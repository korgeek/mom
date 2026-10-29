import type { ModelRegistration } from '../providers/model-registrations';
import { openRouterLLMInfo } from '../providers/openrouter-llm-options';
import { openAIModelInfo } from '../providers/openai-models';

export function minutesReasoning(model: ModelRegistration | null | undefined) {
  if (!model || model.stage !== 'llm') return null;
  if (model.adapter === 'openai') return openAIModelInfo(model.adapter, model.modelId);
  if (model.adapter === 'openrouter') return openRouterLLMInfo(model);
  return null;
}

export function supportsMinutesReasoning(model: ModelRegistration | null | undefined, effort: string | undefined): boolean {
  return effort === undefined || !!minutesReasoning(model)?.efforts.some(value => value === effort);
}

export function requestedMinutesReasoning(model: ModelRegistration | null | undefined): string | null {
  const params = model?.requestParameters;
  const nested = params?.reasoning;
  const value = params?.reasoning_effort ?? (nested && typeof nested === 'object' && !Array.isArray(nested) ? (nested as Record<string, unknown>).effort : undefined);
  return typeof value === 'string' ? value : null;
}

/** Anthropic requires room for response tokens above the configured thinking budget. */
export function reasoningBudgetConflict(model: ModelRegistration, outputTokens: number | null, effort: string | undefined): boolean {
  if (model.adapter !== 'openrouter' || !model.modelId.startsWith('anthropic/') || effort !== undefined || outputTokens === null) return false;
  const reasoning = model.requestParameters?.reasoning;
  const budget = reasoning && typeof reasoning === 'object' && !Array.isArray(reasoning) ? (reasoning as Record<string, unknown>).max_tokens : undefined;
  return typeof budget === 'number' && budget >= outputTokens;
}

/** Keep the selected registration immutable; the frozen request records the override. */
export function withMinutesReasoning(model: ModelRegistration, effort: string | undefined): ModelRegistration {
  if (!supportsMinutesReasoning(model, effort)) throw new Error('Unsupported reasoning effort');
  if (effort === undefined) return model;
  const params = { ...model.requestParameters };
  if (model.adapter === 'openai') params.reasoning_effort = effort;
  else {
    const previous = params.reasoning;
    const reasoning = { ...(previous && typeof previous === 'object' && !Array.isArray(previous) ? previous : {}) } as Record<string, unknown>;
    delete reasoning.enabled;
    delete reasoning.max_tokens;
    params.reasoning = { ...reasoning, effort };
    delete params.reasoning_effort;
  }
  return { ...model, requestParameters: params };
}
