import { validateTranscriptionHints } from '../domain/stt-settings';
import { asObject, bodyProviderError, nonnegativeNumber, ProviderError, runPaidRequest, type FetchTransport, type RuntimeKeyGetter } from '../domain/pipeline';
import type { JobContext, MinutesRequest, MinutesRun, RawTranscript, SourceSegment, STTProvider, Usage } from '../domain/types';
import { buildMinutesMessages } from '../minutes/prompt';
import type { ChatMessage, MinutesFit, MinutesPreflight } from './openrouter';
import { buildRegistrationRequest, defaultRegistrationOutputTokens, sttInputSupport, freezeExecutionModel, registrationEndpoint, registrationReadiness, renderInstructionTemplate, type ModelRegistration } from './model-registrations';
export type RegisteredProviderOptions = Readonly<{ model: ModelRegistration; getKey: RuntimeKeyGetter; fetch?: FetchTransport; now?: () => number; timeoutMs?: number; makeId?: () => string; minutesMessages?: readonly ChatMessage[] }>;
export type RegisteredMinutesRun = MinutesRun & Readonly<{response:unknown;requestedEndpoint:string;modelSnapshot:ModelRegistration}>;
export async function readBoundedResponse(response: Response, signal: AbortSignal, maxBytes = 8*1024*1024): Promise<string> {
 if (Number(response.headers.get('Content-Length')) > maxBytes) { void response.body?.cancel(); throw new ProviderError('too-large'); }
 if (!response.body) return '';
 const reader = response.body.getReader(), decoder = new TextDecoder(); let bytes=0,text='';
 const stop=()=>{void reader.cancel().catch(()=>{});}; signal.addEventListener('abort',stop,{once:true});
 try { while(true) {signal.throwIfAborted();const chunk=await reader.read();signal.throwIfAborted();if(chunk.done)break;bytes+=chunk.value.byteLength;if(bytes>maxBytes){await reader.cancel();throw new ProviderError('too-large');}text+=decoder.decode(chunk.value,{stream:true});}return text+decoder.decode(); }
 finally {signal.removeEventListener('abort',stop);reader.releaseLock();}
}
function ready(model: ModelRegistration): void {
 const issues=registrationReadiness(model); if(issues.includes('credential-origin'))throw new ProviderError('authentication');
 if(issues.length)throw new ProviderError('invalid-input');
}
async function dispatch<T>(options: RegisteredProviderOptions, model:ModelRegistration, request:ReturnType<typeof buildRegistrationRequest>, job:JobContext, consume:(body:Record<string,unknown>, response:unknown, sanitize:(s:string)=>string, headers:Headers,elapsedMs:number)=>T):Promise<T> {
 const now=options.now??Date.now;
 return runPaidRequest(new URL(request.url).origin,job,async(signal,dispatched)=>{
  let secret:string|null=null;
  try {
   const headers=new Headers();
   if(model.auth==='bearer') {if(model.credentialOrigin!==new URL(request.url).origin)throw new ProviderError('authentication');secret=await options.getKey();job.assertActive();if(!secret?.trim()||/[\r\n]/u.test(secret))throw new ProviderError('authentication');headers.set('Authorization',`Bearer ${secret}`);}
   if(request.contentType)headers.set('Content-Type',request.contentType);
   signal.throwIfAborted();job.assertActive();const start=now();dispatched();
   const response=await(options.fetch??globalThis.fetch)(request.url,{method:'POST',body:request.body,headers,signal,redirect:'error',credentials:'omit',cache:'no-store'});job.assertActive();
   const text=await readBoundedResponse(response,signal);job.assertActive();
   const sanitize=(value:string)=>secret?value.split(secret).join('[redacted]'):value;
   const redact=(value:unknown):unknown=>typeof value==='string'?sanitize(value):Array.isArray(value)?value.map(redact):asObject(value)?Object.fromEntries(Object.entries(value as Record<string,unknown>).map(([k,v])=>[sanitize(k),redact(v)])):value;
   let body:Record<string,unknown>|null;try{body=asObject(JSON.parse(text));}catch{throw response.ok?new ProviderError('malformed'):bodyProviderError(null,response.status,now(),response.headers);}
   const safe=redact(body);
   if(!response.ok||body?.error!==undefined){const error=bodyProviderError(asObject(safe)?.error??null,response.status,now(),response.headers);throw error;}
   if(!body)throw new ProviderError('malformed');
   try{return consume(body,safe,sanitize,response.headers,Math.max(0,now()-start));}
   catch(error){if(error instanceof ProviderError)throw new ProviderError(error.code,{status:response.status,sensitiveResponse:safe});throw error;}
  } finally {secret=null;}
 },options);
}
function usage(value:unknown,elapsedMs:number,model:ModelRegistration):Usage {
 const u=asObject(value),input=asObject(u?.input_token_details),output=asObject(u?.output_token_details),cost=nonnegativeNumber(u?.cost);
 return {inputTokens:nonnegativeNumber(u?.input_tokens??u?.prompt_tokens),outputTokens:nonnegativeNumber(u?.output_tokens??u?.completion_tokens),durationSeconds:nonnegativeNumber(u?.seconds),audioInputTokens:nonnegativeNumber(input?.audio_tokens),textInputTokens:nonnegativeNumber(input?.text_tokens),audioOutputTokens:nonnegativeNumber(output?.audio_tokens),textOutputTokens:nonnegativeNumber(output?.text_tokens),elapsedMs,cost,costKind:cost===null?'unavailable':'reported',currency:cost===null?null:model.adapter==='openrouter'&&model.stage==='llm'?'credits':'USD',rateSource:null,rateCheckedAt:null,rateSnapshot:null};
}
export function registeredMinutesMessages(model:ModelRegistration,request:MinutesRequest,baseMessages?:readonly ChatMessage[]):readonly ChatMessage[] {
 const messages=baseMessages??buildMinutesMessages(request.transcript,{...request.settings,modelId:model.modelId});
 if(!model.instructionTemplate)return messages;
 const extra=renderInstructionTemplate(model.instructionTemplate,{stage:'llm',transcript:request.transcript.segments.map(s=>s.text).join('\n'),outputLanguage:request.settings.outputLanguage,sections:request.settings.sections,instructions:request.settings.instructions});
 return [...messages,{role:'user',content:extra}];
}
export function registeredMinutesFit(value:ModelRegistration,request:MinutesRequest,baseMessages?:readonly ChatMessage[]):MinutesFit {
 const model=freezeExecutionModel(value),messages=registeredMinutesMessages(model,request,baseMessages),input=messages.reduce((sum,m)=>sum+new TextEncoder().encode(m.content).byteLength+128,256),configuredContext=model.llm?.contextTokens??null,context=configuredContext===null?null:Math.min(configuredContext,model.catalogEvidence?.limits.contextTokens??Infinity),output=request.settings.outputTokens??defaultRegistrationOutputTokens(model)??null;
 const promptLimit=model.catalogEvidence?.limits.maxPromptTokens??null,maxOutput=model.llm?.maxTokens==null?null:Math.min(model.llm.maxTokens,model.catalogEvidence?.limits.maxOutputTokens??Infinity);
 const derived=context!==null&&output!==null?Math.max(0,context-output):null,effective=derived===null?null:Math.min(derived,promptLimit??Infinity);
 const missing=[...(context===null?['contextTokens']:[]),...(maxOutput===null?['maxTokens']:[])];
 return {inputTokenEstimate:input,estimateKind:'conservative-utf8-bytes',outputTokens:output,reasoningReserveTokens:0,contextTokens:context,maxPromptTokens:promptLimit,maxOutputTokens:maxOutput,derivedInputBudgetTokens:derived,effectiveInputBudgetTokens:effective,completionParameter:model.llm?.tokenField??null,completionCeilingTokens:output,visibleOutputTokens:null,status:missing.length?'missing-limits':effective!==null&&(input>effective||output!>maxOutput!)?'overflow':'fits',missingLimits:missing};
}
export function createRegisteredMinutesProvider(options:RegisteredProviderOptions):Readonly<{generate(request:MinutesRequest,job:JobContext):Promise<RegisteredMinutesRun>;completeMinutes(request:MinutesRequest,job:JobContext):Promise<RegisteredMinutesRun>;preflightMinutes(request:MinutesRequest):MinutesPreflight}> {
 const model=freezeExecutionModel(options.model);
 const preflightMinutes=(request:MinutesRequest):MinutesPreflight=>{ready(model);if(model.stage!=='llm'||request.settings.modelId!==model.modelId&&request.settings.modelId!==model.id)throw new ProviderError('invalid-input');const fit=registeredMinutesFit(model,request,options.minutesMessages);if(fit.status!=='fits')throw new ProviderError('context');return {inputTokenEstimate:fit.inputTokenEstimate,estimateKind:fit.estimateKind,outputTokens:fit.outputTokens!,reasoningReserveTokens:0,contextTokens:fit.contextTokens!,completionParameter:fit.completionParameter!,completionCeilingTokens:fit.outputTokens!,visibleOutputTokens:null};};
 const generate=async(request:MinutesRequest,job:JobContext):Promise<RegisteredMinutesRun>=>{
  job.assertActive();const preflight=preflightMinutes(request);
  const built=buildRegistrationRequest(model,{stage:'llm',transcript:request.transcript.segments.map(s=>s.text).join('\n'),outputLanguage:request.settings.outputLanguage,sections:request.settings.sections,instructions:request.settings.instructions},preflight.outputTokens);
  built.body=JSON.stringify({...JSON.parse(built.body as string),messages:registeredMinutesMessages(model,request,options.minutesMessages)});
  return dispatch(options,model,built,job,(body,response,sanitize,_headers,elapsedMs)=>{
   const choice=asObject(Array.isArray(body.choices)?body.choices[0]:null),message=asObject(choice?.message);
   if(typeof message?.content!=='string'||!message.content.trim()||message.refusal||message.tool_calls!=null&&(!Array.isArray(message.tool_calls)||message.tool_calls.length))throw new ProviderError('malformed');
   if(choice?.finish_reason!=='stop')throw new ProviderError(choice?.finish_reason==='length'?'incomplete':'malformed');
   return {id:request.runId,transcriptVersionId:request.transcript.id,settings:structuredClone(request.settings),generatedMarkdown:sanitize(message.content),requestedModel:model.modelId,returnedModel:typeof body.model==='string'?sanitize(body.model):null,actualProvider:typeof body.provider==='string'?sanitize(body.provider):null,usage:usage(body.usage,elapsedMs,model),response,requestedEndpoint:built.url,modelSnapshot:model};
  });
 };
 return {generate,completeMinutes:generate,preflightMinutes};
}
export function createRegisteredSTTProvider(options:RegisteredProviderOptions):STTProvider {
 const model=freezeExecutionModel(options.model);
 return {async transcribe(request,job){
  job.assertActive();ready(model);const c=request.chunk;
  try { validateTranscriptionHints(request.transcriptionHints); } catch { throw new ProviderError('invalid-input'); }
  const format=c.codec==='mp3'&&c.mimeType==='audio/mpeg'?'mp3':c.codec==='pcm-s16le'&&c.mimeType==='audio/wav'?'wav':null;
  if(model.stage!=='stt'||request.modelId!==model.modelId&&request.modelId!==model.id||!format||!model.stt?.formats?.includes(format)||!(request.audio instanceof Blob)||request.audio.type!==c.mimeType||request.audio.size!==c.encodedBytes||!c.encodedBytes||!request.runId||![c.sourceStartMs,c.sourceEndMs,c.encodingOffsetMs].every(Number.isSafeInteger)||c.sourceStartMs<0||c.sourceEndMs<=c.sourceStartMs||c.encodingOffsetMs<0||c.encodingOffsetMs>=c.sourceEndMs-c.sourceStartMs||request.expectedLanguages.some(v=>!v.trim())||model.stt.languageMode==='single'&&request.expectedLanguages.length>1)throw new ProviderError('invalid-input');
  if(request.audio.size>model.stt.maxBytes!||(c.sourceEndMs-c.sourceStartMs)/1000>model.stt.maxSeconds!||model.adapter==='openrouter'&&request.audio.size>16_000_000)throw new ProviderError('too-large');
  let encodedAudio: {data:string;format:string}|undefined;
  if(model.adapter==='openrouter'){const bytes=new Uint8Array(await request.audio.arrayBuffer());job.assertActive();const parts:string[]=[];for(let i=0;i<bytes.length;i+=24576){job.assertActive();let binary='';for(const byte of bytes.subarray(i,i+24576))binary+=String.fromCharCode(byte);parts.push(btoa(binary));}encodedAudio={data:parts.join(''),format};}
  const built=buildRegistrationRequest(model,{stage:'stt',file:new File([request.audio],`chunk.${format}`,{type:c.mimeType}),languages:request.expectedLanguages,glossary:request.transcriptionHints?.terms??sttInputSupport(model).defaultTerms,context:request.transcriptionHints?.context??'',encodedAudio});
  if(typeof built.body==='string'&&new TextEncoder().encode(built.body).length>24_000_000)throw new ProviderError('too-large');
  return dispatch(options,model,built,job,(body,response,sanitize,headers,elapsedMs):RawTranscript=>{
   if(typeof body.text!=='string')throw new ProviderError('malformed');if(body.finish_reason!==undefined&&body.finish_reason!=='stop')throw new ProviderError('incomplete');
   const id=(options.makeId??(()=>crypto.randomUUID()))(),normalized:{segments:SourceSegment[];words:SourceSegment[]}={segments:[],words:[]};let speakers=false;
   for(const key of ['segments','words'] as const){if(body[key]===undefined)continue;if(!Array.isArray(body[key]))throw new ProviderError('malformed');for(const[index,item]of body[key].entries()){const entry=asObject(item),start=nonnegativeNumber(entry?.start),end=nonnegativeNumber(entry?.end),text=entry?.[key==='words'?'word':'text'];if(start===null||end===null||end<start||typeof text!=='string')throw new ProviderError('malformed');const from=c.sourceStartMs+Math.round(start*1000)-c.encodingOffsetMs,to=c.sourceStartMs+Math.round(end*1000)-c.encodingOffsetMs;if(!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||to<c.sourceStartMs||from>c.sourceEndMs)throw new ProviderError('malformed');speakers ||= typeof entry?.speaker==='string'||typeof entry?.speaker==='number';normalized[key].push({id:`${id}:${key}:${index}`,text:sanitize(text),sourceStartMs:Math.max(c.sourceStartMs,from),sourceEndMs:Math.min(c.sourceEndMs,to),rawIds:[id],...(typeof entry?.speaker==='number'||typeof entry?.speaker==='string'?{speaker:typeof entry.speaker==='string'?sanitize(entry.speaker):entry.speaker}:{})});}}
   const timing=normalized.words.length?'word':normalized.segments.length?'segment':'chunk',segments=normalized.words.length?normalized.words:normalized.segments.length?normalized.segments:body.text?[{id:`${id}:chunk`,text:sanitize(body.text),sourceStartMs:c.sourceStartMs,sourceEndMs:c.sourceEndMs,rawIds:[id]}]:[];
   const returnedModel=typeof body.model==='string'?sanitize(body.model):null,actualProvider=typeof body.provider==='string'?sanitize(body.provider):null;
   return {id,chunkId:c.id,runId:request.runId,response,text:sanitize(body.text),segments,timing,speakerScope:speakers?'chunk':'none',responseMetadata:{generationId:headers.get('X-Generation-Id'),returnedModel,actualProvider},execution:{requestedModel:model.modelId,returnedModel,actualProvider,expectedLanguages:[...request.expectedLanguages],usage:usage(body.usage,elapsedMs,model)},requestedEndpoint:registrationEndpoint(model)} as RawTranscript;
  });
 }};
}
