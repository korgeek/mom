import { describe, expect, it } from "vitest";
import { createJobContext } from "../src/react-app/domain/jobs";
import { STT_MODELS, validModelId } from "../src/react-app/providers/catalog";
import { createModelDiscovery } from "../src/react-app/providers/discovery";

const at = "2026-10-02T00:00:00.000Z";
const minutesModel = { id: "fixture/minutes", name: "Minutes fixture", context_length: 16000, top_provider: { max_completion_tokens: 2048 }, architecture: { input_modalities: ["text"], output_modalities: ["text"] }, supported_parameters: ["max_tokens"], pricing: { prompt: "0.000001", completion: "0.000002", request: "0" } };
const sttModel = { id: "fixture/transcription", name: "Transcription fixture", context_length: 0, top_provider: { max_completion_tokens: 0 }, architecture: { input_modalities: ["audio"], output_modalities: ["transcription"] }, supported_parameters: [], pricing: { prompt: "0.00001", completion: "0" } };
const json = (value: unknown, status = 200, headers: HeadersInit = {}) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json", ...headers } });
const now = () => Date.parse(at);
const endpointModel = { tag: "Fixture/region", model_id: minutesModel.id, provider_name: "Fixture", context_length: 12000, max_completion_tokens: 1000, supported_parameters: ["max_tokens"], pricing: minutesModel.pricing };
const localJob = () => {
 const controller = new AbortController();
 return { controller, job: { signal: controller.signal, epoch: 0, assertActive() { if (controller.signal.aborted) throw new DOMException("Fixture job inactive", "AbortError"); } } };
};

describe("explicit provider model discovery", () => {
 it("loads public minutes metadata only when invoked without keys or credentials", async () => {
  const requests: { url: string; init: RequestInit | undefined }[] = [];
  const discovery = createModelDiscovery({ now, fetch: async (url, init) => { requests.push({ url: String(url), init }); return json({ data: [minutesModel] }); } });
  expect(requests).toEqual([]);
  const models = await discovery.loadOpenRouterMinutes(createJobContext());
  expect(models).toHaveLength(1); expect(models[0]).toMatchObject({ id: minutesModel.id, contextTokens: 16000, checkedAt: at, source: "https://openrouter.ai/api/v1/models", pricingMetadata: { complete: true } });
  expect(requests).toHaveLength(1); expect(requests[0].url).toBe("https://openrouter.ai/api/v1/models");
  expect(requests[0].init).toMatchObject({ method: "GET", credentials: "omit", redirect: "error", cache: "no-store" });
  expect(new Headers(requests[0].init?.headers).has("Authorization")).toBe(false);
  expect(Object.isFrozen(models)).toBe(true); expect(Object.isFrozen(models[0].pricingMetadata.raw)).toBe(true);
 });
 it("retains dedicated STT candidates with zero text caps without claiming an adapter or price units", async () => {
  let requested = "";
  const models = await createModelDiscovery({ now, fetch: async url => { requested = String(url); return json({ data: [sttModel] }); } }).loadOpenRouterSTT(createJobContext());
  expect(requested).toBe("https://openrouter.ai/api/v1/models?output_modalities=transcription");
  expect(models).toEqual([{ id: sttModel.id, name: sttModel.name, inputModalities: ["audio"], outputModalities: ["transcription"], source: requested, checkedAt: at, adapterStatus: "unsupported", pricing: { status: "unknown", raw: sttModel.pricing } }]);
  expect(Object.isFrozen(models[0].pricing.raw)).toBe(true);
 });
 it("maps only exact reviewed OpenAI STT IDs and keeps authenticated listing separate from inference", async () => {
  let getterCalls = 0; let authorization: string | null = null;
  const discovery = createModelDiscovery({ now, fetch: async (url, init) => { expect(String(url)).toBe("https://api.openai.com/v1/models"); authorization = new Headers(init?.headers).get("Authorization"); return json({ data: [{ id: "whisper-1", owned_by: "openai", created: 1700000000, extra: "AUTHENTICATED_RAW_SENTINEL" }, { id: "whisper-future", name: "Unknown fixture" }] }); } });
  const models = await discovery.loadOpenAIModels(() => { getterCalls++; return "KEYLESS_DISCOVERY_FIXTURE"; }, createJobContext());
  expect(getterCalls).toBe(1); expect(authorization).toBe("Bearer KEYLESS_DISCOVERY_FIXTURE");
  expect(models[0]).toMatchObject({ id: "whisper-1", ownedBy: "openai", adapterStatus: "available", inferenceVerified: false, checkedAt: at, sttModel: STT_MODELS.find(model => model.id === "whisper-1") });
  expect(models[0].sttModel?.rateSnapshot.checkedAt).not.toBe(at);
  expect(models[1]).toMatchObject({ id: "whisper-future", name: "Unknown fixture", adapterStatus: "unsupported", sttModel: null, inferenceVerified: false });
  expect(JSON.stringify(models)).not.toContain("KEYLESS_DISCOVERY_FIXTURE"); expect(JSON.stringify(models)).not.toContain("AUTHENTICATED_RAW_SENTINEL");
  expect(Object.isFrozen(models)).toBe(true);
 });
 it("reads exact public endpoint identity and retains unknown limits without authentication", async () => {
  let requested = ""; let sent: RequestInit | undefined;
  const endpoints = await createModelDiscovery({ now, fetch: async (url, init) => { requested = String(url); sent = init; return json({ data: { id: minutesModel.id, endpoints: [{ ...endpointModel, context_length: 0, max_completion_tokens: null, pricing: null }] } }); } }).loadOpenRouterEndpoints(minutesModel.id, createJobContext());
  expect(requested).toBe("https://openrouter.ai/api/v1/models/fixture/minutes/endpoints");
  expect(new Headers(sent?.headers).has("Authorization")).toBe(false); expect(sent).toMatchObject({ method: "GET", redirect: "error", credentials: "omit" });
  expect(endpoints).toHaveLength(1); expect(endpoints[0]).toMatchObject({ modelId: minutesModel.id, tag: endpointModel.tag, contextTokens: null, maxOutputTokens: null, pricing: null, checkedAt: at, source: requested });
  expect(Object.isFrozen(endpoints[0].supportedParameters)).toBe(true);
 });
 it.each([
  { data: { endpoints: [endpointModel] } },
  { data: { id: "fixture/other", endpoints: [endpointModel] } },
  { data: { id: minutesModel.id, endpoints: [{ ...endpointModel, model_id: "fixture/other" }] } },
  { data: { id: minutesModel.id, endpoints: [{ ...endpointModel, tag: "bad\nroute" }] } },
 ])("rejects missing, mismatched or malformed endpoint identity rather than relabelling it", async body => {
  await expect(createModelDiscovery({ now, fetch: async () => json(body) }).loadOpenRouterEndpoints(minutesModel.id, createJobContext())).rejects.toMatchObject({ code: "catalog" });
 });
 it.each(["../models", "fixture/.", "fixture/..", "fixture/auto", "fixture/router", "fixture/model?key=fixture", "https://example.test/model"])("rejects an invalid endpoint request before transport (%s)", async id => {
  let calls = 0;
  await expect(createModelDiscovery({ fetch: async () => { calls++; return json({}); } }).loadOpenRouterEndpoints(id, createJobContext())).rejects.toMatchObject({ code: "catalog" });
  expect(calls).toBe(0);
 });
 it("assembles every bounded page before returning a complete immutable snapshot", async () => {
  const urls: string[] = [];
  const models = await createModelDiscovery({ now, fetch: async url => { urls.push(String(url)); return urls.length === 1 ? json({ data: [minutesModel], links: { next: "/api/v1/models?offset=1&limit=1" } }) : json({ data: [{ ...minutesModel, id: "fixture/second" }], links: { next: null } }); } }).loadOpenRouterMinutes(createJobContext());
  expect(urls).toEqual(["https://openrouter.ai/api/v1/models", "https://openrouter.ai/api/v1/models?offset=1&limit=1"]);
  expect(models.map(model => model.id)).toEqual([minutesModel.id, "fixture/second"]);
  expect(models.every(model => model.checkedAt === at)).toBe(true); expect(Object.isFrozen(models)).toBe(true);
 });
 it.each([
  "https://example.test/api/v1/models?offset=1", "https://user@openrouter.ai/api/v1/models?offset=1", "/api/v1/models/other?offset=1", "/api/v1/models?offset=1#other",
  "/api/v1/models?q=unreviewed", "/api/v1/models?offset=-1", "/api/v1/models?offset=1&offset=2", "/api/v1/models?output_modalities=all", "http://openrouter.ai/api/v1/models?offset=1",
 ])("rejects an unapproved pagination destination/query before a second call (%s)", async next => {
  let calls = 0;
  await expect(createModelDiscovery({ fetch: async () => { calls++; return json({ data: [minutesModel], links: { next } }); } }).loadOpenRouterMinutes(createJobContext())).rejects.toMatchObject({ code: "catalog" });
  expect(calls).toBe(1);
 });
 it("preserves the dedicated STT modality filter on pagination", async () => {
  const urls: string[] = [];
  const models = await createModelDiscovery({ now, fetch: async url => { urls.push(String(url)); return json({ data: [{ ...sttModel, id: `fixture/stt-${urls.length}` }], links: { next: urls.length === 1 ? "?output_modalities=transcription&offset=1" : null } }); } }).loadOpenRouterSTT(createJobContext());
  expect(models).toHaveLength(2); expect(urls.every(url => new URL(url).searchParams.get("output_modalities") === "transcription")).toBe(true);
 });
 it("rejects an STT next page that drops its modality filter", async () => {
  let calls = 0;
  await expect(createModelDiscovery({ fetch: async () => { calls++; return json({ data: [sttModel], links: { next: "?offset=1" } }); } }).loadOpenRouterSTT(createJobContext())).rejects.toMatchObject({ code: "catalog" }); expect(calls).toBe(1);
 });
 it("rejects pagination cycles without returning the first page or retrying", async () => {
  let calls = 0;
  await expect(createModelDiscovery({ fetch: async () => { calls++; return json({ data: [minutesModel], links: { next: "https://openrouter.ai/api/v1/models" } }); } }).loadOpenRouterMinutes(createJobContext())).rejects.toMatchObject({ code: "catalog" }); expect(calls).toBe(1);
 });
 it("recognizes a pagination cycle despite reordered query parameters", async () => {
  let calls = 0;
  await expect(createModelDiscovery({ fetch: async () => { calls++; return json({ data: [minutesModel], links: { next: calls === 1 ? "?offset=1&limit=1" : "?limit=1&offset=1" } }); } }).loadOpenRouterMinutes(createJobContext())).rejects.toMatchObject({ code: "catalog" }); expect(calls).toBe(2);
 });
 it("fails explicitly when another page would exceed the configured page bound", async () => {
  let calls = 0;
  await expect(createModelDiscovery({ limits: { maxPages: 1 }, fetch: async () => { calls++; return json({ data: [minutesModel], links: { next: "?offset=1" } }); } }).loadOpenRouterMinutes(createJobContext())).rejects.toMatchObject({ code: "catalog" }); expect(calls).toBe(1);
 });
 it("counts raw candidates before filtering rather than declaring a truncated catalog complete", async () => {
  await expect(createModelDiscovery({ limits: { maxCandidates: 1 }, fetch: async () => json({ data: [minutesModel, { id: "unknown" }] }) }).loadOpenRouterMinutes(createJobContext())).rejects.toMatchObject({ code: "catalog" });
 });
 it.each([{}, { "Content-Length": "1" }] as Record<string, string>[])("bounds actual response bytes even when length is absent or inaccurate (%j)", async headers => {
  await expect(createModelDiscovery({ limits: { maxResponseBytes: 24 }, fetch: async () => json({ data: [minutesModel] }, 200, headers) }).loadOpenRouterMinutes(createJobContext())).rejects.toMatchObject({ code: "catalog" });
 });
 it("cancels a response stream when its actual byte bound is exceeded", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new TextEncoder().encode("a".repeat(32))); }, cancel() { cancelled = true; } });
  await expect(createModelDiscovery({ limits: { maxResponseBytes: 24 }, fetch: async () => new Response(stream) }).loadOpenRouterMinutes(createJobContext())).rejects.toMatchObject({ code: "catalog" }); expect(cancelled).toBe(true);
 });
 it("rejects a declared over-bound response before reading its body", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  await expect(createModelDiscovery({ limits: { maxResponseBytes: 24 }, fetch: async () => new Response(stream, { headers: { "Content-Length": "25" } }) }).loadOpenRouterMinutes(createJobContext())).rejects.toMatchObject({ code: "catalog" }); expect(cancelled).toBe(true);
 });
 it.each([{ maxPages: 0 }, { maxCandidates: -1 }, { maxResponseBytes: Number.NaN }, { maxPages: 21 }, { maxCandidates: 10001 }])("rejects invalid/unbounded configuration (%j)", limits => {
  expect(() => createModelDiscovery({ limits })).toThrow();
 });
 it("preserves unknown and conditional text pricing without inventing free rates", async () => {
  const models = await createModelDiscovery({ now, fetch: async () => json({ data: [{ ...minutesModel, id: "fixture/unknown", pricing: null }, { ...minutesModel, id: "fixture/conditional", pricing: { ...minutesModel.pricing, tiers: [{ limit: 100 }] } }] }) }).loadOpenRouterMinutes(createJobContext());
  expect(models.map(model => model.pricing)).toEqual([null, null]); expect(models.every(model => model.pricingMetadata.complete === false)).toBe(true);
 });
 it("rejects conflicting duplicate minutes model metadata", async () => {
  await expect(createModelDiscovery({ now, fetch: async () => json({ data: [minutesModel, { ...minutesModel, context_length: 8000 }] }) }).loadOpenRouterMinutes(createJobContext())).rejects.toMatchObject({ code: "catalog" });
 });
 it("collapses identical metadata duplicates only after complete discovery", async () => {
  const models = await createModelDiscovery({ now, fetch: async () => json({ data: [minutesModel, { ...minutesModel }] }) }).loadOpenRouterMinutes(createJobContext()); expect(models).toHaveLength(1);
 });
 it("rejects conflicting duplicate exact endpoint metadata", async () => {
  await expect(createModelDiscovery({ now, fetch: async () => json({ data: { id: minutesModel.id, endpoints: [endpointModel, { ...endpointModel, max_completion_tokens: 500 }] } }) }).loadOpenRouterEndpoints(minutesModel.id, createJobContext())).rejects.toMatchObject({ code: "catalog" });
 });
 it.each([{ cap: 6000, reverse: false }, { cap: 6000, reverse: true }, { cap: null, reverse: false }, { cap: null, reverse: true }])("never discovers an exact tag whose malformed duplicate would hide a conflicting prompt cap ($cap, $reverse)", async ({ cap, reverse }) => {
  const duplicates = [{ ...endpointModel, max_prompt_tokens: cap }, { ...endpointModel, max_prompt_tokens: 0 }];
  const endpoints = await createModelDiscovery({ now, fetch: async () => json({ data: { id: minutesModel.id, endpoints: reverse ? duplicates.reverse() : duplicates } }) }).loadOpenRouterEndpoints(minutesModel.id, createJobContext());
  expect(endpoints).toEqual([]);
 });
 it.each([{ ...sttModel, architecture: { input_modalities: ["audio"], output_modalities: ["text"] } }, { ...sttModel, id: "not-a-slug" }, { ...sttModel, architecture: null }])("fails closed on malformed/non-transcription STT metadata (%j)", async record => {
  await expect(createModelDiscovery({ fetch: async () => json({ data: [record] }) }).loadOpenRouterSTT(createJobContext())).rejects.toMatchObject({ code: "catalog" });
 });
 it("never returns a raw authenticated OpenAI body or guesses STT from a prefix", async () => {
  const models = await createModelDiscovery({ now, fetch: async () => json({ data: [{ id: "gpt-transcribe-future", name: { untrusted: true }, owned_by: [], created: "unknown", audio: "DO_NOT_RETURN" }] }) }).loadOpenAIModels(() => "KEYLESS_DISCOVERY_FIXTURE", createJobContext());
  expect(models).toEqual([{ id: "gpt-transcribe-future", name: null, ownedBy: null, createdAt: null, source: "https://api.openai.com/v1/models", checkedAt: at, adapterStatus: "unsupported", inferenceVerified: false, sttModel: null }]);
 });
 it("rejects an incomplete authenticated listing rather than inventing an OpenAI pagination request", async () => {
  let calls = 0;
  await expect(createModelDiscovery({ fetch: async () => { calls++; return json({ data: [{ id: "whisper-1" }], has_more: true }); } }).loadOpenAIModels(() => "KEYLESS_DISCOVERY_FIXTURE", createJobContext())).rejects.toMatchObject({ code: "catalog" }); expect(calls).toBe(1);
 });
 it.each([{ status: 401, code: "authentication" }, { status: 429, code: "rate-limit" }])("preserves a typed read-only error without retries ($status)", async ({ status, code }) => {
  let calls = 0;
  await expect(createModelDiscovery({ now, fetch: async () => { calls++; return json({ error: { code: status, message: "UPSTREAM_PRIVATE_SENTINEL" } }, status, { "Retry-After": "5" }); } }).loadOpenRouterMinutes(createJobContext())).rejects.toMatchObject({ code, status, retryAt: Date.parse(at) + 5000, outcomeUnknown: false }); expect(calls).toBe(1);
 });
 it.each([{ value: "{", code: "malformed" }, { value: JSON.stringify({ data: {} }), code: "catalog" }])("rejects malformed response data ($code)", async ({ value, code }) => {
  await expect(createModelDiscovery({ fetch: async () => new Response(value) }).loadOpenRouterMinutes(createJobContext())).rejects.toMatchObject({ code });
 });
 it("rejects an already inactive job before getters or requests", async () => {
  const { controller, job } = localJob(); controller.abort(); let keys = 0; let calls = 0;
  await expect(createModelDiscovery({ fetch: async () => { calls++; return json({ data: [] }); } }).loadOpenAIModels(() => { keys++; return "KEYLESS_DISCOVERY_FIXTURE"; }, job)).rejects.toMatchObject({ name: "AbortError" }); expect(keys).toBe(0); expect(calls).toBe(0);
 });
 it("fences a key getter completing after lock before any authenticated dispatch", async () => {
  const { controller, job } = localJob(); let resolve!: (value: string) => void; let keys = 0; let calls = 0;
  const key = new Promise<string>(done => { resolve = done; });
  const pending = createModelDiscovery({ fetch: async () => { calls++; return json({ data: [] }); } }).loadOpenAIModels(() => { keys++; return key; }, job);
  await Promise.resolve(); controller.abort(); resolve("KEYLESS_DISCOVERY_FIXTURE");
  await expect(pending).rejects.toMatchObject({ name: "AbortError" }); expect(keys).toBe(1); expect(calls).toBe(0);
 });
 it("rejects a late public response after lock and does not fetch the next page", async () => {
  const { controller, job } = localJob(); let resolve!: (value: Response) => void; let calls = 0;
  const response = new Promise<Response>(done => { resolve = done; });
  const pending = createModelDiscovery({ fetch: async (_url, init) => { calls++; expect(init?.signal).toBe(job.signal); return response; } }).loadOpenRouterMinutes(job);
  controller.abort(); resolve(json({ data: [minutesModel], links: { next: "?offset=1" } }));
  await expect(pending).rejects.toMatchObject({ name: "AbortError" }); expect(calls).toBe(1);
 });
 it("does not cache an old successful snapshot across explicit refreshes", async () => {
  let calls = 0;
  const discovery = createModelDiscovery({ now, fetch: async () => { calls++; return json({ data: [{ ...minutesModel, id: `fixture/version-${calls}` }] }); } });
  const first = await discovery.loadOpenRouterMinutes(createJobContext()); const second = await discovery.loadOpenRouterMinutes(createJobContext());
  expect(first[0].id).toBe("fixture/version-1"); expect(second[0].id).toBe("fixture/version-2"); expect(calls).toBe(2);
 });
 it.each([2, -1, "1"])("rejects an incomplete or invalid advertised total rather than succeeding (%j)", async total => {
  await expect(createModelDiscovery({ fetch: async () => json({ data: [minutesModel], total_count: total }) }).loadOpenRouterMinutes(createJobContext())).rejects.toMatchObject({ code: "catalog" });
 });
 it("accepts a consistent advertised total only after the final page", async () => {
  let calls = 0;
  const models = await createModelDiscovery({ now, fetch: async () => { calls++; return json({ data: [{ ...minutesModel, id: `fixture/total-${calls}` }], total_count: 2, links: { next: calls === 1 ? "?offset=1" : null } }); } }).loadOpenRouterMinutes(createJobContext()); expect(models).toHaveLength(2);
 });
 it("rejects an advertised total that changes between pages", async () => {
  let calls = 0;
  await expect(createModelDiscovery({ fetch: async () => { calls++; return json({ data: [{ ...minutesModel, id: `fixture/change-${calls}` }], total_count: calls === 1 ? 2 : 3, links: { next: calls === 1 ? "?offset=1" : null } }); } }).loadOpenRouterMinutes(createJobContext())).rejects.toMatchObject({ code: "catalog" }); expect(calls).toBe(2);
 });
 it("rejects an advertised catalog beyond the count bound before fetching more pages", async () => {
  let calls = 0;
  await expect(createModelDiscovery({ limits: { maxCandidates: 1 }, fetch: async () => { calls++; return json({ data: [minutesModel], total_count: 2, links: { next: "?offset=1" } }); } }).loadOpenRouterMinutes(createJobContext())).rejects.toMatchObject({ code: "catalog" }); expect(calls).toBe(1);
 });
 it.each([null, { id: "malformed" }])("rejects malformed minutes identities instead of returning a partial filtered success (%j)", async record => {
  await expect(createModelDiscovery({ fetch: async () => json({ data: [minutesModel, record] }) }).loadOpenRouterMinutes(createJobContext())).rejects.toMatchObject({ code: "catalog" });
 });
 it("rejects malformed pagination metadata on an exact endpoint response", async () => {
  await expect(createModelDiscovery({ fetch: async () => json({ data: { id: minutesModel.id, endpoints: [endpointModel] }, links: "invalid" }) }).loadOpenRouterEndpoints(minutesModel.id, createJobContext())).rejects.toMatchObject({ code: "catalog" });
 });
 it("rejects malformed pagination metadata on an authenticated OpenAI listing", async () => {
  await expect(createModelDiscovery({ fetch: async () => json({ data: [{ id: "whisper-1" }], links: "invalid", has_more: "false" }) }).loadOpenAIModels(() => "KEYLESS_DISCOVERY_FIXTURE", createJobContext())).rejects.toMatchObject({ code: "catalog" });
 });
 it("cancels body reading and rejects when the job locks during a pending stream read", async () => {
  const { controller, job } = localJob(); let cancelled = false; let started!: () => void;
  const reading = new Promise<void>(done => { started = done; });
  const stream = new ReadableStream<Uint8Array>({ pull() { started(); }, cancel() { cancelled = true; } });
  const pending = createModelDiscovery({ fetch: async () => new Response(stream) }).loadOpenRouterMinutes(job);
  await reading; controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" }); expect(cancelled).toBe(true);
 });
 it("keeps usable minutes rows from a complete mixed catalog while excluding routing candidates", async () => {
  const routingIds = ["fixture/auto", "fixture/router"]; let calls = 0;
  const discovery = createModelDiscovery({ now, fetch: async (_url, init) => { calls++; expect(new Headers(init?.headers).has("Authorization")).toBe(false); return json({ data: [minutesModel, ...routingIds.map(id => ({ ...minutesModel, id }))], total_count: 3 }); } });
  const models = await discovery.loadOpenRouterMinutes(createJobContext());
  expect(models.map(model => model.id)).toEqual([minutesModel.id]); expect(Object.isFrozen(models)).toBe(true);
  for (const id of routingIds) await expect(discovery.loadOpenRouterEndpoints(id, createJobContext())).rejects.toMatchObject({ code: "catalog" });
  expect(calls).toBe(1);
 });
 it("returns a complete empty minutes snapshot when every well-formed candidate is routing-only", async () => {
  const models = await createModelDiscovery({ now, fetch: async () => json({ data: ["fixture/auto", "fixture/router"].map(id => ({ ...minutesModel, id })), total_count: 2 }) }).loadOpenRouterMinutes(createJobContext());
  expect(models).toEqual([]); expect(Object.isFrozen(models)).toBe(true);
 });
 it("uses raw totals across mixed routing pages before filtering executable minutes rows", async () => {
  let calls = 0;
  const models = await createModelDiscovery({ now, limits: { maxCandidates: 3 }, fetch: async () => { calls++; return calls === 1 ? json({ data: [{ ...minutesModel, id: "fixture/auto" }, minutesModel], total_count: 3, links: { next: "?offset=2" } }) : json({ data: [{ ...minutesModel, id: "fixture/router" }], total_count: 3 }); } }).loadOpenRouterMinutes(createJobContext());
  expect(models.map(model => model.id)).toEqual([minutesModel.id]); expect(calls).toBe(2);
 });
 it("counts excluded routing candidates against raw count and total limits", async () => {
  let calls = 0;
  await expect(createModelDiscovery({ limits: { maxCandidates: 2 }, fetch: async () => { calls++; return json({ data: [minutesModel, { ...minutesModel, id: "fixture/auto" }, { ...minutesModel, id: "fixture/router" }], total_count: 3 }); } }).loadOpenRouterMinutes(createJobContext())).rejects.toMatchObject({ code: "catalog" }); expect(calls).toBe(1);
 });
 it("keeps an unsupported normal STT candidate when routing rows share the dedicated catalog", async () => {
  const models = await createModelDiscovery({ now, fetch: async () => json({ data: [sttModel, { ...sttModel, id: "fixture/auto" }, { ...sttModel, id: "fixture/router" }], total_count: 3 }) }).loadOpenRouterSTT(createJobContext());
  expect(models.map(model => model.id)).toEqual([sttModel.id]); expect(models[0]).toMatchObject({ adapterStatus: "unsupported", pricing: { status: "unknown", raw: sttModel.pricing }, inputModalities: ["audio"], outputModalities: ["transcription"] });
 });
 it("returns a complete empty STT snapshot for routing-only catalog entries", async () => {
  const models = await createModelDiscovery({ now, fetch: async () => json({ data: ["fixture/auto", "fixture/router"].map(id => ({ ...sttModel, id })), total_count: 2 }) }).loadOpenRouterSTT(createJobContext()); expect(models).toEqual([]);
 });
 it("keeps normal IDs containing routing words without treating them as routing candidates", async () => {
  const ids = ["auto/normal", "router/normal", "fixture/automatic", "fixture/model-router"];
  const models = await createModelDiscovery({ now, fetch: async () => json({ data: ids.map(id => ({ ...minutesModel, id })), total_count: ids.length }) }).loadOpenRouterMinutes(createJobContext()); expect(models.map(model => model.id)).toEqual(ids);
 });
 it("keeps usable minutes rows when catalog-only leading-tilde aliases share the complete list", async () => {
  const models = await createModelDiscovery({ now, fetch: async () => json({ data: [minutesModel, { ...minutesModel, id: "~fixture/latest" }], total_count: 2 }) }).loadOpenRouterMinutes(createJobContext());
  expect(models.map(model => model.id)).toEqual([minutesModel.id]); expect(Object.isFrozen(models)).toBe(true);
 });
 it("keeps a normal unsupported STT candidate beside catalog-only leading-tilde aliases", async () => {
  const models = await createModelDiscovery({ now, fetch: async () => json({ data: [sttModel, { ...sttModel, id: "~fixture/transcription-latest" }], total_count: 2 }) }).loadOpenRouterSTT(createJobContext());
  expect(models.map(model => model.id)).toEqual([sttModel.id]); expect(models[0].adapterStatus).toBe("unsupported");
 });
 it.each(["minutes", "stt"] as const)("returns an immutable empty %s list when every candidate is a catalog-only leading-tilde alias", async stage => {
  const discovery = createModelDiscovery({ now, fetch: async () => json({ data: [{ ...(stage === "minutes" ? minutesModel : sttModel), id: "~fixture/latest" }], total_count: 1 }) });
  const models = await (stage === "minutes" ? discovery.loadOpenRouterMinutes(createJobContext()) : discovery.loadOpenRouterSTT(createJobContext()));
  expect(models).toEqual([]); expect(Object.isFrozen(models)).toBe(true);
 });
 it("rejects catalog-only leading-tilde aliases as manual IDs and endpoint requests before transport", async () => {
  let calls = 0; const discovery = createModelDiscovery({ fetch: async () => { calls++; return json({}); } });
  expect(validModelId("~fixture/latest")).toBe(false);
  await expect(discovery.loadOpenRouterEndpoints("~fixture/latest", createJobContext())).rejects.toMatchObject({ code: "catalog" }); expect(calls).toBe(0);
 });
 it.each(["~~fixture/latest", "fixture/~latest", "~fixture/latest/extra", "~./latest", "~../latest"])("rejects malformed catalog-only alias syntax rather than weakening identity checks (%s)", async id => {
  await expect(createModelDiscovery({ fetch: async () => json({ data: [minutesModel, { ...minutesModel, id }], total_count: 2 }) }).loadOpenRouterMinutes(createJobContext())).rejects.toMatchObject({ code: "catalog" });
 });
 it("counts catalog-only aliases against raw totals and candidate limits before excluding them", async () => {
  const data = [minutesModel, { ...minutesModel, id: "~fixture/latest" }];
  await expect(createModelDiscovery({ fetch: async () => json({ data, total_count: 1 }) }).loadOpenRouterMinutes(createJobContext())).rejects.toMatchObject({ code: "catalog" });
  await expect(createModelDiscovery({ limits: { maxCandidates: 1 }, fetch: async () => json({ data, total_count: 2 }) }).loadOpenRouterMinutes(createJobContext())).rejects.toMatchObject({ code: "catalog" });
 });
 it("retains manual-model duplicate conflict protection when catalog-only aliases are present", async () => {
  const data = [minutesModel, { ...minutesModel, context_length: 8000 }, { ...minutesModel, id: "~fixture/latest" }];
  await expect(createModelDiscovery({ fetch: async () => json({ data, total_count: 3 }) }).loadOpenRouterMinutes(createJobContext())).rejects.toMatchObject({ code: "catalog" });
 });
});
