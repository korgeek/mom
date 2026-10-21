// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {createModelPreset} from '../src/react-app/providers/model-profiles';
import App, { defaultPreferences, type AppController } from '../src/react-app/App';
import type { MeetingProject, RouterSTTPreference } from '../src/react-app/domain/types';
import { ModelManager, type ModelManagementRow } from '../src/react-app/ui/components/ModelManager';
import { observeRouterSTTRoute, registryRouteKey } from '../src/react-app/providers/model-registry';
import { freezeRouterSTTSelection } from '../src/react-app/providers/stt-selection';
import { recommendRouterSTT } from '../src/react-app/providers/stt-catalog';
import type { DiscoveredSTTModel } from '../src/react-app/providers/discovery';
import { appendBatchAttempt, createSTTBatch, replaceSTTBatch, sttActionToken } from '../src/react-app/transcript/batches';

// Screen-only descriptor fixtures; native preparation is covered by the separate headed test.
vi.mock('../src/react-app/media/prepare', () => ({ planChunkRanges: (durationMs: number) => [{ sourceStartMs: 0, sourceEndMs: durationMs }] }));
afterEach(cleanup);
beforeAll(()=>{HTMLDialogElement.prototype.showModal=function(){this.open=true;};HTMLDialogElement.prototype.close=function(){this.open=false;};});
const mini = 'openai/gpt-4o-mini-transcribe', whisper = 'openai/whisper-large-v3';
const preference: RouterSTTPreference = { policy: { dataCollection: 'deny', requireZdr: true }, acknowledgedDisclosureVersion: null, initialDefaultApplied: false };
function discovery(id = mini): DiscoveredSTTModel {
  return { id, name: id, source: 'https://openrouter.ai/api/v1/models?output_modalities=transcription', checkedAt: '2026-10-03T04:18:04.389Z', inputModalities: ['audio'], outputModalities: ['transcription'], adapterStatus: 'unsupported', pricing: { status: 'unknown', raw: { prompt: '0.000001', completion: id === whisper ? '0' : '0.000002', request: '0' } } };
}
function row(id = mini, enabled = false): ModelManagementRow {
  const route = { connectionId: 'openrouter', provider: 'openrouter', stage: 'stt', modelId: id, endpointTag: null } as const;
  const metadata = observeRouterSTTRoute(route, discovery(id)).metadata;
  return { key: registryRouteKey(route), route, metadata, alias: null, developer: 'openai', userEnabled: enabled, isDefault: false, status: 'current', blockedReason: metadata.compatible ? null : 'unsupported-stt-profile', metadataAcceptanceRequired: false, mayLoadEndpoints: false };
}
function project(): MeetingProject {
  return { id: 'SYNTHETIC_OR_STT_UI', title: 'SYNTHETIC_OR_STT_UI', icon: 'mic', color: '#3B82F6', pinned: false, createdAt: '2026-10-03T00:00:00Z', updatedAt: '2026-10-03T00:00:00Z',
    sourceAssets: [{ id: 'source', fileName: 'SYNTHETIC.wav', bytes: 32044, container: 'wav', codec: 'pcm', durationMs: 1000, channels: 1, sampleRateHz: 16000 }],
    audioOptions: { chunkMinutes: 10, overlapSeconds: 10, expectedLanguages: ['ko', 'en'], bitrateKbps: 32, sampleRateHz: 16000 },
    preparedChunks: [{ id: 'chunk', sourceId: 'source', index: 0, sourceStartMs: 0, sourceEndMs: 1000, encodingOffsetMs: 0, encodedBytes: 1234, mimeType: 'audio/mpeg', codec: 'mp3', audioRecordId: 'audio' }],
    retainedAudio: { sourceIds: ['source'], chunkIds: ['chunk'] }, rawTranscripts: [], transcriptVersions: [], selectedTranscriptVersionId: null,
    minutesSettings: { outputLanguage: 'ko', sections: ['summary'], instructions: '', modelId: '' }, minutesRuns: [], minutesRevisions: [], selectedMinutesRevisionId: null, runs: [] };
}
function controller(extra: Partial<AppController> = {}): AppController {
  const p = project(), selection = freezeRouterSTTSelection(p, ['chunk'], row().route, discovery(), preference.policy);
  return { session: 'unlocked', screen: 'stt', selectedProjectId: p.id, projects: [p], settingsTab: 'connections', preferences: { ...defaultPreferences, uiLanguage: 'en' }, defaultAudioOptions: p.audioOptions, sttModelId: mini, sttConsentToken: 'scope-1', routerSTTSelection: selection,
    connections: [{ provider: 'openai', status: 'none' }, { provider: 'openrouter', status: 'saved' }], storageEstimate: null,
    modelCatalog: [mini, whisper, 'unknown/stt'].map(id => ({ id, label: id, provider: 'openrouter', kind: 'stt', enabled: id !== 'unknown/stt' })), onSTTModel: vi.fn(), ...extra };
}
function settings(extra: Partial<AppController> = {}) {
  const rows = [row(), row(whisper)];
  return controller({ screen: 'settings', projects: [], selectedProjectId: null, modelRegistry: { version: 1, entries: [], defaults: { stt: null, minutes: null }, lastCheckedAt: null }, routerSTTRecommendation: recommendRouterSTT([discovery(), discovery(whisper)]),
    modelManagement: { rows, language: 'en', busy: false, discoveryAvailability: { openai: false, openrouter: true }, onEnabled: vi.fn() }, onRouterSTTPreference: vi.fn().mockResolvedValue(undefined), onApplyRouterSTTRecommendation: vi.fn().mockResolvedValue(undefined), ...extra });
}

describe('OR_STT_UI', () => {
  it.each(['en', 'ko'] as const)('OR_STT_review blocked %s route remains managed without current discovery facts', async language => {
    const start = vi.fn(), c = controller({ preferences: { ...defaultPreferences, uiLanguage: language }, routerSTTSelection: null, onStartSTT: start });
    render(<App controller={c} />);
    expect(screen.getByText(language === 'en' ? 'Browser → OpenRouter → dynamically selected processor' : '브라우저 → OpenRouter → 동적으로 선택되는 처리 제공사')).toBeTruthy();
    expect(screen.getByText(language === 'en' ? 'Current transcription facts unavailable. Refresh the OpenRouter transcription catalog in Models settings before sending.' : '현재 전사 정보를 확인할 수 없어요. 전송 전에 모델 설정에서 OpenRouter 전사 목록을 다시 조회하세요.')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/no intermediate server|중간 서버 없음|generic filename|일반 전송 파일명/);
    await userEvent.setup().click(screen.getByRole('checkbox', { name: language === 'en' ? "I've reviewed the above" : '위 내용을 확인했어요' }));
    expect((screen.getByRole('button', { name: language === 'en' ? 'Transcribe' : '전사 실행' }) as HTMLButtonElement).disabled).toBe(true);
    expect(start).not.toHaveBeenCalled();
  });
  it.each(['en','ko'] as const)('shows %s OpenRouter policies only inside its model editor and resets policy acknowledgment',async language=>{
    const model=createModelPreset('mai-transcribe-2'),user=userEvent.setup();
    render(<App controller={settings({preferences:{...defaultPreferences,uiLanguage:language},modelRegistrations:{version:2,entries:[model]},onSaveRegistration:vi.fn(async()=>{})})}/>);
    expect(screen.queryByRole('link',{name:language==='en'?'Data collection policy':'데이터 수집 정책'})).toBeNull();
    await user.click(screen.getByRole('button',{name:language==='en'?'Edit':'수정'}));
    const collection=screen.getByRole('link',{name:language==='en'?'Data collection policy':'데이터 수집 정책'}),logging=screen.getByRole('link',{name:language==='en'?'Provider logging & retention':'제공사 로그·보관 정책'});
    expect(collection.getAttribute('href')).toBe('https://openrouter.ai/docs/guides/privacy/data-collection');expect(logging.getAttribute('href')).toBe('https://openrouter.ai/docs/guides/privacy/provider-logging');
    const check=screen.getByRole('checkbox',{name:language==='en'?'I reviewed the selected OpenRouter transmission and retention policy':'선택한 OpenRouter 전송·보관 정책을 확인했어요'});
    expect((check as HTMLInputElement).checked).toBe(false);await user.click(check);
    await user.selectOptions(screen.getByLabelText(language==='en'?'OpenRouter retention policy':'OpenRouter 보관 정책'),'standard');expect((check as HTMLInputElement).checked).toBe(false);
  });
  it('saves the explicitly selected policy with the model and no transmission',async()=>{
    const model=createModelPreset('mai-transcribe-2'),save=vi.fn(async()=>{}),test=vi.fn(),user=userEvent.setup();
    render(<App controller={settings({modelRegistrations:{version:2,entries:[model]},onSaveRegistration:save,onTestRegistration:test})}/>);
    await user.click(screen.getByRole('button',{name:'Edit'}));expect((screen.getByLabelText('OpenRouter retention policy') as HTMLSelectElement).value).toBe('zdr');
    await user.selectOptions(screen.getByLabelText('OpenRouter retention policy'),'standard');await user.click(screen.getByRole('checkbox',{name:'I reviewed the selected OpenRouter transmission and retention policy'}));
    await user.click(screen.getByRole('button',{name:'Save'}));expect(save).toHaveBeenCalledWith(expect.objectContaining({routerPolicy:{requireZdr:false,acknowledged:true}}),{action:'keep'});expect(test).not.toHaveBeenCalled();
  });
  it('keeps model save failure safe without exposing a provider or storage error',async()=>{
    const model=createModelPreset('mai-transcribe-2'),save=vi.fn(async()=>{throw new Error('SYNTHETIC_PRIVATE_ERROR');}),user=userEvent.setup();
    render(<App controller={settings({modelRegistrations:{version:2,entries:[model]},onSaveRegistration:save})}/>);await user.click(screen.getByRole('button',{name:'Edit'}));await user.click(screen.getByRole('button',{name:'Save'}));expect(screen.getByRole('alert').textContent).toContain('Could not complete');expect(document.body.textContent).not.toContain('SYNTHETIC_PRIVATE_ERROR');
  });
  it('separates encrypted saving from server transmission and plaintext sharing',async()=>{
    render(<App controller={settings()}/>);await userEvent.setup().click(screen.getByRole('button',{name:'Transmission & sharing details'}));expect(screen.getByText(/Audio, results, settings and saved keys are encrypted in this browser/)).toBeTruthy();expect(screen.getByText(/Local encryption does not control server logs or retention/)).toBeTruthy();expect(screen.getByText(/API keys and test inputs\/responses are excluded/)).toBeTruthy();
  });
  it.each(['saved-default','disabled','existing-meeting'])('preserves %s choices without automatically enabling a recommendation',state=>{
    const model={...createModelPreset('mai-transcribe-2'),enabled:state!=='disabled'},c=settings({modelRegistrations:{version:2,entries:[model],defaults:{stt:state==='saved-default'?model.id:null,llm:null}},projects:state==='existing-meeting'?[project()]:[],onSaveRegistration:vi.fn(async()=>{}),onSetRegistrationDefault:vi.fn(async()=>{})});render(<App controller={c}/>);
    expect(c.onSaveRegistration).not.toHaveBeenCalled();expect(c.onSetRegistrationDefault).not.toHaveBeenCalled();expect(c.onApplyRouterSTTRecommendation).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Default models'}));expect((screen.getByLabelText('STT default model') as HTMLSelectElement).value).toBe(state==='saved-default'?model.id:'');
  });
  it('allows a documented OR route to be explicitly enabled while unknown profiles remain blocked', async () => {
    const enabled = vi.fn(), user = userEvent.setup(); render(<ModelManager rows={[row(), row('unknown/stt')]} language="en" busy={false} discoveryAvailability={{ openai: false, openrouter: true }} onEnabled={enabled} />);
    await user.click(screen.getByRole('button', { name: 'Show all models' })); const items = screen.getAllByRole('listitem'); const supported = within(items.find(item => item.textContent?.includes(mini))!).getByRole('checkbox'); expect((supported as HTMLInputElement).disabled).toBe(false);
    await user.click(supported); expect(enabled).toHaveBeenCalledWith(row().key, true);
    expect((within(items.find(item => item.textContent?.includes('unknown/stt'))!).getByRole('checkbox') as HTMLInputElement).disabled).toBe(true);
  });
  it.each(['en', 'ko'] as const)('renders %s managed presend with collapsed policy/model, measured bytes and applied hint', language => {
    const c = controller({ preferences: { ...defaultPreferences, uiLanguage: language }, onStartSTT: vi.fn() }); render(<App controller={c} />);
    expect(screen.getByText(language === 'en' ? 'Browser → OpenRouter → dynamically selected processor' : '브라우저 → OpenRouter → 동적으로 선택되는 처리 제공사')).toBeTruthy();
    expect(screen.getByText(language === 'en' ? 'Data collection denied · ZDR required' : '데이터 수집 거부 · ZDR 필수')).toBeTruthy();
    expect(screen.getByText(/1,234/)).toBeTruthy(); expect(screen.getByText(language === 'en' ? 'Automatic detection · multiple expected languages' : '자동 감지 · 여러 예상 언어')).toBeTruthy();
    expect(screen.getByText(/1,234/).closest('details')).toBeNull();
    expect(screen.queryByText(language === 'en' ? 'Preflight total' : '예상 총비용')).toBeNull();
    expect(screen.queryByText(language === 'en' ? 'Processor' : '처리 제공사', { exact: true })).toBeNull();
    expect(screen.getAllByText(/input-token/).length).toBeGreaterThan(0);
    expect((screen.getByRole('checkbox', { name: language === 'en' ? "I've reviewed the above" : '위 내용을 확인했어요' }) as HTMLInputElement).checked).toBe(false);
  });
  it.each(['policy', 'model', 'source'])('invalidates presend when %s changes and dispatches only fresh matching consent', async change => {
    const start = vi.fn(), c = controller({ onStartSTT: start }), user = userEvent.setup(), view = render(<App controller={c} />), check = screen.getByRole('checkbox', { name: "I've reviewed the above" }); await user.click(check);
    const next = { ...c, sttConsentToken: `changed-${change}`, ...(change === 'model' ? { sttModelId: whisper } : {}), ...(change === 'policy' ? { routerSTTSelection: { ...c.routerSTTSelection!, policy: { dataCollection: 'deny' as const, requireZdr: false } } } : {}), ...(change === 'source' ? { projects: [{ ...c.projects[0], sourceAssets: [{ ...c.projects[0].sourceAssets[0], fileName: 'SYNTHETIC_CHANGED.wav' }] }] } : {}) };
    view.rerender(<App controller={next} />); expect((check as HTMLInputElement).checked).toBe(false); expect((screen.getByRole('button', { name: 'Transcribe' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(check); await user.click(screen.getByRole('button', { name: 'Transcribe' }));
    expect(start).toHaveBeenCalledWith(c.projects[0].id, { acknowledged: true, modelId: next.sttModelId, consentToken: sttActionToken(next.sttConsentToken, next.projects[0], { purpose: 'initial', chunkIds: ['chunk'], modelId: next.sttModelId }) });
  });
  it('omits unavailable advertised pricing and unknown total while keeping a reviewed single hint', () => {
    const c = controller(); render(<App controller={{ ...c, routerSTTSelection: { ...c.routerSTTSelection!, rateSnapshot: null, appliedLanguage: 'sw', expectedLanguages: ['sw'] } }} />);
    expect(screen.queryByText('Advertised rates unavailable')).toBeNull(); expect(screen.getByText('Applied hint: sw')).toBeTruthy(); expect(screen.queryByText('Total cost unknown before sending')).toBeNull();
  });
  it('OR_STT_review uses frozen original retry languages after current expectations change with OR key alone', async () => {
    const c = controller(), p = c.projects[0], selection = c.routerSTTSelection!, retry = vi.fn();
    const batch = appendBatchAttempt(createSTTBatch(p, { purpose: 'initial', chunkIds: ['chunk'], modelId: mini, languages: p.audioOptions.expectedLanguages, route: row().route, routerSelection: selection }), 'failed-run');
    const failed = replaceSTTBatch({ ...p, audioOptions: { ...p.audioOptions, expectedLanguages: ['ja'] }, runs: [{ id: 'failed-run', projectId: p.id, state: 'outcome-unknown', checkpoint: null, intent: { kind: 'stt', chunkId: 'chunk', requestedModel: mini, expectedLanguages: ['ko', 'en'], requestedEndpoint: null, rateSnapshot: selection.rateSnapshot, sttBatchId: batch.id } }] }, batch);
    render(<App controller={{ ...c, projects: [failed], onRetrySTT: retry }} />); const user = userEvent.setup(); await user.click(screen.getByRole('button', { name: 'Retry latest attempt' })); const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText('Browser → OpenRouter → dynamically selected processor')).toBeTruthy(); expect(dialog.getAllByText('ko, en').length).toBeGreaterThan(0); expect(dialog.queryByText('ja')).toBeNull(); expect(dialog.queryByText(/Enter your OpenAI key/)).toBeNull(); const check = dialog.getByRole('checkbox'); expect((check as HTMLInputElement).checked).toBe(false);
    await user.click(check); expect((dialog.getByRole('button', { name: 'Transcribe' }) as HTMLButtonElement).disabled).toBe(false); await user.click(dialog.getByRole('button', { name: 'Transcribe' }));
    expect(retry.mock.calls[0][2]).toMatchObject({ modelId: mini, acknowledged: true, additionalChargeAcknowledged: true, batchId: batch.id });
  });
  it('labels saved raw provenance using its actual OR batch route', async () => {
    const c = controller(), p = c.projects[0], selection = c.routerSTTSelection!;
    const batch = appendBatchAttempt(createSTTBatch(p, { purpose: 'initial', chunkIds: ['chunk'], modelId: mini, languages: ['ko', 'en'], route: row().route, routerSelection: selection }), 'raw-run');
    const saved = replaceSTTBatch({ ...p, rawTranscripts: [{ id: 'raw', runId: 'raw-run', chunkId: 'chunk', text: 'TEST_ONLY_RAW_OR', response: { text: 'TEST_ONLY_RAW_OR' }, segments: [], timing: 'chunk', speakerScope: 'none', execution: null }],
      transcriptVersions: [{ id: 'version', parentId: null, batchId: batch.id, rawIds: ['raw'], segments: [], issues: [], missingRanges: [] }], selectedTranscriptVersionId: 'version',
      runs: [{ id: 'raw-run', projectId: p.id, state: 'saved', checkpoint: { id: 'checkpoint', projectId: p.id, runId: 'raw-run', committedAt: '2026-10-03T00:00:00Z', recordIds: [p.id] } }] }, batch);
    render(<App controller={{ ...c, projects: [saved] }} />); await userEvent.setup().click(screen.getByRole('button', { name: 'Review & edit full transcript' })); await userEvent.setup().click(screen.getByRole('button', { name: 'Raw by chunk' }));
    const raw = within(screen.getByText('Raw transcript #1').closest('section')!);
    expect(raw.getByText(/OpenRouter · dynamic processor/)).toBeTruthy(); expect(raw.queryByText(/Direct OpenAI/)).toBeNull();
  });

  it('projects the recorded OR requested route in the STT usage statement', async () => {
    const c = controller(), p = c.projects[0], selection = c.routerSTTSelection!;
    const batch = appendBatchAttempt(createSTTBatch(p, { purpose: 'initial', chunkIds: ['chunk'], modelId: mini, languages: ['ko', 'en'], route: row().route, routerSelection: selection }), 'usage-run');
    const attempted = replaceSTTBatch({ ...p, runs: [{ id: 'usage-run', projectId: p.id, state: 'outcome-unknown', checkpoint: null, intent: { kind: 'stt', chunkId: 'chunk', requestedModel: mini, expectedLanguages: ['ko', 'en'], requestedEndpoint: null, rateSnapshot: selection.rateSnapshot, sttBatchId: batch.id } }] }, batch);
    render(<App controller={{ ...c, projects: [attempted] }} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'View statement & request history →' }));
    const usage = within(screen.getByRole('region', { name: 'STT usage statement' }));
    expect(usage.getByText(/Recorded requested adapters\/models: OpenRouter/)).toBeTruthy(); expect(usage.queryByText(/Direct OpenAI/)).toBeNull();
  });

});
