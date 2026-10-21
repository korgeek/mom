import type { PreparationResetPlan } from "./preparation-reset";
import { registrationEndpoint, validateApiCredential, validateRegistration, type ApiCredential, type ModelRegistration, type ModelRegistrations, type RegistrationKeyUpdate, type RegistrationTestResult } from '../providers/model-registrations';
import type { SelectionLists } from '../settings/lists';
import { cancelJobs, createJobContext, snapshotProject } from "../domain/jobs";
import type { AudioOptions, MeetingProject, CheckpointWrite, DeletionConfirmation, DeletionPlan, JobContext, ModelRegistry, RetainedAudio, SourceDraft, SourceWriter, StorageInventory, VaultStore, WavCaptureConfig } from "../domain/types";
import { originStorageEstimate } from "./storage-management";
import type { SourceReader } from "../media/source";
import type { ScreenState } from './screen-state';
import { createHeader, randomId, unwrapHeader, validatePassphrase } from "./crypto";
import { clearVaultDatabase, openVaultDatabase, readHeader, readResetOwnerId, VaultCoordinator, writeInitialHeader } from "./store";
export type VaultState = "locked" | "unlocking" | "unlocked" | "locking" | "lock-save-failed";
export type VaultLockOptions = Readonly<{ idleMinutes: 5 | 15 | 30; lockOnHide: boolean }>;
type ReleaseOwnership = () => void | Promise<void>;
export type Ownership = Readonly<{
    acquire(name: string): Promise<ReleaseOwnership | null>;
}>;
export type VaultSessionOptions = Readonly<{
    databaseName?: string;
    indexedDB?: IDBFactory;
    onState?: (state: VaultState) => void;
    // Capture before clear/teardown; returned snapshots must be the latest completed work.
    capturePending?: () => readonly CheckpointWrite[];
    onSensitiveClear?: () => void;
    teardown?: () => void;
    idleMs?: number;
    // The controller owns screen locking; page departure still closes the vault.
    screenLockManaged?: boolean;
    // Deliberate test seam: rejected in every non-test Vite mode.
    testOnlyOwnership?: Ownership;
}>;
export interface VaultSession {
    readonly state: VaultState;
    readonly store: VaultStore;
    create(secret: string, confirmation: string): Promise<void>;
    unlock(secret: string): Promise<void>;
    lock(reason: "manual" | "idle" | "hidden"): Promise<void>;
    retryLock(): Promise<void>;
    discardPendingAndLock(): Promise<void>;
    // Destructive: callers must obtain explicit final confirmation before invoking.
    // Clears only this database's vault stores; no passphrase or provider key is needed.
    reset(): Promise<void>;
    changePassphrase(current: string, next: string, confirmation: string): Promise<void>;
    saveProviderKey(providerId: string, key: string, persistence?: "encrypted" | "session"): Promise<void>;
    getProviderKey(providerId: string): Promise<string | null>;
    clearProviderKey(providerId: string): Promise<void>;
    loadModelRegistrations(job: JobContext): Promise<ModelRegistrations>;
    saveModelRegistrations(value: ModelRegistrations, job: JobContext): Promise<void>;
    saveRegisteredModel(model: ModelRegistration, keyUpdate: RegistrationKeyUpdate, job: JobContext): Promise<ModelRegistrations>;
    saveApiCredential(meta:ApiCredential,keyUpdate:RegistrationKeyUpdate,job:JobContext):Promise<ModelRegistrations>;
    deleteApiCredential(id:string,job:JobContext):Promise<ModelRegistrations>;
    saveRegistrationKey(id:string, key:string, persistence:'encrypted'|'session', job:JobContext):Promise<ModelRegistrations>;
    saveRegistrationTest(id:string, result:RegistrationTestResult, job:JobContext):Promise<ModelRegistrations>;
    loadModelRegistry(job: JobContext): Promise<ModelRegistry | null>;
    saveModelRegistry(registry: ModelRegistry, job: JobContext): Promise<void>;
    loadSelectionLists(job: JobContext): Promise<SelectionLists>;
    saveSelectionLists(value: SelectionLists, job: JobContext): Promise<void>;
    loadScreenState(job: JobContext): Promise<ScreenState | null>;
    saveScreenState(value: ScreenState, job: JobContext): Promise<void>;
    verifyScreenPassphrase(secret: string): Promise<void>;
    streamSource(recordId: string, job: JobContext): AsyncIterable<Uint8Array<ArrayBuffer>>;
    openRetainedSource(sourceId: string, job: JobContext): Promise<SourceReader>;
    createSourceWriter(projectId: string, sourceId: string, config: WavCaptureConfig, job: JobContext): Promise<SourceWriter>;
    listSourceDrafts(projectId: string, job: JobContext): Promise<readonly SourceDraft[]>;
    readonly storageBusy: boolean;
    getStorageInventory(job: JobContext): Promise<StorageInventory>;
    getAudioAvailability(projectId: string, job: JobContext): Promise<RetainedAudio>;
    planPreparationReset(projectId: string, audioOptions: AudioOptions, job: JobContext): Promise<PreparationResetPlan>;
    resetPreparation(plan: PreparationResetPlan, token: string, job: JobContext): Promise<MeetingProject>;
    planDeletion(scope: DeletionPlan["scope"], projectId: string | null, job: JobContext): Promise<DeletionPlan>;
    executeDeletion(plan: DeletionPlan, confirmation: DeletionConfirmation, job: JobContext): Promise<void>;
    configureLock(options: VaultLockOptions): void;
    noteActivity(): void;
    requestOwnerLock(): void;
    dispose(): Promise<void>;
}
function nativeOwnership(): Ownership {
    return { async acquire(name) {
            if (!globalThis.isSecureContext || !globalThis.navigator?.locks)
                throw new Error("Secure Web Locks coordination support is required");
            return new Promise((resolve, reject) => {
                const request: Promise<unknown> = navigator.locks.request(name, { mode: "exclusive", ifAvailable: true }, async (lock) => {
                    if (!lock) {
                        resolve(null);
                        return;
                    }
                    await new Promise<void>(released => { let live = true; resolve(async () => { if (live) {
                        live = false;
                        released();
                    } await request; }); }); // Reopening must wait for the browser's actual lock release.
                });
                void request.catch(() => reject(new Error("Unable to acquire vault ownership")));
            });
        } };
}
export function createVaultSession(options: VaultSessionOptions = {}): VaultSession {
    if (options.testOnlyOwnership && import.meta.env.MODE !== "test")
        throw new Error("Test ownership is unavailable");
    const ownership = options.testOnlyOwnership ?? nativeOwnership();
    const name = options.databaseName ?? "mom-encrypted-vault-v1";
    const factory = options.indexedDB ?? globalThis.indexedDB;
    let state: VaultState = "locked";
    let coordinator: VaultCoordinator | null = null;
    let releaseOwnership: ReleaseOwnership | null = null;
    let releaseDatabaseOwnership: ReleaseOwnership | null = null;
    let vaultId: string | null = null;
    let pending: readonly CheckpointWrite[] = [];
    const sessionKeys = new Map<string, string>();
    let registrationTail: Promise<unknown> = Promise.resolve();
    const serializeRegistrations = <T>(operation:()=>Promise<T>):Promise<T> => {
        const result = registrationTail.then(operation); registrationTail = result.then(()=>{},()=>{}); return result;
    };
    let lockPromise: Promise<void> | null = null;
    let resetPromise: Promise<void> | null = null;
    let activationPromise: Promise<void> | null = null;
    let resetBoundaryFailed = false;
    let boundaryNeedsRetry = false;
    let captureNeedsRetry = false;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    let disposeRequested = false;
    let storageBusy = false;
    let passphraseRevision = 0, passphraseChanges = 0;
    let idleMs = options.idleMs ?? 15 * 60_000;
    let lockOnHide = options.screenLockManaged !== true;
    let pageIsHidden = false;
    const channel = typeof window !== "undefined" && typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("mom-vault-events-v1") : null;
    const update = (next: VaultState) => { state = next; options.onState?.(next); };
    const assertUnlocked = () => { if (state !== "unlocked" || !releaseOwnership || !coordinator || disposed || storageBusy)
        throw new Error("Vault is not unlocked by this owner"); };
    const assertPrivate = () => { if (!releaseOwnership || !coordinator || !(storageBusy && state === "unlocked" || state === "unlocking" || state === "locking" || state === "lock-save-failed"))
        throw new Error("Vault finalization ownership is unavailable"); };
    const stopTimer = () => { if (idleTimer !== null)
        clearTimeout(idleTimer); idleTimer = null; };
    const broadcast = (event: "lock-request" | "locked") => { if (vaultId)
        channel?.postMessage({ vaultId, event, epoch: createJobContext().epoch, nonce: randomId() }); };
    const releaseLocks = async () => {
        const ownershipRelease = releaseOwnership, databaseRelease = releaseDatabaseOwnership;
        releaseOwnership = null; releaseDatabaseOwnership = null;
        try { await ownershipRelease?.(); }
        finally { await databaseRelease?.(); }
    };
    const release = async (committedReset = false) => {
        stopTimer();
        sessionKeys.clear();
        pending = [];
        boundaryNeedsRetry = false;
        captureNeedsRetry = false;
        coordinator?.release();
        coordinator = null;
        await releaseLocks();
        // An observer exception cannot reclassify an already committed reset as
        // failed/cancelled. The storage outcome has already become definitive.
        state = "locked";
        try { options.onState?.("locked"); } catch (error) { if (!committedReset) throw error; }
        try { broadcast("locked"); } catch (error) { if (!committedReset) throw error; }
        vaultId = null;
    };
    const finalize = async () => {
        try {
            if (!coordinator)
                throw new Error("Vault finalizer unavailable");
            await coordinator.finalize(pending);
            await release();
        }
        catch {
            update("lock-save-failed");
            throw new Error("Unable to save completed work before locking");
        }
    };
    const activate = async (secret: string, confirmation?: string) => {
        if (state !== "locked" || disposed || disposeRequested || resetPromise)
            throw new Error("Vault cannot be unlocked in its current state");
        validatePassphrase(secret);
        if (confirmation !== undefined && confirmation !== secret)
            throw new Error("Passphrase confirmation does not match");
        if (!factory)
            throw new Error("Encrypted browser storage support is required");
        if (pageIsHidden || (lockOnHide && typeof document !== "undefined" && document.visibilityState === "hidden"))
            throw new Error("Vault opening was interrupted");
        update("unlocking");
        let db: IDBDatabase | null = null;
        try {
            // This database-name lock is held for the entire active session.
            // Acquire before reading any header so reset cannot invalidate a
            // cached header while this opening is waiting for vault ownership.
            releaseDatabaseOwnership = await ownership.acquire(`mom:vault-create:${name}`);
            if (!releaseDatabaseOwnership)
                throw new Error("Another vault owner is active");
            const openingGuard = () => { if (state !== "unlocking" || !releaseDatabaseOwnership || disposed || disposeRequested || pageIsHidden || (lockOnHide && typeof document !== "undefined" && document.visibilityState === "hidden"))
                throw new Error("Vault opening was interrupted"); };
            openingGuard();
            db = await openVaultDatabase(factory, name);
            openingGuard();
            let header = await readHeader(db, openingGuard);
            if (confirmation !== undefined) {
                if (header)
                    throw new Error("A vault already exists; unlock it instead");
                vaultId = randomId();
            }
            else {
                if (!header)
                    throw new Error("Create a vault before unlocking");
                vaultId = header.vaultId;
            }
            releaseOwnership = await ownership.acquire(`mom:vault:${vaultId}`);
            if (!releaseOwnership)
                throw new Error("Another vault owner is active");
            openingGuard();
            let key: CryptoKey;
            if (confirmation !== undefined) {
                const created = await createHeader(secret, vaultId!);
                openingGuard();
                header = created.header;
                key = created.key;
                header = await writeInitialHeader(db, header, key, openingGuard);
                openingGuard();
            }
            else {
                key = await unwrapHeader(secret, header!);
                openingGuard();
            }
            coordinator = new VaultCoordinator(db, header!, key, assertUnlocked, assertPrivate);
            await coordinator.recover();
            openingGuard();
            cancelJobs();
            update("unlocked");
            session.noteActivity();
        }
        catch (error) {
            coordinator?.release();
            coordinator = null;
            db?.close();
            sessionKeys.clear();
            pending = [];
            await releaseLocks();
            vaultId = null;
            update("locked");
            throw error;
        }
    };
    const beginActivation = (secret: string, confirmation?: string) => {
        if (activationPromise) return Promise.reject(new Error("Vault opening is already in progress"));
        const operation = activate(secret, confirmation);
        activationPromise = operation;
        void operation.then(() => { if (activationPromise === operation) activationPromise = null; }, () => { if (activationPromise === operation) activationPromise = null; });
        return operation;
    };
    const session: VaultSession = {
        get state() { return state; },
        get storageBusy() { return storageBusy; },
        get store() { assertUnlocked(); return coordinator!.publicStore; },
        create: (secret, confirmation) => beginActivation(secret, confirmation),
        unlock: secret => beginActivation(secret),
        lock(reason) {
            void reason;
            if (resetPromise)
                return Promise.reject(new Error("Vault reset is in progress"));
            if (state === "locked")
                return Promise.resolve();
            if (state === "locking")
                return lockPromise ?? Promise.reject(new Error("Vault lock is in progress"));
            if (state !== "unlocked")
                return Promise.reject(new Error("Vault cannot lock in its current state"));
            // No await until public work is fenced, newest completed work captured and UI gone.
            state = "locking";
            stopTimer();
            let boundaryFailed = false;
            const captured = new Map(coordinator!.capturePending().map(write => [write.project.id, write]));
            try {
                for (const write of options.capturePending?.() ?? [])
                    captured.set(write.project.id, Object.freeze({ project: snapshotProject(write.project), runId: write.runId, audioRecords: Object.freeze(write.audioRecords.map(record => Object.freeze({ ...record }))) }));
            }
            catch {
                captureNeedsRetry = true;
                boundaryFailed = true;
            }
            pending = [...captured.values()];
            cancelJobs();
            sessionKeys.clear();
            try {
                options.onState?.("locking");
            }
            catch {
                boundaryFailed = true;
            }
            try {
                options.onSensitiveClear?.();
            }
            catch {
                boundaryFailed = true;
            }
            try {
                options.teardown?.();
            }
            catch {
                boundaryFailed = true;
            }
            boundaryNeedsRetry = boundaryFailed;
            lockPromise = (async () => { if (boundaryFailed) {
                await coordinator!.drain();
                update("lock-save-failed");
                throw new Error("Unable to complete vault lock boundary");
            } await finalize(); })().finally(() => { lockPromise = null; });
            return lockPromise;
        },
        retryLock() {
            if (resetBoundaryFailed)
                return Promise.reject(new Error("Reset boundary requires explicit reset retry"));
            if (state !== "lock-save-failed")
                return Promise.reject(new Error("No failed lock to retry"));
            state = "locking";
            if (boundaryNeedsRetry) {
                let failed = false;
                const captured = new Map(pending.map(write => [write.project.id, write]));
                // Retry capture only if it failed. A successful pre-teardown
                // snapshot must survive UI-reference mutation during resource cleanup.
                if (captureNeedsRetry) {
                    try {
                        for (const write of options.capturePending?.() ?? []) {
                            // Recovered application snapshots supersede older
                            // coordinator fallback work for the same project.
                            captured.set(write.project.id, Object.freeze({ project: snapshotProject(write.project), runId: write.runId, audioRecords: Object.freeze(write.audioRecords.map(record => Object.freeze({ ...record }))) }));
                        }
                        captureNeedsRetry = false;
                    }
                    catch {
                        failed = true;
                    }
                }
                pending = [...captured.values()];
                try {
                    options.onState?.("locking");
                }
                catch {
                    failed = true;
                }
                try {
                    options.onSensitiveClear?.();
                }
                catch {
                    failed = true;
                }
                try {
                    options.teardown?.();
                }
                catch {
                    failed = true;
                }
                boundaryNeedsRetry = failed;
                if (failed) {
                    update("lock-save-failed");
                    return Promise.reject(new Error("Unable to complete vault lock boundary"));
                }
            }
            else
                options.onState?.("locking");
            lockPromise = finalize().finally(() => { lockPromise = null; });
            return lockPromise;
        },
        async discardPendingAndLock() {
            if (resetBoundaryFailed)
                throw new Error("Reset boundary requires explicit reset retry");
            if (state !== "lock-save-failed")
                throw new Error("Explicit discard is only available after a failed lock");
            // The UI must call this only from the user's separate destructive discard action.
            if (boundaryNeedsRetry) {
                let failed = false;
                try { options.onSensitiveClear?.(); } catch { failed = true; }
                try { options.teardown?.(); } catch { failed = true; }
                if (failed) throw new Error("Unable to complete vault lock boundary");
                boundaryNeedsRetry = false;
            }
            await coordinator!.drain();
            await release();
        },
        reset() {
            if (resetPromise) return resetPromise;
            if (disposed || disposeRequested || !["locked", "unlocked", "lock-save-failed"].includes(state))
                return Promise.reject(new Error("Vault cannot reset in its current state"));
            if (!factory) return Promise.reject(new Error("Encrypted browser storage support is required"));
            state = "locking";
            stopTimer();
            pending = [];
            captureNeedsRetry = false;
            resetBoundaryFailed = false;
            let complete!: () => void, fail!: (error: unknown) => void;
            const operation = new Promise<void>((resolve, reject) => { complete = resolve; fail = reject; });
            resetPromise = operation;
            const boundary = () => {
                cancelJobs();
                sessionKeys.clear();
                let failed = false;
                try { options.onState?.("locking"); } catch { failed = true; }
                try { options.onSensitiveClear?.(); } catch { failed = true; }
                try { options.teardown?.(); } catch { failed = true; }
                return failed;
            };
            const run = async () => {
                let db: IDBDatabase | null = null;
                let failedBoundary = false;
                // An owned session is fenced/cleared synchronously before any
                // await. A locked non-owner must first acquire ownership; its
                // failed attempt must not cancel another owner's active jobs.
                const owned = !!releaseDatabaseOwnership;
                if (owned) failedBoundary = boundary();
                const drainBoundary = async () => {
                    await coordinator?.drain();
                    if (failedBoundary) {
                        resetBoundaryFailed = true;
                        boundaryNeedsRetry = true;
                        state = "lock-save-failed";
                        try { options.onState?.(state); } catch { /* Boundary remains failed. */ }
                        throw new Error("Unable to complete vault reset boundary; retry reset explicitly");
                    }
                };
                try {
                    if (owned) await drainBoundary();
                    if (!releaseDatabaseOwnership) {
                        releaseDatabaseOwnership = await ownership.acquire(`mom:vault-create:${name}`);
                        if (!releaseDatabaseOwnership) throw new Error("Another vault owner is active");
                    }
                    const guard = () => { if (state !== "locking" || !releaseDatabaseOwnership || disposed) throw new Error("Vault reset ownership is unavailable"); };
                    guard();
                    db = await openVaultDatabase(factory, name);
                    guard();
                    if (!releaseOwnership) {
                        const ownerId = await readResetOwnerId(db, guard);
                        if (ownerId) {
                            vaultId = ownerId;
                            releaseOwnership = await ownership.acquire(`mom:vault:${vaultId}`);
                            if (!releaseOwnership) throw new Error("Another vault owner is active");
                        }
                    }
                    if (!owned) failedBoundary = boundary();
                    if (!owned) await drainBoundary();
                    coordinator?.release();
                    coordinator = null;
                    guard();
                    await clearVaultDatabase(db, guard);
                    resetBoundaryFailed = false;
                    await release(true);
                }
                catch (error) {
                    if (!resetBoundaryFailed) {
                        await coordinator?.drain();
                        await release(true);
                    }
                    throw error;
                }
                finally { db?.close(); }
            };
            void run().then(() => { resetPromise = null; complete(); }, error => { resetPromise = null; fail(error); });
            return operation;
        },
        async changePassphrase(current, next, confirmation) { assertUnlocked(); validatePassphrase(next); if (next !== confirmation)
            throw new Error("Passphrase confirmation does not match");
            passphraseRevision++; passphraseChanges++;
            try { await coordinator!.changePassphrase(current, next, createJobContext()); assertUnlocked(); }
            finally { passphraseRevision++; passphraseChanges--; }
        },
        async verifyScreenPassphrase(secret) {
            assertUnlocked();
            const owner = coordinator!, ownership = releaseOwnership, revision = passphraseRevision, job = createJobContext();
            const guard = () => { assertUnlocked(); job.assertActive(); if (coordinator !== owner || releaseOwnership !== ownership || revision !== passphraseRevision || passphraseChanges) throw new Error('Screen verification no longer current'); };
            try { guard(); await owner.verifyPassphrase(secret, job); guard(); }
            finally { secret = ''; }
        },
        async saveProviderKey(providerId, key, persistence = "encrypted") {
            assertUnlocked();
            if (!providerId || !key)
                throw new Error("A provider and key are required");
            const job = createJobContext();
            await coordinator!.saveProviderKey(providerId, persistence === "session" ? null : key, job);
            assertUnlocked();
            job.assertActive();
            if (persistence === "session")
                sessionKeys.set(providerId, key);
            else
                sessionKeys.delete(providerId);
        },
        async getProviderKey(providerId) {
            assertUnlocked();const job=createJobContext();
            if(providerId.startsWith('registration:')){
                const registrations=await session.loadModelRegistrations(job),entry=registrations.entries.find(model=>providerId==='registration:'+model.id);
                if(!entry?.credentialId||entry.auth!=='bearer')return null;
                const credential=registrations.credentials?.find(c=>c.id===entry.credentialId);
                if(!credential||credential.origin!==new URL(registrationEndpoint(entry)).origin)return null;
                providerId='credential:'+credential.id;
            }
            if(sessionKeys.has(providerId))return sessionKeys.get(providerId)!;
            const value=await coordinator!.getProviderKey(providerId,job);assertUnlocked();job.assertActive();return value;
        },
        async clearProviderKey(providerId) { assertUnlocked(); sessionKeys.delete(providerId); await coordinator!.saveProviderKey(providerId, null, createJobContext()); assertUnlocked(); },
        loadModelRegistrations(job) { return serializeRegistrations(async () => {
            assertUnlocked(); job.assertActive(); const owner = coordinator!;
            const result = await owner.loadModelRegistrationState(job,new Set(sessionKeys.keys()));
            assertUnlocked(); job.assertActive(); if (coordinator !== owner) throw new Error('Vault owner changed');
            for (const transfer of result.sessionTransfers) {
                const key = sessionKeys.get(transfer.sourceNamespace);
                if (key !== undefined) sessionKeys.set(transfer.targetNamespace,key);
            }
            for(const namespace of sessionKeys.keys())if(namespace.startsWith('registration:'))sessionKeys.delete(namespace);
            owner.acknowledgeModelRegistrationTransfers();
            return result.registrations;
        }); },
        async saveModelRegistrations(value, job) {
            assertUnlocked(); job.assertActive(); const command = structuredClone(value);
            return serializeRegistrations(async () => {
                assertUnlocked(); job.assertActive(); const owner = coordinator!;
                await owner.saveModelRegistrations(command,job);
                assertUnlocked(); job.assertActive(); if (coordinator !== owner) throw new Error('Vault owner changed');
                const current = await owner.loadModelRegistrations(job); assertUnlocked(); job.assertActive();
                for (const namespace of sessionKeys.keys()) if (namespace.startsWith('credential:') && !current.credentials?.some(c=>namespace==='credential:'+c.id && c.keyStorage==='session')) sessionKeys.delete(namespace);
            });
        },
        async saveRegisteredModel(model,keyUpdate,job) {
            assertUnlocked(); job.assertActive(); const snapshot = validateRegistration(model), command = {...keyUpdate};
            return serializeRegistrations(async () => {
                assertUnlocked(); job.assertActive(); const owner = coordinator!;
                const result = await owner.saveRegisteredModel(snapshot,command,job,sessionKeys);
                assertUnlocked(); job.assertActive(); if (coordinator !== owner) throw new Error('Vault owner changed');
                for(const change of result.sessionChanges)if(change.value===null)sessionKeys.delete(change.namespace);else sessionKeys.set(change.namespace,change.value);
                return result.registrations;
            });
        },
        async saveApiCredential(meta,keyUpdate,job){
            assertUnlocked();job.assertActive();const snapshot=validateApiCredential(meta),command={...keyUpdate};
            return serializeRegistrations(async()=>{
                assertUnlocked();job.assertActive();const owner=coordinator!,result=await owner.saveApiCredential(snapshot,command,job,sessionKeys);
                assertUnlocked();job.assertActive();if(coordinator!==owner)throw Error('Vault owner changed');
                for(const change of result.sessionChanges)if(change.value===null)sessionKeys.delete(change.namespace);else sessionKeys.set(change.namespace,change.value);
                return result.registrations;
            });
        },
        async deleteApiCredential(id,job){
            assertUnlocked();job.assertActive();
            return serializeRegistrations(async()=>{
                assertUnlocked();job.assertActive();const owner=coordinator!,result=await owner.deleteApiCredential(id,job);
                assertUnlocked();job.assertActive();if(coordinator!==owner)throw Error('Vault owner changed');
                for(const change of result.sessionChanges)sessionKeys.delete(change.namespace);
                return result.registrations;
            });
        },
        async saveRegistrationKey(id,key,persistence,job) {
            const current = await session.loadModelRegistrations(job), model = current.entries.find(entry=>entry.id === id);
            if (!model || model.auth !== 'bearer') throw new Error('Save a Bearer registration before its key');
            return session.saveRegisteredModel({...model,keyStorage:persistence},{action:'replace',value:key},job);
        },
        async saveRegistrationTest(id, result, job) { assertUnlocked(); return coordinator!.saveRegistrationTest(id, result, job); },
        async loadModelRegistry(job) { assertUnlocked(); return coordinator!.loadModelRegistry(job); },
        async saveModelRegistry(registry, job) { assertUnlocked(); await coordinator!.saveModelRegistry(registry, job); },
        async loadSelectionLists(job) { assertUnlocked(); return coordinator!.loadSelectionLists(job); },
        async saveSelectionLists(value, job) { assertUnlocked(); await coordinator!.saveSelectionLists(value, job); },
        async loadScreenState(job) { assertUnlocked(); return coordinator!.loadScreenState(job); },
        async saveScreenState(value, job) { assertUnlocked(); await coordinator!.saveScreenState(value, job); },
        streamSource(recordId, job) { assertUnlocked(); return coordinator!.streamSource(recordId, job); },
        async openRetainedSource(sourceId, job) { assertUnlocked(); return coordinator!.openRetainedSource(sourceId, job); },
        async createSourceWriter(projectId, sourceId, config, job) { assertUnlocked(); return coordinator!.createSourceWriter(projectId, sourceId, config, job); },
        async listSourceDrafts(projectId, job) { assertUnlocked(); return coordinator!.listSourceDrafts(projectId, job); },
        async getStorageInventory(job) {
            assertUnlocked(); const owner = coordinator!, inventory = await owner.getStorageInventory(job), estimate = await originStorageEstimate();
            assertUnlocked(); job.assertActive(); return Object.freeze({ ...inventory, ...estimate });
        },
        async getAudioAvailability(projectId, job) { assertUnlocked(); return coordinator!.getAudioAvailability(projectId, job); },
        async planPreparationReset(projectId, audioOptions, job) { assertUnlocked(); return coordinator!.planPreparationReset(projectId, audioOptions, job); },
        async resetPreparation(plan, token, job) {
            assertUnlocked(); const owner = coordinator!, accepted = owner.acceptPreparationReset(plan, token, job);
            storageBusy = true;
            const guard = () => { if (!storageBusy || state !== "unlocked" || coordinator !== owner || !releaseOwnership || disposed) throw new Error("Preparation reset owner no longer active"); job.assertActive(); };
            try { return await owner.executePreparationReset(accepted.plan, accepted.revision, guard); }
            finally { storageBusy = false; }
        },
        async planDeletion(scope, projectId, job) { assertUnlocked(); return coordinator!.planDeletion(scope, projectId, job); },
        async executeDeletion(plan, confirmation, job) {
            assertUnlocked(); const owner = coordinator!, accepted = owner.acceptDeletion(plan, confirmation, job);
            // Consume confirmation before touching lifecycle/data. Capture completed
            // work before teardown; cancellation cannot silently discard those edits.
            const captured = new Map(owner.capturePending().map(write => [write.project.id, write]));
            for (const write of options.capturePending?.() ?? []) captured.set(write.project.id, Object.freeze({ project: snapshotProject(write.project), runId: write.runId, audioRecords: Object.freeze(write.audioRecords.map(record => Object.freeze({ ...record }))) }));
            const preserved = owner.retainDeletionPending([...captured.values()]);
            storageBusy = true; cancelJobs(); const cleanupJob = createJobContext();
            const guard = () => { if (!storageBusy || state !== "unlocked" || coordinator !== owner || !releaseOwnership || disposed) throw new Error("Storage cleanup owner no longer active"); cleanupJob.assertActive(); };
            try {
                options.teardown?.();
                await owner.flushDeletionPending(preserved, guard);
                await owner.executeAcceptedDeletion(accepted.plan, accepted.revision, guard, cleanupJob);
                guard();
                if (accepted.plan.scope === "vault") await session.reset();
            } finally { storageBusy = false; }
        },
        configureLock(preferences) {
            assertUnlocked();
            if (![5, 15, 30].includes(preferences.idleMinutes) || typeof preferences.lockOnHide !== "boolean")
                throw new Error("Unsupported lock preferences");
            idleMs = preferences.idleMinutes * 60_000;
            lockOnHide = !options.screenLockManaged && preferences.lockOnHide;
            session.noteActivity();
            if (lockOnHide && typeof document !== "undefined" && document.visibilityState === "hidden")
                void session.lock("hidden").catch(() => { });
        },
        noteActivity() {
            stopTimer();
            if (state !== "unlocked" || options.screenLockManaged)
                return;
            if (!Number.isFinite(idleMs) || idleMs <= 0)
                throw new Error("Invalid idle duration");
            idleTimer = setTimeout(() => { void session.lock("idle").catch(() => { }); }, idleMs);
        },
        requestOwnerLock() { broadcast("lock-request"); },
        async dispose() {
            try {
                // Reset is not cancellation: await its definitive durable outcome.
                // Opening may be interrupted before any new header is promoted.
                if (resetPromise || activationPromise) {
                    disposeRequested = true;
                    if (resetPromise) await resetPromise.catch(() => { });
                    if (activationPromise) await activationPromise.catch(() => { });
                }
                if (state === "unlocked")
                    await session.lock("manual");
                else if (state === "locking")
                    await lockPromise;
                if (state !== "locked")
                    throw new Error("Unsaved completed work requires retry or explicit discard");
                disposed = true;
                stopTimer();
                channel?.close();
                if (typeof document !== "undefined")
                    document.removeEventListener("visibilitychange", hidden);
                if (typeof window !== "undefined") {
                    window.removeEventListener("pagehide", pagehide);
                    window.removeEventListener("pageshow", pageshow);
                }
            }
            finally { if (!disposed) disposeRequested = false; }
        },
    };
    const hidden = () => { if (lockOnHide && document.visibilityState === "hidden" && state === "unlocked")
        void session.lock("hidden").catch(() => { }); };
    // Page departure remains an unconditional best-effort lock boundary. A
    // browser freeze/termination can still prevent asynchronous save completion.
    const pagehide = () => {
        pageIsHidden = true;
        if (state === "unlocked") void session.lock("hidden").catch(() => { });
    };
    const pageshow = () => { pageIsHidden = false; };
    if (typeof document !== "undefined")
        document.addEventListener("visibilitychange", hidden);
    if (typeof window !== "undefined") {
        window.addEventListener("pagehide", pagehide);
        window.addEventListener("pageshow", pageshow);
    }
    if (channel)
        channel.onmessage = event => {
            const message = event.data as {
                vaultId?: unknown;
                event?: unknown;
                epoch?: unknown;
                nonce?: unknown;
            };
            if (message && message.vaultId === vaultId && message.event === "lock-request" && Number.isSafeInteger(message.epoch) && typeof message.nonce === "string" && state === "unlocked")
                void session.lock("manual").catch(() => { });
        };
    return Object.freeze(session);
}
