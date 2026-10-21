// Real encrypted storage/session; all data and ownership are disposable synthetic fixtures.
import { webcrypto } from 'node:crypto';
import { File as NodeFile } from 'node:buffer';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createMeetingController, type MeetingController } from '../src/react-app/controller';
import { createVaultSession, type Ownership, type VaultSessionOptions } from '../src/react-app/vault/session';
import { openVaultDatabase } from '../src/react-app/vault/store';
import { cancelJobs } from '../src/react-app/domain/jobs';
import { createLocalMediaWorker } from '../src/react-app/media/worker';

const passphrase = 'synthetic frontend reset passphrase';
const active: MeetingController[] = [];
const cleanup: (() => void)[] = [];
beforeAll(() => { Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto }); });
afterEach(async () => {
  vi.restoreAllMocks();
  for (const release of cleanup.splice(0)) release();
  for (const core of active.splice(0)) await core.dispose();
  cancelJobs();
});
function ownership(): Ownership {
  const held = new Set<string>();
  return { async acquire(name) { if (held.has(name)) return null; held.add(name); return () => { held.delete(name); }; } };
}
function fixture(extra: { indexedDB?: IDBFactory; databaseName?: string; owner?: Ownership; sessionFactory?: (hooks: VaultSessionOptions) => ReturnType<typeof createVaultSession>; revoke?: (url: string) => void; fetch?: typeof globalThis.fetch } = {}) {
  const indexedDB = extra.indexedDB ?? new IDBFactory(), databaseName = extra.databaseName ?? crypto.randomUUID();
  const owner = extra.owner ?? ownership(), revoked: string[] = [];
  const core = createMeetingController({ indexedDB, databaseName,
    sessionFactory: hooks => (extra.sessionFactory ?? createVaultSession)({ ...hooks, testOnlyOwnership: owner }),
    fetch: extra.fetch ?? (async () => { throw new Error('Unexpected provider request in reset fixture'); }), mediaWorkerFactory: createLocalMediaWorker,
    objectUrls: { create: () => 'blob:synthetic-reset-source', revoke: url => { extra.revoke?.(url); revoked.push(url); } } });
  active.push(core); return { core, indexedDB, databaseName, owner, revoked };
}
async function opened(extra: Parameters<typeof fixture>[0] = {}) {
  const f = fixture(extra); await f.core.initialize(); await f.core.createVault(passphrase); return f;
}
function wav(): File {
  const bytes = new Uint8Array(44 + 32000), view = new DataView(bytes.buffer);
  for (const [at, value] of [[0, 'RIFF'], [8, 'WAVE'], [12, 'fmt '], [36, 'data']] as const) [...value].forEach((char, i) => { bytes[at + i] = char.charCodeAt(0); });
  view.setUint32(4, bytes.length - 8, true); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); view.setUint32(40, 32000, true);
  return new NodeFile([bytes], 'SYNTHETIC_RESET_AUDIO.wav', { type: 'audio/wav' }) as unknown as File;
}
async function counts(f: ReturnType<typeof fixture>) {
  const db = await openVaultDatabase(f.indexedDB, f.databaseName);
  try { return await Promise.all(['header', 'records', 'nonces'].map(name => new Promise<number>((resolve, reject) => {
    const request = db.transaction(name).objectStore(name).count(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  }))); } finally { db.close(); }
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }

describe('connected passwordless vault reset', () => {
  it('wires the final UI action to real reset while locked, without a passphrase', async () => {
    const f = await opened(); await f.core.createMeeting(); await f.core.lock();
    expect(typeof f.core.getSnapshot().onResetVault).toBe('function');
    f.core.getSnapshot().onResetVault!();
    await expect.poll(() => f.core.getSnapshot().session).toBe('new');
    expect(await counts(f)).toEqual([0, 0, 0]);
  });
  it('clears actual encrypted meetings/audio/keys, previews and model preferences before a fresh vault', async () => {
    const f = await opened(), id = await f.core.createMeeting();
    await f.core.updateMeeting(id, { title: 'SYNTHETIC_RESET_TITLE' }); await f.core.importFile(id, wav());
    await f.core.saveKey('openai', 'SYNTHETIC_ENCRYPTED_RESET_KEY', 'encrypted');
    await f.core.saveKey('openrouter', 'SYNTHETIC_SESSION_RESET_KEY', 'session');
    const saved = f.core.getSnapshot().modelManagement!.rows.find(row => row.route.modelId === 'gpt-4o-mini-transcribe')!;
    await f.core.setModelDefault('stt', saved.key); await f.core.setModelAlias(saved.key, 'SYNTHETIC_RESET_ALIAS');
    expect((await counts(f)).every(n => n > 0)).toBe(true);
    expect(typeof f.core.resetVault).toBe('function'); await f.core.resetVault();
    const state = f.core.getSnapshot();
    expect(state.session).toBe('new'); expect(state.projects).toEqual([]); expect(state.selectedProjectId).toBeNull();
    expect(state.sourcePreviewUrl).toBeNull(); expect(state.playback).toBeNull(); expect(state.modelRegistry).toBeNull(); expect(state.modelManagement).toBeNull();
    expect(state.connections.every(connection => connection.status === 'none')).toBe(true); expect(f.revoked).toContain('blob:synthetic-reset-source');
    expect(await counts(f)).toEqual([0, 0, 0]);
    await f.core.createVault('different synthetic fresh passphrase');
    expect(f.core.getSnapshot().projects).toEqual([]);
    expect(f.core.getSnapshot().modelManagement!.rows.some(row => row.alias === 'SYNTHETIC_RESET_ALIAS')).toBe(false);
    expect(f.core.getSnapshot().connections.every(connection => connection.status === 'none')).toBe(true);
  });
  it('stays pending behind a real transaction and exposes new-vault only after commit', async () => {
    const f = await opened(); await f.core.createMeeting(); const db = await openVaultDatabase(f.indexedDB, f.databaseName);
    const entered = deferred(), finished = deferred(); let held = true;
    const tx = db.transaction(['header', 'records', 'nonces'], 'readwrite');
    const next = () => { const request = tx.objectStore('records').get('synthetic-held-reset'); request.onsuccess = () => { entered.resolve(); if (held) next(); }; };
    tx.oncomplete = () => finished.resolve(); tx.onabort = () => finished.resolve(); next(); await entered.promise;
    try {
      expect(typeof f.core.resetVault).toBe('function'); let settled = false;
      const resetting = f.core.resetVault().then(() => { settled = true; });
      await Promise.resolve(); expect(settled).toBe(false); expect(f.core.getSnapshot().session).toBe('locking'); expect(f.core.getSnapshot().resettingVault).toBe(true);
      held = false; await finished.promise; await resetting;
      expect(f.core.getSnapshot().session).toBe('new'); expect(await counts(f)).toEqual([0, 0, 0]);
    } finally { held = false; await finished.promise; db.close(); }
  });
  it('keeps a failed atomic wipe locked with its durable data and requires explicit reset retry', async () => {
    const f = await opened(); await f.core.createMeeting(); const before = await counts(f);
    const clear = vi.spyOn(IDBObjectStore.prototype, 'clear').mockImplementation(() => { throw new Error('Synthetic clear failure'); });
    expect(typeof f.core.resetVault).toBe('function'); await expect(f.core.resetVault()).rejects.toThrow();
    expect(f.core.getSnapshot().session).toBe('locked'); expect(f.core.getSnapshot().resetVaultError).toBeTruthy(); expect(await counts(f)).toEqual(before);
    clear.mockRestore(); await f.core.resetVault(); expect(f.core.getSnapshot().session).toBe('new'); expect(await counts(f)).toEqual([0, 0, 0]);
  });
  it('retains reset-only recovery on cleanup failure and succeeds only after explicit retry', async () => {
    let fail = true; const f = await opened({ revoke: () => { if (fail) throw new Error('Synthetic resource cleanup failure'); } });
    cleanup.push(() => { fail = false; });
    const id = await f.core.createMeeting(); await f.core.importFile(id, wav()); const before = await counts(f);
    expect(typeof f.core.resetVault).toBe('function'); await expect(f.core.resetVault()).rejects.toThrow();
    expect(f.core.getSnapshot().session).toBe('save-failed'); expect(f.core.getSnapshot().resetVaultError).toBeTruthy(); expect(await counts(f)).toEqual(before);
    fail = false; await f.core.resetVault(); expect(f.core.getSnapshot().session).toBe('new'); expect(await counts(f)).toEqual([0, 0, 0]);
  });
  it('clears a past atomic-reset error when the original vault is successfully unlocked', async () => {
    const f = await opened(), id = await f.core.createMeeting();
    const clear = vi.spyOn(IDBObjectStore.prototype, 'clear').mockImplementation(() => { throw new Error('Synthetic clear failure'); });
    await expect(f.core.resetVault()).rejects.toThrow(); expect(f.core.getSnapshot().resetVaultError).toBeTruthy(); clear.mockRestore();
    await f.core.unlock(passphrase); expect(f.core.getSnapshot().session).toBe('unlocked');
    expect(f.core.getSnapshot().resetVaultError).toBeNull(); expect(f.core.getSnapshot().projects.map(project => project.id)).toEqual([id]);
  });
  it('rejects a locked non-owner reset without empty success or cancelling the active owner', async () => {
    const first = await opened(); await first.core.createMeeting(); const before = await counts(first);
    const second = fixture({ indexedDB: first.indexedDB, databaseName: first.databaseName, owner: first.owner }); await second.core.initialize();
    expect(typeof second.core.resetVault).toBe('function'); await expect(second.core.resetVault()).rejects.toThrow();
    expect(second.core.getSnapshot().session).toBe('locked'); expect(second.core.getSnapshot().resetVaultError).toBeTruthy(); expect(await counts(first)).toEqual(before);
    expect(first.core.getSnapshot().session).toBe('unlocked'); await first.core.createMeeting(); expect(first.core.getSnapshot().projects).toHaveLength(2);
    await first.core.lock(); await second.core.resetVault(); expect(second.core.getSnapshot().session).toBe('new'); expect(await counts(second)).toEqual([0, 0, 0]);
  });
  it('stops playback and fences a held STT response from the old vault after fresh creation', async () => {
    const entered = deferred(); let release!: () => void;
    const response = new Promise<Response>(done => { release = () => done(new Response(JSON.stringify({ text: 'SYNTHETIC_LATE_RESET_SPEECH', usage: { type: 'duration', seconds: 1 } }))); });
    const f = await opened({ fetch: async url => { expect(String(url)).toContain('/audio/transcriptions'); entered.resolve(); return response; } });
    const id = await f.core.createMeeting(); await f.core.importFile(id, wav()); await f.core.saveKey('openai', 'SYNTHETIC_RESET_INFLIGHT_KEY', 'encrypted'); await f.core.prepareAudio(id);
    const pause = vi.fn(); f.core.getSnapshot().onSourcePreviewPlay?.({ pause } as unknown as HTMLAudioElement);
    const running = f.core.startSTT(id, { modelId: 'gpt-transcribe', acknowledged: true }); void running.catch(() => {}); await entered.promise;
    try {
      expect(typeof f.core.resetVault).toBe('function'); await f.core.resetVault(); expect(pause).toHaveBeenCalled();
      await f.core.createVault('different synthetic fresh passphrase'); release(); await expect(running).rejects.toMatchObject({ name: 'AbortError' });
      expect(f.core.getSnapshot().projects).toEqual([]); expect(f.core.getSnapshot().busy).toBe(false);
      await f.core.lock(); await f.core.unlock('different synthetic fresh passphrase'); expect(f.core.getSnapshot().projects).toEqual([]);
    } finally { release(); await running.catch(() => {}); }
  });
  it('does not let late original-vault restoration lock a newly created vault', async () => {
    const entered = deferred(), release = deferred(); let held = false;
    const f = await opened({ sessionFactory: hooks => {
      const actual = createVaultSession(hooks);
      return new Proxy(actual, { get(target, key) {
        if (key !== 'store') return Reflect.get(target, key);
        const store = target.store;
        return { ...store, async listProjects(job: Parameters<typeof store.listProjects>[0]) {
          const projects = await store.listProjects(job);
          if (held) { entered.resolve(); await release.promise; }
          return projects;
        } } satisfies typeof store;
      } });
    } });
    const id = await f.core.createMeeting(); await f.core.importFile(id, wav()); await f.core.lock(); held = true;
    const restoring = f.core.unlock(passphrase); void restoring.catch(() => {}); await entered.promise;
    try {
      await f.core.resetVault(); held = false; await f.core.createVault('different synthetic fresh passphrase'); release.resolve();
      const outcome = await restoring.then(() => null, error => error);
      expect(f.core.getSnapshot().session).toBe('unlocked'); expect(f.core.getSnapshot().projects).toEqual([]);
      expect(outcome).toMatchObject({ name: 'AbortError' });
    } finally { held = false; release.resolve(); await restoring.catch(() => {}); }
  });
});
