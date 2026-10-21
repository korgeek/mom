import { afterEach, expect, it, vi } from "vitest";
import { IDBDatabase, IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { cancelJobs, createJobContext } from "../src/react-app/domain/jobs";
import type { DeletionConfirmation, MeetingProject } from "../src/react-app/domain/types";
import { createVaultSession, type VaultSession, type VaultSessionOptions } from "../src/react-app/vault/session";
import { openVaultDatabase, readHeader } from "../src/react-app/vault/store";
import { decryptRecord, encryptRecord, unwrapHeader, type RecordEnvelope } from "../src/react-app/vault/crypto";
import { audioAvailability, hasRetainedAudio } from "../src/react-app/vault/storage-management";

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

it("inventories encoded owned audio separately from exact encrypted bytes and nullable origin estimates", async () => {
 const f = await fixture();
 expect(f.s.getStorageInventory, "real encrypted session exposes inventory").toBeTypeOf("function");
 const inventory = await f.s.getStorageInventory(createJobContext());
 expect(inventory).toMatchObject({ sourceBytes: 64, chunkBytes: 32, draftBytes: 0, originUsage: null, originQuota: null });
 expect(inventory.encryptedBytes).toBe((await records(f)).reduce((sum, envelope) => sum + envelope.ciphertext.byteLength, 0));
 expect(inventory.projects).toHaveLength(2);
 expect(inventory.projects.find(entry => entry.projectId === f.p.id)?.retainedAudio).toEqual({ sourceIds: [f.p.sourceAssets[0].id], chunkIds: [f.p.preparedChunks[0].id] });
});

async function metadata(f: Awaited<ReturnType<typeof fixture>>) {
 const db = await openVaultDatabase(f.factory, f.name), header = (await readHeader(db))!, key = await unwrapHeader(secret, header);
 const get = (id: string) => new Promise<RecordEnvelope>((resolve, reject) => { const r = db.transaction("records").objectStore("records").get(id); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
 async function json<T>(id: string): Promise<T> { const bytes = await decryptRecord(key, header, id, await get(id)); try { return JSON.parse(new TextDecoder().decode(bytes)) as T; } finally { bytes.fill(0); } }
 const put = (value: unknown, store = "records") => new Promise<void>((resolve, reject) => { const tx = db.transaction(store, "readwrite"); tx.objectStore(store).put(value); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
 async function writeJSON(id: string, value: unknown) { const bytes = new TextEncoder().encode(JSON.stringify(value)); try { await put(await encryptRecord(key, header, id, bytes, crypto.getRandomValues(new Uint8Array(12)))); } finally { bytes.fill(0); } }
 return { db, header, get, json, put, writeJSON };
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(complete => { resolve = complete; }); return { promise, resolve }; }

it("deletes chunks-only and keeps original bytes, STT batches and selected edits", async () => {
 const f = await fixture(), plan = await f.s.planDeletion("chunks", f.p.id, createJobContext());
 await f.s.executeDeletion(plan, { accepted: true, token: plan.versionToken }, createJobContext());
 const job = createJobContext(), expected = { ...f.p, retainedAudio: { sourceIds: [f.p.sourceAssets[0].id], chunkIds: [] } };
 expect(await f.s.store.readProject(f.p.id, job)).toEqual(expected);
 const reader = await f.s.openRetainedSource(f.p.sourceAssets[0].id, job); expect(new Uint8Array(await reader.read(0, 64, job))).toEqual(new Uint8Array(64).fill(7));
 await expect(f.s.store.readAudio(f.p.preparedChunks[0].audioRecordId, job)).rejects.toThrow();
 expect((await f.s.getStorageInventory(job)).chunkBytes).toBe(0);
});

it("keeps legacy availability unknown in pure helpers and resolves it only through the owned vault", async () => {
 const f = await fixture();
 expect(audioAvailability(f.p)).toBeNull(); expect(hasRetainedAudio(f.p, "source", f.p.sourceAssets[0].id)).toBe(false);
 const availability = await f.s.getAudioAvailability(f.p.id, createJobContext());
 expect(hasRetainedAudio(f.p, "source", f.p.sourceAssets[0].id, availability)).toBe(true);
 vi.stubGlobal("navigator", { storage: { estimate: async () => ({ usage: 777, quota: 999 }) } });
 expect(await f.s.getStorageInventory(createJobContext())).toMatchObject({ originUsage: 777, originQuota: 999, sourceBytes: 64, chunkBytes: 32 });
 vi.stubGlobal("navigator", { storage: { estimate: async () => { throw new Error("SYNTHETIC_ESTIMATE_FAILURE"); } } });
 expect(await f.s.getStorageInventory(createJobContext())).toMatchObject({ originUsage: null, originQuota: null });
});

it("rejects cancel, wrong token/project/scope and replay without deleting or cancelling on invalid confirmation", async () => {
 const f = await fixture(), job = createJobContext(), plan = await f.s.planDeletion("source", f.p.id, job);
 for (const [candidate, confirmation] of [[plan, { accepted: false, token: plan.versionToken }], [plan, { accepted: true, token: "wrong" }], [{ ...plan, projectId: f.other.id }, { accepted: true, token: plan.versionToken }], [{ ...plan, scope: "chunks" }, { accepted: true, token: plan.versionToken }], [{ ...plan, recordIds: [] }, { accepted: true, token: plan.versionToken }]] as const) {
  await expect(f.s.executeDeletion(candidate as typeof plan, confirmation as DeletionConfirmation, job)).rejects.toThrow();
  expect(() => job.assertActive()).not.toThrow();
 }
 expect(await f.s.store.readProject(f.p.id, job)).toEqual(f.p);
 await f.s.executeDeletion(plan, { accepted: true, token: plan.versionToken }, job);
 await expect(f.s.executeDeletion(plan, { accepted: true, token: plan.versionToken }, createJobContext())).rejects.toThrow();
});

it("uses the issued immutable record list when a caller mutates its accepted plan copy during cleanup", async () => {
 const f = await fixture(), issued = await f.s.planDeletion("source", f.p.id, createJobContext()), copied = { ...issued, recordIds: [...issued.recordIds] };
 const deleting = f.s.executeDeletion(copied, { accepted: true, token: copied.versionToken }, createJobContext());
 copied.recordIds.splice(0, copied.recordIds.length, f.other.id);
 await deleting;
 expect(await f.s.store.readProject(f.other.id, createJobContext())).toEqual(f.other);
 expect((await f.s.getStorageInventory(createJobContext())).sourceBytes).toBe(0);
});

it("binds plans to current revisions and rejects stale plans after saved edits", async () => {
 const f = await fixture(), plan = await f.s.planDeletion("source", f.p.id, createJobContext());
 await f.s.store.checkpoint({ project: { ...f.p, title: "new durable title" }, runId: null, audioRecords: [] }, createJobContext());
 await expect(f.s.executeDeletion(plan, { accepted: true, token: plan.versionToken }, createJobContext())).rejects.toThrow(/stale/i);
 const saved = await f.s.store.readProject(f.p.id, createJobContext()); expect(saved?.title).toBe("new durable title"); expect(saved?.retainedAudio).toBeUndefined();
 expect((await f.s.getStorageInventory(createJobContext())).sourceBytes).toBe(64);
});

it("counts and deletes older owned audio generations even after descriptors move to a new source identity", async () => {
 const f = await fixture(), source = f.p.sourceAssets[0];
 await f.s.store.checkpoint({ project: f.p, runId: null, audioRecords: [{ recordId: source.id, audio: new Blob([new Uint8Array(64).fill(2)], { type: "audio/wav" }) }] }, createJobContext());
 expect((await f.s.getStorageInventory(createJobContext())).sourceBytes).toBe(128);
 const next = { ...source, id: crypto.randomUUID() }, moved = { ...f.p, sourceAssets: [next] };
 await f.s.store.checkpoint({ project: moved, runId: null, audioRecords: [{ recordId: next.id, audio: new Blob([new Uint8Array(64).fill(3)], { type: "audio/wav" }) }] }, createJobContext());
 expect((await f.s.getStorageInventory(createJobContext())).sourceBytes).toBe(192);
 const plan = await f.s.planDeletion("source", f.p.id, createJobContext()); expect(plan.recordIds).toContain(source.id); expect(plan.recordIds).toContain(next.id);
 await f.s.executeDeletion(plan, { accepted: true, token: plan.versionToken }, createJobContext());
 expect((await f.s.getStorageInventory(createJobContext())).sourceBytes).toBe(0);
 expect(await f.s.store.readProject(f.p.id, createJobContext())).toEqual({ ...moved, retainedAudio: { sourceIds: [], chunkIds: [f.p.preparedChunks[0].id] } });
 await expect(f.s.openRetainedSource(source.id, createJobContext())).rejects.toThrow();
});

it.each(["source", "chunks"] as const)("durably refuses every removed historical %s record identity while accepting fresh audio", async scope => {
 const f = await fixture(), source = f.p.sourceAssets[0], chunk = f.p.preparedChunks[0];
 const moved = scope === "source" ? { ...f.p, sourceAssets: [{ ...source, id: crypto.randomUUID() }] } : { ...f.p, preparedChunks: [{ ...chunk, id: crypto.randomUUID(), audioRecordId: crypto.randomUUID() }] };
 const recordId = scope === "source" ? moved.sourceAssets[0].id : moved.preparedChunks[0].audioRecordId;
 await f.s.store.checkpoint({ project: moved, runId: null, audioRecords: [{ recordId, audio: new Blob([new Uint8Array(scope === "source" ? 64 : 32)], { type: scope === "source" ? "audio/wav" : "audio/mpeg" }) }] }, createJobContext());
 const plan = await f.s.planDeletion(scope, f.p.id, createJobContext()); await f.s.executeDeletion(plan, { accepted: true, token: plan.versionToken }, createJobContext());
 await f.s.lock("manual"); await f.s.unlock(secret);
 const saved = (await f.s.store.readProject(f.p.id, createJobContext()))!;
 for (const removedId of plan.recordIds) {
  const stale = scope === "source" ? { ...f.p, sourceAssets: [{ ...source, id: removedId }] } : { ...f.p, preparedChunks: [{ ...chunk, audioRecordId: removedId }] };
  await expect(f.s.store.checkpoint({ project: stale, runId: null, audioRecords: [{ recordId: removedId, audio: new Blob([new Uint8Array(scope === "source" ? 64 : 32)], { type: scope === "source" ? "audio/wav" : "audio/mpeg" }) }] }, createJobContext())).rejects.toThrow(/Deleted audio/);
 }
 const data = await metadata(f);
 try { expect((await data.json<{ deletedRecordIds: string[] }>(data.header.vaultId)).deletedRecordIds).toEqual(expect.arrayContaining([...plan.recordIds])); } finally { data.db.close(); }
 const freshId = crypto.randomUUID(), fresh = scope === "source" ? { ...saved, sourceAssets: [{ ...source, id: freshId }] } : { ...saved, preparedChunks: [{ ...chunk, id: crypto.randomUUID(), audioRecordId: freshId }] };
 await f.s.store.checkpoint({ project: fresh, runId: null, audioRecords: [{ recordId: freshId, audio: new Blob([new Uint8Array(scope === "source" ? 64 : 32)], { type: scope === "source" ? "audio/wav" : "audio/mpeg" }) }] }, createJobContext());
 const available = await f.s.getAudioAvailability(f.p.id, createJobContext()); expect(scope === "source" ? available.sourceIds : available.chunkIds).toEqual([scope === "source" ? freshId : fresh.preparedChunks[0].id]);
 await f.s.lock("manual"); await f.s.unlock(secret); expect(await f.s.getAudioAvailability(f.p.id, createJobContext())).toEqual(available);
 const priorId = scope === "source" ? source.id : chunk.audioRecordId;
 await expect(f.s.store.checkpoint({ project: f.p, runId: null, audioRecords: [{ recordId: priorId, audio: new Blob([new Uint8Array(scope === "source" ? 64 : 32)]) }] }, createJobContext())).rejects.toThrow(/Deleted audio/);
 const elsewhere = scope === "source" ? { ...f.other, sourceAssets: [source] } : { ...f.other, preparedChunks: [chunk] };
 await expect(f.s.store.checkpoint({ project: elsewhere, runId: null, audioRecords: [{ recordId: priorId, audio: new Blob([new Uint8Array(scope === "source" ? 64 : 32)]) }] }, createJobContext())).rejects.toThrow(/Deleted audio/);
 expect(await f.s.store.readProject(f.other.id, createJobContext())).toEqual(f.other);
});

it("accepts an unchanged captured editor snapshot and preserves it before teardown mutations", async () => {
 let captured: MeetingProject | undefined;
 const f = await fixture({ capturePending: () => captured ? [{ project: captured, runId: null, audioRecords: [] }] : [], teardown: () => { if (captured) captured = { ...captured, title: "SYNTHETIC_TEARDOWN_MUTATION" }; } });
 captured = f.p;
 const plan = await f.s.planDeletion("source", f.p.id, createJobContext()); await f.s.executeDeletion(plan, { accepted: true, token: plan.versionToken }, createJobContext());
 expect((await f.s.store.readProject(f.p.id, createJobContext()))?.title).toBe(f.p.title);
});

it("does not delete or report success if resource teardown fails", async () => {
 let fail = false; const f = await fixture({ teardown: () => { if (fail) throw new Error("SYNTHETIC_TEARDOWN_FAILURE"); } }), plan = await f.s.planDeletion("source", f.p.id, createJobContext()); fail = true;
 await expect(f.s.executeDeletion(plan, { accepted: true, token: plan.versionToken }, createJobContext())).rejects.toThrow(/TEARDOWN_FAILURE/); fail = false;
 expect(f.s.storageBusy).toBe(false); expect(await f.s.store.readProject(f.p.id, createJobContext())).toEqual(f.p); expect((await f.s.getStorageInventory(createJobContext())).sourceBytes).toBe(64);
});

it("keeps a destructively drained completed capture through failed teardown and encrypted lock reload", async () => {
 const pending = new Map<string, { project: MeetingProject; runId: null; audioRecords: [] }>(); let fail = false;
 const f = await fixture({ capturePending: () => { const writes = [...pending.values()]; pending.clear(); return writes; }, teardown: () => { if (fail) throw new Error("SYNTHETIC_TEARDOWN_CAPTURE_FAILURE"); } });
 const edited = { ...f.p, title: "SYNTHETIC_DRAINED_CAPTURE_TITLE" }; pending.set(f.p.id, { project: edited, runId: null, audioRecords: [] });
 const plan = await f.s.planDeletion("source", f.p.id, createJobContext()); fail = true;
 await expect(f.s.executeDeletion(plan, { accepted: true, token: plan.versionToken }, createJobContext())).rejects.toThrow(/TEARDOWN_CAPTURE_FAILURE/); fail = false; expect(pending.size).toBe(0);
 expect((await f.s.getStorageInventory(createJobContext())).sourceBytes).toBe(64);
 await f.s.lock("manual"); await f.s.unlock(secret); expect(await f.s.store.readProject(f.p.id, createJobContext())).toEqual(edited);
 const retry = await f.s.planDeletion("source", f.p.id, createJobContext()); await f.s.executeDeletion(retry, { accepted: true, token: retry.versionToken }, createJobContext()); expect((await f.s.store.readProject(f.p.id, createJobContext()))?.title).toBe(edited.title);
});

it("retains drained capture when teardown triggers lock before cleanup flush", async () => {
 const pending = new Map<string, { project: MeetingProject; runId: null; audioRecords: [] }>(); let trigger = false; let locking: Promise<void> | undefined;
 const f = await fixture({ capturePending: () => { const writes = [...pending.values()]; pending.clear(); return writes; }, teardown: () => { if (trigger) { trigger = false; locking = f.s.lock("manual"); } } });
 const edited = { ...f.p, title: "SYNTHETIC_CAPTURE_BEFORE_LOCK" }; pending.set(f.p.id, { project: edited, runId: null, audioRecords: [] });
 const plan = await f.s.planDeletion("source", f.p.id, createJobContext()); trigger = true;
 await expect(f.s.executeDeletion(plan, { accepted: true, token: plan.versionToken }, createJobContext())).rejects.toThrow(); await locking; await f.s.unlock(secret);
 expect(await f.s.store.readProject(f.p.id, createJobContext())).toEqual(edited); expect((await f.s.getStorageInventory(createJobContext())).sourceBytes).toBe(64);
});

it("preserves encrypted availability through stale metadata saves and refuses resurrection under deleted IDs", async () => {
 const f = await fixture(), plan = await f.s.planDeletion("source", f.p.id, createJobContext()); await f.s.executeDeletion(plan, { accepted: true, token: plan.versionToken }, createJobContext());
 await f.s.store.checkpoint({ project: { ...f.p, title: "later retained edit" }, runId: null, audioRecords: [] }, createJobContext());
 const saved = await f.s.store.readProject(f.p.id, createJobContext()); expect(saved?.retainedAudio).toEqual({ sourceIds: [], chunkIds: [f.p.preparedChunks[0].id] });
 await expect(f.s.store.checkpoint({ project: f.p, runId: null, audioRecords: [{ recordId: f.p.sourceAssets[0].id, audio: new Blob([new Uint8Array(64)]) }] }, createJobContext())).rejects.toThrow(/Deleted audio/i);
 try { await expect(f.s.lock("manual")).resolves.toBeUndefined(); }
 finally { if (f.s.state === "lock-save-failed") await f.s.discardPendingAndLock(); }
 await f.s.unlock(secret); expect((await f.s.store.readProject(f.p.id, createJobContext()))?.title).toBe("later retained edit");
});

it("does not accept caller-invented missing availability over durable legacy audio", async () => {
 const f = await fixture();
 await f.s.store.checkpoint({ project: { ...f.p, retainedAudio: { sourceIds: [], chunkIds: [] } }, runId: null, audioRecords: [] }, createJobContext());
 expect(await f.s.getAudioAvailability(f.p.id, createJobContext())).toEqual({ sourceIds: [f.p.sourceAssets[0].id], chunkIds: [f.p.preparedChunks[0].id] });
 expect((await f.s.getStorageInventory(createJobContext())).sourceBytes).toBe(64);
});

it("rolls back all audio/availability changes when a native transaction aborts", async () => {
 const f = await fixture(), plan = await f.s.planDeletion("source", f.p.id, createJobContext()), before = await records(f), native = IDBObjectStore.prototype.delete;
 const spy = vi.spyOn(IDBObjectStore.prototype, "delete").mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore["delete"]>) {
  if (this.name === "records" && args[0] === plan.recordIds[plan.recordIds.length - 1]) { this.transaction.abort(); throw new DOMException("SYNTHETIC_DELETE_FAILURE", "QuotaExceededError"); }
  return native.apply(this, args);
 });
 await expect(f.s.executeDeletion(plan, { accepted: true, token: plan.versionToken }, createJobContext())).rejects.toThrow(); spy.mockRestore();
 expect(await f.s.store.readProject(f.p.id, createJobContext())).toEqual(f.p);
 expect((await records(f)).map(record => record.recordId).sort()).toEqual(before.map(record => record.recordId).sort());
 const data = await metadata(f); try { expect((await data.json<{ deletedRecordIds?: string[] }>(data.header.vaultId)).deletedRecordIds).toBeUndefined(); } finally { data.db.close(); }
});

it("drains a held old reader and blocks public work before deleting, with no late plaintext return", async () => {
 const teardown = vi.fn(), f = await fixture({ teardown }), data = await metadata(f), pointer = await data.json<{ manifestId: string }>(f.p.sourceAssets[0].id), manifest = await data.json<{ blocks: { id: string }[] }>(pointer.manifestId); data.db.close();
 const job = createJobContext(), reader = await f.s.openRetainedSource(f.p.sourceAssets[0].id, job), plan = await f.s.planDeletion("source", f.p.id, job), entered = deferred(), release = deferred(), native = crypto.subtle.decrypt.bind(crypto.subtle); let held: ArrayBuffer | undefined;
 const spy = vi.spyOn(crypto.subtle, "decrypt").mockImplementation(async (...args) => { const result = await native(...args), aad = (args[0] as AesGcmParams).additionalData; if (!held && aad && new TextDecoder().decode(aad).includes(manifest.blocks[0].id)) { held = result; entered.resolve(); await release.promise; } return result; });
 const reading = reader.read(0, 11, job), rejected = expect(reading).rejects.toThrow(); await entered.promise;
 let done = false; const deleting = f.s.executeDeletion(plan, { accepted: true, token: plan.versionToken }, job).then(() => { done = true; });
 try { expect(f.s.storageBusy).toBe(true); expect(teardown).toHaveBeenCalledOnce(); expect(() => f.s.store).toThrow(); await Promise.resolve(); expect(done).toBe(false); }
 finally { release.resolve(); }
 await rejected; await deleting; spy.mockRestore(); expect(new Uint8Array(held!).every(byte => byte === 0)).toBe(true);
 await expect(reader.read(0, 1, createJobContext())).rejects.toThrow();
});

it("preserves a completed pending edit and invalidates deletion rather than silently lose or publish late saves", async () => {
 const f = await fixture(), plan = await f.s.planDeletion("source", f.p.id, createJobContext()), entered = deferred(), release = deferred(), native = crypto.subtle.encrypt.bind(crypto.subtle); let once = false;
 const spy = vi.spyOn(crypto.subtle, "encrypt").mockImplementation(async (...args) => { const result = await native(...args); if (!once && new TextDecoder().decode(args[2]).includes("LATEST_PENDING_TITLE")) { once = true; entered.resolve(); await release.promise; } return result; });
 const saving = f.s.store.checkpoint({ project: { ...f.p, title: "LATEST_PENDING_TITLE" }, runId: null, audioRecords: [] }, createJobContext()), saveRejected = expect(saving).rejects.toThrow(); await entered.promise;
 const deleting = f.s.executeDeletion(plan, { accepted: true, token: plan.versionToken }, createJobContext()), deleteRejected = expect(deleting).rejects.toThrow(/stale/i);
 release.resolve(); await saveRejected; await deleteRejected; spy.mockRestore();
 expect((await f.s.store.readProject(f.p.id, createJobContext()))?.title).toBe("LATEST_PENDING_TITLE");
 expect((await f.s.getStorageInventory(createJobContext())).sourceBytes).toBe(64);
});

it("cleans only explicitly planned same-project draft bodies and revokes old writer handles", async () => {
 const f = await fixture(), empty = { ...project(), sourceAssets: [], preparedChunks: [] }; await f.s.store.checkpoint({ project: empty, runId: null, audioRecords: [] }, createJobContext());
 const sourceId = crypto.randomUUID(), writer = await f.s.createSourceWriter(empty.id, sourceId, { sampleRateHz: 16000, channels: 1 }, createJobContext()); await writer.append(new Uint8Array(32).fill(1), createJobContext());
 const inventory = await f.s.getStorageInventory(createJobContext()); expect(inventory.draftBytes).toBe(32);
 const plan = await f.s.planDeletion("source", empty.id, createJobContext()); expect(plan.draftIds).toEqual([sourceId]); expect(plan.recordIds).toContain(sourceId);
 await f.s.executeDeletion(plan, { accepted: true, token: plan.versionToken }, createJobContext());
 expect(await f.s.listSourceDrafts(empty.id, createJobContext())).toEqual([]); expect((await f.s.getStorageInventory(createJobContext())).draftBytes).toBe(0);
 await expect(writer.append(new Uint8Array(32), createJobContext())).rejects.toThrow(); expect(await f.s.store.readProject(f.p.id, createJobContext())).toEqual(f.p);
 await expect(f.s.createSourceWriter(empty.id, sourceId, { sampleRateHz: 16000, channels: 1 }, createJobContext())).rejects.toThrow(/Deleted audio/);
 await expect(f.s.createSourceWriter(f.other.id, sourceId, { sampleRateHz: 16000, channels: 1 }, createJobContext())).rejects.toThrow(/Deleted audio/);
 const nextId = crypto.randomUUID(), next = await f.s.createSourceWriter(empty.id, nextId, { sampleRateHz: 16000, channels: 1 }, createJobContext()); await next.append(new Uint8Array(32), createJobContext());
 await next.finalize({ id: nextId, fileName: "synthetic.wav", bytes: 76, container: "wav", codec: "pcm_s16le", durationMs: 1, channels: 1, sampleRateHz: 16000 }, createJobContext());
 expect((await f.s.getStorageInventory(createJobContext())).projects.find(item => item.projectId === empty.id)?.retainedAudio.sourceIds).toEqual([nextId]);
});

it("rejects ambiguous cross-project ownership and lost vault ownership", async () => {
 const f = await fixture(), data = await metadata(f);
 try {
  const original = await data.json<{ ownedRecords: string[] }>(f.other.id); await data.writeJSON(f.other.id, { ...original, ownedRecords: [...original.ownedRecords, f.p.sourceAssets[0].id] });
  await expect(f.s.planDeletion("source", f.p.id, createJobContext())).rejects.toThrow(/ownership/i);
  await data.writeJSON(f.other.id, original);
  const plan = await f.s.planDeletion("source", f.p.id, createJobContext()); await data.put({ ...data.header, vaultId: "SYNTHETIC_OTHER_OWNER" }, "header");
  await expect(f.s.executeDeletion(plan, { accepted: true, token: plan.versionToken }, createJobContext())).rejects.toThrow(/ownership/i);
  await data.put(data.header, "header"); expect((await f.s.getStorageInventory(createJobContext())).sourceBytes).toBe(64);
 } finally { data.db.close(); }
});

it("fences deletion during lock and keeps original availability when commit never happened", async () => {
 const f = await fixture(), plan = await f.s.planDeletion("source", f.p.id, createJobContext()), entered = deferred(), release = deferred(), native = crypto.subtle.encrypt.bind(crypto.subtle); let once = false;
 const spy = vi.spyOn(crypto.subtle, "encrypt").mockImplementation(async (...args) => { const result = await native(...args); if (!once && new TextDecoder().decode(args[2]).includes('"retainedAudio"')) { once = true; entered.resolve(); await release.promise; } return result; });
 const deleting = f.s.executeDeletion(plan, { accepted: true, token: plan.versionToken }, createJobContext()), rejected = expect(deleting).rejects.toThrow(); await entered.promise;
 const locking = f.s.lock("manual"); release.resolve(); await rejected; await locking; spy.mockRestore(); await f.s.unlock(secret);
 expect(await f.s.store.readProject(f.p.id, createJobContext())).toEqual(f.p); expect((await f.s.getStorageInventory(createJobContext())).sourceBytes).toBe(64);
});

it("preserves committed deletion against stale captured metadata when lock wins publication", async () => {
 const captured: { project?: MeetingProject } = {}; const f = await fixture({ capturePending: () => captured.project ? [{ project: captured.project, runId: null, audioRecords: [] }] : [] }); captured.project = f.p;
 const plan = await f.s.planDeletion("source", f.p.id, createJobContext()), native = IDBDatabase.prototype.transaction; let locking: Promise<void> | undefined;
 const spy = vi.spyOn(IDBDatabase.prototype, "transaction").mockImplementation(function (this: IDBDatabase, ...args: Parameters<IDBDatabase["transaction"]>) {
  const tx = native.apply(this, args);
  if (args[1] === "readwrite" && Array.isArray(args[0]) && args[0].includes("header") && args[0].includes("records")) tx.addEventListener("complete", () => { locking = f.s.lock("manual"); }, { once: true });
  return tx;
 });
 await expect(f.s.executeDeletion(plan, { accepted: true, token: plan.versionToken }, createJobContext())).rejects.toThrow(); spy.mockRestore(); expect(locking).toBeDefined(); await locking; await f.s.unlock(secret);
 expect(await f.s.store.readProject(f.p.id, createJobContext())).toEqual({ ...f.p, retainedAudio: { sourceIds: [], chunkIds: [f.p.preparedChunks[0].id] } });
 expect((await f.s.getStorageInventory(createJobContext())).sourceBytes).toBe(0);
});

it("drains disposal during held deletion and cannot publish a success from the old session", async () => {
 const f = await fixture(), plan = await f.s.planDeletion("source", f.p.id, createJobContext()), entered = deferred(), release = deferred(), native = crypto.subtle.encrypt.bind(crypto.subtle); let once = false;
 const spy = vi.spyOn(crypto.subtle, "encrypt").mockImplementation(async (...args) => { const result = await native(...args); if (!once && new TextDecoder().decode(args[2]).includes('"retainedAudio"')) { once = true; entered.resolve(); await release.promise; } return result; });
 const deleting = f.s.executeDeletion(plan, { accepted: true, token: plan.versionToken }, createJobContext()), rejected = expect(deleting).rejects.toThrow(); await entered.promise;
 const disposing = f.s.dispose(); release.resolve(); await rejected; await disposing; spy.mockRestore(); await expect(f.s.unlock(secret)).rejects.toThrow();
 const next = createVaultSession({ indexedDB: f.factory, databaseName: f.name, testOnlyOwnership: { acquire: async () => () => {} } }); sessions.push(next); await next.unlock(secret);
 expect(await next.store.readProject(f.p.id, createJobContext())).toEqual(f.p); expect((await next.getStorageInventory(createJobContext())).sourceBytes).toBe(64);
});

it.each(["delete", "DELETE", "DeLeTe"])("reuses confirmed meeting deletion and case-insensitive typed vault reset while a separate fixture database survives: %s", async typedPhrase => {
 const f = await fixture(), sentinel = await new Promise<IDBDatabase>((resolve, reject) => { const request = f.factory.open("synthetic-other-database", 1); request.onupgradeneeded = () => request.result.createObjectStore("sentinel"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
 await new Promise<void>((resolve, reject) => { const tx = sentinel.transaction("sentinel", "readwrite"); tx.objectStore("sentinel").put("SYNTHETIC_UNTOUCHED", "id"); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
 const meeting = await f.s.planDeletion("meeting", f.other.id, createJobContext()); await f.s.executeDeletion(meeting, { accepted: true, token: meeting.versionToken }, createJobContext()); expect(await f.s.store.readProject(f.other.id, createJobContext())).toBeNull();
 const vault = await f.s.planDeletion("vault", null, createJobContext()), job = createJobContext();
 for (const invalid of [undefined, "wrong", "delete!", " delete", "delete ", "DELETE MOM DATA", "MoM 데이터 삭제"]) {
  await expect(f.s.executeDeletion(vault, { accepted: true, token: vault.versionToken, typedPhrase: invalid }, job)).rejects.toThrow(/phrase/i); expect(() => job.assertActive()).not.toThrow();
 }
 expect(await f.s.store.readProject(f.p.id, job)).toEqual(f.p);
 await f.s.executeDeletion(vault, { accepted: true, token: vault.versionToken, typedPhrase }, job); expect(f.s.state).toBe("locked"); await f.s.create(secret, secret); expect(await f.s.store.listProjects(createJobContext())).toEqual([]);
 const value = await new Promise<unknown>((resolve, reject) => { const r = sentinel.transaction("sentinel").objectStore("sentinel").get("id"); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); expect(value).toBe("SYNTHETIC_UNTOUCHED"); sentinel.close();
});

it("atomically deletes source-only records while preserving prepared audio and every result descriptor", async () => {
 const f = await fixture();
 expect(f.s.planDeletion, "real encrypted session exposes selective planning").toBeTypeOf("function");
 const plan = await f.s.planDeletion("source", f.p.id, createJobContext());
 const before = await records(f);
 await f.s.executeDeletion(plan, { accepted: true, token: plan.versionToken }, createJobContext());
 const job = createJobContext(), saved = await f.s.store.readProject(f.p.id, job);
 expect(saved).toEqual({ ...f.p, retainedAudio: { sourceIds: [], chunkIds: [f.p.preparedChunks[0].id] } });
 expect(await f.s.store.readProject(f.other.id, job)).toEqual(f.other);
 await expect(f.s.openRetainedSource(f.p.sourceAssets[0].id, job)).rejects.toThrow();
 expect((await f.s.store.readAudio(f.p.preparedChunks[0].audioRecordId, job)).size).toBe(32);
 const after = await records(f);
 expect(before.filter(record => !after.some(next => next.recordId === record.recordId)).map(record => record.recordId).sort()).toEqual([...plan.recordIds].sort());
 await f.s.lock("manual"); await f.s.unlock(secret);
 expect((await f.s.store.readProject(f.p.id, createJobContext()))?.retainedAudio).toEqual({ sourceIds: [], chunkIds: [f.p.preparedChunks[0].id] });
});
it('deletes every owned interrupted recording fragment while preserving another memo', async () => {
 const f=await fixture(), job=createJobContext();
 const writer=await f.s.createSourceWriter(f.other.id,crypto.randomUUID(),{sampleRateHz:16000,channels:1},job);
 await writer.append(new Uint8Array(32).fill(3),job);await writer.abort();
 expect(await f.s.listSourceDrafts(f.other.id,job)).toMatchObject([{bodyBytes:32}]);
 const m=await metadata(f);
 try {
  const payload=await m.json<{ownedRecords:string[]}>(f.other.id);
  expect(payload.ownedRecords.length).toBeGreaterThan(2);
  await f.s.store.deleteProject(f.other.id,job);
  const remaining=new Set((await records(f)).map(row=>row.recordId));
  expect([...payload.ownedRecords,f.other.id].some(id=>remaining.has(id))).toBe(false);
  expect(await f.s.store.readProject(f.p.id,job)).toEqual(f.p);
  await f.s.lock('manual');await f.s.unlock(secret);
  expect((await f.s.store.listProjects(createJobContext())).map(p=>p.id)).toEqual([f.p.id]);
 } finally {m.db.close();}
});

it('rolls back memo deletion and its tombstones together on storage failure', async () => {
 const f=await fixture(), before=(await records(f)).map(row=>row.recordId).sort(), original=IDBObjectStore.prototype.delete;
 const spy=vi.spyOn(IDBObjectStore.prototype,'delete').mockImplementation(function(this:IDBObjectStore,key:IDBValidKey|IDBKeyRange){
  if(this.name==='records' && key===f.p.id){this.transaction.abort();throw new Error('SYNTHETIC_DELETE_STORAGE_FAILURE');}
  return original.call(this,key);
 });
 await expect(f.s.store.deleteProject(f.p.id,createJobContext())).rejects.toThrow();spy.mockRestore();
 expect((await records(f)).map(row=>row.recordId).sort()).toEqual(before);
 expect(await f.s.store.readProject(f.p.id,createJobContext())).toEqual(f.p);
 await f.s.store.checkpoint({project:f.p,runId:null,audioRecords:[]},createJobContext());
 await f.s.store.deleteProject(f.p.id,createJobContext());
 expect(await f.s.store.readProject(f.p.id,createJobContext())).toBeNull();
});

it("verifies all owned memo records including older source generations disappear while another memo, key and registry survive", async () => {
 const f=await fixture();
 await f.s.saveProviderKey("openai", "SYNTHETIC_DELETION_CHECK_NOT_A_REAL_KEY");
 const registry={version:1 as const,entries:[],defaults:{stt:null,minutes:null},lastCheckedAt:null};
 await f.s.saveModelRegistry(registry,createJobContext());
 await f.s.store.checkpoint({project:f.p,runId:null,audioRecords:[{recordId:f.p.sourceAssets[0].id,audio:new Blob([new Uint8Array(64).fill(8)],{type:"audio/wav"})}]},createJobContext());
 const draftKey=JSON.stringify(['minutes-text',f.p.id,'SYNTHETIC_REVISION']);
 const otherDraftKey=JSON.stringify(['minutes-text',f.other.id,'SYNTHETIC_OTHER_REVISION']);
 const staleScreen={version:1 as const,autoLockSeconds:60 as const,restore:{screen:'minutes',selectedProjectId:f.p.id,settingsTab:'security',drafts:{[draftKey]:'SYNTHETIC_DELETED_DRAFT',[otherDraftKey]:'SYNTHETIC_PRESERVED_DRAFT',settings:'SYNTHETIC_SETTINGS_DRAFT'}}};
 await f.s.saveScreenState(staleScreen,createJobContext());
 const m=await metadata(f);
 try {
  const payload=await m.json<{ownedRecords:string[]}>(f.p.id);
  const otherPayload=await m.json<{ownedRecords:string[]}>(f.other.id);
  expect(payload.ownedRecords.length).toBeGreaterThan(8);
  const before=new Set((await records(f)).map(row=>row.recordId));
  expect([...payload.ownedRecords,f.p.id].every(id=>before.has(id))).toBe(true);
  await f.s.store.deleteProject(f.p.id,createJobContext());
  const after=new Set((await records(f)).map(row=>row.recordId));
  expect([...payload.ownedRecords,f.p.id].some(id=>after.has(id))).toBe(false);
  expect([...otherPayload.ownedRecords,f.other.id].every(id=>after.has(id))).toBe(true);
  expect(await f.s.store.readProject(f.p.id,createJobContext())).toBeNull();
  expect(await f.s.store.readProject(f.other.id,createJobContext())).toEqual(f.other);
  expect(await f.s.getProviderKey("openai")).toBe("SYNTHETIC_DELETION_CHECK_NOT_A_REAL_KEY");
  expect(await f.s.loadModelRegistry(createJobContext())).toEqual(registry);
  expect(await f.s.loadScreenState(createJobContext())).toMatchObject({restore:{screen:'home',selectedProjectId:null,drafts:{[otherDraftKey]:'SYNTHETIC_PRESERVED_DRAFT',settings:'SYNTHETIC_SETTINGS_DRAFT'}}});
  expect((await f.s.loadScreenState(createJobContext()))!.restore!.drafts).not.toHaveProperty(draftKey);
  await expect(f.s.store.checkpoint({project:f.p,runId:null,audioRecords:[]},createJobContext())).rejects.toThrow();
  await f.s.saveScreenState(staleScreen,createJobContext());
  expect((await f.s.loadScreenState(createJobContext()))!.restore!.drafts).not.toHaveProperty(draftKey);
  await f.s.lock("manual");await f.s.unlock(secret);
  await expect(f.s.store.checkpoint({project:f.p,runId:null,audioRecords:[]},createJobContext())).rejects.toThrow();
  expect((await f.s.loadScreenState(createJobContext()))!.restore!.drafts).toEqual({[otherDraftKey]:'SYNTHETIC_PRESERVED_DRAFT',settings:'SYNTHETIC_SETTINGS_DRAFT'});
  expect((await f.s.store.listProjects(createJobContext())).map(p=>p.id)).toEqual([f.other.id]);
 } finally {m.db.close();}
});
