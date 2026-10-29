import {expect,it} from 'vitest';
import {createModelPreset, MODEL_PRESETS} from '../src/react-app/providers/model-profiles';
import {OPENAI_REASONING_EFFORTS, openAIModelInfo, openAIReasoningIssue} from '../src/react-app/providers/openai-models';

it('offers only the requested direct OpenAI presets with low reasoning',()=>{
 const direct=MODEL_PRESETS.filter(p=>p.adapter==='openai');
 expect(direct.filter(p=>p.stage==='stt').map(p=>p.modelId)).toEqual(['gpt-transcribe']);
 expect(direct.filter(p=>p.stage==='llm').map(p=>p.modelId).sort()).toEqual(['gpt-6-luna','gpt-6.1-terra']);
 for(const id of ['openai-text','openai-gpt-6.1-terra'])expect(createModelPreset(id).requestParameters?.reasoning_effort).toBe('low');
 expect(MODEL_PRESETS.some(p=>p.id==='router-gpt-6.1-sol')).toBe(true);
});
it('reports official standard rates and the long input adjustment only for known direct models',()=>{
 expect(openAIModelInfo('openai','gpt-6.1-terra')).toMatchObject({inputUsdPerMillion:1,outputUsdPerMillion:5,checkedAt:'2026-10-29',longInputTokens:272_000,longInputMultiplier:2,longOutputMultiplier:1.5});
 expect(openAIModelInfo('openai','gpt-6-luna')).toMatchObject({inputUsdPerMillion:0.1,outputUsdPerMillion:0.5,checkedAt:'2026-10-29'});
 expect(openAIModelInfo('openrouter','gpt-6-luna')).toBeNull();expect(openAIModelInfo('openai','other')).toBeNull();
});
it('checks supported efforts and non-none sampling restrictions without altering old configurations',()=>{
 const base=createModelPreset('openai-text');
 for(const effort of OPENAI_REASONING_EFFORTS)expect(openAIReasoningIssue({...base,requestParameters:{reasoning_effort:effort}})).toBeUndefined();
 expect(openAIReasoningIssue({...base,requestParameters:{reasoning_effort:'invalid'}})).toBe('effort');
 expect(openAIReasoningIssue({...base,requestParameters:{reasoning_effort:'none'},llm:{...base.llm,temperature:0.5}})).toBeUndefined();
 expect(openAIReasoningIssue({...base,requestParameters:{},llm:{...base.llm,temperature:0}})).toBe('sampling');
 expect(openAIReasoningIssue({...base,requestParameters:{reasoning_effort:'low',logprobs:false}})).toBe('sampling');
 expect(openAIReasoningIssue({...base,adapter:'openrouter',requestParameters:{reasoning_effort:'bogus'}})).toBeUndefined();
});
