import { afterEach, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { cancelJobs } from '../src/react-app/domain/jobs';
import { createMeetingController, type MeetingController } from '../src/react-app/controller';
import { createVaultSession, type VaultSession } from '../src/react-app/vault/session';
import { defaultSelectionLists } from '../src/react-app/settings/lists';
const phrase = 'synthetic lists controller phrase', cores: MeetingController[] = [];
const custom = { icons: ['headphones', 'mic'], colors: ['#123456'], languages: [{ code: 'fr', name: 'French fixture' }] };
afterEach(async () => { vi.restoreAllMocks(); for (const core of cores.splice(0)) await core.dispose(); cancelJobs(); });
async function fixture(wrap?: (session: VaultSession) => VaultSession) {
  const core = createMeetingController({ indexedDB: new IDBFactory(), databaseName: crypto.randomUUID(), fetch: async () => { throw new Error('No external request expected'); }, sessionFactory: hooks => {
    const actual = createVaultSession({ ...hooks, testOnlyOwnership: { acquire: async () => () => {} } }); return wrap ? wrap(actual) : actual;
  } }); cores.push(core); await core.initialize(); await core.createVault(phrase); return core;
}
it('restores lists, updates only after saved receipt and preserves old/new meeting choices', async () => {
  const core = await fixture(); expect(core.getSnapshot().selectionLists).toEqual(defaultSelectionLists);
  const id = await core.createMeeting(); await core.updateMeeting(id, { color: '#ABCDEF' });
  const old = core.getSnapshot().projects[0];
  await core.getSnapshot().onSaveSelectionLists!(custom);
  expect(core.getSnapshot().selectionLists).toEqual(custom); expect(core.getSnapshot().projects[0]).toEqual(old);
  await core.lock(); expect(core.getSnapshot().selectionLists).toBeNull(); await core.unlock(phrase);
  expect(core.getSnapshot().selectionLists).toEqual(custom); expect(core.getSnapshot().projects[0]).toEqual(old);
  await core.createMeeting(); const next = core.getSnapshot().projects.find(p => p.id !== id)!;
  expect(next.color).toBe('#2B59C3'); expect(next.audioOptions.expectedLanguages).toEqual(['ko', 'en']);
});
it('admits a save before immediate lock without repopulating cleared settings', async () => {
  const core = await fixture(); const saving = core.saveSelectionLists(custom), rejected = expect(saving).rejects.toThrow();
  await core.lock(); await rejected; expect(core.getSnapshot().selectionLists).toBeNull();
  await core.unlock(phrase); expect(core.getSnapshot().selectionLists).toEqual(custom);
});
it('retains applied settings on storage failure and allows explicit retry', async () => {
  const core = await fixture(), native = IDBObjectStore.prototype.put;
  const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) { if (this.name === 'records') { this.transaction.abort(); throw new Error('synthetic quota'); } return native.apply(this, args); });
  await expect(core.saveSelectionLists(custom)).rejects.toThrow(); expect(core.getSnapshot().selectionLists).toEqual(defaultSelectionLists); expect(core.getSnapshot().busy).toBe(false);
  spy.mockRestore(); await core.saveSelectionLists(custom); expect(core.getSnapshot().selectionLists).toEqual(custom);
});
it('fences a delayed save receipt after lock and rejects saves while locked', async () => {
  let release!: () => void, saved!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), completed = new Promise<void>(resolve => { saved = resolve; });
  const core = await fixture(session => new Proxy(Object.create(session) as VaultSession, { get(target, key) { if (key === 'saveSelectionLists') return async (...args: Parameters<VaultSession['saveSelectionLists']>) => { await target.saveSelectionLists(...args); saved(); await gate; }; return Reflect.get(target, key); } }));
  const saving = core.saveSelectionLists(custom), rejected = expect(saving).rejects.toThrow(); await completed; await core.lock(); release(); await rejected;
  expect(core.getSnapshot().selectionLists).toBeNull(); await expect(core.saveSelectionLists(custom)).rejects.toThrow();
});
