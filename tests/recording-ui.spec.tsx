// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RecordingControls, { type RecordingControlsProps } from '../src/react-app/ui/RecordingControls';
import type { RecordingSnapshot } from '../src/react-app/recording/recorder';

// Shared copy imports preparation helpers; this widget never invokes a codec or Worker.
vi.mock('../src/react-app/media/prepare', () => ({ planChunkRanges: () => { throw new Error('Unexpected preparation from recording widget'); } }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const snapshot = (patch: Partial<RecordingSnapshot> = {}): RecordingSnapshot => Object.freeze({
  state: 'idle', sampleRateHz: null, acceptedSamples: 0, committedSamples: 0,
  bodyBytes: 0, committedBytes: 0, durationMs: 0, inputLevel: 0, source: null, error: null, ...patch,
});
function props(patch: Partial<RecordingControlsProps> = {}): RecordingControlsProps {
  return { snapshot: snapshot(), language: 'en', supported: true, startBlockedReason: null, pendingAction: null,
    onStart: vi.fn(), onPause: vi.fn(), onResume: vi.fn(), onStop: vi.fn(), onAbort: vi.fn(), ...patch };
}
const disabled = (name: string) => (screen.getByRole('button', { name }) as HTMLButtonElement).disabled;
const capturing = snapshot({ state: 'recording', sampleRateHz: 16000, acceptedSamples: 1058000, committedSamples: 16000, bodyBytes: 2116000, committedBytes: 32000, durationMs: 66125 });
const savedSource = Object.freeze({ id: 'SYNTHETIC_RECORDING_SOURCE', fileName: 'SYNTHETIC_MIC.wav', bytes: 2116044, container: 'wav', codec: 'pcm_s16le', durationMs: 66125, channels: 1, sampleRateHz: 16000 });

it('requests microphone capture only through explicit keyboard Start after the microphone disclosure', async () => {
  const fetch = vi.fn(), media = vi.fn(); vi.stubGlobal('fetch', fetch); vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: media } });
  const p = props(), user = userEvent.setup(); render(<RecordingControls {...p} />);
  expect(screen.getByRole('heading', { name: 'Microphone recording' })).toBeTruthy();
  expect(screen.getByText(/microphone only/i)).toBeTruthy();
  expect(screen.getByText(/Start requests microphone permission/i)).toBeTruthy();
  expect(p.onStart).not.toHaveBeenCalled(); expect(media).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  await user.tab(); expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Start recording' })); await user.keyboard('{Enter}');
  expect(p.onStart).toHaveBeenCalledOnce(); expect(media).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  expect(screen.queryByRole('textbox')).toBeNull(); expect(screen.queryByRole('combobox')).toBeNull();
});
it('retains the disabled Start node during permission while keeping a separate earlier Cancel action available', async () => {
  const p = props(), user = userEvent.setup(), view = render(<RecordingControls {...p} />);
  const start = screen.getByRole('button', { name: 'Start recording' });
  view.rerender(<RecordingControls {...p} snapshot={snapshot({ state: 'permission' })} pendingAction="start" />);
  expect(screen.getByRole('status').textContent).toContain('Waiting for microphone permission');
  expect(screen.getByRole('button', { name: 'Start recording' })).toBe(start); expect(disabled('Start recording')).toBe(true);
  const cancel = screen.getByRole('button', { name: 'Cancel recording' });
  expect(cancel).not.toBe(start); expect(start.parentElement!.lastElementChild).toBe(start);
  expect(cancel.compareDocumentPosition(start) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(disabled('Cancel recording')).toBe(false); expect(screen.queryByRole('button', { name: 'Save and stop' })).toBeNull();
  await user.click(start); expect(p.onStart).not.toHaveBeenCalled();
  await user.click(cancel); expect(p.onAbort).toHaveBeenCalledOnce();
  expect(p.onStart).not.toHaveBeenCalled(); expect(p.onStop).not.toHaveBeenCalled();
});
it('puts status and recording actions before sample-clock duration, captured bytes and encrypted committed bytes', () => {
  const p = props({ snapshot: capturing }), view = render(<RecordingControls {...p} />);
  const status = screen.getByRole('status'), stop = screen.getByRole('button', { name: 'Save and stop' });
  const cancel = screen.getByRole('button', { name: 'Cancel recording' });
  expect(status.compareDocumentPosition(stop) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(stop.compareDocumentPosition(screen.getByLabelText('Recorded duration')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(cancel.compareDocumentPosition(screen.getByRole('meter', { name: 'Input level' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByLabelText('Recorded duration').textContent).toBe('00:01:06');
  expect(screen.getByLabelText('Captured audio').textContent).toBe('2.02 MB');
  expect(screen.getByLabelText('Encrypted saved audio').textContent).toBe('0.03 MB');
  view.rerender(<RecordingControls {...p} snapshot={{ ...capturing, state: 'paused' }} />);
  expect(screen.getByLabelText('Recorded duration').textContent).toBe('00:01:06');
  expect(screen.queryByText('Recording saved')).toBeNull();
});
it('discloses retained microphone tracks while paused and dispatches only the explicit Resume or stop actions', async () => {
  const p = props({ snapshot: { ...capturing, state: 'paused' } }), user = userEvent.setup(); render(<RecordingControls {...p} />);
  expect(screen.getByText(/paused.*microphone.*still.*active/i)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Resume' })); expect(p.onResume).toHaveBeenCalledOnce(); expect(p.onPause).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Save and stop' })); expect(p.onStop).toHaveBeenCalledOnce();
});
it('shows the supplied live level, clears it while paused and preserves hours and two-decimal MB after save', () => {
  const p = props({ snapshot: { ...capturing, inputLevel: .5, durationMs: 3661125 } });
  const view = render(<RecordingControls {...p} />);
  expect(screen.getByLabelText('Recorded duration').textContent).toBe('01:01:01');
  expect(Number(screen.getByRole('meter', { name: 'Input level' }).getAttribute('aria-valuenow'))).toBeGreaterThan(0);
  view.rerender(<RecordingControls {...p} snapshot={{ ...p.snapshot, state: 'paused' }} />);
  expect(screen.getByRole('meter', { name: 'Input level' }).getAttribute('aria-valuenow')).toBe('0');
  view.rerender(<RecordingControls {...p} snapshot={{ ...p.snapshot, state: 'saved', source: { ...savedSource, bytes: 1048576 } }} />);
  expect(screen.getByLabelText('Captured audio').textContent).toBe('1.00 MB');
  expect(screen.getByRole('meter', { name: 'Input level' }).getAttribute('aria-valuenow')).toBe('0');
});
it('requests Pause explicitly without inventing the paused or stopped microphone state', async () => {
  const p = props({ snapshot: capturing }), user = userEvent.setup(); render(<RecordingControls {...p} />);
  await user.click(screen.getByRole('button', { name: 'Pause' })); expect(p.onPause).toHaveBeenCalledOnce(); expect(p.onResume).not.toHaveBeenCalled();
  expect(screen.getByRole('status').textContent).toBe('Recording'); expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull();
});
it('blocks duplicate pause/resume dispatch while its acknowledgment is pending but keeps stop and abort available', async () => {
  const p = props({ snapshot: capturing, pendingAction: 'pause' }), view = render(<RecordingControls {...p} />), user = userEvent.setup();
  expect(disabled('Pause')).toBe(true); await user.click(screen.getByRole('button', { name: 'Pause' })); expect(p.onPause).not.toHaveBeenCalled();
  expect(disabled('Save and stop')).toBe(false); expect(disabled('Cancel recording')).toBe(false);
  view.rerender(<RecordingControls {...p} snapshot={{ ...capturing, state: 'paused' }} pendingAction="resume" />);
  expect(disabled('Resume')).toBe(true); await user.click(screen.getByRole('button', { name: 'Resume' })); expect(p.onResume).not.toHaveBeenCalled();
});
it('never claims Saved on Stop or while encrypted finalization is pending', async () => {
  const p = props({ snapshot: capturing }), view = render(<RecordingControls {...p} />), user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Save and stop' })); expect(p.onStop).toHaveBeenCalledOnce();
  expect(screen.getByRole('status').textContent).toBe('Recording'); expect(screen.queryByText('Recording saved')).toBeNull();
  view.rerender(<RecordingControls {...p} snapshot={{ ...capturing, state: 'saving' }} pendingAction="stop" />);
  expect(screen.getByRole('status').textContent).toBe('Saving encrypted recording…');
  expect(screen.queryByRole('button', { name: 'Save and stop' })).toBeNull(); expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
  expect(disabled('Cancel recording')).toBe(false); await user.click(screen.getByRole('button', { name: 'Cancel recording' })); expect(p.onAbort).toHaveBeenCalledOnce();
  expect(screen.queryByText('Recording saved')).toBeNull();
});
it('confirms Saved only from a saved snapshot with its actual finalized source', () => {
  const p = props({ snapshot: { ...capturing, state: 'saved' } }), view = render(<RecordingControls {...p} />);
  expect(screen.queryByText('Recording saved')).toBeNull(); expect(screen.getByRole('alert')).toBeTruthy();
  view.rerender(<RecordingControls {...p} snapshot={{ ...capturing, state: 'saved', committedSamples: capturing.acceptedSamples, committedBytes: capturing.bodyBytes, source: savedSource }} />);
  expect(screen.getByRole('status').textContent).toBe('Recording saved'); expect(screen.getByText(savedSource.fileName)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Start recording' })).toBeNull(); expect(screen.queryByRole('button', { name: 'Cancel recording' })).toBeNull();
});
it.each(['project-not-empty', 'busy', 'interrupted-draft'] as const)('blocks Start for %s without silently replacing existing project data', async reason => {
  const p = props({ startBlockedReason: reason }), user = userEvent.setup(); render(<RecordingControls {...p} />);
  expect(disabled('Start recording')).toBe(true); expect(screen.getByRole('status').textContent).not.toBe('Ready to record');
  await user.click(screen.getByRole('button', { name: 'Start recording' })); expect(p.onStart).not.toHaveBeenCalled();
});
it('blocks unsupported capture with an actionable local browser explanation', async () => {
  const p = props({ supported: false }), user = userEvent.setup(); render(<RecordingControls {...p} />);
  expect(disabled('Start recording')).toBe(true); expect(screen.getByRole('alert').textContent).toMatch(/supported browser.*HTTPS/i);
  expect(screen.getByRole('status').textContent).not.toBe('Ready to record');
  await user.click(screen.getByRole('button', { name: 'Start recording' })); expect(p.onStart).not.toHaveBeenCalled();
});
it.each(['permission', 'storage', 'backpressure', 'capture-ended', 'size-limit', 'sample-rate', 'invalid-pcm', 'empty', 'busy', 'unsupported'] as const)('keeps failure %s actionable without a false saved source or implicit restart', async error => {
  const p = props({ snapshot: { ...capturing, state: 'error', error } }), user = userEvent.setup(); render(<RecordingControls {...p} />);
  expect(screen.getByRole('alert').textContent!.length).toBeGreaterThan(20); expect(screen.queryByText('Recording saved')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull(); expect(screen.queryByRole('button', { name: 'Start recording' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Cancel recording' })); expect(p.onAbort).toHaveBeenCalledOnce(); expect(p.onStart).not.toHaveBeenCalled();
});
it('keeps interrupted committed audio distinct from a finalized source and does not invent a resumed clock', () => {
  const p = props({ startBlockedReason: 'interrupted-draft', interruptedCommittedBytes: 32000 }); render(<RecordingControls {...p} />);
  expect(screen.getByText(/interrupted.*encrypted.*not.*complete.*source/i)).toBeTruthy();
  expect(screen.getByLabelText('Interrupted encrypted audio').textContent).toBe('31.3 KB');
  expect(screen.queryByLabelText('Recorded duration')).toBeNull(); expect(screen.getByText('No recording is running.')).toBeTruthy(); expect(screen.queryByText('Recording saved')).toBeNull();
  expect(disabled('Start recording')).toBe(true);
});
it('keeps cancellation pending fenced and displays terminal cancellation only from the controlled snapshot', async () => {
  const p = props({ snapshot: capturing, pendingAction: 'abort' }), view = render(<RecordingControls {...p} />), user = userEvent.setup();
  expect(disabled('Cancel recording')).toBe(true); expect(disabled('Save and stop')).toBe(true); expect(disabled('Pause')).toBe(true);
  await user.click(screen.getByRole('button', { name: 'Cancel recording' })); expect(p.onAbort).not.toHaveBeenCalled();
  expect(screen.getByRole('status').textContent).toBe('Recording');
  view.rerender(<RecordingControls {...p} snapshot={{ ...capturing, state: 'aborted' }} pendingAction={null} startBlockedReason="interrupted-draft" />);
  expect(screen.getByRole('status').textContent).toBe('Recording cancelled'); expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull();
  expect(screen.getByText(/encrypted.*not.*complete.*source/i)).toBeTruthy(); expect(disabled('Start recording')).toBe(true);
});
