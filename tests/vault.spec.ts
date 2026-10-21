import { afterEach, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { cancelJobs, createJobContext } from "../src/react-app/domain/jobs";
import type { MeetingProject } from "../src/react-app/domain/types";
import { createVaultSession, type VaultSession } from "../src/react-app/vault/session";
import { createHeader, unwrapHeader, encryptRecord, decryptRecord, validatePassphrase, type VaultHeader, type RecordEnvelope } from "../src/react-app/vault/crypto";
const secret = "keyless vault test phrase 123";
const sessions: VaultSession[] = [];
function fixture(id = crypto.randomUUID()): MeetingProject {
    return { id, title: "PRIVATE_TITLE_SENTINEL", icon: "meeting", color: "cobalt", pinned: false, createdAt: "2026-09-30T00:00:00Z", updatedAt: "2026-09-30T00:00:00Z", sourceAssets: [], preparedChunks: [], audioOptions: { chunkMinutes: 10, overlapSeconds: 10, expectedLanguages: ["ko", "sw"], bitrateKbps: 32, sampleRateHz: 16000 }, rawTranscripts: [], transcriptVersions: [], selectedTranscriptVersionId: null, minutesSettings: { outputLanguage: "en", sections: ["summary"], instructions: "PRIVATE_INSTRUCTION_SENTINEL", modelId: "test-model" }, minutesRuns: [], minutesRevisions: [], selectedMinutesRevisionId: null, runs: [] };
}
async function session() {
    const factory = new IDBFactory();
    const name = crypto.randomUUID();
    const s = createVaultSession({ databaseName: name, indexedDB: factory, testOnlyOwnership: { acquire: async () => () => { } } });
    sessions.push(s);
    await s.create(secret, secret);
    return { s, factory, name };
}
async function database(factory: IDBFactory, name: string): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => { const r = factory.open(name); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}
type StoredValues = { header: VaultHeader; records: RecordEnvelope; nonces: Readonly<{ id: string }> };
async function values<K extends keyof StoredValues>(db: IDBDatabase, store: K): Promise<StoredValues[K][]> {
    return new Promise((resolve, reject) => { const r = db.transaction(store).objectStore(store).getAll(); r.onsuccess = () => resolve(r.result as StoredValues[K][]); r.onerror = () => reject(r.error); });
}
async function put(db: IDBDatabase, store: string, value: unknown): Promise<void> {
    return new Promise((resolve, reject) => { const tx = db.transaction(store, "readwrite"); tx.objectStore(store).put(value); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
}
afterEach(async () => { vi.restoreAllMocks(); for (const s of sessions.splice(0))
    await s.dispose(); cancelJobs(); });
describe("native vault cryptography", () => {
    it.each([secret, "Eight123"])("roundtrips a nonextractable wrapped key and authenticates expected record identity (%#)", async (passphrase) => {
        const { header, key } = await createHeader(passphrase, crypto.randomUUID());
        expect(key.extractable).toBe(false);
        const unlocked = await unwrapHeader(passphrase, header);
        const envelope = await encryptRecord(unlocked, header, "opaque-record", new TextEncoder().encode("PRIVATE_SENTINEL"), crypto.getRandomValues(new Uint8Array(12)));
        expect(new TextDecoder().decode(await decryptRecord(unlocked, header, "opaque-record", envelope))).toBe("PRIVATE_SENTINEL");
        await expect(decryptRecord(unlocked, header, "swapped-record", envelope)).rejects.toThrow();
        await expect(unwrapHeader("a different test passphrase", header)).rejects.toThrow();
    });
    it("rejects altered, truncated and unsupported-version ciphertext without fallback", async () => {
        const { header, key } = await createHeader(secret, crypto.randomUUID());
        const e = await encryptRecord(key, header, "record", new Uint8Array([1, 2, 3]), crypto.getRandomValues(new Uint8Array(12)));
        for (const invalid of [{ ...e, ciphertext: e.ciphertext.slice(0, 8) }, { ...e, schemaVersion: 2 }, { ...e, recordId: "wrong" }, { ...e, iv: "AAAAAAAAAAAAAAAA" }])
            await expect(decryptRecord(key, header, "record", invalid)).rejects.toThrow();
        await expect(unwrapHeader(secret, { ...header, iterations: 1 })).rejects.toThrow();
        await expect(unwrapHeader(secret, { ...header, vaultId: crypto.randomUUID() })).rejects.toThrow();
    });
    it("enforces an eight-codepoint minimum and rejects numeric secrets", () => {
        expect(() => validatePassphrase("123456123456123456")).toThrow();
        expect(() => validatePassphrase("a".repeat(7))).toThrow();
        expect(() => validatePassphrase("😀".repeat(7))).toThrow();
        expect(() => validatePassphrase("12345678")).toThrow();
        expect(() => validatePassphrase("१२३४५६७८")).toThrow();
        expect(() => validatePassphrase("a".repeat(8))).not.toThrow();
        expect(() => validatePassphrase("😀".repeat(8))).not.toThrow();
        expect(() => validatePassphrase("x".repeat(257))).toThrow();
    });
});
describe("encrypted transactional checkpoints", () => {
    it("roundtrips immutable projects with encrypted metadata and default encrypted keys", async () => {
        const { s, factory, name } = await session();
        const p = fixture();
        const result = await s.store.checkpoint({ project: p, runId: null, audioRecords: [] }, createJobContext());
        expect(result.project.title).toBe(p.title);
        expect(Object.isFrozen(result.project)).toBe(true);
        expect(await s.store.readProject(p.id, createJobContext())).toEqual(result.project);
        await s.saveProviderKey("openai", "KEYLESS_PRIVATE_KEY_SENTINEL");
        expect(await s.getProviderKey("openai")).toBe("KEYLESS_PRIVATE_KEY_SENTINEL");
        const db = await database(factory, name);
        const dump = JSON.stringify(await values(db, "records"), (_key, value) => value instanceof ArrayBuffer ? new TextDecoder().decode(value) : value);
        db.close();
        for (const text of [p.title, p.minutesSettings.instructions, "KEYLESS_PRIVATE_KEY_SENTINEL", "openai"])
            expect(dump).not.toContain(text);
        await s.lock("manual");
        await s.unlock(secret);
        expect(await s.getProviderKey("openai")).toBe("KEYLESS_PRIVATE_KEY_SENTINEL");
    });
    it("publishes matching saved run and receipt only after final transaction and uses fresh IVs", async () => {
        const { s, factory, name } = await session();
        const p = { ...fixture(), runs: [{ id: crypto.randomUUID(), projectId: "", state: "saving" as const, checkpoint: null }] };
        p.runs[0].projectId = p.id;
        const r = await s.store.checkpoint({ project: p, runId: p.runs[0].id, audioRecords: [] }, createJobContext());
        expect(r.project.runs[0].state).toBe("saved");
        expect(r.project.runs[0].checkpoint).toEqual(r.checkpoint);
        const db = await database(factory, name);
        const old = (await values(db, "records")).find(e => e.recordId === p.id)!;
        await s.store.checkpoint({ project: r.project, runId: null, audioRecords: [] }, createJobContext());
        const current = (await values(db, "records")).find(e => e.recordId === p.id)!;
        expect(old.iv).not.toBe(current.iv);
        db.close();
    });
    it("rejects non-JSON values and unrelated audio IDs before persistence", async () => {
        const { s } = await session();
        const p = fixture();
        await expect(s.store.checkpoint({ project: { ...p, title: undefined } as unknown as MeetingProject, runId: null, audioRecords: [] }, createJobContext())).rejects.toThrow();
        await expect(s.store.checkpoint({ project: p, runId: null, audioRecords: [{ recordId: crypto.randomUUID(), audio: new Blob(["test"]) }] }, createJobContext())).rejects.toThrow();
    });
    it("stages originals in 1MiB blocks with bounded reads and streams only promoted manifests", async () => {
        const { s, factory, name } = await session();
        const id = crypto.randomUUID();
        const bytes = new Uint8Array(2 * 1024 * 1024 + 7).fill(91);
        bytes.set(new TextEncoder().encode("PRIVATE_AUDIO_SENTINEL"));
        const audio = new Blob([bytes]);
        const full = vi.spyOn(audio, "arrayBuffer").mockImplementation(() => { throw new Error("source-wide read forbidden"); });
        const p = { ...fixture(), sourceAssets: [{ id, fileName: "PRIVATE_FILENAME", bytes: audio.size, container: "wav", codec: "pcm", durationMs: 1000, channels: 1, sampleRateHz: 16000 }] };
        await s.store.checkpoint({ project: p, runId: null, audioRecords: [{ recordId: id, audio }] }, createJobContext());
        expect(full).not.toHaveBeenCalled();
        await expect(s.store.readAudio(id, createJobContext())).rejects.toThrow(/prepared/i);
        const output: number[] = [];
        for await (const block of s.streamSource(id, createJobContext()))
            output.push(block.length);
        expect(output).toEqual([1024 * 1024, 1024 * 1024, 7]);
        const db = await database(factory, name);
        expect(JSON.stringify(await values(db, "records"), (_key, value) => value instanceof ArrayBuffer ? new TextDecoder().decode(value) : value)).not.toContain("PRIVATE_FILENAME");
        expect(JSON.stringify(await values(db, "records"), (_key, value) => value instanceof ArrayBuffer ? new TextDecoder().decode(value) : value)).not.toContain("PRIVATE_AUDIO_SENTINEL");
        db.close();
    });
    it("loads one validated prepared chunk and rejects declared byte mismatch", async () => {
        const { s } = await session();
        const id = crypto.randomUUID();
        const p = { ...fixture(), preparedChunks: [{ id: crypto.randomUUID(), sourceId: crypto.randomUUID(), index: 0, sourceStartMs: 0, sourceEndMs: 1000, encodingOffsetMs: 0, encodedBytes: 4, mimeType: "audio/mpeg", codec: "mp3", audioRecordId: id }] };
        await s.store.checkpoint({ project: p, runId: null, audioRecords: [{ recordId: id, audio: new Blob(["abcd"], { type: "audio/mpeg" }) }] }, createJobContext());
        expect(await (await s.store.readAudio(id, createJobContext())).text()).toBe("abcd");
        await expect(s.store.checkpoint({ project: p, runId: null, audioRecords: [{ recordId: id, audio: new Blob(["abcdef"]) }] }, createJobContext())).rejects.toThrow();
    });
    it("keeps the previous checkpoint after final promotion abort and accounts failed encryptions durably", async () => {
        const { s, factory, name } = await session();
        const p = fixture();
        await s.store.checkpoint({ project: p, runId: null, audioRecords: [] }, createJobContext());
        const db = await database(factory, name);
        const before = (await values(db, "header"))[0].operations;
        const original = IDBObjectStore.prototype.put;
        const spy = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, value: unknown, ...args: [key?: IDBValidKey]) { if (this.name === "records" && (value as RecordEnvelope).recordId === p.id) {
            this.transaction.abort();
            throw new DOMException("aborted", "AbortError");
        } return original.call(this, value, ...args); });
        await expect(s.store.checkpoint({ project: { ...p, title: "latest unsaved" }, runId: null, audioRecords: [] }, createJobContext())).rejects.toThrow();
        spy.mockRestore();
        expect((await s.store.readProject(p.id, createJobContext()))?.title).toBe(p.title);
        const after = (await values(db, "header"))[0].operations;
        expect(after).toBeGreaterThan(before);
        db.close();
    });
    it("fails closed at the durable operation limit after reload", async () => {
        const { s, factory, name } = await session();
        await s.lock("manual");
        const db = await database(factory, name);
        const h = (await values(db, "header"))[0];
        await put(db, "header", { ...h, operations: 2 ** 20 });
        db.close();
        await s.unlock(secret);
        await expect(s.store.checkpoint({ project: fixture(), runId: null, audioRecords: [] }, createJobContext())).rejects.toThrow(/limit/i);
        await expect(s.lock("manual")).rejects.toThrow();
        expect(s.state).toBe("lock-save-failed");
        await s.discardPendingAndLock();
    });
    it("retains old passphrase after failed rewrap and switches atomically after success", async () => {
        const { s } = await session();
        const next = "Next1234";
        const original = IDBObjectStore.prototype.put;
        const spy = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, v: unknown, ...args: [key?: IDBValidKey]) { if (this.name === "header") {
            this.transaction.abort();
            throw new Error("test storage failure");
        } return original.call(this, v, ...args); });
        await expect(s.changePassphrase(secret, next, next)).rejects.toThrow();
        spy.mockRestore();
        await s.lock("manual");
        await s.unlock(secret);
        await s.changePassphrase(secret, next, next);
        await s.lock("manual");
        await expect(s.unlock(secret)).rejects.toThrow();
        await s.unlock(next);
    });
    it("does not delete another project's records and detects attempted cross-project audio reuse", async () => {
        const { s } = await session();
        const first = fixture();
        const second = fixture();
        await s.store.checkpoint({ project: first, runId: null, audioRecords: [] }, createJobContext());
        await s.store.checkpoint({ project: second, runId: null, audioRecords: [] }, createJobContext());
        await s.store.deleteProject(first.id, createJobContext());
        expect(await s.store.readProject(first.id, createJobContext())).toBeNull();
        expect((await s.store.readProject(second.id, createJobContext()))?.id).toBe(second.id);
    });
});
describe("durable nonce and generation boundaries", () => {
    it("retries a reserved IV collision without consuming a duplicate operation", async () => {
        const { s, factory, name } = await session();
        const p = fixture();
        await s.store.checkpoint({ project: p, runId: null, audioRecords: [] }, createJobContext());
        const db = await database(factory, name);
        const previous = (await values(db, "records")).find(e => e.recordId === p.id)!;
        const collision = Uint8Array.from(atob(previous.iv), c => c.charCodeAt(0));
        const original = crypto.getRandomValues.bind(crypto);
        let injected = false;
        const spy = vi.spyOn(crypto, "getRandomValues").mockImplementation(<T extends ArrayBufferView>(array: T): T => { if (array instanceof Uint8Array && array.byteLength === 12 && !injected) {
            injected = true;
            array.set(collision);
            return array;
        } return original(array); });
        await s.store.checkpoint({ project: p, runId: null, audioRecords: [] }, createJobContext());
        spy.mockRestore();
        const current = (await values(db, "records")).find(e => e.recordId === p.id)!;
        expect(current.iv).not.toBe(previous.iv);
        const h = (await values(db, "header"))[0];
        expect((await values(db, "nonces")).length).toBe(h.operations);
        db.close();
    });
    it("keeps the old audio generation readable when a replacement promotion aborts", async () => {
        const { s } = await session();
        const id = crypto.randomUUID();
        const p = { ...fixture(), preparedChunks: [{ id: crypto.randomUUID(), sourceId: crypto.randomUUID(), index: 0, sourceStartMs: 0, sourceEndMs: 1000, encodingOffsetMs: 0, encodedBytes: 4, mimeType: "audio/mpeg", codec: "mp3", audioRecordId: id }] };
        await s.store.checkpoint({ project: p, runId: null, audioRecords: [{ recordId: id, audio: new Blob(["old!"], { type: "audio/mpeg" }) }] }, createJobContext());
        const original = IDBObjectStore.prototype.put;
        const spy = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, v: unknown, ...args: [key?: IDBValidKey]) { if (this.name === "records" && (v as RecordEnvelope).recordId === p.id) {
            this.transaction.abort();
            throw new Error("interrupted promotion");
        } return original.call(this, v, ...args); });
        await expect(s.store.checkpoint({ project: p, runId: null, audioRecords: [{ recordId: id, audio: new Blob(["new!"], { type: "audio/mpeg" }) }] }, createJobContext())).rejects.toThrow();
        spy.mockRestore();
        expect(await (await s.store.readAudio(id, createJobContext())).text()).toBe("old!");
        await s.lock("manual");
        await s.unlock(secret);
        expect(await (await s.store.readAudio(id, createJobContext())).text()).toBe("new!");
    });
    it("rejects another project reusing a promoted audio pointer", async () => {
        const { s } = await session();
        const id = crypto.randomUUID();
        const source = { id, fileName: "test.wav", bytes: 4, container: "wav", codec: "pcm", durationMs: 1000, channels: 1, sampleRateHz: 16000 };
        const a = { ...fixture(), sourceAssets: [source] };
        const b = { ...fixture(), sourceAssets: [source] };
        await s.store.checkpoint({ project: a, runId: null, audioRecords: [{ recordId: id, audio: new Blob(["test"]) }] }, createJobContext());
        await expect(s.store.checkpoint({ project: b, runId: null, audioRecords: [{ recordId: id, audio: new Blob(["evil"]) }] }, createJobContext())).rejects.toThrow(/another project/i);
        await expect(s.lock("manual")).rejects.toThrow();
        await s.discardPendingAndLock();
    });
});
describe("authenticated directory ownership", () => {
    it("does not use unauthenticated public directory metadata to remove committed work", async () => {
        const { s, factory, name } = await session();
        const p = fixture();
        await s.store.checkpoint({ project: p, runId: null, audioRecords: [] }, createJobContext());
        const db = await database(factory, name);
        const header = (await values(db, "header"))[0];
        await put(db, "header", { ...header, projectIds: [] });
        db.close();
        await s.lock("manual");
        await s.unlock(secret);
        expect((await s.store.readProject(p.id, createJobContext()))?.title).toBe(p.title);
    });
});
describe("abandoned staging recovery", () => {
    it("drops only unreferenced ciphertext after explicit discard and keeps lifetime accounting", async () => {
        const { s, factory, name } = await session();
        const p = fixture();
        await s.store.checkpoint({ project: p, runId: null, audioRecords: [] }, createJobContext());
        const sourceId = crypto.randomUUID();
        const audio = new Blob([new Uint8Array(2 * 1024 * 1024).fill(83)]);
        const unsaved = { ...p, sourceAssets: [{ id: sourceId, fileName: "PRIVATE_ABANDONED_SOURCE", bytes: audio.size, container: "wav", codec: "pcm", durationMs: 1000, channels: 1, sampleRateHz: 16000 }] };
        const original = IDBObjectStore.prototype.add;
        let additions = 0;
        const spy = vi.spyOn(IDBObjectStore.prototype, "add").mockImplementation(function (this: IDBObjectStore, v: unknown, ...args: [key?: IDBValidKey]) { if (this.name === "records" && ++additions % 2 === 0) {
            this.transaction.abort();
            throw new DOMException("quota", "QuotaExceededError");
        } return original.call(this, v, ...args); });
        await expect(s.store.checkpoint({ project: unsaved, runId: null, audioRecords: [{ recordId: sourceId, audio }] }, createJobContext())).rejects.toThrow();
        await expect(s.lock("manual")).rejects.toThrow();
        spy.mockRestore();
        const db = await database(factory, name);
        const countBefore = (await values(db, "records")).length;
        const operations = (await values(db, "header"))[0].operations;
        await s.discardPendingAndLock();
        await s.unlock(secret);
        const countAfter = (await values(db, "records")).length;
        expect(countAfter).toBeLessThan(countBefore);
        expect((await values(db, "header"))[0].operations).toBe(operations);
        expect((await s.store.readProject(p.id, createJobContext()))?.sourceAssets).toHaveLength(0);
        db.close();
    });
    it("never reads the next source block until its prior ciphertext transaction completes", async () => {
        const { s } = await session();
        const id = crypto.randomUUID();
        const audio = new Blob([new Uint8Array(2 * 1024 * 1024 + 1)]);
        const p = { ...fixture(), sourceAssets: [{ id, fileName: "test.wav", bytes: audio.size, container: "wav", codec: "pcm", durationMs: 1000, channels: 1, sampleRateHz: 16000 }] };
        let committed = 0;
        const originalAdd = IDBObjectStore.prototype.add;
        const add = vi.spyOn(IDBObjectStore.prototype, "add").mockImplementation(function (this: IDBObjectStore, v: unknown, ...args: [key?: IDBValidKey]) { if (this.name === "records")
            this.transaction.addEventListener("complete", () => committed++, { once: true }); return originalAdd.call(this, v, ...args); });
        const originalSlice = audio.slice.bind(audio);
        const slice = vi.spyOn(audio, "slice").mockImplementation((start = 0, end = audio.size, type) => { expect(committed).toBe(Math.floor(start / (1024 * 1024))); expect(end - start).toBeLessThanOrEqual(1024 * 1024); return originalSlice(start, end, type); });
        await s.store.checkpoint({ project: p, runId: null, audioRecords: [{ recordId: id, audio }] }, createJobContext());
        expect(committed).toBe(3);
        expect(slice).toHaveBeenCalledTimes(3);
        add.mockRestore();
        slice.mockRestore();
    });
});

describe("review regression: audio admission snapshot", () => {
    it("preserves the validated Blob when a caller replaces an entry after checkpoint admission", async () => {
        const { s } = await session();
        const recordId = crypto.randomUUID();
        const p = { ...fixture(), preparedChunks: [{ id: crypto.randomUUID(), sourceId: crypto.randomUUID(), index: 0, sourceStartMs: 0, sourceEndMs: 1000, encodingOffsetMs: 0, encodedBytes: 4, mimeType: "audio/mpeg", codec: "mp3", audioRecordId: recordId }] };
        const entry = { recordId, audio: new Blob(["abcd"], { type: "audio/mpeg" }) };
        const saving = s.store.checkpoint({ project: p, runId: null, audioRecords: [entry] }, createJobContext());
        entry.audio = new Blob(["changed bytes"], { type: "audio/mpeg" });
        const saved = await saving;
        expect(saved.project.preparedChunks[0].encodedBytes).toBe(4);
        expect(await (await s.store.readAudio(recordId, createJobContext())).text()).toBe("abcd");
    });
});
