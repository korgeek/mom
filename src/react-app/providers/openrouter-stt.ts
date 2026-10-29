import { requestRecord, redactRecordedValue, recordedFailure } from './request-history';
import type { JobContext, PreparedChunk, RawTranscript, RouterSTTProfile, RouterSTTSelection, SourceSegment, STTProvider, STTRequest, Usage } from "../domain/types";
import { ProviderError, asObject, authHeaders, nonnegativeNumber, readProviderJson, runPaidRequest } from "../domain/pipeline";
import type { FetchTransport, RuntimeKeyGetter } from "../domain/pipeline";
import { freezeMetadata } from "./catalog";
import { lookupRouterSTTProfile } from "./stt-catalog";

export type OpenRouterSTTProviderOptions = Readonly<{
 selection: RouterSTTSelection; getKey: RuntimeKeyGetter; fetch?: FetchTransport;
 now?: () => number; timeoutMs?: number;
}>;

// ISO 639-1 transport hints. Expectations may contain regional/three-letter
// languages, but those are preserved as expectations rather than sent as hints.
const iso6391 = new Set("aa ab ae af ak am an ar as av ay az ba be bg bi bm bn bo br bs ca ce ch co cr cs cu cv cy da de dv dz ee el en eo es et eu fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ht hu hy hz ia id ie ig ii ik io is it iu ja jv ka kg ki kj kk kl km kn ko kr ks ku kv kw ky la lb lg li ln lo lt lu lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn no nr nv ny oc oj om or os pa pi pl ps pt qu rm rn ro ru rw sa sc sd se sg si sk sl sm sn so sq sr ss st su sv sw ta te tg th ti tk tl tn to tr ts tt tw ty ug uk ur uz ve vi vo wa wo xh yi yo za zh zu".split(" "));
const chunkFields = ["id", "sourceId", "index", "sourceStartMs", "sourceEndMs", "encodingOffsetMs", "encodedBytes", "mimeType", "codec", "audioRecordId"] as const;
const nonempty = (value: unknown): value is string => typeof value === "string" && !!value.trim() && !/[\r\n]/u.test(value);
const validLanguages = (languages: readonly string[]): boolean => Array.isArray(languages) && languages.every(language => typeof language === "string" && /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/u.test(language));

export function resolveRouterSTTLanguageHint(expectedLanguages: readonly string[], profile: RouterSTTProfile): string | null {
 return profile.singleLanguageHint && expectedLanguages.length === 1 && iso6391.has(expectedLanguages[0]) ? expectedLanguages[0] : null;
}

function validChunk(chunk: PreparedChunk, profile: RouterSTTProfile): boolean {
 return !!chunk && nonempty(chunk.id) && nonempty(chunk.sourceId) && nonempty(chunk.audioRecordId)
  && Number.isSafeInteger(chunk.index) && chunk.index >= 0
  && Number.isSafeInteger(chunk.sourceStartMs) && chunk.sourceStartMs >= 0
  && Number.isSafeInteger(chunk.sourceEndMs) && chunk.sourceEndMs > chunk.sourceStartMs
  && Number.isSafeInteger(chunk.encodingOffsetMs) && chunk.encodingOffsetMs >= 0 && chunk.encodingOffsetMs < chunk.sourceEndMs - chunk.sourceStartMs
  && Number.isSafeInteger(chunk.encodedBytes) && chunk.encodedBytes > 0
  && profile.formats.some(format => format.mime === chunk.mimeType && format.codec === chunk.codec);
}

function validate(request: STTRequest, selection: RouterSTTSelection): Readonly<{ profile: RouterSTTProfile; format: "mp3" | "wav" }> {
 const route = selection.route; const profile = lookupRouterSTTProfile(selection.profileId, route?.modelId);
 if (!profile || selection.version !== 1 || selection.profileVersion !== profile.version
  || route.provider !== "openrouter" || route.stage !== "stt" || route.endpointTag !== null || !nonempty(route.connectionId)
  || request.modelId !== profile.modelId || selection.responseFormat !== "json" || selection.disclosureVersion !== "or-stt-1"
  || selection.policy?.dataCollection !== "deny" || typeof selection.policy.requireZdr !== "boolean"
  || !nonempty(selection.catalogFingerprint) || !nonempty(selection.catalogSource)
  || !nonempty(selection.catalogCheckedAt) || !Number.isFinite(Date.parse(selection.catalogCheckedAt))
  || !nonempty(selection.sourceId) || !nonempty(request.runId)
  || !Array.isArray(selection.chunks) || !selection.chunks.length || !validLanguages(selection.expectedLanguages) || !validLanguages(request.expectedLanguages)
  || JSON.stringify(request.expectedLanguages) !== JSON.stringify(selection.expectedLanguages)) throw new ProviderError("invalid-input");
 const hint = resolveRouterSTTLanguageHint(selection.expectedLanguages, profile);
 if (selection.appliedLanguage !== hint || selection.chunks.some(chunk => !validChunk(chunk, profile) || chunk.sourceId !== selection.sourceId)
  || new Set(selection.chunks.map(chunk => chunk.id)).size !== selection.chunks.length
  || !validChunk(request.chunk, profile) || !(request.audio instanceof Blob)
  || request.audio.size !== request.chunk.encodedBytes || request.audio.type !== request.chunk.mimeType) throw new ProviderError("invalid-input");
 const bound = selection.chunks.find(chunk => chunk.id === request.chunk.id);
 if (!bound || chunkFields.some(field => bound[field] !== request.chunk[field])) throw new ProviderError("invalid-input");
 if (request.audio.size > Math.min(profile.maxAudioBytes, 16_000_000)) throw new ProviderError("too-large");
 return { profile, format: request.chunk.codec === "mp3" ? "mp3" : "wav" };
}

async function encodeAudio(audio: Blob, job: JobContext): Promise<string> {
 job.assertActive();
 const bytes = new Uint8Array(await audio.arrayBuffer()); job.assertActive();
 if (bytes.byteLength !== audio.size) throw new ProviderError("invalid-input");
 const encoded: string[] = [];
 // Each part ends on a complete triplet, so concatenation is valid base64.
 // No large argument spread or retained whole-recording PCM allocation.
 for (let offset = 0; offset < bytes.length; offset += 24_576) {
  job.assertActive(); let binary = "";
  const end = Math.min(offset + 24_576, bytes.length);
  for (let index = offset; index < end; index++) binary += String.fromCharCode(bytes[index]);
  encoded.push(btoa(binary));
 }
 return encoded.join("");
}

function parseUsage(value: unknown, selection: RouterSTTSelection, elapsedMs: number): Usage {
 const usage = asObject(value); const cost = nonnegativeNumber(usage?.cost); const rates = selection.rateSnapshot;
 return freezeMetadata({ inputTokens: nonnegativeNumber(usage?.input_tokens), outputTokens: nonnegativeNumber(usage?.output_tokens),
  durationSeconds: nonnegativeNumber(usage?.seconds), audioInputTokens: null, textInputTokens: null, audioOutputTokens: null, textOutputTokens: null,
  elapsedMs: Math.max(0, elapsedMs), cost, costKind: cost === null ? "unavailable" : "reported", currency: cost === null ? null : "USD",
  rateSource: rates?.source ?? null, rateCheckedAt: rates?.checkedAt ?? null, rateSnapshot: rates });
}

function normalize(body: Record<string, unknown>, headers: Headers, request: Omit<STTRequest, "audio">, selection: RouterSTTSelection, elapsedMs: number): RawTranscript {
 if (typeof body.text !== "string") throw new ProviderError("malformed", { sensitiveResponse: body });
 if (body.finish_reason !== undefined && body.finish_reason !== "stop") throw new ProviderError("incomplete", { sensitiveResponse: body });
 const id = crypto.randomUUID(); const chunk = request.chunk; const segments: SourceSegment[] = []; let timing: RawTranscript["timing"] = "chunk";
 if (body.segments !== undefined) {
  if (!Array.isArray(body.segments)) throw new ProviderError("malformed", { sensitiveResponse: body });
  for (const [index, entry] of body.segments.entries()) {
   const segment = asObject(entry); const start = nonnegativeNumber(segment?.start); const end = nonnegativeNumber(segment?.end);
   if (!segment || typeof segment.text !== "string" || start === null || end === null || end < start) throw new ProviderError("malformed", { sensitiveResponse: body });
   const sourceStartMs = chunk.sourceStartMs + Math.round(start * 1000) - chunk.encodingOffsetMs;
   const sourceEndMs = chunk.sourceStartMs + Math.round(end * 1000) - chunk.encodingOffsetMs;
   if (!Number.isSafeInteger(sourceStartMs) || !Number.isSafeInteger(sourceEndMs) || sourceStartMs < chunk.sourceStartMs || sourceEndMs > chunk.sourceEndMs || sourceEndMs < sourceStartMs) throw new ProviderError("malformed", { sensitiveResponse: body });
   segments.push({ id: `${id}:segment:${index}`, text: segment.text, sourceStartMs, sourceEndMs, rawIds: [id] });
  }
  if (segments.length) timing = "segment";
 }
 if (timing === "chunk" && body.text.length) segments.push({ id: `${id}:chunk`, text: body.text, sourceStartMs: chunk.sourceStartMs, sourceEndMs: chunk.sourceEndMs, rawIds: [id] });
 const returnedModel = nonempty(body.model) ? body.model : null; const actualProvider = nonempty(body.provider) ? body.provider : null;
 // The STT guide documents this header; an arbitrary JSON id remains raw.
 const returnedGenerationId = headers.get("X-Generation-Id");
 const generationId = nonempty(returnedGenerationId) ? returnedGenerationId : null;
 return freezeMetadata({ id, chunkId: chunk.id, runId: request.runId, response: body, text: body.text, segments, timing, speakerScope: "none",
  responseMetadata: { generationId, returnedModel, actualProvider },
  execution: { requestedModel: selection.route.modelId, returnedModel, actualProvider, expectedLanguages: request.expectedLanguages, usage: parseUsage(body.usage, selection, elapsedMs) } });
}

export function createOpenRouterSTTProvider(options: OpenRouterSTTProviderOptions): STTProvider {
 const selection = freezeMetadata(structuredClone(options.selection)); const fetch = options.fetch ?? globalThis.fetch.bind(globalThis); const now = options.now ?? Date.now;
 return {
  async transcribe(request, job) {
   job.assertActive(); const { profile, format } = validate(request, selection);
   const frozenRequest = freezeMetadata({ modelId: request.modelId, runId: request.runId, chunk: structuredClone(request.chunk), expectedLanguages: [...request.expectedLanguages] });
   let body: string | null = null; let encoded: string | null = null;
   let sent:unknown, secret:string|null=null;
   try {
    encoded = await encodeAudio(request.audio, job); job.assertActive();
    // Dedicated STT schema: https://openrouter.ai/docs/guides/overview/multimodal/stt
    body = JSON.stringify({ model: selection.route.modelId, input_audio: { data: encoded, format }, response_format: "json",
     ...(selection.appliedLanguage === null ? {} : { language: selection.appliedLanguage }),
     provider: { data_collection: selection.policy.dataCollection, zdr: selection.policy.requireZdr } });
    encoded = null;
    if (new TextEncoder().encode(body).byteLength > Math.min(profile.maxBodyBytes, 24_000_000)) throw new ProviderError("too-large");
    return await runPaidRequest("openrouter", job, async (signal, dispatched) => {
     const active = () => { job.assertActive(); if (signal.aborted) throw new ProviderError("timeout"); };
     active(); const headers = await authHeaders(options.getKey, job); active(); headers.set("Content-Type", "application/json");
     const start = now(); secret=headers.get("Authorization")?.slice(7)??null; sent=requestRecord({url:"https://openrouter.ai/api/v1/audio/transcriptions",body:body!},secret); dispatched();
     const response = await fetch("https://openrouter.ai/api/v1/audio/transcriptions", { method: "POST", headers, body, signal, redirect: "error", credentials: "omit", cache: "no-store" }); active();
     body = null; const parsed = redactRecordedValue(await readProviderJson(response, now(), true),secret) as Record<string,unknown>; active();
     return {...normalize(parsed, response.headers, frozenRequest, selection, now() - start),request:sent};
    }, options);
   } catch (error) {
    job.assertActive(); if (error instanceof ProviderError) throw recordedFailure(error,sent,secret); throw recordedFailure(new ProviderError("network"),sent,secret);
   } finally { body = null; encoded = null; secret=null; }
  },
 };
}
