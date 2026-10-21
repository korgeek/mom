import { afterEach, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { cancelJobs, createJobContext } from "../src/react-app/domain/jobs";
import type { MeetingProject } from "../src/react-app/domain/types";
import { createVaultSession, type VaultSession } from "../src/react-app/vault/session";
import { decryptRecord, encryptRecord, unwrapHeader, type RecordEnvelope } from "../src/react-app/vault/crypto";
import { openVaultDatabase, readHeader } from "../src/react-app/vault/store";

const MIB = 1024 * 1024;
const secret = "synthetic range reader phrase 123";
const sessions: VaultSession[] = [];
const heldReleases: (() => void)[] = [];
type SourceManifest = { projectId: string; totalBytes: number; blocks: { id: string; index: number; bytes: number }[] };
type ProjectPayload = { project: MeetingProject; ownedRecords: string[] };

function pattern(offset: number, length: number): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) bytes[i] = ((offset + i) * 17 + Math.floor((offset + i) / 251)) % 256;
    return bytes;
}
// The checkpoint writer receives one real slice at a time. No original-sized
// array/Blob is allocated, even for the >64 MiB persistence/reload case.
class LazySource extends Blob {
    readonly slices: number[] = [];
    constructor(private readonly byteCount: number) { super([], { type: "audio/wav" }); }
    override get size(): number { return this.byteCount; }
    override async arrayBuffer(): Promise<ArrayBuffer> { throw new Error("Whole-original read forbidden"); }
    override slice(start = 0, end = this.size, type = this.type): Blob {
        const length = end - start;
        if (length < 0 || length > MIB) throw new Error("Unbounded source slice");
        this.slices.push(length);
        return new Blob([pattern(start, length)], { type });
    }
}
function project(sourceId: string, bytes: number): MeetingProject {
    return { id: crypto.randomUUID(), title: "Synthetic range fixture", icon: "meeting", color: "cobalt", pinned: false, createdAt: "2026-10-02T00:00:00Z", updatedAt: "2026-10-02T00:00:00Z", sourceAssets: [{ id: sourceId, fileName: "synthetic.wav", bytes, container: "wav", codec: "pcm", durationMs: 1000, channels: 1, sampleRateHz: 16000 }], preparedChunks: [], audioOptions: { chunkMinutes: 10, overlapSeconds: 10, expectedLanguages: ["en"], bitrateKbps: 32, sampleRateHz: 16000 }, rawTranscripts: [], transcriptVersions: [], selectedTranscriptVersionId: null, minutesSettings: { outputLanguage: "en", sections: ["summary"], instructions: "", modelId: "synthetic-model" }, minutesRuns: [], minutesRevisions: [], selectedMinutesRevisionId: null, runs: [] };
}
async function fixture(size = 2 * MIB + 31) {
    const factory = new IDBFactory();
    const name = crypto.randomUUID();
    const s = createVaultSession({ databaseName: name, indexedDB: factory, testOnlyOwnership: { acquire: async () => () => { } } });
    sessions.push(s);
    await s.create(secret, secret);
    const id = crypto.randomUUID();
    const audio = new LazySource(size);
    const p = project(id, size);
    await s.store.checkpoint({ project: p, runId: null, audioRecords: [{ recordId: id, audio }] }, createJobContext());
    return { s, factory, name, id, audio, p };
}
async function get(db: IDBDatabase, id: string): Promise<RecordEnvelope | undefined> {
    return new Promise((resolve, reject) => { const tx = db.transaction("records"); const r = tx.objectStore("records").get(id); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}
async function mutate(db: IDBDatabase, id: string, envelope?: RecordEnvelope): Promise<void> {
    return new Promise((resolve, reject) => { const tx = db.transaction("records", "readwrite"); if (envelope) tx.objectStore("records").put(envelope); else tx.objectStore("records").delete(id); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
}
async function metadata(f: Awaited<ReturnType<typeof fixture>>) {
    const db = await openVaultDatabase(f.factory, f.name);
    const header = (await readHeader(db))!;
    const key = await unwrapHeader(secret, header);
    async function json<T>(id: string): Promise<T> {
        const bytes = await decryptRecord(key, header, id, (await get(db, id))!);
        try { return JSON.parse(new TextDecoder().decode(bytes)) as T; } finally { bytes.fill(0); }
    }
    async function writeJSON(id: string, value: unknown) {
        const bytes = new TextEncoder().encode(JSON.stringify(value));
        try { await mutate(db, id, await encryptRecord(key, header, id, bytes, crypto.getRandomValues(new Uint8Array(12)))); } finally { bytes.fill(0); }
    }
    const pointer = await json<{ manifestId: string }>(f.id);
    const manifest = await json<SourceManifest>(pointer.manifestId);
    return { db, header, key, json, writeJSON, manifestId: pointer.manifestId, manifest };
}
async function holdBlock(id: string) {
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    heldReleases.push(release);
    const native = crypto.subtle.decrypt.bind(crypto.subtle);
    let observed: ArrayBuffer | undefined;
    let held = false;
    vi.spyOn(crypto.subtle, "decrypt").mockImplementation(async (algorithm, key, data) => {
        const output = await native(algorithm, key, data);
        const aad = (algorithm as AesGcmParams).additionalData;
        if (!held && aad && new TextDecoder().decode(aad).includes(id)) {
            held = true;
            observed = output;
            enter();
            await gate;
        }
        return output;
    });
    return { entered, release, bytes: () => new Uint8Array(observed!) };
}
afterEach(async () => {
    for (const release of heldReleases.splice(0)) release();
    vi.restoreAllMocks();
    for (const s of sessions.splice(0)) await s.dispose();
    cancelJobs();
});

describe("bounded authenticated retained source ranges", () => {
    it("reloads a >64 MiB lazy source and reads only intersecting blocks in readonly transactions", async () => {
        const f = await fixture(65 * MIB + 31);
        expect(Math.max(...f.audio.slices)).toBe(MIB);
        expect(f.audio.slices).toHaveLength(66);
        const meta = await metadata(f);
        meta.db.close();
        await f.s.lock("manual");
        await f.s.unlock(secret);
        const reader = await f.s.openRetainedSource(f.id, createJobContext());
        expect(reader.size).toBe(65 * MIB + 31);
        expect(Object.isFrozen(reader)).toBe(true);
        const gets = vi.spyOn(IDBObjectStore.prototype, "get");
        const puts = vi.spyOn(IDBObjectStore.prototype, "put");
        const getAll = vi.spyOn(IDBObjectStore.prototype, "getAll").mockImplementation(() => { throw new Error("Whole record scan forbidden"); });
        for (const [start, end] of [[64 * MIB + 17, 64 * MIB + 1017], [MIB - 7, MIB + 19], [65 * MIB + 7, reader.size], [7 * MIB + 127, 7 * MIB + 4096]]) {
            gets.mockClear();
            expect(new Uint8Array(await reader.read(start, end, createJobContext()))).toEqual(pattern(start, end - start));
            const expected = meta.manifest.blocks.slice(Math.floor(start / MIB), Math.floor((end - 1) / MIB) + 1).map(block => block.id);
            const fetchedBlocks = gets.mock.calls.map(([id]) => id).filter(id => meta.manifest.blocks.some(block => block.id === id));
            expect(fetchedBlocks).toEqual(expected);
        }
        expect(puts).not.toHaveBeenCalled();
        expect(getAll).not.toHaveBeenCalled();
    }, 15000);

    it("returns byte-exact half-open subranges across boundaries and independent output buffers", async () => {
        const f = await fixture();
        const reader = await f.s.openRetainedSource(f.id, createJobContext());
        for (const [start, end] of [[0, 17], [MIB - 1, MIB + 1], [MIB - 7, 2 * MIB - 7], [2 * MIB, reader.size], [reader.size, reader.size], [0, 0]]) {
            const bytes = new Uint8Array(await reader.read(start, end, createJobContext()));
            expect(bytes).toEqual(pattern(start, end - start));
            bytes.fill(0);
            expect(new Uint8Array(await reader.read(start, end, createJobContext()))).toEqual(pattern(start, end - start));
        }
        await expect(f.s.store.readAudio(f.id, createJobContext())).rejects.toThrow(/prepared/i);
        const lengths = [];
        for await (const block of f.s.streamSource(f.id, createJobContext())) lengths.push(block.length);
        expect(lengths).toEqual([MIB, MIB, 31]);
    });

    it("rejects unsafe, reversed, out-of-source and over-admission ranges before fetching data", async () => {
        const f = await fixture();
        const reader = await f.s.openRetainedSource(f.id, createJobContext());
        const gets = vi.spyOn(IDBObjectStore.prototype, "get");
        for (const [start, end] of [[-1, 1], [0, -1], [2, 1], [0.5, 1], [0, 1.5], [NaN, 1], [0, Infinity], [0, Number.MAX_SAFE_INTEGER + 1], [0, reader.size + 1], [0, MIB + 1]]) {
            await expect(reader.read(start, end, createJobContext())).rejects.toThrow();
        }
        expect(gets).not.toHaveBeenCalled();
    });

    it("admits a persisted empty source without inventing a block", async () => {
        const f = await fixture(0);
        const reader = await f.s.openRetainedSource(f.id, createJobContext());
        expect(reader.size).toBe(0);
        expect((await reader.read(0, 0, createJobContext())).byteLength).toBe(0);
        await expect(reader.read(0, 1, createJobContext())).rejects.toThrow();
    });

    it.each(["interior-short", "bad-total", "duplicate", "bad-index", "null-block", "block-unowned", "source-bytes", "source-unowned", "project-unpublished", "prepared-purpose"])("rejects authenticated invalid manifest/source ownership: %s", async kind => {
        const f = await fixture();
        const meta = await metadata(f);
        try {
            const m = meta.manifest;
            const p = await meta.json<ProjectPayload>(f.p.id);
            if (kind === "interior-short") { m.blocks[0].bytes -= 1; m.totalBytes -= 1; p.project = { ...p.project, sourceAssets: p.project.sourceAssets.map(asset => ({ ...asset, bytes: m.totalBytes })) }; }
            if (kind === "bad-total") m.totalBytes += 1;
            if (kind === "duplicate") m.blocks[1].id = m.blocks[0].id;
            if (kind === "bad-index") m.blocks[1].index = 9;
            if (kind === "null-block") m.blocks[0] = null as unknown as SourceManifest["blocks"][number];
            if (kind === "block-unowned") p.ownedRecords = p.ownedRecords.filter(id => id !== m.blocks[0].id);
            if (kind === "source-bytes") p.project = { ...p.project, sourceAssets: p.project.sourceAssets.map(asset => ({ ...asset, bytes: asset.bytes + 1 })) };
            if (kind === "source-unowned") p.project = { ...p.project, sourceAssets: [] };
            if (kind === "project-unpublished") {
                const catalog = await meta.json<{ projectIds: string[] }>(meta.header.vaultId);
                catalog.projectIds = [];
                await meta.writeJSON(meta.header.vaultId, catalog);
            }
            if (kind === "prepared-purpose") Object.assign(m, { purpose: "prepared" });
            await meta.writeJSON(meta.manifestId, m);
            await meta.writeJSON(f.p.id, p);
            await expect(f.s.openRetainedSource(f.id, createJobContext())).rejects.toThrow();
        } finally { meta.db.close(); }
    });

    it.each(["missing", "corrupt", "truncated", "authenticated-short"])("fails instead of returning a partial range for %s data", async kind => {
        const f = await fixture();
        const reader = await f.s.openRetainedSource(f.id, createJobContext());
        const meta = await metadata(f);
        try {
            const id = meta.manifest.blocks[1].id;
            const old = (await get(meta.db, id))!;
            if (kind === "missing") await mutate(meta.db, id);
            if (kind === "corrupt") { const ciphertext = old.ciphertext.slice(0); new Uint8Array(ciphertext)[17] ^= 1; await mutate(meta.db, id, { ...old, ciphertext }); }
            if (kind === "truncated") await mutate(meta.db, id, { ...old, ciphertext: old.ciphertext.slice(0, -1) });
            if (kind === "authenticated-short") await mutate(meta.db, id, await encryptRecord(meta.key, meta.header, id, new Uint8Array(17), crypto.getRandomValues(new Uint8Array(12))));
            await expect(reader.read(MIB - 7, MIB + 19, createJobContext())).rejects.toThrow();
        } finally { meta.db.close(); }
    });

    it("binds a reader to one immutable source generation", async () => {
        const f = await fixture();
        const reader = await f.s.openRetainedSource(f.id, createJobContext());
        await f.s.store.checkpoint({ project: f.p, runId: null, audioRecords: [{ recordId: f.id, audio: new LazySource(f.audio.size) }] }, createJobContext());
        await expect(reader.read(0, 19, createJobContext())).rejects.toThrow();
        const next = await f.s.openRetainedSource(f.id, createJobContext());
        expect(new Uint8Array(await next.read(0, 19, createJobContext()))).toEqual(pattern(0, 19));
    });

    it("fences both opening and individual read jobs", async () => {
        const f = await fixture();
        const staleJob = createJobContext();
        cancelJobs();
        await expect(f.s.openRetainedSource(f.id, staleJob)).rejects.toThrow();
        const reader = await f.s.openRetainedSource(f.id, createJobContext());
        await expect(reader.read(0, 1, staleJob)).rejects.toThrow();
        cancelJobs();
        await expect(reader.read(0, 1, createJobContext())).rejects.toThrow();
    });

    it("allows only one outstanding bounded read across different readers and reopens admission after failure", async () => {
        const f = await fixture();
        const first = await f.s.openRetainedSource(f.id, createJobContext());
        const second = await f.s.openRetainedSource(f.id, createJobContext());
        const meta = await metadata(f);
        meta.db.close();
        const hold = await holdBlock(meta.manifest.blocks[0].id);
        const reading = first.read(0, 19, createJobContext());
        await hold.entered;
        await expect(second.read(MIB, MIB + 19, createJobContext())).rejects.toThrow(/read.*progress|outstanding|busy/i);
        hold.release();
        expect(new Uint8Array(await reading)).toEqual(pattern(0, 19));
        const invalid = (await openVaultDatabase(f.factory, f.name));
        await mutate(invalid, meta.manifest.blocks[0].id);
        invalid.close();
        await expect(first.read(0, 19, createJobContext())).rejects.toThrow();
        expect(new Uint8Array(await second.read(MIB, MIB + 19, createJobContext()))).toEqual(pattern(MIB, 19));
    });

    it.each(["lock", "reset", "dispose"])("tracks a held decrypt through %s and never publishes late plaintext", async boundary => {
        const f = await fixture();
        const reader = await f.s.openRetainedSource(f.id, createJobContext());
        const meta = await metadata(f);
        meta.db.close();
        const hold = await holdBlock(meta.manifest.blocks[1].id);
        const reading = reader.read(MIB - 7, MIB + 19, createJobContext());
        const rejected = expect(reading).rejects.toThrow();
        await hold.entered;
        let finished = false;
        const closing = (boundary === "lock" ? f.s.lock("manual") : boundary === "reset" ? f.s.reset() : f.s.dispose()).then(() => { finished = true; });
        expect(f.s.state).toBe("locking");
        await Promise.resolve();
        expect(finished).toBe(false);
        hold.release();
        await rejected;
        await closing;
        expect(hold.bytes().every(byte => byte === 0)).toBe(true);
        expect(f.s.state).toBe("locked");
        await expect(reader.read(0, 19, createJobContext())).rejects.toThrow();
        if (boundary === "lock") {
            await f.s.unlock(secret);
            await expect(reader.read(0, 19, createJobContext())).rejects.toThrow();
            const fresh = await f.s.openRetainedSource(f.id, createJobContext());
            expect(new Uint8Array(await fresh.read(0, 19, createJobContext()))).toEqual(pattern(0, 19));
        }
        if (boundary === "reset") {
            await f.s.create(secret, secret);
            await expect(reader.read(0, 19, createJobContext())).rejects.toThrow();
            await expect(f.s.openRetainedSource(f.id, createJobContext())).rejects.toThrow();
        }
    });
});
