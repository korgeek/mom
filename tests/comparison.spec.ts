// Real pure comparison boundaries; no keys, provider transport or user material.
import { webcrypto } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { parseRouterEndpoints, parseRouterModels } from "../src/react-app/providers/catalog";
import { buildMinutesMessages } from "../src/react-app/minutes/prompt";
import type { MinutesSettings, TranscriptVersion } from "../src/react-app/domain/types";
beforeAll(() => { Object.defineProperty(globalThis, "crypto", { configurable: true, value: webcrypto }); });
const at = "2026-10-01T00:00:00.000Z";
const data = { id: "fixture/a", name: "Fixture A", context_length: 32000, top_provider: { max_completion_tokens: 3000 }, architecture: { input_modalities: ["text"], output_modalities: ["text"] }, supported_parameters: ["max_tokens"], pricing: { prompt: "0.000001", completion: "0.000002", request: "0" } };
function choice(id = data.id, cap = 2000, pricing: unknown = data.pricing) {
 return { model: parseRouterModels({ data: [{ ...data, id }] }, at)[0], endpoint: parseRouterEndpoints({ data: { endpoints: [{ tag: `Fixture/${id}`, provider_name: "Fixture", context_length: 30000, max_prompt_tokens: 28000, max_completion_tokens: cap, supported_parameters: ["max_tokens"], pricing }] } }, id, at)[0] };
}
const transcript: TranscriptVersion = { id: "fixture-version", parentId: null, rawIds: ["raw"], segments: [{ id: "s", text: "한글 日本語 café 😀 cancelled decision", sourceStartMs: 0, sourceEndMs: 1000, rawIds: ["raw"] }], issues: [], missingRanges: [] };
const settings: MinutesSettings = { outputLanguage: "fr", sections: ["decisions", "summary"], instructions: "Keep uncertainties", modelId: data.id };
const modulePath = "../src/react-app/minutes/compare";
async function comparison() {
 const imported = await import(/* @vite-ignore */ modulePath).catch(() => null);
 expect(imported, "Reusable frozen comparison implementation exists").not.toBeNull();
 return imported as typeof import("../src/react-app/minutes/compare");
}
describe("frozen exactly-two comparison", () => {
 it('rejects the same model identity even when endpoint tags differ', async () => {
  const { previewComparison } = await comparison(); const a = choice();
  const b = { ...a, endpoint: { ...a.endpoint, tag: 'DifferentFixture/region' } };
  expect(previewComparison({ transcript, settings, choices: [a, b] }).status).toBe('duplicate');
 });
 it('preserves boundary history without reintroducing alternatives outside selected speech', async () => {
  const { previewComparison, freezeMinutesComparison } = await comparison();
  const unresolved = { ...transcript, issues: [{ id: 'uncertain', rangeMs: [0, 1000] as const, alternatives: [[transcript.segments[0]], [{ ...transcript.segments[0], text: 'Opposite decision' }]], selected: null }] };
  const choices = [choice(), choice('fixture/b')] as const;
  expect(previewComparison({ transcript: unresolved, settings, choices }).status).toBe('fits');
  const frozen = await freezeMinutesComparison('project', unresolved, settings, choices, 2000);
  expect(frozen.transcript.issues).toEqual(unresolved.issues);
  expect(frozen.messages[1].content).not.toContain('Opposite decision');
 });
 it("uses the minimum of both model and endpoint caps with identical full prompts", async () => {
  const { previewComparison, freezeMinutesComparison } = await comparison();
  const choices = [choice(), choice("fixture/b", 1500)] as const;
  const preview = previewComparison({ transcript, settings, choices });
  expect(preview.status).toBe("fits"); expect(preview.outputTokens).toBe(1500);
  expect(preview.members.map(member => member.limits.outputTokens)).toEqual([1500, 1500]);
  expect(preview.members[0].fit?.inputTokenEstimate).toBe(preview.members[1].fit?.inputTokenEstimate);
  expect(preview.combinedTotal).toBeCloseTo(preview.members[0].projection.total! + preview.members[1].projection.total!);
  const frozen = await freezeMinutesComparison("project", transcript, settings, choices, 1500);
  expect(frozen.messages).toEqual(buildMinutesMessages(transcript, settings));
  expect(frozen.messages).toEqual(buildMinutesMessages(transcript, { ...settings, modelId: "fixture/b" }));
  expect(frozen.transcript).toEqual(transcript); expect(frozen.settings.sections).toEqual(["decisions", "summary"]);
  expect(Object.isFrozen(frozen.transcript.segments[0])).toBe(true);
  expect(frozen.members).toHaveLength(2); expect(JSON.stringify(frozen)).not.toContain("Authorization");
 });
 it("rejects duplicate model identities and preflights both members including unknown or overflow limits", async () => {
  const { previewComparison } = await comparison(); const a = choice(); const b = choice("fixture/b");
  expect(previewComparison({ transcript, settings, choices: [a, a] }).status).toBe("duplicate");
  expect(previewComparison({ transcript, settings, choices: [a, { ...b, endpoint: { ...b.endpoint, maxPromptTokens: null } }] }).status).toBe("fits");
  expect(previewComparison({ transcript, settings, choices: [a, { ...b, endpoint: { ...b.endpoint, maxOutputTokens: null } }] }).status).toBe("missing-limits");
  expect(previewComparison({ transcript, settings, choices: [a, { ...b, endpoint: { ...b.endpoint, maxPromptTokens: 1 } }] }).status).toBe("overflow");
  expect(previewComparison({ transcript, settings, choices: [a, b], outputTokens: 2001 }).status).toBe("overflow");
  expect(previewComparison({ transcript: { ...transcript, issues: [{ id: "overlap", rangeMs: [0, 1], alternatives: [], selected: null }] }, settings, choices: [a, b] }).status).toBe("fits");
 });
 it("never fabricates a combined total when one endpoint billing dimension is unknown", async () => {
  const { previewComparison } = await comparison();
  const preview = previewComparison({ transcript, settings, choices: [choice(), choice("fixture/b", 2000, { prompt: "0.000001", completion: "0.000002" })] });
  expect(preview.status).toBe("fits"); expect(preview.unknownTotal).toBe(true); expect(preview.combinedTotal).toBeNull();
  expect(preview.members[1].projection.output).toBe(0.004);
 });
 it("binds routes, frozen input, full metadata, budget, refresh and retry attempts in consent", async () => {
  const { freezeMinutesComparison, comparisonConsentToken } = await comparison(); const a = choice(); const b = choice("fixture/b"); const choices = [a, b] as const;
  const frozen = await freezeMinutesComparison("project", transcript, settings, choices, 2000);
  const token = await comparisonConsentToken(frozen, choices, 0, null);
  for (const other of [await comparisonConsentToken(frozen, choices, 1, null), await comparisonConsentToken({ ...frozen, outputTokens: 1999 }, choices, 0, null), await comparisonConsentToken({ ...frozen, settings: { ...settings, instructions: "changed" } }, choices, 0, null), await comparisonConsentToken(frozen, [a, { ...b, endpoint: { ...b.endpoint, maxPromptTokens: 27000 } }], 0, null), await comparisonConsentToken(frozen, choices, 0, 1)]) expect(other).not.toBe(token);
 });
});
