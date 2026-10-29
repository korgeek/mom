import type { ModelRegistration } from './model-registrations';

export const OPENAI_REASONING_EFFORTS = ['none', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
const models = {
  'gpt-6.1-terra': { inputUsdPerMillion: 1, outputUsdPerMillion: 5, source: 'https://developers.openai.com/api/docs/models/gpt-6.1-terra' },
  'gpt-6-luna': { inputUsdPerMillion: 0.1, outputUsdPerMillion: 0.5, source: 'https://developers.openai.com/api/docs/models/gpt-6-luna' },
} as const;
export function openAIModelInfo(adapter: ModelRegistration['adapter'], modelId: string) {
  if (adapter !== 'openai' || !Object.prototype.hasOwnProperty.call(models, modelId)) return null;
  return { ...models[modelId as keyof typeof models], efforts: OPENAI_REASONING_EFFORTS, defaultEffort: 'medium' as const, checkedAt: '2026-10-29', longInputTokens: 272_000, longInputMultiplier: 2, longOutputMultiplier: 1.5 };
}
export function openAIReasoningIssue(model: ModelRegistration): 'effort' | 'sampling' | undefined {
  if (model.stage !== 'llm' || !openAIModelInfo(model.adapter, model.modelId)) return;
  const params = model.requestParameters, effort = params?.reasoning_effort === undefined ? 'medium' : params.reasoning_effort;
  if (typeof effort !== 'string' || !(OPENAI_REASONING_EFFORTS as readonly string[]).includes(effort)) return 'effort';
  if (effort !== 'none' && (model.llm?.temperature !== undefined || model.llm?.topP !== undefined || params?.top_logprobs !== undefined || params?.logprobs !== undefined)) return 'sampling';
}
