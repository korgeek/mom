// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import App, { defaultPreferences, type AppController, type AppScreen } from '../src/react-app/App';
import type { MeetingProject } from '../src/react-app/domain/types';
import CompletedStageDetails from '../src/react-app/ui/components/CompletedStageDetails';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const prepared: MeetingProject = {
  id: 'synthetic-workflow', title: 'Synthetic workflow', icon: 'mic', color: '#3B82F6', pinned: false,
  createdAt: '2026-10-17T00:00:00Z', updatedAt: '2026-10-17T00:00:00Z',
  sourceAssets: [{ id: 'source', fileName: 'Synthetic.wav', bytes: 32044, durationMs: 1000, container: 'wav', codec: 'pcm', channels: 1, sampleRateHz: 16000 }],
  audioOptions: { chunkMinutes: 10, overlapSeconds: 10, bitrateKbps: 32, sampleRateHz: 16000, expectedLanguages: ['en'] },
  preparedChunks: [{ id: 'chunk', sourceId: 'source', index: 0, sourceStartMs: 0, sourceEndMs: 1000, encodingOffsetMs: 0, encodedBytes: 32044, mimeType: 'audio/wav', codec: 'pcm', audioRecordId: 'audio' }],
  retainedAudio: { sourceIds: ['source'], chunkIds: ['chunk'] }, rawTranscripts: [], transcriptVersions: [], selectedTranscriptVersionId: null,
  minutesSettings: { outputLanguage: 'en', sections: ['summary'], instructions: '', modelId: '' }, minutesRuns: [], minutesRevisions: [], selectedMinutesRevisionId: null, runs: [],
};
function transcribed(): MeetingProject {
  const segment = { id: 'segment', text: 'SYNTHETIC_PRESERVED_TRANSCRIPT', sourceStartMs: 0, sourceEndMs: 1000, rawIds: ['raw'] };
  return { ...prepared,
    rawTranscripts: [{ id: 'raw', chunkId: 'chunk', runId: 'run', response: { text: segment.text }, text: segment.text, segments: [segment], timing: 'chunk', speakerScope: 'none', execution: null }],
    transcriptVersions: [{ id: 'version', parentId: null, rawIds: ['raw'], segments: [segment], issues: [], missingRanges: [] }], selectedTranscriptVersionId: 'version',
    runs: [{ id: 'run', projectId: prepared.id, state: 'saved', checkpoint: { id: 'receipt', projectId: prepared.id, runId: 'run', recordIds: ['raw'], committedAt: prepared.updatedAt }, intent: { kind: 'stt', chunkId: 'chunk', requestedModel: 'gpt-transcribe', expectedLanguages: ['en'], rateSnapshot: null, requestedEndpoint: null } }],
  };
}
function flow(initialProject = prepared, initialScreen: AppScreen = 'import', extra: Partial<AppController> = {}, acceptNavigation = true) {
  let c: AppController = { session: 'unlocked', projects: [initialProject], selectedProjectId: initialProject.id, screen: initialScreen, settingsTab: 'models',
    preferences: { ...defaultPreferences, uiLanguage: 'en' }, defaultAudioOptions: initialProject.audioOptions, modelCatalog: [], sttModelId: '', connections: [], storageEstimate: null,
    onUpdateMeeting: vi.fn(), onAudioOptions: vi.fn(), onPlanPreparationReset: vi.fn(), ...extra };
  const navigate = vi.fn((next: AppScreen, id?: string) => { if (acceptNavigation) { c = { ...c, screen: next, selectedProjectId: id ?? c.selectedProjectId }; view.rerender(<App controller={c} />); } });
  c = { ...c, onNavigate: navigate };
  const view = render(<App controller={c} />);
  return { navigate, update(p: MeetingProject, patch: Partial<AppController> = {}) { c = { ...c, projects: [p], ...patch }; view.rerender(<App controller={c} />); } };
}
function step(name: RegExp) { fireEvent.click(within(screen.getByRole('navigation', { name: 'Memo steps' })).getByRole('button', { name })); }
function disclosure(stage: 'preparation' | 'transcription') { return screen.getByRole('button', { name: new RegExp(`^(Show|Hide) ${stage} details$`) }); }

it('keeps completion open and folds preparation only after an accepted forward move and revisit', () => {
  const f = flow({ ...prepared, preparedChunks: [], retainedAudio: { sourceIds: ['source'], chunkIds: [] } });
  f.update(prepared);
  expect(disclosure('preparation').getAttribute('aria-expanded')).toBe('true');
  step(/Transcribe/); step(/Prepare audio/);
  expect(disclosure('preparation').getAttribute('aria-expanded')).toBe('false');
  expect(screen.getAllByText('Synthetic.wav').length).toBeGreaterThan(0);
  fireEvent.click(disclosure('preparation'));
  expect(disclosure('preparation').getAttribute('aria-expanded')).toBe('true');
  expect(f.navigate).toHaveBeenCalledWith('stt', prepared.id);
});
it('does not fold the visible stage when a navigation request has not arrived', () => {
  flow(prepared, 'import', {}, false); step(/Transcribe/);
  expect(disclosure('preparation').getAttribute('aria-expanded')).toBe('true');
});
it('keeps unapplied preparation options open and applies through the existing reset planner', () => {
  const plan = vi.fn(); flow(prepared, 'import', { onPlanPreparationReset: plan });
  fireEvent.click(screen.getByText('Chunks & compression'));
  fireEvent.click(within(screen.getByRole('group', { name: 'Chunk length' })).getByRole('button', { name: '15 min' }));
  expect((disclosure('preparation') as HTMLButtonElement).disabled).toBe(true);
  expect(disclosure('preparation').getAttribute('aria-expanded')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
  expect(plan).toHaveBeenCalledWith(prepared.id, { ...prepared.audioOptions, chunkMinutes: 15 });
});
it('keeps transcript review mounted and visible when completed execution details are folded', () => {
  const f = flow(prepared, 'stt'); f.update(transcribed());
  expect(disclosure('transcription').getAttribute('aria-expanded')).toBe('true');
  step(/Organize memo/); step(/Transcribe/);
  expect(disclosure('transcription').getAttribute('aria-expanded')).toBe('false');
  const transcript = screen.getByText('SYNTHETIC_PRESERVED_TRANSCRIPT');
  expect(transcript.closest('.completed-stage-body')).toBeNull();
  fireEvent.click(disclosure('transcription'));
  fireEvent.click(screen.getByRole('button', { name: 'Edit transcription input' }));
  fireEvent.change(screen.getByLabelText('Spoken languages · comma-separated'), { target: { value: 'en, ko' } });
  expect((disclosure('transcription') as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByLabelText('Spoken languages · comma-separated') as HTMLInputElement).value).toBe('en, ko');
});
it.each(['failed', 'outcome-unknown', 'requesting'] as const)('reveals a newer %s attempt instead of hiding it behind an old saved result', state => {
  const p = transcribed(), f = flow(p, 'stt');
  step(/Organize memo/); step(/Transcribe/);
  expect(disclosure('transcription').getAttribute('aria-expanded')).toBe('false');
  f.update({ ...p, runs: [...p.runs, { id: 'new-run', projectId: p.id, state, checkpoint: null, intent: p.runs[0].intent }] });
  expect(screen.queryByRole('button', { name: /^(Show|Hide) transcription details$/ })).toBeNull();
  expect(document.querySelector('.completed-stage-body')?.getAttribute('data-collapsed')).toBe('false');
});
it('opens the preparation reset editor before moving keyboard focus into its controls', () => {
  const f = flow(prepared); step(/Transcribe/); step(/Prepare audio/);
  expect(disclosure('preparation').getAttribute('aria-expanded')).toBe('false');
  f.update(prepared, { preparationEditor: { projectId: prepared.id, requestId: 1 } });
  expect(disclosure('preparation').getAttribute('aria-expanded')).toBe('true');
  expect(document.activeElement).toBe(screen.getByText('Chunks & compression').closest('summary'));
});
it('reveals a partial selected transcript instead of presenting all saved chunks as complete', () => {
  const p = transcribed(), f = flow(p, 'stt'); step(/Organize memo/); step(/Transcribe/);
  expect(disclosure('transcription').getAttribute('aria-expanded')).toBe('false');
  f.update({ ...p, transcriptVersions: [{ ...p.transcriptVersions[0], missingRanges: [[500, 1000]] }] });
  expect(screen.queryByRole('button', { name: /^(Show|Hide) transcription details$/ })).toBeNull();
  expect(document.querySelector('.completed-stage-body')?.getAttribute('data-collapsed')).toBe('false');
});
it('preserves mounted input state across folding and keeps focused desktop controls open when narrowed', () => {
  const media = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal('matchMedia', () => media);
  const view = render(<CompletedStageDetails stage="preparation" language="en" complete initiallyCollapsed summary="Synthetic"><input aria-label="Synthetic local draft" defaultValue="original" /></CompletedStageDetails>);
  const input = screen.getByLabelText('Synthetic local draft');
  fireEvent.change(input, { target: { value: 'unsaved' } }); input.focus();
  media.matches = true; act(() => media.addEventListener.mock.calls[0][1]());
  expect(disclosure('preparation').getAttribute('aria-expanded')).toBe('true');
  expect(document.activeElement).toBe(input);
  fireEvent.click(disclosure('preparation')); expect(disclosure('preparation').getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(disclosure('preparation')); expect(screen.getByLabelText('Synthetic local draft')).toBe(input);
  expect((input as HTMLInputElement).value).toBe('unsaved');
  view.unmount(); expect(media.removeEventListener).toHaveBeenCalledWith('change', media.addEventListener.mock.calls[0][1]);
});
it('does not reuse a collapse preference for newly prepared chunks or another memo', () => {
  const f = flow(prepared); step(/Transcribe/); step(/Prepare audio/);
  expect(disclosure('preparation').getAttribute('aria-expanded')).toBe('false');
  step(/Transcribe/);
  const fresh = { ...prepared, preparedChunks: [{ ...prepared.preparedChunks[0], id: 'fresh-chunk' }], retainedAudio: { sourceIds: ['source'], chunkIds: ['fresh-chunk'] } };
  f.update(fresh); step(/Prepare audio/);
  expect(disclosure('preparation').getAttribute('aria-expanded')).toBe('true');
});
it('keeps final Markdown and export actions outside every completed-stage disclosure', () => {
  const p = { ...transcribed(), minutesRevisions: [{ id: 'notes', runId: 'notes-run', parentId: null, markdown: '# SYNTHETIC_FINAL_NOTES' }], selectedMinutesRevisionId: 'notes' };
  flow(p, 'stt', { onCopyMinutes: vi.fn(), onDownloadMinutes: vi.fn() }); step(/Organize memo/);
  expect(screen.getByText('SYNTHETIC_FINAL_NOTES').closest('.completed-stage-body')).toBeNull();
  for (const name of [/Copy Markdown/, /Download/]) expect(screen.getByRole('button', { name }).closest('.completed-stage-body')).toBeNull();
});
