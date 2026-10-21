import { afterEach, expect, it, vi } from 'vitest';
import { createMp3Encoder } from 'wasm-media-encoders';
import { cancelJobs, createJobContext } from '../src/react-app/domain/jobs';
import { inspectSource, sourceWaveform } from '../src/react-app/media/mp3';
import { loadSourcePreview, MAX_RESTORED_PREVIEW_BYTES } from '../src/react-app/media/preview';
import { createLocalMediaWorker, type MediaWorker } from '../src/react-app/media/worker';
import type { SourceReader } from '../src/react-app/media/source';
import type { JobContext, SourceAsset } from '../src/react-app/domain/types';

afterEach(() => cancelJobs());
function wav() {
  const bytes = new Uint8Array(44 + 32000), view = new DataView(bytes.buffer);
  const text = (at: number, value: string) => [...value].forEach((value, index) => bytes[at + index] = value.charCodeAt(0));
  text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, 32000, true);
  for (let i = 8000; i < 16000; i++) view.setInt16(44 + i * 2, 16384, true);
  return bytes;
}
const source: SourceAsset = { id: 'source', fileName: 'SYNTHETIC_PREVIEW.wav', bytes: 32044, container: 'wav', codec: 'pcm_s16le', sampleRateHz: 16000, channels: 1, durationMs: 1000 };
function retained(bytes: Uint8Array<ArrayBuffer>, job: JobContext) {
  const reads: ArrayBuffer[] = [];
  return { reads, name: source.fileName, size: bytes.length, async read(start: number, end: number, received: JobContext) {
    expect(end - start).toBeLessThanOrEqual(1048576); expect(received).toBe(job); job.assertActive();
    const output = bytes.slice(start, end).buffer; reads.push(output); return output;
  } };
}
it('extracts true silence and amplitude peaks through bounded retained-source windows', async () => {
  const job = createJobContext(), reader = retained(wav(), job), inspected = await inspectSource(reader, job);
  const peaks = await sourceWaveform(reader, inspected.asset, job);
  expect(peaks).toHaveLength(256); expect(peaks.slice(0, 128).every(value => value === 0)).toBe(true);
  expect(peaks.slice(128).every(value => value === .5)).toBe(true);
});
it('restores exact original bytes and actual waveform without reselecting a file', async () => {
  const job = createJobContext(), bytes = wav(), reader = retained(bytes, job);
  const result = await loadSourcePreview(reader, source, job, createLocalMediaWorker);
  expect(new Uint8Array(await result.audio!.arrayBuffer())).toEqual(bytes); expect(result.peaks?.[200]).toBe(.5);
  expect(new Uint8Array(reader.reads[0]).every(value => value === 0)).toBe(true);
});
it('bounds retained playback reconstruction while keeping waveform and existing File previews', async () => {
  const job = createJobContext(), waveform = vi.fn(async () => new Array<number>(256).fill(.25)), terminate = vi.fn();
  const factory = () => ({ waveform, terminate } as unknown as MediaWorker);
  const reader: SourceReader & { name: string } = { name: 'SYNTHETIC_LARGE.mp3', size: MAX_RESTORED_PREVIEW_BYTES + 1, read: vi.fn() };
  const result = await loadSourcePreview(reader, source, job, factory);
  expect(result.audio).toBeNull(); expect(result.peaks?.[0]).toBe(.25); expect(reader.read).not.toHaveBeenCalled(); expect(waveform).toHaveBeenCalledOnce();
  const file = new File(['tone'], 'SYNTHETIC_FILE.wav');
  expect((await loadSourcePreview(file, source, job, factory)).audio).toBe(file);
  expect(terminate).toHaveBeenCalledTimes(2);
});
it('preserves native playback when the waveform codec is unavailable', async () => {
  const job = createJobContext(), file = new File(['tone'], 'SYNTHETIC_FILE.wav');
  const result = await loadSourcePreview(file, source, job, () => ({ waveform: async () => { throw Error('unavailable'); }, terminate() {} } as unknown as MediaWorker));
  expect(result.audio).toBe(file); expect(result.peaks).toBeNull();
  const unavailable = await loadSourcePreview(file, source, job, () => { throw Error('worker unavailable'); });
  expect(unavailable.audio).toBe(file); expect(unavailable.peaks).toBeNull();
});
it('terminates decoding and rejects a late waveform after lock cancellation', async () => {
  const job = createJobContext(), terminate = vi.fn(); let finish!: (peaks: number[]) => void;
  const waveform = new Promise<number[]>(resolve => { finish = resolve; });
  const pending = loadSourcePreview(new File(['tone'], 'SYNTHETIC.wav'), source, job, () => ({ waveform: () => waveform, terminate } as unknown as MediaWorker));
  cancelJobs(); expect(terminate).toHaveBeenCalledOnce(); finish(new Array<number>(256).fill(.5));
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
});
it('clears a held decrypted read when cancellation wins and rejects unavailable source bytes', async () => {
  const job = createJobContext(); let finish!: (bytes: ArrayBuffer) => void;
  const held = new Promise<ArrayBuffer>(resolve => { finish = resolve; }), late = new Uint8Array(8).fill(42);
  const input = { name: source.fileName, size: 8, read: () => held };
  const pending = loadSourcePreview(input, source, job, createLocalMediaWorker); cancelJobs(); finish(late.buffer);
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' }); expect([...late]).toEqual(new Array(8).fill(0));
  await expect(loadSourcePreview({ ...input, read: async () => { throw Error('source deleted'); } }, source, createJobContext(), createLocalMediaWorker)).rejects.toThrow('source deleted');
});

it('extracts real compressed MP3 amplitudes without retaining decoded recording PCM', async () => {
  const encoder = await createMp3Encoder(); encoder.configure({ sampleRate: 16000, outputSampleRate: 16000, channels: 1, bitrate: 32 });
  const pcm = Float32Array.from({ length: 16000 }, (_, i) => i < 8000 ? 0 : .5 * Math.sin(i * .2));
  const file = new File([new Uint8Array(encoder.encode([pcm])), new Uint8Array(encoder.finalize())], 'SYNTHETIC_COMPRESSED.mp3'); pcm.fill(0);
  const job = createJobContext(), inspection = await inspectSource(file, job), peaks = await sourceWaveform(file, inspection.asset, job);
  expect(peaks.slice(0, 64).every(peak => peak < .01)).toBe(true); expect(peaks.slice(192).some(peak => peak > .2)).toBe(true);
});
