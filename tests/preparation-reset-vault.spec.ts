import { afterEach, expect, it, vi } from "vitest";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { cancelJobs, createJobContext } from "../src/react-app/domain/jobs";
import type { MeetingProject } from "../src/react-app/domain/types";
import { createVaultSession, type VaultSession, type VaultSessionOptions } from "../src/react-app/vault/session";
import { decryptRecord, encryptRecord, unwrapHeader, type RecordEnvelope } from "../src/react-app/vault/crypto";
import { openVaultDatabase, readHeader } from "../src/react-app/vault/store";
const secret = "synthetic storage cleanup phrase 123";
const sessions: VaultSession[] = [];
function project(): MeetingProject {
 const id = crypto.randomUUID(), sourceId = crypto.randomUUID(), chunkId = crypto.randomUUID();
 return { id, title: "Synthetic preserved meeting", icon: "meeting", color: "cobalt", pinned: false, createdAt: "2026-10-02T00:00:00Z", updatedAt: "2026-10-02T00:00:00Z", sourceAssets: [{ id: sourceId, fileName: "synthetic.wav", bytes: 64, container: "wav", codec: "pcm", durationMs: 1000, channels: 1, sampleRateHz: 16000 }], preparedChunks: [{ id: chunkId, sourceId, index: 0, sourceStartMs: 0, sourceEndMs: 1000, encodingOffsetMs: 69, encodedBytes: 32, mimeType: "audio/mpeg", codec: "mp3", audioRecordId: crypto.randomUUID() }], audioOptions: { chunkMinutes: 5, overlapSeconds: 5, expectedLanguages: ["en"], bitrateKbps: 32, sampleRateHz: 16000 }, rawTranscripts: [{ id: "synthetic-raw", chunkId, runId: "synthetic-run", response: { text: "original response" }, text: "original response", segments: [], timing: "chunk", speakerScope: "none", execution: null }], transcriptVersions: [{ id: "synthetic-edit", parentId: null, rawIds: ["synthetic-raw"], segments: [], issues: [], missingRanges: [] }], selectedTranscriptVersionId: "synthetic-edit", minutesSettings: { outputLanguage: "en", sections: ["summary"], instructions: "retained instruction", modelId: "synthetic-model" }, minutesRuns: [], minutesRevisions: [{ id: "synthetic-minutes", runId: "synthetic-minutes-run", parentId: null, markdown: "# retained edit" }], selectedMinutesRevisionId: "synthetic-minutes", runs: [], sttBatches: [{ id: "synthetic-batch", parentBatchId: null, parentTranscriptVersionId: null, sourceId, chunkIds: [chunkId], modelId: "synthetic-model", languages: ["en"], route: { connectionId: "synthetic-connection", provider: "openai", stage: "stt", modelId: "synthetic-model", endpointTag: null }, purpose: "initial", createdAt: "2026-10-02T00:00:00Z", parentSelectedRawIdsByChunk: {}, attemptRunIds: ["synthetic-run"], selectedRawIdsByChunk: { [chunkId]: "synthetic-raw" } }] };
}
async function fixture(options: Partial<VaultSessionOptions> = {}) {
 const factory = new IDBFactory(), name = crypto.randomUUID(), s = createVaultSession({ ...options, indexedDB: factory, databaseName: name, testOnlyOwnership: { acquire: async () => () => {} } }); sessions.push(s);
 await s.create(secret, secret);
 const p = project(), other = { ...project(), sourceAssets: [], preparedChunks: [] };
 await s.store.checkpoint({ project: p, runId: null, audioRecords: [{ recordId: p.sourceAssets[0].id, audio: new Blob([new Uint8Array(64).fill(7)], { type: "audio/wav" }) }, { recordId: p.preparedChunks[0].audioRecordId, audio: new Blob([new Uint8Array(32).fill(9)], { type: "audio/mpeg" }) }] }, createJobContext());
 await s.store.checkpoint({ project: other, runId: null, audioRecords: [] }, createJobContext());
 return { s, factory, name, p, other };
}
async function records(f: Awaited<ReturnType<typeof fixture>>) {
 const db = await openVaultDatabase(f.factory, f.name);
 try { return await new Promise<RecordEnvelope[]>((resolve, reject) => { const r = db.transaction("records").objectStore("records").getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); }
 finally { db.close(); }
}
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); for (const s of sessions.splice(0)) await s.dispose(); cancelJobs(); });

const nextOptions = { chunkMinutes: 10 as const, overlapSeconds: 10 as const, expectedLanguages: ["en"], bitrateKbps: 48, sampleRateHz: 16000 };
it("atomically resets preparation while preserving original audio and other memo after reload", async () => {
 const f = await fixture();
 const plan = await f.s.planPreparationReset(f.p.id, nextOptions, createJobContext());
 expect(plan.counts).toEqual({ chunks: 1, transcriptVersions: 1, minutesRevisions: 1 });
 const reset = await f.s.resetPreparation(plan, plan.versionToken, createJobContext());
 expect(reset).toMatchObject({ audioOptions: nextOptions, preparedChunks: [], rawTranscripts: [], transcriptVersions: [], minutesRuns: [], minutesRevisions: [], sttBatches: [], runs: [], minutesComparisons: [], selectedTranscriptVersionId: null, selectedMinutesRevisionId: null });
 expect(reset.sourceAssets).toEqual(f.p.sourceAssets); expect(reset.minutesSettings).toEqual(f.p.minutesSettings);
 expect(reset.processingArchives).toHaveLength(1);
 expect(reset.processingArchives![0].items[0]).toMatchObject({ id: "synthetic-run", kind: "stt", hasResult: true });
 expect(JSON.stringify(reset)).not.toContain("original response"); expect(JSON.stringify(reset)).not.toContain("# retained edit");
 await expect(f.s.store.readAudio(f.p.preparedChunks[0].audioRecordId, createJobContext())).rejects.toThrow();
 const reader = await f.s.openRetainedSource(f.p.sourceAssets[0].id, createJobContext());
 expect(new Uint8Array(await reader.read(0, 64, createJobContext()))).toEqual(new Uint8Array(64).fill(7));
 expect(await f.s.store.readProject(f.other.id, createJobContext())).toEqual(f.other);
 await f.s.lock("manual"); await f.s.unlock(secret);
 expect(await f.s.store.readProject(f.p.id, createJobContext())).toEqual(reset);
 expect((await f.s.getStorageInventory(createJobContext())).chunkBytes).toBe(0);
});

it("rejects wrong, changed and replayed confirmations while keeping the same job active", async () => {
 const f = await fixture(), job = createJobContext(), plan = await f.s.planPreparationReset(f.p.id, nextOptions, job);
 for (const [candidate, token] of [[plan, "wrong"], [{ ...plan, projectId: f.other.id }, plan.versionToken], [{ ...plan, audioOptions: { ...nextOptions, bitrateKbps: 24 } }, plan.versionToken], [{ ...plan, counts: { ...plan.counts, chunks: 0 } }, plan.versionToken]] as const) {
  await expect(f.s.resetPreparation(candidate, token, job)).rejects.toThrow(/exact current/);
  expect(() => job.assertActive()).not.toThrow();
 }
 expect(await f.s.store.readProject(f.p.id, job)).toEqual(f.p);
 await f.s.resetPreparation(plan, plan.versionToken, job);
 await expect(f.s.resetPreparation(plan, plan.versionToken, job)).rejects.toThrow();
 expect(() => job.assertActive()).not.toThrow();
});

it("snapshots immutable options and accepted caller copies before asynchronous execution", async () => {
 const f = await fixture(), mutable = { ...nextOptions, expectedLanguages: ["en"], transcriptionHints: { terms: ["MoM"], context: "synthetic context" } };
 const planning = f.s.planPreparationReset(f.p.id, mutable, createJobContext());
 mutable.expectedLanguages[0] = "ko"; mutable.transcriptionHints.terms[0] = "changed";
 const issued = await planning;
 expect(Object.isFrozen(issued.audioOptions.expectedLanguages)).toBe(true);
 const copied = { ...issued, audioOptions: { ...issued.audioOptions, expectedLanguages: [...issued.audioOptions.expectedLanguages] } };
 const resetting = f.s.resetPreparation(copied, copied.versionToken, createJobContext());
 copied.audioOptions.expectedLanguages[0] = "id";
 const saved = await resetting;
 expect(saved.audioOptions.expectedLanguages).toEqual(["en"]); expect(saved.audioOptions.transcriptionHints?.terms).toEqual(["MoM"]);
});

it("rejects stale storage revisions and cancelled or locked owners without deleting anything", async () => {
 const f = await fixture(), job = createJobContext(), plan = await f.s.planPreparationReset(f.p.id, nextOptions, job);
 const edited = { ...f.p, title: "latest synthetic title" };
 await f.s.store.checkpoint({ project: edited, runId: null, audioRecords: [] }, job);
 await expect(f.s.resetPreparation(plan, plan.versionToken, job)).rejects.toThrow(/stale/);
 const next = await f.s.planPreparationReset(f.p.id, nextOptions, job); cancelJobs();
 await expect(f.s.resetPreparation(next, next.versionToken, job)).rejects.toThrow(/active/);
 await f.s.lock("manual");
 await expect(f.s.resetPreparation(next, next.versionToken, createJobContext())).rejects.toThrow(/unlocked/);
 await f.s.unlock(secret);
 await expect(f.s.resetPreparation(next, next.versionToken, createJobContext())).rejects.toThrow(/exact current/);
 expect(await f.s.store.readProject(f.p.id, createJobContext())).toEqual(edited);
 expect((await f.s.getStorageInventory(createJobContext())).chunkBytes).toBe(32);
});

it("requires retained source bytes and rejects invalid options", async () => {
 const f = await fixture();
 await expect(f.s.planPreparationReset(f.p.id, { ...nextOptions, bitrateKbps: 999 }, createJobContext())).rejects.toThrow();
 const cleanup = await f.s.planDeletion("source", f.p.id, createJobContext());
 await f.s.executeDeletion(cleanup, { accepted: true, token: cleanup.versionToken }, createJobContext());
 const before = await f.s.store.readProject(f.p.id, createJobContext());
 await expect(f.s.planPreparationReset(f.p.id, nextOptions, createJobContext())).rejects.toThrow(/original source/);
 expect(await f.s.store.readProject(f.p.id, createJobContext())).toEqual(before);
 expect((await f.s.getStorageInventory(createJobContext())).chunkBytes).toBe(32);
});

it("rolls back every chunk deletion and project change when the final transaction aborts", async () => {
 const f = await fixture(), plan = await f.s.planPreparationReset(f.p.id, nextOptions, createJobContext()), before = await records(f);
 const native = IDBObjectStore.prototype.delete;
 const spy = vi.spyOn(IDBObjectStore.prototype, "delete").mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore["delete"]>) {
  const request = native.apply(this, args); this.transaction.abort(); return request;
 });
 await expect(f.s.resetPreparation(plan, plan.versionToken, createJobContext())).rejects.toThrow(/transaction failed/);
 spy.mockRestore();
 expect(f.s.storageBusy).toBe(false); expect(await records(f)).toEqual(before);
 expect(await f.s.store.readProject(f.p.id, createJobContext())).toEqual(f.p);
 expect((await f.s.getStorageInventory(createJobContext())).chunkBytes).toBe(32);
 await f.s.lock("manual"); await f.s.unlock(secret);
 expect(await f.s.store.readProject(f.p.id, createJobContext())).toEqual(f.p);
});

it("preserves encrypted provider keys, prior archives, and every old chunk generation", async () => {
 const f = await fixture(), job = createJobContext();
 await f.s.saveProviderKey("synthetic-provider", "synthetic-fixture-key", "encrypted");
 await f.s.store.checkpoint({ project: f.p, runId: null, audioRecords: [{ recordId: f.p.preparedChunks[0].audioRecordId, audio: new Blob([new Uint8Array(32).fill(3)], { type: "audio/mpeg" }) }] }, job);
 expect((await f.s.getStorageInventory(job)).chunkBytes).toBe(64);
 let plan = await f.s.planPreparationReset(f.p.id, nextOptions, job);
 const first = await f.s.resetPreparation(plan, plan.versionToken, job);
 plan = await f.s.planPreparationReset(f.p.id, { ...nextOptions, bitrateKbps: 24 }, job);
 const second = await f.s.resetPreparation(plan, plan.versionToken, job);
 expect(second.processingArchives).toHaveLength(2); expect(second.processingArchives![0]).toEqual(first.processingArchives![0]); expect(second.processingArchives![1].items).toEqual([]);
 expect((await f.s.getStorageInventory(job)).chunkBytes).toBe(0);
 await f.s.lock("manual"); await f.s.unlock(secret);
 expect(await f.s.getProviderKey("synthetic-provider")).toBe("synthetic-fixture-key");
 await expect(f.s.store.checkpoint({ project: f.p, runId: null, audioRecords: [{ recordId: f.p.preparedChunks[0].audioRecordId, audio: new Blob([new Uint8Array(32)], { type: "audio/mpeg" }) }] }, createJobContext())).rejects.toThrow(/Deleted audio/);
});

it("refuses active runs and source writers without cancelling them", async () => {
 const f = await fixture(), job = createJobContext();
 const active = { ...f.p, runs: [{ id: "pending-synthetic-run", projectId: f.p.id, state: "requesting" as const, checkpoint: null }] };
 await f.s.store.checkpoint({ project: active, runId: null, audioRecords: [] }, job);
 await expect(f.s.planPreparationReset(f.p.id, nextOptions, job)).rejects.toThrow(/active runs/);
 expect(() => job.assertActive()).not.toThrow();
 await f.s.store.checkpoint({ project: f.p, runId: null, audioRecords: [] }, job);
 const plan = await f.s.planPreparationReset(f.p.id, nextOptions, job);
 const writer = await f.s.createSourceWriter(f.other.id, crypto.randomUUID(), { sampleRateHz: 16000, channels: 1 }, job);
 await expect(f.s.resetPreparation(plan, plan.versionToken, job)).rejects.toThrow(/active audio/);
 expect(() => job.assertActive()).not.toThrow(); await writer.abort();
 expect(await f.s.store.readProject(f.p.id, job)).toEqual(f.p);
});

async function metadata(f: Awaited<ReturnType<typeof fixture>>) {
 const db = await openVaultDatabase(f.factory, f.name), header = (await readHeader(db))!, key = await unwrapHeader(secret, header);
 const get = (id: string) => new Promise<RecordEnvelope>((resolve, reject) => { const r = db.transaction("records").objectStore("records").get(id); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
 async function json<T>(id: string): Promise<T> { const bytes = await decryptRecord(key, header, id, await get(id)); try { return JSON.parse(new TextDecoder().decode(bytes)) as T; } finally { bytes.fill(0); } }
 const put = (value: unknown, store = "records") => new Promise<void>((resolve, reject) => { const tx = db.transaction(store, "readwrite"); tx.objectStore(store).put(value); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
 async function writeJSON(id: string, value: unknown) { const bytes = new TextEncoder().encode(JSON.stringify(value)); try { await put(await encryptRecord(key, header, id, bytes, crypto.getRandomValues(new Uint8Array(12)))); } finally { bytes.fill(0); } }
 return { db, header, get, json, put, writeJSON };
}

it("refuses missing source records and ambiguous cross-project ownership before deletion", async () => {
 const f = await fixture(), plan = await f.s.planPreparationReset(f.p.id, nextOptions, createJobContext()), data = await metadata(f);
 try {
  const other = await data.json<{ ownedRecords: string[] }>(f.other.id);
  await data.writeJSON(f.other.id, { ...other, ownedRecords: [...other.ownedRecords, f.p.sourceAssets[0].id] });
  await expect(f.s.resetPreparation(plan, plan.versionToken, createJobContext())).rejects.toThrow(/ownership/);
  await data.writeJSON(f.other.id, other);
  const deletion = data.db.transaction("records", "readwrite"); deletion.objectStore("records").delete(f.p.sourceAssets[0].id);
  await new Promise<void>((resolve, reject) => { deletion.oncomplete = () => resolve(); deletion.onabort = () => reject(deletion.error); });
  await expect(f.s.planPreparationReset(f.p.id, nextOptions, createJobContext())).rejects.toThrow();
  expect(await f.s.store.readProject(f.p.id, createJobContext())).toEqual(f.p);
  expect(await f.s.store.readAudio(f.p.preparedChunks[0].audioRecordId, createJobContext())).toBeInstanceOf(Blob);
 } finally { data.db.close(); }
});

it("authenticates retained source bodies before deleting valid prepared audio", async () => {
 const f = await fixture(), data = await metadata(f);
 try {
  const pointer = await data.json<{ manifestId: string }>(f.p.sourceAssets[0].id), manifest = await data.json<{ blocks: { id: string }[] }>(pointer.manifestId);
  const block = await data.get(manifest.blocks[0].id), corrupt = block.ciphertext.slice(0); new Uint8Array(corrupt)[0] ^= 1;
  await data.put({ ...block, ciphertext: corrupt });
  const plan = await f.s.planPreparationReset(f.p.id, nextOptions, createJobContext());
  await expect(f.s.resetPreparation(plan, plan.versionToken, createJobContext())).rejects.toThrow();
  expect(await f.s.store.readProject(f.p.id, createJobContext())).toEqual(f.p);
  expect(await f.s.store.readAudio(f.p.preparedChunks[0].audioRecordId, createJobContext())).toBeInstanceOf(Blob);
 } finally { data.db.close(); }
});

it("archives call and usage metadata while removing saved provider error and result bodies", async () => {
 const f = await fixture(), job = createJobContext();
 const usage = { inputTokens: null, outputTokens: null, durationSeconds: 1, audioInputTokens: null, textInputTokens: null, audioOutputTokens: null, textOutputTokens: null, elapsedMs: 25, cost: 0.01, costKind: "reported" as const, currency: "USD", rateSource: null, rateCheckedAt: null, rateSnapshot: null };
 const richer = { ...f.p, failedProviderResponses: [{ runId: "synthetic-run", response: { text: "SYNTHETIC_PRIVATE_ERROR_BODY" } }], rawTranscripts: f.p.rawTranscripts.map(raw => ({ ...raw, execution: { requestedModel: "synthetic-model", returnedModel: "synthetic-returned", actualProvider: "synthetic-provider", expectedLanguages: ["en"], usage } })), runs: [{ id: "synthetic-run", projectId: f.p.id, state: "failed" as const, checkpoint: null, intent: { kind: "stt" as const, chunkId: f.p.preparedChunks[0].id, requestedModel: "synthetic-model", expectedLanguages: ["en"], rateSnapshot: null, requestedEndpoint: "synthetic-endpoint" } }] };
 await f.s.store.checkpoint({ project: richer, runId: null, audioRecords: [] }, job);
 const plan = await f.s.planPreparationReset(f.p.id, nextOptions, job), reset = await f.s.resetPreparation(plan, plan.versionToken, job);
 expect(JSON.stringify(reset)).not.toContain("SYNTHETIC_PRIVATE_ERROR_BODY"); expect(reset).not.toHaveProperty("failedProviderResponses");
 expect(reset.processingArchives![0].items[0]).toMatchObject({ state: "failed", recordedAttempt: true, hasResult: true, model: "synthetic-model", returnedModel: "synthetic-returned", actualProvider: "synthetic-provider", requestedEndpoint: "synthetic-endpoint", chunkId: f.p.preparedChunks[0].id, usage });
});

it.each(["cancel", "lock"] as const)("preserves prepared results when %s interrupts original validation", async interruption => {
 const f = await fixture(), data = await metadata(f), pointer = await data.json<{ manifestId: string }>(f.p.sourceAssets[0].id), manifest = await data.json<{ blocks: { id: string }[] }>(pointer.manifestId); data.db.close();
 let enter!: () => void, release!: () => void;
 const entered = new Promise<void>(resolve => { enter = resolve; }), released = new Promise<void>(resolve => { release = resolve; });
 const plan = await f.s.planPreparationReset(f.p.id, nextOptions, createJobContext()), native = crypto.subtle.decrypt.bind(crypto.subtle); let held = false;
 const spy = vi.spyOn(crypto.subtle, "decrypt").mockImplementation(async (...args) => {
  const result = await native(...args), aad = (args[0] as AesGcmParams).additionalData;
  if (!held && aad && new TextDecoder().decode(aad).includes(manifest.blocks[0].id)) { held = true; enter(); await released; }
  return result;
 });
 const resetting = f.s.resetPreparation(plan, plan.versionToken, createJobContext()), rejection = expect(resetting).rejects.toThrow();
 await entered; expect(f.s.storageBusy).toBe(true);
 expect(() => f.s.store).toThrow(/unlocked/);
 let locking: Promise<void> | undefined;
 if (interruption === "lock") locking = f.s.lock("manual"); else cancelJobs();
 release(); await rejection; await locking; spy.mockRestore();
 if (interruption === "lock") await f.s.unlock(secret);
 expect(f.s.storageBusy).toBe(false); expect(await f.s.store.readProject(f.p.id, createJobContext())).toEqual(f.p);
 expect((await f.s.getStorageInventory(createJobContext())).chunkBytes).toBe(32);
});
