import { requestRecord, redactRecordedValue, recordedFailure } from './request-history';
import type { JobContext, MinutesProvider, MinutesRequest, MinutesRun, MinutesSettings, TranscriptVersion, Usage } from "../domain/types";
import { ProviderError, asObject, authHeaders, bodyProviderError, nonnegativeNumber, positiveInteger, readOnlyJson, readProviderJson, runPaidRequest } from "../domain/pipeline";
import type { FetchTransport, RequestControlOptions, RuntimeKeyGetter } from "../domain/pipeline";
import { freezeMetadata, selectCompletionParameter, validModelId } from "./catalog";
import type { CompletionParameter, RouterEndpoint, RouterModel } from "./catalog";
import type { ConnectionCheck } from "./openai";

export type ChatMessage = Readonly<{ role: "system" | "user" | "assistant"; content: string }>;
export type RouterSelection = Readonly<{ model: RouterModel; endpoint: RouterEndpoint }>;
export type MinutesPreflight = Readonly<{ inputTokenEstimate: number; estimateKind: "conservative-utf8-bytes"; outputTokens: number; reasoningReserveTokens: number; contextTokens: number; completionParameter: CompletionParameter; completionCeilingTokens: number; visibleOutputTokens: null }>;
export type MinutesFit = Readonly<{
 inputTokenEstimate: number; estimateKind: "conservative-utf8-bytes"; outputTokens: number | null; reasoningReserveTokens: number;
 contextTokens: number | null; maxPromptTokens: number | null; maxOutputTokens: number | null;
 derivedInputBudgetTokens: number | null; effectiveInputBudgetTokens: number | null;
 completionParameter: CompletionParameter | null; completionCeilingTokens: number | null; visibleOutputTokens: null;
 status: "fits" | "missing-limits" | "overflow" | "invalid-input"; missingLimits: readonly string[];
}>;
/** Unknown endpoint prompt caps remain unknown. Published context/output and a
 * jointly supported completion ceiling are still required for an exact route. */
export function hasMinutesEndpointLimits(model: RouterModel, endpoint: RouterEndpoint): boolean {
 return [model.contextTokens, endpoint.contextTokens, model.maxOutputTokens, endpoint.maxOutputTokens].every(value => positiveInteger(value) !== null)
  && (endpoint.maxPromptTokens === null || positiveInteger(endpoint.maxPromptTokens) !== null) && selectCompletionParameter(model, endpoint) !== null;
}
export type ProviderMinutesRun = MinutesRun & Readonly<{ response: unknown; requestedEndpoint: string | null }>;
export type OpenRouterProvider = MinutesProvider & Readonly<{ generate(request: MinutesRequest, job: JobContext): Promise<ProviderMinutesRun>; completeMinutes(request: MinutesRequest, job: JobContext): Promise<ProviderMinutesRun>; preflightMinutes(request: MinutesRequest): MinutesPreflight; checkConnection(job: JobContext): Promise<ConnectionCheck> }>;
export type OpenRouterProviderOptions = RequestControlOptions & Readonly<{
 getKey: RuntimeKeyGetter; selection: RouterSelection; buildMessages: (transcript: TranscriptVersion, settings: MinutesSettings) => readonly ChatMessage[];
 // The full provider completion ceiling, including any provider-managed reasoning.
 // No visible-Markdown allocation is guaranteed. Separate reserves are unsupported.
 maxOutputTokens: number; reasoningReserveTokens?: number; fetch?: FetchTransport; makeId?: () => string;
}>;
/** Shared pure fit calculation. No credential access, transport or transcript truncation. */
export function previewMinutesFit(selection: RouterSelection, messages: readonly ChatMessage[], output: number | null, reasoning = 0): MinutesFit {
 const { model, endpoint } = selection;
 const input = messages.reduce((sum, message) => sum + new TextEncoder().encode(message.content).byteLength + 128, 256);
 const context = model.contextTokens !== null && endpoint.contextTokens !== null ? Math.min(model.contextTokens, endpoint.contextTokens) : null;
 const maxOutput = model.maxOutputTokens !== null && endpoint.maxOutputTokens !== null ? Math.min(model.maxOutputTokens, endpoint.maxOutputTokens) : null;
 const completionParameter = selectCompletionParameter(model, endpoint);
 const missingLimits = [
  ...(model.contextTokens === null ? ["model.contextTokens"] : []), ...(endpoint.contextTokens === null ? ["endpoint.contextTokens"] : []),
  ...(model.maxOutputTokens === null ? ["model.maxOutputTokens"] : []), ...(endpoint.maxOutputTokens === null ? ["endpoint.maxOutputTokens"] : []),
  ...(completionParameter === null ? ["shared.completionParameter"] : []), ...(output === null ? ["outputTokens"] : []),
 ];
 const invalid = !validModelId(model.id) || endpoint.modelId !== model.id || !endpoint.tag.trim() || !messages.length || messages.some((message) => !["system", "user", "assistant"].includes(message.role) || typeof message.content !== "string") || (output !== null && !positiveInteger(output)) || reasoning !== 0
  || !Number.isSafeInteger(input) || [model.contextTokens, endpoint.contextTokens, model.maxOutputTokens, endpoint.maxOutputTokens, endpoint.maxPromptTokens].some(value => value !== null && positiveInteger(value) === null);
 const derivedInputBudgetTokens = !invalid && context !== null && output !== null ? Math.max(0, context - output) : null;
 const effectiveInputBudgetTokens = derivedInputBudgetTokens === null ? null : endpoint.maxPromptTokens === null ? derivedInputBudgetTokens : Math.min(endpoint.maxPromptTokens, derivedInputBudgetTokens);
 const overflow = output !== null && ((effectiveInputBudgetTokens !== null && input > effectiveInputBudgetTokens) || (maxOutput !== null && output > maxOutput));
 return freezeMetadata({ inputTokenEstimate: input, estimateKind: "conservative-utf8-bytes", outputTokens: output, reasoningReserveTokens: reasoning, completionParameter, completionCeilingTokens: output, visibleOutputTokens: null, contextTokens: context, maxPromptTokens: endpoint.maxPromptTokens, maxOutputTokens: maxOutput, derivedInputBudgetTokens, effectiveInputBudgetTokens, status: invalid ? "invalid-input" : missingLimits.length ? "missing-limits" : overflow ? "overflow" : "fits", missingLimits });
}
function prepare(request: MinutesRequest, selection: RouterSelection, messages: readonly ChatMessage[], output: number, reasoning: number): MinutesPreflight {
 const { model, endpoint } = selection;
 if (!validModelId(model.id) || request.settings.modelId !== model.id || endpoint.modelId !== model.id || !endpoint.tag.trim() || !request.runId.trim() ||
  !Array.isArray(messages) || !messages.length || messages.some((message) => !["system", "user", "assistant"].includes(message.role) || typeof message.content !== "string") || !positiveInteger(output) || reasoning !== 0) throw new ProviderError("invalid-input");
 // Deliberately conservative for multilingual ordinary byte-based tokenizers:
 // UTF-8 bytes rather than characters/4, plus role/chat framing overhead.
 const fit = previewMinutesFit(selection, messages, output, reasoning);
 if (fit.status !== "fits" || fit.contextTokens === null || fit.completionParameter === null) throw new ProviderError(fit.status === "invalid-input" ? "invalid-input" : "context");
 return { inputTokenEstimate: fit.inputTokenEstimate, estimateKind: fit.estimateKind, outputTokens: output, reasoningReserveTokens: reasoning, contextTokens: fit.contextTokens, completionParameter: fit.completionParameter, completionCeilingTokens: output, visibleOutputTokens: null };
}
function usageFrom(body: Record<string, unknown>, selection: RouterSelection, elapsedMs: number): Usage {
 const usage = asObject(body.usage); const input = nonnegativeNumber(usage?.prompt_tokens); const output = nonnegativeNumber(usage?.completion_tokens); const reported = nonnegativeNumber(usage?.cost); const pricing = selection.endpoint.pricing;
 // Cache hits/writes can change billable input prices. Aggregate prompt tokens
 // plus a flat prompt rate cannot establish a complete returned-usage estimate.
 // Supplied non-object details, including null, cannot establish cache applicability.
 const promptDetails = asObject(usage?.prompt_tokens_details);
 const malformedPromptDetails = !!usage && Object.prototype.hasOwnProperty.call(usage, "prompt_tokens_details") && promptDetails === null;
 const cacheActivity = malformedPromptDetails || [usage, promptDetails].some(details => Object.entries(details ?? {}).some(([key, value]) => /cache/u.test(key) && nonnegativeNumber(value) !== 0));
 const estimated = !cacheActivity && input !== null && output !== null && pricing && pricing.request !== null && selection.endpoint.pricingMetadata.complete ? input * pricing.prompt + output * pricing.completion + pricing.request : null;
 const snapshot = pricing ? freezeMetadata({ source: selection.endpoint.source, checkedAt: selection.endpoint.checkedAt, currency: "USD", rates: [{ unit: "text-input-token" as const, units: 1, price: pricing.prompt }, { unit: "text-output-token" as const, units: 1, price: pricing.completion }, ...(pricing.request === null ? [] : [{ unit: "request" as const, units: 1, price: pricing.request }])] }) : null;
 return freezeMetadata({ inputTokens: input, outputTokens: output, durationSeconds: null, audioInputTokens: null, textInputTokens: input, audioOutputTokens: null, textOutputTokens: output,
  elapsedMs: Math.max(0, elapsedMs), cost: reported ?? estimated, costKind: reported !== null ? "reported" : estimated !== null ? "estimated" : "unavailable", currency: reported !== null ? "credits" : estimated !== null ? "USD" : null,
  rateSource: snapshot?.source ?? null, rateCheckedAt: snapshot?.checkedAt ?? null, rateSnapshot: snapshot });
}
function textLimitError(error: unknown): unknown {
 if (!(error instanceof ProviderError)) return error;
 const envelope = asObject(error.readSensitiveResponse()), body = asObject(envelope?.error) ?? envelope, metadata = asObject(body?.metadata);
 // Classify only recognizable limit errors; provider text stays in the sensitive
 // response and never appears in the UI. Other 400 errors keep their own category.
 const detail = [body?.message, body?.code, metadata?.error_type].filter(value => typeof value === 'string').join(' ').slice(0, 4096);
 const limit = error.code === 'too-large' || error.code === 'invalid-input' && /context[_ -]length|maximum.{0,32}context|prompt.{0,32}(?:too long|limit|tokens)|max[_ -](?:prompt|completion|tokens).{0,32}(?:exceed|limit)/iu.test(detail);
 return limit ? new ProviderError('context', { status: error.status ?? undefined, httpStatus: error.httpStatus, sensitiveResponse: error.readSensitiveResponse(), outcomeUnknown: error.outcomeUnknown }) : error;
}
export function createOpenRouterProvider(options: OpenRouterProviderOptions): OpenRouterProvider {
 // One pinned model/endpoint/rate snapshot for every run through this factory.
 const selection = freezeMetadata(structuredClone(options.selection)); const fetch = options.fetch ?? globalThis.fetch.bind(globalThis); const now = options.now ?? Date.now; const makeId = options.makeId ?? (() => crypto.randomUUID());
 const maxOutput = options.maxOutputTokens; const reasoning = options.reasoningReserveTokens ?? 0;
 const build = (request: MinutesRequest) => freezeMetadata(structuredClone(options.buildMessages(request.transcript, request.settings)));
 async function completeMinutes(request: MinutesRequest, job: JobContext): Promise<ProviderMinutesRun> {
  job.assertActive(); const frozenRequest = freezeMetadata(structuredClone(request)); const messages = build(frozenRequest); const prepared = prepare(frozenRequest, selection, messages, maxOutput, reasoning);
  const body = JSON.stringify({ model: selection.model.id, messages, [prepared.completionParameter]: prepared.completionCeilingTokens, stream: false, provider: { only: [selection.endpoint.tag], order: [selection.endpoint.tag], allow_fallbacks: false, require_parameters: true } });
  let sent:unknown, secret:string|null=null;
  try { return await runPaidRequest("openrouter", job, async (signal, dispatched) => {
   const headers = await authHeaders(options.getKey, job); headers.set("Content-Type", "application/json"); const start = now(); job.assertActive(); secret=headers.get("Authorization")?.slice(7)??null; sent=requestRecord({url:"https://openrouter.ai/api/v1/chat/completions",body},secret); dispatched();
   const response = await fetch("https://openrouter.ai/api/v1/chat/completions", { method: "POST", headers, body, signal, redirect: "error", credentials: "omit", cache: "no-store" }); job.assertActive(); const result = redactRecordedValue(await readProviderJson(response, now(), true),secret) as Record<string,unknown>; job.assertActive();
   const choices = result.choices; const choice = Array.isArray(choices) && choices.length === 1 ? asObject(choices[0]) : null; const message = asObject(choice?.message);
   if (choice?.error !== undefined) throw bodyProviderError(choice.error, 200, now(), response.headers);
   if (!choice || !message || typeof message.content !== "string" || !message.content.trim()) throw new ProviderError("malformed", { sensitiveResponse: result });
   if (choice.finish_reason !== "stop" || (choice.native_finish_reason != null && !["stop", "STOP", "end_turn", "stop_sequence", "eos_token", "completed"].includes(String(choice.native_finish_reason)))) throw new ProviderError("incomplete", { sensitiveResponse: result });
   const actualProvider = typeof result.provider === "string" ? result.provider : null;
   return freezeMetadata({ id: frozenRequest.runId || makeId(), transcriptVersionId: frozenRequest.transcript.id, settings: frozenRequest.settings, generatedMarkdown: message.content, usage: usageFrom(result, selection, now() - start),
    requestedModel: selection.model.id, returnedModel: typeof result.model === "string" ? result.model : null, actualProvider, response: result, request: sent, requestedEndpoint: selection.endpoint.tag });
  }, options); } catch(error) { throw recordedFailure(textLimitError(error),sent,secret); } finally {secret=null;}
 }
 return {
  completeMinutes, generate: completeMinutes,
  preflightMinutes(request) { return prepare(request, selection, build(request), maxOutput, reasoning); },
  async checkConnection(job) {
   const headers = await authHeaders(options.getKey, job); const endpoint = "https://openrouter.ai/api/v1/key";
   const body = await readOnlyJson(fetch, endpoint, { headers, signal: job.signal, redirect: "error", credentials: "omit" }, now, job);
   if (!asObject(body.data)) throw new ProviderError("malformed"); return { authenticated: true, transportVerified: true, inferenceVerified: false, endpoint };
  },
 };
}
