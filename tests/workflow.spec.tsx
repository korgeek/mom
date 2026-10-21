// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App, { defaultPreferences, type AppController } from '../src/react-app/App';
import type { MeetingProject } from '../src/react-app/domain/types';
import { sttActionToken } from '../src/react-app/transcript/batches';

// UI descriptor fixtures never invoke audio codecs or workers.
vi.mock('../src/react-app/media/prepare', () => ({ planChunkRanges: (durationMs: number) => [{ sourceStartMs: 0, sourceEndMs: durationMs }] }));
beforeAll(() => { HTMLDialogElement.prototype.showModal = function () { this.open = true; }; HTMLDialogElement.prototype.close = function () { this.open = false; }; });
afterEach(cleanup);
const project: MeetingProject = {
  id: 'synthetic-workflow', title: 'Synthetic workflow', icon: 'mic', color: '#3B82F6', pinned: false,
  createdAt: '2026-10-02T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z',
  sourceAssets: [{ id: 'synthetic-source', fileName: 'synthetic.wav', bytes: 32044, container: 'wav', codec: 'pcm', durationMs: 1000, channels: 1, sampleRateHz: 16000 }],
  audioOptions: { chunkMinutes: 5, overlapSeconds: 5, expectedLanguages: ['ko', 'en'], bitrateKbps: 32, sampleRateHz: 16000 },
  retainedAudio: { sourceIds: ['synthetic-source'], chunkIds: ['synthetic-chunk'] },
  preparedChunks: [], rawTranscripts: [], transcriptVersions: [], selectedTranscriptVersionId: null,
  minutesSettings: { outputLanguage: 'en', sections: ['summary'], instructions: '', modelId: '' },
  minutesRuns: [], minutesRevisions: [], selectedMinutesRevisionId: null, runs: [],
};
const chunk = { id: 'synthetic-chunk', sourceId: 'synthetic-source', index: 0, sourceStartMs: 0, sourceEndMs: 1000, encodingOffsetMs: 0, encodedBytes: 1200, mimeType: 'audio/mpeg', codec: 'mp3', audioRecordId: 'encrypted-audio' };
function controller(extra: Partial<AppController> = {}): AppController {
  return { session: 'unlocked', projects: [project], selectedProjectId: project.id, screen: 'import', settingsTab: 'connections',
    preferences: { ...defaultPreferences, uiLanguage: 'en' }, defaultAudioOptions: project.audioOptions,
    modelCatalog: [{ id: 'fixture-stt', label: 'Fixture STT', provider: 'openai', kind: 'stt', enabled: true }], sttModelId: 'fixture-stt', connections: [], storageEstimate: null, ...extra };
}
describe('three-stage user workflow', () => {
  it('offers local preparation without provider selection or transmission consent', async () => {
    const user = userEvent.setup(), onPrepareAudio = vi.fn(), onStartSTT = vi.fn();
    render(<App controller={controller({ onPrepareAudio, onStartSTT })} />);
    expect(screen.queryByRole('combobox', { name: 'Transcription model' })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: "I've reviewed the above" })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Prepare transcription' }));
    expect(onPrepareAudio).toHaveBeenCalledWith(project.id); expect(onStartSTT).not.toHaveBeenCalled();
  });
  it('keeps STT paid consent visible and tied to complete prepared audio and the selected model', async () => {
    const user = userEvent.setup(), onStartSTT = vi.fn();
    const c = controller({ screen: 'stt', projects: [{ ...project, preparedChunks: [chunk] }], onStartSTT });
    const { rerender } = render(<App controller={c} />);
    expect(screen.getByText(/api.openai.com\/v1\/audio\/transcriptions/)).toBeTruthy();
    const start = screen.getByRole('button', { name: 'Transcribe' }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    await user.click(screen.getByRole('checkbox', { name: "I've reviewed the above" }));
    expect(start.disabled).toBe(false); await user.click(start);
    expect(onStartSTT).toHaveBeenCalledWith(project.id, { modelId: 'fixture-stt', acknowledged: true, consentToken: sttActionToken(c.sttConsentToken, c.projects[0], { purpose: 'initial', chunkIds: [chunk.id], modelId: 'fixture-stt' }) });
    rerender(<App controller={{ ...c, projects: [project] }} />);
    expect((screen.getByRole('button', { name: 'Transcribe' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('keeps selected and raw transcript results inside STT and reaches minutes without a review stage', async () => {
    const user = userEvent.setup(), onNavigate = vi.fn();
    const segment = { id: 'segment', text: 'Selected synthetic speech', sourceStartMs: 0, sourceEndMs: 1000, rawIds: ['raw'] };
    const result: MeetingProject = { ...project, preparedChunks: [chunk],
      rawTranscripts: [{ id: 'raw', chunkId: chunk.id, runId: 'run', text: 'Raw synthetic speech', response: { text: 'Raw synthetic speech' }, segments: [segment], timing: 'chunk', speakerScope: 'none', execution: null }],
      transcriptVersions: [{ id: 'version', parentId: null, rawIds: ['raw'], segments: [segment], issues: [], missingRanges: [] }], selectedTranscriptVersionId: 'version' };
    render(<App controller={controller({ screen: 'review', projects: [result], onNavigate })} />);
    expect(screen.getByText(segment.text)).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Transcript version' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Raw by chunk' }));
    expect(screen.getByText('Raw synthetic speech')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Organize memo from this transcript' }));
    expect(onNavigate).toHaveBeenCalledWith('minutes', project.id);
  });
});
