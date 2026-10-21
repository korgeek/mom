import { it, expect, vi } from 'vitest';
import { createJobContext } from '../src/react-app/domain/jobs';
import { validateRegistration } from '../src/react-app/providers/model-registrations';
import { runRegistrationTest } from '../src/react-app/providers/registration-test';
const r = validateRegistration({ id: 'fixture', name: 'Fixture', stage: 'llm', baseUrl: 'https://api.openai.com/v1', modelId: 'fixture-alias', auth: 'bearer', credentialOrigin: 'https://api.openai.com', credentialVersion: 1 });
const input = { stage: 'llm' as const, transcript: 'Synthetic meeting: approved the next review.', outputLanguage: 'ko', sections: ['summary'], instructions: '' };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
it('sends only saved credentials to the assembled endpoint and masks echoed secrets', async () => {
    const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => { expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer SYNTHETIC_SECRET'); expect(init?.redirect).toBe('error'); expect(init?.credentials).toBe('omit'); expect(JSON.parse(init?.body as string).messages[1].content).toContain('Synthetic meeting'); return response({ model: 'fixture-alias', choices: [{ message: { content: 'SYNTHETIC_SECRET result' }, finish_reason: 'stop' }], usage: { total_tokens: 12 } }); });
    const result = await runRegistrationTest(r, input, createJobContext(), { getKey: () => 'SYNTHETIC_SECRET', fetch });
    expect(fetch).toHaveBeenCalledOnce(); expect(fetch.mock.calls[0][1]?.cache).toBe('no-store');
    expect(result.state).toBe('success');
    expect(result.status).toBe(200);
    expect(result.raw).not.toContain('SYNTHETIC_SECRET');
    expect(result.text).toContain('[redacted]');
    expect(result.usage).toEqual({ total_tokens: 12 });
});
it.each([
    [{ error: { message: 'SYNTHETIC_SECRET' } }, 'failed'],
    [{ choices: [{ message: { content: 'partial' }, finish_reason: 'length' }] }, 'incomplete'],
    [{ choices: [{ message: { content: null, refusal: 'refused' }, finish_reason: 'stop' }] }, 'failed'],
    [{ choices: [{ message: { content: '', tool_calls: [{}] }, finish_reason: 'tool_calls' }] }, 'failed'],
    [{ choices: [{ message: { content: '' }, finish_reason: 'stop' }] }, 'failed'],
    [{ choices: [{ message: { content: 'hello' }, finish_reason: null }] }, 'failed'],
])('classifies actual response %j as %s', async (body, state) => {
    const result = await runRegistrationTest(r, input, createJobContext(), { getKey: () => 'SYNTHETIC_SECRET', fetch: async () => response(body) });
    expect(result.state).toBe(state);
    expect(result.raw).not.toContain('SYNTHETIC_SECRET');
});
it('rejects changed origins without reading a secret or sending', async () => { const getKey = vi.fn(() => 'SYNTHETIC_SECRET'), fetch = vi.fn(); const result = await runRegistrationTest({ ...r, baseUrl: 'https://example.com/v1' }, input, createJobContext(), { getKey, fetch }); expect(result.state).toBe('failed'); expect(getKey).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled(); });
it('supports keyless local requests, rejects oversized responses and malformed JSON', async () => {
    const local = { ...r, auth: 'none' as const, baseUrl: 'http://localhost:8000/v1', credentialOrigin: null };
    const getKey = vi.fn();
    for (const body of ['not json', 'x'.repeat(524289)]) {
        const result = await runRegistrationTest(local, input, createJobContext(), { getKey, fetch: async (_url, init) => { expect(new Headers(init?.headers).has('Authorization')).toBe(false); return new Response(body); } });
        expect(result.state).toBe('failed');
    }
    expect(getKey).not.toHaveBeenCalled();
});
function wav(seconds = 1) { const samples = 16000 * seconds; const b = new ArrayBuffer(44 + samples * 2), v = new DataView(b); const text = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0))); text(0, 'RIFF'); v.setUint32(4, 36 + samples * 2, true); text(8, 'WAVE'); text(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); text(36, 'data'); v.setUint32(40, samples * 2, true); return new File([b], 'test.wav', { type: 'audio/wav' }); }
it('inspects actual WAV bytes and duration before one multipart request', async () => {
    const stt = validateRegistration({ ...r, stage: 'stt', auth: 'none', credentialOrigin: null, stt: { languageMode: 'single' } }), fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => { const form = init?.body as FormData; expect(form.get('file')).toBeInstanceOf(File); expect(form.get('language')).toBe('ko'); expect(new Headers(init?.headers).has('Content-Type')).toBe(false); return response({ text: '', segments: [] }); });
    const audio = { stage: 'stt' as const, file: wav(), languages: ['ko'], glossary: [], context: '' };
    expect((await runRegistrationTest(stt, audio, createJobContext(), { getKey: () => null, fetch })).state).toBe('success');
    for (const file of [wav(31), new File(['invalid'], 'broken.wav'), new File([new Uint8Array(5242881)], 'large.wav')])
        expect((await runRegistrationTest(stt, { ...audio, file }, createJobContext(), { getKey: () => null, fetch })).state).toBe('failed');
    expect(fetch).toHaveBeenCalledOnce();
});
it('times out once, blocks duplicate paid calls, and ignores late successful responses', async () => {
    let settle!: (r: Response) => void;
    const fetch = vi.fn(() => new Promise<Response>(resolve => { settle = resolve; }));
    const pending = runRegistrationTest(r, input, createJobContext(), { getKey: () => 'SYNTHETIC_SECRET', fetch, timeoutMs: 30 });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    const duplicate = await runRegistrationTest(r, input, createJobContext(), { getKey: () => 'SYNTHETIC_SECRET', fetch });
    expect(duplicate.state).toBe('failed');
    expect((await pending).state).toBe('outcome-unknown');
    settle(response({ choices: [{ message: { content: 'late' }, finish_reason: 'stop' }] }));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(fetch).toHaveBeenCalledOnce();
});
it('masks escaped secrets in raw JSON and errors', async () => {
    const secret = 'SYNTHETIC_"QUOTED_SECRET';
    const result = await runRegistrationTest(r, input, createJobContext(), { getKey: () => secret, fetch: async () => response({ error: { message: secret } }) });
    expect(result.raw).not.toContain('QUOTED_SECRET');
});
it('preserves OpenRouter STT retention routing with the documented JSON transport', async () => {
    const router = validateRegistration({ ...r, stage: 'stt', adapter:'openrouter', baseUrl: 'https://openrouter.ai/api/v1', credentialOrigin: 'https://openrouter.ai', stt: { languageMode: 'single', routerRequireZdr: true } });
    const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => { expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json'); const body = JSON.parse(init?.body as string); expect(body.provider).toEqual({ data_collection: 'deny', zdr: true }); expect(body.input_audio.format).toBe('wav'); expect(body.input_audio.data).toBeTruthy(); expect(body.language).toBe('ko'); return response({ text: 'synthetic speech' }); });
    const result = await runRegistrationTest(router, { stage: 'stt', file: wav(), languages: ['ko'], glossary: [], context: '' }, createJobContext(), { getKey: () => 'SYNTHETIC_SECRET', fetch });
    expect(result.state).toBe('success');
    expect(fetch).toHaveBeenCalledOnce();
});
it('redacts an escaped secret after canonicalizing Unicode escapes', async () => {
    const key = 'SYNTHETIC_"QUOTED_SECRET';
    const body = JSON.stringify({ error: { message: key } }).replace('SYNTHETIC', String.fromCharCode(92) + 'u0053YNTHETIC');
    const result = await runRegistrationTest(r, input, createJobContext(), { getKey: () => key, fetch: async () => new Response(body) });
    expect(result.raw).not.toContain('QUOTED_SECRET');
});
it('does not corrupt response field names when a short saved key matches them', async () => {
    const result = await runRegistrationTest(r, input, createJobContext(), { getKey: () => 'content', fetch: async () => response({ choices: [{ message: { content: 'valid output' }, finish_reason: 'stop' }] }) });
    expect(result.state).toBe('success');
});
it('enforces smaller configured audio limits before dispatch and validates verbose timing',async()=>{
 const fetch=vi.fn(async()=>response({text:'speech',segments:[{start:0,end:1,text:'speech'}],words:[{start:0,end:1,word:'speech'}]}));
 const audio={stage:'stt' as const,file:wav(),languages:[],glossary:[],context:''};
 for(const stt of [{maxBytes:1000},{maxSeconds:0.5}]){
  const reg=validateRegistration({...r,stage:'stt',stt});expect((await runRegistrationTest(reg,audio,createJobContext(),{getKey:()=> 'SYNTHETIC_SECRET',fetch})).state).toBe('failed');
 }
 expect(fetch).not.toHaveBeenCalled();
 const reg=validateRegistration({...r,stage:'stt',stt:{responseFormat:'verbose_json',timestamps:'word'}});
 expect((await runRegistrationTest(reg,audio,createJobContext(),{getKey:()=> 'SYNTHETIC_SECRET',fetch})).state).toBe('success');
 const malformed=await runRegistrationTest(reg,audio,createJobContext(),{getKey:()=> 'SYNTHETIC_SECRET',fetch:async()=>response({text:'speech',segments:[{start:2,end:1,text:'speech'}]})});expect(malformed.state).toBe('failed');
});
it('accepts compatible chat responses with an empty tool_calls array',async()=>{
 const result=await runRegistrationTest(r,input,createJobContext(),{getKey:()=> 'SYNTHETIC_SECRET',fetch:async()=>response({choices:[{message:{content:'valid compatible output',tool_calls:[]},finish_reason:'stop'}]})});expect(result.state).toBe('success');
});
it('bounds redacted expansion so a completed result remains persistable', async () => {
 const result=await runRegistrationTest(r,input,createJobContext(),{getKey:()=> 'x',fetch:async()=>response({choices:[{message:{content:'x'.repeat(100000)},finish_reason:'stop'}]})});
 expect(result.state).toBe('incomplete');expect(result.raw.length).toBeLessThanOrEqual(524288);expect(result.text.length).toBeLessThanOrEqual(524288);expect(result.raw).not.toContain('xxxxxxxx');
});
it('does not read a saved key or dispatch HTTP IPv6 literal calls blocked by CSP',async()=>{
 const registration={...r,baseUrl:'http://[::1]:8000/v1',credentialOrigin:'http://[::1]:8000'},getKey=vi.fn(()=> 'SYNTHETIC_SECRET'),fetch=vi.fn();
 expect((await runRegistrationTest(registration,input,createJobContext(),{getKey,fetch})).state).toBe('failed');expect(getKey).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
});
