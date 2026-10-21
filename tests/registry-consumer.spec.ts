import { describe, expect, it } from 'vitest';
import { addRegistryObservation, modelManagementRows, registryModelChoices, registryRouteMatches } from '../src/react-app/providers/registry-consumer';
import { emptyModelRegistry, observeSTTRoute, registryRouteKey, setRegistryAlias, setRegistryEnabled } from '../src/react-app/providers/model-registry';
import { getSTTModel } from '../src/react-app/providers/catalog';

const observation = observeSTTRoute({ connectionId: 'openai', provider: 'openai', stage: 'stt', modelId: 'gpt-transcribe', endpointTag: null }, getSTTModel('gpt-transcribe'));
describe('registry consumer projections', () => {
  it('keeps new discovered rows ephemeral and offers only compatible enabled workflow choices', () => {
    const empty = emptyModelRegistry(); expect(modelManagementRows(empty, [observation])[0]).toMatchObject({ userEnabled: false, status: 'new', blockedReason: null }); expect(empty.entries).toEqual([]);
    const saved = setRegistryEnabled(addRegistryObservation(empty, observation), registryRouteKey(observation.route), true);
    expect(registryModelChoices(saved, [], [{ stage: 'minutes', modelId: 'legacy/kept', endpointTag: 'legacy/route' }])).toMatchObject([{ id: 'gpt-transcribe', enabled: true }, { id: 'legacy/kept', enabled: false }]);
  });
  it('an alias cannot mutate route identity and disabling never silently selects an alternative', () => {
    const key = registryRouteKey(observation.route), saved = setRegistryAlias(setRegistryEnabled(addRegistryObservation(emptyModelRegistry(), observation), key, true), key, 'My alias');
    const disabled = setRegistryEnabled(saved, key, false); expect(registryModelChoices(disabled, [], [{ stage: 'stt', modelId: observation.route.modelId, endpointTag: null }])).toMatchObject([{ id: 'gpt-transcribe', label: 'My alias', enabled: false }]); expect(disabled.entries[0].route).toEqual(observation.route);
    expect(modelManagementRows(disabled, [])[0].blockedReason).toBeNull();
  });
  it('changed accepted metadata stays blocked even while disabled until separate acceptance', () => {
    const key = registryRouteKey(observation.route), saved = setRegistryEnabled(addRegistryObservation(emptyModelRegistry(), observation), key, true), changed = { ...saved, entries: saved.entries.map(entry => ({ ...entry, userEnabled: false, observedMetadata: { ...entry.observedMetadata, limits: { ...entry.observedMetadata.limits, maxBytes: 100 } } })) };
    expect(modelManagementRows(changed, [])[0]).toMatchObject({ metadataAcceptanceRequired: true, blockedReason: 'metadata-changed' });
  });
  it('requires exact runtime route metadata to match the accepted registry, retaining unknown rates', () => {
    const key = registryRouteKey(observation.route), saved = setRegistryEnabled(addRegistryObservation(emptyModelRegistry(), observation), key, true);
    expect(registryRouteMatches(saved, observation)).toBe(true);
    expect(registryRouteMatches(saved, { ...observation, metadata: { ...observation.metadata, pricing: { ...observation.metadata.pricing, kind: 'unknown', snapshot: null, missingDimensions: ['applicable-rates'] } } })).toBe(false);
  });
});

it('OR_STT_registry projects an enabled OR STT route without any OpenAI model lookup and preserves disabled selections', async () => {
  const { observeRouterSTTRoute } = await import('../src/react-app/providers/model-registry');
  const route = { connectionId: 'openrouter', provider: 'openrouter' as const, stage: 'stt' as const, modelId: 'openai/gpt-4o-mini-transcribe', endpointTag: null };
  const observed = observeRouterSTTRoute(route, { id: route.modelId, name: 'Synthetic Mini', source: 'https://openrouter.ai/api/v1/models', checkedAt: '2026-10-03T00:00:00.000Z', inputModalities: ['audio'], outputModalities: ['transcription'], adapterStatus: 'unsupported', pricing: { status: 'unknown', raw: null } });
  const saved = setRegistryEnabled(addRegistryObservation(emptyModelRegistry(), observed), registryRouteKey(route), true);
  expect(registryModelChoices(saved, [], [])).toMatchObject([{ id: route.modelId, provider: 'openrouter', enabled: true }]);
  expect(registryModelChoices(setRegistryEnabled(saved, registryRouteKey(route), false), [], [{ stage: 'stt', modelId: route.modelId, endpointTag: null }])).toMatchObject([{ id: route.modelId, provider: 'openrouter', enabled: false }]);
});
