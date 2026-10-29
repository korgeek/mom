import { expect, it } from 'vitest';
import { routerSTTOptions, routerSTTOptionIssue } from '../src/react-app/providers/openrouter-stt-options';
import { buildRegistrationRequest, registrationReadiness, sttInputSupport, validateRegistration } from '../src/react-app/providers/model-registrations';
import { createModelPreset } from '../src/react-app/providers/model-profiles';
const input={stage:'stt' as const,file:new File(['fixture'],'fixture.mp3',{type:'audio/mpeg'}),encodedAudio:{data:'Zml4dHVyZQ==',format:'mp3'},languages:['ko'],glossary:['MoM','API'],context:'project meeting'};
const withOptions=(id:string, options:unknown)=>validateRegistration({...createModelPreset(id),requestParameters:{provider:{options}}});
it('maps reviewed provider fields only for matching models and preserves common options',()=>{
 expect(routerSTTOptions('microsoft/mai-transcribe-2')?.provider).toBe('azure');
 expect(routerSTTOptions('openai/whisper-large-v3')?.provider).toBe('groq');
 expect(routerSTTOptions('elevenlabs/scribe-v2-medical')?.provider).toBe('elevenlabs');
 for(const id of ['openai/gpt-transcribe','qwen/qwen3-asr-1.7b','microsoft/mai-transcribe-1.5','mistralai/voxtral-mini-transcribe','nvidia/parakeet-tdt-0.6b-v3'])expect(routerSTTOptions(id)).toBeNull();
 const groq=withOptions('router-whisper-large-v3',{groq:{prompt:'',custom_flag:true},other:{x:1}});
 const body=JSON.parse(buildRegistrationRequest(groq,input).body as string);
 expect(body.provider).toMatchObject({data_collection:'deny',zdr:true,options:{groq:{prompt:'MoM, API\nproject meeting',custom_flag:true},other:{x:1}}});
 expect(sttInputSupport(groq)).toMatchObject({termMode:'groq-prompt',context:true});
 const noOpt=withOptions('router-whisper-large-v3',{});expect(sttInputSupport(noOpt).termMode).toBe('none');
});
it('passes documented ElevenLabs fields and refuses ignored keyterms',()=>{
 const model=withOptions('scribe-v2',{elevenlabs:{diarize:true,num_speakers:4,tag_audio_events:false,no_verbatim:true,unknown_option:'preserved'}});
 const body=JSON.parse(buildRegistrationRequest(model,input).body as string);
 expect(body.provider.options.elevenlabs).toEqual({diarize:true,num_speakers:4,tag_audio_events:false,no_verbatim:true,unknown_option:'preserved'});
 expect(sttInputSupport(model)).toMatchObject({termMode:'none',context:false});
 expect(routerSTTOptionIssue(model.modelId,{provider:{options:{elevenlabs:{keyterms:['MoM']}}}})).toBe('provider.options.elevenlabs.keyterms');
});
it('preserves saved Groq and Azure options when hints were not specified and permits an explicit clear',()=>{
 const groq=withOptions('router-whisper-large-v3',{groq:{prompt:'Saved context'}});
 expect(JSON.parse(buildRegistrationRequest(groq,{...input,context:'',glossary:[],hintsProvided:false}).body as string).provider.options.groq.prompt).toBe('Saved context');
 expect(JSON.parse(buildRegistrationRequest(groq,{...input,context:'',glossary:[],hintsProvided:true}).body as string).provider.options.groq.prompt).toBe('');
 const azure=withOptions('mai-transcribe-2',{azure:{phraseList:{phrases:['Saved term']}}});
 expect(JSON.parse(buildRegistrationRequest(azure,{...input,glossary:[],hintsProvided:false}).body as string).provider.options.azure.phraseList.phrases).toEqual(['Saved term']);
 expect(JSON.parse(buildRegistrationRequest(azure,{...input,glossary:[],hintsProvided:true}).body as string).provider.options.azure.phraseList.phrases).toEqual([]);
});
it('validates known fields without destroying a saved profile and accepts valid bounds',()=>{
 const bad=withOptions('scribe-v2',{elevenlabs:{diarize:true,num_speakers:33}});
 expect(registrationReadiness(bad)).toContain('stt-provider-options');
 expect(routerSTTOptionIssue(bad.modelId,bad.requestParameters)).toBe('provider.options.elevenlabs.num_speakers');
 expect(()=>buildRegistrationRequest(bad,input)).toThrow();
 for(const options of [{num_speakers:0},{diarize:'yes'},{tag_audio_events:1},{num_speakers:2},{diarize:true,num_speakers:2,diarization_threshold:0.2},{diarize:true,diarization_threshold:0.41},{seed:2147483648}])expect(routerSTTOptionIssue('elevenlabs/scribe-v2',{provider:{options:{elevenlabs:options}}})).toBeTruthy();
 expect(routerSTTOptionIssue('elevenlabs/scribe-v2',{provider:{options:{elevenlabs:{diarize:true,num_speakers:32}}}})).toBeUndefined();
 expect(routerSTTOptionIssue('microsoft/mai-transcribe-2',{provider:{options:{azure:{diarization:{enabled:true,maxSpeakers:36}}}}})).toBe('provider.options.azure.diarization');
 expect(routerSTTOptionIssue('microsoft/mai-transcribe-2',{provider:{options:{azure:{enhancedMode:{modelOptions:{transcribeStyle:'other'}}}}}})).toBeTruthy();
});
it('blocks the documented unsupported verbose format on MAI 1.5',()=>{
 const r=validateRegistration({...createModelPreset('scribe-v2'),modelId:'microsoft/mai-transcribe-1.5'}),stale=validateRegistration({...r,stt:{...r.stt,responseFormat:'verbose_json'}});
 expect(registrationReadiness(stale)).toContain('stt-model-format');
});
it('maps the two OpenRouter timestamp granularities together',()=>{
 const model=validateRegistration({...createModelPreset('mai-transcribe-2'),stt:{...createModelPreset('mai-transcribe-2').stt,timestamps:'segment-and-word'}});
 const body=JSON.parse(buildRegistrationRequest(model,input).body as string);
 expect(body.timestamp_granularities).toEqual(['segment','word']);
 expect(body.provider).not.toHaveProperty('require_parameters');
});
