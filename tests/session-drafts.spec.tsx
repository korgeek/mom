// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { defaultPreferences, type AppController } from '../src/react-app/App';
import type { MeetingProject } from '../src/react-app/domain/types';
import { useSessionDraft } from '../src/react-app/ui/useSessionDraft';
import Review from '../src/react-app/ui/screens/Review';
import Minutes from '../src/react-app/ui/screens/Minutes';
import Import from '../src/react-app/ui/screens/Import';
import STT from '../src/react-app/ui/screens/STT';

afterEach(cleanup);

function project(): MeetingProject {
  return { id: 'synthetic-drafts', title: 'Synthetic drafts', icon: 'mic', color: '#2B59C3', pinned: false,
    createdAt: '2026-10-18T00:00:00Z', updatedAt: '2026-10-18T00:00:00Z', sourceAssets: [],
    audioOptions: { chunkMinutes: 10, overlapSeconds: 10, expectedLanguages: ['en'], bitrateKbps: 32, sampleRateHz: 16000 },
    preparedChunks: [], rawTranscripts: [],
    transcriptVersions: [{ id: 'transcript-one', parentId: null, rawIds: [], segments: [{ id: 'segment-one', text: 'SOURCE_TRANSCRIPT', sourceStartMs: 0, sourceEndMs: 1000, rawIds: [] }], issues: [], missingRanges: [] }], selectedTranscriptVersionId: 'transcript-one',
    minutesSettings: { outputLanguage: 'en', sections: ['summary'], instructions: '', modelId: '' },
    minutesRuns: [], minutesRevisions: [{ id: 'notes-one', runId: 'synthetic-run', parentId: null, markdown: '# SOURCE_NOTES' }], selectedMinutesRevisionId: 'notes-one', runs: [] };
}

function controller(p = project(), extra: Partial<AppController> = {}): AppController {
  let drafts: Record<string, unknown> = {};
  return { session: 'unlocked', projects: [p], selectedProjectId: p.id, screen: 'import', settingsTab: 'models',
    preferences: { ...defaultPreferences, uiLanguage: 'en' }, defaultAudioOptions: p.audioOptions,
    modelCatalog: [{ id: 'whisper-1', label: 'Synthetic STT', provider: 'openai', kind: 'stt', enabled: true }],
    sttModelId: 'whisper-1', connections: [], storageEstimate: null,
    onEditTranscript: vi.fn(), onEditMinutes: vi.fn(), onMinutesSettings: vi.fn(), onAudioOptions: vi.fn(), onPlanPreparationReset: vi.fn(),
    get uiDrafts() { return drafts; }, onUIDraft(key, value) { drafts = { ...drafts, [key]: structuredClone(value) }; }, ...extra };
}

it('records the first change synchronously and restores it after unmount without controller emission', () => {
  const c = controller();
  const first = renderHook(() => useSessionDraft(c, 'memo:version:text', 'original'));
  act(() => { first.result.current[1]('typed first character'); expect(c.uiDrafts?.['memo:version:text']).toBe('typed first character'); });
  first.unmount();
  const restored = renderHook(() => useSessionDraft(c, 'memo:version:text', 'original'));
  expect(restored.result.current[0]).toBe('typed first character');
});

it('applies consecutive functional setters to the latest draft before React commits', () => {
  const c = controller(), view = renderHook(() => useSessionDraft(c, 'count', 0));
  act(() => { view.result.current[1](value => value + 1); view.result.current[1](value => value + 1); expect(c.uiDrafts?.count).toBe(2); });
  expect(view.result.current[0]).toBe(2);
});

it('keeps distinct identities separate when an existing mounted editor changes its input', () => {
  const c = controller();
  const view = renderHook(({ id }) => useSessionDraft(c, id, () => `source:${id}`), { initialProps: { id: 'version-one' } });
  act(() => view.result.current[1]('first draft'));
  view.rerender({ id: 'version-two' }); expect(view.result.current[0]).toBe('source:version-two');
  act(() => view.result.current[1]('second draft'));
  view.rerender({ id: 'version-one' }); expect(view.result.current[0]).toBe('first draft');
});

it('falls back to ordinary local state without a draft controller', () => {
  const view = renderHook(() => useSessionDraft({}, 'local-only', () => 'initial'));
  act(() => view.result.current[1](value => `${value} edited`));
  expect(view.result.current[0]).toBe('initial edited');
});

it.each([null, false, 0, ''])('restores a present falsy JSON draft: %j', value => {
  const initial = vi.fn(() => 'unused');
  const view = renderHook(() => useSessionDraft<unknown>({ uiDrafts: { saved: value } }, 'saved', initial));
  expect(view.result.current[0]).toBe(value); expect(initial).not.toHaveBeenCalled();
});

it('restores the unsaved transcript editor while isolating a newly selected transcript version', () => {
  const p = project(), c = controller(p), first = render(<Review project={p} controller={c} />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit segment 1' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Transcript edit' }), { target: { value: 'UNSAVED_TRANSCRIPT_DRAFT' } });
  first.unmount();
  const restored = render(<Review project={p} controller={c} />);
  expect((screen.getByRole('textbox', { name: 'Transcript edit' }) as HTMLTextAreaElement).value).toBe('UNSAVED_TRANSCRIPT_DRAFT');
  restored.unmount();
  const next = { ...p, selectedTranscriptVersionId: 'transcript-two', transcriptVersions: [{ ...p.transcriptVersions[0], id: 'transcript-two' }] };
  render(<Review project={next} controller={c} />);
  expect(screen.queryByRole('textbox', { name: 'Transcript edit' })).toBeNull();
  expect(c.onEditTranscript).not.toHaveBeenCalled();
});

it('restores Markdown mode, text and unapplied language/budget without saving or mixing a new result', () => {
  const p = project(), c = controller(p), first = render(<Minutes project={p} controller={c} />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Markdown editor' }), { target: { value: '# UNSAVED_MARKDOWN_DRAFT' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Output language' }), { target: { value: '__custom' } });
  fireEvent.change(screen.getByLabelText('Notes language', {}), { target: { value: 'French' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Notes length' }), { target: { value: '__custom' } });
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Custom maximum · tokens' }), { target: { value: '777' } });
  first.unmount();
  const restored = render(<Minutes project={p} controller={c} />);
  expect((screen.getByRole('textbox', { name: 'Markdown editor' }) as HTMLTextAreaElement).value).toBe('# UNSAVED_MARKDOWN_DRAFT');
  expect((screen.getByLabelText('Notes language', {}) as HTMLInputElement).value).toBe('French');
  expect((screen.getByRole('spinbutton', { name: 'Custom maximum · tokens' }) as HTMLInputElement).value).toBe('777');
  restored.unmount();
  render(<Minutes project={{ ...p, selectedMinutesRevisionId: 'notes-two', minutesRevisions: [{ ...p.minutesRevisions[0], id: 'notes-two', markdown: '# NEW_RESULT' }] }} controller={c} />);
  expect(screen.queryByRole('textbox', { name: 'Markdown editor' })).toBeNull();
  expect(screen.getByText('NEW_RESULT')).toBeTruthy();
  expect(c.onEditMinutes).not.toHaveBeenCalled(); expect(c.onMinutesSettings).not.toHaveBeenCalled();
});

it('retains unapplied preparation options without applying or resetting completed work', () => {
  const p = project(), c = controller(p), first = render(<Import project={p} controller={c} />);
  fireEvent.click(screen.getByText('Chunks & compression', {}));
  fireEvent.click(within(screen.getByRole('group', { name: 'Chunk length' })).getByRole('button', { name: '15 min' }));
  expect(within(screen.getByRole('group', { name: 'Chunk length' })).getByRole('button', { name: '15 min' }).getAttribute('aria-pressed')).toBe('true');
  first.unmount();
  render(<Import project={p} controller={c} />);
  fireEvent.click(screen.getByText('Chunks & compression', {}));
  expect(within(screen.getByRole('group', { name: 'Chunk length' })).getByRole('button', { name: '15 min' }).getAttribute('aria-pressed')).toBe('true');
  expect(c.onAudioOptions).not.toHaveBeenCalled();
});

it('retains STT language, vocabulary and context drafts without applying or carrying them to a different model', () => {
  const p = project(), c = controller(p), first = render(<STT project={p} controller={c} />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit transcription input' }));
  for (const [label, value] of [['Spoken languages · comma-separated', 'en, ko'], ['Vocabulary · one per line', 'SYNTHETIC_TERM'], ['Context', 'UNSAVED_CONTEXT']] as const)
    fireEvent.change(screen.getByLabelText(label, {}), { target: { value } });
  first.unmount();
  const restored = render(<STT project={p} controller={c} />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit transcription input' }));
  expect((screen.getByLabelText('Context', {}) as HTMLTextAreaElement).value).toBe('UNSAVED_CONTEXT');
  expect((screen.getByLabelText('Vocabulary · one per line', {}) as HTMLTextAreaElement).value).toBe('SYNTHETIC_TERM');
  expect((screen.getByLabelText('Spoken languages · comma-separated', {}) as HTMLInputElement).value).toBe('en, ko');
  restored.unmount(); render(<STT project={p} controller={{ ...c, sttModelId: '' }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit transcription input' }));
  expect((screen.getByLabelText('Spoken languages · comma-separated', {}) as HTMLInputElement).value).toBe('en');
  expect(c.onAudioOptions).not.toHaveBeenCalled();
});
