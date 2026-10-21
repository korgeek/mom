import { Check, Plus } from 'lucide-react';
import { ScreenGate, AutoLockStatus } from './ui/ScreenLock';
import type { ScreenState } from './vault/screen-state';
import type { PreparationResetPlan } from './vault/preparation-reset';
import type { ApiCredential, ModelRegistration, ModelRegistrations, RegistrationKeyUpdate, RegistrationTestInput, RegistrationTestResult } from './providers/model-registrations';
import type { SelectionLists } from './settings/lists';
/// <reference types="vite/client" />
import { useEffect, useRef, useState } from 'react';
import type { AudioOptions, MeetingProject, MinutesSettings, RunState, ModelRegistry, StorageInventory, DeletionPlan, RouterSTTSelection, RouterSTTPreference } from './domain/types';
import type { RecordingControlsProps } from './ui/RecordingControls';
import type { ModelManagerProps } from './ui/components/ModelManager';
import type { MinutesSelectionPreview } from './minutes/selection';
import type { MinutesComparisonPreview } from './minutes/compare';
import type { CatalogMetadata } from './providers/model-presentation';
import Home from './ui/screens/Home';
import Import from './ui/screens/Import';
import STT from './ui/screens/STT';
import Minutes from './ui/screens/Minutes';
import Settings, { ResetVaultControls } from './ui/screens/Settings';
import History from './ui/screens/History';
import type { UsageHistoryItem } from './usage/statement';
import type { PlaybackState } from './playback';
import type { recommendRouterSTT } from './providers/stt-catalog';
import type { STTConsent } from './transcript/batches';
import MobileNavigation from './ui/components/MobileNavigation';
import MemoDeletion from './ui/components/MemoDeletion';
import { copy, formatBytes, formatTime, memoIcons, preparedAudioReady, steps, transcriptionComplete } from './ui/copy';
import './ui/styles.css';
import './ui/mobile-navigation.css';
import './ui/mobile-stages.css';

export type AppScreen = 'home' | 'import' | 'stt' | 'review' | 'minutes' | 'settings' | 'history';
export type SettingsTab = 'connections' | 'keys' | 'models' | 'defaults' | 'appearance' | 'security' | 'history';
export type AppPreferences = Readonly<{
  theme: 'light' | 'dark' | 'system'; palette: 'cobalt' | 'teal' | 'mono'; uiLanguage: 'ko' | 'en';
  keyStorage: 'encrypted' | 'session'; autoLockSeconds?: ScreenState['autoLockSeconds'];
  lockWorkPolicy?: 'standard' | 'strict';
  /** Legacy in-memory preferences; automatic screen lock uses autoLockSeconds. */
  autoLockMinutes: 5 | 15 | 30; lockOnHide: boolean;
}>;
export const defaultPreferences: AppPreferences = { theme: 'light', palette: 'cobalt', uiLanguage: 'ko', keyStorage: 'encrypted', autoLockSeconds: 60, lockWorkPolicy: 'standard', autoLockMinutes: 15, lockOnHide: false };
export type UIModel = Readonly<{
  id: string; label: string; provider: 'openai' | 'openrouter' | 'openai-compatible'; kind: 'stt' | 'minutes';
  enabled: boolean; disabledReason?: string; note?: string; catalog?: CatalogMetadata;
}>;
export type UIConnection = Readonly<{
  provider: 'openai' | 'openrouter'; status: 'none' | 'saved' | 'checking' | 'verified' | 'failed';
  message?: string;
}>;
export type UIChunkState = Readonly<{ chunkId: string; state: RunState; error?: string }>;
export type UIPreparation = Readonly<{
  stage: 'inspecting' | 'reading' | 'decoding' | 'preparing' | 'verifying' | 'saving' | 'complete' | 'failed' | 'stopped';
  /** Completed encrypted audio checkpoints; total is a planned chunk count. */
  completed: number; total: number | null;
  sourceProcessedMs?: number | null; durationMs?: number | null; savedEncodedBytes?: number | null; message?: string;
  jobId?: string; sourceId?: string; settingsFingerprint?: string;
  startedAtMs?: number; lastProgressAtMs?: number; lastForegroundAtMs?: number;
  phaseProcessedMs?: number | null; phaseDurationMs?: number | null; savedThroughMs?: number;
  backgroundCount?: number; backgroundDurationMs?: number; errorCode?: string;
}>;
export type UIHistoryItem = UsageHistoryItem;

// Only the integration controller owns durable state, credentials, jobs and side effects.
// Missing actions mean unavailable; the UI never simulates a completed action.
export interface AppController {
  workReturnScreen?: AppScreen | null;
  screenAccess?: 'open' | 'locked' | 'verifying';
  screenUnlockError?: boolean;
  uiDrafts?: Readonly<Record<string, unknown>>;
  onUIDraft?: (key: string, value: unknown) => void;
  onScreenUnlock?: (passphrase: string) => void;
  onHardLock?: () => void;
  autoLockRemaining?: () => number | null;

  selectionLists?: SelectionLists | null;
  onSaveSelectionLists?: (lists: SelectionLists) => Promise<void>;
  modelRegistrations?: ModelRegistrations | null;
  registrationKeyReady?: readonly string[];
  credentialKeyReady?: readonly string[];
  apiCredentialChecks?: Readonly<Record<string, Readonly<{state:'checking'|'verified'|'failed'|'unsupported';message:string}>>>;
  registrationTest?: Readonly<{id:string;running:boolean;saving:boolean;result:RegistrationTestResult|null;saved:boolean}> | null;
  onSaveRegistration?: (value:ModelRegistration,keyUpdate?:RegistrationKeyUpdate)=>Promise<void>;
  onDeleteRegistration?: (id:string)=>Promise<void>;
  onCheckApiCredential?: (id:string)=>Promise<void>;
  onSaveApiCredential?: (value:ApiCredential,keyUpdate:RegistrationKeyUpdate)=>Promise<void>;
  onDeleteApiCredential?: (id:string)=>Promise<void>;
  onImportRegistrations?: (values:readonly ModelRegistration[])=>Promise<void>;
  onSetRegistrationDefault?: (stage:'stt'|'llm',id:string|null)=>Promise<void>;
  onSaveRegistrationKey?: (id:string,key:string,mode:'encrypted'|'session')=>Promise<void>;
  onTestRegistration?: (value:ModelRegistration,input:RegistrationTestInput,routerAcknowledged?:boolean)=>Promise<void>;
  onCancelRegistrationTest?: ()=>void;
  onRetryRegistrationResult?: ()=>Promise<void>;
  keySaveAttempts?: Readonly<Partial<Record<UIConnection['provider'], Readonly<{ status: 'saving' | 'saved' | 'failed'; revision: number; message: string }>>>>;
  recording?: (RecordingControlsProps & Readonly<{ projectId: string }>) | null;
  recordingActive?: boolean;
  storageInventory?: StorageInventory | null;
  audioDeletionPlan?: DeletionPlan | null;
  storageWorking?: boolean;
  storageError?: string | null;
  storageNotice?: string | null;
  onRefreshStorage?: () => void;
  onPlanAudioDeletion?: (scope: 'source' | 'chunks', projectId: string) => void;
  onCancelAudioDeletion?: () => void;
  onConfirmAudioDeletion?: (token: string) => void;
  modelRegistry?: ModelRegistry | null;
  modelManagement?: ModelManagerProps | null;
  minutesRoutes?: readonly Readonly<{ key: string; modelId: string; endpointTag: string; label: string; enabled: boolean; disabledReason?: string }>[];
  minutesRouteKey?: string | null;
  comparisonBRouteKey?: string | null;
  onMinutesRoute?: (projectId: string, key: string) => void;
  onComparisonBRoute?: (projectId: string, key: string) => void;
  session: 'new' | 'locked' | 'unlocking' | 'unlocked' | 'locking' | 'save-failed';
  projects: readonly MeetingProject[]; selectedProjectId: string | null; screen: AppScreen; settingsTab: SettingsTab;
  preferences: AppPreferences; defaultAudioOptions: AudioOptions; modelCatalog: readonly UIModel[] | null;
  sttModelId: string; connections: readonly UIConnection[]; storageEstimate: Readonly<{ usage: number; quota: number }> | null;
  chunkStates?: readonly UIChunkState[]; preparation?: UIPreparation | null; sourcePreviewUrl?: string | null;
  sourceWaveform?: readonly number[] | null;
  sourcePreviewLoading?: boolean;
  sourcePreviewError?: string | null;
  playback?: PlaybackState | null;
  history?: readonly UIHistoryItem[]; busy?: boolean; minutesGenerating?: boolean; error?: string | null; notice?: string | null;
  resettingVault?: boolean; resetVaultError?: string | null;
  sttConsentToken?: string;
  routerSTTSelection?: RouterSTTSelection | null;
  routerSTTRecommendation?: ReturnType<typeof recommendRouterSTT> | null;
  onRouterSTTPreference?: (connectionId: string, preference: RouterSTTPreference) => Promise<void>;
  onApplyRouterSTTRecommendation?: (connectionId: string, modelId: string) => Promise<void>;
  sttUnavailableReason?: string; minutesUnavailableReason?: string; exportUnavailableReason?: string;
  sttPolicyBlockedModels?: readonly string[];
  comparisonUnavailableReason?: string;
  minutesConsentToken?: string | null;
  minutesSelection?: MinutesSelectionPreview | null;
  minutesInstructionsSaving?: boolean;
  meetingEditsSaving?: boolean;
  comparisonOpen?: boolean;
  comparisonBModelId?: string | null;
  comparisonBEndpointTag?: string | null;
  comparisonBEndpoints?: AppController['minutesEndpoints'];
  minutesComparison?: MinutesComparisonPreview | null;
  comparisonConsentToken?: string | null;
  selectedComparisonId?: string | null;
  comparisonRetryMember?: 0 | 1 | null;
  minutesEndpoints?: readonly Readonly<{ tag: string; label: string; enabled: boolean; disabledReason?: string }>[];
  minutesEndpointTag?: string | null;
  historyProjectId?: string | null;
  preparationEditor?: Readonly<{projectId:string;requestId:number}> | null;
  preparationResetPlan?: PreparationResetPlan | null;
  onEditPreparation?: (id:string)=>void;
  onPlanPreparationReset?: (id:string, options:AudioOptions)=>void;
  onConfirmPreparationReset?: (token:string)=>void;
  onCancelPreparationReset?: ()=>void;
  onNavigate?: (screen: AppScreen, projectId?: string) => void;
  onNavigateAfterStop?: (screen: AppScreen, projectId?: string) => void;
  onSettingsTab?: (tab: SettingsTab) => void;
  onCreateMeeting?: () => void;
  onUpdateMeeting?: (id: string, patch: Partial<Pick<MeetingProject, 'title' | 'icon' | 'color' | 'pinned'>>) => void;
  onDeleteMeeting?: (id: string) => void;
  onPickFile?: (id: string, file: File) => void;
  onClearFile?: (id: string) => void;
  onAudioOptions?: (id: string, options: AudioOptions) => void;
  onDefaultAudioOptions?: (options: AudioOptions) => void;
  onSTTModel?: (modelId: string) => void;
  onPrepareAudio?: (id: string) => void;
  onCancelPreparation?: () => void;
  onStartSTT?: (id: string, consent: STTConsent) => void;
  onCancelSTT?: (id: string) => void;
  onRetrySTT?: (id: string, chunkIds: readonly string[], consent: STTConsent) => void;
  onRerunSTT?: (id: string, chunkIds: readonly string[], consent: STTConsent) => void;
  onTranscribeChunks?: (id: string, chunkIds: readonly string[], consent: STTConsent) => void;
  onSelectChunkTranscript?: (id: string, chunkId: string, rawId: string, parentVersionId: string | null) => void;
  onPlayChunk?: (id: string, chunkId: string) => void;
  onPauseChunk?: (id: string, chunkId: string) => void;
  onResumeChunk?: (id: string, chunkId: string) => void;
  onStopPlayback?: () => void;
  onSourcePreviewPlay?: (audio: HTMLAudioElement) => void;
  onLoadSourcePreview?: (projectId: string) => void;
  onReleaseSourcePreview?: (projectId: string) => void;
  onPlaySegment?: (id: string, versionId: string, segmentId: string) => void;
  onSelectTranscript?: (id: string, versionId: string) => void;
  onEditTranscript?: (id: string, versionId: string, segmentId: string, text: string) => void;
  onResolveBoundary?: (id: string, versionId: string, issueId: string, alternative: number) => void;
  onReconcileBoundary?: (id: string, versionId: string, issueId: string, edits: readonly Readonly<{ segmentId: string; text: string }>[]) => void;
  onMinutesSettings?: (id: string, settings: MinutesSettings) => void;
  onMinutesInstructions?: (id: string, instructions: string, composing: boolean) => void;
  onMinutesEndpoint?: (projectId: string, tag: string) => void;
  onRefreshMinutesMetadata?: () => void;
  onGenerateMinutes?: (id: string, consent: { acknowledged: true; transcriptVersionId: string; consentToken: string; partialAcknowledged: boolean }) => void;
  onComparisonView?: (id: string, open: boolean) => void;
  onComparisonB?: (id: string, modelId: string, endpointTag: string | null) => void;
  onSelectComparison?: (id: string, comparisonId: string | null, retryMember?: 0 | 1 | null) => void;
  onGenerateComparison?: (id: string, consent: { acknowledged: true; transcriptVersionId: string; consentToken: string; partialAcknowledged: boolean; unknownTotalAcknowledged: boolean }) => void;
  onCancelMinutes?: () => void;
  onSelectMinutes?: (id: string, revisionId: string) => void;
  onEditMinutes?: (id: string, revisionId: string, markdown: string) => void;
  onCopyMinutes?: (id: string, revisionId: string) => void;
  onDownloadMinutes?: (id: string, revisionId: string) => void;
  onPreferences?: (preferences: AppPreferences) => void;
  onSaveKey?: (provider: UIConnection['provider'], secret: string, mode: AppPreferences['keyStorage']) => void;
  onClearKey?: (provider: UIConnection['provider']) => void;
  onTestConnection?: (provider: UIConnection['provider']) => void;
  onCreateVault?: (passphrase: string) => void;
  onUnlock?: (passphrase: string) => void;
  onLock?: () => void;
  onRetryLock?: () => void;
  onDiscardAndLock?: () => void;
  onResetVault?: () => void;
}
export type ProjectScreenProps = { controller: AppController; project: MeetingProject; initiallyCollapsed?: boolean };

const emptyController: AppController = { session: 'new', projects: [], selectedProjectId: null, screen: 'home', settingsTab: 'connections', preferences: defaultPreferences,
  defaultAudioOptions: { chunkMinutes: 5, overlapSeconds: 5, expectedLanguages: ['ko', 'en'], bitrateKbps: 32, sampleRateHz: 16000 }, modelCatalog: null, sttModelId: '', connections: [], storageEstimate: null };

export function MeetingIcon({ icon, color, large = false }: { icon: string; color: string; large?: boolean }) {
  const Icon = memoIcons[icon]?.Icon ?? memoIcons.mic.Icon;
  return <span className={`meeting-icon${large ? ' large' : ''}`} style={{ color, background: `color-mix(in srgb, ${color} 14%, var(--surface))` }}>
    <Icon aria-hidden="true" />
  </span>;
}
function VaultGate({ controller: c }: { controller: AppController }) {
  const [passphrase, setPassphrase] = useState(''); const [confirmation, setConfirmation] = useState('');
  const t = (ko: string, en: string) => copy(c.preferences.uiLanguage, ko, en);
  const isNew = c.session === 'new';
  const codepoints = Array.from(passphrase).length;
  const validNewSecret = codepoints >= 8 && codepoints <= 256 && new TextEncoder().encode(passphrase).byteLength <= 1024 && !/^\p{Nd}+$/u.test(passphrase);
  const working = c.session === 'unlocking' || c.session === 'locking';
  const submit = () => {
    const secret = passphrase; setPassphrase(''); setConfirmation('');
    if (isNew) c.onCreateVault?.(secret); else c.onUnlock?.(secret);
  };
  return <div className="vault-gate"><section className="vault-card" aria-labelledby="vault-heading">
    <div className="brand-mark vault-mark">M</div>
    <strong className="centered">Minutes of Meeting</strong>
    {c.session === 'save-failed' && (c.resetVaultError || c.resettingVault) ? <>
      <h1 id="vault-heading">{c.resettingVault ? t('보관함 초기화 처리 중', 'Resetting the vault') : t('보관함 초기화에 실패했어요', 'Vault reset failed')}</h1>
    </> : c.session === 'save-failed' ? <>
      <h1 id="vault-heading">{t('완료분 저장에 실패했어요', 'Completed work could not be saved')}</h1>
      <p role="alert">{t('새 작업은 중지됐어요. 저장을 다시 시도하거나 저장되지 않은 작업을 버리고 잠그세요.', 'New work has stopped. Retry saving, or discard unsaved work and lock.')}</p>
      <button className="primary" disabled={!c.onRetryLock} onClick={c.onRetryLock}>{t('저장 후 잠금 다시 시도', 'Retry saving and lock')}</button>
      <button className="danger-outline" disabled={!c.onDiscardAndLock} onClick={c.onDiscardAndLock}>{t('미저장 작업 버리고 잠금', 'Discard unsaved work and lock')}</button>
    </> : <>
      <h1 id="vault-heading">{isNew ? t('새 보관함 만들기', 'Create a new vault') : t('암호로 잠금 해제', 'Unlock with your passphrase')}</h1>
      {isNew && <div className="stack gap10"><strong>{t('내 음성 메모는 내 기기에.', 'My voice memos stay on my device.')}</strong><p>{t('MoM은 회원가입 없이 브라우저에서 사용하는 음성 메모 앱입니다. 녹음과 전사·요약은 지금 사용하는 기기의 브라우저에 암호화해 보관합니다.', 'MoM is a browser voice memo app with no sign-up. Recordings, transcripts and summaries are kept encrypted in this device’s browser.')}</p></div>}
      <p>{t('이 브라우저에 보관할 음성 메모와 API 키를 보호하는 암호예요. 잊으면 저장된 데이터를 복구할 수 없어요.', 'This passphrase protects voice memos and API keys stored in this browser. Forgotten passphrases cannot recover saved data.')}</p>
      <form onSubmit={event => { event.preventDefault(); if (!working && passphrase && (isNew ? validNewSecret && passphrase === confirmation && c.onCreateVault : c.onUnlock)) submit(); }}>
        <label>{t('암호', 'Passphrase')}<input autoFocus type="password" name="vault-passphrase" minLength={isNew ? 8 : undefined} {...(isNew ? { passwordrules: "minlength: 8; maxlength: 256;" } : {})} autoComplete={isNew ? 'new-password' : 'current-password'} value={passphrase} disabled={working} onChange={event => setPassphrase(event.target.value)} /></label>
        {isNew && <><span className="hint">{t('8~256자의 고유한 암호를 사용하세요. 문자·숫자·특수문자를 조합해 사용하세요. 공백과 대소문자는 그대로 적용돼요.', 'Use a unique passphrase of 8–256 characters. Combine letters, numbers, and special characters. Spaces and capitalization are preserved.')}</span><label>{t('암호 확인', 'Confirm passphrase')}<input type="password" name="vault-passphrase-confirmation" minLength={8} autoComplete="new-password" value={confirmation} disabled={working} onChange={event => setConfirmation(event.target.value)} /></label></>}
        {c.error && <div role="alert" className="error">{t('보관함을 열 수 없어요. 암호와 브라우저 저장소 상태를 확인하세요.', 'The vault could not be opened. Check the passphrase and browser storage.')}</div>}
        <button className="primary" disabled={working || !passphrase || (isNew ? !validNewSecret || confirmation !== passphrase || !c.onCreateVault : !c.onUnlock)} type="submit">{working ? t('처리 중…', 'Working…') : isNew ? t('보관함 만들기', 'Create vault') : t('잠금 해제', 'Unlock')}</button>
      </form>
      {!c.onCreateVault && isNew && <span className="hint">{t('보관함 연결을 준비하고 있어요.', 'Vault setup is not available yet.')}</span>}
    </>}
    {!isNew && <ResetVaultControls controller={c} />}
  </section></div>;
}
function completedStepKey(project: MeetingProject, screen: AppScreen, progress: AppController['chunkStates']) {
  if (!(screen === 'import' && preparedAudioReady(project) || screen === 'stt' && transcriptionComplete(project, progress))) return null;
  return JSON.stringify([project.id, screen, project.sourceAssets.map(source => source.id), project.preparedChunks.map(chunk => [chunk.id, chunk.audioRecordId]), screen === 'stt' ? [project.rawTranscripts.map(raw => [raw.id, raw.runId]), project.selectedTranscriptVersionId] : null]);
}
function UnlockedApp({ controller: c }: { controller: AppController }) {
  const heading = useRef<HTMLHeadingElement>(null); const main = useRef<HTMLElement>(null);
  const t = (ko: string, en: string) => copy(c.preferences.uiLanguage, ko, en);
  const project = c.projects.find(p => p.id === c.selectedProjectId);
  // Compatibility for an already-open legacy Settings history tab.
  const currentScreen = c.screen === 'review' ? 'stt' : c.screen === 'settings' && c.settingsTab === 'history' ? 'history' : c.screen;
  const [collapsedSteps, setCollapsedSteps] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [forward, setForward] = useState<{ projectId: string; from: AppScreen; to: AppScreen; identity: string } | null>(null);
  const [stopNavigation, setStopNavigation] = useState<{ screen: AppScreen; id?: string } | null>(null);
  const stoppingNavigation = useRef(false);
  if (forward && project?.id === forward.projectId && currentScreen === forward.to) {
    if (completedStepKey(project, forward.from, c.chunkStates) === forward.identity) setCollapsedSteps(new Map(collapsedSteps).set(JSON.stringify([project.id, forward.from]), forward.identity));
    setForward(null);
  }
  const navigate = (screen: AppScreen, id?: string) => {
    if (c.recordingActive && screen !== 'settings' && !(currentScreen === 'settings' && screen === c.workReturnScreen && (id ?? c.selectedProjectId) === c.selectedProjectId)) {
      stoppingNavigation.current = false; setStopNavigation({ screen, id }); return;
    }
    const identity = project && completedStepKey(project, currentScreen, c.chunkStates);
    const from = steps.findIndex(step => step.id === currentScreen), to = steps.findIndex(step => step.id === screen);
    setForward(project && identity && from >= 0 && to > from && (id ?? project.id) === project.id && !c.busy && !c.storageWorking && !c.recordingActive ? { projectId: project.id, from: currentScreen, to: screen, identity } : null);
    if (id === undefined) c.onNavigate?.(screen); else c.onNavigate?.(screen, id);
  };
  const flowController = { ...c, onNavigate: c.onNavigate ? navigate : undefined };
  const wasCollapsed = (screen: AppScreen) => !!project && collapsedSteps.get(JSON.stringify([project.id, screen])) === completedStepKey(project, screen, c.chunkStates);
  const flow = ['import', 'stt', 'review', 'minutes'].includes(currentScreen) && !!project;
  const preparationOwnsFocus = currentScreen === 'import' && (c.preparationEditor?.projectId === c.selectedProjectId || c.preparationResetPlan?.projectId === c.selectedProjectId);
  useEffect(() => { if (preparationOwnsFocus) return; (heading.current ?? main.current?.querySelector<HTMLHeadingElement>('h1'))?.focus(); main.current?.scrollTo?.(0, 0); }, [currentScreen, c.selectedProjectId, preparationOwnsFocus]);
  const meetings = [...c.projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const recent = meetings.filter(p => !p.pinned).slice(0, 5);
  const sidebarMeeting = (p: MeetingProject) => <div key={p.id}><button className={`side-meeting ${p.id === project?.id && flow ? 'active' : ''}`} aria-label={p.title} aria-describedby={p.sourceAssets[0] ? `side-duration-${p.id}` : undefined} disabled={!c.onNavigate || (c.busy && !c.recordingActive)} onClick={() => navigate('import', p.id)}><MeetingIcon icon={p.icon} color={p.color} /><span className="side-meeting-title">{p.title}</span>{p.sourceAssets[0] && <span id={`side-duration-${p.id}`} className="mono side-meeting-duration"><span className="visually-hidden">{t('전체 길이', 'Total duration')} </span>{formatTime(p.sourceAssets[0].durationMs)}</span>}</button>
    {p.id === project?.id && flow && <div className="side-steps">{steps.map((step, index) => <button key={step.id} className={currentScreen === step.id ? 'active' : ''} disabled={!c.onNavigate || (c.busy && !c.recordingActive)} onClick={() => navigate(step.id, p.id)}><span>{index + 1}</span>{t(step.ko, step.en)}</button>)}</div>}</div>;
  return <div className="app-shell">
    <aside className="sidebar" aria-label={t('음성 메모 탐색', 'Voice memo navigation')}>
      <button className="brand" title={t('음성 메모 홈', 'Voice memo home')} aria-current={c.screen === 'home' ? 'page' : undefined} disabled={!c.onNavigate || (c.busy && !c.recordingActive)} onClick={() => navigate('home')}><span className="brand-mark" aria-hidden="true">M</span><strong>Minutes of Meeting</strong></button>
      <MobileNavigation key={`${currentScreen}:${c.selectedProjectId ?? ''}`} language={c.preferences.uiLanguage} screen={currentScreen} navigationDisabled={!c.onNavigate || !!(c.busy && !c.recordingActive)} settingsDisabled={!c.onNavigate} onNavigate={flowController.onNavigate} onLock={c.onLock} />
      {meetings.some(p => p.pinned) && <><div className="side-label">{t('고정', 'Pinned')}</div>{meetings.filter(p => p.pinned).map(sidebarMeeting)}</>}
      <div className="side-label row-between"><button className="plain recent-home" disabled={!c.onNavigate || (c.busy && !c.recordingActive)} onClick={() => navigate('home')}>{t('최근', 'Recent')} <span className="mono">{recent.length}</span></button><button className="plain icon-label" aria-label={t('+ 새 음성 메모', '+ New')} disabled={!c.onCreateMeeting || c.busy} onClick={c.onCreateMeeting}><Plus aria-hidden="true" />{t('새 음성 메모', 'New')}</button></div>
      {recent.map(sidebarMeeting)}
      <div className="side-all">{t('모든 음성 메모', 'All voice memos')} {c.projects.length}{t('개', '')}</div>
      <div className="side-divider" />
      <button className={`side-nav ${currentScreen === 'history' ? 'active' : ''}`} aria-current={currentScreen === 'history' ? 'page' : undefined} disabled={!c.onNavigate || (c.busy && !c.recordingActive)} onClick={() => navigate('history')}>{t('처리 기록', 'History')}</button>
      <button className={`side-nav ${currentScreen === 'settings' ? 'active' : ''}`} disabled={!c.onNavigate} onClick={() => navigate('settings')}>{t('설정', 'Settings')}</button>
      <div className="side-storage"><div className="meter"><span style={{ width: `${c.storageEstimate && c.storageEstimate.quota > 0 ? Math.min(100, c.storageEstimate.usage / c.storageEstimate.quota * 100) : 0}%` }} /></div><span>{c.storageEstimate ? `${formatBytes(c.storageEstimate.usage)} · ${t('이 브라우저 저장소 추정치', 'browser storage estimate')}` : t('저장 공간 추정치를 확인할 수 없어요', 'Storage estimate unavailable')}</span><AutoLockStatus controller={c} /><button disabled={!c.onLock} onClick={c.onLock}>{t('화면 잠금', 'Lock screen')}</button></div>
    </aside>
    <main ref={main} tabIndex={-1} className="main"><div className="main-content"><AutoLockStatus controller={c} />
      {c.busy && <span role="status" className="hint">{c.recordingActive ? t('녹음 중이에요. 설정은 작업을 유지한 채 바꿀 수 있어요.', 'Recording is in progress. Settings keep it running.') : c.minutesGenerating ? t('정리 중이에요. 같은 작업은 한 번만 실행해요.', 'Generating notes. This task runs once.') : t('작업 중이에요. 같은 작업은 한 번만 실행해요.', 'Work is in progress. This task runs once.')}</span>}
      {stopNavigation && <section className="card stack" role="dialog" aria-labelledby="stop-navigation-heading">
        <h2 id="stop-navigation-heading">{t('녹음을 중단하고 이동할까요?', 'Stop recording and move?')}</h2>
        <p>{t('저장된 부분은 보존해요. 중단된 녹음은 조각으로 남을 수 있으며 자동으로 이어 녹음하지 않아요.', 'Saved portions are retained. Interrupted audio may remain as fragments and does not resume automatically.')}</p>
        <div className="actions"><button autoFocus onClick={() => setStopNavigation(null)}>{t('계속 진행', 'Keep going')}</button><button className="danger-outline" disabled={!c.onNavigateAfterStop} onClick={() => { if (stoppingNavigation.current) return; stoppingNavigation.current = true; const destination = stopNavigation; setStopNavigation(null); c.onNavigateAfterStop?.(destination.screen, destination.id); }}>{t('중단하기', 'Stop')}</button></div>
      </section>}
      {flow && <div className="flow-header"><div className="flow-heading-row"><div className="flow-title"><MeetingIcon large icon={project.icon} color={project.color} /><h1 ref={heading} tabIndex={-1}>{project.title}</h1><span className="mono muted">{project.sourceAssets[0] ? formatTime(project.sourceAssets[0].durationMs) : t('파일 가져오기 전', 'No file imported')}</span></div><MemoDeletion key={`${project.id}:${currentScreen}`} controller={c} project={project} /></div><nav className="step-bar" aria-label={t('음성 메모 단계', 'Memo steps')}>{steps.map((step, index) => <button key={step.id} aria-current={currentScreen === step.id ? 'step' : undefined} className={currentScreen === step.id ? 'active' : ''} disabled={!c.onNavigate || (c.busy && !c.recordingActive)} onClick={() => navigate(step.id, project.id)}><span className="mono">{index + 1}</span>{t(step.ko, step.en)}{completedStepKey(project, step.id, c.chunkStates) && <span className="step-complete" aria-label={t('완료', 'Complete')}><Check aria-hidden="true" /></span>}</button>)}</nav></div>}
      {c.error && <div className="error" role="alert">{c.error}</div>}{c.notice && <div className="notice" role="status">{c.notice}</div>}
      {c.screen === 'home' && <Home controller={c} />}
      {currentScreen === 'settings' && <Settings controller={c} />}
      {currentScreen === 'history' && <History controller={c} />}
      {project && c.screen === 'import' && <Import key={project.id} controller={flowController} project={project} initiallyCollapsed={wasCollapsed('import')} />}
      {project && currentScreen === 'stt' && <STT key={project.id} controller={flowController} project={project} initiallyCollapsed={wasCollapsed('stt')} />}
      {project && c.screen === 'minutes' && <Minutes key={`${project.id}:${project.selectedMinutesRevisionId}`} controller={flowController} project={project} />}
      {!project && currentScreen !== 'home' && currentScreen !== 'settings' && currentScreen !== 'history' && <div className="card empty">{t('홈에서 음성 메모를 선택하세요.', 'Choose a voice memo from Home.')}</div>}
    </div></main>
  </div>;
}
export default function App({ controller = emptyController }: { controller?: AppController }) {
  return <div className="mom" data-theme={controller.preferences.theme} data-palette={controller.preferences.palette} lang={controller.preferences.uiLanguage}>
    {controller.screenAccess && controller.screenAccess !== 'open' && !['save-failed', 'new'].includes(controller.session) ? <ScreenGate controller={controller}>{controller.session === 'locked' && <ResetVaultControls controller={controller} />}</ScreenGate> : controller.session === 'unlocked' ? <UnlockedApp controller={controller} /> : <VaultGate key={controller.session} controller={controller} />}
  </div>;
}
