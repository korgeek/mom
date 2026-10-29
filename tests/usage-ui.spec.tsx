// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App, { defaultPreferences, type AppController, type AppScreen } from '../src/react-app/App';
import type { MeetingProject, Usage } from '../src/react-app/domain/types';

// UI descriptor fixtures never invoke audio codecs or workers.
vi.mock('../src/react-app/media/prepare', () => ({ planChunkRanges: (durationMs: number) => [{ sourceStartMs: 0, sourceEndMs: durationMs }] }));
beforeAll(() => { HTMLDialogElement.prototype.showModal = function () { this.open = true; }; HTMLDialogElement.prototype.close = function () { this.open = false; }; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const usage: Usage = { inputTokens: 100, outputTokens: 10, audioInputTokens: 90, textInputTokens: 10, audioOutputTokens: 0, textOutputTokens: 10, durationSeconds: 601, elapsedMs: 1000, cost: 0.01, costKind: 'estimated', currency: 'USD', rateSource: 'Rate source fixture', rateCheckedAt: '2026-09-01', rateSnapshot: { source: 'Rate source fixture', checkedAt: '2026-09-01', currency: 'USD', rates: [{ unit: 'audio-second', units: 60, price: 0.006 }] } };
function project(): MeetingProject {
  return { id: 'p', title: 'Usage fixture voice memo', icon: 'mic', color: '#123456', pinned: false, createdAt: '2026-10-01', updatedAt: '2026-10-01', sourceAssets: [], audioOptions: { chunkMinutes: 10, overlapSeconds: 10, expectedLanguages: ['en'], bitrateKbps: 32, sampleRateHz: 16000 }, preparedChunks: [{ id: 'chunk', sourceId: 'source', index: 0, sourceStartMs: 0, sourceEndMs: 600000, encodingOffsetMs: 0, encodedBytes: 100, mimeType: 'audio/mpeg', codec: 'mp3', audioRecordId: 'audio' }], rawTranscripts: [{ id: 'raw', runId: 's', chunkId: 'chunk', response: {}, text: 'Fixture only', segments: [], timing: 'chunk', speakerScope: 'none', execution: { requestedModel: 'whisper-1', returnedModel: 'returned/stt', actualProvider: null, expectedLanguages: ['en'], usage } }], transcriptVersions: [], selectedTranscriptVersionId: null, minutesSettings: { outputLanguage: 'en', sections: ['summary'], instructions: '', modelId: 'CURRENT/selector' }, minutesRuns: [{ id: 'm', transcriptVersionId: 'v', settings: { outputLanguage: 'en', sections: ['summary'], instructions: '', modelId: 'openai/historical' }, generatedMarkdown: '# Fixture notes', requestedModel: 'openai/historical', returnedModel: 'returned/model', actualProvider: 'Returned Provider', usage: { ...usage, cost: 0.02, costKind: 'reported', currency: 'credits', audioInputTokens: null, audioOutputTokens: null, textInputTokens: 100, durationSeconds: null } }], minutesRevisions: [{ id: 'revision', runId: 'm', parentId: null, markdown: '# Fixture notes' }], selectedMinutesRevisionId: 'revision', runs: [{ id: 's', projectId: 'p', state: 'saved', checkpoint: null, intent: { kind: 'stt', chunkId: 'chunk', requestedModel: 'whisper-1', requestedEndpoint: null, expectedLanguages: ['en'], rateSnapshot: usage.rateSnapshot } }, { id: 'm', projectId: 'p', state: 'saved', checkpoint: null, intent: { kind: 'minutes', chunkId: null, requestedModel: 'openai/historical', requestedEndpoint: 'Requested/region', expectedLanguages: [], rateSnapshot: null } }, { id: 'old', projectId: 'p', state: 'outcome-unknown', checkpoint: null, intent: { kind: 'minutes', chunkId: null, requestedModel: 'old/model', requestedEndpoint: 'Old/region', expectedLanguages: [], rateSnapshot: null } }] };
}
function controller(extra: Partial<AppController> = {}): AppController {
  return { session: 'unlocked', projects: [project()], selectedProjectId: 'p', screen: 'minutes', settingsTab: 'connections', preferences: { ...defaultPreferences, uiLanguage: 'en' }, defaultAudioOptions: project().audioOptions, modelCatalog: null, sttModelId: 'CURRENT/stt', connections: [], storageEstimate: null, ...extra };
}
function Harness() {
  const [current, setCurrent] = useState<AppScreen>('settings');
  return <App controller={controller({ screen: current, onNavigate: next => setCurrent(next) })} />;
}
function HistoryHarness({ memo = project() }: { memo?: MeetingProject }) {
  const [historyProjectId, setHistoryProjectId] = useState<string | null>(null);
  return <App controller={controller({ screen: 'history', projects: [memo], historyProjectId, onNavigate: (next, id) => setHistoryProjectId(next === 'history' ? id ?? null : null) })} />;
}
describe('independent History and stage usage UI', () => {
  it('navigates to History outside Settings, retains voice memos and makes no network or export call', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); const user = userEvent.setup(); render(<Harness />);
    expect(within(screen.getByRole('tablist', { name: 'Settings categories' })).queryByRole('tab', { name: 'History' })).toBeNull();
    const history = screen.getByRole('button', { name: 'History' }); history.focus(); await user.keyboard('{Enter}');
    expect(screen.getByRole('heading', { name: 'Processing history' })).toBe(document.activeElement);
    expect(screen.queryByRole('tablist', { name: 'Settings categories' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Usage fixture voice memo' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Copy Markdown' })).toBeNull(); expect(fetch).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Settings' })); expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy();
  });
  it('intentionally redirects a legacy runtime settings history selection without losing the project', () => {
    render(<App controller={controller({ screen: 'settings', settingsTab: 'history' })} />);
    expect(screen.getByRole('heading', { name: 'Processing history' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Usage fixture voice memo' })).toBeTruthy();
  });
  it('shows STT/notes stages and independent currency components in the final notes statement', () => {
    render(<App controller={controller()} />); const statement = screen.getByRole('region', { name: 'Usage statement' });
    expect(within(statement).queryByRole('table')).toBeNull();
    fireEvent.click(within(statement).getByRole('button', { name: 'Show usage and cost details' }));
    expect(within(statement).getByRole('row', { name: /STT.*1.*1.*1.*USD/ })).toBeTruthy();
    expect(within(statement).getByRole('row', { name: /Notes.*2.*1.*credits/ })).toBeTruthy();
    expect(within(statement).getByText('Combined known components')).toBeTruthy();
    expect(within(statement).getByText(/Complete combined total: Unavailable/)).toBeTruthy();
    expect(within(statement).getByText(/Final provider billing is unverified/)).toBeTruthy();
  });
  it('shows only the STT stage on its own screen without equating returned duration and audio tokens', async () => {
    render(<App controller={controller({ screen: 'stt' })} />); await userEvent.setup().click(screen.getByRole('button', { name: 'View statement & request history →' })); const statement = screen.getByRole('region', { name: 'STT usage statement' });
    expect(within(statement).queryByRole('row', { name: /^Notes/ })).toBeNull();
    expect(within(statement).getByText(/Returned audio duration \(seconds\): 601/)).toBeTruthy();
    expect(within(statement).getByText(/Audio input tokens: 90/)).toBeTruthy();
    expect(within(statement).getByText(/Aggregate input tokens: 100/)).toBeTruthy();
  });
  it.each(['minutes', 'stt'] as const)('exposes saved STT identities and rate units for all retries inside the %s statement', async current => {
    const p = project();
    const sttIntent = p.runs[0].intent!;
    const enriched: MeetingProject = { ...p,
      rawTranscripts: [{ ...p.rawTranscripts[0], execution: { ...p.rawTranscripts[0].execution!, actualProvider: 'Reported STT provider' } }, { ...p.rawTranscripts[0], id: 'retry-raw', runId: 'stt-retry', execution: { ...p.rawTranscripts[0].execution!, returnedModel: 'returned/retry-stt', actualProvider: 'Reported retry provider' } }],
      runs: [{ ...p.runs[0], intent: { ...sttIntent, requestedEndpoint: 'saved-stt-endpoint' } }, ...p.runs.slice(1), { id: 'stt-old', projectId: p.id, state: 'outcome-unknown', checkpoint: null, intent: { ...sttIntent, requestedEndpoint: 'old-stt-endpoint' } }, { id: 'stt-retry', projectId: p.id, state: 'saved', checkpoint: null, intent: { ...sttIntent, requestedEndpoint: 'retry-stt-endpoint' } }],
    };
    render(<App controller={controller({ screen: current, projects: [enriched] })} />);
    if (current === 'stt') await userEvent.setup().click(screen.getByRole('button', { name: 'View statement & request history →' }));
    const statement = screen.getByRole('region', { name: current === 'stt' ? 'STT usage statement' : 'Usage statement' });
    if (current === 'minutes') fireEvent.click(within(statement).getByRole('button', { name: 'Show usage and cost details' }));
    await userEvent.setup().click(within(statement).getByText('STT · Token, timing and state details'));
    for (const id of ['s', 'stt-old', 'stt-retry']) {
      const attempt = within(statement).getByRole('group', { name: `Statement run ${id}` });
      await userEvent.setup().click(attempt.querySelector('summary')!);
      await userEvent.setup().click(within(attempt).getByText('Request ID & route details'));
      expect(within(attempt).getByText('Direct provider: OpenAI')).toBeTruthy();
      expect(within(attempt).getAllByText('audio-second: 0.006 USD / 60 units')).toHaveLength(id === 'stt-old' ? 1 : 2);
      expect(within(attempt).getByText('Request intent rate snapshot')).toBeTruthy();
    }
    const saved = within(statement).getByRole('group', { name: 'Statement run s' });
    expect(within(saved).getByText('Returned model: returned/stt')).toBeTruthy();
    expect(within(saved).getByText('Reported execution provider: Reported STT provider')).toBeTruthy();
    expect(within(saved).getByText('Requested execution endpoint: saved-stt-endpoint')).toBeTruthy();
    expect(within(saved).getByText('Result rate snapshot')).toBeTruthy();
    expect(within(saved).getAllByText('Rate source fixture · 2026-09-01')).toHaveLength(2);
    const old = within(statement).getByRole('group', { name: 'Statement run stt-old' });
    expect(within(old).getByText('Returned model: Unknown')).toBeTruthy();
    expect(within(old).getByText('Reported execution provider: Unknown')).toBeTruthy();
    expect(within(old).getByText('Requested execution endpoint: old-stt-endpoint')).toBeTruthy();
  });
  it('exposes every notes comparison member and earlier attempt in final output with saved response and rate provenance', async () => {
    const p = project(); const member = { ...p.minutesRuns[0], id: 'b', requestedModel: 'anthropic/saved-b', returnedModel: 'returned/b', actualProvider: 'Reported B provider', usage: { ...usage, durationSeconds: null, rateSource: 'Saved B rates', rateCheckedAt: '2026-09-02', rateSnapshot: { source: 'Saved B rates', checkedAt: '2026-09-02', currency: 'USD', rates: [{ unit: 'text-input-token' as const, units: 1000000, price: 2 }] } } };
    const enriched: MeetingProject = { ...p, minutesRuns: [...p.minutesRuns, member], runs: [...p.runs, { ...p.runs[1], id: 'b', intent: { ...p.runs[1].intent!, requestedModel: member.requestedModel, requestedEndpoint: 'SavedB/region', rateSnapshot: member.usage.rateSnapshot } }], minutesComparisons: [{ id: 'comparison', projectId: p.id, createdAt: '', inputSignature: '', promptVersion: '', transcript: { id: 'v', parentId: null, rawIds: [], segments: [], issues: [], missingRanges: [] }, settings: p.minutesSettings, messages: [], outputTokens: 1, reasoningReserveTokens: 0, members: [{ modelId: p.minutesRuns[0].requestedModel, endpointTag: 'Requested/region', providerName: null, selectionSnapshot: {}, attempts: [{ runId: 'old', revisionId: null, consentToken: '', selectionSnapshot: {} }, { runId: 'm', revisionId: 'revision', consentToken: '', selectionSnapshot: {} }] }, { modelId: member.requestedModel, endpointTag: 'SavedB/region', providerName: null, selectionSnapshot: {}, attempts: [{ runId: 'b', revisionId: null, consentToken: '', selectionSnapshot: {} }] }] }] };
    render(<App controller={controller({ projects: [enriched] })} />);
    const statement = screen.getByRole('region', { name: 'Usage statement' });
    fireEvent.click(within(statement).getByRole('button', { name: 'Show usage and cost details' }));
    await userEvent.setup().click(within(statement).getByText('Notes · Token, timing and state details'));
    expect(within(statement).getAllByRole('group', { name: /^Statement run/ })).toHaveLength(3);
    const b = within(statement).getByRole('group', { name: 'Statement run b' });
    await userEvent.setup().click(b.querySelector('summary')!);
    await userEvent.setup().click(within(b).getByText('Request ID & route details'));
    expect(within(b).getByText('Requested adapter (from recorded intent): OpenRouter')).toBeTruthy();
    expect(within(b).getByText('Requested model: anthropic/saved-b')).toBeTruthy();
    expect(within(b).getByText('Catalog namespace: Anthropic')).toBeTruthy();
    expect(within(b).getByText('Requested execution endpoint: SavedB/region')).toBeTruthy();
    expect(within(b).getByText('Returned model: returned/b')).toBeTruthy();
    expect(within(b).getByText('Reported execution provider: Reported B provider')).toBeTruthy();
    expect(within(b).getByText('Result rate snapshot')).toBeTruthy();
    expect(within(b).getAllByText('Saved B rates · 2026-09-02')).toHaveLength(2);
    expect(within(b).getAllByText('text-input-token: 2 USD / 1,000,000 units')).toHaveLength(2);
    const old = within(statement).getByRole('group', { name: 'Statement run old' });
    await userEvent.setup().click(old.querySelector('summary')!);
    await userEvent.setup().click(within(old).getByText('Request ID & route details'));
    expect(within(old).getByText('Returned model: Unknown')).toBeTruthy();
    expect(within(old).getByText('Requested execution endpoint: Old/region')).toBeTruthy();
  });
  it('keeps saved requested adapter, model, endpoint, returned provider and pricing provenance distinct', async () => {
    render(<HistoryHarness />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Processing history Usage fixture voice memo' }));
    const attempt = screen.getByRole('group', { name: 'Run m' });
    expect(within(attempt).getByText('Requested adapter (from recorded intent): OpenRouter')).toBeTruthy();
    expect(within(attempt).getByText('Requested model: openai/historical')).toBeTruthy();
    expect(within(attempt).getByText('Catalog namespace: OpenAI')).toBeTruthy();
    expect(within(attempt).getByText('Requested execution endpoint: Requested/region')).toBeTruthy();
    expect(within(attempt).getByText('Returned model: returned/model')).toBeTruthy();
    expect(within(attempt).getByText('Reported execution provider: Returned Provider')).toBeTruthy();
    expect(within(attempt).getByText(/Rate source fixture.*2026-09-01/)).toBeTruthy();
    expect(within(attempt).getByText('audio-second: 0.006 USD / 60 units')).toBeTruthy();
    const stt = screen.getByRole('group', { name: 'Run s' });
    expect(within(stt).getByText('Requested adapter (from recorded intent): Direct OpenAI')).toBeTruthy();
    expect(within(stt).queryByText(/Requested execution endpoint:/)).toBeNull();
  });
  it('keeps legacy unknown attempts visible while omitting unavailable metadata', async () => {
    const p = { ...project(), runs: [{ id: 'legacy', projectId: 'p', state: 'requesting' as const, checkpoint: null }], rawTranscripts: [], minutesRuns: [], minutesRevisions: [], selectedMinutesRevisionId: null };
    render(<HistoryHarness memo={p} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Processing history Usage fixture voice memo' }));
    const attempt = screen.getByRole('group', { name: 'Run legacy' });
    expect(within(attempt).getByText('Request record')).toBeTruthy();
    expect(within(attempt).getByText('Requesting')).toBeTruthy();
    expect(within(attempt).queryByText(/Stage:|Requested adapter|Requested model/)).toBeNull();
    expect(screen.getByText(/Request records do not prove provider receipt or billing/)).toBeTruthy();
  });
  it.each(['en', 'ko'] as const)('renders empty history honestly in %s', uiLanguage => {
    render(<App controller={controller({ screen: 'history' as AppScreen, projects: [], selectedProjectId: null, preferences: { ...defaultPreferences, uiLanguage } })} />);
    expect(screen.getByText(uiLanguage === 'en' ? 'No processing records yet.' : '아직 처리 기록이 없어요.')).toBeTruthy();
  });
});

it('summarizes unique STT runs with honest partial cost coverage and keeps all request details in the modal', async () => {
  const p = project(), missing = { ...p.rawTranscripts[0], id: 'missing-raw', runId: 'missing', text: 'SYNTHETIC_NO_USAGE', execution: null };
  const enriched = { ...p, rawTranscripts: [p.rawTranscripts[0], { ...p.rawTranscripts[0], id: 'same-run-copy' }, missing], runs: [p.runs[0], p.runs[0], { ...p.runs[0], id: 'missing' }, { ...p.runs[0], id: 'failed', state: 'failed' as const }, { ...p.runs[0], id: 'unknown', state: 'outcome-unknown' as const }] };
  render(<App controller={controller({ screen: 'stt', projects: [enriched] })} />);
  const summary = screen.getByRole('region', { name: 'Transcription usage summary' });
  expect(summary.textContent).toContain('Request records 4');
  expect(summary.textContent).toContain('Cost unavailable');
  expect(summary.textContent).toContain('0.01 USD · Estimated known partial subtotal');
  expect(within(summary).queryByText('Preserved responses')).toBeNull();
  expect(within(summary).queryByText('Failed / unknown outcome')).toBeNull();
  expect(screen.queryByRole('region', { name: 'STT usage statement' })).toBeNull();
  await userEvent.setup().click(within(summary).getByRole('button', { name: 'View statement & request history →' }));
  const modal = within(screen.getByRole('dialog', { name: 'Usage statement · request history' }));
  expect(modal.getByRole('row', { name: /STT.*4.*2/ })).toBeTruthy();
  await userEvent.setup().click(modal.getByText('STT · Token, timing and state details'));
  expect(modal.getByText(/Failed 1/)).toBeTruthy();
  expect(modal.getAllByRole('group', { name: /^Statement run/ })).toHaveLength(4);
  const unknown = modal.getByRole('group', { name: 'Statement run unknown' });
  expect(unknown.querySelector('summary')?.textContent).toContain('Outcome unknown');
  expect(unknown.querySelector('summary strong')?.textContent).toBe('whisper-1');
  expect(within(unknown).getByText('Request ID & route details').closest('details')?.open).toBe(false);
});
