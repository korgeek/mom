import { describe, it, expect } from 'vitest';
import { validateRegistration, normalizeRegistrations, registrationEndpoint, buildRegistrationRequest, registrationSignature } from '../src/react-app/providers/model-registrations';
import {createModelPreset} from '../src/react-app/providers/model-profiles';
const base = { id: 'fixture-1', stage: 'stt', name: 'Local', baseUrl: 'http://localhost:8000/v1/', modelId: 'whisper-local', auth: 'none', credentialOrigin: null, credentialVersion: 0 };
describe('model registration contracts', () => {
    it('accepts local aliases and joins compatible endpoints once', () => {
        const r = validateRegistration(base);
        expect(registrationEndpoint(r)).toBe('http://localhost:8000/v1/audio/transcriptions');
        expect(registrationEndpoint(validateRegistration({ ...base, baseUrl: 'https://openrouter.ai/api/v1', stage: 'llm' }))).toBe('https://openrouter.ai/api/v1/chat/completions');
        expect(registrationEndpoint(validateRegistration({ ...base, baseUrl: 'https://api.openai.com/v1/audio/transcriptions' }))).toBe('https://api.openai.com/v1/audio/transcriptions');
    });
    it.each(['http://example.com/v1', 'https://secret@example.com/v1', 'https://example.com/v1?key=x', 'https://example.com/v1#x', 'https://example.com/\n'])('rejects unsafe address %s', baseUrl => expect(() => validateRegistration({ ...base, baseUrl })).toThrow());
    it('handles legacy catalogs without overwriting unknown versions', () => { expect(normalizeRegistrations(undefined)).toEqual({ version: 2, entries: [], defaults: {stt:null,llm:null}, legacyRouteIds:{},credentials:[] }); expect(() => normalizeRegistrations({ version: 3, entries: [] })).toThrow(); });
    it('binds an actual file and only selected language/prompt fields', () => {
        const r = validateRegistration({ ...base, stt: { languageMode: 'multiple', termMode: 'keywords', responseFormat: 'json' } });
        const file = new File(['fixture'], 'fixture.wav', { type: 'audio/wav' });
        const req = buildRegistrationRequest(r, { stage: 'stt', file, languages: ['ko', 'en'], glossary: ['MoM'], context: 'meeting' });
        const form = req.body as FormData;
        expect(form.get('file')).toBeInstanceOf(File);
        expect(form.getAll('languages[]')).toEqual(['ko', 'en']);
        expect(form.has('language')).toBe(false);
        expect(form.getAll('keywords[]')).toEqual(['MoM']);
        expect(form.has('prompt')).toBe(false);
        expect(req.contentType).toBe(null);
    });
    it('puts LLM work settings in messages and omits unset generation fields', () => {
        const r = validateRegistration({ ...base, stage: 'llm', llm: { tokenField: 'max_tokens', maxTokens: 200 } });
        const body = JSON.parse(buildRegistrationRequest(r, { stage: 'llm', transcript: 'Synthetic decision', outputLanguage: 'ko', sections: ['decisions'], instructions: 'Be concise' }).body as string);
        expect(body.max_tokens).toBe(200);
        expect(body.max_completion_tokens).toBeUndefined();
        expect(body.temperature).toBeUndefined();
        expect(body.output_language).toBeUndefined();
        expect(body.stream).toBe(false);
        expect(JSON.stringify(body.messages)).toContain('Synthetic decision');
        expect(JSON.stringify(body.messages)).toContain('decisions');
    });
    it('previews fixed placeholders and excludes credentials and test results from signatures', () => {
        const r = validateRegistration({ ...base, auth: 'bearer' });
        const p = buildRegistrationRequest(r, 'preview').preview;
        expect(p).toContain('{{api_key}}');
        expect(p).toContain('{{audio}}');
        expect(p).not.toContain('fixture.wav');
        expect(registrationSignature({ ...r, name: 'new display name' })).toBe(registrationSignature(r));
    });
    it('rejects incompatible and out of range options', () => {
        expect(() => validateRegistration({ ...base, stage: 'llm', llm: { temperature: 3 } })).toThrow();
        expect(() => validateRegistration({ ...base, baseUrl: 'https://openrouter.ai/api/v1', stt: { termMode: 'prompt' } })).toThrow();
    });
});
it('rejects malformed option objects and unknown secret fields at the boundary', () => {
    expect(() => validateRegistration({ ...base, stt: [] })).toThrow();
    expect(() => validateRegistration({ ...base, apiKey: 'SYNTHETIC_FORBIDDEN_KEY' })).toThrow();
    expect(() => validateRegistration({ ...base, stage: undefined })).toThrow();
});
it.each([
 ['router-qwen3-asr-1.7b','qwen/qwen3-asr-1.7b','stt'],['router-qwen3-asr-0.6b','qwen/qwen3-asr-0.6b','stt'],
 ['router-whisper-large-v3','openai/whisper-large-v3','stt'],['whisper-large-v3-turbo','openai/whisper-large-v3-turbo','stt'],
 ['scribe-v2','elevenlabs/scribe-v2','stt'],['router-scribe-v2-medical','elevenlabs/scribe-v2-medical','stt'],
 ['mai-transcribe-2','microsoft/mai-transcribe-2','stt'],
 ['router-voxtral-mini-transcribe','mistralai/voxtral-mini-transcribe','stt'],['router-voxtral-mini-3b-2507','mistralai/voxtral-mini-3b-2507','stt'],['router-voxtral-small-24b-2507-stt','mistralai/voxtral-small-24b-2507-stt','stt'],
 ['router-parakeet-tdt-0.6b-v3','nvidia/parakeet-tdt-0.6b-v3','stt'],['router-nemotron-3.5-asr-streaming-multilingual-0.6b','nvidia/nemotron-3.5-asr-streaming-multilingual-0.6b','stt'],
 ['router-deepseek-v4.1-flash','deepseek/deepseek-v4.1-flash','llm'],['router-glm-5.3-flash','z-ai/glm-5.3-flash','llm'],['router-muse-spark-1.3-contributor','meta/muse-spark-1.3-contributor','llm'],['router-claude-haiku-5.5','anthropic/claude-haiku-5.5','llm'],
] as const)('assembles the requested OpenRouter preset %s with the correct transport and policy', (id,modelId,stage)=>{
 const model=createModelPreset(id);
 const input=stage==='stt'?{stage:'stt' as const,file:new File(['synthetic'],'synthetic.wav',{type:'audio/wav'}),encodedAudio:{data:'c3ludGhldGlj',format:'wav'},languages:[],glossary:[],context:''}:{stage:'llm' as const,transcript:'Synthetic',outputLanguage:'ko',sections:['summary'],instructions:''};
 const request=buildRegistrationRequest(model,input),body=JSON.parse(request.body as string);
 expect(request.url).toBe(stage==='stt'?'https://openrouter.ai/api/v1/audio/transcriptions':'https://openrouter.ai/api/v1/chat/completions');expect(body.model).toBe(modelId);expect(model.auth).toBe('bearer');
 expect(body.provider).toMatchObject({data_collection:'deny',zdr:true});
 if(stage==='stt')expect(body.input_audio).toEqual({data:'c3ludGhldGlj',format:'wav'});else{expect(body.messages[1].content).toContain('Synthetic');expect(body.max_tokens).toBe(4096);expect(body.reasoning).toEqual({effort:'low'});expect(body.provider.require_parameters).toBe(true);}
});

it.each([
 ['openai-text','gpt-6-luna','max_completion_tokens'],
 ['openrouter-text','openai/gpt-6-luna','max_tokens'],
] as const)('builds the GPT-6 Luna preset %s with provider-specific output limits', (id,modelId,tokenField)=>{
 const model=createModelPreset(id);
 const request=buildRegistrationRequest(model,{stage:'llm',transcript:'Synthetic meeting',outputLanguage:'ko',sections:['summary'],instructions:''});
 const body=JSON.parse(request.body as string);
 expect(model.name).toBe('GPT-6 Luna');
 expect(model.llm).toMatchObject({contextTokens:922_000,maxTokens:128000,tokenField});
 expect(body).toMatchObject({model:modelId,[tokenField]:4096,...(id==='openai-text'?{reasoning_effort:'low'}:{reasoning:{effort:'low'}})});
 expect(request.url).toBe(id==='openai-text'?'https://api.openai.com/v1/chat/completions':'https://openrouter.ai/api/v1/chat/completions');
 if(id==='openrouter-text')expect(body.provider).toMatchObject({data_collection:'deny',zdr:true,allow_fallbacks:false});
});

it.each([
 ['openai-text','gpt-6-luna','low'],
 ['openai-gpt-6.1-terra','gpt-6.1-terra','low'],
] as const)('builds the current direct OpenAI preset %s with supported reasoning and a 4K request', (id,modelId,effort)=>{
 const model=createModelPreset(id),request=buildRegistrationRequest(model,{stage:'llm',transcript:'Synthetic meeting',outputLanguage:'ko',sections:['summary'],instructions:''});
 const body=JSON.parse(request.body as string);
 expect(model.enabled).toBe(false);expect(model.credentialOrigin).toBeNull();expect(model.credentialId).toBeUndefined();
 expect(model.llm).toMatchObject({contextTokens:922000,maxTokens:128000,tokenField:'max_completion_tokens'});
 expect(request.url).toBe('https://api.openai.com/v1/chat/completions');
 expect(body).toMatchObject({model:modelId,max_completion_tokens:4096,reasoning_effort:effort,stream:false});
 expect(body).not.toHaveProperty('temperature');expect(body).not.toHaveProperty('top_p');
});

it.each([
 ['router-gpt-6.1-sol','openai/gpt-6.1-sol','low'],
 ['router-gpt-6.1-terra','openai/gpt-6.1-terra','low'],
] as const)('builds the current OpenRouter preset %s with the verified model and retention policy', (id,modelId,effort)=>{
 const model=createModelPreset(id),request=buildRegistrationRequest(model,{stage:'llm',transcript:'Synthetic meeting',outputLanguage:'ko',sections:['summary'],instructions:''});
 const body=JSON.parse(request.body as string);
 expect(model.enabled).toBe(false);expect(model.credentialOrigin).toBeNull();expect(model.credentialId).toBeUndefined();
 expect(model.llm).toMatchObject({contextTokens:922000,maxTokens:128000,tokenField:'max_tokens'});
 expect(request.url).toBe('https://openrouter.ai/api/v1/chat/completions');
 expect(body).toMatchObject({model:modelId,max_tokens:4096,reasoning:{effort},provider:{data_collection:'deny',zdr:true,allow_fallbacks:false}});
 expect(body).not.toHaveProperty('temperature');expect(body).not.toHaveProperty('top_p');
});
