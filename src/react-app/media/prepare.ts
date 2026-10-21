import type { AudioOptions, JobContext, PreparedChunk } from "../domain/types";
import { MediaError, MP3_ENCODING_OFFSET_MS, validateOptions } from "./mp3";
import { createBrowserMediaWorker, type MediaProgress, type MediaWorker } from "./worker";
import type { MediaInput } from './io';
export { planChunkRanges, SUPPORTED_AUDIO } from "./mp3";

export type AudioPreparerConfig = Readonly<{
	sourceId: string;
	// Must resolve only after atomic encrypted audio + project checkpoint.
	sink(chunk: PreparedChunk, audio: Blob, job: JobContext): Promise<void>;
	maxEncodedBytes?: number; safetyMarginBytes?: number;
	onProgress?: (progress: MediaProgress) => void;
	/** Node tests only. Production requires a terminating module Worker. */
	workerFactory?: (progress?: (progress: MediaProgress) => void) => MediaWorker;
}>;
let active: symbol | null = null;
export function createAudioPreparer(config: AudioPreparerConfig) {
	if (!config.sourceId || typeof config.sink !== "function") throw new TypeError("A source ID and encrypted save sink are required");
	const maxBytes = config.maxEncodedBytes ?? 25000000, margin = config.safetyMarginBytes ?? 250000;
	if (!Number.isSafeInteger(maxBytes) || !Number.isSafeInteger(margin) || margin <= 0 || maxBytes <= margin) throw new TypeError("Provide a positive provider byte limit and safety margin");
	return async function* prepareAudio(file: MediaInput, options: AudioOptions, job: JobContext): AsyncIterable<PreparedChunk> {
		job.assertActive(); validateOptions(options);
		if (active) throw new MediaError("busy", "Another audio preparation job is running. Stop it before preparing another recording.");
		const owner = Symbol("audio-job"); active = owner;
		let worker: MediaWorker | null = null;
		let result: Awaited<ReturnType<MediaWorker["next"]>> | null = null;
		const stop = () => { worker?.terminate(); worker = null; result = null; file = null!; if (active === owner) active = null; };
		job.signal.addEventListener("abort", stop, { once: true });
		try {
			worker = (config.workerFactory ?? createBrowserMediaWorker)((value) => { if (!job.signal.aborted) { job.assertActive(); config.onProgress?.(value); } });
			{
				const inspected = await worker.inspect(file, job); job.assertActive();
				const source = { ...inspected.asset, id: config.sourceId };
				await worker.start(file, source, options, maxBytes - margin, inspected.decodedSamples, job); job.assertActive();
			}
			file = null!; // The Worker transport owns its input until termination.
			let index = 0;
			while (true) {
				job.assertActive(); result = await worker!.next(); job.assertActive(); if (result.done) break;
				const chunk: PreparedChunk = Object.freeze({ id: crypto.randomUUID(), sourceId: config.sourceId, index: index++, ...result.value.range, encodingOffsetMs: MP3_ENCODING_OFFSET_MS, encodedBytes: result.value.audio.size, mimeType: "audio/mpeg", codec: "mp3", audioRecordId: crypto.randomUUID() });
				if (chunk.encodedBytes >= maxBytes - margin) throw new MediaError("encoded-too-large", "The encoded chunk exceeds the actual byte safety target.");
				await config.sink(chunk, result.value.audio, job); job.assertActive(); result = null;
				yield chunk;
			}
		} finally { job.signal.removeEventListener("abort", stop); stop(); }
	};
}
