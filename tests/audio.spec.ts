import { afterEach, describe, expect, it, vi } from "vitest";
import { createMp3Encoder } from "wasm-media-encoders";
import { MPEGDecoder } from "mpg123-decoder";
import { cancelJobs, createJobContext } from "../src/react-app/domain/jobs";
import type { AudioOptions } from "../src/react-app/domain/types";
import { inspectAudio, inspectAudioDetails, MediaError } from "../src/react-app/media/inspect";
import { createAudioPreparer, planChunkRanges } from "../src/react-app/media/prepare";
import { createLocalMediaWorker, type MediaProgress } from "../src/react-app/media/worker";

const options: AudioOptions = { chunkMinutes: 10, overlapSeconds: 10, expectedLanguages: ["ko", "en"], bitrateKbps: 32, sampleRateHz: 16000 };
const sourceId = "keyless-audio-source";
afterEach(() => { cancelJobs(); vi.unstubAllGlobals(); });

// All fixtures are synthetic tones, generated locally without keys or speech.
function wav(seconds = 2, sampleRate = 16000): globalThis.File {
	const samples = Math.round(seconds * sampleRate);
	const bytes = new Uint8Array(44 + samples * 2);
	const view = new DataView(bytes.buffer);
	const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i); };
	text(0, "RIFF"); view.setUint32(4, bytes.length - 8, true); text(8, "WAVE"); text(12, "fmt ");
	view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, "data"); view.setUint32(40, samples * 2, true);
	for (let i = 0; i < samples; i++) view.setInt16(44 + i * 2, Math.sin(2 * Math.PI * 440 * i / sampleRate) * 16000, true);
	return new File([bytes], "synthetic-tone.bin", { type: "application/octet-stream" }) as globalThis.File;
}

async function mp3(seconds = 2, sampleRate = 16000, channels: 1 | 2 = 1): Promise<globalThis.File> {
	const encoder = await createMp3Encoder();
	encoder.configure({ sampleRate, outputSampleRate: sampleRate as 16000 | 44100 | 48000, channels, bitrate: sampleRate === 16000 ? 32 : 128 });
	const parts: Uint8Array<ArrayBuffer>[] = [];
	for (let block = 0; block < seconds; block++) {
		const pcm = Float32Array.from({ length: sampleRate }, (_, i) => Math.sin(2 * Math.PI * 440 * i / sampleRate) * .5);
		parts.push(new Uint8Array(encoder.encode(channels === 2 ? [pcm, pcm] : [pcm])));
	}
	parts.push(new Uint8Array(encoder.finalize()));
	return new File(parts, "synthetic-tone.not-mp3", { type: "video/mp4" }) as globalThis.File;
}

async function decode(audio: Blob) {
	const decoder = new MPEGDecoder();
	await decoder.ready;
	try { return decoder.decode(new Uint8Array(await audio.arrayBuffer())); }
	finally { decoder.free(); }
}

describe("bounded audio ranges", () => {
    for (const chunkMinutes of [5, 10, 15] as const) for (const overlapSeconds of [5, 10, 15] as const) it(`plans ${chunkMinutes} minute chunks with exact ${overlapSeconds} second overlap and a short terminal range`, () => {
        const length = chunkMinutes * 60000, duration = length + 1000;
        expect(planChunkRanges(duration, { ...options, chunkMinutes, overlapSeconds })).toEqual([
            { sourceStartMs: 0, sourceEndMs: length },
            { sourceStartMs: length - overlapSeconds * 1000, sourceEndMs: duration },
        ]);
    });
	it("covers one hour with seven 10 minute ranges and exact 10 second overlaps", () => {
		const ranges = planChunkRanges(3600000, options);
		expect(ranges).toHaveLength(7);
		expect(ranges[0]).toEqual({ sourceStartMs: 0, sourceEndMs: 600000 });
		expect(ranges.at(-1)?.sourceEndMs).toBe(3600000);
		for (let i = 1; i < ranges.length; i++) expect(ranges[i - 1].sourceEndMs - ranges[i].sourceStartMs).toBe(10000);
	});
	it("covers two hours with nine 15 minute ranges and exact 15 second overlaps", () => {
		const ranges = planChunkRanges(7200000, { ...options, chunkMinutes: 15, overlapSeconds: 15 });
		expect(ranges).toHaveLength(9);
		expect(ranges.at(-1)?.sourceEndMs).toBe(7200000);
		for (let i = 1; i < ranges.length; i++) expect(ranges[i - 1].sourceEndMs - ranges[i].sourceStartMs).toBe(15000);
	});
	it("does not create a terminal chunk contained entirely in the previous one", () => {
		expect(planChunkRanges(600000, options)).toHaveLength(1);
		expect(planChunkRanges(1190000, options)).toHaveLength(2);
		expect(() => planChunkRanges(0, options)).toThrow(MediaError);
	});
});

describe("actual container inspection", () => {
	it("bounds fast progress messages while retaining actual phase completion", async () => {
		vi.spyOn(performance, 'now').mockReturnValue(0);
		try {
			const events: MediaProgress[] = [];
			const prepare = createAudioPreparer({ sourceId, workerFactory: createLocalMediaWorker, sink: async () => {}, onProgress: value => events.push(value) });
			for await (const chunk of prepare(wav(13), options, createJobContext())) expect(chunk.sourceEndMs).toBe(13000);
			expect(events.length).toBeLessThan(8);
			expect(events.some(event => event.stage === 'preparing' && event.sourceProcessedMs === 13000)).toBe(true);
			expect(events.at(-1)).toMatchObject({ stage: 'verifying', sourceProcessedMs: 13000 });
		} finally { vi.restoreAllMocks(); }
	});
	it("reports real decoded audio during inspection before any encoding begins", async () => {
		const file = await mp3(3), events: MediaProgress[] = [];
		const result = await import('../src/react-app/media/mp3').then(media => media.inspectSource(file, createJobContext(), value => events.push(value)));
		expect(events.some(event => event.stage === 'decoding' && (event.phaseProcessedMs ?? 0) > 0)).toBe(true);
		expect(events.at(-1)).toMatchObject({ stage: 'decoding', sourceProcessedMs: 0, phaseProcessedMs: result.asset.durationMs, phaseDurationMs: result.asset.durationMs });
		expect(events.every(event => event.encodedBytes === 0)).toBe(true);
	});
	it("separates output verification from encoding without counting it as more source time", async () => {
		const events: MediaProgress[] = [];
		const prepare = createAudioPreparer({ sourceId, workerFactory: createLocalMediaWorker, sink: async () => {}, onProgress: value => events.push(value) });
		for await (const chunk of prepare(wav(3), options, createJobContext())) expect(chunk.sourceEndMs).toBe(3000);
		expect(events.some(event => event.stage === 'inspecting')).toBe(true);
		expect(events.some(event => event.stage === 'verifying' && (event.phaseProcessedMs ?? 0) > 0)).toBe(true);
		expect(events.filter(event => event.stage === 'verifying').every(event => event.sourceProcessedMs === 3000 && event.durationMs === 3000)).toBe(true);
		expect(events.at(-1)?.sourceProcessedMs).toBe(3000);
	});
	it("does not create a Worker when locking races the asynchronous module import", async () => {
		// Node has no browser Worker; fail explicitly if an inactive epoch reaches it.
		vi.stubGlobal("Worker", class { constructor() { throw new Error("An inactive job tried to create a Worker"); } });
		const pending = inspectAudioDetails(wav(), createJobContext());
		cancelJobs();
		await expect(pending).rejects.toMatchObject({ name: "AbortError" });
	});
	it("inspects PCM16 WAV bytes independently of extension or declared MIME", async () => {
		const file = wav();
		const source = await inspectAudio(file);
		expect(source).toMatchObject({ fileName: file.name, bytes: file.size, container: "wav", codec: "pcm_s16le", durationMs: 2000, channels: 1, sampleRateHz: 16000 });
	});
	it("inspects all MP3 frames and decoder duration independently of extension", async () => {
		const file = await mp3();
		const source = await inspectAudio(file);
		expect(source).toMatchObject({ bytes: file.size, container: "mp3", codec: "mp3", channels: 1, sampleRateHz: 16000 });
		expect(source.durationMs).toBeGreaterThanOrEqual(2000);
		expect(source.durationMs).toBeLessThan(2200);
	});
	it("rejects damaged audio and unsupported containers explicitly", async () => {
		await expect(inspectAudio(new File(["not audio"], "sounds.mp3") as globalThis.File)).rejects.toMatchObject({ code: "unsupported-container" });
		const file = await mp3();
		await expect(inspectAudio(new File([file.slice(0, file.size - 3)], "truncated.mp3") as globalThis.File)).rejects.toMatchObject({ code: "damaged-input" });
	});
	it("rejects a WAV with no audio data and unsupported WAV sample format", async () => {
		await expect(inspectAudio(wav(0))).rejects.toMatchObject({ code: "no-audio-track" });
		const bytes = new Uint8Array(await wav().arrayBuffer());
		new DataView(bytes.buffer).setUint16(20, 3, true);
		await expect(inspectAudio(new File([bytes], "float.wav") as globalThis.File)).rejects.toMatchObject({ code: "unsupported-codec" });
	});
});

describe("real local encoding and encrypted-save boundary", () => {
    it("encodes a 301 second tone into actual byte-fitting five minute chunks with five second overlap", async () => {
        const saved: Blob[] = [], progress: MediaProgress[] = [];
        const prepare = createAudioPreparer({ sourceId, sink: async (_chunk, audio) => { saved.push(audio); }, workerFactory: createLocalMediaWorker, onProgress: value => progress.push(value) });
        const chunks = [];
        for await (const chunk of prepare(wav(301), { ...options, chunkMinutes: 5, overlapSeconds: 5 }, createJobContext())) chunks.push(chunk);
        expect(chunks.map(({ sourceStartMs, sourceEndMs }) => ({ sourceStartMs, sourceEndMs }))).toEqual([
            { sourceStartMs: 0, sourceEndMs: 300000 }, { sourceStartMs: 295000, sourceEndMs: 301000 },
        ]);
        expect(progress.some(value => value.sourceProcessedMs > 0 && value.sourceProcessedMs < 300000)).toBe(true);
        expect(progress.at(-1)?.sourceProcessedMs).toBe(301000);
        for (let index = 0; index < saved.length; index++) {
            expect(chunks[index].encodedBytes).toBe(saved[index].size);
            expect(saved[index].size).toBeGreaterThan(0); expect(saved[index].size).toBeLessThan(24750000);
            const decoded = await decode(saved[index]);
            expect(decoded.errors).toEqual([]); expect(decoded.sampleRate).toBe(16000);
            const expectedSeconds = (chunks[index].sourceEndMs - chunks[index].sourceStartMs) / 1000;
            expect(decoded.samplesDecoded / decoded.sampleRate).toBeGreaterThanOrEqual(expectedSeconds);
            expect(decoded.samplesDecoded / decoded.sampleRate).toBeLessThan(expectedSeconds + .2);
            expect(Math.max(...decoded.channelData[0].slice(1000, 2000))).toBeGreaterThan(.2);
        }
    }, 30000);
    for (const value of [5, 10, 15] as const) it(`encodes and independently decodes a short tone with ${value} minute/second controls`, async () => {
        const saved: Blob[] = [];
        const prepare = createAudioPreparer({ sourceId, sink: async (_chunk, audio) => { saved.push(audio); }, workerFactory: createLocalMediaWorker });
        const chunks = [];
        for await (const chunk of prepare(wav(2), { ...options, chunkMinutes: value, overlapSeconds: value }, createJobContext())) chunks.push(chunk);
        expect(chunks).toHaveLength(1); expect(chunks[0].sourceEndMs).toBe(2000);
        expect(chunks[0].encodedBytes).toBe(saved[0].size); expect(saved[0].size).toBeLessThan(24750000);
        const decoded = await decode(saved[0]); expect(decoded.errors).toEqual([]); expect(decoded.samplesDecoded / decoded.sampleRate).toBeGreaterThanOrEqual(2);
    });
	for (const sampleRate of [16000, 44100, 48000]) for (const channels of [1, 2] as const) it(`prepares ${sampleRate} Hz ${channels} channel MP3 without losing the rounded terminal samples`, async () => {
		const file = await mp3(2, sampleRate, channels);
		const source = await inspectAudio(file);
		let saved: Blob | null = null;
		const prepare = createAudioPreparer({ sourceId, sink: async (_chunk, audio) => { saved = audio; }, workerFactory: createLocalMediaWorker });
		const results = [];
		for await (const chunk of prepare(file, options, createJobContext())) results.push(chunk);
		expect(results).toHaveLength(1);
		expect(results[0].sourceEndMs).toBe(source.durationMs);
		const decoded = await decode(saved!);
		expect(decoded.errors).toEqual([]);
		expect(decoded.sampleRate).toBe(16000);
	});
	for (const bitrateKbps of [24, 32, 48]) it(`encodes independently decodable 16 kHz mono MP3 at ${bitrateKbps} kbps`, async () => {
		const saved: Blob[] = [];
		const progress: MediaProgress[] = [];
		const prepare = createAudioPreparer({ sourceId, sink: async (chunk, audio, job) => { job.assertActive(); expect(chunk.encodedBytes).toBe(audio.size); saved.push(audio); }, workerFactory: createLocalMediaWorker, onProgress: (value) => progress.push(value) });
		const chunks = [];
		for await (const chunk of prepare(wav(), { ...options, bitrateKbps }, createJobContext())) chunks.push(chunk);
		expect(chunks).toHaveLength(1);
		expect(chunks[0]).toMatchObject({ sourceId, sourceStartMs: 0, sourceEndMs: 2000, mimeType: "audio/mpeg", codec: "mp3", encodingOffsetMs: 69 });
		const decoded = await decode(saved[0]);
		expect(decoded.errors).toEqual([]);
		expect(decoded.sampleRate).toBe(16000);
		// mpg123 exposes two identical PCM channels even for mono frames.
		expect((await inspectAudio(new File([saved[0]], "output.mp3") as globalThis.File)).channels).toBe(1);
		expect(decoded.channelData[0]).toEqual(decoded.channelData[1]);
		expect(decoded.samplesDecoded / decoded.sampleRate).toBeGreaterThanOrEqual(2);
		expect(Math.max(...decoded.channelData[0].slice(1000, 2000))).toBeGreaterThan(.2);
		expect(progress.at(-1)?.sourceProcessedMs).toBe(2000);
	});
	it("does not yield a descriptor before the sink resolves", async () => {
		let release!: () => void;
		let entered!: () => void;
		const started = new Promise<void>((resolve) => { entered = resolve; });
		const pending = new Promise<void>((resolve) => { release = resolve; });
		const prepare = createAudioPreparer({ sourceId, sink: async () => { entered(); await pending; }, workerFactory: createLocalMediaWorker });
		const iterator = prepare(wav(), options, createJobContext())[Symbol.asyncIterator]();
		const next = iterator.next();
		await started;
		let yielded = false; void next.then(() => { yielded = true; });
		await Promise.resolve(); expect(yielded).toBe(false);
		release(); expect((await next).value.sourceId).toBe(sourceId);
		await iterator.return?.();
	});
	it("stops on encrypted save failure without yielding success", async () => {
		const prepare = createAudioPreparer({ sourceId, sink: async () => { throw new Error("storage quota fixture"); }, workerFactory: createLocalMediaWorker });
		await expect(prepare(wav(), options, createJobContext())[Symbol.asyncIterator]().next()).rejects.toThrow("storage quota fixture");
	});
	it("rejects actual encoded bytes above the safety target before saving", async () => {
		let saved = false;
		const prepare = createAudioPreparer({ sourceId, sink: async () => { saved = true; }, maxEncodedBytes: 2000, safetyMarginBytes: 100, workerFactory: createLocalMediaWorker });
		await expect(prepare(wav(), options, createJobContext())[Symbol.asyncIterator]().next()).rejects.toMatchObject({ code: "encoded-too-large" });
		expect(saved).toBe(false);
	});
	it("terminates on lock and rejects a late save before yielding", async () => {
		const job = createJobContext();
		const prepare = createAudioPreparer({ sourceId, sink: async () => { cancelJobs(); }, workerFactory: createLocalMediaWorker });
		await expect(prepare(wav(), options, job)[Symbol.asyncIterator]().next()).rejects.toMatchObject({ name: "AbortError" });
	});
	it("rejects unverified output controls rather than silently changing quality", async () => {
		const prepare = createAudioPreparer({ sourceId, sink: async () => {}, workerFactory: createLocalMediaWorker });
		await expect(prepare(wav(), { ...options, sampleRateHz: 48000 }, createJobContext())[Symbol.asyncIterator]().next()).rejects.toMatchObject({ code: "unsupported-options" });
	});
	it("releases the single job slot immediately when locked while suspended at a saved yield", async () => {
		const prepare = createAudioPreparer({ sourceId, sink: async () => {}, workerFactory: createLocalMediaWorker });
		const iterator = prepare(wav(), options, createJobContext())[Symbol.asyncIterator]();
		await iterator.next(); cancelJobs();
		const next = prepare(wav(), options, createJobContext())[Symbol.asyncIterator]();
		try { expect((await next.next()).done).toBe(false); }
		finally { await next.return?.(); await iterator.return?.(); }
	});
});
