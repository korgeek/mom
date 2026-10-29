import { buildMinutesMessages } from '../minutes/prompt';
import type { MinutesSection, ModelRegistryMetadata } from '../domain/types';
import { asObject } from '../domain/pipeline';
// Transient save command; never persist this object in model configuration.
export type RegistrationKeyUpdate = {action:'keep'} | {action:'replace';value:string;name?:string} | {action:'clear'};
export type RegistrationTestInput = {
    stage: 'stt';
    file: File;
    languages: readonly string[];
    glossary: readonly string[];
    context: string;
    encodedAudio?: {
        data: string;
        format: string;
    };
} | {
    stage: 'llm';
    transcript: string;
    outputLanguage: string;
    sections: readonly string[];
    instructions: string;
};
export type RegistrationTestResult = Readonly<{
    signature: string;
    inputSignature: string;
    inputSummary: string;
    state: 'success' | 'incomplete' | 'failed' | 'cancelled' | 'outcome-unknown';
    status: number | null;
    elapsedMs: number;
    text: string;
    raw: string;
    message: string;
    requestedModel: string;
    returnedModel: string | null;
    usage: unknown;
}>;
export type RouterPolicy = Readonly<{requireZdr:boolean;acknowledged:boolean}>;
export type ApiCredential = Readonly<{id:string;name:string;origin:string;keyStorage:'encrypted'|'session';version:number;routerPolicy?:RouterPolicy}>;
export type ModelRegistration = Readonly<{
    id: string;
    stage: 'stt' | 'llm';
    name: string;
    baseUrl: string;
    endpointUrl?: string;
    adapter?: 'openai' | 'openrouter' | 'openai-compatible';
    enabled?: boolean;
    revision?: number;
    keyStorage?: 'encrypted' | 'session';
    requestParameters?: Readonly<Record<string, unknown>>;
    instructionTemplate?: string;
    routerPolicy?: RouterPolicy;
    routerEndpointTag?: string;
    catalogEvidence?: ModelRegistryMetadata;
    modelId: string;
    auth: 'none' | 'bearer';
    credentialId?: string;
    credentialOrigin: string | null;
    credentialVersion: number;
    stt?: Readonly<{
        formats?: readonly ('mp3' | 'wav')[];
        responseFormat?: 'json' | 'verbose_json' | 'diarized_json';
        languageMode?: 'none' | 'single' | 'multiple';
        termMode?: 'none' | 'prompt' | 'keywords' | 'prompt-and-keywords';
        temperature?: number;
        timestamps?: 'none' | 'segment' | 'word';
        maxBytes?: number;
        maxSeconds?: number;
        routerRequireZdr?: boolean;
    }>;
    llm?: Readonly<{
        tokenField?: 'max_completion_tokens' | 'max_tokens';
        contextTokens?: number;
        maxTokens?: number;
        temperature?: number;
        topP?: number;
    }>;
    lastTest?: RegistrationTestResult;
}>;
export type ModelRegistrations = Readonly<{
    version: 1 | 2;
    entries: readonly ModelRegistration[];
    defaults?: Readonly<{stt: string | null; llm: string | null}>;
    legacyRouteIds?: Readonly<Record<string, string>>;
    credentials?: readonly ApiCredential[];
}>;
function fields(value: Record<string, unknown>, allowed: readonly string[]): void { if (Object.keys(value).some(key => !allowed.includes(key)))
    invalid(); }
function defined<T extends object>(value: T): T { return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T; }
function invalid(): never { throw new Error('Invalid model registration'); }
function string(value: unknown, max = 2048): string { if (typeof value !== 'string' || !value.trim() || value.length > max || Array.from(value).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127))
    invalid(); return value.trim(); }
function choice<T extends string>(value: unknown, choices: readonly T[], fallback: T): T { if (value === undefined)
    return fallback; if (!choices.includes(value as T))
    invalid(); return value as T; }
function number(value: unknown, min: number, max: number, integer = false): number | undefined { if (value === undefined)
    return undefined; if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isSafeInteger(value)))
    invalid(); return value; }
export function registrationBaseUrl(value: unknown): string {
    const source = string(value);
    let u: URL;
    try {
        u = new URL(source);
    }
    catch {
        invalid();
    }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
    if (u.username || u.password || u.search || u.hash || source.includes('?') || source.includes('#') || u.protocol !== 'https:' && !(u.protocol === 'http:' && local))
        invalid();
    return u.href.replace(/\/+$/u, '');
}
export function validateTestResult(value: unknown): RegistrationTestResult {
    const r = asObject(value);
    if (!r)
        invalid();
    const state = choice(r.state, ['success', 'incomplete', 'failed', 'cancelled', 'outcome-unknown'] as const, 'failed');
    if (r.status !== null && (number(r.status, 100, 599, true) === undefined))
        invalid();
    for (const key of ['signature', 'inputSignature', 'inputSummary', 'text', 'raw', 'message', 'requestedModel'])
        if (typeof r[key] !== 'string')
            invalid();
    if ((r.raw as string).length > 524288 || (r.text as string).length > 524288 || (r.inputSummary as string).length > 65536)
        invalid();
    if (r.returnedModel !== null && typeof r.returnedModel !== 'string')
        invalid();
    const elapsedMs = number(r.elapsedMs, 0, Number.MAX_SAFE_INTEGER);
    if (elapsedMs === undefined)
        invalid();
    return { signature: r.signature as string, inputSignature: r.inputSignature as string, inputSummary: r.inputSummary as string, state, status: r.status as number | null, elapsedMs, text: r.text as string, raw: r.raw as string, message: r.message as string, requestedModel: r.requestedModel as string, returnedModel: r.returnedModel as string | null, usage: r.usage ?? null };
}
export function validateRegistration(value: unknown): ModelRegistration {
    const r = asObject(value);
    if (!r)
        invalid();
    fields(r, ['id', 'stage', 'name', 'baseUrl', 'modelId', 'auth', 'credentialOrigin', 'credentialVersion', 'credentialId', 'stt', 'llm', 'lastTest', 'endpointUrl', 'adapter', 'enabled', 'revision', 'keyStorage', 'requestParameters', 'instructionTemplate', 'routerPolicy', 'routerEndpointTag', 'catalogEvidence']);
    if (typeof r.stage !== 'string' || typeof r.auth !== 'string')
        invalid();
    const id = string(r.id, 128);
    if (!/^[a-zA-Z0-9_-]+$/u.test(id))
        invalid();
    const stage = choice(r.stage, ['stt', 'llm'] as const, 'stt');
    const auth = choice(r.auth, ['none', 'bearer'] as const, 'none');
    const baseUrl = registrationBaseUrl(r.baseUrl ?? r.endpointUrl);
    const endpointUrl = r.endpointUrl === undefined ? undefined : registrationBaseUrl(r.endpointUrl);
    const host = new URL(endpointUrl ?? baseUrl).hostname;
    const adapter = choice(r.adapter, ['openai', 'openrouter', 'openai-compatible'] as const, host === 'api.openai.com' ? 'openai' : host === 'openrouter.ai' ? 'openrouter' : 'openai-compatible');
    const routerEndpointTag=r.routerEndpointTag===undefined?undefined:string(r.routerEndpointTag,256);
    if(routerEndpointTag!==undefined&&(adapter!=='openrouter'||stage!=='llm'))invalid();
    if (adapter === 'openai' || adapter === 'openrouter') {
        const origin = adapter === 'openai' ? 'https://api.openai.com' : 'https://openrouter.ai';
        const prefix = adapter === 'openai' ? '/v1' : '/api/v1';
        const path = stage === 'stt' ? '/audio/transcriptions' : '/chat/completions';
        const target = endpointUrl ?? (baseUrl.endsWith(path) ? baseUrl : baseUrl + path);
        if (target !== origin + prefix + path) invalid();
    }
    if (r.enabled !== undefined && typeof r.enabled !== 'boolean') invalid();
    const policy = asObject(r.routerPolicy);
    if (r.routerPolicy !== undefined && (!policy || Object.keys(policy).some(k => !['requireZdr','acknowledged'].includes(k)) || typeof policy.requireZdr !== 'boolean' || typeof policy.acknowledged !== 'boolean')) invalid();
    const template = r.instructionTemplate === undefined ? undefined : validateInstructionTemplate(r.instructionTemplate);
    const requestParameters = validateRequestParameters(r.requestParameters ?? {});
    if (r.catalogEvidence !== undefined) validatePublicJson(r.catalogEvidence);
    const evidence = r.catalogEvidence === undefined ? undefined : structuredClone(r.catalogEvidence) as ModelRegistryMetadata;
    if (evidence && (!asObject(evidence.route) || !asObject(evidence.limits) || evidence.route.modelId !== r.modelId || evidence.route.stage !== (stage === 'stt' ? 'stt' : 'minutes') || evidence.route.endpointTag !== null && typeof evidence.route.endpointTag !== 'string')) invalid();
    const credentialVersion = number(r.credentialVersion, 0, Number.MAX_SAFE_INTEGER, true) ?? 0;
    const credentialOrigin = r.credentialOrigin == null ? null : string(r.credentialOrigin);
    if (credentialOrigin !== null && new URL(credentialOrigin).origin !== credentialOrigin)
        invalid();
    const result: ModelRegistration = { id, stage, name: string(r.name, 512), baseUrl, modelId: string(r.modelId, 256), auth, credentialOrigin, credentialVersion, ...defined({ endpointUrl, adapter, routerEndpointTag, credentialId:r.credentialId === undefined ? undefined : credentialId(r.credentialId), enabled: r.enabled === true, revision: number(r.revision, 0, Number.MAX_SAFE_INTEGER, true) ?? 0, keyStorage: choice(r.keyStorage, ['encrypted', 'session'] as const, 'encrypted'), requestParameters, instructionTemplate: template, routerPolicy: adapter === 'openrouter' ? { requireZdr: policy?.requireZdr !== false && asObject(r.stt)?.routerRequireZdr !== false, acknowledged: policy?.acknowledged === true } : undefined, catalogEvidence: evidence }) };
    if (stage === 'stt') {
        if (r.stt !== undefined && !asObject(r.stt))
            invalid();
        const s = asObject(r.stt) ?? {};
        fields(s, ['responseFormat', 'languageMode', 'termMode', 'timestamps', 'maxBytes', 'maxSeconds', 'routerRequireZdr', 'formats', 'temperature']);
        const legacyPrompt = adapter === 'openai' && ['whisper-1', 'gpt-4o-transcribe', 'gpt-4o-mini-transcribe', 'gpt-4o-mini-transcribe-2025-12-15'].includes(result.modelId);
        const termMode = choice(s.termMode, ['none', 'prompt', 'keywords', 'prompt-and-keywords'] as const, legacyPrompt ? 'prompt' : 'none');
        const router = adapter === 'openrouter';
        if (s.formats !== undefined && (!Array.isArray(s.formats) || !s.formats.length || s.formats.some(f => f !== 'mp3' && f !== 'wav'))) invalid();
        if (router && (termMode !== 'none' || s.languageMode === 'multiple' || s.responseFormat === 'diarized_json'))
            invalid();
        if (s.routerRequireZdr !== undefined && typeof s.routerRequireZdr !== 'boolean')
            invalid();
        const responseFormat = choice(s.responseFormat, ['json', 'verbose_json', 'diarized_json'] as const, 'json');
        const timestamps = choice(s.timestamps, ['none', 'segment', 'word'] as const, 'none');
        if (timestamps !== 'none' && responseFormat !== 'verbose_json')
            invalid();
        return { ...result, stt: defined({ temperature: number(s.temperature, 0, 1), formats: s.formats === undefined ? ['mp3', 'wav'] as const : [...new Set(s.formats as ('mp3' | 'wav')[])], responseFormat, languageMode: choice(s.languageMode, ['none', 'single', 'multiple'] as const, 'none'), termMode, timestamps, maxBytes: number(s.maxBytes, 1, 1024 * 1024 * 1024, true), maxSeconds: number(s.maxSeconds, 0.01, 86400), ...(router ? { routerRequireZdr: s.routerRequireZdr !== false } : {}) }), ...(r.lastTest ? { lastTest: validateTestResult(r.lastTest) } : {}) };
    }
    if (r.llm !== undefined && !asObject(r.llm))
        invalid();
    const l = asObject(r.llm) ?? {};
    fields(l, ['tokenField', 'maxTokens', 'temperature', 'topP', 'contextTokens']);
    return { ...result, llm: defined({ contextTokens: number(l.contextTokens, 1, 10000000, true), tokenField: choice(l.tokenField, ['max_completion_tokens', 'max_tokens'] as const, 'max_completion_tokens'), maxTokens: number(l.maxTokens, 1, 1000000, true), temperature: number(l.temperature, 0, 2), topP: number(l.topP, 0, 1) }), ...(r.lastTest ? { lastTest: validateTestResult(r.lastTest) } : {}) };
}
export function credentialId(value:unknown):string { const id=string(value,128);if(!/^[a-zA-Z0-9_-]+$/u.test(id))invalid();return id; }
export function validateApiCredential(value:unknown):ApiCredential {
    const r=asObject(value);if(!r)invalid();fields(r,['id','name','origin','keyStorage','version','routerPolicy']);
    const origin=registrationBaseUrl(r.origin);if(new URL(origin).origin!==origin)invalid();
    const policy=asObject(r.routerPolicy);
    if(r.routerPolicy!==undefined&&(origin!=='https://openrouter.ai'||!policy||Object.keys(policy).some(key=>!['requireZdr','acknowledged'].includes(key))||typeof policy.requireZdr!=='boolean'||typeof policy.acknowledged!=='boolean'))invalid();
    return {id:credentialId(r.id),name:string(r.name,512),origin,keyStorage:choice(r.keyStorage,['encrypted','session'] as const,'encrypted'),version:number(r.version,0,Number.MAX_SAFE_INTEGER,true)??0,...(policy?{routerPolicy:{requireZdr:policy.requireZdr as boolean,acknowledged:policy.acknowledged as boolean}}:{})};
}
export function withCredentialPolicy(entry:ModelRegistration,credential:ApiCredential|undefined):ModelRegistration {
    if(entry.adapter!=='openrouter'||entry.auth!=='bearer'||credential?.origin!=='https://openrouter.ai'||!credential.routerPolicy)return entry;
    const routerPolicy={...credential.routerPolicy};
    return {...entry,routerPolicy,...(entry.stt?{stt:{...entry.stt,routerRequireZdr:routerPolicy.requireZdr}}:{})};
}
export type NormalizedModelRegistrations = ModelRegistrations & Readonly<{ version: 2; credentials:readonly ApiCredential[]; defaults: Readonly<{ stt: string | null; llm: string | null }>; legacyRouteIds: Readonly<Record<string, string>> }>;
export function normalizeRegistrations(value: unknown): NormalizedModelRegistrations {
    if (value === undefined) return { version: 2, entries: [], defaults: { stt: null, llm: null }, legacyRouteIds: {},credentials:[] };
    const v = asObject(value);
    if (!v || ![1,2].includes(v.version as number) || !Array.isArray(v.entries) || v.entries.length > 150) invalid();
    if(v.credentials!==undefined&&!Array.isArray(v.credentials))invalid();
    const credentials=(v.credentials as unknown[]|undefined ?? []).map(validateApiCredential);
    if(credentials.length>150||new Set(credentials.map(c=>c.id)).size!==credentials.length)invalid();
    const entries = v.entries.map(validateRegistration).map(entry=>{
        if(!entry.credentialId)return entry;
        const credential=credentials.find(c=>c.id===entry.credentialId);
        if(!credential||entry.auth!=='bearer'||credential.origin!==new URL(registrationEndpoint(entry)).origin)invalid();
        const mirrored={...withCredentialPolicy(entry,credential),keyStorage:credential.keyStorage,credentialOrigin:credential.origin,credentialVersion:credential.version};
        if(mirrored.lastTest&&mirrored.lastTest.signature!==registrationSignature(mirrored))return Object.fromEntries(Object.entries(mirrored).filter(([key])=>key!=='lastTest')) as ModelRegistration;
        return mirrored;
    });
    if (new Set(entries.map(r => r.id)).size !== entries.length) invalid();
    const defaults = asObject(v.defaults) ?? {};
    if (Object.keys(defaults).some(k => !['stt','llm'].includes(k))) invalid();
    const selected = (stage: 'stt' | 'llm'): string | null => {
        const id = defaults[stage] ?? null;
        if (id !== null && (typeof id !== 'string' || !entries.some(r => r.id === id && r.stage === stage))) invalid();
        return id as string | null;
    };
    const legacy = asObject(v.legacyRouteIds) ?? {};
    if (v.legacyRouteIds !== undefined && !asObject(v.legacyRouteIds) || Object.values(legacy).some(id => typeof id !== 'string' || !entries.some(r => r.id === id))) invalid();
    if (Object.keys(legacy).some(k => ['__proto__','prototype','constructor'].includes(k))) invalid();
    return { version: 2, entries, credentials, defaults: { stt: selected('stt'), llm: selected('llm') }, legacyRouteIds: { ...legacy } as Record<string,string> };
}
export function registrationEndpoint(r: ModelRegistration): string { if (r.endpointUrl) return registrationBaseUrl(r.endpointUrl); const base = registrationBaseUrl(r.baseUrl), path = r.stage === 'stt' ? '/audio/transcriptions' : '/chat/completions'; return base.endsWith(path) ? base : base + path; }
export function registrationSignature(r: ModelRegistration): string { const settings = Object.fromEntries(Object.entries(validateRegistration(r)).filter(([key]) => key !== 'name' && key !== 'lastTest')); return JSON.stringify(settings); }
export function registrationInputSummary(input: RegistrationTestInput): string {
    return input.stage === 'stt' ? JSON.stringify({ stage: input.stage, bytes: input.file.size, type: input.file.type, languages: input.languages, glossary: input.glossary, context: input.context }) : JSON.stringify(input);
}
// Known provider contracts; custom endpoints retain their declared options.
export function sttCapabilities(model: ModelRegistration) {
    type S = NonNullable<ModelRegistration['stt']>;
    type Capabilities = { formats: NonNullable<S['responseFormat']>[]; languages: NonNullable<S['languageMode']>[]; terms: NonNullable<S['termMode']>[] };
    const all: Capabilities = { formats: ['json', 'verbose_json', 'diarized_json'], languages: ['none', 'single', 'multiple'], terms: ['none', 'prompt', 'keywords', 'prompt-and-keywords'] };
    if (model.adapter === 'openrouter') return { formats: ['openai/gpt-transcribe', 'openai/gpt-4o-transcribe'].includes(model.modelId) ? ['json'] : ['json', 'verbose_json'], languages: ['none', 'single'], terms: ['none'] } satisfies Capabilities;
    if (model.adapter !== 'openai') return all;
    if (model.modelId === 'gpt-transcribe') return { formats: ['json'], languages: ['none', 'multiple'], terms: all.terms } satisfies Capabilities;
    if (model.modelId === 'gpt-4o-transcribe-diarize') return { formats: ['json', 'diarized_json'], languages: ['none', 'single'], terms: ['none'] } satisfies Capabilities;
    if (['whisper-1', 'gpt-4o-transcribe', 'gpt-4o-mini-transcribe', 'gpt-4o-mini-transcribe-2025-12-15'].includes(model.modelId)) return { formats: model.modelId === 'whisper-1' ? ['json', 'verbose_json'] : ['json'], languages: ['none', 'single'], terms: ['none', 'prompt'] } satisfies Capabilities;
    return all;
}
// Reviewed request mappings; compatible servers still require their own capability settings.
export function sttInputSupport(model: ModelRegistration) {
    const nativePrompt = model.adapter === 'openai' && ['whisper-1', 'gpt-4o-transcribe', 'gpt-4o-mini-transcribe', 'gpt-4o-mini-transcribe-2025-12-15'].includes(model.modelId);
    const azure = model.adapter === 'openrouter' && model.modelId === 'microsoft/mai-transcribe-2';
    const phrases = asObject(asObject(asObject(asObject(model.requestParameters?.provider)?.options)?.azure)?.phraseList)?.phrases;
    const termMode = model.adapter === 'openai' && model.modelId === 'gpt-4o-transcribe-diarize' ? 'none' as const : azure ? 'azure-phrases' as const : model.stt?.termMode ?? (nativePrompt ? 'prompt' : 'none');
    return { languageMode: model.stt?.languageMode ?? 'none', termMode, context: termMode === 'prompt' || termMode === 'prompt-and-keywords', defaultTerms: azure && Array.isArray(phrases) ? phrases.filter((v): v is string => typeof v === 'string') : [] };
}
export function defaultRegistrationOutputTokens(model: ModelRegistration): number | undefined {
    return model.llm?.maxTokens === undefined ? undefined : Math.min(4096, model.llm.maxTokens, model.catalogEvidence?.limits.maxOutputTokens ?? Infinity);
}
export function buildRegistrationRequest(value: ModelRegistration, input: RegistrationTestInput | 'preview', outputTokens?: number): {
    url: string;
    body: FormData | string;
    contentType: string | null;
    preview: string;
} {
    const r = validateRegistration(value);
    if (outputTokens !== undefined && (r.stage !== 'llm' || r.llm?.maxTokens === undefined || outputTokens > Math.min(r.llm.maxTokens, r.catalogEvidence?.limits.maxOutputTokens ?? Infinity))) invalid();
    if (input !== 'preview' && input.stage !== r.stage)
        invalid();
    const url = registrationEndpoint(r);
    const auth = r.auth === 'bearer' ? 'Authorization: Bearer {{api_key}}\n' : '';
    if (r.stage === 'stt') {
        const s = r.stt!, support = sttInputSupport(r);
        const form = new FormData();
        form.set('model', r.modelId);
        form.set('response_format', s.responseFormat!);
        const fields: string[] = ['model: {{model}}', 'file: {{audio}}', `response_format: ${s.responseFormat}`];
        const data = input !== 'preview' && input.stage === 'stt' ? input : null;
        if (data)
            form.set('file', data.file, data.file.name);
        if (s.languageMode === 'single') {
            fields.push('language: {{language}}');
            if (data?.languages.length)
                form.set('language', data.languages[0]);
        }
        if (s.languageMode === 'multiple') {
            fields.push('languages[]: {{languages}}');
            data?.languages.forEach(v => form.append('languages[]', v));
        }
        if (support.termMode === 'prompt' || support.termMode === 'prompt-and-keywords') {
            fields.push('prompt: {{glossary_and_context}}');
            if (data) {
                const prompt = [support.termMode === 'prompt' ? data.glossary.join(', ') : '', data.context].filter(Boolean).join('\n');
                if (prompt)
                    form.set('prompt', prompt);
            }
        }
        if (support.termMode === 'keywords' || support.termMode === 'prompt-and-keywords') {
            fields.push('keywords[]: {{glossary}}');
            data?.glossary.forEach(v => form.append('keywords[]', v));
        }
        if (s.timestamps !== 'none') {
            fields.push(`timestamp_granularities[]: ${s.timestamps}`);
            form.append('timestamp_granularities[]', s.timestamps!);
        }
        if (r.adapter === 'openrouter') {
            const provider: Record<string, unknown> = { ...asObject(r.requestParameters?.provider), data_collection: 'deny', zdr: r.routerPolicy?.requireZdr !== false };
            if (support.termMode === 'azure-phrases' && data) {
                const options = asObject(provider.options), azure = asObject(options?.azure);
                provider.options = { ...options, azure: { ...azure, phraseList: { ...asObject(azure?.phraseList), phrases: data.glossary } } };
            }
            const body = { ...r.requestParameters, ...(s.temperature !== undefined ? { temperature: s.temperature } : {}), model: input === 'preview' ? '{{model}}' : r.modelId, input_audio: data?.encodedAudio ?? { data: '{{audio_base64}}', format: '{{audio_format}}' }, response_format: s.responseFormat, ...(s.languageMode === 'single' ? { language: data?.languages[0] ?? '{{language}}' } : {}), ...(s.timestamps !== 'none' ? { timestamp_granularities: [s.timestamps] } : {}), provider };
            const previewBody = { ...body, model: '{{model}}', input_audio: { data: '{{audio_base64}}', format: '{{audio_format}}' }, ...(s.languageMode === 'single' ? { language: '{{language}}' } : {}) };
            return { url, body: JSON.stringify(body), contentType: 'application/json', preview: `POST ${url}\n${auth}Content-Type: application/json\n${JSON.stringify(previewBody, null, 2)}\n\nresponse.text / response.segments / response.words / response.usage` };
        }
        if (s.temperature !== undefined) { form.set('temperature', String(s.temperature)); fields.push(`temperature: ${s.temperature}`); }
        for (const [key, value] of Object.entries(r.requestParameters ?? {})) { form.set(key, typeof value === 'string' ? value : JSON.stringify(value)); fields.push(`${key}: ${JSON.stringify(value)}`); }
        return { url, body: form, contentType: null, preview: `POST ${url}\n${auth}multipart/form-data (boundary: browser)\n${fields.join('\n')}\n\nresponse.text / response.segments / response.words / response.usage` };
    }
    const l = r.llm!;
    const data = input !== 'preview' && input.stage === 'llm' ? input : null;
    const messages = data ? buildMinutesMessages({ id: 'registration-test', parentId: null, rawIds: [], segments: [{ id: 'test', text: data.transcript, sourceStartMs: 0, sourceEndMs: 0, rawIds: [] }], issues: [], missingRanges: [] }, { modelId: r.modelId, outputLanguage: data.outputLanguage, sections: data.sections as readonly MinutesSection[], instructions: data.instructions }) : [{ role: 'system', content: '{{minutes_instructions}}' }, { role: 'user', content: '{{selected_transcript_and_settings}}' }];
    const rendered = data && r.instructionTemplate ? renderInstructionTemplate(r.instructionTemplate, data) : '';
    const requestMessages = rendered ? [...messages, { role: 'user', content: rendered }] : messages;
    const budget = number(outputTokens ?? defaultRegistrationOutputTokens(r), 1, 1000000, true);
    const options = { ...(budget !== undefined ? { [l.tokenField!]: budget } : {}), ...(l.temperature !== undefined ? { temperature: l.temperature } : {}), ...(l.topP !== undefined ? { top_p: l.topP } : {}) };
    const endpointTag=r.routerEndpointTag??r.catalogEvidence?.route.endpointTag;
    const body = JSON.stringify({ ...r.requestParameters, model: r.modelId, messages: requestMessages, stream: false, ...options, ...(r.adapter === 'openrouter' ? {provider: { ...asObject(r.requestParameters?.provider), data_collection: 'deny', zdr: r.routerPolicy?.requireZdr !== false, allow_fallbacks: false, ...(endpointTag ? {only: [endpointTag]} : {}) }} : {}) });
    const previewBody = JSON.stringify({ ...JSON.parse(body), model: '{{model}}', messages: [{ role: 'system', content: '{{minutes_instructions}}' }, { role: 'user', content: '{{selected_transcript_and_settings}}' }] }, null, 2);
    return { url, body, contentType: 'application/json', preview: `POST ${url}\n${auth}Content-Type: application/json\n${previewBody}\n\nresponse.choices[0].message.content\nresponse.choices[0].finish_reason / response.usage / response.model / response.id` };
}

const managedParameters = new Set(['model','input_audio','file','messages','stream','url','auth','authorization','headers','response_format','timestamp_granularities','language','languages','prompt','keywords','max_tokens','max_completion_tokens','temperature','top_p']);
const forbiddenKeys = /^(?:__proto__|prototype|constructor|api[_-]?key|key|token|access[_-]?token|secret|password|authorization|auth|headers|credentials?|testTranscript|testAudio|audio_data|transcript)$/iu;
export function validatePublicJson(value: unknown, limit = 65536): void {
    let nodes = 0;
    function visit(item: unknown, depth: number): void {
        if (++nodes > 10000 || depth > 12) invalid();
        if (item === null || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item)) return;
        if (typeof item === 'string') { if (/(?:sk-[a-zA-Z0-9_-]{12,}|Bearer\s+\S+)/u.test(item)) invalid(); return; }
        if (Array.isArray(item)) { item.forEach(v => visit(v, depth + 1)); return; }
        if (!item || typeof item !== 'object' || ![Object.prototype,null].includes(Object.getPrototypeOf(item))) invalid();
        for (const [key,v] of Object.entries(item)) { if (forbiddenKeys.test(key) && !(key === 'auth' && (v === 'none' || v === 'bearer'))) invalid(); visit(v,depth+1); }
    }
    visit(value,0);
    if (new TextEncoder().encode(JSON.stringify(value)).length > limit) invalid();
}
export function validateRequestParameters(value: unknown): Readonly<Record<string, unknown>> {
    validatePublicJson(value);
    const object = asObject(value); if (!object) invalid();
    if (Object.keys(object).some(key => managedParameters.has(key.toLowerCase()))) invalid();
    if (object.provider !== undefined) {
        const provider = asObject(object.provider); if (!provider || Object.keys(provider).some(k => k !== 'options') || provider.options !== undefined && !asObject(provider.options)) invalid();
    }
    return structuredClone(object);
}
export function validateInstructionTemplate(value: unknown): string {
    if (typeof value !== 'string' || value.length > 8192 || Array.from(value).some(c => c.charCodeAt(0) < 32 && ![9,10,13].includes(c.charCodeAt(0)))) invalid();
    if (/\{\{|\}\}/u.test(value.replace(/\{\{(?:transcript|output_language|sections|instructions)\}\}/gu,''))) invalid();
    return value;
}
export function renderInstructionTemplate(template: string, input: Extract<RegistrationTestInput,{stage:'llm'}>): string {
    const values = { transcript: input.transcript, output_language: input.outputLanguage, sections: input.sections.join(', '), instructions: input.instructions };
    return validateInstructionTemplate(template).replace(/\{\{(transcript|output_language|sections|instructions)\}\}/gu, (_m,key: keyof typeof values) => values[key]);
}
export function freezeExecutionModel(value: ModelRegistration): ModelRegistration {
    const result = Object.fromEntries(Object.entries(validateRegistration(value)).filter(([key]) => key !== 'lastTest')) as ModelRegistration;
    function freeze(value: unknown): void { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } }
    freeze(result); return result;
}
export function registrationReadiness(value: ModelRegistration): readonly string[] {
    const r = validateRegistration(value), issues: string[] = [];
    if (!r.enabled) issues.push('disabled');
    const endpoint = new URL(registrationEndpoint(r));
    if (endpoint.hostname === '[::1]') issues.push('ipv6-csp');
    if (r.auth === 'bearer' && r.credentialOrigin !== endpoint.origin) issues.push('credential-origin');
    if (r.adapter === 'openrouter' && !r.routerPolicy?.acknowledged) issues.push('router-disclosure');
    if (r.stage === 'stt') {
        const capabilities = sttCapabilities(r), s = r.stt!;
        if (!capabilities.formats.includes(s.responseFormat!)) issues.push('stt-model-format');
        if (!capabilities.languages.includes(s.languageMode!)) issues.push('stt-model-language');
        if (!capabilities.terms.includes(s.termMode!)) issues.push('stt-model-terms');
    }
    if (r.stage === 'stt' && (!r.stt?.maxBytes || !r.stt.formats?.length)) issues.push('stt-limits');
    if (r.stage === 'llm' && (!r.llm?.contextTokens || !r.llm.maxTokens || r.llm.maxTokens >= r.llm.contextTokens)) issues.push('llm-limits');
    return issues;
}
