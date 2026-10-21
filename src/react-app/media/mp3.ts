import { validateTranscriptionHints } from '../domain/stt-settings';
import { MPEGDecoder } from "mpg123-decoder";
import { createEncoder, createMp3Encoder } from "wasm-media-encoders";
import mp3WasmUrl from "wasm-media-encoders/wasm/mp3?url";
import type { AudioOptions, JobContext, SourceAsset } from "../domain/types";

import { MediaError } from "./errors";
import { readMediaRange, type MediaBytes, type MediaInput } from './io';
import { readM4a, m4aMonoPcm, m4aPcmSampleAtMs, M4A_LIMITS, type M4aSource } from "./m4a";
export { MediaError } from "./errors";
export type { MediaErrorCode } from "./errors";
export type ChunkRange = Readonly<{ sourceStartMs: number; sourceEndMs: number }>;
export type MediaProgress = Readonly<{ sourceProcessedMs: number; durationMs: number; pcmBytes: number; encodedBytes: number;
	stage?: 'inspecting' | 'decoding' | 'preparing' | 'verifying'; phaseProcessedMs?: number; phaseDurationMs?: number | null }>;
export type Inspection = Readonly<{ asset: SourceAsset; decodedSamples: number; originalEncoding: Readonly<{ delaySamples: number | null; paddingSamples: number | null }> }>;
export const SUPPORTED_AUDIO = Object.freeze({ containers: ["mp3", "wav", "m4a"], outputCodec: "mp3", outputSampleRateHz: 16000, bitratesKbps: [24, 32, 48], inputSampleRatesHz: [16000, 44100, 48000], maxPcmWindowSeconds: 1 });
// Pinned LAME output, independently measured with Chrome impulse decoding at all
// supported rates/bitrates: 1105 output samples. Domain time uses integer ms.
export const MP3_ENCODING_OFFSET_MS = Math.round(1105 * 1000 / 16000);

const READ_BYTES = 65536;
const uncheckedJob: JobContext = { signal: new AbortController().signal, epoch: 0, assertActive() {} };
const label = (bytes: Uint8Array, offset: number, length: number) => String.fromCharCode(...bytes.subarray(offset, offset + length));

// Blob slices keep file backing storage opaque; no whole-file arrayBuffer/PCM.
class Reader {
	private bytes = new Uint8Array(0);
	private start = -1;
	constructor(private readonly file: MediaBytes, private readonly job: JobContext) {}
	async get(offset: number, length: number): Promise<Uint8Array> {
		this.job.assertActive();
		if (offset < 0 || offset + length > this.file.size) throw new MediaError("damaged-input", "The audio contains a truncated header or frame.");
		if (offset < this.start || offset + length > this.start + this.bytes.length) {
			this.bytes = new Uint8Array(await readMediaRange(this.file, offset, Math.min(this.file.size, offset + Math.max(READ_BYTES, length)), this.job));
			this.job.assertActive(); this.start = offset;
		}
		return this.bytes.subarray(offset - this.start, offset - this.start + length);
	}
}

type Frame = { bytes: Uint8Array; offset: number; sampleRateHz: number; channels: number; samples: number };
function frameHeader(bytes: Uint8Array): Omit<Frame, "bytes" | "offset"> & { length: number } {
	const [a, b, c, d] = bytes;
	if (a !== 255 || (b & 224) !== 224 || ((b >> 3) & 3) === 1 || (c >> 4) === 15 || ((c >> 2) & 3) === 3) throw new MediaError("damaged-input", "The MP3 frame header is invalid.");
	if (((b >> 1) & 3) !== 1 || (c >> 4) === 0) throw new MediaError("unsupported-codec", "Only MP3 Layer III with an explicit bitrate is supported.");
	const version = (b >> 3) & 3;
	const rate = [44100, 48000, 32000][(c >> 2) & 3] / (version === 3 ? 1 : version === 2 ? 2 : 4);
	const bitrate = (version === 3 ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320] : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160])[c >> 4];
	return { length: Math.floor((version === 3 ? 144000 : 72000) * bitrate / rate) + ((c >> 1) & 1), sampleRateHz: rate, channels: (d >> 6) === 3 ? 1 : 2, samples: version === 3 ? 1152 : 576 };
}

async function* frames(file: MediaBytes, job: JobContext): AsyncGenerator<Frame> {
	const reader = new Reader(file, job);
	let offset = 0;
	if (file.size >= 10 && label(await reader.get(0, 10), 0, 3) === "ID3") {
		const tag = await reader.get(0, 10);
		if (tag.subarray(6).some((v) => v > 127) || ![2, 3, 4].includes(tag[3])) throw new MediaError("damaged-input", "The ID3 header is invalid.");
		offset = 10 + tag[6] * 2097152 + tag[7] * 16384 + tag[8] * 128 + tag[9] + ((tag[5] & 16) ? 10 : 0);
		if (offset > file.size) throw new MediaError("damaged-input", "The ID3 tag exceeds the file length.");
	}
	let first: Frame | null = null;
	while (offset < file.size) {
		job.assertActive();
		if (file.size - offset === 128 && label(await reader.get(offset, 3), 0, 3) === "TAG") break;
		const header = frameHeader(await reader.get(offset, 4));
		const frame = { ...header, offset, bytes: await reader.get(offset, header.length) };
		if (first && (first.sampleRateHz !== frame.sampleRateHz || first.channels !== frame.channels)) throw new MediaError("unsupported-codec", "MP3 streams that change sample rate or channel count are not supported.");
		first ??= frame;
		yield frame; offset += header.length;
	}
	if (!first) throw new MediaError("no-audio-track", "No MP3 audio frames were found.");
}

function originalDelay(frame: Frame): Inspection["originalEncoding"] {
	// Xing/LAME delay is source metadata; the output encoder offset is separate.
	const bytes = frame.bytes;
	const version1 = ((bytes[1] >> 3) & 3) === 3;
	const xing = 4 + ((bytes[1] & 1) ? 0 : 2) + (version1 ? frame.channels === 1 ? 17 : 32 : frame.channels === 1 ? 9 : 17);
	if (!["Xing", "Info"].includes(label(bytes, xing, 4))) return { delaySamples: null, paddingSamples: null };
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (xing + 8 > bytes.length) return { delaySamples: null, paddingSamples: null };
	const flags = view.getUint32(xing + 4);
	let lame = xing + 8;
	for (const [flag, size] of [[1, 4], [2, 4], [4, 100], [8, 4]]) if (flags & flag) lame += size;
	if (lame + 24 > bytes.length || !["LAME", "Lavf", "Lavc"].includes(label(bytes, lame, 4))) return { delaySamples: null, paddingSamples: null };
	return { delaySamples: (bytes[lame + 21] << 4) | (bytes[lame + 22] >> 4), paddingSamples: ((bytes[lame + 22] & 15) << 8) | bytes[lame + 23] };
}

type WavInfo = { sampleRateHz: number; channels: number; dataOffset: number; dataBytes: number };
async function readWav(file: MediaBytes, job: JobContext): Promise<WavInfo> {
	const reader = new Reader(file, job);
	const header = await reader.get(0, 12);
	const riffSize = new DataView(header.buffer, header.byteOffset).getUint32(4, true) + 8;
	if (riffSize !== file.size || label(header, 8, 4) !== "WAVE") throw new MediaError("damaged-input", "The WAV RIFF size or header is invalid.");
	let format: { sampleRateHz: number; channels: number } | null = null;
	let data: { dataOffset: number; dataBytes: number } | null = null;
	for (let offset = 12; offset < riffSize;) {
		const chunk = await reader.get(offset, 8);
		const size = new DataView(chunk.buffer, chunk.byteOffset).getUint32(4, true);
		if (offset + 8 + size > riffSize) throw new MediaError("damaged-input", "A WAV chunk exceeds the file size.");
		const name = label(chunk, 0, 4);
		if (name === "fmt ") {
			if (format || size < 16) throw new MediaError("damaged-input", "The WAV format header is invalid.");
			const bytes = await reader.get(offset + 8, 16), view = new DataView(bytes.buffer, bytes.byteOffset);
			const channels = view.getUint16(2, true), sampleRateHz = view.getUint32(4, true);
			if (view.getUint16(0, true) !== 1 || view.getUint16(14, true) !== 16 || ![1, 2].includes(channels)) throw new MediaError("unsupported-codec", "Only mono/stereo 16-bit PCM WAV is supported.");
			if (view.getUint16(12, true) !== channels * 2 || view.getUint32(8, true) !== sampleRateHz * channels * 2) throw new MediaError("damaged-input", "The WAV sample layout is inconsistent.");
			format = { channels, sampleRateHz };
		} else if (name === "data") {
			if (data) throw new MediaError("unsupported-codec", "Multiple WAV audio data chunks are not supported.");
			data = { dataOffset: offset + 8, dataBytes: size };
		}
		offset += 8 + size + size % 2;
	}
	if (!format || !data || !data.dataBytes) throw new MediaError("no-audio-track", "The WAV has no audio samples.");
	if (!SUPPORTED_AUDIO.inputSampleRatesHz.includes(format.sampleRateHz)) throw new MediaError("unsupported-codec", "The tested input sample rates are 16, 44.1 and 48 kHz.");
	if (data.dataBytes % (format.channels * 2)) throw new MediaError("damaged-input", "The WAV ends in a partial sample.");
	return { ...format, ...data };
}

async function container(file: MediaBytes, job: JobContext): Promise<"wav" | "mp3" | "m4a"> {
	if (file.size < 4) throw new MediaError("unsupported-container", "Select a supported MP3 or PCM16 WAV audio file.");
	job.assertActive(); const header = new Uint8Array(await readMediaRange(file, 0, Math.min(file.size, 12), job)); job.assertActive();
	if (label(header, 0, 4) === "RIFF") return "wav";
	if (label(header, 4, 4) === "ftyp") return "m4a";
	if (label(header, 0, 3) === "ID3" || (header[0] === 255 && (header[1] & 224) === 224)) return "mp3";
	throw new MediaError("unsupported-container", "This container is not verified. Select MP3 or PCM16 WAV; video and Ogg are not supported; AAC-LC M4A needs native browser decoding.");
}

export async function inspectSource(file: MediaInput, job = uncheckedJob, progress?: (value: MediaProgress) => void): Promise<Inspection> {
	progress?.({ stage: 'inspecting', sourceProcessedMs: 0, durationMs: 0, pcmBytes: 0, encodedBytes: 0 });
	const kind = await container(file, job);
	let channels: number, sampleRateHz: number, samples = 0;
	let sourceDurationMs: number | null = null;
	let encoding: Inspection["originalEncoding"] = { delaySamples: null, paddingSamples: null };
	let reportedMs = 0, reportedAt = -Infinity;
	const reportDecoded = (final = false) => {
		job.assertActive();
		const processed = Math.round(samples * 1000 / sampleRateHz);
		const now = performance.now();
		if (!final && (processed - reportedMs < 1000 || now - reportedAt < 100)) return;
		reportedMs = processed; reportedAt = now;
		progress?.({ stage: kind === 'wav' ? 'inspecting' : 'decoding', sourceProcessedMs: 0, durationMs: 0, pcmBytes: 0, encodedBytes: 0,
			phaseProcessedMs: processed, phaseDurationMs: final ? sourceDurationMs ?? processed : sourceDurationMs });
	};
	if (kind === "m4a") {
		const m4a = await readM4a(file, job); channels = m4a.channels; sampleRateHz = m4a.sampleRateHz;
		if (m4a.gapless) encoding = { delaySamples: m4a.delaySamples, paddingSamples: m4a.paddingSamples };
		sourceDurationMs = Math.round(m4a.clockDuration * 1000 / sampleRateHz);
		for await (const pcm of m4aMonoPcm(file, m4a, job)) { samples += pcm.length; pcm.fill(0); reportDecoded(); }
	} else if (kind === "wav") {
		const wav = await readWav(file, job); channels = wav.channels; sampleRateHz = wav.sampleRateHz; samples = wav.dataBytes / (channels * 2);
	} else {
		channels = 0; sampleRateHz = 0;
		const decoder = new MPEGDecoder(); await decoder.ready; job.assertActive();
		try {
			for await (const frame of frames(file, job)) {
				if (!sampleRateHz) { sampleRateHz = frame.sampleRateHz; channels = frame.channels; encoding = originalDelay(frame); }
				if (!SUPPORTED_AUDIO.inputSampleRatesHz.includes(sampleRateHz)) throw new MediaError("unsupported-codec", "The tested MP3 input sample rates are 16, 44.1 and 48 kHz.");
				const decoded = decoder.decodeFrame(frame.bytes);
				if (decoded.errors.length) throw new MediaError("damaged-input", "MP3 decoding reported damaged audio; repair or re-export the source.");
				samples += decoded.samplesDecoded;
				reportDecoded();
			}
		} finally { decoder.free(); }
	}
	if (!samples) throw new MediaError("no-audio-track", "The file contains no decodable audio samples.");
	job.assertActive();
	reportDecoded(true);
	return { asset: Object.freeze({ id: crypto.randomUUID(), fileName: file.name, bytes: file.size, container: kind, codec: kind === "wav" ? "pcm_s16le" : kind === "m4a" ? "aac-lc" : "mp3", durationMs: sourceDurationMs ?? Math.round(samples * 1000 / sampleRateHz), channels, sampleRateHz }), decodedSamples: samples, originalEncoding: encoding };
}

export function validateOptions(options: AudioOptions): void {
	validateTranscriptionHints(options.transcriptionHints);
	if (![5, 10, 15].includes(options.chunkMinutes) || ![5, 10, 15].includes(options.overlapSeconds) || options.sampleRateHz !== 16000 || !SUPPORTED_AUDIO.bitratesKbps.includes(options.bitrateKbps)) throw new MediaError("unsupported-options", "Use 5/10/15 minute chunks, 5/10/15 second overlap, and 16 kHz mono MP3 at 24/32/48 kbps.");
}
export function planChunkRanges(durationMs: number, options: AudioOptions): ChunkRange[] {
	validateOptions(options);
	if (!Number.isSafeInteger(durationMs) || durationMs <= 0) throw new MediaError("no-audio-track", "A positive measured audio duration is required.");
	const ranges: ChunkRange[] = [], length = options.chunkMinutes * 60000, step = length - options.overlapSeconds * 1000;
	for (let start = 0; start < durationMs; start += step) {
		const end = Math.min(start + length, durationMs); ranges.push({ sourceStartMs: start, sourceEndMs: end });
		if (end === durationMs) break;
	}
	return ranges;
}

async function* monoPcm(file: MediaInput, source: SourceAsset, job: JobContext, inspectedM4a?: M4aSource): AsyncGenerator<Float32Array> {
	if (source.container === "m4a") {
		const m4a = inspectedM4a ?? await readM4a(file, job);
		if (m4a.sampleRateHz !== source.sampleRateHz || m4a.channels !== source.channels || Math.round(m4a.clockDuration * 1000 / m4a.sampleRateHz) !== source.durationMs) throw new MediaError("damaged-input", "The M4A source metadata changed.");
		yield* m4aMonoPcm(file, m4a, job);
	} else if (source.container === "wav") {
		const info = await readWav(file, job);
		const blockBytes = Math.min(READ_BYTES, source.sampleRateHz * source.channels * 2);
		for (let offset = info.dataOffset; offset < info.dataOffset + info.dataBytes; offset += blockBytes) {
			job.assertActive(); const bytes = await readMediaRange(file, offset, Math.min(offset + blockBytes, info.dataOffset + info.dataBytes), job); job.assertActive();
			const view = new DataView(bytes), pcm = new Float32Array(bytes.byteLength / (source.channels * 2));
			for (let i = 0; i < pcm.length; i++) { let value = 0; for (let c = 0; c < source.channels; c++) value += view.getInt16((i * source.channels + c) * 2, true) / 32768; pcm[i] = value / source.channels; }
			yield pcm;
		}
	} else {
		const decoder = new MPEGDecoder(); await decoder.ready; job.assertActive();
		try {
			for await (const frame of frames(file, job)) {
				const decoded = decoder.decodeFrame(frame.bytes);
				if (decoded.errors.length || (decoded.samplesDecoded && decoded.sampleRate !== source.sampleRateHz)) throw new MediaError("damaged-input", "The MP3 decoder could not preserve the source audio.");
				if (!decoded.samplesDecoded) continue;
				const mono = decoded.channelData[0];
				if (decoded.channelData.length === 2) for (let i = 0; i < mono.length; i++) mono[i] = (mono[i] + decoded.channelData[1][i]) / 2;
				yield mono;
			}
		} finally { decoder.free(); }
	}
}

/** Only a fixed overview and one decoder window are retained. */
export async function sourceWaveform(file: MediaInput, source: SourceAsset, job: JobContext): Promise<number[]> {
	job.assertActive();
	if (!Number.isFinite(source.durationMs) || source.durationMs <= 0 || !SUPPORTED_AUDIO.inputSampleRatesHz.includes(source.sampleRateHz)) throw new MediaError('damaged-input', 'Invalid waveform source.');
	const m4a = source.container === 'm4a' ? await readM4a(file, job) : undefined;
	const samples = m4a?.decodedSamples ?? Math.round(source.durationMs * source.sampleRateHz / 1000);
	const peaks = new Array<number>(256).fill(0);
	let position = 0;
	try {
		for await (const pcm of monoPcm(file, source, job, m4a)) {
			try {
				job.assertActive();
				for (const value of pcm) {
					const bucket = Math.min(peaks.length - 1, Math.floor(position++ * peaks.length / samples));
					peaks[bucket] = Math.max(peaks[bucket], Math.min(1, Math.abs(value)));
				}
			} finally { pcm.fill(0); }
		}
		job.assertActive(); return peaks;
	} catch (error) { peaks.fill(0); throw error; }
}

export async function* encodeSourceChunks(file: MediaInput, source: SourceAsset, options: AudioOptions, job: JobContext, targetBytes: number, decodedSamples: number, progress?: (value: MediaProgress) => void): AsyncGenerator<{ range: ChunkRange; audio: Blob }> {
	validateOptions(options); job.assertActive();
	progress?.({ stage: 'preparing', sourceProcessedMs: 0, durationMs: source.durationMs, pcmBytes: 0, encodedBytes: 0 });
	const m4a = source.container === "m4a" ? await readM4a(file, job) : undefined;
	if (m4a && m4a.decodedSamples !== decodedSamples) throw new MediaError("damaged-input", "The M4A decoded frame count changed.");
	const sampleAtMs = (milliseconds: number) => m4a ? m4aPcmSampleAtMs(m4a, milliseconds) : Math.round(milliseconds * source.sampleRateHz / 1000);
	// Production CSP allows same-origin connections, not the helper's data: fetch.
	// Vite emits this pinned WASM as an asset; Node tests use the same real codec.
	const encoder = await (import.meta.env.SSR ? createMp3Encoder() : createEncoder("audio/mpeg", mp3WasmUrl)); job.assertActive();
	const pcm = monoPcm(file, source, job, m4a)[Symbol.asyncIterator]();
	// Retain the overlap plus the bounded clock drift and one final access unit.
	// New decode windows never exceed one second; the original file is unchanged.
	const clockTail = m4a ? m4a.clockDriftSamples + M4A_LIMITS.decodedFrames : 0;
	const tail = new Float32Array(source.sampleRateHz * options.overlapSeconds + clockTail);
	let tailPosition = 0, tailCount = 0, consumed = 0, current: Float32Array = new Float32Array(0), currentPosition = 0, reportedAt = performance.now();
	try {
		for (const range of planChunkRanges(source.durationMs, options)) {
			job.assertActive(); encoder.configure({ channels: 1, sampleRate: source.sampleRateHz, outputSampleRate: 16000, bitrate: options.bitrateKbps as 24 | 32 | 48 });
			let parts: Uint8Array<ArrayBuffer>[] = [], encodedBytes = 0;
			const append = (bytes: Uint8Array) => {
				encodedBytes += bytes.byteLength;
				if (encodedBytes >= targetBytes) throw new MediaError("encoded-too-large", "The actual MP3 exceeds the provider safety target. Choose a lower bitrate or shorter chunks.");
				if (bytes.length) parts.push(new Uint8Array(bytes));
			};
			if (range.sourceStartMs) {
				const replay = consumed - sampleAtMs(range.sourceStartMs);
				if (replay < 0 || replay > tailCount) throw new MediaError("damaged-input", "The source overlap exceeds its bounded PCM tail.");
				const start = (tailPosition - replay + tail.length) % tail.length, first = Math.min(replay, tail.length - start);
				append(encoder.encode([tail.subarray(start, start + first)]));
				if (first < replay) append(encoder.encode([tail.subarray(0, replay - first)]));
			}
			// A rounded integer-ms duration can differ by 22 samples at 44.1 kHz.
			// The last chunk must consume every actual decoded source sample.
			const endSample = range.sourceEndMs === source.durationMs ? decodedSamples : sampleAtMs(range.sourceEndMs);
			while (consumed < endSample) {
				job.assertActive();
				if (currentPosition === current.length) { const next = await pcm.next(); job.assertActive(); if (next.done) break; current = next.value; currentPosition = 0; }
				const length = Math.min(current.length - currentPosition, endSample - consumed);
				const block = current.subarray(currentPosition, currentPosition + length);
				append(encoder.encode([block]));
				for (let i = 0; i < length; i++) { tail[tailPosition] = block[i]; tailPosition = (tailPosition + 1) % tail.length; }
				tailCount = Math.min(tail.length, tailCount + length); consumed += length; currentPosition += length;
				if (consumed % source.sampleRateHz < length || consumed >= endSample) {
					const now = performance.now();
					if (consumed >= endSample || now - reportedAt >= 100) {
						reportedAt = now;
						progress?.({ stage: 'preparing', sourceProcessedMs: Math.min(source.durationMs, Math.round(consumed * 1000 / source.sampleRateHz)), durationMs: source.durationMs, pcmBytes: tail.byteLength + current.byteLength, encodedBytes });
					}
				}
			}
			if (consumed < endSample - 1) throw new MediaError("damaged-input", "Decoded source ended before its measured duration.");
			append(encoder.finalize()); job.assertActive();
			const audio = new Blob(parts, { type: "audio/mpeg" }); parts = [];
			if (!audio.size || audio.size >= targetBytes) throw new MediaError("encoded-too-large", "The actual encoded audio does not fit the provider safety target.");
			// Inspect the finished output with a fresh decoder, not just its header.
			const verified = await inspectSource(new File([audio], "prepared.mp3"), job, value => progress?.({ ...value, stage: 'verifying',
				sourceProcessedMs: range.sourceEndMs, durationMs: source.durationMs, encodedBytes }));
			if (verified.asset.codec !== "mp3" || verified.asset.sampleRateHz !== 16000 || verified.asset.channels !== 1) throw new MediaError("damaged-input", "The output encoder produced an unexpected format.");
			yield { range, audio };
		}
	} finally { tail.fill(0); current.fill(0); await pcm.return?.(undefined); }
}
