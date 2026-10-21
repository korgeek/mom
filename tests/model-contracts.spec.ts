import { describe, expect, it } from "vitest";
import { createJobContext } from "../src/react-app/domain/jobs";
import { getSTTModel, hasCompletionCeilingParameter, parseRouterEndpoints, parseRouterModels, selectCompletionParameter } from "../src/react-app/providers/catalog";
import { canonicalizeRouterModels } from "../src/react-app/providers/model-presentation";
import { createOpenRouterProvider, previewMinutesFit } from "../src/react-app/providers/openrouter";
import { previewMinutesSelection, selectionConsentSnapshot } from "../src/react-app/minutes/selection";
import type { MinutesRequest } from "../src/react-app/domain/types";

const at = "2026-10-01T00:00:00.000Z";
const modelData = { id: "fixture/contracts", name: "Contract fixture", context_length: 32000, top_provider: { max_completion_tokens: 4096 }, architecture: { input_modalities: ["text"], output_modalities: ["text"] }, supported_parameters: ["max_completion_tokens"], pricing: { prompt: "0.000001", completion: "0.000002", request: "0" } };
const endpointData = { tag: "FixtureAzure/region", provider_name: "FixtureAzure", context_length: 30000, max_prompt_tokens: 28000, max_completion_tokens: 3000, supported_parameters: ["max_completion_tokens"], pricing: modelData.pricing };
const selection = () => ({ model: parseRouterModels({ data: [modelData] }, at)[0], endpoint: parseRouterEndpoints({ data: { endpoints: [endpointData] } }, modelData.id, at)[0] });
const messages = [{ role: "user" as const, content: "Fixture full multilingual speech 한글 日本語" }];
const request: MinutesRequest = { runId: "contract-run", transcript: { id: "contract-version", parentId: null, rawIds: [], segments: [{ id: "s", text: messages[0].content, sourceStartMs: 0, sourceEndMs: 1000, rawIds: [] }], issues: [], missingRanges: [] }, settings: { modelId: modelData.id, outputLanguage: "id", sections: ["summary"], instructions: "" } };
describe("provider completion contracts", () => {
 it.each([
  [["max_tokens"], ["max_tokens"], "max_tokens"],
  [["max_completion_tokens"], ["max_completion_tokens"], "max_completion_tokens"],
  [["max_tokens", "max_completion_tokens"], ["max_completion_tokens", "max_tokens"], "max_completion_tokens"],
  [["max_tokens", "max_completion_tokens"], ["max_tokens"], "max_tokens"],
  [["max_tokens"], ["max_completion_tokens"], null],
  [[], ["max_tokens"], null],
  [["max_completion_tokens"], ["reasoning"], null],
 ] as const)("selects only a jointly advertised ceiling (%j, %j)", (modelParameters, endpointParameters, expected) => {
  const selected = selection(); const model = { ...selected.model, supportedParameters: modelParameters }; const endpoint = { ...selected.endpoint, supportedParameters: endpointParameters };
  expect(selectCompletionParameter(model, endpoint)).toBe(expected);
  expect(previewMinutesFit({ model, endpoint }, messages, 2000).status).toBe(expected ? "fits" : "missing-limits");
  expect(hasCompletionCeilingParameter(model)).toBe(modelParameters.length > 0);
 });
 it("blocks incompatible advertised ceilings in preflight and before keys or transport", async () => {
  const selected = selection(); selected.model = { ...selected.model, supportedParameters: ["max_tokens"] }; let keys = 0; let calls = 0;
  const provider = createOpenRouterProvider({ selection: selected, maxOutputTokens: 2000, getKey: () => { keys++; return "KEYLESS_CONTRACT_FIXTURE"; }, buildMessages: () => messages, fetch: async () => { calls++; throw new Error("must not dispatch"); } });
  expect(() => provider.preflightMinutes(request)).toThrow();
  await expect(provider.completeMinutes(request, createJobContext())).rejects.toMatchObject({ code: "context" }); expect(keys).toBe(0); expect(calls).toBe(0);
 });
 it("supports an advertised completion-only route with one identical preflight/payload/consent ceiling", async () => {
  const selected = selection(); let sent: Record<string, unknown> | null = null;
  const provider = createOpenRouterProvider({ selection: selected, maxOutputTokens: 2000, getKey: () => "KEYLESS_CONTRACT_FIXTURE", buildMessages: () => messages, fetch: async (_url, init) => { sent = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ model: modelData.id, choices: [{ message: { content: "# Fixture" }, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 4 } })); } });
  const preview = previewMinutesSelection({ ...selected, messages, outputTokens: 2000, reasoningReserveTokens: 0 });
  expect(preview.status).toBe("fits");
  expect(preview.fit).toMatchObject({ completionParameter: "max_completion_tokens", completionCeilingTokens: 2000, outputTokens: 2000 });
  expect(provider.preflightMinutes(request)).toMatchObject({ completionParameter: "max_completion_tokens", completionCeilingTokens: 2000 });
  expect(selectionConsentSnapshot(selected.model, selected.endpoint, 2000, 0)).toMatchObject({ completion: { parameter: "max_completion_tokens", ceilingTokens: 2000, visibleOutputTokens: null } });
  await provider.generate(request, createJobContext());
  expect(sent).toMatchObject({ max_completion_tokens: 2000, provider: { only: [endpointData.tag], order: [endpointData.tag], allow_fallbacks: false, require_parameters: true } });
  expect(sent).not.toHaveProperty("max_tokens"); expect(sent).not.toHaveProperty("reasoning");
 });
 it("rejects unsupported separate reasoning reserves before key or transport", async () => {
  const selected = selection(); selected.model = { ...selected.model, supportedParameters: ["max_tokens", "reasoning"] }; selected.endpoint = { ...selected.endpoint, supportedParameters: ["max_tokens", "reasoning"] };
  let keys = 0; let calls = 0;
  expect(previewMinutesFit(selected, messages, 2000, 100).status).toBe("invalid-input");
  const provider = createOpenRouterProvider({ selection: selected, maxOutputTokens: 2000, reasoningReserveTokens: 100, getKey: () => { keys++; return "KEYLESS_CONTRACT_FIXTURE"; }, buildMessages: () => messages, fetch: async () => { calls++; throw new Error("must not dispatch"); } });
  await expect(provider.generate(request, createJobContext())).rejects.toMatchObject({ code: "invalid-input" }); expect(keys).toBe(0); expect(calls).toBe(0);
 });
});

describe("defensive optional model metadata", () => {
 it("preserves cloned optional gateway metadata and provenance without inventing reasoning behavior", () => {
  const reasoning = { mandatory: true, efforts: ["fixture-effort"] }; const defaults = { reasoning_effort: "fixture-effort", temperature: 0.2 };
  const model = parseRouterModels({ data: [{ ...modelData, reasoning, default_parameters: defaults, expiration_date: "2027-02-26" }] }, at)[0];
  const endpoint = parseRouterEndpoints({ data: { endpoints: [{ ...endpointData, reasoning, default_parameters: defaults, expiration_date: "2026-12-31" }] } }, model.id, at)[0];
  expect(model.capabilityMetadata).toMatchObject({ reasoningBehavior: "unknown", defaultParameters: defaults, expirationDate: "2027-02-26", raw: { reasoning }, checkedAt: at, source: model.source });
  expect(endpoint.capabilityMetadata).toMatchObject({ reasoningBehavior: "unknown", expirationDate: "2026-12-31", source: endpoint.source });
  reasoning.mandatory = false; defaults.reasoning_effort = "changed";
  expect(model.capabilityMetadata?.raw.reasoning).toEqual({ mandatory: true, efforts: ["fixture-effort"] });
  expect(Object.isFrozen(model.capabilityMetadata?.defaultParameters)).toBe(true);
 });
 it.each([undefined, { reasoning: "false", default_parameters: [], expiration_date: "2027-02-30" }])("keeps absent/malformed interpretations unknown while preserving supplied raw values", fields => {
  const model = parseRouterModels({ data: [{ ...modelData, ...fields }] }, at)[0];
  expect(model.capabilityMetadata).toMatchObject({ reasoningBehavior: "unknown", defaultParameters: null, expirationDate: null });
  expect(model.capabilityMetadata?.raw).toEqual({ reasoning: fields?.reasoning ?? null, defaultParameters: fields?.default_parameters ?? null, expirationDate: fields?.expiration_date ?? null });
 });
 it("marks optional capability conflicts unavailable in either duplicate order instead of inheriting the first", () => {
  const first = parseRouterModels({ data: [{ ...modelData, default_parameters: { reasoning_effort: "low" }, expiration_date: "2027-02-26" }] }, at)[0];
  const later = parseRouterModels({ data: [{ ...modelData, default_parameters: { reasoning_effort: "high" }, expiration_date: "2027-02-26" }] }, at)[0];
  for (const entries of [[first, later], [later, first]]) {
   const model = canonicalizeRouterModels(entries)[0];
   expect(model.catalogConflict).toHaveLength(2); expect(model.capabilityMetadata).toBeNull(); expect(model.supportedParameters).toEqual([]);
  }
 });
 it("keeps omitted legacy optional metadata equivalent to an unknown parsed declaration", () => {
  const parsed = selection().model; const legacy = { ...parsed, capabilityMetadata: undefined };
  for (const entries of [[legacy, parsed], [parsed, legacy]]) expect(canonicalizeRouterModels(entries)).toEqual([entries[0]]);
 });
 it("records only the documented alias shutdown dates and does not inherit them to a snapshot", () => {
  for (const id of ["whisper-1", "gpt-4o-transcribe", "gpt-4o-mini-transcribe", "gpt-4o-transcribe-diarize"]) expect(getSTTModel(id).lifecycle).toEqual({ shutdownDate: "2027-02-26", source: "https://developers.openai.com/api/docs/deprecations", checkedOn: "2026-10-01" });
  expect(getSTTModel("gpt-4o-mini-transcribe-2025-12-15").lifecycle).toBeNull(); expect(getSTTModel("gpt-transcribe").lifecycle).toBeNull();
 });
});
