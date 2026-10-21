import { describe, expect, it } from 'vitest';
import { hasCompletionCeilingParameter, parseRouterModels } from '../src/react-app/providers/catalog';
import { canonicalizeRouterModels, catalogMetadata, groupCatalogChoices, modelIdentity, modelOptionLabel } from '../src/react-app/providers/model-presentation';

const checkedAt = '2026-10-01T00:00:00.000Z';
const raw = { context_length: 16000, top_provider: { max_completion_tokens: 4096 }, supported_parameters: ['max_tokens'], architecture: { input_modalities: ['text'], output_modalities: ['text'] }, pricing: { prompt: '0', completion: '0', request: '0' } };
function choice(id: string, extra = {}) {
  const model = parseRouterModels({ data: [{ ...raw, id, name: `Name ${id}`, ...extra }] }, checkedAt)[0];
  return { id, label: model.name, provider: 'openrouter' as const, enabled: model.contextTokens !== null && model.maxOutputTokens !== null && hasCompletionCeilingParameter(model), catalog: catalogMetadata(model) };
}
const ids = (groups: ReturnType<typeof groupCatalogChoices>) => groups.flatMap(group => group.models.map(model => model.id));

describe('honest model identity and catalog groups', () => {
  it('keeps completion-only candidates searchable without claiming endpoint compatibility or free unknown metadata', () => {
    const model = choice('azure/completion-only', { supported_parameters: ['max_completion_tokens'], pricing: undefined });
    expect(model.enabled).toBe(true); expect(model.catalog.pricingKind).toBe('uncertain');
    expect(ids(groupCatalogChoices([model], '', 'all', 'completion-only'))).toEqual([model.id]);
    expect(ids(groupCatalogChoices([model], '', 'free', ''))).toEqual([]);
  });
  it.each(['pricing', 'compatibility', 'limits'] as const)('keeps conflicting same-ID metadata unavailable in both input orders: %s', mode => {
    const first = choice('openai/duplicate', { name: 'First candidate', pricing: { prompt: '0.01', completion: '0', request: '0' } });
    const later = choice(first.id, { name: 'Later candidate', pricing: { prompt: mode === 'pricing' ? '0' : '0.01', completion: '0', request: '0' }, supported_parameters: mode === 'compatibility' ? [] : ['max_tokens'], top_provider: { max_completion_tokens: mode === 'limits' ? 512 : 4096 } });
    for (const choices of [[first, later], [later, first]]) {
      const all = groupCatalogChoices(choices, first.id, 'all', '');
      expect(all.flatMap(group => group.models)).toHaveLength(1);
      expect(all[0].models[0]).toMatchObject({ id: first.id, label: first.id, enabled: false, catalog: { conflict: true, pricingKind: 'uncertain', createdAt: null } });
      expect(ids(groupCatalogChoices(choices, '', 'free', ''))).toEqual([]);
      expect(ids(groupCatalogChoices(choices, '', 'shortlist', ''))).toEqual([]);
      expect(ids(groupCatalogChoices(choices, '', 'latest', ''))).toEqual([]);
      expect(groupCatalogChoices(choices, first.id, 'shortlist', '')[0].id).toBe('selected');
    }
  });
  it('keeps equivalent duplicates usable when only checked time or numeric rate representation differs', () => {
    const first = choice('openai/identical');
    const equivalent = choice(first.id, { pricing: { prompt: '0.0', completion: 0, request: '0.000' } });
    const later = { ...equivalent, catalog: { ...equivalent.catalog, checkedAt: '2026-10-01T00:00:01.000Z' } };
    const result = groupCatalogChoices([first, later], first.id, 'all', '').flatMap(group => group.models);
    expect(result).toEqual([first]); expect(result[0].enabled).toBe(true); expect(result[0].catalog?.conflict).toBe(false);
    const earlierModel = parseRouterModels({ data: [{ ...raw, id: first.id }] }, checkedAt)[0];
    const laterModel = parseRouterModels({ data: [{ ...raw, id: first.id, pricing: { prompt: '0.0', completion: 0, request: '0.000' } }] }, later.catalog.checkedAt)[0];
    for (const models of [[earlierModel, laterModel], [laterModel, earlierModel]]) {
      const normalized = canonicalizeRouterModels(models);
      expect(normalized).toEqual([models[0]]); expect(catalogMetadata(normalized[0])).toMatchObject({ conflict: false, pricingKind: 'zero' });
    }
  });
  it('separates the gateway from namespace-derived catalog owner and independently known direct creator', () => {
    expect(modelIdentity('openai/gpt-fixture', 'openrouter', 'GPT fixture')).toMatchObject({ route: 'OpenRouter', owner: 'OpenAI', creator: null, ownerKind: 'catalog-namespace' });
    expect(modelIdentity('whisper-1', 'openai')).toMatchObject({ route: 'Direct OpenAI', owner: 'OpenAI', creator: 'OpenAI', ownerKind: 'direct-provider' });
    expect(modelIdentity('unlisted/model', 'openrouter')).toMatchObject({ owner: 'unlisted', creator: null, ownerKind: 'catalog-namespace' });
    expect(modelIdentity('legacy-model', 'openrouter')).toMatchObject({ owner: null, creator: null, ownerKind: 'unknown' });
    const label = modelOptionLabel(choice('openai/gpt-fixture'), 'en');
    expect(label).toContain('OpenRouter'); expect(label).toContain('OpenAI (catalog namespace)'); expect(label).toContain('openai/gpt-fixture'); expect(label).not.toContain('Executed by');
  });
  it.each([
    [{ prompt: '0', completion: '0', request: '0' }, 'zero'],
    [{ prompt: '0', completion: '0' }, 'uncertain'],
    [{ prompt: 'oops', completion: '0', request: '0' }, 'uncertain'],
    [{ prompt: '0', completion: '0', request: '0', overrides: [{}] }, 'uncertain'],
    [{ prompt: '0', completion: '0', request: '0', image: '0' }, 'uncertain'],
    [{ prompt: '0', completion: '0', request: '0', image: '0.1' }, 'priced'],
    [{ prompt: '0.01', completion: '0', request: '0' }, 'priced'],
  ])('classifies validated fees rather than the :free suffix (%j)', (pricing, kind) => {
    expect(choice('owner/model:free', { pricing }).catalog.pricingKind).toBe(kind);
  });
  it('uses at most five enabled entries with one per namespace first, then ID order, regardless of response order', () => {
    const choices = ['c/model', 'a/second', 'd/model', 'a/first', 'e/model', 'b/model', 'f/disabled'].map(id => choice(id, { pricing: { prompt: '0.01', completion: '0', request: '0' }, ...(id === 'f/disabled' ? { supported_parameters: [] } : {}) }));
    expect(ids(groupCatalogChoices(choices, '', 'shortlist', ''))).toEqual(['a/first', 'b/model', 'c/model', 'd/model', 'e/model']);
    expect(groupCatalogChoices(choices, '', 'shortlist', '')).toEqual(groupCatalogChoices([...choices].reverse(), '', 'shortlist', ''));
  });
  it('shortlist regression prefers exact eligible curated IDs over the namespace fallback', () => {
    const choices = [choice('a/first'), choice('openai/gpt-6-luna'), choice('deepseek/deepseek-v4.1-flash'), choice('google/gemini-3.8-flash', { supported_parameters: [] })];
    expect(ids(groupCatalogChoices(choices, '', 'shortlist', ''))).toEqual(['deepseek/deepseek-v4.1-flash', 'openai/gpt-6-luna']);
    expect(ids(groupCatalogChoices(choices, '', 'shortlist', 'a/first'))).toEqual(['a/first']);
    expect(groupCatalogChoices(choices, '', 'shortlist', '')).toEqual(groupCatalogChoices([...choices].reverse(), '', 'shortlist', ''));
  });
  it.each(['free', 'latest'] as const)('shortlist search regression preserves actual fee/date classification when searching beyond %s', category => {
    const choices = [choice('owner/target:free', { pricing: null }), choice('owner/priced-target', { pricing: { prompt: '0.1', completion: '0', request: '0' } })];
    const groups = groupCatalogChoices(choices, '', category, 'target');
    expect(ids(groups)).toHaveLength(2);
    expect(groups.some(group => group.id === 'free' || group.id === 'latest')).toBe(false);
    expect(groups.flatMap(group => group.models).map(model => model.catalog?.pricingKind)).toEqual(['priced', 'uncertain']);
  });
  it('orders latest valid catalog additions, excludes invalid dates, and retains current metadata provenance', () => {
    const choices = [choice('owner/old', { created: 1760000000 }), choice('owner/new-z', { created: 1770000000 }), choice('owner/new-a', { created: 1770000000 }), choice('owner/unknown'), choice('owner/invalid', { created: -1 })];
    expect(ids(groupCatalogChoices(choices, '', 'latest', ''))).toEqual(['owner/new-a', 'owner/new-z', 'owner/old']);
    expect(choices[0].catalog).toMatchObject({ checkedAt, source: 'https://openrouter.ai/api/v1/models', createdAt: '2025-10-09T08:53:20.000Z' });
  });
  it('keeps a selected missing or filtered model without duplicate option values or an automatic switch', () => {
    const choices = [choice('openai/a'), choice('openai/a'), choice('google/b')];
    const missing = groupCatalogChoices(choices, 'retired/saved', 'free', 'absent');
    expect(ids(missing)).toEqual(['retired/saved']); expect(missing[0].id).toBe('selected'); expect(missing[0].models[0].enabled).toBe(false);
    expect(ids(groupCatalogChoices(choices, 'google/b', 'all', 'openai'))).toEqual(['google/b', 'openai/a']);
    expect(new Set(ids(groupCatalogChoices(choices, '', 'all', ''))).size).toBe(2);
  });
  it('keeps all compatible entries searchable by ID, name and human-readable namespace owner with one group per entry', () => {
    const choices = [choice('openai/a'), choice('anthropic/b'), choice('google/c'), choice('meta-llama/d'), choice('mistralai/e'), choice('openai/z', { name: 'Find This', created: 1770000000, pricing: { prompt: '0.1', completion: '0', request: '0' } }), choice('unknown/uncertain', { pricing: null })];
    expect(ids(groupCatalogChoices(choices, '', 'all', 'find this'))).toEqual(['openai/z']);
    expect(ids(groupCatalogChoices(choices, '', 'all', 'Meta'))).toEqual(['meta-llama/d']);
    expect(ids(groupCatalogChoices(choices, '', 'free', ''))).not.toContain('unknown/uncertain');
    const groups = groupCatalogChoices(choices, '', 'all', '');
    expect(groups.map(group => group.id)).toEqual(['free', 'latest', 'all']);
    expect(ids(groups)).toHaveLength(7);
  });
});
