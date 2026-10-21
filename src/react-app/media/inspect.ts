import { createJobContext } from "../domain/jobs";
import type { JobContext, SourceAsset } from "../domain/types";
import { inspectSource, type Inspection, type MediaProgress } from "./mp3";
export { MediaError, SUPPORTED_AUDIO } from "./mp3";

export async function inspectAudioDetails(file: File, job: JobContext = createJobContext(), progress?: (value: MediaProgress) => void): Promise<Inspection> {
	job.assertActive();
	if (typeof Worker === "undefined") return inspectSource(file, job, progress);
	const { createBrowserMediaWorker } = await import("./worker");
	job.assertActive();
	const worker = createBrowserMediaWorker(progress);
	const stop = () => worker.terminate(); job.signal.addEventListener("abort", stop, { once: true });
	try { const result = await worker.inspect(file, job); job.assertActive(); return result; }
	finally { job.signal.removeEventListener("abort", stop); worker.terminate(); }
}
export async function inspectAudio(file: File, job?: JobContext, progress?: (value: MediaProgress) => void): Promise<SourceAsset> { return (await inspectAudioDetails(file, job, progress)).asset; }
