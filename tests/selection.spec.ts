// Pure/keyless selection projections: no provider credentials, audio or live requests.
import { describe, expect, it } from "vitest";
import { createJobContext } from "../src/react-app/domain/jobs";
import { parseRouterEndpoints, parseRouterModels } from "../src/react-app/providers/catalog";
import { createOpenRouterProvider } from "../src/react-app/providers/openrouter";
import type { MinutesRequest } from "../src/react-app/domain/types";

const at = "2026-10-01T00:00:00.000Z";
const modelData = { id: "fixture/model", name: "Fixture", context_length: 12000, top_provider: { max_completion_tokens: 4096 }, architecture: { input_modalities: ["text"], output_modalities: ["text"] }, supported_parameters: ["max_tokens", "temperature"], pricing: { prompt: "0.000001", completion: "0.000002", request: "0" } };
const endpointData = { tag: "Fixture/region", provider_name: "Fixture", context_length: 8000, max_prompt_tokens: 6500, max_completion_tokens: 2000, supported_parameters: ["max_tokens"], pricing: { prompt: "0.000003", completion: "0.000004", request: "0.01" } };
const model = () => parseRouterModels({ data: [modelData] }, at)[0];
const endpoint = (pricing: unknown = endpointData.pricing) => parseRouterEndpoints({ data: { endpoints: [{ ...endpointData, pricing }] } }, modelData.id, at)[0];
const messages = [{ role: "user" as const, content: "한글 日本語 café 😀" }];
const request: MinutesRequest = { runId: "fixture-run", settings: { modelId: modelData.id, outputLanguage: "fr", sections: ["summary"], instructions: "" }, transcript: { id: "fixture-transcript", parentId: null, rawIds: [], segments: [{ id: "speech", text: messages[0].content, sourceStartMs: 0, sourceEndMs: 1000, rawIds: [] }], issues: [], missingRanges: [] } };
const modulePath = "../src/react-app/minutes/selection";
async function selection() {
 const imported = await import(/* @vite-ignore */ modulePath).catch(() => null);
 expect(imported, "Reusable selection preview is implemented").not.toBeNull();
 return imported as typeof import("../src/react-app/minutes/selection");
}
describe("minutes selection preview", () => {
 it("exposes cloned capability, full ceiling and raw selected pricing details, all bound in consent", async () => {
  const { previewMinutesSelection, selectionConsentSnapshot } = await selection();
  const m = parseRouterModels({ data: [{ ...modelData, default_parameters: { reasoning_effort: "fixture" } }] }, at)[0];
  const e = parseRouterEndpoints({ data: { endpoints: [{ ...endpointData, expiration_date: "2026-12-31", pricing: { ...endpointData.pricing, cache_read: "0.000001", overrides: [{ min_prompt_tokens: 272000, prompt: "0.000006" }] } }] } }, m.id, at)[0];
  const preview = previewMinutesSelection({ model: m, endpoint: e, messages, outputTokens: 1000, reasoningReserveTokens: 0 });
  expect(preview.completion).toEqual({ parameter: "max_tokens", ceilingTokens: 1000, visibleOutputTokens: null, scope: "full-provider-completion" });
  expect(preview.capabilities).toEqual({ model: m.capabilityMetadata, endpoint: e.capabilityMetadata });
  expect(preview.pricing.raw).toEqual(e.pricingMetadata.raw); expect(preview.projection.total).toBeNull();
  const snapshot = selectionConsentSnapshot(m, e, 1000, 0);
  expect(snapshot.model.capabilityMetadata).toEqual(m.capabilityMetadata); expect(snapshot.endpoint.capabilityMetadata).toEqual(e.capabilityMetadata);
  expect(Object.isFrozen(preview.pricing.raw)).toBe(true); expect(Object.isFrozen(snapshot.model.capabilityMetadata?.raw)).toBe(true);
  expect(selectionConsentSnapshot({ ...m, capabilityMetadata: null }, e, 1000, 0)).not.toEqual(snapshot);
  expect(selectionConsentSnapshot(m, { ...e, capabilityMetadata: null }, 1000, 0)).not.toEqual(snapshot);
 });
 it("retains pricing dates and the uncertain threshold verbatim without calculating tier applicability", async () => {
  const { previewMinutesSelection } = await selection();
  const pricing = { ...endpointData.pricing, effective_until: "2026-12-31", effective_from: "2027-01-01", overrides: [{ min_prompt_tokens: 272000, prompt: "0.000006", completion: "0.000006" }] };
  const p = previewMinutesSelection({ model: model(), endpoint: endpoint(pricing), messages, outputTokens: 1000, reasoningReserveTokens: 0 });
  expect(p.pricing.raw).toEqual(pricing); expect(p.pricing).toMatchObject({ complete: false, source: endpoint().source, checkedAt: at }); expect(p.projection.total).toBeNull();
 });
 it("shows selected endpoint rates, caps and full multilingual estimate exactly as dispatch preflight", async () => {
  const { previewMinutesSelection } = await selection(); const selected = { model: model(), endpoint: endpoint() };
  const preview = previewMinutesSelection({ ...selected, messages, outputTokens: 1600, reasoningReserveTokens: 0 });
  const provider = createOpenRouterProvider({ selection: selected, getKey: () => { throw new Error("preview must not get a key"); }, fetch: async () => { throw new Error("preview must not fetch"); }, buildMessages: () => messages, maxOutputTokens: 1600 });
  expect(preview.fit).toMatchObject({ ...provider.preflightMinutes(request), status: "fits" });
  expect(preview.fit?.inputTokenEstimate).toBe(384 + new TextEncoder().encode(messages[0].content).byteLength);
  expect(preview.limits).toMatchObject({ contextTokens: 8000, maxPromptTokens: 6500, maxOutputTokens: 2000, outputTokens: 1600, modelSupportedParameters: ["max_tokens", "temperature"], endpointSupportedParameters: ["max_tokens"] });
  expect(preview.pricing).toMatchObject({ kind: "selected-endpoint", inputPerMillion: 3, outputPerMillion: 4, requestFee: 0.01, source: selected.endpoint.source, checkedAt: at, complete: true });
  expect(preview.projection.total).toBeCloseTo(preview.fit!.inputTokenEstimate * 0.000003 + 1600 * 0.000004 + 0.01);
 });
 it("preserves zero rates and zero projected total", async () => {
  const { previewMinutesSelection } = await selection();
  const p = previewMinutesSelection({ model: model(), endpoint: endpoint({ prompt: "0", completion: "0", request: "0" }), messages, outputTokens: 1000, reasoningReserveTokens: 0 });
  expect(p.pricing.inputPerMillion).toBe(0); expect(p.projection).toMatchObject({ input: 0, output: 0, request: 0, total: 0, kind: "estimated" });
 });
 it.each([
  [{ prompt: "0.000003", completion: "0.000004" }, ["request"], []],
  [{ completion: "0.000004", request: "0" }, ["prompt"], []],
  [{ prompt: "0.000003", completion: "0.000004", request: "0", web_search: "0.01" }, [], ["web_search"]],
 ])("keeps known components but does not claim an incomplete total (%j)", async (pricing, missing, unsupported) => {
  const { previewMinutesSelection } = await selection();
  const p = previewMinutesSelection({ model: model(), endpoint: endpoint(pricing), messages, outputTokens: 1000, reasoningReserveTokens: 0 });
  expect(p.pricing.missingDimensions).toEqual(missing); expect(p.pricing.unsupportedDimensions).toEqual(unsupported); expect(p.projection.total).toBeNull(); expect(p.projection.kind).toBe("unavailable");
  expect(p.projection.output).toBeCloseTo(0.004);
 });
 it.each(["tiers", "overrides"])("retains conditional %s and leaves conditional rates unavailable", async dimension => {
  const { previewMinutesSelection } = await selection();
  const p = previewMinutesSelection({ model: model(), endpoint: endpoint({ ...endpointData.pricing, [dimension]: [{ prompt: "0.1" }] }), messages, outputTokens: 1000, reasoningReserveTokens: 0 });
  expect(p.pricing.conditionalDimensions).toEqual([dimension]); expect(p.pricing.inputPerMillion).toBeNull(); expect(p.projection.total).toBeNull();
 });
 it("labels model pricing as catalog-only and leaves dispatch projection unavailable until endpoint selection", async () => {
  const { previewMinutesSelection } = await selection();
  const p = previewMinutesSelection({ model: model(), endpoint: null, messages, outputTokens: 1000, reasoningReserveTokens: 0 });
  expect(p.status).toBe("choose-endpoint"); expect(p.pricing).toMatchObject({ kind: "catalog-only", inputPerMillion: 1 }); expect(p.projection.total).toBeNull();
  expect(previewMinutesSelection({ model: null, endpoint: null, messages: null, outputTokens: null, reasoningReserveTokens: 0 }).status).toBe("choose-model");
  expect(previewMinutesSelection({ model: model(), endpoint: endpoint(), messages: null, outputTokens: 1000, reasoningReserveTokens: 0 }).status).toBe("choose-transcript");
 });
 it.each(["missing-limits", "overflow"])("explains %s without deleting speech and matches dispatch rejection", async status => {
  const { previewMinutesSelection } = await selection(); const selected = { model: model(), endpoint: status === "missing-limits" ? { ...endpoint(), maxOutputTokens: null } : endpoint() };
  const fullMessages = [{ role: "user" as const, content: "한".repeat(3000) }];
  const p = previewMinutesSelection({ ...selected, messages: fullMessages, outputTokens: 1000, reasoningReserveTokens: 0 });
  expect(p.status).toBe(status); expect(p.fit?.inputTokenEstimate).toBe(9384); expect(fullMessages[0].content).toHaveLength(3000);
  const provider = createOpenRouterProvider({ selection: selected, getKey: () => { throw new Error("must not acquire key"); }, buildMessages: () => fullMessages, maxOutputTokens: 1000, fetch: async () => { throw new Error("must not dispatch"); } });
  await expect(provider.generate(request, createJobContext())).rejects.toMatchObject({ code: "context" });
 });
 it("treats an output budget above the effective cap as overflow", async () => {
  const { previewMinutesSelection } = await selection();
  expect(previewMinutesSelection({ model: model(), endpoint: endpoint(), messages, outputTokens: 2001, reasoningReserveTokens: 0 }).status).toBe("overflow");
 });
 it("freezes relevant consent metadata and changes identity for price, limits and configured budgets", async () => {
  const { selectionConsentSnapshot } = await selection(); const m = model(); const e = endpoint();
  const baseline = selectionConsentSnapshot(m, e, 1000, 0);
  expect(Object.isFrozen(baseline.endpoint.pricingMetadata.raw)).toBe(true);
  for (const other of [selectionConsentSnapshot(m, { ...e, maxPromptTokens: 6000 }, 1000, 0), selectionConsentSnapshot(m, { ...e, pricing: { prompt: 0, completion: 0, request: 0 } }, 1000, 0), selectionConsentSnapshot(m, e, 999, 0), selectionConsentSnapshot(m, e, 1000, 1)]) expect(other).not.toEqual(baseline);
 });
});
