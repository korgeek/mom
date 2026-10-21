// Keyless integration: real vault/crypto/media/transcript/minutes; injected fetch only.
import { webcrypto } from "node:crypto";
import { File as NodeFile } from "node:buffer";
import { readFileSync } from "node:fs";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createMeetingController, type MeetingController } from "../src/react-app/controller";
import { createVaultSession, type VaultSessionOptions } from "../src/react-app/vault/session";
import { createLocalMediaWorker, type MediaProgress } from "../src/react-app/media/worker";
import { cancelJobs, createJobContext } from "../src/react-app/domain/jobs";
import { minutesInputSignature } from "../src/react-app/minutes/generate";
import { resolveMinutesSettings } from "../src/react-app/minutes/preferences";
import { sttActionToken } from "../src/react-app/transcript/batches";
const secret = "keyless controller testing phrase";
const active: MeetingController[] = [];
beforeAll(() => { Object.defineProperty(globalThis, "crypto", { configurable: true, value: webcrypto }); });
afterEach(async () => {
    try {
        for (const core of active.splice(0))
            await core.dispose();
    }
    finally {
        cancelJobs();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    }
});
function wav(): File {
    const samples = 16000;
    const data = new Uint8Array(44 + samples * 2);
    const view = new DataView(data.buffer);
    const str = (at: number, value: string) => [...value].forEach((letter, index) => { data[at + index] = letter.charCodeAt(0); });
    str(0, "RIFF");
    view.setUint32(4, data.length - 8, true);
    str(8, "WAVE");
    str(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 16000, true);
    view.setUint32(28, 32000, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    str(36, "data");
    view.setUint32(40, samples * 2, true);
    for (let i = 0; i < samples; i++)
        view.setInt16(44 + i * 2, Math.round(2000 * Math.sin(i * 0.1)), true);
    return new NodeFile([data], "KEYLESS_PRIVATE_SOURCE.wav", { type: "audio/wav" }) as unknown as File;
}
const model = { id: "fixture/text-model", name: "Fixture text model", context_length: 32000, top_provider: { max_completion_tokens: 4096 }, architecture: { input_modalities: ["text"], output_modalities: ["text"], tokenizer: "FixtureBPE" }, supported_parameters: ["max_tokens"], pricing: { prompt: "0.000001", completion: "0.000002", request: "0" } };
const endpoint = { tag: "FixtureProvider/explicit-region", provider_name: "FixtureProvider", context_length: 32000, max_prompt_tokens: 28000, max_completion_tokens: 4096, supported_parameters: ["max_tokens"], pricing: model.pricing };
function setup(options: {
    factory?: typeof createVaultSession;
    fetch?: typeof globalThis.fetch;
    indexedDB?: IDBFactory;
    databaseName?: string;
    respond?: (url: string, init?: RequestInit) => Promise<Response | null>;
    mediaWorkerFactory?: typeof createLocalMediaWorker;
} = {}) {
    const indexedDB = options.indexedDB ?? new IDBFactory();
    const databaseName = options.databaseName ?? crypto.randomUUID();
    const held = new Set<string>();
    const calls: string[] = [];
    const revoked: string[] = [];
    const fetch: typeof globalThis.fetch = options.fetch ?? (async (url, init) => {
        calls.push(String(url));
        const custom = await options.respond?.(String(url), init);
        if (custom)
            return custom;
        if (String(url).endsWith("/audio/transcriptions")) {
            expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer KEYLESS_OPENAI_TEST");
            return new Response(JSON.stringify({ text: "Keyless speech: decision cancelled, continue investigation.", usage: { type: "duration", seconds: 1 } }));
        }
        if (String(url).endsWith("/chat/completions")) {
            const request = JSON.parse(String(init?.body));
            expect(request.provider.only).toEqual([endpoint.tag]);
            expect(request.provider.allow_fallbacks).toBe(false);
            return new Response(JSON.stringify({ model: model.id, choices: [{ message: { content: "# Keyless fixture minutes\n\nThe decision was cancelled." }, finish_reason: "stop" }], usage: { prompt_tokens: 40, completion_tokens: 15 } }));
        }
        if (String(url).endsWith("/endpoints"))
            return new Response(JSON.stringify({ data: { id: String(url).split("/models/")[1].replace("/endpoints", ""), endpoints: [endpoint] } }));
        if (String(url) === 'https://api.openai.com/v1/models')
            return new Response(JSON.stringify({ data: [{ id: 'gpt-transcribe', owned_by: 'openai' }] }));
        return new Response(JSON.stringify({ data: [model] }));
    });
    const core = createMeetingController({ indexedDB, databaseName, sessionFactory: (hooks) => (options.factory ?? createVaultSession)({ ...hooks, indexedDB, databaseName, testOnlyOwnership: { acquire: async (name) => {
                    if (held.has(name))
                        return null;
                    held.add(name);
                    return () => { held.delete(name); };
                } } }), mediaWorkerFactory: options.mediaWorkerFactory ?? createLocalMediaWorker, fetch, objectUrls: { create: () => `blob:keyless-${crypto.randomUUID()}`, revoke: (url) => { revoked.push(url); } } });
    active.push(core);
    return { core, calls, revoked, indexedDB, databaseName };
}
async function opened(options: Parameters<typeof setup>[0] = {}) { const fixture = setup(options); await fixture.core.initialize(); await fixture.core.createVault(secret); return fixture; }
async function transcribed(options: Parameters<typeof setup>[0] = {}, explicitModelSetup = false) {
    const fixture = await opened(options);
    if (explicitModelSetup) {
        await fixture.core.saveKey('openai', 'KEYLESS_OPENAI_TEST', 'encrypted');
        await fixture.core.discoverModels('openai', 'stt');
        const speech = fixture.core.getSnapshot().modelManagement!.rows.find(row => row.route.modelId === 'gpt-transcribe')!;
        await fixture.core.applyModelSelection({ baseRevision: fixture.core.getSnapshot().modelManagement!.revision!, changes: [{ key: speech.key, enabled: true }], defaultChanges: [{ stage: 'stt', key: speech.key }] });
    }
    const id = await fixture.core.createMeeting(); await fixture.core.updateMeeting(id, { title: "KEYLESS_PRIVATE_TITLE" }); await fixture.core.importFile(id, wav()); await fixture.core.saveKey("openai", "KEYLESS_OPENAI_TEST", "encrypted"); await fixture.core.prepareAudio(id); await fixture.core.startSTT(id, { modelId: "gpt-transcribe", acknowledged: true }); return { ...fixture, id };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
function interceptCheckpoint(intercept: (write: Parameters<ReturnType<typeof createVaultSession>["store"]["checkpoint"]>[0]) => Promise<void>) {
    return (options: VaultSessionOptions = {}) => {
        const session = createVaultSession(options);
        return new Proxy(session, { get(target, key) {
                if (key !== "store")
                    return Reflect.get(target, key);
                const store = target.store;
                return { ...store, async checkpoint(write, job) { await intercept(write); return store.checkpoint(write, job); } } satisfies typeof store;
            } });
    };
}
async function enableMinutes(fixture: Awaited<ReturnType<typeof transcribed>>, modelId = model.id, tag = endpoint.tag) {
    const { core } = fixture;
    const candidate = core.getSnapshot().modelManagement!.rows.find(row => row.route.modelId === modelId && !row.route.endpointTag)!;
    await core.loadModelEndpoints(candidate.route);
    const row = core.getSnapshot().modelManagement!.rows.find(row => row.route.modelId === modelId && row.route.endpointTag === tag)!;
    if (row.blockedReason === null) await core.setModelEnabled(row.key, true);
    else await core.setModelAlias(row.key, null); // Preserve a blocked explicit fixture route without enabling it.
    return row;
}
async function minutesReady(fixture: Awaited<ReturnType<typeof transcribed>>) { const { core, id } = fixture; await core.saveKey("openrouter", "KEYLESS_ROUTER_TEST", "encrypted"); await core.refreshModels(); await enableMinutes(fixture); const p = core.getSnapshot().projects.find((item) => item.id === id)!; await core.setMinutesSettings(id, { ...p.minutesSettings, modelId: model.id }); await core.selectMinutesEndpoint(id, endpoint.tag); return { acknowledged: true as const, transcriptVersionId: p.selectedTranscriptVersionId!, consentToken: core.getSnapshot().minutesConsentToken!, partialAcknowledged: false }; }
describe('connected central model settings', () => {
    it('keeps catalog-only aliases out of public minutes rows without key reads or automatic enablement', async () => {
        const reads = vi.fn(), fixture = await opened({ factory: options => { const session = createVaultSession(options); return new Proxy(Object.create(session) as typeof session, { get(target, key) { if (key === 'getProviderKey') return (provider: Parameters<typeof session.getProviderKey>[0]) => { reads(provider); return session.getProviderKey(provider); }; return Reflect.get(target, key); } }); }, respond: async (url, init) => { expect(url).toBe('https://openrouter.ai/api/v1/models'); expect(new Headers(init?.headers).has('Authorization')).toBe(false); return new Response(JSON.stringify({ data: [model, { ...model, id: '~fixture/latest' }], total_count: 2, links: { next: null } })); } });
        reads.mockClear(); await fixture.core.discoverModels('openrouter', 'minutes'); const snapshot = fixture.core.getSnapshot();
        expect(snapshot.modelManagement!.rows.filter(row => row.route.stage === 'minutes')).toMatchObject([{ route: { modelId: model.id }, userEnabled: false, blockedReason: 'exact-endpoint-required' }]);
        expect(snapshot.modelRegistry!.entries).toHaveLength(2); expect(snapshot.minutesRoutes).toEqual([]); expect(reads).not.toHaveBeenCalled(); expect(fixture.calls).toEqual(['https://openrouter.ai/api/v1/models']);
    });
    it.each(['ko', 'en'] as const)('shows a safe catalog-only discovery failure in %s and preserves saved choices without blocking local work', async language => {
        let failing = false; const reads = vi.fn();
        const fixture = await opened({ factory: options => { const session = createVaultSession(options); return new Proxy(Object.create(session) as typeof session, { get(target, key) { if (key === 'getProviderKey') return (provider: Parameters<typeof session.getProviderKey>[0]) => { reads(provider); return session.getProviderKey(provider); }; return Reflect.get(target, key); } }); }, respond: async (url, init) => { expect(new Headers(init?.headers).has('Authorization')).toBe(false); return url.endsWith('/models') && failing ? new Response(JSON.stringify({ data: [{ id: 'PRIVATE_UPSTREAM_RESPONSE_SENTINEL' }] })) : null; } });
        fixture.core.getSnapshot().onPreferences!({ ...fixture.core.getSnapshot().preferences, uiLanguage: language }); reads.mockClear();
        await fixture.core.discoverModels('openrouter', 'minutes'); const candidate = fixture.core.getSnapshot().modelManagement!.rows.find(row => row.route.modelId === model.id)!;
        await fixture.core.loadModelEndpoints(candidate.route); const exact = fixture.core.getSnapshot().modelManagement!.rows.find(row => row.route.endpointTag === endpoint.tag)!;
        await fixture.core.setModelEnabled(exact.key, true); await fixture.core.setModelDefault('minutes', exact.key); const id = await fixture.core.createMeeting(), before = fixture.core.getSnapshot();
        failing = true; before.modelManagement!.onDiscover!('openrouter', 'minutes'); await vi.waitFor(() => expect(fixture.core.getSnapshot().busy).toBe(false)); const after = fixture.core.getSnapshot();
        const message = language === 'ko' ? '모델 또는 제공사 엔드포인트 목록을 불러오지 못했어요. 설정에서 목록 조회를 다시 시도하세요. 저장된 선택은 유지돼요.' : 'The model or provider endpoint catalog could not be loaded. Retry discovery in Settings. Saved selections were retained.';
        expect(after.error).toBe(message); expect(after.modelManagement!.error).toBe(message); expect(after.error).not.toContain('PRIVATE_UPSTREAM');
        expect(after.modelRegistry!.defaults).toEqual(before.modelRegistry!.defaults); expect(after.modelRegistry!.entries.find(row => row.route.endpointTag === endpoint.tag)).toMatchObject({ route: exact.route, acceptedMetadata: before.modelRegistry!.entries.find(row => row.route.endpointTag === endpoint.tag)!.acceptedMetadata, refresh: { status: 'stale' } });
        expect(after.projects.find(project => project.id === id)).toEqual(before.projects.find(project => project.id === id)); expect(after.minutesConsentToken).toBeNull(); expect(reads).not.toHaveBeenCalled(); expect(fixture.calls).toEqual(['https://openrouter.ai/api/v1/models', `https://openrouter.ai/api/v1/models/${model.id}/endpoints`, 'https://openrouter.ai/api/v1/models']);
        await expect(fixture.core.createMeeting()).resolves.toBeTruthy();
    });
    it('applies a saved STT default only to a new meeting and preserves a disabled default as blocked', async () => {
        const fixture = await opened(); await fixture.core.createMeeting(); const mini = fixture.core.getSnapshot().modelManagement!.rows.find(row => row.route.modelId === 'gpt-4o-mini-transcribe')!;
        await fixture.core.setModelDefault('stt', mini.key); expect(fixture.core.getSnapshot().sttModelId).toBe('gpt-transcribe'); await fixture.core.createMeeting(); expect(fixture.core.getSnapshot().sttModelId).toBe(mini.route.modelId);
        await fixture.core.setModelEnabled(mini.key, false); const id = await fixture.core.createMeeting(); expect(fixture.core.getSnapshot().sttModelId).toBe(mini.route.modelId); expect(fixture.core.getSnapshot().modelCatalog!.find(model => model.id === mini.route.modelId)?.enabled).toBe(false); await expect(fixture.core.startSTT(id, { modelId: mini.route.modelId, acknowledged: true })).rejects.toMatchObject({ code: 'invalid-input' }); expect(fixture.calls).toEqual([]);
    });
    it('quota failure preserves saved preferences and never publishes a successful alias', async () => {
        let fail = false; const fixture = await opened({ factory: options => { const session = createVaultSession(options); return new Proxy(Object.create(session) as typeof session, { get(target, key) { if (key === 'saveModelRegistry') return async (...args: Parameters<typeof session.saveModelRegistry>) => { if (fail) throw new DOMException('fixture quota', 'QuotaExceededError'); return session.saveModelRegistry(...args); }; return Reflect.get(target, key); } }); } });
        const before = fixture.core.getSnapshot().modelRegistry!, key = fixture.core.getSnapshot().modelManagement!.rows[0].key; fail = true;
        await expect(fixture.core.setModelAlias(key, 'UNSAVED_QUOTA_ALIAS')).rejects.toMatchObject({ code: 'storage' }); expect(fixture.core.getSnapshot().modelRegistry).toEqual(before); expect(fixture.core.getSnapshot().modelManagement!.rows[0].alias).toBeNull();
        fail = false; await fixture.core.lock(); await fixture.core.unlock(secret); expect(fixture.core.getSnapshot().modelRegistry).toEqual(before);
    });
    it('late discovery after lock cannot restore rows, metadata or consent', async () => {
        const reached = deferred<void>(), release = deferred<void>(), fixture = await opened({ respond: async url => { if (url.endsWith('/models')) { reached.resolve(); await release.promise; return new Response(JSON.stringify({ data: [model] })); } return null; } });
        const work = fixture.core.discoverModels('openrouter', 'minutes'), rejected = expect(work).rejects.toThrow(); await reached.promise; await fixture.core.lock(); release.resolve(); await rejected;
        expect(fixture.core.getSnapshot()).toMatchObject({ session: 'locked', modelRegistry: null, modelManagement: null, modelCatalog: null, minutesRoutes: [], projects: [], minutesConsentToken: null, comparisonConsentToken: null });
    });
    it('full discovery retains 1001 new rows ephemerally without endpoints or preference auto-enable', async () => {
        const fixture = await opened({ respond: async url => url.endsWith('/models') ? new Response(JSON.stringify({ total_count: 1001, data: Array.from({ length: 1001 }, (_, i) => ({ ...model, id: `fixture/discovered-${i}` })) })) : null });
        await fixture.core.discoverModels('openrouter', 'minutes'); const snapshot = fixture.core.getSnapshot();
        expect(snapshot.modelManagement!.rows.filter(row => row.route.stage === 'minutes')).toHaveLength(1001); expect(snapshot.modelRegistry!.entries).toHaveLength(2); expect(snapshot.modelCatalog!.filter(row => row.kind === 'minutes')).toEqual([]); expect(fixture.calls).toHaveLength(1); expect(fixture.calls[0]).toBe('https://openrouter.ai/api/v1/models');
    });
    it('authenticated OpenAI listing is explicit and unsupported stages never become paid-ready', async () => {
        const fixture = await opened({ respond: async (url, init) => url === 'https://api.openai.com/v1/models' ? (expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer KEYLESS_OPENAI_TEST'), new Response(JSON.stringify({ data: [{ id: 'gpt-transcribe', owned_by: 'openai' }, { id: 'fixture-unsupported' }] }))) : url.includes('output_modalities=transcription') ? new Response(JSON.stringify({ data: [{ id: 'fixture/or-audio', architecture: { input_modalities: ['audio'], output_modalities: ['transcription'] } }] })) : null });
        await fixture.core.saveKey('openai', 'KEYLESS_OPENAI_TEST', 'encrypted'); expect(fixture.calls).toEqual([]); await fixture.core.discoverModels('openai', 'stt');
        const unsupported = fixture.core.getSnapshot().modelManagement!.rows.find(row => row.route.modelId === 'fixture-unsupported')!; await expect(fixture.core.setModelEnabled(unsupported.key, true)).rejects.toMatchObject({ code: 'invalid-input' });
        await fixture.core.discoverModels('openrouter', 'stt'); const or = fixture.core.getSnapshot().modelManagement!.rows.find(row => row.route.modelId === 'fixture/or-audio')!; expect(or.metadata.pricing.kind).toBe('unknown'); await expect(fixture.core.setModelEnabled(or.key, true)).rejects.toMatchObject({ code: 'invalid-input' });
        expect(fixture.calls.filter(url => /audio\/transcriptions|chat\/completions/.test(url))).toEqual([]);
    });
    it('disabling an exact route preserves its project choice and blocks dispatch with no STT rerun', async () => {
        const fixture = await transcribed({}, true); await minutesReady(fixture); const before = fixture.core.getSnapshot().projects[0], consent = fixture.core.getSnapshot().minutesConsentToken!, row = fixture.core.getSnapshot().modelManagement!.rows.find(row => row.route.endpointTag === endpoint.tag)!;
        await fixture.core.setModelEnabled(row.key, false); const snapshot = fixture.core.getSnapshot(); expect(snapshot.projects[0].minutesSettings).toEqual(before.minutesSettings); expect(snapshot.minutesConsentToken).toBeNull(); expect(snapshot.minutesRoutes!.find(choice => choice.key === row.key)?.enabled).toBe(false);
        await expect(fixture.core.generateMinutes(fixture.id, { acknowledged: true, transcriptVersionId: before.selectedTranscriptVersionId!, consentToken: consent, partialAcknowledged: false })).rejects.toMatchObject({ code: 'invalid-input' }); expect(fixture.calls.filter(url => url.endsWith('/chat/completions'))).toEqual([]); expect(fixture.calls.filter(url => url.endsWith('/audio/transcriptions'))).toHaveLength(1);
    });
    it('a failed endpoint refresh cannot publish partial metadata, and changed prices need separate acceptance', async () => {
        let changed = false, fail = false;
        const fixture = await transcribed({ respond: async url => { if (changed && url.endsWith('/endpoints')) { if (fail) throw new TypeError('synthetic endpoint refresh interruption'); return new Response(JSON.stringify({ data: { id: model.id, endpoints: [{ ...endpoint, pricing: { ...endpoint.pricing, prompt: '0.001' } }] } })); } return null; } }, true);
        await minutesReady(fixture); const original = fixture.core.getSnapshot().modelRegistry!, row = fixture.core.getSnapshot().modelManagement!.rows.find(row => row.route.endpointTag === endpoint.tag)!, oldToken = fixture.core.getSnapshot().minutesConsentToken;
        changed = true; fail = true; await expect(fixture.core.refreshModels()).rejects.toMatchObject({ code: 'network' });
        expect(fixture.core.getSnapshot().modelRegistry!.entries.find(entry => entry.route.endpointTag === endpoint.tag)).toMatchObject({ observedMetadata: original.entries.find(entry => entry.route.endpointTag === endpoint.tag)!.observedMetadata, refresh: { status: 'stale' } }); expect(fixture.core.getSnapshot().minutesConsentToken).toBeNull();
        fail = false; await fixture.core.refreshModels(); const current = fixture.core.getSnapshot().modelManagement!.rows.find(item => item.key === row.key)!; expect(current).toMatchObject({ userEnabled: true, metadataAcceptanceRequired: true, blockedReason: 'metadata-changed' }); expect(fixture.core.getSnapshot().minutesConsentToken).toBeNull();
        await fixture.core.setModelEnabled(row.key, false); await expect(fixture.core.setModelEnabled(row.key, true)).rejects.toMatchObject({ code: 'invalid-input' }); expect(fixture.core.getSnapshot().modelRegistry!.entries.find(entry => entry.route.endpointTag === endpoint.tag)!.acceptedMetadata).toEqual(original.entries.find(entry => entry.route.endpointTag === endpoint.tag)!.acceptedMetadata);
        await fixture.core.acceptModelMetadata(row.key, fixture.core.getSnapshot().modelManagement!.revision!); await fixture.core.setModelEnabled(row.key, true); expect(fixture.core.getSnapshot().minutesConsentToken).toBeTruthy(); expect(fixture.core.getSnapshot().minutesConsentToken).not.toBe(oldToken); expect(fixture.calls.filter(url => url.endsWith('/chat/completions'))).toEqual([]);
    });
    it('keeps two enabled same-model endpoints distinct and atomically saves an exact selected route', async () => {
        const other = { ...endpoint, tag: 'SecondProvider/region' }, fixture = await transcribed({ respond: async url => url.endsWith('/endpoints') ? new Response(JSON.stringify({ data: { id: model.id, endpoints: [endpoint, other] } })) : null }); await minutesReady(fixture);
        const second = fixture.core.getSnapshot().modelManagement!.rows.find(row => row.route.endpointTag === other.tag)!; await fixture.core.setModelEnabled(second.key, true); await fixture.core.setModelAlias(second.key, 'SECOND_ENDPOINT_ALIAS');
        const before = fixture.core.getSnapshot().projects[0]; expect(fixture.core.getSnapshot().minutesRoutes!.filter(row => row.modelId === model.id && row.enabled)).toHaveLength(2); await fixture.core.setMinutesRoute(fixture.id, second.key);
        const selected = fixture.core.getSnapshot(); expect(selected.minutesRouteKey).toBe(second.key); expect(selected.minutesEndpointTag).toBe(other.tag); expect(selected.projects[0].minutesSettings).toEqual(before.minutesSettings); expect(selected.projects[0].rawTranscripts).toEqual(before.rawTranscripts);
        await fixture.core.setComparisonB(fixture.id, model.id, endpoint.tag); await fixture.core.setComparisonView(fixture.id, true); expect(fixture.core.getSnapshot().minutesComparison?.status).toBe('duplicate'); expect(fixture.core.getSnapshot().comparisonConsentToken).toBeNull();
    });
    it('uses OR minutes without an OpenAI key and keeps preparation independent of stage credentials', async () => {
        const fixture = await transcribed(); await minutesReady(fixture); const p = fixture.core.getSnapshot().projects[0]; fixture.core.getSnapshot().onClearKey!('openai'); await vi.waitFor(() => expect(fixture.core.getSnapshot().busy).toBe(false));
        expect(fixture.core.getSnapshot().connections.find(item => item.provider === 'openai')!.status).toBe('none'); expect(fixture.core.getSnapshot().minutesUnavailableReason).toBeUndefined();
        await fixture.core.generateMinutes(fixture.id, { acknowledged: true, transcriptVersionId: p.selectedTranscriptVersionId!, consentToken: fixture.core.getSnapshot().minutesConsentToken!, partialAcknowledged: false }); expect(fixture.calls.filter(url => url.endsWith('/chat/completions'))).toHaveLength(1); expect(fixture.calls.filter(url => url.endsWith('/audio/transcriptions'))).toHaveLength(1);
        const newId = await fixture.core.createMeeting(); await fixture.core.importFile(newId, wav()); const calls = fixture.calls.length; await fixture.core.prepareAudio(newId); expect(fixture.calls).toHaveLength(calls);
    });
    it('persists only the identified first-run STT seed and performs no implicit discovery', async () => {
        const fixture = await opened(); const registry = fixture.core.getSnapshot().modelRegistry;
        expect(registry?.entries.map(entry => entry.route.modelId)).toEqual(['gpt-transcribe', 'gpt-4o-mini-transcribe']);
        expect(registry?.entries.every(entry => entry.userEnabled)).toBe(true); expect(registry?.defaults.minutes).toBeNull(); expect(fixture.calls).toEqual([]);
        await fixture.core.lock(); await fixture.core.unlock(secret); expect(fixture.core.getSnapshot().modelRegistry).toEqual(registry); expect(fixture.calls).toEqual([]);
    });
    it('discovers public minutes without reading a key and saves explicit enable, alias and prospective default', async () => {
        const reads = vi.fn(), fixture = await opened({ factory: options => { const session = createVaultSession(options); return new Proxy(Object.create(session) as typeof session, { get(target, key) { if (key === 'getProviderKey') return (provider: string) => { reads(provider); return session.getProviderKey(provider); }; return Reflect.get(target, key); } }); }, respond: async url => url.endsWith('/endpoints') ? new Response(JSON.stringify({ data: { id: model.id, endpoints: [endpoint] } })) : null });
        const oldId = await fixture.core.createMeeting(); reads.mockClear(); await fixture.core.discoverModels('openrouter', 'minutes'); expect(reads).not.toHaveBeenCalled();
        const candidate = fixture.core.getSnapshot().modelManagement!.rows.find(row => row.route.modelId === model.id)!;
        expect(candidate.userEnabled).toBe(false); expect(fixture.core.getSnapshot().modelRegistry!.entries).toHaveLength(2);
        await fixture.core.loadModelEndpoints(candidate.route); const route = fixture.core.getSnapshot().modelManagement!.rows.find(row => row.route.endpointTag === endpoint.tag)!;
        await fixture.core.setModelEnabled(route.key, true); await fixture.core.setModelAlias(route.key, 'MY_SAVED_MODEL_ALIAS'); await fixture.core.setModelDefault('minutes', route.key);
        const id = await fixture.core.createMeeting(); expect(fixture.core.getSnapshot().projects.find(p => p.id === oldId)?.minutesSettings.modelId).toBe(''); expect(fixture.core.getSnapshot().projects.find(p => p.id === id)?.minutesSettings.modelId).toBe(model.id);
        await fixture.core.lock(); await fixture.core.unlock(secret); expect(fixture.core.getSnapshot().modelManagement!.rows.find(row => row.key === route.key)).toMatchObject({ alias: 'MY_SAVED_MODEL_ALIAS', isDefault: true, userEnabled: true });
        expect(fixture.core.getSnapshot().projects.find(p => p.id === id)?.minutesSettings.modelId).toBe(model.id); expect(fixture.calls.filter(url => /chat\/completions|audio\/transcriptions/.test(url))).toEqual([]);
    });
});
describe('three-stage local preparation contract', () => {
    it('prepares real encrypted audio without a provider key or any network request and preserves it after reload', async () => {
        const keyReads = vi.fn();
        const fixture = await opened({ factory: options => {
            const session = createVaultSession(options);
            return new Proxy(Object.create(session) as typeof session, { get(target, key) {
                if (key === 'getProviderKey') return (provider: Parameters<typeof session.getProviderKey>[0]) => { keyReads(); return session.getProviderKey(provider); };
                return Reflect.get(target, key);
            } });
        } });
        const id = await fixture.core.createMeeting(); await fixture.core.importFile(id, wav());
        const readsBefore = keyReads.mock.calls.length, callsBefore = [...fixture.calls];
        await fixture.core.prepareAudio(id);
        const prepared = fixture.core.getSnapshot().projects[0];
        expect(prepared.preparedChunks).toHaveLength(1);
        expect(prepared.preparedChunks[0]).toMatchObject({ codec: 'mp3', sourceStartMs: 0, sourceEndMs: 1000 });
        expect(prepared.preparedChunks[0].encodedBytes).toBeGreaterThan(0);
        expect(fixture.core.getSnapshot().preparation).toMatchObject({ stage: 'complete', completed: 1, total: 1 });
        expect(prepared.runs).toHaveLength(0); expect(prepared.rawTranscripts).toHaveLength(0);
        expect(keyReads.mock.calls).toHaveLength(readsBefore); expect(fixture.calls).toEqual(callsBefore);
        await fixture.core.lock();
        const reloaded = setup({ indexedDB: fixture.indexedDB, databaseName: fixture.databaseName });
        await reloaded.core.initialize(); await reloaded.core.unlock(secret);
        expect(reloaded.core.getSnapshot().projects[0].preparedChunks).toEqual(prepared.preparedChunks);
        expect(reloaded.calls.some(url => /audio\/transcriptions|chat\/completions/.test(url))).toBe(false);
    });
    it('rejects STT before any preparation, paid intent, provider key read or transmission', async () => {
        const keyReads = vi.fn();
        const fixture = await opened({ factory: options => {
            const session = createVaultSession(options);
            return new Proxy(Object.create(session) as typeof session, { get(target, key) {
                if (key === 'getProviderKey') return (provider: Parameters<typeof session.getProviderKey>[0]) => { keyReads(); return session.getProviderKey(provider); };
                return Reflect.get(target, key);
            } });
        } });
        const id = await fixture.core.createMeeting(); await fixture.core.importFile(id, wav());
        const readsBefore = keyReads.mock.calls.length, callsBefore = [...fixture.calls];
        await expect(fixture.core.startSTT(id, { modelId: 'gpt-transcribe', acknowledged: true })).rejects.toMatchObject({ code: 'invalid-input' });
        const project = fixture.core.getSnapshot().projects[0];
        expect(project.preparedChunks).toHaveLength(0); expect(project.runs).toHaveLength(0);
        expect(keyReads.mock.calls).toHaveLength(readsBefore); expect(fixture.calls).toEqual(callsBefore);
    });
});
describe("preparation defaults and durable progress", () => {
    it("ends failed source inspection rather than leaving local inspection running", async () => {
        const { core } = await opened(); const id = await core.createMeeting();
        await expect(core.importFile(id, new NodeFile(['not audio'], 'synthetic-bad.wav') as unknown as File)).rejects.toMatchObject({ code: 'unsupported-container' });
        expect(core.getSnapshot().preparation).toMatchObject({ stage: 'failed', completed: 0, total: null });
    });
    it("clears transient preparation when creating or opening another meeting", async () => {
        const { core } = await opened(); const original = await core.createMeeting();
        const bad = () => new NodeFile(['not audio'], 'synthetic-bad.wav') as unknown as File;
        await expect(core.importFile(original, bad())).rejects.toThrow();
        const next = await core.createMeeting();
        expect(core.getSnapshot().preparation).toBeNull();
        await expect(core.importFile(next, bad())).rejects.toThrow();
        core.getSnapshot().onNavigate!('import', original);
        await vi.waitFor(() => expect(core.getSnapshot().selectedProjectId).toBe(original));
        expect(core.getSnapshot().preparation).toBeNull();
    });
    it("starts a new meeting with five minute chunks and five second overlap", async () => {
        const { core } = await opened();
        const id = await core.createMeeting();
        expect(core.getSnapshot().defaultAudioOptions).toMatchObject({ chunkMinutes: 5, overlapSeconds: 5 });
        expect(core.getSnapshot().projects.find(project => project.id === id)?.audioOptions).toMatchObject({ chunkMinutes: 5, overlapSeconds: 5 });
    });
    it("reports real source time before the first encrypted receipt and saved bytes only after it", async () => {
        const reached = deferred<void>(), release = deferred<void>(), providerReached = deferred<void>(), providerRelease = deferred<void>();
        const fixture = await opened({ factory: interceptCheckpoint(async write => {
            if (write.audioRecords.length && write.project.preparedChunks.length) { reached.resolve(); await release.promise; }
        }), respond: async url => { if (url.endsWith('/audio/transcriptions')) { providerReached.resolve(); await providerRelease.promise; } return null; } });
        const id = await fixture.core.createMeeting(); await fixture.core.importFile(id, wav()); await fixture.core.saveKey('openai', 'KEYLESS_OPENAI_TEST', 'encrypted');
        const snapshots: unknown[] = [];
        const unsubscribe = fixture.core.subscribe(() => snapshots.push(fixture.core.getSnapshot().preparation));
        const work = fixture.core.prepareAudio(id);
        await reached.promise;
        expect(snapshots).toContainEqual(expect.objectContaining({ stage: 'preparing', sourceProcessedMs: 1000, durationMs: 1000, completed: 0, savedEncodedBytes: 0 }));
        expect(fixture.core.getSnapshot().preparation).toMatchObject({ stage: 'saving', sourceProcessedMs: 1000, durationMs: 1000, completed: 0, total: 1, savedEncodedBytes: 0 });
        expect(fixture.core.getSnapshot().projects[0].preparedChunks).toHaveLength(0);
        expect(fixture.calls.filter(url => url.endsWith('/audio/transcriptions'))).toHaveLength(0);
        release.resolve(); await work;
        const transcription = fixture.core.startSTT(id, { modelId: 'gpt-transcribe', acknowledged: true }); await providerReached.promise;
        const chunk = fixture.core.getSnapshot().projects[0].preparedChunks[0];
        expect(snapshots).toContainEqual(expect.objectContaining({ stage: 'complete', completed: 1, total: 1, savedEncodedBytes: chunk.encodedBytes }));
        expect(fixture.core.getSnapshot().preparation).toBeNull();
        providerRelease.resolve(); await transcription; unsubscribe();
    });
    it("keeps failed encrypted preparation unsaved even after the codec reaches source end", async () => {
        const fixture = await opened({ factory: interceptCheckpoint(async write => {
            if (write.audioRecords.length && write.project.preparedChunks.length) throw new Error('synthetic quota failure');
        }) });
        const id = await fixture.core.createMeeting(); await fixture.core.importFile(id, wav()); await fixture.core.saveKey('openai', 'KEYLESS_OPENAI_TEST', 'encrypted');
        await expect(fixture.core.prepareAudio(id)).rejects.toMatchObject({ code: 'storage' });
        expect(fixture.core.getSnapshot().preparation).toMatchObject({ stage: 'failed', sourceProcessedMs: 1000, completed: 0, savedEncodedBytes: 0 });
        expect(fixture.calls.filter(url => url.endsWith('/audio/transcriptions'))).toHaveLength(0);
    });
    it.each(['lock', 'cancel'] as const)("clears preparation immediately on %s and fences late worker events", async action => {
        const reached = deferred<void>(), release = deferred<void>(); let late: ((value: MediaProgress) => void) | undefined;
        const fixture = await opened({ factory: interceptCheckpoint(async write => {
            if (write.audioRecords.length && write.project.preparedChunks.length) { reached.resolve(); await release.promise; }
        }), mediaWorkerFactory: progress => { late = progress; return createLocalMediaWorker(progress); } });
        const id = await fixture.core.createMeeting(); await fixture.core.importFile(id, wav()); await fixture.core.saveKey('openai', 'KEYLESS_OPENAI_TEST', 'encrypted');
        const work = fixture.core.prepareAudio(id);
        const rejection = expect(work).rejects.toMatchObject({ name: 'AbortError' });
        await reached.promise;
        if (action === 'lock') { const locking = fixture.core.lock(); expect(fixture.core.getSnapshot().preparation).toBeNull(); release.resolve(); await locking; }
        else { fixture.core.getSnapshot().onCancelPreparation!(); expect(fixture.core.getSnapshot().preparation).toBeNull(); release.resolve(); }
        late?.({ sourceProcessedMs: 1000, durationMs: 1000, pcmBytes: 0, encodedBytes: 99 });
        await rejection;
        await vi.waitFor(() => expect(fixture.core.getSnapshot().busy).toBe(false));
        if (action === 'cancel') expect(fixture.core.getSnapshot().preparation).toMatchObject({ stage: 'stopped' });
        else expect(fixture.core.getSnapshot().preparation).toBeNull();
        expect(fixture.calls.filter(url => url.endsWith('/audio/transcriptions'))).toHaveLength(0);
    });
    it("keeps legacy options and completed data through encrypted reload while defaults affect only new meetings", async () => {
        const fixture = await opened(); const id = await fixture.core.createMeeting();
        fixture.core.getSnapshot().onAudioOptions!(id, { ...fixture.core.getSnapshot().projects[0].audioOptions, chunkMinutes: 10, overlapSeconds: 15 });
        await vi.waitFor(() => expect(fixture.core.getSnapshot().busy).toBe(false));
        await fixture.core.importFile(id, wav()); await fixture.core.saveKey('openai', 'KEYLESS_OPENAI_TEST', 'encrypted');
        await fixture.core.prepareAudio(id);
        await fixture.core.startSTT(id, { modelId: 'gpt-transcribe', acknowledged: true });
        const before = fixture.core.getSnapshot().projects[0];
        fixture.core.getSnapshot().onDefaultAudioOptions!({ ...before.audioOptions, chunkMinutes: 15, overlapSeconds: 10 });
        const nextId = await fixture.core.createMeeting();
        expect(fixture.core.getSnapshot().projects.find(project => project.id === nextId)?.audioOptions).toMatchObject({ chunkMinutes: 15, overlapSeconds: 10 });
        await fixture.core.lock();
        const reloaded = setup({ indexedDB: fixture.indexedDB, databaseName: fixture.databaseName });
        await reloaded.core.initialize(); await reloaded.core.unlock(secret);
        const legacy = reloaded.core.getSnapshot().projects.find(project => project.id === id)!;
        expect(legacy.audioOptions).toEqual(before.audioOptions);
        expect(legacy.preparedChunks).toEqual(before.preparedChunks); expect(legacy.rawTranscripts).toEqual(before.rawTranscripts); expect(legacy.transcriptVersions).toEqual(before.transcriptVersions);
        expect(reloaded.calls.filter(url => url.endsWith('/audio/transcriptions'))).toHaveLength(0);
    });
});
describe("catalog and history identity projections", () => {
    it.each(['pricing', 'compatibility', 'limits'] as const)("rejects conflicting duplicate refresh completely and preserves accepted identities: %s", async mode => {
        const first = [model, modelB].map(entry => ({ ...entry, name: `First ${entry.id}` }));
        const later = [model, modelB].map(entry => ({ ...entry, name: `Later ${entry.id}`, top_provider: { max_completion_tokens: mode === 'limits' ? 512 : entry.top_provider.max_completion_tokens }, supported_parameters: mode === 'compatibility' ? [] : ['max_tokens'], pricing: mode === 'pricing' ? { prompt: '0', completion: '0', request: '0' } : entry.pricing }));
        for (const data of [[...first, ...later], [...later, ...first]]) {
            let changed = false; const fixture = await comparisonReady({ respond: async url => changed && url.endsWith('/models') ? new Response(JSON.stringify({ data })) : null });
            const before = fixture.core.getSnapshot().modelRegistry!; changed = true; await expect(fixture.core.refreshModels()).rejects.toMatchObject({ code: 'catalog' });
            const snapshot = fixture.core.getSnapshot(); expect(snapshot.minutesConsentToken).toBeNull(); expect(snapshot.comparisonConsentToken).toBeNull();
            expect(snapshot.projects[0].minutesSettings.modelId).toBe(model.id); expect(snapshot.comparisonBModelId).toBe(modelB.id);
            for (const entry of before.entries.filter(entry => entry.route.stage === 'minutes')) {
                const preserved = snapshot.modelRegistry!.entries.find(item => item.route.modelId === entry.route.modelId)!;
                expect(preserved).toMatchObject({ route: entry.route, acceptedMetadata: entry.acceptedMetadata, observedMetadata: entry.observedMetadata, refresh: { status: 'stale' } });
            }
            await expect(fixture.core.generateComparison(fixture.id, fixture.consent)).rejects.toThrow(); expect(fixture.requests).toHaveLength(0);
        }
    });
    it("opens independent history without provider fetch or inference and preserves selected meeting", async () => {
        const fixture = await transcribed(); const consent = await minutesReady(fixture);
        await fixture.core.generateMinutes(fixture.id, consent);
        const before = fixture.core.getSnapshot().projects; const calls = fixture.calls.length;
        fixture.core.getSnapshot().onNavigate?.('history', fixture.id);
        await vi.waitFor(() => expect(fixture.core.getSnapshot().screen).toBe('history'));
        expect(fixture.calls).toHaveLength(calls);
        expect(fixture.core.getSnapshot().selectedProjectId).toBe(fixture.id);
        expect(fixture.core.getSnapshot().projects).toEqual(before);
        expect(fixture.core.getSnapshot().history).toHaveLength(2);
    });
    it("projects checked catalog dates/prices, preserves IDs on refresh, and keeps requested versus reported route fields", async () => {
        const fixture = await transcribed({ respond: async url => url.endsWith('/models') ? new Response(JSON.stringify({ data: [{ ...model, created: 1760000000 }] })) : null });
        const consent = await minutesReady(fixture);
        expect(fixture.core.getSnapshot().modelCatalog?.find(entry => entry.id === model.id)?.catalog).toMatchObject({ createdAt: '2025-10-09T08:53:20.000Z', pricingKind: 'priced', source: 'https://openrouter.ai/api/v1/models' });
        await fixture.core.refreshModels();
        expect(fixture.core.getSnapshot().projects[0].minutesSettings.modelId).toBe(model.id);
        expect(fixture.core.getSnapshot().minutesConsentToken).not.toBe(consent.consentToken);
        expect(fixture.calls.filter(url => url.endsWith('/chat/completions'))).toHaveLength(0);
        await fixture.core.generateMinutes(fixture.id, { ...consent, consentToken: fixture.core.getSnapshot().minutesConsentToken! });
        expect(fixture.core.getSnapshot().history?.find(item => item.kind === 'stt')).toMatchObject({ route: 'openai', model: 'gpt-transcribe', returnedModel: null, actualProvider: null, requestedEndpoint: null });
        expect(fixture.core.getSnapshot().history?.find(item => item.kind === 'minutes')).toMatchObject({ route: 'openrouter', model: model.id, returnedModel: model.id, actualProvider: null, requestedEndpoint: endpoint.tag });
    });
});
const modelB = { ...model, id: "fixture/model-b", name: "Fixture B", top_provider: { max_completion_tokens: 2048 } };
const endpointB = { ...endpoint, tag: "FixtureB/region", provider_name: "FixtureB", max_completion_tokens: 1500 };
async function comparisonReady(options: Parameters<typeof transcribed>[0] = {}) {
    const requests: Record<string, unknown>[] = [];
    const fixture = await transcribed({ ...options, respond: async (url, init) => {
        if (url.endsWith("/chat/completions")) requests.push(JSON.parse(String(init?.body)));
        const custom = await options.respond?.(url, init); if (custom) return custom;
        if (url.endsWith("/models")) return new Response(JSON.stringify({ data: [model, modelB] }));
        if (url.endsWith("/endpoints")) return new Response(JSON.stringify({ data: { id: String(url).split("/models/")[1].replace("/endpoints", ""), endpoints: [url.includes("model-b") ? endpointB : endpoint] } }));
        if (url.endsWith("/chat/completions")) return new Response(JSON.stringify({ model: requests.at(-1)!.model, provider: requests.length === 1 ? "FixtureProvider" : "FixtureB", choices: [{ message: { content: `# Fixture result ${requests.length}` }, finish_reason: "stop" }], usage: { prompt_tokens: 40, completion_tokens: 15, cost: requests.length === 1 ? 0.01 : undefined } }));
        return null;
    } });
    await minutesReady(fixture);
    await enableMinutes(fixture, modelB.id, endpointB.tag);
    await fixture.core.setComparisonB(fixture.id, modelB.id, endpointB.tag);
    await fixture.core.setComparisonView(fixture.id, true);
    const consent = { acknowledged: true as const, transcriptVersionId: fixture.core.getSnapshot().projects[0].selectedTranscriptVersionId!, consentToken: fixture.core.getSnapshot().comparisonConsentToken!, partialAcknowledged: false, unknownTotalAcknowledged: false };
    return { ...fixture, requests, consent };
}
describe('optional minutes language consumer', () => {
    it.each(['ko', 'en'] as const)('creates encrypted app-following defaults in %s without selecting a model or running STT', async language => {
        const fixture = await opened(); fixture.core.getSnapshot().onPreferences!({ ...fixture.core.getSnapshot().preferences, uiLanguage: language });
        const id = await fixture.core.createMeeting(); expect(fixture.core.getSnapshot().projects[0].minutesSettings).toMatchObject({ outputLanguageMode: 'app', outputLanguage: language, modelId: '' });
        await fixture.core.lock(); await fixture.core.unlock(secret);
        expect(fixture.core.getSnapshot().projects.find(p => p.id === id)?.minutesSettings).toMatchObject({ outputLanguageMode: 'app', outputLanguage: language, modelId: '' });
        expect(fixture.calls.filter(url => url.endsWith('/audio/transcriptions') || url.endsWith('/chat/completions'))).toEqual([]);
    });
    it('binds app-following preview consent, payload and recorded single-run signature to the same effective language', async () => {
        const payloads: Record<string, unknown>[] = [], fixture = await transcribed({ respond: async (url, init) => { if (url.endsWith('/chat/completions')) payloads.push(JSON.parse(String(init?.body))); return null; } }); await minutesReady(fixture);
        const p = fixture.core.getSnapshot().projects[0]; await fixture.core.setMinutesSettings(fixture.id, { ...p.minutesSettings, outputLanguageMode: 'app', outputLanguage: 'ko' });
        const old = fixture.core.getSnapshot().minutesConsentToken; fixture.core.getSnapshot().onPreferences!({ ...fixture.core.getSnapshot().preferences, uiLanguage: 'en' });
        expect(fixture.core.getSnapshot().minutesConsentToken).toBeNull();
        await vi.waitFor(() => expect(fixture.core.getSnapshot().minutesConsentToken).toBeTruthy()); expect(fixture.core.getSnapshot().minutesConsentToken).not.toBe(old);
        const selected = fixture.core.getSnapshot().projects[0], settings = resolveMinutesSettings(selected.minutesSettings, 'en');
        await fixture.core.generateMinutes(fixture.id, { acknowledged: true, transcriptVersionId: selected.selectedTranscriptVersionId!, consentToken: fixture.core.getSnapshot().minutesConsentToken!, partialAcknowledged: false });
        const messages = payloads[0].messages as { role: string; content: string }[]; expect(JSON.parse(messages.find(message => message.role === 'user')!.content).output.language).toBe('en');
        const saved = fixture.core.getSnapshot().projects[0]; expect(saved.minutesRuns[0]).toMatchObject({ settings, inputSignature: await minutesInputSignature(selected.transcriptVersions.find(v => v.id === selected.selectedTranscriptVersionId)!, settings) });
        expect(saved.minutesSettings.outputLanguage).toBe('ko'); expect(saved.rawTranscripts).toEqual(p.rawTranscripts); expect(fixture.calls.filter(url => url.endsWith('/audio/transcriptions'))).toHaveLength(1);
    });
    it.each([undefined, 'explicit'] as const)('preserves a custom saved language with legacy/explicit mode %s after an app language change', async mode => {
        let session!: ReturnType<typeof createVaultSession>; const payloads: Record<string, unknown>[] = [];
        const fixture = await transcribed({ factory: options => { session = createVaultSession(options); return session; }, respond: async (url, init) => { if (url.endsWith('/chat/completions')) payloads.push(JSON.parse(String(init?.body))); return null; } }); await minutesReady(fixture);
        const p = fixture.core.getSnapshot().projects[0], settings = { ...p.minutesSettings, outputLanguage: 'zh-Hant-custom', ...(mode ? { outputLanguageMode: mode } : {}) }; if (!mode) delete settings.outputLanguageMode;
        await session.store.checkpoint({ project: { ...p, minutesSettings: settings }, runId: null, audioRecords: [] }, createJobContext()); await fixture.core.lock(); await fixture.core.unlock(secret); await fixture.core.refreshModels();
        const oldToken = fixture.core.getSnapshot().minutesConsentToken;
        fixture.core.getSnapshot().onPreferences!({ ...fixture.core.getSnapshot().preferences, uiLanguage: 'en' }); expect(fixture.core.getSnapshot().minutesConsentToken).toBeNull(); await vi.waitFor(() => expect(fixture.core.getSnapshot().minutesConsentToken).toBeTruthy());
        expect(fixture.core.getSnapshot().minutesConsentToken).not.toBe(oldToken);
        await expect(fixture.core.generateMinutes(fixture.id, { acknowledged: true, transcriptVersionId: p.selectedTranscriptVersionId!, consentToken: oldToken!, partialAcknowledged: false })).rejects.toMatchObject({ code: 'invalid-input' }); expect(payloads).toHaveLength(0);
        await fixture.core.generateMinutes(fixture.id, { acknowledged: true, transcriptVersionId: p.selectedTranscriptVersionId!, consentToken: fixture.core.getSnapshot().minutesConsentToken!, partialAcknowledged: false });
        const messages = payloads[0].messages as { role: string; content: string }[]; expect(JSON.parse(messages.find(message => message.role === 'user')!.content).output.language).toBe('zh-Hant-custom'); expect(fixture.core.getSnapshot().projects[0].minutesSettings).toEqual(settings);
    });
    it('invalidates synchronously and prevents a delayed old-language preview from restoring stale consent', async () => {
        const fixture = await transcribed(); await minutesReady(fixture); const p = fixture.core.getSnapshot().projects[0]; await fixture.core.setMinutesSettings(fixture.id, { ...p.minutesSettings, outputLanguageMode: 'app' });
        const reached = deferred<void>(), release = deferred<void>(), native = crypto.subtle.digest.bind(crypto.subtle); let hold = true;
        vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (algorithm, data) => { const parsed = JSON.parse(new TextDecoder().decode(data as Uint8Array)); if (hold && parsed.settings?.outputLanguage === 'ko') { hold = false; reached.resolve(); await release.promise; } return native(algorithm, data); });
        const oldPreview = fixture.core.refreshModels(); await reached.promise;
        try {
            fixture.core.getSnapshot().onPreferences!({ ...fixture.core.getSnapshot().preferences, uiLanguage: 'en' }); expect(fixture.core.getSnapshot().minutesConsentToken).toBeNull();
            await vi.waitFor(() => expect(fixture.core.getSnapshot().minutesConsentToken).toBeTruthy()); const fresh = fixture.core.getSnapshot().minutesConsentToken;
            release.resolve(); await oldPreview; expect(fixture.core.getSnapshot().minutesConsentToken).toBe(fresh); expect(fixture.core.getSnapshot().preferences.uiLanguage).toBe('en');
        } finally { release.resolve(); await oldPreview; }
    });
    it('uses resolved settings for both new comparison members and freezes their shared signature and messages', async () => {
        const fixture = await comparisonReady(), p = fixture.core.getSnapshot().projects[0]; await fixture.core.setMinutesSettings(fixture.id, { ...p.minutesSettings, outputLanguageMode: 'app', outputLanguage: 'ko' });
        fixture.core.getSnapshot().onPreferences!({ ...fixture.core.getSnapshot().preferences, uiLanguage: 'en' }); expect(fixture.core.getSnapshot().comparisonConsentToken).toBeNull(); await vi.waitFor(() => expect(fixture.core.getSnapshot().comparisonConsentToken).toBeTruthy());
        await fixture.core.generateComparison(fixture.id, { ...fixture.consent, consentToken: fixture.core.getSnapshot().comparisonConsentToken! });
        const saved = fixture.core.getSnapshot().projects[0], record = saved.minutesComparisons![0]; expect(record.settings.outputLanguage).toBe('en'); expect(record.inputSignature).toBe(await minutesInputSignature(record.transcript, record.settings));
        expect(fixture.requests).toHaveLength(2); for (const request of fixture.requests) expect(request.messages).toEqual(record.messages); expect(saved.minutesRuns.map(run => run.settings.outputLanguage)).toEqual(['en', 'en']);
    });
    it('retries a comparison with its original language and budget after app and per-meeting language changes', async () => {
        let fail = true; const fixture = await comparisonReady({ respond: async url => { if (fail && url.endsWith('/chat/completions')) throw new TypeError('fixture interrupted language comparison'); return null; } });
        await expect(fixture.core.generateComparison(fixture.id, fixture.consent)).rejects.toMatchObject({ code: 'network' }); const saved = fixture.core.getSnapshot().projects[0], record = saved.minutesComparisons![0];
        await fixture.core.setMinutesSettings(fixture.id, { ...saved.minutesSettings, outputLanguageMode: 'explicit', outputLanguage: 'fr-CA-custom' }); await fixture.core.selectComparison(fixture.id, record.id, 0);
        const oldRetryToken = fixture.core.getSnapshot().comparisonConsentToken!; fixture.core.getSnapshot().onPreferences!({ ...fixture.core.getSnapshot().preferences, uiLanguage: 'en' }); expect(fixture.core.getSnapshot().comparisonConsentToken).toBeNull(); await vi.waitFor(() => expect(fixture.core.getSnapshot().comparisonConsentToken).toBeTruthy());
        expect(fixture.core.getSnapshot().comparisonConsentToken).not.toBe(oldRetryToken); await expect(fixture.core.generateComparison(fixture.id, { ...fixture.consent, consentToken: oldRetryToken })).rejects.toMatchObject({ code: 'invalid-input' }); expect(fixture.requests).toHaveLength(1);
        fail = false; await fixture.core.generateComparison(fixture.id, { ...fixture.consent, consentToken: fixture.core.getSnapshot().comparisonConsentToken! });
        expect(fixture.requests).toHaveLength(2); expect(fixture.requests[1].messages).toEqual(record.messages); expect(fixture.requests[1].max_tokens).toBe(record.outputTokens); expect(fixture.core.getSnapshot().projects[0].minutesRuns[0].settings.outputLanguage).toBe(record.settings.outputLanguage); expect(record.settings.outputLanguage).toBe('ko');
        expect(fixture.calls.filter(url => url.endsWith('/audio/transcriptions'))).toHaveLength(1);
    });
    it('fences a delayed frozen-comparison retry preview after the app language changes', async () => {
        let fail = true; const fixture = await comparisonReady({ respond: async url => { if (fail && url.endsWith('/chat/completions')) throw new TypeError('fixture interrupted comparison'); return null; } }); await expect(fixture.core.generateComparison(fixture.id, fixture.consent)).rejects.toMatchObject({ code: 'network' });
        const record = fixture.core.getSnapshot().projects[0].minutesComparisons![0]; await fixture.core.selectComparison(fixture.id, record.id, 0);
        const reached = deferred<void>(), release = deferred<void>(), native = crypto.subtle.digest.bind(crypto.subtle); let hold = true;
        vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (algorithm, data) => { const parsed = JSON.parse(new TextDecoder().decode(data as Uint8Array)); if (hold && Array.isArray(parsed) && parsed[1] === record.id) { hold = false; reached.resolve(); await release.promise; } return native(algorithm, data); });
        const oldPreview = fixture.core.refreshModels(); await reached.promise;
        try {
            fixture.core.getSnapshot().onPreferences!({ ...fixture.core.getSnapshot().preferences, uiLanguage: 'en' }); expect(fixture.core.getSnapshot().comparisonConsentToken).toBeNull(); await vi.waitFor(() => expect(fixture.core.getSnapshot().comparisonConsentToken).toBeTruthy()); const fresh = fixture.core.getSnapshot().comparisonConsentToken;
            release.resolve(); await oldPreview; expect(fixture.core.getSnapshot().comparisonConsentToken).toBe(fresh);
            fail = false; await fixture.core.generateComparison(fixture.id, { ...fixture.consent, consentToken: fresh! }); expect(fixture.requests[1].messages).toEqual(record.messages); expect(fixture.core.getSnapshot().projects[0].minutesRuns[0].settings.outputLanguage).toBe(record.settings.outputLanguage);
        } finally { release.resolve(); await oldPreview; }
    });
    it('retains an explicitly applied language when lock fences a pending settings checkpoint', async () => {
        const reached = deferred<void>(), release = deferred<void>(); let hold = true;
        const fixture = await transcribed({ factory: interceptCheckpoint(async write => { if (hold && write.project.minutesSettings.outputLanguage === 'zh-Hant-applied') { hold = false; reached.resolve(); await release.promise; } }) }); await minutesReady(fixture);
        const p = fixture.core.getSnapshot().projects[0], saving = fixture.core.setMinutesSettings(fixture.id, { ...p.minutesSettings, outputLanguageMode: 'explicit', outputLanguage: 'zh-Hant-applied' }), rejected = expect(saving).rejects.toThrow(); await reached.promise;
        const locking = fixture.core.lock(); expect(fixture.core.getSnapshot().projects).toEqual([]); release.resolve(); await rejected; await locking; await fixture.core.unlock(secret);
        expect(fixture.core.getSnapshot().projects[0].minutesSettings).toMatchObject({ outputLanguageMode: 'explicit', outputLanguage: 'zh-Hant-applied' }); expect(fixture.core.getSnapshot().projects[0].rawTranscripts).toEqual(p.rawTranscripts); expect(fixture.calls.filter(url => url.endsWith('/chat/completions'))).toHaveLength(0);
    });
});
describe("reviewed completion capability caller eligibility", () => {
    const completionModel = { ...model, supported_parameters: ["max_completion_tokens"] };
    const completionModelB = { ...modelB, supported_parameters: ["max_completion_tokens"] };
    const completionEndpoint = { ...endpoint, supported_parameters: ["max_completion_tokens"] };
    const completionEndpointB = { ...endpointB, supported_parameters: ["max_completion_tokens"] };
    it.each([
        { modelParameters: ['max_tokens'], endpointParameters: ['max_completion_tokens'] },
        { modelParameters: ['max_completion_tokens'], endpointParameters: ['max_tokens'] },
    ])("disables crossed single model/endpoint ceiling fields without switching IDs (%j)", async ({ modelParameters, endpointParameters }) => {
        const fixture = await transcribed({ respond: async url => {
            if (url.endsWith('/models')) return new Response(JSON.stringify({ data: [{ ...model, supported_parameters: modelParameters }] }));
            if (url.endsWith('/endpoints')) return new Response(JSON.stringify({ data: { id: String(url).split("/models/")[1].replace("/endpoints", ""), endpoints: [{ ...endpoint, supported_parameters: endpointParameters }] } }));
            return null;
        } });
        const consent = await minutesReady(fixture); const snapshot = fixture.core.getSnapshot();
        expect(snapshot.minutesSelection?.status).toBe('missing-limits'); expect(snapshot.minutesRoutes?.find(entry => entry.endpointTag === endpoint.tag)?.enabled).toBe(false);
        expect(snapshot.projects[0].minutesSettings.modelId).toBe(model.id); expect(snapshot.minutesEndpointTag).toBe(endpoint.tag);
        await expect(fixture.core.generateMinutes(fixture.id, consent)).rejects.toMatchObject({ code: 'invalid-input' });
        expect(fixture.calls.filter(url => url.endsWith('/chat/completions'))).toHaveLength(0);
    });
    it("disables crossed B capability even when its endpoint would fit A's legacy field", async () => {
        const fixture = await comparisonReady({ respond: async url => url.endsWith('/models') ? new Response(JSON.stringify({ data: [model, completionModelB] })) : null });
        const snapshot = fixture.core.getSnapshot();
        expect(snapshot.minutesComparison?.status).toBe('missing-limits'); expect(snapshot.comparisonBEndpoints?.find(entry => entry.tag === endpointB.tag)?.enabled).toBe(false);
        expect(snapshot.minutesEndpoints?.find(entry => entry.tag === endpoint.tag)?.enabled).toBe(true);
        expect(snapshot.comparisonBModelId).toBe(modelB.id); expect(snapshot.comparisonBEndpointTag).toBe(endpointB.tag);
        await expect(fixture.core.generateComparison(fixture.id, fixture.consent)).rejects.toMatchObject({ code: 'invalid-input' }); expect(fixture.requests).toHaveLength(0);
    });
    it("disables cached single endpoints when the selected actual model disappears on refresh", async () => {
        let present = true;
        const fixture = await transcribed({ respond: async url => url.endsWith('/models') ? new Response(JSON.stringify({ data: present ? [model] : [] })) : null });
        await minutesReady(fixture); present = false; await fixture.core.refreshModels();
        const snapshot = fixture.core.getSnapshot(); expect(snapshot.minutesSelection?.status).toBe('choose-model');
        expect(snapshot.minutesRoutes?.find(entry => entry.endpointTag === endpoint.tag)?.enabled).toBe(false);
        expect(snapshot.projects[0].minutesSettings.modelId).toBe(model.id); expect(snapshot.minutesEndpointTag).toBe(endpoint.tag);
        expect(fixture.calls.filter(url => url.endsWith('/chat/completions'))).toHaveLength(0);
    });
    it("disables cached B endpoints when B disappears without borrowing the current A model", async () => {
        let present = true;
        const fixture = await comparisonReady({ respond: async url => url.endsWith('/models') ? new Response(JSON.stringify({ data: present ? [model, modelB] : [model] })) : null });
        present = false; await fixture.core.refreshModels(); const snapshot = fixture.core.getSnapshot();
        expect(snapshot.minutesRoutes?.find(entry => entry.endpointTag === endpointB.tag)?.enabled).toBe(false); expect(snapshot.minutesEndpoints?.find(entry => entry.tag === endpoint.tag)?.enabled).toBe(true);
        expect(snapshot.comparisonBModelId).toBe(modelB.id); expect(snapshot.comparisonBEndpointTag).toBe(endpointB.tag); expect(snapshot.comparisonConsentToken).toBeNull(); expect(fixture.requests).toHaveLength(0);
    });
    it.each(['model-context', 'model-output', 'endpoint-context', 'endpoint-prompt', 'endpoint-output'] as const)("keeps both endpoint eligibility and known-limit model availability honest for %s", async kind => {
        const models = [model, modelB].map(entry => ({ ...entry, ...(kind === 'model-context' ? { context_length: null } : {}), ...(kind === 'model-output' ? { top_provider: { max_completion_tokens: null } } : {}) }));
        const data = models;
        const fixture = await comparisonReady({ respond: async url => {
            if (url.endsWith('/models')) return new Response(JSON.stringify({ data }));
            if (url.endsWith('/endpoints')) return new Response(JSON.stringify({ data: { id: String(url).split("/models/")[1].replace("/endpoints", ""), endpoints: [{ ...(url.includes('model-b') ? endpointB : endpoint), ...(kind === 'endpoint-context' ? { context_length: null } : {}), ...(kind === 'endpoint-prompt' ? { max_prompt_tokens: null } : {}), ...(kind === 'endpoint-output' ? { max_completion_tokens: null } : {}) }] } }));
            return null;
        } });
        const snapshot = fixture.core.getSnapshot();
        expect(snapshot.minutesSelection?.status).toBe('missing-limits'); expect(snapshot.minutesComparison?.status).toBe('choose-model');
        expect(snapshot.minutesEndpoints?.find(entry => entry.tag === endpoint.tag)?.enabled).toBe(false); expect(snapshot.comparisonBEndpoints?.find(entry => entry.tag === endpointB.tag)?.enabled).toBe(false);
        for (const id of [model.id, modelB.id]) { expect(snapshot.modelCatalog?.find(entry => entry.id === id)?.enabled).toBe(false); expect(snapshot.modelManagement!.rows.some(row => row.route.modelId === id && row.blockedReason !== null)).toBe(true); }
        expect(snapshot.comparisonConsentToken).toBeNull(); expect(fixture.requests).toHaveLength(0);
    });
    it("offers a public completion-only model with known limits without selecting it automatically", async () => {
        const fixture = await opened({ respond: async url => url.endsWith('/models') ? new Response(JSON.stringify({ data: [completionModel] })) : null });
        const id = await fixture.core.createMeeting(); const selected = fixture.core.getSnapshot().projects[0].minutesSettings.modelId;
        await fixture.core.refreshModels();
        expect(fixture.core.getSnapshot().modelCatalog?.find(entry => entry.id === model.id)).toBeUndefined(); expect(fixture.core.getSnapshot().modelManagement!.rows.find(row => row.route.modelId === model.id)).toMatchObject({ userEnabled: false, mayLoadEndpoints: true });
        expect(fixture.core.getSnapshot().projects.find(project => project.id === id)?.minutesSettings.modelId).toBe(selected);
        expect(fixture.calls.filter(url => url.endsWith('/chat/completions'))).toHaveLength(0);
    });
    it("enables the matching completion-only single endpoint and keeps explicit paid consent and routing", async () => {
        const sent: Record<string, unknown>[] = [];
        const fixture = await transcribed({ respond: async (url, init) => {
            if (url.endsWith('/models')) return new Response(JSON.stringify({ data: [completionModel] }));
            if (url.endsWith('/endpoints')) return new Response(JSON.stringify({ data: { id: String(url).split("/models/")[1].replace("/endpoints", ""), endpoints: [completionEndpoint] } }));
            if (url.endsWith('/chat/completions')) sent.push(JSON.parse(String(init?.body)));
            return null;
        } });
        const consent = await minutesReady(fixture); const snapshot = fixture.core.getSnapshot();
        expect(snapshot.minutesSelection?.status).toBe('fits');
        expect(snapshot.minutesSelection?.limits).toMatchObject({ outputTokens: 4096, reasoningReserveTokens: 0 });
        expect(snapshot.minutesEndpoints?.find(entry => entry.tag === endpoint.tag)?.enabled).toBe(true);
        expect(snapshot.modelCatalog?.find(entry => entry.id === model.id)?.enabled).toBe(true);
        expect(snapshot.projects[0].minutesSettings.modelId).toBe(model.id); expect(snapshot.minutesEndpointTag).toBe(endpoint.tag);
        await expect(fixture.core.generateMinutes(fixture.id, { ...consent, consentToken: 'stale-fixture-consent' })).rejects.toMatchObject({ code: 'invalid-input' }); expect(sent).toHaveLength(0);
        await fixture.core.generateMinutes(fixture.id, consent);
        expect(sent).toHaveLength(1); expect(sent[0]).toMatchObject({ model: model.id, max_completion_tokens: 4096, provider: { only: [endpoint.tag], order: [endpoint.tag], allow_fallbacks: false, require_parameters: true } });
        expect(sent[0]).not.toHaveProperty('max_tokens'); expect(sent[0]).not.toHaveProperty('reasoning');
    });
    it("resolves actual B completion-only capability independently of legacy A and keeps the common ceiling", async () => {
        const fixture = await comparisonReady({ respond: async url => {
            if (url.endsWith('/models')) return new Response(JSON.stringify({ data: [model, completionModelB] }));
            if (url.endsWith('/endpoints')) return new Response(JSON.stringify({ data: { id: String(url).split("/models/")[1].replace("/endpoints", ""), endpoints: [url.includes('model-b') ? completionEndpointB : endpoint] } }));
            return null;
        } });
        const snapshot = fixture.core.getSnapshot();
        expect(snapshot.minutesComparison).toMatchObject({ status: 'fits', outputTokens: 1500 });
        expect(snapshot.comparisonBEndpoints?.find(entry => entry.tag === endpointB.tag)?.enabled).toBe(true);
        expect(snapshot.modelCatalog?.find(entry => entry.id === modelB.id)?.enabled).toBe(true);
        expect(snapshot.minutesEndpoints?.find(entry => entry.tag === endpoint.tag)?.enabled).toBe(true);
        expect(snapshot.comparisonBModelId).toBe(modelB.id); expect(snapshot.comparisonBEndpointTag).toBe(endpointB.tag);
        await fixture.core.generateComparison(fixture.id, fixture.consent);
        expect(fixture.requests).toHaveLength(2);
        expect(fixture.requests[0]).toMatchObject({ model: model.id, max_tokens: 1500, provider: { only: [endpoint.tag], order: [endpoint.tag], allow_fallbacks: false, require_parameters: true } });
        expect(fixture.requests[1]).toMatchObject({ model: modelB.id, max_completion_tokens: 1500, provider: { only: [endpointB.tag], order: [endpointB.tag], allow_fallbacks: false, require_parameters: true } });
        expect(fixture.requests[0]).not.toHaveProperty('max_completion_tokens'); expect(fixture.requests[1]).not.toHaveProperty('max_tokens');
        expect(fixture.requests[0].messages).toEqual(fixture.requests[1].messages); expect(fixture.requests[1]).not.toHaveProperty('reasoning');
        await fixture.core.setComparisonB(fixture.id, model.id, endpoint.tag);
        expect(fixture.core.getSnapshot().minutesComparison?.status).toBe('duplicate'); expect(fixture.core.getSnapshot().comparisonConsentToken).toBeNull();
    });
});

describe("exactly two comparison controller", () => {
    it("waits for the A checkpoint to resolve and rejects competing operations before starting B", async () => {
        const reached = deferred<void>(); const release = deferred<void>();
        const fixture = await comparisonReady({ factory: interceptCheckpoint(async write => { if (write.project.minutesRuns.length === 1 && write.runId) { reached.resolve(); await release.promise; } }) });
        const generation = fixture.core.generateComparison(fixture.id, fixture.consent); await reached.promise;
        expect(fixture.requests).toHaveLength(1);
        await expect(fixture.core.setComparisonView(fixture.id, false)).rejects.toMatchObject({ code: "busy" });
        release.resolve(); await generation; expect(fixture.requests).toHaveLength(2);
    });
    it("preserves an unknown paid attempt and retries only its selected member after fresh consent", async () => {
        let fail = true;
        const fixture = await comparisonReady({ respond: async url => { if (fail && url.endsWith("/chat/completions")) throw new TypeError("fixture dropped response"); return null; } });
        await expect(fixture.core.generateComparison(fixture.id, fixture.consent)).rejects.toMatchObject({ code: "network", outcomeUnknown: true });
        const p = fixture.core.getSnapshot().projects[0]; const record = p.minutesComparisons![0]; expect(p.runs.at(-1)?.state).toBe("outcome-unknown"); expect(fixture.requests).toHaveLength(1);
        await fixture.core.selectComparison(fixture.id, record.id, 0);
        await expect(fixture.core.generateComparison(fixture.id, fixture.consent)).rejects.toMatchObject({ code: "invalid-input" });
        fail = false; await fixture.core.generateComparison(fixture.id, { ...fixture.consent, consentToken: fixture.core.getSnapshot().comparisonConsentToken! });
        const saved = fixture.core.getSnapshot().projects[0]; expect(fixture.requests.map(request => request.model)).toEqual([model.id, model.id]);
        expect(saved.minutesComparisons![0].members.map(member => member.attempts.length)).toEqual([2, 0]);
        expect(saved.runs.some(run => run.id === record.members[0].attempts[0].runId && run.state === "outcome-unknown")).toBe(true);
    });
    it("keeps old encrypted projects compatible without creating comparisons or replaying inference on open", async () => {
        const fixture = await transcribed(); await minutesReady(fixture); await fixture.core.lock(); await fixture.core.unlock(secret);
        expect(fixture.core.getSnapshot().projects[0].minutesComparisons).toBeUndefined();
        await fixture.core.setComparisonView(fixture.id, true);
        expect(fixture.core.getSnapshot().projects[0].minutesComparisons).toBeUndefined(); expect(fixture.core.getSnapshot().comparisonConsentToken).toBeNull();
        expect(fixture.calls.filter(url => url.endsWith("/chat/completions"))).toHaveLength(0);
    });
    it.each(['missing ranges', 'unresolved alternatives'] as const)("requires partial consent only for missing speech and preserves %s history in comparison", async kind => {
        let session!: ReturnType<typeof createVaultSession>;
        const fixture = await comparisonReady({ factory: options => { session = createVaultSession(options); return session; } });
        const p = fixture.core.getSnapshot().projects[0];
        const partial = { ...p, transcriptVersions: p.transcriptVersions.map(version => kind === 'missing ranges' ? ({ ...version, missingRanges: [[1000, 2000] as const] }) : ({ ...version, issues: [{ id: 'uncertain', rangeMs: [0, 1000] as const, selected: null, alternatives: [[version.segments[0]], [{ ...version.segments[0], text: 'Unresolved opposite decision' }]] }] })) };
        await session.store.checkpoint({ project: partial, runId: null, audioRecords: [] }, createJobContext());
        await fixture.core.lock(); await fixture.core.unlock(secret); await fixture.core.refreshModels();
        await fixture.core.setComparisonB(fixture.id, modelB.id, endpointB.tag); await fixture.core.setComparisonView(fixture.id, true);
        const consent = { ...fixture.consent, consentToken: fixture.core.getSnapshot().comparisonConsentToken! };
        if (kind === 'missing ranges') {
            await expect(fixture.core.generateComparison(fixture.id, consent)).rejects.toMatchObject({ code: "invalid-input" }); expect(fixture.requests).toHaveLength(0);
            await fixture.core.generateComparison(fixture.id, { ...consent, partialAcknowledged: true });
        } else await fixture.core.generateComparison(fixture.id, consent);
        const saved = fixture.core.getSnapshot().projects[0];
        if (kind === 'missing ranges') {
            expect(saved.minutesComparisons![0].transcript.missingRanges).toEqual([[1000, 2000]]);
            expect(saved.minutesRuns.every(run => run.generatedMarkdown.includes("Missing source ranges: 1000–2000 ms"))).toBe(true);
        } else {
            expect(saved.minutesComparisons![0].transcript.issues).toEqual(partial.transcriptVersions[0].issues);
            expect(saved.minutesComparisons![0].messages[1].content).not.toContain('Unresolved opposite decision');
            expect(saved.minutesRuns.every(run => !run.generatedMarkdown.includes('Incomplete transcript'))).toBe(true);
        }
    });
    it.each(["frozen record", "A intent", "B result"])("stops new calls on failed %s checkpoint and preserves recovery", async stage => {
        let deny = true;
        const fixture = await comparisonReady({ factory: interceptCheckpoint(async write => {
            const comparison = write.project.minutesComparisons?.[0];
            if (!comparison || !deny) return;
            if ((stage === "frozen record" && !comparison.members[0].attempts.length) || (stage === "A intent" && comparison.members[0].attempts.length === 1 && !write.project.minutesRuns.length) || (stage === "B result" && write.project.minutesRuns.length === 2)) throw new Error("fixture checkpoint denied");
        }) });
        await expect(fixture.core.generateComparison(fixture.id, fixture.consent)).rejects.toMatchObject({ code: "storage" });
        expect(fixture.requests).toHaveLength(stage === "B result" ? 2 : 0);
        deny = false; await fixture.core.lock(); await fixture.core.unlock(secret);
        const p = fixture.core.getSnapshot().projects[0]; expect(p.minutesComparisons).toHaveLength(1);
        expect(p.minutesRuns).toHaveLength(stage === "B result" ? 2 : 0);
        if (stage === "B result") expect(p.runs.filter(run => run.intent?.kind === "minutes").map(run => run.state)).toEqual(["saved", "saved"]);
        expect(fixture.requests).toHaveLength(stage === "B result" ? 2 : 0);
    });
    it("rejects retry of saved A and blocks B retry when current caps no longer fit its original budget", async () => {
        let reduced = false;
        const fixture = await comparisonReady({ respond: async (url, init) => {
            if (url.endsWith("/chat/completions") && JSON.parse(String(init?.body)).model === modelB.id) return new Response('{"error":{"message":"fixture failure"}}', { status: 503 });
            if (reduced && url.endsWith("/endpoints") && url.includes("model-b")) return new Response(JSON.stringify({ data: { id: String(url).split("/models/")[1].replace("/endpoints", ""), endpoints: [{ ...endpointB, max_completion_tokens: 1000 }] } }));
            return null;
        } });
        await expect(fixture.core.generateComparison(fixture.id, fixture.consent)).rejects.toThrow();
        const record = fixture.core.getSnapshot().projects[0].minutesComparisons![0];
        await expect(fixture.core.selectComparison(fixture.id, record.id, 0)).rejects.toMatchObject({ code: "invalid-input" });
        await fixture.core.selectComparison(fixture.id, record.id, 1); const retryConsent = { ...fixture.consent, consentToken: fixture.core.getSnapshot().comparisonConsentToken! };
        reduced = true; await fixture.core.refreshModels();
        expect(fixture.core.getSnapshot().minutesComparison?.outputTokens).toBe(1500); expect(fixture.core.getSnapshot().minutesComparison?.status).toBe("choose-model");
        const changed = fixture.core.getSnapshot().modelManagement!.rows.find(row => row.route.endpointTag === endpointB.tag)!; await fixture.core.acceptModelMetadata(changed.key, fixture.core.getSnapshot().modelManagement!.revision!); expect(fixture.core.getSnapshot().minutesComparison?.status).toBe("overflow");
        await expect(fixture.core.generateComparison(fixture.id, retryConsent)).rejects.toThrow(); expect(fixture.requests).toHaveLength(2);
    });
    it("cancels an active A, marks its unknown outcome and never starts B after the late response", async () => {
        const reached = deferred<void>(); const release = deferred<void>();
        const fixture = await comparisonReady({ respond: async url => { if (!url.endsWith("/chat/completions")) return null; reached.resolve(); await release.promise; return new Response(JSON.stringify({ choices: [{ message: { content: "# Cancelled fixture" }, finish_reason: "stop" }] })); } });
        const generating = fixture.core.generateComparison(fixture.id, fixture.consent); const rejected = expect(generating).rejects.toThrow(); await reached.promise;
        fixture.core.getSnapshot().onCancelMinutes!(); await rejected;
        await vi.waitFor(() => expect(fixture.core.getSnapshot().busy).toBe(false));
        release.resolve(); await Promise.resolve();
        expect(fixture.requests).toHaveLength(1); const p = fixture.core.getSnapshot().projects[0]; expect(p.runs.at(-1)?.state).toBe("outcome-unknown"); expect(p.minutesRuns).toHaveLength(0);
        expect(p.minutesComparisons![0].members[1].attempts).toHaveLength(0);
    });
    it("dispatches identical full prompts and common cap only after explicit consent, checkpointing A before B", async () => {
        const checkpoints: Parameters<ReturnType<typeof createVaultSession>["store"]["checkpoint"]>[0][] = [];
        const fixture = await comparisonReady({ factory: interceptCheckpoint(async write => { checkpoints.push(write); }) });
        expect(fixture.requests).toHaveLength(0); expect(fixture.core.getSnapshot().minutesComparison?.outputTokens).toBe(1500);
        await fixture.core.generateComparison(fixture.id, fixture.consent);
        expect(fixture.requests).toHaveLength(2);
        expect(fixture.requests[0].messages).toEqual(fixture.requests[1].messages);
        expect(fixture.requests.map(request => request.max_tokens)).toEqual([1500, 1500]);
        const p = fixture.core.getSnapshot().projects[0]; const comparison = p.minutesComparisons![0];
        expect(comparison.members.map(member => member.attempts.length)).toEqual([1, 1]);
        expect(comparison.members.map(member => p.runs.find(run => run.id === member.attempts[0].runId)?.state)).toEqual(["saved", "saved"]);
        const bIntent = checkpoints.find(write => write.project.minutesComparisons?.[0].members[1].attempts.length === 1)!;
        expect(bIntent.project.runs.find(run => run.id === comparison.members[0].attempts[0].runId)?.state).toBe("saved");
        expect(p.minutesRuns.map(run => [run.actualProvider, run.usage.costKind, run.usage.currency])).toEqual([["FixtureProvider", "reported", "credits"], ["FixtureB", "estimated", "USD"]]);
    });
    it("retains saved A when B fails and explicitly retries only B with frozen original input", async () => {
        let failB = true;
        const fixture = await comparisonReady({ respond: async (url, init) => url.endsWith("/chat/completions") && JSON.parse(String(init?.body)).model === modelB.id && failB ? new Response(JSON.stringify({ error: { message: "fixture fail" } }), { status: 503 }) : null });
        await expect(fixture.core.generateComparison(fixture.id, fixture.consent)).rejects.toThrow();
        let p = fixture.core.getSnapshot().projects[0]; const comparison = p.minutesComparisons![0];
        expect(p.minutesRuns).toHaveLength(1); expect(comparison.members[1].attempts).toHaveLength(1);
        await fixture.core.setMinutesSettings(fixture.id, { ...p.minutesSettings, instructions: "Later settings must not replace frozen original" });
        await fixture.core.selectComparison(fixture.id, comparison.id, 1);
        const oldRetryToken = fixture.core.getSnapshot().comparisonConsentToken!;
        await fixture.core.setMinutesSettings(fixture.id, { ...fixture.core.getSnapshot().projects[0].minutesSettings, outputLanguageMode: "explicit", outputLanguage: "ja" });
        await expect(fixture.core.generateComparison(fixture.id, { ...fixture.consent, consentToken: oldRetryToken })).rejects.toMatchObject({ code: "invalid-input" });
        expect(fixture.requests).toHaveLength(2);
        failB = false;
        await fixture.core.generateComparison(fixture.id, { ...fixture.consent, consentToken: fixture.core.getSnapshot().comparisonConsentToken! });
        p = fixture.core.getSnapshot().projects[0];
        expect(fixture.requests.map(request => request.model)).toEqual([model.id, modelB.id, modelB.id]);
        expect(fixture.requests[2].messages).toEqual(fixture.requests[0].messages);
        expect(p.minutesComparisons![0].members.map(member => member.attempts.length)).toEqual([1, 2]);
        expect(p.minutesRuns).toHaveLength(2);
        await fixture.core.lock(); await fixture.core.unlock(secret);
        expect(fixture.requests).toHaveLength(3); expect(fixture.core.getSnapshot().projects[0].minutesComparisons).toHaveLength(1);
    });
    it.each(["duplicate", "overflow", "stale", "unknown-total"])("blocks both calls for %s until requirements are satisfied", async mode => {
        const fixture = await comparisonReady({ respond: async url => mode === "unknown-total" && url.endsWith("/endpoints") && url.includes("model-b") ? new Response(JSON.stringify({ data: { id: String(url).split("/models/")[1].replace("/endpoints", ""), endpoints: [{ ...endpointB, pricing: { prompt: "0", completion: "0" } }] } })) : null });
        if (mode === "duplicate") await fixture.core.setComparisonB(fixture.id, model.id, endpoint.tag);
        if (mode === "overflow") await fixture.core.setMinutesSettings(fixture.id, { ...fixture.core.getSnapshot().projects[0].minutesSettings, instructions: "x".repeat(30000) });
        if (mode === "stale") await fixture.core.refreshModels();
        await expect(fixture.core.generateComparison(fixture.id, fixture.consent)).rejects.toThrow();
        expect(fixture.requests).toHaveLength(0);
        if (mode === "unknown-total") {
            await fixture.core.generateComparison(fixture.id, { ...fixture.consent, unknownTotalAcknowledged: true });
            expect(fixture.requests).toHaveLength(2);
        }
    });
    it("stops before B when A encrypted result checkpoint fails, then lock recovery retains it", async () => {
        let deny = true;
        const fixture = await comparisonReady({ factory: interceptCheckpoint(async write => { if (deny && write.project.minutesRuns.length === 1) throw new Error("fixture storage failure"); }) });
        await expect(fixture.core.generateComparison(fixture.id, fixture.consent)).rejects.toMatchObject({ code: "storage" });
        expect(fixture.requests).toHaveLength(1); deny = false;
        await fixture.core.lock(); await fixture.core.unlock(secret);
        const p = fixture.core.getSnapshot().projects[0]; expect(p.minutesRuns).toHaveLength(1); expect(p.runs.at(-1)?.state).toBe("saved");
        expect(p.minutesComparisons![0].members[0].attempts[0].revisionId).toBe(p.minutesRevisions[0].id);
        expect(fixture.requests).toHaveLength(1);
    });
    it("fences a late A response after lock and restores its unknown attempt without replay", async () => {
        const reached = deferred<void>(); const release = deferred<void>();
        const fixture = await comparisonReady({ respond: async url => { if (!url.endsWith("/chat/completions")) return null; reached.resolve(); await release.promise; return new Response(JSON.stringify({ choices: [{ message: { content: "# Late fixture" }, finish_reason: "stop" }] })); } });
        const generating = fixture.core.generateComparison(fixture.id, fixture.consent); const rejected = expect(generating).rejects.toThrow();
        await reached.promise; await fixture.core.lock();
        expect(fixture.core.getSnapshot().minutesComparison).toBeNull(); expect(fixture.core.getSnapshot().projects).toEqual([]);
        release.resolve(); await rejected; await fixture.core.unlock(secret);
        expect(fixture.requests).toHaveLength(1); const p = fixture.core.getSnapshot().projects[0];
        expect(p.minutesRuns).toHaveLength(0); expect(p.runs.at(-1)?.state).toBe("outcome-unknown");
        expect(p.minutesComparisons![0].members[0].attempts).toHaveLength(1);
    });
});
describe("production controller keyless vertical slice", () => {
    it.each(['idle autosave', 'paid work'] as const)("restores title-save exclusivity after cancellation: %s", async mode => {
        const reached = deferred<void>(); const release = deferred<void>();
        const paidReached = deferred<void>(); const paidRelease = deferred<void>();
        let hold = false; let vault!: ReturnType<typeof createVaultSession>;
        const fixture = await opened({ factory: options => {
            vault = interceptCheckpoint(async write => {
                if (hold && write.project.title === "Title before cancellation") {
                    hold = false; reached.resolve(); await release.promise;
                }
            })(options); return vault;
        }, respond: async url => {
            if (url.endsWith('/audio/transcriptions')) { paidReached.resolve(); await paidRelease.promise; }
            return null;
        } });
        const id = await fixture.core.createMeeting();
        if (mode === 'paid work') {
            await fixture.core.importFile(id, wav()); await fixture.core.prepareAudio(id);
            await fixture.core.saveKey('openai', 'KEYLESS_OPENAI_TEST', 'encrypted');
        }
        hold = true;
        fixture.core.getSnapshot().onUpdateMeeting!(id, { title: "Title before cancellation" });
        fixture.core.getSnapshot().onNavigate!('stt', id);
        await reached.promise;
        expect(fixture.core.getSnapshot().screen).toBe('stt');
        fixture.core.getSnapshot().onCancelSTT!(id); release.resolve();
        await vi.waitFor(() => expect(fixture.core.getSnapshot().busy).toBe(false));
        if (mode === 'idle autosave') {
            fixture.core.getSnapshot().onNavigate!('import', id);
            await vi.waitFor(() => expect(fixture.core.getSnapshot().screen).toBe('import'));
            fixture.core.getSnapshot().onUpdateMeeting!(id, { title: "Autosaved title after cancellation" });
            // Read the durable encrypted checkpoint before Lock could rescue a missed autosave.
            await vi.waitFor(async () => expect((await vault.store.listProjects(createJobContext()))[0].title).toBe("Autosaved title after cancellation"));
            await vi.waitFor(() => expect(fixture.core.getSnapshot().busy).toBe(false));
        } else {
            const request = fixture.core.startSTT(id, { modelId: 'gpt-transcribe', acknowledged: true });
            const settled = request.catch(() => { /* Always settle the held request before fixture teardown. */ });
            await paidReached.promise;
            try {
                fixture.core.getSnapshot().onUpdateMeeting!(id, { title: "Must not enter a paid request snapshot" });
                expect(fixture.core.getSnapshot().projects[0].title).toBe("Title before cancellation");
            } finally { paidRelease.resolve(); await settled; }
            await request;
            expect((await vault.store.listProjects(createJobContext()))[0].title).toBe("Title before cancellation");
        }
        await fixture.core.lock(); await fixture.core.unlock(secret);
        expect(fixture.core.getSnapshot().projects[0].title).toBe(mode === 'idle autosave' ? "Autosaved title after cancellation" : "Title before cancellation");
    });
    it("preserves newer meeting title edits through an older encrypted autosave receipt and reload", async () => {
        const reached = deferred<void>(); const release = deferred<void>(); let hold = false;
        const fixture = await opened({ factory: interceptCheckpoint(async write => {
            if (hold && write.project.title === "First title") { reached.resolve(); await release.promise; hold = false; }
        }) });
        const id = await fixture.core.createMeeting(); hold = true;
        fixture.core.getSnapshot().onUpdateMeeting!(id, { title: "First title" }); await reached.promise;
        try {
            expect(fixture.core.getSnapshot().busy).toBe(true);
            fixture.core.getSnapshot().onUpdateMeeting!(id, { icon: 'calendar' });
            expect(fixture.core.getSnapshot().projects[0].icon).not.toBe('calendar');
            fixture.core.getSnapshot().onUpdateMeeting!(id, { title: "Newest complete 한글 title" });
            expect(fixture.core.getSnapshot().projects[0].title).toBe("Newest complete 한글 title");
        } finally { release.resolve(); }
        await vi.waitFor(() => expect(fixture.core.getSnapshot().busy).toBe(false));
        await fixture.core.lock(); await fixture.core.unlock(secret);
        expect(fixture.core.getSnapshot().projects[0].title).toBe("Newest complete 한글 title");
    });
    it.each(['lock', 'storage failure'] as const)("keeps the newest title pending through %s during its own autosave", async mode => {
        const reached = deferred<void>(); const release = deferred<void>(); let hold = false;
        const fixture = await opened({ factory: interceptCheckpoint(async write => {
            if (hold && write.project.title === "Old held title") {
                reached.resolve(); await release.promise; hold = false;
                if (mode === 'storage failure') throw new Error('Synthetic encrypted save failure');
            }
        }) });
        const id = await fixture.core.createMeeting(); hold = true;
        fixture.core.getSnapshot().onUpdateMeeting!(id, { title: "Old held title" }); await reached.promise;
        try {
            fixture.core.getSnapshot().onUpdateMeeting!(id, { title: "Latest lock checkpoint title" });
            expect(fixture.core.getSnapshot().projects[0].title).toBe("Latest lock checkpoint title");
        } finally { release.resolve(); }
        if (mode === 'storage failure') {
            await vi.waitFor(() => expect(fixture.core.getSnapshot().error).toMatch(/저장|saving/));
            expect(fixture.core.getSnapshot().busy).toBe(true);
        }
        await fixture.core.lock();
        expect(fixture.core.getSnapshot().projects).toEqual([]);
        await fixture.core.unlock(secret);
        expect(fixture.core.getSnapshot().projects[0].title).toBe("Latest lock checkpoint title");
    });
    it("checkpoints text typed during asynchronous consent hashing before autosave finishes", async () => {
        const instructions: string[] = []; const reached = deferred<void>(); const release = deferred<void>(); let hold = false;
        const fixture = await transcribed({ factory: interceptCheckpoint(async write => { instructions.push(write.project.minutesSettings.instructions); }) });
        await minutesReady(fixture);
        const digest = crypto.subtle.digest.bind(crypto.subtle);
        vi.spyOn(crypto.subtle, "digest").mockImplementation(async (algorithm, data) => {
            if (hold && new TextDecoder().decode(data as Uint8Array).includes('"instructions":"Before refresh"')) { hold = false; reached.resolve(); await release.promise; }
            return digest(algorithm, data);
        });
        hold = true; fixture.core.setMinutesInstructions(fixture.id, "Before refresh"); await reached.promise;
        fixture.core.setMinutesInstructions(fixture.id, "Typed during hash 한글"); release.resolve();
        await vi.waitFor(() => expect(fixture.core.getSnapshot().busy).toBe(false));
        expect(instructions.at(-1)).toBe("Typed during hash 한글");
        expect(fixture.core.getSnapshot().projects[0].minutesSettings.instructions).toBe("Typed during hash 한글");
    });
    it("preserves newer instructions typed while an older encrypted checkpoint resolves", async () => {
        const reached = deferred<void>(); const release = deferred<void>(); let hold = true;
        const fixture = await transcribed({ factory: interceptCheckpoint(async write => { if (hold && write.project.minutesSettings.instructions === "First instructions") { reached.resolve(); await release.promise; hold = false; } }) });
        await minutesReady(fixture);
        fixture.core.setMinutesInstructions(fixture.id, "First instructions"); await reached.promise;
        expect(fixture.core.getSnapshot().minutesInstructionsSaving).toBe(true);
        fixture.core.setMinutesInstructions(fixture.id, "Newest complete 한글 instructions", true);
        release.resolve(); await vi.waitFor(() => expect(fixture.core.getSnapshot().busy).toBe(false));
        expect(fixture.core.getSnapshot().projects[0].minutesSettings.instructions).toBe("Newest complete 한글 instructions");
        await fixture.core.lock(); await fixture.core.unlock(secret);
        expect(fixture.core.getSnapshot().projects[0].minutesSettings.instructions).toBe("Newest complete 한글 instructions");
        await fixture.core.refreshModels();
        await fixture.core.generateMinutes(fixture.id, { acknowledged: true, transcriptVersionId: fixture.core.getSnapshot().projects[0].selectedTranscriptVersionId!, consentToken: fixture.core.getSnapshot().minutesConsentToken!, partialAcknowledged: false });
        expect(fixture.core.getSnapshot().projects[0].minutesRuns[0].settings.instructions).toBe("Newest complete 한글 instructions");
    });
    it("stops new work after instructions autosave failure and retains full text for lock recovery", async () => {
        let deny = true;
        const fixture = await transcribed({ factory: interceptCheckpoint(async write => { if (deny && write.project.minutesSettings.instructions === "Full failed save 한글") throw new Error("fixture denied"); }) });
        const consent = await minutesReady(fixture); fixture.core.setMinutesInstructions(fixture.id, "Full failed save 한글");
        await vi.waitFor(() => expect(fixture.core.getSnapshot().error).not.toBeNull());
        expect(fixture.core.getSnapshot().busy).toBe(true); expect(fixture.core.getSnapshot().minutesConsentToken).toBeNull();
        expect(fixture.core.getSnapshot().projects[0].minutesSettings.instructions).toBe("Full failed save 한글");
        await expect(fixture.core.generateMinutes(fixture.id, consent)).rejects.toMatchObject({ code: "storage" });
        deny = false; await fixture.core.lock(); await fixture.core.unlock(secret);
        expect(fixture.core.getSnapshot().projects[0].minutesSettings.instructions).toBe("Full failed save 한글");
        expect(fixture.calls.filter(url => url.endsWith("/chat/completions"))).toHaveLength(0);
    });
    it("stages complete composing instructions, invalidates consent immediately and encrypts them on lock", async () => {
        const fixture = await transcribed(); const consent = await minutesReady(fixture);
        fixture.core.setMinutesInstructions(fixture.id, "한글 전체 작성 지침", true);
        expect(fixture.core.getSnapshot().projects[0].minutesSettings.instructions).toBe("한글 전체 작성 지침");
        expect(fixture.core.getSnapshot().minutesConsentToken).toBeNull();
        await fixture.core.lock(); await fixture.core.unlock(secret);
        expect(fixture.core.getSnapshot().projects[0].minutesSettings.instructions).toBe("한글 전체 작성 지침");
        await expect(fixture.core.generateMinutes(fixture.id, consent)).rejects.toMatchObject({ code: "invalid-input" });
        expect(fixture.calls.filter(url => url.endsWith("/chat/completions"))).toHaveLength(0);
    });
    it("activates the real encrypted vault in the visible test browser", async () => {
        const session = createVaultSession({ indexedDB: new IDBFactory(), databaseName: crypto.randomUUID(), testOnlyOwnership: { acquire: async () => () => { } } });
        try {
            await session.create(secret, secret);
            expect(session.state).toBe("unlocked");
        }
        finally {
            await session.dispose();
        }
    });
    it("keeps storage estimation optional when the browser denies that read-only metadata", async () => {
        vi.stubGlobal("navigator", { storage: { estimate: async () => { throw new Error("KEYLESS_ESTIMATE_DENIED"); } } });
        const { core } = await opened();
        expect(core.getSnapshot().session).toBe("unlocked");
        expect(core.getSnapshot().storageEstimate).toBeNull();
    });
    it("closes the unlocked session when encrypted project restoration fails", async () => {
        let deny = true;
        const { core } = setup({ factory: (options = {}) => {
                const session = createVaultSession(options);
                return new Proxy(session, { get(target, key) {
                        if (key !== "store")
                            return Reflect.get(target, key);
                        const store = target.store;
                        return { ...store, async listProjects(job) {
                                if (deny)
                                    throw new Error("KEYLESS_RESTORE_FAILURE");
                                return store.listProjects(job);
                            } } satisfies typeof store;
                    } });
            } });
        await core.initialize();
        await expect(core.createVault(secret)).rejects.toThrow();
        expect(core.getSnapshot().session).toBe("locked");
        expect(core.getSnapshot().projects).toEqual([]);
        deny = false;
        await core.unlock(secret);
        expect(core.getSnapshot().session).toBe("unlocked");
    });
    it("uses real encoded chunks, encrypted STT checkpoints, immutable transcript/minutes edits and exact selected output", async () => {
        const { core, calls, id } = await transcribed();
        let p = core.getSnapshot().projects.find((item) => item.id === id)!;
        expect(p.preparedChunks[0].codec).toBe("mp3");
        expect(p.rawTranscripts[0].execution?.requestedModel).toBe("gpt-transcribe");
        expect(p.runs[0].state).toBe("saved");
        expect(p.transcriptVersions).toHaveLength(1);
        const version = p.transcriptVersions[0];
        await core.editTranscript(id, version.id, version.segments[0].id, "Keyless edited speech: decision cancelled.");
        p = core.getSnapshot().projects.find((item) => item.id === id)!;
        expect(p.transcriptVersions).toHaveLength(2);
        expect(p.rawTranscripts[0].text).toContain("continue investigation");
        await core.saveKey("openrouter", "KEYLESS_ROUTER_TEST", "encrypted");
        await core.refreshModels();
        await enableMinutes({ core } as Awaited<ReturnType<typeof transcribed>>);
        await core.setMinutesSettings(id, { ...p.minutesSettings, modelId: model.id, outputLanguageMode: "explicit", outputLanguage: "fr", sections: ["summary", "decisions"] });
        expect(core.getSnapshot().minutesEndpointTag).toBeNull();
        await core.selectMinutesEndpoint(id, endpoint.tag);
        const token = core.getSnapshot().minutesConsentToken!;
        await core.generateMinutes(id, { acknowledged: true, transcriptVersionId: p.selectedTranscriptVersionId!, consentToken: token, partialAcknowledged: false });
        p = core.getSnapshot().projects.find((item) => item.id === id)!;
        expect(p.minutesRuns).toHaveLength(1);
        expect(p.minutesRuns[0].transcriptVersionId).toBe(p.selectedTranscriptVersionId);
        expect(p.minutesRuns[0].settings.outputLanguage).toBe("fr");
        expect(p.runs.at(-1)?.state).toBe("saved");
        const generated = p.minutesRevisions[0];
        await core.editMinutes(id, generated.id, "# Keyless edited minutes\n\nExact Unicode: 한글\n");
        p = core.getSnapshot().projects.find((item) => item.id === id)!;
        expect(p.minutesRevisions).toHaveLength(2);
        expect(p.minutesRuns[0].generatedMarkdown).toContain("decision was cancelled");
        expect(p.minutesRevisions.at(-1)?.parentId).toBe(generated.id);
        expect(calls.filter((url) => url.endsWith("/audio/transcriptions"))).toHaveLength(1);
        expect(calls.filter((url) => url.endsWith("/chat/completions"))).toHaveLength(1);
    });
    it("clears sensitive state and URLs synchronously on lock, reloads encrypted work without replay, and preserves saved keys", async () => {
        const { core, id, revoked, indexedDB, databaseName, calls } = await transcribed();
        const oldPreview = core.getSnapshot().sourcePreviewUrl;
        const locked = core.lock();
        expect(core.getSnapshot().projects).toEqual([]);
        expect(core.getSnapshot().sourcePreviewUrl).toBeNull();
        await locked;
        expect(revoked).toContain(oldPreview);
        await core.unlock(secret);
        expect(core.getSnapshot().projects[0].title).toBe("KEYLESS_PRIVATE_TITLE");
        expect(calls.filter((url) => url.endsWith("/audio/transcriptions"))).toHaveLength(1);
        await core.lock();
        const reloaded = setup({ indexedDB, databaseName });
        await reloaded.core.initialize();
        expect(reloaded.core.getSnapshot().session).toBe("locked");
        await reloaded.core.unlock(secret);
        expect(reloaded.core.getSnapshot().projects.find((p) => p.id === id)?.rawTranscripts).toHaveLength(1);
        expect(reloaded.calls.filter((url) => url.endsWith("/audio/transcriptions"))).toHaveLength(0);
        expect(reloaded.core.getSnapshot().connections.find((item) => item.provider === "openai")?.status).toBe("saved");
    });
    it("rejects stale minutes consent and stops before provider transmission", async () => {
        const { core, id, calls } = await transcribed();
        await core.saveKey("openrouter", "KEYLESS_ROUTER_TEST", "encrypted");
        await core.refreshModels();
        await enableMinutes({ core } as Awaited<ReturnType<typeof transcribed>>);
        const p = core.getSnapshot().projects[0];
        await core.setMinutesSettings(id, { ...p.minutesSettings, modelId: model.id });
        await core.selectMinutesEndpoint(id, endpoint.tag);
        const oldToken = core.getSnapshot().minutesConsentToken!;
        await core.setMinutesSettings(id, { ...core.getSnapshot().projects[0].minutesSettings, outputLanguageMode: "explicit", outputLanguage: "ja" });
        await expect(core.generateMinutes(id, { acknowledged: true, transcriptVersionId: p.selectedTranscriptVersionId!, consentToken: oldToken, partialAcknowledged: true })).rejects.toThrow();
        expect(calls.filter((url) => url.endsWith("/chat/completions"))).toHaveLength(0);
    });
    it.each(["price", "limit", "output budget", "unsupported billing", "same metadata"])("refreshes metadata read-only and rejects stale consent for changed %s before inference", async change => {
        vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-01T00:00:00.000Z"));
        let refreshed = false;
        const fixture = await transcribed({ respond: async url => {
            if (!refreshed || !url.endsWith("/endpoints")) return null;
            const updated = change === "price" ? { ...endpoint, pricing: { ...endpoint.pricing, prompt: "0.001" } }
                : change === "limit" ? { ...endpoint, max_prompt_tokens: 20000 }
                : change === "output budget" ? { ...endpoint, max_completion_tokens: 1024 }
                : change === "unsupported billing" ? { ...endpoint, pricing: { ...endpoint.pricing, reasoning: "0.001" } } : endpoint;
            return new Response(JSON.stringify({ data: { id: String(url).split("/models/")[1].replace("/endpoints", ""), endpoints: [updated] } }));
        } });
        const consent = await minutesReady(fixture);
        expect(fixture.core.getSnapshot()).toHaveProperty("minutesSelection.status", "fits");
        expect(fixture.core.getSnapshot()).toHaveProperty("minutesSelection.limits.outputTokens", 4096);
        const before = fixture.calls.length; refreshed = true;
        await fixture.core.refreshModels();
        expect(fixture.calls.slice(before).every(url => url.endsWith("/models") || url.endsWith("/endpoints"))).toBe(true);
        expect(fixture.calls.slice(before).some(url => url.endsWith("/endpoints"))).toBe(true);
        expect(fixture.core.getSnapshot().minutesConsentToken).not.toBe(consent.consentToken);
        if (change === "output budget") expect(fixture.core.getSnapshot()).toHaveProperty("minutesSelection.limits.outputTokens", 1024);
        if (change === "unsupported billing") expect(fixture.core.getSnapshot()).toHaveProperty("minutesSelection.projection.total", null);
        await expect(fixture.core.generateMinutes(fixture.id, consent)).rejects.toMatchObject({ code: "invalid-input" });
        expect(fixture.calls.filter(url => url.endsWith("/chat/completions"))).toHaveLength(0);
    });
    it.each(["price", "limit", "output budget", "unsupported billing"])("binds %s in consent even when metadata checked time and refresh revision are unchanged", async change => {
        vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-01T00:00:00.000Z"));
        let changed = false;
        const fixture = await transcribed({ respond: async url => {
            if (!changed || !url.endsWith("/endpoints")) return null;
            const updated = change === "price" ? { ...endpoint, pricing: { ...endpoint.pricing, request: "0.02" } }
                : change === "limit" ? { ...endpoint, max_prompt_tokens: 20000 }
                : change === "output budget" ? { ...endpoint, max_completion_tokens: 1024 }
                : { ...endpoint, pricing: { ...endpoint.pricing, cache_read: "0.001" } };
            return new Response(JSON.stringify({ data: { id: String(url).split("/models/")[1].replace("/endpoints", ""), endpoints: [updated] } }));
        } });
        const consent = await minutesReady(fixture);
        await fixture.core.lock(); changed = true; await fixture.core.unlock(secret);
        expect(fixture.core.getSnapshot().minutesConsentToken).not.toBe(consent.consentToken);
        await expect(fixture.core.generateMinutes(fixture.id, consent)).rejects.toMatchObject({ code: "invalid-input" });
        expect(fixture.calls.filter(url => url.endsWith("/chat/completions"))).toHaveLength(0);
    });
    it("clears the metadata preview on lock and refuses a late refresh replacement", async () => {
        let hold = false;
        const reached = deferred<void>(); const release = deferred<void>();
        const fixture = await transcribed({ respond: async url => {
            if (hold && url.endsWith("/endpoints")) { reached.resolve(); await release.promise; return new Response(JSON.stringify({ data: { id: String(url).split("/models/")[1].replace("/endpoints", ""), endpoints: [endpoint] } })); }
            return null;
        } });
        await minutesReady(fixture);
        expect(fixture.core.getSnapshot()).toHaveProperty("minutesSelection.status", "fits");
        hold = true;
        const request = fixture.core.refreshModels(); const rejected = request.catch(() => undefined);
        await vi.waitFor(() => expect(fixture.calls.filter(url => url.endsWith("/models")).length).toBeGreaterThan(0));
        // A metadata refresh invalidates acknowledgement as soon as it begins.
        await vi.waitFor(() => expect(fixture.core.getSnapshot().minutesConsentToken).toBeNull());
        await reached.promise;
        const locked = fixture.core.lock();
        expect(fixture.core.getSnapshot()).toHaveProperty("minutesSelection", null);
        release.resolve(); await rejected; await locked;
        expect(fixture.core.getSnapshot()).toHaveProperty("minutesSelection", null);
        expect(fixture.core.getSnapshot().minutesEndpoints).toEqual([]);
        expect(fixture.calls.filter(url => url.endsWith("/chat/completions"))).toHaveLength(0);
    });
    it("accepts consecutive title keystrokes without disabling the input and encrypts the latest draft on immediate lock", async () => {
        const { core } = await opened();
        const id = await core.createMeeting();
        for (const title of ["K", "Ke", "Key", "Keyless complete title"]) {
            core.getSnapshot().onUpdateMeeting!(id, { title });
            expect(core.getSnapshot().busy).toBe(false);
            expect(core.getSnapshot().projects[0].title).toBe(title);
        }
        await core.lock();
        await core.unlock(secret);
        expect(core.getSnapshot().projects[0].title).toBe("Keyless complete title");
    });
    it("does not resurrect a deleted meeting from a pending title draft on lock", async () => {
        const { core } = await opened();
        const id = await core.createMeeting();
        core.getSnapshot().onUpdateMeeting!(id, { title: "KEYLESS_DELETED_DRAFT" });
        core.getSnapshot().onDeleteMeeting!(id);
        await vi.waitFor(() => expect(core.getSnapshot().projects).toEqual([]));
        await core.lock();
        await core.unlock(secret);
        expect(core.getSnapshot().projects).toEqual([]);
    });
    it("persists and freezes minutes intent before dispatch, then preserves the raw successful response", async () => {
        const reached = deferred<void>();
        const release = deferred<void>();
        let armed = false;
        const fixture = await transcribed({ factory: interceptCheckpoint(async (write) => {
                if (armed && write.runId === null && write.project.runs.at(-1)?.intent?.kind === "minutes") {
                    reached.resolve();
                    await release.promise;
                }
            }) });
        const consent = await minutesReady(fixture);
        armed = true;
        const request = fixture.core.generateMinutes(fixture.id, consent);
        await reached.promise;
        expect(fixture.calls.filter((url) => url.endsWith("/chat/completions"))).toHaveLength(0);
        release.resolve();
        await request;
        const p = fixture.core.getSnapshot().projects[0];
        expect(p.runs.at(-1)?.intent?.rateSnapshot?.rates).toContainEqual({ unit: "request", units: 1, price: 0 });
        expect((p.minutesRuns[0] as unknown as {
            response: unknown;
        }).response).toHaveProperty("choices");
        expect(p.runs.at(-1)?.checkpoint?.runId).toBe(p.minutesRuns[0].id);
    });
    it("halts on failed durable minutes intent without sending, and reload never replays that intent", async () => {
        let armed = false;
        const fixture = await transcribed({ factory: interceptCheckpoint(async (write) => {
                if (armed && write.runId === null && write.project.runs.at(-1)?.intent?.kind === "minutes")
                    throw new Error("KEYLESS_STORAGE_FAILURE");
            }) });
        const consent = await minutesReady(fixture);
        armed = true;
        await expect(fixture.core.generateMinutes(fixture.id, consent)).rejects.toMatchObject({ code: "storage" });
        expect(fixture.calls.filter((url) => url.endsWith("/chat/completions"))).toHaveLength(0);
        expect(fixture.core.getSnapshot().busy).toBe(true);
        await expect(fixture.core.updateMeeting(fixture.id, { title: "must not overwrite pending" })).rejects.toMatchObject({ code: "storage" });
        await fixture.core.lock();
        await fixture.core.unlock(secret);
        expect(fixture.core.getSnapshot().projects[0].runs.at(-1)?.state).toBe("outcome-unknown");
        expect(fixture.calls.filter((url) => url.endsWith("/chat/completions"))).toHaveLength(0);
    });
    it("keeps a completed unsaved minutes snapshot for the lock finalizer instead of overwriting it", async () => {
        let armed = false;
        const fixture = await transcribed({ factory: interceptCheckpoint(async (write) => {
                if (armed && write.runId && write.project.minutesRuns.some((run) => run.id === write.runId))
                    throw new Error("KEYLESS_STORAGE_FAILURE");
            }) });
        const consent = await minutesReady(fixture);
        armed = true;
        await expect(fixture.core.generateMinutes(fixture.id, consent)).rejects.toMatchObject({ code: "storage" });
        expect(fixture.core.getSnapshot().projects[0].minutesRuns).toHaveLength(0);
        expect(fixture.core.getSnapshot().error).not.toContain("decision was cancelled");
        await fixture.core.lock();
        await fixture.core.unlock(secret);
        const p = fixture.core.getSnapshot().projects[0];
        expect(p.minutesRuns).toHaveLength(1);
        expect(p.runs.at(-1)?.state).toBe("saved");
        expect(fixture.calls.filter((url) => url.endsWith("/chat/completions"))).toHaveLength(1);
    });
    it("restores the encrypted original and prepares it after a reload before any chunks existed", async () => {
        const fixture = await opened();
        const id = await fixture.core.createMeeting();
        await fixture.core.importFile(id, wav());
        await fixture.core.saveKey("openai", "KEYLESS_OPENAI_TEST", "encrypted");
        await fixture.core.lock();
        const reloaded = setup({ indexedDB: fixture.indexedDB, databaseName: fixture.databaseName });
        await reloaded.core.initialize();
        await reloaded.core.unlock(secret);
        await reloaded.core.prepareAudio(id);
        await reloaded.core.startSTT(id, { modelId: "gpt-transcribe", acknowledged: true });
        expect(reloaded.core.getSnapshot().projects[0].rawTranscripts).toHaveLength(1);
        expect(reloaded.calls.filter((url) => url.endsWith("/audio/transcriptions"))).toHaveLength(1);
    });
    it("fences a dispatched STT response on lock and retains unknown intent without automatic replay", async () => {
        const reached = deferred<void>();
        const response = deferred<Response>();
        let sent = 0;
        const transport: typeof fetch = async (url) => {
            if (String(url).endsWith("/audio/transcriptions")) {
                sent++;
                reached.resolve();
                return response.promise;
            }
            return new Response(JSON.stringify({ data: [model] }));
        };
        const fixture = await opened({ fetch: transport });
        const id = await fixture.core.createMeeting();
        await fixture.core.importFile(id, wav());
        await fixture.core.saveKey("openai", "KEYLESS_OPENAI_TEST", "encrypted");
        await fixture.core.prepareAudio(id);
        const request = fixture.core.startSTT(id, { modelId: "gpt-transcribe", acknowledged: true });
        const failed = request.catch((error: unknown) => error);
        await reached.promise;
        await fixture.core.lock();
        response.resolve(new Response(JSON.stringify({ text: "LATE_KEYLESS_PRIVATE_SPEECH" })));
        await failed;
        expect(fixture.core.getSnapshot().projects).toEqual([]);
        await fixture.core.unlock(secret);
        const p = fixture.core.getSnapshot().projects[0];
        expect(p.rawTranscripts).toHaveLength(0);
        expect(p.runs[0].state).toBe("outcome-unknown");
        await expect(fixture.core.startSTT(id, { modelId: "gpt-transcribe", acknowledged: true })).rejects.toMatchObject({ code: "ambiguous-attempt" });
        expect(sent).toBe(1);
    });
    it("exports the selected edited Markdown exactly and reports clipboard failure without false success", async () => {
        const fixture = await transcribed();
        await fixture.core.generateMinutes(fixture.id, await minutesReady(fixture));
        const first = fixture.core.getSnapshot().projects[0].minutesRevisions[0];
        const markdown = "# Exact selected edit\n\n한글, café, 日本語\n";
        await fixture.core.editMinutes(fixture.id, first.id, markdown);
        const selected = fixture.core.getSnapshot().projects[0].minutesRevisions.at(-1)!;
        const writeText = vi.fn<(text: string) => Promise<void>>(async () => { });
        vi.stubGlobal("navigator", { clipboard: { writeText } });
        fixture.core.getSnapshot().onCopyMinutes!(fixture.id, selected.id);
        await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(markdown));
        await vi.waitFor(() => expect(fixture.core.getSnapshot().busy).toBe(false));
        expect(fixture.core.getSnapshot().notice).not.toBeNull();
        writeText.mockRejectedValueOnce(new Error("KEYLESS_CLIPBOARD_DENIED"));
        fixture.core.getSnapshot().onCopyMinutes!(fixture.id, selected.id);
        await vi.waitFor(() => expect(fixture.core.getSnapshot().error).not.toBeNull());
        expect(fixture.core.getSnapshot().notice).toBeNull();
        const anchor = { href: "", download: "", click: vi.fn(), remove: vi.fn() };
        vi.stubGlobal("document", { addEventListener: vi.fn(), removeEventListener: vi.fn(), createElement: () => anchor, body: { append: vi.fn() }, querySelectorAll: () => [] });
        const create = vi.spyOn(URL, "createObjectURL");
        fixture.core.getSnapshot().onDownloadMinutes!(fixture.id, selected.id);
        await vi.waitFor(() => expect(anchor.click).toHaveBeenCalledOnce());
        expect(anchor.download).toBe("KEYLESS_PRIVATE_TITLE.md");
        const blob = create.mock.calls[0][0] as Blob;
        expect(blob.type).toBe("text/markdown;charset=utf-8");
        expect(await blob.text()).toBe(markdown);
    });
    it("requires explicit partial acknowledgement bound to the selected transcript before minutes dispatch", async () => {
        let session: ReturnType<typeof createVaultSession> | null = null;
        const fixture = await transcribed({ factory: (options = {}) => { session = createVaultSession(options); return session; } });
        const original = fixture.core.getSnapshot().projects[0];
        const partial = { ...original.transcriptVersions[0], id: crypto.randomUUID(), parentId: original.transcriptVersions[0].id, missingRanges: [[800, 1000] as const] };
        await session!.store.checkpoint({ project: { ...original, transcriptVersions: [...original.transcriptVersions, partial], selectedTranscriptVersionId: partial.id }, runId: null, audioRecords: [] }, createJobContext());
        await fixture.core.lock();
        await fixture.core.unlock(secret);
        const consent = await minutesReady(fixture);
        await expect(fixture.core.generateMinutes(fixture.id, consent)).rejects.toThrow();
        expect(fixture.calls.filter((url) => url.endsWith("/chat/completions"))).toHaveLength(0);
        await fixture.core.generateMinutes(fixture.id, { ...consent, partialAcknowledged: true });
        const run = fixture.core.getSnapshot().projects[0].minutesRuns[0] as unknown as {
            generatedMarkdown: string;
            partialAcknowledgement: {
                transcriptVersionId: string;
            };
        };
        expect(run.generatedMarkdown).toContain("Incomplete transcript");
        expect(run.partialAcknowledgement.transcriptVersionId).toBe(partial.id);
        expect(fixture.calls.filter((url) => url.endsWith("/audio/transcriptions"))).toHaveLength(1);
    });
    it("encrypts an incomplete private provider response without treating it as completed minutes or showing it in errors", async () => {
        const fixture = await transcribed({ respond: async (url) => url.endsWith("/chat/completions") ? new Response(JSON.stringify({ choices: [{ message: { content: "KEYLESS_PRIVATE_INCOMPLETE_RESPONSE" }, finish_reason: "length" }] })) : null });
        const consent = await minutesReady(fixture);
        await expect(fixture.core.generateMinutes(fixture.id, consent)).rejects.toMatchObject({ code: "incomplete" });
        const p = fixture.core.getSnapshot().projects[0] as unknown as {
            minutesRuns: unknown[];
            failedProviderResponses: {
                runId: string;
                response: unknown;
            }[];
        };
        expect(p.minutesRuns).toHaveLength(0);
        expect(p.failedProviderResponses).toHaveLength(1);
        expect(p.failedProviderResponses[0].response).toHaveProperty("choices");
        expect(fixture.core.getSnapshot().error).not.toContain("KEYLESS_PRIVATE_INCOMPLETE_RESPONSE");
        await fixture.core.lock();
        await fixture.core.unlock(secret);
        expect((fixture.core.getSnapshot().projects[0] as unknown as typeof p).failedProviderResponses).toHaveLength(1);
    });
    it("preserves the completed STT snapshot during cancellation and excludes new work until cancellation saves it", async () => {
        const reached = deferred<void>();
        const release = deferred<void>();
        const entered = deferred<void>();
        const promote = deferred<void>();
        let paused = false;
        let saving = false;
        const fixture = await opened({ factory: interceptCheckpoint(async (write) => {
                if (write.runId && write.project.rawTranscripts.length) {
                    if (!paused) {
                        paused = true;
                        reached.resolve();
                        await release.promise;
                    }
                    else if (!saving) {
                        saving = true;
                        entered.resolve();
                        await promote.promise;
                    }
                }
            }) });
        const id = await fixture.core.createMeeting();
        await fixture.core.importFile(id, wav());
        await fixture.core.saveKey("openai", "KEYLESS_OPENAI_TEST", "encrypted");
        await fixture.core.prepareAudio(id);
        const request = fixture.core.startSTT(id, { modelId: "gpt-transcribe", acknowledged: true });
        const failed = request.catch(() => { });
        await reached.promise;
        fixture.core.getSnapshot().onCancelSTT!(id);
        release.resolve();
        await failed;
        // The test awaits promotion only in the fixed implementation; the old path
        // overwrites the snapshot with outcome-unknown and becomes idle instead.
        await vi.waitFor(() => expect(saving || fixture.core.getSnapshot().busy === false).toBe(true));
        expect(saving).toBe(true);
        await entered.promise;
        expect(fixture.core.getSnapshot().busy).toBe(true);
        await expect(fixture.core.updateMeeting(id, { title: "must stay excluded" })).rejects.toMatchObject({ code: "busy" });
        promote.resolve();
        await vi.waitFor(() => expect(fixture.core.getSnapshot().busy).toBe(false));
        await fixture.core.lock();
        await fixture.core.unlock(secret);
        const p = fixture.core.getSnapshot().projects[0];
        expect(p.rawTranscripts).toHaveLength(1);
        expect(p.runs[0].state).toBe("saved");
        expect(p.runs[0].checkpoint?.runId).toBe(p.rawTranscripts[0].runId);
        expect(fixture.calls.filter((url) => url.endsWith("/audio/transcriptions"))).toHaveLength(1);
    });
    it("rejects source byte metadata mismatching the encrypted original without streaming or paid requests", async () => {
        let oversized = false;
        let streamed = 0;
        let readerOpens = 0;
        const fixture = await opened({ factory: (options = {}) => {
                const session = createVaultSession(options);
                return new Proxy({} as typeof session, { get(_target, key) {
                        if (key === "streamSource")
                            return (...args: Parameters<typeof session.streamSource>) => { streamed++; return session.streamSource(...args); };
                        if (key === "openRetainedSource")
                            return (...args: Parameters<typeof session.openRetainedSource>) => { readerOpens++; return session.openRetainedSource(...args); };
                        if (key !== "store")
                            return Reflect.get(session, key);
                        const store = session.store;
                        return { ...store, async listProjects(job) { const projects = await store.listProjects(job); return oversized ? projects.map((p) => ({ ...p, sourceAssets: p.sourceAssets.map((source) => ({ ...source, bytes: 64 * 1024 * 1024 + 1 })) })) : projects; } } satisfies typeof store;
                    } });
            } });
        const id = await fixture.core.createMeeting();
        await fixture.core.importFile(id, wav());
        await fixture.core.saveKey("openai", "KEYLESS_OPENAI_TEST", "encrypted");
        await fixture.core.lock();
        oversized = true;
        await fixture.core.unlock(secret);
        await expect(fixture.core.prepareAudio(id)).rejects.toThrow();
        expect(streamed).toBe(0);
        expect(readerOpens).toBe(1);
        expect(fixture.core.getSnapshot().error).toContain("일치하지");
        expect(fixture.core.getSnapshot().preparation?.stage).toBe("failed");
        expect(fixture.calls.filter((url) => url.endsWith("/audio/transcriptions"))).toHaveLength(0);
    });
    it("rejects an incomplete bounded source read before any whole-source Blob copy", async () => {
        let reads = 0;
        let streamed = 0;
        const fixture = await opened({ factory: (options = {}) => {
                const session = createVaultSession(options);
                return new Proxy({} as typeof session, { get(_target, key) {
                        if (key === "streamSource")
                            return () => { streamed++; throw new Error("Keyless whole-source stream forbidden"); };
                        if (key === "openRetainedSource")
                            return async (...args: Parameters<typeof session.openRetainedSource>) => { const reader = await session.openRetainedSource(...args); return { size: reader.size, async read() { reads++; return new ArrayBuffer(11); } }; };
                        return Reflect.get(session, key);
                    } });
            } });
        const id = await fixture.core.createMeeting();
        await fixture.core.importFile(id, wav());
        await fixture.core.saveKey("openai", "KEYLESS_OPENAI_TEST", "encrypted");
        await fixture.core.lock();
        await fixture.core.unlock(secret);
        const NativeBlob = Blob;
        let copiedBytes = 0;
        class CountedBlob extends NativeBlob {
            constructor(parts: BlobPart[] = [], properties?: BlobPropertyBag) { copiedBytes += parts.reduce((sum, part) => sum + (ArrayBuffer.isView(part) ? part.byteLength : 0), 0); super(parts, properties); }
        }
        vi.stubGlobal("Blob", CountedBlob);
        await expect(fixture.core.prepareAudio(id)).rejects.toThrow();
        expect(copiedBytes).toBe(0);
        expect(streamed).toBe(0);
        expect(reads).toBe(1);
        expect(fixture.core.getSnapshot().preparation?.stage).toBe("failed");
        expect(fixture.core.getSnapshot().error).toContain("손상");
        expect(fixture.calls.filter((url) => url.endsWith("/audio/transcriptions"))).toHaveLength(0);
    });
    it("verifies a reselected original byte-for-byte and keeps all completed chunks and edited transcript versions", async () => {
        const fixture = await transcribed();
        const beforeEdit = fixture.core.getSnapshot().projects[0];
        await fixture.core.editTranscript(fixture.id, beforeEdit.selectedTranscriptVersionId!, beforeEdit.transcriptVersions[0].segments[0].id, "KEYLESS_PRESERVED_EDIT");
        await fixture.core.lock();
        await fixture.core.unlock(secret);
        const before = fixture.core.getSnapshot().projects[0];
        await fixture.core.importFile(fixture.id, wav());
        const after = fixture.core.getSnapshot().projects[0];
        expect(after).toEqual(before);
        expect(after.transcriptVersions.at(-1)?.segments[0].text).toBe("KEYLESS_PRESERVED_EDIT");
        expect(fixture.core.getSnapshot().notice).not.toBeNull();
        expect(fixture.calls.filter((url) => url.endsWith("/audio/transcriptions"))).toHaveLength(1);
        const changed = new Uint8Array(await wav().arrayBuffer());
        changed[changed.length - 1] ^= 1;
        const different = new NodeFile([changed], "KEYLESS_PRIVATE_SOURCE.wav", { type: "audio/wav" }) as unknown as File;
        await expect(fixture.core.importFile(fixture.id, different)).rejects.toThrow();
        expect(fixture.core.getSnapshot().projects[0]).toEqual(before);
        expect(fixture.core.getSnapshot().error).toContain("일치하지");
        await fixture.core.lock();
        await fixture.core.unlock(secret);
        expect(fixture.core.getSnapshot().projects[0]).toEqual(before);
    });
    it("retries an existing prepared chunk after reload without restoring a larger partially prepared original", async () => {
        let expanded = false;
        let streamReads = 0;
        let attempts = 0;
        const fixture = await opened({ respond: async (url) => { if (url.endsWith("/audio/transcriptions") && ++attempts === 1)
                return new Response(JSON.stringify({ error: { message: "KEYLESS_RETRY_FAILURE" } }), { status: 500 }); return null; }, factory: (options = {}) => {
                const session = createVaultSession(options);
                return new Proxy({} as typeof session, { get(_target, key) {
                        if (key === "streamSource")
                            return (...args: Parameters<typeof session.streamSource>) => { streamReads++; return session.streamSource(...args); };
                        if (key !== "store")
                            return Reflect.get(session, key);
                        const store = session.store;
                        return { ...store, async listProjects(job) { const projects = await store.listProjects(job); return expanded ? projects.map((p) => ({ ...p, sourceAssets: p.sourceAssets.map((source) => ({ ...source, bytes: 64 * 1024 * 1024 + 1, durationMs: 2000 })) })) : projects; } } satisfies typeof store;
                    } });
            } });
        const id = await fixture.core.createMeeting();
        await fixture.core.importFile(id, wav());
        await fixture.core.saveKey("openai", "KEYLESS_OPENAI_TEST", "encrypted");
        await fixture.core.prepareAudio(id);
        await expect(fixture.core.startSTT(id, { modelId: "gpt-transcribe", acknowledged: true })).rejects.toThrow();
        const chunkId = fixture.core.getSnapshot().projects[0].preparedChunks[0].id;
        await fixture.core.lock();
        expanded = true;
        await fixture.core.unlock(secret);
        const retrySnapshot = fixture.core.getSnapshot(), retryProject = retrySnapshot.projects[0];
        const consentToken = sttActionToken(retrySnapshot.sttConsentToken, retryProject, { purpose: "retry-failed", chunkIds: [chunkId], modelId: "gpt-transcribe" });
        await fixture.core.startSTT(id, { modelId: "gpt-transcribe", acknowledged: true, additionalChargeAcknowledged: true, consentToken }, [chunkId]);
        const p = fixture.core.getSnapshot().projects[0];
        expect(streamReads).toBe(0);
        expect(p.rawTranscripts[0].chunkId).toBe(chunkId);
        expect(p.runs.at(-1)?.state).toBe("saved");
        expect(p.transcriptVersions[0].missingRanges).toContainEqual([1000, 2000]);
        expect(attempts).toBe(2);
    });
    it("rejects encoding changes after raw STT and preserves the actual stored settings and prepared chunks", async () => {
        const fixture = await transcribed();
        const original = fixture.core.getSnapshot().projects[0];
        fixture.core.getSnapshot().onAudioOptions!(fixture.id, { ...original.audioOptions, bitrateKbps: 24 });
        await vi.waitFor(() => expect(fixture.core.getSnapshot().error).toContain("전사 결과"));
        expect(fixture.core.getSnapshot().projects[0].audioOptions).toEqual(original.audioOptions);
        expect(fixture.core.getSnapshot().projects[0].preparedChunks).toEqual(original.preparedChunks);
        await fixture.core.lock();
        await fixture.core.unlock(secret);
        expect(fixture.core.getSnapshot().projects[0].audioOptions).toEqual(original.audioOptions);
    });
});

// Media errors must survive the Worker boundary as allowlisted guidance.
describe('safe import error guidance', () => {
    for (const language of ['ko', 'en'] as const) it(`shows fixed supported-format guidance in ${language} without leaking the filename`, async () => {
        const { core, calls } = await opened();
        core.getSnapshot().onPreferences!({ ...core.getSnapshot().preferences, uiLanguage: language });
        const id = await core.createMeeting();
        await expect(core.importFile(id, new NodeFile(['not audio'], 'PRIVATE_FILENAME.m4a') as unknown as File)).rejects.toThrow();
        const error = core.getSnapshot().error;
        expect(error).toContain('MP3');
        expect(error).not.toContain('PRIVATE_FILENAME');
        expect(calls.filter(url => url.endsWith('/audio/transcriptions'))).toEqual([]);
    });
    for (const language of ['ko', 'en'] as const) it(`preserves distinct M4A layout guidance through the controller in ${language}`, async () => {
        const { core, calls } = await opened();
        core.getSnapshot().onPreferences!({ ...core.getSnapshot().preferences, uiLanguage: language });
        const id = await core.createMeeting();
        const bytes = new Uint8Array(readFileSync(new URL('./fixtures/media/synthetic-aac.m4a', import.meta.url))), view = new DataView(bytes.buffer);
        const moov = Buffer.from(bytes).indexOf('moov') - 4, at = moov + 8;
        const annotation = new Uint8Array([0, 0, 0, 8, 119, 105, 100, 101]); // Ordinary empty 'wide' box, unsupported at this core location.
        view.setUint32(moov, view.getUint32(moov) + annotation.length);
        const stco = Buffer.from(bytes).indexOf('stco'), count = view.getUint32(stco + 8);
        for (let i = 0; i < count; i++) view.setUint32(stco + 12 + i * 4, view.getUint32(stco + 12 + i * 4) + annotation.length);
        const file = new NodeFile([bytes.subarray(0, at), annotation, bytes.subarray(at)], 'PRIVATE_FILENAME.m4a') as unknown as File;
        await expect(core.importFile(id, file)).rejects.toMatchObject({ code: 'unsupported-layout' });
        expect(core.getSnapshot().error).toContain('M4A');
        expect(core.getSnapshot().error).not.toContain('ALAC');
        expect(core.getSnapshot().error).not.toContain('PRIVATE_FILENAME');
        expect(calls.filter(url => url.endsWith('/audio/transcriptions'))).toEqual([]);
    });
});

describe('safe UI file-picker failure', () => {
    for (const language of ['ko', 'en'] as const) it(`retains allowlisted media guidance through the asynchronous UI handler in ${language}`, async () => {
        const { core } = await opened();
        core.getSnapshot().onPreferences!({ ...core.getSnapshot().preferences, uiLanguage: language });
        const id = await core.createMeeting();
        core.getSnapshot().onPickFile!(id, new NodeFile(['not audio'], 'PRIVATE_FILENAME.m4a') as unknown as File);
        await vi.waitFor(() => { expect(core.getSnapshot().busy).toBe(false); expect(core.getSnapshot().error).toContain('MP3'); });
        expect(core.getSnapshot().error).not.toContain('PRIVATE_FILENAME');
    });
});


describe('E1_review explicit Direct OpenAI new setup', () => {
    it('discovers and explicitly enables a prospective default while a saved disabled default stays blocked', async () => {
        const fixture = await opened({ respond: async (url, init) => {
            expect(url).toBe('https://api.openai.com/v1/models');
            expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer KEYLESS_OPENAI_TEST');
            return new Response(JSON.stringify({ data: [{ id: 'gpt-transcribe', owned_by: 'openai' }, { id: 'gpt-4o-mini-transcribe', owned_by: 'openai' }] }));
        } });
        const { core } = fixture; expect(core.getSnapshot().modelRegistry!.entries).toEqual([]);
        await core.saveKey('openai', 'KEYLESS_OPENAI_TEST', 'encrypted'); await core.discoverModels('openai', 'stt');
        const rows = core.getSnapshot().modelManagement!.rows;
        const direct = rows.find(row => row.route.provider === 'openai' && row.route.modelId === 'gpt-transcribe')!;
        const mini = rows.find(row => row.route.provider === 'openai' && row.route.modelId === 'gpt-4o-mini-transcribe')!;
        expect(direct.userEnabled).toBe(false); expect(mini.userEnabled).toBe(false);
        await core.setModelEnabled(direct.key, true); await core.setModelEnabled(mini.key, true);
        await core.setModelDefault('stt', direct.key); await core.createMeeting(); expect(core.getSnapshot().sttModelId).toBe(direct.route.modelId);
        await core.setModelDefault('stt', mini.key); expect(core.getSnapshot().sttModelId).toBe(direct.route.modelId);
        await core.createMeeting(); expect(core.getSnapshot().sttModelId).toBe(mini.route.modelId);
        await core.setModelEnabled(mini.key, false); const id = await core.createMeeting();
        expect(core.getSnapshot().sttModelId).toBe(mini.route.modelId);
        expect(core.getSnapshot().modelCatalog!.find(model => model.id === mini.route.modelId)?.enabled).toBe(false);
        await expect(core.startSTT(id, { modelId: mini.route.modelId, acknowledged: true })).rejects.toMatchObject({ code: 'invalid-input' });
        expect(fixture.calls).toEqual(['https://api.openai.com/v1/models']);
    });
    it('locks one explicitly configured held POST and retains unknown intent without late raw or initial replay', async () => {
        const response = deferred<Response>(); let posts = 0;
        const fixture = await opened({ respond: async (url, init) => {
            expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer KEYLESS_OPENAI_TEST');
            if (url === 'https://api.openai.com/v1/models') return new Response(JSON.stringify({ data: [{ id: 'gpt-transcribe', owned_by: 'openai' }] }));
            expect(url).toBe('https://api.openai.com/v1/audio/transcriptions'); posts++; return response.promise;
        } });
        const { core } = fixture; await core.saveKey('openai', 'KEYLESS_OPENAI_TEST', 'encrypted'); await core.discoverModels('openai', 'stt');
        const route = core.getSnapshot().modelManagement!.rows.find(row => row.route.modelId === 'gpt-transcribe')!;
        await core.setModelEnabled(route.key, true); await core.setModelDefault('stt', route.key);
        const id = await core.createMeeting(); await core.importFile(id, wav()); await core.prepareAudio(id);
        const ready = core.getSnapshot(), prepared = ready.projects[0];
        expect(prepared.retainedAudio!.chunkIds).toHaveLength(1); expect(ready.sttModelId).toBe('gpt-transcribe');
        const consent = { modelId: 'gpt-transcribe', acknowledged: true as const, consentToken: sttActionToken(ready.sttConsentToken, prepared, { purpose: 'initial', chunkIds: prepared.retainedAudio!.chunkIds, modelId: 'gpt-transcribe' }) };
        const pending = core.startSTT(id, consent).catch((error: unknown) => error);
        await vi.waitFor(() => expect(posts).toBe(1)); await core.lock(); response.resolve(new Response(JSON.stringify({ text: 'E1_REVIEW_LATE_SYNTHETIC_SPEECH' }))); await pending;
        expect(core.getSnapshot().projects).toEqual([]); await core.unlock(secret);
        const current = core.getSnapshot(), restored = current.projects[0]; expect(restored.rawTranscripts).toEqual([]);
        expect(restored.runs).toHaveLength(1); expect(restored.runs[0].state).toBe('outcome-unknown');
        expect(restored.runs[0].intent).toMatchObject({ kind: 'stt', requestedModel: 'gpt-transcribe' });
        const fresh = { ...consent, consentToken: sttActionToken(current.sttConsentToken, restored, { purpose: 'initial', chunkIds: restored.retainedAudio!.chunkIds, modelId: 'gpt-transcribe' }) };
        await expect(core.startSTT(id, fresh)).rejects.toMatchObject({ code: 'invalid-input' });
        expect(posts).toBe(1); expect(fixture.calls.filter(url => url.endsWith('/audio/transcriptions'))).toHaveLength(1);
    });
});
