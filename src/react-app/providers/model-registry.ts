import type { ModelRegistry, ModelRegistryEntry, ModelRegistryMetadata, ModelRegistryRoute, RegisteredModelRoute, RateSnapshot, RouterSTTPreference } from '../domain/types';
import { lookupRouterSTTProfile, resolveRouterSTTProfile, routerSTTRateSnapshot } from './stt-catalog';
import type { DiscoveredSTTModel } from './discovery';
import { asObject } from '../domain/pipeline';
import { previewMinutesSelection } from '../minutes/selection';
import { freezeMetadata, getSTTModel, selectCompletionParameter, validModelId } from './catalog';
import type { RouterEndpoint, RouterModel, STTModel } from './catalog';
import { hasMinutesEndpointLimits } from './openrouter';
export const MODEL_REGISTRY_MAX_ENTRIES = 50;
export const MODEL_REGISTRY_MAX_BYTES = 128 * 1024;
const encoder = new TextEncoder();
const invalid = (): never => { throw new Error('Invalid or oversized model registry'); };
const date = (value: unknown): value is string => typeof value === 'string' && value.length <= 64 && !!value && Number.isFinite(Date.parse(value));
const text = (value: unknown, limit = 256): value is string => typeof value === 'string' && !!value.trim() && encoder.encode(value).byteLength <= limit;
const cap = (value: unknown) => value === null || typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
    const object = asObject(value);
    if (!object)
        return invalid();
    if (![Object.prototype, null].includes(Object.getPrototypeOf(object)) || Object.getOwnPropertySymbols(object).length || Object.keys(object).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(object, key)))
        invalid();
    return object;
}
function list(value: unknown): void {
    if (!Array.isArray(value) || value.length > 32 || value.some(entry => !text(entry, 256)))
        invalid();
}
function validateRoute(route: ModelRegistryRoute | RegisteredModelRoute): void {
    exact(route, ['connectionId', 'provider', 'stage', 'modelId', 'endpointTag']);
    if (!text(route.connectionId, 128) || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u.test(route.connectionId) || !['openai', 'openrouter'].includes(route.provider) || !['stt', 'minutes'].includes(route.stage) || !text(route.modelId) || route.endpointTag !== null && (!text(route.endpointTag) || /[\r\n]/u.test(route.endpointTag)))
        invalid();
}
/** Alias is deliberately absent: a rename cannot change route/default/history identity. */
export function registryRouteKey(route: ModelRegistryRoute | RegisteredModelRoute): string {
    validateRoute(route);
    return JSON.stringify([route.connectionId, route.provider, route.modelId, route.stage, route.endpointTag]);
}
function implemented(route: ModelRegistryRoute): boolean {
    if (route.provider === 'openrouter' && route.stage === 'stt' && route.endpointTag === null)
        return !!lookupRouterSTTProfile(`openrouter-stt-json:${route.modelId}`, route.modelId);
    if (route.provider === 'openrouter' && route.stage === 'minutes')
        return validModelId(route.modelId);
    if (route.provider === 'openai' && route.stage === 'stt' && route.endpointTag === null) {
        try {
            getSTTModel(route.modelId);
            return true;
        }
        catch {
            return false;
        }
    }
    return false;
}
function validateProvenance(value: unknown, content: 'text' | 'retiredOn'): void {
    const object = exact(value, [content, 'source', 'checkedAt']);
    if (!text(object[content], content === 'text' ? 1024 : 64) || !text(object.source, 2048) || !date(object.checkedAt))
        invalid();
    if (content === 'retiredOn' && (!date(object.retiredOn) || !/^\d{4}-\d{2}-\d{2}$/u.test(object.retiredOn as string) || new Date(object.retiredOn as string).toISOString().slice(0, 10) !== object.retiredOn))
        invalid();
}
function validateRates(value: RateSnapshot): void {
    exact(value, ['source', 'checkedAt', 'currency', 'rates']);
    if (!text(value.source, 2048) || !date(value.checkedAt) || !text(value.currency, 16) || !Array.isArray(value.rates) || !value.rates.length || value.rates.length > 8)
        invalid();
    for (const rate of value.rates) {
        exact(rate, ['unit', 'units', 'price']);
        if (!['input-token', 'output-token', 'text-input-token', 'text-output-token', 'audio-input-token', 'audio-output-token', 'audio-second', 'request'].includes(rate.unit) || !Number.isSafeInteger(rate.units) || rate.units <= 0 || !Number.isFinite(rate.price) || rate.price < 0)
            invalid();
    }
}
function validateMetadata(metadata: ModelRegistryMetadata, route: ModelRegistryRoute): void {
    exact(metadata, ['route', 'name', 'source', 'checkedAt', 'endpointSource', 'endpointCheckedAt', 'compatible', 'blockers', 'warnings', 'inputModalities', 'outputModalities', 'modelSupportedParameters', 'endpointSupportedParameters', 'completionParameter', 'limits', 'pricing', 'description', 'retirement']);
    if (registryRouteKey(metadata.route) !== registryRouteKey(route) || !text(metadata.name, 512) || !text(metadata.source, 2048) || !date(metadata.checkedAt) || typeof metadata.compatible !== 'boolean' || metadata.endpointSource !== null && !text(metadata.endpointSource, 2048) || metadata.endpointCheckedAt !== null && !date(metadata.endpointCheckedAt) || ![null, 'max_tokens', 'max_completion_tokens'].includes(metadata.completionParameter))
        invalid();
    for (const values of [metadata.blockers, metadata.warnings, metadata.inputModalities, metadata.outputModalities, metadata.modelSupportedParameters, metadata.endpointSupportedParameters])
        list(values);
    exact(metadata.limits, ['maxBytes', 'contextTokens', 'maxPromptTokens', 'maxOutputTokens']);
    if (Object.values(metadata.limits).some(value => !cap(value)))
        invalid();
    exact(metadata.pricing, ['kind', 'snapshot', 'missingDimensions', 'unsupportedDimensions', 'conditionalDimensions']);
    if (!['zero', 'priced', 'unknown'].includes(metadata.pricing.kind))
        invalid();
    for (const values of [metadata.pricing.missingDimensions, metadata.pricing.unsupportedDimensions, metadata.pricing.conditionalDimensions])
        list(values);
    if (metadata.pricing.snapshot !== null)
        validateRates(metadata.pricing.snapshot);
    if (metadata.pricing.kind !== 'unknown' && (!metadata.pricing.snapshot || metadata.pricing.missingDimensions.length || metadata.pricing.unsupportedDimensions.length || metadata.pricing.conditionalDimensions.length || (metadata.pricing.kind === 'zero') !== metadata.pricing.snapshot.rates.every(rate => rate.price === 0)))
        invalid();
    if (metadata.description !== null)
        validateProvenance(metadata.description, 'text');
    if (metadata.retirement !== null)
        validateProvenance(metadata.retirement, 'retiredOn');
    if (metadata.compatible && (!implemented(route) || metadata.blockers.length))
        invalid();
    if (metadata.compatible && route.provider === 'openrouter' && route.stage === 'stt' && (!metadata.inputModalities.includes('audio') || !metadata.outputModalities.includes('transcription') || route.endpointTag !== null || metadata.limits.maxBytes === null || metadata.limits.maxBytes > 16_000_000)) invalid();
    if (metadata.compatible && route.stage === 'minutes' && (!route.endpointTag || !metadata.inputModalities.includes('text') || !metadata.outputModalities.includes('text') || !metadata.completionParameter || !metadata.modelSupportedParameters.includes(metadata.completionParameter) || !metadata.endpointSupportedParameters.includes(metadata.completionParameter) || [metadata.limits.contextTokens, metadata.limits.maxOutputTokens].some(value => value === null)))
        invalid();
}
/** Acknowledgment belongs to this exact policy version inside the encrypted registry. */
export function normalizeRouterSTTPreference(preference: RouterSTTPreference): RouterSTTPreference {
    exact(preference, ['policy', 'acknowledgedDisclosureVersion', 'initialDefaultApplied']);
    exact(preference.policy, ['dataCollection', 'requireZdr']);
    if (preference.policy.dataCollection !== 'deny' || typeof preference.policy.requireZdr !== 'boolean' ||
        ![null, 'or-stt-1'].includes(preference.acknowledgedDisclosureVersion) || typeof preference.initialDefaultApplied !== 'boolean' ||
        (!preference.policy.requireZdr || preference.initialDefaultApplied) && preference.acknowledgedDisclosureVersion !== 'or-stt-1') invalid();
    return freezeMetadata(structuredClone(preference));
}
/** Detached, exact-schema preferences only; never persist an entire discovery response. */
export function normalizeModelRegistry(registry: ModelRegistry): ModelRegistry {
    exact(registry, ['version', 'entries', 'defaults', 'lastCheckedAt', ...(Object.prototype.hasOwnProperty.call(registry, 'openRouterSTT') ? ['openRouterSTT'] : [])]);
    if (Object.prototype.hasOwnProperty.call(registry, 'openRouterSTT')) {
        const preferences = asObject(registry.openRouterSTT);
        if (!preferences) return invalid();
        if (![Object.prototype, null].includes(Object.getPrototypeOf(preferences)) || Object.getOwnPropertySymbols(preferences).length || Object.keys(preferences).length > 32) invalid();
        for (const [connectionId, preference] of Object.entries(preferences)) {
            if (!text(connectionId, 128) || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u.test(connectionId) || ['__proto__', 'constructor', 'prototype'].includes(connectionId)) invalid();
            normalizeRouterSTTPreference(preference as RouterSTTPreference);
        }
    }
    if (registry.version !== 1 || !Array.isArray(registry.entries) || registry.entries.length > MODEL_REGISTRY_MAX_ENTRIES || registry.lastCheckedAt !== null && !date(registry.lastCheckedAt))
        invalid();
    exact(registry.defaults, ['stt', 'minutes']);
    const keys = new Map<string, ModelRegistryEntry>();
    for (const entry of registry.entries) {
        exact(entry, ['route', 'alias', 'userEnabled', 'observedMetadata', 'acceptedMetadata', 'refresh']);
        const key = registryRouteKey(entry.route);
        if (keys.has(key) || typeof entry.userEnabled !== 'boolean' || entry.alias !== null && !text(entry.alias))
            invalid();
        keys.set(key, entry);
        validateMetadata(entry.observedMetadata, entry.route);
        if (entry.acceptedMetadata !== null)
            validateMetadata(entry.acceptedMetadata, entry.route);
        exact(entry.refresh, ['status', 'attemptedAt', 'error']);
        if (!['current', 'stale', 'unavailable'].includes(entry.refresh.status) || !date(entry.refresh.attemptedAt) || ![null, 'refresh-failed'].includes(entry.refresh.error) || (entry.refresh.status === 'stale') !== (entry.refresh.error === 'refresh-failed'))
            invalid();
    }
    for (const stage of ['stt', 'minutes'] as const) {
        const key = registry.defaults[stage];
        if (key !== null && (typeof key !== 'string' || keys.get(key)?.route.stage !== stage))
            invalid();
    }
    if (encoder.encode(JSON.stringify(registry)).byteLength > MODEL_REGISTRY_MAX_BYTES)
        invalid();
    return freezeMetadata(structuredClone(registry));
}
export const emptyModelRegistry = (): ModelRegistry => normalizeModelRegistry({
    version: 1,
    entries: [],
    defaults: { stt: null, minutes: null },
    lastCheckedAt: null
});
export type RegistryObservation = Readonly<{
    route: ModelRegistryRoute;
    metadata: ModelRegistryMetadata;
}>;
type CuratedMetadata = Readonly<{
    description?: ModelRegistryMetadata['description'];
    retirement?: ModelRegistryMetadata['retirement'];
}>;
function observed(route: ModelRegistryRoute, metadata: ModelRegistryMetadata): RegistryObservation {
    validateRoute(route);
    validateMetadata(metadata, route);
    return freezeMetadata(structuredClone({ route, metadata }));
}
export function observeMinutesRoute(route: ModelRegistryRoute, model: RouterModel, endpoint: RouterEndpoint | null, curated: CuratedMetadata = {}): RegistryObservation {
    validateRoute(route);
    if (route.stage !== 'minutes' || route.provider !== 'openrouter' || route.modelId !== model.id || endpoint && (endpoint.modelId !== model.id || endpoint.tag !== route.endpointTag))
        throw new Error('Registry observation route mismatch');
    const preview = previewMinutesSelection({
        model,
        endpoint,
        messages: null,
        outputTokens: null,
        reasoningReserveTokens: 0
    }), parameter = endpoint ? selectCompletionParameter(model, endpoint) : null;
    const blockers = [...(model.catalogConflict?.length ? ['conflicting-metadata'] : []), ...(!model.inputModalities.includes('text') || !model.outputModalities.includes('text') ? ['unknown-text-support'] : []), ...(!endpoint ? ['exact-endpoint-required'] : []), ...(endpoint && !parameter ? ['shared-completion-parameter-unavailable'] : []), ...(!endpoint || !hasMinutesEndpointLimits(model, endpoint) ? ['missing-limits'] : []), ...(model.perRequestLimits !== null && (!asObject(model.perRequestLimits) || Object.keys(asObject(model.perRequestLimits)!).length) ? ['uninterpreted-request-limits'] : [])];
    const rates: RateSnapshot['rates'][number][] = [];
    if (preview.pricing.inputPerMillion !== null)
        rates.push({
            unit: 'text-input-token',
            units: 1000000,
            price: preview.pricing.inputPerMillion
        });
    if (preview.pricing.outputPerMillion !== null)
        rates.push({
            unit: 'text-output-token',
            units: 1000000,
            price: preview.pricing.outputPerMillion
        });
    if (preview.pricing.requestFee !== null)
        rates.push({
            unit: 'request',
            units: 1,
            price: preview.pricing.requestFee
        });
    // Catalog rates and partial/conditional endpoint dimensions never establish free usage.
    const complete = preview.pricing.complete && !!endpoint && !!endpoint.pricing && (['prompt', 'completion', 'request'] as const).every(key => endpoint.pricing![key] === endpoint.pricingMetadata.rates[key]);
    const snapshot: RateSnapshot | null = rates.length ? {
        source: preview.pricing.source!,
        checkedAt: preview.pricing.checkedAt!,
        currency: 'USD',
        rates
    } : null;
    return observed(route, {
        route,
        name: model.name,
        source: model.source,
        checkedAt: model.checkedAt,
        endpointSource: endpoint?.source ?? null,
        endpointCheckedAt: endpoint?.checkedAt ?? null,
        compatible: !blockers.length,
        blockers,
        warnings: ['metadata-only-inference-unverified', ...(endpoint?.maxPromptTokens === null ? ['unknown-endpoint-prompt-limit-context-estimate'] : []), ...(complete ? [] : ['unknown-applicable-cost'])],
        inputModalities: model.inputModalities,
        outputModalities: model.outputModalities,
        modelSupportedParameters: model.supportedParameters,
        endpointSupportedParameters: endpoint?.supportedParameters ?? [],
        completionParameter: parameter,
        limits: {
            maxBytes: null,
            contextTokens: preview.limits.contextTokens,
            maxPromptTokens: preview.limits.maxPromptTokens,
            maxOutputTokens: preview.limits.maxOutputTokens
        },
        pricing: {
            kind: complete ? rates.every(rate => rate.price === 0) ? 'zero' : 'priced' : 'unknown',
            snapshot,
            missingDimensions: preview.pricing.missingDimensions,
            unsupportedDimensions: preview.pricing.unsupportedDimensions,
            conditionalDimensions: preview.pricing.conditionalDimensions
        },
        description: curated.description ?? null,
        retirement: curated.retirement ?? null
    });
}
export function observeSTTRoute(route: ModelRegistryRoute, model: STTModel, curated: CuratedMetadata = {}): RegistryObservation {
    if (route.stage !== 'stt' || route.provider !== 'openai' || route.endpointTag !== null || route.modelId !== model.id || getSTTModel(route.modelId).id !== model.id)
        throw new Error('Registry STT observation route mismatch');
    return observed(route, {
        route,
        name: model.id,
        source: model.rateSnapshot.source,
        checkedAt: model.rateSnapshot.checkedAt,
        endpointSource: null,
        endpointCheckedAt: null,
        compatible: true,
        blockers: [],
        warnings: ['metadata-only-inference-unverified', ...(model.completenessWarning ? [model.completenessWarning] : [])],
        inputModalities: ['audio'],
        outputModalities: ['text'],
        modelSupportedParameters: [],
        endpointSupportedParameters: [],
        completionParameter: null,
        limits: {
            maxBytes: model.maxBytes,
            contextTokens: model.contextTokens,
            maxPromptTokens: null,
            maxOutputTokens: model.maxOutputTokens
        },
        pricing: {
            kind: model.rateSnapshot.rates.every(rate => rate.price === 0) ? 'zero' : 'priced',
            snapshot: model.rateSnapshot,
            missingDimensions: [],
            unsupportedDimensions: [],
            conditionalDimensions: []
        },
        description: curated.description ?? null,
        retirement: curated.retirement ?? (model.lifecycle ? {
            retiredOn: model.lifecycle.shutdownDate,
            source: model.lifecycle.source,
            checkedAt: model.lifecycle.checkedOn
        } : null)
    });
}
/** Dedicated observed modalities plus a reviewed exact adapter profile, never inference evidence. */
export function observeRouterSTTRoute(route: ModelRegistryRoute, model: DiscoveredSTTModel): RegistryObservation {
    if (route.provider !== 'openrouter' || route.stage !== 'stt' || route.endpointTag !== null || route.modelId !== model.id) throw new Error('Registry STT observation route mismatch');
    const profile = resolveRouterSTTProfile(model);
    const snapshot = profile ? routerSTTRateSnapshot(model, profile) : null;
    return observed(route, {
        route, name: model.name, source: model.source, checkedAt: model.checkedAt, endpointSource: null, endpointCheckedAt: null,
        compatible: !!profile, blockers: profile ? [] : ['unsupported-adapter'],
        warnings: ['metadata-only-inference-unverified', 'unknown-applicable-cost', 'dynamic-processing-provider'],
        inputModalities: model.inputModalities, outputModalities: model.outputModalities,
        modelSupportedParameters: [], endpointSupportedParameters: [], completionParameter: null,
        limits: { maxBytes: profile?.maxAudioBytes ?? null, contextTokens: null, maxPromptTokens: null, maxOutputTokens: null },
        pricing: { kind: 'unknown', snapshot, missingDimensions: ['preflight-total'], unsupportedDimensions: [], conditionalDimensions: snapshot ? ['dynamic-provider-rates'] : [] },
        description: null, retirement: null,
    });
}
/** A catalog audio indication cannot stand in for a verified transcription adapter. */
export function observeUnsupportedRoute(route: ModelRegistryRoute, provenance: Readonly<{
    name: string;
    source: string;
    checkedAt: string;
}>): RegistryObservation {
    return observed(route, {
        route,
        ...provenance,
        endpointSource: null,
        endpointCheckedAt: null,
        compatible: false,
        blockers: ['unsupported-adapter'],
        warnings: ['metadata-only-inference-unverified'],
        inputModalities: [],
        outputModalities: [],
        modelSupportedParameters: [],
        endpointSupportedParameters: [],
        completionParameter: null,
        limits: {
            maxBytes: null,
            contextTokens: null,
            maxPromptTokens: null,
            maxOutputTokens: null
        },
        pricing: {
            kind: 'unknown',
            snapshot: null,
            missingDimensions: ['applicable-rates'],
            unsupportedDimensions: [],
            conditionalDimensions: []
        },
        description: null,
        retirement: null
    });
}
export type RegistryRefresh = Readonly<{
    connectionId: string;
    stage: ModelRegistryRoute['stage'];
    status: 'success' | 'failed';
    observations: readonly RegistryObservation[];
    checkedAt: string;
}>;
/** Success covers the stored routes in this connection/stage, not a search page.
 * Missing routes keep their last evidence and choices, with unavailable status.
 */
export function mergeModelRegistry(registry: ModelRegistry, refresh: RegistryRefresh): ModelRegistry {
    const current = normalizeModelRegistry(registry);
    if (!text(refresh.connectionId, 128) || !['stt', 'minutes'].includes(refresh.stage) || !['success', 'failed'].includes(refresh.status) || !date(refresh.checkedAt) || !Array.isArray(refresh.observations) || refresh.observations.length > MODEL_REGISTRY_MAX_ENTRIES || refresh.status === 'failed' && refresh.observations.length)
        invalid();
    const observations = new Map<string, RegistryObservation>();
    for (const item of refresh.observations) {
        exact(item, ['route', 'metadata']);
        validateMetadata(item.metadata, item.route);
        const key = registryRouteKey(item.route);
        if (item.route.connectionId !== refresh.connectionId || item.route.stage !== refresh.stage || observations.has(key))
            invalid();
        observations.set(key, item);
    }
    const entries = current.entries.map(entry => {
        if (entry.route.connectionId !== refresh.connectionId || entry.route.stage !== refresh.stage)
            return entry;
        const key = registryRouteKey(entry.route), observation = observations.get(key);
        observations.delete(key);
        return {
            ...entry,
            ...(observation ? { observedMetadata: observation.metadata } : {}),
            refresh: {
                status: refresh.status === 'failed' ? 'stale' as const : observation ? 'current' as const : 'unavailable' as const,
                attemptedAt: refresh.checkedAt,
                error: refresh.status === 'failed' ? 'refresh-failed' as const : null
            }
        };
    });
    for (const observation of observations.values())
        entries.push({
            route: observation.route,
            alias: null,
            userEnabled: false,
            observedMetadata: observation.metadata,
            acceptedMetadata: null,
            refresh: {
                status: 'current',
                attemptedAt: refresh.checkedAt,
                error: null
            }
        });
    return normalizeModelRegistry({
        ...current,
        entries,
        lastCheckedAt: refresh.status === 'success' ? refresh.checkedAt : current.lastCheckedAt
    });
}
function updateEntry(registry: ModelRegistry, key: string, action: (entry: ModelRegistryEntry) => ModelRegistryEntry): ModelRegistry {
    const current = normalizeModelRegistry(registry);
    if (!current.entries.some(entry => registryRouteKey(entry.route) === key))
        throw new Error('Registry route is unavailable');
    return normalizeModelRegistry({ ...current, entries: current.entries.map(entry => registryRouteKey(entry.route) === key ? action(entry) : entry) });
}
export function setRegistryAlias(registry: ModelRegistry, key: string, alias: string | null): ModelRegistry { return updateEntry(registry, key, entry => ({ ...entry, alias })); }
export function setRegistryEnabled(registry: ModelRegistry, key: string, userEnabled: boolean): ModelRegistry {
    return updateEntry(registry, key, entry => ({
        ...entry,
        userEnabled,
        acceptedMetadata: userEnabled && entry.acceptedMetadata === null ? entry.observedMetadata : entry.acceptedMetadata
    }));
}
export function acceptRegistryMetadata(registry: ModelRegistry, key: string): ModelRegistry { return updateEntry(registry, key, entry => ({ ...entry, acceptedMetadata: entry.observedMetadata })); }
function signature(metadata: ModelRegistryMetadata): string {
    // A new check date/name alone does not invalidate an accepted route. Prices,
    // limits and adapter capabilities do; accepting those changes is explicit.
    return JSON.stringify([metadata.compatible, metadata.blockers, metadata.inputModalities, metadata.outputModalities, metadata.modelSupportedParameters, metadata.endpointSupportedParameters, metadata.completionParameter, metadata.limits, metadata.pricing.kind, metadata.pricing.snapshot?.currency ?? null, metadata.pricing.snapshot?.rates ?? null, metadata.pricing.missingDimensions, metadata.pricing.unsupportedDimensions, metadata.pricing.conditionalDimensions, metadata.retirement?.retiredOn ?? null]);
}
function blocker(entry: ModelRegistryEntry): string | null {
    if (!entry.userEnabled)
        return 'disabled';
    if (!implemented(entry.route))
        return 'unsupported-adapter';
    if (entry.refresh.status !== 'current')
        return entry.refresh.status;
    if (entry.observedMetadata.retirement && Date.parse(entry.observedMetadata.retirement.retiredOn) <= Date.parse(entry.refresh.attemptedAt))
        return 'retired';
    if (!entry.observedMetadata.compatible)
        return entry.observedMetadata.blockers[0] ?? 'unknown-compatibility';
    if (entry.acceptedMetadata && signature(entry.acceptedMetadata) !== signature(entry.observedMetadata))
        return 'metadata-changed';
    return null;
}
export function projectModelRegistry(registry: ModelRegistry, stage: ModelRegistryRoute['stage']) {
    const current = normalizeModelRegistry(registry), choices: {
        key: string;
        route: ModelRegistryRoute;
        label: string;
        metadata: ModelRegistryMetadata;
        isDefault: boolean;
    }[] = [], blocked: {
        key: string;
        reason: string;
    }[] = [];
    if (!['stt', 'minutes'].includes(stage))
        invalid();
    for (const entry of current.entries.filter(entry => entry.route.stage === stage)) {
        const key = registryRouteKey(entry.route), reason = blocker(entry);
        if (reason)
            blocked.push({ key, reason });
        else
            choices.push({
                key,
                route: entry.route,
                label: entry.alias ?? entry.observedMetadata.name,
                metadata: entry.observedMetadata,
                isDefault: current.defaults[stage] === key
            });
    }
    const defaultKey = current.defaults[stage];
    return freezeMetadata({
        choices,
        blocked,
        defaultKey,
        defaultBlocker: defaultKey ? blocked.find(entry => entry.key === defaultKey)?.reason ?? null : 'no-default'
    });
}
export function setRegistryDefault(registry: ModelRegistry, stage: ModelRegistryRoute['stage'], key: string | null): ModelRegistry {
    const current = normalizeModelRegistry(registry);
    if (!['stt', 'minutes'].includes(stage))
        invalid();
    if (key !== null) {
        const entry = current.entries.find(entry => registryRouteKey(entry.route) === key);
        if (!entry || entry.route.stage !== stage)
            throw new Error('Registry default stage mismatch');
        const reason = blocker(entry);
        if (reason)
            throw new Error(`Registry default unavailable: ${reason}`);
    }
    return normalizeModelRegistry({ ...current, defaults: { ...current.defaults, [stage]: key } });
}
