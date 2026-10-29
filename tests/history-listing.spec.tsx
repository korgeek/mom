// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App, { defaultPreferences, type AppController } from '../src/react-app/App';
import type { MeetingProject, RunRecord } from '../src/react-app/domain/types';
import Home from '../src/react-app/ui/screens/Home';
import History from '../src/react-app/ui/screens/History';

afterEach(cleanup);
function project(id: string, patch: Partial<MeetingProject> = {}): MeetingProject {
  return { id, title: `Memo ${id}`, icon: 'mic', color: '#123456', pinned: false,
    createdAt: '2026-10-01', updatedAt: '2026-10-01', sourceAssets: [],
    audioOptions: { chunkMinutes: 10, overlapSeconds: 10, expectedLanguages: ['en'], bitrateKbps: 32, sampleRateHz: 16000 },
    preparedChunks: [], rawTranscripts: [], transcriptVersions: [], selectedTranscriptVersionId: null,
    minutesSettings: { outputLanguage: 'en', sections: ['summary'], instructions: '', modelId: '' },
    minutesRuns: [], minutesRevisions: [], selectedMinutesRevisionId: null, runs: [], ...patch };
}
function run(id: string, date: string | null, kind: 'stt' | 'minutes' = 'stt', state: RunRecord['state'] = 'saved'): RunRecord {
  return { id, projectId: 'p', state,
    checkpoint: date ? { id: `checkpoint-${id}`, projectId: 'p', runId: id, recordIds: [], committedAt: date } : null,
    intent: { kind, chunkId: kind === 'stt' ? 'chunk' : null, requestedModel: `fixture/${id}`, requestedEndpoint: null, expectedLanguages: [], rateSnapshot: null } };
}
function controller(projects: readonly MeetingProject[], extra: Partial<AppController> = {}): AppController {
  return { session: 'unlocked', projects, selectedProjectId: null, screen: 'history', settingsTab: 'connections',
    preferences: { ...defaultPreferences, uiLanguage: 'en' }, defaultAudioOptions: project('p').audioOptions,
    modelCatalog: null, sttModelId: '', connections: [], storageEstimate: null, ...extra };
}
const titles = () => screen.getAllByRole('heading', { level: 2 }).map(heading => heading.textContent);

describe('paginated memo lists', () => {
  it('lists only processed memos, sorted by processing date rather than edit date, 15 at a time', async () => {
    const projects = Array.from({ length: 17 }, (_, index) => project(String(index), {
      updatedAt: index === 0 ? '2027-01-01' : '2026-10-01', runs: [run(`r${index}`, `2026-10-${String(index + 1).padStart(2, '0')}T00:00:00Z`)],
    }));
    const onNavigate = vi.fn();
    render(<History controller={controller([...projects, project('unprocessed')], { onNavigate })} />);
    expect(titles()).toEqual(Array.from({ length: 15 }, (_, index) => `Memo ${16 - index}`));
    expect(screen.queryByText('Memo unprocessed')).toBeNull();
    expect(screen.queryByText('Token, timing and state details')).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Next page' }));
    expect(titles()).toEqual(['Memo 1', 'Memo 0']);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Processing history Memo 0' }));
    expect(onNavigate).toHaveBeenLastCalledWith('history', '0');
  });
  it('includes unprocessed memos on Home, keeps edit order and opens matching history', async () => {
    const projects = Array.from({ length: 16 }, (_, index) => project(String(index), { updatedAt: `2026-10-${String(index + 1).padStart(2, '0')}` }));
    const onNavigate = vi.fn();
    render(<Home controller={controller(projects, { onNavigate })} />);
    const rows = document.querySelectorAll('.meeting-row');
    expect(rows.length).toBe(15); expect(rows[0].textContent).toContain('Memo 15');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Processing history Memo 15' }));
    expect(onNavigate).toHaveBeenCalledWith('history', '15');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Next page' }));
    expect(document.querySelectorAll('.meeting-row')).toHaveLength(1);
    expect(screen.getByText('Memo 0')).toBeTruthy();
  });
  it('clamps the current page when memos are deleted', async () => {
    const projects = Array.from({ length: 16 }, (_, index) => project(String(index)));
    const view = render(<Home controller={controller(projects)} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Next page' }));
    view.rerender(<Home controller={controller(projects.slice(0, 15))} />);
    expect(document.querySelectorAll('.meeting-row')).toHaveLength(15);
    expect(screen.queryByRole('button', { name: 'Next page' })).toBeNull();
  });
});

describe('memo processing detail', () => {
  it('shows saved provider diagnostics only on the matching failed run and masks credential-like text', async () => {
    const p = project('p', { runs: [run('failed', null, 'stt', 'failed'), run('other', null)],
      failedProviderResponses: [{ runId: 'failed', status: 400, failureCode: 'invalid-input', response: {
        message: 'Unsupported format verbose_json. sk-proj-SYNTHETIC_SECRET_VALUE', code: 'unsupported_value', type: 'invalid_request_error', param: 'response_format', audio: 'PRIVATE_AUDIO_SHOULD_NOT_RENDER',
      } }] });
    render(<History controller={controller([p], { historyProjectId: 'p' })} />);
    const failed = screen.getByRole('group', { name: 'Run failed' });
    await userEvent.setup().click(within(failed).getByText('fixture/failed'));
    expect(within(failed).getByText('HTTP status: 400')).toBeTruthy();
    expect(within(failed).getByText('error.code: unsupported_value')).toBeTruthy();
    expect(within(failed).getByText('error.type: invalid_request_error')).toBeTruthy();
    expect(within(failed).getByText('error.param: response_format')).toBeTruthy();
    expect(within(failed).getByText('error.message: Unsupported format verbose_json. [redacted]')).toBeTruthy();
    expect(document.body.textContent).not.toContain('SYNTHETIC_SECRET_VALUE');
    expect(document.body.textContent).not.toContain('PRIVATE_AUDIO_SHOULD_NOT_RENDER');
    expect(within(screen.getByRole('group', { name: 'Run other' })).queryByText(/HTTP status/)).toBeNull();
  });
  it('shows legacy provider messages without inventing an HTTP status', async () => {
    const p = project('p', { runs: [run('failed', null, 'minutes', 'failed')], failedProviderResponses: [{ runId: 'failed', response: { error: { message: 'Synthetic legacy failure', code: 429 } } }] });
    render(<History controller={controller([p], { historyProjectId: 'p' })} />);
    const failed = screen.getByRole('group', { name: 'Run failed' });
    await userEvent.setup().click(within(failed).getByText('fixture/failed'));
    expect(within(failed).getByText('HTTP status: Not recorded')).toBeTruthy();
    expect(within(failed).getByText('error.message: Synthetic legacy failure')).toBeTruthy();
    expect(within(failed).getByText('error.code: 429')).toBeTruthy();
  });
  it('sorts calls newest first and paginates each selected STT/LLM filter independently', async () => {
    const p = project('p', { runs: Array.from({ length: 18 }, (_, index) => run(String(index), `2026-10-${String(index + 1).padStart(2, '0')}T00:00:00Z`, index === 17 ? 'minutes' : 'stt')) });
    const onNavigate = vi.fn(); render(<History controller={controller([p], { historyProjectId: 'p', onNavigate })} />);
    expect(screen.getAllByRole('group', { name: /^Run / })).toHaveLength(15);
    expect(screen.getAllByRole('group', { name: /^Run / })[0].getAttribute('aria-label')).toBe('Run 17');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getAllByRole('group', { name: /^Run / })).toHaveLength(3);
    await userEvent.setup().click(screen.getByRole('button', { name: 'LLM' }));
    expect(screen.getAllByRole('group', { name: /^Run / })).toHaveLength(1);
    expect(screen.getByRole('group', { name: 'Run 17' })).toBeTruthy();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Back to processing history' }));
    expect(onNavigate).toHaveBeenCalledWith('history');
  });
  it('retains unknown, failed and cancelled calls without invented metadata and keeps details collapsed', async () => {
    const p = project('p', { runs: [run('failed', null, 'stt', 'failed'), run('cancelled', null, 'minutes', 'cancelled'), { id: 'legacy', projectId: 'p', state: 'outcome-unknown', checkpoint: null }] });
    render(<History controller={controller([p], { historyProjectId: 'p' })} />);
    expect(screen.getAllByRole('group', { name: /^Run / }).map(item => item.getAttribute('aria-label'))).toEqual(['Run failed', 'Run cancelled', 'Run legacy']);
    expect(screen.getByText('Failed')).toBeTruthy(); expect(screen.getByText('Cancelled')).toBeTruthy(); expect(screen.getByText('Outcome unknown')).toBeTruthy();
    expect(screen.queryByText(/Unknown|Unavailable|0 USD|Returned model:/)).toBeNull();
    const failed = screen.getByRole('group', { name: 'Run failed' });
    expect(failed.hasAttribute('open')).toBe(false);
    await userEvent.setup().click(within(failed).getByText('fixture/failed'));
    expect(within(failed).getByText('Request ID: failed')).toBeTruthy();
    expect(within(failed).queryByText(/Requested execution endpoint:/)).toBeNull();
  });
  it('marks archived calls and resolves their original chunk range without changing active counts', async () => {
    const p = project('p', { runs: [run('current', '2026-10-17T00:00:00Z')],
      processingArchives: [{ id: 'archive', resetAt: '2026-10-16T00:00:00Z', chunks: [{ id: 'chunk', index: 3, sourceStartMs: 600000, sourceEndMs: 1200000 }], items: [{ id: 'archived', projectId: 'p', date: '2026-10-15T00:00:00Z', kind: 'stt', state: 'saved', recordedAttempt: true, hasResult: true, conflict: false, model: 'fixture/archived', executionRequestedModel: null, route: 'openai', publisher: 'OpenAI', requestedEndpoint: null, returnedModel: null, actualProvider: null, chunkId: 'chunk', usage: null, intentRateSnapshot: null }] }] });
    render(<History controller={controller([p], { historyProjectId: 'p' })} />);
    const archived = screen.getByRole('group', { name: 'Run archived' });
    expect(within(archived).getByText('Before initialization · results deleted')).toBeTruthy();
    expect(within(archived).getByText('Chunk 4 · 10:00–20:00')).toBeTruthy();
    expect(screen.getAllByRole('group', { name: /^Run / })).toHaveLength(2);
  });
});

it('shows the sidebar total as information without an arrow or duplicate Home link',()=>{
 const navigate=vi.fn();render(<App controller={controller([project('p')],{screen:'home',onNavigate:navigate})}/>);
 const side=within(screen.getByRole('complementary')),info=side.getByText('All voice memos 1');
 expect(info.tagName).toBe('DIV');expect(info.closest('button,a')).toBeNull();expect(info.textContent).not.toContain('→');expect(side.queryByRole('button',{name:/All voice memos/})).toBeNull();
});

it.each([false, true])('shows recorded STT/LLM counts and the latest state, including archived=%s', archived => {
  const memo = project('p', { runs: [run('older', '2026-10-12T00:00:00Z'), run('text', '2026-10-13T00:00:00Z', 'minutes'), run('latest', '2026-10-14T00:00:00Z', 'stt', 'failed')],
    processingArchives: archived ? [{ id: 'archive', resetAt: '2026-10-17T00:00:00Z', chunks: [], items: [{ id: 'archived', projectId: 'p', date: '2026-10-16T00:00:00Z', kind: 'stt', state: 'saved', recordedAttempt: true, hasResult: true, conflict: false, model: 'fixture/archived', executionRequestedModel: null, route: 'openai', publisher: 'OpenAI', requestedEndpoint: null, returnedModel: null, actualProvider: null, chunkId: 'chunk', usage: null, intentRateSnapshot: null }] }] : [] });
  render(<History controller={controller([memo])} />);
  expect(screen.getByText(`STT ${archived ? 3 : 2}`)).toBeTruthy(); expect(screen.getByText('LLM 1')).toBeTruthy();
  expect(screen.getByText(archived ? 'Before initialization · results deleted' : 'Failed')).toBeTruthy();
  expect(screen.queryByText('Saved')).toBeNull();
});
it('shows recorded request and response in each matching run and marks missing old records',()=>{
 const memo=project('details');
 const run={id:'recorded',projectId:memo.id,state:'saved' as const,checkpoint:null,intent:{kind:'stt' as const,chunkId:'chunk',requestedModel:'fixture/stt',expectedLanguages:[],requestedEndpoint:null,rateSnapshot:null}};
 const enriched={...memo,runs:[run],rawTranscripts:[{id:'raw',runId:'recorded',chunkId:'chunk',response:{text:'SYNTHETIC RESPONSE'},request:{method:'POST',body:{file:{omitted:'audio bytes',bytes:12,type:'audio/wav'},model:'fixture/stt'}},text:'SYNTHETIC RESPONSE',segments:[],timing:'chunk' as const,speakerScope:'none' as const}]} as unknown as MeetingProject;
 const c=controller([enriched]);c.historyProjectId=enriched.id;render(<History controller={c}/>);
 const group=screen.getByRole('group',{name:'Run recorded'});expect(within(group).getByText('Request')).toBeTruthy();expect(within(group).getByText('Response')).toBeTruthy();expect(within(group).getByText('SYNTHETIC RESPONSE')).toBeTruthy();
 expect(within(group).queryByText('Request content was not recorded.')).toBeNull();
});
it('labels raw request and response JSON distinctly for assistive technology',async()=>{
 const JsonResponse=(await import('../src/react-app/ui/components/JsonResponse')).default;
 render(<><JsonResponse value={{method:'POST'}} language="en" title="Request"/><JsonResponse value={{text:'fixture'}} language="en" title="Response"/></>);
 const request=screen.getByRole('region',{name:'Request'}), response=screen.getByRole('region',{name:'Response'});
 await userEvent.click(within(request).getByRole('button',{name:'View original JSON'}));await userEvent.click(within(response).getByRole('button',{name:'View original JSON'}));
 expect(within(request).getByLabelText('Request JSON')).toBeTruthy();expect(within(response).getByLabelText('Response JSON')).toBeTruthy();
});
