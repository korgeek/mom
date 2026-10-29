// @vitest-environment jsdom
// Disposable synthetic storage only. No physical microphone or provider request.
import { webcrypto } from 'node:crypto';
import { Buffer, Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import App from '../src/react-app/App';
import { createMeetingController, useMeetingController, type ControllerOptions, type MeetingController } from '../src/react-app/controller';
import { createVaultSession, type VaultSession } from '../src/react-app/vault/session';
import type { MicrophoneRecorder, RecordingSnapshot } from '../src/react-app/recording/recorder';
import { cancelJobs } from '../src/react-app/domain/jobs';

const phrase = 'synthetic screen lock race passphrase';
const cores: MeetingController[] = [], sessions: VaultSession[] = [], releases: (() => void)[] = [];
let visibility: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.stubGlobal('ArrayBuffer', Buffer.alloc(0).buffer.constructor);
  vi.stubGlobal('Uint8Array', Object.getPrototypeOf(Buffer.prototype).constructor);
  vi.stubGlobal('Blob', NodeBlob); vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('AudioContext', class {}); vi.stubGlobal('AudioWorkletNode', class {});
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(() => Promise.reject(new Error('Physical microphone forbidden'))) } });
  visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
});
afterEach(async () => {
  for (const release of releases.splice(0)) release();
  cleanup();
  for (const core of cores.splice(0)) await core.dispose();
  for (const session of sessions.splice(0)) await session.dispose();
  cancelJobs(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
function options(extra: Partial<ControllerOptions> = {}): ControllerOptions {
  return { indexedDB: new IDBFactory(), databaseName: crypto.randomUUID(),
    fetch: vi.fn(() => Promise.reject(new Error('External requests forbidden'))),
    sessionFactory: hooks => { const session = createVaultSession({ ...hooks, testOnlyOwnership: { acquire: async () => () => {} } }); sessions.push(session); return session; }, ...extra };
}
async function opened(extra: Partial<ControllerOptions> = {}) {
  const core = createMeetingController(options(extra)); cores.push(core);
  await core.initialize(); await core.createVault(phrase); return core;
}
function hold() {
  let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; });
  releases.push(release); return { promise, release };
}

it('fences nested recording callbacks retained before screen locking', async () => {
  let snapshot: RecordingSnapshot = { state: 'idle', sampleRateHz: 16000, acceptedSamples: 0, committedSamples: 0, bodyBytes: 0, committedBytes: 0, durationMs: 0, inputLevel: 0, source: null, error: null };
  const pause = vi.fn(async () => { snapshot = { ...snapshot, state: 'paused' }; });
  const recorder: MicrophoneRecorder = { getSnapshot: () => snapshot,
    start: async () => { snapshot = { ...snapshot, state: 'recording' }; }, pause,
    resume: async () => {}, stop: async () => { throw new Error('Not requested'); },
    abort: async () => { snapshot = { ...snapshot, state: 'aborted' }; } };
  const core = await opened({ recorderFactory: () => recorder }), id = await core.createMeeting();
  await core.startRecording(id);
  const oldRecording = core.getSnapshot().recording!;
  await core.screenLock(); expect(core.getSnapshot().session).toBe('unlocked');
  oldRecording.onPause?.();
  await Promise.resolve(); await Promise.resolve();
  expect(pause).not.toHaveBeenCalled();
  expect(recorder.getSnapshot().state).toBe('recording');
});

it('stages the latest unsaved UI draft on page departure before vault locking', async () => {
  const barrier = hold(); let loads = 0, restoreWaiting = false;
  const config = options({ sessionFactory: hooks => {
    const session = createVaultSession({ ...hooks, testOnlyOwnership: { acquire: async () => () => {} } }); sessions.push(session);
    const load = session.loadScreenState.bind(session);
    const wrapper = Object.create(session) as VaultSession;
    Object.defineProperty(wrapper, 'loadScreenState', { value: async (job: Parameters<VaultSession['loadScreenState']>[0]) => { if (++loads === 2) { restoreWaiting = true; await barrier.promise; } return load(job); } });
    return wrapper;
  } }), hook = renderHook(() => useMeetingController(config));
  await vi.waitFor(() => expect(hook.result.current.session).toBe('new'));
  act(() => hook.result.current.onCreateVault!(phrase));
  await vi.waitFor(() => expect(hook.result.current.session).toBe('unlocked'));
  await vi.waitFor(() => expect(hook.result.current.screenAccess).toBe('open'));
  act(() => hook.result.current.onCreateMeeting!());
  await vi.waitFor(() => expect(hook.result.current.selectedProjectId).toBeTruthy());
  const id = hook.result.current.selectedProjectId!, key = `synthetic-unsaved:${id}`;
  act(() => hook.result.current.onUIDraft!(key, 'UNSAVED_PAGE_DEPARTURE_DRAFT'));
  act(() => window.dispatchEvent(new Event('pagehide')));
  await vi.waitFor(() => expect(hook.result.current.session).toBe('locked'));
  act(() => window.dispatchEvent(new Event('pageshow')));
  act(() => hook.result.current.onUnlock!(phrase));
  await vi.waitFor(() => expect(restoreWaiting).toBe(true));
  expect(hook.result.current.session).toBe('unlocked');
  expect(hook.result.current.screenAccess).toBe('verifying');
  expect(hook.result.current.uiDrafts?.[key]).toBeUndefined();
  act(() => hook.result.current.onUIDraft!(key, 'MUST_NOT_REPLACE_SAVED_DRAFT'));
  barrier.release();
  await vi.waitFor(() => expect(hook.result.current.screenAccess).toBe('open'));
  expect(hook.result.current.uiDrafts?.[key]).toBe('UNSAVED_PAGE_DEPARTURE_DRAFT');
});

it('does not reopen a strict vault after the page becomes hidden during key derivation', async () => {
  const core = await opened();
  core.getSnapshot().onPreferences!({ ...core.getSnapshot().preferences, lockWorkPolicy: 'strict' });
  await core.lock();
  const barrier = hold(), derive = crypto.subtle.deriveKey.bind(crypto.subtle);
  const derivation = vi.spyOn(crypto.subtle, 'deriveKey').mockImplementation(async (...args) => { await barrier.promise; return derive(...args); });
  const opening = core.unlockScreen(phrase); void opening.catch(() => {});
  await vi.waitFor(() => expect(derivation).toHaveBeenCalledOnce());
  expect(core.getSnapshot().session).toBe('unlocking');
  visibility.mockReturnValue('hidden'); await core.noteBackground();
  barrier.release(); await opening.catch(() => {});
  await vi.waitFor(() => expect(core.getSnapshot().session).toBe('locked'));
  expect(core.getSnapshot().screenAccess).not.toBe('open');
  expect(core.getSnapshot().projects).toEqual([]);
});

it('keeps strict flush failure behind the recovery gate and retains the encrypted retry draft', async () => {
  const core = await opened(), id = await core.createMeeting(), key = `strict-failure:${id}`;
  core.getSnapshot().onUIDraft!(key, 'SYNTHETIC_UNSAVED_STRICT_DRAFT');
  core.getSnapshot().onPreferences!({ ...core.getSnapshot().preferences, lockWorkPolicy: 'strict' });
  const failure = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => { throw new Error('Synthetic full storage'); });
  try {
    await expect(core.screenLock()).rejects.toThrow();
    expect(core.getSnapshot().session).toBe('save-failed');
    expect(core.getSnapshot().projects).toEqual([]);
    render(<App controller={core.getSnapshot()} />);
    expect(screen.getByRole('button', { name: '저장 후 잠금 다시 시도' })).toBeTruthy();
    expect(document.body.textContent).not.toContain('SYNTHETIC_UNSAVED_STRICT_DRAFT');
    await expect(core.createMeeting()).rejects.toThrow();
  } finally { failure.mockRestore(); }
  core.getSnapshot().onRetryLock!();
  await vi.waitFor(() => expect(core.getSnapshot().session).toBe('locked'));
  await core.unlockScreen(phrase);
  expect(core.getSnapshot().uiDrafts?.[key]).toBe('SYNTHETIC_UNSAVED_STRICT_DRAFT');
});
