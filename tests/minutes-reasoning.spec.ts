import { describe, expect, it } from 'vitest';
import { createModelPreset } from '../src/react-app/providers/model-profiles';
import { minutesReasoning, requestedMinutesReasoning, supportsMinutesReasoning, withMinutesReasoning } from '../src/react-app/minutes/reasoning';
import { buildRegistrationRequest, freezeExecutionModel } from '../src/react-app/providers/model-registrations';
import { previewRegisteredMinutesSelection } from '../src/react-app/minutes/selection';

describe('per-memo reasoning effort', () => {
  it('blocks an incompatible run override in the preview without changing the saved sampling settings', () => {
    const base=createModelPreset('openai-text'),model={...base,requestParameters:{reasoning_effort:'none'},llm:{...base.llm,temperature:0.5}};
    const transcript={id:'fixture',parentId:null,rawIds:[],segments:[{id:'s',text:'Synthetic',sourceStartMs:0,sourceEndMs:1,rawIds:[]}],issues:[],missingRanges:[]};
    const settings={modelId:model.modelId,outputLanguage:'en',sections:['summary' as const],instructions:''};
    expect(previewRegisteredMinutesSelection(model,transcript,settings).status).toBe('fits');
    expect(previewRegisteredMinutesSelection(model,transcript,{...settings,reasoningEffort:'high'}).status).toBe('invalid-input');
    expect(model.llm.temperature).toBe(0.5);expect(model.requestParameters.reasoning_effort).toBe('none');
  });
  it('keeps the model default unchanged and freezes a direct OpenAI override separately', () => {
    const model = createModelPreset('openai-text');
    expect(requestedMinutesReasoning(model)).toBe('low');
    expect(withMinutesReasoning(model, undefined)).toEqual(model);
    const override = withMinutesReasoning(model, 'high');
    expect(requestedMinutesReasoning(override)).toBe('high');
    const body = JSON.parse(buildRegistrationRequest(freezeExecutionModel(override), 'preview').body as string);
    expect(body.reasoning_effort).toBe('high');
    expect(requestedMinutesReasoning(model)).toBe('low');
    expect(minutesReasoning(model)?.efforts).toContain('none');
    expect(() => withMinutesReasoning(model, 'minimal')).toThrow();
  });

  it('uses router options without combining effort with a previous enabled or token budget', () => {
    const model = createModelPreset('router-glm-5.3-flash');
    const legacy = { ...model, requestParameters: { reasoning: { enabled: true, max_tokens: 3000 } } };
    expect(supportsMinutesReasoning(legacy, 'none')).toBe(false);
    const selected = withMinutesReasoning(legacy, 'low');
    expect(selected.requestParameters?.reasoning).toEqual({ effort: 'low' });
    const body = JSON.parse(buildRegistrationRequest(freezeExecutionModel(selected), 'preview').body as string);
    expect(body.reasoning).toEqual({ effort: 'low' });
    expect(body.provider.require_parameters).toBe(true);
    expect(legacy.requestParameters.reasoning).toEqual({ enabled: true, max_tokens: 3000 });
  });
});
