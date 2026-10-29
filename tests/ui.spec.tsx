// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, useState } from 'react';
import App, { MeetingIcon, type AppController, type AppScreen, defaultPreferences } from '../src/react-app/App';
import { memoIcons } from '../src/react-app/settings/icons';
import type { MeetingProject } from '../src/react-app/domain/types';
import { previewMinutesSelection } from '../src/react-app/minutes/selection';
import { previewComparison } from '../src/react-app/minutes/compare';
import { parseRouterEndpoints, parseRouterModels } from '../src/react-app/providers/catalog';
import { resolveMinutesSettings } from '../src/react-app/minutes/preferences';
import { createModelPreset } from '../src/react-app/providers/model-profiles';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(cleanup);

it('renders the memo icon catalog with decorative Lucide icons and a safe fallback', () => {
  const ids = Object.keys(memoIcons);
  const { container } = render(<>{[...ids, 'unknown-legacy-icon'].map(icon => <MeetingIcon key={icon} icon={icon} color="#2B59C3" />)}</>);
  const icons = [...container.querySelectorAll('svg')];
  expect(icons).toHaveLength(ids.length + 1);
  expect(icons.every(icon => icon.classList.contains('lucide') && icon.getAttribute('aria-hidden') === 'true')).toBe(true);
  expect(icons.at(-1)!.classList.contains('lucide-mic')).toBe(true);
});

// Keyless UI fixtures remain in tests and are never loaded by the production entry point.
function meeting(): MeetingProject {
  return { id: 'test-meeting', title: 'Private test voice memo', icon: 'mic', color: '#3B82F6', pinned: false,
    createdAt: '2026-09-30T18:00:00.000Z', updatedAt: '2026-09-30T18:00:00.000Z', sourceAssets: [],
    audioOptions: { chunkMinutes: 10, overlapSeconds: 10, expectedLanguages: ['ko', 'en'], bitrateKbps: 32, sampleRateHz: 16000 },
    preparedChunks: [], rawTranscripts: [], transcriptVersions: [], selectedTranscriptVersionId: null,
    minutesSettings: { outputLanguage: 'ko', sections: ['summary', 'actions'], instructions: '', modelId: '' },
    minutesRuns: [], minutesRevisions: [], selectedMinutesRevisionId: null, runs: [] };
}
function controller(extra: Partial<AppController> = {}): AppController {
  return { session: 'unlocked', projects: [], selectedProjectId: null, screen: 'home', settingsTab: 'connections',
    preferences: { ...defaultPreferences, uiLanguage: 'en' }, defaultAudioOptions: meeting().audioOptions,
    modelCatalog: null, sttModelId: '', connections: [], storageEstimate: null, ...extra };
}
function Harness({ initial = meeting(), start = 'home' }: { initial?: MeetingProject; start?: AppScreen }) {
  const [projects, setProjects] = useState<readonly MeetingProject[]>([initial]);
  const [current, setCurrent] = useState<AppScreen>(start);
  const [selected, setSelected] = useState<string | null>(start === 'home' ? null : initial.id);
  return <App controller={controller({ projects, selectedProjectId: selected, screen: current,
    onNavigate: (next, id) => { setCurrent(next); if (id) setSelected(id); },
    onCreateMeeting: () => { const next = { ...meeting(), id: 'new-meeting', title: 'New test voice memo' }; setProjects([...projects, next]); setSelected(next.id); setCurrent('import'); },
    onUpdateMeeting: (id, patch) => setProjects(projects.map(p => p.id === id ? { ...p, ...patch } : p)),
    onDeleteMeeting: id => setProjects(projects.filter(p => p.id !== id)),
    onAudioOptions: (id, options) => setProjects(projects.map(p => p.id === id ? { ...p, audioOptions: options } : p)),
    onMinutesSettings: (id, settings) => setProjects(projects.map(p => p.id === id ? { ...p, minutesSettings: settings } : p)),
  })} />;
}

describe('reference UI navigation and local voice memo actions', () => {
  it('opens the same completed memo stage from Home and the sidebar without starting work', async () => {
    const p={...meeting(),transcriptVersions:[{id:'selected',parentId:null,rawIds:[],segments:[{id:'s',text:'Synthetic speech',sourceStartMs:0,sourceEndMs:1000,rawIds:[]}],issues:[],missingRanges:[]}],selectedTranscriptVersionId:'selected'};
    const onNavigate=vi.fn(),onGenerateMinutes=vi.fn(),onStartSTT=vi.fn(),user=userEvent.setup();
    render(<App controller={controller({projects:[p],screen:'home',onNavigate,onGenerateMinutes,onStartSTT})}/>);
    await user.click(screen.getByRole('button',{name:`Open ${p.title}`}));
    await user.click(screen.getByRole('button',{name:p.title}));
    expect(onNavigate.mock.calls).toEqual([['minutes',p.id],['minutes',p.id]]);
    expect(onGenerateMinutes).not.toHaveBeenCalled();expect(onStartSTT).not.toHaveBeenCalled();
  });
  it('saves a memo reasoning choice without generating and preserves an unsupported choice until replaced', async () => {
    const model = createModelPreset('openai-text'); const user = userEvent.setup();
    const p = { ...meeting(), minutesSettings: { ...meeting().minutesSettings, modelId: model.modelId, registrationId: model.id, reasoningEffort: 'minimal' } };
    const onMinutesSettings = vi.fn(), onGenerateMinutes = vi.fn();
    render(<App controller={controller({ screen: 'minutes', projects: [p], selectedProjectId: p.id, modelRegistrations: { version: 2, entries: [model] }, onMinutesSettings, onGenerateMinutes })} />);
    const select = screen.getByRole('combobox', { name: 'Reasoning effort for this run' });
    expect((select as HTMLSelectElement).value).toBe('minimal');
    expect(screen.getByText('Choose a supported effort or the model default.')).toBeTruthy();
    await user.selectOptions(select, 'high');
    expect(onMinutesSettings).toHaveBeenCalledWith(p.id, { ...p.minutesSettings, reasoningEffort: 'high' });
    expect(onGenerateMinutes).not.toHaveBeenCalled();
    await user.selectOptions(select, '');
    const { reasoningEffort: _ignored, ...defaults } = p.minutesSettings; void _ignored;
    expect(onMinutesSettings).toHaveBeenLastCalledWith(p.id, defaults);
  });
  it('opens one model manager from the legacy Settings route without discovery or connection calls', async () => {
    const onDiscover=vi.fn(), onSaveRegistration=vi.fn(async()=>{}), user=userEvent.setup();
    render(<App controller={controller({screen:'settings',onSaveRegistration,modelRegistrations:{version:2,entries:[]},modelManagement:{rows:[],language:'en',busy:false,discoveryAvailability:{openai:false,openrouter:true},onDiscover}})}/>);
    expect(screen.queryByRole('tab',{name:'Connections'})).toBeNull();expect(screen.getByRole('tab',{name:'Models'}).getAttribute('aria-selected')).toBe('true');
    await user.click(screen.getByRole('button',{name:'New model'}));expect(screen.getByLabelText('Full endpoint URL')).toBeTruthy();expect(onDiscover).not.toHaveBeenCalled();expect(onSaveRegistration).not.toHaveBeenCalled();
  });
  it('connected central model workflow identifies two enabled endpoints of the same model by immutable route key', async () => {
    const p = { ...meeting(), minutesSettings: { ...meeting().minutesSettings, modelId: 'fixture/shared' } }, onMinutesRoute = vi.fn();
    const routes = ['One/region', 'Two/region'].map((endpointTag, i) => ({ key: `actual-route-${i}`, modelId: 'fixture/shared', endpointTag, label: `Alias ${i} · fixture/shared · ${endpointTag}`, enabled: true }));
    render(<App controller={controller({ screen: 'minutes', projects: [p], selectedProjectId: p.id, minutesRoutes: routes, minutesRouteKey: routes[0].key, onMinutesRoute })} />);
    await userEvent.setup().selectOptions(screen.getByRole('combobox', {name:'Notes model'}), routes[1].key); expect(onMinutesRoute).toHaveBeenCalledWith(p.id, routes[1].key);
    expect(screen.queryByRole('searchbox', { name: 'Search models' })).toBeNull(); expect(screen.getAllByText(/Alias 0 · fixture\/shared · One\/region/)).toHaveLength(1);
  });
  it.each(['ko', 'en'] as const)('shows configured output languages and app-follow directly in %s', async language => {
    const user = userEvent.setup(), p = { ...meeting(), minutesSettings: { ...meeting().minutesSettings, outputLanguageMode: 'app' as const } }, onMinutesSettings = vi.fn();
    render(<App controller={controller({ preferences: { ...defaultPreferences, uiLanguage: language }, projects: [p], selectedProjectId: p.id, screen: 'minutes', onMinutesSettings, selectionLists: { icons: ['mic'], colors: ['#3B82F6'], languages: [{code:'sw',name:'Kiswahili'},{code:'fr',name:'Français'}] } })} />);
    const select = screen.getByRole('combobox', {name:language === 'en' ? 'Output language' : '출력 언어'});
    expect(select.closest('details')).toBeNull(); expect((select as HTMLSelectElement).value).toBe('__app');
    expect(within(select).getByRole('option',{name:'Kiswahili'})).toBeTruthy(); expect(within(select).queryByRole('option',{name:'日本語'})).toBeNull();
    await user.selectOptions(select,'sw'); expect(onMinutesSettings).toHaveBeenLastCalledWith(p.id, {...p.minutesSettings,outputLanguageMode:'explicit',outputLanguage:'sw'});
  });
  it('shows a legacy custom language as an explicit free-form override and lets the user opt into app language', async () => {
    const user = userEvent.setup(), p = { ...meeting(), minutesSettings: { ...meeting().minutesSettings, outputLanguage: 'zh-Hant-custom' } }, onMinutesSettings = vi.fn(); const view = render(<App controller={controller({ projects: [p], selectedProjectId: p.id, screen: 'minutes', onMinutesSettings })} />);
    const follow = screen.getByRole('combobox', { name: 'Output language' }); expect((follow as HTMLSelectElement).value).toBe('__custom'); expect((screen.getByLabelText('Notes language') as HTMLInputElement).value).toBe('zh-Hant-custom');
    fireEvent.change(screen.getByLabelText('Notes language'), { target: { value: 'ar-private-code' } }); expect(onMinutesSettings).not.toHaveBeenCalled(); await user.click(screen.getByRole('button', { name: 'Apply language' })); expect(onMinutesSettings).toHaveBeenLastCalledWith(p.id, { ...p.minutesSettings, outputLanguageMode: 'explicit', outputLanguage: 'ar-private-code' });
    const applied = { ...p, minutesSettings: { ...p.minutesSettings, outputLanguageMode: 'explicit' as const, outputLanguage: 'ar-private-code' } }; view.rerender(<App controller={controller({ projects: [applied], selectedProjectId: p.id, screen: 'minutes', onMinutesSettings })} />);
    await user.selectOptions(follow, '__app'); expect(onMinutesSettings).toHaveBeenLastCalledWith(p.id, { ...applied.minutesSettings, outputLanguageMode: 'app' });
  });
  it('keeps keyboard-typed language as an unapplied draft until one explicit encrypted-save action', async () => {
    const user = userEvent.setup(), p = meeting(), onMinutesSettings = vi.fn(); render(<App controller={controller({ projects: [p], selectedProjectId: p.id, screen: 'minutes', onMinutesSettings })} />);
    await user.selectOptions(screen.getByLabelText('Output language'), '__custom');
    const input = screen.getByLabelText('Notes language'); await user.clear(input); await user.type(input, 'zh-Hant-keyboard'); expect((input as HTMLInputElement).value).toBe('zh-Hant-keyboard'); expect(onMinutesSettings).not.toHaveBeenCalled();
    expect(screen.getByText('This language edit is retained as a draft. Apply to save this memo’s language setting.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Apply language' })); expect(onMinutesSettings).toHaveBeenCalledTimes(1); expect(onMinutesSettings).toHaveBeenCalledWith(p.id, { ...p.minutesSettings, outputLanguageMode: 'explicit', outputLanguage: 'zh-Hant-keyboard' });
  });
  it.each(['app', 'legacy'] as const)('compares saved output with the effective current %s language without rewriting it', mode => {
    const p = { ...meeting(), minutesSettings: { ...meeting().minutesSettings, outputLanguage: mode === 'app' ? 'ko' : 'zh-Hant-custom', ...(mode === 'app' ? { outputLanguageMode: 'app' as const } : {}) } };
    const usage = { inputTokens: null, outputTokens: null, durationSeconds: null, audioInputTokens: null, textInputTokens: null, audioOutputTokens: null, textOutputTokens: null, elapsedMs: 0, cost: null, costKind: 'unavailable' as const, currency: null, rateSource: null, rateCheckedAt: null, rateSnapshot: null };
    const run = { id: 'saved-language-run', transcriptVersionId: 'selected-speech', settings: resolveMinutesSettings(p.minutesSettings, 'en'), generatedMarkdown: '# ORIGINAL_SAVED_LANGUAGE_OUTPUT', requestedModel: '', returnedModel: null, actualProvider: null, usage };
    const saved = { ...p, minutesRuns: [run], minutesRevisions: [{ id: 'saved-language-output', runId: run.id, parentId: null, markdown: run.generatedMarkdown }], selectedMinutesRevisionId: 'saved-language-output' };
    const c = controller({ projects: [saved], selectedProjectId: p.id, screen: 'minutes' }), view = render(<App controller={c} />);
    expect(screen.queryByText('Settings changed. Regenerate to create a new result from the same transcript.')).toBeNull();
    view.rerender(<App controller={{ ...c, preferences: { ...c.preferences, uiLanguage: 'ko' } }} />);
    expect(!!screen.queryByText('설정이 바뀌었어요. 재생성하면 같은 전사문으로 새 결과를 만들어요.')).toBe(mode === 'app'); expect(screen.getByText('ORIGINAL_SAVED_LANGUAGE_OUTPUT')).toBeTruthy(); expect(saved.minutesRuns[0].settings.outputLanguage).toBe(mode === 'app' ? 'en' : 'zh-Hant-custom');
  });
  it.each(['single', 'comparison', 'retry'] as const)('blocks %s dispatch for an unapplied language draft and requires fresh consent after Discard', async kind => {
    const at = '2026-10-02T00:00:00Z', models = parseRouterModels({ data: ['a', 'b'].map(id => ({ id: `fixture/language-${id}`, name: id, context_length: 8000, top_provider: { max_completion_tokens: 2000 }, supported_parameters: ['max_tokens'], architecture: { input_modalities: ['text'], output_modalities: ['text'] }, pricing: { prompt: '0', completion: '0', request: '0' } })) }, at);
    const endpoints = models.map(m => parseRouterEndpoints({ data: { endpoints: [{ tag: `Synthetic/${m.id}`, provider_name: 'Synthetic fixture', context_length: 8000, max_prompt_tokens: 6000, max_completion_tokens: 2000, supported_parameters: ['max_tokens'], pricing: { prompt: '0', completion: '0', request: '0' } }] } }, m.id, at)[0]);
    const version = { id: 'language-speech', parentId: null, rawIds: [], segments: [{ id: 's', text: 'SYNTHETIC_LANGUAGE_SPEECH', sourceStartMs: 0, sourceEndMs: 1000, rawIds: [] }], issues: [], missingRanges: [] }, p = { ...meeting(), transcriptVersions: [version], selectedTranscriptVersionId: version.id, minutesSettings: { ...meeting().minutesSettings, outputLanguageMode: 'explicit' as const, modelId: models[0].id } };
    const record = { id: 'language-comparison', projectId: p.id, createdAt: at, inputSignature: 'fixture-language', promptVersion: 'fixture-language', transcript: version, settings: p.minutesSettings, messages: [], outputTokens: 2000, reasoningReserveTokens: 0, members: models.map((m, i) => ({ modelId: m.id, endpointTag: endpoints[i].tag, providerName: 'Synthetic fixture', selectionSnapshot: {}, attempts: [] })) as unknown as NonNullable<MeetingProject['minutesComparisons']>[number]['members'] };
    const onGenerateMinutes = vi.fn(), onGenerateComparison = vi.fn(), onMinutesSettings = vi.fn(), c = controller({ projects: [{ ...p, ...(kind === 'retry' ? { minutesComparisons: [record] } : {}) }], selectedProjectId: p.id, screen: 'minutes', modelCatalog: models.map(m => ({ id: m.id, label: m.name, provider: 'openrouter', kind: 'minutes', enabled: true })), minutesEndpointTag: endpoints[0].tag, minutesEndpoints: [{ tag: endpoints[0].tag, label: 'Synthetic fixture', enabled: true }], minutesConsentToken: 'single-language-consent', minutesSelection: previewMinutesSelection({ model: models[0], endpoint: endpoints[0], messages: [{ role: 'user', content: 'fixture' }], outputTokens: 2000, reasoningReserveTokens: 0 }), comparisonOpen: kind !== 'single', comparisonConsentToken: 'comparison-language-consent', minutesComparison: previewComparison({ transcript: version, settings: p.minutesSettings, choices: [{ model: models[0], endpoint: endpoints[0] }, { model: models[1], endpoint: endpoints[1] }] }), comparisonRetryMember: kind === 'retry' ? 0 : null, selectedComparisonId: kind === 'retry' ? record.id : null, onMinutesSettings, onGenerateMinutes, onGenerateComparison });
    render(<App controller={c} />); const user = userEvent.setup(), ackName = kind === 'single' ? 'I understand that the selected transcript and settings will be sent, and charges may apply. Audio will not be sent again.' : kind === 'retry' ? 'I approve this member retry, transmission and possible additional charge' : 'I approve two sequential requests, transmission and charges', actionName = kind === 'single' ? 'Generate notes' : kind === 'retry' ? 'Retry member A' : 'Compare two models';
    const ack = screen.getByRole('checkbox', { name: ackName }), action = screen.getByRole('button', { name: actionName }); await user.click(ack); expect((action as HTMLButtonElement).disabled).toBe(false);
    await user.selectOptions(screen.getByLabelText('Output language'), '__custom');
    fireEvent.change(screen.getByLabelText('Notes language'), { target: { value: 'fr-local-draft' } }); expect((action as HTMLButtonElement).disabled).toBe(true); expect((ack as HTMLInputElement).checked).toBe(false); await user.click(action); expect(onGenerateMinutes).not.toHaveBeenCalled(); expect(onGenerateComparison).not.toHaveBeenCalled(); expect(onMinutesSettings).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Discard language edit' })); expect((screen.getByLabelText('Output language') as HTMLSelectElement).value).toBe('ko'); expect((action as HTMLButtonElement).disabled).toBe(true); expect((ack as HTMLInputElement).checked).toBe(false); await user.click(ack); expect((action as HTMLButtonElement).disabled).toBe(false);
  });
  it('presents exactly three workflow stages with no separate mandatory review stage', () => {
    render(<Harness start="import" />);
    const stages = within(screen.getByRole('navigation', { name: 'Memo steps' })).getAllByRole('button');
    expect(stages.map(stage => stage.textContent?.replace(/^\d+/, ''))).toEqual(['Prepare audio', 'Transcribe', 'Organize memo']);
    expect(within(screen.getByRole('navigation', { name: 'Memo steps' })).queryByRole('button', { name: /Review/ })).toBeNull();
  });
  it('starts empty with no sample voice memos, fabricated usage or unlocked content', () => {
    render(<App />);
    expect(screen.queryByText('3분기 제품 로드맵 음성 메모')).toBeNull();
    expect(screen.getByRole('heading', { name: '새 보관함 만들기' })).toBeTruthy();
    expect(screen.queryByRole('main')).toBeNull();
    expect(screen.queryByText('356 MB')).toBeNull();
  });
  it('offers the three workflow screens plus brand Home and Settings and focuses the screen heading after keyboard navigation', async () => {
    const user = userEvent.setup(); render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open Private test voice memo' }));
    expect(screen.getByRole('heading', { name: 'Private test voice memo' })).toBeTruthy();
    for (const name of ['Transcribe', 'Organize memo', 'Prepare audio']) {
      const step = within(screen.getByRole('navigation', { name: 'Memo steps' })).getByRole('button', { name: new RegExp(name.replace('&', '\\&')) });
      step.focus(); await user.keyboard('{Enter}');
      expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Private test voice memo' }));
    }
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Minutes of Meeting' }));
    expect(screen.getByRole('heading', { name: 'Voice memos' })).toBeTruthy();
  });
  it('shows source duration beside sidebar titles and uses Recent or the brand for home navigation', async () => {
    const user = userEvent.setup(), onNavigate = vi.fn();
    const projects = Array.from({ length: 7 }, (_, index) => ({ ...meeting(), id: `memo-${index}`, title: `SYNTHETIC sidebar memo ${index}`, updatedAt: `2026-10-${17 - index}T00:00:00Z`,
      sourceAssets: index === 0 ? [{ id: 'source', fileName: 'SYNTHETIC.wav', bytes: 32044, container: 'wav', codec: 'pcm', durationMs: 5401000, channels: 1, sampleRateHz: 16000 }] : [] }));
    const c = controller({ projects, selectedProjectId: projects[0].id, screen: 'import', onNavigate });
    const view = render(<App controller={c} />), sidebar = within(screen.getByRole('complementary'));
    const memo = sidebar.getByRole('button', { name: projects[0].title });
    expect(within(memo).getByText('90:01')).toBeTruthy();
    expect(memo.getAttribute('aria-describedby')).toBe(within(memo).getByText('90:01').id);
    expect(within(sidebar.getByRole('button', { name: projects[1].title })).queryByText(/Total duration/)).toBeNull();
    expect(sidebar.getAllByRole('button').filter(button => button.classList.contains('side-meeting'))).toHaveLength(5);
    expect(sidebar.queryByRole('button', { name: 'Home' })).toBeNull();
    const recent = sidebar.getByRole('button', { name: 'Recent 5' }), brand = sidebar.getByRole('button', { name: 'Minutes of Meeting' });
    await user.click(recent); await user.click(brand); expect(onNavigate.mock.calls).toEqual([['home'], ['home']]);
    view.rerender(<App controller={{ ...c, busy: true }} />);
    expect((recent as HTMLButtonElement).disabled).toBe(true); expect((brand as HTMLButtonElement).disabled).toBe(true);
    view.rerender(<App controller={{ ...c, busy: true, recordingActive: true }} />);
    expect((recent as HTMLButtonElement).disabled).toBe(false); expect((brand as HTMLButtonElement).disabled).toBe(false);
  });
  it('creates, renames, pins and explicitly confirms deletion', async () => {
    const user = userEvent.setup(); render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Rename Private test voice memo' }));
    const input = screen.getByRole('textbox', { name: 'Memo title' });
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute('autocomplete')).toBe('off');
    await user.clear(input); await user.type(input, 'Renamed test voice memo{Enter}');
    await user.click(screen.getByRole('button', { name: 'Pin Renamed test voice memo' }));
    expect(screen.getByRole('button', { name: 'Unpin Renamed test voice memo' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Delete Renamed test voice memo' }));
    expect(screen.getByText(/This can't be undone/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Confirm delete Renamed test voice memo' }));
    expect(screen.queryByText('Renamed test voice memo')).toBeNull();
    await user.click(screen.getByRole('button', { name: '+ New voice memo' }));
    expect(screen.getByRole('heading', { name: 'New test voice memo' })).toBeTruthy();
  });
});

describe('import configuration', () => {
  it('groups recording and upload tabs before preparation without dispatching STT', async () => {
    const user = userEvent.setup(), p = meeting();
    const onPrepareAudio = vi.fn(), onStartSTT = vi.fn(), onNavigate = vi.fn(), onCreateMeeting = vi.fn();
    const c = controller({ projects: [p], selectedProjectId: p.id, screen: 'import', onPrepareAudio, onStartSTT, onNavigate, onCreateMeeting,
      recording: { projectId: p.id, language: 'en', supported: true, startBlockedReason: null, pendingAction: null,
        snapshot: { state: 'idle', sampleRateHz: null, acceptedSamples: 0, committedSamples: 0, bodyBytes: 0, committedBytes: 0, durationMs: 0, inputLevel: 0, source: null, error: null },
        onStart: vi.fn(), onPause: vi.fn(), onResume: vi.fn(), onStop: vi.fn(), onAbort: vi.fn() } });
    const view = render(<App controller={c} />);
    const names = ['Memo details', 'Add audio', 'Prepare transcription'];
    const regions = names.map(name => screen.getByRole('region', { name }));
    for (let i = 1; i < regions.length; i++) expect(regions[i - 1].compareDocumentPosition(regions[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const recordTab = screen.getByRole('tab', { name: 'Microphone recording' });
    const uploadTab = screen.getByRole('tab', { name: 'File upload' });
    expect(uploadTab.getAttribute('aria-selected')).toBe('true');
    expect(recordTab.getAttribute('aria-selected')).toBe('false');
    expect(c.recording!.onStart).not.toHaveBeenCalled();
    uploadTab.focus(); await user.keyboard('{Home}');
    expect(document.activeElement).toBe(recordTab); expect(recordTab.getAttribute('aria-selected')).toBe('true');
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(uploadTab); expect(uploadTab.getAttribute('aria-selected')).toBe('true');
    const actions = screen.getByRole('region', { name: 'Prepare transcription' });
    const prepare = within(actions).getByRole('button', { name: 'Prepare transcription' }) as HTMLButtonElement;
    const transcribe = within(actions).getByRole('button', { name: 'Transcribe →' }) as HTMLButtonElement;
    expect(prepare.disabled).toBe(true); expect(transcribe.disabled).toBe(true);
    await user.click(transcribe); expect(onNavigate).not.toHaveBeenCalled();
    const source = { id: 'source', fileName: 'SYNTHETIC.wav', bytes: 32044, container: 'wav', codec: 'pcm', durationMs: 1000, channels: 1, sampleRateHz: 16000 };
    const selected = { ...p, sourceAssets: [source], retainedAudio: { sourceIds: ['source'], chunkIds: [] } };
    view.rerender(<App controller={{ ...c, projects: [selected] }} />);
    await user.click(recordTab);
    const panel = screen.getByRole('tabpanel', { name: 'Microphone recording' });
    expect(within(panel).queryByRole('meter')).toBeNull();
    expect(within(panel).queryByRole('button', { name: 'Start recording' })).toBeNull();
    await user.click(within(panel).getByRole('button', { name: 'New voice memo' }));
    expect(onCreateMeeting).toHaveBeenCalledOnce(); expect(c.recording!.onStart).not.toHaveBeenCalled();
    expect(within(actions).getByText(source.fileName)).toBeTruthy();
    expect(prepare.disabled).toBe(false); expect(transcribe.disabled).toBe(true);
    await user.click(prepare); expect(onPrepareAudio).toHaveBeenCalledWith(p.id);
    const prepared = { ...selected, preparedChunks: [{ id: 'chunk', sourceId: 'source', index: 0, sourceStartMs: 0, sourceEndMs: 1000, encodingOffsetMs: 0, encodedBytes: 4000, mimeType: 'audio/mpeg', codec: 'mp3', audioRecordId: 'audio' }], retainedAudio: { sourceIds: ['source'], chunkIds: ['chunk'] } };
    view.rerender(<App controller={{ ...c, projects: [prepared] }} />);
    expect(prepare.disabled).toBe(true); expect(transcribe.disabled).toBe(false);
    await user.click(transcribe); expect(onNavigate).toHaveBeenCalledWith('stt', p.id); expect(onStartSTT).not.toHaveBeenCalled();
    view.rerender(<App controller={{ ...c, projects: [prepared], busy: true }} />);
    expect(transcribe.disabled).toBe(true); expect((recordTab as HTMLButtonElement).disabled).toBe(true);
  });
  it('keeps title typing focused during its own encrypted autosave and blocks unrelated work', () => {
    const p = meeting(); const onUpdateMeeting = vi.fn();
    const c = controller({ projects: [p], selectedProjectId: p.id, screen: 'import', onUpdateMeeting });
    const { rerender } = render(<App controller={c} />);
    const title = screen.getByRole('textbox', { name: /^Memo title/ }) as HTMLInputElement;
    title.focus();
    rerender(<App controller={{ ...c, busy: true, meetingEditsSaving: true }} />);
    expect(title.disabled).toBe(false); expect(document.activeElement).toBe(title);
    fireEvent.change(title, { target: { value: 'Complete native title' } });
    expect(onUpdateMeeting).toHaveBeenCalledWith(p.id, { title: 'Complete native title' });
    rerender(<App controller={{ ...c, busy: true, meetingEditsSaving: false }} />);
    expect(title.disabled).toBe(true);
  });
  it('disables native workflow and sidebar navigation while busy and keeps lock available', () => {
    const p = meeting(); const onNavigate = vi.fn(), onLock = vi.fn();
    render(<App controller={controller({ projects: [p], selectedProjectId: p.id, screen: 'import', busy: true, onNavigate, onLock })} />);
    for (const button of [...within(screen.getByRole('navigation', { name: 'Memo steps' })).getAllByRole('button'),
      ...within(screen.getByRole('complementary', { name: 'Voice memo navigation' })).getAllByRole('button').filter(button => button.textContent !== 'Lock screen' && button.textContent !== 'Settings' && button.getAttribute('aria-label') !== 'Navigation menu')]) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
    const settings=screen.getByRole('button',{name:'Settings'});expect((settings as HTMLButtonElement).disabled).toBe(false);fireEvent.click(settings);expect(onNavigate).toHaveBeenCalledWith('settings');
    const lock = screen.getByRole('button', { name: 'Lock screen' });
    expect((lock as HTMLButtonElement).disabled).toBe(false); fireEvent.click(lock); expect(onLock).toHaveBeenCalledOnce();
  });
  it.each(['ko', 'en'] as const)('uses approved empty copy and a keyboard-accessible collapsed language explanation: %s', async uiLanguage => {
    const user = userEvent.setup(); const p = meeting();
    render(<App controller={controller({ projects: [p], selectedProjectId: p.id, screen: 'import', preferences: { ...defaultPreferences, uiLanguage } })} />);
    expect(screen.getByText(uiLanguage === 'ko' ? '음성 파일이 준비되지 않았어요' : 'No audio file is ready yet')).toBeTruthy();
    const summary = screen.getByText(uiLanguage === 'ko' ? '언어 안내' : 'Language guidance', { selector: 'summary' });
    const details = summary.closest('details')!;
    expect(details).toBeTruthy(); expect(details.hasAttribute('open')).toBe(false);
    expect(within(details).getByText(uiLanguage === 'ko' ? '전사 모델 선택 후 확인' : 'Choose a transcription model')).toBeTruthy();
    summary.focus(); expect(document.activeElement).toBe(summary);
    await user.click(summary); expect(details.hasAttribute('open')).toBe(true);
    await user.click(summary); expect(details.hasAttribute('open')).toBe(false);
    expect(screen.getByRole('group', { name: uiLanguage === 'ko' ? '사용 언어 · 복수 선택' : 'Spoken languages · select multiple' })).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: uiLanguage === 'ko' ? '위 내용을 확인했어요' : "I've reviewed the above" })).toBeNull();
    expect(screen.queryByText(uiLanguage === 'ko' ? '보내지 않는 것' : 'Not sent')).toBeNull();
  });
  it('keeps native preview usable through effect replay and source changes while cleaning up without autoplay', () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    const load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    try {
      const p = { ...meeting(), retainedAudio: { sourceIds: ['native-source'], chunkIds: [] }, sourceAssets: [{ id: 'native-source', fileName: 'synthetic.wav', bytes: 32044, container: 'wav', codec: 'pcm', durationMs: 1000, channels: 1, sampleRateHz: 16000 }] };
      const c = controller({ projects: [p], selectedProjectId: p.id, screen: 'import', sourcePreviewUrl: 'blob:synthetic-one' });
      const { rerender, unmount } = render(<StrictMode><App controller={c} /></StrictMode>);
      const audio = screen.getByLabelText('Source audio preview');
      expect(audio.getAttribute('src')).toBe('blob:synthetic-one');
      rerender(<StrictMode><App controller={{ ...c, sourcePreviewUrl: 'blob:synthetic-two' }} /></StrictMode>);
      const replacement = screen.getByLabelText('Source audio preview');
      expect(audio.getAttribute('src')).toBeNull(); expect(replacement.getAttribute('src')).toBe('blob:synthetic-two'); expect(play).not.toHaveBeenCalled();
      unmount(); expect(replacement.getAttribute('src')).toBeNull(); expect(pause).toHaveBeenCalled(); expect(load).toHaveBeenCalled();
    } finally { cleanup(); pause.mockRestore(); load.mockRestore(); play.mockRestore(); }
  });
  it('surfaces indeterminate real file inspection without estimating a percentage', () => {
    const p = meeting(); render(<App controller={controller({ projects: [p], selectedProjectId: p.id, screen: 'import', preparation: { stage: 'inspecting', completed: 0, total: null }, busy: true })} />);
    const panel=screen.getByRole('region',{name:'Local audio preparation'});
    expect(within(panel).getByText('Inspecting audio file locally…')).toBeTruthy();
    const progress=within(panel).getByRole('progressbar', { name: 'Inspection audio processed:' });expect(progress.hasAttribute('value')).toBe(false);expect(progress.closest('details')).toBeNull();
  });
  it('selects all processing defaults exactly for future voice memos', async () => {
    const user = userEvent.setup(); const onDefaultAudioOptions = vi.fn(); const c = controller({ screen: 'settings', settingsTab: 'defaults', onDefaultAudioOptions });
    render(<App controller={c} />);
    for (const value of [5, 10, 15]) {
      await user.click(within(screen.getByRole('group', { name: 'Default chunk length' })).getByRole('button', { name: `${value} min` }));
      expect(onDefaultAudioOptions).toHaveBeenLastCalledWith({ ...c.defaultAudioOptions, chunkMinutes: value });
      await user.click(within(screen.getByRole('group', { name: 'Default overlap' })).getByRole('button', { name: `${value} s` }));
      expect(onDefaultAudioOptions).toHaveBeenLastCalledWith({ ...c.defaultAudioOptions, overlapSeconds: value });
    }
  });
  it('offers exact five, ten and fifteen minute/second controls without changing legacy selections', async () => {
    const user = userEvent.setup(); render(<Harness start="import" />);
    await user.click(screen.getByText('Chunks & compression').closest('summary')!);
    const lengths = screen.getByRole('group', { name: 'Chunk length' });
    const overlaps = screen.getByRole('group', { name: 'Overlap' });
    expect(within(lengths).getAllByRole('button').map(button => button.textContent)).toEqual(['5 min', '10 min', '15 min']);
    expect(within(lengths).getByRole('button', { name: '10 min' }).getAttribute('aria-pressed')).toBe('true');
    await user.click(within(lengths).getByRole('button', { name: '5 min' }));
    await user.click(within(overlaps).getByRole('button', { name: '5 s' }));
    await user.click(screen.getByRole('button',{name:'Apply changes'}));
    expect(screen.getByText(/5 min · 5 s overlap/)).toBeTruthy();
  });
  it('allows encoding drafts after raw transcripts while keeping language hints editable', async () => {
    const user = userEvent.setup(); const p = { ...meeting(), rawTranscripts: [{ id: 'raw', chunkId: 'chunk', runId: 'run', text: 'Completed fixture', response: {}, segments: [], timing: 'chunk' as const, speakerScope: 'none' as const, execution: null }] };
    const onAudioOptions = vi.fn(),onPlanPreparationReset=vi.fn();
    render(<App controller={controller({ projects: [p], selectedProjectId: p.id, screen: 'import', onAudioOptions,onPlanPreparationReset })} />);
    await user.click(screen.getByText('Chunks & compression').closest('summary')!);
    for (const group of ['Chunk length', 'Overlap']) {
      expect(within(screen.getByRole('group', { name: group })).getAllByRole('button').every(button => (button as HTMLButtonElement).disabled)).toBe(false);
    }
    expect((screen.getByRole('button', { name: 'Reset to defaults' }) as HTMLButtonElement).disabled).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Advanced ▸' }));
    expect((screen.getByRole('combobox', { name: 'Bitrate' }) as HTMLSelectElement).disabled).toBe(false);
    expect((screen.getByRole('combobox', { name: 'Sample rate' }) as HTMLSelectElement).disabled).toBe(false);
    expect(screen.getByText(/Applying chunk or compression changes requires confirmation/)).toBeTruthy();
    await user.click(within(screen.getByRole('group', { name: 'Spoken languages · select multiple' })).getByRole('button', { name: /日本語/ }));
    expect(onAudioOptions).toHaveBeenCalledWith(p.id, { ...p.audioOptions, expectedLanguages: ['ko', 'en', 'ja'] });
  });
  it.each(['en', 'ko'] as const)('retains the original and completed work and blocks replacement (%s)', async uiLanguage => {
    const user = userEvent.setup(); const p = { ...meeting(), retainedAudio: { sourceIds: ['retained-source'], chunkIds: [] }, sourceAssets: [{ id: 'retained-source', fileName: 'original.wav', bytes: 4, container: 'wav', codec: 'pcm', durationMs: 1000, channels: 1, sampleRateHz: 16000 }],
      rawTranscripts: [{ id: 'saved-raw', chunkId: 'saved-chunk', runId: 'saved-run', text: 'Completed fixture transcript', response: {}, segments: [], timing: 'chunk' as const, speakerScope: 'none' as const, execution: null }] };
    const onPickFile = vi.fn(), onClearFile = vi.fn();
    const c = controller({ projects: [p], selectedProjectId: p.id, screen: 'import', preferences: { ...defaultPreferences, uiLanguage }, onPickFile, onClearFile,sourcePreviewUrl:'blob:synthetic-retained' });
    const { rerender } = render(<App controller={c} />);
    const upload = screen.getByRole('tabpanel', { name: uiLanguage === 'ko' ? '파일 업로드' : 'File upload' });
    expect(within(upload).getByText('original.wav')).toBeTruthy();expect(within(upload).getByText('4 B')).toBeTruthy();
    const replace=within(upload).getByRole('button',{name:uiLanguage==='ko'?'교체':'Replace'}) as HTMLButtonElement;
    expect(replace.disabled).toBe(true);await user.click(replace);expect(onPickFile).not.toHaveBeenCalled();expect(onClearFile).not.toHaveBeenCalled();
    const details=screen.getByText(uiLanguage==='ko'?'음성 정보·미리듣기':'Audio details & playback',{selector:'summary'});await user.click(details);
    expect(screen.getByLabelText(uiLanguage==='ko'?'원본 음성 미리듣기':'Source audio preview').getAttribute('src')).toBe('blob:synthetic-retained');
    expect(p.sourceAssets[0].id).toBe('retained-source');expect(p.rawTranscripts[0].id).toBe('saved-raw');
    rerender(<App controller={{ ...c, busy: true }} />);expect(replace.disabled).toBe(true);
  });
  it('keeps multiple and legacy spoken languages and uses minute/second units', async () => {
    const base = meeting(), initial = { ...base, audioOptions: { ...base.audioOptions, expectedLanguages: ['ko', 'en', 'sw'] } };
    const user = userEvent.setup(); render(<Harness initial={initial} start="import" />);
    const languages = screen.getByRole('group', { name: 'Spoken languages · select multiple' });
    expect(within(languages).getByRole('button', { name: /한국어/ }).getAttribute('aria-pressed')).toBe('true');
    await user.click(within(languages).getByRole('button', { name: /日本語/ }));
    expect(within(languages).getByRole('button', { name: /English/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('textbox', { name: 'Additional language code' })).toBeNull();
    expect(within(languages).getByRole('button', { name: /sw/ }).getAttribute('aria-pressed')).toBe('true');
    await user.click(screen.getByText('Chunks & compression').closest('summary')!);
    await user.click(within(screen.getByRole('group', { name: 'Chunk length' })).getByRole('button', { name: '15 min' }));
    await user.click(within(screen.getByRole('group', { name: 'Overlap' })).getByRole('button', { name: '15 s' }));
    await user.click(screen.getByRole('button',{name:'Apply changes'}));
    expect(screen.getByText(/15 min · 15 s overlap/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Prepare transcription' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('does not enable transmission without a supported model, a file, acknowledgment and an action', async () => {
    const user = userEvent.setup(); render(<Harness start="stt" />);
    await user.click(screen.getByRole('checkbox', { name: "I've reviewed the above" }));
    expect((screen.getByRole('button', { name: 'Transcribe' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('combobox', { name: 'Transcription model' }).querySelectorAll('option')).toHaveLength(1);
    expect(screen.getByRole('option', { name: 'No compatible model selected' })).toBeTruthy();
  });
});

describe('transcript and notes state', () => {
  it.each(['ko', 'en'] as const)('separates real source time from encrypted chunk receipts and external requests: %s', uiLanguage => {
    const p = meeting(); const c = controller({ projects: [p], selectedProjectId: p.id, screen: 'import', preferences: { ...defaultPreferences, uiLanguage }, busy: true,
      preparation: { stage: 'preparing', sourceProcessedMs: 1234, durationMs: 300000, completed: 0, total: 2, savedEncodedBytes: 0 } });
    const { rerender } = render(<App controller={c} />);
    const label = uiLanguage === 'ko' ? '로컬 음성 처리 시간' : 'Local source time processed';
    expect(screen.getByRole('progressbar', { name: label }).getAttribute('value')).toBe('1234');
    expect(screen.getByRole('progressbar', { name: label }).getAttribute('max')).toBe('300000');
    expect(screen.getByText(uiLanguage === 'ko' ? '암호화 저장된 음성 청크: 0 / 계획 2' : 'Encrypted audio chunks saved: 0 / planned 2')).toBeTruthy();
    const bytes = screen.getByText(uiLanguage === 'ko' ? '청크 용량: 0 B' : 'Chunk size: 0 B');
    const details=bytes.closest('details')!;expect(details.open).toBe(false);fireEvent.click(within(details).getByText(uiLanguage==='ko'?'자세히 보기':'Show details',{selector:'summary'}));expect(details.open).toBe(true);
    rerender(<App controller={{ ...c, preparation: { ...c.preparation!, stage: 'saving', sourceProcessedMs: 300000 } }} />);
    expect(screen.getByText(uiLanguage === 'ko' ? '음성 청크 암호화 저장 중…' : 'Saving encrypted audio chunk…')).toBeTruthy();
    expect(screen.queryByText(uiLanguage === 'ko' ? '로컬 음성 준비 완료' : 'Local audio preparation complete')).toBeNull();
    rerender(<App controller={{ ...c, preparation: { stage: 'preparing', completed: 0, total: null } }} />);
    expect(screen.getByRole('progressbar', { name: label }).hasAttribute('value')).toBe(false);
    expect(screen.getByRole('progressbar', { name: label }).hasAttribute('max')).toBe(false);
  });
  it.each(['pricing', 'compatibility', 'limits'] as const)('keeps a blocked saved route outside optional details and excludes conflicting catalog candidates: %s', mode => {
    const p = { ...meeting(), minutesSettings: { ...meeting().minutesSettings, modelId: 'fixture/conflict' } }, row = { key: `blocked-${mode}`, modelId: 'fixture/conflict', endpointTag: 'Saved/route', label: 'fixture/conflict · Saved/route · blocked', enabled: false }, onMinutesRoute = vi.fn(), onGenerateMinutes = vi.fn();
    render(<App controller={controller({ projects: [p], selectedProjectId: p.id, screen: 'minutes', minutesRoutes: [row], minutesRouteKey: row.key, modelCatalog: ['First candidate', 'Later candidate'].map(label => ({ id: p.minutesSettings.modelId, label, provider: 'openrouter', kind: 'minutes', enabled: false })), onMinutesRoute, onGenerateMinutes })} />);
    const select = screen.getByRole('combobox', {name:'Notes model'}) as HTMLSelectElement; expect(select.value).toBe(row.key); expect(within(select).getAllByRole('option')).toHaveLength(2); expect((within(select).getByRole('option', { name: row.label }) as HTMLOptionElement).disabled).toBe(true);
    const warning = screen.getByText('The saved route is retained. Enable and refresh it in Settings.'); expect(warning.closest('details')).toBeNull(); expect(screen.getByRole('checkbox', { name: 'I understand that the selected transcript and settings will be sent, and charges may apply. Audio will not be sent again.' }).closest('details')).toBeNull();
    expect(screen.queryByText('First candidate')).toBeNull(); expect(screen.queryByText('Later candidate')).toBeNull(); expect((screen.getByRole('button', { name: 'Generate notes' }) as HTMLButtonElement).disabled).toBe(true); expect(onMinutesRoute).not.toHaveBeenCalled(); expect(onGenerateMinutes).not.toHaveBeenCalled();
  });
  it('keeps the selected route and blocked warning visible while alternatives are optional keyboard-accessible details', async () => {
    const row = { key: 'saved-key', modelId: 'retired/saved-model', endpointTag: 'Saved/route', label: 'My saved alias · retired/saved-model · Saved/route', enabled: false }, p = { ...meeting(), minutesSettings: { ...meeting().minutesSettings, modelId: row.modelId } };
    render(<App controller={controller({ projects: [p], selectedProjectId: p.id, screen: 'minutes', minutesRoutes: [row], minutesRouteKey: row.key, onMinutesRoute: vi.fn() })} />);
    const select = screen.getByRole('combobox', {name:'Notes model'}) as HTMLSelectElement;
    expect(select.closest('details')).toBeNull(); expect(select.value).toBe(row.key);
    expect(select.closest('.minutes-setup')).toBeTruthy();
    expect(screen.getByText('The saved route is retained. Enable and refresh it in Settings.').closest('details')).toBeNull();
    expect(screen.getByText('No notes yet').closest('.minutes-results')).toBeTruthy();
    expect(screen.queryByRole('searchbox', { name: 'Search models' })).toBeNull();
  });
  it('shows compact known request options without unknown creator placeholders', () => {
    const p = meeting(); const m = parseRouterModels({ data: [{ id: 'openai/gpt-fixture', name: 'GPT fixture', context_length: 16000, top_provider: { max_completion_tokens: 4096 }, architecture: { input_modalities: ['text'], output_modalities: ['text'] }, supported_parameters: ['max_tokens'], pricing: { prompt: '0', completion: '0', request: '0' } }] }, '2026-10-01T00:00:00.000Z')[0];
    const e = parseRouterEndpoints({ data: { endpoints: [{ tag: 'OtherExecution/region', provider_name: 'Other Execution', context_length: 16000, max_prompt_tokens: 16000, max_completion_tokens: 4096, supported_parameters: ['max_tokens'], pricing: { prompt: '0', completion: '0', request: '0' } }] } }, m.id, m.checkedAt)[0];
    render(<App controller={controller({ projects: [{ ...p, minutesSettings: { ...p.minutesSettings, modelId: m.id } }], selectedProjectId: p.id, screen: 'minutes', minutesSelection: previewMinutesSelection({ model: m, endpoint: e, messages: [{ role: 'user', content: 'fixture' }], outputTokens: 4096, reasoningReserveTokens: 0 }) })} />);
    const card = screen.getByRole('region', { name: 'Model details' });
    expect(within(card).getByText('Context limit')).toBeTruthy();
    expect(within(card).queryByText(/Unknown|Unavailable|creator/)).toBeNull();
    const details=card.closest('details')!;expect(details.open).toBe(false);fireEvent.click(within(details).getByText('Model and pricing details',{selector:'summary'}));expect(details.open).toBe(true);
  });
  it.each(['Returned Execution', null])('retains historical requested/returned model IDs and labels only the reported execution provider (%s)', async actualProvider => {
    const p = meeting(); const usage = { inputTokens: null, outputTokens: null, durationSeconds: null, audioInputTokens: null, textInputTokens: null, audioOutputTokens: null, textOutputTokens: null, elapsedMs: 1, cost: null, costKind: 'unavailable' as const, currency: null, rateSource: null, rateCheckedAt: null, rateSnapshot: null };
    const run = { id: 'historical-run', transcriptVersionId: 'old', settings: p.minutesSettings, generatedMarkdown: '# Saved', usage, requestedModel: 'openai/retired-requested', returnedModel: 'other/retired-returned', actualProvider };
    const rich = { ...p, minutesRuns: [run], minutesRevisions: [{ id: 'revision', runId: run.id, parentId: null, markdown: run.generatedMarkdown }], selectedMinutesRevisionId: 'revision', runs: [{ id: run.id, projectId: p.id, state: 'saved' as const, checkpoint: null, intent: { kind: 'minutes' as const, chunkId: null, requestedModel: run.requestedModel, expectedLanguages: [], rateSnapshot: null, requestedEndpoint: 'RequestedExecution/region' } }] };
    render(<App controller={controller({ projects: [rich], selectedProjectId: p.id, screen: 'minutes' })} />);
    await userEvent.setup().click(screen.getByText('Notes · Token, timing and state details'));
    expect(screen.getByText('Requested adapter (from recorded intent): OpenRouter')).toBeTruthy();
    expect(screen.getByText('Requested model: openai/retired-requested')).toBeTruthy();
    expect(screen.getByText('Catalog namespace: OpenAI')).toBeTruthy();
    expect(screen.getByText('Requested execution endpoint: RequestedExecution/region')).toBeTruthy();
    expect(screen.getByText(/Returned model: other\/retired-returned/)).toBeTruthy();
    expect(screen.getByText(`Reported execution provider: ${actualProvider ?? 'Unknown'}`)).toBeTruthy();
  });
  it('uses the same enabled exact routes for A and B and preserves blocked legacy IDs without dispatch', async () => {
    const p = { ...meeting(), minutesSettings: { ...meeting().minutesSettings, modelId: 'retired/a' } }, rows = [{ key: 'old-a', modelId: 'retired/a', endpointTag: 'Old/a', label: 'retired/a · Old/a · blocked', enabled: false }, { key: 'old-b', modelId: 'retired/b', endpointTag: 'Old/b', label: 'retired/b · Old/b · blocked', enabled: false }, { key: 'enabled-exact', modelId: 'fixture/enabled', endpointTag: 'Provider/exact', label: 'Enabled alias · fixture/enabled · Provider/exact', enabled: true }], onMinutesRoute = vi.fn(), onComparisonBRoute = vi.fn(), onGenerateMinutes = vi.fn(), onGenerateComparison = vi.fn();
    render(<App controller={controller({ projects: [p], selectedProjectId: p.id, screen: 'minutes', comparisonOpen: true, comparisonBModelId: 'retired/b', minutesRoutes: rows, minutesRouteKey: 'old-a', comparisonBRouteKey: 'old-b', onMinutesRoute, onComparisonBRoute, onGenerateMinutes, onGenerateComparison })} />);
    const a = screen.getByRole('combobox', {name:'Notes model'}) as HTMLSelectElement, b = screen.getByLabelText('Member B model') as HTMLSelectElement; expect(a.value).toBe('old-a'); expect(b.value).toBe('old-b'); expect(within(a).getAllByRole('option').map(option => (option as HTMLOptionElement).value)).toEqual(['', ...rows.map(row => row.key)]);
    const user = userEvent.setup(); await user.selectOptions(a, 'enabled-exact'); await user.selectOptions(b, 'enabled-exact'); expect(onMinutesRoute).toHaveBeenCalledWith(p.id, 'enabled-exact'); expect(onComparisonBRoute).toHaveBeenCalledWith(p.id, 'enabled-exact'); expect(onGenerateMinutes).not.toHaveBeenCalled(); expect(onGenerateComparison).not.toHaveBeenCalled();
  });
  it('offers two explicit routes/common budget and requires unavailable-total acknowledgment before comparison', async () => {
    const user = userEvent.setup();
    const raw = { id: 'fixture/a', name: 'A', context_length: 32000, top_provider: { max_completion_tokens: 4096 }, architecture: { input_modalities: ['text'], output_modalities: ['text'] }, supported_parameters: ['max_tokens'], pricing: { prompt: '0', completion: '0', request: '0' } };
    const a = parseRouterModels({ data: [raw] }, 'fixture-time')[0]; const b = { ...a, id: 'fixture/b', name: 'B' };
    const e = parseRouterEndpoints({ data: { endpoints: [{ tag: 'Provider/A', provider_name: 'Provider A', context_length: 32000, max_prompt_tokens: 28000, max_completion_tokens: 2000, supported_parameters: ['max_tokens'], pricing: raw.pricing }] } }, a.id, 'fixture-time')[0];
    const eb = { ...e, modelId: b.id, tag: 'Provider/B', providerName: 'Provider B', pricing: { prompt: 0, completion: 0, request: null }, pricingMetadata: { ...e.pricingMetadata, complete: false, missingDimensions: ['request'] } };
    const version = { id: 'full', parentId: null, rawIds: [], segments: [{ id: 's', text: 'Fixture speech', sourceStartMs: 0, sourceEndMs: 1, rawIds: [] }], issues: [], missingRanges: [] };
    const p = { ...meeting(), transcriptVersions: [version], selectedTranscriptVersionId: version.id, minutesSettings: { ...meeting().minutesSettings, modelId: a.id } };
    const onGenerateComparison = vi.fn(); const onGenerateMinutes = vi.fn();
    render(<App controller={controller({ projects: [p], selectedProjectId: p.id, screen: 'minutes', comparisonOpen: true, comparisonBModelId: b.id, comparisonBEndpointTag: eb.tag, comparisonBEndpoints: [{ tag: eb.tag, label: eb.providerName, enabled: true }], comparisonConsentToken: 'frozen-two', minutesUnavailableReason: 'The current single-request route is unavailable', minutesComparison: previewComparison({ transcript: version, settings: p.minutesSettings, choices: [{ model: a, endpoint: e }, { model: b, endpoint: eb }] }), modelCatalog: [a, b].map(m => ({ id: m.id, label: m.name, provider: 'openrouter', kind: 'minutes', enabled: true })), onComparisonView: vi.fn(), onComparisonB: vi.fn(), onGenerateComparison, onGenerateMinutes })} />);
    expect(screen.getByText(/Common output budget: 2,000/)).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Member B model' })).toBeTruthy();
    const generate = screen.getByRole('button', { name: 'Compare two models' }) as HTMLButtonElement;
    await user.click(screen.getByRole('checkbox', { name: /I approve two sequential/ })); expect(generate.disabled).toBe(true);
    await user.click(screen.getByRole('checkbox', { name: /complete estimated total is unavailable/ })); expect(generate.disabled).toBe(false);
    await user.click(generate);
    expect(onGenerateComparison).toHaveBeenCalledWith(p.id, { acknowledged: true, transcriptVersionId: version.id, consentToken: 'frozen-two', partialAcknowledged: false, unknownTotalAcknowledged: true });
    expect(onGenerateMinutes).not.toHaveBeenCalled();
  });
  it('selects existing comparison results and protects dirty Markdown without generation', async () => {
    const user = userEvent.setup(); const p = { ...meeting(), minutesRevisions: [{ id: 'a-revision', runId: 'a-run', parentId: null, markdown: '# A output' }, { id: 'b-revision', runId: 'b-run', parentId: null, markdown: '# B output' }], selectedMinutesRevisionId: 'a-revision' };
    const usage = { inputTokens: 42, outputTokens: 15, durationSeconds: null, audioInputTokens: null, textInputTokens: 42, audioOutputTokens: null, textOutputTokens: 15, elapsedMs: 12, cost: 0.1, costKind: 'reported' as const, currency: 'credits', rateSource: null, rateCheckedAt: null, rateSnapshot: null };
    const rich = { ...p, minutesRuns: ['a', 'b'].map(id => ({ id: `${id}-run`, transcriptVersionId: 'v', settings: p.minutesSettings, generatedMarkdown: `# ${id.toUpperCase()} output`, usage, requestedModel: id, returnedModel: `${id}-returned`, actualProvider: `${id}-provider` })), runs: ['a', 'b'].map(id => ({ id: `${id}-run`, projectId: p.id, state: 'saved' as const, checkpoint: null })), minutesComparisons: [{ id: 'comparison', projectId: p.id, createdAt: 'time', inputSignature: 'fixture', promptVersion: 'fixture', transcript: { id: 'v', parentId: null, rawIds: [], segments: [], issues: [], missingRanges: [] }, settings: p.minutesSettings, messages: [], outputTokens: 1500, reasoningReserveTokens: 0, members: ['a', 'b'].map(id => ({ modelId: id, endpointTag: `${id}-endpoint`, providerName: `${id}-provider`, selectionSnapshot: {}, attempts: [{ runId: `${id}-run`, revisionId: `${id}-revision`, consentToken: 'fixture', selectionSnapshot: {} }] })) as unknown as NonNullable<MeetingProject['minutesComparisons']>[number]['members'] }] };
    const onSelectMinutes = vi.fn(); const onGenerateComparison = vi.fn();
    render(<App controller={controller({ projects: [rich], selectedProjectId: p.id, screen: 'minutes', comparisonOpen: true, selectedComparisonId: 'comparison', onComparisonView: vi.fn(), onSelectMinutes, onEditMinutes: vi.fn(), onGenerateComparison })} />);
    expect(within(screen.getByRole('article', { name: 'Result A' })).getByText(/a-returned/)).toBeTruthy(); expect(screen.getAllByText(/reported.*credits/)).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Use result B' })); expect(onSelectMinutes).toHaveBeenCalledWith(p.id, 'b-revision');
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.type(screen.getByRole('textbox', { name: 'Markdown editor' }), '\nUnsaved');
    expect((screen.getByRole('button', { name: 'Use result B' }) as HTMLButtonElement).disabled).toBe(true);
    expect(onGenerateComparison).not.toHaveBeenCalled();
  });
  it('keeps instructions focused with caret and Korean composition during its own encrypted save', () => {
    const p = meeting(); const onMinutesInstructions = vi.fn();
    const c = controller({ projects: [p], selectedProjectId: p.id, screen: 'minutes', onMinutesInstructions });
    const { rerender } = render(<App controller={c} />);
    const input = screen.getByRole('textbox', { name: 'Extra instructions' }) as HTMLTextAreaElement;
    input.focus(); fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: '한', selectionStart: 1, selectionEnd: 1 } });
    expect(onMinutesInstructions).toHaveBeenLastCalledWith(p.id, '한', true);
    rerender(<App controller={{ ...c, busy: true, minutesInstructionsSaving: true, projects: [{ ...p, minutesSettings: { ...p.minutesSettings, instructions: '한' } }] }} />);
    expect(input.disabled).toBe(false); expect(document.activeElement).toBe(input); expect(input.selectionStart).toBe(1);
    fireEvent.change(input, { target: { value: '한글', selectionStart: 2, selectionEnd: 2 } });
    rerender(<App controller={{ ...c, busy: true, minutesInstructionsSaving: true, projects: [{ ...p, minutesSettings: { ...p.minutesSettings, instructions: '한글' } }] }} />);
    fireEvent.compositionEnd(input, { data: '한글' });
    expect(onMinutesInstructions).toHaveBeenLastCalledWith(p.id, '한글', false);
    expect(document.activeElement).toBe(input); expect(input.selectionStart).toBe(2);
  });
  it.each(['en', 'ko'] as const)('uses neutral disclosure before a model and endpoint are selected (%s)', uiLanguage => {
    const p = meeting();
    render(<App controller={controller({ projects: [p], selectedProjectId: p.id, screen: 'minutes', preferences: { ...defaultPreferences, uiLanguage } })} />);
    expect(screen.getByText(uiLanguage === 'en' ? 'Choose a model to review the destination.' : '모델을 선택하면 전송 대상을 확인할 수 있어요.')).toBeTruthy();
    expect(screen.queryByText(/go directly to OpenAI/)).toBeNull();
    expect(screen.queryByRole('region', { name: uiLanguage === 'en' ? 'Model details' : '모델 상세' })).toBeNull();
  });
  it('shows exact endpoint prices and fit before consent, and central Settings navigation never generates notes', async () => {
    const user = userEvent.setup(); const p = meeting();
    const m = parseRouterModels({ data: [{ id: 'fixture/model', name: 'Fixture', context_length: 12000, top_provider: { max_completion_tokens: 4000 }, architecture: { input_modalities: ['text'], output_modalities: ['text'] }, supported_parameters: ['max_tokens'], pricing: { prompt: '0.1', completion: '0.2', request: '0' } }] }, '2026-10-01T00:00:00.000Z')[0];
    const e = parseRouterEndpoints({ data: { endpoints: [{ tag: 'Fixture/region', provider_name: 'FixtureProvider', context_length: 8000, max_prompt_tokens: 6000, max_completion_tokens: 2000, supported_parameters: ['max_tokens'], pricing: { prompt: '0.000003', completion: '0.000004', request: '0' } }] } }, m.id, m.checkedAt)[0];
    const preview = previewMinutesSelection({ model: m, endpoint: e, messages: [{ role: 'user', content: '한글 fixture' }], outputTokens: 1600, reasoningReserveTokens: 0 });
    const onGenerateMinutes = vi.fn(), onNavigate = vi.fn(), onSettingsTab = vi.fn();
    render(<App controller={controller({ projects: [{ ...p, minutesSettings: { ...p.minutesSettings, modelId: m.id } }], selectedProjectId: p.id, screen: 'minutes', modelCatalog: [{ id: m.id, label: m.name, provider: 'openrouter', kind: 'minutes', enabled: true }], minutesEndpoints: [{ tag: e.tag, label: e.providerName!, enabled: true }], minutesEndpointTag: e.tag, minutesSelection: preview, onNavigate, onSettingsTab, onGenerateMinutes })} />);
    const card = screen.getByRole('region', { name: 'Model details' });
    expect(within(card).getByText('$3')).toBeTruthy(); expect(within(card).getByText('$4')).toBeTruthy();
    expect(within(card).getByText('Fits the selected limits')).toBeTruthy();
    expect(card.compareDocumentPosition(screen.getByRole('checkbox', { name: 'I understand that the selected transcript and settings will be sent, and charges may apply. Audio will not be sent again.' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText(/go to OpenRouter and FixtureProvider \(Fixture\/region\)/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Manage models in Settings' }));
    expect(onNavigate).toHaveBeenCalledWith('settings', p.id); expect(onSettingsTab).toHaveBeenCalledWith('models'); expect(onGenerateMinutes).not.toHaveBeenCalled();
  });
  it('keeps the Korean search label on one line while filtering the selected transcript', async () => {
    const user = userEvent.setup(); const p = meeting(); const version = { id: 'search-version', parentId: null, rawIds: [], segments: [{ id: 'search-a', text: 'alpha target', sourceStartMs: 0, sourceEndMs: 1000, rawIds: [] }, { id: 'search-b', text: 'beta unrelated', sourceStartMs: 1000, sourceEndMs: 2000, rawIds: [] }], issues: [], missingRanges: [] };
    render(<App controller={controller({ projects: [{ ...p, transcriptVersions: [version], selectedTranscriptVersionId: version.id }], selectedProjectId: p.id, screen: 'review', preferences: { ...defaultPreferences, uiLanguage: 'ko' } })} />);
    const label = screen.getByText('검색');
    expect(label.style.whiteSpace).toBe('nowrap'); expect(label.style.flexShrink).toBe('0');
    expect(screen.getByText('beta unrelated')).toBeTruthy();
    await user.type(screen.getByPlaceholderText('단어 또는 문장'), 'target');
    expect(screen.queryByText('beta unrelated')).toBeNull(); expect(screen.getByText('target').tagName).toBe('MARK');
  });
  it.each(['en', 'ko'] as const)('disables saved-chunk retranscription with an honest availability explanation (%s)', async uiLanguage => {
    const user = userEvent.setup(); const p = meeting();
    const chunk = { id: 'saved-chunk', sourceId: 'source', index: 0, sourceStartMs: 0, sourceEndMs: 1000, encodingOffsetMs: 0, encodedBytes: 120, mimeType: 'audio/mpeg', codec: 'mp3', audioRecordId: 'audio' };
    const onRetrySTT = vi.fn(); const checkpoint = { id: 'saved-receipt', projectId: p.id, runId: 'saved-run', recordIds: [p.id, 'saved-raw'], committedAt: '2026-09-30T00:00:00Z' };
    render(<App controller={controller({ projects: [{ ...p, preparedChunks: [chunk], rawTranscripts: [{ id: 'saved-raw', chunkId: chunk.id, runId: 'saved-run', text: 'Saved fixture speech', response: {}, segments: [], timing: 'chunk', speakerScope: 'none', execution: null }], runs: [{ id: 'saved-run', projectId: p.id, state: 'saved', checkpoint }] }], selectedProjectId: p.id, screen: 'stt', preferences: { ...defaultPreferences, uiLanguage }, onRetrySTT })} />);
    const retry = screen.getByRole('button', { name: uiLanguage === 'ko' ? '다시 전사' : 'Re-transcribe' }) as HTMLButtonElement;
    expect(retry.disabled).toBe(true);
    expect(retry.title).toBe(uiLanguage === 'ko' ? '저장된 청크의 재전사는 아직 지원되지 않아요.' : 'Re-transcription of saved chunks is not available yet.');
    await user.click(retry); expect(screen.queryByRole('dialog')).toBeNull(); expect(onRetrySTT).not.toHaveBeenCalled();
  });
  it('blocks a retry dialog if its selected chunk becomes saved before dispatch', async () => {
    const user = userEvent.setup(); const p = { ...meeting(), retainedAudio: { sourceIds: [], chunkIds: ['retry-chunk'] }, preparedChunks: [{ id: 'retry-chunk', sourceId: 'source', index: 0, sourceStartMs: 0, sourceEndMs: 1000, encodingOffsetMs: 0, encodedBytes: 120, mimeType: 'audio/mpeg', codec: 'mp3', audioRecordId: 'audio' }] };
    const onRetrySTT = vi.fn(); const c = controller({ chunkStates: [{ chunkId: 'retry-chunk', state: 'failed' }], projects: [p], selectedProjectId: p.id, screen: 'stt', sttModelId: 'stt-test', modelCatalog: [{ id: 'stt-test', label: 'Fixture STT', provider: 'openai', kind: 'stt', enabled: true }], onSTTModel: vi.fn(), onRetrySTT });
    const { rerender } = render(<App controller={c} />);
    await user.click(screen.getByRole('button', { name: 'Retry latest attempt' }));
    await user.click(screen.getByRole('checkbox', { name: 'I reviewed the selected transmission and possible additional charges' }));
    expect((within(screen.getByRole('dialog')).getByRole('button', { name: 'Transcribe' }) as HTMLButtonElement).disabled).toBe(false);
    const checkpoint = { id: 'receipt', projectId: p.id, runId: 'run', recordIds: [p.id, 'raw'], committedAt: '2026-09-30T00:00:00Z' };
    const saved: MeetingProject = { ...p, rawTranscripts: [{ id: 'raw', chunkId: 'retry-chunk', runId: 'run', text: 'Saved fixture', response: {}, segments: [], timing: 'chunk', speakerScope: 'none', execution: null }], runs: [{ id: 'run', projectId: p.id, state: 'saved', checkpoint }] };
    rerender(<App controller={{ ...c, projects: [saved] }} />);
    const submit = within(screen.getByRole('dialog')).getByRole('button', { name: 'Transcribe' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true); await user.click(submit); expect(onRetrySTT).not.toHaveBeenCalled();
  });
  it('clears STT retry consent when enabled-route metadata identity changes without switching its model', async () => {
    const p = { ...meeting(), retainedAudio: { sourceIds: [], chunkIds: ['retry-metadata-chunk'] }, preparedChunks: [{ id: 'retry-metadata-chunk', sourceId: 'source', index: 0, sourceStartMs: 0, sourceEndMs: 1000, encodingOffsetMs: 0, encodedBytes: 120, mimeType: 'audio/mpeg', codec: 'mp3', audioRecordId: 'audio' }] }, onRetrySTT = vi.fn();
    const c = controller({ chunkStates: [{ chunkId: 'retry-metadata-chunk', state: 'failed' }], projects: [p], selectedProjectId: p.id, screen: 'stt', sttModelId: 'stt-test', sttConsentToken: 'prior-metadata', modelCatalog: [{ id: 'stt-test', label: 'Fixture STT', provider: 'openai', kind: 'stt', enabled: true }], onSTTModel: vi.fn(), onRetrySTT }), view = render(<App controller={c} />), user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^Retry latest attempt$/ })); const dialog = screen.getByRole('dialog'), ack = within(dialog).getByRole('checkbox'); await user.click(ack); expect((within(dialog).getByRole('button', { name: 'Transcribe' }) as HTMLButtonElement).disabled).toBe(false);
    view.rerender(<App controller={{ ...c, sttConsentToken: 'new-metadata' }} />); expect((within(dialog).getByRole('checkbox') as HTMLInputElement).checked).toBe(false); expect((within(dialog).getByRole('button', { name: 'Transcribe' }) as HTMLButtonElement).disabled).toBe(true); expect(onRetrySTT).not.toHaveBeenCalled();
  });
  it('keeps a newer failed attempt retryable while preserving an older saved result', async () => {
    const base = meeting(), id = 'retry-chunk', onRetrySTT = vi.fn(), user = userEvent.setup();
    const p: MeetingProject = { ...base, retainedAudio: { sourceIds: [], chunkIds: [id] },
      preparedChunks: [{ id, sourceId: 'source', index: 0, sourceStartMs: 0, sourceEndMs: 1000, encodingOffsetMs: 0, encodedBytes: 120, mimeType: 'audio/mpeg', codec: 'mp3', audioRecordId: 'audio' }],
      rawTranscripts: [{ id: 'old-raw', chunkId: id, runId: 'old-run', text: 'Previously saved speech', response: {}, segments: [], timing: 'chunk', speakerScope: 'none', execution: null }],
      runs: [{ id: 'old-run', projectId: base.id, state: 'saved', checkpoint: { id: 'receipt', projectId: base.id, runId: 'old-run', recordIds: [base.id, 'old-raw'], committedAt: '2026-10-17T00:00:00Z' } },
        { id: 'new-failed-run', projectId: base.id, state: 'failed', checkpoint: null, intent: { kind: 'stt', chunkId: id, requestedModel: 'stt-test', expectedLanguages: ['ko', 'en'], requestedEndpoint: null, rateSnapshot: null } }] };
    render(<App controller={controller({ projects: [p], selectedProjectId: p.id, screen: 'stt', sttModelId: 'stt-test', modelCatalog: [{ id: 'stt-test', label: 'Fixture STT', provider: 'openai', kind: 'stt', enabled: true }], onRetrySTT })} />);
    await user.click(screen.getByRole('button', { name: 'Retry latest attempt' }));
    const dialog = within(screen.getByRole('dialog')); await user.click(dialog.getByRole('checkbox'));
    await user.click(dialog.getByRole('button', { name: 'Transcribe' }));
    expect(onRetrySTT).toHaveBeenCalledOnce(); expect(p.rawTranscripts[0].text).toBe('Previously saved speech');
  });
  const minutesFixture = (partial = false): MeetingProject => ({ ...meeting(),
    minutesSettings: { ...meeting().minutesSettings, modelId: 'minutes-test' },
    transcriptVersions: [{ id: 'reviewed-v1', parentId: null, rawIds: [], segments: [{id:'speech',text:'Synthetic selected speech',sourceStartMs:0,sourceEndMs:1000,rawIds:[]}], issues: [], missingRanges: partial ? [[0, 1000]] : [] }],
    selectedTranscriptVersionId: 'reviewed-v1' });
  const minutesModel = { id: 'minutes-test', label: 'Keyless test model', provider: 'openai' as const, kind: 'minutes' as const, enabled: true };
  it('keeps the actual blocking limit visible alongside compact request options', () => {
    const p = minutesFixture();
    const m = parseRouterModels({ data: [{ id: 'fixture/visible-limit', name: 'Fixture', context_length: 12000, top_provider: { max_completion_tokens: 4000 }, architecture: { input_modalities: ['text'], output_modalities: ['text'] }, supported_parameters: ['max_tokens'], pricing: { prompt: '0', completion: '0', request: '0' } }] }, '2026-10-01T00:00:00Z')[0];
    const e = parseRouterEndpoints({ data: { endpoints: [{ tag: 'fixture/limits', provider_name: 'Fixture', context_length: 8000, max_prompt_tokens: 1, max_completion_tokens: 2000, supported_parameters: ['max_tokens'], pricing: { prompt: '0', completion: '0', request: '0' } }] } }, m.id, m.checkedAt)[0];
    const preview = previewMinutesSelection({ model: m, endpoint: e, messages: [{ role: 'user', content: 'The full transcript must remain available.' }], outputTokens: 1000, reasoningReserveTokens: 0 });
    render(<App controller={controller({ projects: [p], selectedProjectId: p.id, screen: 'minutes', modelCatalog: [minutesModel], minutesSelection: preview })} />);
    const status = screen.getByRole('status', { name: 'Generation readiness' });
    expect(status.textContent).toBe('The full transcript exceeds the limits; all text is retained'); expect(status.closest('details')).toBeNull();
    const detail=screen.getByRole('region', {name:'Model details'}).closest('details')!;expect(detail.open).toBe(false);fireEvent.click(within(detail).getByText('Model and pricing details',{selector:'summary'}));expect(detail.open).toBe(true);expect(status.closest('details')).toBeNull();
  });
  const transmissionLabel = 'I understand that the selected transcript and settings will be sent, and charges may apply. Audio will not be sent again.';
  const partialLabel = 'I reviewed generation of partial notes with missing ranges disclosed';
  it('allows intentional overlap without partial consent and clears transmission consent on version change', async () => {
    const user = userEvent.setup(), onGenerateMinutes = vi.fn(), base = minutesFixture();
    const segment = { id: 's', text: 'Keep both possible decisions', sourceStartMs: 0, sourceEndMs: 1000, rawIds: [] };
    const version = { ...base.transcriptVersions[0], segments: [segment], issues: [{ id: 'overlap', rangeMs: [0, 1000] as const, alternatives: [[segment]], selected: null }] };
    const p = { ...base, transcriptVersions: [version] };
    const c = controller({ projects: [p], selectedProjectId: p.id, screen: 'minutes', modelCatalog: [minutesModel], minutesConsentToken: 'overlap-snapshot', onGenerateMinutes });
    const { rerender } = render(<App controller={c} />);
    expect(screen.queryByRole('checkbox', { name: partialLabel })).toBeNull();
    await user.click(screen.getByRole('checkbox', { name: transmissionLabel }));
    await user.click(screen.getByRole('button', { name: 'Generate notes' }));
    expect(onGenerateMinutes).toHaveBeenCalledWith(p.id, { acknowledged: true, transcriptVersionId: version.id, consentToken: 'overlap-snapshot', partialAcknowledged: false });
    const next = { ...version, id: 'next-version' };
    rerender(<App controller={{ ...c, projects: [{ ...p, transcriptVersions: [version, next], selectedTranscriptVersionId: next.id }], minutesConsentToken: 'next-snapshot' }} />);
    expect((screen.getByRole('checkbox', { name: transmissionLabel }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole('button', { name: 'Generate notes' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it.each(['selected transcript', 'snapshot token'])('clears both notes acknowledgments when the %s changes', async change => {
    const user = userEvent.setup(); const p = minutesFixture(true); const onGenerateMinutes = vi.fn();
    const c = controller({ projects: [p], selectedProjectId: p.id, screen: 'minutes', modelCatalog: [minutesModel], minutesConsentToken: 'reviewed-snapshot-one', onGenerateMinutes });
    const { rerender } = render(<App controller={c} />);
    await user.click(screen.getByRole('checkbox', { name: transmissionLabel }));
    await user.click(screen.getByRole('checkbox', { name: partialLabel }));
    expect((screen.getByRole('button', { name: 'Generate notes' }) as HTMLButtonElement).disabled).toBe(false);
    const next = change === 'selected transcript' ? { ...p, transcriptVersions: [...p.transcriptVersions, { ...p.transcriptVersions[0], id: 'reviewed-v2' }], selectedTranscriptVersionId: 'reviewed-v2' } : { ...p, transcriptVersions: [{ ...p.transcriptVersions[0], missingRanges: [[2000, 4000] as const] }] };
    rerender(<App controller={{ ...c, projects: [next], minutesConsentToken: change === 'snapshot token' ? 'reviewed-snapshot-two' : c.minutesConsentToken }} />);
    expect((screen.getByRole('checkbox', { name: transmissionLabel }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole('checkbox', { name: partialLabel }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole('button', { name: 'Generate notes' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Generate notes' })); expect(onGenerateMinutes).not.toHaveBeenCalled();
  });
  it.each([false, true])('sends the reviewed notes identity and explicit partial acknowledgment (partial=%s)', async partial => {
    const user = userEvent.setup(); const p = minutesFixture(partial); const onGenerateMinutes = vi.fn();
    render(<App controller={controller({ projects: [p], selectedProjectId: p.id, screen: 'minutes', modelCatalog: [minutesModel], minutesConsentToken: 'exact-fixture-snapshot', onGenerateMinutes })} />);
    await user.click(screen.getByRole('checkbox', { name: transmissionLabel }));
    if (partial) {
      expect((screen.getByRole('button', { name: 'Generate notes' }) as HTMLButtonElement).disabled).toBe(true);
      await user.click(screen.getByRole('checkbox', { name: partialLabel }));
    }
    await user.click(screen.getByRole('button', { name: 'Generate notes' }));
    expect(onGenerateMinutes).toHaveBeenCalledWith(p.id, { acknowledged: true, transcriptVersionId: 'reviewed-v1', consentToken: 'exact-fixture-snapshot', partialAcknowledged: partial });
  });
  it('does not restore notes acknowledgment when an older snapshot token returns', async () => {
    const user = userEvent.setup(); const p = minutesFixture(true); const onGenerateMinutes = vi.fn();
    const c = controller({ projects: [p], selectedProjectId: p.id, screen: 'minutes', modelCatalog: [minutesModel], minutesConsentToken: 'previous-snapshot', onGenerateMinutes });
    const { rerender } = render(<App controller={c} />);
    await user.click(screen.getByRole('checkbox', { name: transmissionLabel }));
    await user.click(screen.getByRole('checkbox', { name: partialLabel }));
    rerender(<App controller={{ ...c, minutesConsentToken: 'replacement-snapshot' }} />);
    rerender(<App controller={c} />);
    expect((screen.getByRole('checkbox', { name: transmissionLabel }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole('checkbox', { name: partialLabel }) as HTMLInputElement).checked).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Generate notes' })); expect(onGenerateMinutes).not.toHaveBeenCalled();
  });
  it('renders fenced Markdown literally and resumes headings after the closing fence', () => {
    const p = { ...meeting(), minutesRevisions: [{ id: 'fenced', runId: 'fixture-run', parentId: null, markdown: '# Visible heading\n```md\n# Inside code\n<img src=x onerror=fixture>\n```\n## After fence\n<script>fixture</script>' }], selectedMinutesRevisionId: 'fenced' };
    render(<App controller={controller({ projects: [p], selectedProjectId: p.id, screen: 'minutes' })} />);
    expect(screen.getByRole('heading', { name: 'Visible heading' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Inside code' })).toBeNull();
    expect(screen.getByText('# Inside code').tagName).toBe('PRE');
    expect(screen.getByRole('heading', { name: 'After fence' })).toBeTruthy();
    const preview = screen.getByText('<script>fixture</script>').closest('.markdown-preview')!;
    expect(preview.querySelector('script,img')).toBeNull();
    expect(within(preview as HTMLElement).getByText('<img src=x onerror=fixture>')).toBeTruthy();
  });
  it('requires a current snapshot token before enabling notes generation', async () => {
    const user = userEvent.setup(); const p = minutesFixture(); const onGenerateMinutes = vi.fn();
    render(<App controller={controller({ projects: [p], selectedProjectId: p.id, screen: 'minutes', modelCatalog: [minutesModel], onGenerateMinutes })} />);
    await user.click(screen.getByRole('checkbox', { name: transmissionLabel }));
    expect((screen.getByRole('button', { name: 'Generate notes' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Generate notes' })); expect(onGenerateMinutes).not.toHaveBeenCalled();
  });
  it('requires an explicit enabled exact route and clears transmission consent when changing it', async () => {
    const user = userEvent.setup(), p = minutesFixture(), onMinutesRoute = vi.fn(), onGenerateMinutes = vi.fn(), key = JSON.stringify(['openrouter', 'openrouter', p.minutesSettings.modelId, 'minutes', 'verified-route']);
    const c = controller({ projects: [p], selectedProjectId: p.id, screen: 'minutes', modelCatalog: [{ ...minutesModel, provider: 'openrouter' }], minutesConsentToken: 'endpoint-fixture-snapshot', minutesRoutes: [{ key, modelId: p.minutesSettings.modelId, endpointTag: 'verified-route', label: 'Verified fixture route', enabled: true }], minutesEndpoints: [{ tag: 'verified-route', label: 'Verified fixture route', enabled: true }], minutesEndpointTag: null, onMinutesRoute, onGenerateMinutes });
    const { rerender } = render(<App controller={c} />), select = screen.getByRole('combobox', {name:'Notes model'}) as HTMLSelectElement;
    expect(select.value).toBe(''); expect(within(select).getAllByRole('option')).toHaveLength(2); expect(screen.queryByRole('option', { name: /Unverified fixture route/ })).toBeNull(); expect(onMinutesRoute).not.toHaveBeenCalled();
    await user.click(screen.getByRole('checkbox', { name: transmissionLabel })); expect((screen.getByRole('button', { name: 'Generate notes' }) as HTMLButtonElement).disabled).toBe(true);
    await user.selectOptions(select, key); expect(onMinutesRoute).toHaveBeenCalledWith(p.id, key); expect((screen.getByRole('checkbox', { name: transmissionLabel }) as HTMLInputElement).checked).toBe(false);
    rerender(<App controller={{ ...c, minutesRouteKey: key, minutesEndpointTag: 'verified-route', minutesConsentToken: 'fresh-exact-route-snapshot' }} />);
    await user.click(screen.getByRole('checkbox', { name: transmissionLabel })); expect((screen.getByRole('button', { name: 'Generate notes' }) as HTMLButtonElement).disabled).toBe(false); expect(onGenerateMinutes).not.toHaveBeenCalled();
  });
  it.each(['busy', 'active chunk'])('blocks an open STT retry dialog when %s begins', async active => {
    const user = userEvent.setup(); const p = { ...meeting(), retainedAudio: { sourceIds: [], chunkIds: ['retry-chunk'] }, preparedChunks: [{ id: 'retry-chunk', sourceId: 'source', index: 0, sourceStartMs: 0, sourceEndMs: 1000, encodingOffsetMs: 0, encodedBytes: 120, mimeType: 'audio/mpeg', codec: 'mp3', audioRecordId: 'audio' }] };
    const onRetrySTT = vi.fn(); const c = controller({ chunkStates: [{ chunkId: 'retry-chunk', state: 'failed' }], projects: [p], selectedProjectId: p.id, screen: 'stt', sttModelId: 'stt-test', modelCatalog: [{ id: 'stt-test', label: 'Fixture STT', provider: 'openai', kind: 'stt', enabled: true }], onSTTModel: vi.fn(), onRetrySTT });
    const { rerender } = render(<App controller={c} />);
    await user.click(screen.getByRole('button', { name: 'Retry latest attempt' }));
    await user.click(screen.getByRole('checkbox', { name: 'I reviewed the selected transmission and possible additional charges' }));
    expect((within(screen.getByRole('dialog')).getByRole('button', { name: 'Transcribe' }) as HTMLButtonElement).disabled).toBe(false);
    rerender(<App controller={{ ...c, ...(active === 'busy' ? { busy: true } : { chunkStates: [{ chunkId: 'retry-chunk', state: 'saving' }] }) }} />);
    const modal = within(screen.getByRole('dialog'));
    expect((modal.getByRole('combobox', { name: 'Transcription model' }) as HTMLSelectElement).disabled).toBe(true);
    expect((modal.getByRole('checkbox') as HTMLInputElement).disabled).toBe(true);
    expect((modal.getByRole('button', { name: 'Transcribe' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(modal.getByRole('button', { name: 'Transcribe' })); expect(onRetrySTT).not.toHaveBeenCalled();
    await user.click(modal.getByRole('button', { name: 'Close' })); expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('derives STT progress from persisted chunk results and never counts an unsaved response', () => {
    const p = { ...meeting(), retainedAudio: { sourceIds: [], chunkIds: ['c1'] } };
    const chunk = { id: 'c1', sourceId: 's1', index: 0, sourceStartMs: 0, sourceEndMs: 1000, encodingOffsetMs: 0, encodedBytes: 120, mimeType: 'audio/mpeg', codec: 'mp3', audioRecordId: 'a1' };
    render(<App controller={controller({ projects: [{ ...p, preparedChunks: [chunk], rawTranscripts: [{ id: 'r1', chunkId: 'c1', runId: 'run1', text: 'Private transcript', response: {}, segments: [], timing: 'chunk', speakerScope: 'none', execution: null }], runs: [{ id: 'run1', projectId: p.id, state: 'saving', checkpoint: null }] }], selectedProjectId: p.id, screen: 'stt' })} />);
    expect(screen.getAllByText('Transcript results 0 / 1')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Organize memo →' })).toBeNull();
    expect(screen.queryByText('100%')).toBeNull();
    expect(screen.getByText('Saving encrypted result')).toBeTruthy();
  });
  it('shows immutable raw speech separately and saves a selected segment as an edit', async () => {
    const user = userEvent.setup(); const p = meeting(); const onEditTranscript = vi.fn();
    const segment = { id: 'seg', text: 'Private original speech', sourceStartMs: 0, sourceEndMs: 1000, rawIds: ['raw'] };
    render(<App controller={controller({ projects: [{ ...p, rawTranscripts: [{ id: 'raw', chunkId: 'chunk', runId: 'run', response: {}, text: segment.text, segments: [segment], timing: 'chunk', speakerScope: 'none', execution: null }], transcriptVersions: [{ id: 'v1', parentId: null, rawIds: ['raw'], segments: [segment], issues: [], missingRanges: [] }], selectedTranscriptVersionId: 'v1' }], selectedProjectId: p.id, screen: 'review', onEditTranscript })} />);
    await user.click(screen.getByRole('button', { name: 'Edit segment 1' }));
    const editor = screen.getByRole('textbox', { name: 'Transcript edit' }); await user.clear(editor); await user.type(editor, 'Corrected speech');
    await user.click(screen.getByRole('button', { name: 'Save transcript edit' }));
    expect(onEditTranscript).toHaveBeenCalledWith(p.id, 'v1', 'seg', 'Corrected speech');
    await user.click(screen.getByRole('button', { name: 'Raw by chunk' }));
    expect(screen.getByText('Private original speech')).toBeTruthy();
  });
  it('retains whole chunk speech without requiring per-boundary review', async () => {
    const p = meeting(); const onReconcileBoundary = vi.fn();
    const first = { id: 'a', text: 'First whole chunk speech', sourceStartMs: 0, sourceEndMs: 600000, rawIds: ['r1'] };
    const second = { id: 'b', text: 'Second whole chunk speech', sourceStartMs: 590000, sourceEndMs: 1200000, rawIds: ['r2'] };
    const version = { id: 'coarse-v', parentId: null, rawIds: ['r1', 'r2'], segments: [first, second], missingRanges: [], issues: [{ id: 'coarse-overlap', rangeMs: [590000, 600000] as const, alternatives: [[first], [second]], selected: null }] };
    render(<App controller={controller({ projects: [{ ...p, transcriptVersions: [version], selectedTranscriptVersionId: version.id }], selectedProjectId: p.id, screen: 'review', onReconcileBoundary, onResolveBoundary: vi.fn() })} />);
    expect(screen.queryByRole('button', { name: 'Alternative 1 use' })).toBeNull();
    expect(screen.queryByText('Needs review')).toBeNull();
    expect(onReconcileBoundary).not.toHaveBeenCalled();
    expect(screen.getAllByText(first.text)).toHaveLength(1); expect(screen.getAllByText(second.text)).toHaveLength(1);
  });
  it('orders selected sections and changes output language without losing the selected transcript', async () => {
    const user = userEvent.setup(); render(<Harness start="minutes" />);
    await user.click(screen.getByRole('button', { name: 'Standard notes' }));
    await user.click(screen.getByRole('button', { name: 'Move Action items up' }));
    const selected = screen.getAllByRole('checkbox').filter(el => (el as HTMLInputElement).checked).map(el => el.getAttribute('aria-label'));
    expect(selected).toEqual(['Summary', 'Discussion by topic', 'Action items', 'Decisions', 'Open questions']);
    await user.selectOptions(screen.getByLabelText('Output language'), '__custom');
    fireEvent.change(screen.getByLabelText('Notes language'), { target: { value: 'fr' } });
    expect((screen.getByLabelText('Notes language') as HTMLInputElement).value).toBe('fr');
    await user.click(screen.getByRole('button', { name: 'Apply language' })); expect((screen.getByLabelText('Notes language') as HTMLInputElement).value).toBe('fr');
    expect(screen.getByRole('checkbox',{name:/selected transcript and settings/})).toBeTruthy();
  });
  it('saves a distinct revision and exports only the selected saved revision', async () => {
    const user = userEvent.setup(); const p = { ...meeting(), minutesRevisions: [{ id: 'edited-v2', runId: 'mr1', parentId: 'generated-v1', markdown: '# Selected edited notes' }], selectedMinutesRevisionId: 'edited-v2' };
    const onCopyMinutes = vi.fn(); const onDownloadMinutes = vi.fn(); const onEditMinutes = vi.fn();
    render(<App controller={controller({ projects: [p], selectedProjectId: p.id, screen: 'minutes', onCopyMinutes, onDownloadMinutes, onEditMinutes })} />);
    await user.click(screen.getByRole('button', { name: 'Copy Markdown' })); await user.click(screen.getByRole('button', { name: 'Download .md' }));
    expect(onCopyMinutes).toHaveBeenCalledWith(p.id, 'edited-v2'); expect(onDownloadMinutes).toHaveBeenCalledWith(p.id, 'edited-v2');
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const edit = screen.getByRole('textbox', { name: 'Markdown editor' }); await user.clear(edit); await user.type(edit, '# New revision');
    expect((screen.getByRole('button', { name: 'Copy Markdown' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Save notes edit' }));
    expect(onEditMinutes).toHaveBeenCalledWith(p.id, 'edited-v2', '# New revision');
    expect(screen.getByText(/plaintext outside the vault/)).toBeTruthy();
  });
});

describe('route labels in transcription selectors and processing history', () => {
  it('labels direct OpenAI in the Transcribe model selector and transmission destination', async () => {
    const p = meeting();
    render(<App controller={controller({ projects: [p], selectedProjectId: p.id, screen: 'stt', sttModelId: 'whisper-1', modelCatalog: [{ id: 'whisper-1', label: 'whisper-1', provider: 'openai', kind: 'stt', enabled: true }] })} />);
    expect(screen.getByRole('option', { name: 'whisper-1' })).toBeTruthy();
    expect(screen.getByText('Direct OpenAI · api.openai.com/v1/audio/transcriptions')).toBeTruthy();
  });
  it('keeps historical requested endpoint and reported provider distinct in history even without a current catalog', () => {
    const p = meeting(); const usage = { inputTokens: null, outputTokens: null, durationSeconds: null, audioInputTokens: null, textInputTokens: null, audioOutputTokens: null, textOutputTokens: null, elapsedMs: 1, cost: null, costKind: 'unavailable' as const, currency: null, rateSource: null, rateCheckedAt: null, rateSnapshot: null };
    const rich = { ...p, minutesRuns: [{ id: 'h', transcriptVersionId: 'old', settings: p.minutesSettings, generatedMarkdown: '# Saved', usage, requestedModel: 'openai/retired', returnedModel: 'other/returned', actualProvider: 'Returned Provider' }], runs: [{ id: 'h', projectId: p.id, state: 'saved' as const, checkpoint: null, intent: { kind: 'minutes' as const, chunkId: null, requestedModel: 'openai/retired', expectedLanguages: [], rateSnapshot: null, requestedEndpoint: 'Requested/region' } }] };
    render(<App controller={controller({ screen: 'history', historyProjectId: p.id, projects: [rich] })} />);
    expect(screen.getByText('Requested adapter (from recorded intent): OpenRouter')).toBeTruthy();
    expect(screen.getByText('Requested model: openai/retired')).toBeTruthy();
    expect(screen.getByText('Catalog namespace: OpenAI')).toBeTruthy();
    expect(screen.getByText('Requested execution endpoint: Requested/region')).toBeTruthy();
    expect(screen.getByText('Returned model: other/returned')).toBeTruthy();
    expect(screen.getByText('Reported execution provider: Returned Provider')).toBeTruthy();
  });
});

describe('settings and sensitive screen boundary', () => {
  it.each(['ko', 'en'] as const)('places legal links exactly once in the common Settings footer: %s', async uiLanguage => {
    const user = userEvent.setup();
    const c = controller({ screen: 'settings', preferences: { ...defaultPreferences, uiLanguage }, onSettingsTab: () => {} });
    const { rerender } = render(<App controller={c} />);
    for (const tab of ['models', 'defaults', 'appearance', 'security'] as const) {
      rerender(<App controller={{ ...c, settingsTab: tab }} />);
      expect(document.getElementById(`settings-${tab}`)?.getAttribute('aria-selected')).toBe('true');
      const footer = screen.getByRole('navigation', { name: uiLanguage === 'ko' ? '앱 정보 · 라이선스' : 'App info & licenses' });
      const links = [[uiLanguage === 'ko' ? 'MoM 라이선스' : 'MoM license', '/licenses/MoM-SOURCE-AVAILABLE-LICENSE.txt'], [uiLanguage === 'ko' ? '제3자 라이선스' : 'Third-party licenses', '/THIRD_PARTY_NOTICES.txt'], [uiLanguage === 'ko' ? '제3자 소스 · 재빌드 · 재연결' : 'Third-party source · rebuild · relink', '/sources/REBUILD.md']];
      expect(screen.getByText(uiLanguage === 'ko' ? /개인·회사 내부 회의록 작성과 소스 검증은/ : /Personal and internal business meeting use and source verification/)).toBeTruthy();
      for (const [name, href] of links) {
        expect(screen.getAllByRole('link', { name })).toHaveLength(1);
        const link = within(footer).getByRole('link', { name });
        expect(link.getAttribute('href')).toBe(href);
        expect(link.getAttribute('target')).toBe('_blank'); expect(link.getAttribute('rel')).toBe('noopener noreferrer');
        link.focus(); expect(document.activeElement).toBe(link); await user.keyboard('{Tab}'); expect(document.activeElement).not.toBe(link);
      }
      expect(within(screen.getByRole('complementary')).queryByRole('link')).toBeNull();
    }
  });
  const vaultCases = (['ko', 'en'] as const).flatMap(uiLanguage => (['new', 'locked', 'unlocking', 'unlocked', 'locking', 'save-failed'] as const).map(session => ({ uiLanguage, session })));
  it.each(vaultCases)('omits the build banner while preserving the vault boundary in $uiLanguage/$session', ({ uiLanguage, session }) => {
    const p = { ...meeting(), minutesRevisions: [{ id: 'private-revision', runId: 'private-run', parentId: null, markdown: '# PRIVATE_GATE_MINUTES' }], selectedMinutesRevisionId: 'private-revision' };
    render(<App controller={controller({ session, projects: [p], selectedProjectId: p.id, screen: 'minutes', preferences: { ...defaultPreferences, uiLanguage }, error: session === 'unlocked' ? 'Public test failure' : 'PRIVATE_GATE_ERROR' })} />);
    expect(screen.queryByText(uiLanguage === 'ko' ? '테스트 빌드 · 실제 AI 미검증' : 'Test build · live AI unverified')).toBeNull();
    expect(screen.queryByRole('link', { name: uiLanguage === 'ko' ? 'MoM 라이선스' : 'MoM license' })).toBeNull();
    expect(screen.queryByRole('link', { name: uiLanguage === 'ko' ? '제3자 라이선스' : 'Third-party licenses' })).toBeNull();
    expect(screen.queryByRole('link', { name: uiLanguage === 'ko' ? '제3자 소스 · 재빌드 · 재연결' : 'Third-party source · rebuild · relink' })).toBeNull();
    if (session !== 'unlocked') {
      expect(screen.getByText('Minutes of Meeting')).toBeTruthy();
      expect(screen.queryByText(p.title)).toBeNull(); expect(document.body.textContent).not.toContain('PRIVATE_GATE_MINUTES'); expect(document.body.textContent).not.toContain('PRIVATE_GATE_ERROR');
      expect(screen.queryByRole('main')).toBeNull();
    }
  });
  it('keeps shared API keys beside models and defaults to encrypted key storage', async () => {
    render(<App controller={controller({screen:'settings',modelRegistrations:{version:2,entries:[]},onSaveApiCredential:vi.fn(async()=>{})})}/>);
    expect(screen.queryByRole('tab',{name:'API keys'})).toBeNull();
    await userEvent.setup().click(screen.getByRole('button',{name:'Add API key'}));
    fireEvent.click(screen.getByText('Storage options'));
    expect((screen.getByLabelText('Key storage') as HTMLSelectElement).value).toBe('encrypted');
    expect(screen.queryByLabelText('Model ID')).toBeNull();
  });
  it('removes every sensitive screen, pending editor and key input when locked or save fails', async () => {
    const p = { ...meeting(), minutesRevisions: [{ id: 'v', runId: 'run', parentId: null, markdown: '# Private notes' }], selectedMinutesRevisionId: 'v' };
    const unlocked = controller({ projects: [p], selectedProjectId: p.id, screen: 'minutes' });
    const { rerender } = render(<App controller={unlocked} />);
    expect(screen.getByText('Private notes')).toBeTruthy();
    rerender(<App controller={{ ...unlocked, session: 'locked' }} />);
    expect(screen.queryByText('Private notes')).toBeNull(); expect(screen.queryByText(p.title)).toBeNull(); expect(screen.queryByRole('main')).toBeNull();
    expect(screen.getByLabelText('Passphrase').getAttribute('type')).toBe('password');
    rerender(<App controller={{ ...unlocked, session: 'save-failed', error: 'Private internal failure detail' }} />);
    expect(screen.queryByText('Private internal failure detail')).toBeNull(); expect(screen.queryByText(p.title)).toBeNull();
    expect(screen.getByRole('button', { name: 'Retry saving and lock' })).toBeTruthy(); expect(screen.getByRole('button', { name: 'Discard unsaved work and lock' })).toBeTruthy();
  });
  it('keeps screen lock available during in-flight work', async () => {
    const user = userEvent.setup(); const onLock = vi.fn();
    render(<App controller={controller({ busy: true, onLock })} />);
    await user.click(screen.getByRole('button', { name: 'Lock screen' }));
    expect(onLock).toHaveBeenCalledTimes(1);
  });
  it('enforces the new-vault minimum and preserves exact spaces', async () => {
    const user = userEvent.setup(); const onCreateVault = vi.fn(); render(<App controller={controller({ session: 'new', onCreateVault })} />);
    const pass = screen.getByLabelText('Passphrase'); const confirm = screen.getByLabelText('Confirm passphrase');
    for (const invalid of ['Eight123', 'a'.repeat(15), '123456789012345', '१२३४५६७८९०१२३४५', '😀'.repeat(15), 'a'.repeat(257)]) {
      await user.clear(pass); await user.clear(confirm); await user.type(pass, invalid); await user.type(confirm, invalid);
      expect((screen.getByRole('button', { name: 'Create vault' }) as HTMLButtonElement).disabled).toBe(true);
    }
    for (const valid of ['Long distinct passphrase', '  validphrase!  ']) {
      await user.clear(pass); await user.clear(confirm);
      await user.type(pass, valid); await user.type(confirm, valid); await user.click(screen.getByRole('button', { name: 'Create vault' }));
      expect(onCreateVault).toHaveBeenLastCalledWith(valid);
    }
  });
  it('requires a strong new passphrase and clears the form after dispatch without asserting unlocked success', async () => {
    const user = userEvent.setup(); const onCreateVault = vi.fn(); render(<App controller={controller({ session: 'new', onCreateVault })} />);
    const input = screen.getByLabelText('Passphrase'); await user.type(input, 'short');
    expect((screen.getByRole('button', { name: 'Create vault' }) as HTMLButtonElement).disabled).toBe(true);
    await user.clear(input); await user.type(input, 'Long distinct passphrase'); await user.type(screen.getByLabelText('Confirm passphrase'), 'Long distinct passphrase');
    await user.click(screen.getByRole('button', { name: 'Create vault' }));
    expect(onCreateVault).toHaveBeenCalledWith('Long distinct passphrase'); expect((input as HTMLInputElement).value).toBe('');
    expect(screen.queryByRole('main')).toBeNull();
  });
});

describe('autofill isolation', () => {
  it('isolates the write-only API credential and clears it after an independent save', async () => {
    const user=userEvent.setup(),onSaveApiCredential=vi.fn(async()=>{});
    render(<App controller={controller({screen:'settings',settingsTab:'keys',modelRegistrations:{version:2,entries:[]},onSaveApiCredential})}/>);
    await user.click(screen.getByRole('button',{name:'Add API key'}));await user.type(screen.getByLabelText('Key name'),'Shared key');await user.selectOptions(screen.getByLabelText('Provider'),'openai');const input=screen.getByLabelText('New API key') as HTMLInputElement;
    expect(input.type).toBe('password');expect(input.autocomplete).toBe('new-password');expect(input.value).toBe('');
    await user.type(input,'KEYLESS_MANUAL_TOKEN');await user.click(screen.getByRole('button',{name:'Save key'}));
    expect(onSaveApiCredential).toHaveBeenCalledWith(expect.objectContaining({keyStorage:'encrypted',origin:'https://api.openai.com'}),{action:'replace',value:'KEYLESS_MANUAL_TOKEN'});expect(input.value).toBe('');expect(input.type).toBe('password');
  });
  it.each(['import', 'review', 'minutes'] as const)('disables history autofill on %s text fields', current => {
    const p = meeting(); const { container } = render(<App controller={controller({ screen: current, projects: [p], selectedProjectId: p.id })} />);
    for (const field of container.querySelectorAll('input:not([type]), input[type="text"], textarea')) {
      expect(field.getAttribute('autocomplete')).toBe('off');
    }
  });
});

it('keeps saved-password autofill on the vault gate and exposes creation length requirements', () => {
  const { rerender } = render(<App controller={controller({ session: 'new' })} />);
  expect(screen.getByLabelText('Passphrase').getAttribute('autocomplete')).toBe('new-password');
  expect(screen.getByLabelText('Passphrase').getAttribute('minlength')).toBe('15');
  expect(screen.getByLabelText('Confirm passphrase').getAttribute('minlength')).toBe('15');
  expect(screen.getByLabelText('Passphrase').getAttribute('passwordrules')).toBe('minlength: 15; maxlength: 256;');
  rerender(<App controller={controller({ session: 'locked' })} />);
  expect(screen.getByLabelText('Passphrase').getAttribute('autocomplete')).toBe('current-password');
  expect(screen.getByLabelText('Passphrase').getAttribute('name')).toBe('vault-passphrase');
  expect(screen.getByLabelText('Passphrase').getAttribute('minlength')).toBeNull();
});


it('uses managed lists, preserves absent current choices and links to language settings', async () => {
  const p = meeting(), onAudioOptions = vi.fn(), onNavigate = vi.fn(), onSettingsTab = vi.fn();
  const project = { ...p, color: '#112233', audioOptions: { ...p.audioOptions, expectedLanguages: ['sw', 'en'] } };
  render(<App controller={controller({ screen: 'import', projects: [project], selectedProjectId: p.id, selectionLists: { icons: ['headphones'], colors: ['#445566'], languages: [{ code: 'fr', name: 'French fixture' }] }, onAudioOptions, onNavigate, onSettingsTab })} />);
  const user = userEvent.setup(), group = screen.getByRole('group', { name: 'Spoken languages · select multiple' });
  expect(screen.getByRole('button', { name: 'Color #112233' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('button', { name: 'Color #445566' })).toBeTruthy();
  await user.click(within(group).getByRole('button', { name: /French fixture/ }));
  expect(onAudioOptions).toHaveBeenLastCalledWith(p.id, { ...project.audioOptions, expectedLanguages: ['sw', 'en', 'fr'] });
  await user.click(within(group).getByRole('button', { name: /sw/ }));
  expect(onAudioOptions).toHaveBeenLastCalledWith(p.id, { ...project.audioOptions, expectedLanguages: ['en'] });
  await user.click(screen.getByRole('button', { name: 'Manage icons, colors & languages →' }));
  expect(onSettingsTab).toHaveBeenCalledWith('appearance'); expect(onNavigate).toHaveBeenCalledWith('settings', p.id);
});
it.each(['ko', 'en'] as const)('keeps preparation choices below theme and UI language in the appearance tab in %s', async language => {
  render(<App controller={controller({ screen: 'settings', preferences: { ...defaultPreferences, uiLanguage: language } })} />);
  const tab = screen.getByRole('tab', { name: language === 'ko' ? '화면 · 언어' : 'Appearance & language' });
  await userEvent.setup().click(tab); expect(tab.getAttribute('aria-selected')).toBe('true');
  expect(screen.getAllByRole('tab')).toHaveLength(4);
  const uiLanguage = screen.getByText(language === 'ko' ? '화면 언어' : 'Interface language');
  const colors = screen.getByRole('region', { name: language === 'ko' ? '색상 목록' : 'Color list' });
  expect(uiLanguage.compareDocumentPosition(colors) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByRole('region', { name: language === 'ko' ? '색상 목록' : 'Color list' })).toBeTruthy();
  tab.focus(); await userEvent.setup().keyboard('{ArrowRight}');
  const next = screen.getByRole('tab', { name: language === 'ko' ? '보안 · 잠금' : 'Security & lock' });
  expect(next.getAttribute('aria-selected')).toBe('true'); expect(document.activeElement).toBe(next);
});

it.each(['ko', 'en'] as const)('uses voice-memo terminology throughout app-owned screens in %s', language => {
  const p = { ...meeting(), title: 'SYNTHETIC_MEMO' };
  for (const route of ['home', 'import', 'stt', 'review', 'minutes', 'history', 'settings'] as const) {
    const tabs = route === 'settings' ? ['connections', 'keys', 'models', 'defaults', 'appearance', 'security'] as const : ['connections'] as const;
    for (const settingsTab of tabs) {
      const view = render(<App controller={controller({ screen: route, settingsTab, projects: [p], selectedProjectId: p.id, preferences: { ...defaultPreferences, uiLanguage: language } })} />);
      expect(view.container.querySelector('.brand strong')?.textContent).toBe('Minutes of Meeting');
      const content=view.container.cloneNode(true) as HTMLElement;content.querySelector('.brand strong')?.remove();content.querySelector('.settings-footer')?.remove();
      const ownedCopy = content.textContent + [...content.querySelectorAll('[aria-label]')].map(el => el.getAttribute('aria-label')).join(' ');
      expect(ownedCopy).not.toMatch(language === 'ko' ? /회의/ : /\bmeetings?\b|\bminutes\b/i);
      view.unmount();
    }
  }
});
