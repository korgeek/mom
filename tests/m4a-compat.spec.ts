import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cancelJobs, createJobContext } from '../src/react-app/domain/jobs';
import { M4A_LIMITS, m4aMonoPcm, m4aPcmSampleAtMs, readM4a } from '../src/react-app/media/m4a';
import { inspectSource } from '../src/react-app/media/mp3';
import { MediaError, mediaFailureMessage } from '../src/react-app/media/errors';

// Only the committed synthetic tone is used here. No recording or recorder
// metadata from a user is copied into these ordinary compatibility fixtures.
const tone = () => new Uint8Array(readFileSync(new URL('./fixtures/media/synthetic-aac.m4a', import.meta.url)));
const find = (bytes: Uint8Array, type: string) => Buffer.from(bytes).indexOf(type, 0, 'latin1');
const box = (type: string, body: Uint8Array = new Uint8Array()) => {
  const bytes = new Uint8Array(8 + body.length);
  new DataView(bytes.buffer).setUint32(0, bytes.length);
  bytes.set(new TextEncoder().encode(type), 4); bytes.set(body, 8);
  return bytes;
};
function splice(bytes: Uint8Array<ArrayBuffer>, path: readonly string[], at: number, addition: Uint8Array<ArrayBuffer>) {
  const view = new DataView(bytes.buffer);
  for (const type of path) { const start = find(bytes, type) - 4; view.setUint32(start, view.getUint32(start) + addition.length); }
  const offsets = find(bytes, 'stco'), count = view.getUint32(offsets + 8);
  for (let i = 0; i < count; i++) view.setUint32(offsets + 12 + i * 4, view.getUint32(offsets + 12 + i * 4) + addition.length);
  const result = new Uint8Array(bytes.length + addition.length);
  result.set(bytes.subarray(0, at)); result.set(addition, at); result.set(bytes.subarray(at), at + addition.length);
  return result;
}
function insert(bytes: Uint8Array<ArrayBuffer>, path: readonly string[], addition: Uint8Array<ArrayBuffer>) {
  return splice(bytes, path, find(bytes, path[path.length - 1]) + 4, addition);
}
function clockTone({ gapless = false, finalDelta = 1024 } = {}) {
  let bytes = tone(); const timing = find(bytes, 'stts'), run = new Uint8Array(8);
  const runView = new DataView(run.buffer); runView.setUint32(0, 1); runView.setUint32(4, finalDelta);
  bytes = splice(bytes, ['moov', 'trak', 'mdia', 'minf', 'stbl', 'stts'], timing + 20, run);
  const view = new DataView(bytes.buffer);
  if (!gapless) bytes.set(new TextEncoder().encode('ordinary'), find(bytes, 'iTunSMPB'));
  view.setUint32(timing + 8, 2); view.setUint32(timing + 12, 174); view.setUint32(timing + 16, 1023);
  view.setUint32(find(bytes, 'mdhd') + 20, 174 * 1023 + finalDelta);
  return new File([bytes], 'synthetic-clock.m4a');
}
function replaceMetadata(bytes: Uint8Array<ArrayBuffer>, path: readonly string[], replacement: Uint8Array<ArrayBuffer>) {
  const view = new DataView(bytes.buffer), at = find(bytes, path[path.length - 1]) - 4, size = view.getUint32(at);
  for (const type of path.slice(0, -1)) { const start = find(bytes, type) - 4; view.setUint32(start, view.getUint32(start) + replacement.length - size); }
  const result = new Uint8Array(bytes.length + replacement.length - size);
  result.set(bytes.subarray(0, at)); result.set(replacement, at); result.set(bytes.subarray(at + size), at + replacement.length);
  return result;
}
function longClockTone(shortenEvery = 64) {
  const original = tone(), view = new DataView(original.buffer), moov = find(original, 'moov') - 4;
  const count = Math.ceil(16 * 60 * 44100 / 1024), packetSize = view.getUint32(find(original, 'stsz') + 16), packetOffset = view.getUint32(find(original, 'stco') + 12);
  // Repeat a valid silent priming packet from the committed synthetic tone.
  // This is an ordinary bounded timing fixture, not a native-quality claim.
  const packet = original.subarray(packetOffset, packetOffset + packetSize);
  let metadata = original.slice(moov, moov + view.getUint32(moov));
  metadata.set(new TextEncoder().encode('ordinary'), find(metadata, 'iTunSMPB'));
  const runs: { count: number; delta: number }[] = [];
  for (let at = 0; at < count;) {
    const amount = Math.min(shortenEvery - 1, count - at); runs.push({ count: amount, delta: 1024 }); at += amount;
    if (at < count) { runs.push({ count: 1, delta: 1023 }); at++; }
  }
  const timing = new Uint8Array(8 + runs.length * 8), timingView = new DataView(timing.buffer); timingView.setUint32(4, runs.length);
  runs.forEach((run, i) => { timingView.setUint32(8 + i * 8, run.count); timingView.setUint32(12 + i * 8, run.delta); });
  const sizes = new Uint8Array(12), sizesView = new DataView(sizes.buffer); sizesView.setUint32(4, packetSize); sizesView.setUint32(8, count);
  const chunks = new Uint8Array(20), chunksView = new DataView(chunks.buffer); chunksView.setUint32(4, 1); chunksView.setUint32(8, 1); chunksView.setUint32(12, count); chunksView.setUint32(16, 1);
  const offsets = new Uint8Array(12); new DataView(offsets.buffer).setUint32(4, 1);
  for (const [type, body] of [['stts', timing], ['stsz', sizes], ['stsc', chunks], ['stco', offsets]] as const)
    metadata = replaceMetadata(metadata, ['moov', 'trak', 'mdia', 'minf', 'stbl', type], box(type, body));
  const changed = new DataView(metadata.buffer), drift = Math.floor(count / shortenEvery), clock = count * 1024 - drift;
  changed.setUint32(find(metadata, 'mdhd') + 20, clock); changed.setUint32(find(metadata, 'mvhd') + 20, clock); changed.setUint32(find(metadata, 'tkhd') + 24, clock);
  changed.setUint32(find(metadata, 'stco') + 12, moov + metadata.length + 8);
  const payload = new Uint8Array(count * packetSize); for (let i = 0; i < count; i++) payload.set(packet, i * packetSize);
  return { file: new File([original.subarray(0, moov), metadata, box('mdat', payload)], 'synthetic-long-clock.m4a'), count, drift, clock };
}
// Node can verify frame accounting and lifecycle, not native AAC quality.
// The controller separately runs all actual packets through headed Chrome.
function nativePackets() {
  const stats = { packets: 0, closed: 0, maxQueue: 0, stopped: false };
  class Packet { constructor(public readonly init: { timestamp: number }) {} }
  class Decoder {
    static async isConfigSupported() { return { supported: true }; }
    state = 'unconfigured'; decodeQueueSize = 0; queue: Packet[] = [];
    constructor(private readonly callbacks: { output(data: unknown): void }) {}
    configure() { this.state = 'configured'; }
    decode(packet: Packet) { this.queue.push(packet); stats.packets++; stats.maxQueue = Math.max(stats.maxQueue, ++this.decodeQueueSize); }
    async flush() {
      for (const packet of this.queue.splice(0)) this.callbacks.output({ sampleRate: 44100, numberOfChannels: 1, numberOfFrames: 1024, timestamp: packet.init.timestamp,
        copyTo: (target: Float32Array) => target.fill(.25), close: () => { stats.closed++; } });
      this.decodeQueueSize = 0;
    }
    close() { this.state = 'closed'; stats.stopped = true; this.queue = []; }
  }
  vi.stubGlobal('AudioDecoder', Decoder); vi.stubGlobal('EncodedAudioChunk', Packet);
  return stats;
}
afterEach(() => { cancelJobs(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('ordinary AAC recorder metadata compatibility', () => {
  it('omits a non-full direct meta annotation while retaining exact original packet offsets and gapless timing', async () => {
    const annotation = box('meta', box('hdlr', new Uint8Array([1, 2, 3])));
    const bytes = insert(tone(), ['moov'], annotation), file = new File([bytes], 'synthetic-recorder.m4a');
    const original = await readM4a(new File([tone()], 'synthetic-tone.m4a'), createJobContext());
    const source = await readM4a(file, createJobContext());
    expect(source).toMatchObject({ delaySamples: 2112, paddingSamples: 688, decodedSamples: 176400 });
    expect(source.samples).toEqual(original.samples.map(sample => ({ ...sample, offset: sample.offset + annotation.length })));
    for (const sample of source.samples) expect(bytes.subarray(sample.offset, sample.offset + sample.size)).toEqual(tone().subarray(sample.offset - annotation.length, sample.offset - annotation.length + sample.size));
  });
  it('omits opaque recorder annotations alongside validated iTunSMPB', async () => {
    let bytes = tone();
    for (const type of ['SDLN', 'smrd', 'smta']) bytes = insert(bytes, ['moov', 'udta'], box(type, new Uint8Array([1, 2, 3])));
    expect(await readM4a(new File([bytes], 'synthetic-recorder.m4a'), createJobContext())).toMatchObject({ delaySamples: 2112, paddingSamples: 688, decodedSamples: 176400 });
  });
});

describe('ordinary AAC recorder clock compatibility', () => {
  it('accepts supplied-like one-tick density over about 16 minutes and maps exact 10 minute/10 second boundaries', async () => {
    const { file, count, drift, clock } = longClockTone(), source = await readM4a(file, createJobContext());
    expect(drift * 1000 / source.sampleRateHz).toBeGreaterThan(10);
    expect(source).toMatchObject({ decodedSamples: count * 1024, delaySamples: 0, paddingSamples: 0, clockDuration: clock, clockDriftSamples: drift });
    const end = m4aPcmSampleAtMs(source, 600000), start = m4aPcmSampleAtMs(source, 590000);
    expect(end).toBe(26460403); expect(start).toBe(26019397); expect(end - start).toBe(441006);
    expect(end - start).toBeLessThanOrEqual(441000 + drift + 1024);
    expect(m4aPcmSampleAtMs(source, clock * 1000 / 44100)).toBe(count * 1024);
  });
  it('retains every native frame of the long clock fixture within decoder and PCM bounds', async () => {
    const stats = nativePackets(), { file, count } = longClockTone(), job = createJobContext(), source = await readM4a(file, job);
    let frames = 0;
    for await (const block of m4aMonoPcm(file, source, job)) { frames += block.length; expect(block.length).toBeLessThanOrEqual(44100); }
    expect(frames).toBe(count * 1024); expect(stats.packets).toBe(count); expect(stats.closed).toBe(count);
    expect(stats.maxQueue).toBeLessThanOrEqual(M4A_LIMITS.decodeBatch); expect(stats.stopped).toBe(true);
  });
  it('rejects an otherwise consistent long clock fixture beyond the bounded duration-scaled policy', async () => {
    await expect(readM4a(longClockTone(16).file, createJobContext())).rejects.toMatchObject({ code: 'unsupported-layout' });
  });
  it('retains native frames for benign 1023/1024 timing variation without inferring priming or lost padding', async () => {
    const nativeFrames = 175 * 1024, clockFrames = nativeFrames - 174;
    const source = await readM4a(clockTone(), createJobContext());
    expect(source).toMatchObject({ decodedSamples: nativeFrames, delaySamples: 0, paddingSamples: 0 });
    expect(source.samples.reduce((sum, sample) => sum + sample.duration, 0)).toBe(clockFrames);
    expect(source.clockDuration).toBe(clockFrames);
    expect(m4aPcmSampleAtMs(source, 1023 * 1000 / 44100)).toBe(1024);
    expect(m4aPcmSampleAtMs(source, clockFrames * 1000 / 44100)).toBe(nativeFrames);
  });
  it('reports the retained source-clock duration separately from all decoded native frames and unknown priming', async () => {
    nativePackets();
    const inspected = await inspectSource(clockTone(), createJobContext());
    expect(inspected.asset.durationMs).toBe(Math.round((175 * 1024 - 174) * 1000 / 44100));
    expect(inspected.decodedSamples).toBe(175 * 1024);
    expect(inspected.originalEncoding).toEqual({ delaySamples: null, paddingSamples: null });
  });
  it('retains all packet outputs with bounded PCM and closes every native data object', async () => {
    const stats = nativePackets(), file = clockTone(), job = createJobContext(), source = await readM4a(file, job);
    let frames = 0;
    for await (const block of m4aMonoPcm(file, source, job)) { frames += block.length; expect(block.every(value => value === .25)).toBe(true); expect(block.length).toBeLessThanOrEqual(source.sampleRateHz); }
    expect(frames).toBe(175 * 1024); expect(stats.packets).toBe(175); expect(stats.closed).toBe(175);
    expect(stats.maxQueue).toBeLessThanOrEqual(M4A_LIMITS.decodeBatch); expect(stats.stopped).toBe(true);
  });
  it('keeps verified native iTunSMPB trims alongside bounded clock variation', async () => {
    const source = await readM4a(clockTone({ gapless: true }), createJobContext());
    expect(source).toMatchObject({ decodedSamples: 176400, delaySamples: 2112, paddingSamples: 688, gapless: true });
    expect(source.clockDuration).toBeLessThan(176400);
  });
  it('maps a verified simple edit from media-clock ticks to native packet frames', async () => {
    const body = new Uint8Array(20), view = new DataView(body.buffer);
    view.setUint32(4, 1); view.setUint32(8, 174 * 1023 + 1024 - 1023); view.setInt32(12, 1023); view.setInt16(16, 1);
    const bytes = insert(new Uint8Array(await clockTone().arrayBuffer()), ['moov', 'trak'], box('edts', box('elst', body)));
    const source = await readM4a(new File([bytes], 'synthetic-edited-clock.m4a'), createJobContext());
    expect(source).toMatchObject({ gapless: true, delaySamples: 1024, decodedSamples: 174 * 1024, paddingSamples: 0 });
    expect(source.clockStart).toBe(1023); expect(source.clockDuration).toBe(173 * 1023 + 1024);
  });
  it('retains the final native packet tail without a verified gapless trim', async () => {
    const source = await readM4a(clockTone({ finalDelta: 512 }), createJobContext());
    expect(source).toMatchObject({ decodedSamples: 175 * 1024, paddingSamples: 0, gapless: false });
    expect(m4aPcmSampleAtMs(source, source.clockDuration * 1000 / source.sampleRateHz)).toBe(source.decodedSamples);
  });
  it('classifies otherwise consistent timing beyond the bounded drift policy as unsupported layout', async () => {
    // The same ordinary packet-table mutation used by the existing 16 kHz
    // metadata test; no native decode is invoked for this policy-only check.
    const bytes = new Uint8Array(await clockTone().arrayBuffer()), view = new DataView(bytes.buffer);
    const asc = find(bytes, 'esds') + 39; bytes[asc] = 0x14; bytes[asc + 1] = 8;
    view.setUint32(find(bytes, 'mp4a') + 28, 16000 * 65536); view.setUint32(find(bytes, 'mdhd') + 16, 16000);
    await expect(readM4a(new File([bytes], 'synthetic-bound.m4a'), createJobContext())).rejects.toMatchObject({ code: 'unsupported-layout' });
  });
  it('rejects an unexplained nonfinal duration change larger than one tick as damaged timing', async () => {
    const bytes = new Uint8Array(await clockTone().arrayBuffer()), view = new DataView(bytes.buffer);
    view.setUint32(find(bytes, 'stts') + 16, 1022); view.setUint32(find(bytes, 'mdhd') + 20, 174 * 1022 + 1024);
    await expect(readM4a(new File([bytes], 'synthetic-timing.m4a'), createJobContext())).rejects.toMatchObject({ code: 'damaged-input' });
  });
  it('uses allowlisted bilingual metadata guidance without claiming AAC is ALAC or exposing private details', () => {
    for (const language of ['ko', 'en'] as const) {
      const message = mediaFailureMessage(new MediaError('unsupported-layout', 'PRIVATE_RECORDER_DATA filename.m4a'), language);
      expect(message).toContain('M4A'); expect(message).not.toContain('ALAC'); expect(message).not.toContain('PRIVATE_RECORDER_DATA'); expect(message).not.toContain('filename.m4a');
    }
  });
});
