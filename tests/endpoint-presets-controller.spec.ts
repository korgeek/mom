import { webcrypto } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeAll, expect, it } from 'vitest';
import { createMeetingController, type MeetingController } from '../src/react-app/controller';
import { createVaultSession } from '../src/react-app/vault/session';
const cores: MeetingController[] = [];
const candidates = [['openai/gpt-6-luna', 'openai'], ['google/gemini-3.8-flash', 'google-ai-studio'], ['anthropic/claude-opus-5.5', 'anthropic']];
const secret = 'TEST_ONLY endpoint preset vault phrase';
beforeAll(() => Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto }));
afterEach(async () => { for (const core of cores.splice(0)) await core.dispose(); });
async function fixture() {
 const calls: { url: string; authorization: string | null; method: string }[] = []; let fail = false, saves = 0, forbidKeyRead = false;
 const core = createMeetingController({ indexedDB: new IDBFactory(), databaseName: crypto.randomUUID(), fetch: async (url, init) => {
  calls.push({ url: String(url), authorization: new Headers(init?.headers).get('Authorization'), method: init?.method ?? 'GET' });
  if (fail) throw new Error('TEST_ONLY_PRIVATE_UPSTREAM');
  const candidate = candidates.find(([id]) => String(url) === `https://openrouter.ai/api/v1/models/${id}/endpoints`);
  const body = candidate ? { data: { id: candidate[0], endpoints: [{ tag: candidate[1], context_length: 32000, max_prompt_tokens: null, max_completion_tokens: 4096, supported_parameters: ['max_tokens'] }] } } : { data: candidates.map(([id]) => ({ id, context_length: 32000, top_provider: { max_completion_tokens: 4096 }, supported_parameters: ['max_tokens'], architecture: { input_modalities: ['text'], output_modalities: ['text'] } })) };
  return new Response(JSON.stringify(body));
 }, sessionFactory: options => { const session = createVaultSession({ ...options, testOnlyOwnership: { acquire: async () => () => {} } }); return new Proxy(Object.create(session) as typeof session, { get(target, key) { if (key === 'saveModelRegistry') return async (...args: Parameters<typeof session.saveModelRegistry>) => { saves++; return session.saveModelRegistry(...args); }; if (key === 'getProviderKey') return (...args: Parameters<typeof session.getProviderKey>) => { if (forbidKeyRead) throw new Error('public metadata must not read saved keys'); return session.getProviderKey(...args); }; return Reflect.get(target, key); } }); } });
 cores.push(core); await core.initialize(); await core.createVault(secret); forbidKeyRead = true;
 return { core, calls, saves: () => saves, fail: () => { fail = true; }, allowActivation: () => { forbidKeyRead = false; } };
}
it('prepares only keyless public metadata, does not save a preference until Apply, and preserves rejection/default after reload', async () => {
 const f = await fixture(), before = f.core.getSnapshot().modelRegistry, saves = f.saves();
 await f.core.prepareModelSelection('openrouter');
 const rows = f.core.getSnapshot().modelManagement!.rows.filter(row => row.route.endpointTag);
 expect(rows).toHaveLength(3); expect(rows.every(row => row.metadata.compatible && row.metadata.limits.maxPromptTokens === null)).toBe(true);
 expect(f.core.getSnapshot().modelRegistry).toEqual(before); expect(f.saves()).toBe(saves);
 expect(f.calls).toHaveLength(4); expect(f.calls.every(call => call.method === 'GET' && call.authorization === null)).toBe(true);
 const gpt = rows.find(row => row.route.modelId === candidates[0][0])!;
 await f.core.applyModelSelection({ baseRevision: f.core.getSnapshot().modelManagement!.revision!, changes: rows.map(row => ({ key: row.key, enabled: row === gpt })), defaultChanges: [{ stage: 'minutes', key: gpt.key }] });
 expect(f.saves()).toBe(saves + 1); expect(f.core.getSnapshot().minutesConsentToken).toBeNull();
 await f.core.lock(); f.allowActivation(); await f.core.unlock(secret); await f.core.prepareModelSelection('openrouter');
 expect(f.calls).toHaveLength(4); expect(f.core.getSnapshot().modelRegistry!.entries.filter(entry => entry.userEnabled)).toHaveLength(1); expect(f.core.getSnapshot().modelRegistry!.defaults.minutes).toBe(gpt.key);
});
it('clears an unsaved old recommendation on failed preparation and reports explicit retry without private details', async () => {
 const f = await fixture(); await f.core.prepareModelSelection('openrouter'); const before = f.core.getSnapshot().modelRegistry; f.fail();
 await expect(f.core.prepareModelSelection('openrouter')).rejects.toThrow();
 expect(f.core.getSnapshot().modelManagement!.rows.some(row => row.route.endpointTag)).toBe(false);
 expect(f.core.getSnapshot().modelManagement!.error).toMatch(/retry|다시/i); expect(f.core.getSnapshot().modelManagement!.error).not.toContain('PRIVATE'); expect(f.core.getSnapshot().modelRegistry).toEqual(before);
});
