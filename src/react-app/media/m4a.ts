import { createFile, Log, type MP4BoxBuffer, type AudioSampleEntry, type ES_Descriptor } from 'mp4box';
import type { JobContext } from '../domain/types';
import { MediaError } from './errors';
import { readMediaRange, type MediaBytes } from './io';
import { MAX_SOURCE_READ_BYTES } from './source';

// Only bounded metadata enters MP4Box. Encoded media is never accumulated there.
export const M4A_LIMITS = Object.freeze({ metadataBytes: 8 * 1024 * 1024, samples: 500000, packetBytes: 65536, decodeBatch: 32, decodedFrames: 1024, clockDriftMs: 10, clockDriftPerMinuteMs: 1, clockDriftMaxMs: 600 });
const damaged = () => new MediaError('damaged-input', 'Invalid M4A structure or timing.');
const unsupported = () => new MediaError('unsupported-layout', 'Unsupported M4A metadata or track layout.');
const unsupportedCodec = () => new MediaError('unsupported-codec', 'Unsupported M4A audio codec.');
const ascii = (b: Uint8Array, start: number, end: number) => new TextDecoder('latin1').decode(b.subarray(start, end));
type Box = { type: string; start: number; data: number; end: number };
type Extent = { start: number; end: number };
export type M4aSample = Readonly<{ offset: number; size: number; cts: number; duration: number; timescale: number }>;
export type M4aSource = Readonly<{ config: AudioDecoderConfig; samples: readonly M4aSample[]; sampleRateHz: number; channels: number; decodedSamples: number; delaySamples: number; paddingSamples: number; gapless: boolean; clockStart: number; clockDuration: number; clockDriftSamples: number }>;

function boxes(bytes: Uint8Array, start: number, end: number): Box[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), found: Box[] = [];
  while (start < end) {
    if (end - start < 8 || found.length >= 10000) throw damaged();
    let size = view.getUint32(start), header = 8;
    if (size === 1) { if (end - start < 16) throw damaged(); size = Number(view.getBigUint64(start + 8)); header = 16; }
    if (!size) size = end - start;
    if (!Number.isSafeInteger(size) || size < header || size > end - start) throw damaged();
    found.push({ type: ascii(bytes, start + 4, start + 8), start, data: start + header, end: start + size }); start += size;
  }
  return found;
}
function only(all: readonly Box[], type: string): Box {
  const selected = all.filter(box => box.type === type); if (selected.length !== 1) throw damaged(); return selected[0];
}
function validateMetadata(bytes: Uint8Array): { smpb: readonly [number, number, number] | null; sanitized: Uint8Array<ArrayBuffer> } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let smpb: readonly [number, number, number] | null = null, nodes = 0;
  const omissions: Box[] = [], containers: Box[] = [];
  // MP4Box registers parsers by FOURCC, even at unexpected nesting locations.
  // Every box it will receive must therefore have an explicit location and
  // bounded payload grammar; an unknown ancestor cannot hide a counted table.
  const grammar: Record<string, readonly string[]> = {
    root: ['moov'], moov: ['mvhd', 'trak', 'udta', 'meta', 'free'], trak: ['tkhd', 'mdia', 'edts', 'udta', 'free'],
    mdia: ['mdhd', 'hdlr', 'minf'], minf: ['smhd', 'dinf', 'stbl'], dinf: ['dref'], dref: ['url '],
    stbl: ['stsd', 'stts', 'stsc', 'stsz', 'stco', 'co64', 'ctts', 'stss'], stsd: ['mp4a'],
    mp4a: ['esds', 'btrt', 'sbtd'], edts: ['elst'],
  };
  const required: Record<string, readonly string[]> = {
    root: ['moov'], moov: ['mvhd', 'trak'], trak: ['tkhd', 'mdia'], mdia: ['mdhd', 'hdlr', 'minf'],
    minf: ['smhd', 'dinf', 'stbl'], dinf: ['dref'], dref: ['url '], stbl: ['stsd', 'stts', 'stsc', 'stsz'],
    stsd: ['mp4a'], mp4a: ['esds'], edts: ['elst'],
  };
  const boundedBoxes = (start: number, end: number, depth: number) => {
    if (depth > 12) throw damaged();
    const children = boxes(bytes, start, end); nodes += children.length;
    if (nodes > 10000) throw new MediaError('media-limit', 'M4A metadata node count exceeds the limit.');
    return children;
  };
  // Annotation payloads never enter MP4Box. Inspect only bounded box headers
  // along the known Apple gapless path; every other annotation stays opaque.
  const annotation = (parent: string, start: number, end: number, depth: number) => {
    for (const box of boundedBoxes(start, end, depth)) {
      if (box.type === 'meta' && parent === 'udta') {
        const prefix = box.end - box.data >= 4 && view.getUint32(box.data) === 0 ? 4 : 0;
        annotation('meta', box.data + prefix, box.end, depth + 1);
      } else if (box.type === 'ilst' && parent === 'meta') annotation('ilst', box.data, box.end, depth + 1);
      else if (box.type === '----' && parent === 'ilst') {
        const fields = boundedBoxes(box.data, box.end, depth + 1);
        const names = fields.filter(field => field.type === 'name'), means = fields.filter(field => field.type === 'mean');
        if (!names.some(name => name.end - name.data >= 4 && ascii(bytes, name.data + 4, name.end) === 'iTunSMPB')) continue;
        const name = only(names, 'name'), mean = only(means, 'mean'), data = only(fields, 'data');
        if (name.end - name.data < 4 || mean.end - mean.data < 4 || data.end - data.data < 8) throw damaged();
        if (ascii(bytes, mean.data + 4, mean.end) !== 'com.apple.iTunes') continue;
        if (view.getUint32(name.data) !== 0 || view.getUint32(mean.data) !== 0 || view.getUint32(data.data) !== 1 || view.getUint32(data.data + 4) !== 0) throw damaged();
        const values = ascii(bytes, data.data + 8, data.end).trim().split(/\s+/);
        if (smpb || values.length < 4 || values.some(value => !/^[0-9a-fA-F]{8,16}$/.test(value))) throw damaged();
        const timing = values.slice(1, 4).map(value => Number.parseInt(value, 16));
        if (timing.some(value => !Number.isSafeInteger(value))) throw damaged();
        smpb = [timing[0], timing[1], timing[2]];
      }
    }
  };
  const full = (box: Box, versions: readonly number[] = [0], flags = 0) => {
    if (box.end - box.data < 4 || !versions.includes(bytes[box.data]) || (view.getUint32(box.data) & 0xffffff) !== flags) throw damaged();
  };
  const fixed = (box: Box, lengths: readonly number[]) => { if (!lengths.includes(box.end - box.data)) throw damaged(); };
  const descriptor = (start: number, end: number) => {
    if (end - start < 2) throw damaged();
    const tag = bytes[start++]; let size = 0, terminated = false;
    for (let i = 0; i < 4; i++) {
      if (start >= end) throw damaged();
      const value = bytes[start++]; size = size * 128 + (value & 127);
      if (!(value & 128)) { terminated = true; break; }
    }
    if (!terminated || size > end - start) throw damaged();
    return { tag, data: start, end: start + size };
  };
  const esds = (box: Box) => {
    full(box);
    if (box.end - box.data > 1024) throw unsupported();
    const es = descriptor(box.data + 4, box.end);
    if (es.tag !== 3 || es.end !== box.end || es.end - es.data < 3) throw damaged();
    // No dependency, URL or OCR extension in this focused audio grammar.
    if (bytes[es.data + 2] !== 0) throw unsupported();
    const config = descriptor(es.data + 3, es.end);
    if (config.tag !== 4 || config.end - config.data < 13) throw damaged();
    if (bytes[config.data] !== 64 || (bytes[config.data + 1] >> 2) !== 5) throw unsupportedCodec();
    const specific = descriptor(config.data + 13, config.end);
    if (specific.tag !== 5 || specific.end !== config.end || specific.end - specific.data < 2 || specific.end - specific.data > 64) throw damaged();
    const sl = descriptor(config.end, es.end);
    if (sl.tag !== 6 || sl.end !== es.end || sl.end - sl.data !== 1 || bytes[sl.data] !== 2) throw unsupported();
  };
  const entries = (box: Box, width: number, versions: readonly number[] = [0]) => {
    full(box, versions);
    if (box.end - box.data < 8) throw damaged();
    const count = view.getUint32(box.data + 4);
    if (count > M4A_LIMITS.samples || box.end - box.data !== 8 + count * width) throw damaged();
    return count;
  };
  const sampleTables = (children: readonly Box[]) => {
    const sizes = only(children, 'stsz'); full(sizes);
    if (sizes.end - sizes.data < 12) throw damaged();
    const size = view.getUint32(sizes.data + 4), samples = view.getUint32(sizes.data + 8);
    if (samples > M4A_LIMITS.samples) throw new MediaError('media-limit', 'M4A sample table exceeds the limit.');
    if (!samples || size > M4A_LIMITS.packetBytes || sizes.end - sizes.data !== 12 + (size ? 0 : samples * 4)) throw damaged();
    if (!size) for (let i = 0; i < samples; i++) {
      const packetSize = view.getUint32(sizes.data + 12 + i * 4);
      if (!packetSize || packetSize > M4A_LIMITS.packetBytes) throw damaged();
    }
    const offsets = children.filter(box => ['stco', 'co64'].includes(box.type));
    if (offsets.length !== 1) throw damaged();
    const chunks = entries(offsets[0], offsets[0].type === 'co64' ? 8 : 4);
    if (!chunks || chunks > samples) throw damaged();
    const mapping = only(children, 'stsc'), runs = entries(mapping, 12);
    if (!runs || runs > chunks) throw damaged();
    let capacity = 0;
    for (let i = 0; i < runs; i++) {
      const at = mapping.data + 8 + i * 12, first = view.getUint32(at), perChunk = view.getUint32(at + 4), description = view.getUint32(at + 8);
      const next = i + 1 < runs ? view.getUint32(at + 12) : chunks + 1;
      if ((i === 0 && first !== 1) || first < 1 || first > chunks || next <= first || next > chunks + 1 || !perChunk || perChunk > samples || description !== 1) throw damaged();
      capacity += (next - first) * perChunk;
      if (capacity > samples) throw damaged();
    }
    if (capacity !== samples) throw damaged();
    const timing = only(children, 'stts'), timingRuns = entries(timing, 8); let timedSamples = 0;
    if (!timingRuns) throw damaged();
    for (let i = 0; i < timingRuns; i++) {
      const at = timing.data + 8 + i * 8, count = view.getUint32(at), delta = view.getUint32(at + 4);
      if (!count || !delta || delta > 1024 || (delta < 1023 && (i !== timingRuns - 1 || count !== 1))) throw damaged();
      timedSamples += count; if (timedSamples > samples) throw damaged();
    }
    if (timedSamples !== samples) throw damaged();
    for (const box of children.filter(box => box.type === 'ctts')) {
      const count = entries(box, 8, [0, 1]); let described = 0;
      for (let i = 0; i < count; i++) { const at = box.data + 8 + i * 8, amount = view.getUint32(at); if (!amount || view.getUint32(at + 4) !== 0) throw unsupported(); described += amount; }
      if (described !== samples) throw damaged();
    }
    for (const box of children.filter(box => box.type === 'stss')) {
      const count = entries(box, 4); let previous = 0;
      for (let i = 0; i < count; i++) { const sample = view.getUint32(box.data + 8 + i * 4); if (sample <= previous || sample > samples) throw damaged(); previous = sample; }
    }
  };
  const walk = (parent: string, start: number, end: number, depth: number) => {
    const children = boundedBoxes(start, end, depth), seen = new Set<string>();
    for (const box of children) {
      if (!grammar[parent]?.includes(box.type)) throw unsupported();
      if (seen.has(box.type) && !['free', '----'].includes(box.type)) { if (box.type === 'trak') throw unsupported(); throw damaged(); }
      seen.add(box.type);
    }
    for (const type of required[parent] ?? []) only(children, type);
    if (parent === 'stbl') {
      const description = only(children, 'stsd'); full(description);
      if (description.end - description.data < 8 || view.getUint32(description.data + 4) !== 1) throw damaged();
      const formats = boxes(bytes, description.data + 8, description.end);
      if (formats.length !== 1) throw damaged();
      if (formats[0].type !== 'mp4a') throw unsupportedCodec();
      sampleTables(children);
    }
    for (const box of children) {
      let childStart = box.data;
      if (box.type === 'udta' || box.type === 'meta') {
        omissions.push(box);
        const prefix = box.type === 'meta' && box.end - box.data >= 4 && view.getUint32(box.data) === 0 ? 4 : 0;
        annotation(box.type, box.data + prefix, box.end, depth + 1);
        continue;
      }
      if (['mvhd', 'tkhd', 'mdhd'].includes(box.type)) {
        if (box.end - box.data < 4) throw damaged();
        full(box, [0, 1], box.type === 'tkhd' ? view.getUint32(box.data) & 0xffffff : 0);
        const lengths = box.type === 'mvhd' ? [100, 112] : box.type === 'tkhd' ? [84, 96] : [24, 36];
        fixed(box, [lengths[bytes[box.data]]]);
      }
      if (box.type === 'hdlr') { full(box); if (box.end - box.data < 24) throw damaged(); }
      if (box.type === 'smhd') { full(box); fixed(box, [8]); }
      if (box.type === 'elst') {
        full(box, [0, 1]); const wide = bytes[box.data] === 1;
        if (entries(box, wide ? 20 : 12, [0, 1]) !== 1) throw unsupported();
        const at = box.data + 8, duration = wide ? Number(view.getBigUint64(at)) : view.getUint32(at);
        const time = wide ? Number(view.getBigInt64(at + 8)) : view.getInt32(at + 4), rate = at + (wide ? 16 : 8);
        if (!Number.isSafeInteger(duration) || !Number.isSafeInteger(time) || duration <= 0 || time < 0) throw damaged();
        if (view.getInt16(rate) !== 1 || view.getInt16(rate + 2) !== 0) throw unsupported();
      }
      if (box.type === 'btrt') fixed(box, [12]);
      if (box.type === 'sbtd' && box.end - box.data > 32) throw unsupported();
      if (box.type === 'esds') esds(box);
      if (box.type === 'url ') { full(box, [0], 1); fixed(box, [4]); }
      if (['dref', 'stsd'].includes(box.type)) {
        full(box); childStart += 4;
        if (box.end - box.data < 8 || view.getUint32(box.data + 4) !== 1) throw damaged(); childStart += 4;
      }
      if (box.type === 'mp4a') {
        if (box.end - box.data < 28 || view.getUint16(box.data + 8) !== 0 || view.getUint16(box.data + 6) !== 1) throw unsupported();
        childStart += 28;
      }
      if (grammar[box.type]) { containers.push(box); walk(box.type, childStart, box.end, depth + 1); }
    }
  };
  walk('root', 0, bytes.length, 0);
  omissions.sort((a, b) => a.start - b.start);
  const sanitized = new Uint8Array(bytes.length - omissions.reduce((sum, box) => sum + box.end - box.start, 0));
  let read = 0, write = 0;
  for (const box of omissions) { sanitized.set(bytes.subarray(read, box.start), write); write += box.start - read; read = box.end; }
  sanitized.set(bytes.subarray(read), write);
  const cleanView = new DataView(sanitized.buffer);
  for (const box of containers) {
    let before = 0, inside = 0;
    for (const omitted of omissions) {
      if (omitted.end <= box.start) before += omitted.end - omitted.start;
      else if (omitted.start >= box.data && omitted.end <= box.end) inside += omitted.end - omitted.start;
    }
    if (inside) {
      const at = box.start - before, size = box.end - box.start - inside;
      if (box.data - box.start === 16) cleanView.setBigUint64(at + 8, BigInt(size)); else cleanView.setUint32(at, size);
    }
  }
  return { smpb, sanitized };
}

async function slice(file: MediaBytes, start: number, end: number, job: JobContext): Promise<ArrayBuffer> {
  return readMediaRange(file, start, end, job, M4A_LIMITS.metadataBytes);
}

export async function readM4a(file: MediaBytes, job: JobContext): Promise<M4aSource> {
  let metadata: Uint8Array | null = null, ftyp = false, topBoxes = 0;
  const extents: Extent[] = [];
  for (let offset = 0; offset < file.size;) {
    if (++topBoxes > 10000 || file.size - offset < 8) throw damaged();
    const bytes = new Uint8Array(await slice(file, offset, Math.min(offset + 16, file.size), job));
    const view = new DataView(bytes.buffer); let size = view.getUint32(0), header = 8;
    if (size === 1) { if (bytes.length < 16) throw damaged(); size = Number(view.getBigUint64(8)); header = 16; }
    if (!size) size = file.size - offset;
    if (!Number.isSafeInteger(size) || size < header || size > file.size - offset) throw damaged();
    const type = ascii(bytes, 4, 8);
    if (type === 'ftyp') { if (ftyp || offset !== 0 || size < 16 || size > 4096) throw damaged(); ftyp = true; }
    if (type === 'moof') throw unsupported();
    if (type === 'mdat') extents.push({ start: offset + header, end: offset + size });
    if (type === 'moov') {
      if (metadata) throw damaged();
      if (size > M4A_LIMITS.metadataBytes) throw new MediaError('media-limit', 'M4A metadata exceeds the limit.');
      metadata = new Uint8Array(await slice(file, offset, offset + size, job));
    }
    offset += size;
  }
  if (!ftyp || !metadata) throw damaged();
  const { smpb, sanitized } = validateMetadata(metadata); metadata = null;
  // Silence upstream diagnostics: raw metadata must never reach the console.
  Log.debug = Log.info = Log.warn = Log.log = () => {};
  Log.error = (_module, _message, file) => { file?.onError?.('media', 'Invalid M4A structure.'); };
  const parser = createFile(true);
  let parseError = false; parser.onError = () => { parseError = true; };
  const buffer = sanitized.buffer as MP4BoxBuffer; buffer.fileStart = 0;
  try { parser.appendBuffer(buffer); } catch { throw damaged(); }
  if (parseError || !parser.moov || parser.moov.traks.length !== 1) throw damaged();
  const track = parser.moov.traks[0];
  if (track.mdia?.hdlr?.handler !== 'soun') throw new MediaError('no-audio-track', 'No M4A audio track.');
  const table = track.mdia.minf.stbl, entry = table.stsd.entries[0] as AudioSampleEntry & { esds?: { esd: ES_Descriptor } };
  const descriptor = entry.esds?.esd;
  const description = descriptor?.findDescriptor(4)?.findDescriptor(5)?.data as Uint8Array | undefined;
  if (!descriptor || !description || description.length < 2 || description.length > 64 || descriptor.getOTI() !== 64) throw unsupportedCodec();
  const objectType = description[0] >> 3, rateIndex = ((description[0] & 7) << 1) | (description[1] >> 7), channels = (description[1] >> 3) & 15;
  const sampleRateHz = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350][rateIndex];
  // Focused AAC-LC, fixed 1024-sample access units; reject PCE/HE-AAC/extensions.
  if (objectType !== 2 || ![1, 2].includes(channels) || ![16000, 44100, 48000].includes(sampleRateHz) || (description[1] & 7) || (description.length > 2 && description.subarray(2).some(value => value !== 0))) throw unsupportedCodec();
  if (entry.samplerate !== sampleRateHz) throw damaged();
  const samples = parser.getTrackSamplesInfo(track.tkhd.track_id);
  if (!samples.length) throw new MediaError('no-audio-track', 'No M4A audio samples.');
  if (samples.length > M4A_LIMITS.samples) throw new MediaError('media-limit', 'M4A sample table exceeds the limit.');
  let end = 0, byteEnd = 0, totalBytes = 0, clockDrift = 0;
  for (let index = 0; index < samples.length; index++) {
    if (index % 1024 === 0) job.assertActive();
    const sample = samples[index];
    if (![sample.offset, sample.size, sample.dts, sample.cts, sample.duration, sample.timescale].every(Number.isSafeInteger) || sample.description_index !== 0 || sample.timescale !== sampleRateHz || sample.dts !== end || sample.cts !== sample.dts || sample.duration < 1 || sample.duration > 1024 || (index < samples.length - 1 && sample.duration < 1023) || sample.size < 1 || sample.size > M4A_LIMITS.packetBytes || sample.offset < byteEnd || !extents.some(extent => sample.offset >= extent.start && sample.offset + sample.size <= extent.end)) throw damaged();
    if (sample.duration === 1023) clockDrift++;
    end += sample.duration; byteEnd = sample.offset + sample.size; totalBytes += sample.size;
  }
  const timedSamples = table.stts.sample_counts.reduce((sum, count) => sum + count, 0);
  const timedDuration = table.stts.sample_counts.reduce((sum, count, i) => sum + count * table.stts.sample_deltas[i], 0);
  if (timedSamples !== samples.length || timedDuration !== end || end !== track.mdia.mdhd.duration || totalBytes !== track.samples_size) throw damaged();
  const nativeSamples = samples.length * M4A_LIMITS.decodedFrames;
  // Integer ticks: 10 ms baseline + 1 ms per native audio minute, max 600 ms.
  // Only 1023/1024 quantization counts here; a final partial packet is separate.
  const clockBudget = Math.min(Math.floor(sampleRateHz * M4A_LIMITS.clockDriftMaxMs / 1000), Math.floor(sampleRateHz * M4A_LIMITS.clockDriftMs / 1000 + nativeSamples * M4A_LIMITS.clockDriftPerMinuteMs / 60000));
  if (clockDrift > clockBudget) throw unsupported();
  let delaySamples = 0, decodedSamples = nativeSamples, paddingSamples = 0;
  const edits = track.edts?.elst?.entries;
  if (edits?.length) {
    if (edits.length !== 1 || edits[0].media_time < 0 || edits[0].media_rate_integer !== 1 || edits[0].media_rate_fraction !== 0) throw unsupported();
    const start = edits[0].media_time, duration = edits[0].segment_duration * sampleRateHz / parser.moov.mvhd.timescale;
    if (!Number.isFinite(duration) || start + duration > end) throw damaged();
    delaySamples = Math.round(clockToNative(samples, start));
    decodedSamples = Math.round(clockToNative(samples, start + duration)) - delaySamples;
    paddingSamples = samples.length * 1024 - delaySamples - decodedSamples;
  }
  if (smpb) {
    if (edits?.length && (delaySamples !== smpb[0] || Math.abs(decodedSamples - smpb[2]) > sampleRateHz / parser.moov.mvhd.timescale)) throw damaged();
    [delaySamples, paddingSamples, decodedSamples] = smpb;
    if (delaySamples + paddingSamples + decodedSamples !== samples.length * 1024) throw damaged();
  }
  if (![delaySamples, decodedSamples, paddingSamples].every(Number.isSafeInteger) || delaySamples < 0 || decodedSamples <= 0 || paddingSamples < 0 || delaySamples + paddingSamples + decodedSamples !== nativeSamples) throw damaged();
  const clockStart = nativeToClock(samples, delaySamples), clockDuration = nativeToClock(samples, delaySamples + decodedSamples) - clockStart;
  job.assertActive();
  return { config: { codec: 'mp4a.40.2', sampleRate: sampleRateHz, numberOfChannels: channels, description: new Uint8Array(description) }, samples: samples.map(({ offset, size, cts, duration, timescale }) => ({ offset, size, cts, duration, timescale })), sampleRateHz, channels, delaySamples, paddingSamples, decodedSamples, gapless: Boolean(smpb || edits?.length), clockStart, clockDuration, clockDriftSamples: clockDrift };
}

function nativeToClock(samples: readonly M4aSample[], nativeSample: number): number {
  const index = Math.min(samples.length - 1, Math.floor(nativeSample / M4A_LIMITS.decodedFrames)), sample = samples[index];
  return sample.cts + (nativeSample - index * M4A_LIMITS.decodedFrames) * sample.duration / M4A_LIMITS.decodedFrames;
}
// Clock differences never delete PCM or resample it. Map each source boundary
// through the original packet clock, then encode every retained native frame.
export function m4aPcmSampleAtMs(source: M4aSource, milliseconds: number): number {
  const clock = source.clockStart + milliseconds * source.sampleRateHz / 1000;
  return Math.max(0, Math.min(source.decodedSamples, Math.round(clockToNative(source.samples, clock) - source.delaySamples)));
}
function clockToNative(samples: readonly M4aSample[], clock: number): number {
  let low = 0, high = samples.length - 1;
  while (low < high) { const middle = Math.ceil((low + high) / 2); if (samples[middle].cts <= clock) low = middle; else high = middle - 1; }
  const sample = samples[low];
  return low * M4A_LIMITS.decodedFrames + (clock - sample.cts) * M4A_LIMITS.decodedFrames / sample.duration;
}

export async function* m4aMonoPcm(file: MediaBytes, source: M4aSource, job: JobContext): AsyncGenerator<Float32Array> {
  job.assertActive();
  if (typeof AudioDecoder === 'undefined' || typeof EncodedAudioChunk === 'undefined') throw new MediaError('unsupported-browser', 'Native AAC decoding is unavailable.');
  let supported = false;
  try { supported = (await AudioDecoder.isConfigSupported(source.config)).supported === true; } catch { /* fixed safe error below */ }
  job.assertActive(); if (!supported) throw new MediaError('unsupported-browser', 'Native AAC decoding is unavailable.');
  let failure: MediaError | null = null, decoded = 0, retained = 0;
  const batchPackets = Math.min(M4A_LIMITS.decodeBatch, Math.floor(source.sampleRateHz / M4A_LIMITS.decodedFrames));
  let batch = new Float32Array(0), batchLength = 0, batchOutputs = 0;
  let encoded = new Uint8Array(0), encodedStart = 0;
  const decoder = new AudioDecoder({ error: () => { failure = damaged(); }, output(data) {
    try {
      job.assertActive();
      if (data.sampleRate !== source.sampleRateHz || data.numberOfChannels !== source.channels || data.numberOfFrames !== M4A_LIMITS.decodedFrames || ++batchOutputs > batchPackets) throw damaged();
      const first = Math.max(0, source.delaySamples - decoded), last = Math.min(data.numberOfFrames, source.delaySamples + source.decodedSamples - decoded);
      if (last > first) {
        const channel = new Float32Array(data.numberOfFrames);
        if (batchLength + last - first > batch.length) throw damaged();
        for (let c = 0; c < data.numberOfChannels; c++) { data.copyTo(channel, { planeIndex: c, format: 'f32-planar' }); for (let i = first; i < last; i++) batch[batchLength + i - first] += channel[i] / data.numberOfChannels; }
        channel.fill(0); batchLength += last - first; retained += last - first;
      }
      decoded += data.numberOfFrames;
    } catch (error) { failure = error instanceof MediaError ? error : damaged(); }
    finally { data.close(); }
  } });
  const stop = () => { if (decoder.state !== 'closed') decoder.close(); batch.fill(0); encoded.fill(0); encoded = new Uint8Array(0); };
  job.signal.addEventListener('abort', stop, { once: true });
  try {
    decoder.configure(source.config);
    for (let start = 0; start < source.samples.length; start += batchPackets) {
      job.assertActive();
      batch = new Float32Array(Math.min(batchPackets, source.samples.length - start) * M4A_LIMITS.decodedFrames); batchLength = 0; batchOutputs = 0;
      for (const sample of source.samples.slice(start, start + batchPackets)) {
        job.assertActive();
        if (sample.offset + sample.size > file.size) throw damaged();
        if (sample.offset < encodedStart || sample.offset + sample.size > encodedStart + encoded.length) {
          // Packet reads must not repeatedly decrypt the same retained source block.
          encoded.fill(0); encoded = new Uint8Array(0); encodedStart = sample.offset;
          encoded = new Uint8Array(await readMediaRange(file, encodedStart, Math.min(file.size, encodedStart + MAX_SOURCE_READ_BYTES), job));
          job.assertActive();
        }
        const data = encoded.subarray(sample.offset - encodedStart, sample.offset - encodedStart + sample.size);
        decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp: Math.round(sample.cts * 1000000 / sample.timescale), duration: Math.round(sample.duration * 1000000 / sample.timescale), data }));
        if (decoder.decodeQueueSize > batchPackets) throw damaged();
      }
      await decoder.flush(); job.assertActive(); if (failure) throw failure;
      if (batchLength) { job.assertActive(); yield batch.subarray(0, batchLength); }
      batch.fill(0); batch = new Float32Array(0);
    }
    if (decoded !== source.samples.length * 1024 || retained !== source.decodedSamples) throw damaged();
  } catch (error) { job.assertActive(); throw error instanceof MediaError ? error : damaged(); }
  finally { job.signal.removeEventListener('abort', stop); stop(); }
}
