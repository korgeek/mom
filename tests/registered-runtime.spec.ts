import { it, expect, vi } from 'vitest';
import { createJobContext } from '../src/react-app/domain/jobs';
import { validateRegistration, normalizeRegistrations, registrationSignature, registrationReadiness, freezeExecutionModel, buildRegistrationRequest } from '../src/react-app/providers/model-registrations';
import { exportModelProfiles, importModelProfiles, createModelPreset } from '../src/react-app/providers/model-profiles';
import { createRegisteredSTTProvider, createRegisteredMinutesProvider } from '../src/react-app/providers/registered-runtime';
const base = {id:'fixture',name:'Synthetic',stage:'stt',baseUrl:'http://localhost:8000/v1',modelId:'synthetic',auth:'none',credentialOrigin:null,credentialVersion:0,enabled:true,stt:{formats:['wav','mp3'],maxBytes:16000000,maxSeconds:900}};
const audio = new Blob([new Uint8Array(20)],{type:'audio/wav'});
const request = {modelId:'synthetic',runId:'run',audio,expectedLanguages:['en'],chunk:{id:'chunk',sourceId:'source',index:0,sourceStartMs:10000,sourceEndMs:20000,encodingOffsetMs:100,encodedBytes:20,mimeType:'audio/wav',codec:'pcm-s16le',audioRecordId:'audio'}};
const minutes = {runId:'run',transcript:{id:'transcript',parentId:null,rawIds:[],segments:[{id:'segment',text:'Synthetic meeting',sourceStartMs:0,sourceEndMs:1,rawIds:[]}],issues:[],missingRanges:[]},settings:{modelId:'synthetic',outputLanguage:'en',sections:['summary'] as const,instructions:''}};
it('uses frozen comparison messages in both registered request preflight and dispatch', async () => {
 const model = validateRegistration({...base,stage:'llm',llm:{contextTokens:8000,maxTokens:500},instructionTemplate:'Write in {{output_language}}'});
 const messages = [{role:'system' as const,content:'SAVED_V1_PROMPT'}, {role:'user' as const,content:'SAVED_SELECTED_TRANSCRIPT'}];
 const fetch = vi.fn(async (_url:RequestInfo|URL, init?:RequestInit) => {
  const body = JSON.parse(init?.body as string);
  expect(body.messages.slice(0, 2)).toEqual(messages); expect(body.messages[2].content).toBe('Write in en');
  return response({choices:[{message:{content:'# Saved retry'},finish_reason:'stop'}]});
 });
 const provider = createRegisteredMinutesProvider({model,getKey:()=>null,fetch,minutesMessages:messages});
 const fit = provider.preflightMinutes(minutes);
 expect(fit.inputTokenEstimate).toBeLessThan(1000);
 await provider.generate(minutes,createJobContext()); expect(fetch).toHaveBeenCalledOnce();
});
const response = (body:unknown)=>new Response(JSON.stringify(body));
it('uses automatic language detection in the shared OpenRouter preset for multilingual memos',async()=>{
 const preset=createModelPreset('mai-transcribe-2',()=> 'multilingual');let sent:Record<string,unknown>={};
 const model=validateRegistration({...preset,enabled:true,credentialOrigin:'https://openrouter.ai',routerPolicy:{requireZdr:true,acknowledged:true}});
 const provider=createRegisteredSTTProvider({model,getKey:()=> 'SYNTHETIC_ONLY_KEY',fetch:async(_url,init)=>{sent=JSON.parse(String(init?.body));return response({text:'Synthetic multilingual memo'});}});
 const result=await provider.transcribe({...request,modelId:model.modelId,expectedLanguages:['ko','en']},createJobContext());
 expect(result.text).toBe('Synthetic multilingual memo');expect(sent).not.toHaveProperty('language');
});
it('normalizes v1 to disabled v2 and excludes display edits from execution identity',()=>{
 const v=normalizeRegistrations({version:1,entries:[base]});expect(v.version).toBe(2);expect(v.defaults).toEqual({stt:null,llm:null});
 expect(normalizeRegistrations({version:1,entries:[{...base,enabled:undefined}]}).entries[0].enabled).toBe(false);
 expect(registrationSignature({...base,name:'renamed'} as never)).toBe(registrationSignature(base as never));
 expect(Object.isFrozen(freezeExecutionModel(base as never).stt)).toBe(true);expect(registrationReadiness(validateRegistration(base))).toEqual([]);
 expect(registrationReadiness(validateRegistration({...base,stage:'llm',llm:{}}))).toContain('llm-limits');
});
it('shares validated public profiles with fresh disabled identities and no credentials/tests',()=>{
 const original=validateRegistration({...base,auth:'bearer',credentialOrigin:'http://localhost:8000',credentialVersion:4});
 const serialized=exportModelProfiles([original]);expect(serialized).not.toContain('credential');expect(serialized).not.toContain('keyStorage');expect(serialized).not.toContain('"id"');
 const imported=importModelProfiles(serialized,()=> 'fresh');expect(imported[0]).toMatchObject({id:'fresh',enabled:false,credentialOrigin:null,credentialVersion:0});
 expect(JSON.parse(exportModelProfiles(imported)).models).toEqual(JSON.parse(serialized).models);
 expect(importModelProfiles(JSON.stringify({...JSON.parse(serialized),models:[{...JSON.parse(serialized).models[0],keyStorage:'session'}]}),()=> 'legacy-profile')[0].keyStorage).toBe('encrypted');
 for(const value of [{apiKey:'synthetic'},{requestParameters:{provider:{zdr:false}}},{requestParameters:{messages:[]}},{testTranscript:'private'}])expect(()=>importModelProfiles(JSON.stringify({format:'mom-models',version:1,models:[{...JSON.parse(serialized).models[0],...value}]}))).toThrow();
 expect(()=>importModelProfiles(' '.repeat(262145))).toThrow();
});
it('preserves MAI nested Azure options and typed word timestamps',()=>{
 const model=createModelPreset('mai-transcribe-2',()=> 'mai');
 const built=buildRegistrationRequest(model,{stage:'stt',file:new File([audio],'a.wav'),encodedAudio:{data:'AAAA',format:'wav'},languages:[],glossary:[],context:''});
 expect(JSON.parse(built.body as string)).toMatchObject({model:'microsoft/mai-transcribe-2',response_format:'verbose_json',timestamp_granularities:['word'],provider:{data_collection:'deny',zdr:true,options:{azure:{diarization:{enabled:true},phraseList:{phrases:[]},enhancedMode:{modelOptions:{transcribeStyle:'clean'}}}}}});
});
it('shows the actual OpenRouter retention and pinned routing fields in the notes request preview',()=>{
 const model=validateRegistration({...createModelPreset('openrouter-text',()=> 'preview'),routerEndpointTag:'synthetic/explicit'});
 const built=buildRegistrationRequest(model,'preview'),actual=JSON.parse(built.body as string);
 const shown=JSON.parse(built.preview.slice(built.preview.indexOf('\n{')+1,built.preview.indexOf('\n\nresponse.')));
 expect(shown.provider).toEqual(actual.provider);
 expect(shown.provider).toMatchObject({data_collection:'deny',zdr:true,allow_fallbacks:false,only:['synthetic/explicit']});
});
it.each(['openai','openrouter','openai-compatible'] as const)('executes %s STT and LLM once using explicit endpoint',async adapter=>{
 const url=adapter==='openai'?'https://api.openai.com/v1':adapter==='openrouter'?'https://openrouter.ai/api/v1':'http://localhost:8000/v1';
 const model=validateRegistration({...base,baseUrl:url,adapter,routerPolicy:{requireZdr:true,acknowledged:true}});
 const fetch=vi.fn(async (_url:RequestInfo|URL,init?:RequestInit)=>{expect(init?.redirect).toBe('error');expect(init?.credentials).toBe('omit');expect(new Headers(init?.headers).has('Authorization')).toBe(false);return response({text:'hello',segments:[{start:0.1,end:1.1,text:'hello',speaker:2}],words:[{start:0.1,end:1.1,word:'hello',speaker:2}],model:'returned',provider:'actual',usage:{cost:0.2}});});
 const stt=await createRegisteredSTTProvider({model,getKey:()=>null,fetch}).transcribe(request,createJobContext());
 expect(stt.segments[0]).toMatchObject({sourceStartMs:10000,sourceEndMs:11000,speaker:2});expect(stt.timing).toBe('word');expect(stt.response).toMatchObject({words:[{speaker:2}]});expect(stt.execution?.usage.costKind).toBe('reported');expect(fetch).toHaveBeenCalledOnce();expect(fetch.mock.calls[0][1]?.cache).toBe("no-store");
 const llm=validateRegistration({...model,stage:'llm',llm:{contextTokens:8000,maxTokens:500},instructionTemplate:'Write in {{output_language}}; {{instructions}}'});
 const textFetch=vi.fn(async (_url:RequestInfo|URL,init?:RequestInit)=>{const body=JSON.parse(init?.body as string);expect(body.stream).toBe(false);expect(JSON.stringify(body.messages)).toContain('Synthetic meeting');return response({model:'returned',choices:[{message:{content:'# Synthetic'},finish_reason:'stop'}]});});
 const result=await createRegisteredMinutesProvider({model:llm,getKey:()=>null,fetch:textFetch}).generate(minutes,createJobContext());expect(result.generatedMarkdown).toBe('# Synthetic');expect(result.requestedEndpoint).toBe(url+'/chat/completions');expect(result.response).toMatchObject({model:'returned'});expect(textFetch).toHaveBeenCalledOnce();expect(textFetch.mock.calls[0][1]?.cache).toBe("no-store");
});
it('rejects origin mismatch, unacknowledged routing and oversized responses without retries',async()=>{
 const fetch=vi.fn(),getKey=vi.fn(()=> 'synthetic');
 const mismatch=validateRegistration({...base,auth:'bearer',credentialOrigin:'https://wrong.example'});
 await expect(createRegisteredSTTProvider({model:mismatch,getKey,fetch}).transcribe(request,createJobContext())).rejects.toMatchObject({code:'authentication'});expect(getKey).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
 const router=validateRegistration({...base,adapter:'openrouter',baseUrl:'https://openrouter.ai/api/v1'});
 await expect(createRegisteredSTTProvider({model:router,getKey,fetch}).transcribe(request,createJobContext())).rejects.toMatchObject({code:'invalid-input'});
 const huge=vi.fn(async()=> new Response('x'.repeat(8*1024*1024+1)));
 await expect(createRegisteredSTTProvider({model:validateRegistration(base),getKey,fetch:huge}).transcribe(request,createJobContext())).rejects.toMatchObject({code:'too-large'});expect(huge).toHaveBeenCalledOnce();
});
it('rejects override fields, unknown placeholders and unsafe JSON before requests',()=>{
 for(const requestParameters of [{model:'x'},{provider:{only:['x']}},{headers:{}},JSON.parse('{"__proto__":{}}')])expect(()=>validateRegistration({...base,requestParameters})).toThrow();
 expect(()=>validateRegistration({...base,instructionTemplate:'{{unknown}}'})).toThrow();
});

it('redacts reflected credentials without altering semantic response parsing',async()=>{
 const model=validateRegistration({...base,auth:'bearer',credentialOrigin:'http://localhost:8000',stage:'llm',llm:{contextTokens:8000,maxTokens:500}});
 const result=await createRegisteredMinutesProvider({model,getKey:()=> 'content',fetch:async()=>response({choices:[{message:{content:'content fixture'},finish_reason:'stop'}]})}).generate(minutes,createJobContext());
 expect(result.generatedMarkdown).toBe('[redacted] fixture');expect(JSON.stringify(result.response)).not.toContain('content');
});
it.each(['refusal','tools','length','empty'])('does not promote %s LLM output to success',async variant=>{
 const model=validateRegistration({...base,stage:'llm',llm:{contextTokens:8000,maxTokens:500}});
 const message={content:variant==='empty'?'':'partial',...(variant==='refusal'?{refusal:'no'}:{}),...(variant==='tools'?{tool_calls:[{}]}:{})};
 const fetch=vi.fn(async()=>response({choices:[{message,finish_reason:variant==='length'?'length':'stop'}]}));
 await expect(createRegisteredMinutesProvider({model,getKey:()=>null,fetch}).generate(minutes,createJobContext())).rejects.toBeDefined();expect(fetch).toHaveBeenCalledOnce();
});
it('rejects wrong official endpoint paths and preserves explicit full compatible URLs',()=>{
 expect(()=>validateRegistration({...base,adapter:'openai',endpointUrl:'https://api.openai.com/elsewhere'})).toThrow();
 const model=validateRegistration({...base,endpointUrl:'http://localhost:8000/custom'});expect(buildRegistrationRequest(model,'preview').url).toBe('http://localhost:8000/custom');
});

it('shares the endpoint pin and configured limits without importing trusted price evidence',()=>{
 const evidence={route:{connectionId:'legacy',provider:'openrouter',stage:'minutes',modelId:'synthetic',endpointTag:'synthetic/provider'},limits:{contextTokens:8000,maxPromptTokens:7000,maxOutputTokens:500,maxBytes:null}};
 const model=validateRegistration({...base,stage:'llm',baseUrl:'https://openrouter.ai/api/v1',adapter:'openrouter',catalogEvidence:evidence,llm:{contextTokens:8000,maxTokens:500}});
 const shared=importModelProfiles(exportModelProfiles([model]),()=> 'shared')[0];
 expect(shared.routerEndpointTag).toBe('synthetic/provider');
 expect(shared.catalogEvidence).toBeUndefined();
 expect(shared.llm).toMatchObject({contextTokens:8000,maxTokens:500});
 const body=JSON.parse(buildRegistrationRequest(shared,{stage:'llm',transcript:'synthetic',outputLanguage:'en',sections:['summary'],instructions:''}).body as string);
 expect(body.provider).toMatchObject({only:['synthetic/provider'],allow_fallbacks:false});
});

it.each([
 ['',401,'authentication'],
 ['NON_JSON_SYNTHETIC_ERROR',401,'authentication'],
 ['NON_JSON_SYNTHETIC_RESPONSE',200,'malformed'],
] as const)('classifies a non-JSON response %j with HTTP %i before parsing details',async(body,status,code)=>{
 const fetch=vi.fn(async()=>new Response(body,{status}));
 const provider=createRegisteredSTTProvider({model:validateRegistration(base),getKey:()=>null,fetch});
 await expect(provider.transcribe(request,createJobContext())).rejects.toMatchObject({code,...(status===401?{status}:{})});
 expect(fetch).toHaveBeenCalledOnce();
});
