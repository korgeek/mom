// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { defaultPreferences, type AppController } from '../src/react-app/App';
import type { MeetingProject, Usage } from '../src/react-app/domain/types';
import Import from '../src/react-app/ui/screens/Import';
import Minutes from '../src/react-app/ui/screens/Minutes';
import UsageStatement from '../src/react-app/ui/UsageStatement';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function viewport(initialWidth: number) {
  let width = initialWidth;
  const lists: (EventTarget & { matches: boolean; max: number })[] = [];
  vi.stubGlobal('matchMedia', (query: string) => {
    const max = Number(/max-width:\s*(\d+)px/u.exec(query)?.[1] ?? 0);
    const list = Object.assign(new EventTarget(), { matches: width <= max, max });
    lists.push(list); return list;
  });
  return (next: number) => act(() => {
    width = next;
    for (const list of lists) { list.matches = width <= list.max; list.dispatchEvent(new Event('change')); }
  });
}
function project(withResult = false): MeetingProject {
  return { id: 'compact-priority', title: 'SYNTHETIC_MEMO', icon: 'mic', color: '#2B59C3', pinned: false,
    createdAt: '2026-10-18', updatedAt: '2026-10-18', sourceAssets: [],
    audioOptions: { chunkMinutes: 10, overlapSeconds: 10, expectedLanguages: ['en'], bitrateKbps: 32, sampleRateHz: 16000 },
    preparedChunks: [], rawTranscripts: [], transcriptVersions: [], selectedTranscriptVersionId: null,
    minutesSettings: { outputLanguage: 'en', sections: ['summary'], instructions: '', modelId: '' },
    minutesRuns: [], minutesRevisions: withResult ? [{ id: 'notes-one', runId: 'notes-run', parentId: null, markdown: '# SYNTHETIC_RESULT' }] : [],
    selectedMinutesRevisionId: withResult ? 'notes-one' : null, runs: [] };
}
function controller(p: MeetingProject, recording = false): AppController {
  let drafts: Record<string, unknown> = {};
  return { session: 'unlocked', projects: [p], selectedProjectId: p.id, screen: 'import', settingsTab: 'models',
    preferences: { ...defaultPreferences, uiLanguage: 'en' }, defaultAudioOptions: p.audioOptions,
    modelCatalog: [], sttModelId: '', connections: [], storageEstimate: null,
    onUpdateMeeting: vi.fn(), onAudioOptions: vi.fn(), onMinutesSettings: vi.fn(), onEditMinutes: vi.fn(), onGenerateMinutes: vi.fn(),
    get uiDrafts() { return drafts; }, onUIDraft(key, value) { drafts = { ...drafts, [key]: structuredClone(value) }; },
    recordingActive: recording,
    recording: { projectId: p.id, language: 'en', supported: true, startBlockedReason: null, pendingAction: null,
      snapshot: { state: recording ? 'recording' : 'idle', sampleRateHz: 16000, acceptedSamples: 16000, committedSamples: 16000, bodyBytes: 32000, committedBytes: 32000, durationMs: 1000, inputLevel: 0.2, source: null, error: null },
      onStart: vi.fn(), onPause: vi.fn(), onResume: vi.fn(), onStop: vi.fn(), onAbort: vi.fn() } };
}
function bodyOf(button: HTMLElement) { return document.getElementById(button.getAttribute('aria-controls')!)!; }

function preparingProject() {
  const p = project();
  return { ...p, sourceAssets: [{ id: 'source', fileName: 'SYNTHETIC_PREPARATION.wav', durationMs: 610000, bytes: 320044,
    container: 'wav', codec: 'pcm_s16le', channels: 1, sampleRateHz: 16000 }],
    retainedAudio: { sourceIds: ['source'], chunkIds: ['saved'] }, preparedChunks: [{ id: 'saved', sourceId: 'source', index: 0,
      sourceStartMs: 0, sourceEndMs: 600000, encodingOffsetMs: 0, encodedBytes: 100, mimeType: 'audio/mpeg', codec: 'mp3', audioRecordId: 'audio' }] };
}
const preparing = { stage: 'preparing' as const, completed: 1, total: 2, sourceProcessedMs: 600000, durationMs: 610000 };

it.each([390, 820, 1100])('prioritizes preparation and incomplete saved work at %ipx without moving scroll', width => {
  viewport(width); const p = preparingProject(), c = { ...controller(p), busy: true, preparation: preparing, onCancelPreparation: vi.fn(), onPrepareAudio: vi.fn() };
  const view = render(<Import project={p} controller={c} />);
  expect(bodyOf(screen.getByRole('button', { name: 'Show memo details' })).hidden).toBe(true);
  const sourceToggle = screen.getByRole('button', { name: 'Show audio input' });
  for (const id of sourceToggle.getAttribute('aria-controls')!.split(' ')) expect(document.getElementById(id)?.hidden).toBe(true);
  expect(screen.queryByRole('textbox', { name: 'Memo title' })).toBeNull();
  expect(screen.queryByRole('tablist', { name: 'Audio input method' })).toBeNull();
  expect(screen.getByRole('region', { name: 'Local audio preparation' })).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Cancel preparation' }) as HTMLButtonElement).disabled).toBe(false);
  view.rerender(<Import project={p} controller={{ ...c, busy: false, preparation: { ...preparing, stage: 'stopped' } }} />);
  expect(screen.getByRole('button', { name: 'Show memo details' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Show audio input' })).toBeTruthy();
  expect(screen.getByText('Decoding and compression restart from the beginning. Saved chunks are kept.')).toBeTruthy();
  view.rerender(<Import project={p} controller={{ ...c, busy: false, preparation: null }} />);
  expect(screen.getByRole('button', { name: 'Show audio input' })).toBeTruthy();
});

it('retains explicitly opened preparation details across stop, retry and remount', () => {
  viewport(390); const p = preparingProject(), c = controller(p);
  const view = render(<Import project={p} controller={{ ...c, preparation: preparing }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Show memo details' }));
  fireEvent.click(screen.getByRole('button', { name: 'Show audio input' }));
  view.rerender(<Import project={p} controller={{ ...c, preparation: { ...preparing, stage: 'stopped' } }} />);
  expect(screen.getByRole('textbox', { name: 'Memo title' })).toBeTruthy();
  expect(screen.getByRole('tablist', { name: 'Audio input method' })).toBeTruthy();
  view.unmount(); render(<Import project={p} controller={{ ...c, preparation: preparing }} />);
  expect(screen.getByRole('button', { name: 'Hide memo details' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Hide audio input' })).toBeTruthy();
});

it('keeps focused source controls visible on narrowing and leaves wide preparation expanded', () => {
  const resize = viewport(1440), p = preparingProject(), c = { ...controller(p), preparation: { ...preparing, stage: 'stopped' as const }, onPickFile: vi.fn() };
  render(<Import project={p} controller={c} />);
  expect(screen.queryByRole('button', { name: 'Show memo details' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Show audio input' })).toBeNull();
  const preview = screen.getByRole('button', { name: 'Choose file for preview' }); act(() => preview.focus()); resize(820);
  expect(screen.getByRole('button', { name: 'Hide audio input' })).toBeTruthy();
  expect(document.activeElement).toBe(preview);
});

it.each([390, 820, 1100])('summarizes recording metadata at %ipx while keeping capture controls and mounted fields', width => {
  viewport(width); const p = project(), c = controller(p, true);
  render(<Import project={p} controller={c} />);
  const toggle = screen.getByRole('button', { name: 'Show memo details' });
  const body = bodyOf(toggle), input = within(body).getByRole('textbox', { name: 'Memo title', hidden: true });
  expect(body.hidden).toBe(true); expect(body.hasAttribute('inert')).toBe(true);
  expect(screen.queryByRole('textbox', { name: 'Memo title' })).toBeNull();
  expect(screen.getByText(p.title)).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Save and stop' }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(toggle);
  expect(body.hidden).toBe(false); expect(screen.getByRole('textbox', { name: 'Memo title' })).toBe(input);
  expect((input as HTMLInputElement).value).toBe(p.title);
  fireEvent.click(screen.getByRole('button', { name: 'Save and stop' })); expect(c.recording?.onStop).toHaveBeenCalledOnce();
});

it('keeps edited metadata and focused desktop fields visible when recording starts or the viewport narrows', () => {
  const resize = viewport(1440), p = project(), c = controller(p);
  const view = render(<Import project={p} controller={c} />);
  const input = screen.getByRole('textbox', { name: 'Memo title' });
  act(() => input.focus()); fireEvent.change(input, { target: { value: 'EDITED_TITLE' } });
  const active = { ...c, recordingActive: true, recording: { ...c.recording!, snapshot: { ...c.recording!.snapshot, state: 'recording' as const } } };
  view.rerender(<Import project={{ ...p, title: 'EDITED_TITLE' }} controller={active} />); resize(820);
  const toggle = screen.getByRole('button', { name: 'Hide memo details' });
  expect(toggle.getAttribute('aria-expanded')).toBe('true'); expect(document.activeElement).toBe(input);
  expect((input as HTMLInputElement).value).toBe('EDITED_TITLE'); expect(bodyOf(toggle).hidden).toBe(false);
});

it('leaves desktop recording metadata expanded without a compact-only action', () => {
  viewport(1440); const p = project(); render(<Import project={p} controller={controller(p, true)} />);
  expect(screen.getByRole('textbox', { name: 'Memo title' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Show memo details' })).toBeNull();
});

it('collapses metadata after the normal title edit then Start recording flow', async () => {
  viewport(390); const p = project(), c = controller(p), user = userEvent.setup();
  const view = render(<Import project={p} controller={c} />);
  const input = screen.getByRole('textbox', { name: 'Memo title' });
  await user.click(input); fireEvent.change(input, { target: { value: 'EDITED_BEFORE_RECORDING' } });
  await user.click(screen.getByRole('button', { name: 'Start recording' }));
  const active = { ...c, recordingActive: true, recording: { ...c.recording!, snapshot: { ...c.recording!.snapshot, state: 'recording' as const } } };
  view.rerender(<Import project={{ ...p, title: 'EDITED_BEFORE_RECORDING' }} controller={active} />);
  const toggle = screen.getByRole('button', { name: 'Show memo details' });
  expect(bodyOf(toggle).hidden).toBe(true); expect(screen.getByText('EDITED_BEFORE_RECORDING')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Save and stop' })).toBeTruthy(); expect(c.recording?.onStart).toHaveBeenCalledOnce();
});

it('puts a completed compact result ahead of hidden settings and retains inputs and consent when explicitly reopened', () => {
  viewport(820); const p = project(true), c = controller(p); render(<Minutes project={p} controller={c} />);
  const toggle = screen.getByRole('button', { name: 'Show notes settings' }), body = bodyOf(toggle);
  expect(body.hidden).toBe(true); expect(body.hasAttribute('inert')).toBe(true);
  expect(screen.queryByRole('combobox', { name: 'Output language' })).toBeNull(); expect(screen.getByText('SYNTHETIC_RESULT')).toBeTruthy();
  fireEvent.click(toggle);
  const input = screen.getByRole('combobox', { name: 'Output language' });
  const consent = screen.getByRole('checkbox', { name: /I understand that the selected transcript/ });
  fireEvent.click(consent); expect((consent as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Hide notes settings' }));
  expect(body.hidden).toBe(true); fireEvent.click(screen.getByRole('button', { name: 'Show notes settings' }));
  expect(screen.getByRole('combobox', { name: 'Output language' })).toBe(input);
  expect((screen.getByRole('checkbox', { name: /I understand that the selected transcript/ }) as HTMLInputElement).checked).toBe(true);
  expect(c.onGenerateMinutes).not.toHaveBeenCalled(); expect(c.onMinutesSettings).not.toHaveBeenCalled();
});

it('preserves an explicitly opened settings draft through response-driven revision remounts without persisting consent', () => {
  viewport(820); const p = project(true), c = controller(p);
  const view = render(<Minutes key={p.selectedMinutesRevisionId} project={p} controller={c} />);
  fireEvent.click(screen.getByRole('button', { name: 'Show notes settings' }));
  fireEvent.change(screen.getByRole('combobox', { name: 'Output language' }), { target: { value: '__custom' } });
  const input = screen.getByLabelText('Notes language'); act(() => input.focus());
  fireEvent.change(input, { target: { value: 'UNAPPLIED_LANGUAGE' } });
  const next = { ...p, selectedMinutesRevisionId: 'notes-two', minutesRevisions: [{ ...p.minutesRevisions[0], id: 'notes-two' }] };
  view.rerender(<Minutes key={next.selectedMinutesRevisionId} project={next} controller={c} />);
  expect(screen.getByRole('button', { name: 'Hide notes settings' }).getAttribute('aria-expanded')).toBe('true');
  expect((screen.getByLabelText('Notes language') as HTMLInputElement).value).toBe('UNAPPLIED_LANGUAGE');
  expect((screen.getByRole('checkbox', { name: /I understand that the selected transcript/ }) as HTMLInputElement).checked).toBe(false);
});

it('protects active notes settings on narrowing and keeps desktop settings visible', () => {
  const resize = viewport(1440), p = project(true), c = controller(p);
  render(<Minutes project={p} controller={c} />);
  const input = screen.getByRole('combobox', { name: 'Output language' }); act(() => input.focus()); resize(820);
  const toggle = screen.getByRole('button', { name: 'Hide notes settings' });
  expect(bodyOf(toggle).hidden).toBe(false); expect(document.activeElement).toBe(input);
});

it('defaults to the result after ordinary initial settings selection and transmission review', async () => {
  viewport(820); const p = project(), c = controller(p), user = userEvent.setup();
  const view = render(<Minutes key={p.selectedMinutesRevisionId} project={p} controller={c} />);
  await user.selectOptions(screen.getByRole('combobox', { name: 'Output language' }), 'en');
  await user.click(screen.getByRole('checkbox', { name: /I understand that the selected transcript/ }));
  const result = project(true);
  view.rerender(<Minutes key={result.selectedMinutesRevisionId} project={result} controller={c} />);
  expect(bodyOf(screen.getByRole('button', { name: 'Show notes settings' })).hidden).toBe(true);
  expect(screen.getByText('SYNTHETIC_RESULT')).toBeTruthy();
});

it('keeps a field being edited visible across a response remount even without an earlier explicit Show', () => {
  viewport(820); const p = project(), c = controller(p);
  const view = render(<Minutes key={p.selectedMinutesRevisionId} project={p} controller={c} />);
  act(() => screen.getByRole('combobox', { name: 'Output language' }).focus());
  const result = project(true);
  view.rerender(<Minutes key={result.selectedMinutesRevisionId} project={result} controller={c} />);
  expect(bodyOf(screen.getByRole('button', { name: 'Hide notes settings' })).hidden).toBe(false);
  expect(screen.getByRole('combobox', { name: 'Output language' })).toBeTruthy();
});

const usage: Usage = { inputTokens: 100, outputTokens: 10, audioInputTokens: null, textInputTokens: null, audioOutputTokens: null, textOutputTokens: null, durationSeconds: null, elapsedMs: 1000,
  cost: 0.01, costKind: 'estimated', currency: 'USD', rateSource: 'SYNTHETIC_RATE_SOURCE', rateCheckedAt: '2026-10-18', rateSnapshot: null };
function usageProject(): MeetingProject {
  const p = project(true);
  return { ...p, rawTranscripts: [{ id: 'raw', runId: 'stt-run', chunkId: 'chunk', response: {}, text: 'Synthetic', segments: [], timing: 'chunk', speakerScope: 'none', execution: { requestedModel: 'whisper-1', returnedModel: null, actualProvider: null, expectedLanguages: ['en'], usage } }],
    minutesRuns: [{ id: 'notes-run', transcriptVersionId: 'transcript', settings: p.minutesSettings, generatedMarkdown: '# SYNTHETIC_RESULT', requestedModel: 'synthetic-notes', returnedModel: null, actualProvider: null, usage: { ...usage, currency: 'credits', cost: 0.02, costKind: 'reported' } }],
    runs: [{ id: 'stt-run', projectId: p.id, state: 'saved', checkpoint: null, intent: { kind: 'stt', chunkId: 'chunk', requestedModel: 'whisper-1', expectedLanguages: ['en'], rateSnapshot: null, requestedEndpoint: null } },
      { id: 'notes-run', projectId: p.id, state: 'saved', checkpoint: null, intent: { kind: 'minutes', chunkId: null, requestedModel: 'synthetic-notes', expectedLanguages: [], rateSnapshot: null, requestedEndpoint: null } }] };
}
it.each([false, true])('summarizes compact usage with costs/provenance available by disclosure (STT-only=%s)', async sttOnly => {
  viewport(820); render(<UsageStatement project={usageProject()} language="en" sttOnly={sttOnly} />);
  const toggle = screen.getByRole('button', { name: 'Show usage and cost details' });
  const body = bodyOf(toggle); expect(body.hidden).toBe(true); expect(screen.queryByRole('table')).toBeNull();
  fireEvent.click(toggle); expect(screen.getByRole('table')).toBeTruthy();
  expect(screen.getByText(/Final provider billing is unverified/)).toBeTruthy();
  if (!sttOnly) { expect(screen.getAllByText(/0.02 credits/).length).toBeGreaterThan(0); expect(screen.getByText(/Complete combined total: Unavailable/)).toBeTruthy(); }
  const user = userEvent.setup(); await user.click(screen.getByText('STT · Token, timing and state details'));
  await user.click(screen.getByRole('group', { name: 'Statement run stt-run' }).querySelector('summary')!);
  expect(screen.getByText('SYNTHETIC_RATE_SOURCE · 2026-10-18')).toBeTruthy();
  const hide = screen.getByRole('button', { name: 'Hide usage and cost details' });
  // A synthetic click that leaves focus inside the details must not hide it.
  fireEvent.click(hide); expect(body.hidden).toBe(false);
  await user.click(hide);
  expect(body.hidden).toBe(true); fireEvent.click(screen.getByRole('button', { name: 'Show usage and cost details' }));
  expect(screen.getByRole('group', { name: 'Statement run stt-run' })).toBeTruthy();
});
