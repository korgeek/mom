// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { Buffer, Blob as NodeBlob } from 'node:buffer';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useState } from 'react';
import { IDBFactory } from 'fake-indexeddb';
import App from '../src/react-app/App';
import { createMeetingController, type ControllerOptions, type MeetingController } from '../src/react-app/controller';
import { createVaultSession, type VaultSession } from '../src/react-app/vault/session';
import { cancelJobs, createJobContext } from '../src/react-app/domain/jobs';
import type { JobContext, SourceWriter } from '../src/react-app/domain/types';
import { createMicrophoneRecorder, type MicrophoneRecorderOptions } from '../src/react-app/recording/recorder';
import type { RecordingControlsProps } from '../src/react-app/ui/RecordingControls';
import { readMediaRange, type MediaInput } from '../src/react-app/media/io';

type Consumer = MeetingController & Partial<{
  startRecording(id: string): Promise<void>; pauseRecording(id: string): Promise<void>; resumeRecording(id: string): Promise<void>;
  stopRecording(id: string): Promise<void>; abortRecording(id: string): Promise<void>;
}>;
const controllers: Consumer[] = [], releases: (() => void)[] = [];
afterEach(async () => { cleanup(); for (const release of releases.splice(0)) release(); for (const core of controllers.splice(0)) await core.dispose(); cancelJobs(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function gate() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); releases.push(release); return { promise, release }; }
class Track extends EventTarget { kind = 'audio'; readyState = 'live'; stop = vi.fn(() => { this.readyState = 'ended'; }); }
class Rig {
  track = new Track(); samples = 0; packetId = 0; holdPermission: ReturnType<typeof gate> | null = null; holdPause: ReturnType<typeof gate> | null = null;
  context = { sampleRate: 16000, state: 'suspended', onstatechange: null as (() => void) | null,
    audioWorklet: { addModule: vi.fn(async () => {}) }, destination: {},
    resume: async () => { this.context.state = 'running'; }, close: async () => { this.context.state = 'closed'; },
    createMediaStreamSource: () => ({ connect() {}, disconnect() {} }),
  };
  port = { onmessage: null as ((event: MessageEvent) => void) | null, onmessageerror: null, close() {}, postMessage: (data: { type: string; commandId?: number }) => {
    if (!['start','pause','resume','stop'].includes(data.type)) return;
    const message = { type: data.type === 'pause' ? 'paused' : data.type === 'stop' ? 'stopped' : 'running', commandId: data.commandId, packetId: this.packetId, samples: this.samples };
    void (async () => { if (data.type === 'pause') await this.holdPause?.promise; queueMicrotask(() => this.emit(message)); })();
  } };
  emit(data: object) { this.port.onmessage?.({ data } as MessageEvent); }
  packet(frames = 4000) { this.packetId++; this.samples += frames; this.emit({ type: 'pcm', packetId: this.packetId, frames, bytes: new ArrayBuffer(frames * 2) }); }
  dependencies = {
    supported: () => true,
    getUserMedia: async (constraints: MediaStreamConstraints) => { expect(constraints).toEqual({ audio: true, video: false }); await this.holdPermission?.promise; return { getTracks: () => [this.track], getAudioTracks: () => [this.track] } as unknown as MediaStream; },
    createAudioContext: () => this.context as unknown as AudioContext,
    createWorkletNode: () => { queueMicrotask(() => this.emit({ type: 'ready', sampleRateHz: 16000 })); return { port: this.port, connect() {}, disconnect() {}, onprocessorerror: null } as unknown as AudioWorkletNode; },
  };
}
function view(core: Consumer) { return (core.getSnapshot() as ReturnType<MeetingController['getSnapshot']> & { recording?: RecordingControlsProps & { projectId: string } | null }).recording; }
function Surface({ core }: { core: Consumer }) { const [snapshot, set] = useState(core.getSnapshot()); useEffect(() => core.subscribe(() => set(core.getSnapshot())), [core]); return <App controller={snapshot} />; }
async function fixture(changeSession?: (session: VaultSession) => VaultSession) {
  // fake-IDB structuredClone and Node WebCrypto return Node-realm buffers.
  vi.stubGlobal('ArrayBuffer', Buffer.alloc(0).buffer.constructor); vi.stubGlobal('Uint8Array', Object.getPrototypeOf(Buffer.prototype).constructor); vi.stubGlobal('Blob', NodeBlob);
  vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('isSecureContext', true); vi.stubGlobal('AudioContext', class {}); vi.stubGlobal('AudioWorkletNode', class {});
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  const physicalMic = vi.fn(() => Promise.reject(new Error('TEST_ONLY physical microphone forbidden'))); Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: physicalMic } });
  const indexedDB = new IDBFactory(), databaseName = crypto.randomUUID(), calls: string[] = [], rigs: Rig[] = [], factoryCalls: MicrophoneRecorderOptions[] = [], writerJobs: JobContext[] = [], sourceReads: number[] = [];
  let session!: VaultSession;
  const startupErrors: unknown[] = [];
  const options: ControllerOptions = { indexedDB, databaseName, fetch: async (input: RequestInfo | URL) => { calls.push(String(input)); throw new Error('TEST_ONLY provider forbidden'); },
    recorderFactory: (options: MicrophoneRecorderOptions) => { factoryCalls.push(options); const rig = rigs[rigs.length - 1] ?? new Rig(); if (!rigs.length) rigs.push(rig); return createMicrophoneRecorder({ ...options, dependencies: rig.dependencies }); },
    sessionFactory: (hooks: Parameters<typeof createVaultSession>[0]) => {
      session = createVaultSession({ ...hooks, indexedDB, databaseName, testOnlyOwnership: { acquire: async () => () => {} } });
      const boundary = new Proxy(Object.create(session) as VaultSession, { get(target, key) {
        if (key === 'createSourceWriter') return async (projectId: string, sourceId: string, config: Parameters<VaultSession['createSourceWriter']>[2], job: JobContext) => { writerJobs.push(job); return session.createSourceWriter(projectId, sourceId, config, job); };
        const value = Reflect.get(target, key);
        if (['create','loadModelRegistry','saveModelRegistry','getStorageInventory'].includes(String(key))) return async (...args: unknown[]) => {
          try { return await value(...args); } catch (error) { startupErrors.push(error); throw error; }
        };
        return value;
      } }); return changeSession?.(boundary) ?? boundary;
    },
    // A transport-only encoder seam verifies actual retained range reads and encrypted chunk handoff. No codec quality claim.
    mediaWorkerFactory: () => { let job: JobContext, sourceDuration = 0, yielded = false; return {
      async inspect(input: MediaInput, context?: JobContext) { job = context!; const bytes = new Uint8Array(await readMediaRange(input, 0, 44, job)); sourceReads.push(bytes.byteLength); expect(String.fromCharCode(...bytes.slice(0,4))).toBe('RIFF'); sourceDuration = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(40,true) / 32; return { asset: { id: crypto.randomUUID(), fileName: input.name, bytes: input.size, container: 'wav', codec: 'pcm_s16le', durationMs: sourceDuration, channels: 1, sampleRateHz: 16000 }, decodedSamples: sourceDuration * 16, originalEncoding: { delaySamples: null, paddingSamples: null } }; },
      async start() {}, async next() { job.assertActive(); if (yielded) return { done: true as const, value: undefined }; yielded = true; return { done: false as const, value: { range: { sourceStartMs: 0, sourceEndMs: sourceDuration }, audio: new Blob(['TEST_ONLY encoded transport']) } }; }, terminate() {},
    }; },
    objectUrls: { create: () => { throw new Error('TEST_ONLY recording must not allocate a whole source Blob'); }, revoke() {} },
  };
  const core = createMeetingController(options) as Consumer; controllers.push(core);
  await core.initialize(); await core.createVault('TEST_ONLY microphone integration phrase').catch(error => { throw startupErrors[0] ?? error; }); const id = await core.createMeeting();
  return { core, id, rigs, factoryCalls, writerJobs, calls, physicalMic, sourceReads, session: () => session };
}
async function start(f: Awaited<ReturnType<typeof fixture>>) { await f.core.startRecording?.(f.id); expect(f.factoryCalls).toHaveLength(1); expect(view(f.core)?.snapshot.state).toBe('recording'); }
async function captured(f: Awaited<ReturnType<typeof fixture>>) { await start(f); f.rigs[0].packet(); await vi.waitFor(() => expect(view(f.core)?.snapshot.committedBytes).toBe(8000)); }
it('lazily mounts microphone controls and starts the real core only after explicit Start with one original writer job', async () => {
  const f = await fixture(); expect(f.factoryCalls).toEqual([]); expect(f.physicalMic).not.toHaveBeenCalled(); expect(f.calls).toEqual([]);
  render(<Surface core={f.core} />); expect(screen.getByRole('heading', { name: '마이크 녹음' })).toBeTruthy();
  await userEvent.setup().click(screen.getByRole('button', { name: '녹음 시작' })); await vi.waitFor(() => expect(view(f.core)?.snapshot.state).toBe('recording'));
  expect(f.factoryCalls).toHaveLength(1); expect(f.writerJobs).toEqual([f.factoryCalls[0].job]); expect(f.calls).toEqual([]); expect(f.physicalMic).not.toHaveBeenCalled();
});
it('synchronously rejects duplicate Start and permits Cancel while the original permission request is unresolved', async () => {
  const f = await fixture(), rig = new Rig(), hold = gate(); rig.holdPermission = hold; f.rigs.push(rig);
  const first = Promise.resolve(f.core.startRecording?.(f.id)); const observed = first.catch(() => {});
  await vi.waitFor(() => expect(f.factoryCalls).toHaveLength(1)); expect(view(f.core)?.snapshot.state).toBe('permission');
  await expect(Promise.resolve(f.core.startRecording?.(f.id))).rejects.toMatchObject({ code: 'busy' });
  await f.core.abortRecording?.(f.id); expect(view(f.core)?.snapshot.state).toBe('aborted'); hold.release(); await observed;
  expect(rig.track.stop).toHaveBeenCalled(); expect(f.calls).toEqual([]);
});
it('expires duplicate-command status without cancelling or repeating the recording', async () => {
  const f = await fixture(); await captured(f);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    view(f.core)!.onStart(); view(f.core)!.onStart();
    await Promise.resolve(); await Promise.resolve();
    expect(f.core.getSnapshot().notice).toBe('작업 중이에요.');
    await vi.advanceTimersByTimeAsync(3000);
    expect(f.core.getSnapshot().notice).toBeNull();
    expect(view(f.core)?.snapshot.state).toBe('recording');
    expect(f.factoryCalls).toHaveLength(1); expect(f.rigs[0].track.stop).not.toHaveBeenCalled(); expect(f.calls).toEqual([]);
  } finally { vi.useRealTimers(); }
});
it('binds real pause/resume snapshots and lets Stop overtake a pending Pause without fake Saved', async () => {
  const f = await fixture(); await captured(f); await f.core.pauseRecording?.(f.id); expect(view(f.core)?.snapshot.state).toBe('paused'); expect(f.rigs[0].track.stop).not.toHaveBeenCalled();
  await f.core.resumeRecording?.(f.id); expect(view(f.core)?.snapshot.state).toBe('recording');
  const hold = gate(); f.rigs[0].holdPause = hold; const pause = Promise.resolve(f.core.pauseRecording?.(f.id)); const observed = pause.catch(() => {});
  expect(view(f.core)?.pendingAction).toBe('pause'); const stop = Promise.resolve(f.core.stopRecording?.(f.id)); expect(view(f.core)?.snapshot.state).not.toBe('saved');
  await stop; hold.release(); await observed; expect(view(f.core)?.snapshot.state).toBe('saved'); expect(f.rigs[0].track.stop).toHaveBeenCalled(); expect(f.calls).toEqual([]);
});
it('adopts the actual durable Writer project and prepares its retained WAV after reload without whole-source Blob or provider traffic', async () => {
  const f = await fixture(); await captured(f); const original = f.core.getSnapshot().projects[0]; await f.core.stopRecording?.(f.id);
  const p = f.core.getSnapshot().projects[0]; expect(p.sourceAssets).toHaveLength(1); expect(p.retainedAudio?.sourceIds).toEqual([p.sourceAssets[0].id]); expect(p.title).toBe(original.title); expect(p.minutesSettings).toEqual(original.minutesSettings);
  expect(await f.session().listSourceDrafts(f.id, createJobContext())).toEqual([]); expect(f.core.getSnapshot().sourcePreviewUrl).toBeNull();
  await f.core.lock(); await f.core.unlock('TEST_ONLY microphone integration phrase'); await f.core.prepareAudio(f.id);
  expect(f.sourceReads).toEqual([44]); expect(f.core.getSnapshot().preparation?.stage).toBe('complete'); expect(f.core.getSnapshot().projects[0].preparedChunks).toHaveLength(1); expect(f.calls).toEqual([]);
});
it.each(['navigation','lock','dispose','owner-loss','reset'] as const)('cuts the real microphone synchronously on %s and suppresses every late core callback', async boundary => {
  const f = await fixture(); await captured(f); const late = f.factoryCalls[0].onState!;
  if (boundary === 'navigation') { f.core.getSnapshot().onNavigateAfterStop!('home'); expect(f.rigs[0].track.stop).toHaveBeenCalled(); await vi.waitFor(() => expect(f.core.getSnapshot().screen).toBe('home')); }
  else if (boundary === 'lock') { const promise = f.core.lock(); expect(f.rigs[0].track.stop).toHaveBeenCalled(); expect(f.core.getSnapshot().recording).toBeNull(); await promise; }
  else if (boundary === 'dispose') { const promise = f.core.dispose(); expect(f.rigs[0].track.stop).toHaveBeenCalled(); await promise; }
  else if (boundary === 'reset') { const promise = f.core.resetVault(); expect(f.rigs[0].track.stop).toHaveBeenCalled(); await promise; }
  else { const promise = f.session().lock('manual'); expect(f.rigs[0].track.stop).toHaveBeenCalled(); await promise; }
  late({ state: 'saved', sampleRateHz: 16000, acceptedSamples: 4000, committedSamples: 4000, bodyBytes: 8000, committedBytes: 8000, durationMs: 250, inputLevel: 0, source: { id: 'TEST_ONLY_LATE', fileName: 'TEST_ONLY_LATE.wav', bytes: 8044, container: 'wav', codec: 'pcm_s16le', durationMs: 250, sampleRateHz: 16000, channels: 1 }, error: null });
  expect(view(f.core)).toBeNull(); expect(f.core.getSnapshot().projects.some(p => p.sourceAssets.some(s => s.id === 'TEST_ONLY_LATE'))).toBe(false); expect(f.calls).toEqual([]);
});
it('retains aborted committed draft bytes after encrypted reload and blocks fresh capture without inventing a resumed clock', async () => {
  const f = await fixture(); await captured(f); await f.core.abortRecording?.(f.id); expect(view(f.core)?.interruptedCommittedBytes).toBe(8000);
  await f.core.lock(); await f.core.unlock('TEST_ONLY microphone integration phrase'); f.core.getSnapshot().onNavigate!('import',f.id); await vi.waitFor(() => expect(f.core.getSnapshot().screen).toBe('import'));
  expect(view(f.core)?.interruptedCommittedBytes).toBe(8000); expect(view(f.core)?.snapshot.durationMs).toBe(0);
  await expect(Promise.resolve(f.core.startRecording?.(f.id))).rejects.toThrow(); expect(f.factoryCalls).toHaveLength(1); expect(f.calls).toEqual([]);
});
it('blocks a zero-byte incomplete draft before creating a recorder or requesting permission', async () => {
  const f = await fixture(), writer = await f.session().createSourceWriter(f.id,'TEST_ONLY_ZERO_DRAFT',{sampleRateHz:16000,channels:1},createJobContext()); await writer.abort();
  await expect(Promise.resolve(f.core.startRecording?.(f.id))).rejects.toThrow(); expect(f.factoryCalls).toEqual([]); expect(f.physicalMic).not.toHaveBeenCalled();
  expect(view(f.core)?.interruptedCommittedBytes).toBe(0); expect(view(f.core)?.startBlockedReason).toBe('interrupted-draft');
});
it('blocks an otherwise source-empty meeting with persisted run history without changing its data', async () => {
  const f = await fixture(), p = f.core.getSnapshot().projects[0], changed = { ...p, runs: [{ id:'TEST_ONLY_HISTORY',projectId:f.id,state:'failed' as const,checkpoint:null }] };
  await f.session().store.checkpoint({ project:changed,runId:null,audioRecords:[] },createJobContext());
  await expect(Promise.resolve(f.core.startRecording?.(f.id))).rejects.toThrow(); expect(f.factoryCalls).toEqual([]); expect((await f.session().store.readProject(f.id,createJobContext()))!.runs).toEqual(changed.runs);
});
it('rejects import, preparation and provider work during capture while preserving explicit navigation', async () => {
  const f = await fixture(); await start(f);
  await expect(f.core.importFile(f.id, new File(['TEST_ONLY'], 'TEST_ONLY_IMPORT.wav'))).rejects.toMatchObject({ code:'busy' });
  await expect(f.core.prepareAudio(f.id)).rejects.toMatchObject({ code:'busy' }); await expect(f.core.startSTT(f.id,{ acknowledged:true,modelId:'gpt-transcribe' })).rejects.toMatchObject({ code:'busy' });
  f.core.getSnapshot().onUpdateMeeting!(f.id,{title:'TEST_ONLY forbidden staged edit'}); expect(f.core.getSnapshot().projects[0].title).not.toBe('TEST_ONLY forbidden staged edit');
  expect(() => f.core.setMinutesInstructions(f.id, 'TEST_ONLY forbidden staged instructions')).toThrow(); expect(f.core.getSnapshot().projects[0].minutesSettings.instructions).toBe('');
  render(<Surface core={f.core} />); expect((screen.getByRole('button',{name:'Minutes of Meeting'}) as HTMLButtonElement).disabled).toBe(false); expect((screen.getByLabelText('음성 파일 선택') as HTMLInputElement).disabled).toBe(true);
  expect(f.calls).toEqual([]);
});
it('aborts a late writer factory result against its original canceled job without promotion or new source', async () => {
  const hold = gate(), entered = gate(); let lateWriter: SourceWriter | null = null;
  const f = await fixture(session => new Proxy(Object.create(session) as VaultSession,{get(target,key){if(key==='createSourceWriter')return async(...args:Parameters<VaultSession['createSourceWriter']>)=>{lateWriter=await session.createSourceWriter(...args);entered.release();await hold.promise;return lateWriter;};return Reflect.get(target,key);}}));
  const first = Promise.resolve(f.core.startRecording?.(f.id)), observed = first.catch(() => {}); await entered.promise;
  await f.core.abortRecording?.(f.id); expect(f.factoryCalls[0].job.signal.aborted).toBe(true); hold.release(); await observed;
  expect((await f.session().store.readProject(f.id,createJobContext()))!.sourceAssets).toEqual([]); expect(f.rigs[0].track.stop).toHaveBeenCalled(); expect(f.calls).toEqual([]);
});
it('keeps failed encrypted finalization out of Saved and requires explicit cleanup', async () => {
  const f = await fixture(session => new Proxy(Object.create(session) as VaultSession,{get(target,key){if(key==='createSourceWriter')return async(...args:Parameters<VaultSession['createSourceWriter']>)=>{const writer=await session.createSourceWriter(...args);return{...writer,finalize:async()=>{throw new Error('TEST_ONLY finalize failed');}};};return Reflect.get(target,key);}}));
  await captured(f); await expect(Promise.resolve(f.core.stopRecording?.(f.id))).rejects.toThrow(); expect(view(f.core)?.snapshot.state).toBe('error'); expect(f.core.getSnapshot().projects[0].sourceAssets).toEqual([]);
  await f.core.abortRecording?.(f.id); expect(view(f.core)?.interruptedCommittedBytes).toBe(8000); expect(f.calls).toEqual([]);
});

it('keeps the entire abort handoff fenced until actual draft/project reads finish', async () => {
  const hold = gate(), entered = gate(); let holding = false;
  const f = await fixture(session => new Proxy(Object.create(session) as VaultSession, { get(target,key) {
    if(key==='store')return new Proxy(Object.create(session.store) as VaultSession['store'],{get(store,key){
      if(key==='readProject')return async(...args:Parameters<VaultSession['store']['readProject']>)=>{const p=await session.store.readProject(...args);if(holding){holding=false;entered.release();await hold.promise;}return p;};return Reflect.get(store,key);
    }});return Reflect.get(target,key);
  }}));
  await captured(f); holding=true; const abort=Promise.resolve(f.core.abortRecording?.(f.id)), observed=abort.catch(()=>{}); await entered.promise;
  expect(view(f.core)?.pendingAction).toBe('abort'); expect(f.core.getSnapshot().busy).toBe(true);
  await expect(Promise.resolve(f.core.startRecording?.(f.id))).rejects.toMatchObject({code:'busy'});
  hold.release(); await abort; await observed; expect(view(f.core)?.interruptedCommittedBytes).toBe(8000); expect(view(f.core)?.pendingAction).toBeNull(); expect(f.calls).toEqual([]);
});
it('does not publish an old abort handoff failure into a newly unlocked session', async () => {
  const hold = gate(), entered = gate(); let holding = false;
  const f = await fixture(session => new Proxy(Object.create(session) as VaultSession, { get(target,key) {
    if(key==='store')return new Proxy(Object.create(session.store) as VaultSession['store'],{get(store,key){
      if(key==='readProject')return async(...args:Parameters<VaultSession['store']['readProject']>)=>{const p=await session.store.readProject(...args);if(holding){holding=false;entered.release();await hold.promise;}return p;};return Reflect.get(store,key);
    }});return Reflect.get(target,key);
  }}));
  await captured(f); holding=true; const abort=Promise.resolve(f.core.abortRecording?.(f.id)), observed=abort.catch(error=>error); await entered.promise;
  expect(f.rigs[0].track.stop).toHaveBeenCalled(); await f.core.lock(); await f.core.unlock('TEST_ONLY microphone integration phrase');
  expect(f.core.getSnapshot().session).toBe('unlocked'); expect(f.core.getSnapshot().error).toBeNull();
  hold.release(); expect(await observed).toMatchObject({name:'AbortError'});
  expect(f.core.getSnapshot().error).toBeNull(); expect(f.core.getSnapshot().busy).toBe(false);
  const nextId=await f.core.createMeeting(); f.rigs.push(new Rig()); await f.core.startRecording?.(nextId); expect(f.factoryCalls).toHaveLength(2); expect(f.calls).toEqual([]); expect(f.physicalMic).not.toHaveBeenCalled();
});
it('keeps a genuine current abort handoff storage failure save-blocked', async () => {
  let failing = false;
  const f = await fixture(session => new Proxy(Object.create(session) as VaultSession, { get(target,key) {
    if(key==='store')return new Proxy(Object.create(session.store) as VaultSession['store'],{get(store,key){
      if(key==='readProject')return async(...args:Parameters<VaultSession['store']['readProject']>)=>{const p=await session.store.readProject(...args);if(failing){failing=false;throw new Error('TEST_ONLY current abort handoff read failure');}return p;};return Reflect.get(store,key);
    }});return Reflect.get(target,key);
  }}));
  await captured(f); failing=true;
  await expect(Promise.resolve(f.core.abortRecording?.(f.id))).rejects.toThrow('TEST_ONLY current abort handoff read failure');
  expect(f.rigs[0].track.stop).toHaveBeenCalled(); expect(f.core.getSnapshot().session).toBe('unlocked'); expect(f.core.getSnapshot().error).toBeTruthy(); expect(f.core.getSnapshot().busy).toBe(true);
  await expect(f.core.createMeeting()).rejects.toMatchObject({code:'storage'}); expect(f.calls).toEqual([]); expect(f.physicalMic).not.toHaveBeenCalled();
});
it('keeps core Saved private until durable handoff and suppresses that held handoff after lock', async () => {
  const hold=gate(), entered=gate(); let holding=false;
  const f=await fixture(session=>new Proxy(Object.create(session) as VaultSession,{get(target,key){
    if(key==='store')return new Proxy(Object.create(session.store) as VaultSession['store'],{get(store,key){if(key==='readProject')return async(...args:Parameters<VaultSession['store']['readProject']>)=>{const p=await session.store.readProject(...args);if(holding){holding=false;entered.release();await hold.promise;}return p;};return Reflect.get(store,key);}});return Reflect.get(target,key);
  }}));
  await captured(f); holding=true; const stop=Promise.resolve(f.core.stopRecording?.(f.id)), observed=stop.catch(()=>{}); await entered.promise;
  expect(view(f.core)?.snapshot.state).toBe('saving'); expect(f.core.getSnapshot().projects[0].sourceAssets).toEqual([]);
  await f.core.lock(); expect(view(f.core)).toBeNull(); hold.release(); await observed; expect(f.core.getSnapshot().projects).toEqual([]);
  await f.core.unlock('TEST_ONLY microphone integration phrase'); expect(f.core.getSnapshot().projects[0].sourceAssets).toHaveLength(1); expect(f.calls).toEqual([]);
});
