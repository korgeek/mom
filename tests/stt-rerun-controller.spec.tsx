// Keyless fixture integration: real encrypted vault and direct adapters, intercepted fetch only.
import { IDBFactory } from "fake-indexeddb";
import { afterEach, expect, it, vi } from "vitest";
import { createMeetingController, type MeetingController } from "../src/react-app/controller";
import { cancelJobs, createJobContext } from "../src/react-app/domain/jobs";
import { createVaultSession, type VaultSession } from "../src/react-app/vault/session";
import type { MeetingProject } from "../src/react-app/domain/types";
import { aggregateProjectUsage } from "../src/react-app/usage/statement";
import { createModelPreset } from "../src/react-app/providers/model-profiles";
import { validateRegistration } from "../src/react-app/providers/model-registrations";
import { sttActionToken } from "../src/react-app/transcript/batches";

const routerModel = { id: "fixture/rerun-minutes", name: "TEST_ONLY_TEXT_MODEL", context_length: 32000, top_provider: { max_completion_tokens: 4096 }, architecture: { input_modalities: ["text"], output_modalities: ["text"], tokenizer: "FixtureBPE" }, supported_parameters: ["max_tokens"], pricing: { prompt: "0.000001", completion: "0.000002", request: "0" } };
const routerEndpoint = { tag: "TestOnlyEndpoint/region", provider_name: "TestOnlyEndpoint", context_length: 32000, max_prompt_tokens: 28000, max_completion_tokens: 4096, supported_parameters: ["max_tokens"], pricing: routerModel.pricing };
const secret = "synthetic STT rerun integration phrase", cores: MeetingController[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const core of cores.splice(0)) await core.dispose(); cancelJobs(); });
async function fixture(options: { respond?: (attempt: number, init?: RequestInit) => Promise<Response>; respondMinutes?: () => Promise<Response>; checkpoint?: (project: MeetingProject, runId: string | null) => Promise<void> } = {}) {
    const indexedDB = new IDBFactory(), databaseName = crypto.randomUUID(), held = new Set<string>(), requests: RequestInit[] = [], minutesRequests: RequestInit[] = []; let keyReads = 0;
    let session!: VaultSession;
    const make = () => {
        const core = createMeetingController({ indexedDB, databaseName, sessionFactory: hooks => {
            session = createVaultSession({ ...hooks, indexedDB, databaseName, testOnlyOwnership: { async acquire(name) { if (held.has(name)) return null; held.add(name); return () => { held.delete(name); }; } } });
            const currentSession = session;
            return new Proxy({} as VaultSession, { get(_target, key) { const target = currentSession; if (key === "getProviderKey") return (provider: "openai" | "openrouter") => { keyReads++; return target.getProviderKey(provider); }; if (key !== "store") return Reflect.get(target, key); const store = target.store; return { ...store, async checkpoint(write, job) { await options.checkpoint?.(write.project, write.runId); return store.checkpoint(write, job); } } satisfies typeof store; } });
        }, objectUrls: { create: () => "blob:synthetic-stt-rerun", revoke: () => {} }, fetch: async (url, init) => {
            if (String(url).endsWith("/audio/transcriptions")) {
                requests.push(init!);
                return options.respond?.(requests.length, init) ?? new Response(JSON.stringify({ text: `SYNTHETIC_STT_ANSWER_${requests.length}`, usage: { type: "duration", seconds: 1 } }));
            }
            if (String(url).endsWith("/chat/completions")) { minutesRequests.push(init!); return options.respondMinutes?.() ?? new Response(JSON.stringify({ model: routerModel.id, choices: [{ message: { content: "# SYNTHETIC_ORIGINAL_MINUTES" }, finish_reason: "stop" }], usage: { prompt_tokens: 40, completion_tokens: 10 } })); }
            if (String(url) === "https://api.openai.com/v1/models") return new Response(JSON.stringify({ data: [{ id: "gpt-transcribe" }, { id: "gpt-4o-mini-transcribe" }] }));
            if (String(url).endsWith("/endpoints")) return new Response(JSON.stringify({ data: { id: routerModel.id, endpoints: [routerEndpoint] } }));
            if (String(url).startsWith("https://openrouter.ai/api/v1/models")) return new Response(JSON.stringify({ data: [routerModel] }));
            throw new Error("Unexpected fixture-only transport");
        } }); cores.push(core); return core;
    };
    const core = make(); await core.initialize(); await core.createVault(secret); const id = await core.createMeeting();
    const p = core.getSnapshot().projects.find(project => project.id === id)!, sourceId = crypto.randomUUID();
    const audio = new Blob(["abc"], { type: "audio/mpeg" });
    const preparedChunks = [0, 1].map(index => ({ id: crypto.randomUUID(), sourceId, index, sourceStartMs: index ? 295000 : 0, sourceEndMs: index ? 310000 : 300000, encodingOffsetMs: 0, encodedBytes: audio.size, mimeType: audio.type, codec: "mp3", audioRecordId: crypto.randomUUID() }));
    const seeded = { ...p, sourceAssets: [{ id: sourceId, fileName: "SYNTHETIC_PREPARED_FIXTURE.wav", bytes: 3, container: "wav", codec: "pcm", durationMs: 310000, channels: 1, sampleRateHz: 16000 }], preparedChunks };
    await session.store.checkpoint({ project: seeded, runId: null, audioRecords: [{ recordId: sourceId, audio }, ...preparedChunks.map(chunk => ({ recordId: chunk.audioRecordId, audio }))] }, createJobContext());
    await core.lock(); await core.unlock(secret); await core.saveKey("openai", "SYNTHETIC_FAKE_KEY_NO_NETWORK", "encrypted");
    for (const id of ['gpt-transcribe', 'gpt-4o-mini-transcribe']) {
        const model = validateRegistration({ ...createModelPreset('openai-gpt-transcribe', () => id), modelId: id, enabled: true, stt: { formats: ['mp3'], maxBytes: 25000000, responseFormat: 'json', languageMode: id === 'gpt-transcribe' ? 'multiple' : 'none', timestamps: 'none' } });
        await core.getSnapshot().onSaveRegistration!(model, { action: 'replace', value: 'SYNTHETIC_REGISTRATION_KEY_NO_NETWORK' });
    }
    await core.getSnapshot().onSetRegistrationDefault!('stt', 'gpt-transcribe');
    core.getSnapshot().onSTTModel?.('gpt-transcribe');
    await vi.waitFor(() => expect(core.getSnapshot().sttModelId).toBe('gpt-transcribe'));
    core.getSnapshot().onNavigate?.("stt", id); await vi.waitFor(() => { expect(core.getSnapshot().selectedProjectId).toBe(id); expect(core.getSnapshot().busy).toBe(false); });
    return { core, id, requests, minutesRequests, indexedDB, databaseName, make, get session() { return session; }, get keyReads() { return keyReads; }, project: () => core.getSnapshot().projects.find(project => project.id === id)! };
}

it("reruns one saved chunk with one new request, retaining the selected edited transcript and all older responses", async () => {
    const f = await fixture(); await f.core.startSTT(f.id, initialConsent(f));
    const original = f.project(), version = original.transcriptVersions.find(version => version.id === original.selectedTranscriptVersionId)!;
    await f.core.editTranscript(f.id, version.id, version.segments[0].id, "SYNTHETIC_SELECTED_EDIT"); const selected = f.project().selectedTranscriptVersionId;
    const chunks = [original.preparedChunks[0].id];
    const consent = { modelId: "gpt-transcribe", acknowledged: true as const, additionalChargeAcknowledged: true, consentToken: sttActionToken(f.core.getSnapshot().sttConsentToken, f.project(), { purpose: "rerun-successful", chunkIds: chunks, modelId: "gpt-transcribe" }) };
    await f.core.startSTT(f.id, consent, chunks, { purpose: "rerun-successful" });
    expect(f.requests).toHaveLength(3);
    expect(f.project().rawTranscripts).toHaveLength(3);
    expect(f.project().selectedTranscriptVersionId).toBe(selected);
    expect(f.project().transcriptVersions.find(version => version.id === selected)?.segments[0].text).toBe("SYNTHETIC_SELECTED_EDIT");
    expect(f.project().rawTranscripts.slice(0, 2)).toEqual(original.rawTranscripts);
});
function deferred<T = void>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function initialConsent(f: Awaited<ReturnType<typeof fixture>>) {
    return { modelId: 'gpt-transcribe', acknowledged: true as const, consentToken: sttActionToken(f.core.getSnapshot().sttConsentToken, f.project(), { purpose: 'initial', chunkIds: f.project().preparedChunks.map(chunk => chunk.id), modelId: 'gpt-transcribe' }) };
}

it.each([true, false])('retains encrypted failure diagnostics after reload with JSON=%s without retrying', async json => {
    const f = await fixture({ respond: async () => new Response(json ? JSON.stringify({ error: { message: 'Unsupported format verbose_json SYNTHETIC_REGISTRATION_KEY_NO_NETWORK', code: 'unsupported_value', param: 'response_format', type: 'invalid_request_error' } }) : 'Synthetic non-JSON failure', { status: 400 }) });
    await expect(f.core.startSTT(f.id, initialConsent(f))).rejects.toMatchObject({ code: 'invalid-input', status: 400 });
    await f.core.lock(); await f.core.unlock(secret);
    const saved = f.project() as import('../src/react-app/controller').ControllerProject;
    expect(saved.failedProviderResponses).toHaveLength(1);
    expect(saved.failedProviderResponses![0]).toMatchObject({ runId: saved.runs[0].id, status: 400, failureCode: 'invalid-input' });
    if (json) expect(saved.failedProviderResponses![0].response).toMatchObject({ error: { message: 'Unsupported format verbose_json [redacted]', code: 'unsupported_value', param: 'response_format' } });
    expect(saved.failedProviderResponses![0].request).toMatchObject({method:'POST',body:{file:{omitted:'audio bytes'}}});
    expect(JSON.stringify(saved.failedProviderResponses)).not.toContain('SYNTHETIC_REGISTRATION_KEY_NO_NETWORK');
    expect(saved.rawTranscripts).toHaveLength(0); expect(f.requests).toHaveLength(1);
});

it('retains LLM failure diagnostics without changing completed transcripts', async () => {
    const f = await fixture({ respondMinutes: async () => new Response(JSON.stringify({ error: { message: 'Synthetic context limit', code: 'context_length_exceeded', param: 'messages' } }), { status: 400 }) });
    await f.core.startSTT(f.id, initialConsent(f));
    const notes = validateRegistration({ ...createModelPreset('openrouter-text', () => 'diagnostic-notes'), modelId: routerModel.id, enabled: true, routerPolicy: { requireZdr: true, acknowledged: true }, llm: { tokenField: 'max_tokens', contextTokens: 32000, maxTokens: 4096 } });
    await f.core.getSnapshot().onSaveRegistration!(notes, { action: 'replace', value: 'SYNTHETIC_ROUTER_KEY_NO_NETWORK' });
    await f.core.setMinutesRoute(f.id, notes.id);
    await expect(f.core.generateMinutes(f.id, { acknowledged: true, transcriptVersionId: f.project().selectedTranscriptVersionId!, consentToken: f.core.getSnapshot().minutesConsentToken!, partialAcknowledged: false })).rejects.toMatchObject({ code: 'context', status: 400 });
    await f.core.lock(); await f.core.unlock(secret);
    expect(f.project().failedProviderResponses![0]).toMatchObject({ status: 400, failureCode: 'context', response: { error: { code: 'context_length_exceeded', param: 'messages' } }, request:{method:'POST'} });
    expect(f.project().rawTranscripts).toHaveLength(2); expect(f.project().minutesRuns).toHaveLength(0); expect(f.minutesRequests).toHaveLength(1);
});
function rerunConsent(f: Awaited<ReturnType<typeof fixture>>, chunkIds: readonly string[], batchId?: string) {
    const purpose = batchId ? "retry-failed" : "rerun-successful", modelId = batchId ? f.project().sttBatches!.find(batch => batch.id === batchId)!.modelId : f.core.getSnapshot().sttModelId;
    return { modelId, acknowledged: true as const, additionalChargeAcknowledged: true, ...(batchId ? { batchId } : {}), consentToken: sttActionToken(f.core.getSnapshot().sttConsentToken, f.project(), { purpose, chunkIds, modelId, ...(batchId ? { batchId } : {}) }) };
}
it('selects one saved result durably without extra requests and retains edits in other chunks', async () => {
    const f = await fixture(); await f.core.startSTT(f.id, initialConsent(f));
    const initial = f.project(), version = initial.transcriptVersions.find(item => item.id === initial.selectedTranscriptVersionId)!;
    await f.core.editTranscript(f.id, version.id, version.segments[1].id, 'SYNTHETIC_OTHER_EDIT');
    const chunks = [initial.preparedChunks[0].id];
    await f.core.startSTT(f.id, rerunConsent(f, chunks), chunks, { purpose: 'rerun-successful' });
    const before = f.project(), raw = before.rawTranscripts.at(-1)!, parent = before.selectedTranscriptVersionId;
    f.core.getSnapshot().onSelectChunkTranscript!(f.id, chunks[0], raw.id, parent);
    await vi.waitFor(() => { expect(f.project().selectedTranscriptVersionId).not.toBe(parent); expect(f.core.getSnapshot().busy).toBe(false); });
    const selected = f.project().selectedTranscriptVersionId, chosen = f.project().transcriptVersions.find(item => item.id === selected)!;
    expect(chosen.rawIds).toEqual([raw.id, initial.rawTranscripts[1].id]); expect(chosen.segments[1].text).toBe('SYNTHETIC_OTHER_EDIT');
    expect(f.project().rawTranscripts).toEqual(before.rawTranscripts); expect(f.project().transcriptVersions.slice(0, -1)).toEqual(before.transcriptVersions);
    expect(f.project().minutesRevisions).toEqual(before.minutesRevisions); expect(f.requests).toHaveLength(3);
    f.core.getSnapshot().onSelectChunkTranscript!(f.id, chunks[0], initial.rawTranscripts[0].id, parent);
    await vi.waitFor(() => expect(f.core.getSnapshot().error).toBeTruthy()); expect(f.project().selectedTranscriptVersionId).toBe(selected);
    await f.core.lock(); await f.core.unlock(secret);
    expect(f.project().selectedTranscriptVersionId).toBe(selected); expect(f.project().transcriptVersions.at(-1)).toEqual(chosen); expect(f.requests).toHaveLength(3);
});
it('keeps a replacement private on save failure and recovers that exact selection on lock', async () => {
    let fail = false;
    const f = await fixture({ checkpoint: async () => { if (fail) throw new Error('SYNTHETIC_SELECTION_SAVE_FAILURE'); } });
    await f.core.startSTT(f.id, initialConsent(f)); const ids = [f.project().preparedChunks[0].id];
    await f.core.startSTT(f.id, rerunConsent(f, ids), ids, { purpose: 'rerun-successful' });
    const before = f.project(); fail = true;
    f.core.getSnapshot().onSelectChunkTranscript!(f.id, ids[0], before.rawTranscripts.at(-1)!.id, before.selectedTranscriptVersionId);
    await vi.waitFor(() => expect(f.core.getSnapshot().error).toBeTruthy());
    expect(f.project().selectedTranscriptVersionId).toBe(before.selectedTranscriptVersionId); expect(f.project().transcriptVersions).toEqual(before.transcriptVersions);
    fail = false; await f.core.lock(); await f.core.unlock(secret);
    const recovered = f.project().transcriptVersions.at(-1)!;
    expect(f.project().selectedTranscriptVersionId).toBe(recovered.id);
    expect(recovered.rawIds[0]).toBe(before.rawTranscripts.at(-1)!.id);
    expect(f.project().transcriptVersions).toHaveLength(before.transcriptVersions.length + 1); expect(f.requests).toHaveLength(3);
});
it('continues failed and untouched chunks together and persists a subsequent whole rerun as a separate batch', async () => {
    const f = await fixture({ respond: async attempt => attempt === 2 ? new Response('{"error":{"message":"TEST_ONLY_FAILURE"}}', { status: 429 }) : new Response(JSON.stringify({ text: `SYNTHETIC_${attempt}` })) });
    await expect(f.core.startSTT(f.id, initialConsent(f))).rejects.toMatchObject({ code: 'rate-limit' });
    for (const ids of [[f.project().preparedChunks[1].id], f.project().preparedChunks.map(chunk => chunk.id)]) {
        const consent = { modelId: 'gpt-transcribe', acknowledged: true as const, additionalChargeAcknowledged: true, consentToken: sttActionToken(f.core.getSnapshot().sttConsentToken, f.project(), { purpose: 'transcribe-selected', chunkIds: ids, modelId: 'gpt-transcribe' }) };
        await f.core.startSTT(f.id, consent, ids, { purpose: 'transcribe-selected' });
    }
    expect(f.requests).toHaveLength(5); expect(f.project().sttBatches?.map(batch => batch.purpose)).toEqual(['initial', 'transcribe-selected', 'transcribe-selected']);
    const before = f.project(); await f.core.lock(); await f.core.unlock(secret); expect(f.project().sttBatches).toEqual(before.sttBatches);
});
it("rejects missing/freshness/scope acknowledgment errors before any extra credential read or dispatch", async () => {
    const f = await fixture(); await f.core.startSTT(f.id, initialConsent(f));
    const chunkIds = [f.project().preparedChunks[0].id], consent = rerunConsent(f, chunkIds), reads = f.keyReads;
    for (const invalid of [{ ...consent, additionalChargeAcknowledged: false }, { ...consent, consentToken: undefined }, { ...consent, consentToken: "stale synthetic acknowledgment" }])
        await expect(f.core.startSTT(f.id, invalid, chunkIds, { purpose: "rerun-successful" })).rejects.toMatchObject({ code: "invalid-input" });
    await expect(f.core.startSTT(f.id, consent, [f.project().preparedChunks[1].id], { purpose: "rerun-successful" })).rejects.toMatchObject({ code: "invalid-input" });
    const version = f.project().transcriptVersions.find(version => version.id === f.project().selectedTranscriptVersionId)!;
    await f.core.editTranscript(f.id, version.id, version.segments[0].id, "SYNTHETIC_CHANGED_PARENT");
    await expect(f.core.startSTT(f.id, consent, chunkIds, { purpose: "rerun-successful" })).rejects.toMatchObject({ code: "invalid-input" });
    expect(f.keyReads).toBe(reads); expect(f.requests).toHaveLength(2);
});
it("keeps a received candidate private until durable save and saves that exact candidate once on lock", async () => {
    const entered = deferred(), release = deferred(); let hold = false, privateProject: MeetingProject | null = null;
    const f = await fixture({ checkpoint: async (project, runId) => { if (hold && runId) { privateProject = project; entered.resolve(); await release.promise; } } });
    await f.core.startSTT(f.id, initialConsent(f)); const before = f.project(); hold = true;
    const chunkIds = [before.preparedChunks[0].id]; const running = f.core.startSTT(f.id, rerunConsent(f, chunkIds), chunkIds, { purpose: "rerun-successful" }); void running.catch(() => {}); await entered.promise;
    expect(f.project().rawTranscripts).toEqual(before.rawTranscripts); expect(f.project().transcriptVersions).toEqual(before.transcriptVersions); expect(f.project().selectedTranscriptVersionId).toBe(before.selectedTranscriptVersionId);
    expect(privateProject!.transcriptVersions).toHaveLength(before.transcriptVersions.length + 1);
    const candidate = privateProject!.transcriptVersions.at(-1)!;
    await f.core.lock(); expect(f.core.getSnapshot().projects).toEqual([]); release.resolve(); await expect(running).rejects.toBeTruthy(); await f.core.unlock(secret);
    const reloaded = f.project(); expect(reloaded.rawTranscripts).toHaveLength(3); expect(reloaded.transcriptVersions).toHaveLength(before.transcriptVersions.length + 1); expect(reloaded.transcriptVersions.filter(version => version.id === candidate.id)).toHaveLength(1);
    expect(reloaded.selectedTranscriptVersionId).toBe(before.selectedTranscriptVersionId); expect(reloaded.transcriptVersions.at(-1)).toEqual(candidate); expect(f.requests).toHaveLength(3);
});
it("preserves the old public selection on checkpoint failure and recovers one completed candidate on encrypted reload", async () => {
    let fail = false;
    const f = await fixture({ checkpoint: async (_project, runId) => { if (fail && runId) throw new Error("Synthetic checkpoint failure"); } });
    await f.core.startSTT(f.id, initialConsent(f)); const before = f.project(); fail = true;
    const chunkIds = [before.preparedChunks[0].id]; await expect(f.core.startSTT(f.id, rerunConsent(f, chunkIds), chunkIds, { purpose: "rerun-successful" })).rejects.toMatchObject({ code: "storage" });
    expect(f.project().rawTranscripts).toEqual(before.rawTranscripts); expect(f.project().transcriptVersions).toEqual(before.transcriptVersions); expect(f.project().selectedTranscriptVersionId).toBe(before.selectedTranscriptVersionId);
    expect(f.core.getSnapshot().busy).toBe(true); await f.core.lock(); await f.core.unlock(secret);
    expect(f.project().rawTranscripts).toHaveLength(3); expect(f.project().transcriptVersions).toHaveLength(before.transcriptVersions.length + 1); expect(f.project().selectedTranscriptVersionId).toBe(before.selectedTranscriptVersionId); expect(f.requests).toHaveLength(3);
});
it("fills a missing chunk after explicit retry while preserving edited transcript lineage across reload", async () => {
    const f = await fixture({ respond: async attempt => attempt === 2 ? new Response(JSON.stringify({ error: { message: "TEST_ONLY_FAILURE" } }), { status: 429 }) : new Response(JSON.stringify({ text: `SYNTHETIC_RESULT_${attempt}`, usage: { type: "duration", seconds: 1 } })) });
    await expect(f.core.startSTT(f.id, initialConsent(f))).rejects.toMatchObject({ code: "rate-limit" });
    const partial = f.project(), selected = partial.transcriptVersions.find(version => version.id === partial.selectedTranscriptVersionId)!, batch = partial.sttBatches![0], chunks = [partial.preparedChunks[1].id];
    expect(selected.missingRanges.length).toBeGreaterThan(0); expect(batch.attemptRunIds).toHaveLength(2);
    await f.core.editTranscript(f.id, selected.id, selected.segments[0].id, 'SYNTHETIC_KEEP_EDIT');
    const edited = structuredClone(f.project().transcriptVersions.find(version => version.id === f.project().selectedTranscriptVersionId)!);
    await f.core.startSTT(f.id, rerunConsent(f, chunks, batch.id), chunks, { purpose: "retry-failed", batchId: batch.id });
    expect(f.requests).toHaveLength(3);
    const saved = f.project(), complete = saved.transcriptVersions.find(version => version.id === saved.selectedTranscriptVersionId)!;
    expect(complete.id).not.toBe(edited.id); expect(complete.parentId).toBe(edited.id); expect(complete.missingRanges).toEqual([]);
    expect(complete.segments.some(segment => segment.text === 'SYNTHETIC_KEEP_EDIT')).toBe(true);
    expect(complete.rawIds).toEqual(expect.arrayContaining([...edited.rawIds]));
    expect(saved.transcriptVersions.find(version => version.id === edited.id)).toEqual(edited);
    expect(saved.transcriptVersions.find(version => version.id === selected.id)).toEqual(selected);
    const originalBatch = saved.sttBatches![0]; await f.core.lock(); await f.core.unlock(secret);
    expect(f.project().sttBatches![0]).toEqual(originalBatch); expect(f.project().selectedTranscriptVersionId).toBe(complete.id);
    expect(f.project().transcriptVersions.find(version => version.id === complete.id)).toEqual(complete);
    expect(f.project().transcriptVersions.find(version => version.id === edited.id)).toEqual(edited); expect(f.requests).toHaveLength(3);
});

it("retries a failed rerun with the original enabled model and language hints after current settings change", async () => {
    const f = await fixture({ respond: async attempt => attempt === 3 ? new Response(JSON.stringify({ error: { message: "TEST_ONLY_RETRY_FAILURE" } }), { status: 429 }) : new Response(JSON.stringify({ text: `SYNTHETIC_RESULT_${attempt}` })) });
    await f.core.startSTT(f.id, initialConsent(f)); const chunks = [f.project().preparedChunks[0].id];
    await expect(f.core.startSTT(f.id, rerunConsent(f, chunks), chunks, { purpose: "rerun-successful" })).rejects.toMatchObject({ code: "rate-limit" });
    const batch = f.project().sttBatches!.at(-1)!;
    f.core.getSnapshot().onSTTModel?.("gpt-4o-mini-transcribe"); await vi.waitFor(() => { expect(f.core.getSnapshot().sttModelId).toBe("gpt-4o-mini-transcribe"); expect(f.core.getSnapshot().busy).toBe(false); });
    // Change only synthetic persisted hint settings, then restore through the encrypted vault.
    await f.session.store.checkpoint({ project: { ...f.project(), audioOptions: { ...f.project().audioOptions, expectedLanguages: ["ja"] } }, runId: null, audioRecords: [] }, createJobContext()); await f.core.lock(); await f.core.unlock(secret);
    await f.core.startSTT(f.id, rerunConsent(f, chunks, batch.id), chunks, { purpose: "retry-failed", batchId: batch.id });
    expect(f.requests).toHaveLength(4); const originalBody = f.requests[2].body as FormData, retriedBody = f.requests[3].body as FormData;
    expect(retriedBody.get("model")).toBe(originalBody.get("model")); expect(retriedBody.get("prompt")).toBe(originalBody.get("prompt")); expect(retriedBody.get("language")).toBe(originalBody.get("language")); expect(retriedBody.getAll("languages[]")).toEqual(batch.languages); expect(f.project().sttBatches!.at(-1)!.languages).toEqual(batch.languages);
    await f.core.getSnapshot().onSaveRegistration!({ ...f.core.getSnapshot().modelRegistrations!.entries.find(model => model.id === batch.modelSnapshot!.id)!, enabled: false }); const reads = f.keyReads;
    await expect(f.core.startSTT(f.id, rerunConsent(f, chunks, batch.id), chunks, { purpose: "retry-failed", batchId: batch.id })).rejects.toMatchObject({ code: "permission" }); expect(f.keyReads).toBe(reads); expect(f.requests).toHaveLength(4);
});
it.each(["lock", "cancel"] as const)("fences a late rerun response on %s without changing old selected data or automatic replay", async boundary => {
    const entered = deferred(), response = deferred<Response>();
    const f = await fixture({ respond: async attempt => { if (attempt === 3) { entered.resolve(); return response.promise; } return new Response(JSON.stringify({ text: `SYNTHETIC_RESULT_${attempt}` })); } });
    await f.core.startSTT(f.id, initialConsent(f)); const before = f.project(), chunks = [before.preparedChunks[0].id];
    const running = f.core.startSTT(f.id, rerunConsent(f, chunks), chunks, { purpose: "rerun-successful" }); void running.catch(() => {}); await entered.promise;
    if (boundary === "lock") await f.core.lock(); else { f.core.getSnapshot().onCancelSTT?.(f.id); await vi.waitFor(() => expect(f.core.getSnapshot().busy).toBe(false)); }
    response.resolve(new Response(JSON.stringify({ text: "SYNTHETIC_LATE_RESPONSE_MUST_NOT_SELECT" }))); await expect(running).rejects.toBeTruthy();
    if (boundary === "lock") await f.core.unlock(secret);
    expect(f.project().rawTranscripts).toEqual(before.rawTranscripts); expect(f.project().transcriptVersions).toEqual(before.transcriptVersions); expect(f.project().selectedTranscriptVersionId).toBe(before.selectedTranscriptVersionId);
    expect(f.project().runs.at(-1)?.state).toBe("outcome-unknown"); expect(f.requests).toHaveLength(3);
});
it("chooses a new transcript for minutes consent without extra STT and counts each saved run once", async () => {
    const f = await fixture(); await f.core.startSTT(f.id, initialConsent(f));
    const notesModel = validateRegistration({ ...createModelPreset('openrouter-text', () => 'synthetic-notes-model'), modelId: routerModel.id, enabled: true, routerPolicy: { requireZdr: true, acknowledged: true }, llm: { tokenField: 'max_tokens', contextTokens: 32000, maxTokens: 4096 } });
    await f.core.getSnapshot().onSaveRegistration!(notesModel, { action: 'replace', value: 'SYNTHETIC_ROUTER_KEY_NO_NETWORK' });
    await f.core.setMinutesRoute(f.id, notesModel.id); const prior = f.core.getSnapshot().minutesConsentToken; expect(prior).toBeTruthy();
    await f.core.generateMinutes(f.id, { acknowledged: true, transcriptVersionId: f.project().selectedTranscriptVersionId!, consentToken: prior!, partialAcknowledged: false });
    const minutes = f.project().minutesRuns, revisions = f.project().minutesRevisions, selectedMinutes = f.project().selectedMinutesRevisionId;
    const chunks = [f.project().preparedChunks[0].id]; await f.core.startSTT(f.id, rerunConsent(f, chunks), chunks, { purpose: "rerun-successful" });
    expect(f.core.getSnapshot().minutesConsentToken).toBe(prior); expect(f.project().minutesRuns).toEqual(minutes); expect(f.project().minutesRevisions).toEqual(revisions); expect(f.project().selectedMinutesRevisionId).toBe(selectedMinutes); const candidate = f.project().transcriptVersions.at(-1)!;
    f.core.getSnapshot().onSelectTranscript?.(f.id, candidate.id); await vi.waitFor(() => expect(f.project().selectedTranscriptVersionId).toBe(candidate.id)); await vi.waitFor(() => expect(f.core.getSnapshot().minutesConsentToken).not.toBe(prior));
    const usage = aggregateProjectUsage(f.project()).stt; expect(usage.attemptCount).toBe(3); expect(usage.responseCount).toBe(3); expect(usage.dimensions.durationSeconds.subtotal).toBe(3); expect(usage.transcribedChunks).toBe(2); expect(f.requests).toHaveLength(3); expect(f.minutesRequests).toHaveLength(1);
});
it.each(["source", "chunk"] as const)("rejects a frozen retry after synthetic %s identity is removed before key access", async changed => {
    const f = await fixture({ respond: async attempt => attempt === 3 ? new Response(JSON.stringify({ error: { message: "TEST_ONLY_FAILURE" } }), { status: 429 }) : new Response(JSON.stringify({ text: `SYNTHETIC_RESULT_${attempt}` })) });
    await f.core.startSTT(f.id, initialConsent(f)); const chunks = [f.project().preparedChunks[0].id];
    await expect(f.core.startSTT(f.id, rerunConsent(f, chunks), chunks, { purpose: "rerun-successful" })).rejects.toBeTruthy(); const batch = f.project().sttBatches!.at(-1)!;
    const next = { ...f.project(), ...(changed === "source" ? { sourceAssets: [] } : { preparedChunks: f.project().preparedChunks.filter(chunk => chunk.id !== chunks[0]) }) };
    await f.session.store.checkpoint({ project: next, runId: null, audioRecords: [] }, createJobContext()); await f.core.lock(); await f.core.unlock(secret); const reads = f.keyReads;
    await expect(f.core.startSTT(f.id, rerunConsent(f, chunks, batch.id), chunks, { purpose: "retry-failed", batchId: batch.id })).rejects.toMatchObject({ code: "invalid-input" }); expect(f.keyReads).toBe(reads); expect(f.requests).toHaveLength(3);
});
it("opens legacy encrypted projects without inventing batch provenance or replaying historic responses", async () => {
    const f = await fixture(); await f.core.startSTT(f.id, initialConsent(f)); const before = f.project();
    const legacy = { ...before, sttBatches: undefined, transcriptVersions: before.transcriptVersions.map(version => ({ ...version, batchId: undefined, createdAt: undefined })), runs: before.runs.map(run => ({ ...run, intent: undefined })) };
    await f.session.store.checkpoint({ project: JSON.parse(JSON.stringify(legacy)), runId: null, audioRecords: [] }, createJobContext()); await f.core.lock(); await f.core.unlock(secret);
    expect(f.project().sttBatches).toBeUndefined(); expect(f.core.getSnapshot().chunkStates?.every(chunk => chunk.state === "saved")).toBe(true); expect(f.project().transcriptVersions.every(version => version.batchId === undefined && version.createdAt === undefined)).toBe(true); expect(f.requests).toHaveLength(2);
    const chunks = [before.preparedChunks[0].id]; await f.core.startSTT(f.id, rerunConsent(f, chunks), chunks, { purpose: "rerun-successful" }); const batch = f.project().sttBatches![0];
    expect(batch.parentBatchId).toBeNull(); expect(batch.parentTranscriptVersionId).toBe(before.selectedTranscriptVersionId); expect(f.project().selectedTranscriptVersionId).toBe(before.selectedTranscriptVersionId); expect(f.requests).toHaveLength(3);
});
it("rejects a failed paid attempt disguised as a newly acknowledged initial request", async () => {
    const f = await fixture({ respond: async attempt => attempt === 2 ? new Response(JSON.stringify({ error: { message: "TEST_ONLY_FAILURE" } }), { status: 429 }) : new Response(JSON.stringify({ text: `SYNTHETIC_RESULT_${attempt}` })) });
    await expect(f.core.startSTT(f.id, initialConsent(f))).rejects.toBeTruthy(); const chunkIds = [f.project().preparedChunks[1].id], reads = f.keyReads;
    const consentToken = sttActionToken(f.core.getSnapshot().sttConsentToken, f.project(), { purpose: "initial", chunkIds, modelId: "gpt-transcribe" });
    await expect(f.core.startSTT(f.id, { modelId: "gpt-transcribe", acknowledged: true, consentToken }, chunkIds, { purpose: "initial" })).rejects.toMatchObject({ code: "invalid-input" });
    expect(f.keyReads).toBe(reads); expect(f.requests).toHaveLength(2); expect(f.project().sttBatches).toHaveLength(1);
});
it("pins multiple ISO language hints without translating raw mixed-language text or inventing word timings", async () => {
    const text = "TEST_ONLY_한국어 English 발화", f = await fixture({ respond: async () => new Response(JSON.stringify({ text })) });
    await f.core.startSTT(f.id, initialConsent(f));
    const frozen = f.project().sttBatches![0]; expect(frozen.languages).toEqual(["ko", "en"]);
    for (const request of f.requests) { const form = request.body as FormData; expect(form.getAll("languages[]")).toEqual(["ko", "en"]); expect(form.has("language")).toBe(false); expect(form.has("prompt")).toBe(false); }
    for (const raw of f.project().rawTranscripts) { expect(raw.text).toBe(text); expect(raw.response).toEqual({ text }); expect(raw.execution?.expectedLanguages).toEqual(frozen.languages); expect(raw.timing).toBe("chunk"); }
});

it("switches a failed retry to a new model batch with exact selected scope and leaves old batches and selected edits unchanged", async () => {
    const f = await fixture({ respond: async attempt => attempt === 3 ? new Response(JSON.stringify({ error: { message: "SYNTHETIC_FAILED_RERUN" } }), { status: 429 }) : new Response(JSON.stringify({ text: `SYNTHETIC_RESULT_${attempt}` })) });
    await f.core.startSTT(f.id, initialConsent(f));
    const initial = f.project(), version = initial.transcriptVersions.find(item => item.id === initial.selectedTranscriptVersionId)!;
    await f.core.editTranscript(f.id, version.id, version.segments[0].id, "SYNTHETIC_RETAIN_EDIT");
    const chunkIds = [f.project().preparedChunks[0].id];
    await expect(f.core.startSTT(f.id, rerunConsent(f, chunkIds), chunkIds, { purpose: "rerun-successful" })).rejects.toMatchObject({ code: "rate-limit" });
    const before = f.project(), oldBatches = structuredClone(before.sttBatches), selected = before.selectedTranscriptVersionId;
    f.core.getSnapshot().onSTTModel?.("gpt-4o-mini-transcribe");
    await vi.waitFor(() => { expect(f.core.getSnapshot().sttModelId).toBe("gpt-4o-mini-transcribe"); expect(f.core.getSnapshot().busy).toBe(false); });
    const modelId = "gpt-4o-mini-transcribe", consentToken = sttActionToken(f.core.getSnapshot().sttConsentToken, f.project(), { purpose: "retry-failed", chunkIds, modelId });
    await expect(f.core.startSTT(f.id, { modelId, acknowledged: true, additionalChargeAcknowledged: false, consentToken }, chunkIds, { purpose: "retry-failed" })).rejects.toMatchObject({ code: "invalid-input" });
    expect(f.requests).toHaveLength(3);
    await f.core.startSTT(f.id, { modelId, acknowledged: true, additionalChargeAcknowledged: true, consentToken }, chunkIds, { purpose: "retry-failed" });
    expect(f.requests).toHaveLength(4); expect((f.requests[3].body as FormData).get('model')).toBe(modelId);
    expect(f.project().sttBatches!.slice(0, oldBatches!.length)).toEqual(oldBatches);
    expect(f.project().sttBatches!.at(-1)).toMatchObject({ modelId, purpose: 'retry-failed', chunkIds });
    expect(f.project().rawTranscripts.slice(0, before.rawTranscripts.length)).toEqual(before.rawTranscripts);
    expect(f.project().rawTranscripts.at(-1)?.chunkId).toBe(chunkIds[0]);
    expect(f.project().selectedTranscriptVersionId).toBe(selected);
    expect(f.project().transcriptVersions.find(item => item.id === selected)?.segments[0].text).toBe('SYNTHETIC_RETAIN_EDIT');
    expect(f.project().minutesRuns).toEqual(before.minutesRuns);
});

it.each([true, false])('blocks a known data-policy rejection until explicit policy review without automatic replay (reported code: %s)', async reportedCode => {
    const f = await fixture({ respond: async attempt => attempt === 1 ? new Response(JSON.stringify({ error: { ...(reportedCode ? { code: 404 } : {}), message: 'PRIVATE_POLICY_MESSAGE', metadata: { failed_routing_step: 'Filter by Data Policy' } } }), { status: 404 }) : new Response(JSON.stringify({ text: 'SYNTHETIC_POLICY_REVIEW_RESULT' })) });
    await f.core.getSnapshot().onSaveRegistration!({ ...createModelPreset('router-qwen3-asr-1.7b', () => 'router-policy'), enabled: true, routerPolicy: { requireZdr: true, acknowledged: true } }, { action: 'replace', value: 'SYNTHETIC_ROUTER_KEY' });
    f.core.getSnapshot().onSTTModel!('router-policy');
    await vi.waitFor(() => { expect(f.core.getSnapshot().sttModelId).toBe('router-policy'); expect(f.core.getSnapshot().busy).toBe(false); });
    const chunks = f.project().preparedChunks.map(chunk => chunk.id);
    const consent = (purpose: 'initial' | 'retry-failed', selected = chunks) => ({ modelId: 'router-policy', acknowledged: true as const, additionalChargeAcknowledged: true, consentToken: sttActionToken(f.core.getSnapshot().sttConsentToken, f.project(), { purpose, chunkIds: selected, modelId: 'router-policy' }) });
    await expect(f.core.startSTT(f.id, consent('initial'))).rejects.toMatchObject({ code: 'data-policy' });
    expect(f.core.getSnapshot().sttPolicyBlockedModels).toContain('router-policy');
    expect(f.core.getSnapshot().error).not.toContain('PRIVATE_POLICY_MESSAGE');
    const before = structuredClone(f.project().sttBatches);
    await expect(f.core.startSTT(f.id, consent('retry-failed'), chunks, { purpose: 'retry-failed' })).rejects.toMatchObject({ code: 'data-policy' });
    expect(f.requests).toHaveLength(1); expect(f.project().sttBatches).toEqual(before);
    expect(JSON.parse(f.requests[0].body as string).provider).toMatchObject({ data_collection: 'deny', zdr: true });
    await f.core.lock(); await f.core.unlock(secret);
    expect(f.core.getSnapshot().sttPolicyBlockedModels).toContain('router-policy');
    const credential = f.core.getSnapshot().modelRegistrations!.credentials!.find(item => item.origin === 'https://openrouter.ai')!;
    await f.core.getSnapshot().onSaveApiCredential!({ ...credential, routerPolicy: { requireZdr: false, acknowledged: true } }, { action: 'keep' });
    expect(f.core.getSnapshot().sttPolicyBlockedModels).not.toContain('router-policy'); expect(f.requests).toHaveLength(1);
    await f.core.startSTT(f.id, consent('retry-failed', [chunks[0]]), [chunks[0]], { purpose: 'retry-failed' });
    expect(f.requests).toHaveLength(2);
    expect(JSON.parse(f.requests[1].body as string).provider).toMatchObject({ data_collection: 'deny', zdr: false });
    expect(f.project().sttBatches![0]).toEqual(before![0]);
});
