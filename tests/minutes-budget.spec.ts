import {expect,it,vi} from 'vitest';
import {createModelPreset} from '../src/react-app/providers/model-profiles';
import {validateRegistration} from '../src/react-app/providers/model-registrations';
import {createRegisteredMinutesProvider} from '../src/react-app/providers/registered-runtime';
import {previewRegisteredMinutesSelection} from '../src/react-app/minutes/selection';
import {previewComparison} from '../src/react-app/minutes/compare';
import {createJobContext} from '../src/react-app/domain/jobs';
import type {MinutesRequest} from '../src/react-app/domain/types';
const model=validateRegistration({...createModelPreset('compatible-text'),enabled:true,llm:{contextTokens:8192,maxTokens:4096,tokenField:'max_tokens'}});
const request:MinutesRequest={runId:'synthetic',transcript:{id:'speech',parentId:null,rawIds:[],segments:[{id:'segment',text:'Synthetic speech',sourceStartMs:0,sourceEndMs:1000,rawIds:[]}],issues:[],missingRanges:[]},settings:{modelId:model.modelId,outputLanguage:'en',sections:['summary'],instructions:'',outputTokens:1024}};
it('uses the saved per-memo output budget in preview, comparison and actual request without mutating the model',async()=>{
 const preview=previewRegisteredMinutesSelection(model,request.transcript,request.settings);
 expect(preview.status).toBe('fits');expect(preview.limits).toMatchObject({outputTokens:1024,maxOutputTokens:4096});
 const other={...model,id:'other',modelId:'synthetic-other'};
 expect(previewComparison({transcript:request.transcript,settings:request.settings,choices:[{registration:model},{registration:other}]})).toMatchObject({status:'fits',outputTokens:1024});
 let body:Record<string,unknown>={};const provider=createRegisteredMinutesProvider({model,getKey:()=>null,fetch:async(_url,init)=>{body=JSON.parse(init!.body as string);return new Response(JSON.stringify({choices:[{message:{content:'# Synthetic notes'},finish_reason:'stop'}]}));}});
 const result=await provider.generate(request,createJobContext());expect(body.max_tokens).toBe(1024);expect(result.settings.outputTokens).toBe(1024);expect(model.llm!.maxTokens).toBe(4096);
});
it('blocks invalid budgets, exceeded limits and missing model limits before transport',async()=>{
 const fetch=vi.fn(),getKey=vi.fn(()=>null);
 for(const outputTokens of [0,-1,1.5,NaN,Infinity,1000001,4097])await expect(createRegisteredMinutesProvider({model,getKey,fetch}).generate({...request,settings:{...request.settings,outputTokens}},createJobContext())).rejects.toBeDefined();
 await expect(createRegisteredMinutesProvider({model:{...model,llm:{contextTokens:8192,tokenField:'max_tokens'}},getKey,fetch}).generate(request,createJobContext())).rejects.toBeDefined();
 expect(fetch).not.toHaveBeenCalled();expect(getKey).not.toHaveBeenCalled();
 expect(previewRegisteredMinutesSelection(model,request.transcript,{...request.settings,outputTokens:4097}).status).toBe('overflow');
 const other={...model,id:'other',modelId:'synthetic-other',llm:{...model.llm,maxTokens:512}};
 expect(previewComparison({transcript:request.transcript,settings:request.settings,choices:[{registration:model},{registration:other}]}).status).toBe('overflow');
});
it('sends instructions-only output through real preflight and request building while keeping grounding rules',async()=>{
 const fetch=vi.fn<typeof globalThis.fetch>(async()=>new Response(JSON.stringify({choices:[{message:{content:'Synthetic paragraph.'},finish_reason:'stop'}]})));
 const provider=createRegisteredMinutesProvider({model,getKey:()=>null,fetch});
 const custom={...request,settings:{...request.settings,sections:[],instructions:'Write one short paragraph.'}};
 const result=await provider.generate(custom,createJobContext());expect(result.settings.sections).toEqual([]);
 const body=JSON.parse(fetch.mock.calls[0][1]!.body as string);expect(JSON.parse(body.messages[1].content).output).toMatchObject({sections:[],instructions:custom.settings.instructions});
 expect(body.messages[0].content).toContain('When output.sections is empty');expect(body.messages[0].content).toMatch(/Never invent speakers/);
 const before=fetch.mock.calls.length;await expect(provider.generate({...custom,settings:{...custom.settings,instructions:'  '}},createJobContext())).rejects.toBeDefined();expect(fetch).toHaveBeenCalledTimes(before);
});
it('defaults to 4K independently of a higher model ceiling and sends explicitly selected 8K or 16K unchanged',async()=>{
 const high=validateRegistration({...model,llm:{...model.llm,contextTokens:64000,maxTokens:16384}});
 const {outputTokens:_,...settings}=request.settings;void _;
 const body:Record<string,unknown>[]=[];
 const provider=createRegisteredMinutesProvider({model:high,getKey:()=>null,fetch:async(_url,init)=>{body.push(JSON.parse(init!.body as string));return new Response(JSON.stringify({choices:[{message:{content:'# Synthetic notes'},finish_reason:'stop'}]}));}});
 for(const outputTokens of [undefined,8192,16384]){
  const next={...request,settings:{...settings,...(outputTokens===undefined?{}:{outputTokens})}},expected=outputTokens??4096;
  expect(previewRegisteredMinutesSelection(high,next.transcript,next.settings).limits).toMatchObject({outputTokens:expected,maxOutputTokens:16384});
  await provider.generate(next,createJobContext());expect(body.at(-1)?.max_tokens).toBe(expected);
 }
 expect(high.llm?.maxTokens).toBe(16384);
 expect(previewComparison({transcript:request.transcript,settings,choices:[{registration:high},{registration:{...high,id:'other',modelId:'other'}}]}).outputTokens).toBe(4096);
});
it('uses a lower accepted endpoint ceiling for the default in both single and comparison previews',()=>{
 const evidence={route:{connectionId:'synthetic',provider:'openrouter',stage:'minutes',modelId:model.modelId,endpointTag:'synthetic/provider'},limits:{contextTokens:8192,maxPromptTokens:7000,maxOutputTokens:512,maxBytes:null}};
 const limited=validateRegistration({...model,catalogEvidence:evidence});
 const {outputTokens:_,...settings}=request.settings;void _;
 expect(previewRegisteredMinutesSelection(limited,request.transcript,settings)).toMatchObject({status:'fits',limits:{outputTokens:512,maxOutputTokens:512}});
 expect(previewComparison({transcript:request.transcript,settings,choices:[{registration:limited},{registration:{...model,id:'other',modelId:'other'}}]})).toMatchObject({status:'fits',outputTokens:512});
});
