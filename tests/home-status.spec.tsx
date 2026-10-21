// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { defaultPreferences, type AppController } from '../src/react-app/App';
import Home from '../src/react-app/ui/screens/Home';
import type { MeetingProject, RunRecord, RunState } from '../src/react-app/domain/types';

afterEach(cleanup);

const pinPath = 'M9 4h6l-1 6 3 3H7l3-3z M12 13v7';
const unpinPath = `${pinPath} M4 4l16 16`;
function meeting(patch: Partial<MeetingProject> = {}): MeetingProject {
  return { id: 'synthetic-home', title: 'SYNTHETIC_HOME', icon: 'mic', color: '#3B82F6', pinned: false,
    createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', sourceAssets: [],
    audioOptions: { chunkMinutes: 10, overlapSeconds: 10, expectedLanguages: ['ko', 'en'], bitrateKbps: 32, sampleRateHz: 16000 },
    preparedChunks: [], rawTranscripts: [], transcriptVersions: [], selectedTranscriptVersionId: null,
    minutesSettings: { outputLanguage: 'ko', sections: ['summary'], instructions: '', modelId: '' },
    minutesRuns: [], minutesRevisions: [], selectedMinutesRevisionId: null, runs: [], ...patch };
}
function run(id: string, state: RunState, chunkId: string | null = null): RunRecord {
  return { id, projectId: 'synthetic-home', state, checkpoint: null,
    intent: { kind: chunkId ? 'stt' : 'minutes', chunkId, requestedModel: 'fixture/model', expectedLanguages: ['ko'], requestedEndpoint: null, rateSnapshot: null } };
}
function savedSTT(id: string, chunkId: string): RunRecord {
  return { ...run(id, 'saved', chunkId), checkpoint: { id: 'synthetic-checkpoint', projectId: 'synthetic-home', runId: id, recordIds: ['synthetic-home'], committedAt: '2026-10-01T00:00:00.000Z' } };
}
function ready(patch: Partial<MeetingProject> = {}) {
  return meeting({ minutesRevisions: [{ id: 'saved-revision', runId: 'saved-run', parentId: null, markdown: '# SYNTHETIC_SAVED_MINUTES' }],
    selectedMinutesRevisionId: 'saved-revision', runs: [run('saved-run', 'saved')], ...patch });
}
function controller(projects: readonly MeetingProject[], patch: Partial<AppController> = {}): AppController {
  return { session: 'unlocked', projects, selectedProjectId: null, screen: 'home', settingsTab: 'connections',
    preferences: { ...defaultPreferences, uiLanguage: 'en' }, defaultAudioOptions: meeting().audioOptions,
    modelCatalog: null, sttModelId: '', connections: [], storageEstimate: null, ...patch };
}
const row = (title = 'SYNTHETIC_HOME') => screen.getByText(title, { selector: 'strong' }).closest('.meeting-row') as HTMLElement;
const badge = (title = 'SYNTHETIC_HOME') => row(title).querySelector('.badge')!;

describe('Home primary status and retained attempts', () => {
  it.each(['failed', 'outcome-unknown'] as const)('uses the same completed badge for a selected saved result with %s history', state => {
    const ordinary = ready({ id: 'ordinary', title: 'SYNTHETIC_ORDINARY' });
    const historical = ready({ runs: [run('earlier-attempt', state), run('saved-run', 'saved')] });
    const before = structuredClone(historical);
    const onUpdateMeeting = vi.fn();
    render(<Home controller={controller([ordinary, historical], { onUpdateMeeting })} />);
    expect(badge().textContent).toBe('Notes ready');
    expect(badge().className).toBe(badge('SYNTHETIC_ORDINARY').className);
    expect(badge().classList.contains('done')).toBe(true);
    expect(within(row()).getByText(state === 'failed'
      ? 'Failed attempts are retained in this voice memo.'
      : 'An earlier request has an unknown outcome and may have incurred a charge.')).toBeTruthy();
    expect(historical).toEqual(before);
    expect(onUpdateMeeting).not.toHaveBeenCalled();
  });
  it('shows both history notes without changing saved chunks, raw transcripts or revisions', () => {
    const p = ready({ runs: [run('failed', 'failed'), run('unknown', 'outcome-unknown'), run('saved', 'saved'), savedSTT('stt-run', 'chunk')],
      preparedChunks: [{ id: 'chunk', sourceId: 'source', index: 0, sourceStartMs: 0, sourceEndMs: 1000, encodingOffsetMs: 0, encodedBytes: 100, mimeType: 'audio/mpeg', codec: 'mp3', audioRecordId: 'audio' }],
      rawTranscripts: [{ id: 'raw', chunkId: 'chunk', runId: 'stt-run', response: { text: 'SYNTHETIC_RAW' }, text: 'SYNTHETIC_RAW', segments: [], timing: 'chunk', speakerScope: 'none', execution: null }] });
    const before = structuredClone(p);
    render(<Home controller={controller([p])} />);
    expect(badge().classList.contains('done')).toBe(true);
    expect(within(row()).getByText('Failed attempts are retained in this voice memo.')).toBeTruthy();
    expect(within(row()).getByText(/unknown outcome.*charge/)).toBeTruthy();
    expect(within(row()).getByText('1 / 1 chunks saved')).toBeTruthy();
    expect(p).toEqual(before);
  });
  it.each(['requesting', 'response-received', 'saving'] as const)('keeps saved notes ready while separately showing a %s request', state => {
    render(<Home controller={controller([ready({ runs: [run('saved', 'saved'), run('current', state)] })])} />);
    expect(badge().textContent).toBe('Notes ready');
    expect(badge().classList.contains('done')).toBe(true);
    expect(within(row()).getByText('Another request is processing; saved notes remain available.')).toBeTruthy();
  });
  it.each(['failed', 'outcome-unknown'] as const)('keeps unresolved %s work distinct when no saved result is selected', state => {
    render(<Home controller={controller([meeting({ runs: [run('current', state)] })])} />);
    expect(badge().textContent).toBe('Partly failed · needs review');
    expect(badge().classList.contains('failed')).toBe(true);
  });
  it('shows active processing ahead of an old failed request when no saved result exists', () => {
    render(<Home controller={controller([meeting({ runs: [run('earlier', 'failed'), run('current', 'requesting')] })])} />);
    expect(badge().textContent).toBe('Processing');
    expect(badge().classList.contains('running')).toBe(true);
    expect(within(row()).getByText('Failed attempts are retained in this voice memo.')).toBeTruthy();
  });
  it('does not turn a successful retry into a current failure', () => {
    const transcript = { id: 'transcript', parentId: null, rawIds: [], segments: [], issues: [], missingRanges: [] };
    render(<Home controller={controller([meeting({ transcriptVersions: [transcript], selectedTranscriptVersionId: transcript.id,
      runs: [run('earlier', 'failed', 'chunk'), savedSTT('retried', 'chunk')],
      rawTranscripts: [{ id: 'retry-raw', chunkId: 'chunk', runId: 'retried', response: { text: 'SYNTHETIC_RETRY' }, text: 'SYNTHETIC_RETRY', segments: [], timing: 'chunk', speakerScope: 'none', execution: null }] })])} />);
    expect(badge().textContent).toBe('Reviewing transcript');
    expect(badge().classList.contains('idle')).toBe(true);
    expect(within(row()).getByText('Failed attempts are retained in this voice memo.')).toBeTruthy();
  });
  it('keeps an unresolved different chunk visible after another chunk succeeds', () => {
    render(<Home controller={controller([meeting({ runs: [run('missing', 'failed', 'chunk-1'), run('saved', 'saved', 'chunk-2')] })])} />);
    expect(badge().textContent).toBe('Partly failed · needs review');
    expect(badge().classList.contains('failed')).toBe(true);
  });
  it('keeps an ambiguous legacy failure visible even when a later run says saved', () => {
    render(<Home controller={controller([meeting({ runs: [{ id: 'legacy', projectId: 'synthetic-home', state: 'failed', checkpoint: null }, run('later', 'saved')] })])} />);
    expect(badge().textContent).toBe('Partly failed · needs review');
  });
  it('requires a linked saved raw result before considering an STT failure historical', () => {
    render(<Home controller={controller([meeting({ runs: [run('earlier', 'failed', 'chunk'), run('later', 'saved', 'chunk')] })])} />);
    expect(badge().textContent).toBe('Partly failed · needs review');
  });
  it('keeps a chunk failure unresolved without a matching encrypted save receipt', () => {
    render(<Home controller={controller([meeting({ runs: [run('earlier', 'failed', 'chunk'), run('later', 'saved', 'chunk')],
      rawTranscripts: [{ id: 'raw', chunkId: 'chunk', runId: 'later', response: {}, text: 'SYNTHETIC_UNRECEIPTED', segments: [], timing: 'chunk', speakerScope: 'none', execution: null }] })])} />);
    expect(badge().textContent).toBe('Partly failed · needs review');
  });
  it('does not infer that a later text request resolved an earlier text failure', () => {
    render(<Home controller={controller([meeting({ runs: [run('earlier', 'failed'), run('later', 'saved')] })])} />);
    expect(badge().textContent).toBe('Partly failed · needs review');
  });
  it('requires a valid selected revision before claiming notes are ready', () => {
    render(<Home controller={controller([ready({ selectedMinutesRevisionId: 'missing', runs: [] })])} />);
    expect(badge().textContent).toBe('Awaiting setup');
    expect(badge().classList.contains('idle')).toBe(true);
  });
  it('renders the separate unknown-outcome disclosure in Korean', () => {
    render(<Home controller={controller([ready({ runs: [run('earlier', 'outcome-unknown')] })], { preferences: defaultPreferences })} />);
    expect(badge().textContent).toBe('정리 노트 완료');
    expect(badge().classList.contains('done')).toBe(true);
    expect(within(row()).getByText('이전 요청의 결과를 알 수 없으며 요금이 발생했을 수 있어요.')).toBeTruthy();
  });
});

describe('Home reference pin toggle', () => {
  it('uses the exact distinct action vectors and colors with a real accessible keyboard toggle', async () => {
    const user = userEvent.setup(); const onUpdateMeeting = vi.fn();
    function Harness() {
      const [p, setProject] = useState(ready());
      return <Home controller={controller([p], { onUpdateMeeting: (id, patch) => {
        onUpdateMeeting(id, patch); setProject(current => ({ ...current, ...patch }));
      } })} />;
    }
    render(<Harness />);
    const pin = screen.getByRole('button', { name: 'Pin SYNTHETIC_HOME' });
    expect(pin.getAttribute('aria-pressed')).toBe('false');
    expect(pin.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(pin.querySelector('path')?.getAttribute('d')).toBe(pinPath);
    expect(pin.style.color).toBe('var(--ink3)');
    pin.focus(); await user.keyboard('{Enter}');
    const unpin = screen.getByRole('button', { name: 'Unpin SYNTHETIC_HOME' });
    expect(document.activeElement).toBe(unpin);
    expect(unpin.getAttribute('aria-pressed')).toBe('true');
    expect(unpin.querySelector('path')?.getAttribute('d')).toBe(unpinPath);
    expect(unpin.style.color).toBe('var(--accent)');
    expect(unpin.classList.contains('selected')).toBe(true);
    expect(onUpdateMeeting).toHaveBeenCalledExactlyOnceWith('synthetic-home', { pinned: true });
    await user.keyboard(' ');
    expect(screen.getByRole('button', { name: 'Pin SYNTHETIC_HOME' }).querySelector('path')?.getAttribute('d')).toBe(pinPath);
    expect(onUpdateMeeting.mock.calls).toEqual([['synthetic-home', { pinned: true }], ['synthetic-home', { pinned: false }]]);
  });
  it.each([false, true])('keeps the %s pin state visible but disabled while busy', pinned => {
    const onUpdateMeeting = vi.fn();
    render(<Home controller={controller([ready({ pinned })], { busy: true, onUpdateMeeting })} />);
    const button = screen.getByRole('button', { name: `${pinned ? 'Unpin' : 'Pin'} SYNTHETIC_HOME` }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-pressed')).toBe(String(pinned));
    expect(button.querySelector('path')?.getAttribute('d')).toBe(pinned ? unpinPath : pinPath);
    button.click(); expect(onUpdateMeeting).not.toHaveBeenCalled();
  });
});
