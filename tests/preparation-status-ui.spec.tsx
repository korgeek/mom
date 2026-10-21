// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { defaultPreferences, type AppController, type UIPreparation } from '../src/react-app/App';
import type { MeetingProject } from '../src/react-app/domain/types';
import PreparationStatus, { PreparationDiagnosticControl } from '../src/react-app/ui/PreparationStatus';
import Import from '../src/react-app/ui/screens/Import';
// These UI checks do not load the codec's WASM through the worktree symlink.
vi.mock('../src/react-app/media/prepare', () => ({ planChunkRanges: (durationMs: number) => [{ sourceStartMs: 0, sourceEndMs: durationMs }] }));

const now = Date.parse('2026-10-18T12:00:00Z');
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
const preparation = (patch: Partial<UIPreparation> = {}): UIPreparation => ({
  stage: 'preparing', completed: 1, total: 7, sourceProcessedMs: 60000, durationMs: 2100000,
  startedAtMs: now - 60000, lastProgressAtMs: now - 2000, ...patch,
});
const controller = (value: UIPreparation, patch: Partial<AppController> = {}): AppController => ({
  session: 'unlocked', screenAccess: 'open', screen: 'import', settingsTab: 'connections',
  projects: [], selectedProjectId: null, preferences: { ...defaultPreferences, uiLanguage: 'en' },
  defaultAudioOptions: { chunkMinutes: 5, overlapSeconds: 5, bitrateKbps: 32, sampleRateHz: 16000, expectedLanguages: [] },
  modelCatalog: null, sttModelId: '', connections: [], storageEstimate: null, preparation: value, ...patch,
});

it.each([
  ['inspecting', 'Inspecting audio file locally…', 'Inspection audio processed:'],
  ['reading', 'Reading encrypted source audio locally…', 'Source audio read:'],
  ['decoding', 'Decoding source audio locally…', 'Decoded source audio:'],
  ['verifying', 'Verifying encoded audio chunk locally…', 'Chunk audio verified:'],
] as const)('shows %s separately without treating its work as encoded source progress', (stage, title, detail) => {
  render(<PreparationStatus controller={controller(preparation({ stage, phaseProcessedMs: 30000, phaseDurationMs: 300000 }))} />);
  expect(screen.getByRole('status').textContent).toBe(title);
  expect(screen.getByText(`${detail} 00:30 / 05:00`)).toBeTruthy();
  expect(screen.getByText('Source time processed: 01:00 / 35:00')).toBeTruthy();
  expect(screen.getByText('Encrypted audio chunks saved: 1 / planned 7')).toBeTruthy();
});

it('advances elapsed and last-event age without inventing processing progress or live announcements', () => {
  render(<PreparationStatus controller={controller(preparation())} />);
  const status = screen.getByRole('status'), initialStatus = status.textContent;
  expect(screen.getByText('Elapsed: 01:00')).toBeTruthy();
  expect(screen.getByText('Last real progress: 00:02 ago')).toBeTruthy();
  act(() => vi.advanceTimersByTime(5000));
  expect(screen.getByText('Elapsed: 01:05')).toBeTruthy();
  const age = screen.getByText('Last real progress: 00:07 ago');
  expect(age.closest('[aria-live], [role="status"], [role="alert"]')).toBeNull();
  expect(status.textContent).toBe(initialStatus);
  expect(screen.getByText('Source time processed: 01:00 / 35:00')).toBeTruthy();
  expect((screen.getByRole('progressbar') as HTMLProgressElement).value).toBe(60000);
});

it('warns after 30 seconds without real events and clears the warning only for a new event', () => {
  const value = preparation({ lastProgressAtMs: now });
  const view = render(<PreparationStatus controller={controller(value)} />);
  act(() => vi.advanceTimersByTime(29000));
  expect(screen.queryByText(/No new processing update/)).toBeNull();
  act(() => vi.advanceTimersByTime(1000));
  const warning = screen.getByText(/No new processing update/);
  expect(warning.getAttribute('role')).toBe('status');
  expect(warning.textContent).toContain('does not confirm that work has stopped');
  act(() => vi.advanceTimersByTime(10000));
  expect(warning.textContent).toContain('30 seconds');
  view.rerender(<PreparationStatus controller={controller({ ...value })} />);
  expect(screen.getByText(/No new processing update/)).toBeTruthy();
  view.rerender(<PreparationStatus controller={controller({ ...value, lastProgressAtMs: now + 40000, sourceProcessedMs: 61000 })} />);
  expect(screen.queryByText(/No new processing update/)).toBeNull();
  expect(screen.getByText('Source time processed: 01:01 / 35:00')).toBeTruthy();
});

it('waits for actual processing after foreground return instead of treating return as a heartbeat', () => {
  const value = preparation({ lastForegroundAtMs: now, lastProgressAtMs: now - 5000 });
  const view = render(<PreparationStatus controller={controller(value)} />);
  expect(screen.getByText(/Waiting for a new processing event after returning to this page/)).toBeTruthy();
  act(() => vi.advanceTimersByTime(5000));
  expect(screen.getByText(/Waiting for a new processing event after returning to this page/)).toBeTruthy();
  view.rerender(<PreparationStatus controller={controller({ ...value, lastProgressAtMs: now + 5000 })} />);
  expect(screen.queryByText(/Waiting for a new processing event after returning to this page/)).toBeNull();
});

it.each(['complete', 'failed', 'stopped'] as const)('stops the display clock after %s', stage => {
  render(<PreparationStatus controller={controller(preparation({ stage, lastProgressAtMs: now }))} />);
  expect(screen.getByText('Elapsed: 01:00')).toBeTruthy();
  act(() => vi.advanceTimersByTime(60000));
  expect(screen.getByText('Elapsed: 01:00')).toBeTruthy();
  expect(screen.queryByText(/No new processing update/)).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});

it('distinguishes stopped processing from saved contiguous source audio', () => {
  render(<PreparationStatus controller={controller(preparation({ stage: 'stopped', sourceProcessedMs: 400000, savedThroughMs: 300000 }))} />);
  expect(screen.getByRole('status').textContent).toContain('stopped');
  expect(screen.getByText('Contiguous source audio saved: 05:00 / 35:00')).toBeTruthy();
  expect(screen.getByText(/Decoding and compression restart from the beginning/)).toBeTruthy();
});

it('does not fabricate timestamps for older preparation snapshots', () => {
  render(<PreparationStatus controller={controller({ stage: 'saving', completed: 0, total: 7 })} />);
  expect(screen.getByText('Elapsed: Unknown')).toBeTruthy();
  expect(screen.getByText('Last real progress: Unknown')).toBeTruthy();
  expect(vi.getTimerCount()).toBe(0);
  expect(screen.getByRole('progressbar').hasAttribute('value')).toBe(false);
});

function project(): MeetingProject {
  const source = { id: 'source', fileName: 'SYNTHETIC.wav', bytes: 1000, durationMs: 2100000, container: 'wav', codec: 'pcm_s16le', channels: 1, sampleRateHz: 16000 } as const;
  return { id: 'synthetic', title: 'Synthetic memo', icon: 'mic', color: '#3B82F6', pinned: false,
    createdAt: '2026-10-18T00:00:00Z', updatedAt: '2026-10-18T00:00:00Z', sourceAssets: [source],
    audioOptions: { chunkMinutes: 5, overlapSeconds: 5, bitrateKbps: 32, sampleRateHz: 16000, expectedLanguages: [] },
    retainedAudio: { sourceIds: ['source'], chunkIds: [] }, preparedChunks: [], rawTranscripts: [], transcriptVersions: [], selectedTranscriptVersionId: null,
    minutesSettings: { outputLanguage: 'en', sections: ['summary'], instructions: '', modelId: '' }, minutesRuns: [], minutesRevisions: [], selectedMinutesRevisionId: null, runs: [] };
}

it('keeps retry unavailable during work and explains that cancelling preserves saved chunks', () => {
  const p = project();
  const start = vi.fn(), cancel = vi.fn();
  const c = controller(preparation(), { busy: true, projects: [p], selectedProjectId: p.id, onPrepareAudio: start, onCancelPreparation: cancel });
  const view = render(<Import controller={c} project={p} />);
  expect((screen.getByRole('button', { name: 'Prepare transcription' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/Cancelling keeps encrypted saved chunks/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel preparation' }));
  expect(cancel).toHaveBeenCalledOnce(); expect(start).not.toHaveBeenCalled();
  view.rerender(<Import controller={{ ...c, busy: false, preparation: preparation({ stage: 'failed' }) }} project={p} />);
  expect(screen.queryByRole('button', { name: 'Cancel preparation' })).toBeNull();
  expect(screen.getByText(/Decoding and compression restart from the beginning/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Prepare transcription' }));
  expect(start).toHaveBeenCalledOnce(); expect(start).toHaveBeenCalledWith(p.id);
  const partial = { ...p, retainedAudio: { sourceIds: ['source'], chunkIds: ['saved'] }, preparedChunks: [{ id: 'saved', sourceId: 'source', index: 0,
    sourceStartMs: 0, sourceEndMs: 300000, encodingOffsetMs: 0, encodedBytes: 100, mimeType: 'audio/mpeg', codec: 'mp3', audioRecordId: 'audio' }] };
  view.rerender(<Import controller={{ ...c, busy: false, preparation: null }} project={partial} />);
  expect(screen.getByText('Preparation incomplete · saved audio chunks: 1')).toBeTruthy();
  expect(screen.getByText(/Decoding and compression restart from the beginning/)).toBeTruthy();
});

it('blocks transcription for partial, wrong-source and unretained checkpoints until every planned range is saved', () => {
  const p = project(), navigate = vi.fn();
  const chunk = { id: 'saved', sourceId: 'source', index: 0, sourceStartMs: 0, sourceEndMs: 300000,
    encodingOffsetMs: 0, encodedBytes: 100, mimeType: 'audio/mpeg', codec: 'mp3', audioRecordId: 'audio' };
  const partial = { ...p, retainedAudio: { sourceIds: ['source'], chunkIds: ['saved'] }, preparedChunks: [chunk] };
  const c = controller(preparation(), { preparation: null, busy: false, onPrepareAudio: vi.fn(), onNavigate: navigate });
  const view = render(<Import controller={c} project={partial} />);
  const transcribe = () => screen.getByRole('button', { name: 'Transcribe →' }) as HTMLButtonElement;
  expect(transcribe().disabled).toBe(true);
  expect(screen.queryByText('Local audio preparation complete')).toBeNull();
  fireEvent.click(transcribe()); expect(navigate).not.toHaveBeenCalled();
  const complete = { ...partial, preparedChunks: [{ ...chunk, sourceEndMs: p.sourceAssets[0].durationMs }] };
  view.rerender(<Import controller={c} project={complete} />);
  expect(transcribe().disabled).toBe(false);
  for (const stale of [
    { ...complete, preparedChunks: [{ ...complete.preparedChunks[0], sourceId: 'other-source' }] },
    { ...complete, retainedAudio: { sourceIds: ['source'], chunkIds: [] } },
    { ...complete, preparedChunks: [{ ...complete.preparedChunks[0], encodedBytes: 0 }] },
  ]) {
    view.rerender(<Import controller={c} project={stale} />);
    expect(transcribe().disabled).toBe(true);
  }
});

it('shows a compact diagnostics trigger beside cancellation and copies only the reviewed snapshot on request', async () => {
  const secret = 'PRIVATE_DIAGNOSTIC_SENTINEL', p = project(), write = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: write } });
  const transport = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No network authorized'));
  const value = { ...preparation(), message: secret, fileName: secret, title: secret, jobId: secret, errorCode: secret };
  const c = controller(value, { busy: true, projects: [p], selectedProjectId: p.id, onCancelPreparation: vi.fn() });
  const view = render(<Import controller={c} project={p} />);
  const trigger = screen.getByRole('button', { name: 'Show preparation diagnostics' });
  expect(trigger.closest('.preparation-buttons')).toBe(screen.getByRole('button', { name: 'Cancel preparation' }).parentElement);
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByRole('button', { name: 'Copy diagnostics' })).toBeNull();
  expect(write).not.toHaveBeenCalled(); expect(transport).not.toHaveBeenCalled();
  fireEvent.click(trigger);
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  expect(screen.getByText('Diagnostics when opened')).toBeTruthy();
  const capturedAt = screen.getByLabelText('Captured at');
  expect(capturedAt.getAttribute('datetime')).toBe(new Date(now).toISOString());
  const capturedText = capturedAt.textContent;
  const preview = screen.getByLabelText('Preparation diagnostic preview').textContent!;
  expect(preview).toContain('stage: preparing'); expect(preview).toContain('elapsedMs: 60000');
  expect(preview).toContain('errorCode: unknown'); expect(preview).not.toContain(secret);
  expect(write).not.toHaveBeenCalled(); expect(transport).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(5000));
  view.rerender(<Import controller={{ ...c, preparation: { ...value, sourceProcessedMs: 65000, lastProgressAtMs: now + 5000 } }} project={p} />);
  expect(screen.getByLabelText('Preparation diagnostic preview').textContent).toBe(preview);
  expect(screen.getByLabelText('Captured at').textContent).toBe(capturedText);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy diagnostics' })); });
  expect(write).toHaveBeenCalledOnce(); expect(write).toHaveBeenCalledWith(preview);
  expect(screen.getByText('Diagnostics copied.')).toBeTruthy(); expect(transport).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByLabelText('Preparation diagnostic preview'), { key: 'Escape' });
  expect(screen.queryByRole('button', { name: 'Copy diagnostics' })).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

it('reports clipboard failure without claiming that diagnostic information was copied', async () => {
  const write = vi.fn().mockRejectedValue(new Error('PRIVATE_CLIPBOARD_ERROR'));
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: write } });
  render(<PreparationDiagnosticControl controller={controller(preparation({ stage: 'stopped' }))} />);
  fireEvent.click(screen.getByRole('button', { name: 'Show preparation diagnostics' }));
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy diagnostics' })); });
  expect(screen.getByRole('alert').textContent).toContain('Could not copy diagnostics');
  expect(screen.queryByText('Diagnostics copied.')).toBeNull(); expect(document.body.textContent).not.toContain('PRIVATE_CLIPBOARD_ERROR');
});

it('reveals the diagnostics panel in its nearest scroll area only when opened while unlocked', () => {
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView'), scroll = vi.fn();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scroll });
  try {
    const c = controller(preparation()), view = render(<PreparationDiagnosticControl controller={c} />);
    expect(scroll).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Show preparation diagnostics' }));
    expect(scroll).toHaveBeenCalledOnce(); expect(scroll).toHaveBeenCalledWith({ block: 'nearest' });
    expect(scroll.mock.contexts[0]).toBe(screen.getByRole('region', { name: 'Preparation diagnostics' }));
    view.rerender(<PreparationDiagnosticControl controller={{ ...c, preparation: { ...preparation(), sourceProcessedMs: 65000 } }} />);
    expect(scroll).toHaveBeenCalledOnce();
    view.rerender(<PreparationDiagnosticControl controller={{ ...c, screenAccess: 'locked' }} />);
    view.rerender(<PreparationDiagnosticControl controller={{ ...c, screenAccess: 'verifying' }} />);
    expect(scroll).toHaveBeenCalledOnce();
    expect(screen.queryByRole('region', { name: 'Preparation diagnostics' })).toBeNull();
  } finally {
    if (original) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', original);
    else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  }
});

it.each(['locked', 'verifying'] as const)('removes diagnostic information and prevents clipboard commands while %s', async screenAccess => {
  const write = vi.fn().mockResolvedValue(undefined), c = controller(preparation());
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: write } });
  const view = render(<><PreparationStatus controller={c} /><PreparationDiagnosticControl controller={c} /></>);
  expect(screen.getByText('Processing location: this device · no external AI requests')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Show preparation diagnostics' }));
  const oldCopy = screen.getByRole('button', { name: 'Copy diagnostics' });
  view.rerender(<><PreparationStatus controller={{ ...c, screenAccess }} /><PreparationDiagnosticControl controller={{ ...c, screenAccess }} /></>);
  expect(screen.queryByRole('region', { name: 'Local audio preparation' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Show preparation diagnostics' })).toBeNull();
  expect(screen.queryByLabelText('Preparation diagnostic preview')).toBeNull();
  await act(async () => { fireEvent.click(oldCopy); });
  expect(write).not.toHaveBeenCalled();
});
