import { asObject, bodyProviderError, ProviderError, runPaidRequest, type FetchTransport, type RuntimeKeyGetter } from '../domain/pipeline';
import { parseTranscriptionEvents, readBoundedResponse } from './registered-runtime';
import type { JobContext } from '../domain/types';
import { inspectAudioDetails } from '../media/inspect';
import { buildRegistrationRequest, registrationEndpoint, registrationInputSummary, registrationSignature, validateRegistration, type ModelRegistration, type RegistrationTestInput, type RegistrationTestResult } from './model-registrations';
const MAX_RESPONSE_BYTES = 512 * 1024;
async function digest(input: RegistrationTestInput): Promise<string> {
    const summary = new TextEncoder().encode(registrationInputSummary(input));
    const content = input.stage === 'stt' ? new Uint8Array(await input.file.arrayBuffer()) : summary;
    const hash = await crypto.subtle.digest('SHA-256', content);
    return Array.from(new Uint8Array(hash), v => v.toString(16).padStart(2, '0')).join('') + ':' + registrationInputSummary(input);
}
export async function runRegistrationTest(value: ModelRegistration, input: RegistrationTestInput, job: JobContext, options: {
    getKey: RuntimeKeyGetter;
    fetch?: FetchTransport;
    now?: () => number;
    timeoutMs?: number;
    onCompleted?: (result: RegistrationTestResult) => void;
}): Promise<RegistrationTestResult> {
    const complete = (value: RegistrationTestResult) => {
        const limit = MAX_RESPONSE_BYTES;
        const expanded = value.raw.length > limit || value.text.length > limit || JSON.stringify(value.usage).length > limit;
        const trim = (text:string) => text.length > limit ? text.slice(0, limit-64) + '\n[Truncated after redaction]' : text;
        const result = expanded ? {...value, state:value.state === 'success' ? 'incomplete' as const : value.state, raw:trim(value.raw), text:trim(value.text), usage:JSON.stringify(value.usage).length > limit ? null : value.usage, message:value.message+'; redacted response truncated at app limit'} : value;
        options.onCompleted?.(result); return result;
    };
    const now = options.now ?? Date.now, start = now();
    let status: number | null = null, raw = '', secret: string | null = null, dispatched = false, audioFormat = '';
    let result: RegistrationTestResult = { signature: '', inputSignature: '', inputSummary: registrationInputSummary(input), state: 'failed', status: null, elapsedMs: 0, text: '', raw: '', message: '', requestedModel: value.modelId, returnedModel: null, usage: null };
    try {
        const r = validateRegistration(value);
        result = {...result, signature: registrationSignature(r)};
        job.assertActive();
        const destination = new URL(registrationEndpoint(r));
        if (destination.protocol === 'http:' && destination.hostname === '[::1]') throw new ProviderError('invalid-input');
        if (input.stage !== r.stage)
            throw new ProviderError('invalid-input');
        if (input.stage === 'stt') {
            if (!(input.file instanceof File) || !input.file.size || input.file.size > Math.min(5 * 1024 * 1024, r.stt?.maxBytes ?? Infinity))
                throw new ProviderError('too-large');
            const details = await inspectAudioDetails(input.file, job);
            job.assertActive();
            audioFormat = details.asset.container;
            if (!Number.isFinite(details.asset.durationMs) || details.asset.durationMs <= 0 || details.asset.durationMs > Math.min(30, r.stt?.maxSeconds ?? Infinity) * 1000)
                throw new ProviderError('too-large');
            if (r.stt?.languageMode === 'single' && input.languages.length > 1)
                throw new ProviderError('invalid-input');
            result = { ...result, inputSummary: JSON.stringify({ ...JSON.parse(result.inputSummary), durationMs: details.asset.durationMs }) };
        }
        else if (!input.transcript.trim() || input.transcript.length > 32768 || !input.outputLanguage.trim() || (!input.sections.length && !input.instructions.trim()))
            throw new ProviderError('invalid-input');
        if (result.inputSummary.length > 65536)
            throw new ProviderError('too-large');
        const inputSignature = await digest(input);
        job.assertActive();
        result = { ...result, inputSignature };
        let boundInput = input.stage === 'stt' ? { ...input, hintsProvided: input.hintsProvided ?? (input.glossary.length > 0 || input.context.length > 0) } : input;
        if (boundInput.stage === 'stt' && r.adapter === 'openrouter') {
            const bytes = new Uint8Array(await boundInput.file.arrayBuffer());
            job.assertActive();
            let binary = '';
            for (let i = 0; i < bytes.length; i += 32768)
                binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
            boundInput = { ...boundInput, encodedAudio: { data: btoa(binary), format: audioFormat } };
        }
        if (boundInput.stage === 'stt')
            boundInput = { ...boundInput, file: new File([boundInput.file], `test-audio.${audioFormat}`, { type: audioFormat === 'wav' ? 'audio/wav' : audioFormat === 'mp3' ? 'audio/mpeg' : 'audio/mp4' }) };
        const request = buildRegistrationRequest(r, boundInput);
        return await runPaidRequest(new URL(request.url).origin, job, async (signal, markDispatched) => {
            const headers = new Headers();
            if (r.auth === 'bearer') {
                if (r.credentialOrigin !== new URL(request.url).origin)
                    throw new ProviderError('authentication');
                secret = await options.getKey();
                job.assertActive();
                if (typeof secret !== 'string' || !secret.trim() || /[\r\n]/u.test(secret))
                    throw new ProviderError('authentication');
                headers.set('Authorization', `Bearer ${secret}`);
            }
            if (request.contentType)
                headers.set('Content-Type', request.contentType);
            signal.throwIfAborted();
            markDispatched();
            dispatched = true;
            const response = await (options.fetch ?? globalThis.fetch)(request.url, { method: 'POST', body: request.body, headers, signal, redirect: 'error', credentials: 'omit', cache: 'no-store' });
            job.assertActive();
            status = response.status;
            raw = await readBoundedResponse(response, signal, MAX_RESPONSE_BYTES);
            job.assertActive();
            const sanitize = (text: string) => secret ? text.split(secret).join('[redacted]') : text;
            const redact = (value: unknown): unknown => {
                if (typeof value === 'string')
                    return sanitize(value);
                if (Array.isArray(value))
                    return value.map(redact);
                const object = asObject(value);
                return object ? Object.fromEntries(Object.entries(object).map(([key, value]) => [sanitize(key), redact(value)])) : value;
            };
            let body: Record<string, unknown> | null;
            try {
                if (response.ok && r.stage === 'stt' && r.stt?.stream) { const parsed = parseTranscriptionEvents(raw); body = parsed.body; raw = JSON.stringify(redact({events:parsed.events})); }
                else { body = asObject(JSON.parse(raw)); raw = JSON.stringify(redact(body)); }
            }
            catch (error) {
                if (error instanceof ProviderError) { raw = JSON.stringify(redact(error.readSensitiveResponse() ?? {})); throw error; }
                raw = 'Unparseable response omitted';
                throw new ProviderError('malformed');
            }
            if (!response.ok || body?.error !== undefined)
                throw bodyProviderError(body?.error ?? null, response.status, now(), response.headers);
            if (!body)
                throw new ProviderError('malformed');
            result = { ...result, returnedModel: typeof body.model === 'string' ? sanitize(body.model) : null, usage: redact(body.usage ?? null) };
            if (r.stage === 'stt') {
                if (typeof body.text !== 'string')
                    throw new ProviderError('malformed');
                for (const key of ['segments', 'words'])
                    if (body[key] !== undefined && (!Array.isArray(body[key]) || (body[key] as unknown[]).some(item => { const o = asObject(item); return !o || typeof o.start !== 'number' || typeof o.end !== 'number' || !Number.isFinite(o.start) || !Number.isFinite(o.end) || o.start < 0 || o.end < o.start || typeof o[key === 'words' ? 'word' : 'text'] !== 'string'; })))
                        throw new ProviderError('malformed');
                result = { ...result, state: 'success', text: sanitize(body.text), message: body.text === '' ? 'Empty transcript returned' : 'Test completed' };
            }
            else {
                const choice = asObject(Array.isArray(body.choices) ? body.choices[0] : null), message = asObject(choice?.message);
                if (typeof message?.content === 'string')
                    result = { ...result, text: sanitize(message.content) };
                if (message?.refusal || message?.tool_calls != null && (!Array.isArray(message.tool_calls) || message.tool_calls.length > 0) || !result.text.trim())
                    throw new ProviderError('malformed');
                if (choice?.finish_reason === 'length')
                    result = { ...result, state: 'incomplete', message: 'Output limit reached' };
                else if (choice?.finish_reason !== 'stop')
                    throw new ProviderError('malformed');
                else
                    result = { ...result, state: 'success', message: 'Test completed' };
            }
            return complete({ ...result, status, raw, elapsedMs: Math.max(0, now() - start) });
        }, { now, timeoutMs: options.timeoutMs });
    }
    catch (error) {
        if (job.signal.aborted) {
            job.assertActive();
        }
        const failure = error instanceof ProviderError ? error : null;
        return complete({ ...result, state: failure?.outcomeUnknown ? 'outcome-unknown' : error instanceof DOMException && error.name === 'AbortError' ? (dispatched ? 'outcome-unknown' : 'cancelled') : 'failed', message: failure?.code ?? 'invalid-input', status, elapsedMs: Math.max(0, now() - start), raw: secret ? raw.split(secret).join('[redacted]').split(JSON.stringify(secret).slice(1, -1)).join('[redacted]') : raw });
    }
    finally {
        secret = null;
    }
}
