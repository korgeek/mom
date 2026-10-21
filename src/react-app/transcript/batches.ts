import { validateTranscriptionHints } from '../domain/stt-settings';
import { snapshotProject } from "../domain/jobs";
import type { MeetingProject, RawTranscript, STTBatch, STTBatchPurpose, TranscriptVersion, RouterSTTSelection } from "../domain/types";
import { validateRouterSTTSelection } from '../providers/stt-selection';
import { mergeTranscripts } from "./merge";
import { registrationEndpoint, registrationSignature, validateRegistration } from '../providers/model-registrations';

function fail(): never { throw new Error("Invalid STT batch provenance"); }
function immutable<T>(value: T): T {
    const copy = structuredClone(value);
    const freeze = (item: unknown) => { if (item && typeof item === "object") { Object.freeze(item); Object.values(item).forEach(freeze); } };
    freeze(copy); return copy;
}
function sameMap(left: Readonly<Record<string, string>>, right: Readonly<Record<string, string>>) { return Object.keys(left).length === Object.keys(right).length && Object.entries(left).every(([key, value]) => right[key] === value); }
function selectedRaw(project: MeetingProject, chunkId: string, rawId: string, sourceId: string, saved: boolean): RawTranscript {
    const chunks = project.preparedChunks.filter(chunk => chunk.id === chunkId), matches = project.rawTranscripts.filter(raw => raw.id === rawId);
    if (chunks.length !== 1 || chunks[0].sourceId !== sourceId || matches.length !== 1 || matches[0].chunkId !== chunkId) fail();
    const raw = matches[0], runs = project.runs.filter(run => run.id === raw.runId);
    if (runs.length !== 1 || runs[0].projectId !== project.id || (runs[0].intent?.chunkId != null && runs[0].intent.chunkId !== chunkId)) fail();
    if (saved && (runs[0].state !== "saved" || !runs[0].checkpoint?.id || runs[0].checkpoint.projectId !== project.id || runs[0].checkpoint.runId !== raw.runId)) fail();
    return raw;
}
/** The selected version is the only inheritance source. Historic alternatives
 * without an explicit unique selection never become an inferred quality winner. */
export function selectedRawMap(project: MeetingProject, versionId = project.selectedTranscriptVersionId): Readonly<Record<string, string>> {
    if (versionId === null) return immutable({});
    const versions = project.transcriptVersions.filter(version => version.id === versionId);
    if (versions.length !== 1 || new Set(versions[0].rawIds).size !== versions[0].rawIds.length) fail();
    const map: Record<string, string> = {};
    for (const id of versions[0].rawIds) {
        const matches = project.rawTranscripts.filter(raw => raw.id === id);
        if (matches.length !== 1 || Object.prototype.hasOwnProperty.call(map, matches[0].chunkId)) fail();
        const chunk = project.preparedChunks.find(chunk => chunk.id === matches[0].chunkId); if (!chunk) fail();
        selectedRaw(project, chunk.id, id, chunk.sourceId, true); map[chunk.id] = id;
    }
    return immutable(map);
}
export function selectChunkRaw(project: MeetingProject, chunkId: string, rawId: string): MeetingProject {
    const chunk = project.preparedChunks.find(item => item.id === chunkId); if (!chunk) fail();
    selectedRaw(project, chunkId, rawId, chunk.sourceId, true);
    const inherited = selectedRawMap(project), parent = project.transcriptVersions.find(item => item.id === project.selectedTranscriptVersionId);
    if (inherited[chunkId] === rawId) return project;
    const selected = { ...inherited, [chunkId]: rawId };
    const chunks = project.preparedChunks.filter(item => item.sourceId === chunk.sourceId).sort((a, b) => a.index - b.index);
    const source = project.sourceAssets.find(item => item.id === chunk.sourceId); if (!source) fail();
    const merged = mergeTranscripts(chunks.filter(item => selected[item.id]).map(item => selectedRaw(project, item.id, selected[item.id], chunk.sourceId, true)), { expectedChunks: chunks, sourceEndMs: source.durationMs });
    const changed = new Set([inherited[chunkId], rawId]);
    const version = preserveTranscriptEdits(parent, merged, changed);
    return snapshotProject({ ...project, transcriptVersions: [...project.transcriptVersions, version], selectedTranscriptVersionId: version.id });
}
function preserveTranscriptEdits(parent: TranscriptVersion | undefined, merged: TranscriptVersion, changed: ReadonlySet<string>): TranscriptVersion {
    const affected = (segment: TranscriptVersion['segments'][number]) => segment.rawIds.some(id => changed.has(id));
    const segmentKey = (segment: TranscriptVersion['segments'][number]) => JSON.stringify([segment.sourceStartMs, segment.sourceEndMs, [...segment.rawIds].sort()]);
    const prior = new Map<string, TranscriptVersion['segments'][number][]>(), seen = new Set<string>();
    for (const segment of [...(parent?.segments ?? []), ...(parent?.issues.flatMap(issue => issue.alternatives.flat()) ?? [])]) {
        if (seen.has(segment.id)) continue;
        seen.add(segment.id);
        const key = segmentKey(segment), group = prior.get(key) ?? [];
        group.push(segment); prior.set(key, group);
    }
    const replacements = new Map<string, TranscriptVersion['segments'][number]>();
    for (const segment of merged.segments) {
        const previous = (!affected(segment) && prior.get(segmentKey(segment))?.shift()) || parent?.segments.find(old => !affected(old) && old.rawIds.length && old.sourceStartMs === segment.sourceStartMs && old.sourceEndMs === segment.sourceEndMs && old.rawIds.every(id => segment.rawIds.includes(id)));
        if (previous) replacements.set(segment.id, { ...previous, rawIds: segment.rawIds });
    }
    const visible = new Set(parent?.segments.map(segment => segment.id));
    const reuse = (segment: TranscriptVersion['segments'][number]) => replacements.get(segment.id) ?? segment;
    const issueKey = (issue: TranscriptVersion['issues'][number]) => JSON.stringify([issue.rangeMs, [...new Set(issue.alternatives.flat().flatMap(segment => segment.rawIds))].sort()]);
    // Keep explicit edits and earlier boundary choices outside the changed raw result.
    return immutable({ ...merged, parentId: parent?.id ?? null, createdAt: new Date().toISOString(),
        segments: merged.segments.filter(segment => !parent || affected(segment) || visible.has(reuse(segment).id)).map(reuse),
        issues: merged.issues.map(issue => (!issue.alternatives.flat().some(affected) && parent?.issues.find(old => issueKey(old) === issueKey(issue))) || { ...issue, alternatives: issue.alternatives.map(segments => segments.map(reuse)) }) });
}

export type STTBatchInput = Readonly<{ purpose: STTBatchPurpose; chunkIds: readonly string[]; modelId: string; languages: readonly string[]; route: STTBatch['route']; routerSelection?: RouterSTTSelection; modelSnapshot?: STTBatch['modelSnapshot'] }>;
export type STTAction = Readonly<{ purpose: STTBatchPurpose; chunkIds: readonly string[]; modelId: string; batchId?: string }>;
export type STTConsent = Readonly<{ modelId: string; acknowledged: true; consentToken?: string; additionalChargeAcknowledged?: boolean; batchId?: string }>;
export function initialSTTChunkIds(project: MeetingProject): readonly string[] {
    return project.preparedChunks.filter(chunk => !project.rawTranscripts.some(raw => raw.chunkId === chunk.id && project.runs.some(run => run.id === raw.runId && run.state === "saved")) && !project.runs.some(run => run.intent?.kind === "stt" && run.intent.chunkId === chunk.id)).map(chunk => chunk.id);
}
export function sttProjectToken(project: MeetingProject, revision: string | number): string {
    return JSON.stringify([revision, project.id, project.sourceAssets, project.preparedChunks,
        project.audioOptions.expectedLanguages, project.audioOptions.transcriptionHints ?? null, project.selectedTranscriptVersionId, project.transcriptVersions.map(({ id, parentId, rawIds, batchId }) => [id, parentId, rawIds, batchId ?? null]),
        project.rawTranscripts.map(({ id, chunkId, runId }) => [id, chunkId, runId]), project.runs.filter(run => run.intent?.kind === "stt").map(({ id, state, checkpoint }) => [id, state, checkpoint?.id ?? null]), project.sttBatches ?? []]);
}
export function sttActionToken(base: string | undefined, project: MeetingProject, action: STTAction): string {
    const frozen = action.batchId ? project.sttBatches?.find(batch => batch.id === action.batchId) ?? null : null;
    return JSON.stringify([base ?? null, project.id, action.purpose, action.chunkIds, action.modelId, action.batchId ?? null,
        frozen ?? [project.sourceAssets[0]?.id ?? null, project.audioOptions.expectedLanguages, project.audioOptions.transcriptionHints ?? null, project.selectedTranscriptVersionId, project.transcriptVersions.find(version => version.id === project.selectedTranscriptVersionId)?.rawIds ?? []]]);
}
export function createSTTBatch(project: MeetingProject, input: STTBatchInput, stamp: Readonly<{ id?: string; createdAt?: string }> = {}): STTBatch {
    const source = project.sourceAssets[0]; if (!source) fail();
    const parent = project.transcriptVersions.find(version => version.id === project.selectedTranscriptVersionId);
    const inherited = selectedRawMap(project);
    const batch: STTBatch = immutable({ ...input, id: stamp.id ?? crypto.randomUUID(), createdAt: stamp.createdAt ?? new Date().toISOString(),
        ...(project.audioOptions.transcriptionHints ? { transcriptionHints: project.audioOptions.transcriptionHints } : {}),
        sourceId: source.id, parentBatchId: parent?.batchId ?? null, parentTranscriptVersionId: parent?.id ?? null,
        parentSelectedRawIdsByChunk: inherited, selectedRawIdsByChunk: inherited, attemptRunIds: [] });
    validateSTTBatch(project, batch);
    return batch;
}
export function validateSTTBatch(project: MeetingProject, batch: STTBatch): void {
    validateTranscriptionHints(batch.transcriptionHints);
    if (!batch.id || !batch.modelId.trim() || !batch.createdAt.endsWith("Z") || !Number.isFinite(Date.parse(batch.createdAt)) ||
        !["initial", "retry-failed", "rerun-successful", "transcribe-selected"].includes(batch.purpose) || !batch.chunkIds.length || new Set(batch.chunkIds).size !== batch.chunkIds.length ||
        new Set(batch.attemptRunIds).size !== batch.attemptRunIds.length || batch.attemptRunIds.some(id => !id) || batch.languages.some(language => typeof language !== "string" || !language.trim())) fail();
    if (project.sourceAssets.filter(source => source.id === batch.sourceId).length !== 1 || batch.chunkIds.some(id => project.preparedChunks.filter(chunk => chunk.id === id && chunk.sourceId === batch.sourceId).length !== 1)) fail();
    if (batch.route.stage !== "stt" || batch.route.modelId !== batch.modelId || batch.route.endpointTag !== null || !batch.route.connectionId) fail();
    if (batch.modelSnapshot) {
        const model = validateRegistration(batch.modelSnapshot);
        if (model.stage !== 'stt' || model.id !== batch.route.connectionId || model.modelId !== batch.modelId ||
            model.adapter !== batch.route.provider || batch.routerSelection !== undefined) fail();
    } else if (batch.route.provider === 'openrouter') {
        if (!batch.routerSelection || JSON.stringify(batch.routerSelection.route) !== JSON.stringify(batch.route) || batch.routerSelection.sourceId !== batch.sourceId ||
            JSON.stringify(batch.routerSelection.expectedLanguages) !== JSON.stringify(batch.languages) || JSON.stringify(batch.routerSelection.chunks.map(chunk => chunk.id)) !== JSON.stringify(batch.chunkIds)) fail();
        try { validateRouterSTTSelection(project, batch.routerSelection); } catch { fail(); }
    } else if (batch.route.provider !== 'openai' || batch.routerSelection !== undefined) fail();
    // Only runs created by this batch may be claimed as its attempts. Parent
    // raw inheritance is checked separately and may have different/unknown intent.
    for (const runId of batch.attemptRunIds) {
        const runs = project.runs.filter(run => run.id === runId), intent = runs[0]?.intent;
        if (runs.length !== 1 || runs[0].projectId !== project.id || intent?.kind !== "stt" ||
            intent.sttBatchId !== batch.id || intent.requestedModel !== batch.modelId ||
            JSON.stringify(intent.expectedLanguages) !== JSON.stringify(batch.languages) ||
            (batch.routerSelection && JSON.stringify(intent.rateSnapshot) !== JSON.stringify(batch.routerSelection.rateSnapshot)) ||
            intent.requestedEndpoint !== (batch.modelSnapshot ? registrationEndpoint(batch.modelSnapshot) : batch.route.endpointTag) ||
            (batch.modelSnapshot && (!intent.modelSnapshot || registrationSignature(intent.modelSnapshot) !== registrationSignature(batch.modelSnapshot))) ||
            (intent.sttPurpose !== batch.purpose && intent.sttPurpose !== "retry-failed") ||
            intent.chunkId === null || !batch.chunkIds.includes(intent.chunkId) ||
            project.preparedChunks.filter(chunk => chunk.id === intent.chunkId && chunk.sourceId === batch.sourceId).length !== 1) fail();
    }
    const parent = batch.parentTranscriptVersionId === null ? null : project.transcriptVersions.find(version => version.id === batch.parentTranscriptVersionId);
    if (batch.parentTranscriptVersionId !== null && !parent) fail();
    if ((parent?.batchId ?? null) !== batch.parentBatchId || !sameMap(batch.parentSelectedRawIdsByChunk, selectedRawMap(project, batch.parentTranscriptVersionId))) fail();
    for (const [chunkId, rawId] of Object.entries(batch.parentSelectedRawIdsByChunk)) selectedRaw(project, chunkId, rawId, batch.sourceId, true);
    for (const [chunkId, rawId] of Object.entries(batch.selectedRawIdsByChunk)) {
        const raw = selectedRaw(project, chunkId, rawId, batch.sourceId, false);
        if (batch.parentSelectedRawIdsByChunk[chunkId] !== rawId && (!batch.chunkIds.includes(chunkId) || !batch.attemptRunIds.includes(raw.runId))) fail();
    }
    for (const [chunkId, rawId] of Object.entries(batch.parentSelectedRawIdsByChunk)) if (!Object.prototype.hasOwnProperty.call(batch.selectedRawIdsByChunk, chunkId) || (!batch.chunkIds.includes(chunkId) && batch.selectedRawIdsByChunk[chunkId] !== rawId)) fail();
}
export function replaceSTTBatch(project: MeetingProject, batch: STTBatch): MeetingProject {
    const existing = project.sttBatches ?? [];
    if (existing.filter(item => item.id === batch.id).length > 1) fail();
    return snapshotProject({ ...project, sttBatches: existing.some(item => item.id === batch.id) ? existing.map(item => item.id === batch.id ? batch : item) : [...existing, batch] });
}
export function appendBatchAttempt(batch: STTBatch, runId: string): STTBatch {
    if (!runId || batch.attemptRunIds.includes(runId)) fail();
    return immutable({ ...batch, attemptRunIds: [...batch.attemptRunIds, runId] });
}
export function selectBatchRaw(project: MeetingProject, batch: STTBatch, raw: RawTranscript): STTBatch {
    validateSTTBatch(project, batch);
    if (!batch.chunkIds.includes(raw.chunkId) || !batch.attemptRunIds.includes(raw.runId)) fail();
    selectedRaw(project, raw.chunkId, raw.id, batch.sourceId, false);
    return immutable({ ...batch, selectedRawIdsByChunk: { ...batch.selectedRawIdsByChunk, [raw.chunkId]: raw.id } });
}
function mergeSelected(project: MeetingProject, batch: STTBatch, pendingRunId?: string): TranscriptVersion {
    validateSTTBatch(project, batch);
    const source = project.sourceAssets.find(source => source.id === batch.sourceId)!;
    const chunks = project.preparedChunks.filter(chunk => chunk.sourceId === batch.sourceId).sort((a, b) => a.index - b.index);
    const selected = chunks.filter(chunk => Object.prototype.hasOwnProperty.call(batch.selectedRawIdsByChunk, chunk.id)).map(chunk => {
        const raw = selectedRaw(project, chunk.id, batch.selectedRawIdsByChunk[chunk.id], batch.sourceId, false);
        if (raw.runId === pendingRunId) {
            const run = project.runs.find(run => run.id === pendingRunId);
            if (run?.state !== "saving" || run.intent?.sttBatchId !== batch.id || !batch.attemptRunIds.includes(raw.runId)) fail();
        } else selectedRaw(project, chunk.id, raw.id, batch.sourceId, true);
        return raw;
    });
    return immutable({ ...mergeTranscripts(selected, { expectedChunks: chunks, sourceEndMs: source.durationMs }), batchId: batch.id, createdAt: new Date().toISOString() });
}
export function mergeBatch(project: MeetingProject, batch: STTBatch): TranscriptVersion { return mergeSelected(project, batch); }
/** Only a private response checkpoint candidate accepts its explicit saving run.
 * The vault must promote raw, run, batch-map and version in the same transaction. */
export function checkpointBatchResult(project: MeetingProject, batch: STTBatch, raw: RawTranscript, purpose: STTBatchPurpose): MeetingProject {
    const version = mergeSelected(project, batch, raw.runId);
    const selected = project.transcriptVersions.find(item => item.id === project.selectedTranscriptVersionId);
    const advanceInitial = purpose === "initial" && batch.purpose === "initial" && selected?.batchId === batch.id && selected.parentId === null;
    if (selected && !advanceInitial && !Object.prototype.hasOwnProperty.call(selectedRawMap(project), raw.chunkId)) {
        const chunks = project.preparedChunks.filter(chunk => chunk.sourceId === batch.sourceId);
        const source = project.sourceAssets.find(source => source.id === batch.sourceId)!;
        const existing = selected.rawIds.map(id => project.rawTranscripts.find(item => item.id === id)!);
        const merged = mergeTranscripts([...existing, raw], { expectedChunks: chunks, sourceEndMs: source.durationMs });
        const expanded = preserveTranscriptEdits(selected, merged, new Set([raw.id]));
        return snapshotProject({ ...project, transcriptVersions: [...project.transcriptVersions, version, expanded], selectedTranscriptVersionId: expanded.id });
    }
    return snapshotProject({ ...project, transcriptVersions: [...project.transcriptVersions, version], selectedTranscriptVersionId: project.selectedTranscriptVersionId === null || advanceInitial ? version.id : project.selectedTranscriptVersionId });
}
export function batchStatus(project: MeetingProject, batch: STTBatch): "queued" | "requesting" | "partial" | "complete" | "failed" | "outcome-unknown" | "cancelled" {
    const latest = batch.chunkIds.map(chunkId => [...project.runs].reverse().find(run => batch.attemptRunIds.includes(run.id) && (run.intent?.chunkId === chunkId || project.rawTranscripts.some(raw => raw.runId === run.id && raw.chunkId === chunkId))));
    if (latest.some(run => run && ["requesting", "response-received", "saving"].includes(run.state))) return "requesting";
    if (latest.some(run => run?.state === "outcome-unknown")) return "outcome-unknown";
    if (latest.some(run => run?.state === "failed")) return "failed";
    if (latest.some(run => run?.state === "cancelled")) return "cancelled";
    if (latest.every(run => run?.state === "saved")) return "complete";
    if (latest.some(run => run?.state === "saved")) return "partial";
    return "queued";
}
