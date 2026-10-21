// Keyless Settings integration: real encrypted test vault, public metadata fixtures only.
import { webcrypto } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { createMeetingController, type MeetingController } from '../src/react-app/controller';
import { createVaultSession, type VaultSession } from '../src/react-app/vault/session';
import { cancelJobs } from '../src/react-app/domain/jobs';
import type { ModelSelectionSubmission } from '../src/react-app/ui/components/ModelManager';
const secret = 'TEST_ONLY model selection vault phrase';
const cores: MeetingController[] = [];
beforeAll(() => Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto }));
afterEach(async () => { for (const core of cores.splice(0)) await core.dispose(); cancelJobs(); vi.restoreAllMocks(); });
const textModel = { id: 'fixture/text', name: 'TEST_ONLY text', context_length: 32000, top_provider: { max_completion_tokens: 4096 }, architecture: { input_modalities: ['text'], output_modalities: ['text'] }, supported_parameters: ['max_tokens'], pricing: { prompt: '0.000001', completion: '0.000002', request: '0' } };
const endpoint = { tag: 'TEST_ONLY/explicit', context_length: 32000, max_prompt_tokens: 28000, max_completion_tokens: 4096, supported_parameters: ['max_tokens'], pricing: textModel.pricing };
const catalog = ['openai/gpt-4o-mini-transcribe', 'openai/whisper-large-v3', 'fixture/unsupported'].map(id => ({ id, name: id, architecture: { input_modalities: ['audio'], output_modalities: ['transcription'] }, pricing: { prompt: '0.000001', completion: '0.000002' } }));
async function opened() {
 const indexedDB = new IDBFactory(), held = new Set<string>(), calls: string[] = [];
 let failRegistry = false, failKey = false, saves = 0, session!: VaultSession;
 let endpointPrompt = endpoint.pricing.prompt;
 let endpointResult: 'valid' | 'empty' | 'failed' = 'valid';
 let heldSave: (() => Promise<void>) | null = null;
 const core = createMeetingController({ indexedDB, databaseName: crypto.randomUUID(), fetch: async url => { calls.push(String(url)); if (String(url) === 'https://openrouter.ai/api/v1/models?output_modalities=transcription') return new Response(JSON.stringify({ data: catalog })); if (String(url) === 'https://openrouter.ai/api/v1/models') return new Response(JSON.stringify({ data: [textModel] })); if (String(url) === 'https://openrouter.ai/api/v1/models/fixture/text/endpoints') { if (endpointResult === 'failed') throw new Error('TEST_ONLY PRIVATE_UPSTREAM'); return new Response(JSON.stringify({ data: { id: textModel.id, endpoints: endpointResult === 'empty' ? [] : [{ ...endpoint, pricing: { ...endpoint.pricing, prompt: endpointPrompt } }] } })); } throw new Error('Provider inference/auth is forbidden'); }, sessionFactory: options => {
  session = createVaultSession({ ...options, testOnlyOwnership: { acquire: async name => { if (held.has(name)) return null; held.add(name); return () => { held.delete(name); }; } } });
  return new Proxy(Object.create(session) as VaultSession, { get(target, key) { if (key === 'saveModelRegistry') return async (...args: Parameters<VaultSession['saveModelRegistry']>) => { saves++; await heldSave?.(); if (failRegistry) throw new DOMException('TEST_ONLY quota', 'QuotaExceededError'); return session.saveModelRegistry(...args); }; if (key === 'saveProviderKey') return async (...args: Parameters<VaultSession['saveProviderKey']>) => { if (failKey) throw new Error('TEST_ONLY secret error must not appear'); return session.saveProviderKey(...args); }; return Reflect.get(target, key); } });
 } });
 cores.push(core); await core.initialize(); await core.createVault(secret);
 return { core, calls, session, saves: () => saves, failRegistry: () => { failRegistry = true; }, failKey: () => { failKey = true; }, changeEndpoint: (prompt = '0.000009') => { endpointPrompt = prompt; }, endpointResult: (result: typeof endpointResult) => { endpointResult = result; }, holdSave: (gate: () => Promise<void>) => { heldSave = gate; } };
}
function apply(core: MeetingController, changes: ModelSelectionSubmission['changes'], defaultChanges?: ModelSelectionSubmission['defaultChanges'], revision = core.getSnapshot().modelManagement?.revision) {
 const management = core.getSnapshot().modelManagement!;
 expect(management.onApplySelection, 'owned atomic Apply callback').toBeTypeOf('function');
 return management.onApplySelection!({ baseRevision: revision!, changes, defaultChanges });
}
it('reports the latest failed key replacement without borrowing the previous saved badge', async () => {
 const f = await opened(); await f.core.saveKey('openrouter', 'TEST_ONLY_KEY_1', 'encrypted'); const before = f.core.getSnapshot().keySaveAttempts?.openrouter;
 expect(before).toMatchObject({ status: 'saved' }); f.failKey(); await expect(f.core.saveKey('openrouter', 'TEST_ONLY_KEY_2', 'encrypted')).rejects.toThrow();
 const after = f.core.getSnapshot(); expect(after.connections.find(c => c.provider === 'openrouter')?.status).toBe('saved'); expect(after.keySaveAttempts?.openrouter).toMatchObject({ status: 'failed' }); expect(after.keySaveAttempts!.openrouter!.revision).toBeGreaterThan(before!.revision); expect(after.keySaveAttempts!.openrouter!.message).not.toContain('TEST_ONLY'); expect(f.calls).toEqual([]);
 await f.core.lock(); expect(f.core.getSnapshot().keySaveAttempts).toEqual({});
});
it('atomically saves several exact preferences once, with explicit defaults and no policy or meeting mutation', async () => {
 const f = await opened(); const id = await f.core.createMeeting(); await f.core.discoverModels('openrouter', 'stt');
 const before = f.core.getSnapshot(), rows = before.modelManagement!.rows.filter(r => r.metadata.compatible && r.route.provider === 'openrouter'); const saves = f.saves();
 await apply(f.core, rows.map(r => ({ key: r.key, enabled: true })), [{ stage: 'stt', key: rows[0].key }]);
 const after = f.core.getSnapshot(); expect(f.saves() - saves).toBe(1); expect(after.modelRegistry!.entries.filter(r => r.route.provider === 'openrouter').every(r => r.userEnabled)).toBe(true); expect(after.modelRegistry!.defaults.stt).toBe(rows[0].key); expect(after.modelRegistry!.openRouterSTT).toEqual(before.modelRegistry!.openRouterSTT); expect(after.projects.find(p => p.id === id)).toEqual(before.projects.find(p => p.id === id)); expect(after.sttModelId).toBe(before.sttModelId); expect(f.calls).toHaveLength(1);
});
it('failed batch storage preserves the entire prior registry and reloads it unchanged', async () => {
 const f = await opened(); await f.core.discoverModels('openrouter', 'stt'); const before = f.core.getSnapshot().modelRegistry; const rows = f.core.getSnapshot().modelManagement!.rows.filter(r => r.metadata.compatible); f.failRegistry();
 await expect(apply(f.core, rows.map(r => ({ key: r.key, enabled: true })))).rejects.toMatchObject({ code: 'storage' }); expect(f.core.getSnapshot().modelRegistry).toEqual(before);
 await f.core.lock(); await f.core.unlock(secret); expect(f.core.getSnapshot().modelRegistry).toEqual(before);
});
it('persists explicitly unchecked new recommendations without selecting them again on reload', async () => {
 const f = await opened(); await f.core.discoverModels('openrouter', 'stt'); const row = f.core.getSnapshot().modelManagement!.rows.find(r => r.metadata.compatible)!;
 await apply(f.core, [{ key: row.key, enabled: false }]); expect(f.core.getSnapshot().modelManagement!.rows.find(r => r.key === row.key)).toMatchObject({ status: 'current', userEnabled: false }); await f.core.lock(); await f.core.unlock(secret); expect(f.core.getSnapshot().modelRegistry!.entries.find(e => e.route.modelId === row.route.modelId)?.userEnabled).toBe(false);
});
it('rejects unsupported, duplicate, unknown and stale inputs before saving or granting consent', async () => {
 const f = await opened(); await f.core.discoverModels('openrouter', 'stt'); const management = f.core.getSnapshot().modelManagement!, supported = management.rows.find(r => r.metadata.compatible)!, unsupported = management.rows.find(r => !r.metadata.compatible)!; const saves = f.saves();
 for (const changes of [[{ key: unsupported.key, enabled: true }], [{ key: 'unknown', enabled: false }], [{ key: supported.key, enabled: true }, { key: supported.key, enabled: false }]]) await expect(apply(f.core, changes)).rejects.toMatchObject({ code: 'invalid-input' });
 await f.core.saveKey('openrouter', 'TEST_ONLY_CHANGED_KEY', 'session'); await expect(apply(f.core, [{ key: supported.key, enabled: true }], undefined, management.revision)).rejects.toMatchObject({ code: 'invalid-input' }); expect(f.saves()).toBe(saves); expect(f.core.getSnapshot().minutesConsentToken).toBeNull();
 await f.core.lock(); await expect(management.onApplySelection!({ baseRevision: management.revision!, changes: [] })).rejects.toMatchObject({ code: 'permission' }); expect(f.core.getSnapshot().modelManagement).toBeNull();
});

it('fences a pending atomic Apply when vault ownership is released and ignores the late receipt', async () => {
 const f = await opened(); await f.core.discoverModels('openrouter', 'stt'); const row = f.core.getSnapshot().modelManagement!.rows.find(r => r.metadata.compatible)!; const before = f.core.getSnapshot().modelRegistry;
 let reached!: () => void, release!: () => void; const waiting = new Promise<void>(r => { reached = r; }), gate = new Promise<void>(r => { release = r; }); f.holdSave(async () => { reached(); await gate; });
 const pending = apply(f.core, [{ key: row.key, enabled: true }]), rejected = expect(pending).rejects.toThrow(); await waiting;
 await f.session.lock('manual'); release(); await rejected; expect(f.core.getSnapshot()).toMatchObject({ session: 'locked', modelManagement: null, modelRegistry: null, keySaveAttempts: {}, minutesConsentToken: null });
 await f.core.unlock(secret); expect(f.core.getSnapshot().modelRegistry).toEqual(before);
});
it('rejects duplicate default stages and metadata refresh revisions, while permitting blocked saved removal', async () => {
 const f = await opened(); await f.core.discoverModels('openrouter', 'stt'); const row = f.core.getSnapshot().modelManagement!.rows.find(r => r.metadata.compatible)!;
 await apply(f.core, [{ key: row.key, enabled: true }]); const old = f.core.getSnapshot().modelManagement!;
 await expect(apply(f.core, [], [{ stage: 'stt', key: row.key }, { stage: 'stt', key: row.key }])).rejects.toMatchObject({ code: 'invalid-input' });
 await f.core.discoverModels('openrouter', 'stt'); await expect(old.onApplySelection!({ baseRevision: old.revision!, changes: [{ key: row.key, enabled: false }] })).rejects.toMatchObject({ code: 'invalid-input' });
 await f.core.lock(); await f.core.unlock(secret); const restored = f.core.getSnapshot().modelManagement!.rows.find(r => r.key === row.key)!;
 await apply(f.core, [{ key: restored.key, enabled: false }]); expect(f.core.getSnapshot().modelRegistry!.entries.find(e => e.route.modelId === row.route.modelId)?.userEnabled).toBe(false);
});

it('endpoint-only refresh updates saved price evidence and blocks activation until distinct metadata acceptance', async () => {
 const f = await opened(); await f.core.discoverModels('openrouter', 'minutes'); const candidate = f.core.getSnapshot().modelManagement!.rows.find(r => r.mayLoadEndpoints)!; await f.core.loadModelEndpoints(candidate.route); const exact = f.core.getSnapshot().modelManagement!.rows.find(r => r.route.endpointTag === endpoint.tag)!;
 await apply(f.core, [{ key: exact.key, enabled: true }]); const accepted = f.core.getSnapshot().modelRegistry!.entries[0].acceptedMetadata;
 f.changeEndpoint(); await f.core.loadModelEndpoints(candidate.route); const changed = f.core.getSnapshot().modelManagement!.rows.find(r => r.key === exact.key)!;
 expect(changed.metadata.pricing.snapshot!.rates.find(rate => rate.unit === 'text-input-token')!.price).toBe(9); expect(changed).toMatchObject({ metadataAcceptanceRequired: true, blockedReason: 'metadata-changed' }); expect(f.core.getSnapshot().modelRegistry!.entries[0].acceptedMetadata).toEqual(accepted);
 await expect(apply(f.core, [{ key: exact.key, enabled: true }])).rejects.toMatchObject({ code: 'invalid-input' }); await apply(f.core, [{ key: exact.key, enabled: false }]); await f.core.acceptModelMetadata(exact.key, f.core.getSnapshot().modelManagement!.revision!); await apply(f.core, [{ key: exact.key, enabled: true }]); expect(f.core.getSnapshot().modelRegistry!.openRouterSTT).toBeUndefined(); expect(f.core.getSnapshot().modelManagement!.rows.find(r => r.key === exact.key)?.metadataAcceptanceRequired).toBe(false);
});
it('failed saved-endpoint refresh preserves prior price evidence and the durable preferences', async () => {
 const f = await opened(); await f.core.discoverModels('openrouter', 'minutes'); const candidate = f.core.getSnapshot().modelManagement!.rows.find(r => r.mayLoadEndpoints)!; await f.core.loadModelEndpoints(candidate.route); const exact = f.core.getSnapshot().modelManagement!.rows.find(r => r.route.endpointTag === endpoint.tag)!; await apply(f.core, [{ key: exact.key, enabled: true }]); const before = f.core.getSnapshot().modelRegistry;
 f.changeEndpoint(); f.failRegistry(); await expect(f.core.loadModelEndpoints(candidate.route)).rejects.toMatchObject({ code: 'storage' }); expect(f.core.getSnapshot().modelRegistry).toEqual(before); expect(f.core.getSnapshot().modelManagement!.rows.find(r => r.key === exact.key)?.metadata.pricing).toEqual(exact.metadata.pricing);
 await f.core.lock(); await f.core.unlock(secret); expect(f.core.getSnapshot().modelRegistry).toEqual(before);
});
it('rejects an outdated acceptance callback after a second metadata refresh before any registry save', async () => {
 const f = await opened(); await f.core.discoverModels('openrouter', 'minutes'); const candidate = f.core.getSnapshot().modelManagement!.rows.find(row => row.mayLoadEndpoints)!;
 await f.core.loadModelEndpoints(candidate.route); const exact = f.core.getSnapshot().modelManagement!.rows.find(row => row.route.endpointTag === endpoint.tag)!;
 await apply(f.core, [{ key: exact.key, enabled: true }]);
 f.changeEndpoint(); await f.core.loadModelEndpoints(candidate.route); const reviewed = f.core.getSnapshot().modelManagement!;
 expect(reviewed.rows.find(row => row.key === exact.key)?.metadataAcceptanceRequired).toBe(true);
 f.changeEndpoint('0.000013'); await f.core.loadModelEndpoints(candidate.route); const before = f.core.getSnapshot().modelRegistry, saves = f.saves();
 await expect(f.core.acceptModelMetadata(exact.key, reviewed.revision!)).rejects.toMatchObject({ code: 'invalid-input' });
 reviewed.onAcceptMetadata!(exact.key, reviewed.revision!); await vi.waitFor(() => expect(f.core.getSnapshot().busy).toBe(false));
 await expect(f.core.acceptModelMetadata(exact.key, NaN)).rejects.toMatchObject({ code: 'invalid-input' });
 expect(f.saves()).toBe(saves); expect(f.core.getSnapshot().modelRegistry).toEqual(before);
 await f.core.acceptModelMetadata(exact.key, f.core.getSnapshot().modelManagement!.revision!);
 expect(f.saves()).toBe(saves + 1); const entry = f.core.getSnapshot().modelRegistry!.entries.find(row => row.route.endpointTag === endpoint.tag)!;
 expect(entry.acceptedMetadata?.pricing.snapshot!.rates.find(rate => rate.unit === 'text-input-token')!.price).toBe(13);
 expect(entry.userEnabled).toBe(true); expect(f.core.getSnapshot().modelRegistry!.defaults).toEqual(before!.defaults); expect(f.core.getSnapshot().modelRegistry!.openRouterSTT).toEqual(before!.openRouterSTT);
});
it('publishes actionable endpoint failure with no automatic retry or saved preference replacement', async () => {
 const f = await opened(); await f.core.discoverModels('openrouter', 'minutes'); const candidate = f.core.getSnapshot().modelManagement!.rows.find(row => row.mayLoadEndpoints)!; const before = f.core.getSnapshot().modelRegistry;
 f.endpointResult('failed'); await expect(f.core.loadModelEndpoints(candidate.route)).rejects.toThrow();
 expect(f.core.getSnapshot().modelManagement!.error).toEqual(expect.stringMatching(/could not be loaded|failed|불러오지 못|실패/i)); expect(f.core.getSnapshot().modelManagement!.error).not.toContain('PRIVATE_UPSTREAM'); expect(f.core.getSnapshot().modelRegistry).toEqual(before); expect(f.calls).toHaveLength(2);
});
it('reports an empty endpoint catalog truthfully and allows an explicit retry', async () => {
 const f = await opened(); await f.core.discoverModels('openrouter', 'minutes'); const candidate = f.core.getSnapshot().modelManagement!.rows.find(row => row.mayLoadEndpoints)!;
 f.endpointResult('empty'); await f.core.loadModelEndpoints(candidate.route); expect(f.core.getSnapshot().modelManagement!.statusText).toMatch(/no supported endpoint|지원.*엔드포인트/i);
 expect(f.core.getSnapshot().modelManagement!.rows.some(row => row.route.endpointTag)).toBe(false); f.endpointResult('valid'); await f.core.loadModelEndpoints(candidate.route); expect(f.core.getSnapshot().modelManagement!.rows.some(row => row.route.endpointTag === endpoint.tag)).toBe(true); expect(f.calls).toHaveLength(3);
});
it('uses an explicitly confirmed exact text default for new meetings while preserving existing meetings and consent', async () => {
 const f = await opened(), oldId = await f.core.createMeeting(); await f.core.discoverModels('openrouter', 'minutes'); const candidate = f.core.getSnapshot().modelManagement!.rows.find(row => row.mayLoadEndpoints)!; await f.core.loadModelEndpoints(candidate.route);
 const before = f.core.getSnapshot(), exact = before.modelManagement!.rows.find(row => row.route.endpointTag === endpoint.tag)!;
 await apply(f.core, [{ key: exact.key, enabled: true }], [{ stage: 'minutes', key: exact.key }]);
 expect(f.core.getSnapshot().projects.find(project => project.id === oldId)).toEqual(before.projects.find(project => project.id === oldId)); expect(f.core.getSnapshot().minutesConsentToken).toBeNull();
 const newId = await f.core.createMeeting(), meeting = f.core.getSnapshot().projects.find(project => project.id === newId)!;
 expect(meeting.minutesSettings.modelId).toBe(textModel.id); expect((meeting as { minutesEndpointTag?: string }).minutesEndpointTag).toBe(endpoint.tag); expect(f.core.getSnapshot().modelRegistry!.openRouterSTT).toEqual(before.modelRegistry!.openRouterSTT); expect(f.calls).toHaveLength(2);
 await f.core.lock(); await f.core.unlock(secret); expect(f.core.getSnapshot().modelRegistry!.defaults.minutes).toBe(exact.key); expect(f.calls).toHaveLength(2);
});
