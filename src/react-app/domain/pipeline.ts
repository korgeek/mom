import { snapshotProject, transitionRunState } from "./jobs";
import type { JobContext, MeetingProject, RateSnapshot, RunRecord, STTBatch, STTBatchPurpose, STTProvider, VaultStore } from "./types";
import { getSTTModel } from "../providers/catalog";
import { appendBatchAttempt, checkpointBatchResult, replaceSTTBatch, selectBatchRaw, validateSTTBatch } from "../transcript/batches";

export type ProviderFailureCode = "invalid-input" | "authentication" | "data-policy" | "permission" | "payment" | "too-large" | "rate-limit" | "provider-unavailable" | "malformed" | "incomplete" | "context" | "network" | "timeout" | "busy" | "cooldown" | "storage" | "catalog" | "ambiguous-attempt";
// Upstream messages can contain meeting text. Only generic messages/typed facts are public.
export class ProviderError extends Error {
 readonly code: ProviderFailureCode;
 readonly status: number | null;
 readonly httpStatus: number | null;
 readonly retryAt: number | null;
 readonly outcomeUnknown: boolean;
 #sensitiveResponse: unknown;
 constructor(code: ProviderFailureCode, options: { status?: number; httpStatus?: number | null; retryAt?: number | null; outcomeUnknown?: boolean; sensitiveResponse?: unknown } = {}) {
  super(`Provider operation failed: ${code}`); this.name = "ProviderError"; this.code = code;
  this.status = options.status ?? null; this.retryAt = options.retryAt ?? null; this.outcomeUnknown = options.outcomeUnknown ?? false;
  this.httpStatus = options.httpStatus === undefined ? this.status : options.httpStatus;
  this.#sensitiveResponse = options.sensitiveResponse;
 }
 // Call only from the unlocked owner's encrypted-save path, never UI/logging/export.
 readSensitiveResponse(): unknown { return this.#sensitiveResponse; }
 clearSensitiveResponse(): void { this.#sensitiveResponse = undefined; }
}
export type RuntimeKeyGetter = () => string | null | Promise<string | null>;
export type FetchTransport = typeof globalThis.fetch;
export function asObject(value: unknown): Record<string, unknown> | null { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
export function nonnegativeNumber(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null; }
export function positiveInteger(value: unknown): number | null { return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null; }
export function retryAfter(value: string | null, now: number): number | null {
 if (!value) return null; const seconds = Number(value); if (Number.isFinite(seconds) && seconds >= 0) return now + seconds * 1000;
 const date = Date.parse(value); return Number.isFinite(date) ? Math.max(now, date) : null;
}
function statusCode(status: number): ProviderFailureCode {
 if (status === 401) return "authentication"; if (status === 403) return "permission"; if (status === 402) return "payment";
 if (status === 413) return "too-large"; if (status === 429) return "rate-limit"; if (status === 408 || status === 504) return "timeout";
 if (status >= 500) return "provider-unavailable"; if (status === 400 || status === 422) return "invalid-input"; return "malformed";
}
export function bodyProviderError(value: unknown, status: number, at: number, headers?: Headers): ProviderError {
 const error = asObject(value); const errorStatus = status === 408 || status === 504 ? status : typeof error?.code === "number" ? error.code : status;
 const errorType = asObject(error?.metadata)?.error_type ?? error?.code;
 const timedOut = errorStatus === 408 || errorStatus === 504 || ["timeout", "provider_timeout", "request_timeout"].includes(String(errorType));
 const policyBlocked = errorStatus === 404 && asObject(error?.metadata)?.failed_routing_step === "Filter by Data Policy";
 const code = policyBlocked ? "data-policy" : timedOut ? "timeout" : errorType === "context_length_exceeded" ? "context" : errorType === "insufficient_quota" ? "payment" : statusCode(errorStatus);
 return new ProviderError(code, { status: errorStatus, httpStatus: status, retryAt: retryAfter(headers?.get("Retry-After") ?? null, at), sensitiveResponse: value });
}
export async function readProviderJson(response: Response, now: number): Promise<Record<string, unknown>> {
 let value: unknown; let rawBody: string | undefined;
 try { rawBody = await response.text(); value = JSON.parse(rawBody); }
 catch { throw new ProviderError(response.ok ? "malformed" : statusCode(response.status), { status: response.status, retryAt: retryAfter(response.headers.get("Retry-After"), now), outcomeUnknown: response.ok, sensitiveResponse: rawBody }); }
 const body = asObject(value);
 if (!response.ok || body?.error !== undefined) {
  throw bodyProviderError(body?.error ?? value, response.status, now, response.headers);
 }
 if (!body) throw new ProviderError("malformed", { sensitiveResponse: value }); return body;
}
export async function readOnlyJson(fetch: FetchTransport, url: string, init: RequestInit, now: () => number, job?: JobContext): Promise<Record<string, unknown>> {
 try { job?.assertActive(); const response = await fetch(url, { ...init, cache: "no-store" }); job?.assertActive(); const body = await readProviderJson(response, now()); job?.assertActive(); return body; }
 catch (error) { job?.assertActive(); if (error instanceof ProviderError) throw error; throw new ProviderError("network"); }
}
export async function authHeaders(getKey: RuntimeKeyGetter, job: JobContext): Promise<Headers> {
 job.assertActive(); let key = await getKey(); job.assertActive();
 if (typeof key !== "string" || !key.trim() || /[\r\n]/u.test(key)) throw new ProviderError("authentication");
 const headers = new Headers({ Authorization: `Bearer ${key}` }); key = null; return headers;
}

let activePaidRequest: symbol | null = null;
const cooldowns = new Map<string, number>();
export type RequestControlOptions = Readonly<{ timeoutMs?: number; now?: () => number }>;
// Both direct adapters use this gate. The queue must not nest it around an adapter.
export async function runPaidRequest<T>(provider: string, job: JobContext, operation: (signal: AbortSignal, dispatched: () => void) => Promise<T>, options: RequestControlOptions = {}): Promise<T> {
 job.assertActive(); const now = options.now ?? Date.now; const retryAt = cooldowns.get(provider);
 if (retryAt !== undefined && retryAt > now()) throw new ProviderError("cooldown", { retryAt });
 if (activePaidRequest) throw new ProviderError("busy");
 const timeoutMs = options.timeoutMs ?? 120000;
 if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new ProviderError("invalid-input");
 const token = Symbol(); activePaidRequest = token; const controller = new AbortController(); let dispatched = false;
 let timer: ReturnType<typeof setTimeout> | undefined; let cancel!: () => void;
 const cancelled = new Promise<never>((_resolve, reject) => { cancel = () => { controller.abort(); reject(new DOMException("Job no longer active", "AbortError")); }; job.signal.addEventListener("abort", cancel, { once: true }); });
 const timeout = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new ProviderError("timeout", { outcomeUnknown: dispatched })); }, timeoutMs); });
 // Keep the gate until transport settles, even when a fixture/transport ignores abort.
 const remote = (async () => { job.assertActive(); return operation(controller.signal, () => { job.assertActive(); dispatched = true; }); })();
 const tracked = remote.finally(() => { if (activePaidRequest === token) activePaidRequest = null; });
 try { const value = await Promise.race([tracked, timeout, cancelled]); job.assertActive(); return value; }
 catch (error) {
  job.assertActive();
  if (error instanceof ProviderError) {
   if (error.retryAt !== null) cooldowns.set(provider, error.retryAt);
   // A timeout response after dispatch cannot prove remote work/charges stopped.
   // Read-only and pre-dispatch errors never pass through this upgrade.
   if (dispatched && error.code === "timeout" && !error.outcomeUnknown) throw new ProviderError(error.code, { status: error.status ?? undefined, httpStatus: error.httpStatus, retryAt: error.retryAt, outcomeUnknown: true, sensitiveResponse: error.readSensitiveResponse() });
   throw error;
  }
  throw new ProviderError("network", { outcomeUnknown: dispatched });
 } finally { if (timer !== undefined) clearTimeout(timer); job.signal.removeEventListener("abort", cancel); }
}

export type TranscriptionQueueOptions = Readonly<{
 project: MeetingProject; chunkIds: readonly string[]; modelId: string; languages: readonly string[];
 provider: STTProvider; vault: VaultStore; job: JobContext; rateSnapshot?: RateSnapshot | null;
 acknowledgeUnknownOutcome?: boolean; makeId?: () => string;
 purpose?: STTBatchPurpose; batch?: STTBatch; acknowledgeAdditionalCharge?: boolean;
 onProject?: (project: MeetingProject) => void; onPending?: (project: MeetingProject) => void; onState?: (run: RunRecord) => void;
}>;
export type TranscriptionQueueResult = Readonly<{ project: MeetingProject; pendingProject: MeetingProject | null; failure: ProviderError | null }>;
let activeTranscriptionQueue: symbol | null = null;
export async function runTranscriptionQueue(options: TranscriptionQueueOptions): Promise<TranscriptionQueueResult> {
 options.job.assertActive();
 // Admission covers every whole-project write, before any local audio read or
 // durable intent. The adapter gate alone cannot prevent stale queue snapshots.
 if (activeTranscriptionQueue) throw new ProviderError("busy");
 const token = Symbol(); activeTranscriptionQueue = token;
 try { return await executeTranscriptionQueue(options); }
 finally { if (activeTranscriptionQueue === token) activeTranscriptionQueue = null; }
}
async function executeTranscriptionQueue(options: TranscriptionQueueOptions): Promise<TranscriptionQueueResult> {
 const { job, vault, provider } = options; job.assertActive(); let project = snapshotProject(options.project);
 const selectedIds = [...new Set(options.chunkIds)]; const languages = Object.freeze([...options.languages]); const modelId = options.modelId;
 const rateSnapshot = structuredClone(options.rateSnapshot === undefined ? options.batch?.modelSnapshot ? options.batch.modelSnapshot.catalogEvidence?.pricing.snapshot ?? null : options.batch?.routerSelection ? options.batch.routerSelection.rateSnapshot : getSTTModel(modelId).rateSnapshot : options.rateSnapshot);
 const purpose = options.purpose ?? "initial"; let batch = options.batch ? structuredClone(options.batch) : null;
 if (!["initial", "retry-failed", "rerun-successful", "transcribe-selected"].includes(purpose) || (purpose !== "initial" && (!batch || options.acknowledgeAdditionalCharge !== true))) throw new ProviderError("invalid-input");
 if (batch) {
  try { validateSTTBatch(project, batch); } catch { throw new ProviderError("invalid-input"); }
  if (batch.routerSelection && JSON.stringify(rateSnapshot) !== JSON.stringify(batch.routerSelection.rateSnapshot)) throw new ProviderError("invalid-input");
  const stored = project.sttBatches?.find(item => item.id === batch!.id);
  if ((stored && JSON.stringify(stored) !== JSON.stringify(batch)) || batch.modelId !== modelId || JSON.stringify(batch.languages) !== JSON.stringify(languages) || selectedIds.some(id => !batch!.chunkIds.includes(id)) || (purpose !== "retry-failed" && (purpose !== batch.purpose || selectedIds.length !== batch.chunkIds.length))) throw new ProviderError("invalid-input");
 }
 if (!modelId.trim() || selectedIds.some((id) => !project.preparedChunks.some((chunk) => chunk.id === id))) throw new ProviderError("invalid-input");
 if (!options.acknowledgeUnknownOutcome && project.runs.some((run) => run.state === "requesting" || run.state === "outcome-unknown")) throw new ProviderError("ambiguous-attempt");
 const savedChunk = (id: string) => project.rawTranscripts.some(raw => raw.chunkId === id && project.runs.some(run => run.id === raw.runId && run.state === "saved"));
 if (purpose === "rerun-successful" && selectedIds.some(id => !savedChunk(id))) throw new ProviderError("invalid-input");
 if (purpose === "retry-failed" && selectedIds.some(id => { const latest = [...project.runs].reverse().find(run => (batch!.attemptRunIds.length === 0 || batch!.attemptRunIds.includes(run.id)) && run.intent?.kind === "stt" && run.intent.chunkId === id); return !latest || !["failed", "cancelled", "outcome-unknown"].includes(latest.state); })) throw new ProviderError("invalid-input");
 const selected = selectedIds.map((id) => project.preparedChunks.find((chunk) => chunk.id === id)!).filter(chunk => purpose !== "initial" || !savedChunk(chunk.id)).sort((a, b) => a.index - b.index);
 for (const chunk of selected) {
  job.assertActive();
  if (batch) { try { validateSTTBatch(project, batch); } catch { throw new ProviderError("invalid-input"); } }
  let audio: Blob;
  try { audio = await vault.readAudio(chunk.audioRecordId, job); job.assertActive(); }
  catch { job.assertActive(); return { project, pendingProject: null, failure: new ProviderError("storage") }; }
  job.assertActive(); const runId = (options.makeId ?? (() => crypto.randomUUID()))();
  if (!runId || project.runs.some(run => run.id === runId)) throw new ProviderError("invalid-input");
  let run: RunRecord = { id: runId, projectId: project.id, state: "queued", checkpoint: null, intent: { kind: "stt", chunkId: chunk.id, requestedModel: modelId, expectedLanguages: languages, rateSnapshot, requestedEndpoint: batch?.modelSnapshot?.endpointUrl ?? null, ...(batch ? { sttBatchId: batch.id, sttPurpose: purpose, ...(batch.modelSnapshot ? { modelSnapshot: batch.modelSnapshot } : {}) } : {}) } };
  run = transitionRunState(run, "requesting"); let next = snapshotProject({ ...project, runs: [...project.runs, run] });
  if (batch) { batch = appendBatchAttempt(batch, runId); next = replaceSTTBatch(next, batch); }
  try {
   // Null runId checkpoints intent without promoting an unfinished request to saved.
   const intent = await vault.checkpoint({ project: next, runId: null, audioRecords: [] }, job); job.assertActive();
   if (intent.checkpoint.projectId !== project.id || intent.checkpoint.runId !== null || intent.project.runs.find((r) => r.id === runId)?.state !== "requesting") throw new ProviderError("storage");
   project = snapshotProject(intent.project); options.onProject?.(project); options.onState?.(run);
  } catch { job.assertActive(); return { project, pendingProject: null, failure: new ProviderError("storage") }; }
  let raw;
  try { raw = await provider.transcribe({ chunk, audio, modelId, expectedLanguages: languages, runId, transcriptionHints: batch ? batch.transcriptionHints : project.audioOptions.transcriptionHints }, job); job.assertActive(); }
  catch (error) {
   job.assertActive(); const failure = error instanceof ProviderError ? error : new ProviderError("network", { outcomeUnknown: true });
   run = transitionRunState(run, failure.outcomeUnknown ? "outcome-unknown" : "failed"); next = snapshotProject({ ...project, runs: project.runs.map((r) => r.id === runId ? run : r) });
   try { const committed = await vault.checkpoint({ project: next, runId: null, audioRecords: [] }, job); job.assertActive(); project = snapshotProject(committed.project); options.onProject?.(project); options.onState?.(run); }
   catch { job.assertActive(); return { project, pendingProject: next, failure: new ProviderError("storage") }; }
   return { project, pendingProject: null, failure };
  }
  if (raw.runId !== runId || raw.chunkId !== chunk.id || project.rawTranscripts.some(item => item.id === raw.id)) return { project, pendingProject: null, failure: new ProviderError("malformed") };
  run = transitionRunState(transitionRunState(run, "response-received"), "saving");
  next = snapshotProject({ ...project, rawTranscripts: [...project.rawTranscripts, raw], runs: project.runs.map((r) => r.id === runId ? run : r) });
  if (batch) { batch = selectBatchRaw(next, batch, raw); next = checkpointBatchResult(replaceSTTBatch(next, batch), batch, raw, purpose); }
  job.assertActive(); options.onPending?.(next); options.onState?.(run);
  try {
   const result = await vault.checkpoint({ project: next, runId, audioRecords: [] }, job); job.assertActive();
   const saved = transitionRunState(run, "saved", result.checkpoint);
   const returnedRun = result.project.runs.find((r) => r.id === runId);
   if (returnedRun?.state !== "saved" || returnedRun.checkpoint?.id !== saved.checkpoint?.id || !result.project.rawTranscripts.some((r) => r.id === raw.id && r.runId === runId) || (batch && (
    JSON.stringify(result.project.sttBatches?.find(item => item.id === batch!.id)) !== JSON.stringify(batch) ||
    JSON.stringify(result.project.transcriptVersions) !== JSON.stringify(next.transcriptVersions) ||
    result.project.selectedTranscriptVersionId !== next.selectedTranscriptVersionId
   ))) throw new ProviderError("storage");
   project = snapshotProject(result.project); options.onProject?.(project); options.onState?.(saved);
  } catch { job.assertActive(); return { project, pendingProject: next, failure: new ProviderError("storage") }; }
 }
 return { project, pendingProject: null, failure: null };
}
