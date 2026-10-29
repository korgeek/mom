import { aggregateProjectUsage } from "../usage/statement";
import { validateOptions } from "../media/mp3";
import { PreparationResetPlans, type PreparationResetPlan } from "./preparation-reset";
import { normalizeRegistrations, registrationEndpoint, registrationSignature, validateRegistration, validateTestResult, validateApiCredential, withCredentialPolicy, type ApiCredential, type ModelRegistration, type ModelRegistrations, type RegistrationKeyUpdate, type RegistrationTestResult } from '../providers/model-registrations';
import { migrateModelRegistrations, migrateRegistrationCredentials } from './model-registration-migration';
import { normalizeListOverrides, resolveSelectionLists, selectionListOverrides, type SelectionLists, type SelectionListOverrides } from '../settings/lists';
import { snapshotProject, transitionRunState } from "../domain/jobs";
import type { Checkpoint, CheckpointResult, CheckpointWrite, AudioOptions, DeletionConfirmation, DeletionPlan, JobContext, MeetingProject, ModelRegistry, RetainedAudio, SourceAsset, SourceDraft, SourceWriter, StorageInventory, StorageProjectInventory, VaultStore, WavCaptureConfig } from "../domain/types";
import { audioAvailability, DeletionPlans } from "./storage-management";
import { MAX_SOURCE_READ_BYTES, type SourceReader } from "../media/source";
import { normalizeModelRegistry } from "../providers/model-registry";
import { base64, decryptRecord, encryptRecord, OPERATION_LIMIT, randomBytes, randomId, rewrapHeader, verifyHeaderPassphrase, type RecordEnvelope, type VaultHeader } from "./crypto";
import { createWavHeader, MAX_WAV_BODY_BYTES, validateWavCapture } from "../media/wav-header";
import { createBoundSourceWriter } from "./source-writer";
import { validateScreenState, withoutDeletedProjectScreenState, type ScreenState } from './screen-state';
const BLOCK_BYTES = 1024 * 1024;
const FULL_READ_LIMIT = 25000000;
type Guard = () => void;
class DeletedAudioWriteError extends Error {
    constructor() { super("Deleted audio cannot be restored under its previous identity"); }
}
type ProjectPayload = {
    kind: "project";
    project: MeetingProject;
    ownedRecords: string[];
    sourceDraftIds?: string[];
};
type AudioPointer = {
    kind: "audio-pointer";
    projectId: string;
    manifestId: string;
};
type Manifest = {
    kind: "audio-manifest";
    projectId: string;
    recordId: string;
    generation: string;
    purpose: "source" | "prepared";
    mimeType: string;
    totalBytes: number;
    writerLayout?: { kind: "pcm16-wav-v1"; config: WavCaptureConfig };
    blocks: {
        id: string;
        index: number;
        bytes: number;
    }[];
};
type Catalog = {
    kind: "catalog";
    projectIds: string[];
    modelRegistry?: ModelRegistry;
    modelRegistrations?: ModelRegistrations;
    selectionLists?: SelectionListOverrides;
    screenState?: ScreenState;
    // Vault-wide authenticated admission survives descriptor/project changes.
    deletedRecordIds?: string[];
};
type SourceDraftPayload = {
    kind: 'source-draft'; projectId: string; sourceId: string; generation: string;
    config: WavCaptureConfig; bodyBytes: number; blocks: Manifest['blocks'];
};
type StorageProject = { payload: ProjectPayload; availability: RetainedAudio; sourceRecords: Set<string>; chunkRecords: Set<string>; draftRecords: Set<string>; rows: { id: string; iv: string; bytes: number }[]; inventory: StorageProjectInventory };
type SecretPayload = {
    kind: "secrets";
    values: Record<string, string>;
};
export function openVaultDatabase(factory: IDBFactory, name: string): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        let settled = false;
        const request = factory.open(name, 1);
        const fail = (message: string) => { settled = true; reject(new Error(message)); };
        request.onupgradeneeded = () => { if (settled) { request.transaction?.abort(); return; } const db = request.result; db.createObjectStore("header", { keyPath: "id" }); db.createObjectStore("records", { keyPath: "recordId" }); db.createObjectStore("nonces", { keyPath: "id" }); };
        request.onsuccess = () => { const db = request.result; if (settled) { db.close(); return; } settled = true; db.onversionchange = () => db.close(); resolve(db); };
        request.onerror = () => fail("Unable to open encrypted storage");
        request.onblocked = () => fail("Encrypted storage is unavailable");
    });
}
function transaction<T>(db: IDBDatabase, names: string[], mode: IDBTransactionMode, guard: Guard, body: (tx: IDBTransaction, result: (value: T) => void) => void, active?: Set<IDBTransaction>): Promise<T> {
    return new Promise((resolve, reject) => {
        let tx: IDBTransaction;
        let result: T;
        try {
            guard();
            tx = db.transaction(names, mode);
        }
        catch (error) {
            reject(error);
            return;
        }
        active?.add(tx);
        tx.oncomplete = () => { active?.delete(tx); resolve(result); };
        tx.onabort = () => { active?.delete(tx); reject(new Error("Encrypted storage transaction failed")); };
        tx.onerror = () => { }; // Abort is the definitive transaction outcome.
        try {
            body(tx, value => { result = value; });
        }
        catch (error) {
            try {
                tx.abort();
            }
            catch { /* Already settled. */ }
            active?.delete(tx);
            reject(error);
        }
    });
}
export function readHeader(db: IDBDatabase, guard: Guard = () => { }): Promise<VaultHeader | null> {
    return transaction(db, ["header"], "readonly", guard, (tx, result) => { const request = tx.objectStore("header").get("vault"); request.onsuccess = () => result(request.result ?? null); });
}
export type VaultAuthPolicy = Readonly<{ id: 'auth-policy'; vaultId: string; failures: number; pendingDeletion: boolean }>;
export function readVaultAuthPolicy(db: IDBDatabase, vaultId: string): Promise<VaultAuthPolicy> {
    return transaction(db, ['header'], 'readonly', () => {}, (tx, result) => {
        const request = tx.objectStore('header').get('auth-policy');
        request.onsuccess = () => {
            const policy = request.result as VaultAuthPolicy | undefined;
            if (policy && (policy.vaultId !== vaultId || !Number.isInteger(policy.failures) || policy.failures < 0 || policy.failures > 5 || typeof policy.pendingDeletion !== 'boolean' || policy.pendingDeletion !== (policy.failures === 5))) { tx.abort(); return; }
            result(policy ?? { id: 'auth-policy', vaultId, failures: 0, pendingDeletion: false });
        };
    });
}
export function updateVaultAuthPolicy(db: IDBDatabase, vaultId: string, outcome: 'read' | 'failure' | 'success', guard: Guard, signal?: AbortSignal): Promise<VaultAuthPolicy> {
    return transaction(db, ['header'], 'readwrite', guard, (tx, result) => {
        const abort = () => { try { tx.abort(); } catch { /* Already committed. */ } };
        signal?.addEventListener('abort', abort, { once: true });
        const detach = () => signal?.removeEventListener('abort', abort);
        tx.addEventListener('complete', detach, { once: true }); tx.addEventListener('abort', detach, { once: true });
        if (signal?.aborted) { abort(); return; }
        const store = tx.objectStore('header'), request = store.get('auth-policy');
        request.onsuccess = () => {
            try { guard(); } catch { tx.abort(); return; }
            const prior = request.result as VaultAuthPolicy | undefined;
            if (prior && (prior.vaultId !== vaultId || !Number.isInteger(prior.failures) || prior.failures < 0 || prior.failures > 5 || typeof prior.pendingDeletion !== 'boolean' || prior.pendingDeletion !== (prior.failures === 5))) { tx.abort(); return; }
            const old = prior ?? { id: 'auth-policy' as const, vaultId, failures: 0, pendingDeletion: false };
            const failures = old.pendingDeletion ? 5 : outcome === 'failure' ? Math.min(5, old.failures + 1) : outcome === 'success' ? 0 : old.failures;
            const next: VaultAuthPolicy = { id: 'auth-policy', vaultId, failures, pendingDeletion: failures === 5 };
            if (outcome === 'failure' || outcome === 'success' && prior) store.put(next);
            result(next);
        };
    });
}
export async function readResetOwnerId(db: IDBDatabase, guard: Guard): Promise<string | null> {
    // A corrupt cryptographic header needs no decryption to reset, but its exact
    // ownership identity must still be known to exclude older active sessions.
    // An absent header proves absence only when all three vault stores are empty.
    const snapshot = await transaction<{ header: unknown; counts: number[] }>(db, ["header", "records", "nonces"], "readonly", guard, (tx, result) => {
        const snapshot = { header: null as unknown, counts: [] as number[] };
        const request = tx.objectStore("header").get("vault");
        request.onsuccess = () => { snapshot.header = request.result ?? null; };
        for (const name of ["header", "records", "nonces"]) {
            const count = tx.objectStore(name).count();
            count.onsuccess = () => { snapshot.counts.push(count.result); };
        }
        result(snapshot);
    });
    guard();
    if (snapshot.header && typeof snapshot.header === "object" && "vaultId" in snapshot.header && typeof snapshot.header.vaultId === "string" && snapshot.header.vaultId)
        return snapshot.header.vaultId;
    if (snapshot.header === null && snapshot.counts.length === 3 && snapshot.counts.every(count => count === 0))
        return null;
    throw new Error("Unable to establish existing vault owner identity; reset is unavailable");
}
export function clearVaultDatabase(db: IDBDatabase, guard: Guard, expectedDeletionVaultId?: string): Promise<void> {
    // An abortable, atomic clear keeps the version-1 schema for fresh creation.
    // Unlike deleteDatabase(), no nonabortable deletion can finish after failure.
    // Settle only on the transaction's definitive complete/abort event, including
    // a synchronous request failure after an earlier clear has been queued.
    return new Promise((resolve, reject) => {
        let tx: IDBTransaction;
        try { guard(); tx = db.transaction(["header", "records", "nonces"], "readwrite"); }
        catch { reject(new Error("Unable to reset encrypted storage")); return; }
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(new Error("Encrypted storage reset transaction failed"));
        tx.onerror = () => { }; // An error alone is not the durable outcome.
        try {
            const clear = () => { for (const name of ["header", "records", "nonces"]) tx.objectStore(name).clear(); };
            if (!expectedDeletionVaultId) clear();
            else {
                const headers = tx.objectStore('header'), header = headers.get('vault'), policy = headers.get('auth-policy');
                policy.onsuccess = () => {
                    try {
                        guard(); const h = header.result as VaultHeader | undefined, p = policy.result as VaultAuthPolicy | undefined;
                        if (!h || h.vaultId !== expectedDeletionVaultId || !p || p.vaultId !== expectedDeletionVaultId || p.failures !== 5 || p.pendingDeletion !== true) { tx.abort(); return; }
                        clear();
                    } catch { tx.abort(); }
                };
            }
        }
        catch {
            try { tx.abort(); } catch { /* Complete/abort remains authoritative. */ }
        }
    });
}
export async function writeInitialHeader(db: IDBDatabase, header: VaultHeader, key: CryptoKey, guard: Guard): Promise<VaultHeader> {
    // A brand-new random key is discarded if this birth transaction fails. Its
    // first operation, nonce and authenticated directory become durable together.
    const iv = randomBytes(12);
    const bytes = new TextEncoder().encode(JSON.stringify({ kind: "catalog", projectIds: [] }));
    let envelope: RecordEnvelope;
    try {
        envelope = await encryptRecord(key, header, header.vaultId, bytes, iv);
    }
    finally {
        bytes.fill(0);
    }
    guard();
    const initial = { ...header, operations: 1 };
    await transaction<void>(db, ["header", "records", "nonces"], "readwrite", guard, tx => {
        tx.objectStore("header").add(initial);
        tx.objectStore("records").add(envelope);
        tx.objectStore("nonces").add({ id: `${header.keyId}.${base64(iv)}` });
    });
    guard();
    return initial;
}
function assertJSON(value: unknown, ancestors = new Set<object>()): void {
    if (value === null || typeof value === "string" || typeof value === "boolean")
        return;
    if (typeof value === "number" && Number.isFinite(value))
        return;
    if (typeof value !== "object" || value === undefined || ancestors.has(value))
        throw new Error("Only finite JSON project data can be saved");
    const prototype = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null)
        throw new Error("Unsupported project data");
    if (Object.getOwnPropertySymbols(value).length)
        throw new Error("Unsupported project data");
    ancestors.add(value);
    if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
            if (!(i in value))
                throw new Error("Unsupported project data");
            assertJSON(value[i], ancestors);
        }
    }
    else
        for (const item of Object.values(value))
            assertJSON(item, ancestors);
    ancestors.delete(value);
}
function validId(id: string): void { if (typeof id !== "string" || !id.length || id.length > 256)
    throw new Error("Invalid opaque identifier"); }
function recovering(project: MeetingProject): MeetingProject {
    return snapshotProject({ ...project, runs: project.runs.map(run => run.intent && (run.state === "requesting" || run.state === "response-received" || run.state === "saving") ? { ...run, state: "outcome-unknown", checkpoint: null } : run) });
}
// This object is private to the session. Only `publicStore` has the frozen shared API.
export class VaultCoordinator {
    private key: CryptoKey | null;
    private header: VaultHeader;
    private tail: Promise<unknown> = Promise.resolve();
    private readonly active = new Set<IDBTransaction>();
    private readonly reads = new Set<Promise<unknown>>();
    private sourceReadActive = false;
    private sourceWriter: SourceWriter | null = null;
    private readonly undeliveredSources = new Map<string, SourceAsset>();
    private readonly streams = new Set<AsyncGenerator<Uint8Array<ArrayBuffer>>>();
    private readonly pending = new Map<string, CheckpointWrite>();
    private readonly pendingRegistrationTests = new Map<string, RegistrationTestResult>();
    private pendingMigrationTransfers: {sourceNamespace:string;targetNamespace:string}[] = [];
    private pendingSelectionLists: SelectionListOverrides | null = null;
    private pendingScreenState: ScreenState | null = null;
    private readonly deletionPlans = new DeletionPlans();
    private readonly preparationResetPlans = new PreparationResetPlans();
    private deletedRecordIds = new Set<string>();
    readonly publicStore: VaultStore;
    constructor(private readonly db: IDBDatabase, header: VaultHeader, key: CryptoKey, private readonly publicGuard: Guard, private readonly privateGuard: Guard) {
        this.key = key;
        this.header = header;
        this.publicStore = Object.freeze({
            listProjects: (job: JobContext) => this.trackRead(() => this.listProjects(job)), readProject: (id: string, job: JobContext) => this.trackRead(() => this.readProject(id, job)),
            readAudio: (id: string, job: JobContext) => this.trackRead(() => this.readAudio(id, job)), checkpoint: (write: CheckpointWrite, job: JobContext) => this.checkpoint(write, job), deleteProject: (id: string, job: JobContext) => this.deleteProject(id, job),
        });
    }
    private trackRead<T>(action: () => Promise<T>): Promise<T> {
        const tracked: Promise<T> = action().finally(() => this.reads.delete(tracked));
        this.reads.add(tracked);
        return tracked;
    }
    private guard(job: JobContext): Guard { return () => { this.publicGuard(); if (!this.key)
        throw new Error("Vault is locked"); job.assertActive(); }; }
    private serialize<T>(action: () => Promise<T>): Promise<T> { const next = this.tail.then(action, action); this.tail = next.then(() => {}, () => {}); return next; }
    private async getEnvelope(id: string, guard: Guard): Promise<RecordEnvelope | null> {
        validId(id);
        const result = await transaction<RecordEnvelope | null>(this.db, ["records"], "readonly", guard, (tx, done) => { const r = tx.objectStore("records").get(id); r.onsuccess = () => done(r.result ?? null); });
        guard();
        return result;
    }
    private async loadJSON<T>(id: string, guard: Guard): Promise<T | null> {
        const envelope = await this.getEnvelope(id, guard);
        if (!envelope)
            return null;
        guard();
        const plaintext = await decryptRecord(this.requireKey(), this.header, id, envelope);
        try {
            guard();
            return JSON.parse(new TextDecoder().decode(plaintext)) as T;
        }
        catch {
            throw new Error("Unable to read encrypted record");
        }
        finally {
            plaintext.fill(0);
        }
    }
    private requireKey(): CryptoKey { if (!this.key)
        throw new Error("Vault is locked"); return this.key; }
    private async reserve(guard: Guard): Promise<Uint8Array<ArrayBuffer>> {
        // Reservations survive failed encryptions, aborted promotions and reloads.
        for (let attempt = 0; attempt < 8; attempt++) {
            guard();
            const iv = randomBytes(12);
            let collision = false;
            const header = await transaction<VaultHeader>(this.db, ["header", "nonces"], "readwrite", guard, (tx, done) => {
                const headers = tx.objectStore("header");
                const nonces = tx.objectStore("nonces");
                const r = headers.get("vault");
                r.onsuccess = () => {
                    const h = r.result as VaultHeader;
                    if (!h || h.keyId !== this.header.keyId || h.vaultId !== this.header.vaultId) {
                        tx.abort();
                        return;
                    }
                    if (h.operations >= OPERATION_LIMIT) {
                        tx.abort();
                        return;
                    }
                    const id = `${h.keyId}.${base64(iv)}`;
                    const existing = nonces.get(id);
                    existing.onsuccess = () => { if (existing.result) {
                        collision = true;
                        done(h);
                        return;
                    } const next = { ...h, operations: h.operations + 1 }; nonces.add({ id }); headers.put(next); done(next); };
                };
            }, this.active).catch(async (error) => { const h = await readHeader(this.db, guard); guard(); if (h && h.operations >= OPERATION_LIMIT)
                throw new Error("Vault encryption operation limit reached"); throw error; });
            this.header = header;
            guard();
            if (!collision)
                return iv;
        }
        throw new Error("Unable to allocate a fresh encryption nonce");
    }
    private async encrypted(id: string, plaintext: Uint8Array<ArrayBuffer>, guard: Guard): Promise<RecordEnvelope> {
        guard();
        if (this.deletedRecordIds.has(id)) throw new DeletedAudioWriteError();
        const iv = await this.reserve(guard);
        guard();
        const e = await encryptRecord(this.requireKey(), this.header, id, plaintext, iv);
        guard();
        return e;
    }
    private async encryptedJSON(id: string, value: unknown, guard: Guard): Promise<RecordEnvelope> {
        assertJSON(value);
        const plaintext = new TextEncoder().encode(JSON.stringify(value));
        try {
            return await this.encrypted(id, plaintext, guard);
        }
        finally {
            plaintext.fill(0);
        }
    }
    private async readProjectPayload(id: string, guard: Guard): Promise<ProjectPayload | null> {
        const p = await this.loadJSON<ProjectPayload>(id, guard);
        if (p && (p.kind !== "project" || p.project.id !== id || !Array.isArray(p.ownedRecords)))
            throw new Error("Invalid project ownership");
        return p;
    }
    private async catalog(guard: Guard): Promise<Catalog> {
        const catalog = await this.loadJSON<Catalog>(this.header.vaultId, guard);
        if (!catalog || catalog.kind !== "catalog" || !Array.isArray(catalog.projectIds) || new Set(catalog.projectIds).size !== catalog.projectIds.length)
            throw new Error("Missing authenticated vault directory");
        for (const id of catalog.projectIds) {
            validId(id);
            if (id === this.header.vaultId || id === this.header.secretRecordId)
                throw new Error("Invalid directory ownership");
        }
        const deleted = Object.prototype.hasOwnProperty.call(catalog, "deletedRecordIds") ? catalog.deletedRecordIds : [];
        if (!Array.isArray(deleted) || new Set(deleted).size !== deleted.length) throw new Error("Invalid deleted record directory");
        for (const id of deleted) {
            validId(id);
            if (id === this.header.vaultId || id === this.header.secretRecordId || catalog.projectIds.includes(id)) throw new Error("Invalid deleted record identity");
        }
        this.deletedRecordIds = new Set(deleted);
        // Legacy catalogs omit preferences. A present malformed value must not
        // silently become absence or be propagated by a project checkpoint.
        if (Object.prototype.hasOwnProperty.call(catalog, "modelRegistry"))
            catalog.modelRegistry = normalizeModelRegistry(catalog.modelRegistry!);
        if (Object.prototype.hasOwnProperty.call(catalog, "modelRegistrations")) {
            const version = catalog.modelRegistrations!.version;
            const raw = catalog.modelRegistrations!, normalized = normalizeRegistrations(raw);
            catalog.modelRegistrations = raw.credentials === undefined ? {version,entries:normalized.entries,defaults:normalized.defaults,legacyRouteIds:normalized.legacyRouteIds} : {...normalized,version};
        }
        if (Object.prototype.hasOwnProperty.call(catalog, 'selectionLists')) catalog.selectionLists = normalizeListOverrides(catalog.selectionLists);
        if (Object.prototype.hasOwnProperty.call(catalog, 'screenState')) catalog.screenState = validateScreenState(catalog.screenState);
        return catalog;
    }
    loadScreenState(job: JobContext): Promise<ScreenState | null> {
        return this.trackRead(async () => { const guard = this.guard(job); guard(); const catalog = await this.catalog(guard); guard(); return catalog.screenState ?? null; });
    }
    async saveScreenState(value: ScreenState, job: JobContext): Promise<void> {
        const guard = this.guard(job); guard(); const snapshot = validateScreenState(value);
        this.pendingScreenState = snapshot;
        await this.serialize(() => this.persistScreenState(snapshot, guard));
    }
    private async persistScreenState(snapshot: ScreenState, guard: Guard): Promise<void> {
        const catalog = await this.catalog(guard);
        const screenState = withoutDeletedProjectScreenState(snapshot, this.deletedRecordIds);
        const envelope = await this.encryptedJSON(this.header.vaultId, { ...catalog, screenState }, guard);
        await transaction<void>(this.db, ['records', 'header'], 'readwrite', guard, tx => {
            const request = tx.objectStore('header').get('vault');
            request.onsuccess = () => { try { guard(); const header = request.result as VaultHeader;
                if (!header || header.keyId !== this.header.keyId || header.vaultId !== this.header.vaultId) throw new Error('Vault ownership changed');
                tx.objectStore('records').put(envelope);
            } catch { tx.abort(); } };
        }, this.active);
        guard();
        if (this.pendingScreenState === snapshot) this.pendingScreenState = null;
    }
    async verifyPassphrase(secret: string, job: JobContext): Promise<void> {
        const guard = this.guard(job); guard();
        const header = await readHeader(this.db, guard); guard();
        if (!header || header.vaultId !== this.header.vaultId || header.keyId !== this.header.keyId) throw new Error('Vault ownership changed');
        await verifyHeaderPassphrase(secret, header);
        guard();
    }
    authPolicy(outcome: 'read' | 'failure' | 'success', guard: Guard, signal?: AbortSignal): Promise<VaultAuthPolicy> { return updateVaultAuthPolicy(this.db, this.header.vaultId, outcome, guard, signal); }
    loadSelectionLists(job: JobContext): Promise<SelectionLists> {
        return this.trackRead(async () => { const guard = this.guard(job); guard(); const catalog = await this.catalog(guard); guard(); return resolveSelectionLists(catalog.selectionLists); });
    }
    async saveSelectionLists(value: SelectionLists, job: JobContext): Promise<void> {
        const guard = this.guard(job); guard(); const snapshot = selectionListOverrides(value);
        // Admit completed edits before awaiting: lock retries can preserve them privately.
        this.pendingSelectionLists = snapshot;
        await this.serialize(() => this.persistSelectionLists(snapshot, guard));
    }
    private async persistSelectionLists(snapshot: SelectionListOverrides, guard: Guard): Promise<void> {
        const catalog = await this.catalog(guard);
        const envelope = await this.encryptedJSON(this.header.vaultId, { ...catalog, selectionLists: snapshot }, guard);
        await transaction<void>(this.db, ['records', 'header'], 'readwrite', guard, tx => {
            const request = tx.objectStore('header').get('vault');
            request.onsuccess = () => { try { guard(); const header = request.result as VaultHeader;
                if (!header || header.keyId !== this.header.keyId || header.vaultId !== this.header.vaultId) throw new Error('Vault ownership changed');
                tx.objectStore('records').put(envelope);
            } catch { tx.abort(); } };
        }, this.active);
        guard();
        if (this.pendingSelectionLists === snapshot) this.pendingSelectionLists = null;
    }
    loadModelRegistry(job: JobContext): Promise<ModelRegistry | null> {
        return this.trackRead(async () => {
            const guard = this.guard(job);
            guard();
            const catalog = await this.catalog(guard);
            guard();
            return catalog.modelRegistry ?? null;
        });
    }
    async saveModelRegistry(registry: ModelRegistry, job: JobContext): Promise<void> {
        const guard = this.guard(job);
        guard();
        // Detach before queuing: later caller edits cannot alter this decision.
        const snapshot = normalizeModelRegistry(registry);
        await this.serialize(async () => {
            guard();
            const catalog = await this.catalog(guard);
            const envelope = await this.encryptedJSON(this.header.vaultId, { ...catalog, modelRegistry: snapshot }, guard);
            await transaction<void>(this.db, ["records", "header"], "readwrite", guard, tx => {
                const request = tx.objectStore("header").get("vault");
                request.onsuccess = () => {
                    try {
                        guard();
                        const header = request.result as VaultHeader;
                        if (!header || header.keyId !== this.header.keyId || header.vaultId !== this.header.vaultId)
                            throw new Error("Vault ownership changed");
                        tx.objectStore("records").put(envelope);
                    }
                    catch { tx.abort(); }
                };
            }, this.active);
            // A committed receipt can still be fenced by lock. Private project
            // finalization reads the committed catalog and preserves preferences.
            guard();
        });
    }
    loadModelRegistrations(job: JobContext): Promise<ModelRegistrations> {
        return this.loadModelRegistrationState(job).then(value => value.registrations);
    }
    loadModelRegistrationState(job: JobContext, sessionNamespaces: ReadonlySet<string> = new Set()): Promise<{registrations: ModelRegistrations; sessionTransfers: {sourceNamespace:string;targetNamespace:string}[]}> {
        return this.trackRead(() => this.serialize(async () => {
            const guard = this.guard(job); guard(); const catalog = await this.catalog(guard);
            if (catalog.modelRegistrations?.version === 2 && catalog.modelRegistrations.credentials !== undefined) return { registrations: normalizeRegistrations(catalog.modelRegistrations), sessionTransfers: this.pendingMigrationTransfers };
            const secret = await this.loadJSON<SecretPayload>(this.header.secretRecordId, guard);
            if (secret && secret.kind !== 'secrets') throw new Error('Invalid secret namespace');
            const migration = migrateModelRegistrations(catalog.modelRegistrations, catalog.modelRegistry, secret?.values ?? {}, sessionNamespaces);
            const upgraded = migrateRegistrationCredentials(migration.registrations,migration.values,sessionNamespaces,migration.sessionTransfers);
            this.pendingMigrationTransfers = [...upgraded.credentialTransfers];
            await this.writeRegistrationCatalog(catalog, upgraded.registrations, guard, {kind:'secrets',values:upgraded.values});
            return {registrations:upgraded.registrations,sessionTransfers:this.pendingMigrationTransfers};
        }));
    }
    acknowledgeModelRegistrationTransfers(): void { this.pendingMigrationTransfers = []; }
    private async writeRegistrationCatalog(catalog: Catalog, registrations: ModelRegistrations, guard: Guard, secret?: SecretPayload): Promise<void> {
        const envelope = await this.encryptedJSON(this.header.vaultId, {...catalog, modelRegistrations: registrations}, guard);
        const keyEnvelope = secret ? await this.encryptedJSON(this.header.secretRecordId, secret, guard) : null;
        await transaction<void>(this.db, ['records','header'], 'readwrite', guard, tx => {
            const request = tx.objectStore('header').get('vault');
            request.onsuccess = () => { try { guard(); const header = request.result as VaultHeader;
                if (!header || header.keyId !== this.header.keyId || header.vaultId !== this.header.vaultId) throw new Error('Vault ownership changed');
                tx.objectStore('records').put(envelope); if (keyEnvelope) tx.objectStore('records').put(keyEnvelope);
            } catch { tx.abort(); } };
        }, this.active);
        guard();
    }
    private registrationSettings(entry: ModelRegistration): string {
        return JSON.stringify(Object.fromEntries(Object.entries(validateRegistration(entry)).filter(([key]) => !['name','lastTest','revision','credentialOrigin','credentialVersion'].includes(key))));
    }
    private prepareRegistration(entry: ModelRegistration, old: ModelRegistration | undefined, credential: ApiCredential | undefined): ModelRegistration {
        if (old && old.stage !== entry.stage) throw new Error('Saved model stage cannot change');
        const settings = Object.fromEntries(Object.entries(withCredentialPolicy(entry,credential)).filter(([key]) => !['lastTest','credentialId'].includes(key))) as ModelRegistration;
        const next:ModelRegistration = {...settings,...(credential ? {credentialId:credential.id,keyStorage:credential.keyStorage} : {}),
            credentialOrigin:credential?.origin ?? null,credentialVersion:credential?.version ?? (old?.credentialVersion ?? 0)+(old?.credentialId ? 1 : 0)};
        const changed = !!old && (this.registrationSettings(next)!==this.registrationSettings(old)||next.credentialVersion!==old.credentialVersion||next.credentialOrigin!==old.credentialOrigin);
        const revised={...next,revision:old ? (old.revision??0)+(changed?1:0) : 0};
        return {...revised,...(old?.lastTest&&old.lastTest.signature===registrationSignature(revised)?{lastTest:old.lastTest}:{})};
    }
    async saveModelRegistrations(value: ModelRegistrations, job: JobContext): Promise<void> {
        const guard=this.guard(job);guard();const input=structuredClone(value);
        await this.serialize(async()=>{
            const catalog=await this.catalog(guard),current=normalizeRegistrations(catalog.modelRegistrations);
            const entries=input.entries.map(validateRegistration).map(entry=>{
                const old=current.entries.find(item=>item.id===entry.id);
                if(old&&old.keyStorage!==entry.keyStorage)throw Error('Use credential save to change key storage');
                if(old?.credentialId&&entry.credentialId===old.credentialId&&(entry.auth!==old.auth||new URL(registrationEndpoint(entry)).origin!==new URL(registrationEndpoint(old)).origin)){
                    return Object.fromEntries(Object.entries(entry).filter(([key])=>key!=='credentialId')) as ModelRegistration;
                }
                return entry;
            });
            const snapshot=normalizeRegistrations({...input,entries,credentials:current.credentials});
            const prepared=snapshot.entries.map(entry=>this.prepareRegistration(entry,current.entries.find(old=>old.id===entry.id),current.credentials.find(c=>c.id===entry.credentialId)));
            const ids=new Set(prepared.map(entry=>entry.id));
            const defaults=input.defaults!==undefined?snapshot.defaults:{stt:ids.has(current.defaults.stt??'')?current.defaults.stt:null,llm:ids.has(current.defaults.llm??'')?current.defaults.llm:null};
            const legacyRouteIds=input.legacyRouteIds!==undefined?snapshot.legacyRouteIds:Object.fromEntries(Object.entries(current.legacyRouteIds).filter(([,id])=>ids.has(id)));
            const registrations=normalizeRegistrations({...current,...snapshot,entries:prepared,defaults,legacyRouteIds});
            await this.writeRegistrationCatalog(catalog,registrations,guard);this.discardStaleRegistrationTests(registrations);
        });
    }
    private discardStaleRegistrationTests(registrations: ModelRegistrations): void {
        for(const [id,result] of this.pendingRegistrationTests)if(!registrations.entries.some(entry=>entry.id===id&&registrationSignature(entry)===result.signature))this.pendingRegistrationTests.delete(id);
    }
    private keyCommand(update: RegistrationKeyUpdate): {action:'keep'|'replace'|'clear';value:string|null} {
        if(!update||!['keep','replace','clear'].includes(update.action))throw Error('Invalid key update');
        const action=update.action==='replace'&&update.value===''?'keep':update.action;
        const value=update.action==='replace'&&action==='replace'?update.value.trim():null;
        if(action==='replace'&&(!value||update.action!=='replace'||update.value.length>8192||/[\r\n]/u.test(update.value)))throw Error('Invalid credential key');
        return {action,value};
    }
    private changeCredential(current: ReturnType<typeof normalizeRegistrations>, input: ApiCredential, update: RegistrationKeyUpdate, values: Record<string,string>, sessionKeys:ReadonlyMap<string,string>) {
        const supplied=validateApiCredential(input),old=current.credentials.find(c=>c.id===supplied.id),command=this.keyCommand(update);
        if(old&&old.origin!==supplied.origin)throw Error('Credential origin cannot change');
        if(!old&&command.action!=='replace')throw Error('A new credential requires a key');
        const namespace='credential:'+supplied.id,previous=old?.keyStorage==='session'?sessionKeys.get(namespace)??null:values[namespace]??null;
        if(old&&old.keyStorage!==supplied.keyStorage&&command.action==='keep'&&previous===null)throw Error('The existing key is unavailable for this storage transfer');
        const key=command.action==='replace'?command.value:command.action==='clear'?null:previous;
        const changed=command.action!=='keep'||!!old&&old.keyStorage!==supplied.keyStorage;
        const credential={...supplied,version:(old?.version??0)+(changed?1:0)};
        if(credential.keyStorage==='encrypted'&&key!==null)values[namespace]=key;else delete values[namespace];
        const credentials=old?current.credentials.map(c=>c.id===credential.id?credential:c):[...current.credentials,credential];
        const entries=current.entries.map(entry=>entry.credentialId===credential.id?this.prepareRegistration(entry,entry,credential):entry);
        const sessionChanges=credential.keyStorage==='session'&&key!==null?[{namespace,value:key}]:[{namespace,value:null}];
        return {registrations:normalizeRegistrations({...current,entries,credentials}),sessionChanges};
    }
    async saveApiCredential(meta:ApiCredential,update:RegistrationKeyUpdate,job:JobContext,sessionKeys:ReadonlyMap<string,string>=new Map()) {
        const guard=this.guard(job);guard();const snapshot=validateApiCredential(meta),command={...update};this.keyCommand(command);
        return this.serialize(async()=>{
            const catalog=await this.catalog(guard),current=normalizeRegistrations(catalog.modelRegistrations),secret=await this.loadJSON<SecretPayload>(this.header.secretRecordId,guard);
            if(secret&&secret.kind!=='secrets')throw Error('Invalid secret namespace');
            const values:Record<string,string>=Object.assign(Object.create(null),secret?.values??{}),result=this.changeCredential(current,snapshot,command,values,sessionKeys);
            await this.writeRegistrationCatalog(catalog,result.registrations,guard,{kind:'secrets',values});this.discardStaleRegistrationTests(result.registrations);return result;
        });
    }
    async deleteApiCredential(id:string,job:JobContext) {
        const guard=this.guard(job);guard();
        return this.serialize(async()=>{
            const catalog=await this.catalog(guard),current=normalizeRegistrations(catalog.modelRegistrations);
            if(!current.credentials.some(c=>c.id===id))throw Error('Credential unavailable');
            const secret=await this.loadJSON<SecretPayload>(this.header.secretRecordId,guard);if(secret&&secret.kind!=='secrets')throw Error('Invalid secret namespace');
            const values:Record<string,string>=Object.assign(Object.create(null),secret?.values??{});delete values['credential:'+id];
            const entries=current.entries.map(entry=>entry.credentialId===id?this.prepareRegistration(entry,entry,undefined):entry);
            const registrations=normalizeRegistrations({...current,entries,credentials:current.credentials.filter(c=>c.id!==id)});
            await this.writeRegistrationCatalog(catalog,registrations,guard,{kind:'secrets',values});this.discardStaleRegistrationTests(registrations);
            return {registrations,sessionChanges:[{namespace:'credential:'+id,value:null}]};
        });
    }
    async saveRegisteredModel(value:ModelRegistration,keyUpdate:RegistrationKeyUpdate,job:JobContext,sessionKeys:ReadonlyMap<string,string>=new Map()) {
        const guard=this.guard(job);guard();const model=validateRegistration(value),update={...keyUpdate},command=this.keyCommand(update);
        return this.serialize(async()=>{
            const catalog=await this.catalog(guard);let current=normalizeRegistrations(catalog.modelRegistrations);
            const old=current.entries.find(entry=>entry.id===model.id),secret=await this.loadJSON<SecretPayload>(this.header.secretRecordId,guard);
            if(secret&&secret.kind!=='secrets')throw Error('Invalid secret namespace');
            const values:Record<string,string>=Object.assign(Object.create(null),secret?.values??{}),origin=new URL(registrationEndpoint(model)).origin;
            const sameOrigin=old?.auth===model.auth&&new URL(registrationEndpoint(old)).origin===origin;
            let selectedId=model.auth==='none'||command.action==='clear'?undefined:model.credentialId;
            if(old&&!sameOrigin&&selectedId===old.credentialId)selectedId=undefined;
            let credential=current.credentials.find(c=>c.id===selectedId),sessionChanges:{namespace:string;value:string|null}[]=[];
            if(selectedId&&(!credential||credential.origin!==origin))throw Error('Credential origin does not match this model');
            if(model.auth==='bearer'&&command.action==='replace'){
                const meta=credential?{...credential,keyStorage:old?.credentialId===credential.id?(model.keyStorage??credential.keyStorage):credential.keyStorage}:{id:crypto.randomUUID(),name:update.action==='replace'&&update.name?update.name:model.name,origin,keyStorage:model.keyStorage??'encrypted',version:0};
                const result=this.changeCredential(current,meta,update,values,sessionKeys);current=result.registrations;sessionChanges=result.sessionChanges;credential=current.credentials.find(c=>c.id===meta.id);
            }else if(credential&&old?.credentialId===credential.id&&model.keyStorage!==old.keyStorage){
                const result=this.changeCredential(current,{...credential,keyStorage:model.keyStorage??'encrypted'},{action:'keep'},values,sessionKeys);current=result.registrations;sessionChanges=result.sessionChanges;credential=current.credentials.find(c=>c.id===credential!.id);
            }
            const next=this.prepareRegistration(model,old,credential);
            const registrations=normalizeRegistrations({...current,entries:old?current.entries.map(entry=>entry.id===model.id?next:entry):[...current.entries,next]});
            await this.writeRegistrationCatalog(catalog,registrations,guard,{kind:'secrets',values});
            this.pendingMigrationTransfers=[];this.discardStaleRegistrationTests(registrations);return {registrations,sessionChanges};
        });
    }
    async saveRegistrationKey(id: string, value: string | null, job: JobContext): Promise<ModelRegistrations> {
        const current = await this.loadModelRegistrations(job), model = current.entries.find(entry=>entry.id === id);
        if (!model || model.auth !== 'bearer') throw new Error('Save a Bearer registration before its key');
        return (await this.saveRegisteredModel({...model,keyStorage:'encrypted'},value===null?{action:'clear'}:{action:'replace',value},job)).registrations;
    }
    async saveRegistrationTest(id: string, value: RegistrationTestResult, job: JobContext): Promise<ModelRegistrations> {
        const guard = this.guard(job); guard(); const result = validateTestResult(value);
        // Keep completed responses before the first await, including storage failure and lock cutoff.
        this.pendingRegistrationTests.set(id, result);
        return this.serialize(() => this.persistRegistrationTest(id, result, guard));
    }
    private async persistRegistrationTest(id:string, result:RegistrationTestResult, guard:Guard):Promise<ModelRegistrations> {
        const catalog = await this.catalog(guard), current = normalizeRegistrations(catalog.modelRegistrations), entry = current.entries.find(item => item.id === id);
        if (!entry || registrationSignature(entry) !== result.signature) {
            if (this.pendingRegistrationTests.get(id) === result) this.pendingRegistrationTests.delete(id);
            throw new Error('Test belongs to an older configuration');
        }
        const registrations:ModelRegistrations = {...current, entries:current.entries.map(item => item.id === id ? {...item,lastTest:result} : item)};
        await this.writeRegistrationCatalog(catalog, registrations, guard);
        if (this.pendingRegistrationTests.get(id) === result) this.pendingRegistrationTests.delete(id);
        return registrations;
    }
    private async readProject(id: string, job: JobContext): Promise<MeetingProject | null> {
        const guard = this.guard(job);
        guard();
        const payload = await this.readProjectPayload(id, guard);
        guard();
        return payload ? snapshotProject(payload.project) : null;
    }
    private async listProjects(job: JobContext): Promise<readonly MeetingProject[]> {
        const guard = this.guard(job);
        guard();
        const catalog = await this.catalog(guard);
        guard();
        const projects: MeetingProject[] = [];
        for (const id of catalog.projectIds) {
            const p = await this.readProjectPayload(id, guard);
            guard();
            if (!p)
                throw new Error("Missing authenticated project");
            projects.push(snapshotProject(p.project));
        }
        return Object.freeze(projects);
    }
    private validateWrite(write: CheckpointWrite): CheckpointWrite {
        // Blob bytes are immutable; snapshot the caller-owned entry references
        // synchronously so validation and every later write use the same values.
        const audioRecords = Object.freeze(write.audioRecords.map(({ recordId, audio }) => Object.freeze({ recordId, audio })));
        assertJSON(write.project);
        validId(write.project.id);
        if (write.project.id === this.header.secretRecordId || write.project.id === this.header.vaultId)
            throw new Error("Reserved record identity");
        for (const run of write.project.runs)
            if (run.projectId !== write.project.id)
                throw new Error("Invalid run ownership");
        if (write.runId !== null && !write.project.runs.some(run => run.id === write.runId && run.state === "saving"))
            throw new Error("A saving run is required for promotion");
        const ids = new Set<string>();
        for (const { recordId, audio } of audioRecords) {
            validId(recordId);
            if (ids.has(recordId) || recordId === write.project.id || recordId === this.header.secretRecordId || recordId === this.header.vaultId || !(audio instanceof Blob))
                throw new Error("Invalid audio record");
            ids.add(recordId);
            const chunk = write.project.preparedChunks.find(c => c.audioRecordId === recordId);
            const source = write.project.sourceAssets.find(s => s.id === recordId);
            if (!chunk && !source)
                throw new Error("Audio record is not owned by the project");
            if (chunk && source)
                throw new Error("Ambiguous audio record purpose");
            if ((chunk?.encodedBytes ?? source?.bytes) !== audio.size)
                throw new Error("Audio byte count mismatch");
            if (chunk && audio.size > FULL_READ_LIMIT)
                throw new Error("Prepared chunk exceeds full-read limit");
        }
        return Object.freeze({ project: snapshotProject(write.project), runId: write.runId, audioRecords });
    }
    private async checkpoint(write: CheckpointWrite, job: JobContext): Promise<CheckpointResult> {
        const guard = this.guard(job);
        guard();
        const copy = this.validateWrite(write);
        this.pending.set(copy.project.id, copy);
        return this.serialize(async () => {
            guard();
            try {
                const result = await this.save(copy, guard); guard();
                if (this.pending.get(copy.project.id) === copy) this.pending.delete(copy.project.id);
                return result;
            } catch (error) {
                // A refused restoration is invalid work, not a completed snapshot
                // to offer again through the private lock finalizer.
                if (error instanceof DeletedAudioWriteError && this.pending.get(copy.project.id) === copy) this.pending.delete(copy.project.id);
                throw error;
            }
        });
    }
    private async save(write: CheckpointWrite, guard: Guard): Promise<CheckpointResult> {
        guard();
        const catalog = await this.catalog(guard);
        if (this.deletedRecordIds.has(write.project.id) || write.audioRecords.some(record => this.deletedRecordIds.has(record.recordId))) throw new DeletedAudioWriteError();
        const old = await this.readProjectPayload(write.project.id, guard);
        if (old?.project.retainedAudio) {
            const available = audioAvailability(old.project)!;
            for (const record of write.audioRecords) {
                const source = old.project.sourceAssets.find(source => source.id === record.recordId);
                const chunk = old.project.preparedChunks.find(chunk => chunk.audioRecordId === record.recordId);
                if (source && !available.sourceIds.includes(source.id) || chunk && !available.chunkIds.includes(chunk.id))
                    throw new DeletedAudioWriteError();
            }
            const newRecords = new Set(write.audioRecords.map(record => record.recordId));
            write = { ...write, project: snapshotProject({ ...write.project, retainedAudio: {
                sourceIds: write.project.sourceAssets.filter(source => available.sourceIds.includes(source.id) || newRecords.has(source.id)).map(source => source.id),
                chunkIds: write.project.preparedChunks.filter(chunk => available.chunkIds.includes(chunk.id) || newRecords.has(chunk.audioRecordId)).map(chunk => chunk.id),
            } }) };
        } else if (write.project.retainedAudio) {
            // Only an atomic cleanup can mark owned audio absent. A caller's
            // legacy/new project snapshot cannot invent missing availability.
            audioAvailability(write.project);
            write = { ...write, project: snapshotProject({ ...write.project, retainedAudio: {
                sourceIds: write.project.sourceAssets.map(source => source.id),
                chunkIds: write.project.preparedChunks.map(chunk => chunk.id),
            } }) };
        }
        if (!old && await this.getEnvelope(write.project.id, guard))
            throw new Error("Record belongs to a different namespace");
        const owned = new Set(old?.ownedRecords ?? []);
        const staged: RecordEnvelope[] = [];
        const manifests: Manifest[] = [];
        for (const { recordId, audio } of write.audioRecords) {
            guard();
            const existing = await this.loadJSON<AudioPointer>(recordId, guard);
            if (existing && (existing.kind !== "audio-pointer" || existing.projectId !== write.project.id))
                throw new Error("Audio belongs to another project");
            const manifestId = randomId();
            const generation = randomId();
            const blocks: Manifest["blocks"] = [];
            for (let offset = 0; offset < audio.size; offset += BLOCK_BYTES) {
                guard();
                const blockId = randomId();
                const bytes = new Uint8Array(await audio.slice(offset, Math.min(audio.size, offset + BLOCK_BYTES)).arrayBuffer());
                guard();
                let envelope: RecordEnvelope;
                try {
                    envelope = await this.encrypted(blockId, bytes, guard);
                }
                finally {
                    bytes.fill(0);
                }
                guard();
                await transaction<void>(this.db, ["records"], "readwrite", guard, tx => { tx.objectStore("records").add(envelope); }, this.active);
                guard();
                blocks.push({ id: blockId, index: blocks.length, bytes: Math.min(BLOCK_BYTES, audio.size - offset) });
                owned.add(blockId);
            }
            const chunk = write.project.preparedChunks.find(c => c.audioRecordId === recordId);
            const manifest: Manifest = { kind: "audio-manifest", projectId: write.project.id, recordId, generation, purpose: chunk ? "prepared" : "source", mimeType: chunk?.mimeType ?? audio.type, totalBytes: audio.size, blocks };
            manifests.push(manifest);
            staged.push(await this.encryptedJSON(manifestId, manifest, guard));
            staged.push(await this.encryptedJSON(recordId, { kind: "audio-pointer", projectId: write.project.id, manifestId }, guard));
            owned.add(manifestId);
            owned.add(recordId);
        }
        // Existing prepared/source references must resolve to authenticated owned pointers.
        for (const id of [...write.project.sourceAssets.map(s => s.id), ...write.project.preparedChunks.map(c => c.audioRecordId)]) {
            if (write.project.retainedAudio) {
                const availability = audioAvailability(write.project)!;
                const chunk = write.project.preparedChunks.find(chunk => chunk.audioRecordId === id);
                if (chunk ? !availability.chunkIds.includes(chunk.id) : !availability.sourceIds.includes(id)) continue;
            }
            if (write.audioRecords.some(a => a.recordId === id))
                continue;
            const pointer = await this.loadJSON<AudioPointer>(id, guard);
            if (!pointer || pointer.kind !== "audio-pointer" || pointer.projectId !== write.project.id)
                throw new Error("Missing owned audio record");
        }
        const checkpoint: Checkpoint = Object.freeze({ id: randomId(), projectId: write.project.id, runId: write.runId, recordIds: Object.freeze([write.project.id, ...staged.map(e => e.recordId)]), committedAt: new Date().toISOString() });
        const project = snapshotProject({ ...write.project, runs: write.project.runs.map(run => run.id === write.runId ? transitionRunState(run, "saved", checkpoint) : run) });
        owned.add(checkpoint.id);
        staged.push(await this.encryptedJSON(checkpoint.id, { kind: "checkpoint", checkpoint }, guard));
        staged.push(await this.encryptedJSON(project.id, { kind: "project", project, ownedRecords: [...owned], ...(old?.sourceDraftIds ? { sourceDraftIds: old.sourceDraftIds } : {}) } satisfies ProjectPayload, guard));
        staged.push(await this.encryptedJSON(this.header.vaultId, { ...catalog, projectIds: [...new Set([...catalog.projectIds, project.id])] }, guard));
        guard();
        await transaction<void>(this.db, ["records", "header"], "readwrite", guard, tx => {
            const records = tx.objectStore("records");
            const blocks = manifests.flatMap(m => m.blocks);
            let remaining = blocks.length;
            const promote = () => {
                const request = tx.objectStore("header").get("vault");
                request.onsuccess = () => {
                    const h = request.result as VaultHeader;
                    if (!h || h.keyId !== this.header.keyId) {
                        tx.abort();
                        return;
                    }
                    for (const e of staged)
                        records.put(e);
                    // Nonce/accounting reservations have already committed. Directory and
                    // encrypted records are promoted in this same final transaction.
                };
            };
            if (!remaining)
                promote();
            for (const block of blocks) {
                const request = records.get(block.id);
                request.onsuccess = () => { const e = request.result as RecordEnvelope; if (!e || e.recordId !== block.id || e.keyId !== this.header.keyId || e.vaultId !== this.header.vaultId) {
                    tx.abort();
                    return;
                } remaining--; if (remaining === 0)
                    promote(); };
            }
        }, this.active);
        guard();
        return Object.freeze({ project, checkpoint });
    }
    private async sourceDraft(projectId: string, sourceId: string, guard: Guard): Promise<{ draft: SourceDraftPayload; payload: ProjectPayload }> {
        const payload = await this.readProjectPayload(projectId, guard), draft = await this.loadJSON<SourceDraftPayload>(sourceId, guard); guard();
        if (!payload || !Array.isArray(payload.sourceDraftIds) || new Set(payload.sourceDraftIds).size !== payload.sourceDraftIds.length || !payload.sourceDraftIds.includes(sourceId) || !payload.ownedRecords.includes(sourceId) || !draft || draft.kind !== 'source-draft' || draft.projectId !== projectId || draft.sourceId !== sourceId || !draft.generation || !Number.isSafeInteger(draft.bodyBytes) || draft.bodyBytes < 0 || draft.bodyBytes > MAX_WAV_BODY_BYTES || !Array.isArray(draft.blocks)) throw new Error('Invalid owned source draft');
        validateWavCapture(draft.config); let total = 0; const ids = new Set<string>();
        for (const [index, block] of draft.blocks.entries()) {
            if (block.index !== index || !block.id || ids.has(block.id) || !payload.ownedRecords.includes(block.id) || !Number.isSafeInteger(block.bytes) || block.bytes <= 0 || block.bytes > BLOCK_BYTES) throw new Error('Invalid source draft blocks');
            ids.add(block.id); total += block.bytes;
        }
        if (total !== draft.bodyBytes) throw new Error('Source draft byte count mismatch');
        return { draft, payload };
    }
    listSourceDrafts(projectId: string, job: JobContext): Promise<readonly SourceDraft[]> {
        return this.trackRead(async () => {
            const guard = this.guard(job); guard(); const payload = await this.readProjectPayload(projectId, guard); guard();
            if (!payload) throw new Error('Source draft project is unavailable');
            const ids = payload.sourceDraftIds ?? []; if (!Array.isArray(ids) || new Set(ids).size !== ids.length) throw new Error('Invalid source draft directory');
            const result: SourceDraft[] = [];
            for (const id of ids) { const { draft } = await this.sourceDraft(projectId, id, guard); result.push(Object.freeze({ sourceId: id, projectId, config: Object.freeze({ ...draft.config }), bodyBytes: draft.bodyBytes, blockCount: draft.blocks.length })); }
            guard(); return Object.freeze(result);
        });
    }
    private assertSourceWriterProject(payload: ProjectPayload): void {
        if (payload.project.sourceAssets.length || payload.project.preparedChunks.length) throw new Error('Source writer conflicts with existing imported audio');
    }
    private async authenticateSourceDraft(draft: SourceDraftPayload, guard: Guard): Promise<void> {
        // Length/identity alone cannot qualify corrupted ciphertext as a complete
        // source. Authenticate one bounded block at a time, retaining no body copy.
        for (const block of draft.blocks) {
            guard();
            const envelope = await this.getEnvelope(block.id, guard);
            if (!envelope || !(envelope.ciphertext instanceof ArrayBuffer) || envelope.ciphertext.byteLength !== block.bytes + 16)
                throw new Error('Source draft block missing or truncated');
            const bytes = await decryptRecord(this.requireKey(), this.header, block.id, envelope);
            try { guard(); if (bytes.byteLength !== block.bytes) throw new Error('Source draft block byte count mismatch'); }
            finally { bytes.fill(0); }
        }
        guard();
    }
    // A single final transaction installs every new envelope and its ownership.
    // Existing body ciphertext is checked in place, never decrypted/reassembled.
    private async commitSourceRecords(staged: readonly RecordEnvelope[], newIds: ReadonlySet<string>, blocks: Manifest['blocks'], guard: Guard): Promise<void> {
        await transaction<void>(this.db, ['records', 'header'], 'readwrite', guard, tx => {
            const records = tx.objectStore('records'), abort = () => { try { tx.abort(); } catch { /* Already aborted. */ } };
            const promote = () => { try { guard(); for (const envelope of staged) { if (newIds.has(envelope.recordId)) records.add(envelope); else records.put(envelope); } } catch { abort(); } };
            const request = tx.objectStore('header').get('vault');
            request.onsuccess = () => {
                try {
                    guard(); const header = request.result as VaultHeader;
                    if (!header || header.keyId !== this.header.keyId || header.vaultId !== this.header.vaultId) { abort(); return; }
                    if (!blocks.length) { promote(); return; }
                    let index = 0;
                    // Queue the next lookup from this success event, keeping the
                    // same transaction active without fetching the entire source.
                    const checkNext = () => { const block = blocks[index], r = records.get(block.id); r.onsuccess = () => { try {
                        guard(); const e = r.result as RecordEnvelope;
                        if (!e || e.recordId !== block.id || e.keyId !== this.header.keyId || e.vaultId !== this.header.vaultId || !(e.ciphertext instanceof ArrayBuffer) || e.ciphertext.byteLength !== block.bytes + 16) { abort(); return; }
                        if (++index === blocks.length) promote(); else checkNext();
                    } catch { abort(); } }; };
                    checkNext();
                } catch { abort(); }
            };
        }, this.active);
    }
    async createSourceWriter(projectId: string, sourceId: string, config: WavCaptureConfig, job: JobContext): Promise<SourceWriter> {
        const guard = this.guard(job); guard(); validId(projectId); validId(sourceId); validateWavCapture(config);
        const settings = Object.freeze({ sampleRateHz: config.sampleRateHz, channels: config.channels });
        if (sourceId === projectId || sourceId === this.header.vaultId || sourceId === this.header.secretRecordId) throw new Error('Reserved source writer identity');
        return this.serialize(async () => {
            guard(); if (this.sourceWriter) throw new Error('A source writer is already active');
            const catalog = await this.catalog(guard), payload = await this.readProjectPayload(projectId, guard); guard();
            if (this.deletedRecordIds.has(sourceId)) throw new DeletedAudioWriteError();
            if (!catalog.projectIds.includes(projectId) || !payload) throw new Error('Source writer project is unavailable');
            this.assertSourceWriterProject(payload);
            let draft: SourceDraftPayload;
            if (await this.getEnvelope(sourceId, guard)) {
                draft = (await this.sourceDraft(projectId, sourceId, guard)).draft;
                if (draft.config.sampleRateHz !== settings.sampleRateHz || draft.config.channels !== settings.channels) throw new Error('Source writer configuration mismatch');
            } else {
                if (payload.sourceDraftIds?.length) throw new Error('Another incomplete source draft owns this project');
                draft = { kind: 'source-draft', projectId, sourceId, generation: randomId(), config: settings, bodyBytes: 0, blocks: [] };
                const next = { ...payload, ownedRecords: [...payload.ownedRecords, sourceId], sourceDraftIds: [sourceId] };
                const records = [await this.encryptedJSON(sourceId, draft, guard), await this.encryptedJSON(projectId, next, guard)];
                await this.commitSourceRecords(records, new Set([sourceId]), [], guard); guard();
            }
            const generation = draft.generation;
            const active = (writerGuard: Guard) => { guard(); writerGuard(); };
            const current = async (writerGuard: Guard) => {
                const check = () => active(writerGuard); check(); const value = await this.sourceDraft(projectId, sourceId, check); check();
                this.assertSourceWriterProject(value.payload); if (value.draft.generation !== generation) throw new Error('Source draft changed'); return value;
            };
            const writer = createBoundSourceWriter(job, {
                append: (bytes, writerGuard) => this.serialize(async () => {
                    const check = () => active(writerGuard), { draft, payload } = await current(writerGuard);
                    if (bytes.byteLength > MAX_WAV_BODY_BYTES - draft.bodyBytes) throw new Error('Source append exceeds RIFF32 limit');
                    const id = randomId(), envelope = await this.encrypted(id, bytes, check);
                    const next: SourceDraftPayload = { ...draft, bodyBytes: draft.bodyBytes + bytes.byteLength, blocks: [...draft.blocks, { id, index: draft.blocks.length, bytes: bytes.byteLength }] };
                    const records = [envelope, await this.encryptedJSON(sourceId, next, check), await this.encryptedJSON(projectId, { ...payload, ownedRecords: [...payload.ownedRecords, id] }, check)];
                    await this.commitSourceRecords(records, new Set([id]), [], check); check();
                }),
                finalize: (asset, writerGuard) => this.serialize(async () => {
                    const check = () => active(writerGuard), { draft, payload } = await current(writerGuard); assertJSON(asset);
                    const header = createWavHeader(settings, draft.bodyBytes, sourceId, asset), headerId = randomId(), manifestId = randomId();
                    let headerEnvelope: RecordEnvelope; try { await this.authenticateSourceDraft(draft, check); headerEnvelope = await this.encrypted(headerId, header, check); } finally { header.fill(0); }
                    const manifest: Manifest = { kind: 'audio-manifest', projectId, recordId: sourceId, generation: draft.generation, purpose: 'source', mimeType: 'audio/wav', totalBytes: asset.bytes, writerLayout: { kind: 'pcm16-wav-v1', config: settings }, blocks: [{ id: headerId, index: 0, bytes: 44 }, ...draft.blocks.map((block, i) => ({ ...block, index: i + 1 }))] };
                    const checkpoint: Checkpoint = Object.freeze({ id: randomId(), projectId, runId: null, recordIds: Object.freeze([projectId, sourceId, manifestId, headerId, ...draft.blocks.map(block => block.id)]), committedAt: new Date().toISOString() });
                    const project = snapshotProject({ ...payload.project, sourceAssets: [asset], ...(payload.project.retainedAudio ? { retainedAudio: { sourceIds: [asset.id], chunkIds: [...payload.project.retainedAudio.chunkIds] } } : {}) });
                    const owned = new Set([...payload.ownedRecords, headerId, manifestId, checkpoint.id]);
                    const records = [headerEnvelope, await this.encryptedJSON(manifestId, manifest, check), await this.encryptedJSON(sourceId, { kind: 'audio-pointer', projectId, manifestId }, check), await this.encryptedJSON(checkpoint.id, { kind: 'checkpoint', checkpoint }, check), await this.encryptedJSON(projectId, { ...payload, project, ownedRecords: [...owned], sourceDraftIds: payload.sourceDraftIds!.filter(id => id !== sourceId) }, check)];
                    await this.commitSourceRecords(records, new Set([headerId, manifestId, checkpoint.id]), draft.blocks, check);
                    // Actual commit may precede lock while its public receipt is fenced.
                    this.undeliveredSources.set(projectId, asset); check(); return Object.freeze({ project, checkpoint });
                }),
                delivered: () => { this.undeliveredSources.delete(projectId); },
                release: () => { if (this.sourceWriter === writer) this.sourceWriter = null; },
            });
            this.sourceWriter = writer; return writer;
        });
    }
    private async manifest(id: string, guard: Guard): Promise<Manifest> {
        const pointer = await this.loadJSON<AudioPointer>(id, guard);
        if (!pointer || pointer.kind !== "audio-pointer")
            throw new Error("Audio record unavailable");
        const manifest = await this.loadJSON<Manifest>(pointer.manifestId, guard);
        if (!manifest || manifest.kind !== "audio-manifest" || manifest.recordId !== id || manifest.projectId !== pointer.projectId || !manifest.generation || !Number.isSafeInteger(manifest.totalBytes) || manifest.totalBytes < 0 || !Array.isArray(manifest.blocks))
            throw new Error("Invalid authenticated audio manifest");
        const project = await this.readProjectPayload(manifest.projectId, guard);
        if (!project || !project.ownedRecords.includes(id) || !project.ownedRecords.includes(pointer.manifestId))
            throw new Error("Invalid audio ownership");
        let total = 0;
        const ids = new Set<string>();
        for (let i = 0; i < manifest.blocks.length; i++) {
            const block = manifest.blocks[i];
            if (block.index !== i || !block.id || ids.has(block.id) || !Number.isSafeInteger(block.bytes) || block.bytes <= 0 || block.bytes > BLOCK_BYTES || !project.ownedRecords.includes(block.id))
                throw new Error("Invalid authenticated audio blocks");
            ids.add(block.id);
            total += block.bytes;
        }
        if (total !== manifest.totalBytes)
            throw new Error("Audio byte count mismatch");
        return manifest;
    }
    private async retainedManifest(id: string, guard: Guard): Promise<Manifest> {
        const manifest = await this.manifest(id, guard);
        guard();
        validId(manifest.generation);
        if (manifest.purpose !== "source" || typeof manifest.mimeType !== "string")
            throw new Error("Invalid retained source manifest");
        for (const block of manifest.blocks) {
            validId(block.id);
        }
        const project = await this.readProjectPayload(manifest.projectId, guard);
        const catalog = await this.catalog(guard);
        guard();
        const sources = project?.project.sourceAssets;
        const matches = Array.isArray(sources) ? sources.filter(source => source.id === id) : [];
        if (!catalog.projectIds.includes(manifest.projectId) || matches.length !== 1 || matches[0].bytes !== manifest.totalBytes)
            throw new Error("Invalid retained source ownership or byte count");
        if (Object.prototype.hasOwnProperty.call(manifest, "writerLayout")) {
            const layout = manifest.writerLayout;
            if (!layout || layout.kind !== "pcm16-wav-v1" || manifest.mimeType !== "audio/wav" || manifest.blocks.length < 2 || manifest.blocks[0].bytes !== 44)
                throw new Error("Invalid authenticated writer layout");
            // Only the authenticated writer tag admits variable append blocks.
            // Validate its exact PCM16 declaration through the same header rules.
            const header = createWavHeader(layout.config, manifest.totalBytes - 44, id, matches[0]);
            header.fill(0);
        }
        else {
            if (manifest.blocks.length !== Math.ceil(manifest.totalBytes / BLOCK_BYTES))
                throw new Error("Invalid retained source block layout");
            for (const block of manifest.blocks) {
                if (block.bytes !== Math.min(BLOCK_BYTES, manifest.totalBytes - block.index * BLOCK_BYTES))
                    throw new Error("Invalid retained source block layout");
            }
        }
        return manifest;
    }
    openRetainedSource(id: string, job: JobContext): Promise<SourceReader> {
        return this.trackRead(async () => {
            const openingGuard = this.guard(job);
            openingGuard();
            const manifest = await this.retainedManifest(id, openingGuard);
            openingGuard();
            // Bind all authenticated descriptors, not just the mutable pointer.
            const identity = JSON.stringify(manifest);
            const offsets: number[] = [];
            let offset = 0;
            for (const block of manifest.blocks) { offsets.push(offset); offset += block.bytes; }
            const firstBlock = (start: number) => {
                let low = 0, high = manifest.blocks.length;
                while (low < high) {
                    const middle = Math.floor((low + high) / 2);
                    if (offsets[middle] + manifest.blocks[middle].bytes <= start) low = middle + 1;
                    else high = middle;
                }
                return low;
            };
            return Object.freeze({
                size: manifest.totalBytes,
                read: (start: number, end: number, readJob: JobContext) => {
                    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > manifest.totalBytes || end - start > MAX_SOURCE_READ_BYTES)
                        return Promise.reject(new Error("Invalid or oversized retained source range"));
                    if (this.sourceReadActive)
                        return Promise.reject(new Error("A retained source read is already in progress"));
                    // No unbounded queue of pending range requests. This slot is
                    // shared by every source reader belonging to this coordinator.
                    this.sourceReadActive = true;
                    return this.trackRead(async () => {
                        const readGuard = this.guard(readJob);
                        const guard = () => { openingGuard(); readGuard(); };
                        const assertSource = async () => {
                            if (JSON.stringify(await this.retainedManifest(id, guard)) !== identity)
                                throw new Error("Retained source changed; reopen the reader");
                            guard();
                        };
                        let output: Uint8Array<ArrayBuffer> | undefined;
                        try {
                            guard();
                            await assertSource();
                            output = new Uint8Array(end - start);
                            for (let index = firstBlock(start); start !== end && index < manifest.blocks.length && offsets[index] < end; index++) {
                                guard();
                                const block = manifest.blocks[index];
                                const envelope = await this.getEnvelope(block.id, guard);
                                guard();
                                // Reject truncated/oversized ciphertext before decryption.
                                if (!envelope || !(envelope.ciphertext instanceof ArrayBuffer) || envelope.ciphertext.byteLength !== block.bytes + 16)
                                    throw new Error("Retained source block missing or byte count mismatch");
                                const bytes = await decryptRecord(this.requireKey(), this.header, block.id, envelope);
                                try {
                                    guard();
                                    if (bytes.byteLength !== block.bytes)
                                        throw new Error("Retained source byte count mismatch");
                                    const blockStart = offsets[index];
                                    const from = Math.max(start, blockStart);
                                    const to = Math.min(end, blockStart + block.bytes);
                                    output.set(bytes.subarray(from - blockStart, to - blockStart), from - start);
                                }
                                finally { bytes.fill(0); }
                            }
                            // Ownership/generation can change while a block read is
                            // pending. Revalidate before handing bytes to the caller.
                            await assertSource();
                            guard();
                            return output.buffer;
                        }
                        catch (error) { output?.fill(0); throw error; }
                        finally { this.sourceReadActive = false; }
                    });
                },
            });
        });
    }
    private async *blocks(manifest: Manifest, guard: Guard): AsyncGenerator<Uint8Array<ArrayBuffer>> {
        for (const block of manifest.blocks) {
            guard();
            const envelope = await this.getEnvelope(block.id, guard);
            if (!envelope)
                throw new Error("Audio block missing");
            guard();
            const bytes = await decryptRecord(this.requireKey(), this.header, block.id, envelope);
            try {
                guard();
                if (bytes.byteLength !== block.bytes)
                    throw new Error("Audio byte count mismatch");
                yield bytes;
                guard();
            }
            finally {
                try {
                    bytes.fill(0);
                }
                catch { /* A consumer may have transferred/detached the block. */ }
            }
        }
    }
    streamSource(id: string, job: JobContext): AsyncGenerator<Uint8Array<ArrayBuffer>> {
        // Generator functions have their own `this`; retain the coordinator
        // explicitly until iterator completion, including lock-driven return().
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const owner = this;
        async function* sourceBlocks(): AsyncGenerator<Uint8Array<ArrayBuffer>> {
            try {
                const guard = owner.guard(job);
                guard();
                const manifest = await owner.manifest(id, guard);
                guard();
                if (manifest.purpose !== "source")
                    throw new Error("Expected a retained source");
                yield* owner.blocks(manifest, guard);
            }
            finally {
                owner.streams.delete(iterator);
            }
        }
        // Calling an async generator does not execute its body. This const is
        // initialized before next()/return() can reach the cleanup reference.
        const iterator = sourceBlocks();
        this.streams.add(iterator);
        return iterator;
    }
    private async readAudio(id: string, job: JobContext): Promise<Blob> {
        const guard = this.guard(job);
        guard();
        const manifest = await this.manifest(id, guard);
        guard();
        if (manifest.purpose !== "prepared" || manifest.totalBytes > FULL_READ_LIMIT)
            throw new Error("Only a prepared chunk within the full-read limit can be loaded");
        const project = await this.readProjectPayload(manifest.projectId, guard);
        const chunk = project?.project.preparedChunks.find(c => c.audioRecordId === id);
        if (!chunk || chunk.encodedBytes !== manifest.totalBytes || chunk.mimeType !== manifest.mimeType)
            throw new Error("Prepared audio byte count mismatch");
        const parts: Blob[] = [];
        for await (const bytes of this.blocks(manifest, guard)) {
            parts.push(new Blob([bytes]));
            guard();
        }
        guard();
        return new Blob(parts, { type: manifest.mimeType });
    }
    private async storageSnapshot(guard: Guard): Promise<{ catalog: Catalog; projects: Map<string, StorageProject>; inventory: Omit<StorageInventory, "originUsage" | "originQuota">; vaultRows: { id: string; iv: string; bytes: number }[] }> {
        guard();
        const header = await readHeader(this.db, guard);
        if (!header || header.vaultId !== this.header.vaultId || header.keyId !== this.header.keyId) throw new Error("Vault ownership changed");
        const catalog = await this.catalog(guard), payloads = new Map<string, ProjectPayload>(), owners = new Map<string, string>();
        for (const id of catalog.projectIds) {
            const payload = await this.readProjectPayload(id, guard);
            if (!payload || new Set(payload.ownedRecords).size !== payload.ownedRecords.length) throw new Error("Invalid storage ownership");
            payloads.set(id, payload);
            for (const recordId of [id, ...payload.ownedRecords]) {
                validId(recordId);
                if (recordId === this.header.vaultId || recordId === this.header.secretRecordId || owners.has(recordId) || this.deletedRecordIds.has(recordId)) throw new Error("Ambiguous cross-project/deleted storage ownership");
                owners.set(recordId, id);
            }
        }
        const row = async (id: string) => {
            const envelope = await this.getEnvelope(id, guard);
            if (!envelope || envelope.vaultId !== this.header.vaultId || envelope.keyId !== this.header.keyId || envelope.cryptoVersion !== this.header.cryptoVersion || envelope.schemaVersion !== this.header.schemaVersion || !(envelope.ciphertext instanceof ArrayBuffer) || envelope.ciphertext.byteLength < 16) throw new Error("Owned encrypted storage record unavailable");
            return { id, iv: envelope.iv, bytes: envelope.ciphertext.byteLength };
        };
        const projects = new Map<string, StorageProject>();
        let sourceBytes = 0, chunkBytes = 0, draftBytes = 0, projectBytes = 0, encryptedBytes = 0;
        for (const [id, payload] of payloads) {
            const project = payload.project, sourceRecords = new Set<string>(), chunkRecords = new Set<string>(), draftRecords = new Set<string>();
            const sourceIds = project.sourceAssets.map(source => source.id), chunkIds = project.preparedChunks.map(chunk => chunk.id);
            if (new Set(sourceIds).size !== sourceIds.length || new Set(chunkIds).size !== chunkIds.length) throw new Error("Duplicate audio descriptors");
            const explicit = audioAvailability(project);
            const availability = explicit ?? Object.freeze({ sourceIds: Object.freeze(sourceIds), chunkIds: Object.freeze(chunkIds) });
            const manifests = new Map<string, Manifest>();
            for (const source of project.sourceAssets) {
                if (!availability.sourceIds.includes(source.id)) { if (await this.getEnvelope(source.id, guard)) throw new Error("Deleted source still has a pointer"); continue; }
                const manifest = await this.retainedManifest(source.id, guard), pointer = (await this.loadJSON<AudioPointer>(source.id, guard))!;
                manifests.set(pointer.manifestId, manifest); sourceRecords.add(source.id);
            }
            for (const chunk of project.preparedChunks) {
                if (!availability.chunkIds.includes(chunk.id)) { if (await this.getEnvelope(chunk.audioRecordId, guard)) throw new Error("Deleted chunk still has a pointer"); continue; }
                const manifest = await this.manifest(chunk.audioRecordId, guard), pointer = (await this.loadJSON<AudioPointer>(chunk.audioRecordId, guard))!;
                if (manifest.purpose !== "prepared" || manifest.totalBytes !== chunk.encodedBytes || manifest.mimeType !== chunk.mimeType) throw new Error("Invalid prepared storage metadata");
                manifests.set(pointer.manifestId, manifest); chunkRecords.add(chunk.audioRecordId);
            }
            const draftIds = payload.sourceDraftIds ?? [];
            if (!Array.isArray(draftIds) || new Set(draftIds).size !== draftIds.length) throw new Error("Invalid draft directory");
            let localDraftBytes = 0;
            for (const draftId of draftIds) {
                const { draft } = await this.sourceDraft(id, draftId, guard);
                draftRecords.add(draftId); localDraftBytes += draft.bodyBytes;
                for (const block of draft.blocks) { draftRecords.add(block.id); const envelope = await row(block.id); if (envelope.bytes !== block.bytes + 16) throw new Error("Invalid draft block size"); }
            }
            // Older promoted generations remain in ownedRecords. Discover their
            // authenticated manifests so cleanup cannot leave old audio bodies.
            const knownBlocks = new Set([...manifests.values()].flatMap(manifest => manifest.blocks.map(block => block.id)));
            // Promotion appends manifests after their body IDs. Read metadata
            // backwards so historical raw audio is not interpreted as JSON.
            for (const recordId of [...payload.ownedRecords].reverse()) {
                if (sourceRecords.has(recordId) || chunkRecords.has(recordId) || draftRecords.has(recordId) || manifests.has(recordId) || knownBlocks.has(recordId)) continue;
                const envelope = await this.getEnvelope(recordId, guard);
                if (!envelope) throw new Error("Owned record missing");
                const bytes = await decryptRecord(this.requireKey(), this.header, recordId, envelope);
                let value: unknown;
                try { guard(); try { value = JSON.parse(new TextDecoder().decode(bytes)); } catch { value = null; } }
                finally { bytes.fill(0); }
                if (value && typeof value === "object" && "kind" in value && value.kind === "audio-manifest") {
                    const manifest = value as Manifest;
                    if (manifest.projectId !== id || owners.get(manifest.recordId) !== id || manifest.recordId === id || !Number.isSafeInteger(manifest.totalBytes) || manifest.totalBytes < 0 || typeof manifest.mimeType !== "string" || !Array.isArray(manifest.blocks) || !["source", "prepared"].includes(manifest.purpose)) throw new Error("Invalid historical audio manifest");
                    validId(manifest.generation);
                    const ids = new Set<string>(); let total = 0;
                    for (const [index, block] of manifest.blocks.entries()) {
                        if (!block || block.index !== index || owners.get(block.id) !== id || ids.has(block.id) || !Number.isSafeInteger(block.bytes) || block.bytes <= 0 || block.bytes > BLOCK_BYTES) throw new Error("Invalid historical block ownership");
                        ids.add(block.id); total += block.bytes; knownBlocks.add(block.id);
                    }
                    if (total !== manifest.totalBytes) throw new Error("Historical audio byte mismatch");
                    manifests.set(recordId, manifest);
                }
            }
            let localSourceBytes = 0, localChunkBytes = 0;
            for (const [manifestId, manifest] of manifests) {
                if (owners.get(manifestId) !== id) throw new Error("Invalid owned manifest");
                const ids = manifest.purpose === "source" ? sourceRecords : chunkRecords;
                const pointer = await this.loadJSON<AudioPointer>(manifest.recordId, guard);
                const pointed = pointer && manifests.get(pointer.manifestId);
                if (!pointer || pointer.kind !== "audio-pointer" || pointer.projectId !== id || !pointed || pointed.recordId !== manifest.recordId || pointed.purpose !== manifest.purpose) throw new Error("Invalid historical audio pointer");
                ids.add(manifest.recordId);
                ids.add(manifestId);
                for (const block of manifest.blocks) { ids.add(block.id); const envelope = await row(block.id); if (envelope.bytes !== block.bytes + 16) throw new Error("Invalid owned audio block size"); }
                if (manifest.purpose === "source") localSourceBytes += manifest.totalBytes; else localChunkBytes += manifest.totalBytes;
            }
            if ([...sourceRecords].some(record => chunkRecords.has(record) || draftRecords.has(record)) || [...chunkRecords].some(record => draftRecords.has(record))) throw new Error("Ambiguous audio/draft records");
            const rows = [];
            for (const recordId of [id, ...payload.ownedRecords]) rows.push(await row(recordId));
            const localEncrypted = rows.reduce((sum, entry) => sum + entry.bytes, 0), localProjectBytes = rows[0].bytes;
            const inventory: StorageProjectInventory = Object.freeze({ projectId: id, sourceBytes: localSourceBytes, chunkBytes: localChunkBytes, draftBytes: localDraftBytes, projectBytes: localProjectBytes, encryptedBytes: localEncrypted, retainedAudio: availability, draftIds: Object.freeze([...draftIds]) });
            projects.set(id, { payload, availability, sourceRecords, chunkRecords, draftRecords, rows, inventory });
            sourceBytes += localSourceBytes; chunkBytes += localChunkBytes; draftBytes += localDraftBytes; projectBytes += localProjectBytes; encryptedBytes += localEncrypted;
        }
        const vaultRows = [await row(this.header.vaultId)];
        if (await this.getEnvelope(this.header.secretRecordId, guard)) vaultRows.push(await row(this.header.secretRecordId));
        const vaultBytes = vaultRows.reduce((sum, entry) => sum + entry.bytes, 0); encryptedBytes += vaultBytes;
        if (![sourceBytes, chunkBytes, draftBytes, projectBytes, encryptedBytes].every(Number.isSafeInteger)) throw new Error("Storage byte totals exceed safe integer range");
        guard();
        return { catalog, projects, vaultRows, inventory: Object.freeze({ sourceBytes, chunkBytes, draftBytes, projectBytes, encryptedBytes, vaultBytes, projects: Object.freeze([...projects.values()].map(value => value.inventory)) }) };
    }
    getStorageInventory(job: JobContext): Promise<Omit<StorageInventory, "originUsage" | "originQuota">> { return this.trackRead(() => this.serialize(async () => (await this.storageSnapshot(this.guard(job))).inventory)); }
    getAudioAvailability(projectId: string, job: JobContext): Promise<RetainedAudio> {
        return this.trackRead(() => this.serialize(async () => { const value = (await this.storageSnapshot(this.guard(job))).projects.get(projectId); if (!value) throw new Error("Storage project unavailable"); return value.availability; }));
    }
    private storageRevision(snapshot: Awaited<ReturnType<VaultCoordinator["storageSnapshot"]>>, projectId: string | null): string {
        return JSON.stringify({ owner: [this.header.vaultId, this.header.keyId], rows: projectId === null ? [...snapshot.projects.values()].flatMap(project => project.rows).concat(snapshot.vaultRows) : snapshot.projects.get(projectId)?.rows, ownership: [...snapshot.projects].map(([id, project]) => [id, project.payload.ownedRecords]) });
    }
    private assertPreparationIdle(): void {
        if (this.sourceWriter || this.sourceReadActive || this.streams.size || this.pending.size)
            throw new Error("Finish active audio/storage work before resetting preparation");
    }
    private resetProject(snapshot: Awaited<ReturnType<VaultCoordinator["storageSnapshot"]>>, projectId: string): StorageProject {
        this.assertPreparationIdle();
        const value = snapshot.projects.get(projectId);
        if (!value) throw new Error("Preparation project unavailable");
        if ([...snapshot.projects.values()].some(entry => entry.payload.project.runs.some(run => ["queued", "requesting", "response-received", "saving"].includes(run.state))))
            throw new Error("Finish active runs before resetting preparation");
        if (!value.payload.project.sourceAssets.length || value.payload.project.sourceAssets.some(source => !Number.isSafeInteger(source.bytes) || source.bytes <= 0 || !value.availability.sourceIds.includes(source.id)) || value.draftRecords.size)
            throw new Error("A complete retained original source is required to reset preparation");
        return value;
    }
    planPreparationReset(projectId: string, options: AudioOptions, job: JobContext): Promise<PreparationResetPlan> {
        const guard = this.guard(job); guard(); this.assertPreparationIdle();
        assertJSON(options); validateOptions(options);
        const optionsSnapshot = structuredClone(options);
        return this.trackRead(() => this.serialize(async () => {
            const snapshot = await this.storageSnapshot(guard), value = this.resetProject(snapshot, projectId), project = value.payload.project;
            const audioOptions = snapshotProject({ ...project, audioOptions: optionsSnapshot }).audioOptions;
            const plan: PreparationResetPlan = Object.freeze({ projectId, audioOptions, versionToken: randomId(), counts: Object.freeze({ chunks: project.preparedChunks.length, transcriptVersions: project.transcriptVersions.length, minutesRevisions: project.minutesRevisions.length }) });
            guard(); return this.preparationResetPlans.issue(plan, this.storageRevision(snapshot, projectId));
        }));
    }
    acceptPreparationReset(plan: PreparationResetPlan, token: string, job: JobContext): Readonly<{ plan: PreparationResetPlan; revision: string }> {
        this.guard(job)(); this.assertPreparationIdle(); return this.preparationResetPlans.accept(plan, token);
    }
    executePreparationReset(plan: PreparationResetPlan, revision: string, guard: Guard): Promise<MeetingProject> {
        return this.serialize(async () => {
            guard();
            const snapshot = await this.storageSnapshot(guard);
            if (this.storageRevision(snapshot, plan.projectId) !== revision) throw new Error("Preparation reset plan is stale; confirm again");
            const value = this.resetProject(snapshot, plan.projectId), old = value.payload.project;
            // Authenticate original bodies one block at a time before removing the usable prepared copy.
            for (const source of old.sourceAssets) {
                const manifest = await this.retainedManifest(source.id, guard);
                for await (const bytes of this.blocks(manifest, guard)) { bytes.fill(0); guard(); }
            }
            const removed = value.chunkRecords, resetAt = new Date().toISOString();
            const archive = { id: randomId(), resetAt, chunks: old.preparedChunks.map(({ id, index, sourceStartMs, sourceEndMs }) => ({ id, index, sourceStartMs, sourceEndMs })), items: aggregateProjectUsage({ ...old, processingArchives: [] }).items.map(item => ({ ...item, archivedAt: resetAt })) };
            const retained = { ...old } as MeetingProject & { failedProviderResponses?: unknown };
            delete retained.failedProviderResponses;
            const project = snapshotProject({ ...retained, audioOptions: plan.audioOptions, updatedAt: resetAt, preparedChunks: [], rawTranscripts: [], transcriptVersions: [], selectedTranscriptVersionId: null, sttBatches: [], minutesRuns: [], minutesRevisions: [], selectedMinutesRevisionId: null, minutesComparisons: [], runs: [], processingArchives: [...(old.processingArchives ?? []), archive], retainedAudio: { sourceIds: [...value.availability.sourceIds], chunkIds: [] } });
            const payload: ProjectPayload = { ...value.payload, project, ownedRecords: value.payload.ownedRecords.filter(id => !removed.has(id)) };
            const envelope = await this.encryptedJSON(project.id, payload, guard);
            const catalog = { ...snapshot.catalog, deletedRecordIds: [...new Set([...(snapshot.catalog.deletedRecordIds ?? []), ...removed])] };
            const directory = await this.encryptedJSON(this.header.vaultId, catalog, guard);
            await transaction<void>(this.db, ["records", "header"], "readwrite", guard, tx => {
                const request = tx.objectStore("header").get("vault");
                request.onsuccess = () => { try {
                    guard(); const header = request.result as VaultHeader;
                    if (!header || header.vaultId !== this.header.vaultId || header.keyId !== this.header.keyId) throw new Error("Vault ownership changed");
                    for (const id of removed) tx.objectStore("records").delete(id);
                    tx.objectStore("records").put(envelope); tx.objectStore("records").put(directory);
                } catch { tx.abort(); } };
            }, this.active);
            guard(); this.deletedRecordIds = new Set(catalog.deletedRecordIds);
            return project;
        });
    }
    planDeletion(scope: DeletionPlan["scope"], projectId: string | null, job: JobContext): Promise<DeletionPlan> {
        return this.trackRead(() => this.serialize(async () => {
            const guard = this.guard(job); guard();
            if (!["source", "chunks", "meeting", "vault"].includes(scope) || (scope === "vault" ? projectId !== null : typeof projectId !== "string")) throw new Error("Invalid deletion scope/project");
            const snapshot = await this.storageSnapshot(guard), project = projectId === null ? null : snapshot.projects.get(projectId);
            if (projectId !== null && !project) throw new Error("Deletion project unavailable");
            const ids = scope === "source" ? [...project!.sourceRecords, ...project!.draftRecords] : scope === "chunks" ? [...project!.chunkRecords] : scope === "meeting" ? project!.rows.map(row => row.id) : [...snapshot.projects.values()].flatMap(project => project.rows.map(row => row.id)).concat(snapshot.vaultRows.map(row => row.id));
            const plan: DeletionPlan = Object.freeze({ scope, projectId, recordIds: Object.freeze([...new Set(ids)].sort()), draftIds: Object.freeze(scope === "source" || scope === "meeting" ? [...project!.inventory.draftIds] : scope === "vault" ? [...snapshot.projects.values()].flatMap(project => [...project.inventory.draftIds]) : []), versionToken: randomId() });
            guard(); return this.deletionPlans.issue(plan, this.storageRevision(snapshot, projectId));
        }));
    }
    acceptDeletion(plan: DeletionPlan, confirmation: DeletionConfirmation, job: JobContext): Readonly<{ plan: DeletionPlan; revision: string }> { this.guard(job)(); return this.deletionPlans.accept(plan, confirmation); }
    retainDeletionPending(captured: readonly CheckpointWrite[]): readonly CheckpointWrite[] {
        this.publicGuard();
        const copies = captured.map(write => this.validateWrite(write));
        // Controller capture can drain its own map. Transfer ownership before
        // teardown can throw or synchronously trigger the normal lock boundary.
        for (const write of copies) this.pending.set(write.project.id, write);
        return Object.freeze(copies);
    }
    async flushDeletionPending(captured: readonly CheckpointWrite[], guard: Guard): Promise<void> {
        await this.drain(); guard();
        const changed: CheckpointWrite[] = [];
        for (const write of captured) {
            const current = await this.readProjectPayload(write.project.id, guard);
            if (!current) throw new Error("Pending cleanup project unavailable");
            if (write.audioRecords.length || JSON.stringify(write.project) !== JSON.stringify(current.project)) changed.push(write);
            else if (this.pending.get(write.project.id) === write) this.pending.delete(write.project.id);
        }
        guard();
        if (changed.length) await this.serialize(() => this.finalize(changed, guard, false));
    }
    executeAcceptedDeletion(plan: DeletionPlan, revision: string, guard: Guard, job: JobContext): Promise<void> {
        return this.serialize(async () => {
        const snapshot = await this.storageSnapshot(guard); guard();
        if (this.storageRevision(snapshot, plan.projectId) !== revision) throw new Error("Deletion plan is stale; inspect current inventory and confirm again");
        if (plan.scope === "vault") return; // Session invokes the existing atomic reset.
        if (plan.scope === "meeting") return;
        const value = snapshot.projects.get(plan.projectId!)!, removed = new Set(plan.recordIds);
        const retainedAudio = Object.freeze({ sourceIds: plan.scope === "source" ? [] : [...value.availability.sourceIds], chunkIds: plan.scope === "chunks" ? [] : [...value.availability.chunkIds] });
        const project = snapshotProject({ ...value.payload.project, retainedAudio });
        const payload: ProjectPayload = { ...value.payload, project, ownedRecords: value.payload.ownedRecords.filter(id => !removed.has(id)), sourceDraftIds: (value.payload.sourceDraftIds ?? []).filter(id => !removed.has(id)) };
        const envelope = await this.encryptedJSON(project.id, payload, guard);
        const catalog = { ...snapshot.catalog, deletedRecordIds: [...new Set([...(snapshot.catalog.deletedRecordIds ?? []), ...removed])] };
        const directory = await this.encryptedJSON(this.header.vaultId, catalog, guard);
        await transaction<void>(this.db, ["records", "header"], "readwrite", guard, tx => {
            const request = tx.objectStore("header").get("vault");
            request.onsuccess = () => { try {
                guard(); const header = request.result as VaultHeader;
                if (!header || header.vaultId !== this.header.vaultId || header.keyId !== this.header.keyId) throw new Error("Vault ownership changed");
                for (const id of removed) tx.objectStore("records").delete(id);
                tx.objectStore("records").put(envelope);
                tx.objectStore("records").put(directory);
            } catch { tx.abort(); } };
        }, this.active);
        guard(); this.deletedRecordIds = new Set(catalog.deletedRecordIds); this.pending.delete(project.id);
        }).then(() => plan.scope === "meeting" ? this.deleteProject(plan.projectId!, job, guard) : undefined);
    }
    private async deleteProject(id: string, job: JobContext, operationGuard?: Guard): Promise<void> {
        const guard = operationGuard ?? this.guard(job);
        guard();
        await this.serialize(async () => {
            guard();
            const project = await this.readProjectPayload(id, guard);
            if (!project)
                return;
            // Ownership is authenticated in the encrypted project; reject shared/collateral IDs.
            const catalog = await this.catalog(guard);
            guard();
            const others = new Set<string>();
            for (const otherId of catalog.projectIds) {
                if (otherId === id)
                    continue;
                const other = await this.readProjectPayload(otherId, guard);
                if (!other)
                    throw new Error("Missing authenticated project");
                others.add(otherId);
                for (const record of other.ownedRecords)
                    others.add(record);
            }
            if (project.ownedRecords.some(record => others.has(record) || record === this.header.secretRecordId))
                throw new Error("Invalid cross-project ownership");
            const deletedRecordIds = new Set([...(catalog.deletedRecordIds ?? []), ...project.ownedRecords, id]);
            const nextCatalog = { ...catalog, projectIds: catalog.projectIds.filter(v => v !== id), deletedRecordIds: [...deletedRecordIds],
                ...(catalog.screenState ? { screenState: withoutDeletedProjectScreenState(catalog.screenState, deletedRecordIds) } : {}) };
            const envelope = await this.encryptedJSON(this.header.vaultId, nextCatalog, guard);
            await transaction<void>(this.db, ["records"], "readwrite", guard, tx => {
                for (const record of [...project.ownedRecords, id])
                    tx.objectStore("records").delete(record);
                tx.objectStore("records").put(envelope);
            }, this.active);
            guard();
            this.deletedRecordIds = deletedRecordIds;
            if (this.pendingScreenState) this.pendingScreenState = withoutDeletedProjectScreenState(this.pendingScreenState, deletedRecordIds);
            this.pending.delete(id);
        });
    }
    async saveProviderKey(providerId: string, value: string | null, job: JobContext): Promise<void> {
        const guard = this.guard(job);
        guard();
        await this.serialize(async () => {
            const old = await this.loadJSON<SecretPayload>(this.header.secretRecordId, guard);
            if (old && old.kind !== "secrets")
                throw new Error("Invalid secret namespace");
            const values: Record<string, string> = Object.assign(Object.create(null), old?.values ?? {});
            if (value === null)
                delete values[providerId];
            else
                values[providerId] = value;
            const envelope = await this.encryptedJSON(this.header.secretRecordId, { kind: "secrets", values }, guard);
            await transaction<void>(this.db, ["records"], "readwrite", guard, tx => { tx.objectStore("records").put(envelope); }, this.active);
            guard();
        });
    }
    getProviderKey(providerId: string, job: JobContext): Promise<string | null> { return this.trackRead(() => this.readProviderKey(providerId, job)); }
    private async readProviderKey(providerId: string, job: JobContext): Promise<string | null> {
        const guard = this.guard(job);
        guard();
        if(providerId.startsWith('registration:')) {
            const catalog=await this.catalog(guard),entry=catalog.modelRegistrations?.entries.find(model=>providerId==='registration:'+model.id);
            if(entry?.credentialId)providerId='credential:'+entry.credentialId;
            else if(catalog.modelRegistrations?.credentials!==undefined)return null;
        }
        const record = await this.loadJSON<SecretPayload>(this.header.secretRecordId, guard);
        guard();
        if (record && record.kind !== "secrets")
            throw new Error("Invalid secret namespace");
        return record && Object.prototype.hasOwnProperty.call(record.values, providerId) ? record.values[providerId] : null;
    }
    async changePassphrase(current: string, next: string, job: JobContext): Promise<void> {
        const guard = this.guard(job);
        guard();
        await this.serialize(async () => { guard(); const h = await readHeader(this.db, guard); guard(); if (!h)
            throw new Error("Vault unavailable"); const candidate = await rewrapHeader(current, next, h); guard(); await transaction<void>(this.db, ["header"], "readwrite", guard, tx => { tx.objectStore("header").put(candidate); }, this.active); guard(); this.header = candidate; });
    }
    // Revoke public scheduling first, abort/drain transactions, then use only the private guard.
    async drain(): Promise<void> {
        void this.sourceWriter?.abort();
        for (const tx of this.active) {
            try {
                tx.abort();
            }
            catch { /* Committed transaction is drained by the barrier. */ }
        }
        await Promise.allSettled([...this.streams].map(iterator => iterator.return(undefined)));
        this.streams.clear();
        await this.tail;
        await Promise.allSettled([...this.reads]);
    }
    capturePending(): readonly CheckpointWrite[] { return [...this.pending.values()]; }
    async finalize(captured: readonly CheckpointWrite[], guard: Guard = this.privateGuard, drain = true): Promise<void> {
        if (drain) await this.drain();
        guard();
        for (const write of captured) {
            guard();
            let copy = this.validateWrite(write);
            const promoted = this.undeliveredSources.get(copy.project.id);
            if (promoted && !copy.project.sourceAssets.length && !copy.audioRecords.length) {
                const current = await this.readProjectPayload(copy.project.id, guard);
                if (current?.project.sourceAssets.some(asset => asset.id === promoted.id)) copy = this.validateWrite({ ...copy, project: { ...copy.project, sourceAssets: current.project.sourceAssets } });
            }
            let project = snapshotProject({ ...copy.project, runs: copy.project.runs.map(run => run.intent && run.state === "requesting" ? { ...run, state: "outcome-unknown", checkpoint: null } : run) });
            let audioRecords = copy.audioRecords;
            // Completed outcomes captured before cutoff are promoted, including a generic
            // editor snapshot whose caller did not specify the pending inference run ID.
            const completed = project.runs.filter(run => run.id === copy.runId || ((run.state === "saving" || run.state === "response-received") && (project.rawTranscripts.some(raw => raw.runId === run.id) || project.minutesRuns.some(minutes => minutes.id === run.id))));
            if (completed.length) {
                for (const run of completed) {
                    if (run.state === "response-received")
                        project = snapshotProject({ ...project, runs: project.runs.map(candidate => candidate.id === run.id ? transitionRunState(candidate, "saving") : candidate) });
                    const result = await this.save({ project, runId: run.id, audioRecords }, guard);
                    project = result.project;
                    audioRecords = [];
                }
            }
            else
                await this.save({ ...copy, project }, guard);
            this.pending.delete(copy.project.id);
        }
        for (const [id, result] of this.pendingRegistrationTests) await this.persistRegistrationTest(id, result, guard);
        if (this.pendingSelectionLists) await this.persistSelectionLists(this.pendingSelectionLists, guard);
        if (this.pendingScreenState) await this.persistScreenState(this.pendingScreenState, guard);
        await this.recover(guard);
    }
    async recover(guard: Guard = this.privateGuard): Promise<void> {
        guard();
        const catalog = await this.catalog(guard);
        guard();
        for (const id of catalog.projectIds) {
            const payload = await this.readProjectPayload(id, guard);
            guard();
            if (!payload)
                throw new Error("Missing authenticated project");
            const project = recovering(payload.project);
            if (project.runs.some((run, i) => run.state !== payload.project.runs[i].state))
                await this.save({ project, runId: null, audioRecords: [] }, guard);
        }
        await this.cleanup(guard);
    }
    private async cleanup(guard: Guard): Promise<void> {
        guard();
        const catalog = await this.catalog(guard);
        guard();
        const referenced = new Set([this.header.secretRecordId, this.header.vaultId]);
        for (const id of catalog.projectIds) {
            const payload = await this.readProjectPayload(id, guard);
            guard();
            if (!payload)
                throw new Error("Missing authenticated project");
            referenced.add(id);
            for (const owned of payload.ownedRecords)
                referenced.add(owned);
        }
        // Cursor deletes one abandoned ciphertext at a time; never getAll source blocks.
        await transaction<void>(this.db, ["records"], "readwrite", guard, tx => { const request = tx.objectStore("records").openKeyCursor(); request.onsuccess = () => { const cursor = request.result; if (!cursor)
            return; if (!referenced.has(String(cursor.primaryKey)))
            tx.objectStore("records").delete(cursor.primaryKey); cursor.continue(); }; }, this.active);
        guard();
    }
    release(): void { void this.sourceWriter?.abort(); this.key = null; this.pending.clear(); this.pendingRegistrationTests.clear(); this.pendingMigrationTransfers = []; this.pendingSelectionLists = null; this.pendingScreenState = null; this.undeliveredSources.clear(); this.deletionPlans.clear(); this.preparationResetPlans.clear(); this.deletedRecordIds.clear(); this.db.close(); }
}
