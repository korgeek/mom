// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App, { defaultPreferences, type AppController } from '../src/react-app/App';
import type { MeetingProject } from '../src/react-app/domain/types';
afterEach(cleanup);
const project: MeetingProject = { id: 'fixture', title: 'Synthetic playback', icon: 'mic', color: '#3B82F6', pinned: false, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', sourceAssets: [{ id: 'source', fileName: 'Synthetic.wav', bytes: 4, container: 'wav', codec: 'pcm', durationMs: 10000, channels: 1, sampleRateHz: 16000 }], audioOptions: { chunkMinutes: 10, overlapSeconds: 10, expectedLanguages: ['en'], bitrateKbps: 32, sampleRateHz: 16000 },
  preparedChunks: [{ id: 'chunk', sourceId: 'source', index: 0, sourceStartMs: 0, sourceEndMs: 10000, encodingOffsetMs: 125, encodedBytes: 4, mimeType: 'audio/wav', codec: 'pcm', audioRecordId: 'audio' }], retainedAudio: { sourceIds: ['source'], chunkIds: ['chunk'] }, rawTranscripts: [], transcriptVersions: [], selectedTranscriptVersionId: null, minutesSettings: { outputLanguage: 'en', sections: ['summary'], instructions: '', modelId: '' }, minutesRuns: [], minutesRevisions: [], selectedMinutesRevisionId: null, runs: [] };
function controller(extra: Partial<AppController> = {}): AppController { return { session: 'unlocked', projects: [project], selectedProjectId: project.id, screen: 'stt', settingsTab: 'connections', preferences: { ...defaultPreferences, uiLanguage: 'en' }, defaultAudioOptions: project.audioOptions, modelCatalog: [], sttModelId: '', connections: [], storageEstimate: null, ...extra }; }
it('hides idle playback status visually while preserving stopped announcements and missing audio warnings', () => {
  const retained = { ...project, retainedAudio: { sourceIds: ['source'], chunkIds: ['chunk'] } };
  const c = controller({ projects: [retained], onPlayChunk: vi.fn(), onStopPlayback: vi.fn() });
  const view = render(<App controller={c} />);
  const status = screen.getByRole('status', { name: 'Chunk 1 playback' });
  expect(status.classList.contains('visually-hidden')).toBe(true);
  expect(status.textContent).toBe('Stopped');
  view.rerender(<App controller={{ ...c, playback: { projectId: 'fixture', chunkId: 'chunk', kind: 'chunk', state: 'playing' } }} />);
  expect(status.classList.contains('visually-hidden')).toBe(false); expect(status.textContent).toBe('Playing');
  view.rerender(<App controller={{ ...c, playback: null }} />);
  expect(status.classList.contains('visually-hidden')).toBe(true); expect(status.textContent).toBe('Stopped');
  view.rerender(<App controller={{ ...c, projects: [{ ...retained, retainedAudio: { sourceIds: ['source'], chunkIds: [] } }] }} />);
  expect(status.classList.contains('visually-hidden')).toBe(false); expect(status.textContent).toBe('Audio deleted');
});
it('offers keyboard accessible stateful chunk controls, keeps focus and allows Stop while busy/loading', async () => {
  const user = userEvent.setup(), play = vi.fn(), pause = vi.fn(), resume = vi.fn(), stop = vi.fn();
  const c = controller({ projects: [{ ...project, retainedAudio: { sourceIds: ['source'], chunkIds: ['chunk'] } }], onPlayChunk: play, onPauseChunk: pause, onResumeChunk: resume, onStopPlayback: stop });
  const { rerender } = render(<App controller={c} />);
  const button = screen.getByRole('button', { name: 'Play chunk 1' }); button.focus(); await user.keyboard('{Enter}'); expect(play).toHaveBeenCalledWith('fixture', 'chunk');
  rerender(<App controller={{ ...c, busy: true, playback: { projectId: 'fixture', chunkId: 'chunk', kind: 'chunk', state: 'loading' } }} />);
  expect(screen.getByRole('status', { name: 'Chunk 1 playback' }).textContent).toBe('Loading');
  // Disabling a focused native button loses focus in Chrome. Keep it focusable,
  // expose aria-disabled and ignore repeated activation while loading.
  expect((button as HTMLButtonElement).disabled).toBe(false); expect(button.getAttribute('aria-disabled')).toBe('true');
  await user.keyboard('{Enter}'); expect(play).toHaveBeenCalledTimes(1);
  expect((screen.getByRole('button', { name: 'Stop chunk 1' }) as HTMLButtonElement).disabled).toBe(false);
  rerender(<App controller={{ ...c, playback: { projectId: 'fixture', chunkId: 'chunk', kind: 'chunk', state: 'playing' } }} />);
  const pausing = screen.getByRole('button', { name: 'Pause chunk 1' }); expect(document.activeElement).toBe(pausing); expect(pausing.getAttribute('aria-pressed')).toBe('true');
  await user.keyboard(' '); expect(pause).toHaveBeenCalledWith('fixture', 'chunk');
  rerender(<App controller={{ ...c, playback: { projectId: 'fixture', chunkId: 'chunk', kind: 'chunk', state: 'paused' } }} />);
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Resume chunk 1' })); await user.keyboard('{Enter}'); expect(resume).toHaveBeenCalledWith('fixture', 'chunk');
  await user.click(screen.getByRole('button', { name: 'Stop chunk 1' })); expect(stop).toHaveBeenCalledTimes(1);
  rerender(<App controller={{ ...c, playback: { projectId: 'fixture', chunkId: 'chunk', kind: 'chunk', state: 'error' } }} />);
  expect(screen.getByRole('status', { name: 'Chunk 1 playback' }).textContent).toMatch(/Playback failed/); expect(screen.getByRole('button', { name: 'Play chunk 1' })).toBeTruthy();
});
it('coordinates the native source preview on play and clears it on screen unmount', () => {
  const source = vi.fn(), stopped = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {}), unloaded = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  const c = controller({ screen: 'import', sourcePreviewUrl: 'blob:synthetic', onSourcePreviewPlay: source }); const { rerender } = render(<App controller={c} />);
  const audio = screen.getByLabelText('Source audio preview'); fireEvent.play(audio); expect(source).toHaveBeenCalledWith(audio);
  rerender(<App controller={{ ...c, screen: 'stt' }} />); expect(stopped).toHaveBeenCalled(); expect(audio.getAttribute('src')).toBeNull(); stopped.mockRestore(); unloaded.mockRestore();
});
it('preserves a new source URL when replacing a mounted native preview', () => {
  const stopped = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {}), unloaded = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  const c = controller({ screen: 'import', sourcePreviewUrl: 'blob:old' }), { rerender } = render(<App controller={c} />);
  rerender(<App controller={{ ...c, sourcePreviewUrl: 'blob:new' }} />);
  expect(screen.getByLabelText('Source audio preview').getAttribute('src')).toBe('blob:new');
  cleanup(); stopped.mockRestore(); unloaded.mockRestore();
});
