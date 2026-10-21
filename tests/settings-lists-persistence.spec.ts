import { afterEach, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { cancelJobs, createJobContext } from '../src/react-app/domain/jobs';
import { createVaultSession, type VaultSession } from '../src/react-app/vault/session';
import { openVaultDatabase, readHeader } from '../src/react-app/vault/store';
import { defaultSelectionLists } from '../src/react-app/settings/lists';
import type { MeetingProject } from '../src/react-app/domain/types';
const phrase = 'synthetic lists storage fixture phrase', sessions: VaultSession[] = [];
const custom = () => ({ icons: ['headphones', 'mic'], colors: ['#123456'], languages: [{ code: 'fr', name: 'PRIVATE_LANGUAGE_LABEL' }] });
const project = (): MeetingProject => ({ id: crypto.randomUUID(), title: 'SYNTHETIC_LISTS_PROJECT', icon: 'mic', color: '#ABCDEF', pinned: false, createdAt: '2026-10-17T00:00:00Z', updatedAt: '2026-10-17T00:00:00Z', sourceAssets: [], audioOptions: { chunkMinutes: 5, overlapSeconds: 5, expectedLanguages: ['sw', 'en'], bitrateKbps: 32, sampleRateHz: 16000 }, preparedChunks: [], rawTranscripts: [], transcriptVersions: [], selectedTranscriptVersionId: null, minutesSettings: { outputLanguage: 'ko', sections: [], instructions: '', modelId: '' }, minutesRuns: [], minutesRevisions: [], selectedMinutesRevisionId: null, runs: [] });
afterEach(async () => { vi.restoreAllMocks(); for (const s of sessions.splice(0)) await s.dispose(); cancelJobs(); });
async function fixture() {
  const indexedDB = new IDBFactory(), databaseName = crypto.randomUUID(), held = new Set<string>();
  const options = { indexedDB, databaseName, testOnlyOwnership: { acquire: async (name: string) => { if (held.has(name)) return null; held.add(name); return () => { held.delete(name); }; } } };
  const s = createVaultSession(options); sessions.push(s); await s.create(phrase, phrase); return { s, options };
}
it('uses defaults for old absence and encrypts a detached list snapshot through reload', async () => {
  const { s, options } = await fixture();
  expect(await s.loadSelectionLists(createJobContext())).toEqual(defaultSelectionLists);
  const lists = custom(), expected = custom(); const saving = s.saveSelectionLists(lists, createJobContext()); lists.languages[0].name = 'MUTATED'; await saving;
  const db = await openVaultDatabase(options.indexedDB, options.databaseName);
  const records = await new Promise<unknown[]>((resolve, reject) => { const request = db.transaction('records').objectStore('records').getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); db.close();
  expect(JSON.stringify(records)).not.toContain('PRIVATE_LANGUAGE_LABEL'); expect(JSON.stringify(records)).not.toContain('selectionLists');
  await s.dispose(); const fresh = createVaultSession(options); sessions.push(fresh); await fresh.unlock(phrase);
  expect(await fresh.loadSelectionLists(createJobContext())).toEqual(expected);
});
it('preserves project selections and registry across interleaved catalog writes and default reset', async () => {
  const { s } = await fixture(), p = project(), job = createJobContext();
  const registry = { version: 1 as const, entries: [], defaults: { stt: null, minutes: null }, lastCheckedAt: null };
  await Promise.all([s.saveSelectionLists(custom(), job), s.store.checkpoint({ project: p, runId: null, audioRecords: [] }, job), s.saveModelRegistry(registry, job)]);
  expect(await s.loadSelectionLists(job)).toEqual(custom()); expect(await s.loadModelRegistry(job)).toEqual(registry); expect(await s.store.readProject(p.id, job)).toEqual(p);
  await s.saveSelectionLists(defaultSelectionLists, job); await s.lock('manual'); await s.unlock(phrase);
  expect(await s.loadSelectionLists(createJobContext())).toEqual(defaultSelectionLists);
  expect(await s.store.readProject(p.id, createJobContext())).toEqual(p);
});
it('rejects invalid input before nonce reservation or replacing saved values', async () => {
  const { s, options } = await fixture(), db = await openVaultDatabase(options.indexedDB, options.databaseName), before = (await readHeader(db))!;
  await expect(s.saveSelectionLists({ ...custom(), colors: [] }, createJobContext())).rejects.toThrow();
  expect((await readHeader(db))!.operations).toBe(before.operations); db.close();
  expect(await s.loadSelectionLists(createJobContext())).toEqual(defaultSelectionLists);
});
it('retains the prior list on quota failure, then saves the accepted replacement through lock retry', async () => {
  const { s } = await fixture(), old = defaultSelectionLists; await s.saveSelectionLists(old, createJobContext());
  const native = IDBObjectStore.prototype.put;
  const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) { if (this.name === 'records') { this.transaction.abort(); throw new DOMException('synthetic quota', 'QuotaExceededError'); } return native.apply(this, args); });
  await expect(s.saveSelectionLists(custom(), createJobContext())).rejects.toThrow();
  expect(await s.loadSelectionLists(createJobContext())).toEqual(old);
  await expect(s.lock('manual')).rejects.toThrow(); expect(s.state).toBe('lock-save-failed');
  spy.mockRestore(); await s.retryLock(); await s.unlock(phrase);
  expect(await s.loadSelectionLists(createJobContext())).toEqual(custom());
});
it('admits completed list changes synchronously before an immediate lock and fences the late public receipt', async () => {
  const { s } = await fixture();
  const saving = s.saveSelectionLists(custom(), createJobContext()), rejected = expect(saving).rejects.toThrow();
  await s.lock('manual'); await rejected; await s.unlock(phrase);
  expect(await s.loadSelectionLists(createJobContext())).toEqual(custom());
});
it('fences writes without ownership and cannot leak a decrypting read after lock', async () => {
  const { s, options } = await fixture(), other = createVaultSession(options); sessions.push(other);
  await expect(other.unlock(phrase)).rejects.toThrow(); await expect(other.saveSelectionLists(custom(), createJobContext())).rejects.toThrow();
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
  const native = crypto.subtle.decrypt.bind(crypto.subtle);
  vi.spyOn(crypto.subtle, 'decrypt').mockImplementation(async (...args) => { const result = await native(...args); entered(); await gate; return result; });
  const reading = s.loadSelectionLists(createJobContext()), rejected = expect(reading).rejects.toThrow(); await started;
  const locking = s.lock('manual'); release(); await rejected; await locking;
  expect(s.state).toBe('locked');
});

it('rejects present malformed decoded catalog lists instead of silently using defaults', async () => {
  const { s } = await fixture(), native = crypto.subtle.decrypt.bind(crypto.subtle);
  for (const malformed of [null, { version: 2 }, { version: 1, colors: [] }]) {
    const spy = vi.spyOn(crypto.subtle, 'decrypt').mockImplementation(async (...args) => {
      const result = await native(...args), value = JSON.parse(new TextDecoder().decode(result));
      if (value.kind !== 'catalog') return result;
      return new TextEncoder().encode(JSON.stringify({ ...value, selectionLists: malformed })).buffer;
    });
    await expect(s.loadSelectionLists(createJobContext())).rejects.toThrow(); spy.mockRestore();
  }
  expect(await s.loadSelectionLists(createJobContext())).toEqual(defaultSelectionLists);
});
