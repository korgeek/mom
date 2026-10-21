// Synthetic input and intercepted transport; encrypted save/restore uses the real vault.
import { afterEach, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { createMeetingController, type MeetingController } from '../src/react-app/controller';
import { createVaultSession, type VaultSession } from '../src/react-app/vault/session';
import { cancelJobs, createJobContext } from '../src/react-app/domain/jobs';
import { validateRegistration, type ModelRegistration } from '../src/react-app/providers/model-registrations';
import { sttActionToken } from '../src/react-app/transcript/batches';
import { aggregateProjectUsage } from '../src/react-app/usage/statement';
import { withChunkSources } from '../src/react-app/transcript/merge';
import { minutesInputSignature } from '../src/react-app/minutes/generate';

const phrase = 'synthetic unified model controller phrase';
const cores: MeetingController[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const core of cores.splice(0)) await core.dispose(); cancelJobs(); });
const adapters = ['openai', 'openrouter', 'openai-compatible'] as const;
function model(stage: 'stt' | 'llm', adapter: typeof adapters[number], suffix = ''): ModelRegistration {
  const baseUrl = adapter === 'openai' ? 'https://api.openai.com/v1' : adapter === 'openrouter' ? 'https://openrouter.ai/api/v1' : 'http://127.0.0.1:19991/v1';
  return validateRegistration({ id: `${stage}_${adapter}${suffix}`, name: `Synthetic ${adapter} ${stage}${suffix}`, stage, baseUrl,
    endpointUrl: `${baseUrl}/${stage === 'stt' ? 'audio/transcriptions' : 'chat/completions'}`, adapter,
    modelId: `${stage}-synthetic${suffix}`, auth: adapter === 'openai-compatible' ? 'none' : 'bearer',
    credentialOrigin: null, credentialVersion: 0, enabled: true, revision: 1, keyStorage: 'encrypted',
    routerPolicy: { requireZdr: true, acknowledged: true },
    ...(stage === 'stt' ? { stt: { responseFormat: 'json', languageMode: 'none', termMode: 'none', timestamps: 'none', maxBytes: 16000000, formats: ['mp3', 'wav'] } }
      : { llm: { tokenField: 'max_tokens', maxTokens: 1024, contextTokens: 32000 } }),
  });
}
async function fixture(response?: (url: string, init: RequestInit) => Promise<Response>) {
  let session!: VaultSession;
  const calls: { url: string; init: RequestInit }[] = [];
  const core = createMeetingController({ indexedDB: new IDBFactory(), databaseName: crypto.randomUUID(),
    sessionFactory: options => session = createVaultSession({ ...options, testOnlyOwnership: { acquire: async () => () => {} } }),
    fetch: async (url, init) => {
      calls.push({ url: String(url), init: init! });
      if (response) return response(String(url), init!);
      return new Response(JSON.stringify(String(url).endsWith('/audio/transcriptions')
        ? { text: 'SYNTHETIC_TRANSCRIPT approve the launch.', usage: { seconds: 1, cost: 0.0001 } }
        : { model: 'returned-synthetic-text', choices: [{ message: { content: '# SYNTHETIC_NOTES\nLaunch approved.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 30, completion_tokens: 10, cost: 0.0002 } }));
    } });
  cores.push(core); await core.initialize(); await core.createVault(phrase);
  return { core, calls, get session() { return session; } };
}
async function saveModel(f: Awaited<ReturnType<typeof fixture>>, value: ModelRegistration) {
  await f.core.getSnapshot().onSaveRegistration!(value, value.auth === 'none' ? { action: 'keep' } : { action: 'replace', value: 'SYNTHETIC_ONLY_KEY' });
}
it('enriches a legacy selected transcript for consent and dispatch without rewriting its speech or history', async () => {
  const f = await fixture(), stt = model('stt', 'openai-compatible'), llm = model('llm', 'openai-compatible');
  await saveModel(f, stt); await saveModel(f, llm);
  await f.core.getSnapshot().onSetRegistrationDefault!('stt', stt.id); await f.core.getSnapshot().onSetRegistrationDefault!('llm', llm.id);
  const id = await prepared(f), p = f.core.getSnapshot().projects.find(p => p.id === id)!;
  await f.core.startSTT(id, { modelId: stt.id, acknowledged: true, consentToken: sttActionToken(f.core.getSnapshot().sttConsentToken, p, { purpose: 'initial', chunkIds: p.preparedChunks.map(chunk => chunk.id), modelId: stt.id }) });
  const saved = f.core.getSnapshot().projects.find(p => p.id === id)!;
  const legacy = { ...saved, transcriptVersions: saved.transcriptVersions.map(version => { const legacyVersion = { ...version }; delete legacyVersion.chunkSources; return { ...legacyVersion, issues: [{ id: 'legacy-overlap', rangeMs: [0, 500] as const, alternatives: [version.segments], selected: null }] }; }) };
  await f.session.store.checkpoint({ project: legacy, runId: null, audioRecords: [] }, createJobContext());
  await f.core.lock(); await f.core.unlock(phrase); await f.core.setMinutesRoute(id, llm.id);
  await f.core.generateMinutes(id, { acknowledged: true, transcriptVersionId: legacy.selectedTranscriptVersionId!, consentToken: f.core.getSnapshot().minutesConsentToken!, partialAcknowledged: false });
  const result = f.core.getSnapshot().projects.find(p => p.id === id)!, request = JSON.parse(String(f.calls.at(-1)!.init.body));
  expect(JSON.parse(request.messages[1].content).selectedTranscript.chunks).toHaveLength(1);
  expect(result.transcriptVersions).toEqual(legacy.transcriptVersions); expect(result.rawTranscripts).toEqual(legacy.rawTranscripts);
  expect(result.minutesRuns[0].generatedMarkdown).not.toContain('Incomplete transcript');
  const selected = legacy.transcriptVersions.find(v => v.id === legacy.selectedTranscriptVersionId)!;
  expect(result.minutesRuns[0]).toMatchObject({ inputSignature: await minutesInputSignature(withChunkSources(selected, legacy.rawTranscripts, legacy.preparedChunks), result.minutesRuns[0].settings) });
  expect(f.calls).toHaveLength(2);
});
async function prepared(f: Awaited<ReturnType<typeof fixture>>, format: 'mp3' | 'wav' = 'mp3') {
  const id = await f.core.createMeeting();
  const p = f.core.getSnapshot().projects.find(p => p.id === id)!;
  const sourceId = crypto.randomUUID(), audio = new Blob(['synthetic-fixture-only'], { type: format === 'wav' ? 'audio/wav' : 'audio/mpeg' });
  const chunk = { id: crypto.randomUUID(), sourceId, index: 0, sourceStartMs: 0, sourceEndMs: 1000, encodingOffsetMs: 0, encodedBytes: audio.size, mimeType: audio.type, codec: format === 'wav' ? 'pcm-s16le' : 'mp3', audioRecordId: crypto.randomUUID() };
  await f.session.store.checkpoint({ project: { ...p, audioOptions: { ...p.audioOptions, expectedLanguages: [] },
    sourceAssets: [{ id: sourceId, fileName: `SYNTHETIC_FIXTURE.${format}`, bytes: audio.size, container: format, codec: chunk.codec, durationMs: 1000, channels: 1, sampleRateHz: 16000 }], preparedChunks: [chunk] }, runId: null,
    audioRecords: [{ recordId: sourceId, audio }, { recordId: chunk.audioRecordId, audio }] }, createJobContext());
  await f.core.lock(); await f.core.unlock(phrase);
  f.core.getSnapshot().onNavigate!('stt', id);
  await vi.waitFor(() => expect(f.core.getSnapshot().busy).toBe(false));
  return id;
}

it('dispatches retained PCM WAV through the registered STT controller', async () => {
  const f = await fixture(), stt = model('stt', 'openai-compatible');
  await saveModel(f, stt); await f.core.getSnapshot().onSetRegistrationDefault!('stt', stt.id);
  const id = await prepared(f, 'wav'), project = f.core.getSnapshot().projects.find(p => p.id === id)!;
  await f.core.startSTT(id, { modelId: stt.id, acknowledged: true, consentToken: sttActionToken(f.core.getSnapshot().sttConsentToken, project, { purpose: 'initial', chunkIds: project.preparedChunks.map(chunk => chunk.id), modelId: stt.id }) });
  expect(f.calls).toHaveLength(1); expect(f.calls[0].url).toBe(stt.endpointUrl);
  const file = (f.calls[0].init.body as FormData).get('file') as File;
  expect(file.type).toBe('audio/wav'); expect(file.size).toBe(project.preparedChunks[0].encodedBytes);
  expect(f.core.getSnapshot().projects.find(p => p.id === id)!.rawTranscripts[0].text).toContain('SYNTHETIC_TRANSCRIPT');
});

it('saves model, key and independent defaults without any network request', async () => {
  const f = await fixture(); const stt = model('stt', 'openrouter'), llm = model('llm', 'openai');
  await saveModel(f, stt); await saveModel(f, llm);
  await f.core.getSnapshot().onSetRegistrationDefault!('stt', stt.id);
  await f.core.getSnapshot().onSetRegistrationDefault!('llm', llm.id);
  expect(f.calls).toHaveLength(0);
  expect(f.core.getSnapshot().registrationKeyReady).toEqual(expect.arrayContaining([stt.id, llm.id]));
  expect(JSON.stringify(f.core.getSnapshot())).not.toContain('SYNTHETIC_ONLY_KEY');
  await f.core.lock(); await f.core.unlock(phrase);
  expect(f.core.getSnapshot().modelRegistrations?.defaults).toEqual({ stt: stt.id, llm: llm.id });
});

it('deletes a model registration and its default while retaining the shared key, other model and project', async () => {
  const f=await fixture(), stt=model('stt','openrouter'), llm=model('llm','openrouter');
  await saveModel(f,stt); const key=f.core.getSnapshot().modelRegistrations!.credentials![0];
  await f.core.getSnapshot().onSaveRegistration!({...llm,credentialId:key.id});
  await f.core.getSnapshot().onSetRegistrationDefault!('stt',stt.id); await f.core.getSnapshot().onSetRegistrationDefault!('llm',llm.id);
  const projectId=await f.core.createMeeting(), before=f.core.getSnapshot().projects.find(p=>p.id===projectId);
  await f.core.getSnapshot().onDeleteRegistration!(stt.id);
  expect(f.core.getSnapshot().modelRegistrations!.entries.map(r=>r.id)).toEqual([llm.id]);
  expect(f.core.getSnapshot().modelRegistrations!.defaults).toEqual({stt:null,llm:llm.id});
  expect(f.core.getSnapshot().projects.find(p=>p.id===projectId)).toEqual(before);
  expect(await f.session.getProviderKey('credential:'+key.id)).toBe('SYNTHETIC_ONLY_KEY');
  expect(f.core.getSnapshot().sttModelId).toBe('');
  await f.core.lock(); await f.core.unlock(phrase);
  expect(f.core.getSnapshot().modelRegistrations!.entries.map(r=>r.id)).toEqual([llm.id]);
  expect(f.core.getSnapshot().registrationKeyReady).toEqual([llm.id]); expect(f.calls).toEqual([]);
});

it('keeps a model registration and default after a failed deletion save', async () => {
  const f=await fixture(), stt=model('stt','openai'); await saveModel(f,stt); await f.core.getSnapshot().onSetRegistrationDefault!('stt',stt.id);
  const before=f.core.getSnapshot().modelRegistrations, put=IDBObjectStore.prototype.put;
  const failure=vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(this:IDBObjectStore,...args:Parameters<IDBObjectStore['put']>){if(this.name==='records'){this.transaction.abort();throw Error('SYNTHETIC_QUOTA');}return put.apply(this,args);});
  await expect(f.core.getSnapshot().onDeleteRegistration!(stt.id)).rejects.toThrow(); failure.mockRestore();
  expect(f.core.getSnapshot().modelRegistrations).toEqual(before);
  await f.core.lock(); await f.core.unlock(phrase); expect(f.core.getSnapshot().modelRegistrations).toEqual(before);
});

it.each(['openai','openrouter'] as const)('checks a named API key for %s without models or inference and clears verification on rotation', async provider => {
  const f=await fixture(async()=>new Response(JSON.stringify({data:provider==='openai'?[]:{label:'synthetic'}})));
  const key={id:'key_only',name:'Synthetic key',origin:provider==='openai'?'https://api.openai.com':'https://openrouter.ai',keyStorage:'encrypted' as const,version:0};
  await f.core.getSnapshot().onSaveApiCredential!(key,{action:'replace',value:'SYNTHETIC_KEY_CHECK'});
  expect(f.calls).toHaveLength(0); await f.core.getSnapshot().onCheckApiCredential!(key.id);
  expect(f.calls.map(c=>c.url)).toEqual([provider==='openai'?'https://api.openai.com/v1/models':'https://openrouter.ai/api/v1/key']);
  expect(f.calls[0].init.method).toBe('GET'); expect(f.calls[0].init.body).toBeUndefined();
  expect(new Headers(f.calls[0].init.headers).get('Authorization')).toBe('Bearer SYNTHETIC_KEY_CHECK');
  expect(f.calls[0].init).toMatchObject({credentials:'omit',redirect:'error'});
  expect(f.core.getSnapshot().apiCredentialChecks?.[key.id].state).toBe('verified');
  expect(JSON.stringify(f.core.getSnapshot())).not.toContain('SYNTHETIC_KEY_CHECK');
  await f.core.getSnapshot().onSaveApiCredential!(f.core.getSnapshot().modelRegistrations!.credentials![0],{action:'replace',value:'SYNTHETIC_ROTATED'});
  expect(f.core.getSnapshot().apiCredentialChecks?.[key.id]).toBeUndefined();
});

it.each([401,200])('keeps a failed key check unverified for HTTP %i with an invalid response', async status => {
  const f=await fixture(async()=>new Response('{"error":{"message":"SYNTHETIC_PRIVATE_PROVIDER_ERROR"}}',{status}));
  await f.core.getSnapshot().onSaveApiCredential!({id:'key',name:'Synthetic',origin:'https://openrouter.ai',keyStorage:'encrypted',version:0},{action:'replace',value:'SYNTHETIC_ONLY_KEY'});
  await expect(f.core.getSnapshot().onCheckApiCredential!('key')).rejects.toThrow();
  expect(f.core.getSnapshot().apiCredentialChecks?.key.state).toBe('failed');
  expect(JSON.stringify(f.core.getSnapshot())).not.toContain('SYNTHETIC_PRIVATE_PROVIDER_ERROR'); expect(f.calls).toHaveLength(1);
});

it('does not guess a custom key check endpoint or send its secret', async () => {
  const f=await fixture(); await f.core.getSnapshot().onSaveApiCredential!({id:'local',name:'Synthetic custom',origin:'http://localhost:19991',keyStorage:'encrypted',version:0},{action:'replace',value:'SYNTHETIC_CUSTOM_KEY'});
  await f.core.getSnapshot().onCheckApiCredential!('local');
  expect(f.core.getSnapshot().apiCredentialChecks?.local.state).toBe('unsupported'); expect(f.calls).toEqual([]);
});

it('fences a key check response after lock without restoring verification', async () => {
  let complete!:(r:Response)=>void;const f=await fixture(()=>new Promise(r=>{complete=r;}));
  await f.core.getSnapshot().onSaveApiCredential!({id:'key',name:'Synthetic',origin:'https://api.openai.com',keyStorage:'encrypted',version:0},{action:'replace',value:'SYNTHETIC_ONLY_KEY'});
  const checking=f.core.getSnapshot().onCheckApiCredential!('key'), rejected=expect(checking).rejects.toThrow();
  await vi.waitFor(()=>expect(f.calls).toHaveLength(1));await f.core.lock();complete(new Response('{"data":[]}')); await rejected;
  expect(f.core.getSnapshot().apiCredentialChecks).toEqual({});await f.core.unlock(phrase); expect(f.core.getSnapshot().apiCredentialChecks).toEqual({});
});

it('reuses one separately stored key for both stages and refreshes both after rotation or deletion', async () => {
  const f = await fixture();
  const key = { id: 'shared_router_key', name: 'Synthetic shared OpenRouter key', origin: 'https://openrouter.ai', keyStorage: 'encrypted' as const, version: 0 };
  await f.core.getSnapshot().onSaveApiCredential!(key, { action: 'replace', value: 'SYNTHETIC_SHARED_KEY' });
  for (const stage of ['stt', 'llm'] as const) {
    await f.core.getSnapshot().onSaveRegistration!({ ...model(stage, 'openrouter'), credentialId: key.id }, { action: 'keep' });
  }
  const before = f.core.getSnapshot().modelRegistrations!;
  expect(before.credentials).toHaveLength(1);
  expect(before.entries.every(entry => entry.credentialId === key.id)).toBe(true);
  expect(f.core.getSnapshot().credentialKeyReady).toEqual([key.id]);
  expect(f.core.getSnapshot().registrationKeyReady).toHaveLength(2);
  await f.core.getSnapshot().onSaveApiCredential!(before.credentials![0], { action: 'replace', value: 'SYNTHETIC_ROTATED_KEY' });
  const after = f.core.getSnapshot().modelRegistrations!;
  expect(after.entries.every(entry => entry.credentialVersion > before.entries.find(old => old.id === entry.id)!.credentialVersion)).toBe(true);
  expect(JSON.stringify(f.core.getSnapshot())).not.toMatch(/SYNTHETIC_SHARED_KEY|SYNTHETIC_ROTATED_KEY/u);
  await f.core.lock();
  expect(f.core.getSnapshot().credentialKeyReady).toEqual([]);
  await f.core.unlock(phrase);
  expect(f.core.getSnapshot().registrationKeyReady).toHaveLength(2);
  await f.core.getSnapshot().onDeleteApiCredential!(key.id);
  expect(f.core.getSnapshot().credentialKeyReady).toEqual([]);
  expect(f.core.getSnapshot().registrationKeyReady).toEqual([]);
  expect(f.core.getSnapshot().modelRegistrations?.entries.every(entry => !entry.credentialId)).toBe(true);
  expect(f.calls).toHaveLength(0);
});

it.each(adapters.flatMap(stt => adapters.map(llm => [stt, llm] as const)))('executes %s transcription → %s notes and restores both encrypted results', async (sttAdapter, llmAdapter) => {
  const f = await fixture(); const stt = model('stt', sttAdapter), llm = model('llm', llmAdapter);
  await saveModel(f, stt); await saveModel(f, llm);
  await f.core.getSnapshot().onSetRegistrationDefault!('stt', stt.id);
  await f.core.getSnapshot().onSetRegistrationDefault!('llm', llm.id);
  const id = await prepared(f);
  const beforeSTT=f.core.getSnapshot().projects.find(p=>p.id===id)!;
  await f.core.startSTT(id, { modelId: stt.id, acknowledged: true, consentToken: sttActionToken(f.core.getSnapshot().sttConsentToken,beforeSTT,{purpose:'initial',chunkIds:beforeSTT.preparedChunks.map(chunk=>chunk.id),modelId:stt.id}) });
  await f.core.setMinutesRoute(id, llm.id);
  expect(f.core.getSnapshot().minutesUnavailableReason).toBeUndefined();
  const p = f.core.getSnapshot().projects.find(p => p.id === id)!;
  const oldToken=f.core.getSnapshot().minutesConsentToken!;
  await f.core.setMinutesSettings(id,{...p.minutesSettings,outputTokens:512});
  expect(f.core.getSnapshot().minutesSelection?.limits.outputTokens).toBe(512);
  await expect(f.core.generateMinutes(id,{acknowledged:true,transcriptVersionId:p.selectedTranscriptVersionId!,consentToken:oldToken,partialAcknowledged:false})).rejects.toMatchObject({code:'invalid-input'});
  await f.core.generateMinutes(id, { acknowledged: true, transcriptVersionId: p.selectedTranscriptVersionId!, consentToken: f.core.getSnapshot().minutesConsentToken!, partialAcknowledged: false });
  expect(f.calls.map(call => call.url)).toEqual([stt.endpointUrl, llm.endpointUrl]);
  const notesBody = JSON.parse(String(f.calls[1].init.body));
  expect(JSON.stringify(notesBody.messages)).toContain('SYNTHETIC_TRANSCRIPT');
  expect(notesBody).not.toHaveProperty('input_audio'); expect(notesBody.max_tokens).toBe(512);
  expect(new Headers(f.calls[0].init.headers).has('Authorization')).toBe(stt.auth === 'bearer');
  expect(new Headers(f.calls[1].init.headers).has('Authorization')).toBe(llm.auth === 'bearer');
  if(sttAdapter==='openrouter'&&llmAdapter==='openrouter') {
    const results=f.core.getSnapshot().projects.find(p=>p.id===id);
    await f.core.getSnapshot().onDeleteRegistration!(stt.id);await f.core.getSnapshot().onDeleteRegistration!(llm.id);
    expect(f.core.getSnapshot().projects.find(p=>p.id===id)).toEqual(results);
    expect(f.core.getSnapshot().modelRegistrations?.defaults).toEqual({stt:null,llm:null});
  }
  await f.core.lock(); await f.core.unlock(phrase);
  const restored = f.core.getSnapshot().projects.find(p => p.id === id)!;
  expect(restored.rawTranscripts[0].text).toContain('SYNTHETIC_TRANSCRIPT');
  expect(restored.minutesRuns[0].generatedMarkdown).toContain('SYNTHETIC_NOTES'); expect(restored.minutesSettings.outputTokens).toBe(512); expect(restored.minutesRuns[0].settings.outputTokens).toBe(512);
  expect(restored.runs.every(run => run.state === 'saved')).toBe(true);
  expect(restored.runs[0].intent?.modelSnapshot?.id).toBe(stt.id);
  expect(restored.runs[1].intent?.modelSnapshot?.id).toBe(llm.id);
  expect(aggregateProjectUsage(restored).items.map(item=>item.route)).toEqual([sttAdapter,llmAdapter]);
  expect(f.calls).toHaveLength(2);
});
