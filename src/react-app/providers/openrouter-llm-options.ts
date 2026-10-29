import type { ModelRegistration } from './model-registrations';

// OpenRouter catalog snapshot, not a guarantee of a particular routed endpoint.
const models = {
  "openai/gpt-6.1-sol": {
    "efforts": [
      "low",
      "medium",
      "high",
      "xhigh",
      "max"
    ],
    "mandatory": true,
    "defaultEffort": "medium",
    "supportedParameters": [
      "include_reasoning",
      "max_completion_tokens",
      "max_tokens",
      "reasoning",
      "reasoning_effort",
      "response_format",
      "seed",
      "structured_outputs",
      "tool_choice",
      "tools",
      "verbosity"
    ],
    "contextTokens": 1050000,
    "maxOutputTokens": 128000,
    "inputUsdPerMillion": 2,
    "outputUsdPerMillion": 10,
    "priceOverrides": [
      {
        "minInputTokens": 272000,
        "inputUsdPerMillion": 4,
        "outputUsdPerMillion": 15
      }
    ]
  },
  "openai/gpt-6.1-terra": {
    "efforts": [
      "none",
      "low",
      "medium",
      "high",
      "xhigh",
      "max"
    ],
    "mandatory": false,
    "defaultEffort": "medium",
    "supportedParameters": [
      "include_reasoning",
      "max_completion_tokens",
      "max_tokens",
      "reasoning",
      "reasoning_effort",
      "response_format",
      "seed",
      "structured_outputs",
      "tool_choice",
      "tools",
      "verbosity"
    ],
    "contextTokens": 1050000,
    "maxOutputTokens": 128000,
    "inputUsdPerMillion": 1,
    "outputUsdPerMillion": 5,
    "priceOverrides": [
      {
        "minInputTokens": 272000,
        "inputUsdPerMillion": 2,
        "outputUsdPerMillion": 7.5
      }
    ]
  },
  "openai/gpt-6-luna": {
    "efforts": [
      "none",
      "low",
      "medium",
      "high",
      "xhigh",
      "max"
    ],
    "mandatory": false,
    "defaultEffort": "medium",
    "supportedParameters": [
      "include_reasoning",
      "max_completion_tokens",
      "max_tokens",
      "reasoning",
      "reasoning_effort",
      "response_format",
      "seed",
      "structured_outputs",
      "tool_choice",
      "tools",
      "verbosity"
    ],
    "contextTokens": 1050000,
    "maxOutputTokens": 128000,
    "inputUsdPerMillion": 0.1,
    "outputUsdPerMillion": 0.5,
    "priceOverrides": [
      {
        "minInputTokens": 272000,
        "inputUsdPerMillion": 0.2,
        "outputUsdPerMillion": 0.75
      }
    ]
  },
  "deepseek/deepseek-v4.1-flash": {
    "efforts": [
      "none",
      "low",
      "high",
      "max"
    ],
    "mandatory": false,
    "defaultEffort": "high",
    "supportedParameters": [
      "frequency_penalty",
      "include_reasoning",
      "logit_bias",
      "logprobs",
      "max_tokens",
      "min_p",
      "parallel_tool_calls",
      "presence_penalty",
      "reasoning",
      "reasoning_effort",
      "repetition_penalty",
      "response_format",
      "seed",
      "stop",
      "structured_outputs",
      "temperature",
      "tool_choice",
      "tools",
      "top_a",
      "top_k",
      "top_logprobs",
      "top_p"
    ],
    "contextTokens": 1048576,
    "maxOutputTokens": 943718,
    "inputUsdPerMillion": 0.045,
    "outputUsdPerMillion": 0.5,
    "priceOverrides": []
  },
  "z-ai/glm-5.3-flash": {
    "efforts": [
      "low",
      "high",
      "max"
    ],
    "mandatory": true,
    "defaultEffort": "max",
    "supportedParameters": [
      "frequency_penalty",
      "include_reasoning",
      "logit_bias",
      "logprobs",
      "max_tokens",
      "min_p",
      "parallel_tool_calls",
      "presence_penalty",
      "reasoning",
      "reasoning_effort",
      "repetition_penalty",
      "response_format",
      "seed",
      "stop",
      "structured_outputs",
      "temperature",
      "tool_choice",
      "tools",
      "top_k",
      "top_logprobs",
      "top_p"
    ],
    "contextTokens": 1048576,
    "maxOutputTokens": 131072,
    "inputUsdPerMillion": 0.0457,
    "outputUsdPerMillion": 0.0771,
    "priceOverrides": []
  },
  "meta/muse-spark-1.3-contributor": {
    "efforts": [
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max"
    ],
    "mandatory": true,
    "defaultEffort": "medium",
    "supportedParameters": [
      "include_reasoning",
      "max_tokens",
      "reasoning",
      "reasoning_effort",
      "repetition_penalty",
      "response_format",
      "structured_outputs",
      "temperature",
      "tool_choice",
      "tools",
      "top_k",
      "top_p"
    ],
    "contextTokens": 1048576,
    "maxOutputTokens": 943718,
    "inputUsdPerMillion": 0.1,
    "outputUsdPerMillion": 0.2,
    "priceOverrides": []
  },
  "anthropic/claude-haiku-5.5": {
    "efforts": [
      "none",
      "low",
      "medium",
      "high",
      "xhigh",
      "max"
    ],
    "mandatory": false,
    "defaultEffort": "medium",
    "supportedParameters": [
      "include_reasoning",
      "max_completion_tokens",
      "max_tokens",
      "reasoning",
      "reasoning_effort",
      "response_format",
      "stop",
      "structured_outputs",
      "tool_choice",
      "tools",
      "verbosity"
    ],
    "contextTokens": 1000000,
    "maxOutputTokens": 128000,
    "inputUsdPerMillion": 0.1,
    "outputUsdPerMillion": 0.5,
    "priceOverrides": [
      {
        "minInputTokens": 100000,
        "inputUsdPerMillion": 0.5,
        "outputUsdPerMillion": 2.5
      }
    ]
  }
} as const;
export function openRouterLLMInfo(model: Pick<ModelRegistration, 'adapter' | 'modelId'>) {
  if (model.adapter !== 'openrouter' || !Object.prototype.hasOwnProperty.call(models, model.modelId)) return null;
  return { ...models[model.modelId as keyof typeof models], checkedAt: '2026-10-29', source: 'https://openrouter.ai/api/v1/models' };
}

export function openRouterLLMIssues(model: ModelRegistration): readonly string[] {
  const info = model.stage === 'llm' ? openRouterLLMInfo(model) : null;
  if (!info) return [];
  const issues: string[] = [], params = model.requestParameters ?? {};
  const reasoning = params.reasoning;
  if (reasoning !== undefined && (!reasoning || typeof reasoning !== 'object' || Array.isArray(reasoning))) issues.push('reasoning');
  else if (reasoning) {
    const value = reasoning as Record<string, unknown>;
    const effort = value.effort;
    if (Object.keys(value).some(key => !['effort','enabled','exclude','max_tokens'].includes(key)) || value.enabled !== undefined && typeof value.enabled !== 'boolean' || value.exclude !== undefined && typeof value.exclude !== 'boolean' || value.max_tokens !== undefined && (typeof value.max_tokens !== 'number' || !Number.isSafeInteger(value.max_tokens) || value.max_tokens <= 0)) issues.push('reasoning');
    if (effort !== undefined && (typeof effort !== 'string' || !(info.efforts as readonly string[]).includes(effort))) issues.push('reasoning-effort');
    if (info.mandatory && value.enabled === false) issues.push('reasoning-required');
    if (effort !== undefined && value.max_tokens !== undefined || effort !== undefined && value.enabled === false && effort !== 'none' || params.reasoning_effort !== undefined) issues.push('reasoning-conflict');
  }
  if (params.reasoning_effort !== undefined && (typeof params.reasoning_effort !== 'string' || !(info.efforts as readonly string[]).includes(params.reasoning_effort))) issues.push('reasoning-effort');
  if (['tools','tool_choice','parallel_tool_calls','structured_outputs'].some(key => params[key] !== undefined)) issues.push('unsupported-workflow');
  const supported = info.supportedParameters as readonly string[];
  if (model.llm?.tokenField && !supported.includes(model.llm.tokenField) || model.llm?.temperature !== undefined && !supported.includes('temperature') || model.llm?.topP !== undefined && !supported.includes('top_p') || Object.keys(params).some(key => key !== 'provider' && !supported.includes(key))) issues.push('unsupported-parameter');
  const ranges: Record<string, readonly [number, number, boolean]> = { temperature:[0,2,false], top_p:[0,1,false], top_k:[0,Number.MAX_SAFE_INTEGER,true], min_p:[0,1,false], top_a:[0,1,false], frequency_penalty:[-2,2,false], presence_penalty:[-2,2,false], repetition_penalty:[0,2,false], seed:[Number.MIN_SAFE_INTEGER,Number.MAX_SAFE_INTEGER,true], top_logprobs:[0,20,true] };
  const values: Readonly<Record<string, unknown>> = { ...params, ...(model.llm?.temperature !== undefined ? {temperature:model.llm.temperature} : {}), ...(model.llm?.topP !== undefined ? {top_p:model.llm.topP} : {}) };
  for (const [key, [min,max,integer]] of Object.entries(ranges)) {
    const value = values[key];
    if (value != null && (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || integer && !Number.isSafeInteger(value))) issues.push(`invalid-parameter:${key}`);
  }
  if (values.logprobs != null && typeof values.logprobs !== 'boolean') issues.push('invalid-parameter:logprobs');
  if (values.top_logprobs !== undefined && values.logprobs !== true) issues.push('invalid-parameter:top_logprobs');
  if (params.verbosity !== undefined && !['low','medium','high'].includes(String(params.verbosity))) issues.push('invalid-parameter:verbosity');
  return [...new Set(issues)];
}
