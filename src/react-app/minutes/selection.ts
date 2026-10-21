import { freezeMetadata, selectCompletionParameter } from "../providers/catalog";
import type { CompletionParameter, RouterCapabilityMetadata, RouterEndpoint, RouterModel, TextPricingMetadata } from "../providers/catalog";
import { previewMinutesFit } from "../providers/openrouter";
import type { ChatMessage, MinutesFit } from "../providers/openrouter";
import type { MinutesSettings, TranscriptVersion } from '../domain/types';
import { defaultRegistrationOutputTokens, freezeExecutionModel, registrationEndpoint, type ModelRegistration } from '../providers/model-registrations';
import { registeredMinutesFit } from '../providers/registered-runtime';

export type MinutesSelectionOptions = Readonly<{
 model: RouterModel | null; endpoint: RouterEndpoint | null; messages: readonly ChatMessage[] | null;
 outputTokens: number | null; reasoningReserveTokens: number;
}>;
export type MinutesSelectionPreview = Readonly<{
 status: "choose-model" | "choose-endpoint" | "choose-transcript" | MinutesFit["status"];
 route: Readonly<{ modelId: string | null; modelName: string | null; endpointTag: string | null; providerName: string | null }>;
 modalities?: Readonly<{ input: readonly string[]; output: readonly string[] }>;
 completion?: Readonly<{ parameter: CompletionParameter | null; ceilingTokens: number | null; visibleOutputTokens: null; scope: "full-provider-completion" }>;
 capabilities?: Readonly<{ model: RouterCapabilityMetadata | null; endpoint: RouterCapabilityMetadata | null }>;
 pricing: Readonly<{
  kind: "selected-endpoint" | "catalog-only" | "unavailable"; inputPerMillion: number | null; outputPerMillion: number | null; requestFee: number | null;
  source: string | null; checkedAt: string | null; complete: boolean;
  missingDimensions: readonly string[]; unsupportedDimensions: readonly string[]; conditionalDimensions: readonly string[];
  raw?: unknown;
 }>;
 projection: Readonly<{ input: number | null; output: number | null; request: number | null; total: number | null; kind: "estimated" | "unavailable" }>;
 limits: Readonly<{
  modelContextTokens: number | null; endpointContextTokens: number | null; contextTokens: number | null; maxPromptTokens: number | null;
  modelMaxOutputTokens: number | null; endpointMaxOutputTokens: number | null; maxOutputTokens: number | null; outputTokens: number | null; reasoningReserveTokens: number;
  modelSupportedParameters: readonly string[]; endpointSupportedParameters: readonly string[];
 }>;
 fit: MinutesFit | null;
}>;
const unknownPricing: TextPricingMetadata = { rates: { prompt: null, completion: null, request: null }, complete: false, missingDimensions: ["prompt", "completion", "request"], unsupportedDimensions: [], conditionalDimensions: [], raw: null };
const minimum = (first: number | null | undefined, second: number | null | undefined) => first != null && second != null ? Math.min(first, second) : null;

/** Counts and catalog metadata only: never exposes messages, transcript or credentials to UI state. */
export function previewMinutesSelection(options: MinutesSelectionOptions): MinutesSelectionPreview {
 const { model, endpoint, messages, outputTokens, reasoningReserveTokens } = options;
 const selected = model && endpoint ? { model, endpoint } : null;
 const fit = selected && messages ? previewMinutesFit(selected, messages, outputTokens, reasoningReserveTokens) : null;
 const priceOwner = endpoint ?? model;
 const metadata = priceOwner?.pricingMetadata ?? unknownPricing;
 const rates = metadata.conditionalDimensions.length ? unknownPricing.rates : priceOwner?.pricing ?? metadata.rates;
 const complete = !!endpoint && metadata.complete && rates.prompt !== null && rates.completion !== null && rates.request !== null;
 const input = endpoint && fit && rates.prompt !== null ? fit.inputTokenEstimate * rates.prompt : null;
 const output = endpoint && outputTokens !== null && rates.completion !== null ? outputTokens * rates.completion : null;
 const request = endpoint ? rates.request : null;
 const total = complete && input !== null && output !== null && request !== null ? input + output + request : null;
 return freezeMetadata(structuredClone({
  status: !model ? "choose-model" : !endpoint ? "choose-endpoint" : !messages ? "choose-transcript" : fit!.status,
  route: { modelId: model?.id ?? null, modelName: model?.name ?? null, endpointTag: endpoint?.tag ?? null, providerName: endpoint?.providerName ?? null },
  modalities: { input: model?.catalogConflict?.length ? [] : [...(model?.inputModalities ?? [])], output: model?.catalogConflict?.length ? [] : [...(model?.outputModalities ?? [])] },
  completion: { parameter: selected ? selectCompletionParameter(selected.model, selected.endpoint) : null, ceilingTokens: outputTokens, visibleOutputTokens: null, scope: "full-provider-completion" },
  capabilities: { model: model?.catalogConflict?.length ? null : model?.capabilityMetadata ?? null, endpoint: endpoint?.capabilityMetadata ?? null },
  pricing: { kind: endpoint ? "selected-endpoint" : model ? "catalog-only" : "unavailable", inputPerMillion: rates.prompt === null ? null : rates.prompt * 1_000_000, outputPerMillion: rates.completion === null ? null : rates.completion * 1_000_000, requestFee: rates.request, source: priceOwner?.source ?? null, checkedAt: priceOwner?.checkedAt ?? null, complete, missingDimensions: metadata.missingDimensions, unsupportedDimensions: metadata.unsupportedDimensions, conditionalDimensions: metadata.conditionalDimensions, raw: metadata.raw },
  projection: { input, output, request, total, kind: total === null ? "unavailable" : "estimated" },
  limits: { modelContextTokens: model?.contextTokens ?? null, endpointContextTokens: endpoint?.contextTokens ?? null, contextTokens: minimum(model?.contextTokens, endpoint?.contextTokens), maxPromptTokens: endpoint?.maxPromptTokens ?? null, modelMaxOutputTokens: model?.maxOutputTokens ?? null, endpointMaxOutputTokens: endpoint?.maxOutputTokens ?? null, maxOutputTokens: minimum(model?.maxOutputTokens, endpoint?.maxOutputTokens), outputTokens, reasoningReserveTokens, modelSupportedParameters: [...(model?.supportedParameters ?? [])], endpointSupportedParameters: [...(endpoint?.supportedParameters ?? [])] }, fit,
 }));
}

/** Immutable catalog/price/limit identity bound alongside the existing transcript/settings/messages signature. */
export function selectionConsentSnapshot(model: RouterModel, endpoint: RouterEndpoint, outputTokens: number | null, reasoningReserveTokens: number) {
 return freezeMetadata(structuredClone({
  model: { id: model.id, inputModalities: model.inputModalities ?? [], outputModalities: model.outputModalities ?? [], catalogConflict: !!model.catalogConflict?.length, contextTokens: model.contextTokens, maxOutputTokens: model.maxOutputTokens, supportedParameters: model.supportedParameters, pricing: model.pricing, pricingMetadata: model.pricingMetadata, perRequestLimits: model.perRequestLimits, capabilityMetadata: model.catalogConflict?.length ? null : model.capabilityMetadata ?? null, source: model.source, checkedAt: model.checkedAt },
  endpoint: { modelId: endpoint.modelId, tag: endpoint.tag, providerName: endpoint.providerName, contextTokens: endpoint.contextTokens, maxPromptTokens: endpoint.maxPromptTokens, maxOutputTokens: endpoint.maxOutputTokens, supportedParameters: endpoint.supportedParameters, pricing: endpoint.pricing, pricingMetadata: endpoint.pricingMetadata, capabilityMetadata: endpoint.capabilityMetadata ?? null, source: endpoint.source, checkedAt: endpoint.checkedAt },
  outputTokens, reasoningReserveTokens,
  completion: { parameter: selectCompletionParameter(model, endpoint), ceilingTokens: outputTokens, visibleOutputTokens: null, scope: "full-provider-completion" },
 }));
}

/** The same registered request preflight as dispatch; only counts and public metadata reach UI. */
export function previewRegisteredMinutesSelection(value: ModelRegistration | null, transcript: TranscriptVersion | null, settings: MinutesSettings, messages?: readonly ChatMessage[]): MinutesSelectionPreview {
 if (!value) return previewMinutesSelection({ model: null, endpoint: null, messages: null, outputTokens: null, reasoningReserveTokens: 0 });
 const model = freezeExecutionModel(value), endpoint = registrationEndpoint(model);
 let fit: MinutesFit | null = null;
 try { if (transcript) fit = registeredMinutesFit(model, { transcript, settings, runId: 'preview' }, messages); } catch { /* Invalid prompt is blocked below. */ }
 const context = model.llm?.contextTokens ?? null, output = settings.outputTokens ?? defaultRegistrationOutputTokens(model) ?? null;
 const pricing = model.catalogEvidence?.pricing, snapshot = pricing?.snapshot;
 const inputRate = snapshot?.rates.find(rate => ['input-token', 'text-input-token'].includes(rate.unit));
 const outputRate = snapshot?.rates.find(rate => ['output-token', 'text-output-token'].includes(rate.unit));
 const requestRate = snapshot?.rates.find(rate => rate.unit === 'request');
 const supported = pricing && !pricing.missingDimensions.length && !pricing.unsupportedDimensions.length && !pricing.conditionalDimensions.length;
 const inputPrice = supported && inputRate ? inputRate.price / inputRate.units : null;
 const outputPrice = supported && outputRate ? outputRate.price / outputRate.units : null;
 const requestPrice = supported && requestRate ? requestRate.price / requestRate.units : null;
 const projectedInput = fit && inputPrice !== null ? fit.inputTokenEstimate * inputPrice : null;
 const projectedOutput = output !== null && outputPrice !== null ? output * outputPrice : null;
 const total = projectedInput !== null && projectedOutput !== null && requestPrice !== null ? projectedInput + projectedOutput + requestPrice : null;
 return freezeMetadata({ status: !transcript ? 'choose-transcript' : fit?.status ?? 'invalid-input',
  route: { modelId: model.modelId, modelName: model.name, endpointTag: endpoint, providerName: new URL(endpoint).host },
  modalities: { input: ['text'], output: ['text'] },
  completion: { parameter: model.llm?.tokenField ?? null, ceilingTokens: output, visibleOutputTokens: null, scope: 'full-provider-completion' },
  capabilities: { model: null, endpoint: null },
  pricing: { kind: snapshot ? 'selected-endpoint' : 'unavailable', inputPerMillion: inputPrice === null ? null : inputPrice * 1e6, outputPerMillion: outputPrice === null ? null : outputPrice * 1e6, requestFee: requestPrice, source: snapshot?.source ?? null, checkedAt: snapshot?.checkedAt ?? null, complete: total !== null, missingDimensions: pricing?.missingDimensions ?? ['pricing'], unsupportedDimensions: pricing?.unsupportedDimensions ?? [], conditionalDimensions: pricing?.conditionalDimensions ?? [] },
  projection: { input: projectedInput, output: projectedOutput, request: requestPrice, total, kind: total === null ? 'unavailable' : 'estimated' },
  limits: { modelContextTokens: context, endpointContextTokens: context, contextTokens: context, maxPromptTokens: model.catalogEvidence?.limits.maxPromptTokens ?? null, modelMaxOutputTokens: model.llm?.maxTokens ?? null, endpointMaxOutputTokens: model.catalogEvidence?.limits.maxOutputTokens ?? null, maxOutputTokens: fit?.maxOutputTokens ?? model.llm?.maxTokens ?? null, outputTokens: output, reasoningReserveTokens: 0, modelSupportedParameters: model.llm?.tokenField ? [model.llm.tokenField] : [], endpointSupportedParameters: model.llm?.tokenField ? [model.llm.tokenField] : [] }, fit });
}
