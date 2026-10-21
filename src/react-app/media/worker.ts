import type { AudioOptions, JobContext, SourceAsset } from "../domain/types";
import { encodeSourceChunks, inspectSource, sourceWaveform, MediaError, type ChunkRange, type Inspection, type MediaErrorCode, type MediaProgress } from "./mp3";
import { fenceMediaBuffer, isSourceReader, readMediaRange, type MediaInput, type NamedSourceReader } from './io';
import { MAX_SOURCE_READ_BYTES } from './source';
import { mediaFailureMessage } from './errors';
export type { MediaProgress } from "./mp3";
export interface MediaWorker {
	inspect(file: MediaInput, job?: JobContext): Promise<Inspection>;
	start(file: MediaInput, source: SourceAsset, options: AudioOptions, targetBytes: number, decodedSamples: number, job?: JobContext): Promise<void>;
	waveform?(file: MediaInput, source: SourceAsset, job: JobContext): Promise<number[]>;
	next(): Promise<IteratorResult<{ range: ChunkRange; audio: Blob }>>;
	terminate(): void;
}

// Runs the identical codec engine in Node tests; production always uses a Worker.
export function createLocalMediaWorker(progress?: (value: MediaProgress) => void): MediaWorker {
	const controller = new AbortController();
	const job: JobContext = { signal: controller.signal, epoch: 0, assertActive() { if (controller.signal.aborted) throw new DOMException("Audio preparation stopped", "AbortError"); } };
	let iterator: AsyncGenerator<{ range: ChunkRange; audio: Blob }> | null = null;
	const input = (file: MediaInput, original?: JobContext): MediaInput => {
		job.assertActive(); original?.assertActive();
		if (!isSourceReader(file)) return file;
		if (!original) throw new MediaError('damaged-input', 'Retained audio requires its original active job.');
		return { name: file.name, size: file.size, async read(start, end, localJob) {
			localJob.assertActive(); original.assertActive(); const bytes = await file.read(start, end, original);
			fenceMediaBuffer(bytes, localJob); fenceMediaBuffer(bytes, original); return bytes;
		} };
	};
	return {
		inspect: (file, original) => inspectSource(input(file, original), job, progress),
		waveform: (file, source, original) => sourceWaveform(input(file, original), source, job),
		async start(file, source, options, targetBytes, decodedSamples, original) { job.assertActive(); iterator = encodeSourceChunks(input(file, original), source, options, job, targetBytes, decodedSamples, progress); },
		async next() { job.assertActive(); if (!iterator) throw new Error("Start media preparation first"); return iterator.next(); },
		terminate() { controller.abort(); void iterator?.return(undefined).catch(() => {}); iterator = null; },
	};
}

type ReaderDescriptor = Readonly<{ name: string; size: number }>;
type Request = { id: number; operation: "inspect" | "start" | "next" | "waveform"; file?: File; reader?: ReaderDescriptor; source?: SourceAsset; options?: AudioOptions; targetBytes?: number; decodedSamples?: number };
type Failure = { code?: MediaErrorCode; name: string; message: string };
type Response = { id: number; value?: unknown; error?: Failure; fatal?: boolean; progress?: MediaProgress };
type ReadRequest = { operation: 'read'; readId: number; start: number; end: number };
type ReadResult = { operation: 'read-result'; readId: number; start: number; end: number; bytes: ArrayBuffer };
const stopped = () => new DOMException('Audio preparation stopped', 'AbortError');
const protocolError = () => new MediaError('damaged-input', 'The bounded audio Worker message is invalid.');
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object';
const validRange = (start: number, end: number, size: number) => Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && end > start && end <= size && end - start <= MAX_SOURCE_READ_BYTES;
const failure = (error: unknown): Failure => error instanceof MediaError ? { code: error.code, name: error.name, message: error.message } : { name: error instanceof DOMException && error.name === 'AbortError' ? 'AbortError' : 'Error', message: 'Local audio processing failed.' };
function validFailure(value: unknown): value is Failure {
	if (!object(value) || typeof value.message !== 'string') return false;
	if (value.name === 'MediaError') return typeof value.code === 'string' && mediaFailureMessage(new MediaError(value.code as MediaErrorCode, ''), 'en') !== undefined;
	return (value.name === 'Error' || value.name === 'AbortError') && value.code === undefined;
}
function validValue(operation: Request['operation'], value: unknown, expected?: ReaderDescriptor): boolean {
	if (operation === 'waveform') return Array.isArray(value) && value.length === 256 && value.every(peak => typeof peak === 'number' && Number.isFinite(peak) && peak >= 0 && peak <= 1);
	if (operation === 'start') return value === undefined;
	if (!object(value)) return false;
	if (operation === 'inspect') {
		const asset = value.asset;
		return object(asset) && typeof asset.fileName === 'string' && Number.isSafeInteger(asset.bytes) && (asset.bytes as number) >= 0 && Number.isSafeInteger(asset.durationMs) && (asset.durationMs as number) > 0 && Number.isSafeInteger(value.decodedSamples) && (value.decodedSamples as number) > 0 && (!expected || asset.bytes === expected.size && asset.fileName === expected.name);
	}
	if (value.done === true) return value.value === undefined;
	if (value.done !== false || !object(value.value) || !object(value.value.range) || !(value.value.audio instanceof Blob) || value.value.audio.size < 1) return false;
	const range = value.value.range;
	return Number.isSafeInteger(range.sourceStartMs) && Number.isSafeInteger(range.sourceEndMs) && (range.sourceStartMs as number) >= 0 && (range.sourceEndMs as number) > (range.sourceStartMs as number);
}

export function createBrowserMediaWorker(progress?: (value: MediaProgress) => void): MediaWorker {
	if (typeof Worker === "undefined") throw new MediaError("worker-unavailable", "This browser does not support the required local audio Worker.");
	const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
	let sequence = 0, lastReadId = 0, reading = false, ended = false;
	let reader: NamedSourceReader | null = null, originalJob: JobContext | null = null;
	const pending = new Map<number, { operation: Request['operation']; expected?: ReaderDescriptor; resolve(value: unknown): void; reject(error: Error): void }>();
	const abort = () => stop(stopped());
	const stop = (error: Error) => {
		if (ended) return; ended = true;
		originalJob?.signal.removeEventListener('abort', abort); reader = null; originalJob = null;
		worker.onmessage = null; worker.onerror = null; worker.terminate();
		for (const request of pending.values()) request.reject(error); pending.clear();
	};
	const read = async (data: ReadRequest) => {
		const source = reader, job = originalJob;
		if (!source || !job || pending.size !== 1 || reading || data.readId !== lastReadId + 1 || !validRange(data.start, data.end, source.size)) { stop(protocolError()); return; }
		reading = true; lastReadId = data.readId; let bytes: ArrayBuffer | null = null;
		try {
			job.assertActive(); bytes = await readMediaRange(source, data.start, data.end, job); fenceMediaBuffer(bytes, job);
			if (ended || reader !== source || originalJob !== job) { new Uint8Array(bytes).fill(0); return; }
			worker.postMessage({ operation: 'read-result', readId: data.readId, start: data.start, end: data.end, bytes } satisfies ReadResult, [bytes]); bytes = null;
		} catch (error) {
			if (!ended) { try { job.assertActive(); stop(error instanceof MediaError ? error : protocolError()); } catch { stop(stopped()); } }
		} finally { if (bytes) new Uint8Array(bytes).fill(0); reading = false; }
	};
	worker.onmessage = ({ data }: MessageEvent<unknown>) => {
		if (ended) return;
		try { originalJob?.assertActive(); } catch { stop(stopped()); return; }
		if (!object(data)) { stop(protocolError()); return; }
		if (data.operation === 'read') { void read(data as unknown as ReadRequest); return; }
		if ('operation' in data) { stop(protocolError()); return; }
		if (data.progress) {
			try {
				originalJob?.assertActive();
				const value = data.progress;
				if (!object(value) || !['sourceProcessedMs', 'durationMs', 'pcmBytes', 'encodedBytes'].every(key => typeof value[key] === 'number' && Number.isFinite(value[key]) && value[key] >= 0) ||
					(value.stage !== undefined && (typeof value.stage !== 'string' || !['inspecting', 'decoding', 'preparing', 'verifying'].includes(value.stage))) ||
					(value.phaseProcessedMs !== undefined && (typeof value.phaseProcessedMs !== 'number' || !Number.isFinite(value.phaseProcessedMs) || value.phaseProcessedMs < 0)) ||
					(value.phaseDurationMs != null && (typeof value.phaseDurationMs !== 'number' || !Number.isFinite(value.phaseDurationMs) || value.phaseDurationMs <= 0))) throw protocolError();
				progress?.(value as unknown as MediaProgress);
			}
			catch (error) { stop(error instanceof Error ? error : protocolError()); } return;
		}
		const request = pending.get(data.id as number); if (!request || reading) { stop(protocolError()); return; }
		if (data.error) {
			if (!validFailure(data.error)) { stop(protocolError()); return; }
			const error = data.error.code ? new MediaError(data.error.code as MediaErrorCode, data.error.message) : new Error(data.error.message); error.name = data.error.name;
			if (data.fatal) stop(error); else { pending.delete(data.id as number); request.reject(error); }
		} else { if (!validValue(request.operation, data.value, request.expected)) { stop(protocolError()); return; } pending.delete(data.id as number); request.resolve(data.value); }
	};
	worker.onerror = () => stop(new MediaError("worker-unavailable", "The local audio Worker could not run. Reload and retry with a supported file."));
	const rpc = (request: Omit<Request, "id">, file?: MediaInput, job?: JobContext) => new Promise<unknown>((resolve, reject) => {
		if (ended) { reject(stopped()); return; }
		if (pending.size || reading) { reject(new MediaError('busy', 'An audio Worker request is already running.')); return; }
		try {
			job?.assertActive();
			if (file) {
				if (isSourceReader(file) && !job) throw protocolError();
				originalJob?.signal.removeEventListener('abort', abort); reader = isSourceReader(file) ? file : null; originalJob = job ?? null;
				originalJob?.signal.addEventListener('abort', abort, { once: true });
				if (reader) request.reader = { name: reader.name, size: reader.size }; else request.file = file as File;
			}
			originalJob?.assertActive();
			const id = ++sequence; pending.set(id, { operation: request.operation, ...(file ? { expected: { size: file.size, name: file.name } } : {}), resolve, reject }); worker.postMessage({ ...request, id });
		} catch (error) { const value = error instanceof Error ? error : protocolError(); reject(value); stop(value); }
	});
	return {
		inspect: (file, job) => rpc({ operation: "inspect" }, file, job) as Promise<Inspection>,
		waveform: (file, source, job) => rpc({ operation: "waveform", source }, file, job) as Promise<number[]>,
		start: (file, source, options, targetBytes, decodedSamples, job) => rpc({ operation: "start", source, options, targetBytes, decodedSamples }, file, job) as Promise<void>,
		next: () => rpc({ operation: "next" }) as ReturnType<MediaWorker["next"]>,
		terminate: () => stop(stopped()),
	};
}

export interface MediaWorkerScope {
	postMessage(value: Response | ReadRequest): void;
	onmessage: ((event: MessageEvent<unknown>) => void) | null;
}
/** The actual module endpoint is also exercised by ordinary in-process transport
 * tests; its disposer models native Worker termination without test-only paths. */
export function installMediaWorkerEndpoint(scope: MediaWorkerScope): () => void {
	const controller = new AbortController();
	const job: JobContext = { signal: controller.signal, epoch: 0, assertActive() { if (controller.signal.aborted) throw stopped(); } };
	let ended = false, requestId = 0, readId = 0, working: number | null = null;
	let pendingRead: { readId: number; start: number; end: number; resolve(bytes: ArrayBuffer): void; reject(error: Error): void } | null = null;
	const send = (value: Response | ReadRequest) => { if (!ended) scope.postMessage(value); };
	const engine = createLocalMediaWorker((progress) => send({ id: 0, progress }));
	const stop = () => { if (ended) return; ended = true; controller.abort(); engine.terminate(); pendingRead?.reject(stopped()); pendingRead = null; scope.onmessage = null; };
	const fail = () => { send({ id: working ?? 0, error: failure(protocolError()), fatal: true }); stop(); };
	const remote = (descriptor: ReaderDescriptor): NamedSourceReader => ({ ...descriptor, read(start, end, receivedJob) {
		job.assertActive(); receivedJob.assertActive();
		if (pendingRead || !validRange(start, end, descriptor.size)) throw protocolError();
		return new Promise<ArrayBuffer>((resolve, reject) => { pendingRead = { readId: ++readId, start, end, resolve, reject }; send({ operation: 'read', readId, start, end }); });
	} });
	const input = (data: Request): MediaInput => {
		if (!!data.file === !!data.reader) throw protocolError();
		if (data.reader) { if (typeof data.reader.name !== 'string' || !Number.isSafeInteger(data.reader.size) || data.reader.size < 0) throw protocolError(); return remote(data.reader); }
		if (!(data.file instanceof Blob) || typeof data.file.name !== 'string') throw protocolError(); return data.file;
	};
	scope.onmessage = async ({ data }: MessageEvent<unknown>) => {
		if (ended) return;
		if (!object(data)) { fail(); return; }
		if (data.operation === 'read-result') {
			const read = pendingRead;
			if (!read || data.readId !== read.readId || data.start !== read.start || data.end !== read.end || !(data.bytes instanceof ArrayBuffer) || data.bytes.byteLength !== read.end - read.start) { if (data.bytes instanceof ArrayBuffer) new Uint8Array(data.bytes).fill(0); fail(); return; }
			pendingRead = null; read.resolve(data.bytes); return;
		}
		if (working !== null || data.id !== requestId + 1 || !['inspect', 'start', 'next', 'waveform'].includes(data.operation as string)) { fail(); return; }
		requestId = data.id as number; working = requestId;
		try {
			let value: unknown; const request = data as unknown as Request;
			if (request.operation === "inspect") value = await engine.inspect(input(request), job);
			else if (request.operation === "waveform") { if (!request.source) throw protocolError(); value = await engine.waveform!(input(request), request.source, job); }
			else if (request.operation === "start") {
				if (!request.source || !request.options || !Number.isSafeInteger(request.targetBytes) || request.targetBytes! <= 0 || !Number.isSafeInteger(request.decodedSamples) || request.decodedSamples! <= 0) throw protocolError();
				value = await engine.start(input(request), request.source, request.options, request.targetBytes!, request.decodedSamples!, job);
			}
			else value = await engine.next();
			job.assertActive(); send({ id: requestId, value });
		} catch (error) {
			send({ id: requestId, error: failure(error) });
		} finally { working = null; }
	};
	return stop;
}

// Vault readers and keys never enter this dedicated module Worker.
const scope = globalThis as unknown as MediaWorkerScope & { document?: unknown };
if (typeof scope.postMessage === 'function' && typeof scope.document === 'undefined') installMediaWorkerEndpoint(scope);
