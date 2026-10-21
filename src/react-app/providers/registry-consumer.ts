import type { UIModel } from '../App';
import type { ModelRegistry } from '../domain/types';
import type { ModelManagementRow } from '../ui/components/ModelManager';
import { getSTTModel } from './catalog';
import type { RouterModel } from './catalog';
import { catalogMetadata } from './model-presentation';
import { normalizeModelRegistry, projectModelRegistry, registryRouteKey, setRegistryEnabled } from './model-registry';
import type { RegistryObservation } from './model-registry';

/** Save one user-selected preference, never a discovered catalog or partial refresh. */
export function addRegistryObservation(registry: ModelRegistry, observation: RegistryObservation): ModelRegistry {
  if (registry.entries.some(entry => registryRouteKey(entry.route) === registryRouteKey(observation.route))) return registry;
  return normalizeModelRegistry({ ...registry, entries: [...registry.entries, { route: observation.route, alias: null, userEnabled: false, observedMetadata: observation.metadata, acceptedMetadata: null, refresh: { status: 'current', attemptedAt: observation.metadata.checkedAt, error: null } }] });
}
export function modelManagementRows(registry: ModelRegistry, observations: readonly RegistryObservation[]): readonly ModelManagementRow[] {
  const savedKeys = new Set(registry.entries.map(entry => registryRouteKey(entry.route)));
  const rows: ModelManagementRow[] = registry.entries.map(entry => {
    const key = registryRouteKey(entry.route);
    // An explicit enable is tested hypothetically to reveal metadata changes
    // even on disabled rows. This does not accept or save anything.
    const reason = projectModelRegistry(setRegistryEnabled(registry, key, true), entry.route.stage).blocked.find(item => item.key === key)?.reason ?? null;
    return { key, route: entry.route, metadata: entry.observedMetadata, alias: entry.alias, developer: null, userEnabled: entry.userEnabled, isDefault: registry.defaults[entry.route.stage] === key, status: entry.refresh.status, blockedReason: reason, metadataAcceptanceRequired: reason === 'metadata-changed', mayLoadEndpoints: entry.route.provider === 'openrouter' && entry.route.stage === 'minutes' && !entry.route.endpointTag };
  });
  for (const item of observations) if (!savedKeys.has(registryRouteKey(item.route))) rows.push({ key: registryRouteKey(item.route), route: item.route, metadata: item.metadata, alias: null, developer: null, userEnabled: false, isDefault: false, status: 'new', blockedReason: item.metadata.compatible ? null : item.metadata.blockers[0] ?? 'unknown-compatibility', metadataAcceptanceRequired: false, mayLoadEndpoints: item.route.provider === 'openrouter' && item.route.stage === 'minutes' && !item.route.endpointTag });
  return rows;
}
export type PreservedModel = Readonly<{ stage: 'stt' | 'minutes'; modelId: string; endpointTag: string | null }>;
/** Exact parsed metadata is checked again at preview/dispatch, so an endpoint
 * subset or ephemeral discovery cannot bypass accepted preference changes. */
export function registryRouteMatches(registry: ModelRegistry, observation: RegistryObservation): boolean {
  const key = registryRouteKey(observation.route);
  if (!registry.entries.some(entry => registryRouteKey(entry.route) === key)) return false;
  const observed = { ...registry, entries: registry.entries.map(entry => registryRouteKey(entry.route) === key ? { ...entry, observedMetadata: observation.metadata } : entry) };
  return projectModelRegistry(observed, observation.route.stage).choices.some(choice => choice.key === key);
}
/** Workflow choices are enabled compatible preferences, plus a blocked saved ID.
 * Exact parsed provider metadata remains a separate dispatch/preflight boundary.
 */
export function registryModelChoices(registry: ModelRegistry, parsedModels: readonly RouterModel[], preserved: readonly PreservedModel[]): readonly UIModel[] {
  const models: UIModel[] = [];
  for (const stage of ['stt', 'minutes'] as const) for (const choice of projectModelRegistry(registry, stage).choices) {
    if (models.some(model => model.kind === stage && model.id === choice.route.modelId)) continue;
    const parsed = parsedModels.find(model => model.id === choice.route.modelId);
    models.push({ id: choice.route.modelId, label: choice.label, kind: stage, provider: choice.route.provider, enabled: true, note: stage === 'stt' ? choice.route.provider === 'openai' ? getSTTModel(choice.route.modelId).completenessWarning ?? '' : 'Audio sent through OpenRouter to a dynamic provider; total cost unknown.' : 'Enabled in Settings; an exact checked endpoint is required.', ...(parsed ? { catalog: catalogMetadata(parsed) } : {}) });
  }
  for (const selected of preserved) {
    if (!selected.modelId || models.some(model => model.kind === selected.stage && model.id === selected.modelId)) continue;
    const entry = registry.entries.find(entry => entry.route.stage === selected.stage && entry.route.modelId === selected.modelId && (selected.stage === 'stt' || entry.route.endpointTag === selected.endpointTag));
    models.push({ id: selected.modelId, label: entry?.alias ?? entry?.observedMetadata.name ?? selected.modelId, kind: selected.stage, provider: entry?.route.provider ?? (selected.stage === 'stt' ? 'openai' : 'openrouter'), enabled: false, disabledReason: 'Enable and refresh this saved route in Settings. The selection was preserved.' });
  }
  return models;
}
