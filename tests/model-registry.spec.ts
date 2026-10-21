import { expect, it } from 'vitest';
import { parseRouterEndpoints, parseRouterModels, STT_MODELS } from '../src/react-app/providers/catalog';

const at = '2026-10-02T00:00:00.000Z';
const model = parseRouterModels({ data: [{ id: 'fixture/registry-model', name: 'Synthetic actual model name', context_length: 8000, top_provider: { max_completion_tokens: 2000 }, supported_parameters: ['max_completion_tokens'], architecture: { input_modalities: ['text'], output_modalities: ['text'] }, pricing: { prompt: '0', completion: '0', request: '0' } }] }, at)[0];
const endpoint = parseRouterEndpoints({ data: { endpoints: [{ tag: 'Synthetic/route', provider_name: 'Synthetic provider', context_length: 8000, max_prompt_tokens: 6000, max_completion_tokens: 2000, supported_parameters: ['max_completion_tokens'], pricing: { prompt: '0', completion: '0', request: '0' } }] } }, model.id, at)[0];
const route = { connectionId: 'fixture-router', provider: 'openrouter' as const, stage: 'minutes' as const, modelId: model.id, endpointTag: endpoint.tag };
const modulePath = '../src/react-app/providers/model-registry';
async function registry() {
  const imported = await import(/* @vite-ignore */ modulePath).catch(() => null);
  expect(imported, 'pure encrypted-registry preference helpers are implemented').not.toBeNull();
  return imported as typeof import('../src/react-app/providers/model-registry');
}
it('keeps alias independent from immutable route identity, enablement and stage defaults during refresh', async () => {
  const api = await registry(), observation = api.observeMinutesRoute(route, model, endpoint), key = api.registryRouteKey(route);
  const merged = api.mergeModelRegistry(api.emptyModelRegistry(), { connectionId: route.connectionId, stage: 'minutes', status: 'success', observations: [observation], checkedAt: at });
  expect(merged.entries[0].userEnabled).toBe(false);
  const enabled = api.setRegistryEnabled(merged, key, true), selected = api.setRegistryDefault(enabled, 'minutes', key);
  const aliased = api.setRegistryAlias(selected, key, 'PRIVATE_ALIAS_SENTINEL');
  expect(aliased.entries[0].route).toEqual(route); expect(aliased.defaults.minutes).toBe(key); expect(api.registryRouteKey(aliased.entries[0].route)).toBe(key);
  const refreshed = api.mergeModelRegistry(aliased, { connectionId: route.connectionId, stage: 'minutes', status: 'success', observations: [observation], checkedAt: '2026-10-02T01:00:00.000Z' });
  expect(refreshed.entries[0]).toMatchObject({ alias: 'PRIVATE_ALIAS_SENTINEL', userEnabled: true, route }); expect(refreshed.defaults).toEqual(aliased.defaults);
  expect(Object.isFrozen(refreshed.entries[0].route)).toBe(true); expect(merged.entries[0].alias).toBeNull();
});
it('includes connection/provider/model/stage/endpoint in stable identity and restores actual name when alias is cleared', async () => {
  const api = await registry(), key = api.registryRouteKey(route);
  for (const changed of [{ ...route, connectionId: 'other-connection' }, { ...route, provider: 'openai' as const }, { ...route, modelId: 'fixture/other' }, { ...route, stage: 'stt' as const }, { ...route, endpointTag: 'Synthetic/other' }]) expect(api.registryRouteKey(changed)).not.toBe(key);
  const snapshot = api.mergeModelRegistry(api.emptyModelRegistry(), { connectionId: route.connectionId, stage: 'minutes', status: 'success', observations: [api.observeMinutesRoute(route, model, endpoint)], checkedAt: at });
  const enabled = api.setRegistryEnabled(snapshot, key, true), aliased = api.setRegistryAlias(enabled, key, 'Personal nickname');
  expect(api.projectModelRegistry(aliased, 'minutes').choices[0].label).toBe('Personal nickname');
  expect(api.projectModelRegistry(api.setRegistryAlias(aliased, key, null), 'minutes').choices[0].label).toBe(model.name);
});
it('preserves accepted pricing and defaults while new observations mark a changed exact route', async () => {
  const api = await registry(), key = api.registryRouteKey(route), observation = api.observeMinutesRoute(route, model, endpoint);
  const snapshot = api.setRegistryDefault(api.setRegistryEnabled(api.mergeModelRegistry(api.emptyModelRegistry(), { connectionId: route.connectionId, stage: 'minutes', status: 'success', observations: [observation], checkedAt: at }), key, true), 'minutes', key);
  const changed = api.observeMinutesRoute(route, model, { ...endpoint, pricing: { prompt: 0.01, completion: 0.02, request: 0 }, pricingMetadata: { ...endpoint.pricingMetadata, rates: { prompt: 0.01, completion: 0.02, request: 0 } } });
  const refreshed = api.mergeModelRegistry(snapshot, { connectionId: route.connectionId, stage: 'minutes', status: 'success', observations: [changed], checkedAt: '2026-10-02T01:00:00.000Z' });
  expect(refreshed.defaults.minutes).toBe(key); expect(refreshed.entries[0].acceptedMetadata).toEqual(snapshot.entries[0].acceptedMetadata); expect(refreshed.entries[0].observedMetadata).not.toEqual(refreshed.entries[0].acceptedMetadata);
  expect(api.projectModelRegistry(refreshed, 'minutes')).toMatchObject({ defaultKey: key, defaultBlocker: 'metadata-changed', choices: [] });
  expect(api.projectModelRegistry(api.acceptRegistryMetadata(refreshed, key), 'minutes').choices[0]).toMatchObject({ key, isDefault: true });
});
it('refresh neither enables a new candidate nor changes aliases/defaults, and missing/failed results retain evidence', async () => {
  const api = await registry(), key = api.registryRouteKey(route), observation = api.observeMinutesRoute(route, model, endpoint);
  const original = api.setRegistryAlias(api.setRegistryDefault(api.setRegistryEnabled(api.mergeModelRegistry(api.emptyModelRegistry(), { connectionId: route.connectionId, stage: 'minutes', status: 'success', observations: [observation], checkedAt: at }), key, true), 'minutes', key), key, 'Saved alias');
  const newcomerRoute = { ...route, endpointTag: 'Synthetic/new' }, newcomer = api.observeMinutesRoute(newcomerRoute, model, { ...endpoint, tag: newcomerRoute.endpointTag });
  const absent = api.mergeModelRegistry(original, { connectionId: route.connectionId, stage: 'minutes', status: 'success', observations: [newcomer], checkedAt: '2026-10-02T01:00:00.000Z' });
  expect(absent.entries.find(entry => api.registryRouteKey(entry.route) === key)).toMatchObject({ userEnabled: true, alias: 'Saved alias', refresh: { status: 'unavailable' }, observedMetadata: observation.metadata });
  expect(absent.entries.find(entry => entry.route.endpointTag === newcomerRoute.endpointTag)?.userEnabled).toBe(false); expect(absent.defaults).toEqual(original.defaults);
  expect(api.projectModelRegistry(absent, 'minutes').defaultBlocker).toBe('unavailable');
  const failed = api.mergeModelRegistry(original, { connectionId: route.connectionId, stage: 'minutes', status: 'failed', observations: [], checkedAt: '2026-10-02T02:00:00.000Z' });
  expect(failed.entries[0]).toMatchObject({ observedMetadata: observation.metadata, refresh: { status: 'stale', error: 'refresh-failed' } }); expect(failed.lastCheckedAt).toBe(original.lastCheckedAt); expect(failed.defaults).toEqual(original.defaults);
});
it('keeps zero, missing and conditional rates distinct and uses only shared exact completion support', async () => {
  const api = await registry(); expect(api.observeMinutesRoute(route, model, endpoint).metadata.pricing.kind).toBe('zero');
  const unknown = parseRouterEndpoints({ data: { endpoints: [{ ...endpoint, tag: endpoint.tag, context_length: 8000, max_prompt_tokens: 6000, max_completion_tokens: 2000, supported_parameters: ['max_completion_tokens'], pricing: { prompt: '0', completion: '0' } }] } }, model.id, at)[0];
  expect(api.observeMinutesRoute(route, model, unknown).metadata.pricing.kind).toBe('unknown');
  const conditional = { ...endpoint, pricingMetadata: { ...endpoint.pricingMetadata, complete: false, conditionalDimensions: ['tiers'] } };
  expect(api.observeMinutesRoute(route, model, conditional).metadata.pricing.kind).toBe('unknown');
  expect(api.observeMinutesRoute(route, model, { ...endpoint, supportedParameters: ['max_tokens'] }).metadata).toMatchObject({ compatible: false, completionParameter: null });
  expect(api.observeMinutesRoute(route, model, null).metadata.compatible).toBe(false);
});
it('keeps OpenRouter STT unsupported without blocking an OpenRouter-only minutes configuration', async () => {
  const api = await registry(), unsupportedRoute = { ...route, stage: 'stt' as const, endpointTag: null };
  const unsupported = api.observeUnsupportedRoute(unsupportedRoute, { name: 'Synthetic audio catalog indication', source: model.source, checkedAt: at });
  let snapshot = api.mergeModelRegistry(api.emptyModelRegistry(), { connectionId: route.connectionId, stage: 'stt', status: 'success', observations: [unsupported], checkedAt: at });
  snapshot = api.setRegistryEnabled(snapshot, api.registryRouteKey(unsupportedRoute), true);
  expect(api.projectModelRegistry(snapshot, 'stt').choices).toEqual([]); expect(() => api.setRegistryDefault(snapshot, 'stt', api.registryRouteKey(unsupportedRoute))).toThrow(/unsupported/i);
  snapshot = api.mergeModelRegistry(snapshot, { connectionId: route.connectionId, stage: 'minutes', status: 'success', observations: [api.observeMinutesRoute(route, model, endpoint)], checkedAt: at });
  snapshot = api.setRegistryEnabled(snapshot, api.registryRouteKey(route), true); expect(api.projectModelRegistry(snapshot, 'minutes').choices).toHaveLength(1);
});
it('maintains independent stage defaults and never replaces a disabled selected route', async () => {
  const api = await registry(), stt = STT_MODELS[0], sttRoute = { connectionId: 'openai', provider: 'openai' as const, stage: 'stt' as const, modelId: stt.id, endpointTag: null };
  let snapshot = api.mergeModelRegistry(api.emptyModelRegistry(), { connectionId: 'openai', stage: 'stt', status: 'success', observations: [api.observeSTTRoute(sttRoute, stt)], checkedAt: at });
  snapshot = api.setRegistryDefault(api.setRegistryEnabled(snapshot, api.registryRouteKey(sttRoute), true), 'stt', api.registryRouteKey(sttRoute));
  snapshot = api.mergeModelRegistry(snapshot, { connectionId: route.connectionId, stage: 'minutes', status: 'success', observations: [api.observeMinutesRoute(route, model, endpoint)], checkedAt: at });
  snapshot = api.setRegistryDefault(api.setRegistryEnabled(snapshot, api.registryRouteKey(route), true), 'minutes', api.registryRouteKey(route));
  expect(() => api.setRegistryDefault(snapshot, 'minutes', api.registryRouteKey(sttRoute))).toThrow();
  const disabled = api.setRegistryEnabled(snapshot, api.registryRouteKey(route), false); expect(disabled.defaults).toEqual(snapshot.defaults); expect(api.projectModelRegistry(disabled, 'minutes').defaultBlocker).toBe('disabled');
});
it('requires explicit source/date retirement evidence and detaches bounded snapshots without persisting arbitrary responses', async () => {
  const api = await registry(), key = api.registryRouteKey(route), observation = api.observeMinutesRoute(route, model, endpoint, { retirement: { retiredOn: '2026-09-30', source: 'https://fixture.invalid/lifecycle', checkedAt: at } });
  const snapshot = api.setRegistryEnabled(api.mergeModelRegistry(api.emptyModelRegistry(), { connectionId: route.connectionId, stage: 'minutes', status: 'success', observations: [observation], checkedAt: at }), key, true);
  expect(api.projectModelRegistry(snapshot, 'minutes').blocked[0].reason).toBe('retired');
  expect(() => api.observeMinutesRoute(route, model, endpoint, { retirement: { retiredOn: '2026-09-30', source: '', checkedAt: at } })).toThrow();
  const mutable = structuredClone(snapshot), normalized = api.normalizeModelRegistry(mutable); expect(Object.isFrozen(mutable.entries[0])).toBe(false); expect(Object.isFrozen(normalized.entries[0].observedMetadata)).toBe(true);
  expect(() => api.normalizeModelRegistry({ ...mutable, apiKey: 'SYNTHETIC_UNSUPPORTED_SECRET_FIELD' } as unknown as typeof snapshot)).toThrow();
  expect(() => api.setRegistryAlias(snapshot, key, '😀'.repeat(65))).toThrow();
  const giant = Array.from({ length: api.MODEL_REGISTRY_MAX_ENTRIES + 1 }, (_, i) => ({ ...observation, route: { ...route, connectionId: `connection-${i}` } }));
  expect(() => api.mergeModelRegistry(api.emptyModelRegistry(), { connectionId: route.connectionId, stage: 'minutes', status: 'success', observations: giant, checkedAt: at })).toThrow();
});
it('rejects rolled-over lifecycle dates and oversized dates before treating them as sourced evidence', async () => {
  const api = await registry();
  expect(() => api.observeMinutesRoute(route, model, endpoint, { retirement: { retiredOn: '2026-02-31', source: 'https://fixture.invalid/lifecycle', checkedAt: at } })).toThrow();
  expect(() => api.normalizeModelRegistry({ ...api.emptyModelRegistry(), lastCheckedAt: at + ' '.repeat(1024) })).toThrow();
});
it('bounds the selected registry by encoded bytes even when the entry count and individual fields fit', async () => {
  const api = await registry(), metadata = api.observeMinutesRoute(route, model, endpoint).metadata;
  const entries = Array.from({ length: api.MODEL_REGISTRY_MAX_ENTRIES }, (_, i) => {
    const identity = { ...route, endpointTag: `Synthetic/${i}` };
    return { route: identity, alias: null, userEnabled: false, observedMetadata: { ...metadata, route: identity, warnings: Array.from({ length: 32 }, () => 'x'.repeat(256)) }, acceptedMetadata: null, refresh: { status: 'current' as const, attemptedAt: at, error: null } };
  });
  const value = { ...api.emptyModelRegistry(), entries };
  expect(new TextEncoder().encode(JSON.stringify(value)).byteLength).toBeGreaterThan(api.MODEL_REGISTRY_MAX_BYTES);
  expect(() => api.normalizeModelRegistry(value)).toThrow(/oversized/);
});
it('requires explicit acceptance when the rate currency changes with otherwise equal prices', async () => {
  const api = await registry(), stt = STT_MODELS[0], identity = { connectionId: 'synthetic-openai', provider: 'openai' as const, stage: 'stt' as const, modelId: stt.id, endpointTag: null }, key = api.registryRouteKey(identity);
  const observed = api.mergeModelRegistry(api.emptyModelRegistry(), { connectionId: identity.connectionId, stage: 'stt', status: 'success', observations: [api.observeSTTRoute(identity, stt)], checkedAt: at });
  const accepted = api.setRegistryDefault(api.setRegistryEnabled(observed, key, true), 'stt', key);
  const changed = api.mergeModelRegistry(accepted, { connectionId: identity.connectionId, stage: 'stt', status: 'success', observations: [api.observeSTTRoute(identity, { ...stt, rateSnapshot: { ...stt.rateSnapshot, currency: 'EUR' } })], checkedAt: at });
  expect(api.projectModelRegistry(changed, 'stt')).toMatchObject({ defaultKey: key, defaultBlocker: 'metadata-changed', choices: [] });
  expect(changed.entries[0].acceptedMetadata?.pricing.snapshot?.currency).toBe('USD');
});

it('OR_STT_registry discovery keeps supported profiles disabled with defaults unchanged and accepts additive rate units', async () => {
  const api = await registry(), route = { connectionId: 'openrouter', provider: 'openrouter' as const, stage: 'stt' as const, modelId: 'openai/gpt-4o-mini-transcribe', endpointTag: null };
  const observation = api.observeRouterSTTRoute(route, { id: route.modelId, name: 'Synthetic Mini', source: 'https://openrouter.ai/api/v1/models', checkedAt: at, inputModalities: ['audio'], outputModalities: ['transcription'], adapterStatus: 'unsupported', pricing: { status: 'unknown', raw: { prompt: '0.000001', completion: '0.000002' } } });
  const merged = api.mergeModelRegistry(api.emptyModelRegistry(), { connectionId: route.connectionId, stage: 'stt', status: 'success', observations: [observation], checkedAt: at });
  expect(merged.entries[0].userEnabled).toBe(false); expect(merged.defaults).toEqual({ stt: null, minutes: null }); expect(observation.metadata.pricing.kind).toBe('unknown'); expect(observation.metadata.pricing.snapshot!.rates.map(rate => rate.unit)).toEqual(['input-token', 'output-token']);
  expect(api.projectModelRegistry(api.setRegistryEnabled(merged, api.registryRouteKey(route), true), 'stt').choices[0].route).toEqual(route);
});
it('OR_STT_registry preserves explicitly cleared defaults and disabled choices across discovery refresh', async () => {
  const api = await registry(), route = { connectionId: 'openrouter', provider: 'openrouter' as const, stage: 'stt' as const, modelId: 'openai/whisper-large-v3', endpointTag: null };
  const observation = api.observeRouterSTTRoute(route, { id: route.modelId, name: 'Synthetic Whisper', source: 'https://openrouter.ai/api/v1/models', checkedAt: at, inputModalities: ['audio'], outputModalities: ['transcription'], adapterStatus: 'unsupported', pricing: { status: 'unknown', raw: null } });
  const merged = api.mergeModelRegistry(api.emptyModelRegistry(), { connectionId: route.connectionId, stage: 'stt', status: 'success', observations: [observation], checkedAt: at });
  const key = api.registryRouteKey(route), cleared = api.setRegistryDefault(api.setRegistryDefault(api.setRegistryEnabled(merged, key, true), 'stt', key), 'stt', null), disabled = api.setRegistryEnabled(cleared, key, false);
  const refreshed = api.mergeModelRegistry(disabled, { connectionId: route.connectionId, stage: 'stt', status: 'success', observations: [observation], checkedAt: at });
  expect(refreshed.defaults.stt).toBeNull(); expect(refreshed.entries[0].userEnabled).toBe(false);
});
it.each(['policy-extra', 'allow', 'zdr-type', 'version', 'connection', 'extra', 'standard-unacknowledged'] as const)('OR_STT_registry rejects invalid %s preferences', async field => {
  const api = await registry(); const preference = { policy: { dataCollection: 'deny', requireZdr: true }, acknowledgedDisclosureVersion: 'or-stt-1', initialDefaultApplied: false };
  const changed = field === 'policy-extra' ? { ...preference, policy: { ...preference.policy, only: ['private/pin'] } } : field === 'allow' ? { ...preference, policy: { dataCollection: 'allow', requireZdr: true } } : field === 'zdr-type' ? { ...preference, policy: { dataCollection: 'deny', requireZdr: 'true' } } : field === 'version' ? { ...preference, acknowledgedDisclosureVersion: 'future' } : field === 'extra' ? { ...preference, key: 'SYNTHETIC_FORBIDDEN' } : field === 'standard-unacknowledged' ? { ...preference, policy: { dataCollection: 'deny', requireZdr: false }, acknowledgedDisclosureVersion: null } : preference;
  expect(() => api.normalizeModelRegistry({ ...api.emptyModelRegistry(), openRouterSTT: { [field === 'connection' ? 'invalid\nconnection' : 'openrouter']: changed } } as unknown as import('../src/react-app/domain/types').ModelRegistry)).toThrow();
});
it.each([['audio', 'text', undefined], ['text', 'transcription', undefined], ['audio', 'transcription', 'unknown/alias']] as const)('OR_STT_registry blocks unsupported observed profile %s/%s', async (input, output, id) => {
 const api = await registry(), route = { connectionId: 'openrouter', provider: 'openrouter' as const, stage: 'stt' as const, modelId: id ?? 'openai/gpt-4o-mini-transcribe', endpointTag: null };
 const observation = api.observeRouterSTTRoute(route, { id: route.modelId, name: 'Synthetic', source: 'https://openrouter.ai/api/v1/models', checkedAt: at, inputModalities: [input], outputModalities: [output], adapterStatus: 'unsupported', pricing: { status: 'unknown', raw: null } });
 expect(observation.metadata.compatible).toBe(false); expect(observation.metadata.blockers).toEqual(['unsupported-adapter']);
});
