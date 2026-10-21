// Keyless retained-source integration: real encrypted vault and ordinary media;
// the injected media seam is used only where bounded transport is under test.
import { webcrypto } from 'node:crypto';
import { File as NodeFile } from 'node:buffer';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createMeetingController, type MeetingController, type ControllerOptions } from '../src/react-app/controller';
import { createVaultSession, type VaultSession } from '../src/react-app/vault/session';
import { createLocalMediaWorker, type MediaProgress } from '../src/react-app/media/worker';
import { cancelJobs, createJobContext } from '../src/react-app/domain/jobs';
import type { JobContext, MeetingProject, PreparedChunk, MinutesRun } from '../src/react-app/domain/types';
import { readMediaRange, type MediaInput } from '../src/react-app/media/io';
import { openVaultDatabase } from '../src/react-app/vault/store';

const secret = 'TEST_ONLY retained controller fixture phrase';
const active: MeetingController[] = [];
const heldReleases: (() => void)[] = [];
beforeAll(() => { Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto }); });
afterEach(async () => {
  try { for (const release of heldReleases.splice(0)) release(); for (const core of active.splice(0)) await core.dispose(); }
  finally { cancelJobs(); vi.restoreAllMocks(); vi.unstubAllGlobals(); }
});
function wav(): File {
  const bytes = new Uint8Array(32044), view = new DataView(bytes.buffer), text = (at: number, value: string) => [...value].forEach((c, i) => { bytes[at + i] = c.charCodeAt(0); });
  text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVE'); text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, 32000, true);
  for (let i = 0; i < 16000; i++) view.setInt16(44 + i * 2, Math.sin(i * .2) * 12000, true);
  return new NodeFile([bytes], 'TEST_ONLY_RETAINED_SOURCE.wav', { type: 'audio/wav' }) as unknown as File;
}
function setup(options: { session?: (session: VaultSession) => VaultSession; mediaWorkerFactory?: ControllerOptions['mediaWorkerFactory'] } = {}) {
  const indexedDB = new IDBFactory(), databaseName = crypto.randomUUID(), calls: string[] = [];
  const workerErrors: unknown[] = [];
  let session!: VaultSession;
  const core = createMeetingController({ indexedDB, databaseName,
    sessionFactory: hooks => { session = createVaultSession({ ...hooks, indexedDB, databaseName, testOnlyOwnership: { acquire: async () => () => {} } }); return options.session?.(session) ?? session; },
    mediaWorkerFactory: progress => {
      const worker = (options.mediaWorkerFactory ?? createLocalMediaWorker)(progress);
      return { async inspect(...args) { try { return await worker.inspect(...args); } catch (error) { workerErrors.push(error); throw error; } }, async start(...args) { try { return await worker.start(...args); } catch (error) { workerErrors.push(error); throw error; } }, async next() { try { return await worker.next(); } catch (error) { workerErrors.push(error); throw error; } }, terminate() { worker.terminate(); } };
    },
    fetch: async url => { calls.push(String(url)); throw new Error('TEST_ONLY provider request forbidden'); },
    objectUrls: { create: () => `blob:TEST_ONLY-${crypto.randomUUID()}`, revoke() {} },
  });
  active.push(core);
  return { core, indexedDB, databaseName, calls, workerErrors, session: () => session };
}
async function imported(options: Parameters<typeof setup>[0] = {}) {
  const f = setup(options); await f.core.initialize(); await f.core.createVault(secret);
  const id = await f.core.createMeeting(), file = wav(); await f.core.importFile(id, file);
  return { ...f, id, file };
}
const MIB = 1048576;
const pattern = (start: number, end: number) => Uint8Array.from({ length: end - start }, (_, i) => (start + i) % 251);
class LazySource extends Blob {
  readonly reads: number[] = [];
  constructor(private readonly byteCount: number) { super([], { type: 'audio/wav' }); }
  override get size() { return this.byteCount; }
  override async arrayBuffer(): Promise<ArrayBuffer> { throw new Error('TEST_ONLY whole-original read forbidden'); }
  override slice(start = 0, end = this.size): Blob { expect(end - start).toBeLessThanOrEqual(MIB); this.reads.push(end - start); return new Blob([pattern(start, end)]); }
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
// Explicit transport-only codec fixture. Real WAV→MP3 and independent codec
// validation are covered above/by the unchanged reviewed media suite.
function transportWorker(duration = 1000, inspect?: (input: MediaInput, job: JobContext) => Promise<void>, empty = false): NonNullable<ControllerOptions['mediaWorkerFactory']> {
  return progress => {
    let job: JobContext, index = 0;
    const ranges = duration === 1000 ? [{ sourceStartMs: 0, sourceEndMs: 1000 }] : [{ sourceStartMs: 0, sourceEndMs: 300000 }, { sourceStartMs: 295000, sourceEndMs: 310000 }];
    return {
      async inspect(input, context) {
        expect(context).toBeDefined(); job = context!; await (inspect ?? (async (source, received) => { await readMediaRange(source, 0, 12, received); }))(input, job);
        return { asset: { id: crypto.randomUUID(), fileName: input.name, bytes: input.size, container: 'wav', codec: 'pcm_s16le', durationMs: duration, channels: 1, sampleRateHz: 16000 }, decodedSamples: duration * 16, originalEncoding: { delaySamples: null, paddingSamples: null } };
      },
      async start(_input, _source, _options, _target, _decoded, received) { expect(received).toBe(job); job.assertActive(); },
      async next() {
        job.assertActive(); if (empty || index === ranges.length) return { done: true, value: undefined };
        const range = ranges[index++]; progress?.({ sourceProcessedMs: range.sourceEndMs, durationMs: duration, pcmBytes: 0, encodedBytes: 24 });
        return { done: false, value: { range, audio: new Blob(['TEST_ONLY encoded transport fixture']) } };
      }, terminate() {},
    };
  };
}
async function partial(options: Parameters<typeof setup>[0] = {}) {
  const f = await imported({ mediaWorkerFactory: transportWorker(310000), ...options });
  const p = f.core.getSnapshot().projects[0], source = { ...p.sourceAssets[0], durationMs: 310000 }, audio = new Blob(['TEST_ONLY completed first chunk']);
  const chunk: PreparedChunk = { id: crypto.randomUUID(), sourceId: source.id, index: 0, sourceStartMs: 0, sourceEndMs: 300000, encodingOffsetMs: 69, encodedBytes: audio.size, mimeType: 'audio/mpeg', codec: 'mp3', audioRecordId: crypto.randomUUID() };
  const rawId = crypto.randomUUID(), runId = crypto.randomUUID(), versionId = crypto.randomUUID(), editedId = crypto.randomUUID(), batchId = crypto.randomUUID();
  const segment = { id: crypto.randomUUID(), text: 'TEST_ONLY original transcript', sourceStartMs: 0, sourceEndMs: 300000, rawIds: [rawId] };
  const version = { id: versionId, parentId: null, rawIds: [rawId], segments: [segment], issues: [], missingRanges: [[295000, 310000] as const], batchId };
  const project: MeetingProject = { ...p, sourceAssets: [source], preparedChunks: [chunk], rawTranscripts: [{ id: rawId, chunkId: chunk.id, runId, response: { text: segment.text, TEST_ONLY: true }, text: segment.text, segments: [segment], timing: 'chunk', speakerScope: 'none', execution: null }], transcriptVersions: [version, { ...version, id: editedId, parentId: versionId, segments: [{ ...segment, text: 'TEST_ONLY edited transcript' }] }], selectedTranscriptVersionId: editedId,
    runs: [{ id: runId, projectId: p.id, state: 'saving', checkpoint: null, intent: { kind: 'stt', chunkId: chunk.id, requestedModel: 'TEST_ONLY past model', expectedLanguages: ['en'], rateSnapshot: null, requestedEndpoint: null, sttBatchId: batchId, sttPurpose: 'initial' } }],
    sttBatches: [{ id: batchId, parentBatchId: null, parentTranscriptVersionId: null, sourceId: source.id, chunkIds: [chunk.id], modelId: 'TEST_ONLY past model', languages: ['en'], route: { connectionId: 'openai', provider: 'openai', modelId: 'TEST_ONLY past model', stage: 'stt', endpointTag: null }, purpose: 'initial', createdAt: '2026-10-02T00:00:00Z', parentSelectedRawIdsByChunk: {}, attemptRunIds: [runId], selectedRawIdsByChunk: { [chunk.id]: rawId } }],
  };
  const saved = await f.session().store.checkpoint({ project, runId, audioRecords: [{ recordId: chunk.audioRecordId, audio }] }, createJobContext());
  const minutesId = crypto.randomUUID(), revisionId = crypto.randomUUID();
  const minutes: MinutesRun = { id: minutesId, transcriptVersionId: editedId, settings: p.minutesSettings, generatedMarkdown: '# TEST_ONLY existing minutes', requestedModel: 'TEST_ONLY past minutes model', returnedModel: null, actualProvider: null,
    usage: { inputTokens: null, outputTokens: null, durationSeconds: null, audioInputTokens: null, textInputTokens: null, audioOutputTokens: null, textOutputTokens: null, elapsedMs: 0, cost: null, costKind: 'unavailable', currency: null, rateSource: null, rateCheckedAt: null, rateSnapshot: null } };
  await f.session().store.checkpoint({ project: { ...saved.project, minutesRuns: [minutes], minutesRevisions: [{ id: revisionId, runId: minutesId, parentId: null, markdown: '# TEST_ONLY edited minutes' }], selectedMinutesRevisionId: revisionId, runs: [...saved.project.runs, { id: minutesId, projectId: p.id, state: 'saving', checkpoint: null, intent: { kind: 'minutes', chunkId: null, requestedModel: minutes.requestedModel, expectedLanguages: [], rateSnapshot: null, requestedEndpoint: 'TEST_ONLY exact past route' } }] }, runId: minutesId, audioRecords: [] }, createJobContext());
  await f.core.lock(); await f.core.unlock(secret);
  return { ...f, before: f.core.getSnapshot().projects[0] };
}

describe('controller retained range-reader preparation', () => {
  it('binds real phase progress to one preparation and records foreground return without inventing work', async () => {
    const entered = deferred(), gate = deferred(); heldReleases.push(gate.resolve);
    let report: ((progress: MediaProgress) => void) | undefined;
    const f = await imported({ mediaWorkerFactory: progress => {
      report = progress; const worker = transportWorker()(progress);
      return { ...worker, async next() { entered.resolve(); await gate.promise; return worker.next(); } };
    } });
    let now = 1000; vi.spyOn(Date, 'now').mockImplementation(() => now);
    const work = f.core.prepareAudio(f.id); void work.catch(() => {}); await entered.promise;
    const initial = f.core.getSnapshot().preparation!;
    expect(initial).toMatchObject({ startedAtMs: 1000, sourceId: f.core.getSnapshot().projects[0].sourceAssets[0].id });
    expect(initial.jobId).toEqual(expect.any(String)); expect(initial.settingsFingerprint).toEqual(expect.any(String));
    now = 1100;
    report?.({ stage: 'decoding', sourceProcessedMs: 0, durationMs: 1000, phaseProcessedMs: 500, phaseDurationMs: 1000, pcmBytes: 0, encodedBytes: 0 } as MediaProgress);
    expect(f.core.getSnapshot().preparation).toMatchObject({ stage: 'decoding', startedAtMs: 1000, lastProgressAtMs: 1100, phaseProcessedMs: 500, sourceProcessedMs: 0 });
    now = 1150; await f.core.noteBackground();
    expect(f.core.getSnapshot().preparation).toMatchObject({ backgroundCount: 1, lastProgressAtMs: 1100 });
    now = 1200; f.core.checkScreenExpiry();
    expect(f.core.getSnapshot().preparation).toMatchObject({ lastForegroundAtMs: 1200, lastProgressAtMs: 1100, backgroundDurationMs: 50 });
    now = 1300;
    report?.({ stage: 'preparing', sourceProcessedMs: 400, durationMs: 1000, pcmBytes: 0, encodedBytes: 1 } as MediaProgress);
    now = 1400;
    report?.({ stage: 'verifying', sourceProcessedMs: 0, durationMs: 1000, phaseProcessedMs: 250, phaseDurationMs: 1000, pcmBytes: 0, encodedBytes: 1 } as MediaProgress);
    expect(f.core.getSnapshot().preparation).toMatchObject({ stage: 'verifying', startedAtMs: 1000, lastProgressAtMs: 1400, phaseProcessedMs: 250, sourceProcessedMs: 400, completed: 0, savedThroughMs: 0 });
    gate.resolve(); await work;
    expect(f.core.getSnapshot().preparation).toMatchObject({ jobId: initial.jobId, stage: 'complete', startedAtMs: 1000, completed: 1, savedThroughMs: 1000 });
    expect(f.calls).toEqual([]);
  });
  it('publishes a durable stopped summary after cancellation drains and blocks a duplicate run meanwhile', async () => {
    const entered = deferred(), gate = deferred(); heldReleases.push(gate.resolve);
    const f = await partial({ mediaWorkerFactory: progress => {
      const worker = transportWorker(310000)(progress); let calls = 0;
      return { ...worker, async next() { if (++calls === 2) { entered.resolve(); await gate.promise; } return worker.next(); } };
    } });
    const work = f.core.prepareAudio(f.id), outcome = work.then(() => null, error => error);
    await entered.promise;
    expect(f.core.getSnapshot().preparation).toMatchObject({ savedThroughMs: 300000, completed: 1 });
    f.core.getSnapshot().onCancelPreparation!();
    expect(f.core.getSnapshot().preparation).toBeNull(); expect(f.core.getSnapshot().busy).toBe(true);
    await expect(f.core.prepareAudio(f.id)).rejects.toMatchObject({ code: 'busy' });
    gate.resolve(); expect(await outcome).toMatchObject({ name: 'AbortError' }); await vi.waitFor(() => expect(f.core.getSnapshot().busy).toBe(false));
    expect(f.core.getSnapshot().preparation).toMatchObject({ stage: 'stopped', completed: 1, total: 2, savedThroughMs: 300000, savedEncodedBytes: f.before.preparedChunks[0].encodedBytes });
    expect(f.core.getSnapshot().projects[0]).toEqual(f.before); expect(f.calls).toEqual([]);
  });
  it('prepares the real encrypted original after reload without whole-source stream reconstruction or provider requests', async () => {
    let streamed = 0, opened = 0, readerFailure: unknown;
    const f = await imported({ session: session => new Proxy(Object.create(session) as VaultSession, { get(target, key) {
      if (key === 'streamSource') return () => { streamed++; throw new Error('TEST_ONLY whole-source reconstruction forbidden'); };
      if (key === 'openRetainedSource') return async (...args: Parameters<VaultSession['openRetainedSource']>) => {
        opened++;
        try { const reader = await session.openRetainedSource(...args); return { size: reader.size, async read(start: number, end: number, job: Parameters<typeof reader.read>[2]) {
          expect(job).toBe(args[1]); expect(end - start).toBeLessThanOrEqual(1048576);
          try { return await reader.read(start, end, job); } catch (error) { readerFailure = error; throw error; }
        } }; } catch (error) { readerFailure = error; throw error; }
      };
      return Reflect.get(target, key);
    } }) });
    await f.core.lock(); await f.core.unlock(secret);
    try { await f.core.prepareAudio(f.id); } catch (error) { expect(readerFailure).toBeUndefined(); expect(f.workerErrors).toEqual([]); throw error; }
    expect(opened).toBe(1); expect(streamed).toBe(0); expect(f.calls).toEqual([]);
    const p = f.core.getSnapshot().projects[0];
    expect(p.preparedChunks).toHaveLength(1); expect(p.preparedChunks[0]).toMatchObject({ sourceId: p.sourceAssets[0].id, sourceStartMs: 0, sourceEndMs: 1000 });
    expect(f.core.getSnapshot().preparation).toMatchObject({ stage: 'complete', completed: 1 });
    await f.core.lock(); await f.core.unlock(secret); expect(f.core.getSnapshot().projects[0].preparedChunks).toEqual(p.preparedChunks); expect(f.calls).toEqual([]);
  });
  it('keeps the original File preparation path and does not open a retained reader', async () => {
    let opened = 0, seen: MediaInput | undefined;
    const f = await imported({ session: session => new Proxy(Object.create(session) as VaultSession, { get(target, key) { if (key === 'openRetainedSource') return () => { opened++; throw new Error('TEST_ONLY unexpected retained open'); }; return Reflect.get(target, key); } }), mediaWorkerFactory: progress => {
      const worker = createLocalMediaWorker(progress); return { ...worker, inspect(input, job) { seen = input; return worker.inspect(input, job); } };
    } });
    await f.core.prepareAudio(f.id); expect(seen).toBe(f.file); expect(opened).toBe(0); expect(f.calls).toEqual([]);
  });
  it('prepares a >64MiB lazy encrypted source through exact bounded original-job reads without whole reconstruction', async () => {
    const ranges: [number, number][] = [], audio = new LazySource(65 * MIB + 31); let opening: JobContext | undefined, activeReads = 0, peak = 0;
    const f = setup({ session: session => new Proxy(Object.create(session) as VaultSession, { get(target, key) {
      if (key === 'streamSource') return () => { throw new Error('TEST_ONLY whole-source streaming forbidden'); };
      if (key === 'openRetainedSource') return async (id: string, job: JobContext) => { opening = job; const reader = await session.openRetainedSource(id, job); return { size: reader.size, async read(start: number, end: number, received: JobContext) { expect(received).toBe(job); expect(end - start).toBeLessThanOrEqual(MIB); activeReads++; peak = Math.max(peak, activeReads); ranges.push([start, end]); try { return await reader.read(start, end, received); } finally { activeReads--; } } }; };
      return Reflect.get(target, key);
    } }), mediaWorkerFactory: transportWorker(1000, async (input, job) => {
      expect(job).toBe(opening); expect('slice' in input).toBe(false); expect('arrayBuffer' in input).toBe(false);
      for (const [start, end] of [[0, 12], [MIB - 7, MIB + 13], [audio.size - 17, audio.size]]) expect(new Uint8Array(await readMediaRange(input, start, end, job))).toEqual(pattern(start, end));
    }) });
    await f.core.initialize(); await f.core.createVault(secret); const id = await f.core.createMeeting(), p = f.core.getSnapshot().projects[0], sourceId = crypto.randomUUID();
    await f.session().store.checkpoint({ project: { ...p, sourceAssets: [{ id: sourceId, fileName: 'TEST_ONLY_LAZY_SOURCE.wav', bytes: audio.size, container: 'wav', codec: 'pcm_s16le', durationMs: 1000, channels: 1, sampleRateHz: 16000 }] }, runId: null, audioRecords: [{ recordId: sourceId, audio }] }, createJobContext());
    await f.core.lock(); await f.core.unlock(secret); await f.core.prepareAudio(id);
    expect(audio.reads).toHaveLength(66); expect(Math.max(...audio.reads)).toBe(MIB); expect(peak).toBe(1);
    expect(ranges).toEqual([[0, 12], [MIB - 7, MIB + 13], [audio.size - 17, audio.size]]); expect(f.core.getSnapshot().preparation).toMatchObject({ stage: 'complete', completed: 1 }); expect(f.calls).toEqual([]);
  });
  it('skips a matching durable chunk without replacing IDs, raw associations, selected edits, batches or minutes', async () => {
    const f = await partial(); await f.core.prepareAudio(f.id); const p = f.core.getSnapshot().projects[0];
    expect(p.preparedChunks).toHaveLength(2); expect(p.preparedChunks[0]).toEqual(f.before.preparedChunks[0]);
    for (const key of ['rawTranscripts', 'transcriptVersions', 'selectedTranscriptVersionId', 'sttBatches', 'minutesRuns', 'minutesRevisions', 'selectedMinutesRevisionId', 'runs'] as const) expect(p[key]).toEqual(f.before[key]);
    expect(f.core.getSnapshot().preparation).toMatchObject({ stage: 'complete', completed: 2, total: 2, savedEncodedBytes: p.preparedChunks.reduce((bytes, chunk) => bytes + chunk.encodedBytes, 0) });
    await f.core.lock(); await f.core.unlock(secret); expect(f.core.getSnapshot().projects[0]).toEqual(p); expect(f.calls).toEqual([]);
  });
  it('retains the completed snapshot and reports failed preparation when the new encrypted chunk save fails', async () => {
    let fail = true;
    const f = await partial({ session: session => new Proxy(Object.create(session) as VaultSession, { get(target, key) {
      if (key === 'store') { const store = session.store; return { ...store, async checkpoint(write: Parameters<typeof store.checkpoint>[0], job: JobContext) { if (fail && write.project.preparedChunks.length === 2 && write.audioRecords.length) throw new DOMException('TEST_ONLY quota failure', 'QuotaExceededError'); return store.checkpoint(write, job); } }; }
      return Reflect.get(target, key);
    } }) });
    await expect(f.core.prepareAudio(f.id)).rejects.toMatchObject({ code: 'storage' }); expect(f.core.getSnapshot().projects[0]).toEqual(f.before);
    expect(f.core.getSnapshot().preparation).toMatchObject({ stage: 'failed', completed: 1, total: 2, savedEncodedBytes: f.before.preparedChunks[0].encodedBytes });
    await expect(f.core.prepareAudio(f.id)).rejects.toMatchObject({ code: 'storage' }); expect(f.calls).toEqual([]);
    fail = false; await f.core.lock(); await f.core.unlock(secret); const recovered = f.core.getSnapshot().projects[0];
    expect(recovered.preparedChunks).toHaveLength(2); expect(recovered.preparedChunks[0]).toEqual(f.before.preparedChunks[0]); expect(recovered.rawTranscripts).toEqual(f.before.rawTranscripts);
  });
  it('fails corrupt authenticated source metadata without changing saved project data or falling back to a stream', async () => {
    let streamed = 0;
    const f = await partial({ session: session => new Proxy(Object.create(session) as VaultSession, { get(target, key) { if (key === 'streamSource') return () => { streamed++; throw new Error('TEST_ONLY fallback forbidden'); }; return Reflect.get(target, key); } }) });
    const db = await openVaultDatabase(f.indexedDB, f.databaseName);
    try { await new Promise<void>((resolve, reject) => { const tx = db.transaction('records', 'readwrite'), records = tx.objectStore('records'), request = records.get(f.before.sourceAssets[0].id); request.onsuccess = () => { const envelope = request.result, ciphertext = envelope.ciphertext.slice(0); new Uint8Array(ciphertext)[0] ^= 1; records.put({ ...envelope, ciphertext }); }; tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); }); }
    finally { db.close(); }
    await expect(f.core.prepareAudio(f.id)).rejects.toThrow(); expect(f.core.getSnapshot().preparation).toMatchObject({ stage: 'failed', completed: 1 }); expect(f.core.getSnapshot().projects[0]).toEqual(f.before); expect(streamed).toBe(0); expect(f.calls).toEqual([]);
  });
  it('reports a bounded read failure and keeps completed data instead of completing or falling back', async () => {
    const f = await partial({ session: session => new Proxy(Object.create(session) as VaultSession, { get(target, key) {
      if (key === 'openRetainedSource') return async (id: string, job: JobContext) => { const reader = await session.openRetainedSource(id, job); return { size: reader.size, async read() { throw new Error('TEST_ONLY held storage read failed'); } }; };
      if (key === 'streamSource') return () => { throw new Error('TEST_ONLY fallback forbidden'); }; return Reflect.get(target, key);
    } }) });
    await expect(f.core.prepareAudio(f.id)).rejects.toThrow(); expect(f.core.getSnapshot().preparation).toMatchObject({ stage: 'failed', completed: 1, errorCode: 'local-processing-failed' }); expect(f.core.getSnapshot().projects[0]).toEqual(f.before); expect(f.calls).toEqual([]);
  });
  it('keeps completion failed when the media iterator ends without every required durable chunk', async () => {
    const f = await imported({ mediaWorkerFactory: transportWorker(1000, undefined, true) }); await f.core.lock(); await f.core.unlock(secret);
    await expect(f.core.prepareAudio(f.id)).rejects.toMatchObject({ code: 'invalid-input' }); expect(f.core.getSnapshot().preparation).toMatchObject({ stage: 'failed', completed: 0, total: 1 }); expect(f.core.getSnapshot().projects[0].preparedChunks).toEqual([]); expect(f.calls).toEqual([]);
  });
  it.each([0, Number.MAX_SAFE_INTEGER + 1])('rejects unsafe/nonpositive source byte metadata %s before opening or dispatching', async bytes => {
    let opened = 0;
    const f = await imported({ session: session => new Proxy(Object.create(session) as VaultSession, { get(target, key) { if (key === 'openRetainedSource') return () => { opened++; throw new Error('TEST_ONLY unexpected open'); }; return Reflect.get(target, key); } }) });
    const p = f.core.getSnapshot().projects[0]; await f.session().store.checkpoint({ project: { ...p, sourceAssets: [{ ...p.sourceAssets[0], bytes }] }, runId: null, audioRecords: [] }, createJobContext());
    await f.core.lock(); await f.core.unlock(secret); await expect(f.core.prepareAudio(f.id)).rejects.toThrow(); expect(opened).toBe(0); expect(f.core.getSnapshot().preparation?.stage).toBe('failed'); expect(f.calls).toEqual([]);
  });
  it('rejects a reader size mismatching saved source metadata before codec use', async () => {
    let reads = 0;
    const f = await imported({ session: session => new Proxy(Object.create(session) as VaultSession, { get(target, key) { if (key === 'openRetainedSource') return async (id: string, job: JobContext) => { const reader = await session.openRetainedSource(id, job); return { size: reader.size + 1, read: async () => { reads++; return new ArrayBuffer(0); } }; }; return Reflect.get(target, key); } }) });
    await f.core.lock(); await f.core.unlock(secret); await expect(f.core.prepareAudio(f.id)).rejects.toThrow(); expect(reads).toBe(0); expect(f.core.getSnapshot().preparation?.stage).toBe('failed'); expect(f.calls).toEqual([]);
  });
  it.each(['cancel', 'lock', 'reset'] as const)('fences a held real decrypted read on %s with no late chunk, output or provider call', async action => {
    const entered = deferred(), gate = deferred(); heldReleases.push(gate.resolve); let reads = 0, bytes: Uint8Array | undefined;
    const f = await imported({ session: session => new Proxy(Object.create(session) as VaultSession, { get(target, key) {
      if (key === 'openRetainedSource') return async (id: string, opening: JobContext) => { const reader = await session.openRetainedSource(id, opening); return { size: reader.size, async read(start: number, end: number, job: JobContext) { expect(job).toBe(opening); const output = await reader.read(start, end, job); reads++; bytes = new Uint8Array(output); entered.resolve(); await gate.promise; return output; } }; };
      return Reflect.get(target, key);
    } }) });
    await f.core.lock(); await f.core.unlock(secret); const before = f.core.getSnapshot().projects[0], work = f.core.prepareAudio(f.id), rejected = expect(work).rejects.toMatchObject({ name: 'AbortError' }); await entered.promise;
    if (action === 'cancel') { f.core.getSnapshot().onCancelPreparation!(); expect(f.core.getSnapshot().preparation).toBeNull(); }
    else if (action === 'lock') { await f.core.lock(); expect(f.core.getSnapshot().projects).toEqual([]); }
    else { await f.core.resetVault(); expect(f.core.getSnapshot().session).toBe('new'); expect(f.core.getSnapshot().projects).toEqual([]); }
    gate.resolve(); await rejected; await vi.waitFor(() => expect(f.core.getSnapshot().busy).toBe(false)); expect(reads).toBe(1); expect(bytes?.every(value => value === 0)).toBe(true);
    if (action === 'cancel') expect(f.core.getSnapshot().preparation).toMatchObject({ stage: 'stopped', completed: 0, savedThroughMs: 0 });
    else expect(f.core.getSnapshot().preparation).toBeNull();
    expect(f.calls).toEqual([]);
    if (action === 'lock') await f.core.unlock(secret);
    if (action !== 'reset') expect(f.core.getSnapshot().projects[0]).toEqual(before);
  });
  it('fences a reader opened late after lock before creating a media worker', async () => {
    const entered = deferred(), gate = deferred(); heldReleases.push(gate.resolve); let workers = 0;
    const f = await imported({ mediaWorkerFactory: progress => { workers++; return createLocalMediaWorker(progress); }, session: session => new Proxy(Object.create(session) as VaultSession, { get(target, key) {
      if (key === 'openRetainedSource') return async (id: string, job: JobContext) => { const reader = await session.openRetainedSource(id, job); entered.resolve(); await gate.promise; return reader; }; return Reflect.get(target, key);
    } }) });
    await f.core.lock(); await f.core.unlock(secret); const work = f.core.prepareAudio(f.id), rejected = expect(work).rejects.toMatchObject({ name: 'AbortError' }); await entered.promise;
    await f.core.lock(); gate.resolve(); await rejected; expect(workers).toBe(0); expect(f.core.getSnapshot().projects).toEqual([]); expect(f.calls).toEqual([]);
  });
});
