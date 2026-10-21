import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createJobContext, cancelJobs } from '../src/react-app/domain/jobs';
import { inspectSource } from '../src/react-app/media/mp3';

const fixture = (name = 'synthetic-aac.m4a') => new File([readFileSync(new URL(`./fixtures/media/${name}`, import.meta.url))], 'synthetic.bin', { type: 'application/octet-stream' });
afterEach(() => { cancelJobs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('M4A validation before local decoding or provider dispatch', () => {
  it('recognizes AAC bytes and reports missing native decoder instead of generic container failure', async () => {
    await expect(inspectSource(fixture())).rejects.toMatchObject({ code: 'unsupported-browser' });
  });
  it('separately rejects ALAC with an actionable codec classification', async () => {
    await expect(inspectSource(fixture('synthetic-alac.m4a'))).rejects.toMatchObject({ code: 'unsupported-codec' });
  });
  it('rejects a truncated media-data box as damaged input', async () => {
    const file = fixture();
    await expect(inspectSource(new File([file.slice(0, file.size - 1)], 'truncated.m4a'))).rejects.toMatchObject({ code: 'damaged-input' });
  });
  it('honors an inactive job before reading M4A bytes', async () => {
    const job = createJobContext(); cancelJobs();
    await expect(inspectSource(fixture(), job)).rejects.toMatchObject({ name: 'AbortError' });
  });
});

// These tests exercise actual metadata/sample tables, without a codec mock.
import { readM4a, m4aMonoPcm, M4A_LIMITS } from '../src/react-app/media/m4a';
import { MediaError, mediaFailureMessage } from '../src/react-app/media/errors';
const mutate = async (change: (bytes: Uint8Array, view: DataView) => void) => {
  const bytes = new Uint8Array(await fixture().arrayBuffer()); change(bytes, new DataView(bytes.buffer)); return new File([bytes], 'mutated.m4a');
};
const find = (bytes: Uint8Array, name: string) => Buffer.from(bytes).indexOf(name, 0, 'latin1');
describe('bounded M4A metadata and source timing', () => {
  it('uses AAC configuration channels and verified gapless sample counts', async () => {
    const source = await readM4a(fixture(), createJobContext());
    expect(source).toMatchObject({ channels: 1, sampleRateHz: 44100, decodedSamples: 176400, delaySamples: 2112, paddingSamples: 688 });
    expect(source.config).toMatchObject({ codec: 'mp4a.40.2', numberOfChannels: 1, sampleRate: 44100 });
    expect(source.samples).toHaveLength(175);
    expect(source.samples[0]).toMatchObject({ offset: 4096, size: 4, cts: 0, duration: 1024 });
  });
  it('never reads the whole file and retains only metadata and requested packet slices', async () => {
    const file = fixture(); const sizes: number[] = [];
    vi.spyOn(file, 'arrayBuffer').mockRejectedValue(new Error('Whole-file read forbidden'));
    const original = file.slice.bind(file);
    vi.spyOn(file, 'slice').mockImplementation((start, end) => { sizes.push((end ?? file.size) - (start ?? 0)); return original(start, end); });
    await readM4a(file, createJobContext());
    expect(Math.max(...sizes)).toBeLessThan(file.size);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(M4A_LIMITS.metadataBytes);
  });
  it('rejects out-of-file sample offsets before decoding', async () => {
    const file = await mutate((bytes, view) => view.setUint32(find(bytes, 'stco') + 12, bytes.length + 1));
    await expect(readM4a(file, createJobContext())).rejects.toMatchObject({ code: 'damaged-input' });
  });
  it('rejects metadata declaring excessive samples before parser allocations', async () => {
    const file = await mutate((bytes, view) => { const at = find(bytes, 'stsz'); view.setUint32(at + 8, 4); view.setUint32(at + 12, M4A_LIMITS.samples + 1); });
    await expect(readM4a(file, createJobContext())).rejects.toMatchObject({ code: 'media-limit' });
  });
  it('rejects zero or mismatched sample timing instead of trusting the header duration', async () => {
    for (const delta of [0, 512]) {
      const file = await mutate((bytes, view) => view.setUint32(find(bytes, 'stts') + 16, delta));
      await expect(readM4a(file, createJobContext())).rejects.toMatchObject({ code: 'damaged-input' });
    }
  });
  it('rejects a mismatched sample-count table even if payload lengths are valid', async () => {
    const file = await mutate((bytes, view) => view.setUint32(find(bytes, 'stts') + 12, 174));
    await expect(readM4a(file, createJobContext())).rejects.toMatchObject({ code: 'damaged-input' });
  });
  it('rejects HE-AAC config before any native decoder attempt', async () => {
    const file = await mutate((bytes) => { const at = find(bytes, 'esds'); bytes[at + 39] = 0x2a; });
    await expect(readM4a(file, createJobContext())).rejects.toMatchObject({ code: 'unsupported-codec' });
  });
  it('rejects inconsistent gapless metadata rather than dropping uncertain samples', async () => {
    const file = await mutate((bytes) => { const at = find(bytes, '00000840'); bytes[at + 7] = '1'.charCodeAt(0); });
    await expect(readM4a(file, createJobContext())).rejects.toMatchObject({ code: 'damaged-input' });
  });
  it('does not expose arbitrary messages or prototype properties through media guidance', () => {
    const error = new MediaError('unsupported-codec', 'PRIVATE_CONTENT secret-provider-message');
    expect(mediaFailureMessage(error, 'en')).toContain('ALAC');
    expect(mediaFailureMessage(error, 'ko')).toContain('ALAC');
    expect(mediaFailureMessage(error, 'en')).not.toContain('PRIVATE_CONTENT');
    expect(mediaFailureMessage(new MediaError('toString' as never, 'PRIVATE_CONTENT'), 'en')).toBeUndefined();
  });
});

// Node lacks native AAC. This substitute tests lifecycle/backpressure only;
// real AAC decoding and MP3 output are independently exercised in headed Chrome.
function nativeLifecycle({ supported = true, frames = 1024, deferFlush = false, sampleRate = 44100 } = {}) {
  const stats = { largestQueue: 0, outputsClosed: 0, decoderClosed: false, decodedPackets: 0, packetData: [] as Uint8Array[] };
  let release!: () => void;
  const paused = new Promise<void>(resolve => { release = resolve; });
  class Packet { constructor(public readonly init: { timestamp: number; data: Uint8Array }) {} }
  class Decoder {
    static async isConfigSupported() { return { supported }; }
    state = 'unconfigured'; decodeQueueSize = 0; private queue: Packet[] = [];
    constructor(private readonly callbacks: { output: (data: unknown) => void }) {}
    configure() { this.state = 'configured'; }
    decode(packet: Packet) { this.queue.push(packet); stats.packetData.push(new Uint8Array(packet.init.data)); stats.decodedPackets++; this.decodeQueueSize++; stats.largestQueue = Math.max(stats.largestQueue, this.decodeQueueSize); }
    async flush() {
      if (deferFlush) await paused;
      if (this.state === 'closed') throw new Error('Native cancellation fixture');
      for (const packet of this.queue.splice(0)) this.callbacks.output({ sampleRate, numberOfChannels: 1, numberOfFrames: frames, timestamp: packet.init.timestamp,
        copyTo: (target: Float32Array) => target.fill(.5), close: () => { stats.outputsClosed++; } });
      this.decodeQueueSize = 0;
    }
    close() { this.state = 'closed'; this.queue = []; this.decodeQueueSize = 0; stats.decoderClosed = true; }
  }
  vi.stubGlobal('AudioDecoder', Decoder); vi.stubGlobal('EncodedAudioChunk', Packet);
  return { stats, release };
}
describe('AAC decoder lifecycle and bounded output', () => {
  it('reports a native runtime codec capability rejection explicitly', async () => {
    nativeLifecycle({ supported: false });
    await expect(inspectSource(fixture())).rejects.toMatchObject({ code: 'unsupported-browser' });
  });
  it('drains fixed packet batches, trims priming/padding, and closes every AudioData', async () => {
    const { stats } = nativeLifecycle(); const file = fixture(); const source = await readM4a(file, createJobContext());
    let samples = 0, largestBlock = 0;
    for await (const block of m4aMonoPcm(file, source, createJobContext())) { samples += block.length; largestBlock = Math.max(largestBlock, block.length); expect(block.every(value => value === .5)).toBe(true); }
    expect(samples).toBe(176400); expect(largestBlock).toBeLessThanOrEqual(source.sampleRateHz);
    expect(stats.largestQueue).toBeLessThanOrEqual(M4A_LIMITS.decodeBatch);
    expect(stats.outputsClosed).toBe(175); expect(stats.decoderClosed).toBe(true);
  });
  it('reuses a bounded encoded-byte window instead of reading every AAC packet', async () => {
    const { stats } = nativeLifecycle(); const file = fixture(), job = createJobContext();
    const source = await readM4a(file, job), reads: [number, number][] = [], buffers: ArrayBuffer[] = [];
    const reader = { size: file.size, async read(start: number, end: number) {
      reads.push([start, end]); const bytes = await file.slice(start, end).arrayBuffer(); buffers.push(bytes); return bytes;
    } };
    let samples = 0;
    for await (const block of m4aMonoPcm(reader, source, job)) samples += block.length;
    expect(samples).toBe(176400);
    expect(stats.outputsClosed).toBe(175); expect(stats.decoderClosed).toBe(true);
    expect(reads).toHaveLength(1);
    expect(reads.every(([start, end]) => end - start <= 1024 * 1024)).toBe(true);
    expect(buffers.every(bytes => new Uint8Array(bytes).every(value => value === 0))).toBe(true);
  });
  it('clears the encoded window when a consumer returns before the source ends', async () => {
    const { stats } = nativeLifecycle(); const file = fixture(), job = createJobContext();
    const source = await readM4a(file, job), buffers: ArrayBuffer[] = [];
    const reader = { size: file.size, async read(start: number, end: number) {
      const bytes = await file.slice(start, end).arrayBuffer(); buffers.push(bytes); return bytes;
    } };
    const iterator = m4aMonoPcm(reader, source, job);
    expect((await iterator.next()).done).toBe(false);
    await iterator.return(undefined);
    expect(stats.decoderClosed).toBe(true);
    expect(buffers.every(bytes => new Uint8Array(bytes).every(value => value === 0))).toBe(true);
  });
  it('preserves packet bytes across the bounded read window boundary and clears replaced bytes', async () => {
    const { stats } = nativeLifecycle(), job = createJobContext();
    const template = await readM4a(fixture(), job), bytes = new Uint8Array(1024 * 1024 + 12);
    bytes.set([1, 2, 3, 4, 5, 6, 7, 8]);
    bytes.set([11, 12, 13, 14, 15, 16, 17, 18], 1024 * 1024 - 4);
    bytes.set([21, 22, 23, 24, 25, 26, 27, 28], 1024 * 1024 + 4);
    const source = { ...template, delaySamples: 0, paddingSamples: 0, decodedSamples: 3072,
      samples: [0, 1024 * 1024 - 4, 1024 * 1024 + 4].map((offset, i) => ({ offset, size: 8, cts: i * 1024, duration: 1024, timescale: 44100 })) };
    const ranges: [number, number][] = [], buffers: ArrayBuffer[] = [];
    const reader = { size: bytes.length, async read(start: number, end: number) {
      expect(buffers.every(previous => new Uint8Array(previous).every(value => value === 0))).toBe(true);
      ranges.push([start, end]); const result = bytes.slice(start, end).buffer; buffers.push(result); return result;
    } };
    let samples = 0;
    for await (const block of m4aMonoPcm(reader, source, job)) samples += block.length;
    expect(samples).toBe(3072);
    expect(ranges).toEqual([[0, 1048576], [1048572, 1048588]]);
    expect(stats.packetData.map(packet => [...packet])).toEqual([
      [1, 2, 3, 4, 5, 6, 7, 8], [11, 12, 13, 14, 15, 16, 17, 18], [21, 22, 23, 24, 25, 26, 27, 28],
    ]);
    expect(stats.decoderClosed).toBe(true);
    expect(buffers.every(previous => new Uint8Array(previous).every(value => value === 0))).toBe(true);
  });
  it('clears late encoded bytes and rejects a pending read after cancellation', async () => {
    const { stats } = nativeLifecycle(), file = fixture(), job = createJobContext();
    const source = await readM4a(file, job);
    let release!: () => void, late = new Uint8Array(0);
    const held = new Promise<void>(resolve => { release = resolve; });
    const reader = { size: file.size, async read(start: number, end: number) {
      late = new Uint8Array(await file.slice(start, end).arrayBuffer()); await held; return late.buffer;
    } };
    const iterator = m4aMonoPcm(reader, source, job), pending = iterator.next();
    await vi.waitFor(() => expect(late.length).toBeGreaterThan(0));
    cancelJobs(); expect(stats.decoderClosed).toBe(true); release();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(late.every(value => value === 0)).toBe(true); expect(stats.decodedPackets).toBe(0);
  });
  it('rejects a truncated encoded read before decoding and closes the decoder', async () => {
    const { stats } = nativeLifecycle(), file = fixture(), job = createJobContext();
    const source = await readM4a(file, job);
    const reader = { size: file.size, async read(start: number, end: number) { return file.slice(start, end - 1).arrayBuffer(); } };
    await expect(m4aMonoPcm(reader, source, job).next()).rejects.toMatchObject({ code: 'damaged-input' });
    expect(stats.decodedPackets).toBe(0); expect(stats.decoderClosed).toBe(true);
  });
  it('fails safely when native decoded frame lengths violate the AAC configuration', async () => {
    const { stats } = nativeLifecycle({ frames: 2048 });
    await expect(inspectSource(fixture())).rejects.toMatchObject({ code: 'damaged-input' });
    expect(stats.decoderClosed).toBe(true); expect(stats.outputsClosed).toBe(32);
  });
  it('keeps 16 kHz decoded batches below one second', async () => {
    const { stats } = nativeLifecycle({ sampleRate: 16000 });
    const file = await mutate((bytes, view) => {
      const asc = find(bytes, 'esds') + 39; bytes[asc] = 0x14; bytes[asc + 1] = 8;
      view.setUint32(find(bytes, 'mp4a') + 28, 16000 * 65536);
      view.setUint32(find(bytes, 'mdhd') + 16, 16000);
    });
    const source = await readM4a(file, createJobContext());
    let samples = 0;
    for await (const block of m4aMonoPcm(file, source, createJobContext())) { samples += block.length; expect(block.length).toBeLessThanOrEqual(16000); }
    expect(samples).toBe(176400);
    expect(stats.largestQueue).toBeLessThanOrEqual(Math.floor(16000 / 1024));
  });
  it('closes queued decoding immediately on lock and rejects a late flush', async () => {
    const { stats, release } = nativeLifecycle({ deferFlush: true });
    const file = fixture(), source = await readM4a(file, createJobContext());
    const iterator = m4aMonoPcm(file, source, createJobContext()); const pending = iterator.next();
    await vi.waitFor(() => expect(stats.decodedPackets).toBe(32));
    cancelJobs(); expect(stats.decoderClosed).toBe(true); release();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(stats.decodedPackets).toBe(32); expect(stats.outputsClosed).toBe(0);
  });
});

describe('M4A metadata placement and track layout', () => {
  it('handles a moov at the end without scanning/retaining media payload', async () => {
    const bytes = new Uint8Array(await fixture().arrayBuffer()), view = new DataView(bytes.buffer);
    const moovStart = find(bytes, 'moov') - 4, moovSize = view.getUint32(moovStart);
    const offsets = find(bytes, 'stco'), count = view.getUint32(offsets + 8);
    for (let i = 0; i < count; i++) view.setUint32(offsets + 12 + i * 4, view.getUint32(offsets + 12 + i * 4) - moovSize);
    const file = new File([bytes.subarray(0, moovStart), bytes.subarray(moovStart + moovSize), bytes.subarray(moovStart, moovStart + moovSize)], 'moov-at-end.m4a');
    const source = await readM4a(file, createJobContext());
    expect(source.decodedSamples).toBe(176400); expect(source.samples[0].offset).toBe(4096 - moovSize);
  });
  it('rejects multiple audio tracks before allocating their sample lists', async () => {
    const bytes = new Uint8Array(await fixture().arrayBuffer()), view = new DataView(bytes.buffer);
    const start = find(bytes, 'trak') - 4, length = view.getUint32(start), moov = find(bytes, 'moov') - 4;
    view.setUint32(moov, view.getUint32(moov) + length);
    const file = new File([bytes.subarray(0, start + length), bytes.subarray(start, start + length), bytes.subarray(start + length)], 'multiple-tracks.m4a');
    await expect(readM4a(file, createJobContext())).rejects.toMatchObject({ code: 'unsupported-layout' });
  });
  it('accepts a simple edit list consistent with gapless metadata and rejects rate changes', async () => {
    const make = async (rate: number) => {
      const bytes = new Uint8Array(await fixture().arrayBuffer()), view = new DataView(bytes.buffer);
      const edits = new Uint8Array(36), ev = new DataView(edits.buffer);
      const text = (offset: number, value: string) => [...value].forEach((char, i) => { edits[offset + i] = char.charCodeAt(0); });
      ev.setUint32(0, 36); text(4, 'edts'); ev.setUint32(8, 28); text(12, 'elst'); ev.setUint32(20, 1); ev.setUint32(24, 176400); ev.setInt32(28, 2112); ev.setInt16(32, rate);
      const trak = find(bytes, 'trak') - 4, moov = find(bytes, 'moov') - 4, at = trak + 8;
      view.setUint32(trak, view.getUint32(trak) + edits.length); view.setUint32(moov, view.getUint32(moov) + edits.length);
      const offsets = find(bytes, 'stco'), count = view.getUint32(offsets + 8);
      for (let i = 0; i < count; i++) view.setUint32(offsets + 12 + i * 4, view.getUint32(offsets + 12 + i * 4) + edits.length);
      return new File([bytes.subarray(0, at), edits, bytes.subarray(at)], 'edit-list.m4a');
    };
    expect(await readM4a(await make(1), createJobContext())).toMatchObject({ delaySamples: 2112, paddingSamples: 688, decodedSamples: 176400 });
    await expect(readM4a(await make(0), createJobContext())).rejects.toMatchObject({ code: 'unsupported-layout' });
  });
  it('rejects oversized metadata without reading it into memory', async () => {
    const start = readFileSync(new URL('./fixtures/media/synthetic-aac.m4a', import.meta.url)).subarray(0, 28);
    const header = new Uint8Array(8); new DataView(header.buffer).setUint32(0, M4A_LIMITS.metadataBytes + 1); header.set(new TextEncoder().encode('moov'), 4);
    const file = new File([start, header, new Uint8Array(M4A_LIMITS.metadataBytes - 7)], 'oversized.m4a');
    const lengths: number[] = []; const slice = file.slice.bind(file);
    vi.spyOn(file, 'slice').mockImplementation((start, end) => { lengths.push((end ?? file.size) - (start ?? 0)); return slice(start, end); });
    await expect(readM4a(file, createJobContext())).rejects.toMatchObject({ code: 'media-limit' });
    expect(Math.max(...lengths)).toBe(16);
  });
});

import { Log } from 'mp4box';
describe('private parser diagnostics', () => {
  it('suppresses upstream error logs while preserving fixed parser error callbacks', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await readM4a(fixture(), createJobContext());
    Log.error('PRIVATE_FILE_METADATA', 'PRIVATE_METADATA_VALUE');
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });
});

import { ISOFile } from 'mp4box';
function insertedMetadata(path: readonly string[], addition: Uint8Array<ArrayBuffer>): File {
  const bytes = new Uint8Array(readFileSync(new URL('./fixtures/media/synthetic-aac.m4a', import.meta.url))), view = new DataView(bytes.buffer);
  const parent = find(bytes, path[path.length - 1]) - 4, at = parent + 8;
  for (const type of path) { const start = find(bytes, type) - 4; view.setUint32(start, view.getUint32(start) + addition.length); }
  const offsets = find(bytes, 'stco'), count = view.getUint32(offsets + 8);
  for (let i = 0; i < count; i++) view.setUint32(offsets + 12 + i * 4, view.getUint32(offsets + 12 + i * 4) + addition.length);
  return new File([bytes.subarray(0, at), addition, bytes.subarray(at)], 'hostile-synthetic-metadata.m4a');
}
const maliciousGroup = () => {
  const bytes = new Uint8Array(20), view = new DataView(bytes.buffer);
  view.setUint32(0, 20); bytes.set(new TextEncoder().encode('sgpd'), 4); bytes.set(new TextEncoder().encode('zzzz'), 12); view.setUint32(16, 0xffffffff); return bytes;
};
const hiddenSampleTable = () => {
  const bytes = new Uint8Array(28), view = new DataView(bytes.buffer);
  view.setUint32(0, 28); bytes.set(new TextEncoder().encode('dinf'), 4); view.setUint32(8, 20); bytes.set(new TextEncoder().encode('stsz'), 12);
  view.setUint32(20, 4); view.setUint32(24, M4A_LIMITS.samples + 1); return bytes;
};
const unsafeEdits = (wide = false) => {
  const bytes = new Uint8Array(wide ? 44 : 24), view = new DataView(bytes.buffer);
  view.setUint32(0, bytes.length); bytes.set(new TextEncoder().encode('edts'), 4);
  view.setUint32(8, bytes.length - 8); bytes.set(new TextEncoder().encode('elst'), 12);
  if (wide) {
    bytes[16] = 1; view.setUint32(20, 1); view.setBigUint64(24, BigInt(Number.MAX_SAFE_INTEGER) + 1n); view.setInt16(40, 1);
  } else view.setUint32(20, 0xffffffff);
  return bytes;
};
describe('reviewed pre-parser allocation and layout boundary', () => {
  it.each([
    ['unknown group with excessive declared count', () => insertedMetadata(['moov', 'trak', 'mdia', 'minf', 'stbl'], maliciousGroup())],
    ['count-controlled group in the wrong container', () => insertedMetadata(['moov'], maliciousGroup())],
    ['hidden over-limit stsz inside misplaced dinf', () => insertedMetadata(['moov'], hiddenSampleTable())],
    ['stsz hidden in the required data-reference container', () => insertedMetadata(['moov', 'trak', 'mdia', 'minf', 'dinf'], hiddenSampleTable().slice(8))],
    ...['sbgp', 'subs', 'sdtp', 'stdp', 'stz2'].map(type => [
      `unsupported auxiliary ${type}`, () => { const box = maliciousGroup(); box.set(new TextEncoder().encode(type), 4); return insertedMetadata(['moov', 'trak', 'mdia', 'minf', 'stbl'], box); },
    ] as const),
    ['ES descriptor parent length beyond payload', () => mutate((bytes) => { bytes.set([255, 255, 255, 127], find(bytes, 'esds') + 9); })],
    ['decoder configuration parent length beyond payload', () => mutate((bytes) => { bytes.set([255, 255, 255, 127], find(bytes, 'esds') + 17); })],
    ['ESDS descriptor length beyond its enclosing payload', () => mutate((bytes) => { const at = find(bytes, 'esds'); bytes.set([255, 255, 255, 127], at + 35); })],
    ['edit list declared count beyond payload', () => insertedMetadata(['moov', 'trak'], unsafeEdits())],
    ['edit list timing exceeds safe integer precision', () => insertedMetadata(['moov', 'trak'], unsafeEdits(true))],
    ['stsc first chunk starts after the actual first chunk', () => mutate((bytes, view) => view.setUint32(find(bytes, 'stsc') + 12, 2))],
    ['stsc chunk capacity exceeds the sample table', () => mutate((bytes, view) => view.setUint32(find(bytes, 'stsc') + 16, 176))],
    ['dref declared entry count exceeds actual children', () => mutate((bytes, view) => view.setUint32(find(bytes, 'dref') + 8, 2))],
    ['unsupported stts full-box version', () => mutate((bytes) => { bytes[find(bytes, 'stts') + 4] = 1; })],
  ] as const)('rejects %s before an upstream parser can allocate', async (_name, makeFile) => {
    const file = await makeFile();
    // Guard the upstream boundary itself: these inputs must never reach it, and
    // the red run cannot allocate a malicious descriptor/group/sample table.
    const boundary = vi.spyOn(ISOFile.prototype, 'appendBuffer').mockImplementation(() => { throw new Error('Guarded unsafe parser boundary'); });
    await expect(readM4a(file, createJobContext())).rejects.toBeInstanceOf(MediaError);
    expect(boundary).not.toHaveBeenCalled();
  });
});
