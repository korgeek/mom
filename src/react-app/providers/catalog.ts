import { ProviderError, asObject, authHeaders, positiveInteger, readOnlyJson } from "../domain/pipeline";
import type { FetchTransport, RuntimeKeyGetter } from "../domain/pipeline";
import type { JobContext, RateSnapshot } from "../domain/types";

export function freezeMetadata<T>(value: T): T {
 if (value !== null && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value)) freezeMetadata(child); } return value;
}
const checkedAt = "2026-09-30T18:39:00.000Z";
const pricingSource = "https://developers.openai.com/api/docs/pricing";
const formats = [
 { mime: "audio/mpeg", codec: "mp3", extension: "mp3" }, { mime: "audio/mp3", codec: "mp3", extension: "mp3" },
 { mime: "audio/wav", codec: "pcm", extension: "wav" }, { mime: "audio/x-wav", codec: "pcm", extension: "wav" },
 { mime: "audio/mp4", codec: "aac", extension: "m4a" }, { mime: "audio/x-m4a", codec: "aac", extension: "m4a" },
 { mime: "audio/webm", codec: "opus", extension: "webm" },
] as const;
export type STTModel = Readonly<{
 id: string; provider: "openai"; responseFormat: "json" | "verbose_json" | "diarized_json";
 maxBytes: number; formats: readonly Readonly<{ mime: string; codec: string; extension: string }>[];
 timing: "segment" | "chunk"; speakers: "none" | "chunk"; languageHints: "multiple" | "single-and-prompt" | "none";
 contextTokens: number | null; maxOutputTokens: number | null; completenessWarning: string | null;
 rateSnapshot: RateSnapshot; estimatedMinutePrice: number;
 lifecycle?: Readonly<{ shutdownDate: string; source: string; checkedOn: string }> | null;
}>;
function durationRate(price: number): RateSnapshot { return { source: pricingSource, checkedAt, currency: "USD", rates: [{ unit: "audio-second", units: 60, price }] }; }
function audioRate(input: number, output: number): RateSnapshot { return { source: pricingSource, checkedAt, currency: "USD", rates: [{ unit: "audio-input-token", units: 1000000, price: input }, { unit: "audio-output-token", units: 1000000, price: output }] }; }
const limitWarning = "Documented 2,000 output-token limit: complete 10/15-minute transcription is unverified.";
const base = { provider: "openai" as const, maxBytes: 24_900_000, formats };
const aliasShutdown = { shutdownDate: "2027-02-26", source: "https://developers.openai.com/api/docs/deprecations", checkedOn: "2026-10-01" };
export const STT_MODELS: readonly STTModel[] = freezeMetadata(([
 { ...base, id: "gpt-transcribe", responseFormat: "json", timing: "chunk", speakers: "none", languageHints: "multiple", contextTokens: null, maxOutputTokens: null, completenessWarning: "Numeric output limits and long-chunk completeness are unverified.", rateSnapshot: durationRate(0.0045), estimatedMinutePrice: 0.0045 },
 { ...base, id: "gpt-4o-transcribe", responseFormat: "json", timing: "chunk", speakers: "none", languageHints: "single-and-prompt", contextTokens: 16000, maxOutputTokens: 2000, completenessWarning: limitWarning, rateSnapshot: audioRate(2.5, 10), estimatedMinutePrice: 0.006 },
 { ...base, id: "gpt-4o-mini-transcribe", responseFormat: "json", timing: "chunk", speakers: "none", languageHints: "single-and-prompt", contextTokens: 16000, maxOutputTokens: 2000, completenessWarning: limitWarning, rateSnapshot: audioRate(1.25, 5), estimatedMinutePrice: 0.003 },
 { ...base, id: "gpt-4o-mini-transcribe-2025-12-15", responseFormat: "json", timing: "chunk", speakers: "none", languageHints: "single-and-prompt", contextTokens: 16000, maxOutputTokens: 2000, completenessWarning: limitWarning, rateSnapshot: audioRate(1.25, 5), estimatedMinutePrice: 0.003 },
 { ...base, id: "gpt-4o-transcribe-diarize", responseFormat: "diarized_json", timing: "segment", speakers: "chunk", languageHints: "none", contextTokens: 16000, maxOutputTokens: 2000, completenessWarning: limitWarning, rateSnapshot: audioRate(2.5, 10), estimatedMinutePrice: 0.006 },
 { ...base, id: "whisper-1", responseFormat: "verbose_json", timing: "segment", speakers: "none", languageHints: "single-and-prompt", contextTokens: null, maxOutputTokens: null, completenessWarning: null, rateSnapshot: durationRate(0.006), estimatedMinutePrice: 0.006 },
] satisfies STTModel[]).map(model => ({ ...model, lifecycle: ["whisper-1", "gpt-4o-transcribe", "gpt-4o-mini-transcribe", "gpt-4o-transcribe-diarize"].includes(model.id) ? aliasShutdown : null })));
export function getSTTModel(id: string): STTModel { const model = STT_MODELS.find((entry) => entry.id === id); if (!model) throw new ProviderError("invalid-input"); return model; }
export type TextPricing = Readonly<{ prompt: number; completion: number; request: number | null }>;
export type TextPricingMetadata = Readonly<{
 rates: Readonly<{ prompt: number | null; completion: number | null; request: number | null }>;
 complete: boolean; missingDimensions: readonly string[]; unsupportedDimensions: readonly string[]; conditionalDimensions: readonly string[]; raw: unknown;
}>;
/** Retained gateway declarations are not proof of mandatory thinking or supported effort controls. */
export type RouterCapabilityMetadata = Readonly<{
 reasoningBehavior: "unknown"; defaultParameters: Readonly<Record<string, unknown>> | null; expirationDate: string | null;
 raw: Readonly<{ reasoning: unknown; defaultParameters: unknown; expirationDate: unknown }>;
 source: string; checkedAt: string;
}>;
export type RouterModel = Readonly<{
 id: string; canonicalSlug: string | null; name: string; createdAt: string | null; contextTokens: number | null; maxOutputTokens: number | null;
 tokenizer: string | null; supportedParameters: readonly string[]; inputModalities: readonly string[]; outputModalities: readonly string[];
 pricing: TextPricing | null; pricingMetadata: TextPricingMetadata; perRequestLimits: unknown; checkedAt: string; source: string;
 capabilityMetadata?: RouterCapabilityMetadata | null;
 // Conflicting duplicate public entries remain in unlocked metadata rather than being silently selected.
 catalogConflict?: readonly RouterModel[];
}>;
export type RouterEndpoint = Readonly<{
 modelId: string; tag: string; providerName: string | null; contextTokens: number | null; maxPromptTokens: number | null; maxOutputTokens: number | null;
 supportedParameters: readonly string[]; pricing: TextPricing | null; pricingMetadata: TextPricingMetadata; checkedAt: string; source: string;
 capabilityMetadata?: RouterCapabilityMetadata | null;
}>;
export type CompletionParameter = "max_completion_tokens" | "max_tokens";
/** Advertising a ceiling field does not establish visible-output or reasoning behavior. */
export function hasCompletionCeilingParameter(owner: Readonly<{ supportedParameters: readonly string[] }> | null | undefined): boolean {
 return !!owner && ["max_completion_tokens", "max_tokens"].some(parameter => owner.supportedParameters.includes(parameter));
}
/** The model AND exact endpoint must advertise the same field; never translate by assumption. */
export function selectCompletionParameter(model: RouterModel, endpoint: RouterEndpoint): CompletionParameter | null {
 if (model.catalogConflict?.length || endpoint.modelId !== model.id) return null;
 return (["max_completion_tokens", "max_tokens"] as const).find(parameter => model.supportedParameters.includes(parameter) && endpoint.supportedParameters.includes(parameter)) ?? null;
}
function strings(value: unknown): string[] { return Array.isArray(value) && value.every((item) => typeof item === "string") ? [...value] : []; }
function price(value: unknown): number | null { if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return null; const number = Number(value); return Number.isFinite(number) && number >= 0 ? number : null; }
function catalogCreation(value: unknown, at: string): string | null {
 if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return null;
 const milliseconds = value * 1000; const checked = Date.parse(at);
 if (!Number.isSafeInteger(milliseconds) || milliseconds > 8_640_000_000_000_000 || (Number.isFinite(checked) && milliseconds > checked)) return null;
 return new Date(milliseconds).toISOString();
}
function parseCapabilityMetadata(record: Record<string, unknown>, source: string, at: string): RouterCapabilityMetadata {
 const raw = structuredClone({ reasoning: record.reasoning ?? null, defaultParameters: record.default_parameters ?? null, expirationDate: record.expiration_date ?? null });
 const date = raw.expirationDate;
 const expirationDate = typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date ? date : null;
 return { reasoningBehavior: "unknown", defaultParameters: asObject(raw.defaultParameters), expirationDate, raw, source, checkedAt: at };
}
function parsePricingMetadata(value: unknown): TextPricingMetadata {
 const object = asObject(value);
 const dimensions = ["prompt", "completion", "request"] as const;
 const conditionalDimensions = ["overrides", "tiers"].filter((key) => object?.[key] !== undefined && (!Array.isArray(object[key]) || object[key].length > 0));
 const rates = { prompt: price(object?.prompt), completion: price(object?.completion), request: price(object?.request) };
 const missingDimensions = dimensions.filter((key) => rates[key] === null);
 const unsupportedDimensions = Object.keys(object ?? {}).filter((key) => ![...dimensions, "overrides", "tiers"].includes(key)).sort();
 return { rates, complete: !missingDimensions.length && !unsupportedDimensions.length && !conditionalDimensions.length, missingDimensions, unsupportedDimensions, conditionalDimensions, raw: structuredClone(value ?? null) };
}
function parsePricing(metadata: TextPricingMetadata): TextPricing | null {
 const { prompt, completion, request } = metadata.rates;
 if (metadata.conditionalDimensions.length || prompt === null || completion === null) return null;
 return { prompt, completion, request };
}
export function validModelId(id: string): boolean { return /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._:-]+$/u.test(id) && !/(?:^|\/)(?:auto|router)$/u.test(id); }
export function endpointUrl(modelId: string): string { if (!validModelId(modelId)) throw new ProviderError("catalog"); return `https://openrouter.ai/api/v1/models/${modelId.split("/").map(encodeURIComponent).join("/")}/endpoints`; }
export function parseRouterModels(value: unknown, at: string): readonly RouterModel[] {
 const body = asObject(value); if (!Array.isArray(body?.data)) throw new ProviderError("catalog");
 const result: RouterModel[] = [];
 for (const item of body.data) {
  const record = asObject(item); const architecture = asObject(record?.architecture); if (!record || typeof record.id !== "string" || !validModelId(record.id)) continue;
  const input = strings(architecture?.input_modalities); const output = strings(architecture?.output_modalities); if (!input.includes("text") || !output.includes("text")) continue;
  const top = asObject(record.top_provider); const context = positiveInteger(record.context_length); const topContext = positiveInteger(top?.context_length); const pricingMetadata = parsePricingMetadata(record.pricing);
  result.push({ id: record.id, canonicalSlug: typeof record.canonical_slug === "string" ? record.canonical_slug : null, name: typeof record.name === "string" ? record.name : record.id, createdAt: catalogCreation(record.created, at),
   contextTokens: context !== null && topContext !== null ? Math.min(context, topContext) : context, maxOutputTokens: positiveInteger(top?.max_completion_tokens), tokenizer: typeof architecture?.tokenizer === "string" ? architecture.tokenizer : null,
   inputModalities: input, outputModalities: output, supportedParameters: strings(record.supported_parameters), pricing: parsePricing(pricingMetadata), pricingMetadata, perRequestLimits: structuredClone(record.per_request_limits ?? null), capabilityMetadata: parseCapabilityMetadata(record, "https://openrouter.ai/api/v1/models", at), checkedAt: at, source: "https://openrouter.ai/api/v1/models" });
 }
 return freezeMetadata(result);
}
export function parseRouterEndpoints(value: unknown, modelId: string, at: string): readonly RouterEndpoint[] {
 const body = asObject(value); const data = asObject(body?.data); if (!Array.isArray(data?.endpoints)) throw new ProviderError("catalog");
 const result: RouterEndpoint[] = [];
 // Quarantine the exact tag across the complete response before filtering.
 // Otherwise dropping a malformed duplicate could hide conflicting limits.
 const invalidPromptTags = new Set<string>();
 for (const item of data.endpoints) {
  const record = asObject(item);
  if (record && typeof record.tag === "string" && record.max_prompt_tokens != null && positiveInteger(record.max_prompt_tokens) === null) invalidPromptTags.add(record.tag);
 }
 for (const item of data.endpoints) {
  const record = asObject(item); if (!record || typeof record.tag !== "string" || !record.tag.trim() || /[\r\n]/u.test(record.tag)) continue;
  // An absent cap is unknown. A supplied malformed cap must not become an
  // apparently eligible unknown-cap route after numeric normalization.
  if (invalidPromptTags.has(record.tag)) continue;
  const pricingMetadata = parsePricingMetadata(record.pricing);
  result.push({ modelId, tag: record.tag, providerName: typeof record.provider_name === "string" ? record.provider_name : null, contextTokens: positiveInteger(record.context_length), maxPromptTokens: positiveInteger(record.max_prompt_tokens), maxOutputTokens: positiveInteger(record.max_completion_tokens), supportedParameters: strings(record.supported_parameters), pricing: parsePricing(pricingMetadata), pricingMetadata, capabilityMetadata: parseCapabilityMetadata(record, endpointUrl(modelId), at), checkedAt: at, source: endpointUrl(modelId) });
 }
 return freezeMetadata(result);
}
export type ModelCatalog = Readonly<{
 loadModels(refresh?: boolean): Promise<readonly RouterModel[]>;
 loadEndpoints(modelId: string, getKey: RuntimeKeyGetter, job: JobContext): Promise<readonly RouterEndpoint[]>;
 clear(): void;
}>;
export function createModelCatalog(options: { fetch?: FetchTransport; now?: () => number } = {}): ModelCatalog {
 const fetch = options.fetch ?? globalThis.fetch.bind(globalThis); const now = options.now ?? Date.now; let cached: readonly RouterModel[] | null = null;
 return {
  async loadModels(refresh = false) {
   if (cached && !refresh) return cached; const all: RouterModel[] = []; let url: string | null = "https://openrouter.ai/api/v1/models"; const visited = new Set<string>();
   while (url) {
    if (visited.has(url) || visited.size >= 20) throw new ProviderError("catalog"); visited.add(url);
    const body = await readOnlyJson(fetch, url, { redirect: "error", credentials: "omit" }, now); all.push(...parseRouterModels(body, new Date(now()).toISOString()));
    const next = asObject(body.links)?.next; if (next == null) url = null;
    else { if (typeof next !== "string") throw new ProviderError("catalog"); const resolved: URL = new URL(next, url); if (resolved.origin !== "https://openrouter.ai" || resolved.pathname !== "/api/v1/models" || resolved.username || resolved.password || resolved.hash) throw new ProviderError("catalog"); url = resolved.href; }
   }
   cached = freezeMetadata(all); return cached;
  },
  async loadEndpoints(modelId, getKey, job) {
   const url = endpointUrl(modelId); const headers = await authHeaders(getKey, job); const body = await readOnlyJson(fetch, url, { headers, signal: job.signal, redirect: "error", credentials: "omit" }, now, job); return parseRouterEndpoints(body, modelId, new Date(now()).toISOString());
  },
  clear() { cached = null; },
 };
}
