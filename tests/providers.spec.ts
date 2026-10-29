// Keyless transport fixtures: fetch is injected; no live inference or credentials.
import { afterEach, describe, expect, it } from "vitest";
import { cancelJobs, createJobContext } from "../src/react-app/domain/jobs";
import { ProviderError } from "../src/react-app/domain/pipeline";
import { STT_MODELS, createModelCatalog, parseRouterModels, parseRouterEndpoints } from "../src/react-app/providers/catalog";
import { createOpenAIProvider } from "../src/react-app/providers/openai";
import { createOpenRouterProvider } from "../src/react-app/providers/openrouter";
import type { PreparedChunk, STTRequest, MinutesRequest } from "../src/react-app/domain/types";

const checkedAt = "2026-09-30T18:39:00.000Z";
const chunk: PreparedChunk = { id: "c1", sourceId: "s1", index: 0, sourceStartMs: 9000, sourceEndMs: 69000, encodingOffsetMs: 50, encodedBytes: 3, mimeType: "audio/mpeg", codec: "mp3", audioRecordId: "a1" };
const stt = (modelId = "gpt-transcribe", expectedLanguages: string[] = ["ko", "en"]): STTRequest => ({ chunk, audio: new Blob(["abc"], { type: "audio/mpeg" }), modelId, expectedLanguages, runId: "r1" });
const routerModelData = { id: "author/fixture-model", name: "Fixture only model", context_length: 16000, architecture: { input_modalities: ["text"], output_modalities: ["text"], tokenizer: "FixtureBPE" }, top_provider: { max_completion_tokens: 2048 }, supported_parameters: ["max_tokens"], pricing: { prompt: "0.000001", completion: "0.000002", request: "0" } };
const endpointData = { tag: "FixtureProvider/region", provider_name: "FixtureProvider", context_length: 16000, max_prompt_tokens: 12000, max_completion_tokens: 2048, supported_parameters: ["max_tokens"], pricing: { prompt: "0.000003", completion: "0.000004", request: "0" } };
const model = () => parseRouterModels({ data: [routerModelData] }, checkedAt)[0];
const endpoint = () => parseRouterEndpoints({ data: { endpoints: [endpointData] } }, routerModelData.id, checkedAt)[0];
const minutes: MinutesRequest = { runId: "minutes-r1", transcript: { id: "t1", parentId: null, rawIds: ["raw1"], segments: [{ id: "s1", text: "Only fixture meeting text", sourceStartMs: 0, sourceEndMs: 1000, rawIds: ["raw1"] }], issues: [], missingRanges: [] }, settings: { modelId: routerModelData.id, outputLanguage: "ko", sections: ["summary"], instructions: "" } };
const buildMessages = () => [{ role: "system" as const, content: "Ground in the transcript" }, { role: "user" as const, content: "Only fixture meeting text" }];
const okMinutes = { model: "author/returned-fixture", choices: [{ message: { content: "# Fixture minutes" }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.02 } };
const response = (body: unknown, status = 200, headers?: HeadersInit) => new Response(JSON.stringify(body), { status, headers });
const router = (fetch: typeof globalThis.fetch, extra = {}) => createOpenRouterProvider({ getKey: () => "keyless-fixture-value", fetch, selection: { model: model(), endpoint: endpoint() }, maxOutputTokens: 1000, reasoningReserveTokens: 0, buildMessages, ...extra });

afterEach(() => cancelJobs());

describe("provider catalog", () => {
 it("validates catalog creation Unix seconds without treating them as model release dates", () => {
  const data = [1760000000, 0, undefined, "1760000000", -1, 1.5, Number.MAX_SAFE_INTEGER, 9999999999].map((created, index) => ({ ...routerModelData, id: `author/model-${index}`, created }));
  const parsed = parseRouterModels({ data }, "2026-10-01T00:00:00.000Z");
  expect(parsed.map(entry => entry.createdAt)).toEqual(["2025-10-09T08:53:20.000Z", "1970-01-01T00:00:00.000Z", null, null, null, null, null, null]);
 });
 it("retains unsupported dimensions and conditional billing metadata instead of estimating a complete total", () => {
  const priced = parseRouterEndpoints({ data: { endpoints: [{ ...endpointData, pricing: { ...endpointData.pricing, web_search: "0.01", tiers: [{ limit: 10 }], overrides: [{ prompt: "0.1" }] } }] } }, routerModelData.id, checkedAt)[0];
  expect(priced).toHaveProperty("pricingMetadata.unsupportedDimensions", ["web_search"]);
  expect(priced).toHaveProperty("pricingMetadata.conditionalDimensions", ["overrides", "tiers"]);
  expect(priced).toHaveProperty("pricingMetadata.raw.web_search", "0.01");
  expect(priced).toHaveProperty("pricingMetadata.complete", false);
 });
 it("captures actual checked models, duration/audio rates, JSON and timing differences", () => {
  expect(STT_MODELS.map((m) => m.id)).toContain("gpt-transcribe");
  expect(STT_MODELS.find((m) => m.id === "gpt-4o-transcribe")?.responseFormat).toBe("json");
  expect(STT_MODELS.find((m) => m.id === "whisper-1")?.responseFormat).toBe("verbose_json");
  expect(STT_MODELS.find((m) => m.id === "gpt-4o-transcribe")?.maxOutputTokens).toBe(2000);
  expect(STT_MODELS.find((m) => m.id === "gpt-transcribe")?.rateSnapshot.rates[0].unit).toBe("audio-second");
 });
 it("keeps absent caps and prices null and filters nontext entries", () => {
  const parsed = parseRouterModels({ data: [{ id: "a/b", name: "Unknown", architecture: { input_modalities: ["text"], output_modalities: ["text"] } }, { id: "a/image", architecture: { input_modalities: ["image"], output_modalities: ["image"] } }] }, checkedAt);
  expect(parsed).toHaveLength(1); expect(parsed[0].contextTokens).toBeNull(); expect(parsed[0].pricing).toBeNull();
  expect(Object.isFrozen(parsed[0])).toBe(true);
 });
 it("treats conditional price overrides and malformed prices as unavailable", () => {
  expect(parseRouterModels({ data: [{ ...routerModelData, pricing: { prompt: "0", completion: "0", overrides: [{}] } }] }, checkedAt)[0].pricing).toBeNull();
  expect(parseRouterEndpoints({ data: { endpoints: [{ ...endpointData, pricing: { prompt: "oops", completion: "0" } }] } }, routerModelData.id, checkedAt)[0].pricing).toBeNull();
 });
 it("uses a public metadata request and rejects foreign pagination without requesting it", async () => {
  const urls: string[] = []; const catalog = createModelCatalog({ fetch: async (url, init) => { urls.push(String(url)); expect(init?.headers).toBeUndefined(); return response({ data: [routerModelData], links: { next: "https://foreign.invalid/models" } }); } });
  await expect(catalog.loadModels()).rejects.toMatchObject({ code: "catalog" }); expect(urls).toEqual(["https://openrouter.ai/api/v1/models"]);
 });
 it("caches only public metadata in memory and gets endpoint auth at runtime", async () => {
  let calls = 0; let keyCalls = 0; const catalog = createModelCatalog({ fetch: async (_url, init) => { calls++; if (calls === 1) { expect(init?.headers).toBeUndefined(); return response({ data: [routerModelData] }); } expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer keyless-fixture-value"); return response({ data: { endpoints: [endpointData] } }); } });
  await catalog.loadModels(); await catalog.loadModels(); expect(calls).toBe(1);
  await catalog.loadEndpoints(routerModelData.id, () => { keyCalls++; return "keyless-fixture-value"; }, createJobContext()); expect(keyCalls).toBe(1);
 });
});

describe("OpenAI direct multipart", () => {
 it.each(["ko-KR", "eng", "KO", "zz", "bh"])("rejects unsupported GPT-Transcribe hint %s before key/dispatch without narrowing it", async language => {
  let keys = 0; let calls = 0;
  const provider = createOpenAIProvider({ getKey: () => { keys++; return "keyless-fixture-value"; }, fetch: async () => { calls++; return response({ text: "must not dispatch" }); } });
  await expect(provider.transcribe(stt("gpt-transcribe", ["ko", language]), createJobContext())).rejects.toMatchObject({ code: "invalid-input", capability: "iso-639-1-language-hints" });
  expect(keys).toBe(0); expect(calls).toBe(0);
 });
 it("supports valid ISO639-1 hints beyond sample languages and preserves detected languages separately", async () => {
  const languages = ["id", "sw", "ka", "az"];
  const body = { text: "Fixture multilingual speech", languages: ["sw"] };
  const provider = createOpenAIProvider({ getKey: () => "keyless-fixture-value", fetch: async (_url, init) => { const form = init?.body as FormData; expect(form.getAll("languages[]")).toEqual(languages); expect(form.has("language")).toBe(false); return response(body); } });
  const raw = await provider.transcribe(stt("gpt-transcribe", languages), createJobContext());
  expect(raw.execution?.expectedLanguages).toEqual(languages); expect(raw.response).toEqual(body);
 });
 it("preserves the separate older-model language-hint contract", async () => {
  const provider = createOpenAIProvider({ getKey: () => "keyless-fixture-value", fetch: async (_url, init) => { const form = init?.body as FormData; expect(form.get("language")).toBe("eng"); expect(form.has("languages[]")).toBe(false); return response({ text: "Fixture speech" }); } });
  expect((await provider.transcribe(stt("whisper-1", ["eng"]), createJobContext())).execution?.expectedLanguages).toEqual(["eng"]);
 });
 it("sends exact gpt-transcribe language array, neutral file and browser multipart boundary", async () => {
  let calls = 0; let sent: RequestInit | undefined; const provider = createOpenAIProvider({ getKey: () => "keyless-fixture-value", fetch: async (url, init) => {
   sent = init;
   calls++; expect(String(url)).toBe("https://api.openai.com/v1/audio/transcriptions"); expect(init?.method).toBe("POST"); expect(init?.redirect).toBe("error");
   const headers = new Headers(init?.headers); expect(headers.get("Authorization")).toBe("Bearer keyless-fixture-value"); expect(headers.has("Content-Type")).toBe(false);
   const form = init?.body as FormData; expect(form.get("model")).toBe("gpt-transcribe"); expect(form.getAll("languages[]")).toEqual(["ko", "en"]); expect(form.has("language")).toBe(false); expect(form.get("response_format")).toBe("json"); expect((form.get("file") as File).name).toBe("chunk.mp3");
   return response({ text: "Fixture speech", languages: [], usage: { type: "duration", seconds: 60 } });
  } }); const raw = await provider.transcribe(stt(), createJobContext()); expect(sent?.cache).toBe("no-store");
  expect(calls).toBe(1); expect(raw.timing).toBe("chunk"); expect(raw.segments[0].sourceStartMs).toBe(9000); expect(raw.execution?.expectedLanguages).toEqual(["ko", "en"]); expect(raw.execution?.returnedModel).toBeNull(); expect(raw.execution?.usage.costKind).toBe("estimated"); expect(raw.execution?.usage.cost).toBeCloseTo(0.0045);
 });
 it("sends multiple old-model languages as prompt context without singular language narrowing", async () => {
  const provider = createOpenAIProvider({ getKey: () => "keyless-fixture-value", fetch: async (_url, init) => { const form = init?.body as FormData; expect(form.has("language")).toBe(false); expect(form.has("languages[]")).toBe(false); expect(String(form.get("prompt"))).toContain("ko, en"); expect(form.has("timestamp_granularities[]")).toBe(false); return response({ text: "Fixture speech" }); } });
  await provider.transcribe(stt("gpt-4o-transcribe"), createJobContext());
 });
 it("normalizes relative Whisper timing once and preserves the original response", async () => {
  const body = { text: "Fixture speech", segments: [{ start: 0.1, end: 1.1, text: "Fixture speech" }] };
  const provider = createOpenAIProvider({ getKey: () => "keyless-fixture-value", fetch: async (_url, init) => { const form = init?.body as FormData; expect(form.get("response_format")).toBe("verbose_json"); expect(form.getAll("timestamp_granularities[]")).toEqual(["segment"]); expect(form.get("language")).toBe("ko"); return response(body); } });
  const raw = await provider.transcribe(stt("whisper-1", ["ko"]), createJobContext()); expect(raw.segments[0].sourceStartMs).toBe(9050); expect(raw.segments[0].sourceEndMs).toBe(10050); expect(raw.response).toEqual(body); expect(raw.timing).toBe("segment");
 });
 it("uses diarized_json/auto without unsupported language or prompt fields", async () => {
  const provider = createOpenAIProvider({ getKey: () => "keyless-fixture-value", fetch: async (_url, init) => { const form = init?.body as FormData; expect(form.get("response_format")).toBe("diarized_json"); expect(form.get("chunking_strategy")).toBe("auto"); expect(form.has("prompt")).toBe(false); expect(form.has("language")).toBe(false); return response({ text: "Fixture", segments: [{ id: "0", text: "Fixture", start: 0.05, end: 1, speaker: "A", type: "transcript.text.segment" }] }); } });
  expect((await provider.transcribe(stt("gpt-4o-transcribe-diarize"), createJobContext())).speakerScope).toBe("chunk");
 });
 it.each(["unknown-model", "flac"]) ("rejects unsupported model/format before acquiring a key: %s", async (which) => {
  let keyCalls = 0; const provider = createOpenAIProvider({ getKey: () => { keyCalls++; return "keyless-fixture-value"; }, fetch: async () => { throw new Error("must not dispatch"); } });
  const request = which === "flac" ? { ...stt(), chunk: { ...chunk, mimeType: "audio/flac", codec: "flac" }, audio: new Blob(["abc"], { type: "audio/flac" }) } : stt(which);
  await expect(provider.transcribe(request, createJobContext())).rejects.toBeInstanceOf(ProviderError); expect(keyCalls).toBe(0);
 });
 it("checks measured Blob bytes against metadata and conservative 25MB intersection", async () => {
  let calls = 0; const provider = createOpenAIProvider({ getKey: () => "keyless-fixture-value", fetch: async () => { calls++; return response({ text: "bad" }); } });
  await expect(provider.transcribe({ ...stt(), chunk: { ...chunk, encodedBytes: 2 } }, createJobContext())).rejects.toMatchObject({ code: "invalid-input" });
  const audio = new Blob([new Uint8Array(24_900_001)], { type: "audio/mpeg" }); await expect(provider.transcribe({ ...stt(), audio, chunk: { ...chunk, encodedBytes: audio.size } }, createJobContext())).rejects.toMatchObject({ code: "too-large" }); expect(calls).toBe(0);
 });
 it("does not infer mixed text/audio token billing from aggregate usage", async () => {
  const provider = createOpenAIProvider({ getKey: () => "keyless-fixture-value", fetch: async () => response({ text: "Fixture", usage: { type: "tokens", input_tokens: 100, output_tokens: 10, input_token_details: { audio_tokens: 90, text_tokens: 10 } } }) });
  const usage = (await provider.transcribe(stt("gpt-4o-transcribe"), createJobContext())).execution?.usage; expect(usage?.inputTokens).toBe(100); expect(usage?.audioInputTokens).toBe(90); expect(usage?.cost).toBeNull(); expect(usage?.costKind).toBe("unavailable");
 });
 it.each([{}, { text: 42 }, { text: "x", segments: [{ start: 5, end: 1, text: "x" }] }, { error: { code: 401, message: "private fixture text" } }])("rejects malformed/error bodies without leaking upstream details", async (body) => {
  const provider = createOpenAIProvider({ getKey: () => "keyless-fixture-value", fetch: async () => response(body) }); const failure = await provider.transcribe(stt("whisper-1"), createJobContext()).catch((error: ProviderError) => error); expect(failure).toBeInstanceOf(ProviderError); expect(JSON.stringify(failure)).not.toContain("private fixture text");
 });
 it.each([[401, "authentication"], [403, "permission"], [413, "too-large"], [500, "provider-unavailable"], [503, "provider-unavailable"]])("classifies HTTP %s and makes exactly one call", async (status, code) => {
  let calls = 0; const provider = createOpenAIProvider({ getKey: () => "keyless-fixture-value", fetch: async () => { calls++; return response({ error: { message: "private fixture text" } }, status as number); } }); await expect(provider.transcribe(stt(), createJobContext())).rejects.toMatchObject({ code }); expect(calls).toBe(1);
 });
 it("keeps read-only authentication distinct from inference and handles denial", async () => {
  const provider = createOpenAIProvider({ getKey: () => "keyless-fixture-value", fetch: async (url) => { expect(String(url)).toBe("https://api.openai.com/v1/models"); return response({ data: [] }); } }); expect(await provider.checkConnection(createJobContext())).toMatchObject({ authenticated: true, inferenceVerified: false });
  const denied = createOpenAIProvider({ getKey: () => "keyless-fixture-value", fetch: async () => response({}, 401) }); await expect(denied.checkConnection(createJobContext())).rejects.toMatchObject({ code: "authentication" });
 });
});

describe("OpenRouter pinned minutes", () => {
 it("sends explicit model, max_tokens and exact selected endpoint with fallbacks disabled", async () => {
  let sent: RequestInit | undefined; const provider = router(async (url, init) => { sent = init; expect(String(url)).toBe("https://openrouter.ai/api/v1/chat/completions"); expect(init?.redirect).toBe("error"); const body = JSON.parse(String(init?.body)); expect(body).toEqual({ model: routerModelData.id, messages: buildMessages(), max_tokens: 1000, stream: false, provider: { only: [endpointData.tag], order: [endpointData.tag], allow_fallbacks: false, require_parameters: true } }); expect(new Headers(init?.headers).has("X-OpenRouter-Metadata")).toBe(false); return response(okMinutes); });
  const run = await provider.completeMinutes(minutes, createJobContext()); expect(sent?.cache).toBe("no-store"); expect(run.requestedModel).toBe(routerModelData.id); expect(run.returnedModel).toBe("author/returned-fixture"); expect(run.actualProvider).toBeNull(); expect(run.usage.costKind).toBe("reported"); expect(run.usage.cost).toBe(0.02); expect(run.usage.currency).toBe("credits"); expect(run.usage.rateSnapshot?.rates[0].price).toBe(0.000003); expect((run as unknown as {response:unknown}).response).toEqual(okMinutes); expect((run as unknown as {requestedEndpoint:string}).requestedEndpoint).toBe(endpointData.tag);
 });
 it("exposes generate contract with completeMinutes transport", async () => { expect((await router(async () => response(okMinutes)).generate(minutes, createJobContext())).generatedMarkdown).toBe("# Fixture minutes"); });
 it("uses returned actual provider evidence without equating requested tag to actual provider", async () => { const run = await router(async () => response({ ...okMinutes, provider: "ActualFixtureProvider", usage: { prompt_tokens: 10, completion_tokens: 5 } })).generate(minutes, createJobContext()); expect(run.actualProvider).toBe("ActualFixtureProvider"); expect(run.usage.costKind).toBe("estimated"); expect(run.usage.cost).toBeCloseTo(0.00005); });
 it("leaves missing usage and conditional prices unavailable", async () => { const run = await router(async () => response({ choices: okMinutes.choices }), { selection: { model: model(), endpoint: { ...endpoint(), pricing: null } } }).generate(minutes, createJobContext()); expect(run.usage.inputTokens).toBeNull(); expect(run.usage.cost).toBeNull(); expect(run.returnedModel).toBeNull(); });
 it.each(["length", "content_filter", "error", "tool_calls", "unknown", null])("rejects incomplete terminal reason %s while retaining sensitive partial privately", async (finish_reason) => { const error = await router(async () => response({ choices: [{ message: { content: "Private fixture partial" }, finish_reason }] })).generate(minutes, createJobContext()).catch((value: ProviderError) => value); expect(error).toBeInstanceOf(ProviderError); expect((error as ProviderError).code).toBe("incomplete"); expect((error as ProviderError).readSensitiveResponse()).toBeDefined(); expect(JSON.stringify(error)).not.toContain("Private fixture partial"); });
 it.each([{ error: { code: 429, message: "private fixture" } }, { choices: [{ error: { code: 403 }, message: { content: "x" }, finish_reason: "stop" }] }, { choices: [] }, { choices: [{ message: { content: "" }, finish_reason: "stop" }] }])("rejects malformed/200 error responses", async (body) => { await expect(router(async () => response(body)).generate(minutes, createJobContext())).rejects.toBeInstanceOf(ProviderError); });
 it("fails closed on unknown limits or model mismatch before key access", async () => {
  let keys = 0; const provider = router(async () => { throw new Error("must not dispatch"); }, { getKey: () => { keys++; return "keyless-fixture-value"; }, selection: { model: { ...model(), contextTokens: null }, endpoint: endpoint() } }); await expect(provider.generate(minutes, createJobContext())).rejects.toMatchObject({ code: "context" }); expect(keys).toBe(0);
  await expect(router(async () => response(okMinutes)).generate({ ...minutes, settings: { ...minutes.settings, modelId: "another/model" } }, createJobContext())).rejects.toMatchObject({ code: "invalid-input" });
 });
 it("reserves the full completion ceiling with multilingual conservative UTF8 estimate and never truncates", async () => {
  let calls = 0; const provider = router(async () => { calls++; return response(okMinutes); }, { buildMessages: () => [{ role: "user", content: "한".repeat(5000) }] }); await expect(provider.generate(minutes, createJobContext())).rejects.toMatchObject({ code: "context" }); expect(calls).toBe(0);
 });
 it("freezes model/endpoint rates against mutations after construction", async () => {
  const selected = { model: model(), endpoint: endpoint() }; const provider = router(async () => response({ ...okMinutes, usage: { prompt_tokens: 10, completion_tokens: 5 } }), { selection: selected });
  selected.endpoint = { ...endpoint(), pricing: { prompt: 1, completion: 1, request: 0 } }; expect((await provider.generate(minutes, createJobContext())).usage.cost).toBeCloseTo(0.00005);
 });
});

describe("malformed optional returned usage details", () => {
 const malformedDetails = ["not-an-object", [{ cached_tokens: 0 }], true, false, 42, null];
 it.each(malformedDetails.map(details => ({ details })))("keeps numeric aggregate usage cost unknown with malformed details (%j)", async ({ details }) => {
  const usage = { prompt_tokens: 10, completion_tokens: 5, prompt_tokens_details: details };
  const body = { ...okMinutes, usage };
  const run = await router(async () => response(body)).completeMinutes(minutes, createJobContext());
  expect(run.response).toEqual(body); expect(Object.isFrozen(run.response)).toBe(true);
  expect(run.usage).toMatchObject({ inputTokens: 10, outputTokens: 5, cost: null, costKind: "unavailable", currency: null });
 });
 it.each(malformedDetails.flatMap(details => [0, 0.02].map(cost => ({ details, cost }))))("retains reported credits despite malformed optional details (%j)", async ({ details, cost }) => {
  const usage = { prompt_tokens: 10, completion_tokens: 5, cost, prompt_tokens_details: details };
  const body = { ...okMinutes, usage };
  const run = await router(async () => response(body)).completeMinutes(minutes, createJobContext());
  expect(run.response).toEqual(body); expect(run.usage).toMatchObject({ inputTokens: 10, outputTokens: 5, cost, costKind: "reported", currency: "credits" });
 });
 it.each([undefined, {}, { cached_tokens: 0 }])("retains legacy estimates for JSON-omitted or valid zero-cache details (%j)", async prompt_tokens_details => {
  const usage = { prompt_tokens: 10, completion_tokens: 5, prompt_tokens_details };
  const body = JSON.parse(JSON.stringify({ ...okMinutes, usage }));
  const run = await router(async () => response(body)).completeMinutes(minutes, createJobContext());
  expect(run.response).toEqual(body); expect(run.usage).toMatchObject({ inputTokens: 10, outputTokens: 5, costKind: "estimated", currency: "USD" }); expect(run.usage.cost).toBeCloseTo(0.00005);
 });
});

describe("additional provider failure and rate boundaries", () => {
 it.each(["cache_read_tokens", "cache_write_tokens", "cached_tokens"])("does not estimate a complete flat cost from unpriced returned %s", async dimension => {
  const usage = { prompt_tokens: 10, completion_tokens: 5, prompt_tokens_details: { [dimension]: 4 }, completion_tokens_details: { reasoning_tokens: 2 } };
  const run = await router(async () => response({ ...okMinutes, usage })).completeMinutes(minutes, createJobContext());
  expect(run.response).toEqual({ ...okMinutes, usage }); expect(run.usage).toMatchObject({ inputTokens: 10, outputTokens: 5, cost: null, costKind: "unavailable", currency: null });
 });
 it("keeps returned credits authoritative with cache/reasoning details retained, including zero cost", async () => {
  const usage = { prompt_tokens: 10, completion_tokens: 5, cost: 0, prompt_tokens_details: { cached_tokens: 8 }, completion_tokens_details: { reasoning_tokens: 2 } };
  const run = await router(async () => response({ ...okMinutes, usage })).completeMinutes(minutes, createJobContext());
  expect(run.response).toEqual({ ...okMinutes, usage }); expect(run.usage).toMatchObject({ cost: 0, costKind: "reported", currency: "credits", inputTokens: 10, outputTokens: 5 });
 });
 it.each([0, null, -1, "4"])("estimates flat returned usage only when supplied cache activity is known zero (%j)", async cached_tokens => {
  const usage = { prompt_tokens: 10, completion_tokens: 5, prompt_tokens_details: { cached_tokens }, completion_tokens_details: { reasoning_tokens: 2 } };
  const run = await router(async () => response({ ...okMinutes, usage })).completeMinutes(minutes, createJobContext());
  expect(run.response).toEqual({ ...okMinutes, usage }); expect(run.usage.costKind).toBe(cached_tokens === 0 ? "estimated" : "unavailable");
  expect(run.usage.currency).toBe(cached_tokens === 0 ? "USD" : null);
 });
 it("uses returned STT duration rather than the local chunk to estimate duration billing", async () => {
  const provider = createOpenAIProvider({ getKey: () => "keyless-fixture-value", fetch: async () => response({ text: "Fixture", usage: { type: "duration", seconds: 12 } }) });
  const usage = (await provider.transcribe(stt(), createJobContext())).execution?.usage;
  expect(usage).toMatchObject({ durationSeconds: 12, inputTokens: null, costKind: "estimated", currency: "USD" }); expect(usage?.cost).toBeCloseTo(0.0009);
  const missing = createOpenAIProvider({ getKey: () => "keyless-fixture-value", fetch: async () => response({ text: "Fixture" }) });
  expect((await missing.transcribe(stt(), createJobContext())).execution?.usage).toMatchObject({ durationSeconds: null, cost: null, costKind: "unavailable" });
 });
 it("does not present unsupported endpoint billing dimensions as a full estimated usage total", async () => {
  const selectedEndpoint = parseRouterEndpoints({ data: { endpoints: [{ ...endpointData, pricing: { ...endpointData.pricing, internal_reasoning: "0.00001" } }] } }, routerModelData.id, checkedAt)[0];
  const run = await router(async () => response({ ...okMinutes, usage: { prompt_tokens: 10, completion_tokens: 5 } }), { selection: { model: model(), endpoint: selectedEndpoint } }).generate(minutes, createJobContext());
  expect(run.usage.costKind).toBe("unavailable"); expect(run.usage.cost).toBeNull();
 });
 it("does not assume missing per-request price is zero", async () => {
  const selectedEndpoint = { ...endpoint(), pricing: { prompt: 0.000003, completion: 0.000004, request: null } };
  const run = await router(async () => response({ ...okMinutes, usage: { prompt_tokens: 10, completion_tokens: 5 } }), { selection: { model: model(), endpoint: selectedEndpoint } }).generate(minutes, createJobContext()); expect(run.usage.cost).toBeNull(); expect(run.usage.costKind).toBe("unavailable");
 });
 it("includes and freezes a known per-request price", async () => {
  const selectedEndpoint = { ...endpoint(), pricing: { prompt: 0.000003, completion: 0.000004, request: 0.01 } };
  const run = await router(async () => response({ ...okMinutes, usage: { prompt_tokens: 10, completion_tokens: 5 } }), { selection: { model: model(), endpoint: selectedEndpoint } }).generate(minutes, createJobContext()); expect(run.usage.cost).toBeCloseTo(0.01005); expect(run.usage.rateSnapshot?.rates.find((rate) => rate.unit === "request")).toEqual({ unit: "request", units: 1, price: 0.01 }); expect(Object.isFrozen(run.usage.rateSnapshot?.rates)).toBe(true);
 });
 it("honors readable HTTP Retry-After and never automatically repeats", async () => {
  let calls = 0; const provider = createOpenAIProvider({ getKey: () => "keyless-fixture-value", now: () => 1000, fetch: async () => { calls++; return response({ error: { code: 429 } }, 429, { "Retry-After": "2" }); } });
  await expect(provider.transcribe(stt(), createJobContext())).rejects.toMatchObject({ code: "rate-limit", retryAt: 3000 }); await expect(provider.transcribe(stt(), createJobContext())).rejects.toMatchObject({ code: "cooldown", retryAt: 3000 }); expect(calls).toBe(1);
 });
 it("classifies choice-level permission error instead of a complete result", async () => {
  await expect(router(async () => response({ choices: [{ error: { code: 403 }, message: { content: "fixture" }, finish_reason: "stop" }] })).generate(minutes, createJobContext())).rejects.toMatchObject({ code: "permission" });
 });
 it("rejects a conflicting native finish reason", async () => {
  await expect(router(async () => response({ choices: [{ message: { content: "fixture" }, finish_reason: "stop", native_finish_reason: "MAX_TOKENS" }] })).generate(minutes, createJobContext())).rejects.toMatchObject({ code: "incomplete" });
 });
 it("keeps STT source mapping immutable while the key getter awaits", async () => {
  const mutableChunk = { ...chunk }; let resolveKey!: (key:string) => void; const provider = createOpenAIProvider({ getKey: () => new Promise((resolve) => { resolveKey = resolve; }), fetch: async () => response({ text: "fixture" }) }); const pending = provider.transcribe({ ...stt(), chunk: mutableChunk }, createJobContext()); mutableChunk.sourceStartMs = 100000; resolveKey("keyless-fixture-value"); expect((await pending).segments[0].sourceStartMs).toBe(9000);
 });
 it("OpenRouter read-only key check verifies auth but never inference", async () => {
  const provider = router(async (url, init) => { expect(String(url)).toBe("https://openrouter.ai/api/v1/key"); expect(init?.method).toBeUndefined(); return response({ data: { limit_remaining: 1 } }); }); expect(await provider.checkConnection(createJobContext())).toMatchObject({ authenticated: true, inferenceVerified: false });
 });
 it("sanitizes connection-check network failures", async () => {
  await expect(createOpenAIProvider({ getKey: () => "keyless-fixture-value", fetch: async () => { throw new TypeError("Private fixture failure"); } }).checkConnection(createJobContext())).rejects.toMatchObject({ code: "network" });
 });
});
it('records legacy STT and notes requests without audio bytes or reflected keys',async()=>{
 const secret='SYNTHETIC_ONLY_KEY';
 const sttProvider=createOpenAIProvider({getKey:()=>secret,fetch:async()=>response({text:'SYNTHETIC_ONLY_KEY speech'})});
 const raw=await sttProvider.transcribe(stt(),createJobContext());
 expect(raw.request).toMatchObject({body:{file:{omitted:'audio bytes',bytes:3,type:'audio/mpeg'},model:'gpt-transcribe'}});
 expect(JSON.stringify(raw)).not.toContain(secret);
 const fail=await createOpenAIProvider({getKey:()=>secret,fetch:async()=>response({error:{message:secret,code:'unsupported_value',param:'model'}},400)}).transcribe(stt(),createJobContext()).catch(e=>e);
 expect(fail.readSensitiveRequest()).toMatchObject({body:{file:{bytes:3}}});expect(fail.readSensitiveResponse()).toMatchObject({error:{message:'[redacted]',code:'unsupported_value',param:'model'}});
 const notes=await router(async()=>response(okMinutes)).generate(minutes,createJobContext());
 expect(notes.request).toMatchObject({method:'POST',body:{messages:buildMessages()}});expect(JSON.stringify(notes.request)).not.toContain('keyless-fixture-value');
});
