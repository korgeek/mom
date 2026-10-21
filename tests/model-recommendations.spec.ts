import { expect, it } from 'vitest';
import { parseRouterEndpoints, parseRouterModels } from '../src/react-app/providers/catalog';
import type { RouterEndpoint, RouterModel } from '../src/react-app/providers/catalog';
import { previewMinutesSelection } from '../src/react-app/minutes/selection';

const at = '2026-10-02T00:00:00.000Z', evaluatedAt = '2026-10-02T08:00:00.000Z';
const messages = [{ role: 'system' as const, content: 'Use the complete selected transcript.' }, { role: 'user' as const, content: '한글 日本語 café 😀 Complete speech.' }];
const modelData = { name: 'Synthetic metadata', context_length: 12000, top_provider: { max_completion_tokens: 4096 }, architecture: { input_modalities: ['text'], output_modalities: ['text'] }, supported_parameters: ['max_completion_tokens'], pricing: { prompt: '0.000001', completion: '0.000002', request: '0' } };
const endpointData = { tag: 'Synthetic/region', provider_name: 'Synthetic endpoint', context_length: 8000, max_prompt_tokens: 6500, max_completion_tokens: 2000, supported_parameters: ['max_completion_tokens'], pricing: { prompt: '0.000003', completion: '0.000004', request: '0.01' } };
function model(id = 'fixture/model', extra: Record<string, unknown> = {}): RouterModel { return parseRouterModels({ data: [{ ...modelData, id, ...extra }] }, at)[0]; }
function endpoint(id = 'fixture/model', extra: Record<string, unknown> = {}): RouterEndpoint { return parseRouterEndpoints({ data: { endpoints: [{ ...endpointData, ...extra }] } }, id, at)[0]; }
const modulePath = '../src/react-app/providers/recommendations';
async function recommendations() {
  const imported = await import(/* @vite-ignore */ modulePath).catch(() => null);
  expect(imported, 'pure metadata/preflight recommendations are implemented').not.toBeNull();
  return imported as typeof import('../src/react-app/providers/recommendations');
}
const input = (models = [model()], endpoints = [endpoint()]) => ({ models, endpoints, messages, outputTokens: 1000, reasoningReserveTokens: 0, selected: null, evaluatedAt });

it('chooses the lowest complete known endpoint projection and retains the real preflight, rates and dates', async () => {
  const { recommendMinutesModels } = await recommendations();
  const expensive = model('fixture/expensive'), cheap = model('fixture/cheap');
  const expensiveEndpoint = endpoint(expensive.id), cheapEndpoint = endpoint(cheap.id, { pricing: { prompt: '0.000001', completion: '0.000002', request: '0' } });
  const saved = structuredClone(input([expensive, cheap], [expensiveEndpoint, cheapEndpoint])), before = structuredClone(saved);
  const result = recommendMinutesModels(saved);
  expect(result.status).toBe('available'); expect(result.defaultChoice?.modelId).toBe(cheap.id);
  expect(result.choices.map(choice => choice.modelId)).toEqual([cheap.id, expensive.id]);
  const preview = previewMinutesSelection({ model: cheap, endpoint: cheapEndpoint, messages, outputTokens: 1000, reasoningReserveTokens: 0 });
  expect(result.defaultChoice).toMatchObject({ state: 'eligible', endpointTag: cheapEndpoint.tag, estimatedCost: preview.projection.total, preview, evaluatedAt, reason: 'lowest-known-estimated-cost', metadata: { model: { source: cheap.source, checkedAt: at }, endpoint: { source: cheapEndpoint.source, checkedAt: at } } });
  expect(saved).toEqual(before); expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.defaultChoice?.preview.limits)).toBe(true);
  expect(Object.isFrozen(saved.models[0])).toBe(false); expect(Object.isFrozen(saved.endpoints[0].pricingMetadata.raw)).toBe(false);
  saved.endpoints[1] = { ...saved.endpoints[1], contextTokens: 1 };
  expect(result.defaultChoice?.preview.limits.endpointContextTokens).toBe(8000);
});
it.each(['max_tokens', 'max_completion_tokens'])('admits the actual shared %s field without assuming the other field', async parameter => {
  const { recommendMinutesModels } = await recommendations();
  const result = recommendMinutesModels(input([model('fixture/model', { supported_parameters: [parameter] })], [endpoint('fixture/model', { supported_parameters: [parameter] })]));
  expect(result.defaultChoice?.preview.completion?.parameter).toBe(parameter); expect(result.defaultChoice?.preview.completion?.ceilingTokens).toBe(1000);
  expect(result.defaultChoice?.preview.completion?.visibleOutputTokens).toBeNull();
});
it('does not cross advertised ceiling fields or admit an endpoint belonging to another model', async () => {
  const { recommendMinutesModels } = await recommendations();
  const crossed = recommendMinutesModels(input([model()], [endpoint('fixture/model', { supported_parameters: ['max_tokens'] })]));
  expect(crossed.defaultChoice).toBeNull(); expect(crossed.status).toBe('unavailable'); expect(crossed.blockers[0].reason).toBe('shared-completion-parameter-unavailable');
  const mismatched = recommendMinutesModels(input([model()], [endpoint('fixture/different-model')]));
  expect(mismatched.defaultChoice).toBeNull(); expect(mismatched.choices.every(choice => choice.state === 'pending-endpoint')).toBe(true);
});
it.each(['input', 'output'] as const)('leaves missing %s text capability unavailable', async side => {
  const { recommendMinutesModels } = await recommendations(); const m = { ...model(), [side === 'input' ? 'inputModalities' : 'outputModalities']: ['image'] };
  const result = recommendMinutesModels(input([m])); expect(result.status).toBe('unavailable'); expect(result.defaultChoice).toBeNull(); expect(result.blockers[0].reason).toBe('unknown-text-support');
});
it.each(['modelContext', 'modelOutput', 'endpointContext', 'endpointOutput'])('rejects unknown required limit: %s', async field => {
  const { recommendMinutesModels } = await recommendations(); const m = model(), e = endpoint();
  const models = [{ ...m, ...(field === 'modelContext' ? { contextTokens: null } : field === 'modelOutput' ? { maxOutputTokens: null } : {}) }];
  const endpoints = [{ ...e, ...(field === 'endpointContext' ? { contextTokens: null } : field === 'endpointOutput' ? { maxOutputTokens: null } : {}) }];
  const result = recommendMinutesModels(input(models, endpoints)); expect(result.defaultChoice).toBeNull(); expect(result.blockers[0].reason).toBe('missing-limits');
});
it('can recommend an exact unknown-prompt-cap route from context while keeping its published cap unknown', async () => {
  const { recommendMinutesModels } = await recommendations();
  const result = recommendMinutesModels(input([model()], [{ ...endpoint(), maxPromptTokens: null }]));
  expect(result.defaultChoice?.preview.status).toBe('fits');
  expect(result.defaultChoice?.preview.limits.maxPromptTokens).toBeNull();
  expect(result.defaultChoice?.preview.fit?.derivedInputBudgetTokens).toBe(7000);
});
it('rejects full multilingual context overflow and output-cap overflow without truncating messages', async () => {
  const { recommendMinutesModels } = await recommendations(); const full = [{ role: 'user' as const, content: '한'.repeat(3000) }], before = structuredClone(full);
  const result = recommendMinutesModels({ ...input(), messages: full }); expect(result.defaultChoice).toBeNull(); expect(result.blockers[0].reason).toBe('overflow');
  expect(result.blockers[0].preview?.fit?.inputTokenEstimate).toBe(9384); expect(full).toEqual(before);
  expect(recommendMinutesModels({ ...input(), outputTokens: 2001 }).blockers[0].reason).toBe('overflow');
});
it('blocks conflicting duplicate model and exact-endpoint metadata in either input order', async () => {
  const { recommendMinutesModels } = await recommendations(); const first = model(), changed = model(first.id, { top_provider: { max_completion_tokens: 512 } });
  for (const models of [[first, changed], [changed, first]]) { const result = recommendMinutesModels(input(models)); expect(result.defaultChoice).toBeNull(); expect(result.blockers[0].reason).toBe('conflicting-model-metadata'); }
  const e = endpoint(), changedEndpoint = endpoint(first.id, { pricing: { prompt: '0', completion: '0', request: '0' } });
  for (const endpoints of [[e, changedEndpoint], [changedEndpoint, e]]) { const result = recommendMinutesModels(input([first], endpoints)); expect(result.defaultChoice).toBeNull(); expect(result.blockers[0].reason).toBe('conflicting-endpoint-metadata'); }
});
it.each([
  undefined,
  { prompt: '0', completion: '0' },
  { prompt: '0', completion: '0', request: '0', tiers: [{ prompt: '1' }] },
  { prompt: '0', completion: '0', request: '0', overrides: [{ prompt: '1' }] },
  { prompt: '0', completion: '0', request: '0', cache_read: '0' },
  { prompt: '0', completion: '0', request: '0', web_search: '0.01' },
])('keeps incomplete or conditional endpoint pricing out of defaults (%j)', async pricing => {
  const { recommendMinutesModels } = await recommendations(); const result = recommendMinutesModels(input([model()], [endpoint('fixture/model', { pricing })]));
  expect(result.defaultChoice).toBeNull(); expect(result.status).toBe('unavailable'); expect(result.blockers[0].reason).toBe('unknown-or-conditional-cost');
});
it('distinguishes actual known zero from unknown rates and uses exact endpoint rather than catalog rates', async () => {
  const { recommendMinutesModels } = await recommendations(); const unknown = model('fixture/unknown'), zero = model('fixture/zero', { pricing: undefined });
  const result = recommendMinutesModels(input([unknown, zero], [endpoint(unknown.id, { pricing: undefined }), endpoint(zero.id, { pricing: { prompt: '0', completion: '0', request: '0' } })]));
  expect(result.defaultChoice).toMatchObject({ modelId: zero.id, estimatedCost: 0 }); expect(result.defaultChoice?.preview.pricing).toMatchObject({ complete: true, requestFee: 0, inputPerMillion: 0 });
  expect(result.choices.some(choice => choice.modelId === unknown.id)).toBe(false);
});
it('returns only pending endpoint verification for catalog-only candidates with no admitted default', async () => {
  const { recommendMinutesModels } = await recommendations(); const result = recommendMinutesModels(input([model()], []));
  expect(result.status).toBe('pending-endpoints'); expect(result.defaultChoice).toBeNull();
  expect(result.choices).toMatchObject([{ state: 'pending-endpoint', reason: 'pending-endpoint-verification', endpointTag: null, estimatedCost: null, preview: { status: 'choose-endpoint', pricing: { kind: 'catalog-only' }, projection: { total: null, kind: 'unavailable' } } }]);
});
it('preserves an explicit saved model/provider/endpoint without proposing an automatic replacement', async () => {
  const { recommendMinutesModels } = await recommendations(); const selected = { provider: 'openai' as const, modelId: 'saved-custom-choice', endpointTag: null };
  const result = recommendMinutesModels({ ...input(), selected });
  expect(result.selected).toEqual(selected); expect(result.selected).not.toBe(selected); expect(result.defaultChoice).toBeNull(); expect(result.reason).toBe('explicit-choice-preserved');
  expect(Object.isFrozen(selected)).toBe(false); expect(Object.isFrozen(result.selected)).toBe(true);
});
it('uses deterministic ID/endpoint tie breaks and at most five choices without ranking recency or popularity', async () => {
  const { recommendMinutesModels } = await recommendations();
  const models = Array.from({ length: 8 }, (_, i) => model(`fixture/model-${i}`, { created: i % 2 ? 1000 : 2000 }));
  const endpoints = models.flatMap(m => [endpoint(m.id, { tag: 'Synthetic/B' }), endpoint(m.id, { tag: 'Synthetic/A' })]);
  const result = recommendMinutesModels(input(models, endpoints)), reversed = recommendMinutesModels(input([...models].reverse(), [...endpoints].reverse()));
  expect(result).toEqual(reversed); expect(result.choices).toHaveLength(5);
  expect(result.choices.map(choice => [choice.modelId, choice.endpointTag])).toEqual([['fixture/model-0', 'Synthetic/A'], ['fixture/model-0', 'Synthetic/B'], ['fixture/model-1', 'Synthetic/A'], ['fixture/model-1', 'Synthetic/B'], ['fixture/model-2', 'Synthetic/A']]);
  expect(result.defaultChoice?.reason).toBe('lowest-known-estimated-cost'); expect(result.choices[1].reason).toBe('known-cost-alternative');
});
it('reports actual missing inputs without inventing a paid-ready recommendation', async () => {
  const { recommendMinutesModels } = await recommendations();
  expect(recommendMinutesModels({ ...input(), messages: null })).toMatchObject({ status: 'unavailable', reason: 'missing-transcript', defaultChoice: null, choices: [] });
  expect(recommendMinutesModels({ ...input(), outputTokens: null })).toMatchObject({ status: 'unavailable', reason: 'missing-output-budget', defaultChoice: null, choices: [] });
  expect(recommendMinutesModels({ ...input(), evaluatedAt: 'invalid' })).toMatchObject({ status: 'unavailable', reason: 'invalid-recommendation-date', defaultChoice: null });
});
it('does not invent applicability for extra request limits, malformed dates or inconsistent pricing snapshots', async () => {
  const { recommendMinutesModels } = await recommendations();
  const cases = [
    { m: { ...model(), perRequestLimits: { unknown_ceiling: 4 } }, e: endpoint(), reason: 'uninterpreted-request-limits' },
    { m: { ...model(), checkedAt: '' }, e: endpoint(), reason: 'metadata-date-unavailable' },
    { m: model(), e: { ...endpoint(), checkedAt: '' }, reason: 'metadata-date-unavailable' },
    { m: model(), e: { ...endpoint(), pricing: { prompt: 0, completion: 0, request: 0 } }, reason: 'unknown-or-conditional-cost' },
  ];
  for (const { m, e, reason } of cases) { const result = recommendMinutesModels(input([m], [e])); expect(result.defaultChoice).toBeNull(); expect(result.blockers[0].reason).toBe(reason); }
});
it('rejects malformed identities rather than presenting invalid catalog or endpoint routes', async () => {
  const { recommendMinutesModels } = await recommendations();
  const catalog = recommendMinutesModels(input([{ ...model(), id: 'not-a-router-model' }], []));
  expect(catalog.status).toBe('unavailable'); expect(catalog.choices).toEqual([]); expect(catalog.blockers[0].reason).toBe('invalid-model-identity');
  const route = recommendMinutesModels(input([model()], [{ ...endpoint(), tag: 'Synthetic\nregion' }]));
  expect(route.status).toBe('unavailable'); expect(route.defaultChoice).toBeNull(); expect(route.blockers[0].reason).toBe('invalid-endpoint-identity');
});
it('keeps missing input and unsupported or excessive budgets unavailable before endpoint verification', async () => {
  const { recommendMinutesModels } = await recommendations();
  expect(recommendMinutesModels({ ...input([model()], []), messages: [] })).toMatchObject({ status: 'unavailable', reason: 'missing-transcript', choices: [] });
  expect(recommendMinutesModels({ ...input([model()], []), reasoningReserveTokens: 1 })).toMatchObject({ status: 'unavailable', reason: 'unsupported-reasoning-reserve', choices: [] });
  const overflow = recommendMinutesModels({ ...input([model()], []), outputTokens: 4097 });
  expect(overflow.status).toBe('unavailable'); expect(overflow.choices).toEqual([]); expect(overflow.blockers[0].reason).toBe('overflow');
});
