// Synthetic fixture transport only: no live inference or usable credentials.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cancelJobs, createJobContext } from "../src/react-app/domain/jobs";
import { ProviderError } from "../src/react-app/domain/pipeline";
import type { FetchTransport, RequestControlOptions, RuntimeKeyGetter } from "../src/react-app/domain/pipeline";
import type { PreparedChunk, RouterSTTSelection, STTRequest } from "../src/react-app/domain/types";

const modelId = "openai/gpt-4o-mini-transcribe";
const chunk: PreparedChunk = { id: "chunk-1", sourceId: "source-1", index: 0, sourceStartMs: 9000, sourceEndMs: 69000, encodingOffsetMs: 50, encodedBytes: 3, mimeType: "audio/mpeg", codec: "mp3", audioRecordId: "audio-1" };
const request = (): STTRequest => ({ chunk: { ...chunk }, audio: new Blob(["abc"], { type: "audio/mpeg" }), modelId, expectedLanguages: ["ko", "en"], runId: "run-1" });
const selection = (input: STTRequest = request()): RouterSTTSelection => ({ version: 1, route: { connectionId: "fixture-router", provider: "openrouter", stage: "stt", modelId: input.modelId, endpointTag: null }, profileId: `openrouter-stt-json:${input.modelId}`, profileVersion: 1, catalogFingerprint: "fixture-catalog-fingerprint", catalogSource: "https://openrouter.ai/api/v1/models?output_modalities=transcription", catalogCheckedAt: "2026-10-03T00:00:00.000Z", policy: { dataCollection: "deny", requireZdr: true }, sourceId: input.chunk.sourceId, chunks: [input.chunk], expectedLanguages: input.expectedLanguages, appliedLanguage: input.expectedLanguages.length === 1 ? input.expectedLanguages[0] : null, responseFormat: "json", rateSnapshot: null, rawPricing: { prompt: "0.00000125", completion: "0.000005" }, billingBasis: "tokens", disclosureVersion: "or-stt-1" });
const response = (body: unknown, status = 200, headers?: HeadersInit) => new Response(JSON.stringify(body), { status, headers });
const provider = async (fetch: FetchTransport, frozen = selection(), getKey: RuntimeKeyGetter = () => "synthetic-not-a-real-key", controls: RequestControlOptions = {}) => {
 const { createOpenRouterSTTProvider } = await import("../src/react-app/providers/openrouter-stt");
 return createOpenRouterSTTProvider({ selection: frozen, getKey, fetch, ...controls });
};
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { resolve, promise }; };
const flush = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
const noDispatch = async (input: STTRequest, frozen = selection(input), code = "invalid-input") => {
 let keys = 0, posts = 0;
 const adapter = await provider(async () => { posts++; return response({ text: "Unexpected" }); }, frozen, () => { keys++; return "synthetic-not-a-real-key"; });
 await expect(adapter.transcribe(input, createJobContext())).rejects.toMatchObject({ code });
 expect(keys).toBe(0); expect(posts).toBe(0);
};

afterEach(() => { cancelJobs(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("OpenRouter bounded STT transport", () => {
 it("sends_one_json_chunk_with_managed_policy", async () => {
  let posts = 0; let sent: RequestInit | undefined;
  const adapter = await provider(async (url, init) => {
   sent = init; posts++;
   expect(String(url)).toBe("https://openrouter.ai/api/v1/audio/transcriptions");
   expect(init).toMatchObject({ method: "POST", redirect: "error", credentials: "omit" });
   expect(new Headers(init?.headers).get("Content-Type")).toBe("application/json");
   const body = JSON.parse(String(init?.body));
   expect(body).toEqual({ model: modelId, input_audio: { data: "YWJj", format: "mp3" }, response_format: "json", provider: { data_collection: "deny", zdr: true } });
   expect(body.input_audio.data.startsWith("data:")).toBe(false);
   return response({ text: "Synthetic speech" });
  });
  const raw = await adapter.transcribe(request(), createJobContext());
  expect(posts).toBe(1);
  expect(raw.segments).toEqual([{ id: `${raw.id}:chunk`, text: "Synthetic speech", sourceStartMs: 9000, sourceEndMs: 69000, rawIds: [raw.id] }]);
  expect(raw).toMatchObject({ chunkId: chunk.id, runId: "run-1", timing: "chunk", speakerScope: "none" });
  expect(sent?.cache).toBe("no-store");
 });

 it("rejects_bytes_body_and_format_before_credentials", async () => {
  let keys = 0, posts = 0;
  const adapter = await provider(async () => { posts++; return response({ text: "Unexpected" }); }, selection(), () => { keys++; return "synthetic-not-a-real-key"; });
  const bad = { ...request(), chunk: { ...chunk, encodedBytes: 2 } };
  await expect(adapter.transcribe(bad, createJobContext())).rejects.toMatchObject({ code: "invalid-input" });
  const wrongFormat = { ...request(), chunk: { ...chunk, mimeType: "audio/flac", codec: "flac" }, audio: new Blob(["abc"], { type: "audio/flac" }) };
  await expect(adapter.transcribe(wrongFormat, createJobContext())).rejects.toMatchObject({ code: "invalid-input" });
  expect(keys).toBe(0); expect(posts).toBe(0);
 });

 it("keeps_mixed_languages_auto_and_unknown_fields_unknown", async () => {
  const returned = { text: "Synthetic mixed speech", usage: { input_tokens: 83, output_tokens: 30 } };
  const adapter = await provider(async (_url, init) => {
   const body = JSON.parse(String(init?.body));
   expect(body.language).toBeUndefined(); expect(body.prompt).toBeUndefined(); expect(body.timestamp_granularities).toBeUndefined();
   expect(body.provider).toEqual({ data_collection: "deny", zdr: true });
   return response(returned);
  });
  const raw = await adapter.transcribe(request(), createJobContext());
  expect(raw.response).toEqual(returned);
  expect(raw.execution).toMatchObject({ expectedLanguages: ["ko", "en"], returnedModel: null, actualProvider: null, usage: { inputTokens: 83, outputTokens: 30, audioInputTokens: null, textInputTokens: null, audioOutputTokens: null, textOutputTokens: null, durationSeconds: null, cost: null, costKind: "unavailable", currency: null } });
  expect(raw.responseMetadata).toEqual({ generationId: null, returnedModel: null, actualProvider: null });
 });

 it("reports_usd_and_never_retries_or_falls_back", async () => {
  let posts = 0;
  const adapter = await provider(async () => { posts++; return response({ text: "Synthetic speech", usage: { cost: 0.01 } }); });
  const raw = await adapter.transcribe(request(), createJobContext());
  expect(raw.execution?.usage).toMatchObject({ cost: 0.01, costKind: "reported", currency: "USD" });
  expect(posts).toBe(1);
  const failed = await provider(async (_url, init) => { posts++; expect(JSON.parse(String(init?.body)).provider).toEqual({ data_collection: "deny", zdr: true }); return response({ error: { message: "Private fixture text" } }, 503); });
  await expect(failed.transcribe(request(), createJobContext())).rejects.toMatchObject({ code: "provider-unavailable" });
  expect(posts).toBe(2);
 });

 it("accepts the exact raw ceiling and rejects ceiling plus one before key access", async () => {
  const audio = new Blob([new Uint8Array(16_000_000)], { type: "audio/mpeg" });
  const input = { ...request(), audio, chunk: { ...chunk, encodedBytes: audio.size } };
  let posts = 0;
  const adapter = await provider(async (_url, init) => {
   posts++;
   const bytes = new TextEncoder().encode(String(init?.body)).byteLength;
   expect(bytes).toBeLessThanOrEqual(24_000_000);
   const body = JSON.parse(String(init?.body));
   expect(body.input_audio.data.length).toBe(4 * Math.ceil(audio.size / 3));
   expect(atob(body.input_audio.data).length).toBe(audio.size);
   return response({ text: "" });
  }, selection(input));
  expect((await adapter.transcribe(input, createJobContext())).segments).toEqual([]);
  expect(posts).toBe(1);
  const oversized = new Blob([new Uint8Array(16_000_001)], { type: "audio/mpeg" });
  const bad = { ...input, audio: oversized, chunk: { ...input.chunk, encodedBytes: oversized.size } };
  await noDispatch(bad, selection(bad), "too-large");
 });

 it("measures the serialized UTF-8 body against the reviewed profile ceiling", async () => {
  const catalog = await import("../src/react-app/providers/stt-catalog");
  const reviewed = catalog.lookupRouterSTTProfile(`openrouter-stt-json:${modelId}`, modelId)!;
  const expectedBody = { model: modelId, input_audio: { data: "YWJj", format: "mp3" }, response_format: "json", provider: { data_collection: "deny", zdr: true } };
  const bytes = new TextEncoder().encode(JSON.stringify(expectedBody)).byteLength;
  // A narrower confirmed profile fixture makes the otherwise unreachable JSON
  // boundary observable without allocating beyond the 16 MB audio ceiling.
  vi.spyOn(catalog, "lookupRouterSTTProfile").mockReturnValue({ ...reviewed, maxBodyBytes: bytes });
  const adapter = await provider(async () => response({ text: "" }));
  expect((await adapter.transcribe(request(), createJobContext())).text).toBe("");
  vi.spyOn(catalog, "lookupRouterSTTProfile").mockReturnValue({ ...reviewed, maxBodyBytes: bytes - 1 });
  await noDispatch(request(), selection(), "too-large");
 });

 it.each([
  { encodedBytes: 2 }, { encodedBytes: 0 }, { mimeType: "audio/wav", codec: "pcm" }, { codec: "aac" },
  { sourceStartMs: -1 }, { sourceEndMs: 9000 }, { sourceEndMs: 9000.5 }, { encodingOffsetMs: -1 },
  { encodingOffsetMs: 0.5 }, { encodingOffsetMs: 60000 }, { index: -1 }, { id: "" }, { sourceId: "" }, { audioRecordId: "" },
 ])("rejects invalid bytes, format or source mapping %j before credentials", async change => {
  const input = { ...request(), chunk: { ...chunk, ...change } };
  await noDispatch(input);
 });

 it.each([
  { version: 2 }, { profileVersion: 2 }, { profileId: "unreviewed-profile" }, { responseFormat: "verbose_json" },
  { policy: { dataCollection: "allow", requireZdr: true } }, { policy: { dataCollection: "deny", requireZdr: null } },
  { disclosureVersion: "unacknowledged" }, { catalogFingerprint: "" }, { catalogSource: "" }, { catalogCheckedAt: "invalid" },
  { sourceId: "other-source" }, { chunks: [] }, { appliedLanguage: "ko" }, { expectedLanguages: ["en"] },
 ])("rejects unbound selection %j before credentials", async change => {
  await noDispatch(request(), { ...selection(), ...change } as RouterSTTSelection);
 });

 it.each([
  { provider: "openai" }, { stage: "minutes" }, { endpointTag: "PinnedFixtureProvider" }, { modelId: "openrouter/auto" },
  { modelId: "openai/whisper-large-v3" }, { connectionId: "" },
 ])("rejects changed or unmanaged route %j before credentials", async change => {
  const selected = selection();
  await noDispatch(request(), { ...selected, route: { ...selected.route, ...change } } as RouterSTTSelection);
 });

 it("freezes selections and request metadata before asynchronous encoding", async () => {
  const input = request(); const selected = selection(input); const original = structuredClone(selected);
  const encoded = deferred<ArrayBuffer>();
  vi.spyOn(input.audio, "arrayBuffer").mockReturnValue(encoded.promise);
  const adapter = await provider(async (_url, init) => {
   expect(JSON.parse(String(init?.body)).provider).toEqual({ data_collection: "deny", zdr: true });
   return response({ text: "Fixture" });
  }, selected);
  const result = adapter.transcribe(input, createJobContext());
  Object.assign(selected.policy, { requireZdr: false }); Object.assign(selected.route, { modelId: "changed/model" });
  Object.assign(input.chunk, { sourceEndMs: 900000 });
  encoded.resolve(new Uint8Array([97, 98, 99]).buffer);
  const raw = await result;
  expect(raw.execution?.requestedModel).toBe(original.route.modelId);
  expect(raw.segments[0].sourceEndMs).toBe(original.chunks[0].sourceEndMs);
 });

 it.each(["sw", "ka", "az", "id"])("sends a reviewed single ISO hint %s", async language => {
  const input = { ...request(), expectedLanguages: [language] };
  const adapter = await provider(async (_url, init) => { expect(JSON.parse(String(init?.body)).language).toBe(language); return response({ text: "Fixture" }); }, selection(input));
  expect((await adapter.transcribe(input, createJobContext())).execution?.expectedLanguages).toEqual([language]);
 });

 it.each(["eng", "ko-KR", "zz", "bh"])("preserves unsupported expectation %s without sending it as a hint", async language => {
  const input = { ...request(), expectedLanguages: [language] }; const frozen = { ...selection(input), appliedLanguage: null };
  const adapter = await provider(async (_url, init) => { expect(JSON.parse(String(init?.body)).language).toBeUndefined(); return response({ text: "Fixture" }); }, frozen);
  expect((await adapter.transcribe(input, createJobContext())).execution?.expectedLanguages).toEqual([language]);
 });

 it.each(["openai/gpt-4o-mini-transcribe", "openai/whisper-large-v3"])("supports PCM WAV for reviewed exact model %s", async id => {
  const input = { ...request(), modelId: id, audio: new Blob(["abc"], { type: "audio/wav" }), chunk: { ...chunk, mimeType: "audio/wav", codec: "pcm" } };
  const adapter = await provider(async (_url, init) => { expect(JSON.parse(String(init?.body))).toMatchObject({ model: id, input_audio: { format: "wav" } }); return response({ text: "Fixture" }); }, selection(input));
  await adapter.transcribe(input, createJobContext());
 });

 it("honors explicit standard retention without relaxing data collection", async () => {
  const frozen = { ...selection(), policy: { dataCollection: "deny" as const, requireZdr: false } };
  const adapter = await provider(async (_url, init) => { expect(JSON.parse(String(init?.body)).provider).toEqual({ data_collection: "deny", zdr: false }); return response({ text: "Fixture" }); }, frozen);
  await adapter.transcribe(request(), createJobContext());
 });

 it("preserves only actually returned body and header identifiers", async () => {
  const body = { text: "Fixture", model: "returned/model", provider: "ReturnedFixtureProvider", id: "body-generation", usage: { seconds: 60, cost: 0 } };
  const adapter = await provider(async () => response(body, 200, { "X-Generation-Id": "header-generation" }));
  const raw = await adapter.transcribe(request(), createJobContext());
  expect(raw.response).toEqual(body);
  expect(raw.responseMetadata).toEqual({ generationId: "header-generation", returnedModel: "returned/model", actualProvider: "ReturnedFixtureProvider" });
  expect(raw.execution).toMatchObject({ returnedModel: "returned/model", actualProvider: "ReturnedFixtureProvider", usage: { durationSeconds: 60, cost: 0, costKind: "reported", currency: "USD" } });
 });

 it("does not relabel an undocumented JSON id as a generation header", async () => {
  const body = { text: "Fixture", id: "an-unknown-body-record-id" };
  const adapter = await provider(async () => response(body));
  const raw = await adapter.transcribe(request(), createJobContext());
  expect(raw.response).toEqual(body);
  expect(raw.responseMetadata?.generationId).toBeNull();
 });

 it("preserves every binary byte across base64 part boundaries", async () => {
  const bytes = Uint8Array.from({ length: 24_577 }, (_, index) => index % 256);
  const audio = new Blob([bytes], { type: "audio/mpeg" });
  const input = { ...request(), audio, chunk: { ...chunk, encodedBytes: audio.size } };
  const adapter = await provider(async (_url, init) => {
   const binary = atob(JSON.parse(String(init?.body)).input_audio.data);
   expect(Uint8Array.from(binary, char => char.charCodeAt(0))).toEqual(bytes);
   return response({ text: "Fixture" });
  }, selection(input));
  await adapter.transcribe(input, createJobContext());
 });

 it("retains frozen advertised rates separately from unavailable totals", async () => {
  const rateSnapshot = { source: "https://openrouter.ai/api/v1/models", checkedAt: "2026-10-03T00:00:00.000Z", currency: "USD", rates: [{ unit: "input-token" as const, units: 1, price: 0.00000125 }] };
  const adapter = await provider(async () => response({ text: "Fixture", usage: { input_tokens: 100 } }), { ...selection(), rateSnapshot });
  const raw = await adapter.transcribe(request(), createJobContext());
  expect(raw.execution?.usage).toMatchObject({ rateSnapshot, rateSource: rateSnapshot.source, rateCheckedAt: rateSnapshot.checkedAt, cost: null, currency: null });
 });

 it("validates returned segment times before mapping them to source", async () => {
  const body = { text: "Fixture", segments: [{ text: "Fixture", start: 0.1, end: 1.1, speaker: 0 }] };
  const adapter = await provider(async () => response(body));
  const raw = await adapter.transcribe(request(), createJobContext());
  expect(raw.response).toEqual(body); expect(raw.timing).toBe("segment");
  expect(raw.speakerScope).toBe("none");
  expect(raw.segments[0]).toMatchObject({ sourceStartMs: 9050, sourceEndMs: 10050, text: "Fixture" });
 });

 it.each([
  {}, { text: null }, { text: "Fixture", segments: null }, { text: "Fixture", segments: [{ text: "Fixture", start: 3, end: 1 }] },
  { text: "Fixture", segments: [{ text: "Fixture", start: 0, end: 1 }] }, { text: "Fixture", segments: [{ text: "Fixture", start: 60, end: 61 }] },
 ])("rejects malformed text or structured ranges %j", async body => {
  const adapter = await provider(async () => response(body));
  await expect(adapter.transcribe(request(), createJobContext())).rejects.toMatchObject({ code: "malformed" });
 });

 it("accepts valid empty text without inventing speech", async () => {
  const adapter = await provider(async () => response({ text: "" }));
  const raw = await adapter.transcribe(request(), createJobContext());
  expect(raw.text).toBe(""); expect(raw.segments).toEqual([]);
 });

 it.each([[401, "authentication"], [403, "permission"], [402, "payment"], [413, "too-large"], [500, "provider-unavailable"], [503, "provider-unavailable"], [504, "timeout"]])("sanitizes HTTP %s without retry", async (status, code) => {
  let posts = 0;
  const adapter = await provider(async () => { posts++; return response({ error: { message: "Private fixture provider detail" } }, Number(status)); });
  const error = await adapter.transcribe(request(), createJobContext()).catch(error => error);
  expect(error).toBeInstanceOf(ProviderError); expect(error).toMatchObject({ code, outcomeUnknown: code === "timeout" });
  expect(error.message).not.toContain("Private fixture"); expect(JSON.stringify(error)).not.toContain("Private fixture"); expect(posts).toBe(1);
 });

 it("classifies body-level errors and preserves private partial responses", async () => {
  const adapter = await provider(async () => response({ error: { code: 402, message: "Private fixture detail" } }));
  await expect(adapter.transcribe(request(), createJobContext())).rejects.toMatchObject({ code: "payment" });
  const incomplete = await provider(async () => response({ text: "Private fixture partial", finish_reason: "length" }));
  const error = await incomplete.transcribe(request(), createJobContext()).catch(error => error);
  expect(error).toMatchObject({ code: "incomplete" }); expect(error.readSensitiveResponse()).toMatchObject({ text: "Private fixture partial" });
  expect(JSON.stringify(error)).not.toContain("Private fixture partial");
 });

 it("classifies malformed JSON and network uncertainty with no extra POST", async () => {
  let posts = 0;
  const malformed = await provider(async () => { posts++; return new Response("private invalid JSON"); });
  await expect(malformed.transcribe(request(), createJobContext())).rejects.toMatchObject({ code: "malformed", outcomeUnknown: true });
  const network = await provider(async () => { posts++; throw new Error("Private fixture detail"); });
  const error = await network.transcribe(request(), createJobContext()).catch(error => error);
  expect(error).toMatchObject({ code: "network", outcomeUnknown: true }); expect(error.message).not.toContain("Private fixture"); expect(posts).toBe(2);
 });

 it("rejects a second paid request before key lookup while transport is active", async () => {
  const remote = deferred<Response>(), entered = deferred<void>(); let keys = 0, posts = 0;
  const adapter = await provider(async () => { posts++; entered.resolve(); return remote.promise; }, selection(), () => { keys++; return "synthetic-not-a-real-key"; });
  const pending = adapter.transcribe(request(), createJobContext()); await entered.promise;
  await expect(adapter.transcribe(request(), createJobContext())).rejects.toMatchObject({ code: "busy" });
  expect(keys).toBe(1); expect(posts).toBe(1); remote.resolve(response({ text: "Fixture" })); await pending;
 });

 it("blocks late encoding and credential results after lock", async () => {
  const encoded = deferred<ArrayBuffer>(); const input = request(); vi.spyOn(input.audio, "arrayBuffer").mockReturnValue(encoded.promise);
  let keys = 0, posts = 0;
  const adapter = await provider(async () => { posts++; return response({ text: "Fixture" }); }, selection(input), () => { keys++; return "synthetic-not-a-real-key"; });
  const pending = adapter.transcribe(input, createJobContext()); const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  cancelJobs(); encoded.resolve(new Uint8Array([97, 98, 99]).buffer); await rejected;
  expect(keys).toBe(0); expect(posts).toBe(0);
  const key = deferred<string>(), entered = deferred<void>();
  const late = await provider(async () => { posts++; return response({ text: "Fixture" }); }, selection(), () => { entered.resolve(); return key.promise; });
  const latePending = late.transcribe(request(), createJobContext()); const lateRejected = expect(latePending).rejects.toMatchObject({ name: "AbortError" });
  await entered.promise; cancelJobs(); key.resolve("synthetic-not-a-real-key"); await lateRejected; await flush(); expect(posts).toBe(0);
 });

 it("aborts transport on lock and rejects late provider responses", async () => {
  const remote = deferred<Response>(), entered = deferred<void>(); let signal: AbortSignal | undefined; let keys = 0;
  const adapter = await provider(async (_url, init) => { signal = init?.signal ?? undefined; entered.resolve(); return remote.promise; }, selection(), () => { keys++; return "synthetic-not-a-real-key"; });
  const pending = adapter.transcribe(request(), createJobContext()); const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  await entered.promise; cancelJobs(); await rejected; expect(signal?.aborted).toBe(true);
  await expect(adapter.transcribe(request(), createJobContext())).rejects.toMatchObject({ code: "busy" }); expect(keys).toBe(1);
  remote.resolve(response({ text: "Private late fixture" })); await flush();
  const next = await provider(async () => response({ text: "New fixture" }));
  expect((await next.transcribe(request(), createJobContext())).text).toBe("New fixture");
 });

 it("rejects response-body completion after the job epoch changes", async () => {
  const text = deferred<string>(), reading = deferred<void>();
  const returned = response({ text: "Unused fixture" });
  vi.spyOn(returned, "text").mockImplementation(() => { reading.resolve(); return text.promise; });
  const adapter = await provider(async () => returned);
  const pending = adapter.transcribe(request(), createJobContext());
  const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  await reading.promise; cancelJobs(); await rejected;
  text.resolve(JSON.stringify({ text: "Private late body fixture" })); await flush();
 });

 it("times out once and holds the gate until ignored-abort transport settles", async () => {
  vi.useFakeTimers(); const remote = deferred<Response>(), entered = deferred<void>(); let signal: AbortSignal | undefined, posts = 0;
  const adapter = await provider(async (_url, init) => { posts++; signal = init?.signal ?? undefined; entered.resolve(); return remote.promise; }, selection(), undefined, { timeoutMs: 25, now: () => 1000 });
  const pending = adapter.transcribe(request(), createJobContext()); const rejected = expect(pending).rejects.toMatchObject({ code: "timeout", outcomeUnknown: true });
  await entered.promise; await vi.advanceTimersByTimeAsync(25); await rejected;
  expect(signal?.aborted).toBe(true); expect(posts).toBe(1);
  await expect(adapter.transcribe(request(), createJobContext())).rejects.toMatchObject({ code: "busy" });
  remote.resolve(response({ text: "Private late fixture" })); await flush();
 });

 it("cannot dispatch after a timeout while waiting for credentials", async () => {
  vi.useFakeTimers(); const key = deferred<string>(), entered = deferred<void>(); let posts = 0;
  const adapter = await provider(async () => { posts++; return response({ text: "Fixture" }); }, selection(), () => { entered.resolve(); return key.promise; }, { timeoutMs: 25, now: () => 1000 });
  const pending = adapter.transcribe(request(), createJobContext()); const rejected = expect(pending).rejects.toMatchObject({ code: "timeout", outcomeUnknown: false });
  await entered.promise; await vi.advanceTimersByTimeAsync(25); await rejected;
  key.resolve("synthetic-not-a-real-key"); await flush(); expect(posts).toBe(0);
 });

 it("uses injected time for cooldown and never relaxes policy after 429", async () => {
  let now = 1000, posts = 0, keys = 0;
  const adapter = await provider(async (_url, init) => {
   posts++; expect(JSON.parse(String(init?.body)).provider).toEqual({ data_collection: "deny", zdr: true });
   return posts === 1 ? response({ error: { message: "Fixture limit" } }, 429, { "Retry-After": "2" }) : response({ text: "Fixture" });
  }, selection(), () => { keys++; return "synthetic-not-a-real-key"; }, { now: () => now });
  await expect(adapter.transcribe(request(), createJobContext())).rejects.toMatchObject({ code: "rate-limit", retryAt: 3000 });
  now = 2999; await expect(adapter.transcribe(request(), createJobContext())).rejects.toMatchObject({ code: "cooldown", retryAt: 3000 });
  expect(posts).toBe(1); expect(keys).toBe(1);
  now = 3000; await adapter.transcribe(request(), createJobContext()); expect(posts).toBe(2); expect(keys).toBe(2);
 });
});
