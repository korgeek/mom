import { afterEach, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore, IDBDatabase } from 'fake-indexeddb';
import { createJobContext, cancelJobs } from '../src/react-app/domain/jobs';
import type { CheckpointResult, CheckpointWrite, JobContext, MeetingProject, SourceAsset } from '../src/react-app/domain/types';
import { createVaultSession, type VaultSession } from '../src/react-app/vault/session';
import { openVaultDatabase, readHeader } from '../src/react-app/vault/store';
import { decryptRecord, encryptRecord, unwrapHeader, type RecordEnvelope } from '../src/react-app/vault/crypto';
import { inspectSource } from '../src/react-app/media/mp3';
import { createAudioPreparer } from '../src/react-app/media/prepare';
import { createLocalMediaWorker } from '../src/react-app/media/worker';
import { MPEGDecoder } from 'mpg123-decoder';
import { createWavHeader, MAX_WAV_BODY_BYTES } from '../src/react-app/media/wav-header';

type Config = { sampleRateHz: number; channels: 1 | 2 };
type Draft = { sourceId: string; projectId: string; config: Config; bodyBytes: number; blockCount: number };
type Writer = { append(bytes: Uint8Array, job: JobContext): Promise<void>; finalize(asset: SourceAsset, job: JobContext): Promise<CheckpointResult>; abort(): Promise<void> };
type WriterSession = VaultSession & { createSourceWriter(projectId: string, sourceId: string, config: Config, job: JobContext): Promise<Writer>; listSourceDrafts(projectId: string, job: JobContext): Promise<readonly Draft[]> };
const secret = 'synthetic incremental source phrase', config: Config = { sampleRateHz: 16000, channels: 1 }, sessions: VaultSession[] = [];
afterEach(async () => { vi.restoreAllMocks(); cancelJobs(); for (const session of sessions.splice(0)) await session.dispose(); });
function project(): MeetingProject {
 return { id: crypto.randomUUID(), title: 'SYNTHETIC_DRAFT_TITLE', icon: 'mic', color: '#2B59C3', pinned: false, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', sourceAssets: [], preparedChunks: [],
  audioOptions: { chunkMinutes: 5, overlapSeconds: 5, bitrateKbps: 32, sampleRateHz: 16000, expectedLanguages: ['ko'] }, rawTranscripts: [], transcriptVersions: [], selectedTranscriptVersionId: null,
  minutesSettings: { outputLanguage: 'ko', sections: ['summary'], instructions: '', modelId: '' }, minutesRuns: [], minutesRevisions: [], selectedMinutesRevisionId: null, runs: [] };
}
function asset(id: string, bodyBytes: number, settings = config): SourceAsset {
 return { id, fileName: 'SYNTHETIC_INCREMENTAL.wav', bytes: 44 + bodyBytes, container: 'wav', codec: 'pcm_s16le', sampleRateHz: settings.sampleRateHz, channels: settings.channels, durationMs: Math.round(bodyBytes / (settings.channels * 2 * settings.sampleRateHz) * 1000) };
}
async function fixture(capturePending?: () => readonly CheckpointWrite[]) {
 const factory = new IDBFactory(), databaseName = crypto.randomUUID(), session = createVaultSession({ indexedDB: factory, databaseName, capturePending, testOnlyOwnership: { acquire: async () => () => {} } }); sessions.push(session);
 await session.create(secret, secret); const p = project(); await session.store.checkpoint({ project: p, runId: null, audioRecords: [] }, createJobContext());
 const api = session as WriterSession, sourceId = crypto.randomUUID(), job = createJobContext();
 expect(api.createSourceWriter, 'unlocked session exposes incremental source writer').toBeTypeOf('function');
 const writer = await api.createSourceWriter(p.id, sourceId, config, job); return { session: api, writer, p, sourceId, job, factory, databaseName };
}
it('durably appends short immutable blocks and atomically promotes header/body without whole Blob assembly', async () => {
 const { session, writer, p, sourceId, job } = await fixture(), lengths = [7, 9, 1024 * 1024, 18]; let offset = 0;
 const wholeBlob = vi.spyOn(Blob.prototype, 'arrayBuffer').mockImplementation(() => { throw new Error('whole Blob source assembly forbidden'); });
 for (const length of lengths) { const bytes = Uint8Array.from({ length }, (_, i) => (offset + i) % 251), pending = writer.append(bytes, job); bytes.fill(0); await pending; offset += length;
  expect(await session.listSourceDrafts(p.id, job)).toMatchObject([{ sourceId, projectId: p.id, bodyBytes: offset }]); }
 await expect(session.openRetainedSource(sourceId, job)).rejects.toThrow(); expect((await session.store.readProject(p.id, job))?.sourceAssets).toEqual([]);
 const result = await writer.finalize(asset(sourceId, offset), job); expect(result.checkpoint.projectId).toBe(p.id); expect(result.project.sourceAssets).toEqual([asset(sourceId, offset)]);
 expect(await session.listSourceDrafts(p.id, job)).toEqual([]); const reader = await session.openRetainedSource(sourceId, job), head = new DataView(await reader.read(0, 44, job));
 await expect(reader.read(0, reader.size, job)).rejects.toThrow(/oversized|range/i);
 expect(head.getUint32(4, true)).toBe(36 + offset); expect(head.getUint32(40, true)).toBe(offset); expect(head.getUint16(20, true)).toBe(1); expect(head.getUint16(34, true)).toBe(16);
 expect([...new Uint8Array(await reader.read(44 + 5, 44 + 21, job))]).toEqual(Array.from({ length: 16 }, (_, i) => (5 + i) % 251));
 expect([...new Uint8Array(await reader.read(44 + 7 + 9 + 1024 * 1024 - 3, 44 + offset, job))]).toEqual(Array.from({ length: 21 }, (_, i) => (offset - 21 + i) % 251));
 // Independent fixture verification only; the writer never collects this body.
 for (let at = 0; at < offset; at += 1024 * 1024) { const body = new Uint8Array(await reader.read(44 + at, 44 + Math.min(offset, at + 1024 * 1024), job)); expect(body.every((value, i) => value === (at + i) % 251)).toBe(true); }
 expect(wholeBlob).not.toHaveBeenCalled();
});
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
it('admits one append, rejects concurrent buffering and acknowledges only committed encrypted bytes', async () => {
 const { session, writer, p, job } = await fixture(), entered = deferred(), release = deferred(), native = crypto.subtle.encrypt.bind(crypto.subtle);
 await expect(session.createSourceWriter(p.id, crypto.randomUUID(), config, job)).rejects.toThrow(/active/i);
 vi.spyOn(crypto.subtle, 'encrypt').mockImplementation(async (...args) => { const result = await native(...args); if (args[2].byteLength === 128) { entered.resolve(); await release.promise; } return result; });
 const pending = writer.append(new Uint8Array(128).fill(9), job); await entered.promise;
 try { await expect(writer.append(new Uint8Array(16), job)).rejects.toThrow(/pending|busy/i); expect(await session.listSourceDrafts(p.id, job)).toMatchObject([{ bodyBytes: 0, blockCount: 0 }]); }
 finally { release.resolve(); } await pending;
 expect(await session.listSourceDrafts(p.id, job)).toMatchObject([{ bodyBytes: 128, blockCount: 1 }]);
 await expect(writer.append(new Uint8Array(1024 * 1024 + 1), job)).rejects.toThrow(/limit|MiB|block/i); await expect(writer.append(new Uint8Array(0), job)).rejects.toThrow();
});
it('rejects conflicting projects, reserved IDs, job mismatch and invalid WAV declarations', async () => {
 const { session, writer, p, sourceId, job } = await fixture(), other = project(); await session.store.checkpoint({ project: other, runId: null, audioRecords: [] }, job);
 await expect(writer.append(new Uint8Array(32), { ...job, epoch: job.epoch + 1 })).rejects.toThrow(/job/i); await writer.append(new Uint8Array(32), job); await writer.abort();
 await expect(session.createSourceWriter(other.id, sourceId, config, job)).rejects.toThrow(); await expect(session.createSourceWriter(p.id, p.id, config, job)).rejects.toThrow();
 const resumed = await session.createSourceWriter(p.id, sourceId, config, job);
 for (const invalid of [{ ...asset(sourceId, 32), id: 'different-source' }, { ...asset(sourceId, 32), bytes: 77 }, { ...asset(sourceId, 32), durationMs: 10 }, { ...asset(sourceId, 32), codec: 'mp3' }, { ...asset(sourceId, 32), sampleRateHz: 48000 }]) await expect(resumed.finalize(invalid, job)).rejects.toThrow();
 await resumed.append(new Uint8Array(1), job); await expect(resumed.finalize(asset(sourceId, 33), job)).rejects.toThrow(/frame|align/i); await resumed.abort();
 await expect(session.createSourceWriter(p.id, sourceId, { sampleRateHz: 0, channels: 1 }, job)).rejects.toThrow();
 await expect(session.createSourceWriter(p.id, sourceId, { sampleRateHz: 16000, channels: 3 } as unknown as Config, job)).rejects.toThrow();
});
it('keeps prior draft receipt intact when an append transaction fails quota', async () => {
 const { session, writer, p, sourceId, job, factory, databaseName } = await fixture(); await writer.append(new Uint8Array(32).fill(1), job);
 const db = await openVaultDatabase(factory, databaseName), before = (await readHeader(db))!.operations, original = IDBObjectStore.prototype.put;
 const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, ...args: [key?: IDBValidKey]) {
  if (this.name === 'records' && (value as RecordEnvelope).recordId === sourceId) { this.transaction.abort(); throw new DOMException('SYNTHETIC_QUOTA', 'QuotaExceededError'); }
  return original.call(this, value, ...args);
 });
 await expect(writer.append(new Uint8Array(64).fill(2), job)).rejects.toThrow(); spy.mockRestore();
 expect((await readHeader(db))!.operations).toBeGreaterThan(before); db.close(); await writer.abort(); await session.lock('manual'); await session.unlock(secret);
 expect(await session.listSourceDrafts(p.id, createJobContext())).toMatchObject([{ bodyBytes: 32, blockCount: 1 }]); await expect(session.openRetainedSource(sourceId, createJobContext())).rejects.toThrow();
});
it('final promotion is atomic, preserves latest unrelated work and can retry its complete draft', async () => {
 const { session, writer, p, sourceId, job } = await fixture(); await writer.append(new Uint8Array(32000).fill(1), job);
 const revision = { id: crypto.randomUUID(), runId: 'SYNTHETIC_LEGACY', parentId: null, markdown: '# latest edited text' };
 const latest: MeetingProject = { ...p, title: 'LATEST_SYNTHETIC_EDIT', minutesSettings: { ...p.minutesSettings, instructions: 'LATEST_INSTRUCTIONS' }, minutesRevisions: [revision], selectedMinutesRevisionId: revision.id,
  rawTranscripts: [{ id: 'synthetic-raw', chunkId: 'legacy-chunk', runId: 'legacy-run', response: { text: 'retained response' }, text: 'retained response', segments: [], timing: 'chunk', speakerScope: 'none', execution: null }],
  transcriptVersions: [{ id: 'synthetic-version', parentId: null, rawIds: ['synthetic-raw'], segments: [], issues: [], missingRanges: [] }], selectedTranscriptVersionId: 'synthetic-version',
  sttBatches: [{ id: 'synthetic-batch', parentBatchId: null, parentTranscriptVersionId: null, sourceId: 'legacy-source', chunkIds: ['legacy-chunk'], modelId: 'legacy-model', languages: ['en'], route: { connectionId: 'synthetic-connection', provider: 'openai', stage: 'stt', modelId: 'legacy-model', endpointTag: null }, purpose: 'initial', createdAt: p.createdAt, parentSelectedRawIdsByChunk: {}, attemptRunIds: ['legacy-run'], selectedRawIdsByChunk: { 'legacy-chunk': 'synthetic-raw' } }] };
 await session.store.checkpoint({ project: latest, runId: null, audioRecords: [] }, job);
 const original = IDBObjectStore.prototype.put, spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, ...args: [key?: IDBValidKey]) {
  if (this.name === 'records' && (value as RecordEnvelope).recordId === p.id) { this.transaction.abort(); throw new DOMException('SYNTHETIC_PROMOTION_ABORT', 'AbortError'); }
  return original.call(this, value, ...args);
 });
 await expect(writer.finalize(asset(sourceId, 32000), job)).rejects.toThrow(); spy.mockRestore(); expect(await session.store.readProject(p.id, job)).toEqual(latest);
 expect(await session.listSourceDrafts(p.id, job)).toMatchObject([{ bodyBytes: 32000, blockCount: 1 }]); await expect(session.openRetainedSource(sourceId, job)).rejects.toThrow();
 const result = await writer.finalize(asset(sourceId, 32000), job); expect(result.project).toMatchObject({ title: latest.title, minutesSettings: latest.minutesSettings, minutesRevisions: latest.minutesRevisions, selectedMinutesRevisionId: revision.id, rawTranscripts: latest.rawTranscripts, transcriptVersions: latest.transcriptVersions, selectedTranscriptVersionId: latest.selectedTranscriptVersionId, sttBatches: latest.sttBatches });
 await expect(writer.append(new Uint8Array(2), job)).rejects.toThrow(); await expect(writer.finalize(asset(sourceId, 32000), job)).rejects.toThrow();
 await expect(session.createSourceWriter(p.id, crypto.randomUUID(), config, job)).rejects.toThrow();
});
it('lock revokes pending native encryption, zeroes its admitted copy and retains prior draft blocks', async () => {
 const { session, writer, p, sourceId, job } = await fixture(); await writer.append(new Uint8Array(32).fill(5), job);
 const native = crypto.subtle.encrypt.bind(crypto.subtle), entered = deferred(), release = deferred(); let held: Uint8Array | undefined;
 vi.spyOn(crypto.subtle, 'encrypt').mockImplementation(async (...args) => { const result = await native(...args); if (args[2].byteLength === 64) { held = args[2] as Uint8Array; entered.resolve(); await release.promise; } return result; });
 const pending = writer.append(new Uint8Array(64).fill(9), job); const rejected = expect(pending).rejects.toThrow(); await entered.promise;
 const locking = session.lock('manual'); expect(session.state).toBe('locking'); expect(held!.every(value => value === 0)).toBe(true); release.resolve(); await rejected; await locking;
 await expect(writer.append(new Uint8Array(2), createJobContext())).rejects.toThrow(); await expect(writer.finalize(asset(sourceId, 32), createJobContext())).rejects.toThrow();
 await session.unlock(secret); expect(await session.listSourceDrafts(p.id, createJobContext())).toMatchObject([{ bodyBytes: 32, blockCount: 1 }]); await expect(session.openRetainedSource(sourceId, createJobContext())).rejects.toThrow();
});
it('local abort drains its one pending copy without cancelling jobs and a fresh session resumes committed bytes', async () => {
 const { session, writer, p, sourceId, job, factory, databaseName } = await fixture(); await writer.append(new Uint8Array(32).fill(3), job);
 const native = crypto.subtle.encrypt.bind(crypto.subtle), entered = deferred(), release = deferred(); let held: Uint8Array | undefined;
 const spy = vi.spyOn(crypto.subtle, 'encrypt').mockImplementation(async (...args) => { const result = await native(...args); if (args[2].byteLength === 64) { held = args[2] as Uint8Array; entered.resolve(); await release.promise; } return result; });
 const pending = writer.append(new Uint8Array(64).fill(9), job), rejected = expect(pending).rejects.toThrow(); await entered.promise;
 const aborted = writer.abort();
 try {
  expect(held!.every(value => value === 0)).toBe(true); expect(session.state).toBe('unlocked'); expect(() => job.assertActive()).not.toThrow();
  await expect(writer.finalize(asset(sourceId, 32), job)).rejects.toThrow();
 } finally { release.resolve(); }
 await rejected; await aborted; spy.mockRestore();
 expect(await session.listSourceDrafts(p.id, job)).toMatchObject([{ sourceId, bodyBytes: 32, blockCount: 1 }]);
 await session.dispose();
 const fresh = createVaultSession({ indexedDB: factory, databaseName, testOnlyOwnership: { acquire: async () => () => {} } }); sessions.push(fresh); await fresh.unlock(secret);
 const next = createJobContext(); expect(await fresh.listSourceDrafts(p.id, next)).toMatchObject([{ sourceId, bodyBytes: 32, blockCount: 1 }]);
 const resumed = await fresh.createSourceWriter(p.id, sourceId, config, next); await resumed.append(new Uint8Array(32).fill(4), next);
 const result = await resumed.finalize(asset(sourceId, 64), next); expect(result.project.sourceAssets).toEqual([asset(sourceId, 64)]);
 const reader = await fresh.openRetainedSource(sourceId, next); expect([...new Uint8Array(await reader.read(44, 108, next))]).toEqual([...new Uint8Array(32).fill(3), ...new Uint8Array(32).fill(4)]);
 expect(await fresh.listSourceDrafts(p.id, next)).toEqual([]);
});
it('lock after append commit fences acknowledgment while reload identifies its committed block', async () => {
 const { session, writer, p, job } = await fixture(), native = IDBDatabase.prototype.transaction; let locking: Promise<void> | undefined;
 vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (this: IDBDatabase, ...args: Parameters<IDBDatabase['transaction']>) {
  const tx = native.apply(this, args); if (args[1] === 'readwrite' && (args[0] === 'records' || Array.isArray(args[0]) && args[0].includes('records') && !args[0].includes('nonces'))) tx.addEventListener('complete', () => { locking ??= session.lock('manual'); }, { once: true }); return tx;
 });
 await expect(writer.append(new Uint8Array(32).fill(7), job)).rejects.toThrow(); expect(locking).toBeDefined(); await locking; vi.restoreAllMocks(); await session.unlock(secret);
 expect(await session.listSourceDrafts(p.id, createJobContext())).toMatchObject([{ bodyBytes: 32, blockCount: 1 }]);
});
it('lock after final promotion preserves its committed source against a stale capture snapshot', async () => {
 let captured: MeetingProject | undefined;
 const { session, writer, p, sourceId, job } = await fixture(() => captured ? [{ project: captured, runId: null, audioRecords: [] }] : []);
 captured = { ...p, title: 'LATEST_CAPTURED_UNRELATED_EDIT' }; await writer.append(new Uint8Array(32).fill(7), job);
 const native = IDBDatabase.prototype.transaction; let locking: Promise<void> | undefined;
 vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (this: IDBDatabase, ...args: Parameters<IDBDatabase['transaction']>) {
  const tx = native.apply(this, args); if (args[1] === 'readwrite' && Array.isArray(args[0]) && args[0].includes('records') && !args[0].includes('nonces')) tx.addEventListener('complete', () => { locking ??= session.lock('manual'); }, { once: true }); return tx;
 });
 await expect(writer.finalize(asset(sourceId, 32), job)).rejects.toThrow(); expect(locking).toBeDefined(); await locking; vi.restoreAllMocks(); captured = undefined; await session.unlock(secret);
 const saved = await session.store.readProject(p.id, createJobContext()); expect(saved).toMatchObject({ title: 'LATEST_CAPTURED_UNRELATED_EDIT', sourceAssets: [asset(sourceId, 32)] }); expect(await session.listSourceDrafts(p.id, createJobContext())).toEqual([]);
});
it('finalized incremental PCM tone passes real WAV inspection, MP3 encoding and independent decode', async () => {
 const { session, writer, sourceId, job } = await fixture(); const pcm = new Uint8Array(64000), view = new DataView(pcm.buffer);
 for (let i = 0; i < 32000; i++) view.setInt16(i * 2, Math.round(1500 * Math.sin(i * .1)), true);
 for (let at = 0; at < pcm.length; at += 997) await writer.append(pcm.subarray(at, at + 997), job);
 const finalized = await writer.finalize(asset(sourceId, pcm.length), job), reader = await session.openRetainedSource(sourceId, job), input = { ...reader, name: finalized.project.sourceAssets[0].fileName };
 const inspected = await inspectSource(input, job); expect(inspected.asset).toMatchObject({ bytes: 64044, container: 'wav', codec: 'pcm_s16le', durationMs: 2000, sampleRateHz: 16000, channels: 1 });
 let current = finalized.project;
 const outputs: Blob[] = [], ranges: { sourceStartMs: number; sourceEndMs: number }[] = [], prepare = createAudioPreparer({ sourceId, workerFactory: createLocalMediaWorker, sink: async (chunk, audio, context) => {
  current = (await session.store.checkpoint({ project: { ...current, preparedChunks: [...current.preparedChunks, chunk] }, runId: null, audioRecords: [{ recordId: chunk.audioRecordId, audio }] }, context)).project;
  outputs.push(await session.store.readAudio(chunk.audioRecordId, context)); ranges.push(chunk);
 } });
 for await (const chunk of prepare(input, finalized.project.audioOptions, job)) expect(chunk.encodedBytes).toBe(outputs[0].size);
 expect(ranges).toMatchObject([{ sourceStartMs: 0, sourceEndMs: 2000 }]); const decoder = new MPEGDecoder(); await decoder.ready;
 try { const result = decoder.decode(new Uint8Array(await outputs[0].arrayBuffer())); expect(result.errors).toEqual([]); expect(result.sampleRate).toBe(16000); expect(result.samplesDecoded / result.sampleRate).toBeGreaterThanOrEqual(2); expect(result.samplesDecoded / result.sampleRate).toBeLessThan(2.2); }
 finally { decoder.free(); }
});
it('lock before final commit leaves completed draft bytes and no complete source', async () => {
 const { session, writer, p, sourceId, job } = await fixture(); await writer.append(new Uint8Array(32).fill(5), job);
 const native = crypto.subtle.encrypt.bind(crypto.subtle), entered = deferred(), release = deferred(); let heldHeader: Uint8Array | undefined;
 vi.spyOn(crypto.subtle, 'encrypt').mockImplementation(async (...args) => { const result = await native(...args); if (args[2].byteLength === 44) { heldHeader = args[2] as Uint8Array; entered.resolve(); await release.promise; } return result; });
 const pending = writer.finalize(asset(sourceId, 32), job), rejected = expect(pending).rejects.toThrow(); await entered.promise;
 const locking = session.lock('manual'); release.resolve(); await rejected; await locking; expect(heldHeader!.every(value => value === 0)).toBe(true);
 await session.unlock(secret); expect(await session.listSourceDrafts(p.id, createJobContext())).toMatchObject([{ bodyBytes: 32, blockCount: 1 }]); await expect(session.openRetainedSource(sourceId, createJobContext())).rejects.toThrow();
});
it('does not replace an import committed after draft creation', async () => {
 const { session, writer, p, sourceId, job } = await fixture(); await writer.append(new Uint8Array(32), job);
 const importedId = crypto.randomUUID(), audio = new Blob([new Uint8Array(32044)]), imported = asset(importedId, 32000);
 const saved = (await session.store.checkpoint({ project: { ...p, sourceAssets: [imported] }, runId: null, audioRecords: [{ recordId: importedId, audio }] }, job)).project;
 await expect(writer.finalize(asset(sourceId, 32), job)).rejects.toThrow(/import|conflict/i); expect(await session.store.readProject(p.id, job)).toEqual(saved);
 expect(await session.listSourceDrafts(p.id, job)).toMatchObject([{ sourceId, bodyBytes: 32 }]);
});
it('builds a narrow stereo PCM16 header and rejects non-RIFF32 or incomplete frame declarations without allocating their body', () => {
 const settings: Config = { sampleRateHz: 48000, channels: 2 }, id = 'SYNTHETIC_HEADER', header = new DataView(createWavHeader(settings, 192000, id, asset(id, 192000, settings)).buffer);
 expect(header.getUint16(22, true)).toBe(2); expect(header.getUint32(24, true)).toBe(48000); expect(header.getUint32(28, true)).toBe(192000); expect(header.getUint16(32, true)).toBe(4);
 for (const size of [0, 1, 3, NaN, Infinity, MAX_WAV_BODY_BYTES + 1]) expect(() => createWavHeader(settings, size, id, asset(id, size, settings))).toThrow();
});
it('retains identifiable encrypted incomplete draft bytes on abort and reload', async () => {
 const { session, writer, p, sourceId, job, factory, databaseName } = await fixture();
 const bytes = new TextEncoder().encode('SYNTHETIC_PRIVATE_PCM_SENTINEL'); await writer.append(bytes, job); await writer.abort();
 await expect(writer.append(new Uint8Array(2), job)).rejects.toThrow(); await expect(writer.finalize(asset(sourceId, bytes.length), job)).rejects.toThrow();
 await session.lock('manual'); await session.unlock(secret); const next = createJobContext();
 expect(await session.listSourceDrafts(p.id, next)).toMatchObject([{ sourceId, bodyBytes: bytes.length, blockCount: 1 }]); await expect(session.openRetainedSource(sourceId, next)).rejects.toThrow();
 expect((await session.store.readProject(p.id, next))?.sourceAssets).toEqual([]);
 const db = await openVaultDatabase(factory, databaseName); try {
  const records = await new Promise<RecordEnvelope[]>((resolve, reject) => { const r = db.transaction('records').objectStore('records').getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  const stored = JSON.stringify(records, (_key, value) => value instanceof ArrayBuffer ? new TextDecoder().decode(value) : value);
  expect(stored).not.toContain('SYNTHETIC_PRIVATE_PCM_SENTINEL'); expect(stored).not.toContain(p.title); expect(stored).not.toContain('bodyBytes');
 } finally { db.close(); }
});

type StoredDraft = { bodyBytes: number; blocks: { id: string; index: number; bytes: number }[] };
async function storedFixture(f: Awaited<ReturnType<typeof fixture>>) {
 const db = await openVaultDatabase(f.factory, f.databaseName), header = (await readHeader(db))!, key = await unwrapHeader(secret, header);
 const get = (id: string) => new Promise<RecordEnvelope | undefined>((resolve, reject) => { const r = db.transaction('records').objectStore('records').get(id); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
 const put = (id: string, record?: RecordEnvelope) => new Promise<void>((resolve, reject) => { const tx = db.transaction('records', 'readwrite'); if (record) tx.objectStore('records').put(record); else tx.objectStore('records').delete(id); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
 async function json<T>(id: string): Promise<T> { const bytes = await decryptRecord(key, header, id, (await get(id))!); try { return JSON.parse(new TextDecoder().decode(bytes)) as T; } finally { bytes.fill(0); } }
 async function writeJSON(id: string, value: unknown) { const bytes = new TextEncoder().encode(JSON.stringify(value)); try { await put(id, await encryptRecord(key, header, id, bytes, crypto.getRandomValues(new Uint8Array(12)))); } finally { bytes.fill(0); } }
 return { db, header, key, get, put, json, writeJSON };
}

it.each(['missing', 'short', 'corrupt'])('rejects %s staged ciphertext before complete-source promotion and retains prior work', async kind => {
 const f = await fixture(); await f.writer.append(new Uint8Array(32).fill(7), f.job);
 const data = await storedFixture(f);
 try {
  const draft = await data.json<StoredDraft>(f.sourceId), id = draft.blocks[0].id, old = (await data.get(id))!;
  if (kind === 'missing') await data.put(id);
  if (kind === 'short') await data.put(id, { ...old, ciphertext: old.ciphertext.slice(0, -1) });
  if (kind === 'corrupt') { const ciphertext = old.ciphertext.slice(0); new Uint8Array(ciphertext)[0] ^= 1; await data.put(id, { ...old, ciphertext }); }
  await expect(f.writer.finalize(asset(f.sourceId, 32), f.job)).rejects.toThrow();
  expect(await f.session.store.readProject(f.p.id, f.job)).toEqual(f.p);
  await expect(f.session.openRetainedSource(f.sourceId, f.job)).rejects.toThrow();
  expect(await f.session.listSourceDrafts(f.p.id, f.job)).toMatchObject([{ bodyBytes: 32, blockCount: 1 }]);
 } finally { data.db.close(); }
});

it.each(['bad-total', 'bad-index', 'unowned-block', 'bad-config'])('rejects authenticated malformed draft %s without publishing or appending', async kind => {
 const f = await fixture(); await f.writer.append(new Uint8Array(32), f.job);
 const data = await storedFixture(f);
 try {
  const draft = await data.json<StoredDraft>(f.sourceId);
  if (kind === 'bad-total') draft.bodyBytes++;
  if (kind === 'bad-index') draft.blocks[0].index++;
  if (kind === 'unowned-block') draft.blocks[0].id = crypto.randomUUID();
  if (kind === 'bad-config') Object.assign(draft, { config: { sampleRateHz: 0, channels: 1 } });
  await data.writeJSON(f.sourceId, draft);
  await expect(f.session.listSourceDrafts(f.p.id, f.job)).rejects.toThrow();
  await expect(f.writer.append(new Uint8Array(32), f.job)).rejects.toThrow();
  await expect(f.writer.finalize(asset(f.sourceId, 32), f.job)).rejects.toThrow();
  expect((await f.session.store.readProject(f.p.id, f.job))?.sourceAssets).toEqual([]);
 } finally { data.db.close(); }
});

it('keeps committed draft bytes on an encryption failure and consumes reserved accounting without retrying automatically', async () => {
 const f = await fixture(); await f.writer.append(new Uint8Array(32).fill(1), f.job);
 const db = await openVaultDatabase(f.factory, f.databaseName), before = (await readHeader(db))!.operations, native = crypto.subtle.encrypt.bind(crypto.subtle);
 const spy = vi.spyOn(crypto.subtle, 'encrypt').mockImplementation((...args) => args[2].byteLength === 64 ? Promise.reject(new Error('SYNTHETIC_ENCRYPT_FAILURE')) : native(...args));
 try {
  await expect(f.writer.append(new Uint8Array(64).fill(2), f.job)).rejects.toThrow();
  expect((await readHeader(db))!.operations).toBeGreaterThan(before);
  expect(await f.session.listSourceDrafts(f.p.id, f.job)).toMatchObject([{ bodyBytes: 32, blockCount: 1 }]);
 } finally { spy.mockRestore(); db.close(); }
 const result = await f.writer.finalize(asset(f.sourceId, 32), f.job);
 expect(result.project.sourceAssets).toEqual([asset(f.sourceId, 32)]);
});

it.each(['reset', 'dispose'])('revokes and drains held append during %s without late staged publication', async boundary => {
 const f = await fixture(); await f.writer.append(new Uint8Array(32).fill(5), f.job);
 const native = crypto.subtle.encrypt.bind(crypto.subtle), entered = deferred(), release = deferred(); let held: Uint8Array | undefined;
 const spy = vi.spyOn(crypto.subtle, 'encrypt').mockImplementation(async (...args) => { const result = await native(...args); if (args[2].byteLength === 64) { held = args[2] as Uint8Array; entered.resolve(); await release.promise; } return result; });
 const pending = f.writer.append(new Uint8Array(64).fill(9), f.job), rejected = expect(pending).rejects.toThrow(); await entered.promise;
 let closed = false;
 const closing = (boundary === 'reset' ? f.session.reset() : f.session.dispose()).then(() => { closed = true; });
 try { expect(f.session.state).toBe('locking'); expect(held!.every(value => value === 0)).toBe(true); await Promise.resolve(); expect(closed).toBe(false); }
 finally { release.resolve(); }
 await rejected; await closing; spy.mockRestore();
 await expect(f.writer.append(new Uint8Array(2), createJobContext())).rejects.toThrow();
 await expect(f.writer.finalize(asset(f.sourceId, 32), createJobContext())).rejects.toThrow();
 const fresh = createVaultSession({ indexedDB: f.factory, databaseName: f.databaseName, testOnlyOwnership: { acquire: async () => () => {} } }); sessions.push(fresh);
 if (boundary === 'reset') {
  await fresh.create(secret, secret);
  expect(await fresh.store.listProjects(createJobContext())).toEqual([]);
  await expect(fresh.createSourceWriter(f.p.id, f.sourceId, config, createJobContext())).rejects.toThrow();
 } else {
  await fresh.unlock(secret); const job = createJobContext();
  expect(await fresh.listSourceDrafts(f.p.id, job)).toMatchObject([{ bodyBytes: 32, blockCount: 1 }]);
  const resumed = await fresh.createSourceWriter(f.p.id, f.sourceId, config, job);
  expect((await resumed.finalize(asset(f.sourceId, 32), job)).project.sourceAssets).toEqual([asset(f.sourceId, 32)]);
 }
});

it('authenticates the writer layout tag and preserves strict imported-source layout and bounded reads', async () => {
 const f = await fixture(); await f.writer.append(new Uint8Array(16), f.job); await f.writer.append(new Uint8Array(16), f.job); await f.writer.finalize(asset(f.sourceId, 32), f.job);
 const reader = await f.session.openRetainedSource(f.sourceId, f.job);
 await expect(reader.read(0, 1024 * 1024 + 1, f.job)).rejects.toThrow();
 const data = await storedFixture(f);
 try {
  const pointer = await data.json<{ manifestId: string }>(f.sourceId), manifest = await data.json<Record<string, unknown>>(pointer.manifestId);
  const original = structuredClone(manifest);
  for (const mutation of [() => { delete manifest.writerLayout; }, () => { manifest.writerLayout = { kind: 'unknown', config }; }, () => { manifest.writerLayout = { kind: 'pcm16-wav-v1', config: { sampleRateHz: 0, channels: 1 } }; }]) {
   Object.assign(manifest, structuredClone(original)); mutation(); await data.writeJSON(pointer.manifestId, manifest);
   await expect(f.session.openRetainedSource(f.sourceId, f.job)).rejects.toThrow();
   await expect(reader.read(0, 44, f.job)).rejects.toThrow();
  }
  await data.writeJSON(pointer.manifestId, original);
  expect((await (await f.session.openRetainedSource(f.sourceId, f.job)).read(0, 44, f.job)).byteLength).toBe(44);
 } finally { data.db.close(); }
});

it.each(['lock', 'reset', 'dispose'])('fences held staged authentication during finalization across %s', async boundary => {
 const f = await fixture(); await f.writer.append(new Uint8Array(32).fill(7), f.job);
 const data = await storedFixture(f), draft = await data.json<StoredDraft>(f.sourceId); data.db.close();
 const native = crypto.subtle.decrypt.bind(crypto.subtle), entered = deferred(), release = deferred(); let held: ArrayBuffer | undefined;
 const spy = vi.spyOn(crypto.subtle, 'decrypt').mockImplementation(async (...args) => {
  const result = await native(...args), aad = (args[0] as AesGcmParams).additionalData;
  if (aad && new TextDecoder().decode(aad).includes(draft.blocks[0].id)) { held = result; entered.resolve(); await release.promise; }
  return result;
 });
 const pending = f.writer.finalize(asset(f.sourceId, 32), f.job), rejected = expect(pending).rejects.toThrow(); await entered.promise;
 let finished = false;
 const closing = (boundary === 'reset' ? f.session.reset() : boundary === 'dispose' ? f.session.dispose() : f.session.lock('manual')).then(() => { finished = true; });
 try { expect(f.session.state).toBe('locking'); await Promise.resolve(); expect(finished).toBe(false); }
 finally { release.resolve(); }
 await rejected; await closing; spy.mockRestore();
 expect(new Uint8Array(held!).every(value => value === 0)).toBe(true);
 await expect(f.writer.finalize(asset(f.sourceId, 32), createJobContext())).rejects.toThrow();
 const fresh = createVaultSession({ indexedDB: f.factory, databaseName: f.databaseName, testOnlyOwnership: { acquire: async () => () => {} } }); sessions.push(fresh);
 if (boundary === 'reset') { await fresh.create(secret, secret); expect(await fresh.store.listProjects(createJobContext())).toEqual([]); }
 else { await fresh.unlock(secret); const job = createJobContext(); expect(await fresh.listSourceDrafts(f.p.id, job)).toMatchObject([{ bodyBytes: 32, blockCount: 1 }]); expect((await fresh.store.readProject(f.p.id, job))?.sourceAssets).toEqual([]); await expect(fresh.openRetainedSource(f.sourceId, job)).rejects.toThrow(); }
});

it('checks promoted body envelopes one at a time inside the atomic transaction', async () => {
 const f = await fixture(); for (let i = 0; i < 3; i++) await f.writer.append(new Uint8Array(32).fill(i), f.job);
 const data = await storedFixture(f), draft = await data.json<StoredDraft>(f.sourceId); data.db.close();
 const ids = new Set(draft.blocks.map(block => block.id)), native = IDBObjectStore.prototype.get;
 let pending = 0, peak = 0, checked = 0;
 vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['get']>) {
  const request = native.apply(this, args);
  if (this.name === 'records' && this.transaction.mode === 'readwrite' && ids.has(String(args[0]))) {
   pending++; checked++; peak = Math.max(peak, pending);
   request.addEventListener('success', () => { pending--; }, { once: true });
  }
  return request;
 });
 expect((await f.writer.finalize(asset(f.sourceId, 96), f.job)).project.sourceAssets).toEqual([asset(f.sourceId, 96)]);
 expect(checked).toBe(3); expect(peak).toBe(1);
});
