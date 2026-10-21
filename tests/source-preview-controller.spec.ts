import { webcrypto } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createMeetingController, type MeetingController } from '../src/react-app/controller';
import { createVaultSession } from '../src/react-app/vault/session';
import { createLocalMediaWorker } from '../src/react-app/media/worker';
import { cancelJobs } from '../src/react-app/domain/jobs';
const phrase = 'synthetic source preview passphrase';
const cores: MeetingController[] = [];
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(async () => { for (const core of cores.splice(0)) await core.dispose(); cancelJobs(); vi.unstubAllGlobals(); });
function fixtureFile() {
  const bytes = new Uint8Array(44 + 32000), view = new DataView(bytes.buffer);
  const text = (at: number, value: string) => [...value].forEach((value, i) => bytes[at + i] = value.charCodeAt(0));
  text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVE'); text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, 32000, true);
  for (let i = 0; i < 16000; i++) view.setInt16(44 + i * 2, 8192, true);
  return new File([bytes], 'SYNTHETIC_RELOAD.wav', { type: 'audio/wav' });
}
function setup() {
  const indexedDB = new IDBFactory(), databaseName = `source-preview-${crypto.randomUUID()}`, created: Blob[] = [], revoked: string[] = [];
  let held: Promise<number[]> | null = null, terminated = 0;
  const make = () => {
    const core = createMeetingController({ indexedDB, databaseName,
      sessionFactory: options => createVaultSession({ ...options, testOnlyOwnership: { acquire: async () => () => {} } }),
      mediaWorkerFactory: () => { const worker = createLocalMediaWorker(); return { ...worker, waveform: (...args) => held ?? worker.waveform!(...args), terminate() { terminated++; worker.terminate(); } }; },
      objectUrls: { create: blob => { created.push(blob); return `blob:synthetic-${created.length}`; }, revoke: url => { revoked.push(url); } } });
    cores.push(core); return core;
  };
  return { make, created, revoked, hold: (promise: Promise<number[]>) => { held = promise; }, terminated: () => terminated };
}
async function importFile(core: MeetingController) {
  await core.initialize(); await core.createVault(phrase); const id = await core.createMeeting(); await core.importFile(id, fixtureFile()); return id;
}
it('opens encrypted retained source after a fresh controller reload and lock/unlock', async () => {
  const f = setup(), first = f.make(), id = await importFile(first);
  await first.dispose(); cores.splice(cores.indexOf(first), 1);
  const core = f.make(); await core.initialize(); await core.unlock(phrase);
  expect(core.getSnapshot().selectedProjectId).toBe(id);
  core.getSnapshot().onNavigate!('import', id);
  await vi.waitFor(() => expect(core.getSnapshot().screen).toBe('import'));
  core.getSnapshot().onLoadSourcePreview!(id);
  await vi.waitFor(() => expect(core.getSnapshot().sourceWaveform?.[0]).toBe(.25));
  expect(core.getSnapshot().sourcePreviewUrl).toBeTruthy(); expect(f.created.at(-1)?.size).toBe(32044);
  const before = core.getSnapshot().projects[0]; await core.screenLock();
  expect(core.getSnapshot().sourceWaveform).toBeNull(); expect(core.getSnapshot().sourcePreviewUrl).toBeNull();
  await core.unlockScreen(phrase); core.getSnapshot().onLoadSourcePreview!(id);
  await vi.waitFor(() => expect(core.getSnapshot().sourceWaveform?.[0]).toBe(.25));
  expect(core.getSnapshot().projects[0].sourceAssets).toEqual(before.sourceAssets);
  expect(core.getSnapshot().projects[0].transcriptVersions).toEqual(before.transcriptVersions);
});
it('fences late waveform completion on lock and component release without cancelling provider work', async () => {
  const f = setup(), core = f.make(), id = await importFile(core);
  let finish!: (peaks: number[]) => void; const held = new Promise<number[]>(resolve => { finish = resolve; }); f.hold(held);
  core.getSnapshot().onLoadSourcePreview!(id); await vi.waitFor(() => expect(core.getSnapshot().sourcePreviewLoading).toBe(true));
  core.getSnapshot().onReleaseSourcePreview!(id); finish(new Array<number>(256).fill(.9));
  await vi.waitFor(() => expect(core.getSnapshot().sourcePreviewLoading).toBe(false));
  expect(core.getSnapshot().sourceWaveform).toBeNull(); expect(core.getSnapshot().sourcePreviewUrl).toBeNull(); expect(core.getSnapshot().session).toBe('unlocked');
  core.getSnapshot().onLoadSourcePreview!(id); await core.screenLock();
  expect(core.getSnapshot().sourceWaveform).toBeNull(); expect(core.getSnapshot().sourcePreviewUrl).toBeNull(); expect(f.terminated()).toBeGreaterThan(0);
});
it('does not recreate a preview after the retained original has been deleted', async () => {
  const f = setup(), core = f.make(), id = await importFile(core);
  const plan = await core.planAudioDeletion('source', id); await core.deletePlannedAudio(plan.versionToken);
  const before = f.created.length; core.getSnapshot().onLoadSourcePreview!(id);
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(core.getSnapshot().sourcePreviewUrl).toBeNull(); expect(core.getSnapshot().sourceWaveform).toBeNull(); expect(f.created).toHaveLength(before);
});
it('ends preview loading when unrelated preparation cancellation invalidates its job', async () => {
  const f = setup(), core = f.make(), id = await importFile(core);
  let finish!: (peaks: number[]) => void;
  f.hold(new Promise<number[]>(resolve => { finish = resolve; }));
  core.getSnapshot().onLoadSourcePreview!(id);
  await vi.waitFor(() => expect(core.getSnapshot().sourcePreviewLoading).toBe(true));
  cancelJobs(); finish(new Array<number>(256).fill(.5));
  await vi.waitFor(() => expect(core.getSnapshot().sourcePreviewLoading).toBe(false));
  expect(core.getSnapshot().sourceWaveform).toBeNull(); expect(core.getSnapshot().session).toBe('unlocked');
});
