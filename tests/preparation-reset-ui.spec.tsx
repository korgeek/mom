// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App, { defaultPreferences, type AppController } from '../src/react-app/App';
import type { MeetingProject } from '../src/react-app/domain/types';
vi.mock('../src/react-app/media/prepare', () => ({ planChunkRanges: (durationMs: number) => [{ sourceStartMs: 0, sourceEndMs: durationMs }] }));
afterEach(cleanup);
function project(): MeetingProject {
  return { id: 'reset-ui', title: 'Synthetic reset memo', icon: 'mic', color: '#3B82F6', pinned: false, createdAt: '2026-10-17T00:00:00Z', updatedAt: '2026-10-17T00:00:00Z',
    sourceAssets: [{ id: 'source', fileName: 'synthetic.wav', bytes: 3, durationMs: 1000, container: 'wav', codec: 'pcm', channels: 1, sampleRateHz: 16000 }],
    audioOptions: { chunkMinutes: 10, overlapSeconds: 10, bitrateKbps: 32, sampleRateHz: 16000, expectedLanguages: ['ko'], transcriptionHints: { terms: ['MoM'], context: 'Synthetic context' } },
    preparedChunks: [{ id: 'chunk', sourceId: 'source', index: 0, sourceStartMs: 0, sourceEndMs: 1000, encodingOffsetMs: 0, encodedBytes: 3, mimeType: 'audio/mpeg', codec: 'mp3', audioRecordId: 'audio' }],
    retainedAudio: { sourceIds: ['source'], chunkIds: ['chunk'] }, rawTranscripts: [], transcriptVersions: [], selectedTranscriptVersionId: null,
    minutesSettings: { outputLanguage: 'en', sections: ['summary'], instructions: '', modelId: '' }, minutesRuns: [], minutesRevisions: [], selectedMinutesRevisionId: null, runs: [] };
}
function controller(p: MeetingProject, extra: Partial<AppController> = {}): AppController {
  return { session: 'unlocked', screen: 'import', projects: [p], selectedProjectId: p.id, settingsTab: 'connections', preferences: { ...defaultPreferences, uiLanguage: 'en' }, defaultAudioOptions: { ...p.audioOptions, chunkMinutes: 15, expectedLanguages: ['ja'], transcriptionHints: undefined }, modelCatalog: null, sttModelId: '', connections: [], storageEstimate: null, ...extra };
}
async function editor() { const user = userEvent.setup(); await user.click(screen.getByText('Chunks & compression')); return user; }
it('opens the preparation editor from the pencil beside the STT chunk summary', async () => {
  const p = project(), edit = vi.fn(), user = userEvent.setup(); render(<App controller={controller(p, { screen: 'stt', onEditPreparation: edit })} />);
  const button = screen.getByRole('button', { name: 'Edit chunks & compression' }); expect(button.closest('.card-heading')?.textContent).toContain('10 min');
  await user.click(button); expect(edit).toHaveBeenCalledWith(p.id);
});
it('opens, scrolls and focuses processing settings for an editor navigation request', () => {
  const p = project(), scroll = vi.fn(); HTMLElement.prototype.scrollIntoView = scroll;
  render(<App controller={controller(p, { preparationEditor: { projectId: p.id, requestId: 1 } })} />);
  const anchor = screen.getByText('Chunks & compression').closest('summary')!;
  expect(anchor.closest('details')?.open).toBe(true); expect(document.activeElement).toBe(anchor); expect(scroll).toHaveBeenCalled();
});
it('keeps encoding edits local until Apply, then asks for reset with the latest language hints', async () => {
  const p = project(), apply = vi.fn(), plan = vi.fn(), c = controller(p, { onAudioOptions: apply, onPlanPreparationReset: plan }), view = render(<App controller={c} />), user = await editor();
  await user.click(within(screen.getByRole('group', { name: 'Chunk length' })).getByRole('button', { name: '15 min' }));
  expect(apply).not.toHaveBeenCalled(); expect(plan).not.toHaveBeenCalled();
  const changed = { ...p, audioOptions: { ...p.audioOptions, expectedLanguages: ['ko', 'en'], transcriptionHints: { terms: ['Updated'], context: 'Latest' } } };
  view.rerender(<App controller={controller(changed, { onAudioOptions: apply, onPlanPreparationReset: plan })} />);
  await user.click(screen.getByRole('button', { name: 'Apply changes' })); expect(plan).toHaveBeenCalledWith(p.id, { ...changed.audioOptions, chunkMinutes: 15 }); expect(apply).not.toHaveBeenCalled();
});
it('cancels a draft without touching saved options or files', async () => {
  const p = project(), apply = vi.fn(), plan = vi.fn(); render(<App controller={controller(p, { onAudioOptions: apply, onPlanPreparationReset: plan })} />); const user = await editor();
  await user.click(within(screen.getByRole('group', { name: 'Overlap' })).getByRole('button', { name: '15 s' })); await user.click(screen.getByRole('button', { name: 'Cancel changes' }));
  expect(within(screen.getByRole('group', { name: 'Overlap' })).getByRole('button', { name: '10 s' }).getAttribute('aria-pressed')).toBe('true'); expect(apply).not.toHaveBeenCalled(); expect(plan).not.toHaveBeenCalled();
});
it('applies initial settings normally and encoding defaults preserve languages and vocabulary', async () => {
  const p = { ...project(), preparedChunks: [] }, apply = vi.fn(), plan = vi.fn(); render(<App controller={controller(p, { onAudioOptions: apply, onPlanPreparationReset: plan })} />); const user = await editor();
  await user.click(screen.getByRole('button', { name: 'Reset to defaults' })); expect(apply).not.toHaveBeenCalled(); await user.click(screen.getByRole('button', { name: 'Apply changes' }));
  expect(apply).toHaveBeenCalledWith(p.id, { ...p.audioOptions, chunkMinutes: 15 }); expect(plan).not.toHaveBeenCalled();
});
it('changes spoken language hints without planning a reset', async () => {
  const p = project(), apply = vi.fn(), plan = vi.fn(); render(<App controller={controller(p, { onAudioOptions: apply, onPlanPreparationReset: plan })} />);
  await userEvent.setup().click(within(screen.getByRole('group', { name: 'Spoken languages · select multiple' })).getByRole('button', { name: 'English' }));
  expect(apply).toHaveBeenCalledWith(p.id, { ...p.audioOptions, expectedLanguages: ['ko', 'en'] }); expect(plan).not.toHaveBeenCalled();
});
it('describes the exact destructive scope, traps focus and confirms only the reviewed token', async () => {
  const p = project(), confirm = vi.fn(), cancel = vi.fn(), user = userEvent.setup();
  render(<App controller={controller(p, { preparationResetPlan: { projectId: p.id, audioOptions: { ...p.audioOptions, chunkMinutes: 15 }, versionToken: 'reviewed-token', counts: { chunks: 1, transcriptVersions: 2, minutesRevisions: 3 } }, onConfirmPreparationReset: confirm, onCancelPreparationReset: cancel })} />);
  const dialog = within(screen.getByRole('dialog', { name: 'Reset chunks & results?' }));
  expect(dialog.getByText(/Old encrypted chunk audio/)).toBeTruthy(); expect(dialog.getByText(/Raw and edited transcripts/)).toBeTruthy(); expect(dialog.getByText(/Generated and edited notes/)).toBeTruthy();
  expect(dialog.getByText(/Source audio and memo settings are retained/)).toBeTruthy(); expect(dialog.getByText(/before reset/)).toBeTruthy(); expect(dialog.getByText(/does not start paid transcription/)).toBeTruthy();
  expect(document.activeElement).toBe(dialog.getByRole('button', { name: 'Cancel' })); await user.tab({ shift: true }); expect(document.activeElement).toBe(dialog.getByRole('button', { name: 'Reset & prepare again' }));
  await user.click(dialog.getByRole('button', { name: 'Reset & prepare again' })); expect(confirm).toHaveBeenCalledWith('reviewed-token'); expect(cancel).not.toHaveBeenCalled();
});
it('cancels reset confirmation without applying options or deleting anything', async () => {
  const p = project(), confirm = vi.fn(), cancel = vi.fn(), apply = vi.fn(), user = userEvent.setup();
  render(<App controller={controller(p, { preparationResetPlan: { projectId: p.id, audioOptions: p.audioOptions, versionToken: 'token', counts: { chunks: 1, transcriptVersions: 0, minutesRevisions: 0 } }, onConfirmPreparationReset: confirm, onCancelPreparationReset: cancel, onAudioOptions: apply })} />);
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' })); expect(cancel).toHaveBeenCalledOnce(); expect(confirm).not.toHaveBeenCalled(); expect(apply).not.toHaveBeenCalled();
});
it('blocks a reset when source audio is missing and disables editing during processing', async () => {
  const p = { ...project(), retainedAudio: { sourceIds: [], chunkIds: ['chunk'] } }, plan = vi.fn(), c = controller(p, { onAudioOptions: vi.fn(), onPlanPreparationReset: plan }), view = render(<App controller={c} />), user = await editor();
  await user.click(within(screen.getByRole('group', { name: 'Chunk length' })).getByRole('button', { name: '15 min' })); expect((screen.getByRole('button', { name: 'Apply changes' }) as HTMLButtonElement).disabled).toBe(true); expect(screen.getByText(/retained original is unavailable, so preparation cannot be reset/)).toBeTruthy(); expect(plan).not.toHaveBeenCalled();
  view.rerender(<App controller={{ ...c, busy: true }} />); expect((within(screen.getByRole('group', { name: 'Chunk length' })).getByRole('button', { name: '15 min' }) as HTMLButtonElement).disabled).toBe(true);
  view.rerender(<App controller={{ ...c, screen: 'stt', busy: true, onEditPreparation: vi.fn() }} />); expect((screen.getByRole('button', { name: 'Edit chunks & compression' }) as HTMLButtonElement).disabled).toBe(true);
});

it('keeps bitrate edits local and blocks them when a provider request is active', async () => {
  const p = project(), plan = vi.fn(), apply = vi.fn(), c = controller(p, { onPlanPreparationReset: plan, onAudioOptions: apply }), view = render(<App controller={c} />), user = await editor();
  await user.click(screen.getByRole('button', { name: 'Advanced ▸' })); await user.selectOptions(screen.getByRole('combobox', { name: 'Bitrate' }), '48');
  expect(plan).not.toHaveBeenCalled(); expect(apply).not.toHaveBeenCalled();
  view.rerender(<App controller={{ ...c, chunkStates: [{ chunkId: 'chunk', state: 'requesting' }] }} />);
  expect((screen.getByRole('combobox', { name: 'Bitrate' }) as HTMLSelectElement).disabled).toBe(true); expect((screen.getByRole('button', { name: 'Apply changes' }) as HTMLButtonElement).disabled).toBe(true);
  view.rerender(<App controller={c} />); await user.click(screen.getByRole('button', { name: 'Apply changes' })); expect(plan).toHaveBeenCalledWith(p.id, { ...p.audioOptions, bitrateKbps: 48 });
});
it('changes transcript vocabulary and context through ordinary input settings without reset', async () => {
  const p = project(), plan = vi.fn(), apply = vi.fn(), user = userEvent.setup(); render(<App controller={controller(p, { screen: 'stt', sttModelId: 'gpt-4o-transcribe', modelCatalog: [{ id: 'gpt-4o-transcribe', label: 'Synthetic model', kind: 'stt', provider: 'openai', enabled: true }], onPlanPreparationReset: plan, onAudioOptions: apply })} />);
  await user.click(screen.getByRole('button', { name: 'Edit transcription input' })); const terms = screen.getByLabelText('Vocabulary · one per line'), context = screen.getByLabelText('Context');
  await user.clear(terms); await user.type(terms, 'Updated'); await user.clear(context); await user.type(context, 'Latest context'); await user.click(screen.getByRole('button', { name: 'Apply input settings' }));
  expect(apply).toHaveBeenCalledWith(p.id, { ...p.audioOptions, transcriptionHints: { terms: ['Updated'], context: 'Latest context' } }); expect(plan).not.toHaveBeenCalled();
});
