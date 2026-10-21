import { afterEach, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore, IDBDatabase } from 'fake-indexeddb';
import { cancelJobs, createJobContext } from '../src/react-app/domain/jobs';
import { createVaultSession, type VaultSession } from '../src/react-app/vault/session';
import type { MeetingProject, ModelRegistry } from '../src/react-app/domain/types';
import { openVaultDatabase, readHeader } from '../src/react-app/vault/store';
import type { RecordEnvelope } from '../src/react-app/vault/crypto';
import { emptyModelRegistry, mergeModelRegistry, observeSTTRoute, registryRouteKey, setRegistryAlias, setRegistryDefault, setRegistryEnabled } from '../src/react-app/providers/model-registry';
import { STT_MODELS } from '../src/react-app/providers/catalog';

const secret = 'synthetic model registry test phrase', sessions: VaultSession[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const session of sessions.splice(0)) await session.dispose(); cancelJobs(); });
const empty = (): ModelRegistry => ({ version: 1, entries: [], defaults: { stt: null, minutes: null }, lastCheckedAt: null });
function project(): MeetingProject { return { id: crypto.randomUUID(), title: 'SYNTHETIC_REGISTRY_PROJECT', icon: 'mic', color: 'cobalt', pinned: false, createdAt: '2026-10-02T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z', sourceAssets: [], preparedChunks: [], audioOptions: { chunkMinutes: 5, overlapSeconds: 5, expectedLanguages: ['ko'], bitrateKbps: 32, sampleRateHz: 16000 }, rawTranscripts: [], transcriptVersions: [], selectedTranscriptVersionId: null, minutesSettings: { outputLanguage: 'fr-CA', sections: ['summary'], instructions: '', modelId: '' }, minutesRuns: [], minutesRevisions: [], selectedMinutesRevisionId: null, runs: [] }; }
async function fixture(capturePending?: () => readonly { project: MeetingProject; runId: null; audioRecords: [] }[]) {
  const factory = new IDBFactory(), databaseName = crypto.randomUUID(), options = { indexedDB: factory, databaseName, capturePending, testOnlyOwnership: { acquire: async () => () => {} } };
  const session = createVaultSession(options); sessions.push(session); await session.create(secret, secret);
  expect(session.saveModelRegistry, 'unlocked session exposes encrypted registry writes').toBeTypeOf('function');
  return { session, factory, databaseName, options };
}
it('loads legacy absence and durably saves an encrypted registry for a fresh session', async () => {
  const factory = new IDBFactory(), databaseName = crypto.randomUUID(), options = { indexedDB: factory, databaseName, testOnlyOwnership: { acquire: async () => () => {} } };
  const session = createVaultSession(options); sessions.push(session); await session.create(secret, secret);
  expect(session.loadModelRegistry, 'unlocked session exposes encrypted model registry').toBeTypeOf('function');
  expect(await session.loadModelRegistry(createJobContext())).toBeNull();
  const registry = { version: 1 as const, entries: [], defaults: { stt: null, minutes: null }, lastCheckedAt: null };
  await session.saveModelRegistry(registry, createJobContext()); await session.dispose();
  const fresh = createVaultSession(options); sessions.push(fresh); await fresh.unlock(secret);
  expect(await fresh.loadModelRegistry(createJobContext())).toEqual(registry);
});
it('preserves registry on project creation/checkpoint/delete and current directory on interleaved registry saves', async () => {
  const { session } = await fixture(), first = project(), second = project(), job = createJobContext(), a = { ...empty(), lastCheckedAt: '2026-10-02T01:00:00Z' }, b = { ...empty(), lastCheckedAt: '2026-10-02T02:00:00Z' };
  await session.store.checkpoint({ project: first, runId: null, audioRecords: [] }, job);
  await Promise.all([session.saveModelRegistry(a, job), session.store.checkpoint({ project: second, runId: null, audioRecords: [] }, job), session.saveModelRegistry(b, job)]);
  expect((await session.store.listProjects(job)).map(p => p.id)).toEqual([first.id, second.id]); expect(await session.loadModelRegistry(job)).toEqual(b);
  await session.store.checkpoint({ project: { ...first, title: 'LATEST_PROJECT_TITLE' }, runId: null, audioRecords: [] }, job); await session.store.deleteProject(second.id, job);
  await session.lock('manual'); await session.unlock(secret); expect(await session.loadModelRegistry(createJobContext())).toEqual(b); expect((await session.store.listProjects(createJobContext())).map(p => p.title)).toEqual(['LATEST_PROJECT_TITLE']);
});
it('snapshots caller choices and keeps the prior encrypted preference after a quota transaction failure', async () => {
  const { session, factory, databaseName } = await fixture(), old = empty(), job = createJobContext(); await session.saveModelRegistry(old, job);
  const db = await openVaultDatabase(factory, databaseName), header = (await readHeader(db))!, native = IDBObjectStore.prototype.put;
  const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, ...args: [key?: IDBValidKey]) { if (this.name === 'records' && (value as RecordEnvelope).recordId === header.vaultId) { this.transaction.abort(); throw new DOMException('SYNTHETIC_QUOTA', 'QuotaExceededError'); } return native.call(this, value, ...args); });
  await expect(session.saveModelRegistry({ ...old, lastCheckedAt: '2026-10-02T02:00:00Z' }, job)).rejects.toThrow(); spy.mockRestore(); expect(await session.loadModelRegistry(job)).toEqual(old); expect((await readHeader(db))!.operations).toBeGreaterThan(header.operations); db.close();
  const mutable = { ...empty(), lastCheckedAt: '2026-10-02T03:00:00Z' }, pending = session.saveModelRegistry(mutable, job); mutable.lastCheckedAt = '2026-10-02T04:00:00Z'; await pending;
  expect((await session.loadModelRegistry(job))?.lastCheckedAt).toBe('2026-10-02T03:00:00Z');
});
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
it('lock during native encryption fences the pending save and clears its plaintext after draining', async () => {
  const { session } = await fixture(), old = empty(); await session.saveModelRegistry(old, createJobContext());
  const entered = deferred(), release = deferred(), native = crypto.subtle.encrypt.bind(crypto.subtle); let held: Uint8Array | undefined;
  vi.spyOn(crypto.subtle, 'encrypt').mockImplementation(async (...args) => { const result = await native(...args); if (new TextDecoder().decode(args[2]).includes('2026-10-02T05:00:00Z')) { held = args[2] as Uint8Array; entered.resolve(); await release.promise; } return result; });
  const pending = session.saveModelRegistry({ ...old, lastCheckedAt: '2026-10-02T05:00:00Z' }, createJobContext()), rejected = expect(pending).rejects.toThrow(); await entered.promise; const locking = session.lock('manual'); release.resolve(); await rejected; await locking;
  expect(held!.every(value => value === 0)).toBe(true); await expect(session.loadModelRegistry(createJobContext())).rejects.toThrow(); await expect(session.saveModelRegistry(old, createJobContext())).rejects.toThrow();
  await session.unlock(secret); expect(await session.loadModelRegistry(createJobContext())).toEqual(old);
});
it('retains a committed preference when lock fences its receipt and saves a captured project', async () => {
  let captured: MeetingProject | undefined; const { session } = await fixture(() => captured ? [{ project: captured, runId: null, audioRecords: [] }] : []), p = project();
  await session.store.checkpoint({ project: p, runId: null, audioRecords: [] }, createJobContext()); captured = { ...p, title: 'CAPTURED_LATEST_TITLE' };
  const native = IDBDatabase.prototype.transaction; let locking: Promise<void> | undefined;
  const spy = vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (this: IDBDatabase, ...args: Parameters<IDBDatabase['transaction']>) { const tx = native.apply(this, args); if (args[1] === 'readwrite' && Array.isArray(args[0]) && args[0].includes('records') && !args[0].includes('nonces')) tx.addEventListener('complete', () => { locking ??= session.lock('manual'); }, { once: true }); return tx; });
  const committed = { ...empty(), lastCheckedAt: '2026-10-02T06:00:00Z' }; await expect(session.saveModelRegistry(committed, createJobContext())).rejects.toThrow(); await locking; spy.mockRestore(); captured = undefined; await session.unlock(secret);
  expect(await session.loadModelRegistry(createJobContext())).toEqual(committed); expect((await session.store.readProject(p.id, createJobContext()))?.title).toBe('CAPTURED_LATEST_TITLE');
});
it('persists nonempty aliases and exact defaults only inside authenticated ciphertext', async () => {
  const { session, factory, databaseName } = await fixture(), model = STT_MODELS[0], route = { connectionId: 'synthetic-openai', provider: 'openai' as const, stage: 'stt' as const, modelId: model.id, endpointTag: null }, key = registryRouteKey(route);
  const observed = mergeModelRegistry(emptyModelRegistry(), { connectionId: route.connectionId, stage: 'stt', status: 'success', observations: [observeSTTRoute(route, model)], checkedAt: '2026-10-02T00:00:00Z' });
  const registry = setRegistryAlias(setRegistryDefault(setRegistryEnabled(observed, key, true), 'stt', key), key, 'PRIVATE_ENCRYPTED_REGISTRY_ALIAS');
  await session.saveModelRegistry(registry, createJobContext());
  const db = await openVaultDatabase(factory, databaseName), records = await new Promise<unknown[]>((resolve, reject) => { const request = db.transaction('records').objectStore('records').getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); db.close();
  expect(JSON.stringify(records)).not.toContain('PRIVATE_ENCRYPTED_REGISTRY_ALIAS'); expect(JSON.stringify(records)).not.toContain(route.connectionId);
  await session.lock('manual'); await session.unlock(secret);
  const loaded = (await session.loadModelRegistry(createJobContext()))!;
  expect(loaded).toEqual(registry); expect(Object.isFrozen(loaded.entries[0].acceptedMetadata)).toBe(true);
});
it('drains a decrypting registry read before releasing ownership and rejects the late plaintext result', async () => {
  const { session } = await fixture(); await session.saveModelRegistry(empty(), createJobContext());
  const entered = deferred(), release = deferred(), native = crypto.subtle.decrypt.bind(crypto.subtle); let held: Uint8Array | undefined;
  vi.spyOn(crypto.subtle, 'decrypt').mockImplementation(async (...args) => { const result = await native(...args); held = new Uint8Array(result); entered.resolve(); await release.promise; return result; });
  const reading = session.loadModelRegistry(createJobContext()), rejected = expect(reading).rejects.toThrow(); await entered.promise;
  const locking = session.lock('manual'); expect(session.state).toBe('locking'); release.resolve(); await rejected; await locking;
  expect(session.state).toBe('locked'); expect(held!.every(value => value === 0)).toBe(true);
});
it('rejects an invalid preference before reserving a nonce or replacing prior ciphertext', async () => {
  const { session, factory, databaseName } = await fixture(); await session.saveModelRegistry(empty(), createJobContext());
  const db = await openVaultDatabase(factory, databaseName), before = (await readHeader(db))!;
  await expect(session.saveModelRegistry({ ...empty(), key: 'SYNTHETIC_FORBIDDEN_FIELD' } as unknown as ModelRegistry, createJobContext())).rejects.toThrow();
  expect((await readHeader(db))!.operations).toBe(before.operations); db.close(); expect(await session.loadModelRegistry(createJobContext())).toEqual(empty());
});

it('OR_STT_registry policy acknowledgment survives encrypted reload and stays out of persisted envelopes', async () => {
  const { session, factory, databaseName, options } = await fixture();
  const registry: ModelRegistry = { ...empty(), openRouterSTT: { 'SYNTHETIC_PRIVATE_CONNECTION': { policy: { dataCollection: 'deny', requireZdr: false }, acknowledgedDisclosureVersion: 'or-stt-1', initialDefaultApplied: false } } };
  await session.saveModelRegistry(registry, createJobContext());
  const db = await openVaultDatabase(factory, databaseName), records = await new Promise<unknown[]>((resolve, reject) => { const request = db.transaction('records').objectStore('records').getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); db.close();
  expect(JSON.stringify(records)).not.toContain('SYNTHETIC_PRIVATE_CONNECTION'); expect(JSON.stringify(records)).not.toContain('acknowledgedDisclosureVersion');
  await session.dispose(); const fresh = createVaultSession(options); sessions.push(fresh); await fresh.unlock(secret);
  expect(await fresh.loadModelRegistry(createJobContext())).toEqual(registry);
});
it('OR_STT_registry legacy absence reloads without inventing policy acknowledgment', async () => {
  const { session } = await fixture(); await session.saveModelRegistry(empty(), createJobContext()); await session.lock('manual'); await session.unlock(secret);
  expect((await session.loadModelRegistry(createJobContext()))!.openRouterSTT).toBeUndefined();
});
