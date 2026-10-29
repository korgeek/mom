import { it, expect, vi } from 'vitest';
import { cancelJobs, createJobContext } from '../src/react-app/domain/jobs';
import { createModelPreset } from '../src/react-app/providers/model-profiles';
import { buildRegistrationRequest, registrationReadiness, validateRegistration } from '../src/react-app/providers/model-registrations';
import { createRegisteredSTTProvider } from '../src/react-app/providers/registered-runtime';
const audio=new Blob([new Uint8Array(20)],{type:'audio/wav'});
const chunk={id:'chunk',sourceId:'source',index:0,sourceStartMs:0,sourceEndMs:1000,encodingOffsetMs:0,encodedBytes:20,mimeType:'audio/wav',codec:'pcm-s16le' as const,audioRecordId:'audio'};
const model=()=>validateRegistration({...createModelPreset('openai-gpt-transcribe'),enabled:true,auth:'none',stt:{...createModelPreset('openai-gpt-transcribe').stt,stream:true}});
const request={modelId:'gpt-transcribe',runId:'run',audio,chunk,expectedLanguages:['ko','en'],transcriptionHints:{terms:['MoM'],context:'meeting'}};
const event=(value:unknown)=>`data: ${JSON.stringify(value)}\n\n`;
it('sends one streaming request and stores all redacted events with final text',async()=>{
 const fetch=vi.fn(async(_url:RequestInfo|URL, init?:RequestInit)=>{const form=init?.body as FormData;expect(form.get('stream')).toBe('true');expect(form.getAll('languages[]')).toEqual(['ko','en']);expect(form.getAll('keywords[]')).toEqual(['MoM']);expect(form.get('prompt')).toBe('meeting');return new Response(event({type:'transcript.text.delta',delta:'Hello '})+event({type:'transcript.text.done',text:'Hello world',languages:[{code:'en'}]}),{headers:{'Content-Type':'text/event-stream'}});});
 const raw=await createRegisteredSTTProvider({model:model(),getKey:()=>null,fetch}).transcribe(request,createJobContext());
 expect(raw.text).toBe('Hello world');expect(raw.response).toMatchObject({events:[{type:'transcript.text.delta'},{type:'transcript.text.done',languages:[{code:'en'}]}]});expect(fetch).toHaveBeenCalledOnce();
});
it.each([
 [event({type:'transcript.text.delta',delta:'partial'}),'incomplete'],
 ['data: {bad}\n\n','malformed'],
 [event({type:'error',error:{message:'failure'}}),'provider-unavailable'],
 ['data: {"type":"transcript.text.done","text":"unfinished frame"}','incomplete'],
] as const)('does not save incomplete, malformed or error event streams',async (stream,code)=>{
 const fetch=vi.fn(async()=>new Response(stream));
 await expect(createRegisteredSTTProvider({model:model(),getKey:()=>null,fetch}).transcribe(request,createJobContext())).rejects.toMatchObject({code});expect(fetch).toHaveBeenCalledOnce();
});
it('validates stream route, undocumented parameters and forbidden keywords before dispatch',async()=>{
 const m=model(); expect(registrationReadiness(validateRegistration({...m,modelId:'whisper-1'}))).toContain('stt-model-stream');
 expect(registrationReadiness(validateRegistration({...m,requestParameters:{include:['logprobs']}}))).toContain('stt-model-parameters');
 const fetch=vi.fn();const provider=createRegisteredSTTProvider({model:m,getKey:()=>null,fetch});
 await expect(provider.transcribe({...request,transcriptionHints:{terms:['<bad>'],context:''}},createJobContext())).rejects.toMatchObject({code:'invalid-input'});
 await expect(provider.transcribe({...request,expectedLanguages:['en-US']},createJobContext())).rejects.toMatchObject({code:'invalid-input'}); expect(fetch).not.toHaveBeenCalled();
 expect((buildRegistrationRequest(m,'preview').body as FormData).get('stream')).toBe('true');
});
it('cancels the reader without promoting a partial stream or issuing another request',async()=>{
 let controller!:ReadableStreamDefaultController<Uint8Array>;
 const body=new ReadableStream<Uint8Array>({start(value){controller=value;value.enqueue(new TextEncoder().encode(event({type:'transcript.text.delta',delta:'partial'})));}});
 const fetch=vi.fn(async()=>new Response(body));const job=createJobContext();
 const promise=createRegisteredSTTProvider({model:model(),getKey:()=>null,fetch}).transcribe(request,job);
 await vi.waitFor(()=>expect(fetch).toHaveBeenCalledOnce());cancelJobs();
 await expect(promise).rejects.toMatchObject({name:'AbortError'});expect(fetch).toHaveBeenCalledOnce();
 void controller;
});
it('redacts a key in streamed events before returning the saved response',async()=>{
 const protectedModel=validateRegistration({...model(),auth:'bearer',credentialOrigin:'https://api.openai.com'});
 const fetch=vi.fn(async()=>new Response(event({type:'transcript.text.delta',delta:'SYNTHETIC_SECRET'})+event({type:'transcript.text.done',text:'SYNTHETIC_SECRET done'})));
 const result=await createRegisteredSTTProvider({model:protectedModel,getKey:()=> 'SYNTHETIC_SECRET',fetch}).transcribe(request,createJobContext());
 expect(JSON.stringify(result)).not.toContain('SYNTHETIC_SECRET');expect(result.text).toBe('[redacted] done');
});
it('preserves structured stream error fields for encrypted request history',async()=>{
 const error={message:'Unsupported option',code:'invalid_parameter',param:'languages',type:'invalid_request_error'};
 const fetch=vi.fn(async()=>new Response(event({type:'error',error})));
 try { await createRegisteredSTTProvider({model:model(),getKey:()=>null,fetch}).transcribe(request,createJobContext());throw Error('Expected stream failure'); }
 catch(failure){expect(failure).toMatchObject({code:'provider-unavailable',httpStatus:200});expect((failure as {readSensitiveResponse():unknown}).readSensitiveResponse()).toMatchObject({error,events:[{type:'error',error}]});}
 expect(fetch).toHaveBeenCalledOnce();
});
it('blocks incompatible direct OpenAI reasoning and sampling before an LLM request',()=>{
 const llm=validateRegistration({...createModelPreset('openai-text'),llm:{...createModelPreset('openai-text').llm,temperature:0.5},requestParameters:{reasoning_effort:'medium'}});
 expect(registrationReadiness(llm)).toContain('llm-model-sampling');
 expect(()=>buildRegistrationRequest(llm,{stage:'llm',transcript:'Synthetic',outputLanguage:'en',sections:['summary'],instructions:''})).toThrow();
});
