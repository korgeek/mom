import { afterEach, describe, expect, it, vi } from 'vitest';
import { createJobContext, cancelJobs } from '../src/react-app/domain/jobs';
import type { JobContext } from '../src/react-app/domain/types';
import { MPEGDecoder } from 'mpg123-decoder';
import { createAudioPreparer } from '../src/react-app/media/prepare';
import type { Inspection } from '../src/react-app/media/mp3';
import { createBrowserMediaWorker, installMediaWorkerEndpoint, type MediaWorkerScope } from '../src/react-app/media/worker';

afterEach(() => { cancelJobs(); vi.unstubAllGlobals(); });
class ManualWorker {
  static last: ManualWorker;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  messages: Record<string, unknown>[] = [];
  terminated = false;
  constructor() { ManualWorker.last = this; }
  postMessage(value: Record<string, unknown>, transfer: Transferable[] = []) { this.messages.push(structuredClone(value, { transfer })); }
  emit(data: unknown) { this.onmessage?.(new MessageEvent('message', { data })); }
  terminate() { this.terminated = true; }
}
class CodecWorker extends ManualWorker {
  scope: MediaWorkerScope;
  dispose: () => void;
  constructor() {
    super();
    this.scope = { onmessage: null, postMessage: value => queueMicrotask(() => this.onmessage?.(new MessageEvent('message', { data: structuredClone(value) }))) };
    this.dispose = installMediaWorkerEndpoint(this.scope);
  }
  postMessage(value: Record<string, unknown>, transfer: Transferable[] = []) {
    const data = structuredClone(value, { transfer }); this.messages.push(data);
    queueMicrotask(() => this.scope.onmessage?.(new MessageEvent('message', { data })));
  }
  terminate() { super.terminate(); this.dispose(); }
}
describe('retained source main-thread Worker bridge', () => {
	it.each([{ stage: 'heartbeat' }, { phaseProcessedMs: -1 }, { phaseDurationMs: 0 }, { encodedBytes: -1 }])('rejects invalid stage progress instead of treating it as real work %#', async invalid => {
		vi.stubGlobal('Worker', ManualWorker);
		const progress = vi.fn(), worker = createBrowserMediaWorker(progress);
		const outcome = worker.inspect(new File(['TEST_ONLY'], 'synthetic.wav'), createJobContext()).catch(error => error);
		try {
			ManualWorker.last.emit({ id: 0, progress: { sourceProcessedMs: 0, durationMs: 1000, pcmBytes: 0, encodedBytes: 0, ...invalid } });
			expect(ManualWorker.last.terminated).toBe(true);
			expect(progress).not.toHaveBeenCalled();
			expect(await outcome).toMatchObject({ code: 'damaged-input' });
		} finally { worker.terminate(); }
	});
  const inspection = (name: string): Inspection => ({ asset: { id: 'synthetic-source', fileName: name, bytes: 4, container: 'wav', codec: 'pcm_s16le', durationMs: 1, sampleRateHz: 16000, channels: 1 }, decodedSamples: 1, originalEncoding: { delaySamples: null, paddingSamples: null } });
  it('rejects a range outside an active Worker operation without reading plaintext', async () => {
    vi.stubGlobal('Worker', ManualWorker); let reads = 0;
    const name = 'TEST_ONLY_IDLE_RANGE', worker = createBrowserMediaWorker(), pending = worker.inspect({ name, size: 4, read: async () => { reads++; return new ArrayBuffer(4); } }, createJobContext());
    ManualWorker.last.emit({ id: 1, value: inspection(name) }); await pending;
    ManualWorker.last.emit({ operation: 'read', readId: 1, start: 0, end: 4 }); await new Promise(resolve => setTimeout(resolve, 0));
    try { expect(reads).toBe(0); expect(ManualWorker.last.terminated).toBe(true); }
    finally { worker.terminate(); }
  });
  it('rejects an operation result before its held read completes and discards the late plaintext', async () => {
    vi.stubGlobal('Worker', ManualWorker); let release!: (bytes: ArrayBuffer) => void;
    const bytes = Uint8Array.of(1, 2, 3, 4), held = new Promise<ArrayBuffer>(resolve => { release = resolve; });
    const name = 'TEST_ONLY_EARLY_RESULT', worker = createBrowserMediaWorker(), pending = worker.inspect({ name, size: 4, read: async () => held }, createJobContext());
    ManualWorker.last.emit({ operation: 'read', readId: 1, start: 0, end: 4 }); ManualWorker.last.emit({ id: 1, value: inspection(name) });
    try { await expect(pending).rejects.toMatchObject({ code: 'damaged-input' }); }
    finally { worker.terminate(); release(bytes.buffer); await new Promise(resolve => setTimeout(resolve, 0)); }
    expect([...bytes]).toEqual([0, 0, 0, 0]); expect(ManualWorker.last.messages).toHaveLength(1);
  });
  it('rejects a repeated completed range ID without a second read', async () => {
    vi.stubGlobal('Worker', ManualWorker); let reads = 0;
    const worker = createBrowserMediaWorker(), pending = worker.inspect({ name: 'TEST_ONLY_REPEATED_ID', size: 4, read: async () => { reads++; return new ArrayBuffer(4); } }, createJobContext());
    ManualWorker.last.emit({ operation: 'read', readId: 1, start: 0, end: 4 }); await new Promise(resolve => setTimeout(resolve, 0));
    ManualWorker.last.emit({ operation: 'read', readId: 1, start: 0, end: 4 });
    await expect(pending).rejects.toMatchObject({ code: 'damaged-input' }); expect(reads).toBe(1); expect(ManualWorker.last.messages).toHaveLength(2);
  });
  it('fences a result received after the original job epoch changes between reads', async () => {
    vi.stubGlobal('Worker', ManualWorker); let active = true;
    const job: JobContext = { epoch: 9, signal: new AbortController().signal, assertActive() { if (!active) throw new DOMException('Synthetic inactive epoch', 'AbortError'); } };
    const name = 'TEST_ONLY_RESULT_EPOCH', worker = createBrowserMediaWorker(), pending = worker.inspect({ name, size: 4, read: async () => new ArrayBuffer(4) }, job);
    active = false; ManualWorker.last.emit({ id: 1, value: inspection(name) });
    try { await expect(pending).rejects.toMatchObject({ name: 'AbortError' }); expect(ManualWorker.last.terminated).toBe(true); }
    finally { worker.terminate(); }
  });
  it.each([
    { operation: 'read', readId: 0, start: 0, end: 4 },
    { operation: 'read', readId: 2, start: 0, end: 4 },
    { operation: 'read', readId: 1, start: -1, end: 4 },
    { operation: 'read', readId: 1, start: .5, end: 4 },
    { operation: 'read', readId: 1, start: 0, end: 0 },
    { operation: 'read', readId: 1, start: 8, end: 4 },
    { operation: 'read', readId: 1, start: 0, end: 1048577 },
    { operation: 'read', readId: 1, start: 0, end: Infinity },
    { operation: 'read', readId: 1, start: 0, end: 3 * 1048576 },
  ])('rejects malformed/over-admission range $readId:$start..$end without any backend read', async message => {
    vi.stubGlobal('Worker', ManualWorker); let reads = 0;
    const worker = createBrowserMediaWorker(), job = createJobContext();
    const pending = worker.inspect({ name: 'TEST_ONLY_BOUNDED_SOURCE', size: 2 * 1048576, async read() { reads++; return new ArrayBuffer(4); } }, job);
    ManualWorker.last.emit(message);
    await expect(pending).rejects.toMatchObject({ code: 'damaged-input' }); expect(reads).toBe(0); expect(ManualWorker.last.terminated).toBe(true);
  });
  it.each([
    { id: 1, error: { name: 'MediaError', message: 'TEST_ONLY_INVALID_ERROR', code: {} } },
    { id: 1, error: { name: 'MediaError', message: 'TEST_ONLY_INVALID_ERROR', code: 'not-a-media-code' } },
    { id: 1, error: { name: 'UnknownError', message: 'TEST_ONLY_INVALID_ERROR' } },
  ])('rejects malformed error messages without accepting unknown protocol fields %#', async message => {
    vi.stubGlobal('Worker', ManualWorker);
    const worker = createBrowserMediaWorker(), pending = worker.inspect({ name: 'TEST_ONLY_ERROR_RESPONSE', size: 4, read: async () => new ArrayBuffer(4) }, createJobContext());
    ManualWorker.last.emit(message);
    try { await expect(pending).rejects.toMatchObject({ code: 'damaged-input' }); }
    finally { worker.terminate(); }
  });
  it('admits one outstanding range, fails duplicates, and cannot queue a second plaintext read', async () => {
    vi.stubGlobal('Worker', ManualWorker); let reads = 0, release!: (bytes: ArrayBuffer) => void;
    const held = new Promise<ArrayBuffer>(resolve => { release = resolve; });
    const worker = createBrowserMediaWorker(), pending = worker.inspect({ name: 'TEST_ONLY_HELD_READ', size: 8, read: async () => { reads++; return held; } }, createJobContext());
    ManualWorker.last.emit({ operation: 'read', readId: 1, start: 0, end: 4 });
    ManualWorker.last.emit({ operation: 'read', readId: 2, start: 4, end: 8 });
    await expect(pending).rejects.toMatchObject({ code: 'damaged-input' }); expect(reads).toBe(1);
    release(Uint8Array.of(1, 2, 3, 4).buffer); await new Promise(resolve => setTimeout(resolve, 0));
    expect(ManualWorker.last.messages).toHaveLength(1);
  });
  it.each(['terminate', 'abort', 'epoch'] as const)('fences a held late read on %s and never transfers its plaintext', async mode => {
    vi.stubGlobal('Worker', ManualWorker); let active = true, release!: (bytes: ArrayBuffer) => void;
    const controller = new AbortController(), job: JobContext = { epoch: 7, signal: controller.signal, assertActive() { if (!active || controller.signal.aborted) throw new DOMException('Synthetic inactive epoch', 'AbortError'); } };
    const held = new Promise<ArrayBuffer>(resolve => { release = resolve; }), bytes = Uint8Array.of(11, 22, 33, 44);
    const worker = createBrowserMediaWorker(), pending = worker.inspect({ name: 'TEST_ONLY_LATE_READ', size: 4, read: async (_start, _end, received) => { expect(received).toBe(job); return held; } }, job);
    ManualWorker.last.emit({ operation: 'read', readId: 1, start: 0, end: 4 });
    if (mode === 'terminate') worker.terminate(); else if (mode === 'abort') controller.abort(); else active = false;
    release(bytes.buffer); await expect(pending).rejects.toMatchObject({ name: 'AbortError' }); await new Promise(resolve => setTimeout(resolve, 0));
    expect(ManualWorker.last.messages).toHaveLength(1); expect([...bytes]).toEqual([0, 0, 0, 0]);
    await expect(worker.next()).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('rejects short backend buffers before any transfer and unknown response IDs permanently', async () => {
    vi.stubGlobal('Worker', ManualWorker);
    const worker = createBrowserMediaWorker(), pending = worker.inspect({ name: 'TEST_ONLY_SHORT_READ', size: 4, read: async () => new ArrayBuffer(3) }, createJobContext());
    ManualWorker.last.emit({ operation: 'read', readId: 1, start: 0, end: 4 });
    await expect(pending).rejects.toMatchObject({ code: 'damaged-input' }); expect(ManualWorker.last.messages).toHaveLength(1);
    const other = createBrowserMediaWorker(), request = other.inspect({ name: 'TEST_ONLY_UNKNOWN_ID', size: 4, read: async () => new ArrayBuffer(4) }, createJobContext());
    ManualWorker.last.emit({ id: 999, value: undefined }); await expect(request).rejects.toMatchObject({ code: 'damaged-input' });
  });
  it('rejects concurrent caller RPCs without adding another Worker request', async () => {
    vi.stubGlobal('Worker', ManualWorker);
    const worker = createBrowserMediaWorker(), input = { name: 'TEST_ONLY_NO_QUEUE', size: 4, read: async () => new ArrayBuffer(4) }, job = createJobContext();
    const pending = worker.inspect(input, job); await expect(worker.inspect(input, job)).rejects.toMatchObject({ code: 'busy' }); expect(ManualWorker.last.messages).toHaveLength(1);
    worker.terminate(); await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('executes the actual module endpoint and unchanged codec through transferred ranges and the original main job', async () => {
    vi.stubGlobal('Worker', CodecWorker);
    const bytes = new Uint8Array(32044), view = new DataView(bytes.buffer), text = (at: number, value: string) => [...value].forEach((c, i) => { bytes[at + i] = c.charCodeAt(0); });
    text(0, 'RIFF'); view.setUint32(4, 32036, true); text(8, 'WAVE'); text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, 32000, true);
    for (let i = 0; i < 16000; i++) view.setInt16(44 + i * 2, Math.sin(i * .2) * 12000, true);
    const job = createJobContext(), saved: Blob[] = []; let reading = false;
    const input = { name: 'TEST_ONLY_REAL_WORKER_ENGINE.wav', size: bytes.length, async read(start: number, end: number, received: JobContext) {
      expect(received).toBe(job); expect(reading).toBe(false); reading = true;
      try { await Promise.resolve(); expect(end - start).toBeLessThanOrEqual(1048576); return bytes.slice(start, end).buffer; }
      finally { reading = false; }
    } };
    const prepare = createAudioPreparer({ sourceId: 'synthetic-worker-source', sink: async (_chunk, audio) => { saved.push(audio); } }), chunks = [];
    for await (const chunk of prepare(input, { chunkMinutes: 5, overlapSeconds: 5, bitrateKbps: 32, expectedLanguages: ['en'], sampleRateHz: 16000 }, job)) chunks.push(chunk);
    expect(chunks).toHaveLength(1); expect(chunks[0].sourceEndMs).toBe(1000);
    expect(ManualWorker.last.messages[0]).toMatchObject({ operation: 'inspect', reader: { name: input.name, size: bytes.length } });
    const transfers = ManualWorker.last.messages.filter(message => message.operation === 'read-result'); expect(transfers.length).toBeGreaterThan(2);
    expect(transfers.every(message => (message.bytes as ArrayBuffer).byteLength === (message.end as number) - (message.start as number))).toBe(true);
    const decoder = new MPEGDecoder(); await decoder.ready;
    try { const decoded = decoder.decode(new Uint8Array(await saved[0].arrayBuffer())); expect(decoded.errors).toEqual([]); expect(decoded.samplesDecoded).toBeGreaterThanOrEqual(16000); }
    finally { decoder.free(); }
    expect(ManualWorker.last.terminated).toBe(true);
  });
  it.each(['id', 'offset', 'length', 'typed-array'] as const)('fails an invalid transferred range %s at the actual module endpoint', async corruption => {
    class CorruptWorker extends CodecWorker {
      postMessage(value: Record<string, unknown>, transfer: Transferable[] = []) {
        if (value.operation === 'read-result') {
          value = { ...value };
          if (corruption === 'id') value.readId = 999;
          if (corruption === 'offset') value.start = 1;
          if (corruption === 'length') value.bytes = new ArrayBuffer((value.end as number) - (value.start as number) - 1);
          if (corruption === 'typed-array') value.bytes = new Uint8Array((value.end as number) - (value.start as number));
          transfer = [];
        }
        super.postMessage(value, transfer);
      }
    }
    vi.stubGlobal('Worker', CorruptWorker);
    const worker = createBrowserMediaWorker(), pending = worker.inspect({ name: 'TEST_ONLY_RANGE_RESPONSE', size: 16, read: async (start, end) => new ArrayBuffer(end - start) }, createJobContext());
    await expect(pending).rejects.toMatchObject({ code: 'damaged-input' }); expect(ManualWorker.last.terminated).toBe(true);
  });
  it('rejects a malformed successful inspection response instead of resolving an invalid source', async () => {
    vi.stubGlobal('Worker', ManualWorker);
    const worker = createBrowserMediaWorker(), job = createJobContext(), pending = worker.inspect({ name: 'TEST_ONLY_RPC_RESPONSE', size: 4, read: async () => new ArrayBuffer(4) }, job);
    ManualWorker.last.emit({ id: ManualWorker.last.messages[0].id, value: null });
    try { await expect(pending).rejects.toMatchObject({ code: 'damaged-input' }); }
    finally { worker.terminate(); }
  });
  it('fails an unknown operation before any endpoint work instead of leaving the caller pending', async () => {
    class LoopbackWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      scope: MediaWorkerScope;
      dispose: () => void;
      constructor() {
        this.scope = { onmessage: null, postMessage: value => queueMicrotask(() => this.onmessage?.(new MessageEvent('message', { data: structuredClone(value) }))) };
        this.dispose = installMediaWorkerEndpoint(this.scope);
      }
      postMessage(value: Record<string, unknown>) { queueMicrotask(() => this.scope.onmessage?.(new MessageEvent('message', { data: { ...value, operation: 'unknown' } }))); }
      terminate() { this.dispose(); }
    }
    vi.stubGlobal('Worker', LoopbackWorker);
    const worker = createBrowserMediaWorker(), job = createJobContext(), source = { size: 4, name: 'TEST_ONLY_UNKNOWN_OPERATION', async read() { throw new Error('No read may be admitted'); } };
    const pending = worker.inspect(source, job);
    const result = await Promise.race([pending.then(() => 'resolved', error => error), new Promise(resolve => setTimeout(() => resolve({ code: 'still-pending' }), 100))]);
    try { expect(result).toMatchObject({ code: 'damaged-input' }); }
    finally { worker.terminate(); }
  });
  it('posts only a source descriptor and transfers exact requested bytes using the original job', async () => {
    const job = createJobContext(), bytes = Uint8Array.of(82, 73, 70, 70), posted: Record<string, unknown>[] = [];
    const inspected: Inspection = { asset: { id: 'synthetic-source', fileName: 'TEST_ONLY_WORKER.wav', bytes: 4, container: 'wav', codec: 'pcm_s16le', durationMs: 1, sampleRateHz: 16000, channels: 1 }, decodedSamples: 1, originalEncoding: { delaySamples: null, paddingSamples: null } };
    let transferred: ArrayBuffer | null = null;
    class TransportWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      requestId = 0;
      postMessage(value: Record<string, unknown>, transfer: Transferable[] = []) {
        const data = structuredClone(value, { transfer }); posted.push(data);
        if (data.operation === 'inspect') {
          this.requestId = data.id as number;
          queueMicrotask(() => this.onmessage?.(new MessageEvent('message', { data: { operation: 'read', readId: 1, start: 0, end: 4 } })));
        } else if (data.operation === 'read-result') {
          expect(new Uint8Array(data.bytes as ArrayBuffer)).toEqual(bytes);
          queueMicrotask(() => this.onmessage?.(new MessageEvent('message', { data: { id: this.requestId, value: inspected } })));
        }
      }
      terminate() {}
    }
    vi.stubGlobal('Worker', TransportWorker);
    const input = { name: inspected.asset.fileName, size: bytes.length, async read(start: number, end: number, received: JobContext) { expect(received).toBe(job); expect([start, end]).toEqual([0, 4]); transferred = bytes.slice().buffer; return transferred; } };
    const worker = createBrowserMediaWorker();
    try {
      expect(await worker.inspect(input, job)).toEqual(inspected);
      expect(posted[0]).toMatchObject({ operation: 'inspect', reader: { name: input.name, size: input.size } });
      expect(posted[0].file).toBeUndefined(); expect(posted).toHaveLength(2);
      expect((transferred as unknown as ArrayBuffer).byteLength).toBe(0);
    } finally { worker.terminate(); }
  });
});
