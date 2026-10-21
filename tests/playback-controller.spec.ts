import { webcrypto } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMeetingController, type MeetingController } from '../src/react-app/controller';
import { createVaultSession, type VaultSession } from '../src/react-app/vault/session';
import { cancelJobs, createJobContext } from '../src/react-app/domain/jobs';

// Browser media is exercised in the headed fixture. Here this event-driven media
// boundary lets us deterministically deliver metadata and promises after cleanup.
class TestAudio extends EventTarget {
  static instances: TestAudio[] = [];
  src: string; currentTime = 0; paused = true; readyState = 0;
  playResult: Promise<void> | null = null;
  queueMediaEvents = false; queuedMediaEvents: string[] = [];
  listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  resetPositions: number[] = [];
  constructor(src: string) { super(); this.src = src; TestAudio.instances.push(this); }
  override addEventListener(type: string, listener: EventListenerOrEventListenerObject | null) {
    if (listener) { const set = this.listeners.get(type) ?? new Set(); set.add(listener); this.listeners.set(type, set); }
    super.addEventListener(type, listener);
  }
  override removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null) {
    if (listener) this.listeners.get(type)?.delete(listener);
    super.removeEventListener(type, listener);
  }
  event(type: string) {
    if (type === 'loadedmetadata') this.readyState = 1;
    this.dispatchEvent(new Event(type));
    const handler = Reflect.get(this, `on${type}`); if (typeof handler === 'function') handler();
  }
  mediaEvent(type: string) { if (this.queueMediaEvents) this.queuedMediaEvents.push(type); else this.event(type); }
  flushMediaEvent() { const type = this.queuedMediaEvents.shift(); if (type) this.event(type); }
  play() { this.paused = false; if (this.playResult) return this.playResult; this.mediaEvent('playing'); return Promise.resolve(); }
  pause() { const wasPlaying = !this.paused; this.paused = true; if (wasPlaying) this.mediaEvent('pause'); }
  removeAttribute(name: string) { if (name === 'src') { this.resetPositions.push(this.currentTime); this.src = ''; } }
  load() {}
}
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const cores: MeetingController[] = [];
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('Audio', TestAudio); TestAudio.instances = []; });
afterEach(async () => { vi.useRealTimers(); for (const core of cores.splice(0)) await core.dispose(); cancelJobs(); vi.unstubAllGlobals(); });
async function opened() {
  let vault!: VaultSession; let readGate: ReturnType<typeof deferred<Blob>> | null = null, failCapture = false;
  const created: string[] = [], revoked: string[] = [];
  const core = createMeetingController({ indexedDB: new IDBFactory(), databaseName: `playback-${crypto.randomUUID()}`,
    objectUrls: { create: () => { const url = `blob:fixture-${created.length}`; created.push(url); return url; }, revoke: url => { revoked.push(url); } },
    sessionFactory: options => { vault = createVaultSession({ ...options, capturePending: () => { if (failCapture) throw new Error('SYNTHETIC_CAPTURE_FAILURE'); return options.capturePending?.() ?? []; }, testOnlyOwnership: { acquire: async () => () => {} } }); return new Proxy(vault, { get(target, key) {
      if (key !== 'store') return Reflect.get(target, key);
      return { ...target.store, readAudio: (...args: Parameters<VaultSession['store']['readAudio']>) => readGate?.promise ?? target.store.readAudio(...args) };
    } }); }
  });
  cores.push(core); await core.initialize(); await core.createVault('synthetic playback test phrase');
  const id = await core.createMeeting(), project = core.getSnapshot().projects[0];
  const chunks = [0, 1].map(index => ({ id: `chunk-${index}`, sourceId: 'source', index, sourceStartMs: index * 10000, sourceEndMs: (index + 1) * 10000,
    encodingOffsetMs: 125, encodedBytes: 4, mimeType: 'audio/wav', codec: 'pcm', audioRecordId: `audio-${index}` }));
  await vault.store.checkpoint({ project: { ...project, preparedChunks: chunks, transcriptVersions: [{ id: 'version', rawIds: [], segments: [{ id: 'segment', text: 'SYNTHETIC', sourceStartMs: 11000, sourceEndMs: 11500, rawIds: [] }], issues: [], missingRanges: [], parentId: null }], selectedTranscriptVersionId: 'version' }, runId: null,
    audioRecords: chunks.map(chunk => ({ recordId: chunk.audioRecordId, audio: new Blob(['tone'], { type: 'audio/wav' }) })) }, createJobContext());
  await core.lock(); await core.unlock('synthetic playback test phrase');
  return { core, id, created, revoked, gateRead: () => (readGate = deferred<Blob>()), failLockCapture: () => { failCapture = true; } };
}
async function playing(f: Awaited<ReturnType<typeof opened>>, chunk = 'chunk-0') {
  f.core.getSnapshot().onPlayChunk!(f.id, chunk);
  await vi.waitFor(() => expect(TestAudio.instances.length).toBeGreaterThan(0));
  const audio = TestAudio.instances.at(-1)!; audio.event('loadedmetadata');
  await vi.waitFor(() => expect(f.core.getSnapshot().playback?.state).toBe('playing')); return audio;
}

describe('dedicated chunk playback lifecycle', () => {
  it('projects loading independently of the provider busy state', async () => {
    const f = await opened(), gate = f.gateRead(); f.core.getSnapshot().onPlayChunk!(f.id, 'chunk-0');
    expect(f.core.getSnapshot().playback).toMatchObject({ projectId: f.id, chunkId: 'chunk-0', state: 'loading' });
    expect(f.core.getSnapshot().busy).toBe(false); f.core.getSnapshot().onStopPlayback!(); gate.resolve(new Blob(['tone']));
  });
  it('pauses and resumes the same player at its retained position and stops at the mapped beginning', async () => {
    const f = await opened(), audio = await playing(f); expect(audio.currentTime).toBe(.125);
    audio.currentTime = 4.25; f.core.getSnapshot().onPauseChunk!(f.id, 'chunk-0');
    expect(audio.paused).toBe(true); expect(f.core.getSnapshot().playback?.state).toBe('paused');
    f.core.getSnapshot().onResumeChunk!(f.id, 'chunk-0'); await vi.waitFor(() => expect(audio.paused).toBe(false));
    expect(audio.currentTime).toBe(4.25); expect(TestAudio.instances).toHaveLength(1);
    const providerJob = createJobContext(); f.core.getSnapshot().onStopPlayback!();
    expect(() => providerJob.assertActive()).not.toThrow(); expect(audio.paused).toBe(true);
    expect(audio.resetPositions).toEqual([.125]); expect(f.core.getSnapshot().playback).toBeNull();
    expect(f.revoked).toEqual(f.created); expect([...audio.listeners.values()].every(set => set.size === 0)).toBe(true);
  });
  it('uses actual media pause, playing, ended and error events', async () => {
    const f = await opened(), audio = await playing(f); audio.pause(); expect(f.core.getSnapshot().playback?.state).toBe('paused');
    audio.paused = false; audio.event('playing'); expect(audio.paused).toBe(true); expect(f.core.getSnapshot().playback?.state).toBe('paused');
    f.core.getSnapshot().onResumeChunk!(f.id, 'chunk-0'); expect(f.core.getSnapshot().playback?.state).toBe('playing');
    audio.event('ended'); expect(f.core.getSnapshot().playback).toBeNull(); expect(f.revoked).toEqual(f.created);
    f.core.getSnapshot().onPlayChunk!(f.id, 'chunk-1'); await vi.waitFor(() => expect(TestAudio.instances).toHaveLength(2));
    const broken = TestAudio.instances[1]; broken.event('error');
    await vi.waitFor(() => expect(f.core.getSnapshot().playback?.state).toBe('error'));
    expect(broken.paused).toBe(true); expect(f.revoked).toEqual(f.created);
  });
  it('does not duplicate repeated play or resume clicks and switches to one bounded segment', async () => {
    const f = await opened(); f.core.getSnapshot().onPlayChunk!(f.id, 'chunk-0'); f.core.getSnapshot().onPlayChunk!(f.id, 'chunk-0');
    await vi.waitFor(() => expect(TestAudio.instances).toHaveLength(1)); const first = TestAudio.instances[0]; first.event('loadedmetadata');
    await vi.waitFor(() => expect(first.paused).toBe(false)); f.core.getSnapshot().onPlayChunk!(f.id, 'chunk-0');
    f.core.getSnapshot().onPauseChunk!(f.id, 'chunk-0'); f.core.getSnapshot().onResumeChunk!(f.id, 'chunk-0'); f.core.getSnapshot().onResumeChunk!(f.id, 'chunk-0');
    expect(TestAudio.instances).toHaveLength(1);
    f.core.getSnapshot().onPlaySegment!(f.id, 'version', 'segment'); expect(first.paused).toBe(true);
    await vi.waitFor(() => expect(TestAudio.instances).toHaveLength(2)); const segment = TestAudio.instances[1]; segment.event('loadedmetadata');
    await vi.waitFor(() => expect(segment.paused).toBe(false)); expect(segment.currentTime).toBe(1.125);
    segment.currentTime = 1.625; segment.event('timeupdate'); expect(segment.paused).toBe(true);
    expect(f.core.getSnapshot().playback).toBeNull(); expect(f.revoked).toEqual(f.created);
  });
  it.each(['stop', 'navigate', 'lock', 'dispose'] as const)('fences late encrypted reads after %s', async boundary => {
    const f = await opened(), gate = f.gateRead(); f.core.getSnapshot().onPlayChunk!(f.id, 'chunk-0');
    if (boundary === 'stop') f.core.getSnapshot().onStopPlayback!();
    if (boundary === 'navigate') { f.core.getSnapshot().onNavigate!('home'); await vi.waitFor(() => expect(f.core.getSnapshot().screen).toBe('home')); }
    if (boundary === 'lock') await f.core.lock(); if (boundary === 'dispose') await f.core.dispose();
    gate.resolve(new Blob(['tone'])); await new Promise(resolve => setTimeout(resolve, 20));
    expect(TestAudio.instances).toHaveLength(0); expect(f.created).toEqual([]); expect(f.core.getSnapshot().playback).toBeNull();
  });
  it('fences a late metadata event and releases its timeout on stop', async () => {
    const f = await opened(); vi.useFakeTimers(); f.core.getSnapshot().onPlayChunk!(f.id, 'chunk-0');
    await vi.waitFor(() => expect(TestAudio.instances).toHaveLength(1)); const audio = TestAudio.instances[0];
    const timerCount = vi.getTimerCount(); f.core.getSnapshot().onStopPlayback!(); expect(vi.getTimerCount()).toBe(timerCount - 1);
    audio.event('loadedmetadata'); await vi.advanceTimersByTimeAsync(11000);
    expect(audio.paused).toBe(true); expect(f.core.getSnapshot().playback).toBeNull(); expect(f.core.getSnapshot().error).toBeNull();
  });
  it('fences a late play promise and events after a switch', async () => {
    const f = await opened(), late = deferred<void>(); f.core.getSnapshot().onPlayChunk!(f.id, 'chunk-0');
    await vi.waitFor(() => expect(TestAudio.instances).toHaveLength(1)); const old = TestAudio.instances[0]; old.playResult = late.promise; old.event('loadedmetadata');
    await vi.waitFor(() => expect(old.paused).toBe(false)); f.core.getSnapshot().onPlayChunk!(f.id, 'chunk-1');
    await vi.waitFor(() => expect(TestAudio.instances).toHaveLength(2)); const next = TestAudio.instances[1]; next.event('loadedmetadata');
    await vi.waitFor(() => expect(f.core.getSnapshot().playback?.chunkId).toBe('chunk-1'));
    old.event('playing'); late.resolve(); await new Promise(resolve => setTimeout(resolve, 20));
    expect(old.paused).toBe(true); expect(f.core.getSnapshot().playback).toMatchObject({ chunkId: 'chunk-1', state: 'playing' });
  });
  it('releases active playback when deleting its meeting', async () => {
    const f = await opened(), audio = await playing(f); f.core.getSnapshot().onDeleteMeeting!(f.id);
    await vi.waitFor(() => expect(f.core.getSnapshot().projects).toHaveLength(0));
    expect(audio.paused).toBe(true); expect(f.core.getSnapshot().playback).toBeNull(); expect(f.revoked).toEqual(f.created);
  });
  it('stops the previous project when creating a meeting', async () => {
    const f = await opened(), audio = await playing(f); await f.core.createMeeting();
    expect(audio.paused).toBe(true); expect(f.core.getSnapshot().playback).toBeNull(); expect(f.revoked).toEqual(f.created);
  });
  it('coordinates native source preview with chunks in both directions and rejects it after lock', async () => {
    const f = await opened(), chunk = await playing(f), source = new TestAudio('blob:source'); source.play();
    f.core.getSnapshot().onSourcePreviewPlay!(source as unknown as HTMLAudioElement);
    expect(chunk.paused).toBe(true); expect(source.paused).toBe(false); expect(f.core.getSnapshot().playback).toBeNull();
    f.core.getSnapshot().onPlayChunk!(f.id, 'chunk-1'); expect(source.paused).toBe(true);
    await f.core.lock(); source.play(); f.core.getSnapshot().onSourcePreviewPlay!(source as unknown as HTMLAudioElement);
    expect(source.paused).toBe(true); expect(f.core.getSnapshot().playback).toBeNull();
  });
  it.each(['stop', 'navigate', 'lock', 'dispose'] as const)('fences late play promises and events after %s', async boundary => {
    const f = await opened(), late = deferred<void>(); f.core.getSnapshot().onPlayChunk!(f.id, 'chunk-0');
    await vi.waitFor(() => expect(TestAudio.instances).toHaveLength(1)); const audio = TestAudio.instances[0]; audio.playResult = late.promise; audio.event('loadedmetadata');
    await vi.waitFor(() => expect(audio.paused).toBe(false));
    if (boundary === 'stop') f.core.getSnapshot().onStopPlayback!();
    if (boundary === 'navigate') f.core.getSnapshot().onNavigate!('home');
    if (boundary === 'lock') await f.core.lock(); if (boundary === 'dispose') await f.core.dispose();
    audio.event('playing'); audio.event('error'); late.reject(new Error('SYNTHETIC_PRIVATE_ERROR'));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(audio.paused).toBe(true); expect(f.core.getSnapshot().playback).toBeNull(); expect(f.revoked).toEqual(f.created);
    expect([...audio.listeners.values()].every(set => set.size === 0)).toBe(true); expect(f.core.getSnapshot().error).toBeNull();
  });
  it('allows retry after metadata failure and never claims playing on a rejected play promise', async () => {
    const f = await opened(); f.core.getSnapshot().onPlayChunk!(f.id, 'chunk-0');
    await vi.waitFor(() => expect(TestAudio.instances).toHaveLength(1)); TestAudio.instances[0].event('error');
    await vi.waitFor(() => expect(f.core.getSnapshot().playback?.state).toBe('error'));
    f.core.getSnapshot().onPlayChunk!(f.id, 'chunk-0'); await vi.waitFor(() => expect(TestAudio.instances).toHaveLength(2));
    const audio = TestAudio.instances[1], rejected = deferred<void>(); audio.playResult = rejected.promise; audio.event('loadedmetadata');
    await vi.waitFor(() => expect(audio.paused).toBe(false)); expect(f.core.getSnapshot().playback?.state).toBe('loading');
    rejected.reject(new Error('SYNTHETIC_PRIVATE_ERROR')); await vi.waitFor(() => expect(f.core.getSnapshot().playback?.state).toBe('error'));
    expect(audio.paused).toBe(true); expect(f.revoked).toEqual(f.created); expect(f.core.getSnapshot().error).toBeNull();
  });
  it('resumes while an older play promise is pending and ignores that older rejection', async () => {
    const f = await opened(), late = deferred<void>(); f.core.getSnapshot().onPlayChunk!(f.id, 'chunk-0');
    await vi.waitFor(() => expect(TestAudio.instances).toHaveLength(1)); const audio = TestAudio.instances[0]; audio.playResult = late.promise; audio.event('loadedmetadata');
    await vi.waitFor(() => expect(audio.paused).toBe(false)); audio.event('playing');
    f.core.getSnapshot().onPauseChunk!(f.id, 'chunk-0'); audio.playResult = null;
    f.core.getSnapshot().onResumeChunk!(f.id, 'chunk-0'); expect(audio.paused).toBe(false);
    late.reject(new Error('SYNTHETIC_OLD_PLAY')); await new Promise(resolve => setTimeout(resolve, 20));
    expect(f.core.getSnapshot().playback?.state).toBe('playing'); expect(TestAudio.instances).toHaveLength(1);
  });
  it('ignores a queued older Pause after Resume but honors a real queued external pause', async () => {
    const f = await opened(), audio = await playing(f); audio.currentTime = 3.5; audio.queueMediaEvents = true;
    f.core.getSnapshot().onPauseChunk!(f.id, 'chunk-0'); f.core.getSnapshot().onResumeChunk!(f.id, 'chunk-0');
    expect(audio.paused).toBe(false); expect(audio.queuedMediaEvents).toEqual(['pause', 'playing']);
    expect(f.core.getSnapshot().playback?.state).toBe('loading');
    audio.flushMediaEvent(); // Old native Pause arrives while the newer Resume is already unpaused.
    expect(audio.paused).toBe(false); expect(f.core.getSnapshot().playback?.state).toBe('loading');
    audio.flushMediaEvent(); expect(audio.paused).toBe(false); expect(f.core.getSnapshot().playback?.state).toBe('playing');
    expect(audio.currentTime).toBe(3.5); expect(TestAudio.instances).toHaveLength(1);
    audio.pause(); expect(audio.paused).toBe(true); audio.flushMediaEvent();
    expect(f.core.getSnapshot().playback?.state).toBe('paused');
    audio.event('playing'); expect(audio.paused).toBe(true); expect(f.core.getSnapshot().playback?.state).toBe('paused');
  });
  it.each(['navigate', 'lock', 'dispose'] as const)('fences late metadata after %s', async boundary => {
    const f = await opened(); f.core.getSnapshot().onPlayChunk!(f.id, 'chunk-0');
    await vi.waitFor(() => expect(TestAudio.instances).toHaveLength(1)); const audio = TestAudio.instances[0];
    if (boundary === 'navigate') f.core.getSnapshot().onNavigate!('home');
    if (boundary === 'lock') await f.core.lock(); if (boundary === 'dispose') await f.core.dispose();
    audio.event('loadedmetadata'); await new Promise(resolve => setTimeout(resolve, 20));
    expect(audio.paused).toBe(true); expect(audio.src).toBe(''); expect(f.core.getSnapshot().playback).toBeNull();
    expect(f.revoked).toEqual(f.created); expect([...audio.listeners.values()].every(set => set.size === 0)).toBe(true);
  });
  it('requires a new explicit play after unlock and ignores the pre-lock audio read', async () => {
    const f = await opened(), gate = f.gateRead(); f.core.getSnapshot().onPlayChunk!(f.id, 'chunk-0');
    await f.core.lock(); await f.core.unlock('synthetic playback test phrase'); gate.resolve(new Blob(['tone']));
    await new Promise(resolve => setTimeout(resolve, 20)); expect(TestAudio.instances).toHaveLength(0); expect(f.core.getSnapshot().playback).toBeNull();
    const audio = await playing(f); expect(audio.paused).toBe(false);
  });
  it('stops while another operation is busy without changing or cancelling that operation', async () => {
    const f = await opened(), audio = await playing(f), save = f.core.updateMeeting(f.id, { title: 'SYNTHETIC_BUSY_SAVE' });
    expect(f.core.getSnapshot().busy).toBe(true); f.core.getSnapshot().onStopPlayback!();
    expect(f.core.getSnapshot().busy).toBe(true); expect(audio.paused).toBe(true); await save;
    expect(f.core.getSnapshot().projects[0].title).toBe('SYNTHETIC_BUSY_SAVE'); expect(f.core.getSnapshot().busy).toBe(false);
  });
  it('releases playback even when locking cannot capture completed work', async () => {
    const f = await opened(), audio = await playing(f); f.failLockCapture(); await expect(f.core.lock()).rejects.toThrow();
    expect(f.core.getSnapshot().session).toBe('save-failed'); expect(f.core.getSnapshot().playback).toBeNull(); expect(audio.paused).toBe(true); expect(f.revoked).toEqual(f.created);
    f.core.getSnapshot().onDiscardAndLock!(); await vi.waitFor(() => expect(f.core.getSnapshot().session).toBe('locked'));
  });
});
