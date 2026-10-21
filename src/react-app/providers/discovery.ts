import { ProviderError, asObject, authHeaders, readOnlyJson } from "../domain/pipeline";
import type { FetchTransport, RuntimeKeyGetter } from "../domain/pipeline";
import type { JobContext } from "../domain/types";
import { STT_MODELS, endpointUrl, freezeMetadata, parseRouterEndpoints, parseRouterModels, validModelId } from "./catalog";
import type { RouterEndpoint, RouterModel, STTModel } from "./catalog";
import { canonicalizeRouterModels } from "./model-presentation";

export type DiscoveredSTTModel = Readonly<{
 id: string; name: string; inputModalities: readonly string[]; outputModalities: readonly string[];
 source: string; checkedAt: string; adapterStatus: "unsupported";
 pricing: Readonly<{ status: "unknown"; raw: unknown }>;
}>;
export type DiscoveredOpenAIModel = Readonly<{
 id: string; name: string | null; ownedBy: string | null; createdAt: string | null; source: string; checkedAt: string;
 adapterStatus: "available" | "unsupported"; inferenceVerified: false; sttModel: STTModel | null;
}>;
export type ModelDiscoveryLimits = Readonly<{ maxPages?: number; maxCandidates?: number; maxResponseBytes?: number }>;
export type ModelDiscovery = Readonly<{
 loadOpenRouterMinutes(job: JobContext): Promise<readonly RouterModel[]>;
 loadOpenRouterSTT(job: JobContext): Promise<readonly DiscoveredSTTModel[]>;
 loadOpenRouterEndpoints(modelId: string, job: JobContext): Promise<readonly RouterEndpoint[]>;
 loadOpenAIModels(getKey: RuntimeKeyGetter, job: JobContext): Promise<readonly DiscoveredOpenAIModel[]>;
}>;
export const MODEL_DISCOVERY_LIMITS = Object.freeze({ maxPages: 20, maxCandidates: 10000, maxResponseBytes: 4 * 1024 * 1024 });
const routerModelsUrl = "https://openrouter.ai/api/v1/models";
const routerSTTUrl = `${routerModelsUrl}?output_modalities=transcription`;
const openAIModelsUrl = "https://api.openai.com/v1/models";

function catalogError(): never { throw new ProviderError("catalog"); }
function snapshotTime(now: () => number): string {
 const value = now(); if (!Number.isFinite(value) || Math.abs(value) > 8_640_000_000_000_000) return catalogError();
 return new Date(value).toISOString();
}
function metadataString(value: unknown): string | null { return typeof value === "string" && value.trim() && !/[\r\n]/u.test(value) ? value : null; }
// Public catalog aliases may begin with ~; that does not establish manual route eligibility.
function routerCatalogId(value: unknown): value is string {
 return typeof value === "string" && value.length <= 256 && /^~?[a-zA-Z0-9._-]+\/[a-zA-Z0-9._:-]+$/u.test(value) && !value.replace(/^~/u, "").split("/").some(part => part === "." || part === "..");
}
function routerId(value: unknown): value is string { return routerCatalogId(value) && validModelId(value); }
function modalities(value: unknown): readonly string[] {
 if (!Array.isArray(value) || value.some(item => typeof item !== "string" || !item.trim())) return catalogError();
 return [...value];
}
function createdAt(value: unknown, checkedAt: string): string | null {
 if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return null;
 const milliseconds = value * 1000;
 return Number.isSafeInteger(milliseconds) && milliseconds <= Date.parse(checkedAt) ? new Date(milliseconds).toISOString() : null;
}
function signature(value: unknown): string {
 return JSON.stringify(value, (_key, entry) => { const object = asObject(entry); return object ? Object.fromEntries(Object.keys(object).sort().map(key => [key, object[key]])) : entry; });
}
function unique<T>(entries: readonly T[], identity: (entry: T) => string): readonly T[] {
 const result = new Map<string, T>();
 for (const entry of entries) {
  const id = identity(entry); const previous = result.get(id);
  if (previous && signature(previous) !== signature(entry)) return catalogError();
  if (!previous) result.set(id, entry);
 }
 return freezeMetadata([...result.values()]);
}
function nextPage(value: unknown, current: string, stt: boolean): string | null {
 if (value == null) return null;
 if (typeof value !== "string" || !value.trim()) return catalogError();
 let next: URL; try { next = new URL(value, current); } catch { return catalogError(); }
 if (next.origin !== "https://openrouter.ai" || next.pathname !== "/api/v1/models" || next.username || next.password || next.hash) return catalogError();
 for (const [key, parameter] of next.searchParams) {
  if (next.searchParams.getAll(key).length !== 1) return catalogError();
  if (key === "output_modalities") { if (parameter !== (stt ? "transcription" : "text")) return catalogError(); }
  else if (!["offset", "limit"].includes(key) || !/^\d+$/u.test(parameter) || !Number.isSafeInteger(Number(parameter)) || (key === "limit" && (Number(parameter) < 1 || Number(parameter) > 1000))) return catalogError();
 }
 if (stt && next.searchParams.get("output_modalities") !== "transcription") return catalogError();
 return next.href;
}
function pageIdentity(url: string): string { const normalized = new URL(url); normalized.searchParams.sort(); return normalized.href; }

// Bound decoded response bytes before the shared JSON parser. This is a local
// catalog limit, not a claim about preventing all browser/network allocations.
async function boundedResponse(response: Response, maxBytes: number, job: JobContext): Promise<Response> {
 const declared = response.headers.get("Content-Length");
 if (declared !== null && /^\d+$/u.test(declared.trim()) && Number(declared) > maxBytes) {
  await response.body?.cancel().catch(() => undefined); return catalogError();
 }
 if (!response.body) return response;
 const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
 const cancel = () => { void reader.cancel().catch(() => undefined); };
 job.signal.addEventListener("abort", cancel, { once: true });
 try {
  while (true) {
   job.assertActive(); const chunk = await reader.read(); job.assertActive();
   if (chunk.done) break;
   if (!(chunk.value instanceof Uint8Array) || chunk.value.byteLength > maxBytes - bytes) { await reader.cancel(); return catalogError(); }
   bytes += chunk.value.byteLength; chunks.push(chunk.value);
  }
 } finally { job.signal.removeEventListener("abort", cancel); reader.releaseLock(); }
 const joined = new Uint8Array(bytes); let offset = 0;
 for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
 return new Response(joined, { status: response.status, statusText: response.statusText, headers: response.headers });
}

export function createModelDiscovery(options: Readonly<{ fetch?: FetchTransport; now?: () => number; limits?: ModelDiscoveryLimits }> = {}): ModelDiscovery {
 const fetch = options.fetch ?? globalThis.fetch.bind(globalThis); const now = options.now ?? Date.now;
 const limits = { ...MODEL_DISCOVERY_LIMITS, ...options.limits };
 for (const key of ["maxPages", "maxCandidates", "maxResponseBytes"] as const) {
  if (!Number.isSafeInteger(limits[key]) || limits[key] <= 0 || limits[key] > MODEL_DISCOVERY_LIMITS[key]) catalogError();
 }
 async function read(url: string, job: JobContext, headers?: Headers): Promise<Record<string, unknown>> {
  const transport: FetchTransport = async (input, init) => {
   job.assertActive(); const response = await fetch(input, { ...init, cache: "no-store" });
   try { job.assertActive(); return await boundedResponse(response, limits.maxResponseBytes, job); }
   catch (error) { if (!response.body?.locked) await response.body?.cancel().catch(() => undefined); throw error; }
  };
  const body = await readOnlyJson(transport, url, { method: "GET", credentials: "omit", redirect: "error", signal: job.signal, ...(headers ? { headers } : {}) }, now, job);
  if (body.links !== undefined && body.links !== null && !asObject(body.links)) return catalogError();
  return body;
 }
 async function pages(stt: boolean, job: JobContext): Promise<readonly unknown[]> {
  job.assertActive(); let url: string | null = stt ? routerSTTUrl : routerModelsUrl;
  const visited = new Set<string>(); const records: unknown[] = []; let total: number | null = null;
  while (url) {
   job.assertActive(); const identity = pageIdentity(url);
   if (visited.has(identity) || visited.size >= limits.maxPages) return catalogError(); visited.add(identity);
   const body = await read(url, job);
   if (!Array.isArray(body.data) || body.data.length > limits.maxCandidates - records.length) return catalogError();
   if (body.total_count !== undefined) {
    if (typeof body.total_count !== "number" || !Number.isSafeInteger(body.total_count) || body.total_count < 0 || body.total_count > limits.maxCandidates || (total !== null && total !== body.total_count)) return catalogError();
    total = body.total_count;
   }
   if (body.data.some(item => !routerCatalogId(asObject(item)?.id))) return catalogError();
   records.push(...body.data);
   url = nextPage(asObject(body.links)?.next, url, stt);
  }
  if (total !== null && total !== records.length) return catalogError();
  job.assertActive(); return records;
 }
 return Object.freeze({
  async loadOpenRouterMinutes(job: JobContext) {
   job.assertActive(); const checkedAt = snapshotTime(now); const records = await pages(false, job); job.assertActive();
   const models = canonicalizeRouterModels(parseRouterModels({ data: records }, checkedAt));
   if (models.some(model => model.catalogConflict?.length)) return catalogError();
   return models;
  },
  async loadOpenRouterSTT(job: JobContext) {
   job.assertActive(); const checkedAt = snapshotTime(now); const records = await pages(true, job); job.assertActive();
   const models: DiscoveredSTTModel[] = records.filter(item => routerId(asObject(item)?.id)).map(item => {
    const record = asObject(item); const architecture = asObject(record?.architecture);
    if (!record || !routerId(record.id) || !architecture) return catalogError();
    const input = modalities(architecture.input_modalities); const output = modalities(architecture.output_modalities);
    if (!input.includes("audio") || !output.includes("transcription")) return catalogError();
    return { id: record.id, name: metadataString(record.name) ?? record.id, inputModalities: input, outputModalities: output, source: routerSTTUrl, checkedAt, adapterStatus: "unsupported", pricing: { status: "unknown", raw: structuredClone(record.pricing ?? null) } };
   });
   return unique(models, model => model.id);
  },
  async loadOpenRouterEndpoints(modelId: string, job: JobContext) {
   job.assertActive(); if (!routerId(modelId)) return catalogError();
   const url = endpointUrl(modelId); const checkedAt = snapshotTime(now); const body = await read(url, job); job.assertActive(); const data = asObject(body.data);
   if (!data || data.id !== modelId || !Array.isArray(data.endpoints) || data.endpoints.length > limits.maxCandidates || asObject(body.links)?.next != null) return catalogError();
   for (const item of data.endpoints) {
    const record = asObject(item);
    if (!record || typeof record.tag !== "string" || !record.tag.trim() || record.tag.trim() !== record.tag || record.tag.length > 256 || /[\r\n]/u.test(record.tag) || (record.model_id !== undefined && record.model_id !== modelId)) return catalogError();
   }
   return unique(parseRouterEndpoints(body, modelId, checkedAt), endpoint => endpoint.tag);
  },
  async loadOpenAIModels(getKey: RuntimeKeyGetter, job: JobContext) {
   job.assertActive(); const checkedAt = snapshotTime(now); const headers = await authHeaders(getKey, job); job.assertActive();
   const body = await read(openAIModelsUrl, job, headers); job.assertActive();
   if (!Array.isArray(body.data) || body.data.length > limits.maxCandidates || (body.has_more !== undefined && body.has_more !== false) || asObject(body.links)?.next != null) return catalogError();
   const models: DiscoveredOpenAIModel[] = body.data.map(item => {
    const record = asObject(item);
    if (!record || typeof record.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u.test(record.id)) return catalogError();
    const sttModel = STT_MODELS.find(model => model.id === record.id) ?? null;
    return { id: record.id, name: metadataString(record.name), ownedBy: metadataString(record.owned_by), createdAt: createdAt(record.created, checkedAt), source: openAIModelsUrl, checkedAt, adapterStatus: sttModel ? "available" : "unsupported", inferenceVerified: false, sttModel };
   });
   return unique(models, model => model.id);
  },
 });
}
