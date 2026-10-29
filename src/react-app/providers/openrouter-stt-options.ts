import { asObject } from '../domain/pipeline';

// Provider options are forwarded only when that provider handles the request.
export function routerSTTOptions(modelId: string) {
 if (modelId === 'microsoft/mai-transcribe-2') return { provider: 'azure' as const, fields: ['diarization', 'phraseList', 'transcribeStyle'] as const, vocabulary: 'azure-phrases' as const, context: false };
 if (modelId === 'openai/whisper-large-v3' || modelId === 'openai/whisper-large-v3-turbo') return { provider: 'groq' as const, fields: ['prompt'] as const, vocabulary: 'groq-prompt' as const, context: true };
 if (modelId === 'elevenlabs/scribe-v2' || modelId === 'elevenlabs/scribe-v2-medical') return { provider: 'elevenlabs' as const, fields: ['diarize', 'num_speakers', 'diarization_threshold', 'tag_audio_events', 'no_verbatim', 'seed'] as const, vocabulary: 'none' as const, context: false };
 return null;
}

// Validate documented fields without discarding other provider-specific JSON.
export function routerSTTOptionIssue(modelId: string, parameters: Readonly<Record<string, unknown>> | undefined): string | undefined {
 const provider = asObject(parameters?.provider), options = asObject(provider?.options);
 const info = routerSTTOptions(modelId); if (!info || !options || options[info.provider] === undefined) return;
 const value = asObject(options[info.provider]); if (!value) return `provider.options.${info.provider}`;
 if (info.provider === 'groq' && value.prompt !== undefined && typeof value.prompt !== 'string') return 'provider.options.groq.prompt';
 if (info.provider === 'elevenlabs') {
  if (modelId === 'elevenlabs/scribe-v2-medical' && value.no_verbatim === true) return 'provider.options.elevenlabs.no_verbatim';
  if (value.keyterms !== undefined) return 'provider.options.elevenlabs.keyterms';
  for (const key of ['diarize', 'tag_audio_events', 'no_verbatim']) if (value[key] !== undefined && typeof value[key] !== 'boolean') return `provider.options.elevenlabs.${key}`;
  if (value.num_speakers !== undefined && (typeof value.num_speakers !== 'number' || !Number.isInteger(value.num_speakers) || value.num_speakers < 1 || value.num_speakers > 32)) return 'provider.options.elevenlabs.num_speakers';
  if (value.diarization_threshold !== undefined && (typeof value.diarization_threshold !== 'number' || !Number.isFinite(value.diarization_threshold) || value.diarization_threshold < 0.1 || value.diarization_threshold > 0.4)) return 'provider.options.elevenlabs.diarization_threshold';
  if ((value.num_speakers !== undefined || value.diarization_threshold !== undefined) && value.diarize !== true || value.num_speakers !== undefined && value.diarization_threshold !== undefined) return 'provider.options.elevenlabs.diarize';
  if (value.seed !== undefined && (typeof value.seed !== 'number' || !Number.isSafeInteger(value.seed) || value.seed < 0 || value.seed > 2147483647)) return 'provider.options.elevenlabs.seed';
 }
 if (info.provider === 'azure') {
  const diarization = value.diarization === undefined ? undefined : asObject(value.diarization);
  if (value.diarization !== undefined && (!diarization || diarization.enabled !== undefined && typeof diarization.enabled !== 'boolean' || diarization.maxSpeakers !== undefined && (typeof diarization.maxSpeakers !== 'number' || !Number.isInteger(diarization.maxSpeakers) || diarization.maxSpeakers < 2 || diarization.maxSpeakers > 35))) return 'provider.options.azure.diarization';
  const phrases = value.phraseList === undefined ? undefined : asObject(value.phraseList);
  if (value.phraseList !== undefined && (!phrases || phrases.phrases !== undefined && (!Array.isArray(phrases.phrases) || phrases.phrases.some(term => typeof term !== 'string')))) return 'provider.options.azure.phraseList';
  const enhanced = value.enhancedMode === undefined ? undefined : asObject(value.enhancedMode), modelOptions = enhanced?.modelOptions === undefined ? undefined : asObject(enhanced.modelOptions);
  if (value.enhancedMode !== undefined && (!enhanced || enhanced.modelOptions !== undefined && !modelOptions || modelOptions?.transcribeStyle !== undefined && !['clean','verbatim'].includes(String(modelOptions.transcribeStyle)))) return 'provider.options.azure.enhancedMode.modelOptions.transcribeStyle';
 }
}
