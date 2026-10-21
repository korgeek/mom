// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import SourcePreview from '../src/react-app/ui/components/SourcePreview';
import App, { defaultPreferences, type AppController } from '../src/react-app/App';
import type { MeetingProject } from '../src/react-app/domain/types';
beforeEach(() => { vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {}); vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {}); vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('shows actual overview peaks, seeks using the accessible native range, and displays media time', () => {
  const audioRef = createRef<HTMLAudioElement>(), onPlay = vi.fn();
  const view = render(<SourcePreview audioRef={audioRef} url="blob:SYNTHETIC" peaks={[0, .25, .5, 1]} durationMs={10000} language="en" onPlay={onPlay} />);
  const audio = audioRef.current!, slider = screen.getByRole('slider', { name: 'Source audio position' });
  expect(view.container.querySelector('svg path')?.getAttribute('d')).toContain('M3.5,2v56');
  Object.defineProperty(audio, 'duration', { value: 8.5 }); fireEvent.loadedMetadata(audio);
  fireEvent.change(slider, { target: { value: '3.4' } }); expect(audio.currentTime).toBe(3.4);
  expect(screen.getByLabelText('Playback time').textContent).toBe('00:03 / 00:08');
  expect(slider.getAttribute('aria-valuetext')).toBe('00:03 / 00:08');
  fireEvent.click(screen.getByRole('button', { name: 'Play source audio' })); expect(audio.play).toHaveBeenCalledOnce();
  fireEvent.play(audio); expect(onPlay).toHaveBeenCalledWith(audio);
  audio.currentTime = 6; fireEvent.timeUpdate(audio); expect((slider as HTMLInputElement).value).toBe('6');
  view.unmount(); expect(audio.pause).toHaveBeenCalled(); expect(audio.getAttribute('src')).toBeNull();
});
it('does not manufacture peaks or permit seeking when original playback is unavailable', () => {
  const view = render(<SourcePreview audioRef={createRef()} url={null} peaks={null} durationMs={10000} language="en" loading />);
  expect(view.container.querySelector('svg')).toBeNull(); expect((screen.getByRole('slider') as HTMLInputElement).disabled).toBe(true);
  expect(screen.getByText('Opening audio and waveform…')).toBeTruthy();
});
it('loads a retained source once per identity and releases it on deletion or navigation', () => {
  const source = { id: 'source', fileName: 'SYNTHETIC.wav', bytes: 32044, container: 'wav', codec: 'pcm_s16le', durationMs: 1000, channels: 1, sampleRateHz: 16000 } as const;
  const project: MeetingProject = { id: 'memo', title: 'Synthetic', icon: 'mic', color: '#3B82F6', pinned: false, createdAt: '', updatedAt: '', sourceAssets: [source], retainedAudio: { sourceIds: ['source'], chunkIds: [] }, audioOptions: { chunkMinutes: 10, overlapSeconds: 10, expectedLanguages: ['en'], bitrateKbps: 32, sampleRateHz: 16000 }, preparedChunks: [], rawTranscripts: [], transcriptVersions: [], selectedTranscriptVersionId: null, minutesSettings: { outputLanguage: 'en', sections: ['summary'], instructions: '', modelId: '' }, minutesRuns: [], minutesRevisions: [], selectedMinutesRevisionId: null, runs: [] };
  const load = vi.fn(), release = vi.fn();
  const c: AppController = { session: 'unlocked', projects: [project], selectedProjectId: project.id, screen: 'import', settingsTab: 'connections', preferences: { ...defaultPreferences, uiLanguage: 'en' }, defaultAudioOptions: project.audioOptions, modelCatalog: [], sttModelId: '', connections: [], storageEstimate: null, onLoadSourcePreview: load, onReleaseSourcePreview: release };
  const view = render(<App controller={c} />); expect(load).toHaveBeenCalledExactlyOnceWith('memo');
  view.rerender(<App controller={{ ...c, onLoadSourcePreview: id => load(id), onReleaseSourcePreview: id => release(id), sourcePreviewLoading: true }} />);
  expect(load).toHaveBeenCalledOnce();
  view.rerender(<App controller={{ ...c, projects: [{ ...project, retainedAudio: { sourceIds: [], chunkIds: [] } }] }} />);
  expect(release).toHaveBeenCalledWith('memo'); expect(screen.queryByRole('slider')).toBeNull(); expect(load).toHaveBeenCalledOnce();
});
