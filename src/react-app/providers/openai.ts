import { requestRecord, redactRecordedValue, recordedFailure } from './request-history';
import { validateTranscriptionHints } from '../domain/stt-settings';
import type { JobContext, RawTranscript, SourceSegment, STTProvider, STTRequest, Usage } from "../domain/types";
import { ProviderError, asObject, authHeaders, nonnegativeNumber, readOnlyJson, readProviderJson, runPaidRequest } from "../domain/pipeline";
import type { FetchTransport, RequestControlOptions, RuntimeKeyGetter } from "../domain/pipeline";
import { freezeMetadata, getSTTModel } from "./catalog";
import type { STTModel } from "./catalog";

export type ConnectionCheck = Readonly<{ authenticated: true; transportVerified: true; inferenceVerified: false; endpoint: string }>;
export type OpenAIProvider = STTProvider & Readonly<{ checkConnection(job: JobContext): Promise<ConnectionCheck> }>;
export type OpenAIProviderOptions = RequestControlOptions & Readonly<{ getKey: RuntimeKeyGetter; fetch?: FetchTransport; makeId?: () => string }>;
/** ISO639-1 transport codes; regional tags/three-letter aliases are never silently normalized.
 * Alpha2 registry: https://www.loc.gov/standards/iso639-2/ISO-639-2_utf-8.txt
 * The historical bh entry has no current alpha2 code in that registry.
 */
const iso6391 = new Set("aa ab ae af ak am an ar as av ay az ba be bg bi bm bn bo br bs ca ce ch co cr cs cu cv cy da de dv dz ee el en eo es et eu fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ht hu hy hz ia id ie ig ii ik io is it iu ja jv ka kg ki kj kk kl km kn ko kr ks ku kv kw ky la lb lg li ln lo lt lu lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn no nr nv ny oc oj om or os pa pi pl ps pt qu rm rn ro ru rw sa sc sd se sg si sk sl sm sn so sq sr ss st su sv sw ta te tg th ti tk tl tn to tr ts tt tw ty ug uk ur uz ve vi vo wa wo xh yi yo za zh zu".split(" "));
export class OpenAICapabilityError extends ProviderError {
 readonly capability = "iso-639-1-language-hints";
 constructor() { super("invalid-input"); this.message = "GPT-Transcribe language hints require ISO 639-1 two-letter codes."; }
}

function validateRequest(request: STTRequest, model: STTModel): string {
 if (model.languageHints === "multiple" && (!Array.isArray(request.expectedLanguages) || request.expectedLanguages.some(language => !iso6391.has(language)))) throw new OpenAICapabilityError();
 const { chunk, audio } = request; const match = model.formats.find((format) => format.mime === chunk.mimeType && format.codec === chunk.codec);
 if (!match || audio.type !== chunk.mimeType || !Number.isSafeInteger(chunk.encodedBytes) || audio.size !== chunk.encodedBytes || audio.size <= 0 || !request.runId.trim() ||
  !Number.isSafeInteger(chunk.sourceStartMs) || !Number.isSafeInteger(chunk.sourceEndMs) || chunk.sourceStartMs < 0 || chunk.sourceEndMs <= chunk.sourceStartMs || !Number.isSafeInteger(chunk.encodingOffsetMs) || chunk.encodingOffsetMs < 0 ||
  !Array.isArray(request.expectedLanguages) || request.expectedLanguages.some((language) => !/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/u.test(language))) throw new ProviderError("invalid-input");
 if (audio.size > model.maxBytes) throw new ProviderError("too-large"); return match.extension;
}
function parseUsage(value: unknown, model: STTModel, elapsedMs: number): Usage {
 const usage = asObject(value); const input = asObject(usage?.input_token_details); const output = asObject(usage?.output_token_details);
 const tokens = usage?.type === "tokens"; const duration = usage?.type === "duration" ? nonnegativeNumber(usage.seconds) : null;
 const audioInput = tokens ? nonnegativeNumber(input?.audio_tokens) : null; const textInput = tokens ? nonnegativeNumber(input?.text_tokens) : null;
 const audioOutput = tokens ? nonnegativeNumber(output?.audio_tokens) : null; const textOutput = tokens ? nonnegativeNumber(output?.text_tokens) : null;
 let cost: number | null = null;
 const durationRate = model.rateSnapshot.rates.find((rate) => rate.unit === "audio-second");
 if (duration !== null && durationRate) cost = duration / durationRate.units * durationRate.price;
 // Aggregate token totals never substitute for a billable modality. Text pricing
 // is not established for these STT models, so mixed/unknown modalities stay null.
 if (cost === null && audioInput !== null && audioOutput !== null && textInput === 0 && textOutput === 0) {
  const inputRate = model.rateSnapshot.rates.find((rate) => rate.unit === "audio-input-token"); const outputRate = model.rateSnapshot.rates.find((rate) => rate.unit === "audio-output-token");
  if (inputRate && outputRate) cost = audioInput / inputRate.units * inputRate.price + audioOutput / outputRate.units * outputRate.price;
 }
 return freezeMetadata({ inputTokens: tokens ? nonnegativeNumber(usage.input_tokens) : null, outputTokens: tokens ? nonnegativeNumber(usage.output_tokens) : null,
  durationSeconds: duration, audioInputTokens: audioInput, textInputTokens: textInput, audioOutputTokens: audioOutput, textOutputTokens: textOutput,
  elapsedMs: Math.max(0, elapsedMs), cost, costKind: cost === null ? "unavailable" : "estimated", currency: cost === null ? null : "USD",
  rateSource: model.rateSnapshot.source, rateCheckedAt: model.rateSnapshot.checkedAt, rateSnapshot: model.rateSnapshot });
}
function normalize(body: Record<string, unknown>, request: STTRequest, model: STTModel, id: string, elapsedMs: number): RawTranscript {
 if (typeof body.text !== "string") throw new ProviderError("malformed", { sensitiveResponse: body });
 const { chunk } = request; const segments: SourceSegment[] = []; let timing: RawTranscript["timing"] = "chunk";
 // Only documented model timing is consumed; raw provider JSON remains untouched.
 if (model.timing === "segment" && body.segments !== undefined) {
  if (!Array.isArray(body.segments)) throw new ProviderError("malformed", { sensitiveResponse: body });
  for (const [index, value] of body.segments.entries()) {
   const segment = asObject(value); const start = nonnegativeNumber(segment?.start); const end = nonnegativeNumber(segment?.end);
   if (!segment || typeof segment.text !== "string" || start === null || end === null || end < start) throw new ProviderError("malformed", { sensitiveResponse: body });
   const sourceStartMs = chunk.sourceStartMs + Math.round(start * 1000) - chunk.encodingOffsetMs;
   const sourceEndMs = chunk.sourceStartMs + Math.round(end * 1000) - chunk.encodingOffsetMs;
   if (sourceEndMs < chunk.sourceStartMs || sourceStartMs > chunk.sourceEndMs) throw new ProviderError("malformed", { sensitiveResponse: body });
   segments.push({ id: `${id}:segment:${index}`, text: segment.text, sourceStartMs: Math.max(chunk.sourceStartMs, sourceStartMs), sourceEndMs: Math.min(chunk.sourceEndMs, sourceEndMs), rawIds: [id] });
  }
  if (segments.length) timing = "segment";
 }
 if (timing === "chunk" && body.text.length) segments.push({ id: `${id}:chunk`, text: body.text, sourceStartMs: chunk.sourceStartMs, sourceEndMs: chunk.sourceEndMs, rawIds: [id] });
 return freezeMetadata({ id, chunkId: chunk.id, runId: request.runId, response: body, text: body.text, segments, timing,
  speakerScope: model.speakers, execution: { requestedModel: model.id, returnedModel: typeof body.model === "string" ? body.model : null, actualProvider: null,
   expectedLanguages: [...request.expectedLanguages], usage: parseUsage(body.usage, model, elapsedMs) } });
}
export function createOpenAIProvider(options: OpenAIProviderOptions): OpenAIProvider {
 const fetch = options.fetch ?? globalThis.fetch.bind(globalThis); const now = options.now ?? Date.now; const makeId = options.makeId ?? (() => crypto.randomUUID());
 return {
  async transcribe(request, job) {
   job.assertActive(); try { validateTranscriptionHints(request.transcriptionHints); } catch { throw new ProviderError('invalid-input'); } const model = getSTTModel(request.modelId); const extension = validateRequest(request, model);
   const languages = [...new Set(request.expectedLanguages)]; const frozenRequest = freezeMetadata({ ...request, chunk: structuredClone(request.chunk), expectedLanguages: languages });
   const form = new FormData(); form.append("file", request.audio, `chunk.${extension}`); form.append("model", model.id); form.append("response_format", model.responseFormat);
   if (model.languageHints === "multiple") { for (const language of languages) form.append("languages[]", language); }
   if (model.languageHints === "single-and-prompt") {
    if (languages.length === 1) form.append("language", languages[0]);
    else if (languages.length > 1) form.append("prompt", `Expected languages: ${languages.join(", ")}. Transcribe every spoken language without translation.`);
   }
   if (model.languageHints === 'single-and-prompt' && request.transcriptionHints) {
    const prompt = [form.get('prompt'), request.transcriptionHints.terms.join(', '), request.transcriptionHints.context].filter(Boolean).join('\n');
    if (prompt) form.set('prompt', prompt);
   }
   if (model.responseFormat === "verbose_json") form.append("timestamp_granularities[]", "segment");
   if (model.responseFormat === "diarized_json" && request.chunk.sourceEndMs - request.chunk.sourceStartMs > 30000) form.append("chunking_strategy", "auto");
   let sent:unknown, secret:string|null=null;
   try { return await runPaidRequest("openai", job, async (signal, dispatched) => {
    const headers = await authHeaders(options.getKey, job); job.assertActive(); secret=headers.get("Authorization")?.slice(7)??null; const start = now(); sent=requestRecord({url:"https://api.openai.com/v1/audio/transcriptions",body:form},secret); dispatched();
    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers, body: form, signal, redirect: "error", credentials: "omit", cache: "no-store" }); job.assertActive();
    const body = await readProviderJson(response, now(), true); job.assertActive(); return {...normalize(redactRecordedValue(body,secret) as Record<string,unknown>, frozenRequest, model, makeId(), now() - start),request:sent};
   }, options); } catch(error) { throw recordedFailure(error,sent,secret); } finally {secret=null;}
  },
  async checkConnection(job) {
   const headers = await authHeaders(options.getKey, job); const endpoint = "https://api.openai.com/v1/models";
   const body = await readOnlyJson(fetch, endpoint, { headers, signal: job.signal, redirect: "error", credentials: "omit" }, now, job);
   if (!Array.isArray(body.data)) throw new ProviderError("malformed"); return { authenticated: true, transportVerified: true, inferenceVerified: false, endpoint };
  },
 };
}
