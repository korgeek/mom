import { expect, it } from 'vitest';
import { buildRegistrationRequest, registrationReadiness, sttInputSupport, validateRegistration } from '../src/react-app/providers/model-registrations';
import { createModelPreset } from '../src/react-app/providers/model-profiles';
import { validateTranscriptionHints } from '../src/react-app/domain/stt-settings';
import { createRegisteredSTTProvider } from '../src/react-app/providers/registered-runtime';
import { createJobContext } from '../src/react-app/domain/jobs';
import { createOpenAIProvider } from '../src/react-app/providers/openai';

const hints = { terms: ['SYNTHETIC_PRODUCT', 'MoM'], context: 'Synthetic project planning meeting' };
const input = { stage: 'stt', file: new File(['abc'], 'synthetic.mp3', { type: 'audio/mpeg' }), languages: ['ko'], glossary: hints.terms, context: hints.context, encodedAudio: { data: 'YWJj', format: 'mp3' } } as const;
it('maps reviewed native prompts and declared keyword support without inventing context support', () => {
  const openai = createModelPreset('openai-stt');
  const body = buildRegistrationRequest(openai, input).body as FormData;
  expect(body.get('prompt')).toBe('SYNTHETIC_PRODUCT, MoM\nSynthetic project planning meeting');
  const keywords = validateRegistration({ ...createModelPreset('compatible-stt'), stt: { termMode: 'keywords' } });
  const keywordBody = buildRegistrationRequest(keywords, input).body as FormData;
  expect(keywordBody.getAll('keywords[]')).toEqual(hints.terms); expect(keywordBody.has('prompt')).toBe(false);
  expect(sttInputSupport(keywords).context).toBe(false);
  const diarize = validateRegistration({ ...openai, modelId: 'gpt-4o-transcribe-diarize', stt: { termMode: 'prompt' } });
  expect(sttInputSupport(diarize).termMode).toBe('none'); expect((buildRegistrationRequest(diarize, input).body as FormData).has('prompt')).toBe(false);
});
it('maps MAI vocabulary to Azure phrases, permits clearing, and preserves retention and other options', () => {
  const model = createModelPreset('mai-transcribe-2');
  const body = JSON.parse(buildRegistrationRequest(model, input).body as string);
  expect(body.provider).toMatchObject({ data_collection: 'deny', zdr: true, options: { azure: { phraseList: { phrases: hints.terms }, diarization: { enabled: true } } } });
  expect(body).not.toHaveProperty('prompt'); expect(body).not.toHaveProperty('context');
  expect(JSON.parse(buildRegistrationRequest(model, { ...input, glossary: [] }).body as string).provider.options.azure.phraseList.phrases).toEqual([]);
  expect((model.requestParameters?.provider as { options: { azure: { phraseList: { phrases: string[] } } } }).options.azure.phraseList.phrases).toEqual([]);
});
it('does not send unsupported common hints to other router models', () => {
  const model = createModelPreset('scribe-v2');
  const body = buildRegistrationRequest(model, input).body as string;
  expect(sttInputSupport(model)).toMatchObject({ termMode: 'none', context: false });
  expect(body).not.toContain(hints.terms[0]); expect(body).not.toContain(hints.context);
});
it('bounds memo hints before request dispatch and accepts legacy absent settings', async () => {
  expect(() => validateTranscriptionHints(undefined)).not.toThrow();
  for (const value of [{ terms: Array(51).fill('x'), context: '' }, { terms: ['x'.repeat(101)], context: '' }, { terms: [], context: 'x'.repeat(2001) }, { terms: ['bad\nterm'], context: '' }]) expect(() => validateTranscriptionHints(value)).toThrow();
  let calls = 0;
  const model = { ...createModelPreset('compatible-stt'), enabled: true };
  const provider = createRegisteredSTTProvider({ model, getKey: () => null, fetch: async () => { calls++; return new Response(); } });
  await expect(provider.transcribe({ modelId: model.modelId, runId: 'run', audio: input.file, expectedLanguages: [], transcriptionHints: { terms: [], context: 'x'.repeat(2001) }, chunk: {} as never }, createJobContext())).rejects.toMatchObject({ code: 'invalid-input' });
  expect(calls).toBe(0);
});
it('dispatches memo hints through the registered runtime rather than an empty prompt', async () => {
  const model = validateRegistration({ ...createModelPreset('compatible-stt'), enabled: true, stt: { termMode: 'prompt', maxBytes: 16000000, maxSeconds: 900 } });
  let prompt: FormDataEntryValue | null = null;
  const provider = createRegisteredSTTProvider({ model, getKey: () => null, fetch: async (_url, init) => { prompt = (init!.body as FormData).get('prompt'); return new Response('{"text":"SYNTHETIC_RESPONSE"}'); } });
  await provider.transcribe({ modelId: model.modelId, runId: 'run', audio: input.file, expectedLanguages: [], transcriptionHints: hints, chunk: { id: 'chunk', sourceId: 'source', index: 0, sourceStartMs: 0, sourceEndMs: 1000, encodingOffsetMs: 0, encodedBytes: 3, mimeType: 'audio/mpeg', codec: 'mp3', audioRecordId: 'audio' } }, createJobContext());
  expect(prompt).toBe('SYNTHETIC_PRODUCT, MoM\nSynthetic project planning meeting');
});
it('combines direct OpenAI memo hints with multilingual guidance without losing either', async () => {
  let prompt: FormDataEntryValue | null = null;
  const provider = createOpenAIProvider({ getKey: () => 'SYNTHETIC_ONLY_KEY', fetch: async (_url, init) => { prompt = (init!.body as FormData).get('prompt'); return new Response('{"text":"SYNTHETIC_DIRECT_RESPONSE"}'); } });
  await provider.transcribe({ modelId: 'whisper-1', runId: 'run', audio: input.file, expectedLanguages: ['ko','en'], transcriptionHints: hints, chunk: { id: 'chunk', sourceId: 'source', index: 0, sourceStartMs: 0, sourceEndMs: 1000, encodingOffsetMs: 0, encodedBytes: 3, mimeType: 'audio/mpeg', codec: 'mp3', audioRecordId: 'audio' } }, createJobContext());
  expect(String(prompt)).toContain('Expected languages: ko, en.'); expect(String(prompt)).toContain('SYNTHETIC_PRODUCT, MoM'); expect(String(prompt)).toContain(hints.context);
});
it('uses the direct GPT Transcribe contract and preserves incompatible saved settings', () => {
  const model = createModelPreset('openai-gpt-transcribe');
  const body = buildRegistrationRequest(model, {...input, languages:['ko','en']}).body as FormData;
  expect(body.get('response_format')).toBe('json');
  expect(body.getAll('languages[]')).toEqual(['ko','en']);
  expect(body.getAll('keywords[]')).toEqual(hints.terms);
  expect(body.get('prompt')).toBe(hints.context);
  expect(body.has('timestamp_granularities[]')).toBe(false);
  const stale = validateRegistration({...createModelPreset('openai-stt'), modelId:'gpt-transcribe'});
  expect(stale.stt?.responseFormat).toBe('verbose_json');
  expect(registrationReadiness(stale)).toContain('stt-model-format');
});
it('sends typed temperature on the selected route without adding unsupported router hints', () => {
  const model = validateRegistration({...createModelPreset('router-gpt-transcribe'), stt:{...createModelPreset('router-gpt-transcribe').stt,temperature:0.3}});
  const body = JSON.parse(buildRegistrationRequest(model,input).body as string);
  expect(registrationReadiness({...model,stt:{...model.stt,responseFormat:'verbose_json'}})).toContain('stt-model-format');
  expect(body.temperature).toBe(0.3); expect(body).not.toHaveProperty('prompt'); expect(body).not.toHaveProperty('keywords'); expect(body).not.toHaveProperty('languages');
  expect(() => validateRegistration({...model,stt:{...model.stt,temperature:1.1}})).toThrow();
  const direct=validateRegistration({...createModelPreset('openai-gpt-transcribe'),stt:{...createModelPreset('openai-gpt-transcribe').stt,temperature:0}});
  expect((buildRegistrationRequest(direct,input).body as FormData).get('temperature')).toBe('0');
});
it('checks direct model language and diarization formats without changing saved settings', () => {
  const gpt = createModelPreset('openai-gpt-transcribe');
  expect(registrationReadiness(validateRegistration({...gpt, stt:{...gpt.stt, languageMode:'single'}}))).toContain('stt-model-language');
  const diarize = validateRegistration({...gpt, modelId:'gpt-4o-transcribe-diarize', stt:{...gpt.stt, languageMode:'none', termMode:'none', responseFormat:'json'}});
  expect(registrationReadiness(diarize)).not.toContain('stt-model-format');
  expect(registrationReadiness(validateRegistration({...diarize,stt:{...diarize.stt,responseFormat:'diarized_json'}}))).not.toContain('stt-model-format');
  expect(registrationReadiness(validateRegistration({...diarize,stt:{...diarize.stt,responseFormat:'verbose_json'}}))).toContain('stt-model-format');
  const legacy = validateRegistration({...createModelPreset('openai-stt'),stt:{...createModelPreset('openai-stt').stt,termMode:'none'}});
  expect(sttInputSupport(legacy).termMode).toBe('none');
  expect((buildRegistrationRequest(legacy,input).body as FormData).has('prompt')).toBe(false);
  const absent = validateRegistration({...legacy,stt:{...legacy.stt,termMode:undefined}});
  expect(sttInputSupport(absent).termMode).toBe('prompt');
  expect((buildRegistrationRequest(absent,input).body as FormData).get('prompt')).toContain(hints.context);
});
