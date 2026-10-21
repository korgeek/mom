import { asObject } from '../domain/pipeline';
import { previewMinutesSelection, type MinutesSelectionPreview } from '../minutes/selection';
import { canonicalizeRouterModels } from './model-presentation';
import { freezeMetadata, hasCompletionCeilingParameter, selectCompletionParameter, validModelId } from './catalog';
import type { RouterEndpoint, RouterModel } from './catalog';
import type { ChatMessage } from './openrouter';
import { hasMinutesEndpointLimits } from './openrouter';

export type ExplicitMinutesChoice = Readonly<{ provider: 'openai' | 'openrouter'; modelId: string; endpointTag: string | null }>;
export type MinutesRecommendationOptions = Readonly<{
  models: readonly RouterModel[]; endpoints: readonly RouterEndpoint[];
  messages: readonly ChatMessage[] | null; outputTokens: number | null; reasoningReserveTokens: number;
  selected: ExplicitMinutesChoice | null; evaluatedAt: string;
}>;
export type MinutesModelRecommendation = Readonly<{
  modelId: string; modelName: string; endpointTag: string | null; providerName: string | null;
  state: 'eligible' | 'pending-endpoint'; estimatedCost: number | null;
  reason: 'lowest-known-estimated-cost' | 'known-cost-alternative' | 'pending-endpoint-verification';
  evaluatedAt: string;
  metadata: Readonly<{ model: Readonly<{ source: string; checkedAt: string }>; endpoint: Readonly<{ source: string; checkedAt: string }> | null }>;
  preview: MinutesSelectionPreview;
}>;
export type MinutesRecommendationBlocker = Readonly<{ modelId: string; endpointTag: string | null; reason: string; preview: MinutesSelectionPreview | null }>;
export type MinutesRecommendations = Readonly<{
  status: 'available' | 'pending-endpoints' | 'unavailable'; reason: string;
  selected: ExplicitMinutesChoice | null; defaultChoice: MinutesModelRecommendation | null;
  choices: readonly MinutesModelRecommendation[]; blockers: readonly MinutesRecommendationBlocker[];
}>;
const LIMIT = 5;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const knownLimit = (value: number | null) => value !== null && Number.isSafeInteger(value) && value > 0;
const knownDate = (value: string) => !!value.trim() && Number.isFinite(Date.parse(value));
const dated = (owner: { source: string; checkedAt: string }) => !!owner.source.trim() && knownDate(owner.checkedAt);
function stableSignature(value: unknown): string {
  return JSON.stringify(value, (_key, entry) => {
    const object = asObject(entry);
    return object ? Object.fromEntries(Object.keys(object).sort().map(key => [key, object[key]])) : entry;
  });
}
function endpointSignature(endpoint: RouterEndpoint): string {
  const metadata = endpoint.pricingMetadata, raw = asObject(metadata.raw) ?? {};
  return stableSignature({
    providerName: endpoint.providerName, context: endpoint.contextTokens, prompt: endpoint.maxPromptTokens, output: endpoint.maxOutputTokens,
    parameters: [...new Set(endpoint.supportedParameters)].sort(), pricing: endpoint.pricing,
    metadata: { rates: metadata.rates, complete: metadata.complete, missing: [...metadata.missingDimensions].sort(), unsupported: [...metadata.unsupportedDimensions].sort(), conditional: [...metadata.conditionalDimensions].sort(), extras: Object.fromEntries(Object.entries(raw).filter(([key]) => !['prompt', 'completion', 'request'].includes(key))) },
    capabilities: endpoint.capabilityMetadata ? { reasoningBehavior: endpoint.capabilityMetadata.reasoningBehavior, defaultParameters: endpoint.capabilityMetadata.defaultParameters, expirationDate: endpoint.capabilityMetadata.expirationDate, raw: endpoint.capabilityMetadata.raw } : null,
  });
}
function applicableKnownPrice(endpoint: RouterEndpoint): boolean {
  const metadata = endpoint.pricingMetadata, price = endpoint.pricing;
  // Flat rates cannot establish cache/tier applicability, missing request charges,
  // unsupported dimensions or contradictory snapshots. Unknown never means free.
  return !!price && metadata.complete && !metadata.missingDimensions.length && !metadata.unsupportedDimensions.length && !metadata.conditionalDimensions.length
    && (['prompt', 'completion', 'request'] as const).every(key => price[key] !== null && Number.isFinite(price[key]) && price[key]! >= 0 && price[key] === metadata.rates[key]);
}

/** Pure suggestions, never a provider switch, paid fallback, quality rank or cost ceiling. */
export function recommendMinutesModels(options: MinutesRecommendationOptions): MinutesRecommendations {
  const selected = options.selected ? { ...options.selected } : null;
  const unavailable = (reason: string): MinutesRecommendations => freezeMetadata({ status: 'unavailable', reason, selected, defaultChoice: null, choices: [], blockers: [] });
  if (!knownDate(options.evaluatedAt)) return unavailable('invalid-recommendation-date');
  if (options.messages === null || !options.messages.length) return unavailable('missing-transcript');
  if (!knownLimit(options.outputTokens)) return unavailable('missing-output-budget');
  if (options.reasoningReserveTokens !== 0) return unavailable('unsupported-reasoning-reserve');

  // Clone before shared canonicalization: it freezes its result, not caller state.
  const models = canonicalizeRouterModels([...structuredClone(options.models)].sort((a, b) => compare(a.id, b.id) || compare(b.checkedAt, a.checkedAt) || compare(a.source, b.source)));
  const endpoints = [...structuredClone(options.endpoints)].sort((a, b) => compare(a.modelId, b.modelId) || compare(a.tag, b.tag) || compare(b.checkedAt, a.checkedAt) || compare(a.source, b.source));
  const groups = new Map<string, RouterEndpoint[]>();
  for (const endpoint of endpoints) { const key = JSON.stringify([endpoint.modelId, endpoint.tag]), group = groups.get(key) ?? []; group.push(endpoint); groups.set(key, group); }
  const eligible: MinutesModelRecommendation[] = [], pending: MinutesModelRecommendation[] = [], blockers: MinutesRecommendationBlocker[] = [];
  const block = (model: RouterModel, endpoint: RouterEndpoint | null, reason: string, preview: MinutesSelectionPreview | null = null) => blockers.push({ modelId: model.id, endpointTag: endpoint?.tag ?? null, reason, preview });
  for (const model of models) {
    if (!validModelId(model.id)) { block(model, null, 'invalid-model-identity'); continue; }
    if (model.catalogConflict?.length) { block(model, null, 'conflicting-model-metadata'); continue; }
    if (!model.inputModalities.includes('text') || !model.outputModalities.includes('text')) { block(model, null, 'unknown-text-support'); continue; }
    if (!knownLimit(model.contextTokens) || !knownLimit(model.maxOutputTokens)) { block(model, null, 'missing-limits'); continue; }
    if (!dated(model)) { block(model, null, 'metadata-date-unavailable'); continue; }
    if (model.perRequestLimits !== null && (!asObject(model.perRequestLimits) || Object.keys(asObject(model.perRequestLimits)!).length)) { block(model, null, 'uninterpreted-request-limits'); continue; }
    if (!hasCompletionCeilingParameter(model)) { block(model, null, 'shared-completion-parameter-unavailable'); continue; }
    if (options.outputTokens! > model.maxOutputTokens!) { block(model, null, 'overflow'); continue; }
    const exactGroups = [...groups.values()].filter(group => group[0].modelId === model.id);
    if (!exactGroups.length) {
      const preview = previewMinutesSelection({ model, endpoint: null, messages: options.messages, outputTokens: options.outputTokens, reasoningReserveTokens: options.reasoningReserveTokens });
      pending.push({ modelId: model.id, modelName: model.name, endpointTag: null, providerName: null, state: 'pending-endpoint', estimatedCost: null, reason: 'pending-endpoint-verification', evaluatedAt: options.evaluatedAt, metadata: { model: { source: model.source, checkedAt: model.checkedAt }, endpoint: null }, preview });
      continue;
    }
    for (const group of exactGroups) {
      const endpoint = group[0];
      if (!endpoint.tag.trim() || /[\r\n]/u.test(endpoint.tag)) { block(model, endpoint, 'invalid-endpoint-identity'); continue; }
      if (!group.every(entry => endpointSignature(entry) === endpointSignature(endpoint))) { block(model, endpoint, 'conflicting-endpoint-metadata'); continue; }
      if (!selectCompletionParameter(model, endpoint)) { block(model, endpoint, 'shared-completion-parameter-unavailable'); continue; }
      if (!hasMinutesEndpointLimits(model, endpoint)) { block(model, endpoint, 'missing-limits'); continue; }
      if (!dated(endpoint)) { block(model, endpoint, 'metadata-date-unavailable'); continue; }
      const preview = previewMinutesSelection({ model, endpoint, messages: options.messages, outputTokens: options.outputTokens, reasoningReserveTokens: options.reasoningReserveTokens });
      if (preview.status !== 'fits') { block(model, endpoint, preview.status, preview); continue; }
      if (!applicableKnownPrice(endpoint) || preview.projection.total === null || !Number.isFinite(preview.projection.total)) { block(model, endpoint, 'unknown-or-conditional-cost'); continue; }
      eligible.push({ modelId: model.id, modelName: model.name, endpointTag: endpoint.tag, providerName: endpoint.providerName, state: 'eligible', estimatedCost: preview.projection.total, reason: 'known-cost-alternative', evaluatedAt: options.evaluatedAt, metadata: { model: { source: model.source, checkedAt: model.checkedAt }, endpoint: { source: endpoint.source, checkedAt: endpoint.checkedAt } }, preview });
    }
  }
  eligible.sort((a, b) => a.estimatedCost! - b.estimatedCost! || compare(a.modelId, b.modelId) || compare(a.endpointTag!, b.endpointTag!));
  if (eligible.length) eligible[0] = { ...eligible[0], reason: 'lowest-known-estimated-cost' };
  const choices = [...eligible, ...pending].slice(0, LIMIT);
  blockers.sort((a, b) => compare(a.modelId, b.modelId) || compare(a.endpointTag ?? '', b.endpointTag ?? '') || compare(a.reason, b.reason));
  // An existing explicit selection is authoritative even when absent from metadata.
  // The consumer can display suggestions, but receives no automatic replacement.
  return freezeMetadata({ status: eligible.length ? 'available' : pending.length ? 'pending-endpoints' : 'unavailable', reason: selected ? 'explicit-choice-preserved' : eligible.length ? 'known-cost-fit' : pending.length ? 'pending-endpoint-verification' : 'no-safe-candidate', selected, defaultChoice: selected ? null : eligible[0] ?? null, choices, blockers: blockers.slice(0, LIMIT) });
}
