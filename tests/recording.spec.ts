import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { cancelJobs, createJobContext } from '../src/react-app/domain/jobs';
import type { CheckpointResult, MeetingProject, SourceAsset, SourceWriter } from '../src/react-app/domain/types';
import { createMicrophoneRecorder, type MicrophoneRecorder, type MicrophoneRecorderOptions, type RecordingSnapshot } from '../src/react-app/recording/recorder';
import { PCM_PACKET_FRAMES } from '../src/react-app/recording/wav';
import { createVaultSession, type VaultSession } from '../src/react-app/vault/session';
import { namedSourceReader } from '../src/react-app/media/io';
import { inspectSource } from '../src/react-app/media/mp3';

// Synthetic port pair uses real structured-clone transfers and the actual
// processor. No browser permission, device, AudioContext or provider is used.
class Port {
  peer!: Port;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  messages: Record<string, unknown>[] = [];
  closed = false;
  postMessage(data: Record<string, unknown>, transfer: Transferable[] = []) {
    const copy = structuredClone(data, { transfer }); this.messages.push(copy);
    queueMicrotask(() => { if (!this.peer.closed) this.peer.onmessage?.({ data: copy } as MessageEvent); });
  }
  close() { this.closed = true; }
}
let constructingPort: Port;
class ProcessorBase { readonly port = constructingPort as unknown as MessagePort; }
type Processor = { process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean };
let ProcessorType: new() => Processor;
beforeAll(async () => {
  vi.stubGlobal('AudioWorkletProcessor', ProcessorBase); vi.stubGlobal('sampleRate', 16000);
  vi.stubGlobal('registerProcessor', (name: string, ctor: new() => Processor) => { expect(name).toBe('mom-microphone-pcm16'); ProcessorType = ctor; });
  await import('../src/react-app/recording/pcm-worklet');
});
class Track extends EventTarget {
  kind = 'audio'; readyState = 'live';
  stop = vi.fn(() => { this.readyState = 'ended'; });
}
class GraphNode { connect = vi.fn(); disconnect = vi.fn(); }
class Context {
  state = 'suspended'; onstatechange: (() => void) | null = null;
  destination = new GraphNode(); source = new GraphNode();
  audioWorklet = { addModule: vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined) };
  constructor(readonly sampleRate: number) {}
  resume = vi.fn(async () => { this.state = 'running'; });
  close = vi.fn(async () => { this.state = 'closed'; this.onstatechange?.(); });
  createMediaStreamSource = vi.fn(() => this.source);
}
class Node extends GraphNode {
  port = new Port(); processorPort = new Port(); processor: Processor;
  onprocessorerror: (() => void) | null = null;
  constructor(rate: number) {
    super(); this.port.peer = this.processorPort; this.processorPort.peer = this.port;
    constructingPort = this.processorPort; vi.stubGlobal('sampleRate', rate); this.processor = new ProcessorType();
  }
  render(input: Float32Array) {
    const output = new Float32Array(input.length).fill(1), result = this.processor.process([[input]], [[output]]);
    expect(output.every(value => value === 0)).toBe(true); return result;
  }
}
const recorders: MicrophoneRecorder[] = [], sessions: VaultSession[] = [], releases: (() => void)[] = [];
afterEach(async () => {
  for (const release of releases.splice(0)) release();
  await Promise.allSettled(recorders.splice(0).map(recorder => recorder.abort()));
  cancelJobs(); for (const session of sessions.splice(0)) await session.dispose();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
function gate() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); releases.push(release); return { promise, release }; }
function project(): MeetingProject {
  return { id: crypto.randomUUID(), title: 'TEST_ONLY_CAPTURE', icon: 'mic', color: '#2B59C3', pinned: false, createdAt: '2026-10-02T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z', sourceAssets: [], preparedChunks: [],
    audioOptions: { chunkMinutes: 5, overlapSeconds: 5, bitrateKbps: 32, sampleRateHz: 16000, expectedLanguages: ['ko'] }, rawTranscripts: [], transcriptVersions: [], selectedTranscriptVersionId: null,
    minutesSettings: { outputLanguage: 'ko', sections: ['summary'], instructions: '', modelId: '' }, minutesRuns: [], minutesRevisions: [], selectedMinutesRevisionId: null, runs: [] };
}
function receipt(asset: SourceAsset): CheckpointResult {
  const p = { ...project(), sourceAssets: [asset] };
  return { project: p, checkpoint: { id: crypto.randomUUID(), projectId: p.id, runId: null, recordIds: [asset.id], committedAt: '2026-10-02T00:00:00Z' } };
}
function fixture(settings: { rate?: number; readyRate?: number; recorder?: Partial<MicrophoneRecorderOptions> } = {}) {
  const track = new Track(), stream = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
  const context = new Context(settings.rate ?? 16000), blocks: Uint8Array[] = [], states: RecordingSnapshot[] = [];
  const writer: SourceWriter = { append: vi.fn(async bytes => { blocks.push(bytes.slice()); }), finalize: vi.fn(async asset => receipt(asset)), abort: vi.fn(async () => {}) };
  const getUserMedia = vi.fn(async () => stream), createWriter = vi.fn(async () => writer), createAudioContext = vi.fn(() => context as unknown as AudioContext);
  let node!: Node;
  const recorder = createMicrophoneRecorder({ sourceId: crypto.randomUUID(), fileName: 'TEST_ONLY_CAPTURE.wav', job: createJobContext(), createWriter, onState: state => states.push(state),
    dependencies: { supported: () => true, getUserMedia, createAudioContext, createWorkletNode: () => { node = new Node(settings.readyRate ?? context.sampleRate); return node as unknown as AudioWorkletNode; } }, ...settings.recorder });
  recorders.push(recorder);
  return { recorder, track, context, writer, blocks, states, getUserMedia, createWriter, createAudioContext, get node() { return node; } };
}
const tone = (frames: number) => Float32Array.from({ length: frames }, (_, i) => Math.sin(i * .2) * .4);
async function settle() { for (let i = 0; i < 16; i++) await Promise.resolve(); }

it('measures actual PCM level including silence and clears the level while paused or saved', async () => {
  const f = fixture(); await f.recorder.start();
  f.node.render(new Float32Array(PCM_PACKET_FRAMES)); await settle();
  expect(f.recorder.getSnapshot().inputLevel).toBe(0);
  f.node.render(new Float32Array(PCM_PACKET_FRAMES).fill(.5)); await settle();
  expect(f.recorder.getSnapshot().inputLevel).toBe(.5);
  await f.recorder.pause(); expect(f.recorder.getSnapshot().inputLevel).toBe(0);
  const paused = f.recorder.getSnapshot();
  f.node.render(new Float32Array(PCM_PACKET_FRAMES).fill(.9)); await settle();
  expect(f.recorder.getSnapshot()).toBe(paused);
  await f.recorder.resume(); f.node.render(new Float32Array(PCM_PACKET_FRAMES).fill(.25)); await settle();
  expect(f.recorder.getSnapshot().inputLevel).toBe(.25);
  const saving = f.recorder.stop(); expect(f.recorder.getSnapshot().inputLevel).toBe(0);
  await saving; expect(f.recorder.getSnapshot().inputLevel).toBe(0);
});

it('requests only microphone permission on explicit Start and never creates a writer after denial', async () => {
  const f = fixture(); f.getUserMedia.mockRejectedValue(new DOMException('TEST_ONLY permission denied', 'NotAllowedError'));
  expect(f.getUserMedia).not.toHaveBeenCalled(); await expect(f.recorder.start()).rejects.toMatchObject({ code: 'permission' });
  expect(f.getUserMedia).toHaveBeenCalledExactlyOnceWith({ audio: true, video: false });
  expect(f.createWriter).not.toHaveBeenCalled(); expect(f.createAudioContext).not.toHaveBeenCalled(); expect(f.recorder.getSnapshot().state).toBe('error');
});
it('rejects insecure or unsupported capture before asking for permission', async () => {
  const getUserMedia = vi.fn(), f = fixture({ recorder: { dependencies: { supported: () => false, getUserMedia, createAudioContext: vi.fn(), createWorkletNode: vi.fn() } } });
  await expect(f.recorder.start()).rejects.toMatchObject({ code: 'unsupported' }); expect(getUserMedia).not.toHaveBeenCalled(); expect(f.createWriter).not.toHaveBeenCalled();
});
it.each([16000, 44100, 48000])('captures actual %i Hz PCM16, excludes pause gaps and saves only the durable exact sample clock', async rate => {
  const job = createJobContext(), f = fixture({ rate, recorder: { job } }); await f.recorder.start();
  expect(f.createWriter).toHaveBeenCalledExactlyOnceWith({ sampleRateHz: rate, channels: 1 }, job);
  expect(f.context.audioWorklet.addModule).toHaveBeenCalledOnce(); expect(f.context.audioWorklet.addModule.mock.calls[0][0]).not.toMatch(/^(blob:|data:)/);
  f.node.render(new Float32Array([-2, -1, -.5, 0, .5, 1, 2])); await f.recorder.pause(); await settle();
  expect(f.track.stop).not.toHaveBeenCalled(); f.node.render(tone(1000)); expect(f.recorder.getSnapshot().acceptedSamples).toBe(7);
  await f.recorder.resume(); f.node.render(tone(121));
  const pending = f.recorder.stop(); expect(f.track.stop).toHaveBeenCalledOnce(); expect(f.recorder.getSnapshot().state).toBe('saving');
  const source = await pending;
  expect(source).toMatchObject({ bytes: 44 + 256, sampleRateHz: rate, channels: 1, container: 'wav', codec: 'pcm_s16le', durationMs: Math.round(128 * 1000 / rate) });
  const view = new DataView(f.blocks[0].buffer); expect(Array.from({ length: 7 }, (_, i) => view.getInt16(i * 2, true))).toEqual([-32768, -32768, -16384, 0, 16384, 32767, 32767]);
  expect(f.recorder.getSnapshot()).toMatchObject({ state: 'saved', acceptedSamples: 128, committedSamples: 128, bodyBytes: 256, committedBytes: 256, source });
  expect(f.context.close).toHaveBeenCalledOnce(); expect(f.node.port.closed).toBe(true); expect(await f.recorder.stop()).toBe(source);
  expect(f.states.every((state, i) => !i || state.durationMs >= f.states[i - 1].durationMs)).toBe(true);
});
it.each([{ rate: 22050 }, { rate: 48000, recorder: { sampleRateHz: 44100 as const } }, { rate: 16000, readyRate: 48000 }])('rejects unsupported or inconsistent actual sample rate %j without a writer', async settings => {
  const f = fixture(settings); await expect(f.recorder.start()).rejects.toMatchObject({ code: 'sample-rate' }); expect(f.track.stop).toHaveBeenCalledOnce(); expect(f.createWriter).not.toHaveBeenCalled();
});
it('rejects duplicate Start and invalid Resume visibly without duplicate tracks', async () => {
  const f = fixture(); await f.recorder.start(); await expect(f.recorder.start()).rejects.toMatchObject({ code: 'busy' }); await expect(f.recorder.resume()).rejects.toMatchObject({ code: 'busy' });
  expect(f.getUserMedia).toHaveBeenCalledOnce(); expect(f.recorder.getSnapshot()).toMatchObject({ state: 'recording', error: 'busy' });
});
it('reports opening storage failure honestly and stops its graph', async () => {
  const f = fixture(); f.createWriter.mockRejectedValue(new DOMException('TEST_ONLY quota opening draft', 'QuotaExceededError'));
  await expect(f.recorder.start()).rejects.toMatchObject({ code: 'storage' }); expect(f.track.stop).toHaveBeenCalledOnce(); expect(f.context.close).toHaveBeenCalledOnce();
});
it('never requests permission from a recorder created with an already canceled job', async () => {
  const job = createJobContext(); cancelJobs(); const f = fixture({ recorder: { job } });
  await expect(f.recorder.start()).rejects.toMatchObject({ name: 'AbortError' }); expect(f.getUserMedia).not.toHaveBeenCalled(); expect(f.recorder.getSnapshot().state).toBe('aborted');
});
it('stops permission granted after abort and never creates a graph or writer', async () => {
  const hold = gate(), f = fixture(), native = f.getUserMedia.getMockImplementation()!;
  f.getUserMedia.mockImplementation(async () => { await hold.promise; return native(); });
  const start = f.recorder.start(), rejected = expect(start).rejects.toMatchObject({ name: 'AbortError' }); await f.recorder.abort(); hold.release(); await rejected;
  expect(f.track.stop).toHaveBeenCalledOnce(); expect(f.createAudioContext).not.toHaveBeenCalled(); expect(f.createWriter).not.toHaveBeenCalled(); expect(f.recorder.getSnapshot().state).toBe('aborted');
});
it('aborts a writer returned after cancellation before starting the processor', async () => {
  const hold = gate(), entered = gate(), f = fixture();
  f.createWriter.mockImplementation(async () => { entered.release(); await hold.promise; return f.writer; });
  const start = f.recorder.start(), rejected = expect(start).rejects.toMatchObject({ name: 'AbortError' }); await entered.promise; await f.recorder.abort(); hold.release(); await rejected;
  expect(f.writer.abort).toHaveBeenCalledOnce(); expect(f.node.port.messages.some(data => data.type === 'start')).toBe(false); expect(f.track.stop).toHaveBeenCalledOnce();
});
it('fails and stops a microphone that ends while its draft is still opening', async () => {
  const hold = gate(), entered = gate(), f = fixture(); f.createWriter.mockImplementation(async () => { entered.release(); await hold.promise; return f.writer; });
  const start = f.recorder.start(), rejected = expect(start).rejects.toMatchObject({ code: 'capture-ended' }); await entered.promise;
  f.track.readyState = 'ended'; f.track.dispatchEvent(new Event('ended')); expect(f.track.stop).toHaveBeenCalledOnce(); hold.release(); await rejected;
  expect(f.writer.abort).toHaveBeenCalledOnce(); expect(f.node.port.messages.some(data => data.type === 'start')).toBe(false); expect(f.recorder.getSnapshot().state).toBe('error');
});
it('closes the graph honestly if constructing the worklet fails, without a dangling Ready waiter', async () => {
  const f = fixture();
  // Use this fixture's synthetic live stream and context, only the constructor
  // fails. Neither real browser support nor microphone permission is involved.
  const recorder = createMicrophoneRecorder({ sourceId: crypto.randomUUID(), fileName: 'TEST_ONLY_FAILURE.wav', job: createJobContext(), createWriter: f.createWriter,
    dependencies: { supported: () => true, getUserMedia: f.getUserMedia, createAudioContext: f.createAudioContext, createWorkletNode: () => { throw new Error('TEST_ONLY worklet failure'); } } }); recorders.push(recorder);
  await expect(recorder.start()).rejects.toMatchObject({ code: 'capture-ended' }); expect(f.track.stop).toHaveBeenCalledOnce(); expect(f.createWriter).not.toHaveBeenCalled();
});
it('fails rather than dropping speech when real processor credits exhaust under held storage', async () => {
  const hold = gate(), f = fixture(); vi.mocked(f.writer.append).mockImplementation(async () => { await hold.promise; }); await f.recorder.start();
  f.node.render(tone(PCM_PACKET_FRAMES)); await settle(); expect(f.writer.append).toHaveBeenCalledOnce();
  expect(f.node.render(tone(PCM_PACKET_FRAMES * 3))).toBe(false); await settle();
  expect(f.recorder.getSnapshot()).toMatchObject({ state: 'error', error: 'backpressure' }); expect(f.track.stop).toHaveBeenCalledOnce(); expect(f.writer.append).toHaveBeenCalledOnce();
  expect(f.node.port.messages.filter(data => data.type === 'ack')).toHaveLength(0); expect(f.writer.finalize).not.toHaveBeenCalled(); hold.release(); await settle(); expect(f.recorder.getSnapshot().source).toBeNull();
});
it('Abort still awaits the known writer drain after an earlier capture failure', async () => {
  const hold = gate(), f = fixture(); vi.mocked(f.writer.append).mockImplementation(async () => { await hold.promise; });
  vi.mocked(f.writer.abort).mockImplementation(async () => { await hold.promise; }); await f.recorder.start(); f.node.render(tone(PCM_PACKET_FRAMES)); await settle();
  f.node.render(tone(PCM_PACKET_FRAMES * 3)); await settle(); expect(f.recorder.getSnapshot().state).toBe('error');
  let drained = false; const aborted = f.recorder.abort().then(() => { drained = true; }); await settle();
  expect(f.track.stop).toHaveBeenCalledOnce(); expect(drained).toBe(false); hold.release(); await aborted; expect(f.writer.abort).toHaveBeenCalledOnce();
});
it('Stop overtakes an unacknowledged Pause and still flushes only the captured samples', async () => {
  const hold = gate(), f = fixture(); vi.mocked(f.writer.append).mockImplementation(async () => { await hold.promise; });
  await f.recorder.start(); f.node.render(tone(PCM_PACKET_FRAMES * 2 + 17)); await settle();
  const pausing = f.recorder.pause(), interrupted = expect(pausing).rejects.toMatchObject({ name: 'AbortError' });
  const saving = f.recorder.stop(); hold.release(); await interrupted; const source = await saving;
  expect(source.bytes).toBe(44 + (PCM_PACKET_FRAMES * 2 + 17) * 2); expect(f.track.stop).toHaveBeenCalledOnce();
});
it('rejects new PCM after a Stop acknowledgment while finalization is still pending', async () => {
  const entered = gate(), hold = gate(), f = fixture(); vi.mocked(f.writer.finalize).mockImplementation(async asset => { entered.release(); await hold.promise; return receipt(asset); });
  await f.recorder.start(); const stale = f.node.port.onmessage!; f.node.render(tone(128)); const saving = f.recorder.stop(), rejected = expect(saving).rejects.toMatchObject({ code: 'invalid-pcm' });
  await entered.promise;
  // CloseGraph already detached the live callback; emulate an already-delivered
  // handler invocation from this same session, before its durable final receipt.
  const bytes = new ArrayBuffer(16); stale({ data: { type: 'pcm', packetId: 2, frames: 8, bytes } } as MessageEvent);
  expect(f.recorder.getSnapshot().acceptedSamples).toBe(128); hold.release(); await rejected;
});
it('does not save non-finite PCM produced by the actual processor', async () => {
  const f = fixture(); await f.recorder.start(); f.node.render(new Float32Array([.2, Number.NaN])); await settle();
  expect(f.recorder.getSnapshot()).toMatchObject({ state: 'error', error: 'invalid-pcm' }); expect(f.writer.append).not.toHaveBeenCalled(); expect(f.writer.finalize).not.toHaveBeenCalled();
});
it('stops tracks first, flushes finite pending PCM, waits durable append and final receipt', async () => {
  const hold = gate(), entered = gate(), promotion = gate(), f = fixture();
  vi.mocked(f.writer.append).mockImplementation(async bytes => { f.blocks.push(bytes.slice()); await hold.promise; });
  vi.mocked(f.writer.finalize).mockImplementation(async asset => { entered.release(); await promotion.promise; return receipt(asset); });
  await f.recorder.start(); f.node.render(tone(PCM_PACKET_FRAMES + 17)); await settle();
  const saving = f.recorder.stop(); expect(f.recorder.stop()).toBe(saving); expect(f.track.stop).toHaveBeenCalledOnce(); await settle();
  expect(f.writer.finalize).not.toHaveBeenCalled(); expect(f.writer.append).toHaveBeenCalledOnce(); hold.release(); await entered.promise;
  expect(f.recorder.getSnapshot()).toMatchObject({ state: 'saving', committedSamples: PCM_PACKET_FRAMES + 17 }); expect(f.writer.append).toHaveBeenCalledTimes(2);
  promotion.release(); const source = await saving; expect(source.bytes).toBe(44 + 2 * (PCM_PACKET_FRAMES + 17)); expect(f.recorder.getSnapshot().state).toBe('saved');
});
it.each(['abort', 'job'])('cuts off held plaintext and late packet/append publication on %s', async boundary => {
  const hold = gate(), f = fixture(); let held!: Uint8Array;
  vi.mocked(f.writer.append).mockImplementation(async bytes => { held = bytes; await hold.promise; }); await f.recorder.start(); f.node.render(tone(PCM_PACKET_FRAMES)); await settle();
  const stale = f.node.port.onmessage!;
  if (boundary === 'abort') await f.recorder.abort(); else cancelJobs();
  expect(f.track.stop).toHaveBeenCalledOnce(); expect(held.every(value => value === 0)).toBe(true);
  const bytes = new ArrayBuffer(16); new Uint8Array(bytes).fill(9); stale({ data: { type: 'pcm', packetId: 2, frames: 8, bytes } } as MessageEvent);
  expect(new Uint8Array(bytes).every(value => value === 0)).toBe(true); hold.release(); await settle();
  expect(f.writer.append).toHaveBeenCalledOnce(); expect(f.recorder.getSnapshot()).toMatchObject({ state: 'aborted', committedSamples: 0, source: null });
});
it('fences an already pending finalization receipt after abort', async () => {
  const entered = gate(), hold = gate(), f = fixture(); vi.mocked(f.writer.finalize).mockImplementation(async asset => { entered.release(); await hold.promise; return receipt(asset); });
  await f.recorder.start(); f.node.render(tone(128)); const saving = f.recorder.stop(), rejected = expect(saving).rejects.toMatchObject({ name: 'AbortError' });
  await entered.promise; await f.recorder.abort(); hold.release(); await rejected; expect(f.recorder.getSnapshot()).toMatchObject({ state: 'aborted', source: null });
  await expect(f.recorder.stop()).rejects.toMatchObject({ name: 'AbortError' });
});
it('cannot return a cached saved source through Stop after its job is locked', async () => {
  const f = fixture(); await f.recorder.start(); f.node.render(tone(128)); await f.recorder.stop(); cancelJobs();
  expect(f.recorder.getSnapshot()).toMatchObject({ state: 'aborted', source: null }); await expect(f.recorder.stop()).rejects.toMatchObject({ name: 'AbortError' });
});
it.each(['append', 'finalize', 'receipt', 'checkpoint'])('retains earlier durable progress and never reports Saved on %s failure', async kind => {
  const f = fixture(); await f.recorder.start(); f.node.render(tone(PCM_PACKET_FRAMES)); await settle(); expect(f.recorder.getSnapshot().committedSamples).toBe(PCM_PACKET_FRAMES);
  if (kind === 'append') vi.mocked(f.writer.append).mockImplementationOnce(() => { throw new DOMException('TEST_ONLY quota', 'QuotaExceededError'); });
  if (kind === 'finalize') vi.mocked(f.writer.finalize).mockRejectedValue(new Error('TEST_ONLY checkpoint failure'));
  if (kind === 'receipt') vi.mocked(f.writer.finalize).mockImplementation(async asset => receipt({ ...asset, bytes: asset.bytes + 2 }));
  if (kind === 'checkpoint') vi.mocked(f.writer.finalize).mockImplementation(async asset => { const result = receipt(asset); return { ...result, checkpoint: { ...result.checkpoint, recordIds: [], committedAt: 'invalid' } }; });
  f.node.render(tone(128)); await expect(f.recorder.stop()).rejects.toMatchObject({ code: 'storage' });
  expect(f.recorder.getSnapshot()).toMatchObject({ state: 'error', error: 'storage', source: null, committedSamples: kind === 'append' ? PCM_PACKET_FRAMES : PCM_PACKET_FRAMES + 128 });
  expect(f.track.stop).toHaveBeenCalledOnce(); expect(f.writer.abort).toHaveBeenCalledOnce();
});
it('rejects empty capture and stops unexpectedly ended microphone tracks', async () => {
  const empty = fixture(); await empty.recorder.start(); await expect(empty.recorder.stop()).rejects.toMatchObject({ code: 'empty' }); expect(empty.writer.finalize).not.toHaveBeenCalled();
  const ended = fixture(); await ended.recorder.start(); ended.track.dispatchEvent(new Event('ended'));
  expect(ended.recorder.getSnapshot()).toMatchObject({ state: 'error', error: 'capture-ended' }); expect(ended.track.stop).toHaveBeenCalledOnce();
});
it('rejects new PCM after confirmed Pause instead of counting the pause gap', async () => {
  const f = fixture(); await f.recorder.start(); f.node.render(tone(128)); await f.recorder.pause(); await settle();
  f.node.processorPort.postMessage({ type: 'pcm', packetId: 2, frames: 8, bytes: new ArrayBuffer(16) }); await settle();
  expect(f.recorder.getSnapshot()).toMatchObject({ state: 'error', error: 'invalid-pcm', acceptedSamples: 128 });
});
it.each([
  { packetId: 2, frames: 8, bytes: 16 }, { packetId: 1, frames: 8, bytes: 14 },
  { packetId: 1, frames: 4097, bytes: 8194 }, { packetId: 1, frames: .5, bytes: 1 },
])('rejects malformed or oversized PCM packet %j before storage', async data => {
  const f = fixture(); await f.recorder.start(); f.node.processorPort.postMessage({ ...data, type: 'pcm', bytes: new ArrayBuffer(data.bytes) }); await settle();
  expect(f.recorder.getSnapshot()).toMatchObject({ state: 'error', error: 'invalid-pcm', acceptedSamples: 0 }); expect(f.writer.append).not.toHaveBeenCalled(); expect(f.track.stop).toHaveBeenCalledOnce();
});
describe('encrypted SourceWriter integration', () => {
  it('promotes exact processor PCM into a range-readable WAV and retains aborted durable draft across lock', async () => {
    const session = createVaultSession({ indexedDB: new IDBFactory(), databaseName: crypto.randomUUID(), testOnlyOwnership: { acquire: async () => () => {} } }); sessions.push(session);
    const secret = 'TEST_ONLY_CAPTURE_VAULT_PHRASE'; await session.create(secret, secret); const p = project(), job = createJobContext(); await session.store.checkpoint({ project: p, runId: null, audioRecords: [] }, job);
    const sourceId = crypto.randomUUID(), f = fixture({ recorder: { sourceId, job, createWriter: (config, context) => { expect(context).toBe(job); return session.createSourceWriter(p.id, sourceId, config, context); } } });
    await f.recorder.start(); f.node.render(tone(PCM_PACKET_FRAMES + 17)); const source = await f.recorder.stop();
    const reader = await session.openRetainedSource(sourceId, job), inspected = await inspectSource(namedSourceReader(reader, source.fileName), job);
    expect(inspected.asset).toMatchObject({ ...source, id: inspected.asset.id }); expect(inspected.decodedSamples).toBe(PCM_PACKET_FRAMES + 17); expect(await session.listSourceDrafts(p.id, job)).toEqual([]);
    // A new recording requires an empty project; existing source replacement is
    // intentionally a separate feature and the reviewed writer rejects it.
    const draftProject = project(); await session.store.checkpoint({ project: draftProject, runId: null, audioRecords: [] }, job);
    const draftId = crypto.randomUUID(), interrupted = fixture({ recorder: { sourceId: draftId, createWriter: (config, context) => session.createSourceWriter(draftProject.id, draftId, config, context) } });
    await interrupted.recorder.start(); interrupted.node.render(tone(PCM_PACKET_FRAMES));
    await vi.waitFor(() => expect(interrupted.recorder.getSnapshot().committedSamples).toBe(PCM_PACKET_FRAMES)); await interrupted.recorder.abort();
    expect(await session.listSourceDrafts(draftProject.id, job)).toMatchObject([{ sourceId: draftId, bodyBytes: PCM_PACKET_FRAMES * 2 }]);
    await session.lock('manual'); await session.unlock(secret); const next = createJobContext();
    expect(await session.listSourceDrafts(draftProject.id, next)).toMatchObject([{ sourceId: draftId, bodyBytes: PCM_PACKET_FRAMES * 2 }]);
    expect((await session.store.readProject(p.id, next))?.sourceAssets).toEqual([source]);
  });
});
