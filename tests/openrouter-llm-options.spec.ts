import {expect,it} from 'vitest';
import {createModelPreset,MODEL_PRESETS} from '../src/react-app/providers/model-profiles';
import {openRouterLLMInfo,openRouterLLMIssues} from '../src/react-app/providers/openrouter-llm-options';
import {buildRegistrationRequest} from '../src/react-app/providers/model-registrations';
const models = [
 ['router-gpt-6.1-sol','openai/gpt-6.1-sol',['low','medium','high','xhigh','max'],true,'medium'],
 ['router-gpt-6.1-terra','openai/gpt-6.1-terra',['none','low','medium','high','xhigh','max'],false,'medium'],
 ['openrouter-text','openai/gpt-6-luna',['none','low','medium','high','xhigh','max'],false,'medium'],
 ['router-deepseek-v4.1-flash','deepseek/deepseek-v4.1-flash',['none','low','high','max'],false,'high'],
 ['router-glm-5.3-flash','z-ai/glm-5.3-flash',['low','high','max'],true,'max'],
 ['router-muse-spark-1.3-contributor','meta/muse-spark-1.3-contributor',['minimal','low','medium','high','xhigh','max'],true,'medium'],
 ['router-claude-haiku-5.5','anthropic/claude-haiku-5.5',['none','low','medium','high','xhigh','max'],false,'medium'],
] as const;
it.each(models)('provides documented options and canonical safe defaults for %s',(id,modelId,efforts,mandatory,defaultEffort)=>{
 const model=createModelPreset(id),info=openRouterLLMInfo(model);
 expect(model.modelId).toBe(modelId);expect(info).toMatchObject({efforts,mandatory,defaultEffort,checkedAt:'2026-10-29'});
 expect(model.requestParameters).toMatchObject({reasoning:{effort:'low'}});
 const body=JSON.parse(buildRegistrationRequest(model,{stage:'llm',transcript:'Synthetic',outputLanguage:'ko',sections:['summary'],instructions:''}).body as string);
 expect(body).toMatchObject({reasoning:{effort:'low'},provider:{require_parameters:true,data_collection:'deny',zdr:true,allow_fallbacks:false}});
});
it('reports catalog sample pricing, long-input adjustments and known limits without asserting routed provider costs',()=>{
 expect(openRouterLLMInfo(createModelPreset('router-gpt-6.1-sol'))).toMatchObject({inputUsdPerMillion:2,outputUsdPerMillion:10,priceOverrides:[{minInputTokens:272000,inputUsdPerMillion:4,outputUsdPerMillion:15}]});
 expect(openRouterLLMInfo(createModelPreset('router-glm-5.3-flash'))).toMatchObject({maxOutputTokens:131072});
 expect(openRouterLLMInfo(createModelPreset('compatible-text'))).toBeNull();
 expect(MODEL_PRESETS.some(p=>p.id==='router-mai-transcribe-1.5')).toBe(false);
});

it('reports unsupported effort, required reasoning and parameters without changing saved values',()=>{
 const model=createModelPreset('router-glm-5.3-flash');
 const params={reasoning:{effort:'medium',max_tokens:400},seed:2};
 const configured={...model,requestParameters:params};
 expect(openRouterLLMIssues(configured)).toEqual(expect.arrayContaining(['reasoning-effort','reasoning-conflict']));
 expect(configured.requestParameters).toEqual(params);
 expect(openRouterLLMIssues({...model,requestParameters:{reasoning:{enabled:false}}})).toContain('reasoning-required');
 const sol=createModelPreset('router-gpt-6.1-sol');
 expect(openRouterLLMIssues({...sol,llm:{...sol.llm,temperature:0}})).toContain('unsupported-parameter');
 expect(openRouterLLMIssues({...model,requestParameters:{reasoning:{effort:'low'},custom_option:true}})).toContain('unsupported-parameter');
 expect(openRouterLLMIssues(model)).toEqual([]);
});

it('blocks tool requests in the Markdown workflow and preserves them for explicit correction',()=>{
 const model=createModelPreset('router-gpt-6.1-terra'),params={tools:[{type:'function',function:{name:'fixture'}}],reasoning:{effort:'low'}};
 expect(openRouterLLMIssues({...model,requestParameters:params})).toContain('unsupported-workflow');
 expect(()=>buildRegistrationRequest({...model,requestParameters:params},{stage:'llm',transcript:'Synthetic',outputLanguage:'ko',sections:['summary'],instructions:''})).toThrow();
 expect(params.tools).toHaveLength(1);
 expect(openRouterLLMIssues({...model,requestParameters:{verbosity:'invalid'}})).toContain('invalid-parameter:verbosity');
 const sampling=createModelPreset('router-deepseek-v4.1-flash');
 expect(openRouterLLMIssues({...sampling,requestParameters:{top_logprobs:3}})).toContain('invalid-parameter:top_logprobs');
 expect(openRouterLLMIssues({...sampling,requestParameters:{top_logprobs:3,logprobs:true}})).toEqual([]);
});
it('checks token field support and documented numeric boundaries without modifying parameters',()=>{
 const model=createModelPreset('router-deepseek-v4.1-flash');
 expect(openRouterLLMIssues({...model,llm:{...model.llm,tokenField:'max_completion_tokens'}})).toContain('unsupported-parameter');
 for(const [field,value] of [['top_k',-1],['top_k',1.5],['min_p',1.01],['top_a',-0.1],['repetition_penalty',2.1],['presence_penalty',-2.1],['frequency_penalty',2.1],['seed',1.5],['top_logprobs',21],['logprobs','yes']] as const){
  const params={...model.requestParameters,[field]:value};expect(openRouterLLMIssues({...model,requestParameters:params})).toContain(`invalid-parameter:${field}`);expect(params[field]).toBe(value);
 }
 expect(openRouterLLMIssues({...model,requestParameters:{...model.requestParameters,seed:-1,top_k:0,min_p:1,top_a:0,repetition_penalty:2,frequency_penalty:-2,presence_penalty:2,top_logprobs:20,logprobs:true}})).toEqual([]);
});
