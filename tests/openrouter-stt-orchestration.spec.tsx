import { afterEach, describe, expect, it, vi } from 'vitest';
import { cancelJobs, createJobContext } from '../src/react-app/domain/jobs';
import type { MeetingProject } from '../src/react-app/domain/types';
import { createSTTBatch, replaceSTTBatch, sttActionToken, validateSTTBatch } from '../src/react-app/transcript/batches';
import * as registryModule from '../src/react-app/providers/model-registry';
import { normalizeModelRegistry, emptyModelRegistry, registryRouteKey, setRegistryEnabled, setRegistryDefault } from '../src/react-app/providers/model-registry';
import { IDBFactory } from 'fake-indexeddb';
import { createVaultSession, type VaultSession, type VaultSessionOptions } from '../src/react-app/vault/session';
import { createMeetingController, type MeetingController } from '../src/react-app/controller';
import { addRegistryObservation } from '../src/react-app/providers/registry-consumer';
import { createOpenRouterSTTProvider } from '../src/react-app/providers/openrouter-stt';
import { ProviderError, runTranscriptionQueue } from '../src/react-app/domain/pipeline';
import type { DiscoveredSTTModel } from '../src/react-app/providers/discovery';
import type { STTBatch, VaultStore, CheckpointResult, RouterSTTPreference } from '../src/react-app/domain/types';
const date = '2026-10-03T00:00:00.000Z';
const route = {
    connectionId: 'openrouter', provider: 'openrouter', stage: 'stt', modelId: 'openai/gpt-4o-mini-transcribe', endpointTag: null
} as const;
function project(): MeetingProject {
    return {
        id: 'fixture', title: 'SYNTHETIC', icon: 'mic', color: 'blue', pinned: false, createdAt: date, updatedAt: date, sourceAssets: [{
                id: 'source', fileName: 'SYNTHETIC.mp3', bytes: 3, container: 'mp3', codec: 'mp3', durationMs: 1000, channels: 1, sampleRateHz: 16000
            }], audioOptions: {
            chunkMinutes: 10, overlapSeconds: 10, expectedLanguages: ['en'], bitrateKbps: 32, sampleRateHz: 16000
        }, preparedChunks: [{
                id: 'chunk', sourceId: 'source', index: 0, sourceStartMs: 0, sourceEndMs: 1000, encodingOffsetMs: 0, encodedBytes: 3, mimeType: 'audio/mpeg', codec: 'mp3', audioRecordId: 'audio'
            }], rawTranscripts: [], transcriptVersions: [], selectedTranscriptVersionId: null, minutesSettings: {
            outputLanguage: 'en', sections: ['summary'], instructions: '', modelId: ''
        }, minutesRuns: [], minutesRevisions: [], selectedMinutesRevisionId: null, runs: []
    };
}
afterEach(cancelJobs);
describe('OR_STT_only', () => {
    it('accepts an exact OpenRouter batch with a matching frozen snapshot', async () => {
        const p = project(), selection = await frozen(p);
        expect(() => createSTTBatch(p, {
            purpose: 'initial', chunkIds: ['chunk'], modelId: route.modelId, languages: ['en'], route, routerSelection: selection
        } as Parameters<typeof createSTTBatch>[1])).not.toThrow();
    });
    it('retains legacy OpenAI batches without a router snapshot', () => {
        const p = project();
        expect(() => createSTTBatch(p, {
            purpose: 'initial', chunkIds: ['chunk'], modelId: 'gpt-transcribe', languages: ['en'], route: {
                ...route, connectionId: 'openai', provider: 'openai', modelId: 'gpt-transcribe'
            }
        })).not.toThrow();
    });
});
describe('OR_STT_registry', () => {
    it('accepts exact encrypted policy preferences without changing defaults', () => {
        const r = {
            version: 1 as const, entries: [], defaults: { stt: null, minutes: null }, lastCheckedAt: null, openRouterSTT: { openrouter: {
                    policy: { dataCollection: 'deny' as const, requireZdr: true }, acknowledgedDisclosureVersion: 'or-stt-1' as const, initialDefaultApplied: false
                } }
        };
        expect(() => normalizeModelRegistry(r)).not.toThrow();
    });
    it('old optional-field absence grants no acknowledgment', () => {
        expect(normalizeModelRegistry({
            version: 1, entries: [], defaults: { stt: null, minutes: null }, lastCheckedAt: null
        }).openRouterSTT).toBeUndefined();
    });
});
async function selectionModule() {
    return import('../src/react-app/providers/stt-selection');
}
const model = (pricing: unknown = { prompt: '0.000001', completion: '0.000002' }): DiscoveredSTTModel => ({
    id: route.modelId, name: 'SYNTHETIC_MINI', inputModalities: ['audio'], outputModalities: ['transcription'], source: 'https://openrouter.ai/api/v1/models?output_modalities=transcription', checkedAt: date, adapterStatus: 'unsupported', pricing: { status: 'unknown', raw: pricing }
});
const preference: RouterSTTPreference = {
    policy: { dataCollection: 'deny', requireZdr: true }, acknowledgedDisclosureVersion: 'or-stt-1', initialDefaultApplied: false
};
const cores: MeetingController[] = [], sessions: VaultSession[] = [];
afterEach(async () => {
    for (const core of cores.splice(0))
        await core.dispose();
    for (const session of sessions.splice(0))
        await session.dispose();
    vi.restoreAllMocks();
});
function receipt(p: MeetingProject, runId: string | null): CheckpointResult {
    const checkpoint = {
        id: crypto.randomUUID(), projectId: p.id, runId, recordIds: [p.id], committedAt: date
    };
    return { checkpoint, project: { ...p, runs: p.runs.map(run => run.id === runId ? {
                ...run, state: 'saved', checkpoint
            } : run) } };
}
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => {
        resolve = done;
    });
    return { promise, resolve };
}
async function frozen(p = project(), observed = model()) {
    return (await selectionModule()).freezeRouterSTTSelection(p, p.preparedChunks.map(c => c.id), route, observed, preference.policy);
}
async function routerBatch(p = project(), observed = model()): Promise<STTBatch> {
    return createSTTBatch(p, {
        purpose: 'initial', chunkIds: p.preparedChunks.map(c => c.id), modelId: route.modelId, languages: ['en'], route, routerSelection: await frozen(p, observed)
    }, { createdAt: date });
}
async function queueFixture(count = 2, checkpoint?: VaultStore['checkpoint'], knownRates = false) {
    const p = project();
    const two = {
        ...p, sourceAssets: [{ ...p.sourceAssets[0], durationMs: count * 1000 }], preparedChunks: Array.from({ length: count }, (_, index) => ({
            ...p.preparedChunks[0], id: `chunk-${index}`, index, sourceStartMs: index * 1000, sourceEndMs: (index + 1) * 1000, audioRecordId: `audio-${index}`
        }))
    };
    const batch = await routerBatch(two, knownRates ? model() : model(null));
    const bodies: unknown[] = [];
    const vault: VaultStore = {
        listProjects: async () => [], readProject: async () => null, readAudio: async () => new Blob(['abc'], { type: 'audio/mpeg' }), deleteProject: async () => {
        }, checkpoint: checkpoint ?? (async ({ project, runId }) => receipt(project, runId))
    };
    const provider = createOpenRouterSTTProvider({
        selection: batch.routerSelection!, getKey: () => 'SYNTHETIC_ROUTER_ONLY', fetch: async (_url, init) => {
            bodies.push(JSON.parse(String(init?.body)));
            return new Response(JSON.stringify({ text: 'SYNTHETIC_SPEECH', usage: { cost: 0.01 } }));
        }
    });
    return {
        project: replaceSTTBatch(two, batch), batch, bodies, vault, provider, modelId: route.modelId, chunkIds: batch.chunkIds, languages: batch.languages, rateSnapshot: batch.routerSelection!.rateSnapshot, job: createJobContext()
    };
}
async function coreFixture(options: {
    preference?: RouterSTTPreference | null;
    seedProject?: boolean;
    respond?: (url: string, init?: RequestInit) => Promise<Response | null>;
    intercept?: (write: Parameters<VaultStore['checkpoint']>[0]) => Promise<void>;
    registryFailure?: () => boolean;
    clearDefault?: boolean;
    candidates?: readonly DiscoveredSTTModel[];
    twoChunks?: boolean;
} = {}) {
    const indexedDB = new IDBFactory(), databaseName = crypto.randomUUID(), secret = 'synthetic orchestration vault phrase';
    const shared = {
        indexedDB, databaseName, testOnlyOwnership: { acquire: async () => () => {
            } }
    };
    const seed = createVaultSession(shared);
    sessions.push(seed);
    await seed.create(secret, secret);
    let registry = emptyModelRegistry();
    for (const candidate of options.candidates ?? [model()]) {
        const candidateRoute = { ...route, modelId: candidate.id };
        registry = setRegistryEnabled(addRegistryObservation(registry, registryModule.observeRouterSTTRoute(candidateRoute, candidate)), registryRouteKey(candidateRoute), true);
    }
    if (!options.clearDefault)
        registry = setRegistryDefault(registry, 'stt', registryRouteKey(route));
    if (options.preference !== null)
        registry = { ...registry, openRouterSTT: { openrouter: options.preference ?? preference } };
    await seed.saveModelRegistry(registry, createJobContext());
    if (options.seedProject !== false) {
        const p = project();
        const prepared = options.twoChunks ? {
            ...p, sourceAssets: [{ ...p.sourceAssets[0], durationMs: 601000 }], preparedChunks: [{ ...p.preparedChunks[0], sourceEndMs: 600000 }, {
                    ...p.preparedChunks[0], id: 'chunk-1', index: 1, sourceStartMs: 590000, sourceEndMs: 601000, audioRecordId: 'audio-1'
                }]
        } : p;
        await seed.store.checkpoint({
            project: prepared, runId: null, audioRecords: [{ recordId: 'source', audio: new Blob(['abc'], { type: 'audio/mpeg' }) }, ...prepared.preparedChunks.map(chunk => ({ recordId: chunk.audioRecordId, audio: new Blob(['abc'], { type: 'audio/mpeg' }) }))]
        }, createJobContext());
    }
    await seed.saveProviderKey('openrouter', 'SYNTHETIC_ROUTER_ONLY', 'encrypted');
    await seed.dispose();
    const calls: string[] = [], keyReads: string[] = [];
    let session!: VaultSession;
    const core = createMeetingController({
        indexedDB, databaseName, fetch: async (url, init) => {
            calls.push(String(url));
            const custom = await options.respond?.(String(url), init);
            if (custom)
                return custom;
            if (String(url).endsWith('/audio/transcriptions')) {
                expect(String(url)).toBe('https://openrouter.ai/api/v1/audio/transcriptions');
                expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer SYNTHETIC_ROUTER_ONLY');
                return new Response(JSON.stringify({ text: 'SYNTHETIC_ROUTER_SPEECH', usage: { cost: 0.01 } }));
            }
            return new Response(JSON.stringify({ data: (options.candidates ?? [model()]).map(candidate => ({
                    id: candidate.id, name: candidate.name, architecture: { input_modalities: candidate.inputModalities, output_modalities: candidate.outputModalities }, pricing: candidate.pricing.raw
                })) }));
        },
        sessionFactory: (hooks: VaultSessionOptions) => {
            session = createVaultSession({ ...hooks, ...shared });
            return new Proxy(Object.create(session) as VaultSession, { get(target, key) {
                    if (key === 'getProviderKey')
                        return (provider: string) => {
                            keyReads.push(provider);
                            return target.getProviderKey(provider);
                        };
                    if (key === 'saveModelRegistry')
                        return async (...args: Parameters<VaultSession['saveModelRegistry']>) => {
                            if (options.registryFailure?.())
                                throw new Error('SYNTHETIC_QUOTA');
                            return target.saveModelRegistry(...args);
                        };
                    if (key === 'store' && options.intercept)
                        return { ...target.store, checkpoint: async (write: Parameters<VaultStore['checkpoint']>[0], job: Parameters<VaultStore['checkpoint']>[1]) => {
                                await options.intercept!(write);
                                return target.store.checkpoint(write, job);
                            } };
                    return Reflect.get(target, key);
                } });
        }
    });
    cores.push(core);
    await core.initialize();
    await core.unlock(secret);
    await core.discoverModels('openrouter', 'stt');
    keyReads.length = 0;
    return {
        core, calls, keyReads, session: () => session, secret, indexedDB, databaseName
    };
}
function consent(core: MeetingController, purpose: STTBatch['purpose'] = 'initial', chunkIds = ['chunk'], batchId?: string) {
    const snapshot = core.getSnapshot(), p = snapshot.projects[0];
    return {
        modelId: route.modelId, acknowledged: true as const, consentToken: sttActionToken(snapshot.sttConsentToken, p, {
            purpose, chunkIds, modelId: route.modelId, ...(batchId ? { batchId } : {})
        }), ...(purpose !== 'initial' ? { additionalChargeAcknowledged: true } : {}), ...(batchId ? { batchId } : {})
    };
}
describe('OR_STT_only core dispatch', () => {
    it('an OR-only encrypted connection reaches the real OR adapter without requesting an OpenAI key', async () => {
        const { core, calls, keyReads } = await coreFixture();
        expect(core.getSnapshot().sttUnavailableReason).toBeUndefined();
        expect(core.getSnapshot().routerSTTSelection?.route).toEqual(route);
        await core.startSTT('fixture', consent(core));
        expect(calls.filter(url => url.endsWith('/audio/transcriptions'))).toEqual(['https://openrouter.ai/api/v1/audio/transcriptions']);
        expect(keyReads).toEqual(['openrouter']);
        const p = core.getSnapshot().projects[0];
        expect(p.rawTranscripts[0].response).toMatchObject({ text: 'SYNTHETIC_ROUTER_SPEECH' });
        expect(p.sttBatches![0].routerSelection!.policy).toEqual(preference.policy);
    });
    it('requires a fresh presend action token even for an initial OR call', async () => {
        const { core, calls } = await coreFixture();
        await expect(core.startSTT('fixture', { modelId: route.modelId, acknowledged: true })).rejects.toMatchObject({ code: 'invalid-input' });
        expect(calls.filter(url => url.endsWith('/audio/transcriptions'))).toHaveLength(0);
    });
    it('requires exact local policy acknowledgment for this connection', async () => {
        const { core, calls } = await coreFixture({ preference: null });
        expect(core.getSnapshot().routerSTTSelection).toBeNull();
        await expect(core.startSTT('fixture', consent(core))).rejects.toMatchObject({ code: 'invalid-input' });
        expect(calls.filter(url => url.endsWith('/audio/transcriptions'))).toHaveLength(0);
    });
    it('a key save invalidates outstanding consent without inference or default/enablement change', async () => {
        const { core, calls } = await coreFixture(), old = consent(core), registry = core.getSnapshot().modelRegistry;
        const before = calls.length;
        await core.saveKey('openrouter', 'SYNTHETIC_REPLACEMENT', 'encrypted');
        expect(calls).toHaveLength(before);
        expect(core.getSnapshot().modelRegistry).toEqual(registry);
        await expect(core.startSTT('fixture', old)).rejects.toMatchObject({ code: 'invalid-input' });
    });
    it('policy changes invalidate fresh consent and never relax the policy on provider error', async () => {
        const { core, calls } = await coreFixture(), old = consent(core);
        await core.getSnapshot().onRouterSTTPreference!('openrouter', { ...preference, policy: { dataCollection: 'deny', requireZdr: false } });
        await expect(core.startSTT('fixture', old)).rejects.toMatchObject({ code: 'invalid-input' });
        expect(calls.filter(url => url.endsWith('/audio/transcriptions'))).toHaveLength(0);
    });
});
describe('OR_STT_boundary queue', () => {
    it('explicit null rates remain unknown rather than looking up an OpenAI model', async () => {
        const f = await queueFixture(1);
        const result = await runTranscriptionQueue(f);
        expect(result.failure).toBeNull();
        expect(result.project.runs[0].intent?.rateSnapshot).toBeNull();
    });
    it('completed chunk is checkpointed before the next POST', async () => {
        const events: string[] = [];
        const f = await queueFixture(2, async ({ project, runId }) => {
            if (runId)
                events.push(`saved:${project.rawTranscripts.length}`);
            return receipt(project, runId);
        });
        const adapter = f.provider;
        f.provider = { transcribe: async (req, job) => {
                events.push(`post:${req.chunk.index}`);
                return adapter.transcribe(req, job);
            } };
        await runTranscriptionQueue(f);
        expect(events).toEqual(['post:0', 'saved:1', 'post:1', 'saved:2']);
    });
    it('checkpoint failure keeps fetch count at one and blocks the next chunk', async () => {
        const f = await queueFixture(2, async ({ project, runId }) => {
            if (runId)
                throw new Error('SYNTHETIC_QUOTA');
            return receipt(project, runId);
        });
        const result = await runTranscriptionQueue(f);
        expect(result.failure?.code).toBe('storage');
        expect(f.bodies).toHaveLength(1);
        expect(result.project.rawTranscripts).toHaveLength(0);
        expect(result.pendingProject?.rawTranscripts).toHaveLength(1);
    });
    it('lost ownership at the completed checkpoint keeps fetch count at one', async () => {
        const f = await queueFixture(2, async ({ project, runId }) => {
            if (runId)
                cancelJobs();
            return receipt(project, runId);
        });
        await expect(runTranscriptionQueue(f)).rejects.toThrow();
        expect(f.bodies).toHaveLength(1);
    });
    it('an aborted late response cannot append raw results or schedule a second POST', async () => {
        const entered = deferred<void>(), release = deferred<Response>();
        const f = await queueFixture(2);
        let posts = 0;
        f.provider = createOpenRouterSTTProvider({
            selection: f.batch.routerSelection!, getKey: () => 'SYNTHETIC', fetch: async () => {
                posts++;
                entered.resolve();
                return release.promise;
            }
        });
        const work = runTranscriptionQueue(f), rejected = expect(work).rejects.toThrow();
        await entered.promise;
        cancelJobs();
        await rejected;
        release.resolve(new Response(JSON.stringify({ text: 'SYNTHETIC_LATE' })));
        await Promise.resolve();
        expect(posts).toBe(1);
        expect(f.project.rawTranscripts).toHaveLength(0);
    });
    it('retry preserves the original snapshot and requires both additional cost and outcome-unknown acknowledgment', async () => {
        const f = await queueFixture(1);
        f.provider = { transcribe: async () => {
                throw new ProviderError('network', { outcomeUnknown: true });
            } };
        const first = await runTranscriptionQueue(f), batch = first.project.sttBatches![0];
        const options = {
            ...f, project: first.project, batch, purpose: 'retry-failed' as const, job: createJobContext(), acknowledgeAdditionalCharge: true
        };
        await expect(runTranscriptionQueue(options)).rejects.toMatchObject({ code: 'ambiguous-attempt' });
        await expect(runTranscriptionQueue({
            ...options, acknowledgeAdditionalCharge: false, acknowledgeUnknownOutcome: true
        })).rejects.toMatchObject({ code: 'invalid-input' });
        const original = createOpenRouterSTTProvider({
            selection: batch.routerSelection!, getKey: () => 'SYNTHETIC', fetch: async () => new Response(JSON.stringify({ text: 'SYNTHETIC_RETRY' }))
        });
        const second = await runTranscriptionQueue({
            ...options, acknowledgeUnknownOutcome: true, provider: original
        });
        expect(second.failure).toBeNull();
        expect(second.project.sttBatches![0].routerSelection).toEqual(batch.routerSelection);
        expect(second.project.sttBatches).toHaveLength(1);
    });
});
describe('OR_STT_boundary core encrypted history', () => {
    it('a completed chunk/checkpoint survives lock and encrypted reload', async () => {
        const { core, secret } = await coreFixture();
        await core.startSTT('fixture', consent(core));
        const saved = core.getSnapshot().projects[0];
        await core.lock();
        expect(core.getSnapshot().routerSTTSelection).toBeNull();
        expect(core.getSnapshot().projects).toEqual([]);
        await core.unlock(secret);
        const restored = core.getSnapshot().projects[0];
        expect(restored.rawTranscripts).toEqual(saved.rawTranscripts);
        expect(restored.sttBatches).toEqual(saved.sttBatches);
        expect(restored.runs[0].checkpoint).toEqual(saved.runs[0].checkpoint);
    });
    it('rerun creates a new batch/version and preserves earlier raw history and selected edit', async () => {
        const { core } = await coreFixture();
        await core.startSTT('fixture', consent(core));
        const before = core.getSnapshot().projects[0];
        await core.startSTT('fixture', consent(core, 'rerun-successful'), ['chunk'], { purpose: 'rerun-successful' });
        const after = core.getSnapshot().projects[0];
        expect(after.sttBatches).toHaveLength(2);
        expect(after.rawTranscripts).toHaveLength(2);
        expect(after.rawTranscripts[0]).toEqual(before.rawTranscripts[0]);
        expect(after.transcriptVersions).toHaveLength(2);
        expect(after.selectedTranscriptVersionId).toBe(before.selectedTranscriptVersionId);
    });
    it.each(['unavailable', 'price', 'modality'] as const)('a changed %s profile blocks retry rather than silently switching', async (change) => {
        let changed = false;
        const { core, calls } = await coreFixture({ respond: async (url) => {
                if (url.endsWith('/audio/transcriptions'))
                    return new Response(JSON.stringify({ error: { code: 503 } }), { status: 503 });
                if (changed)
                    return new Response(JSON.stringify({ data: change === 'unavailable' ? [] : [{
                                id: route.modelId, architecture: { input_modalities: change === 'modality' ? ['text'] : ['audio'], output_modalities: ['transcription'] }, pricing: { prompt: '0.9', completion: '0.000002' }
                            }] }));
                return null;
            } });
        await expect(core.startSTT('fixture', consent(core))).rejects.toMatchObject({ code: 'provider-unavailable' });
        const batch = core.getSnapshot().projects[0].sttBatches![0];
        changed = true;
        if (change === 'modality')
            await expect(core.discoverModels('openrouter', 'stt')).rejects.toMatchObject({ code: 'catalog' });
        else
            await core.discoverModels('openrouter', 'stt');
        await expect(core.startSTT('fixture', consent(core, 'retry-failed', ['chunk'], batch.id), ['chunk'], { purpose: 'retry-failed', batchId: batch.id })).rejects.toMatchObject({ code: 'invalid-input' });
        expect(calls.filter(url => url.endsWith('/audio/transcriptions'))).toHaveLength(1);
    });
});
describe('OR_STT_only immutable selection', () => {
    it('freezes detached chunks, route, rates and policy and applies the exact shared ISO hint rule', async () => {
        const p = project(), policy = { ...preference.policy }, m = model(), selection = (await selectionModule()).freezeRouterSTTSelection(p, ['chunk'], route, m, policy);
        policy.requireZdr = false;
        const changed = { ...p, preparedChunks: [{ ...p.preparedChunks[0], sourceEndMs: 900 }] };
        expect(changed.preparedChunks[0].sourceEndMs).toBe(900);
        expect(selection.chunks[0].sourceEndMs).toBe(1000);
        expect(selection.policy.requireZdr).toBe(true);
        expect(selection.appliedLanguage).toBe('en');
        expect(Object.isFrozen(selection.chunks[0])).toBe(true);
        expect(selection.rateSnapshot?.rates[0].unit).toBe('input-token');
    });
    it.each(['chunk-id', 'range', 'bytes', 'audio-record', 'source', 'languages', 'route', 'policy', 'rate', 'profile'] as const)('rejects a changed %s snapshot against the current batch before any POST', async (change) => {
        const p = project(), b = await routerBatch(p);
        let cloned = structuredClone(b);
        let current = p;
        if (change === 'chunk-id')
            current = { ...p, preparedChunks: [{ ...p.preparedChunks[0], id: 'changed' }] };
        if (change === 'range')
            current = { ...p, preparedChunks: [{ ...p.preparedChunks[0], sourceEndMs: 900 }] };
        if (change === 'bytes')
            current = { ...p, preparedChunks: [{ ...p.preparedChunks[0], encodedBytes: 4 }] };
        if (change === 'audio-record')
            current = { ...p, preparedChunks: [{ ...p.preparedChunks[0], audioRecordId: 'changed' }] };
        if (change === 'source')
            current = { ...p, sourceAssets: [] };
        if (change === 'languages')
            cloned = { ...cloned, languages: ['ko'] };
        if (change === 'route')
            cloned = { ...cloned, route: { ...route, endpointTag: 'ignored/pinning' } };
        if (change === 'policy')
            cloned = { ...cloned, routerSelection: { ...cloned.routerSelection!, policy: { dataCollection: 'allow' as 'deny', requireZdr: false } } };
        if (change === 'rate')
            cloned = { ...cloned, routerSelection: { ...cloned.routerSelection!, rateSnapshot: { ...cloned.routerSelection!.rateSnapshot!, rates: [{
                                unit: 'input-token', units: 1, price: -1
                            }] } } };
        if (change === 'profile')
            cloned = { ...cloned, routerSelection: { ...cloned.routerSelection!, profileId: 'unknown' } };
        expect(() => validateSTTBatch(current, cloned)).toThrow();
    });
    it.each(['openai', 'minutes', 'endpoint', 'missing', 'different-model'] as const)('requires exact OR batch route/snapshot for %s mismatch', async (kind) => {
        const p = project(), b = await routerBatch(p);
        const altered = kind === 'missing' ? { ...b, routerSelection: undefined } : kind === 'different-model' ? { ...b, routerSelection: { ...b.routerSelection!, route: { ...route, modelId: 'openai/whisper-large-v3' } } } : { ...b, route: { ...route, ...(kind === 'openai' ? { provider: 'openai' as const } : kind === 'minutes' ? { stage: 'minutes' as const } : { endpointTag: 'provider/pin' }) } };
        expect(() => validateSTTBatch(p, altered)).toThrow();
    });
    it('catalog refresh time alone does not change the material consent signature', async () => {
        const module = await selectionModule(), a = await frozen(), b = module.freezeRouterSTTSelection(project(), ['chunk'], route, { ...model(), checkedAt: '2026-10-03T01:00:00.000Z' }, preference.policy);
        expect(module.routerSTTConsentSignature(a)).toBe(module.routerSTTConsentSignature(b));
    });
});
describe('OR_STT_registry controller preferences', () => {
    it('saving preferences round-trips encrypted and the callback rejects failed saves', async () => {
        let fail = false;
        const { core, secret } = await coreFixture({ registryFailure: () => fail });
        const before = core.getSnapshot().modelRegistry;
        fail = true;
        await expect(core.getSnapshot().onRouterSTTPreference!('openrouter', { ...preference, policy: { dataCollection: 'deny', requireZdr: false } })).rejects.toMatchObject({ code: 'storage' });
        expect(core.getSnapshot().modelRegistry).toEqual(before);
        fail = false;
        await core.lock();
        await core.unlock(secret);
        await core.getSnapshot().onRouterSTTPreference!('openrouter', { ...preference, policy: { dataCollection: 'deny', requireZdr: false } });
        await core.lock();
        await core.unlock(secret);
        expect(core.getSnapshot().modelRegistry!.openRouterSTT!.openrouter.policy.requireZdr).toBe(false);
    });
    it('recommendation requires empty setup and cannot overwrite existing defaults', async () => {
        const { core } = await coreFixture();
        await expect(core.getSnapshot().onApplyRouterSTTRecommendation!('openrouter', route.modelId)).rejects.toMatchObject({ code: 'invalid-input' });
    });
    it.each(['wrong-connection', 'invalid-policy', 'missing-ack', 'forged-applied'] as const)('rejects %s preferences without a successful-looking save', async (kind) => {
        const { core } = await coreFixture();
        const before = core.getSnapshot().modelRegistry;
        const next = kind === 'invalid-policy' ? { ...preference, policy: { dataCollection: 'allow' as 'deny', requireZdr: true } } : kind === 'missing-ack' ? {
            ...preference, policy: { dataCollection: 'deny' as const, requireZdr: false }, acknowledgedDisclosureVersion: null
        } : kind === 'forged-applied' ? { ...preference, initialDefaultApplied: true } : preference;
        await expect(core.getSnapshot().onRouterSTTPreference!(kind === 'wrong-connection' ? 'other' : 'openrouter', next)).rejects.toMatchObject({ code: 'invalid-input' });
        expect(core.getSnapshot().modelRegistry).toEqual(before);
    });
});
describe('OR_STT_only saved selection integrity', () => {
    it.each(['positive-rate', 'raw-pricing', 'fingerprint', 'billing-basis'] as const)('rejects persisted %s tampering before dispatch', async (field) => {
        const p = project(), batch = await routerBatch(p), selection = batch.routerSelection!;
        const changed = field === 'positive-rate' ? { ...selection, rateSnapshot: { ...selection.rateSnapshot!, rates: [{
                        unit: 'input-token' as const, units: 1, price: 0.7
                    }] } }
            : field === 'raw-pricing' ? { ...selection, rawPricing: { prompt: '0.9', completion: '0.000002' } }
                : field === 'fingerprint' ? { ...selection, catalogFingerprint: 'arbitrary' } : { ...selection, billingBasis: 'audio-second' as const };
        expect(() => validateSTTBatch(p, { ...batch, routerSelection: changed })).toThrow();
    });
});
describe('OR_STT_boundary rate/receipt provenance', () => {
    it('an omitted queue rate uses the frozen OR snapshot and cannot request a legacy OpenAI lookup', async () => {
        const f = await queueFixture(1, undefined, true);
        const result = await runTranscriptionQueue({ ...f, rateSnapshot: undefined });
        expect(result.failure).toBeNull();
        expect(result.project.runs[0].intent?.rateSnapshot).toEqual(f.batch.routerSelection!.rateSnapshot);
    });
    it('rejects queue rates that differ from the frozen batch before reading audio or POST', async () => {
        const f = await queueFixture(1, undefined, true);
        await expect(runTranscriptionQueue({ ...f, rateSnapshot: { ...f.batch.routerSelection!.rateSnapshot!, rates: [{
                        unit: 'input-token', units: 1, price: 0.8
                    }] } })).rejects.toMatchObject({ code: 'invalid-input' });
        expect(f.bodies).toHaveLength(0);
    });
    it('a receipt with changed chunk descriptors cannot dispatch a next chunk', async () => {
        const f = await queueFixture(2, async ({ project, runId }) => {
            const saved = receipt(project, runId);
            return runId ? { ...saved, project: { ...saved.project, preparedChunks: saved.project.preparedChunks.map(chunk => chunk.index === 1 ? { ...chunk, encodedBytes: 4 } : chunk) } } : saved;
        });
        await expect(runTranscriptionQueue(f)).rejects.toMatchObject({ code: 'invalid-input' });
        expect(f.bodies).toHaveLength(1);
    });
});
describe('OR_STT_boundary controller lock', () => {
    it('lock aborts the in-flight controller attempt and late JSON cannot restore raw history or disclosures', async () => {
        const entered = deferred<void>(), release = deferred<Response>();
        const { core, secret, calls } = await coreFixture({ respond: async (url) => {
                if (url.endsWith('/audio/transcriptions')) {
                    entered.resolve();
                    return release.promise;
                }
                return null;
            } });
        const work = core.startSTT('fixture', consent(core)), rejected = expect(work).rejects.toThrow();
        await entered.promise;
        await core.lock();
        await rejected;
        release.resolve(new Response(JSON.stringify({ text: 'SYNTHETIC_LATE' })));
        await Promise.resolve();
        expect(core.getSnapshot()).toMatchObject({
            session: 'locked', projects: [], routerSTTSelection: null
        });
        await core.unlock(secret);
        const p = core.getSnapshot().projects[0];
        expect(p.rawTranscripts).toEqual([]);
        expect(p.runs[0].state).toBe('outcome-unknown');
        expect(calls.filter(url => url.endsWith('/audio/transcriptions'))).toHaveLength(1);
    });
});
describe('OR_STT_registry exact recommendation acknowledgment', () => {
    it('applies an explicitly named enabled recommendation once to a new empty setup', async () => {
        const { core, secret } = await coreFixture({ clearDefault: true, seedProject: false });
        await core.getSnapshot().onApplyRouterSTTRecommendation!('openrouter', route.modelId);
        expect(core.getSnapshot().modelRegistry!.defaults.stt).toBe(registryRouteKey(route));
        expect(core.getSnapshot().modelRegistry!.openRouterSTT!.openrouter.initialDefaultApplied).toBe(true);
        await expect(core.getSnapshot().onApplyRouterSTTRecommendation!('openrouter', route.modelId)).rejects.toMatchObject({ code: 'invalid-input' });
        await core.lock();
        await core.unlock(secret);
        expect(core.getSnapshot().modelRegistry!.openRouterSTT!.openrouter.initialDefaultApplied).toBe(true);
        await core.createMeeting();
        expect(core.getSnapshot().sttModelId).toBe(route.modelId);
    });
    it('rejects a displayed Mini candidate when refresh now recommends Whisper, without saving a substituted default', async () => {
        let changed = false;
        const whisper: DiscoveredSTTModel = { ...model(null), id: 'openai/whisper-large-v3' };
        const { core } = await coreFixture({
            clearDefault: true, seedProject: false, candidates: [model(), whisper], respond: async () => changed ? new Response(JSON.stringify({ data: [{
                        id: whisper.id, architecture: { input_modalities: ['audio'], output_modalities: ['transcription'] }, pricing: null
                    }] })) : null
        });
        const before = core.getSnapshot().modelRegistry;
        changed = true;
        await core.discoverModels('openrouter', 'stt');
        await expect(core.getSnapshot().onApplyRouterSTTRecommendation!('openrouter', route.modelId)).rejects.toMatchObject({ code: 'invalid-input' });
        expect(core.getSnapshot().modelRegistry!.defaults).toEqual(before!.defaults);
        expect(core.getSnapshot().modelRegistry!.openRouterSTT!.openrouter.initialDefaultApplied).toBe(false);
    });
});
describe('OR_STT_boundary completed recovery', () => {
    it('core result checkpoint failure sends once, then lock recovery encrypts the completed raw/batch/version', async () => {
        const { core, calls, secret } = await coreFixture({ twoChunks: true, intercept: async (write) => {
                if (write.runId)
                    throw new Error('SYNTHETIC_QUOTA');
            } });
        await expect(core.startSTT('fixture', consent(core, 'initial', ['chunk', 'chunk-1']))).rejects.toMatchObject({ code: 'storage' });
        expect(calls.filter(url => url.endsWith('/audio/transcriptions'))).toHaveLength(1);
        expect(core.getSnapshot().projects[0].rawTranscripts).toHaveLength(0);
        await core.lock();
        await core.unlock(secret);
        const saved = core.getSnapshot().projects[0];
        expect(saved.rawTranscripts).toHaveLength(1);
        expect(saved.transcriptVersions).toHaveLength(1);
        expect(saved.runs[0].state).toBe('saved');
        expect(saved.sttBatches![0].selectedRawIdsByChunk.chunk).toBe(saved.rawTranscripts[0].id);
    });
    it('core explicit retry after encrypted reload uses its original batch snapshot and does not create a new batch', async () => {
        let posts = 0;
        const { core, secret } = await coreFixture({ respond: async (url) => url.endsWith('/audio/transcriptions') && ++posts === 1 ? new Response(JSON.stringify({ error: { code: 503 } }), { status: 503 }) : null });
        await expect(core.startSTT('fixture', consent(core))).rejects.toMatchObject({ code: 'provider-unavailable' });
        const original = core.getSnapshot().projects[0].sttBatches![0];
        await core.lock();
        await core.unlock(secret);
        await core.discoverModels('openrouter', 'stt');
        await core.startSTT('fixture', consent(core, 'retry-failed', ['chunk'], original.id), ['chunk'], { purpose: 'retry-failed', batchId: original.id });
        const p = core.getSnapshot().projects[0];
        expect(p.sttBatches).toHaveLength(1);
        expect(p.sttBatches![0].routerSelection).toEqual(original.routerSelection);
        expect(p.sttBatches![0].attemptRunIds).toHaveLength(2);
        expect(posts).toBe(2);
    });
});
it('OR_STT_only freezes material reviewed profile limits, formats and hint capability into consent provenance', async () => {
    const p = project(), batch = await routerBatch(p), fingerprint = JSON.parse(batch.routerSelection!.catalogFingerprint);
    expect(fingerprint[4]).toMatchObject({
        maxAudioBytes: 16000000, maxBodyBytes: 24000000, singleLanguageHint: true, formats: [{ mime: 'audio/mpeg', codec: 'mp3' }, { mime: 'audio/wav', codec: 'pcm' }]
    });
    fingerprint[4].maxBodyBytes = 1000;
    expect(() => validateSTTBatch(p, { ...batch, routerSelection: { ...batch.routerSelection!, catalogFingerprint: JSON.stringify(fingerprint) } })).toThrow();
});
it('OR_STT_only rejects unsupported extra saved snapshot fields rather than persisting credential-shaped metadata', async () => {
    const p = project(), batch = await routerBatch(p);
    expect(() => validateSTTBatch(p, { ...batch, routerSelection: { ...batch.routerSelection!, key: 'SYNTHETIC_FORBIDDEN' } } as unknown as STTBatch)).toThrow();
});

describe('OR_STT_new_setup initialization', () => {
    async function emptyCore(legacy: boolean) {
        const indexedDB = new IDBFactory(), databaseName = crypto.randomUUID(), secret = 'synthetic new setup vault phrase';
        const shared = { indexedDB, databaseName, testOnlyOwnership: { acquire: async () => () => {} } };
        if (legacy) {
            const seed = createVaultSession(shared); sessions.push(seed);
            await seed.create(secret, secret); await seed.dispose();
        }
        const calls: string[] = []; let session!: VaultSession;
        const core = createMeetingController({ indexedDB, databaseName,
            sessionFactory: hooks => { session = createVaultSession({ ...hooks, ...shared }); return session; },
            fetch: async (url, init) => {
                expect(init?.method ?? 'GET').toBe('GET'); calls.push(String(url));
                return new Response(JSON.stringify({ data: [{ id: route.modelId, architecture: { input_modalities: ['audio'], output_modalities: ['transcription'] }, pricing: model().pricing.raw }] }));
            } });
        cores.push(core); await core.initialize();
        if (legacy) await core.unlock(secret); else await core.createVault(secret);
        return { core, secret, calls, session: () => session };
    }
    it('new vault starts with empty enabled/default choices until explicit exact recommendation action', async () => {
        const { core, secret, calls } = await emptyCore(false);
        expect(core.getSnapshot().modelRegistry).toMatchObject({ entries: [], defaults: { stt: null, minutes: null } });
        expect(core.getSnapshot().sttModelId).toBe(''); expect(calls).toEqual([]);
        await core.discoverModels('openrouter', 'stt');
        expect(core.getSnapshot().routerSTTRecommendation?.recommendedId).toBe(route.modelId);
        expect(core.getSnapshot().modelRegistry!.defaults.stt).toBeNull(); expect(core.getSnapshot().modelRegistry!.entries).toEqual([]);
        await core.setRouterSTTPreference('openrouter', preference);
        await core.setModelEnabled(registryRouteKey(route), true);
        expect(core.getSnapshot().modelRegistry!.defaults.stt).toBeNull();
        await core.getSnapshot().onApplyRouterSTTRecommendation!('openrouter', route.modelId);
        expect(core.getSnapshot().modelRegistry!.defaults.stt).toBe(registryRouteKey(route));
        expect(core.getSnapshot().modelRegistry!.openRouterSTT!.openrouter.initialDefaultApplied).toBe(true);
        await core.lock(); await core.unlock(secret);
        expect(core.getSnapshot().modelRegistry!.defaults.stt).toBe(registryRouteKey(route));
        expect(calls).toHaveLength(1);
    });
    it('legacy registry-absent unlock preserves documented seed and later saved disabled or cleared choices', async () => {
        const { core, secret, calls, session } = await emptyCore(true);
        const old = core.getSnapshot().modelRegistry!, key = old.defaults.stt!;
        expect(old.entries.filter(entry => entry.userEnabled).map(entry => entry.route.modelId)).toEqual(['gpt-transcribe', 'gpt-4o-mini-transcribe']);
        expect(core.getSnapshot().sttModelId).toBe('gpt-transcribe');
        await core.setModelEnabled(key, false); await core.lock(); await core.unlock(secret);
        expect(core.getSnapshot().modelRegistry!.defaults.stt).toBe(key);
        expect(core.getSnapshot().modelRegistry!.entries.find(entry => registryRouteKey(entry.route) === key)!.userEnabled).toBe(false);
        await session().saveModelRegistry(setRegistryDefault(core.getSnapshot().modelRegistry!, 'stt', null), createJobContext());
        await core.lock(); await core.unlock(secret);
        expect(core.getSnapshot().modelRegistry!.defaults.stt).toBeNull(); expect(core.getSnapshot().sttModelId).toBe('');
        expect(core.getSnapshot().modelRegistry!.entries.find(entry => registryRouteKey(entry.route) === key)!.userEnabled).toBe(false);
        expect(calls).toEqual([]);
    });
});


it('OR_STT_review_retry uses original languages after current expectations change', async () => {
    const bodies: { language?: string }[] = [];
    const { core, calls } = await coreFixture({ respond: async (url, init) => {
        if (!url.endsWith('/audio/transcriptions')) return null;
        bodies.push(JSON.parse(String(init?.body)));
        return bodies.length === 1 ? new Response(JSON.stringify({ error: { code: 503 } }), { status: 503 }) : null;
    } });
    await expect(core.startSTT('fixture', consent(core))).rejects.toMatchObject({ code: 'provider-unavailable' });
    const original = structuredClone(core.getSnapshot().projects[0].sttBatches![0]);
    const oldConsent = consent(core, 'retry-failed', ['chunk'], original.id);
    const before = core.getSnapshot().projects[0];
    core.getSnapshot().onAudioOptions!('fixture', { ...before.audioOptions, expectedLanguages: ['ja'] });
    await vi.waitFor(() => expect(core.getSnapshot().projects[0].audioOptions.expectedLanguages).toEqual(['ja']));
    await expect(core.startSTT('fixture', oldConsent, ['chunk'], { purpose: 'retry-failed', batchId: original.id })).rejects.toMatchObject({ code: 'invalid-input' });
    expect(bodies).toHaveLength(1);
    await core.startSTT('fixture', consent(core, 'retry-failed', ['chunk'], original.id), ['chunk'], { purpose: 'retry-failed', batchId: original.id });
    const after = core.getSnapshot().projects[0];
    expect(after.audioOptions.expectedLanguages).toEqual(['ja']); expect(after.sttBatches).toHaveLength(1);
    expect(after.sttBatches![0].languages).toEqual(['en']); expect(after.sttBatches![0].routerSelection).toEqual(original.routerSelection);
    expect(after.sttBatches![0].attemptRunIds).toHaveLength(2); expect(new Set(after.sttBatches![0].attemptRunIds).size).toBe(2);
    expect(after.runs).toHaveLength(2); expect(after.runs.map(run => run.intent?.rateSnapshot)).toEqual([original.routerSelection!.rateSnapshot, original.routerSelection!.rateSnapshot]);
    expect(bodies).toEqual([expect.objectContaining({ language: 'en' }), expect.objectContaining({ language: 'en' })]);
    expect(calls.filter(url => url.endsWith('/audio/transcriptions'))).toHaveLength(2);
});
