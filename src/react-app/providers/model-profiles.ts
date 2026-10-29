import { validateRegistration, validatePublicJson, type ModelRegistration } from './model-registrations';

export function exportModelProfiles(entries: readonly ModelRegistration[]): string {
 if (entries.length > 150) throw new Error('Too many models');
 const models = entries.map(value => {
  const normalized=validateRegistration(value);
  const model = Object.fromEntries(Object.entries(normalized).filter(([key]) => !['id','credentialId','credentialOrigin','credentialVersion','keyStorage','lastTest','enabled','revision','catalogEvidence'].includes(key)));
  const endpointTag=normalized.routerEndpointTag??normalized.catalogEvidence?.route.endpointTag;
  if(normalized.adapter==='openrouter'&&normalized.stage==='llm'&&endpointTag)model.routerEndpointTag=endpointTag;
  const policy = model.routerPolicy as ModelRegistration['routerPolicy'];
  return { ...model, ...(policy ? {routerPolicy:{...policy,acknowledged:false}} : {}) };
 });
 const text = JSON.stringify({format:'mom-models',version:1,models},null,2);
 if (new TextEncoder().encode(text).length > 256*1024) throw new Error('Profile exceeds 256 KiB');
 return text;
}
export function importModelProfiles(text: string, makeId: () => string = () => crypto.randomUUID()): readonly ModelRegistration[] {
 if (typeof text !== 'string' || new TextEncoder().encode(text).length > 256*1024) throw new Error('Profile exceeds 256 KiB');
 const data: unknown = JSON.parse(text); validatePublicJson(data,256*1024);
 if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid model profile');
 const value = data as Record<string,unknown>;
 if (value.format !== 'mom-models' || value.version !== 1 || Object.keys(value).some(k=> !['format','version','models'].includes(k)) || !Array.isArray(value.models) || value.models.length > 150) throw new Error('Invalid model profile');
 const models = value.models.map(item=> {
  if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid model profile');
  const model = item as Record<string,unknown>;
  if (Object.keys(model).some(k=> ['id','lastTest','enabled','revision','catalogEvidence'].includes(k) || k.startsWith('credential'))) throw new Error('Private model field in profile');
  const policy = model.routerPolicy as Record<string,unknown> | undefined;
  return validateRegistration({...model,keyStorage:'encrypted',id:makeId(),enabled:false,revision:0,credentialOrigin:null,credentialVersion:0,...(policy ? {routerPolicy:{...policy,acknowledged:false}} : {})});
 });
 if (new Set(models.map(m=>m.id)).size !== models.length) throw new Error('Duplicate model identity');
 return models;
}
const common = {auth:'bearer' as const,credentialOrigin:null,credentialVersion:0,enabled:false,keyStorage:'encrypted' as const};
const router = {baseUrl:'https://openrouter.ai/api/v1',endpointUrl:'https://openrouter.ai/api/v1/audio/transcriptions',adapter:'openrouter' as const,routerPolicy:{requireZdr:true,acknowledged:false}};
const stt = {formats:['mp3','wav'] as const,maxBytes:16_000_000,maxSeconds:900,languageMode:'none' as const};
const routerText = {...router,endpointUrl:'https://openrouter.ai/api/v1/chat/completions'};
export const MODEL_PRESETS = [
 {id:'mai-transcribe-2',name:'MAI-Transcribe2',stage:'stt',...router,modelId:'microsoft/mai-transcribe-2',stt:{...stt,responseFormat:'verbose_json',timestamps:'word'},requestParameters:{provider:{options:{azure:{diarization:{enabled:true},phraseList:{phrases:[]},enhancedMode:{modelOptions:{transcribeStyle:'clean'}}}}}}},
 {id:'scribe-v2',name:'Scribe v2',stage:'stt',...router,modelId:'elevenlabs/scribe-v2',stt:{...stt,responseFormat:'json',timestamps:'none'}},
 {id:'whisper-large-v3-turbo',name:'Whisper large v3 turbo',stage:'stt',...router,modelId:'openai/whisper-large-v3-turbo',stt:{...stt,responseFormat:'json',timestamps:'none'}},
 ...[
  ['router-gpt-transcribe','GPT Transcribe','openai/gpt-transcribe'],
  ['router-qwen3-asr-1.7b','Qwen3 ASR 1.7B','qwen/qwen3-asr-1.7b'],
  ['router-qwen3-asr-0.6b','Qwen3 ASR 0.6B','qwen/qwen3-asr-0.6b'],
  ['router-whisper-large-v3','Whisper Large V3','openai/whisper-large-v3'],
  ['router-scribe-v2-medical','Scribe v2 Medical','elevenlabs/scribe-v2-medical'],
  ['router-voxtral-mini-transcribe','Voxtral Mini Transcribe','mistralai/voxtral-mini-transcribe'],
  ['router-voxtral-mini-3b-2507','Voxtral Mini 3B 2507','mistralai/voxtral-mini-3b-2507'],
  ['router-voxtral-small-24b-2507-stt','Voxtral Small 24B 2507 STT','mistralai/voxtral-small-24b-2507-stt'],
  ['router-parakeet-tdt-0.6b-v3','Parakeet TDT 0.6B v3','nvidia/parakeet-tdt-0.6b-v3'],
  ['router-nemotron-3.5-asr-streaming-multilingual-0.6b','Nemotron 3.5 ASR Streaming Multilingual 0.6B','nvidia/nemotron-3.5-asr-streaming-multilingual-0.6b'],
 ].map(([id,name,modelId])=>({id,name,modelId,stage:'stt' as const,...router,stt:{...stt,responseFormat:'json' as const,timestamps:'none' as const}})),
 {id:'openai-gpt-transcribe',name:'GPT Transcribe',stage:'stt',baseUrl:'https://api.openai.com/v1',endpointUrl:'https://api.openai.com/v1/audio/transcriptions',adapter:'openai',modelId:'gpt-transcribe',stt:{...stt,maxBytes:25_000_000,responseFormat:'json',timestamps:'none',languageMode:'multiple',termMode:'prompt-and-keywords'}},
 // Use the published input ceiling as a conservative app budget; checked 2026-10-29.
 ...([
  ['openai-gpt-6.1-terra','GPT-6.1 Terra','gpt-6.1-terra','low'],
 ] as const).map(([id,name,modelId,effort])=>({id,name,modelId,stage:'llm' as const,baseUrl:'https://api.openai.com/v1',endpointUrl:'https://api.openai.com/v1/chat/completions',adapter:'openai' as const,llm:{tokenField:'max_completion_tokens' as const,maxTokens:128_000,contextTokens:922_000},requestParameters:{reasoning_effort:effort}})),
 ...([
  ['router-gpt-6.1-sol','GPT-6.1 Sol','openai/gpt-6.1-sol','low'],
  ['router-gpt-6.1-terra','GPT-6.1 Terra','openai/gpt-6.1-terra','low'],
 ] as const).map(([id,name,modelId,effort])=>({id,name,modelId,stage:'llm' as const,...routerText,llm:{tokenField:'max_tokens' as const,maxTokens:128_000,contextTokens:922_000},requestParameters:{reasoning:{effort}}})),
 // Published output ceilings checked 2026-10-19; the default request stays at 4K.
 {id:'openai-text',name:'GPT-6 Luna',stage:'llm',baseUrl:'https://api.openai.com/v1',endpointUrl:'https://api.openai.com/v1/chat/completions',adapter:'openai',modelId:'gpt-6-luna',llm:{tokenField:'max_completion_tokens',maxTokens:128_000,contextTokens:922_000},requestParameters:{reasoning_effort:'low'}},
 {id:'openrouter-text',name:'GPT-6 Luna',stage:'llm',baseUrl:'https://openrouter.ai/api/v1',endpointUrl:'https://openrouter.ai/api/v1/chat/completions',adapter:'openrouter',modelId:'openai/gpt-6-luna',routerPolicy:{requireZdr:true,acknowledged:false},llm:{tokenField:'max_tokens',maxTokens:128_000,contextTokens:922_000},requestParameters:{reasoning:{effort:'low'}}},
 ...([
  ['router-deepseek-v4.1-flash','DeepSeek V4.1 Flash','deepseek/deepseek-v4.1-flash',1_048_576,943_718],
  ['router-glm-5.3-flash','GLM 5.3 Flash','z-ai/glm-5.3-flash',1_048_576,131_072],
  ['router-muse-spark-1.3-contributor','Muse Spark 1.3 Contributor','meta/muse-spark-1.3-contributor',1_048_576,943_718],
  ['router-claude-haiku-5.5','Claude Haiku 5.5','anthropic/claude-haiku-5.5',1_000_000,128_000],
 ] as const).map(([id,name,modelId,contextTokens,maxTokens])=>({id,name,modelId,stage:'llm' as const,...routerText,llm:{tokenField:'max_tokens' as const,maxTokens,contextTokens},requestParameters:{reasoning:{effort:'low'}}})),
 {id:'compatible-stt',name:'Compatible STT',stage:'stt',baseUrl:'http://localhost:8000/v1',endpointUrl:'http://localhost:8000/v1/audio/transcriptions',adapter:'openai-compatible',auth:'none',modelId:'whisper-local',stt},
 {id:'compatible-text',name:'Compatible text',stage:'llm',baseUrl:'http://localhost:8000/v1',endpointUrl:'http://localhost:8000/v1/chat/completions',adapter:'openai-compatible',auth:'none',modelId:'local-model',llm:{tokenField:'max_tokens'}},
] as const;
export function createModelPreset(id: string, makeId: () => string = () => crypto.randomUUID()): ModelRegistration {
 const preset = MODEL_PRESETS.find(p=>p.id === id); if (!preset) throw new Error('Unknown model preset');
 return validateRegistration({...common,...preset,id:makeId()});
}
