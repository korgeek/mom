import type { MeetingProject, ModelRegistryRoute, RouterSTTPolicy, RouterSTTProfile, RouterSTTSelection } from '../domain/types';
import type { DiscoveredSTTModel } from './discovery';
import { freezeMetadata } from './catalog';
import { lookupRouterSTTProfile, resolveRouterSTTProfile, routerSTTRateSnapshot } from './stt-catalog';
import { resolveRouterSTTLanguageHint } from './openrouter-stt';
import { normalizeRouterSTTPreference, registryRouteKey } from './model-registry';

function invalid(): never { throw new Error('Invalid OpenRouter STT selection'); }
function stable(value: unknown): string {
    return JSON.stringify(value, (_key, entry) => entry && typeof entry === 'object' && !Array.isArray(entry)
        ? Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]])) : entry);
}
/** Refresh dates and display names do not change capabilities, billing or consent. */
function profileFacts(profile: RouterSTTProfile) {
    const { id, version, modelId, formats, maxAudioBytes, maxBodyBytes, singleLanguageHint } = profile;
    return { id, version, modelId, formats, maxAudioBytes, maxBodyBytes, singleLanguageHint };
}
function catalogFingerprint(model: DiscoveredSTTModel, profile: RouterSTTProfile): string {
    return stable([model.id, model.inputModalities, model.outputModalities, model.pricing.raw, profileFacts(profile)]);
}
export function freezeRouterSTTSelection(project: MeetingProject, chunkIds: readonly string[], route: ModelRegistryRoute, model: DiscoveredSTTModel, policy: RouterSTTPolicy): RouterSTTSelection {
    registryRouteKey(route);
    normalizeRouterSTTPreference({ policy, acknowledgedDisclosureVersion: 'or-stt-1', initialDefaultApplied: false });
    const profile = resolveRouterSTTProfile(model), source = project.sourceAssets[0];
    if (!profile || !source || route.provider !== 'openrouter' || route.stage !== 'stt' || route.endpointTag !== null || route.modelId !== model.id ||
        !chunkIds.length || new Set(chunkIds).size !== chunkIds.length || !model.source.trim() || /[\r\n]/u.test(model.source) || !Number.isFinite(Date.parse(model.checkedAt))) invalid();
    const chunks = chunkIds.map(id => { const matches = project.preparedChunks.filter(chunk => chunk.id === id); if (matches.length !== 1) invalid(); return matches[0]; });
    const rateSnapshot = routerSTTRateSnapshot(model, profile);
    const selection: RouterSTTSelection = freezeMetadata(structuredClone({
        version: 1, route, profileId: profile.id, profileVersion: profile.version,
        catalogFingerprint: catalogFingerprint(model, profile), catalogSource: model.source, catalogCheckedAt: model.checkedAt,
        policy, sourceId: source.id, chunks, expectedLanguages: project.audioOptions.expectedLanguages,
        appliedLanguage: resolveRouterSTTLanguageHint(project.audioOptions.expectedLanguages, profile), responseFormat: 'json',
        rateSnapshot, rawPricing: model.pricing.raw, billingBasis: rateSnapshot ? profile.modelId === 'openai/whisper-large-v3' ? 'audio-second' : 'tokens' : 'unknown', disclosureVersion: 'or-stt-1',
    }));
    validateRouterSTTSelection(project, selection);
    return selection;
}
/** Checks saved provenance against current retained descriptors; no credentials or request bodies. */
export function validateRouterSTTSelection(project: MeetingProject, selection: RouterSTTSelection): void {
    const fields = ['version', 'route', 'profileId', 'profileVersion', 'catalogFingerprint', 'catalogSource', 'catalogCheckedAt', 'policy', 'sourceId', 'chunks', 'expectedLanguages', 'appliedLanguage', 'responseFormat', 'rateSnapshot', 'rawPricing', 'billingBasis', 'disclosureVersion'];
    if (!selection || Object.keys(selection).length !== fields.length || fields.some(field => !Object.prototype.hasOwnProperty.call(selection, field)) || Object.getOwnPropertySymbols(selection).length) invalid();
    const profile = lookupRouterSTTProfile(selection.profileId, selection.route?.modelId);
    registryRouteKey(selection.route);
    normalizeRouterSTTPreference({ policy: selection.policy, acknowledgedDisclosureVersion: 'or-stt-1', initialDefaultApplied: false });
    const sources = project.sourceAssets.filter(source => source.id === selection.sourceId), source = sources[0];
    if (!profile || selection.version !== 1 || selection.profileVersion !== profile.version || selection.route.provider !== 'openrouter' || selection.route.stage !== 'stt' || selection.route.endpointTag !== null ||
        selection.responseFormat !== 'json' || selection.disclosureVersion !== 'or-stt-1' || !selection.catalogFingerprint?.trim() || !selection.catalogSource?.trim() || !Number.isFinite(Date.parse(selection.catalogCheckedAt)) ||
        sources.length !== 1 || !Array.isArray(selection.expectedLanguages) || selection.expectedLanguages.some(language => typeof language !== 'string' || !/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/u.test(language)) ||
        selection.appliedLanguage !== resolveRouterSTTLanguageHint(selection.expectedLanguages, profile) || !Array.isArray(selection.chunks) || !selection.chunks.length || new Set(selection.chunks.map(chunk => chunk.id)).size !== selection.chunks.length) invalid();
    for (const chunk of selection.chunks) {
        const matches = project.preparedChunks.filter(current => current.id === chunk.id);
        if (matches.length !== 1 || stable(matches[0]) !== stable(chunk) || chunk.sourceId !== source.id || !chunk.audioRecordId?.trim() ||
            !Number.isSafeInteger(chunk.index) || chunk.index < 0 || !Number.isSafeInteger(chunk.sourceStartMs) || chunk.sourceStartMs < 0 ||
            !Number.isSafeInteger(chunk.sourceEndMs) || chunk.sourceEndMs <= chunk.sourceStartMs || chunk.sourceEndMs > source.durationMs ||
            !Number.isSafeInteger(chunk.encodingOffsetMs) || chunk.encodingOffsetMs < 0 || chunk.encodingOffsetMs >= chunk.sourceEndMs - chunk.sourceStartMs ||
            !Number.isSafeInteger(chunk.encodedBytes) || chunk.encodedBytes <= 0 || chunk.encodedBytes > Math.min(profile.maxAudioBytes, 16_000_000) || !profile.formats.some(format => format.mime === chunk.mimeType && format.codec === chunk.codec)) invalid();
    }
    if (selection.rateSnapshot !== null && (selection.rateSnapshot.currency !== 'USD' || !selection.rateSnapshot.source?.trim() || !Number.isFinite(Date.parse(selection.rateSnapshot.checkedAt)) ||
        !selection.rateSnapshot.rates?.length || selection.rateSnapshot.rates.some(rate => !['input-token', 'output-token', 'audio-second', 'request'].includes(rate.unit) || !Number.isSafeInteger(rate.units) || rate.units <= 0 || !Number.isFinite(rate.price) || rate.price < 0))) invalid();
    // A saved rate snapshot must derive from the same observed modalities/pricing,
    // rather than a forged advertised price or a model-name assumption.
    let fingerprint: unknown;
    try { fingerprint = JSON.parse(selection.catalogFingerprint); } catch { invalid(); }
    if (!Array.isArray(fingerprint) || fingerprint.length !== 5 || fingerprint[0] !== selection.route.modelId ||
        !Array.isArray(fingerprint[1]) || !Array.isArray(fingerprint[2]) ||
        [...fingerprint[1], ...fingerprint[2]].some(value => typeof value !== 'string') || stable(fingerprint[3]) !== stable(selection.rawPricing) || stable(fingerprint[4]) !== stable(profileFacts(profile))) invalid();
    const observation: DiscoveredSTTModel = { id: selection.route.modelId, name: selection.route.modelId,
        inputModalities: fingerprint[1], outputModalities: fingerprint[2], source: selection.catalogSource, checkedAt: selection.catalogCheckedAt,
        adapterStatus: 'unsupported', pricing: { status: 'unknown', raw: selection.rawPricing } };
    const rates = routerSTTRateSnapshot(observation, profile);
    if (!resolveRouterSTTProfile(observation) || catalogFingerprint(observation, profile) !== selection.catalogFingerprint || stable(rates) !== stable(selection.rateSnapshot) ||
        selection.billingBasis !== (rates ? profile.modelId === 'openai/whisper-large-v3' ? 'audio-second' : 'tokens' : 'unknown')) invalid();
}
/** Bind material request/provenance facts while retaining fresh project/action tokens. */
export function routerSTTConsentSignature(selection: RouterSTTSelection): string {
    return stable([selection.version, selection.route, selection.profileId, selection.profileVersion, selection.catalogFingerprint, selection.policy,
        selection.sourceId, selection.chunks, selection.expectedLanguages, selection.appliedLanguage, selection.responseFormat,
        selection.rateSnapshot?.currency ?? null, selection.rateSnapshot?.rates ?? null, selection.rawPricing, selection.billingBasis, selection.disclosureVersion]);
}
