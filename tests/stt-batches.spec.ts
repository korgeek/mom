import { afterEach, describe, expect, it, vi } from "vitest";
import { cancelJobs, createJobContext } from "../src/react-app/domain/jobs";
import { ProviderError, runTranscriptionQueue } from "../src/react-app/domain/pipeline";
import type { CheckpointResult, MeetingProject, RawTranscript, STTBatch, VaultStore } from "../src/react-app/domain/types";
import { appendBatchAttempt, batchStatus, createSTTBatch, mergeBatch, replaceSTTBatch, selectBatchRaw, selectChunkRaw, selectedRawMap, validateSTTBatch } from "../src/react-app/transcript/batches";
import { mergeTranscripts } from "../src/react-app/transcript/merge";
import { reconcileBoundary } from '../src/react-app/transcript/versions';

const date = "2026-10-02T14:00:00.000Z";
function project(): MeetingProject {
    return { id: "synthetic-project", title: "SYNTHETIC_BATCH_TITLE", icon: "mic", color: "blue", pinned: false, createdAt: date, updatedAt: date,
        sourceAssets: [{ id: "source", fileName: "SYNTHETIC.wav", bytes: 6, container: "wav", codec: "pcm", durationMs: 2000, channels: 1, sampleRateHz: 16000 }],
        audioOptions: { chunkMinutes: 5, overlapSeconds: 5, expectedLanguages: ["ko", "en"], bitrateKbps: 32, sampleRateHz: 16000 },
        preparedChunks: [0, 1].map(index => ({ id: `chunk-${index}`, sourceId: "source", index, sourceStartMs: index * 1000, sourceEndMs: (index + 1) * 1000, encodingOffsetMs: 0, encodedBytes: 3, mimeType: "audio/mpeg", codec: "mp3", audioRecordId: `audio-${index}` })),
        rawTranscripts: [], transcriptVersions: [], selectedTranscriptVersionId: null, minutesSettings: { outputLanguage: "en", sections: ["summary"], instructions: "", modelId: "fixture/text" }, minutesRuns: [], minutesRevisions: [], selectedMinutesRevisionId: null, runs: [] };
}
function raw(chunkId: string, runId: string, text = "SYNTHETIC_BATCH_SPEECH"): RawTranscript {
    return { id: `raw-${runId}`, chunkId, runId, response: { text }, text, segments: [], timing: "chunk", speakerScope: "none", execution: null };
}
function receipt(p: MeetingProject, runId: string | null): CheckpointResult {
    const checkpoint = { id: crypto.randomUUID(), projectId: p.id, runId, recordIds: [p.id], committedAt: date };
    return { checkpoint, project: { ...p, runs: p.runs.map(run => run.id === runId ? { ...run, state: "saved", checkpoint } : run) } };
}
function store(checkpoint: VaultStore["checkpoint"]): VaultStore {
    return { listProjects: async () => [], readProject: async () => null, readAudio: async () => new Blob(["abc"], { type: "audio/mpeg" }), checkpoint, deleteProject: async () => {} };
}
function completed() {
    const p = project();
    const saved = receipt(receipt({ ...p, rawTranscripts: [raw("chunk-0", "original-0"), raw("chunk-1", "original-1")], runs: ["original-0", "original-1"].map(id => ({ id, projectId: p.id, state: "saving", checkpoint: null })) }, "original-0").project, "original-1").project;
    const version = mergeTranscripts(saved.rawTranscripts, { expectedChunks: saved.preparedChunks, sourceEndMs: 2000 });
    return { ...saved, transcriptVersions: [version], selectedTranscriptVersionId: version.id };
}
const route = { connectionId: "openai", provider: "openai", stage: "stt", modelId: "gpt-transcribe", endpointTag: null } as const;
function batch(p: MeetingProject, purpose: STTBatch["purpose"] = "rerun-successful", chunkIds = ["chunk-0"]) { return createSTTBatch(p, { purpose, chunkIds, modelId: route.modelId, languages: ["ko", "en"], route }, { createdAt: date, id: crypto.randomUUID() }); }
afterEach(cancelJobs);
it('fills a newly completed missing chunk while preserving selected edits, originals and existing notes', async () => {
    const base = completed(), first = base.rawTranscripts[0];
    const merged = mergeTranscripts([first], { expectedChunks: base.preparedChunks, sourceEndMs: 2000 });
    const selected = { ...merged, parentId: 'previous-version', segments: merged.segments.map(segment => ({ ...segment, text: 'SYNTHETIC_SELECTED_EDIT' })) };
    const p = { ...base, rawTranscripts: [first], runs: base.runs.slice(0, 1), transcriptVersions: [selected], selectedTranscriptVersionId: selected.id };
    const frozen = batch(p, 'transcribe-selected', ['chunk-1']);
    const result = await runTranscriptionQueue({ project: replaceSTTBatch(p, frozen), batch: frozen, purpose: 'transcribe-selected', acknowledgeAdditionalCharge: true, chunkIds: frozen.chunkIds, modelId: frozen.modelId, languages: frozen.languages, job: createJobContext(), vault: store(async ({ project, runId }) => receipt(project, runId)), provider: { transcribe: async request => raw(request.chunk.id, request.runId, 'SYNTHETIC_NEW_CHUNK') } });
    expect(result.failure).toBeNull();
    const next = result.project.transcriptVersions.find(version => version.id === result.project.selectedTranscriptVersionId)!;
    expect(next.segments.map(segment => segment.text)).toEqual(['SYNTHETIC_SELECTED_EDIT', 'SYNTHETIC_NEW_CHUNK']);
    expect(next.missingRanges).toEqual([]); expect(next.parentId).toBe(selected.id);
    expect(result.project.transcriptVersions[0]).toEqual(selected); expect(result.project.rawTranscripts[0]).toEqual(first);
    expect(result.project.minutesRuns).toEqual(p.minutesRuns);
});
it('keeps a selected edit when a newly filled timed chunk shares the same boundary utterance', async () => {
    const base = completed(), chunk = { ...base.preparedChunks[0], sourceEndMs: 1500 };
    const first = { ...base.rawTranscripts[0], timing: 'segment' as const, segments: [{ id: 'old-boundary', text: 'Original boundary', sourceStartMs: 1000, sourceEndMs: 1200, rawIds: [base.rawTranscripts[0].id] }] };
    const chunks = [chunk, base.preparedChunks[1]], merged = mergeTranscripts([first], { expectedChunks: chunks, sourceEndMs: 2000 });
    const selected = { ...merged, parentId: 'before-edit', segments: [{ ...merged.segments[0], text: 'SYNTHETIC_HUMAN_CORRECTION' }] };
    const p = { ...base, preparedChunks: chunks, rawTranscripts: [first], runs: base.runs.slice(0, 1), transcriptVersions: [selected], selectedTranscriptVersionId: selected.id };
    const frozen = batch(p, 'transcribe-selected', ['chunk-1']);
    const result = await runTranscriptionQueue({ project: replaceSTTBatch(p, frozen), batch: frozen, purpose: 'transcribe-selected', acknowledgeAdditionalCharge: true, chunkIds: frozen.chunkIds, modelId: frozen.modelId, languages: frozen.languages, job: createJobContext(), vault: store(async ({ project, runId }) => receipt(project, runId)), provider: { transcribe: async request => {
        const next = raw(request.chunk.id, request.runId);
        return { ...next, timing: 'segment', segments: [{ ...first.segments[0], id: 'new-boundary', rawIds: [next.id] }, { id: 'tail', text: 'SYNTHETIC_NEW_TAIL', sourceStartMs: 1200, sourceEndMs: 2000, rawIds: [next.id] }] };
    } } });
    expect(result.failure).toBeNull();
    const next = result.project.transcriptVersions.find(version => version.id === result.project.selectedTranscriptVersionId)!;
    expect(next.segments.map(segment => segment.text)).toEqual(['SYNTHETIC_HUMAN_CORRECTION', 'SYNTHETIC_NEW_TAIL']);
    expect(next.segments[0].rawIds).toHaveLength(2); expect(next.missingRanges).toEqual([]);
});
it('reruns a saved original without requiring it in the selected transcript', async () => {
    const p = { ...completed(), transcriptVersions: [], selectedTranscriptVersionId: null }, frozen = batch(p);
    const transcribe = vi.fn(async (request: Parameters<import('../src/react-app/domain/types').STTProvider['transcribe']>[0]) => raw(request.chunk.id, request.runId));
    await runTranscriptionQueue({ project: replaceSTTBatch(p, frozen), batch: frozen, purpose: 'rerun-successful', chunkIds: frozen.chunkIds, modelId: frozen.modelId, languages: frozen.languages, acknowledgeAdditionalCharge: true, job: createJobContext(), vault: store(async ({ project, runId }) => receipt(project, runId)), provider: { transcribe } });
    expect(transcribe).toHaveBeenCalledOnce();
});
it.each(['remaining', 'all'])('transcribes the explicitly confirmed %s scope with saved, unknown and untouched chunks', async scope => {
    const base = completed(), chunks = [0, 1, 2, 3].map(index => ({ ...base.preparedChunks[0], id: `chunk-${index}`, index, sourceStartMs: index * 1000, sourceEndMs: (index + 1) * 1000 }));
    const p = { ...base, sourceAssets: [{ ...base.sourceAssets[0], durationMs: 4000 }], preparedChunks: chunks, runs: [...base.runs, { id: 'unknown-attempt', projectId: base.id, state: 'outcome-unknown' as const, checkpoint: null, intent: { kind: 'stt' as const, chunkId: 'chunk-2', requestedModel: route.modelId, expectedLanguages: [], requestedEndpoint: null, rateSnapshot: null } }] };
    const ids = scope === 'remaining' ? ['chunk-2', 'chunk-3'] : chunks.map(chunk => chunk.id), frozen = batch(p, 'transcribe-selected', ids), calls: string[] = [];
    const result = await runTranscriptionQueue({ project: replaceSTTBatch(p, frozen), batch: frozen, purpose: 'transcribe-selected', chunkIds: ids, modelId: frozen.modelId, languages: frozen.languages, acknowledgeAdditionalCharge: true, acknowledgeUnknownOutcome: true, job: createJobContext(), vault: store(async ({ project, runId }) => receipt(project, runId)), provider: { transcribe: async request => { calls.push(request.chunk.id); return raw(request.chunk.id, request.runId); } } });
    expect(calls).toEqual(ids); expect(result.project.rawTranscripts.slice(0, 2)).toEqual(p.rawTranscripts);
    expect(result.project.transcriptVersions.at(-1)?.missingRanges).toEqual([]);
    const selected = result.project.transcriptVersions.find(version => version.id === result.project.selectedTranscriptVersionId)!;
    expect(selected.missingRanges).toEqual([]);
    expect(selected.rawIds).toContain(p.rawTranscripts[0].id); expect(selected.rawIds).toContain(p.rawTranscripts[1].id);
    expect(result.project.transcriptVersions).toContainEqual(p.transcriptVersions[0]);
});
it('requires new additional-charge consent for a mixed scope before reading audio', async () => {
    const p = completed(), frozen = batch(p, 'transcribe-selected', ['chunk-0', 'chunk-1']), readAudio = vi.fn(), transcribe = vi.fn();
    await expect(runTranscriptionQueue({ project: replaceSTTBatch(p, frozen), batch: frozen, purpose: 'transcribe-selected', chunkIds: frozen.chunkIds, modelId: frozen.modelId, languages: frozen.languages, job: createJobContext(), vault: { ...store(vi.fn()), readAudio }, provider: { transcribe } })).rejects.toMatchObject({ code: 'invalid-input' });
    expect(readAudio).not.toHaveBeenCalled(); expect(transcribe).not.toHaveBeenCalled();
});
it('selects only the chosen chunk result and retains distinct same-time edits in other chunks', () => {
    const base = completed(), second = base.rawTranscripts[1];
    const secondRaw = { ...second, timing: 'segment' as const, speakerScope: 'chunk' as const, segments: ['ONE', 'TWO'].map((text, index) => ({ id: `word-${index}`, text, sourceStartMs: 1000, sourceEndMs: 2000, rawIds: [second.id] })) };
    const raws = [base.rawTranscripts[0], secondRaw], original = mergeTranscripts(raws, { expectedChunks: base.preparedChunks, sourceEndMs: 2000 });
    const edited = { ...original, segments: original.segments.map((segment, index) => index ? { ...segment, text: `SYNTHETIC_EDIT_${index}` } : segment) };
    const alternative = raw('chunk-0', 'alternative-run', 'SYNTHETIC_CHOSEN');
    const p = receipt({ ...base, rawTranscripts: [...raws, alternative], transcriptVersions: [edited], selectedTranscriptVersionId: edited.id, runs: [...base.runs, { id: alternative.runId, projectId: base.id, state: 'saving', checkpoint: null }] }, alternative.runId).project;
    const before = structuredClone(p), result = selectChunkRaw(p, 'chunk-0', alternative.id), version = result.transcriptVersions.at(-1)!;
    expect(version.segments.map(segment => segment.text)).toEqual(['SYNTHETIC_CHOSEN', 'SYNTHETIC_EDIT_1', 'SYNTHETIC_EDIT_2']);
    expect(version.rawIds).toEqual([alternative.id, second.id]); expect(result.selectedTranscriptVersionId).toBe(version.id);
    expect(p).toEqual(before); expect(result.rawTranscripts).toEqual(p.rawTranscripts); expect(result.transcriptVersions[0]).toEqual(edited);
    expect(selectChunkRaw(result, 'chunk-0', alternative.id)).toBe(result);
    expect(() => selectChunkRaw(p, 'chunk-1', alternative.id)).toThrow();
    expect(() => selectChunkRaw({ ...p, runs: p.runs.map(run => run.id === alternative.runId ? { ...run, state: 'saving', checkpoint: null } : run) }, 'chunk-0', alternative.id)).toThrow();
});
it('retains reconciled untouched overlaps and reopens only boundaries adjacent to the chosen chunk', () => {
    const base = completed(), third = { ...base.preparedChunks[1], id: 'chunk-2', index: 2, sourceStartMs: 2000, sourceEndMs: 3000 };
    const chunks = [{ ...base.preparedChunks[0], sourceEndMs: 1500 }, { ...base.preparedChunks[1], sourceEndMs: 2500 }, third];
    const thirdRaw = raw(third.id, 'third-run'), alternative = raw(third.id, 'third-alternative', 'SYNTHETIC_CHOSEN_THIRD');
    const raws = [...base.rawTranscripts, thirdRaw];
    const merged = mergeTranscripts(raws, { expectedChunks: chunks, sourceEndMs: 3000 });
    const edited = reconcileBoundary(merged, merged.issues[0].id, []);
    const p = receipt(receipt({ ...base, sourceAssets: [{ ...base.sourceAssets[0], durationMs: 3000 }], preparedChunks: chunks, rawTranscripts: [...raws, alternative], transcriptVersions: [merged, edited], selectedTranscriptVersionId: edited.id, runs: [...base.runs, ...[thirdRaw, alternative].map(item => ({ id: item.runId, projectId: base.id, state: 'saving' as const, checkpoint: null }))] }, thirdRaw.runId).project, alternative.runId).project;
    const result = selectChunkRaw(p, third.id, alternative.id).transcriptVersions.at(-1)!;
    expect(result.issues[0]).toEqual(edited.issues[0]); expect(result.issues[0].selected).not.toBeNull();
    expect(result.issues[1].selected).toBeNull(); expect(result.issues[1].alternatives.flat().some(segment => segment.text === 'SYNTHETIC_CHOSEN_THIRD')).toBe(true);
    expect(result.segments).toHaveLength(3);
});
describe("STT successful reruns", () => {
    it("dispatches exactly one new explicit successful-chunk attempt and preserves earlier raw results", async () => {
        const p = completed(), calls: string[] = [];
        const frozen = batch(p);
        const options = { project: replaceSTTBatch(p, frozen), batch: frozen, chunkIds: ["chunk-0"], purpose: "rerun-successful" as const, modelId: "gpt-transcribe", languages: ["ko", "en"], acknowledgeAdditionalCharge: true,
            job: createJobContext(), vault: store(async ({ project, runId }) => receipt(project, runId)), provider: { transcribe: async (request: Parameters<import("../src/react-app/domain/types").STTProvider["transcribe"]>[0]) => { calls.push(request.chunk.id); return raw(request.chunk.id, request.runId, "SYNTHETIC_NEW_ANSWER"); } } };
        const result = await runTranscriptionQueue(options);
        expect(calls).toEqual(["chunk-0"]);
        expect(result.project.rawTranscripts).toHaveLength(3);
        expect(result.project.rawTranscripts.slice(0, 2)).toEqual(p.rawTranscripts);
        expect(result.failure).toBeNull();
        expect(result.project.selectedTranscriptVersionId).toBe(p.selectedTranscriptVersionId);
        const current = result.project.sttBatches![0];
        expect(current.attemptRunIds).toHaveLength(1); expect(current.selectedRawIdsByChunk["chunk-0"]).toBe(result.project.rawTranscripts[2].id);
        expect(current.selectedRawIdsByChunk["chunk-1"]).toBe(p.rawTranscripts[1].id);
        expect(mergeBatch(result.project, current).rawIds).toEqual([result.project.rawTranscripts[2].id, p.rawTranscripts[1].id]);
    });
    it("requires a fresh additional-charge acknowledgment before audio reads or writes", async () => {
        const p = completed(), frozen = batch(p), reads = vi.fn(async () => new Blob(["abc"])), checkpoint = vi.fn(async ({ project, runId }: Parameters<VaultStore["checkpoint"]>[0]) => receipt(project, runId)), transcribe = vi.fn();
        await expect(runTranscriptionQueue({ project: replaceSTTBatch(p, frozen), batch: frozen, purpose: "rerun-successful", chunkIds: frozen.chunkIds, modelId: frozen.modelId, languages: frozen.languages, job: createJobContext(), vault: { ...store(checkpoint), readAudio: reads }, provider: { transcribe } })).rejects.toMatchObject({ code: "invalid-input" });
        expect(reads).not.toHaveBeenCalled(); expect(checkpoint).not.toHaveBeenCalled(); expect(transcribe).not.toHaveBeenCalled();
    });
    it("freezes detached source/scope/route/language and the exact selected parent raw map", () => {
        const p = completed(), scope = ["chunk-0"], languages = ["ko", "en"], chosenRoute = { ...route, modelId: String(route.modelId) };
        const frozen = createSTTBatch(p, { purpose: "rerun-successful", chunkIds: scope, modelId: route.modelId, languages, route: chosenRoute }, { id: "synthetic-batch", createdAt: date });
        scope.push("chunk-1"); languages.push("sw"); chosenRoute.modelId = "gpt-4o-mini-transcribe";
        expect(frozen.route.modelId).toBe("gpt-transcribe"); expect(frozen.chunkIds).toEqual(["chunk-0"]); expect(frozen.languages).toEqual(["ko", "en"]);
        expect(frozen.parentTranscriptVersionId).toBe(p.selectedTranscriptVersionId); expect(frozen.parentBatchId).toBeNull();
        expect(frozen.parentSelectedRawIdsByChunk).toEqual({ "chunk-0": p.rawTranscripts[0].id, "chunk-1": p.rawTranscripts[1].id });
        for (const value of [frozen, frozen.route, frozen.chunkIds, frozen.languages, frozen.parentSelectedRawIdsByChunk, frozen.selectedRawIdsByChunk]) expect(Object.isFrozen(value)).toBe(true);
    });
    it("rejects ambiguous legacy selected raw history instead of choosing an answer", () => {
        const p = completed(), alternative = raw("chunk-0", "another-old-answer");
        const corrupted = { ...p, rawTranscripts: [...p.rawTranscripts, alternative], transcriptVersions: [{ ...p.transcriptVersions[0], rawIds: [...p.transcriptVersions[0].rawIds, alternative.id] }] };
        expect(() => selectedRawMap(corrupted)).toThrow(); expect(() => batch(corrupted)).toThrow();
    });
    it.each(["source", "chunk", "route", "parent-map"])("rejects a changed %s before a request can be admitted", kind => {
        const p = completed(), frozen = batch(p);
        const changed = kind === "source" ? { ...p, sourceAssets: [] } : kind === "chunk" ? { ...p, preparedChunks: p.preparedChunks.filter(chunk => chunk.id !== "chunk-0") } : p;
        const altered = kind === "route" ? { ...frozen, route: { ...frozen.route, modelId: "different" } } : kind === "parent-map" ? { ...frozen, parentSelectedRawIdsByChunk: { "chunk-0": p.rawTranscripts[1].id } } : frozen;
        expect(() => validateSTTBatch(changed, altered)).toThrow();
    });
    it("merges only pinned batch results and keeps a failed rerun's inherited result explicit", async () => {
        const p = completed(), frozen = batch(p);
        const result = await runTranscriptionQueue({ project: replaceSTTBatch(p, frozen), batch: frozen, purpose: "rerun-successful", chunkIds: frozen.chunkIds, modelId: frozen.modelId, languages: frozen.languages, acknowledgeAdditionalCharge: true, job: createJobContext(), vault: store(async ({ project, runId }) => receipt(project, runId)), provider: { transcribe: async () => { throw new ProviderError("network", { outcomeUnknown: true }); } } });
        const current = result.project.sttBatches![0]; expect(batchStatus(result.project, current)).toBe("outcome-unknown");
        expect(mergeBatch(result.project, current).rawIds).toEqual(p.transcriptVersions[0].rawIds);
        expect(current.parentSelectedRawIdsByChunk).toEqual(frozen.parentSelectedRawIdsByChunk);
    });
    it("retries only the chosen failed batch member using its original frozen inputs", async () => {
        const p = project(), frozen = batch(p, "initial", ["chunk-0", "chunk-1"]); let calls = 0;
        const first = await runTranscriptionQueue({ project: replaceSTTBatch(p, frozen), batch: frozen, purpose: "initial", chunkIds: frozen.chunkIds, modelId: frozen.modelId, languages: frozen.languages, job: createJobContext(), vault: store(async ({ project, runId }) => receipt(project, runId)), provider: { transcribe: async request => { if (++calls === 2) throw new ProviderError("network", { outcomeUnknown: true }); return raw(request.chunk.id, request.runId); } } });
        const current = first.project.sttBatches![0], inputs: unknown[] = [];
        const next = await runTranscriptionQueue({ project: first.project, batch: current, purpose: "retry-failed", chunkIds: ["chunk-1"], modelId: current.modelId, languages: current.languages, acknowledgeAdditionalCharge: true, acknowledgeUnknownOutcome: true, job: createJobContext(), vault: store(async ({ project, runId }) => receipt(project, runId)), provider: { transcribe: async request => { inputs.push([request.chunk.id, request.modelId, request.expectedLanguages]); return raw(request.chunk.id, request.runId); } } });
        expect(inputs).toEqual([["chunk-1", "gpt-transcribe", ["ko", "en"]]]); expect(next.project.sttBatches).toHaveLength(1); expect(next.project.sttBatches![0].attemptRunIds).toHaveLength(3); expect(batchStatus(next.project, next.project.sttBatches![0])).toBe("complete");
    });
    it("does not merge an unsaved result or an ID from another chunk", () => {
        const p = completed(), frozen = batch(p);
        expect(() => mergeBatch(p, { ...frozen, selectedRawIdsByChunk: { "chunk-0": p.rawTranscripts[1].id } })).toThrow();
        const attempt = appendBatchAttempt(frozen, "pending"), answer = raw("chunk-0", "pending");
        const pending = { ...p, rawTranscripts: [...p.rawTranscripts, answer], runs: [...p.runs, { id: "pending", projectId: p.id, state: "saving" as const, checkpoint: null,
            intent: { kind: "stt" as const, chunkId: "chunk-0", requestedModel: attempt.modelId, expectedLanguages: attempt.languages, requestedEndpoint: null, rateSnapshot: null, sttBatchId: attempt.id, sttPurpose: attempt.purpose } }] };
        const selected = selectBatchRaw(pending, attempt, answer); expect(() => mergeBatch(pending, selected)).toThrow();
    });
});

it("rejects a result receipt that saved raw/run/map but omitted the atomic transcript candidate", async () => {
    const p = completed(), frozen = batch(p);
    const result = await runTranscriptionQueue({ project: replaceSTTBatch(p, frozen), batch: frozen, purpose: "rerun-successful", chunkIds: frozen.chunkIds, modelId: frozen.modelId, languages: frozen.languages, acknowledgeAdditionalCharge: true, job: createJobContext(),
        vault: store(async ({ project, runId }) => { const result = receipt(project, runId); return runId ? { ...result, project: { ...result.project, transcriptVersions: p.transcriptVersions } } : result; }),
        provider: { transcribe: async request => raw(request.chunk.id, request.runId) } });
    expect(result.failure?.code).toBe("storage"); expect(result.project.rawTranscripts).toEqual(p.rawTranscripts); expect(result.project.transcriptVersions).toEqual(p.transcriptVersions);
});

describe("stored STT batch intent provenance", () => {
    function ownResult() {
        const p = completed(), frozen = batch(p), runId = "synthetic-own-run", answer = raw("chunk-0", runId);
        const intent = { kind: "stt", chunkId: "chunk-0", requestedModel: frozen.modelId, expectedLanguages: frozen.languages, requestedEndpoint: null, rateSnapshot: null, sttBatchId: frozen.id, sttPurpose: frozen.purpose } as const;
        const saved = receipt({ ...p, rawTranscripts: [...p.rawTranscripts, answer], runs: [...p.runs, { id: runId, projectId: p.id, state: "saving", checkpoint: null, intent }] }, runId).project;
        const attempted = appendBatchAttempt(frozen, runId), mapped = { ...attempted, selectedRawIdsByChunk: { ...attempted.selectedRawIdsByChunk, "chunk-0": answer.id } };
        return { project: replaceSTTBatch(saved, mapped), batch: mapped, runId, answer };
    }
    it.each(["batch", "model", "languages", "kind", "endpoint", "purpose", "missing-intent"] as const)("rejects persisted own selected raw with inconsistent %s intent", field => {
        const fixture = ownResult();
        const changed = { ...fixture.project, runs: fixture.project.runs.map(run => run.id !== fixture.runId ? run : { ...run, intent: field === "missing-intent" ? undefined : {
            ...run.intent!, ...(field === "batch" ? { sttBatchId: "different-historic-batch" } : field === "model" ? { requestedModel: "gpt-4o-mini-transcribe" } : field === "languages" ? { expectedLanguages: ["ja"] } : field === "kind" ? { kind: "minutes" as const } : field === "endpoint" ? { requestedEndpoint: "different-endpoint" } : { sttPurpose: "initial" as const })
        } }) };
        // JSON round-trip represents an encrypted persisted project with genuinely absent optional fields.
        const persisted: MeetingProject = JSON.parse(JSON.stringify(changed));
        expect(() => validateSTTBatch(persisted, fixture.batch)).toThrow("Invalid STT batch provenance");
        expect(() => mergeBatch(persisted, fixture.batch)).toThrow("Invalid STT batch provenance");
    });
    it("rejects claiming another run as an own attempt even when selected raws remain inherited", () => {
        const p = completed(), frozen = appendBatchAttempt(batch(p), p.runs[0].id);
        expect(() => validateSTTBatch(replaceSTTBatch(p, frozen), frozen)).toThrow("Invalid STT batch provenance");
    });
    it("accepts a matching saved own intent while preserving parent results from another model/language", () => {
        const fixture = ownResult();
        const inherited = { ...fixture.project, runs: fixture.project.runs.map(run => run.id === fixture.runId ? run : { ...run, intent: { kind: "stt" as const, chunkId: fixture.project.rawTranscripts.find(raw => raw.runId === run.id)!.chunkId, requestedModel: "gpt-4o-mini-transcribe", expectedLanguages: ["ja"], requestedEndpoint: null, rateSnapshot: null, sttBatchId: "original-other-model-batch", sttPurpose: "initial" as const } }) };
        expect(() => validateSTTBatch(inherited, fixture.batch)).not.toThrow();
        expect(mergeBatch(inherited, fixture.batch).rawIds).toEqual([fixture.answer.id, inherited.rawTranscripts[1].id]);
        expect(inherited.runs[1].intent?.requestedModel).toBe("gpt-4o-mini-transcribe");
        expect(inherited.runs[1].intent?.expectedLanguages).toEqual(["ja"]);
    });
    it("accepts a matching retry intent in the original frozen batch", () => {
        const fixture = ownResult();
        const retried = { ...fixture.project, runs: fixture.project.runs.map(run => run.id === fixture.runId ? { ...run, intent: { ...run.intent!, sttPurpose: "retry-failed" as const } } : run) };
        expect(() => validateSTTBatch(retried, fixture.batch)).not.toThrow(); expect(mergeBatch(retried, fixture.batch).rawIds[0]).toBe(fixture.answer.id);
    });
});

it('OR_STT_boundary rejects persisted OR attempt rates that disagree with the original frozen batch', async () => {
  const { freezeRouterSTTSelection } = await import('../src/react-app/providers/stt-selection');
  const p = project(), route = { connectionId: 'openrouter', provider: 'openrouter' as const, stage: 'stt' as const, modelId: 'openai/gpt-4o-mini-transcribe', endpointTag: null };
  const selection = freezeRouterSTTSelection(p, ['chunk-0'], route, { id: route.modelId, name: 'Synthetic', source: 'https://openrouter.ai/api/v1/models', checkedAt: date, inputModalities: ['audio'], outputModalities: ['transcription'], adapterStatus: 'unsupported', pricing: { status: 'unknown', raw: null } }, { dataCollection: 'deny', requireZdr: true });
  const frozen = createSTTBatch(p, { purpose: 'initial', chunkIds: ['chunk-0'], modelId: route.modelId, languages: p.audioOptions.expectedLanguages, route, routerSelection: selection }, { createdAt: date });
  const attempted = appendBatchAttempt(frozen, 'attempt'), changed = replaceSTTBatch({ ...p, runs: [{ id: 'attempt', projectId: p.id, state: 'requesting', checkpoint: null, intent: { kind: 'stt', chunkId: 'chunk-0', requestedModel: route.modelId, expectedLanguages: p.audioOptions.expectedLanguages, requestedEndpoint: null, sttBatchId: frozen.id, sttPurpose: 'initial', rateSnapshot: getFixtureRate() } }] }, attempted);
  expect(() => validateSTTBatch(changed, attempted)).toThrow();
});
function getFixtureRate(): import('../src/react-app/domain/types').RateSnapshot { return { source: 'https://openrouter.ai/api/v1/models', checkedAt: date, currency: 'USD', rates: [{ unit: 'input-token', units: 1, price: 0.8 }] }; }
