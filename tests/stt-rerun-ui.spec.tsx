// @vitest-environment jsdom
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createModelPreset } from "../src/react-app/providers/model-profiles";
import { freezeExecutionModel } from "../src/react-app/providers/model-registrations";
import App, { defaultPreferences, type AppController } from "../src/react-app/App";
import type { MeetingProject } from "../src/react-app/domain/types";
import { appendBatchAttempt, createSTTBatch, replaceSTTBatch, sttActionToken } from "../src/react-app/transcript/batches";
// Screen-only synthetic one-chunk fixtures do not invoke the codec/Worker.
vi.mock("../src/react-app/media/prepare", () => ({ planChunkRanges: (durationMs: number) => [{ sourceStartMs: 0, sourceEndMs: durationMs }] }));
beforeAll(() => { HTMLDialogElement.prototype.showModal = function () { this.open = true; }; HTMLDialogElement.prototype.close = function () { this.open = false; }; });
afterEach(cleanup);
function project(): MeetingProject {
    const date = "2026-10-02T15:00:00.000Z", id = "synthetic-ui-project", chunkId = "synthetic-chunk", runId = "synthetic-original";
    const checkpoint = { id: "synthetic-cp", projectId: id, runId, recordIds: [id], committedAt: date };
    return { id, title: "SYNTHETIC_STT_UI", icon: "mic", color: "blue", pinned: false, createdAt: date, updatedAt: date,
        sourceAssets: [{ id: "synthetic-source", fileName: "SYNTHETIC.wav", bytes: 3, container: "wav", codec: "pcm", durationMs: 1000, channels: 1, sampleRateHz: 16000 }],
        audioOptions: { chunkMinutes: 5, overlapSeconds: 5, expectedLanguages: ["ko", "en"], bitrateKbps: 32, sampleRateHz: 16000 },
        preparedChunks: [{ id: chunkId, sourceId: "synthetic-source", index: 0, sourceStartMs: 0, sourceEndMs: 1000, encodingOffsetMs: 0, encodedBytes: 3, mimeType: "audio/mpeg", codec: "mp3", audioRecordId: "synthetic-audio" }],
        retainedAudio: { sourceIds: ["synthetic-source"], chunkIds: [chunkId] },
        rawTranscripts: [{ id: "synthetic-raw", chunkId, runId, text: "SYNTHETIC_OLD_SPEECH", response: {}, segments: [], timing: "chunk", speakerScope: "none", execution: null }],
        transcriptVersions: [{ id: "synthetic-version", parentId: null, rawIds: ["synthetic-raw"], segments: [{ id: "synthetic-segment", text: "SYNTHETIC_OLD_SPEECH", sourceStartMs: 0, sourceEndMs: 1000, rawIds: ["synthetic-raw"] }], issues: [], missingRanges: [] }], selectedTranscriptVersionId: "synthetic-version",
        minutesSettings: { outputLanguage: "en", sections: ["summary"], instructions: "", modelId: "" }, minutesRuns: [], minutesRevisions: [], selectedMinutesRevisionId: null, runs: [{ id: runId, projectId: id, state: "saved", checkpoint }] };
}
function controller(p: MeetingProject, extra: Partial<AppController> = {}): AppController {
    return { session: "unlocked", screen: "stt", projects: [p], selectedProjectId: p.id, settingsTab: "connections", preferences: { ...defaultPreferences, uiLanguage: "en" }, defaultAudioOptions: p.audioOptions,
        sttModelId: "gpt-transcribe", sttConsentToken: "synthetic-metadata", modelCatalog: ["gpt-transcribe", "gpt-4o-mini-transcribe"].map(id => ({ id, label: "Human alias", provider: "openai", kind: "stt", enabled: true })), connections: [], storageEstimate: null, ...extra };
}
it('allows rerunning a saved chunk absent from the selected full transcript', async () => {
    const p = { ...project(), selectedTranscriptVersionId: null, transcriptVersions: [] }, rerun = vi.fn(), user = userEvent.setup();
    render(<App controller={controller(p, { onRerunSTT: rerun })} />);
    const trigger = screen.getByRole('button', { name: 'Re-transcribe' }) as HTMLButtonElement;
    expect(trigger.disabled).toBe(false); await user.click(trigger);
    const selected = within(screen.getByRole('dialog')).getByRole('region', { name: 'Selected chunks' });
    expect(selected.textContent).toContain('#1'); expect(selected.textContent).toContain('00:00–00:01'); expect(selected.closest('details')).toBeNull();
    expect(screen.getByRole('button', { name: 'Delete voice memo' }).closest('.flow-heading-row')).toBe(screen.getByRole('heading', { name: p.title }).closest('.flow-heading-row'));
    await user.click(within(screen.getByRole('dialog')).getByRole('checkbox'));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Transcribe' }));
    expect(rerun).toHaveBeenCalledOnce();
});
it('confirms remaining or all chunks separately and resets additional-charge consent on scope changes', async () => {
    const base = project(), second = { ...base.preparedChunks[0], id: 'pending-chunk', index: 1 };
    const p = { ...base, preparedChunks: [...base.preparedChunks, second], retainedAudio: { ...base.retainedAudio!, chunkIds: [base.preparedChunks[0].id, second.id] } };
    const send = vi.fn(), user = userEvent.setup();
    const c = controller(p, { onTranscribeChunks: send }); render(<App controller={c} />);
    await user.click(screen.getByRole('button', { name: 'Transcribe all' }));
    const modal = within(screen.getByRole('dialog', { name: 'Transcribe all' }));
    expect((modal.getByRole('radio', { name: /Skip completed chunks/ }) as HTMLInputElement).checked).toBe(true);
    await user.click(modal.getByRole('checkbox')); await user.click(modal.getByRole('radio', { name: /Re-transcribe every chunk/ }));
    expect((modal.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
    expect((modal.getByRole('button', { name: 'Transcribe' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(modal.getByRole('checkbox')); await user.click(modal.getByRole('button', { name: 'Transcribe' }));
    expect(send).toHaveBeenCalledWith(p.id, p.preparedChunks.map(chunk => chunk.id), expect.objectContaining({ additionalChargeAcknowledged: true }));
    await user.click(screen.getByRole('button', { name: 'Transcribe all' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('checkbox'));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Transcribe' }));
    expect(send.mock.calls[1][1]).toEqual([second.id]);
});
it('uses a chosen original explicitly without retransmitting audio', async () => {
    const base = project(), alternative = { ...base.rawTranscripts[0], id: 'alternative', runId: 'alternative-run', text: 'SYNTHETIC_ALTERNATIVE' };
    const p = { ...base, rawTranscripts: [{ ...base.rawTranscripts[0], response: { origin: 'SYNTHETIC_RAW_A' } }, { ...alternative, response: { origin: 'SYNTHETIC_RAW_B' } }] }, choose = vi.fn(), send = vi.fn(), user = userEvent.setup();
    render(<App controller={controller(p, { onSelectChunkTranscript: choose, onRerunSTT: send })} />);
    await user.click(screen.getByRole('button', { name: 'View transcript' }));
    const modal = within(screen.getByRole('dialog'));
    expect((modal.getByRole('combobox', { name: 'Original result' }) as HTMLSelectElement).value).toBe(base.rawTranscripts[0].id);
    await user.click(modal.getByText('Provenance · original response', { selector: 'summary' }));
    await user.click(modal.getByRole('button', { name: 'View original JSON' }));
    expect(modal.getByLabelText('Original response JSON').textContent).toContain('SYNTHETIC_RAW_A');
    await user.selectOptions(modal.getByRole('combobox', { name: 'Original result' }), alternative.id);
    expect(modal.getByRole('button', { name: 'View original JSON' }).getAttribute('aria-pressed')).toBe('false');
    expect(modal.getByText('SYNTHETIC_RAW_B')).toBeTruthy(); expect(modal.queryByText('SYNTHETIC_RAW_A')).toBeNull();
    await user.click(modal.getByRole('button', { name: 'Use this result' }));
    expect(choose).toHaveBeenCalledWith(p.id, base.preparedChunks[0].id, alternative.id, p.selectedTranscriptVersionId);
    expect(send).not.toHaveBeenCalled();
});
it('keeps the initial model selector visible and clears consent immediately when choosing another model', async () => {
    const p = { ...project(), rawTranscripts: [], transcriptVersions: [], selectedTranscriptVersionId: null, runs: [] };
    const change = vi.fn(), start = vi.fn(), user = userEvent.setup();
    render(<App controller={controller(p, { onSTTModel: change, onStartSTT: start })} />);
    const select = screen.getByRole('combobox', { name: 'Transcription model' });
    expect(select.closest('details')).toBeNull();
    expect(select.closest('.stt-setup')).toBe(screen.getByRole('region', { name: 'Before sending' }).closest('.stt-setup'));
    expect(screen.getByText('Waiting to transcribe').closest('.stt-results')).toBeTruthy();
    expect(screen.getByText('Transcript results 0 / 1')).toBeTruthy();
    expect(screen.queryByText(/have saved results/)).toBeNull();
    expect(within(select).getByRole('option', { name: 'Human alias · gpt-transcribe' })).toBeTruthy();
    expect(within(select).getByRole('option', { name: 'Human alias · gpt-4o-mini-transcribe' })).toBeTruthy();
    expect(screen.getByText('Actual model ID').closest('details')?.open).toBe(false);
    expect(screen.getByText('Transmission details', { selector: 'summary' })).toBeTruthy();
    expect(screen.queryByText('Details', { selector: 'summary' })).toBeNull();
    expect(screen.getByText(/Provider charges may apply/).closest('details')).toBeNull();
    const check = screen.getByRole('checkbox', { name: "I've reviewed the above" });
    const submit = screen.getByRole('button', { name: 'Transcribe' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true); await user.click(check); expect(submit.disabled).toBe(false);
    await user.selectOptions(select, 'gpt-4o-mini-transcribe');
    expect(change).toHaveBeenCalledWith('gpt-4o-mini-transcribe');
    expect((check as HTMLInputElement).checked).toBe(false); expect(submit.disabled).toBe(true);
    expect(screen.queryByText(/Notes sends|writing instructions|copied and downloaded text/i)).toBeNull();
    expect(screen.getByText(/Local encryption does not control provider retention/)).toBeTruthy();
    expect(screen.getByText(/Cancelling may still incur charges for requests already sent/)).toBeTruthy();
    expect(screen.queryByText(/Saved means the encrypted transaction completed/)).toBeNull();
    expect(start).not.toHaveBeenCalled();
});
it('labels four untouched chunks as waiting with zero transcript results', () => {
    const base = project();
    const chunks = Array.from({ length: 4 }, (_, index) => ({ ...base.preparedChunks[0], id: `chunk-${index}`, index }));
    const p = { ...base, preparedChunks: chunks, retainedAudio: { ...base.retainedAudio!, chunkIds: chunks.map(chunk => chunk.id) }, rawTranscripts: [], transcriptVersions: [], selectedTranscriptVersionId: null, runs: [] };
    render(<App controller={controller(p)} />);
    expect(screen.getByText('Waiting to transcribe')).toBeTruthy();
    expect(screen.getByText('Transcript results 0 / 4')).toBeTruthy();
    expect(document.querySelectorAll('.chunk-row')).toHaveLength(4);
    expect(document.querySelectorAll('.playback-status.visually-hidden')).toHaveLength(4);
});
it("offers a saved-chunk rerun only after a fresh explicit additional-charge confirmation", async () => {
    const p = project(), rerun = vi.fn(), user = userEvent.setup(), c = controller(p, { onRerunSTT: rerun }); render(<App controller={c} />);
    const trigger = screen.getByRole("button", { name: "Re-transcribe" }); expect((trigger as HTMLButtonElement).disabled).toBe(false); await user.click(trigger);
    const dialog = within(screen.getByRole("dialog")), submit = dialog.getByRole("button", { name: "Transcribe" });
    const details = dialog.getByText('Details', { selector: 'summary' }).closest('details')!;
    expect(details.open).toBe(false);
    expect(dialog.getByText('Actual model ID').closest('details')).toBe(details);
    expect(dialog.getByText(/may incur additional charges/).closest('details')).toBeNull();
    expect((submit as HTMLButtonElement).disabled).toBe(true); expect(rerun).not.toHaveBeenCalled();
    await user.click(dialog.getByRole("checkbox")); await user.click(submit);
    expect(rerun).toHaveBeenCalledOnce(); expect(rerun).toHaveBeenCalledWith(p.id, [p.preparedChunks[0].id], { modelId: "gpt-transcribe", acknowledged: true, additionalChargeAcknowledged: true, consentToken: sttActionToken(c.sttConsentToken, p, { purpose: "rerun-successful", chunkIds: [p.preparedChunks[0].id], modelId: "gpt-transcribe" }) });
    expect(p.selectedTranscriptVersionId).toBe("synthetic-version");
});
it("displays the original frozen retry model/languages when current settings changed, and does not call a failed rerun complete", async () => {
    const p = project(), route = { connectionId: "openai", provider: "openai", stage: "stt", modelId: "gpt-transcribe", endpointTag: null } as const;
    const batch = appendBatchAttempt(createSTTBatch(p, { purpose: "rerun-successful", chunkIds: [p.preparedChunks[0].id], modelId: route.modelId, languages: ["ko", "en"], route }), "synthetic-unknown");
    const failed = replaceSTTBatch({ ...p, audioOptions: { ...p.audioOptions, expectedLanguages: ["ja"] }, runs: [...p.runs, { id: "synthetic-unknown", projectId: p.id, state: "outcome-unknown", checkpoint: null, intent: { kind: "stt", chunkId: p.preparedChunks[0].id, requestedModel: batch.modelId, expectedLanguages: batch.languages, requestedEndpoint: null, rateSnapshot: null, sttBatchId: batch.id } }] }, batch);
    const retry = vi.fn(), user = userEvent.setup(); render(<App controller={controller(failed, { sttModelId: "gpt-4o-mini-transcribe", onRetrySTT: retry, onRerunSTT: vi.fn() })} />);
    expect(screen.queryByText("Transcription complete · all chunks saved")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Retry latest attempt" })); const dialog = within(screen.getByRole("dialog"));
    expect((dialog.getByLabelText("Transcription model") as HTMLSelectElement).value).toBe("gpt-transcribe"); expect((dialog.getByLabelText("Transcription model") as HTMLSelectElement).disabled).toBe(true);
    expect(dialog.getAllByText(/ko.*en/).length).toBeGreaterThan(0); expect(dialog.getAllByText(/Direct OpenAI/).length).toBeGreaterThan(0); await user.click(dialog.getByRole("checkbox")); await user.click(dialog.getByRole("button", { name: "Transcribe" }));
    expect(retry.mock.calls[0][2]).toMatchObject({ modelId: "gpt-transcribe", additionalChargeAcknowledged: true, batchId: batch.id });
});
it("invalidates rerun acknowledgment when metadata or selected parent changes and Cancel dispatches nothing", async () => {
    const p = project(), rerun = vi.fn(), c = controller(p, { onRerunSTT: rerun }), view = render(<App controller={c} />), user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Re-transcribe" })); let dialog = within(screen.getByRole("dialog")); await user.click(dialog.getByRole("checkbox"));
    view.rerender(<App controller={{ ...c, sttConsentToken: "new-synthetic-metadata" }} />); dialog = within(screen.getByRole("dialog")); expect((dialog.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    await user.click(dialog.getByRole("button", { name: "Cancel" })); expect(screen.queryByRole("dialog")).toBeNull(); expect(rerun).not.toHaveBeenCalled();
});
it("keeps legacy provenance unknown and offers explicit batch version selection without STT dispatch", async () => {
    const p = project(), batch = createSTTBatch(p, { purpose: "rerun-successful", chunkIds: [p.preparedChunks[0].id], modelId: "gpt-transcribe", languages: ["ko", "en"], route: { connectionId: "openai", provider: "openai", stage: "stt", modelId: "gpt-transcribe", endpointTag: null } }, { createdAt: "2026-10-02T15:20:00.000Z" });
    const candidate = { ...p.transcriptVersions[0], id: "synthetic-new-version", batchId: batch.id, createdAt: "2026-10-02T15:21:00.000Z" };
    const next = replaceSTTBatch({ ...p, transcriptVersions: [...p.transcriptVersions, candidate] }, batch), select = vi.fn(), stt = vi.fn(), user = userEvent.setup();
    render(<App controller={controller(next, { onSelectTranscript: select, onStartSTT: stt, onRerunSTT: stt })} />);
    await user.click(screen.getByRole("button", { name: "Review & edit full transcript" }));
    expect(screen.getByText("Legacy transcript · provenance unknown")).toBeTruthy();
    const picker = screen.getByLabelText("Transcript version"); expect((picker as HTMLSelectElement).value).toBe(p.selectedTranscriptVersionId);
    expect(within(picker).getByRole("option", { name: /gpt-transcribe.*ko, en.*2026-10-02T15:21/ })).toBeTruthy();
    await user.selectOptions(picker, candidate.id); expect(select).toHaveBeenCalledWith(p.id, candidate.id); expect(stt).not.toHaveBeenCalled();
});
it("binds the initial runtime confirmation to its untouched chunk scope and never reuses it for a retry", async () => {
    const p = { ...project(), rawTranscripts: [], transcriptVersions: [], selectedTranscriptVersionId: null, runs: [] }, start = vi.fn(), user = userEvent.setup(), c = controller(p, { onStartSTT: start });
    render(<App controller={c} />); const submit = screen.getByRole("button", { name: "Transcribe" }); expect((submit as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("checkbox", { name: "I've reviewed the above" })); await user.click(submit);
    expect(start).toHaveBeenCalledWith(p.id, { acknowledged: true, modelId: "gpt-transcribe", consentToken: sttActionToken(c.sttConsentToken, p, { purpose: "initial", chunkIds: [p.preparedChunks[0].id], modelId: "gpt-transcribe" }) });
});

it("keeps frozen retry submission blocked when the required provider key is absent", async () => {
    const p = project(), batch = appendBatchAttempt(createSTTBatch(p, { purpose: "rerun-successful", chunkIds: [p.preparedChunks[0].id], modelId: "gpt-transcribe", languages: ["ko", "en"], route: { connectionId: "openai", provider: "openai", stage: "stt", modelId: "gpt-transcribe", endpointTag: null } }), "missing-key-retry");
    const failed = replaceSTTBatch({ ...p, runs: [...p.runs, { id: "missing-key-retry", projectId: p.id, state: "outcome-unknown", checkpoint: null, intent: { kind: "stt", chunkId: p.preparedChunks[0].id, requestedModel: batch.modelId, expectedLanguages: batch.languages, requestedEndpoint: null, rateSnapshot: null, sttBatchId: batch.id } }] }, batch);
    const retry = vi.fn(), user = userEvent.setup(); render(<App controller={controller(failed, { connections: [{ provider: "openai", status: "none" }], sttUnavailableReason: "Enter your OpenAI key in Settings.", onRetrySTT: retry })} />);
    await user.click(screen.getByRole("button", { name: "Retry latest attempt" })); const dialog = within(screen.getByRole("dialog")); await user.click(dialog.getByRole("checkbox"));
    expect((dialog.getByRole("button", { name: "Transcribe" }) as HTMLButtonElement).disabled).toBe(true); expect(retry).not.toHaveBeenCalled();
});

it("switches a frozen failed retry to a new batch only after fresh consent and keeps its exact chunk scope", async () => {
    const p = project(), route = { connectionId: 'openai', provider: 'openai', stage: 'stt', modelId: 'gpt-transcribe', endpointTag: null } as const;
    const batch = appendBatchAttempt(createSTTBatch(p, { purpose: 'rerun-successful', chunkIds: [p.preparedChunks[0].id], modelId: route.modelId, languages: ['ko', 'en'], route }), 'failed-retry');
    const failed = replaceSTTBatch({ ...p, runs: [...p.runs, { id: 'failed-retry', projectId: p.id, state: 'outcome-unknown', checkpoint: null, intent: { kind: 'stt', chunkId: p.preparedChunks[0].id, requestedModel: batch.modelId, expectedLanguages: batch.languages, requestedEndpoint: null, rateSnapshot: null, sttBatchId: batch.id } }] }, batch);
    const retry = vi.fn(), change = vi.fn(), user = userEvent.setup(), c = controller(failed, { onRetrySTT: retry, onSTTModel: change });
    const view = render(<App controller={c} />);
    await user.click(screen.getByRole('button', { name: 'Retry latest attempt' }));
    const modal = within(screen.getByRole('dialog')), choice = modal.getByRole('combobox', { name: 'Transcription model' });
    expect((choice as HTMLSelectElement).value).toBe(batch.modelId);
    await user.click(modal.getByRole('checkbox')); expect((modal.getByRole('button', { name: 'Transcribe' }) as HTMLButtonElement).disabled).toBe(false);
    await user.selectOptions(choice, 'gpt-4o-mini-transcribe');
    expect((modal.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
    expect(modal.getByText(/A changed model or settings creates a new batch/)).toBeTruthy();
    expect(change).toHaveBeenCalledWith('gpt-4o-mini-transcribe');
    view.rerender(<App controller={{ ...c, sttModelId: 'gpt-4o-mini-transcribe' }} />);
    expect((modal.getByRole('button', { name: 'Transcribe' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(modal.getByRole('checkbox')); await user.selectOptions(choice, 'gpt-transcribe');
    expect((modal.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
    expect(modal.queryByText(/A changed model or settings creates a new batch/)).toBeNull();
    await user.selectOptions(choice, 'gpt-4o-mini-transcribe');
    await user.click(modal.getByRole('checkbox')); await user.click(modal.getByRole('button', { name: 'Transcribe' }));
    expect(retry).toHaveBeenCalledWith(p.id, [p.preparedChunks[0].id], { modelId: 'gpt-4o-mini-transcribe', acknowledged: true, additionalChargeAcknowledged: true, consentToken: sttActionToken(c.sttConsentToken, failed, { purpose: 'retry-failed', chunkIds: [p.preparedChunks[0].id], modelId: 'gpt-4o-mini-transcribe' }) });
    expect(failed.sttBatches).toEqual([batch]); expect(failed.selectedTranscriptVersionId).toBe(p.selectedTranscriptVersionId);
});
it("opens immutable chunk originals before retry, preserves source/model provenance, and restores focus", async () => {
    const base = project(), p = { ...base, rawTranscripts: [{ ...base.rawTranscripts[0], response: { note: 'SYNTHETIC_PRIVATE_RESPONSE' } }] }, user = userEvent.setup(), before = structuredClone(p);
    const view = render(<App controller={controller(p, { onRerunSTT: vi.fn() })} />);
    const trigger = screen.getByRole('button', { name: 'View transcript' });
    expect(trigger.nextElementSibling?.textContent).toBe('Re-transcribe');
    await user.click(trigger);
    const modal = within(screen.getByRole('dialog', { name: 'Chunk #1 transcript' }));
    expect(modal.getByText('00:00–00:01 · Original chunk range')).toBeTruthy();
    expect(modal.getByRole('combobox', { name: 'Original result' }).textContent).toContain('Model unknown · Original 1');
    expect(modal.getByText('SYNTHETIC_OLD_SPEECH')).toBeTruthy();
    expect(modal.queryByRole('textbox')).toBeNull();
    await user.click(modal.getByRole('button', { name: 'Close' }));
    expect(document.activeElement).toBe(trigger); expect(p).toEqual(before);
    await user.click(trigger);
    await user.click(screen.getByText('Provenance · original response', { selector: 'summary' }));
    await user.click(screen.getByRole('button', { name: 'View original JSON' }));
    expect(screen.getByLabelText('Original response JSON').textContent).toContain('SYNTHETIC_PRIVATE_RESPONSE');
    view.rerender(<App controller={controller(p, { session: 'locked', projects: [], selectedProjectId: null })} />);
    expect(document.body.textContent).not.toContain('SYNTHETIC_PRIVATE_RESPONSE'); expect(screen.queryByRole('dialog')).toBeNull();
});
it("keeps selected edits and an unsaved editor without boundary tasks through closing the full review, then removes content on lock", async () => {
    const p = project(), version = p.transcriptVersions[0], user = userEvent.setup(), drafts: Record<string, unknown> = {}, reconcile = vi.fn(), edit = vi.fn();
    const selected = { ...version, parentId: 'prior-version', segments: [{ ...version.segments[0], text: 'SYNTHETIC_SELECTED_EDIT' }], missingRanges: [[1000, 2000] as const], issues: [{ id: 'overlap', rangeMs: [0, 500] as const, selected: null, alternatives: [[version.segments[0]], [version.segments[0]]] }] };
    const projectWithEdit = { ...p, transcriptVersions: [selected] };
    const c = controller(projectWithEdit, { uiDrafts: drafts, onUIDraft: (key, value) => { drafts[key] = value; }, onEditTranscript: edit, onReconcileBoundary: reconcile });
    const view = render(<App controller={c} />);
    expect(screen.queryByText('SYNTHETIC_SELECTED_EDIT')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Review & edit full transcript' }));
    expect(screen.getByText('SYNTHETIC_SELECTED_EDIT')).toBeTruthy(); expect(screen.getByText('Missing range:')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Keep both and mark reviewed' })).toBeNull();
    expect(reconcile).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Edit segment 1' }));
    const editor = screen.getByRole('textbox', { name: 'Transcript edit' }); await user.clear(editor); await user.type(editor, 'SYNTHETIC_UNSAVED');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
    await user.click(screen.getByRole('button', { name: 'Review & edit full transcript' }));
    expect((screen.getByRole('textbox', { name: 'Transcript edit' }) as HTMLTextAreaElement).value).toBe('SYNTHETIC_UNSAVED');
    expect(edit).not.toHaveBeenCalled(); expect(p.rawTranscripts[0].text).toBe('SYNTHETIC_OLD_SPEECH');
    view.rerender(<App controller={{ ...c, session: 'locked', projects: [], selectedProjectId: null, uiDrafts: {} }} />);
    expect(screen.queryByRole('dialog')).toBeNull(); expect(document.body.textContent).not.toContain('SYNTHETIC_UNSAVED');
});

it('offers model selection or explicit shared-policy review without sending or relaxing anything on cancel', async () => {
    const p = project(), user = userEvent.setup(), save = vi.fn(async () => {}), send = vi.fn();
    const credential = { id: 'router-key', name: 'Router', origin: 'https://openrouter.ai', keyStorage: 'encrypted' as const, version: 1, routerPolicy: { requireZdr: true, acknowledged: true } };
    const registration = { ...createModelPreset('router-qwen3-asr-1.7b', () => 'router-policy'), enabled: true, credentialId: credential.id, credentialOrigin: credential.origin, credentialVersion: 1, routerPolicy: credential.routerPolicy };
    const c = controller(p, { sttModelId: registration.id, modelCatalog: [{ id: registration.id, label: registration.name, kind: 'stt', provider: 'openrouter', enabled: true }], modelRegistrations: { version: 2, entries: [registration], credentials: [credential] }, registrationKeyReady: [registration.id], sttPolicyBlockedModels: [registration.id], sttUnavailableReason: 'Policy blocked', onSaveApiCredential: save, onSTTModel: vi.fn(), onTranscribeChunks: send, onRerunSTT: send });
    render(<App controller={c} />);
    const recovery = within(screen.getByRole('region', { name: 'Transcription blocked by retention policy' }));
    await user.click(recovery.getByRole('button', { name: 'Choose another model' }));
    expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Transcription model' }));
    expect((screen.getByRole('button', { name: 'Transcribe all' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(recovery.getByRole('button', { name: 'Review retention policy' }));
    let modal = within(screen.getByRole('dialog', { name: 'Edit API key' }));
    expect((modal.getByLabelText('OpenRouter retention policy') as HTMLSelectElement).value).toBe('zdr');
    expect(modal.getByText(/every model using it/)).toBeTruthy();
    expect(modal.getByText(/cannot override ZDR enforced by your OpenRouter account/)).toBeTruthy();
    await user.selectOptions(modal.getByLabelText('OpenRouter retention policy'), 'standard');
    expect((modal.getByRole('button', { name: 'Save key' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(modal.getByRole('button', { name: 'Cancel' }));
    expect(save).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
    await user.click(recovery.getByRole('button', { name: 'Review retention policy' }));
    modal = within(screen.getByRole('dialog'));
    expect((modal.getByLabelText('OpenRouter retention policy') as HTMLSelectElement).value).toBe('zdr');
    await user.selectOptions(modal.getByLabelText('OpenRouter retention policy'), 'standard');
    await user.click(modal.getByRole('checkbox', { name: 'I reviewed the selected OpenRouter transmission and retention policy' }));
    await user.click(modal.getByRole('button', { name: 'Save key' }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ routerPolicy: { requireZdr: false, acknowledged: true } }), { action: 'keep' });
    expect(send).not.toHaveBeenCalled();
});
it('uses a fresh batch and fresh consent after the same model retention policy changes', async () => {
    const base = project(), id = 'router-policy', credential = { id: 'router-key', name: 'Router', origin: 'https://openrouter.ai', keyStorage: 'encrypted' as const, version: 2, routerPolicy: { requireZdr: false, acknowledged: true } };
    const old = { ...createModelPreset('router-qwen3-asr-1.7b', () => id), enabled: true, credentialId: credential.id, credentialOrigin: credential.origin, credentialVersion: 1, routerPolicy: { requireZdr: true, acknowledged: true } };
    const current = { ...old, revision: 2, credentialVersion: 2, routerPolicy: credential.routerPolicy };
    const batch = createSTTBatch(base, { purpose: 'initial', chunkIds: [base.preparedChunks[0].id], modelId: old.modelId, languages: ['en'], route: { connectionId: id, provider: 'openrouter', stage: 'stt', modelId: old.modelId, endpointTag: null }, modelSnapshot: freezeExecutionModel(old) });
    const failedRun = { id: 'failed-policy-run', projectId: base.id, state: 'failed' as const, checkpoint: null, intent: { kind: 'stt' as const, chunkId: base.preparedChunks[0].id, requestedModel: old.modelId, expectedLanguages: ['en'], rateSnapshot: null, requestedEndpoint: 'https://openrouter.ai/api/v1/audio/transcriptions', sttBatchId: batch.id, modelSnapshot: freezeExecutionModel(old) } };
    const p = { ...replaceSTTBatch(base, appendBatchAttempt(batch, failedRun.id)), runs: [...base.runs, failedRun] }, retry = vi.fn(), user = userEvent.setup();
    render(<App controller={controller(p, { sttModelId: id, modelCatalog: [{ id, label: current.name, kind: 'stt', provider: 'openrouter', enabled: true }], modelRegistrations: { version: 2, entries: [current], credentials: [credential] }, registrationKeyReady: [id], onRetrySTT: retry })} />);
    await user.click(screen.getByRole('button', { name: 'Retry latest attempt' }));
    const modal = within(screen.getByRole('dialog'));
    expect(modal.getByText(/changed model or settings creates a new batch/)).toBeTruthy();
    await user.click(modal.getByRole('checkbox'));
    await user.click(modal.getByRole('button', { name: 'Transcribe' }));
    expect(retry).toHaveBeenCalledOnce();
    expect(retry.mock.calls[0][2]).not.toHaveProperty('batchId');
});
