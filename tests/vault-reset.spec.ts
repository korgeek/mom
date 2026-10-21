import { afterEach, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { cancelJobs, createJobContext } from "../src/react-app/domain/jobs";
import type { MeetingProject, ModelRegistry } from "../src/react-app/domain/types";
import { createVaultSession, type Ownership, type VaultSession, type VaultSessionOptions } from "../src/react-app/vault/session";
import { openVaultDatabase, readHeader } from "../src/react-app/vault/store";

const secret = "synthetic reset test passphrase only";
const sessions: VaultSession[] = [];
const handles: IDBDatabase[] = [];
function owners(): Ownership {
    const held = new Set<string>();
    return { async acquire(name) { if (held.has(name)) return null; held.add(name); return () => { held.delete(name); }; } };
}
function fixture(options: VaultSessionOptions = {}) {
    const indexedDB = new IDBFactory(), databaseName = crypto.randomUUID(), testOnlyOwnership = owners();
    const make = (extra: VaultSessionOptions = {}) => {
        const session = createVaultSession({ indexedDB, databaseName, testOnlyOwnership, ...options, ...extra });
        sessions.push(session);
        return session;
    };
    return { indexedDB, databaseName, make };
}
async function database(indexedDB: IDBFactory, name: string) {
    const db = await openVaultDatabase(indexedDB, name);
    handles.push(db);
    return db;
}
async function counts(db: IDBDatabase) {
    return Promise.all(["header", "records", "nonces"].map(name => new Promise<number>((resolve, reject) => {
        const request = db.transaction(name).objectStore(name).count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    })));
}
function project(): MeetingProject {
    return { id: crypto.randomUUID(), title: "SYNTHETIC_RESET_PROJECT", icon: "mic", color: "blue", pinned: false, createdAt: "2026-10-02T00:00:00Z", updatedAt: "2026-10-02T00:00:00Z", sourceAssets: [], preparedChunks: [], audioOptions: { chunkMinutes: 10, overlapSeconds: 10, expectedLanguages: ["ko"], bitrateKbps: 32, sampleRateHz: 16000 }, rawTranscripts: [], transcriptVersions: [], selectedTranscriptVersionId: null, minutesSettings: { outputLanguage: "en", sections: ["summary"], instructions: "SYNTHETIC_RESET_INSTRUCTIONS", modelId: "synthetic-model" }, minutesRuns: [], minutesRevisions: [], selectedMinutesRevisionId: null, runs: [] };
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
async function put(db: IDBDatabase, name: string, value: unknown) {
    await new Promise<void>((resolve, reject) => { const tx = db.transaction(name, "readwrite"); tx.objectStore(name).put(value); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
}
function holdTransaction(db: IDBDatabase) {
    const entered = deferred(), completed = deferred(); let held = true;
    const tx = db.transaction(["header", "records", "nonces"], "readwrite");
    const next = () => { const request = tx.objectStore("records").get("synthetic-held-transaction"); request.onsuccess = () => { entered.resolve(); if (held) next(); }; };
    tx.oncomplete = () => completed.resolve(); tx.onabort = () => completed.resolve(); next();
    return { entered: entered.promise, completed: completed.promise, release: () => { held = false; } };
}
const reset = (session: VaultSession) => session.reset();
afterEach(async () => {
    vi.restoreAllMocks();
    for (const db of handles.splice(0)) db.close();
    for (const session of sessions.splice(0)) await session.dispose();
    cancelJobs();
});

describe("passwordless vault reset", () => {
    it("acquires database ownership before opening or reading a cached vault header", async () => {
        const events: string[] = [], f = fixture();
        const native = f.indexedDB.open.bind(f.indexedDB);
        vi.spyOn(f.indexedDB, "open").mockImplementation((...args) => { events.push("open"); return native(...args); });
        const s = f.make({ testOnlyOwnership: { async acquire(name) { events.push(name); return () => {}; } } });
        await s.create(secret, secret);
        expect(events[0]).toBe(`mom:vault-create:${f.databaseName}`);
    });
    it("removes every owned store without a passphrase and leaves another database untouched", async () => {
        const f = fixture(), s = f.make(); await s.create(secret, secret);
        await s.store.checkpoint({ project: project(), runId: null, audioRecords: [] }, createJobContext());
        await s.saveProviderKey("synthetic-provider", "SYNTHETIC_ENCRYPTED_KEY");
        const registry: ModelRegistry = { version: 1, entries: [], defaults: { stt: null, minutes: null }, lastCheckedAt: "2026-10-02T00:00:00Z" };
        await s.saveModelRegistry(registry, createJobContext());
        await s.lock("manual");
        const target = await database(f.indexedDB, f.databaseName), other = await database(f.indexedDB, "unrelated-synthetic-database");
        await new Promise<void>((resolve, reject) => { const tx = other.transaction("header", "readwrite"); tx.objectStore("header").put({ id: "vault", sentinel: "UNRELATED_SYNTHETIC" }); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
        expect((await counts(target)).every(n => n > 0)).toBe(true);
        const removeDatabase = vi.spyOn(f.indexedDB, "deleteDatabase");
        await reset(s);
        expect(s.state).toBe("locked");
        expect(await counts(target)).toEqual([0, 0, 0]);
        expect((await counts(other))[0]).toBe(1);
        expect(removeDatabase).not.toHaveBeenCalled();
        await expect(s.unlock(secret)).rejects.toThrow(/create/i);
        await s.create(secret, secret);
        expect(await s.store.listProjects(createJobContext())).toEqual([]);
        expect(await s.getProviderKey("synthetic-provider")).toBeNull();
        expect(await s.loadModelRegistry(createJobContext())).toBeNull();
    });
    it("fences active work and clears playback before wiping, without saving captured drafts", async () => {
        const events: string[] = [], capture = vi.fn(() => [{ project: project(), runId: null, audioRecords: [] }]);
        const f = fixture({ capturePending: capture, onState: state => events.push(state), onSensitiveClear: () => events.push("clear"), teardown: () => events.push("teardown") });
        const s = f.make(); await s.create(secret, secret); events.length = 0;
        await s.saveProviderKey("synthetic-session", "SYNTHETIC_SESSION_KEY", "session");
        const old = s.store, job = createJobContext();
        const native = IDBObjectStore.prototype.clear;
        vi.spyOn(IDBObjectStore.prototype, "clear").mockImplementation(function (this: IDBObjectStore) { events.push(`wipe:${this.name}`); return native.call(this); });
        const resetting = reset(s);
        expect(s.state).toBe("locking");
        expect(job.signal.aborted).toBe(true);
        expect(events).toEqual(["locking", "clear", "teardown"]);
        await expect(old.listProjects(createJobContext())).rejects.toThrow();
        await resetting;
        expect(capture).not.toHaveBeenCalled();
        expect(events.slice(3, 6)).toEqual(["wipe:header", "wipe:records", "wipe:nonces"]);
        const db = await database(f.indexedDB, f.databaseName);
        expect(await counts(db)).toEqual([0, 0, 0]);
    });
    it("fails closed while another session owns the vault, and can retry only after that owner locks", async () => {
        const f = fixture(), a = f.make(), b = f.make(); await a.create(secret, secret);
        const p = project(); await a.store.checkpoint({ project: p, runId: null, audioRecords: [] }, createJobContext());
        const job = createJobContext();
        await expect(reset(b)).rejects.toThrow(/owner/i);
        expect(b.state).toBe("locked"); expect(job.signal.aborted).toBe(false);
        expect((await a.store.readProject(p.id, job))?.title).toBe(p.title);
        await a.lock("manual"); await reset(b);
        const db = await database(f.indexedDB, f.databaseName); expect(await counts(db)).toEqual([0, 0, 0]);
    });
    it("also respects a legacy vault-ID owner that does not hold the database-name lock", async () => {
        const f = fixture(), s = f.make(); await s.create(secret, secret); await s.lock("manual");
        const db = await database(f.indexedDB, f.databaseName), header = (await readHeader(db))!;
        const before = await counts(db), clear = vi.spyOn(IDBObjectStore.prototype, "clear");
        const legacy = f.make({ testOnlyOwnership: { async acquire(name) { return name === `mom:vault:${header.vaultId}` ? null : () => {}; } } });
        await expect(reset(legacy)).rejects.toThrow(/owner/i);
        expect(clear).not.toHaveBeenCalled(); expect(await counts(db)).toEqual(before);
    });
    it("keeps reset and creation mutually exclusive while a creator derives its new key", async () => {
        const f = fixture(), creator = f.make(), resetter = f.make(), entered = deferred(), proceed = deferred();
        const native = crypto.subtle.deriveKey.bind(crypto.subtle);
        vi.spyOn(crypto.subtle, "deriveKey").mockImplementation(async (...args) => { const key = await native(...args); entered.resolve(); await proceed.promise; return key; });
        const creating = creator.create(secret, secret); await entered.promise;
        await expect(reset(resetter)).rejects.toThrow(/owner/i);
        proceed.resolve(); await creating;
        expect(creator.state).toBe("unlocked");
        await creator.lock("manual"); await reset(resetter);
    });
    it("does not revive a cached header when an opening is waiting for reset ownership", async () => {
        const f = fixture(), seed = f.make(); await seed.create(secret, secret); await seed.lock("manual");
        const beforeAcquire = deferred(), proceed = deferred(); let first = true;
        const shared = owners();
        const waiting = f.make({ testOnlyOwnership: { async acquire(name) { if (first) { first = false; beforeAcquire.resolve(); await proceed.promise; } return shared.acquire(name); } } });
        const opening = waiting.unlock(secret), rejected = expect(opening).rejects.toThrow(/create/i); await beforeAcquire.promise;
        const resetter = f.make({ testOnlyOwnership: shared }); await reset(resetter);
        proceed.resolve(); await rejected;
        expect(waiting.state).toBe("locked");
        await waiting.create(secret, secret); expect(await waiting.store.listProjects(createJobContext())).toEqual([]);
    });
    it("prevents a late creation from writing a header after disposal was requested", async () => {
        const f = fixture(), s = f.make(), entered = deferred(), proceed = deferred();
        const native = crypto.subtle.deriveKey.bind(crypto.subtle);
        vi.spyOn(crypto.subtle, "deriveKey").mockImplementation(async (...args) => { const key = await native(...args); entered.resolve(); await proceed.promise; return key; });
        const creating = s.create(secret, secret), rejected = expect(creating).rejects.toThrow(/interrupted/i); await entered.promise;
        await expect(s.unlock(secret)).rejects.toThrow();
        const disposing = s.dispose(); void disposing.catch(() => {}); proceed.resolve(); await rejected; await disposing;
        const db = await database(f.indexedDB, f.databaseName); expect(await counts(db)).toEqual([0, 0, 0]);
        await expect(reset(s)).rejects.toThrow(); await expect(s.create(secret, secret)).rejects.toThrow();
    });
    it.each(["clear", "teardown"] as const)("does not wipe when the %s boundary fails, and requires explicit reset retry", async boundary => {
        let fail = true;
        const f = fixture({ onSensitiveClear: () => { if (boundary === "clear" && fail) throw new Error("SYNTHETIC_CLEAR_FAILURE"); }, teardown: () => { if (boundary === "teardown" && fail) throw new Error("SYNTHETIC_TEARDOWN_FAILURE"); } });
        const s = f.make(); await s.create(secret, secret);
        const db = await database(f.indexedDB, f.databaseName), before = await counts(db), wipe = vi.spyOn(IDBObjectStore.prototype, "clear");
        await expect(reset(s)).rejects.toThrow(/boundary/i);
        expect(wipe).not.toHaveBeenCalled(); expect(await counts(db)).toEqual(before);
        expect(s.state).toBe("lock-save-failed");
        await expect(s.unlock(secret)).rejects.toThrow();
        await expect(s.retryLock()).rejects.toThrow(/reset/i); await expect(s.discardPendingAndLock()).rejects.toThrow(/reset/i);
        fail = false; await reset(s); expect(await counts(db)).toEqual([0, 0, 0]);
    });
    it("rolls back all stores on a wipe transaction abort and never performs a later deletion", async () => {
        const f = fixture(), s = f.make(); await s.create(secret, secret); await s.lock("manual");
        const db = await database(f.indexedDB, f.databaseName), before = await counts(db), native = IDBObjectStore.prototype.clear;
        const spy = vi.spyOn(IDBObjectStore.prototype, "clear").mockImplementation(function (this: IDBObjectStore) { const request = native.call(this); if (this.name === "records") this.transaction.abort(); return request; });
        await expect(reset(s)).rejects.toThrow(/storage|reset/i);
        spy.mockRestore(); expect(s.state).toBe("locked"); expect(await counts(db)).toEqual(before);
        await s.unlock(secret); await s.lock("manual"); expect(await counts(db)).toEqual(before);
        await reset(s); expect(await counts(db)).toEqual([0, 0, 0]);
    });
    it("holds ownership until a queued wipe commits and disposal waits for that durable outcome", async () => {
        const f = fixture(), s = f.make(); await s.create(secret, secret); await s.lock("manual");
        const db = await database(f.indexedDB, f.databaseName), held = holdTransaction(db); await held.entered;
        let settled = false, disposed = false;
        const resetting = reset(s).then(() => { settled = true; });
        const disposing = s.dispose().then(() => { disposed = true; });
        const contender = f.make(); await expect(contender.create(secret, secret)).rejects.toThrow(/owner/i);
        expect(settled).toBe(false); expect(disposed).toBe(false); expect(s.state).toBe("locking");
        held.release(); await held.completed; await resetting; await disposing;
        expect(await counts(db)).toEqual([0, 0, 0]);
        await expect(s.create(secret, secret)).rejects.toThrow();
        await contender.create(secret, secret);
    });
    it("drains a decrypting read and clears its late plaintext before the wipe", async () => {
        const f = fixture(), s = f.make(); await s.create(secret, secret); const p = project();
        await s.store.checkpoint({ project: p, runId: null, audioRecords: [] }, createJobContext());
        const entered = deferred(), proceed = deferred(), native = crypto.subtle.decrypt.bind(crypto.subtle); let bytes!: Uint8Array;
        vi.spyOn(crypto.subtle, "decrypt").mockImplementation(async (...args) => { const result = await native(...args); bytes = new Uint8Array(result); entered.resolve(); await proceed.promise; return result; });
        const reading = s.store.readProject(p.id, createJobContext()), rejected = expect(reading).rejects.toThrow(); await entered.promise;
        let wiped = false; const resetting = reset(s).then(() => { wiped = true; });
        expect(wiped).toBe(false); proceed.resolve(); await rejected; await resetting;
        expect(bytes.every(value => value === 0)).toBe(true);
        const db = await database(f.indexedDB, f.databaseName); expect(await counts(db)).toEqual([0, 0, 0]);
    });
    it("drains pending encryption and fences queued writes instead of resurrecting records", async () => {
        const f = fixture(), s = f.make(); await s.create(secret, secret);
        const entered = deferred(), proceed = deferred(), native = crypto.subtle.encrypt.bind(crypto.subtle); let plaintext!: Uint8Array;
        vi.spyOn(crypto.subtle, "encrypt").mockImplementation(async (...args) => { const result = await native(...args); plaintext = args[2] as Uint8Array; entered.resolve(); await proceed.promise; return result; });
        const first = s.store.checkpoint({ project: project(), runId: null, audioRecords: [] }, createJobContext()), firstRejected = expect(first).rejects.toThrow(); await entered.promise;
        const second = s.saveProviderKey("synthetic-provider", "SYNTHETIC_QUEUED_KEY"), secondRejected = expect(second).rejects.toThrow();
        const resetting = reset(s); proceed.resolve(); await firstRejected; await secondRejected; await resetting;
        expect(plaintext.every(value => value === 0)).toBe(true);
        const db = await database(f.indexedDB, f.databaseName); expect(await counts(db)).toEqual([0, 0, 0]);
    });
    it("closes a paused audio stream and zeroes its retained decrypted block", async () => {
        const f = fixture(), s = f.make(); await s.create(secret, secret); const id = crypto.randomUUID();
        const p = { ...project(), sourceAssets: [{ id, fileName: "synthetic.wav", bytes: 4, container: "wav", codec: "pcm", durationMs: 1000, channels: 1, sampleRateHz: 16000 }] };
        await s.store.checkpoint({ project: p, runId: null, audioRecords: [{ recordId: id, audio: new Blob(["test"]) }] }, createJobContext());
        const stream = s.streamSource(id, createJobContext())[Symbol.asyncIterator](), block = await stream.next();
        expect([...block.value!]).toEqual([116, 101, 115, 116]);
        await reset(s); expect([...block.value!]).toEqual([0, 0, 0, 0]); expect((await stream.next()).done).toBe(true);
        const db = await database(f.indexedDB, f.databaseName); expect(await counts(db)).toEqual([0, 0, 0]);
    });
    it("resets an empty missing vault without requiring a passphrase", async () => {
        const f = fixture(), s = f.make(); await reset(s);
        const db = await database(f.indexedDB, f.databaseName); expect(await counts(db)).toEqual([0, 0, 0]);
        await s.create(secret, secret);
    });
    it("resets unsupported header metadata when its exact owner identity remains available", async () => {
        const f = fixture(), s = f.make(), db = await database(f.indexedDB, f.databaseName);
        await put(db, "header", { id: "vault", vaultId: "synthetic-corrupt-id", cryptoVersion: 999, wrappedKey: "not-a-key" });
        await put(db, "records", { recordId: "synthetic-orphan", ciphertext: new ArrayBuffer(4) }); await put(db, "nonces", { id: "synthetic-orphan-nonce" });
        const decrypt = vi.spyOn(crypto.subtle, "decrypt"); await reset(s);
        expect(decrypt).not.toHaveBeenCalled(); expect(await counts(db)).toEqual([0, 0, 0]);
        decrypt.mockRestore(); await s.create(secret, secret);
    });
    it.each([undefined, { id: "vault", vaultId: 7 }, { id: "vault", vaultId: "" }])("refuses to wipe orphan data without a safely identified legacy owner: %j", async header => {
        const f = fixture(), s = f.make(), db = await database(f.indexedDB, f.databaseName);
        if (header) await put(db, "header", header);
        await put(db, "records", { recordId: "synthetic-orphan", ciphertext: new ArrayBuffer(4) }); await put(db, "nonces", { id: "synthetic-orphan-nonce" });
        const before = await counts(db), wipe = vi.spyOn(IDBObjectStore.prototype, "clear");
        await expect(reset(s)).rejects.toThrow(/identity|owner/i);
        expect(wipe).not.toHaveBeenCalled(); expect(await counts(db)).toEqual(before); expect(s.state).toBe("locked");
    });
    it("permits explicit reset retry after disposal encounters a failed sensitive-clear boundary", async () => {
        const clearFailure = vi.fn<() => void>(() => { throw new Error("SYNTHETIC_CLEAR_FAILURE"); });
        const f = fixture({ onSensitiveClear: clearFailure }), owner = f.make(); await owner.create(secret, secret);
        const queued = deferred(), resume = deferred(), encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
        vi.spyOn(crypto.subtle, "encrypt").mockImplementation(async (...args) => { const result = await encrypt(...args); queued.resolve(); await resume.promise; return result; });
        const writing = owner.saveProviderKey("synthetic", "SYNTHETIC_PENDING_KEY"), writingRejected = expect(writing).rejects.toThrow(); await queued.promise;
        const resetting = reset(owner), resetRejected = expect(resetting).rejects.toThrow(/boundary/i);
        const disposing = owner.dispose(), disposeRejected = expect(disposing).rejects.toThrow();
        resume.resolve(); await writingRejected; await resetRejected; await disposeRejected;
        clearFailure.mockImplementation(() => {}); await reset(owner);
        expect(owner.state).toBe("locked");
    });
    it("keeps an owned cleanup failure closed even when opening storage would also fail", async () => {
        let failed = true;
        const f = fixture({ onSensitiveClear: () => { if (failed) throw new Error("SYNTHETIC_CLEAR_FAILURE"); } }), s = f.make(); await s.create(secret, secret);
        const opening = vi.spyOn(f.indexedDB, "open").mockImplementation(() => { throw new DOMException("SYNTHETIC_OPEN_FAILURE", "UnknownError"); });
        const failure = await reset(s).then(() => null, error => error);
        expect(s.state).toBe("lock-save-failed"); expect(failure).toBeInstanceOf(Error); expect(failure.message).toMatch(/boundary/i); expect(opening).not.toHaveBeenCalled();
        await expect(s.retryLock()).rejects.toThrow(/reset/i); await expect(s.discardPendingAndLock()).rejects.toThrow(/reset/i);
        opening.mockRestore(); failed = false; await reset(s); expect(s.state).toBe("locked");
    });
    it("treats an observer exception after durable wipe as committed success", async () => {
        let fail = false;
        const f = fixture({ onState: state => { if (fail && state === "locked") throw new Error("SYNTHETIC_OBSERVER_FAILURE"); } }), s = f.make();
        await s.create(secret, secret); fail = true; await reset(s);
        const db = await database(f.indexedDB, f.databaseName); expect(await counts(db)).toEqual([0, 0, 0]); expect(s.state).toBe("locked");
        fail = false;
    });
    it("aborts an atomic wipe after a synchronous later clear error, preserving every store", async () => {
        const f = fixture(), s = f.make(); await s.create(secret, secret); await s.lock("manual");
        const db = await database(f.indexedDB, f.databaseName), before = await counts(db), native = IDBObjectStore.prototype.clear;
        const spy = vi.spyOn(IDBObjectStore.prototype, "clear").mockImplementation(function (this: IDBObjectStore) { if (this.name === "records") throw new DOMException("SYNTHETIC_REQUEST_FAILURE", "UnknownError"); return native.call(this); });
        await expect(reset(s)).rejects.toThrow(/transaction/i); spy.mockRestore();
        expect(await counts(db)).toEqual(before); await s.unlock(secret);
    });
    it("closes an unobserved late database handle after a blocked opening has already failed", async () => {
        const f = fixture(), s = f.make(), db = await database(f.indexedDB, f.databaseName), entered = deferred();
        const request = { result: db, onupgradeneeded: null, onsuccess: null, onblocked: null, onerror: null } as unknown as IDBOpenDBRequest;
        vi.spyOn(f.indexedDB, "open").mockImplementation(() => { entered.resolve(); return request; });
        const resetting = reset(s), rejected = expect(resetting).rejects.toThrow(/storage/i); await entered.promise;
        request.onblocked?.call(request, new Event("blocked") as IDBVersionChangeEvent); await rejected;
        expect(s.state).toBe("locked");
        request.onsuccess?.call(request, new Event("success"));
        expect(() => db.transaction("header")).toThrow();
    });
    it("aborts a late upgrade after blocked-open failure rather than creating a fresh schema", async () => {
        const f = fixture(), s = f.make(), entered = deferred();
        const abort = vi.fn(), createObjectStore = vi.fn();
        const request = { result: { createObjectStore }, transaction: { abort }, onupgradeneeded: null, onsuccess: null, onblocked: null, onerror: null } as unknown as IDBOpenDBRequest;
        vi.spyOn(f.indexedDB, "open").mockImplementation(() => { entered.resolve(); return request; });
        const resetting = reset(s), rejected = expect(resetting).rejects.toThrow(/storage/i); await entered.promise;
        request.onblocked?.call(request, new Event("blocked") as IDBVersionChangeEvent); await rejected;
        request.onupgradeneeded?.call(request, new Event("upgradeneeded") as IDBVersionChangeEvent);
        expect(abort).toHaveBeenCalledOnce(); expect(createObjectStore).not.toHaveBeenCalled();
    });
    it("refuses an incomplete version-one schema without clearing its existing data", async () => {
        const f = fixture(), s = f.make();
        const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = f.indexedDB.open(f.databaseName, 1); request.onupgradeneeded = () => request.result.createObjectStore("records", { keyPath: "recordId" }); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); handles.push(db);
        await put(db, "records", { recordId: "synthetic-incomplete-schema", ciphertext: new ArrayBuffer(4) });
        const clear = vi.spyOn(IDBObjectStore.prototype, "clear");
        await expect(reset(s)).rejects.toThrow(); expect(clear).not.toHaveBeenCalled(); expect(s.state).toBe("locked");
        const remaining = await new Promise<number>(resolve => { const request = db.transaction("records").objectStore("records").count(); request.onsuccess = () => resolve(request.result); }); expect(remaining).toBe(1);
        await expect(s.create(secret, secret)).rejects.toThrow();
    });
    it("shares one pending reset and rejects generation or ordinary lock actions until it settles", async () => {
        const f = fixture(), s = f.make(); await s.create(secret, secret); await s.lock("manual");
        const db = await database(f.indexedDB, f.databaseName), held = holdTransaction(db); await held.entered;
        const first = reset(s); expect(reset(s)).toBe(first);
        await expect(s.unlock(secret)).rejects.toThrow(); await expect(s.create(secret, secret)).rejects.toThrow(); await expect(s.lock("manual")).rejects.toThrow(/reset/i);
        held.release(); await held.completed; await first;
        expect(await counts(db)).toEqual([0, 0, 0]);
    });
    it("discards a previously failed normal-lock snapshot without saving it before reset", async () => {
        const captured = project(), f = fixture({ capturePending: () => [{ project: { ...captured, title: undefined } as unknown as MeetingProject, runId: null, audioRecords: [] }] }), s = f.make();
        await s.create(secret, secret); await expect(s.lock("manual")).rejects.toThrow(); expect(s.state).toBe("lock-save-failed");
        await reset(s); const db = await database(f.indexedDB, f.databaseName); expect(await counts(db)).toEqual([0, 0, 0]);
    });
    it("fails closed without native secure Web Locks support", async () => {
        vi.stubGlobal("isSecureContext", false);
        const f = fixture(), s = createVaultSession({ indexedDB: f.indexedDB, databaseName: f.databaseName }); sessions.push(s);
        try { await expect(reset(s)).rejects.toThrow(/coordination|support|secure/i); expect(s.state).toBe("locked"); }
        finally { vi.unstubAllGlobals(); }
    });
});
