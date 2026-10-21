import { afterEach, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { cancelJobs, createJobContext } from '../src/react-app/domain/jobs';
import type { JobContext } from '../src/react-app/domain/types';
import { createVaultSession, type VaultSession } from '../src/react-app/vault/session';
import { decryptRecord, encryptRecord, unwrapHeader, type RecordEnvelope, type VaultHeader } from '../src/react-app/vault/crypto';

type ScreenState = Readonly<{ version: 1; autoLockSeconds: 60 | 180 | 300 | 600 | 1800 | 3600 | null; lockWorkPolicy?: 'standard' | 'strict'; restore?: { screen: string; selectedProjectId: string | null; settingsTab: string; drafts: Record<string, unknown> } }>;
type ScreenSession = VaultSession & {
  loadScreenState(job: JobContext): Promise<ScreenState | null>;
  saveScreenState(value: ScreenState, job: JobContext): Promise<void>;
  verifyScreenPassphrase(secret: string): Promise<void>;
};
const phrase = 'SYNTHETIC screen state vault phrase';
const sessions: VaultSession[] = [];
function screenState(): ScreenState {
  return { version: 1, autoLockSeconds: 60, restore: { screen: 'minutes', selectedProjectId: 'SYNTHETIC_PRIVATE_PROJECT', settingsTab: 'security', drafts: { markdown: 'SYNTHETIC_PRIVATE_DRAFT_91c38e', nested: [null, true, 2, { text: '합성 편집 초안' }] } } };
}
async function fixture() {
  const factory = new IDBFactory(), name = crypto.randomUUID();
  const s = createVaultSession({ indexedDB: factory, databaseName: name, testOnlyOwnership: { acquire: async () => () => {} } }) as ScreenSession;
  sessions.push(s); await s.create(phrase, phrase);
  expect(s).toHaveProperty('loadScreenState', expect.any(Function));
  expect(s).toHaveProperty('saveScreenState', expect.any(Function));
  expect(s).toHaveProperty('verifyScreenPassphrase', expect.any(Function));
  return { s, factory, name };
}
async function database(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => { const r = factory.open(name); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}
async function rows<T>(db: IDBDatabase, store: string): Promise<T[]> {
  return new Promise((resolve, reject) => { const r = db.transaction(store).objectStore(store).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}
async function put(db: IDBDatabase, envelope: RecordEnvelope): Promise<void> {
  await new Promise<void>((resolve, reject) => { const tx = db.transaction('records', 'readwrite'); tx.objectStore('records').put(envelope); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
}
function holdNextDerivation() {
  let entered!: () => void, release!: () => void, held = false;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const original = crypto.subtle.deriveKey.bind(crypto.subtle);
  vi.spyOn(crypto.subtle, 'deriveKey').mockImplementation(async (...args) => {
    const key = await original(...args);
    if (!held) { held = true; entered(); await gate; }
    return key;
  });
  return { ready, release };
}
afterEach(async () => { vi.restoreAllMocks(); for (const s of sessions.splice(0)) await s.dispose(); cancelJobs(); });

it('treats an absent catalog screen state as absent without writing a default', async () => {
  const { s } = await fixture();
  expect(await s.loadScreenState(createJobContext())).toBeNull();
});

it('roundtrips every supported duration and detaches accepted drafts before the first await', async () => {
  const { s } = await fixture();
  for (const autoLockSeconds of [60, 180, 300, 600, 1800, 3600, null] as const) {
    const value = { ...screenState(), autoLockSeconds };
    const saving = s.saveScreenState(value, createJobContext());
    value.restore!.drafts.markdown = 'changed after admission';
    await saving;
    expect(await s.loadScreenState(createJobContext())).toEqual({ ...screenState(), autoLockSeconds });
  }
});

it.each(['standard', 'strict'] as const)('roundtrips the optional %s work policy through encrypted persistence', async lockWorkPolicy => {
  const { s, factory, name } = await fixture();
  const value = { ...screenState(), lockWorkPolicy };
  await s.saveScreenState(value, createJobContext());
  const db = await database(factory, name);
  const stored = await Promise.all(['header', 'records', 'nonces'].map(store => rows(db, store)));
  db.close();
  expect(JSON.stringify(stored, (_key, item) => item instanceof ArrayBuffer ? new TextDecoder().decode(item) : item)).not.toContain('lockWorkPolicy');
  await s.lock('manual'); await s.unlock(phrase);
  expect(await s.loadScreenState(createJobContext())).toEqual(JSON.parse(JSON.stringify(value)));
});

it('rejects unsupported work policies without replacing the prior state', async () => {
  const { s } = await fixture(); await s.saveScreenState(screenState(), createJobContext());
  for (const lockWorkPolicy of ['never', '', null, 0, undefined])
    await expect(s.saveScreenState({ ...screenState(), lockWorkPolicy } as ScreenState, createJobContext())).rejects.toThrow();
  expect(await s.loadScreenState(createJobContext())).toEqual(screenState());
});

it('keeps screen settings and draft sentinels out of every persisted store and restores them after reopening', async () => {
  const { s, factory, name } = await fixture();
  await s.saveScreenState(screenState(), createJobContext());
  const db = await database(factory, name);
  const stored = await Promise.all(['header', 'records', 'nonces'].map(store => rows(db, store)));
  db.close();
  const dump = JSON.stringify(stored, (_key, value) => value instanceof ArrayBuffer ? new TextDecoder().decode(value) : value);
  for (const sentinel of ['SYNTHETIC_PRIVATE_PROJECT', 'SYNTHETIC_PRIVATE_DRAFT_91c38e', '합성 편집 초안', 'autoLockSeconds', 'screenState', phrase]) expect(dump).not.toContain(sentinel);
  await s.lock('manual'); await s.unlock(phrase);
  expect(await s.loadScreenState(createJobContext())).toEqual(screenState());
});

it('rejects malformed and non-JSON screen states without replacing the prior saved value', async () => {
  const { s } = await fixture(); await s.saveScreenState(screenState(), createJobContext());
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  const getter = { get text() { throw new Error('must not evaluate an accessor'); } };
  const invalid = [null, {}, { version: 2, autoLockSeconds: 60 }, { version: 1, autoLockSeconds: 900 }, { version: 1, autoLockSeconds: NaN }, { version: 1, autoLockSeconds: 60, extra: true },
    { version: 1, autoLockSeconds: 60, restore: null }, { ...screenState(), restore: { ...screenState().restore, selectedProjectId: 7 } },
    ...[undefined, Infinity, new Date(), new Blob(['synthetic']), cycle, getter, () => 'text', Symbol('text'), new Array(1)].map(value => ({ ...screenState(), restore: { ...screenState().restore, drafts: { value } } }))];
  for (const value of invalid) await expect(s.saveScreenState(value as ScreenState, createJobContext())).rejects.toThrow();
  expect(await s.loadScreenState(createJobContext())).toEqual(screenState());
});

it('rejects sparse arrays even when an extra property masks the missing index', async () => {
  const { s } = await fixture();
  const value = screenState();
  value.restore!.drafts.maskedHole = Object.assign(new Array(1), { extra: 'synthetic' });
  await expect(s.saveScreenState(value, createJobContext())).rejects.toThrow();
  expect(await s.loadScreenState(createJobContext())).toBeNull();
  try { await expect(s.lock('manual')).resolves.toBeUndefined(); }
  finally { if (s.state === 'lock-save-failed') await s.discardPendingAndLock(); }
});

it('preserves the newest accepted screen state when immediate hard lock cancels both public writes', async () => {
  const { s } = await fixture();
  const first = s.saveScreenState({ version: 1, autoLockSeconds: 180 }, createJobContext()).catch(error => error);
  const latest = s.saveScreenState(screenState(), createJobContext()).catch(error => error);
  await s.lock('manual');
  expect(await first).toBeInstanceOf(Error); expect(await latest).toBeInstanceOf(Error);
  await s.unlock(phrase); expect(await s.loadScreenState(createJobContext())).toEqual(screenState());
});

it('retains screen drafts for the private lock finalizer after a storage write fails', async () => {
  const { s } = await fixture();
  const original = IDBObjectStore.prototype.put;
  const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, ...args: [key?: IDBValidKey]) {
    if (this.name === 'records') { this.transaction.abort(); throw new Error('synthetic storage failure'); }
    return original.call(this, value, ...args);
  });
  await expect(s.saveScreenState(screenState(), createJobContext())).rejects.toThrow(); spy.mockRestore();
  await s.lock('manual'); await s.unlock(phrase);
  expect(await s.loadScreenState(createJobContext())).toEqual(screenState());
});

it('fails closed for an authenticated catalog with a present malformed screen state', async () => {
  const { s, factory, name } = await fixture(), db = await database(factory, name);
  const [header] = await rows<VaultHeader>(db, 'header');
  const original = (await rows<RecordEnvelope>(db, 'records')).find(row => row.recordId === header.vaultId)!;
  const key = await unwrapHeader(phrase, header), bytes = await decryptRecord(key, header, header.vaultId, original);
  const catalog = JSON.parse(new TextDecoder().decode(bytes)); bytes.fill(0);
  try {
    await put(db, await encryptRecord(key, header, header.vaultId, new TextEncoder().encode(JSON.stringify({ ...catalog, screenState: null })), crypto.getRandomValues(new Uint8Array(12))));
    await expect(s.loadScreenState(createJobContext())).rejects.toThrow();
  } finally { await put(db, original); db.close(); }
});

it('rechecks correct or incorrect passphrases without changing jobs, keys, state or stored records', async () => {
  const { s, factory, name } = await fixture();
  await s.saveProviderKey('synthetic', 'SYNTHETIC_SESSION_KEY', 'session');
  const job = createJobContext(), db = await database(factory, name);
  const before = await Promise.all(['header', 'records', 'nonces'].map(store => rows(db, store)));
  await s.verifyScreenPassphrase(phrase);
  await expect(s.verifyScreenPassphrase('SYNTHETIC wrong screen phrase')).rejects.toThrow();
  expect(s.state).toBe('unlocked'); expect(() => job.assertActive()).not.toThrow();
  expect(await s.getProviderKey('synthetic')).toBe('SYNTHETIC_SESSION_KEY');
  expect(await Promise.all(['header', 'records', 'nonces'].map(store => rows(db, store)))).toEqual(before); db.close();
});

it('rejects a late passphrase result after hard lock and reactivation without harming the new owner job', async () => {
  const { s } = await fixture(), hold = holdNextDerivation();
  const checking = s.verifyScreenPassphrase(phrase).catch(error => error); await hold.ready;
  await s.lock('manual'); await s.unlock(phrase); const nextJob = createJobContext();
  hold.release(); expect(await checking).toBeInstanceOf(Error);
  expect(s.state).toBe('unlocked'); expect(() => nextJob.assertActive()).not.toThrow();
});

it('rejects a late passphrase result after reset without opening the discarded vault', async () => {
  const { s } = await fixture(), hold = holdNextDerivation();
  const checking = s.verifyScreenPassphrase(phrase).catch(error => error); await hold.ready;
  await s.reset(); hold.release(); expect(await checking).toBeInstanceOf(Error); expect(s.state).toBe('locked');
});

it('invalidates an in-progress screen check when the passphrase changes', async () => {
  const { s } = await fixture(), hold = holdNextDerivation();
  const checking = s.verifyScreenPassphrase(phrase).catch(error => error); await hold.ready;
  await s.changePassphrase(phrase, 'SYNTHETIC changed screen phrase', 'SYNTHETIC changed screen phrase');
  hold.release(); expect(await checking).toBeInstanceOf(Error);
  await expect(s.verifyScreenPassphrase(phrase)).rejects.toThrow();
  await s.verifyScreenPassphrase('SYNTHETIC changed screen phrase');
});

it('refuses screen data access or passphrase checks without an active vault owner', async () => {
  const { s } = await fixture(); await s.lock('manual');
  await expect(s.loadScreenState(createJobContext())).rejects.toThrow();
  await expect(s.saveScreenState(screenState(), createJobContext())).rejects.toThrow();
  await expect(s.verifyScreenPassphrase(phrase)).rejects.toThrow();
});
