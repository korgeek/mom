import { afterEach, describe, expect, it } from 'vitest';
import { MPEGDecoder } from 'mpg123-decoder';
import { createMp3Encoder } from 'wasm-media-encoders';
import { readFile } from 'node:fs/promises';
import { cancelJobs, createJobContext } from '../src/react-app/domain/jobs';
import type { AudioOptions, JobContext } from '../src/react-app/domain/types';
import type { SourceReader } from '../src/react-app/media/source';
import { inspectSource } from '../src/react-app/media/mp3';
import { createAudioPreparer } from '../src/react-app/media/prepare';
import { createLocalMediaWorker } from '../src/react-app/media/worker';
import { namedSourceReader, readMediaRange } from '../src/react-app/media/io';
import { readM4a } from '../src/react-app/media/m4a';

const options: AudioOptions = { chunkMinutes: 5, overlapSeconds: 5, expectedLanguages: ['en'], bitrateKbps: 32, sampleRateHz: 16000 };
afterEach(() => cancelJobs());

function toneBytes(seconds = 1) {
  const bytes = new Uint8Array(44 + 32000 * seconds), view = new DataView(bytes.buffer);
  const text = (at: number, value: string) => [...value].forEach((value, i) => { bytes[at + i] = value.charCodeAt(0); });
  text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, 32000 * seconds, true);
  for (let i = 0; i < 16000 * seconds; i++) view.setInt16(44 + i * 2, Math.sin(i * .2) * 12000, true);
  return bytes;
}
function retained(bytes: Uint8Array<ArrayBuffer>, openingJob: JobContext) {
  const reads: { start: number; end: number; job: JobContext }[] = [];
  let active = 0, peak = 0;
  const source: SourceReader & { name: string } = {
    name: 'TEST_ONLY_RETAINED_TONE.wav', size: bytes.byteLength,
    async read(start, end, job) {
      openingJob.assertActive(); job.assertActive(); expect(job).toBe(openingJob);
      expect(end - start).toBeLessThanOrEqual(1048576); expect(start).toBeGreaterThanOrEqual(0); expect(end).toBeLessThanOrEqual(bytes.byteLength);
      active++; peak = Math.max(peak, active); reads.push({ start, end, job });
      try { await Promise.resolve(); job.assertActive(); return bytes.slice(start, end).buffer; }
      finally { active--; }
    },
  };
  return { source, reads, peak: () => peak };
}

describe('retained source media consumer', () => {
  it('names a backend reader without mutating it or changing delegated job and offsets', async () => {
    const job = createJobContext(), fixture = retained(toneBytes(), job), named = namedSourceReader(fixture.source, 'TEST_ONLY_EXACT_ORIGINAL.wav');
    expect(Object.isFrozen(named)).toBe(true); expect(fixture.source.name).toBe('TEST_ONLY_RETAINED_TONE.wav');
    expect(named.name).toBe('TEST_ONLY_EXACT_ORIGINAL.wav'); expect(named.size).toBe(fixture.source.size);
    expect(new Uint8Array(await named.read(8, 12, job))).toEqual(Uint8Array.of(87, 65, 86, 69));
  });
  it('assembles already bounded metadata byte-exactly with sequential <=1MiB pulls, not the whole source', async () => {
    const job = createJobContext(), calls: [number, number][] = [], buffers: ArrayBuffer[] = [];
    let active = 0, peak = 0;
    const source: SourceReader = { size: 64 * 1048576, async read(start, end, received) {
      expect(received).toBe(job); active++; peak = Math.max(peak, active); calls.push([start, end]);
      try { await Promise.resolve(); const bytes = Uint8Array.from({ length: end - start }, (_, i) => (start + i) % 251); buffers.push(bytes.buffer); return bytes.buffer; }
      finally { active--; }
    } };
    const start = 17, length = 2 * 1048576 + 37, result = new Uint8Array(await readMediaRange(source, start, start + length, job, 8 * 1048576));
    expect(calls).toEqual([[17, 1048593], [1048593, 2097169], [2097169, 2097206]]); expect(peak).toBe(1);
    expect(result.length).toBe(length); for (const i of [0, 1048575, 1048576, 2097151, length - 1]) expect(result[i]).toBe((start + i) % 251);
    expect(buffers.every(buffer => new Uint8Array(buffer).every(value => value === 0))).toBe(true);
  });
  it.each([[0, 1048577], [-1, 5], [3, 2], [.5, 1], [0, Infinity], [0, NaN], [0, 65 * 1048576]])('rejects inadmissible range %s..%s before reading', async (start, end) => {
    let reads = 0;
    const source: SourceReader = { size: 64 * 1048576, async read() { reads++; return new ArrayBuffer(0); } };
    await expect(readMediaRange(source, start, end, createJobContext())).rejects.toMatchObject({ code: 'damaged-input' }); expect(reads).toBe(0);
  });
  it('rejects short returned bytes and clears a held late read after its original job is cancelled', async () => {
    const job = createJobContext();
    await expect(readMediaRange({ size: 10, async read() { return new ArrayBuffer(2); } }, 0, 4, job)).rejects.toMatchObject({ code: 'damaged-input' });
    let release!: (bytes: ArrayBuffer) => void;
    const held = new Promise<ArrayBuffer>(resolve => { release = resolve; }), bytes = Uint8Array.of(82, 73, 70, 70);
    const pending = readMediaRange({ size: 4, read: () => held }, 0, 4, job); cancelJobs(); release(bytes.buffer);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' }); expect([...bytes]).toEqual([0, 0, 0, 0]);
  });
  it('inspects exact WAV metadata from a named reader without File slicing or source reconstruction', async () => {
    const job = createJobContext(), fixture = retained(toneBytes(), job);
    expect('slice' in fixture.source).toBe(false); expect('arrayBuffer' in fixture.source).toBe(false);
    const result = await inspectSource(fixture.source, job);
    expect(result.asset).toMatchObject({ fileName: fixture.source.name, bytes: 32044, container: 'wav', codec: 'pcm_s16le', durationMs: 1000, channels: 1, sampleRateHz: 16000 });
    expect(result.decodedSamples).toBe(16000); expect(fixture.reads.length).toBeGreaterThan(0); expect(fixture.peak()).toBe(1);
  });
  it('prepares independently decodable MP3 through original-job reader pulls and durable sink backpressure', async () => {
    const job = createJobContext(), fixture = retained(toneBytes(), job), saved: Blob[] = [];
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
    const prepare = createAudioPreparer({ sourceId: 'retained-test-source', workerFactory: createLocalMediaWorker, sink: async (_chunk, audio, receivedJob) => { expect(receivedJob).toBe(job); saved.push(audio); entered(); await held; } });
    const iterator = prepare(fixture.source, options, job)[Symbol.asyncIterator]();
    const pending = iterator.next();
    try {
      await Promise.race([started, pending.then(() => { throw new Error('Yielded before durable sink'); })]);
      let yielded = false; void pending.then(() => { yielded = true; }); await Promise.resolve(); expect(yielded).toBe(false);
      release(); const chunk = await pending; expect(chunk.done).toBe(false); expect(chunk.value).toMatchObject({ sourceId: 'retained-test-source', sourceStartMs: 0, sourceEndMs: 1000, encodedBytes: saved[0].size });
      const decoder = new MPEGDecoder(); await decoder.ready;
      try { const decoded = decoder.decode(new Uint8Array(await saved[0].arrayBuffer())); expect(decoded.errors).toEqual([]); expect(decoded.sampleRate).toBe(16000); expect(decoded.samplesDecoded).toBeGreaterThanOrEqual(16000); }
      finally { decoder.free(); }
      expect(fixture.peak()).toBe(1);
    } finally { release?.(); await iterator.return?.(); }
  });
  it('streams a larger-than-one-pull PCM source through unchanged encoding without source reconstruction', async () => {
    const job = createJobContext(), fixture = retained(toneBytes(40), job), saved: Blob[] = [];
    const prepare = createAudioPreparer({ sourceId: 'synthetic-forty-second-source', workerFactory: createLocalMediaWorker, sink: async (_chunk, audio) => { saved.push(audio); } });
    const chunks = []; for await (const chunk of prepare(fixture.source, options, job)) chunks.push(chunk);
    expect(chunks).toHaveLength(1); expect(chunks[0].sourceEndMs).toBe(40000); expect(fixture.reads.length).toBeGreaterThan(40); expect(fixture.peak()).toBe(1);
    const decoder = new MPEGDecoder(); await decoder.ready;
    try { const decoded = decoder.decode(new Uint8Array(await saved[0].arrayBuffer())); expect(decoded.errors).toEqual([]); expect(decoded.sampleRate).toBe(16000); expect(decoded.samplesDecoded).toBeGreaterThanOrEqual(40 * 16000); }
    finally { decoder.free(); }
  });
  it('preserves actual MP3 frame inspection and preparation for named reader input', async () => {
    const encoder = await createMp3Encoder(); encoder.configure({ channels: 1, sampleRate: 16000, outputSampleRate: 16000, bitrate: 32 });
    const audio = [new Uint8Array(encoder.encode([Float32Array.from({ length: 32000 }, (_, i) => Math.sin(i * .2) * .4)])), new Uint8Array(encoder.finalize())];
    const length = audio.reduce((n, part) => n + part.length, 0), bytes = new Uint8Array(length); let offset = 0; for (const part of audio) { bytes.set(part, offset); offset += part.length; }
    const job = createJobContext(), fixture = retained(bytes, job), ordinary = await inspectSource(new File([bytes], fixture.source.name), job);
    const inspected = await inspectSource(fixture.source, job); expect(inspected).toEqual({ ...ordinary, asset: { ...ordinary.asset, id: inspected.asset.id } });
    const saved: Blob[] = [], prepare = createAudioPreparer({ sourceId: 'synthetic-mp3-source', workerFactory: createLocalMediaWorker, sink: async (_chunk, audio) => { saved.push(audio); } });
    const chunks = []; for await (const chunk of prepare(fixture.source, options, job)) chunks.push(chunk); expect(chunks).toHaveLength(1); expect(chunks[0].sourceEndMs).toBe(inspected.asset.durationMs);
    const decoder = new MPEGDecoder(); await decoder.ready;
    try { expect(decoder.decode(new Uint8Array(await saved[0].arrayBuffer())).errors).toEqual([]); }
    finally { decoder.free(); }
  });
  it('reads the existing ordinary synthetic AAC metadata and original sample offsets identically through bounded IO', async () => {
    const bytes = new Uint8Array(await readFile(new URL('./fixtures/media/synthetic-aac.m4a', import.meta.url)));
    const job = createJobContext(), fixture = retained(bytes, job), ordinary = await readM4a(new File([bytes], 'TEST_ONLY_ORDINARY_AAC.m4a'), job);
    expect(await readM4a(fixture.source, job)).toEqual(ordinary); expect(fixture.reads.length).toBeGreaterThan(1); expect(fixture.peak()).toBe(1);
    expect(fixture.reads.every(range => range.end - range.start <= 1048576)).toBe(true);
  });
});
