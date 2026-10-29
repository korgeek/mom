import { afterEach, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { createVaultSession, VaultAttemptError, type VaultSession, type VaultSessionOptions } from "../src/react-app/vault/session";
import { cancelJobs, createJobContext } from "../src/react-app/domain/jobs";
import type { RecordEnvelope } from "../src/react-app/vault/crypto";
import type { MeetingProject } from "../src/react-app/domain/types";
const secret = "keyless lock testing phrase";
const sessions: VaultSession[] = [];
function fixture(): MeetingProject { const id = crypto.randomUUID(); return { id, title: "LOCK_PRIVATE_TITLE", icon: "meeting", color: "blue", pinned: false, createdAt: "2026-09-30T00:00:00Z", updatedAt: "2026-09-30T00:00:00Z", sourceAssets: [], audioOptions: { chunkMinutes: 10, overlapSeconds: 10, expectedLanguages: [], bitrateKbps: 32, sampleRateHz: 16000 }, preparedChunks: [], rawTranscripts: [], transcriptVersions: [], selectedTranscriptVersionId: null, minutesSettings: { outputLanguage: "en", sections: ["summary"], instructions: "", modelId: "test" }, minutesRuns: [], minutesRevisions: [], selectedMinutesRevisionId: null, runs: [] }; }
function owners() { const held = new Set<string>(); return { acquire: async (name: string) => { if (held.has(name))
        return null; held.add(name); return () => { held.delete(name); }; } }; }
function make(options: VaultSessionOptions = {}) { const s = createVaultSession({ indexedDB: new IDBFactory(), databaseName: crypto.randomUUID(), testOnlyOwnership: owners(), ...options }); sessions.push(s); return s; }
afterEach(async () => { vi.restoreAllMocks(); for (const s of sessions.splice(0))
    await s.dispose(); cancelJobs(); });
describe("vault lock boundary", () => {
    it("waits for native ownership to be released before hard-lock or failed-unlock completion", async () => {
        const held = new Set<string>();
        vi.stubGlobal('isSecureContext', true);
        vi.stubGlobal('navigator', { locks: { request(name: string, _options: unknown, callback: (lock: object | null) => Promise<unknown>) {
            if (held.has(name)) return Promise.resolve(callback(null));
            held.add(name);
            return new Promise((resolve, reject) => {
                Promise.resolve(callback({ name })).then(value => {
                    // The browser grants/releases ownership on its own task queue.
                    setTimeout(() => { held.delete(name); resolve(value); }, 0);
                }, reject);
            });
        } } });
        try {
            const s = make({ testOnlyOwnership: undefined });
            await s.create(secret, secret);
            await s.lock('manual');
            await expect(s.unlock('a different synthetic vault phrase')).rejects.toBeInstanceOf(VaultAttemptError);
            await expect(s.unlock(secret)).resolves.toBeUndefined();
            await s.lock('manual');
            await expect(s.unlock(secret)).resolves.toBeUndefined();
            await s.dispose();
        } finally { vi.unstubAllGlobals(); }
    });
    it("revokes public work and sensitive UI synchronously before saving, then clears session keys", async () => {
        const events: string[] = [];
        const s = make({ onState: (v: string) => events.push(v), onSensitiveClear: () => events.push("clear"), teardown: () => events.push("teardown") });
        await s.create(secret, secret);
        await s.saveProviderKey("openai", "SESSION_ONLY_KEYLESS", "session");
        const job = createJobContext();
        const old = s.store;
        const promise = s.lock("manual");
        expect(s.state).toBe("locking");
        expect(events.slice(-3)).toEqual(["locking", "clear", "teardown"]);
        expect(() => job.assertActive()).toThrow();
        expect(() => s.store).toThrow();
        await expect(old.listProjects(createJobContext())).rejects.toThrow();
        await promise;
        expect(s.state).toBe("locked");
        await s.unlock(secret);
        expect(await s.getProviderKey("openai")).toBeNull();
    });
    it("saves the latest captured completed snapshot through a private finalizer", async () => {
        let p = fixture();
        const s = make({ capturePending: () => [{ project: p, runId: null, audioRecords: [] }] });
        await s.create(secret, secret);
        await s.store.checkpoint({ project: p, runId: null, audioRecords: [] }, createJobContext());
        p = { ...p, title: "latest completed edit" };
        await s.lock("manual");
        await s.unlock(secret);
        expect((await s.store.readProject(p.id, createJobContext()))?.title).toBe("latest completed edit");
    });
    it("keeps generic failed state and retries the newest snapshot without granting public access", async () => {
        const p = fixture();
        const s = make({ capturePending: () => [{ project: p, runId: null, audioRecords: [] }] });
        await s.create(secret, secret);
        const original = IDBObjectStore.prototype.put;
        const spy = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, v: unknown, ...args: [key?: IDBValidKey]) { if (this.name === "records") {
            this.transaction.abort();
            throw new DOMException("full", "QuotaExceededError");
        } return original.call(this, v, ...args); });
        await expect(s.lock("manual")).rejects.toThrow();
        expect(s.state).toBe("lock-save-failed");
        expect(() => s.store).toThrow();
        spy.mockRestore();
        await s.retryLock();
        expect(s.state).toBe("locked");
        await s.unlock(secret);
        expect((await s.store.readProject(p.id, createJobContext()))?.title).toBe(p.title);
    });
    it("requires an explicit discard after failed saving and does not report false lock success", async () => {
        const p = fixture();
        const s = make({ capturePending: () => [{ project: p, runId: null, audioRecords: [] }] });
        await s.create(secret, secret);
        const spy = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => { throw new Error("storage unavailable"); });
        await expect(s.lock("manual")).rejects.toThrow();
        expect(s.state).toBe("lock-save-failed");
        spy.mockRestore();
        await s.discardPendingAndLock();
        expect(s.state).toBe("locked");
    });
    it("holds exclusive ownership before key derivation and requires explicit reacquisition", async () => {
        const factory = new IDBFactory();
        const name = crypto.randomUUID();
        const ownership = owners();
        const a = make({ indexedDB: factory, databaseName: name, testOnlyOwnership: ownership });
        const b = make({ indexedDB: factory, databaseName: name, testOnlyOwnership: ownership });
        await a.create(secret, secret);
        await expect(b.unlock(secret)).rejects.toThrow(/owner/i);
        expect(b.state).toBe("locked");
        await a.lock("manual");
        expect(b.state).toBe("locked");
        await b.unlock(secret);
        expect(b.state).toBe("unlocked");
    });
    it("fails closed when Web Locks are unsupported", async () => {
        const s = createVaultSession({ databaseName: crypto.randomUUID(), indexedDB: new IDBFactory() });
        sessions.push(s);
        await expect(s.create(secret, secret)).rejects.toThrow(/coordination|support|secure/i);
        expect(s.state).toBe("locked");
    });
    it("recovers committed unfinished dispatch intents as unknown without automatic work", async () => {
        const p = fixture();
        const run = { id: crypto.randomUUID(), projectId: p.id, state: "requesting" as const, checkpoint: null, intent: { kind: "stt" as const, chunkId: crypto.randomUUID(), requestedModel: "test", expectedLanguages: ["ko"], rateSnapshot: null, requestedEndpoint: "https://provider.invalid" } };
        const s = make();
        await s.create(secret, secret);
        await s.store.checkpoint({ project: { ...p, runs: [run] }, runId: null, audioRecords: [] }, createJobContext());
        await s.lock("hidden");
        await s.unlock(secret);
        expect((await s.store.readProject(p.id, createJobContext()))?.runs[0].state).toBe("outcome-unknown");
    });
    it("rejects stale asynchronous completion and fresh context while locking", async () => {
        const s = make();
        await s.create(secret, secret);
        const job = createJobContext();
        const old = s.store;
        const late = Promise.resolve(fixture());
        const locking = s.lock("idle");
        await expect(late.then(p => old.checkpoint({ project: p, runId: null, audioRecords: [] }, job))).rejects.toThrow();
        await expect(old.listProjects(createJobContext())).rejects.toThrow();
        await locking;
        await s.unlock(secret);
        expect(await s.store.listProjects(createJobContext())).toHaveLength(0);
    });
});
describe("lock completion races", () => {
    it("fences an encrypting public save and preserves the newer captured edit", async () => {
        let p = fixture();
        const s = make({ capturePending: () => [{ project: p, runId: null, audioRecords: [] }] });
        await s.create(secret, secret);
        let release!: () => void;
        let entered!: () => void;
        const ready = new Promise<void>(r => { entered = r; });
        const wait = new Promise<void>(r => { release = r; });
        const original = crypto.subtle.encrypt.bind(crypto.subtle);
        let blocked = false;
        const spy = vi.spyOn(crypto.subtle, "encrypt").mockImplementation(async (...args) => { const result = await original(...args); if (!blocked) {
            blocked = true;
            entered();
            await wait;
        } return result; });
        const old = s.store;
        const publicSave = old.checkpoint({ project: p, runId: null, audioRecords: [] }, createJobContext());
        const outcome = publicSave.catch(error => error);
        await ready;
        p = { ...p, title: "newest edit at cutoff" };
        const locking = s.lock("manual");
        expect(s.state).toBe("locking");
        release();
        expect(await outcome).toBeInstanceOf(Error);
        await locking;
        spy.mockRestore();
        await s.unlock(secret);
        expect((await s.store.readProject(p.id, createJobContext()))?.title).toBe("newest edit at cutoff");
    });
    it("promotes an already completed response in a generic captured saving snapshot", async () => {
        const base = fixture();
        const runId = crypto.randomUUID();
        const p = { ...base, runs: [{ id: runId, projectId: base.id, state: "saving" as const, checkpoint: null }], rawTranscripts: [{ id: crypto.randomUUID(), chunkId: crypto.randomUUID(), runId, response: { text: "completed before cutoff" }, text: "completed before cutoff", segments: [], timing: "chunk" as const, speakerScope: "none" as const, execution: null }] };
        const s = make({ capturePending: () => [{ project: p, runId: null, audioRecords: [] }] });
        await s.create(secret, secret);
        await s.lock("manual");
        await s.unlock(secret);
        const saved = await s.store.readProject(p.id, createJobContext());
        expect(saved?.runs[0].state).toBe("saved");
        expect(saved?.rawTranscripts[0].response).toEqual(p.rawTranscripts[0].response);
    });
    it("snapshots captured edits before teardown releases or mutates UI references", async () => {
        const p = fixture();
        const original = p.title;
        const s = make({ capturePending: () => [{ project: p, runId: null, audioRecords: [] }], teardown: () => { (p as { title: string }).title = "mutated after capture"; } });
        await s.create(secret, secret);
        await s.lock("manual");
        await s.unlock(secret);
        expect((await s.store.readProject(p.id, createJobContext()))?.title).toBe(original);
    });
});
describe("stream teardown", () => {
    it("closes a paused source stream and releases its decrypted block before locked", async () => {
        const id = crypto.randomUUID();
        const p = { ...fixture(), sourceAssets: [{ id, fileName: "test.wav", bytes: 4, container: "wav", codec: "pcm", durationMs: 1000, channels: 1, sampleRateHz: 16000 }] };
        const s = make();
        await s.create(secret, secret);
        await s.store.checkpoint({ project: p, runId: null, audioRecords: [{ recordId: id, audio: new Blob(["test"]) }] }, createJobContext());
        const stream = s.streamSource(id, createJobContext())[Symbol.asyncIterator]();
        const first = await stream.next();
        expect([...first.value!]).toEqual([116, 101, 115, 116]);
        await s.lock("manual");
        expect([...first.value!]).toEqual([0, 0, 0, 0]);
        expect((await stream.next()).done).toBe(true);
    });
});
describe("automatic and failed resource boundaries", () => {
    it("runs the same lock boundary at the configured idle duration", async () => {
        let locked!: () => void;
        const done = new Promise<void>(r => { locked = r; });
        const clear = vi.fn();
        const s = make({ idleMs: 1, onState: (state: string) => { if (state === "locked")
                locked(); }, onSensitiveClear: clear });
        await s.create(secret, secret);
        await done;
        expect(s.state).toBe("locked");
        expect(clear).toHaveBeenCalledTimes(1);
    });
    it("does not claim locked after retry while resource teardown still fails", async () => {
        let fail = true;
        const teardown = vi.fn(() => { if (fail)
            throw new Error("teardown unavailable"); });
        const s = make({ teardown });
        await s.create(secret, secret);
        await expect(s.lock("manual")).rejects.toThrow();
        expect(s.state).toBe("lock-save-failed");
        await expect(s.retryLock()).rejects.toThrow();
        expect(s.state).toBe("lock-save-failed");
        fail = false;
        await s.retryLock();
        expect(s.state).toBe("locked");
        expect(teardown).toHaveBeenCalledTimes(3);
    });
});


describe("safe failure and hidden activation",()=>{
 it("cannot bypass a failed teardown by discarding unsaved work",async()=>{
  let fail=true;const s=make({teardown:()=>{if(fail)throw new Error("teardown failure");}});await s.create(secret,secret);await expect(s.lock("manual")).rejects.toThrow();await expect(s.discardPendingAndLock()).rejects.toThrow();expect(s.state).toBe("lock-save-failed");fail=false;await s.discardPendingAndLock();expect(s.state).toBe("locked");
 });
 it("fails activation closed if the tab becomes hidden during key derivation",async()=>{
  const doc=Object.assign(new EventTarget(),{visibilityState:"visible"});vi.stubGlobal("document",doc);const s=make();
  const original=crypto.subtle.deriveKey.bind(crypto.subtle);const spy=vi.spyOn(crypto.subtle,"deriveKey").mockImplementation(async(...args)=>{const key=await original(...args);doc.visibilityState="hidden";doc.dispatchEvent(new Event("visibilitychange"));return key;});
  try{await expect(s.create(secret,secret)).rejects.toThrow();expect(s.state).toBe("locked");}finally{spy.mockRestore();doc.visibilityState="visible";await s.dispose();vi.unstubAllGlobals();}
 });
});

describe("review regression: authoritative retry capture", () => {
    it("replaces older coordinator pending work with the latest recapture after initial capture failure", async () => {
        const older = { ...fixture(), title: "older coordinator snapshot" };
        const latest = { ...older, title: "latest completed recaptured edit" };
        let failCapture = true;
        const s = make({ capturePending: () => {
            if (failCapture) throw new Error("initial capture failed");
            return [{ project: latest, runId: null, audioRecords: [] }];
        } });
        await s.create(secret, secret);
        const original = IDBObjectStore.prototype.put;
        const spy = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, value: unknown, ...args: [key?: IDBValidKey]) {
            if (this.name === "records" && (value as RecordEnvelope).recordId === older.id) {
                this.transaction.abort();
                throw new DOMException("storage unavailable", "QuotaExceededError");
            }
            return original.call(this, value, ...args);
        });
        await expect(s.store.checkpoint({ project: older, runId: null, audioRecords: [] }, createJobContext())).rejects.toThrow();
        spy.mockRestore();
        await expect(s.lock("manual")).rejects.toThrow();
        expect(s.state).toBe("lock-save-failed");
        failCapture = false;
        await s.retryLock();
        expect(s.state).toBe("locked");
        await s.unlock(secret);
        expect((await s.store.readProject(older.id, createJobContext()))?.title).toBe(latest.title);
    });
});

describe("review regression: preserve successful capture", () => {
    it("preserves the already captured snapshot when teardown mutates UI references and fails", async () => {
        const latest = { ...fixture(), title: "completed edit before teardown" };
        const expectedTitle = latest.title;
        let failTeardown = true;
        const capture = () => [{ project: latest, runId: null, audioRecords: [] }];
        const s = make({ capturePending: capture, teardown: () => {
            latest.title = "mutated UI reference after capture";
            if (failTeardown) throw new Error("resource teardown failed");
        } });
        await s.create(secret, secret);
        await expect(s.lock("manual")).rejects.toThrow();
        expect(s.state).toBe("lock-save-failed");
        failTeardown = false;
        await s.retryLock();
        await s.unlock(secret);
        expect((await s.store.readProject(latest.id, createJobContext()))?.title).toBe(expectedTitle);
    });
});

describe("configured lock preferences", () => {
    it('leaves idle and hidden-page screen locking to an external manager when opted in', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
        vi.stubGlobal('document', doc);
        const s = make({ screenLockManaged: true, idleMs: 1 });
        try {
            await s.create(secret, secret);
            s.configureLock({ idleMinutes: 5, lockOnHide: true });
            doc.visibilityState = 'hidden'; doc.dispatchEvent(new Event('visibilitychange'));
            await vi.advanceTimersByTimeAsync(60 * 60_000);
            expect(s.state).toBe('unlocked');
            s.noteActivity(); await vi.advanceTimersByTimeAsync(60 * 60_000);
            expect(s.state).toBe('unlocked');
        } finally { await s.dispose(); vi.useRealTimers(); vi.unstubAllGlobals(); }
    });
    it('keeps page departure a full lock boundary with an external screen lock manager', async () => {
        const win = new EventTarget(), doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
        vi.stubGlobal('window', win); vi.stubGlobal('document', doc);
        let locked!: () => void;
        const done = new Promise<void>(resolve => { locked = resolve; });
        const s = make({ screenLockManaged: true, onState: state => { if (state === 'locked') locked(); } });
        try {
            await s.create(secret, secret);
            doc.visibilityState = 'hidden'; doc.dispatchEvent(new Event('visibilitychange'));
            expect(s.state).toBe('unlocked');
            win.dispatchEvent(new Event('pagehide')); expect(s.state).toBe('locking');
            await done; expect(s.state).toBe('locked');
        } finally { await s.dispose(); vi.unstubAllGlobals(); }
    });
    it("accepts only the displayed 5/15/30 minute durations and boolean hide choice while unlocked", async () => {
        const s = make();
        expect(() => s.configureLock({ idleMinutes: 15, lockOnHide: true })).toThrow();
        await s.create(secret, secret);
        for (const idleMinutes of [5, 15, 30] as const)
            expect(() => s.configureLock({ idleMinutes, lockOnHide: false })).not.toThrow();
        for (const idleMinutes of [0, 10, 60, NaN])
            expect(() => s.configureLock({ idleMinutes: idleMinutes as 15, lockOnHide: true })).toThrow();
        expect(() => s.configureLock({ idleMinutes: 15, lockOnHide: "false" as unknown as boolean })).toThrow();
        await s.lock("manual");
        expect(() => s.configureLock({ idleMinutes: 5, lockOnHide: false })).toThrow();
    });
    it("restarts the configured idle timer on activity and locks at the updated deadline", async () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        let locked!: () => void;
        const done = new Promise<void>(resolve => { locked = resolve; });
        const s = make({ onState: (state: string) => { if (state === "locked") locked(); } });
        try {
            await s.create(secret, secret);
            s.configureLock({ idleMinutes: 5, lockOnHide: true });
            await vi.advanceTimersByTimeAsync(4 * 60_000);
            expect(s.state).toBe("unlocked");
            s.noteActivity();
            await vi.advanceTimersByTimeAsync(4 * 60_000);
            expect(s.state).toBe("unlocked");
            await vi.advanceTimersByTimeAsync(60_000);
            await done;
            expect(s.state).toBe("locked");
        } finally { await s.dispose(); vi.useRealTimers(); }
    });
    it("honors disabled hide locking and locks when the checkbox is enabled", async () => {
        const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
        vi.stubGlobal("document", doc);
        let locked!: () => void;
        const done = new Promise<void>(resolve => { locked = resolve; });
        const s = make({ onState: (state: string) => { if (state === "locked") locked(); } });
        try {
            await s.create(secret, secret);
            s.configureLock({ idleMinutes: 15, lockOnHide: false });
            doc.visibilityState = "hidden";
            doc.dispatchEvent(new Event("visibilitychange"));
            expect(s.state).toBe("unlocked");
            doc.visibilityState = "visible";
            s.configureLock({ idleMinutes: 15, lockOnHide: true });
            doc.visibilityState = "hidden";
            doc.dispatchEvent(new Event("visibilitychange"));
            expect(s.state).toBe("locking");
            await done;
            expect(s.state).toBe("locked");
        } finally { await s.dispose(); vi.unstubAllGlobals(); }
    });
    it("keeps pagehide locking unconditional even when hide locking is disabled", async () => {
        const win = new EventTarget();
        const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
        vi.stubGlobal("window", win);
        vi.stubGlobal("document", doc);
        let locked!: () => void;
        const done = new Promise<void>(resolve => { locked = resolve; });
        const s = make({ onState: (state: string) => { if (state === "locked") locked(); } });
        try {
            await s.create(secret, secret);
            s.configureLock({ idleMinutes: 30, lockOnHide: false });
            doc.visibilityState = "hidden";
            doc.dispatchEvent(new Event("visibilitychange"));
            expect(s.state).toBe("unlocked");
            win.dispatchEvent(new Event("pagehide"));
            expect(s.state).toBe("locking");
            await done;
            await expect(s.unlock(secret)).rejects.toThrow();
            doc.visibilityState = "visible";
            win.dispatchEvent(new Event("pageshow"));
            await s.unlock(secret);
            expect(s.state).toBe("unlocked");
        } finally { await s.dispose(); vi.unstubAllGlobals(); }
    });
});

describe("default lock preferences", () => {
    it("locks an unconfigured session after the default fifteen minute idle period", async () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        let locked!: () => void;
        const done = new Promise<void>(resolve => { locked = resolve; });
        const s = make({ onState: (state: string) => { if (state === "locked") locked(); } });
        try {
            await s.create(secret, secret);
            await vi.advanceTimersByTimeAsync(14 * 60_000);
            expect(s.state).toBe("unlocked");
            await vi.advanceTimersByTimeAsync(60_000);
            await done;
            expect(s.state).toBe("locked");
        } finally { await s.dispose(); vi.useRealTimers(); }
    });
});
