import { loadSourcePreview } from './media/preview';
import { createScreenIdle } from './screen-idle';
import { validateScreenState, withoutDeletedProjectDrafts, type ScreenState } from './vault/screen-state';
import { normalizeRegistrations, validateRegistration, freezeExecutionModel, registrationEndpoint, registrationReadiness, registrationSignature, registrationInputSummary, type ApiCredential, type RegistrationKeyUpdate, type ModelRegistration, type ModelRegistrations, type RegistrationTestInput, type RegistrationTestResult } from './providers/model-registrations';
import { runRegistrationTest } from './providers/registration-test';
import { createRegisteredSTTProvider, createRegisteredMinutesProvider } from './providers/registered-runtime';
import { normalizeSelectionLists, type SelectionLists } from './settings/lists';
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { defaultPreferences } from "./App";
import type { AppController, AppPreferences, AppScreen, SettingsTab, UIConnection, UIHistoryItem, UIPreparation } from "./App";
import { cancelJobs, createJobContext, snapshotProject, transitionRunState } from "./domain/jobs";
import type { AudioOptions, CheckpointWrite, JobContext, MeetingProject, MinutesComparison, MinutesSettings, RunRecord, STTBatchPurpose, TranscriptVersion, ModelRegistry, ModelRegistryRoute, DeletionPlan, RetainedAudio, StorageInventory, RouterSTTPreference, RouterSTTSelection } from "./domain/types";
import { ProviderError, asObject, authHeaders, readOnlyJson, runTranscriptionQueue, type ProviderFailureCode } from "./domain/pipeline";
import { createVaultSession } from "./vault/session";
import type { VaultSession, VaultSessionOptions, VaultState } from "./vault/session";
import { openVaultDatabase, readHeader } from "./vault/store";
import { inspectAudio } from "./media/inspect";
import { createAudioPreparer, planChunkRanges } from "./media/prepare";
import { namedSourceReader, type MediaInput } from "./media/io";
import { validateOptions } from "./media/mp3";
import { MediaError, mediaFailureMessage } from "./media/errors";
import type { MediaWorker, MediaProgress } from "./media/worker";
import { getSTTModel, STT_MODELS } from "./providers/catalog";
import { FIRST_USE_MINUTES_ROUTES } from './providers/model-shortlist';
import type { RouterEndpoint, RouterModel } from "./providers/catalog";
import type { DiscoveredSTTModel } from './providers/discovery';
import { createModelDiscovery } from './providers/discovery';
import { emptyModelRegistry, mergeModelRegistry, observeMinutesRoute, observeSTTRoute, observeRouterSTTRoute, normalizeRouterSTTPreference, observeUnsupportedRoute, registryRouteKey, projectModelRegistry, setRegistryAlias, setRegistryEnabled, setRegistryDefault, acceptRegistryMetadata, normalizeModelRegistry } from './providers/model-registry';
import type { ModelSelectionSubmission } from './ui/components/ModelManager';
import type { RegistryObservation } from './providers/model-registry';
import { addRegistryObservation, modelManagementRows, registryModelChoices, registryRouteMatches } from './providers/registry-consumer';
import { createOpenRouterSTTProvider } from './providers/openrouter-stt';
import { freezeRouterSTTSelection, routerSTTConsentSignature } from './providers/stt-selection';
import { resolveRouterSTTProfile, recommendRouterSTT } from './providers/stt-catalog';
import { createOpenAIProvider } from "./providers/openai";
import { createOpenRouterProvider, hasMinutesEndpointLimits } from "./providers/openrouter";
import { createSTTBatch, replaceSTTBatch, selectChunkRaw, sttActionToken, sttProjectToken, validateSTTBatch } from "./transcript/batches";
import type { STTConsent } from "./transcript/batches";
import { withChunkSources } from "./transcript/merge";
import { editTranscript, reconcileBoundary, resolveBoundary } from "./transcript/versions";
import type { TranscriptEdit } from "./transcript/versions";
import { acknowledgePartialTranscript, createMinutesGenerator, minutesInputSignature, reviseMinutes } from "./minutes/generate";
import { buildMinutesMessages } from "./minutes/prompt";
import { resolveMinutesSettings, validateMinutesBudget } from "./minutes/preferences";
import { previewMinutesSelection, previewRegisteredMinutesSelection, selectionConsentSnapshot } from "./minutes/selection";
import type { MinutesSelectionPreview } from "./minutes/selection";
import { comparisonConsentToken, comparisonMemberState, freezeMinutesComparison, previewComparison, minutesChoiceSnapshot } from "./minutes/compare";
import type { ComparisonChoices, MinutesChoice } from "./minutes/compare";
import type { PartialAcknowledgement } from "./minutes/generate";
import type { RouterSelection } from "./providers/openrouter";
import { projectHistory } from './usage/history';
import { copyMarkdown, downloadMarkdown } from "./minutes/output";
import { createPlayback } from './playback';
import { createMicrophoneRecorder, type MicrophoneRecorder, type MicrophoneRecorderOptions, type RecordingSnapshot } from './recording/recorder';
import type { RecordingAction } from './ui/RecordingControls';
import { preparedAudioReady, retainedChunks, retainedSource, retainedInitialChunkIds } from './ui/copy';
export type ControllerProject = MeetingProject & Readonly<{
    minutesEndpointTag?: string | null;
    failedProviderResponses?: readonly Readonly<{
        runId: string;
        response: unknown;
        failureCode?: ProviderFailureCode;
    }>[];
}>;
export type GenerationConsent = Readonly<{
    acknowledged: true;
    transcriptVersionId: string;
    consentToken: string;
    partialAcknowledged: boolean;
}>;
export type ComparisonConsent = GenerationConsent & Readonly<{ unknownTotalAcknowledged: boolean }>;
const emptyComparison = { comparisonOpen: false, comparisonBModelId: null, comparisonBEndpointTag: null, comparisonBEndpoints: [], minutesComparison: null, comparisonConsentToken: null, selectedComparisonId: null, comparisonRetryMember: null } as const;
export type ControllerSnapshot = AppController & Readonly<{
    minutesEndpoints: readonly Readonly<{
        tag: string;
        label: string;
        enabled: boolean;
        disabledReason?: string;
    }>[];
    minutesEndpointTag: string | null;
    minutesConsentToken: string | null;
    minutesSelection: MinutesSelectionPreview | null;
}>;
export type ControllerOptions = Readonly<{
    databaseName?: string;
    indexedDB?: IDBFactory;
    fetch?: typeof globalThis.fetch;
    sessionFactory?: (options: VaultSessionOptions) => VaultSession;
    recorderFactory?: (options: MicrophoneRecorderOptions) => MicrophoneRecorder;
    mediaWorkerFactory?: (progress?: (value: MediaProgress) => void) => MediaWorker;
    objectUrls?: Readonly<{
        create(blob: Blob): string;
        revoke(url: string): void;
    }>;
}>;
export interface MeetingController {
    startRecording(id: string): Promise<void>;
    pauseRecording(id: string): Promise<void>;
    resumeRecording(id: string): Promise<void>;
    stopRecording(id: string): Promise<void>;
    abortRecording(id: string): Promise<void>;
    refreshStorage(): Promise<void>;
    planAudioDeletion(scope: 'source' | 'chunks', projectId: string): Promise<DeletionPlan>;
    cancelAudioDeletion(): void;
    deletePlannedAudio(token: string): Promise<void>;
    discoverModels(provider: ModelRegistryRoute['provider'], stage: ModelRegistryRoute['stage']): Promise<void>;
    prepareModelSelection(provider: ModelRegistryRoute['provider']): Promise<void>;
    loadModelEndpoints(route: ModelRegistryRoute): Promise<void>;
    applyModelSelection(submission: ModelSelectionSubmission): Promise<void>;
    setModelEnabled(key: string, enabled: boolean): Promise<void>;
    setModelAlias(key: string, alias: string | null): Promise<void>;
    setModelDefault(stage: ModelRegistryRoute['stage'], key: string): Promise<void>;
    acceptModelMetadata(key: string, reviewedRevision: number): Promise<void>;
    setRouterSTTPreference(connectionId: string, preference: RouterSTTPreference): Promise<void>;
    applyRouterSTTRecommendation(connectionId: string, modelId: string): Promise<void>;
    setMinutesRoute(id: string, key: string): Promise<void>;
    getSnapshot(): ControllerSnapshot;
    subscribe(listener: () => void): () => void;
    initialize(): Promise<void>;
    dispose(): Promise<void>;
    noteActivity(): void;
    checkScreenExpiry(): void;
    noteBackground(): Promise<void>;
    createVault(secret: string): Promise<void>;
    unlock(secret: string): Promise<void>;
    lock(): Promise<void>;
    screenLock(): Promise<void>;
    unlockScreen(secret: string): Promise<void>;
    resetVault(): Promise<void>;
    createMeeting(): Promise<string>;
    saveSelectionLists(lists: SelectionLists): Promise<void>;
    updateMeeting(id: string, patch: Partial<Pick<MeetingProject, "title" | "icon" | "color" | "pinned">>): Promise<void>;
    importFile(id: string, file: File): Promise<void>;
    prepareAudio(id: string): Promise<void>;
    planPreparationReset(id:string,audioOptions:AudioOptions):Promise<void>;
    resetPreparation(token:string):Promise<void>;
    startSTT(id: string, consent: STTConsent, chunkIds?: readonly string[], request?: Readonly<{ purpose: STTBatchPurpose; batchId?: string }>): Promise<void>;
    saveKey(provider: UIConnection["provider"], key: string, mode: AppPreferences["keyStorage"]): Promise<void>;
    refreshModels(): Promise<void>;
    setMinutesSettings(id: string, settings: MinutesSettings): Promise<void>;
    setMinutesInstructions(id: string, instructions: string, composing?: boolean): void;
    selectMinutesEndpoint(id: string, tag: string): Promise<void>;
    generateMinutes(id: string, consent: GenerationConsent): Promise<void>;
    setComparisonView(id: string, open: boolean): Promise<void>;
    setComparisonB(id: string, modelId: string, endpointTag: string | null): Promise<void>;
    selectComparison(id: string, comparisonId: string | null, retryMember?: 0 | 1 | null): Promise<void>;
    generateComparison(id: string, consent: ComparisonConsent): Promise<void>;
    editTranscript(id: string, versionId: string, segmentId: string, text: string): Promise<void>;
    editMinutes(id: string, revisionId: string, markdown: string): Promise<void>;
}
const initialAudio: AudioOptions = { chunkMinutes: 5, overlapSeconds: 5, expectedLanguages: ["ko", "en"], bitrateKbps: 32, sampleRateHz: 16000 };
class ControllerError extends Error {
    constructor(readonly kind: "source-mismatch" | "audio-options-locked" | "source-deleted") { super(kind); }
}
function initialSnapshot(): ControllerSnapshot {
    return { ...emptyComparison, apiCredentialChecks: {}, selectionLists: null, session: "locked", projects: [], selectedProjectId: null, screen: "home", settingsTab: "models", preferences: defaultPreferences,
        defaultAudioOptions: initialAudio, modelCatalog: STT_MODELS.map((model) => ({ id: model.id, label: model.id, provider: "openai", kind: "stt", enabled: true, note: model.completenessWarning ?? "" })),
        sttModelId: "gpt-transcribe", connections: [{ provider: "openai", status: "none" }, { provider: "openrouter", status: "none" }], storageEstimate: null,
        minutesEndpoints: [], minutesEndpointTag: null, minutesConsentToken: null, minutesSelection: null, routerSTTSelection: null, busy: false, minutesGenerating: false, sourcePreviewUrl: null, sourceWaveform: null, sourcePreviewLoading: false, sourcePreviewError: null, playback: null, preparation: null, error: null, notice: null };
}
function safeFailure(error: unknown, language: "ko" | "en"): string {
    if (error instanceof MediaError) {
        const message = mediaFailureMessage(error, language);
        if (message) return message;
    }
    if (error instanceof ControllerError) {
        if (error.kind === 'source-deleted') return language === 'en' ? 'The encrypted original was deleted. Its bytes are unavailable, so a reselected file cannot be verified. Create a new voice memo to import again.' : '암호화된 원본이 삭제됐어요. 원본 바이트가 없어 다시 선택한 파일의 일치를 확인할 수 없어요. 새 음성 메모에서 다시 가져오세요.';
        if (error.kind === "source-mismatch")
            return language === "en" ? "The selected file does not match the encrypted original. Existing chunks and transcripts were retained. Reselect the original file." : "선택한 파일이 암호화된 원본과 일치하지 않아요. 기존 청크와 전사문은 유지했어요. 같은 원본 파일을 다시 선택하세요.";
        return language === "en" ? "Existing preparation must be reset before changing chunk and compression settings. Use Chunks & compression to confirm and prepare again." : "기존 준비를 초기화해야 청크·압축 설정을 바꿀 수 있어요. 청크·압축에서 초기화 범위를 확인하고 다시 준비하세요.";
    }
    const code = error instanceof ProviderError ? error.code : "operation";
    if (code === "catalog") return language === "en" ? "The model or provider endpoint catalog could not be loaded. Retry discovery in Settings. Saved selections were retained." : "모델 또는 제공사 엔드포인트 목록을 불러오지 못했어요. 설정에서 목록 조회를 다시 시도하세요. 저장된 선택은 유지돼요.";
    if (code === "data-policy") return language === "en" ? "No provider route meets the selected data-retention policy. Choose another compatible model or review the retention policy before explicitly retrying." : "선택한 데이터 보관 정책을 충족하는 제공사 경로가 없어요. 다른 호환 모델을 선택하거나 보관 정책을 확인한 뒤 다시 전사하세요.";
    const en: Partial<Record<typeof code, string>> = { authentication: "Check the provider key in Settings.", permission: "This key cannot access the selected provider endpoint.", payment: "The provider reported a billing or quota restriction.", context: "The selected route’s context or input limit was exceeded or rejected by the provider. Shorten the selected text or choose another model, then explicitly retry. No text was removed or route switched.", "rate-limit": "The provider requested a cooldown. Retry explicitly after the stated interval.", cooldown: "The provider cooldown has not ended. No request was sent.", timeout: "The provider timed out. The result and charge may be unknown; retry can add cost.", network: "The connection was interrupted. Dispatched work may still incur a charge.", storage: "Encrypted saving failed. New work has stopped. Lock to save completed work, then repair storage or retry saving.", busy: "Another operation is running. Wait or cancel it first.", "ambiguous-attempt": "An earlier request has an unknown outcome. Use an explicit selected-chunk retry and acknowledge possible additional cost." };
    if (language === "en")
        return en[code] ?? "The operation could not be completed. Check the supported file, selected settings and browser storage.";
    return code === "storage" ? "암호화 저장에 실패해 새 작업을 중지했어요. 잠금으로 완료분을 저장한 뒤 저장 공간을 확인하거나 다시 저장하세요." : code === "authentication" ? "설정에서 제공사 API 키를 확인하세요." : code === "busy" ? "다른 작업이 진행 중이에요. 기다리거나 취소하세요." : code === "context" ? "선택 경로의 컨텍스트·입력 한도를 넘거나 제공사가 요청을 거절했어요. 선택 전사문을 줄이거나 다른 모델을 선택한 뒤 직접 다시 시도하세요. 원문 삭제나 경로 변경은 하지 않았어요." : code === "timeout" || code === "network" || code === "ambiguous-attempt" ? "제공사 처리 결과나 비용이 불확실할 수 있어요. 선택한 작업을 명시적으로 다시 요청하면 추가 비용이 생길 수 있어요." : "작업을 완료하지 못했어요. 지원 파일, 선택한 설정과 브라우저 저장소를 확인하세요.";
}
export function createMeetingController(options: ControllerOptions = {}): MeetingController {
    let state = initialSnapshot();
    let uiDrafts: Record<string, unknown> = {};
    let workReturnScreen: AppScreen | null = null;
    let screenRevision = 0;
    let finishingScreenLock: Promise<void> | null = null;
    let activating = false;
    let preparationContinuations = 0;
    type PreparationContext = { jobId: string; projectId: string; sourceId: string | null; settingsFingerprint: string; job: JobContext; startedAtMs: number; snapshot: UIPreparation | null; backgroundStartedAtMs: number | null; backgroundCount: number; backgroundDurationMs: number };
    let activePreparation: PreparationContext | null = null;
    const idle = createScreenIdle({ onExpire: () => { void core.screenLock().catch(() => {}); } });
    let disposed = false;
    let initialized = false;
    let saveBlocked = false;
    let registrationAbort: AbortController | null = null;
    let cancelling = false;
    let duplicateNoticeTimer: ReturnType<typeof setTimeout> | undefined;
    const listeners = new Set<() => void>();
    const pending = new Map<string, CheckpointWrite>();
    const files = new Map<string, File>();
    const previews = new Map<string, string>();
    let previewWork: { projectId: string; abort: AbortController } | null = null;
    const editTimers = new Map<string, ReturnType<typeof setTimeout>>();
    let meetingEditSave: Readonly<{ id: string }> | null = null;
    const instructionsTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const endpointCatalog = new Map<string, readonly RouterEndpoint[]>();
    let routerSTTModels: readonly DiscoveredSTTModel[] = [];
    let routerModels: readonly RouterModel[] = [];
    let metadataRevision = 0;
    let keyAttemptRevision = 0;
    let comparisonRevision = 0;
    let minutesLanguageRevision = 0;
    let comparisonCandidate: MinutesComparison | null = null;
    let sourcePlayer: HTMLAudioElement | null = null;
    let activeOperation: Promise<unknown> | null = null;
    let resetOperation: Promise<void> | null = null;
    let resetRevision = 0;
    let storageRevision = 0, resourcesRevision = 0;
    let storageOperation: Promise<void> | null = null;
    const availability = new Map<string, RetainedAudio>();
    const recordingDraftBytes = new Map<string, number | null>();
    const recordingDrains = new Set<Promise<void>>();
    const idleRecording: RecordingSnapshot = Object.freeze({ state: 'idle', sampleRateHz: null, acceptedSamples: 0, committedSamples: 0, bodyBytes: 0, committedBytes: 0, durationMs: 0, inputLevel: 0, source: null, error: null });
    type CaptureOwner = { projectId: string; generation: number; job: JobContext; recorder: MicrophoneRecorder | null; pending: RecordingAction | null };
    let preparationEditorRevision = 0;
    let recordingGeneration = 0;
    let recordingOwner: CaptureOwner | null = null;
    let recordingView: Readonly<{ projectId: string; snapshot: RecordingSnapshot }> | null = null;
    const databaseName = options.databaseName ?? "mom-encrypted-vault-v1";
    const factory = options.indexedDB ?? globalThis.indexedDB;
    const urls = options.objectUrls ?? { create: (blob: Blob) => URL.createObjectURL(blob), revoke: (url: string) => URL.revokeObjectURL(url) };
    const discovery = createModelDiscovery({ fetch: options.fetch });
    let registry: ModelRegistry | null = null;
    let discovered: readonly RegistryObservation[] = [];
    const emit = () => {
        queueScreenFinalization();
        if (!disposed)
            for (const listener of listeners)
                listener();
    };
    const update = (patch: Partial<ControllerSnapshot>) => { state = Object.freeze({ ...state, ...patch }); emit(); };
    const route = (provider: ModelRegistryRoute['provider'], stage: ModelRegistryRoute['stage'], modelId: string, endpointTag: string | null = null): ModelRegistryRoute => ({ connectionId: provider, provider, stage, modelId, endpointTag });
    function registeredModel(id: string | null | undefined, stage: 'stt' | 'llm'): ModelRegistration | null {
        return state.modelRegistrations?.entries.find(model => model.id === id && model.stage === stage) ?? null;
    }
    function registrationProblem(model: ModelRegistration): string | undefined {
        const issues = [...registrationReadiness(model)];
        if (model.auth === 'bearer' && !state.registrationKeyReady?.includes(model.id)) issues.push('key');
        if (!issues.length) return undefined;
        const en = state.preferences.uiLanguage === 'en';
        const labels: Record<string,string> = { disabled: en ? 'Enable this model' : '모델 활성화', key: en ? 'Enter an API key' : 'API 키 입력', 'credential-origin': en ? 'Enter a key for this server' : '이 서버용 키 입력', 'router-disclosure': en ? 'Review the OpenRouter data policy' : 'OpenRouter 전송·보관 정책 확인', 'ipv6-csp': en ? 'Use localhost or 127.0.0.1' : 'localhost 또는 127.0.0.1 주소 사용', 'stt-limits': en ? 'Set supported audio formats and file limit' : '오디오 포맷·파일 한도 설정', 'llm-limits': en ? 'Set context and output limits' : '컨텍스트·출력 한도 설정' };
        return [...new Set(issues.map(issue => labels[issue] ?? issue))].join(' · ');
    }
    function publishRegisteredChoices(): void {
        const models = state.modelRegistrations?.entries ?? [];
        const p = state.projects.find(project => project.id === state.selectedProjectId) as ControllerProject | undefined;
        const selected = registeredModel(p?.minutesSettings.registrationId, 'llm');
        const minutesRoutes = models.filter(model => model.stage === 'llm').map(model => ({ key: model.id, modelId: model.modelId, endpointTag: registrationEndpoint(model), label: `${model.name} · ${model.modelId} · ${new URL(registrationEndpoint(model)).host}`, enabled: !registrationProblem(model), disabledReason: registrationProblem(model) }));
        update({ modelCatalog: models.map(model => ({ id: model.id, label: `${model.name} · ${model.modelId}`, provider: model.adapter ?? 'openai-compatible', kind: model.stage === 'stt' ? 'stt' : 'minutes', enabled: !registrationProblem(model), disabledReason: registrationProblem(model), note: registrationEndpoint(model) })),
            minutesRoutes, minutesRouteKey: selected?.id ?? null, comparisonBRouteKey: registeredModel(state.comparisonBEndpointTag, 'llm')?.id ?? null,
            modelManagement: null, minutesUnavailableReason: selected ? registrationProblem(selected) : (state.preferences.uiLanguage === 'en' ? 'Select a notes model in Model management.' : '모델 관리에서 정리 모델을 등록하고 선택하세요.') });
    }
    async function registeredKey(model: ModelRegistration, job: JobContext): Promise<string | null> {
        job.assertActive(); assertUnlocked();
        const current = registeredModel(model.id, model.stage);
        if (!current || registrationSignature(current) !== registrationSignature(model) || registrationProblem(current)) throw new ProviderError('permission');
        const key = await session.getProviderKey('registration:' + model.id);
        job.assertActive(); assertUnlocked();
        if (registrationSignature(registeredModel(model.id, model.stage) ?? model) !== registrationSignature(model)) throw new ProviderError('permission');
        return key;
    }
    function eligible(modelId: string, endpointTag: string | null, stage: ModelRegistryRoute['stage']): boolean {
        return !!registry && projectModelRegistry(registry, stage).choices.some(choice => choice.route.modelId === modelId && choice.route.endpointTag === endpointTag);
    }
    function publishRegistry(statusText: string | null = state.modelManagement?.statusText ?? null, discoveryError: string | null = state.modelManagement?.error ?? null): void {
        if (state.modelRegistrations?.version === 2) { publishRegisteredChoices(); return; }
        if (!registry) return;
        const p = state.projects.find(project => project.id === state.selectedProjectId) as ControllerProject | undefined;
        const selected = [{ stage: 'stt' as const, modelId: state.sttModelId, endpointTag: null }, { stage: 'minutes' as const, modelId: p?.minutesSettings.modelId ?? '', endpointTag: p?.minutesEndpointTag ?? null }, { stage: 'minutes' as const, modelId: state.comparisonBModelId ?? '', endpointTag: state.comparisonBEndpointTag ?? null }];
        const choices = projectModelRegistry(registry, 'minutes').choices;
        const minutesRoutes = choices.map(choice => ({ key: choice.key, modelId: choice.route.modelId, endpointTag: choice.route.endpointTag!, label: `${choice.label} · ${choice.route.modelId} · ${choice.route.endpointTag}`, enabled: true }));
        for (const item of selected.filter(item => item.stage === 'minutes' && item.modelId)) {
            if (!minutesRoutes.some(choice => choice.modelId === item.modelId && choice.endpointTag === item.endpointTag)) minutesRoutes.push({ key: registryRouteKey(route('openrouter', 'minutes', item.modelId, item.endpointTag)), modelId: item.modelId, endpointTag: item.endpointTag ?? '', label: `${item.modelId} · ${item.endpointTag ?? 'no endpoint'} · blocked; enable/refresh in Settings`, enabled: false });
        }
        update({ modelRegistry: registry, modelCatalog: registryModelChoices(registry, routerModels, selected), minutesRoutes,
            minutesRouteKey: p?.minutesSettings.modelId ? registryRouteKey(route('openrouter', 'minutes', p.minutesSettings.modelId, p.minutesEndpointTag ?? null)) : null,
            comparisonBRouteKey: state.comparisonBModelId ? registryRouteKey(route('openrouter', 'minutes', state.comparisonBModelId, state.comparisonBEndpointTag ?? null)) : null,
            minutesUnavailableReason: p?.minutesSettings.modelId && (!eligible(p.minutesSettings.modelId, p.minutesEndpointTag ?? null, 'minutes') || !routerModels.some(model => model.id === p.minutesSettings.modelId) || !endpointCatalog.get(p.minutesSettings.modelId)?.some(endpoint => endpoint.tag === p.minutesEndpointTag)) ? (state.preferences.uiLanguage === 'en' ? 'Enable this exact route and refresh its metadata in Settings before sending.' : '설정에서 이 경로를 활성화하고 메타데이터를 새로 확인한 뒤 전송하세요.') : undefined,
            modelManagement: { revision: metadataRevision, onApplySelection: submission => core.applyModelSelection(submission), rows: modelManagementRows(registry, discovered).map(row => ({ ...row, catalogListedAt: row.route.provider === 'openrouter' && row.route.stage === 'minutes' ? routerModels.find(model => model.id === row.route.modelId)?.createdAt ?? null : null })), language: state.preferences.uiLanguage, busy: !!state.busy, discoveryAvailability: { openai: state.connections.some(item => item.provider === 'openai' && item.status !== 'none'), openrouter: true }, statusText, error: discoveryError,
                onPrepareSelection: provider => core.prepareModelSelection(provider), onDiscover: (provider, stage) => launch(() => core.discoverModels(provider, stage)), onLoadEndpoints: route => launch(() => core.loadModelEndpoints(route)), onEnabled: (key, enabled) => launch(() => core.setModelEnabled(key, enabled)), onAlias: (key, alias) => launch(() => core.setModelAlias(key, alias)), onDefault: (stage, key) => launch(() => core.setModelDefault(stage, key)), onAcceptMetadata: (key, reviewedRevision) => launch(() => core.acceptModelMetadata(key, reviewedRevision)) } });
    }
    async function saveRegistry(next: ModelRegistry, job: JobContext): Promise<void> {
        try { await session.saveModelRegistry(next, job); } catch { job.assertActive(); throw new ProviderError('storage'); }
        job.assertActive(); registry = next; metadataRevision++; comparisonRevision++; comparisonCandidate = null;
        update({ minutesConsentToken: null, minutesSelection: null, comparisonConsentToken: null, minutesComparison: null });
        publishRegistry(); await refreshConsent(job);
    }
    function preferenceWith(key: string): ModelRegistry {
        if (!registry) throw new ProviderError('permission');
        const observation = discovered.find(item => registryRouteKey(item.route) === key);
        return observation ? addRegistryObservation(registry, observation) : registry;
    }
    async function discover(provider: ModelRegistryRoute['provider'], stage: ModelRegistryRoute['stage'], job: JobContext): Promise<void> {
        if (!registry) throw new ProviderError('permission');
        const prior = registry, at = new Date().toISOString();
        metadataRevision++; comparisonRevision++; comparisonCandidate = null;
        update({ minutesConsentToken: null, minutesSelection: null, comparisonConsentToken: null, minutesComparison: null });
        publishRegistry();
        try {
            let observations: RegistryObservation[] = [], models: readonly RouterModel[] | null = null, sttModels: readonly DiscoveredSTTModel[] | null = null;
            const endpoints = new Map<string, readonly RouterEndpoint[]>();
            if (provider === 'openrouter' && stage === 'minutes') {
                models = await discovery.loadOpenRouterMinutes(job);
                observations = models.map(model => observeMinutesRoute(route(provider, stage, model.id), model, null));
                // Complete stored exact routes before authoritative merge. A
                // single failed endpoint fetch prevents every partial success.
                for (const id of new Set(prior.entries.filter(entry => entry.route.connectionId === provider && entry.route.stage === stage && entry.route.endpointTag && models!.some(model => model.id === entry.route.modelId)).map(entry => entry.route.modelId))) {
                    const found = await discovery.loadOpenRouterEndpoints(id, job); endpoints.set(id, found);
                    for (const entry of prior.entries.filter(entry => entry.route.connectionId === provider && entry.route.stage === stage && entry.route.modelId === id && entry.route.endpointTag)) {
                        const endpoint = found.find(endpoint => endpoint.tag === entry.route.endpointTag);
                        if (endpoint) observations.push(observeMinutesRoute(entry.route, models.find(model => model.id === id)!, endpoint));
                    }
                }
            } else if (provider === 'openrouter') {
                sttModels = await discovery.loadOpenRouterSTT(job);
                observations = sttModels.map(model => observeRouterSTTRoute(route(provider, stage, model.id), model));
            } else {
                const models = await discovery.loadOpenAIModels(() => session.getProviderKey('openai'), job);
                observations = models.map(model => stage === 'stt' && model.sttModel ? observeSTTRoute(route(provider, stage, model.id), model.sttModel) : observeUnsupportedRoute(route(provider, stage, model.id), { name: model.name ?? model.id, source: model.source, checkedAt: model.checkedAt }));
            }
            job.assertActive();
            const storedKeys = new Set(prior.entries.map(entry => registryRouteKey(entry.route)));
            const next = mergeModelRegistry(prior, { connectionId: provider, stage, status: 'success', checkedAt: at, observations: observations.filter(item => storedKeys.has(registryRouteKey(item.route))) });
            // Complete provider responses stay ephemeral; preferences alone save.
            try { await session.saveModelRegistry(next, job); } catch { job.assertActive(); throw new ProviderError('storage'); }
            job.assertActive();
            registry = next;
            discovered = [...discovered.filter(item => item.route.connectionId !== provider || item.route.stage !== stage), ...observations];
            if (sttModels) routerSTTModels = sttModels;
            if (models) { routerModels = models; endpointCatalog.clear(); for (const [id, found] of endpoints) endpointCatalog.set(id, found); }
            metadataRevision++; comparisonRevision++; comparisonCandidate = null;
            update({ minutesConsentToken: null, minutesSelection: null, comparisonConsentToken: null, minutesComparison: null });
            publishRegistry(models?.length === 0 || sttModels?.length === 0 || !observations.length ? (state.preferences.uiLanguage === 'en' ? 'No models returned. Retry discovery or choose another provider. Saved choices were retained.' : '목록에 모델이 없어요. 다시 조회하거나 다른 제공사를 선택하세요. 저장된 선택은 유지돼요.') : state.preferences.uiLanguage === 'en' ? `Complete ${provider}/${stage} listing checked ${at}. Inference unverified; new routes remain disabled.` : `${provider}/${stage} 전체 목록 확인: ${at}. 실제 추론은 미검증이며 새 경로는 비활성 상태예요.`, null);
            await refreshConsent(job);
        } catch (error) {
            job.assertActive();
            if (error instanceof ProviderError && error.code === 'storage') throw error;
            // No partially assembled data replaces prior routes or evidence.
            if (provider === 'openrouter' && stage === 'stt') routerSTTModels = [];
            await saveRegistry(mergeModelRegistry(prior, { connectionId: provider, stage, status: 'failed', checkedAt: at, observations: [] }), job);
            publishRegistry(null, safeFailure(error, state.preferences.uiLanguage)); throw error;
        }
    }
    function sttChoice(modelId: string, batchRoute?: ModelRegistryRoute) {
        return registry && projectModelRegistry(registry, 'stt').choices.find(choice => choice.route.modelId === modelId && choice.route.endpointTag === null && (!batchRoute || registryRouteKey(choice.route) === registryRouteKey(batchRoute)));
    }
    function routerSTTSelectionFor(p: MeetingProject, chunkIds: readonly string[], chosenRoute: ModelRegistryRoute): RouterSTTSelection | null {
        if (!registry || chosenRoute.provider !== 'openrouter' || state.connections.find(connection => connection.provider === 'openrouter')?.status === 'none') return null;
        const preference = registry.openRouterSTT?.[chosenRoute.connectionId], model = routerSTTModels.find(model => model.id === chosenRoute.modelId);
        if (!model || preference?.acknowledgedDisclosureVersion !== 'or-stt-1' || !registryRouteMatches(registry, observeRouterSTTRoute(chosenRoute, model))) return null;
        try { return freezeRouterSTTSelection(p, chunkIds, chosenRoute, model, preference.policy); } catch { return null; }
    }
    function sttPolicyBlocked(model: ModelRegistration | null, id = state.selectedProjectId): boolean {
        if (model?.adapter !== 'openrouter') return false;
        const project = state.projects.find(project => project.id === id) as ControllerProject | undefined;
        const run = [...(project?.runs ?? [])].reverse().find(run => run.intent?.kind === 'stt' && run.intent.modelSnapshot?.id === model.id && registrationSignature(run.intent.modelSnapshot) === registrationSignature(model));
        const failure = project?.failedProviderResponses?.find(item => item.runId === run?.id);
        const response = asObject(failure?.response);
        return run?.state === 'failed' && (failure?.failureCode === 'data-policy' || response?.code === 404 && asObject(response.metadata)?.failed_routing_step === 'Filter by Data Policy');
    }
    function sttUnavailableReason(): string | undefined {
        if (state.modelRegistrations?.version === 2) {
            const model = registeredModel(state.sttModelId, 'stt');
            if (sttPolicyBlocked(model)) return safeFailure(new ProviderError('data-policy'), state.preferences.uiLanguage);
            return model ? registrationProblem(model) : state.preferences.uiLanguage === 'en' ? 'Select a transcription model in Model management.' : '모델 관리에서 전사 모델을 등록하고 선택하세요.';
        }
        const choice = sttChoice(state.sttModelId), english = state.preferences.uiLanguage === 'en';
        if (!choice) return english ? 'Enable this transcription route in Settings.' : '설정에서 이 전사 경로를 활성화하세요.';
        if (state.connections.find(connection => connection.provider === choice.route.provider)?.status === 'none') {
            const name = choice.route.provider === 'openrouter' ? 'OpenRouter' : 'OpenAI';
            return english ? `Enter your ${name} key in Settings.` : `설정에서 ${name} 키를 입력하세요.`;
        }
        if (choice.route.provider === 'openrouter' && (registry?.openRouterSTT?.[choice.route.connectionId]?.acknowledgedDisclosureVersion !== 'or-stt-1' ||
            !routerSTTModels.some(model => model.id === state.sttModelId && resolveRouterSTTProfile(model))))
            return english ? 'Refresh this STT profile and acknowledge the OpenRouter data policy in Settings.' : '설정에서 전사 프로필을 새로 확인하고 OpenRouter 데이터 정책을 확인하세요.';
        return undefined;
    }
    function sttDisclosure(p: MeetingProject): RouterSTTSelection | null {
        const choice = sttChoice(state.sttModelId);
        const retained = availability.get(p.id)?.chunkIds ?? [];
        return choice ? routerSTTSelectionFor(p, p.preparedChunks.filter(chunk => retained.includes(chunk.id)).map(chunk => chunk.id), choice.route) : null;
    }
    function sttConsentBase(p: MeetingProject): string {
        const registered = registeredModel(state.sttModelId, 'stt');
        if (registered) return JSON.stringify([sttProjectToken(p, metadataRevision), registrationSignature(registered)]);
        const disclosure = sttDisclosure(p);
        return JSON.stringify([sttProjectToken(p, metadataRevision), disclosure ? routerSTTConsentSignature(disclosure) : null]);
    }
    const getProject = (id: string): ControllerProject => {
        const project = state.projects.find((item) => item.id === id);
        if (!project)
            throw new ProviderError("invalid-input");
        // This is a verified view, never an invented edit/checkpoint for legacy
        // projects. Absence stays unavailable until ownership is checked.
        return { ...project, retainedAudio: availability.get(id) };
    };
    const beginPreparation = (project: MeetingProject, job: JobContext): PreparationContext => {
        const context: PreparationContext = { jobId: crypto.randomUUID(), projectId: project.id, sourceId: project.sourceAssets[0]?.id ?? null, settingsFingerprint: JSON.stringify(project.audioOptions), job, startedAtMs: Date.now(), snapshot: null, backgroundStartedAtMs: null, backgroundCount: 0, backgroundDurationMs: 0 };
        activePreparation = context; return context;
    };
    function assertPreparation(context: PreparationContext): ControllerProject {
        context.job.assertActive();
        const project = getProject(context.projectId);
        if (activePreparation !== context || (project.sourceAssets[0]?.id ?? null) !== context.sourceId || JSON.stringify(project.audioOptions) !== context.settingsFingerprint)
            throw new DOMException('Audio preparation no longer current', 'AbortError');
        return project;
    }
    function preparationSummary(context: PreparationContext, project: MeetingProject, stage: UIPreparation['stage'], detail: Partial<UIPreparation> = {}): UIPreparation {
        const now = Date.now();
        if (['complete', 'failed', 'stopped'].includes(stage) && context.backgroundStartedAtMs !== null) {
            context.backgroundDurationMs += Math.max(0, now - context.backgroundStartedAtMs); context.backgroundStartedAtMs = null;
        }
        const source = project.sourceAssets[0], saved = retainedChunks(project).filter(chunk => chunk.sourceId === source?.id);
        const ranges = source ? planChunkRanges(source.durationMs, project.audioOptions) : null;
        let savedThroughMs = 0;
        for (const range of ranges ?? []) {
            if (!saved.some(chunk => chunk.sourceStartMs === range.sourceStartMs && chunk.sourceEndMs === range.sourceEndMs && chunk.encodedBytes > 0 && !!chunk.audioRecordId)) break;
            savedThroughMs = range.sourceEndMs;
        }
        const previous = context.snapshot;
        return { ...previous, ...(previous?.stage !== stage ? { phaseProcessedMs: null, phaseDurationMs: null } : {}),
            sourceProcessedMs: previous?.sourceProcessedMs ?? 0, durationMs: source?.durationMs ?? previous?.durationMs ?? null, ...detail,
            stage, jobId: context.jobId, ...(context.sourceId ? { sourceId: context.sourceId } : {}), settingsFingerprint: context.settingsFingerprint,
            startedAtMs: context.startedAtMs, lastProgressAtMs: now, backgroundCount: context.backgroundCount, backgroundDurationMs: context.backgroundDurationMs,
            completed: saved.length, total: ranges?.length ?? null, savedThroughMs, savedEncodedBytes: saved.reduce((bytes, chunk) => bytes + chunk.encodedBytes, 0) };
    }
    function reportPreparation(context: PreparationContext, stage: UIPreparation['stage'], detail: Partial<UIPreparation> = {}): void {
        const project = assertPreparation(context);
        context.snapshot = preparationSummary(context, project, stage, detail);
        update({ preparation: context.snapshot });
    }
    function reportMediaPreparation(context: PreparationContext, progress: MediaProgress): void {
        const stage = progress.stage ?? 'preparing';
        reportPreparation(context, stage, { ...(stage === 'preparing' ? { sourceProcessedMs: progress.sourceProcessedMs } : {}),
            ...(progress.durationMs > 0 ? { durationMs: progress.durationMs } : {}), phaseProcessedMs: progress.phaseProcessedMs ?? null, phaseDurationMs: progress.phaseDurationMs ?? null });
    }
    const preparationFailureCode = (error: unknown) => error instanceof MediaError || error instanceof ProviderError ? error.code : 'local-processing-failed';
    const showProject = (project: MeetingProject) => { update({ projects: Object.freeze([...state.projects.filter((item) => item.id !== project.id), project]) }); };
    const pauseSource = () => { sourcePlayer?.pause(); };
    const playback = createPlayback({ urls, onChange: playback => update({ playback }), pauseSource });
    const clearPlayback = () => { playback.stop(); pauseSource(); sourcePlayer = null; };
    const releaseSourcePreview = (id?: string) => {
        if (!id || state.selectedProjectId === id) { pauseSource(); sourcePlayer = null; }
        if (!id || previewWork?.projectId === id) { previewWork?.abort.abort(); previewWork = null; }
        for (const [projectId, url] of previews) if (!id || projectId === id) { urls.revoke(url); previews.delete(projectId); }
        if (!id || state.selectedProjectId === id) update({ sourcePreviewUrl: null, sourceWaveform: null, sourcePreviewLoading: false, sourcePreviewError: null });
    };
    const restoreSourcePreview = async (id: string) => {
        if (!interactive() || state.selectedProjectId !== id || state.screen !== 'import') return;
        const project = getProject(id), source = project.sourceAssets[0];
        if (!source || !retainedSource(project)) { releaseSourcePreview(id); return; }
        releaseSourcePreview();
        const abort = new AbortController(), parent = createJobContext(), revision = screenRevision;
        const owner = { projectId: id, abort }; previewWork = owner;
        const stop = () => abort.abort(); parent.signal.addEventListener('abort', stop, { once: true });
        const job: JobContext = { signal: abort.signal, epoch: parent.epoch, assertActive() {
            parent.assertActive();
            if (abort.signal.aborted || previewWork !== owner || revision !== screenRevision || !interactive() || state.screen !== 'import' || state.selectedProjectId !== id || !retainedSource(getProject(id)) || getProject(id).sourceAssets[0]?.id !== source.id) throw new DOMException('Preview stopped', 'AbortError');
        } };
        update({ sourcePreviewLoading: true, sourcePreviewError: null });
        try {
            const input = files.get(id) ?? namedSourceReader(await session.openRetainedSource(source.id, job), source.fileName);
            job.assertActive();
            const result = await loadSourcePreview(input, source, job, options.mediaWorkerFactory);
            job.assertActive();
            const url = result.audio ? urls.create(result.audio) : null;
            try { job.assertActive(); } catch (error) { if (url) urls.revoke(url); throw error; }
            if (url) previews.set(id, url);
            update({ sourcePreviewUrl: url, sourceWaveform: result.peaks, sourcePreviewLoading: false,
                sourcePreviewError: result.audio ? result.peaks ? null : state.preferences.uiLanguage === 'ko' ? '파형을 열지 못했지만 음성은 미리들을 수 있어요.' : 'Waveform unavailable. Audio playback is still available.' : state.preferences.uiLanguage === 'ko' ? `저장된 원본의 미리듣기는 64 MiB까지 지원해요. ${result.peaks ? '파형은 전체 음성을 표시해요.' : '이 브라우저에서 파형을 열지 못했어요.'}` : `Playback of retained originals supports up to 64 MiB. ${result.peaks ? 'The waveform covers all audio.' : 'The waveform is unavailable in this browser.'}` });
        } catch {
            if (!abort.signal.aborted && previewWork === owner) {
                try { job.assertActive(); update({ sourcePreviewLoading: false, sourcePreviewError: state.preferences.uiLanguage === 'ko' ? '저장된 원본의 미리듣기를 열지 못했어요. 원본 보관 상태와 브라우저 지원을 확인하세요.' : 'Could not open the retained audio preview. Check original availability and browser support.' }); } catch { /* A lock or source change owns the current view. */ }
            }
        } finally {
            parent.signal.removeEventListener('abort', stop);
            if (previewWork === owner) {
                previewWork = null;
                if (abort.signal.aborted && interactive() && state.screen === 'import' && state.selectedProjectId === id)
                    update({ sourcePreviewLoading: false, sourcePreviewError: state.preferences.uiLanguage === 'ko' ? '미리듣기 준비가 중단됐어요. 다시 열어 주세요.' : 'Audio preview preparation was interrupted. Open it again.' });
            }
        }
    };
    const releaseResources = () => {
        resourcesRevision++;
        releaseSourcePreview();
        void cutRecording(true).catch(() => {});
        recordingDraftBytes.clear();
        for (const timer of editTimers.values())
            clearTimeout(timer);
        editTimers.clear();
        meetingEditSave = null;
        for (const timer of instructionsTimers.values()) clearTimeout(timer);
        instructionsTimers.clear();
        clearPlayback();
        for (const url of previews.values())
            urls.revoke(url);
        previews.clear();
        files.clear();
        endpointCatalog.clear(); routerModels = []; routerSTTModels = []; registry = null; discovered = [];
    };
    const stateMap = (vaultState: VaultState): AppController["session"] => vaultState === "lock-save-failed" ? "save-failed" : vaultState;
    const session = (options.sessionFactory ?? createVaultSession)({ databaseName, indexedDB: factory, screenLockManaged: true,
        capturePending: () => { const writes = [...pending.values()]; pending.clear(); return writes; },
        onState: (next) => { if (next !== "unlocked") void cutRecording(true).catch(() => {}); update({ session: stateMap(next) }); },
        onSensitiveClear: () => { releaseSourcePreview(); activePreparation = null; idle.stop(); screenRevision++; uiDrafts = {}; workReturnScreen = null; registrationAbort?.abort(); registrationAbort=null; metadataRevision++; void cutRecording(true).catch(() => {}); storageRevision++; availability.clear(); if (state.resettingVault) pending.clear(); clearPlayback(); comparisonCandidate = null; flushSync(() => update({ ...emptyComparison, uiDrafts: {}, selectionLists: null, modelRegistrations: null, registrationKeyReady: [], credentialKeyReady: [], apiCredentialChecks: {}, registrationTest: null, keySaveAttempts: {}, projects: [], selectedProjectId: null, historyProjectId:null, preparationEditor:null, preparationResetPlan:null, storageInventory: null, audioDeletionPlan: null, storageWorking: false, storageError: null, storageNotice: null, modelRegistry: null, modelManagement: null, modelCatalog: null, routerSTTSelection: null, minutesRoutes: [], minutesRouteKey: null, comparisonBRouteKey: null, sourcePreviewUrl: null, playback: null, history: [], chunkStates: [], preparation: null, minutesEndpoints: [], minutesEndpointTag: null, minutesConsentToken: null, minutesSelection: null, minutesInstructionsSaving: false, meetingEditsSaving: false, connections: [{ provider: "openai", status: "none" }, { provider: "openrouter", status: "none" }], busy: false, minutesGenerating: false, error: null, notice: null })); },
        teardown: releaseResources,
    });
    function runtimeWork(): boolean {
        const captureState = recordingOwner?.recorder?.getSnapshot().state;
        const capture = !!recordingOwner && !['error', 'aborted', 'saved'].includes(captureState ?? 'permission');
        return !!activeOperation || capture || !!recordingDrains.size || !!storageOperation || preparationContinuations > 0;
    }
    function screenState(): ScreenState {
        return validateScreenState({ version: 1, autoLockSeconds: state.preferences.autoLockSeconds === undefined ? 60 : state.preferences.autoLockSeconds,
            lockWorkPolicy: state.preferences.lockWorkPolicy ?? 'standard',
            restore: { screen: state.screen, selectedProjectId: state.selectedProjectId, settingsTab: state.settingsTab, drafts: uiDrafts } });
    }
    function retainScreenState(): void {
        if (session.state !== 'unlocked') return;
        // The vault stages this snapshot before awaiting its serialized public write.
        void session.saveScreenState(screenState(), createJobContext()).catch(() => { if (state.session === 'unlocked') update({ error: state.preferences.uiLanguage === 'ko' ? '화면 복원 정보와 잠금 설정을 저장하지 못했어요. 완료 작업은 보존하며 전체 잠금에서 저장을 다시 시도해요.' : 'Screen state could not be saved. Completed work is retained; full locking retries saving.' }); });
    }
    function queueScreenFinalization(): void {
        if (disposed || activating || finishingScreenLock || state.screenAccess !== 'locked' || session.state !== 'unlocked' || runtimeWork()) return;
        // Wait until the current callback has published its result and save receipt.
        queueMicrotask(() => {
            if (disposed || activating || finishingScreenLock || state.screenAccess !== 'locked' || session.state !== 'unlocked' || runtimeWork()) return;
            finishingScreenLock = core.lock().catch(() => {}).finally(() => { finishingScreenLock = null; });
        });
    }
    function interactive(): boolean {
        idle.check();
        return !disposed && state.session === 'unlocked' && state.screenAccess !== 'locked' && state.screenAccess !== 'verifying';
    }
    function assertUnlocked(): void {
        if (disposed || state.session !== "unlocked" || session.state !== "unlocked")
            throw new ProviderError("permission");
    }
    async function execute<T>(action: (job: JobContext) => Promise<T>): Promise<T> {
        assertUnlocked();
        if (state.busy || cancelling || saveBlocked || recordingOwner || recordingDrains.size)
            throw new ProviderError(saveBlocked ? "storage" : "busy");
        const job = createJobContext();
        update({ busy: true, error: null, notice: null });
        const operation = Promise.resolve().then(async () => {
            try {
                const result = await action(job);
                job.assertActive();
                return result;
            }
            catch (error) {
                if (job.signal.aborted)
                    throw new DOMException("Job no longer active", "AbortError");
                if (state.session === "unlocked" && !job.signal.aborted) {
                    if (error instanceof ProviderError && error.code === "storage")
                        saveBlocked = true;
                    update({ error: safeFailure(error, state.preferences.uiLanguage),
                        ...(state.preparation && ['inspecting', 'reading', 'decoding', 'preparing', 'verifying', 'saving'].includes(state.preparation.stage)
                            ? { preparation: { ...state.preparation, stage: 'failed' as const, errorCode: preparationFailureCode(error), lastProgressAtMs: Date.now() } } : {}) });
                }
                throw error instanceof ProviderError || error instanceof ControllerError || error instanceof MediaError ? error : new Error(safeFailure(error, state.preferences.uiLanguage));
            }
            finally {
                if (activeOperation === operation) {
                    activeOperation = null;
                    if (state.session === "unlocked")
                        update({ busy: saveBlocked || cancelling, minutesGenerating: false });
                }
            }
        });
        activeOperation = operation;
        return operation;
    }
    async function publishRegistrations(value:ModelRegistrations, job:JobContext):Promise<void> {
        const ready:string[]=[], credentialReady:string[]=[];
        for (const entry of value.entries) {
            if (entry.auth === 'bearer' && entry.credentialOrigin === new URL(registrationEndpoint(entry)).origin && await session.getProviderKey('registration:'+entry.id)) ready.push(entry.id);
            job.assertActive();
        }
        for (const credential of value.credentials ?? []) {
            if (await session.getProviderKey('credential:'+credential.id)) credentialReady.push(credential.id);
            job.assertActive();
        }
        assertUnlocked(); update({modelRegistrations:value,registrationKeyReady:ready,credentialKeyReady:credentialReady});
        publishRegisteredChoices();
    }
    async function saveRegistration(value:ModelRegistration,keyUpdate:RegistrationKeyUpdate={action:'keep'}):Promise<void> {
        const entry=validateRegistration(value);
        await execute(async job => {
            const saved=await session.saveRegisteredModel(entry,keyUpdate,job);job.assertActive();
            metadataRevision++; comparisonRevision++; comparisonCandidate=null;
            await publishRegistrations(saved,job);update({apiCredentialChecks:{},registrationTest:null,minutesConsentToken:null,comparisonConsentToken:null});
            await refreshConsent(job);
        });
    }
    async function importRegistrations(values:readonly ModelRegistration[]):Promise<void> {
        await execute(async job => {
            const current=normalizeRegistrations(await session.loadModelRegistrations(job));
            const ids=new Set(current.entries.map(model=>model.id));
            const imported=values.map(value=>{if(ids.has(value.id))throw new ProviderError('invalid-input');ids.add(value.id);return validateRegistration({...value,enabled:false,credentialId:undefined,credentialOrigin:null,credentialVersion:0,lastTest:undefined});});
            const next=normalizeRegistrations({...current,entries:[...current.entries,...imported]});
            await session.saveModelRegistrations(next,job);job.assertActive();
            metadataRevision++;await publishRegistrations(await session.loadModelRegistrations(job),job);await refreshConsent(job);
        });
    }
    async function deleteRegistration(id:string):Promise<void> {
        await execute(async job=>{
            const current=normalizeRegistrations(await session.loadModelRegistrations(job));
            if(!current.entries.some(model=>model.id===id))throw new ProviderError('invalid-input');
            const next=normalizeRegistrations({...current,entries:current.entries.filter(model=>model.id!==id),
                defaults:{stt:current.defaults.stt===id?null:current.defaults.stt,llm:current.defaults.llm===id?null:current.defaults.llm},
                legacyRouteIds:Object.fromEntries(Object.entries(current.legacyRouteIds).filter(([,modelId])=>modelId!==id))});
            await session.saveModelRegistrations(next,job);job.assertActive();
            metadataRevision++;comparisonRevision++;comparisonCandidate=null;
            if(state.sttModelId===id)update({sttModelId:''});
            await publishRegistrations(await session.loadModelRegistrations(job),job);
            update({registrationTest:null,minutesConsentToken:null,comparisonConsentToken:null});await refreshConsent(job);
        });
    }
    async function checkApiCredential(id:string):Promise<void> {
        await execute(async job=>{
            const credential=state.modelRegistrations?.credentials?.find(key=>key.id===id);
            if(!credential)throw new ProviderError('invalid-input');
            const report=(status:NonNullable<AppController['apiCredentialChecks']>[string])=>update({apiCredentialChecks:{...state.apiCredentialChecks,[id]:status}});
            const endpoint=credential.origin==='https://api.openai.com'?'https://api.openai.com/v1/models':credential.origin==='https://openrouter.ai'?'https://openrouter.ai/api/v1/key':null;
            if(!endpoint){report({state:'unsupported',message:state.preferences.uiLanguage==='en'?'This server has no supported authentication check. Test a registered model instead.':'이 서버는 인증 확인 경로가 정해지지 않았어요. 등록한 모델에서 테스트하세요.'});return;}
            report({state:'checking',message:''});
            const signal=AbortSignal.any([job.signal,AbortSignal.timeout(15000)]);
            const checkJob:JobContext={...job,signal,assertActive(){job.assertActive();signal.throwIfAborted();}};
            try {
                const headers=await authHeaders(()=>session.getProviderKey('credential:'+id),checkJob);
                const body=await readOnlyJson(options.fetch??globalThis.fetch.bind(globalThis),endpoint,{method:'GET',headers,signal,redirect:'error',credentials:'omit'},Date.now,checkJob);
                if(credential.origin==='https://api.openai.com'?!Array.isArray(body.data):!asObject(body.data))throw new ProviderError('malformed');
                job.assertActive();report({state:'verified',message:state.preferences.uiLanguage==='en'?'Authentication verified. Model inference has not been tested.':'인증을 확인했어요. 실제 모델 실행은 별도 테스트가 필요해요.'});
            } catch(error) {job.assertActive();report({state:'failed',message:safeFailure(error,state.preferences.uiLanguage)});throw error;}
        });
    }
    async function changeApiCredential(value:ApiCredential,keyUpdate:RegistrationKeyUpdate):Promise<void> {
        await execute(async job=>{
            const saved=await session.saveApiCredential(value,keyUpdate,job);job.assertActive();
            metadataRevision++;comparisonRevision++;comparisonCandidate=null;
            await publishRegistrations(saved,job);update({apiCredentialChecks:{},registrationTest:null,minutesConsentToken:null,comparisonConsentToken:null});
            await refreshConsent(job);
        });
    }
    async function deleteApiCredential(id:string):Promise<void> {
        await execute(async job=>{
            const saved=await session.deleteApiCredential(id,job);job.assertActive();
            metadataRevision++;comparisonRevision++;comparisonCandidate=null;
            await publishRegistrations(saved,job);update({apiCredentialChecks:{},registrationTest:null,minutesConsentToken:null,comparisonConsentToken:null});
            await refreshConsent(job);
        });
    }
    async function setRegistrationDefault(stage:'stt'|'llm',id:string|null):Promise<void> {
        await execute(async job=>{
            const current=normalizeRegistrations(await session.loadModelRegistrations(job));
            if(id!==null&&!current.entries.some(model=>model.id===id&&model.stage===stage&&model.enabled))throw new ProviderError('invalid-input');
            const next=normalizeRegistrations({...current,defaults:{...current.defaults,[stage]:id}});
            await session.saveModelRegistrations(next,job);job.assertActive();
            if(stage==='stt'&&(!state.sttModelId||state.sttModelId===current.defaults.stt))update({sttModelId:id??''});
            metadataRevision++;await publishRegistrations(await session.loadModelRegistrations(job),job);await refreshConsent(job);
        });
    }
    async function testRegistration(value:ModelRegistration,input:RegistrationTestInput,routerAcknowledged=false):Promise<void> {
        await execute(async job => {
            const current=state.modelRegistrations?.entries.find(item=>item.id===value.id);
            if (!current || registrationSignature(current)!==registrationSignature(value)) throw new ProviderError('invalid-input');
            if (new URL(value.baseUrl).hostname==='openrouter.ai' && !routerAcknowledged) throw new ProviderError('permission');
            const started=Date.now();const local=new AbortController();registrationAbort=local;
            let saving:Promise<ModelRegistrations>|null=null;
            const completed=(result:RegistrationTestResult)=>{
                job.assertActive();saving=session.saveRegistrationTest(value.id,result,job);void saving.catch(()=>{});
                update({registrationTest:{id:value.id,running:false,saving:true,result,saved:false}});
            };
            const signal=AbortSignal.any([job.signal,local.signal]);
            const testJob:JobContext={epoch:job.epoch,signal,assertActive(){job.assertActive();signal.throwIfAborted();}};
            update({registrationTest:{id:value.id,running:true,saving:false,result:null,saved:false}});
            try {
                let result:RegistrationTestResult;
                try { result=await runRegistrationTest(value,input,testJob,{getKey:()=>session.getProviderKey('registration:'+value.id),fetch:options.fetch,onCompleted:completed}); }
                catch(error) {
                    job.assertActive();if(!local.signal.aborted)throw error;
                    result={signature:registrationSignature(value),inputSignature:'',inputSummary:registrationInputSummary(input),state:'outcome-unknown',status:null,elapsedMs:Date.now()-started,text:'',raw:'',message:'Cancelled; provider outcome and charges may be unknown',requestedModel:value.modelId,returnedModel:null,usage:null};
                }
                job.assertActive();if(!saving)completed(result);
                try {const saved=await saving!;job.assertActive();await publishRegistrations(saved,job);update({registrationTest:{id:value.id,running:false,saving:false,result,saved:true}});}
                catch {job.assertActive();update({registrationTest:{id:value.id,running:false,saving:false,result,saved:false}});throw new ProviderError('storage');}
            } finally {if(registrationAbort===local)registrationAbort=null;}
        });
    }
    async function retryRegistrationResult():Promise<void> {
        assertUnlocked();const pending=state.registrationTest;if(!pending?.result||pending.saved||pending.running||pending.saving||activeOperation)throw new ProviderError('busy');
        const job=createJobContext();update({busy:true,registrationTest:{...pending,saving:true}});
        try {const saved=await session.saveRegistrationTest(pending.id,pending.result,job);job.assertActive();await publishRegistrations(saved,job);saveBlocked=false;update({registrationTest:{...pending,saving:false,saved:true},busy:false,error:null});}
        catch {job.assertActive();update({busy:true,registrationTest:{...pending,saving:false},error:safeFailure(new ProviderError('storage'),state.preferences.uiLanguage)});throw new ProviderError('storage');}
    }
    async function saveProject(project: MeetingProject, job: JobContext, audioRecords: CheckpointWrite["audioRecords"] = [], runId: string | null = null): Promise<MeetingProject> {
        job.assertActive();
        const write = { project: snapshotProject({ ...project, updatedAt: new Date().toISOString() }), runId, audioRecords };
        pending.set(project.id, write);
        try {
            const result = await session.store.checkpoint(write, job);
            job.assertActive();
            if (pending.get(project.id) === write)
                pending.delete(project.id);
            const prior = availability.get(project.id), records = new Set(audioRecords.map(record => record.recordId));
            availability.set(project.id, result.project.retainedAudio ?? {
                sourceIds: result.project.sourceAssets.filter(source => prior?.sourceIds.includes(source.id) || records.has(source.id)).map(source => source.id),
                chunkIds: result.project.preparedChunks.filter(chunk => prior?.chunkIds.includes(chunk.id) || records.has(chunk.audioRecordId)).map(chunk => chunk.id),
            });
            update({ storageInventory: null });
            // A synchronous text edit can arrive during the encrypted write.
            // Keep its newer pending snapshot visible until its own checkpoint.
            showProject(pending.get(project.id)?.project ?? result.project);
            return result.project;
        }
        catch {
            job.assertActive();
            throw new ProviderError("storage");
        }
    }
    async function refreshConsent(job: JobContext): Promise<MinutesSettings | null> {
        const languageRevision = minutesLanguageRevision;
        const previewRevision = metadataRevision;
        const p = state.projects.find((project) => project.id === state.selectedProjectId) as ControllerProject | undefined;
        const settings = p ? resolveMinutesSettings(p.minutesSettings, state.preferences.uiLanguage) : null;
        const selectedVersion = p?.transcriptVersions.find((version) => version.id === p.selectedTranscriptVersionId);
        const transcript = p && selectedVersion ? withChunkSources(selectedVersion, p.rawTranscripts, p.preparedChunks) : null;
        if (state.modelRegistrations?.version === 2 && p && settings) {
            const registered = registeredModel(settings.registrationId, 'llm');
            const preview = previewRegisteredMinutesSelection(registered, transcript ?? null, settings);
            let token: string | null = null;
            if (registered && transcript && !registrationProblem(registered) && preview.status === 'fits') {
                const input = await minutesInputSignature(transcript, settings); job.assertActive();
                const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([p.id,input,registrationSignature(registered),metadataRevision,languageRevision])));job.assertActive();
                token = [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
            }
            if (languageRevision !== minutesLanguageRevision || previewRevision !== metadataRevision || p.id !== state.selectedProjectId) return null;
            update({minutesConsentToken:token,minutesSelection:preview,minutesEndpoints:[],minutesEndpointTag:registered?registrationEndpoint(registered):null});
            await refreshComparisonConsent(job);publishRegisteredChoices();return settings;
        }
        const endpoints = p ? endpointCatalog.get(p.minutesSettings.modelId) ?? [] : [];
        const selected = p?.minutesEndpointTag ?? null;
        const model = routerModels.find((item) => item.id === p?.minutesSettings.modelId) ?? null;
        const endpoint = endpoints.find((item) => item.tag === selected) ?? null;
        const outputTokens = settings?.outputTokens ?? (model?.maxOutputTokens != null && endpoint?.maxOutputTokens != null ? Math.min(4096, model.maxOutputTokens, endpoint.maxOutputTokens) : null);
        const reasoningReserveTokens = 0;
        let messages: ReturnType<typeof buildMinutesMessages> | null = null;
        try { if (transcript && settings) messages = buildMinutesMessages(transcript, settings); } catch { /* Preview remains available for known catalog fields. */ }
        const preview = p ? previewMinutesSelection({ model, endpoint, messages, outputTokens, reasoningReserveTokens }) : null;
        let token: string | null = null;
        if (p && settings && transcript && model && endpoint && routerChoice(model.id, endpoint.tag)) {
            try {
                const input = await minutesInputSignature(transcript, settings);
                job.assertActive();
                const metadata = selectionConsentSnapshot(model, endpoint, outputTokens, reasoningReserveTokens);
                const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([p.id, input, metadata, metadataRevision, languageRevision])));
                job.assertActive();
                token = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
            }
            catch {
                job.assertActive();
            }
        }
        job.assertActive();
        // UI language changes fence older hashes without cancelling paid work.
        if (languageRevision !== minutesLanguageRevision || previewRevision !== metadataRevision || (p?.id ?? null) !== state.selectedProjectId) return null;
        update({ minutesEndpointTag: selected, minutesConsentToken: token, minutesSelection: preview, minutesEndpoints: endpoints.map((endpoint) => ({ tag: endpoint.tag, label: `${endpoint.providerName ?? endpoint.tag} · ${endpoint.tag}`, enabled: eligible(endpoint.modelId, endpoint.tag, 'minutes') && !!model && hasMinutesEndpointLimits(model, endpoint), disabledReason: "Required endpoint limits are unavailable." })) });
        await refreshComparisonConsent(job);
        publishRegistry();
        return languageRevision === minutesLanguageRevision ? settings : null;
    }
    function routerChoice(modelId: string | null | undefined, endpointTag: string | null | undefined): RouterSelection | null {
        const model = routerModels.find(item => item.id === modelId);
        const endpoint = endpointCatalog.get(modelId ?? "")?.find(item => item.tag === endpointTag);
        return model && endpoint && registry && registryRouteMatches(registry, observeMinutesRoute(route('openrouter', 'minutes', model.id, endpoint.tag), model, endpoint)) ? { model, endpoint } : null;
    }
    function minutesChoice(modelId:string|null|undefined, endpointTag:string|null|undefined, registrationId?:string|null, snapshot?:ModelRegistration):MinutesChoice|null {
        const registered=registeredModel(registrationId,'llm');
        if (registered) return !registrationProblem(registered)&&(!snapshot||registrationSignature(registered)===registrationSignature(snapshot))?{registration:registered}:null;
        if (registrationId||snapshot) return null;
        return routerChoice(modelId,endpointTag);
    }
    async function refreshComparisonConsent(job: JobContext): Promise<void> {
        const languageRevision = minutesLanguageRevision, revision = comparisonRevision;
        comparisonCandidate = null;
        const p = state.projects.find(project => project.id === state.selectedProjectId) as ControllerProject | undefined;
        const record = p?.minutesComparisons?.find(record => record.id === state.selectedComparisonId);
        const bEndpoints = endpointCatalog.get(state.comparisonBModelId ?? "") ?? [];
        const bModel = routerModels.find(model => model.id === state.comparisonBModelId) ?? null;
        if (!p || !state.comparisonOpen) { update({ minutesComparison: null, comparisonConsentToken: null }); return; }
        const choices: ComparisonChoices = record ? record.members.map(member=>minutesChoice(member.modelId,member.endpointTag,member.modelSnapshot?.id,member.modelSnapshot)) as unknown as ComparisonChoices : [minutesChoice(p.minutesSettings.modelId,p.minutesEndpointTag,p.minutesSettings.registrationId),minutesChoice(state.comparisonBModelId,state.comparisonBEndpointTag,registeredModel(state.comparisonBEndpointTag,'llm')?.id)];
        const selected = p.transcriptVersions.find(version => version.id === p.selectedTranscriptVersionId);
        const transcript = record?.transcript ?? (selected ? withChunkSources(selected, p.rawTranscripts, p.preparedChunks) : null);
        // Saved retries keep their accepted language/budget, even in app mode.
        const settings = record?.settings ?? resolveMinutesSettings(p.minutesSettings, state.preferences.uiLanguage);
        const preview = previewComparison({ transcript, settings, choices, ...(record ? { outputTokens: record.outputTokens, messages: record.messages } : {}) });
        let token: string | null = null;
        if (preview.status === "fits" && transcript && preview.outputTokens && choices[0] && choices[1] && (!record || state.comparisonRetryMember != null)) {
            const frozen = record ?? await freezeMinutesComparison(p.id, transcript, settings, [choices[0], choices[1]], preview.outputTokens);
            job.assertActive();
            token = await comparisonConsentToken(frozen, [choices[0], choices[1]], metadataRevision + comparisonRevision, state.comparisonRetryMember ?? null);
            job.assertActive();
            if (languageRevision !== minutesLanguageRevision || revision !== comparisonRevision || p.id !== state.selectedProjectId) return;
            comparisonCandidate = frozen;
        }
        job.assertActive();
        if (languageRevision !== minutesLanguageRevision || revision !== comparisonRevision || p.id !== state.selectedProjectId) return;
        update({ minutesComparison: preview, comparisonConsentToken: token, comparisonBEndpoints: bEndpoints.map(endpoint => ({ tag: endpoint.tag, label: `${endpoint.providerName ?? endpoint.tag} · ${endpoint.tag}`, enabled: eligible(endpoint.modelId, endpoint.tag, 'minutes') && !!bModel && hasMinutesEndpointLimits(bModel, endpoint) })) });
    }
    async function loadEndpoints(modelId: string, job: JobContext, refresh = false): Promise<void> {
        // Navigation and settings selection never implicitly refresh provider metadata.
        job.assertActive();
        if (!modelId || !refresh) return;
        const endpoints = await discovery.loadOpenRouterEndpoints(modelId, job);
        job.assertActive(); endpointCatalog.set(modelId, endpoints);
    }
    async function restore(creating: boolean): Promise<void> {
        const job = createJobContext();
        saveBlocked = false;
        const selectionLists = await session.loadSelectionLists(job); job.assertActive(); assertUnlocked();
        update({ selectionLists });
        const projects = await session.store.listProjects(job);
        job.assertActive();
        await readInventory(job);
        update({ projects, selectedProjectId: projects[0]?.id ?? null, screen: "home", busy: cancelling });
        for (const provider of ["openai", "openrouter"] as const) {
            const hasKey = await session.getProviderKey(provider);
            job.assertActive();
            update({ connections: state.connections.map((item) => item.provider === provider ? { provider, status: hasKey ? "saved" : "none" } : item) });
        }
        registry = await session.loadModelRegistry(job); job.assertActive();
        if (registry === null) {
            let seed = emptyModelRegistry();
            // Only registry-absent legacy vaults retain their previous static choices.
            // Creating a new vault grants no enablement or default selection.
            if (!creating) {
                for (const id of ['gpt-transcribe', 'gpt-4o-mini-transcribe']) {
                    const observation = observeSTTRoute(route('openai', 'stt', id), getSTTModel(id));
                    seed = setRegistryEnabled(addRegistryObservation(seed, observation), registryRouteKey(observation.route), true);
                }
                seed = setRegistryDefault(seed, 'stt', registryRouteKey(route('openai', 'stt', 'gpt-transcribe')));
            }
            await session.saveModelRegistry(seed, job); job.assertActive(); registry = seed;
        }
        const sttDefault = registry.entries.find(entry => registryRouteKey(entry.route) === registry!.defaults.stt);
        const registrations=normalizeRegistrations(await session.loadModelRegistrations(job));job.assertActive();
        const restored=projects.map(project=>{
            const p=project as ControllerProject;
            const legacy=registry?.entries.find(entry=>entry.route.stage==='minutes'&&entry.route.modelId===p.minutesSettings.modelId&&entry.route.endpointTag===p.minutesEndpointTag);
            const id=p.minutesSettings.registrationId??(legacy?registrations.legacyRouteIds[registryRouteKey(legacy.route)]:undefined);
            return {...p,...(!p.sttRegistrationId&&registrations.defaults.stt?{sttRegistrationId:registrations.defaults.stt}:{}),minutesSettings:{...p.minutesSettings,...(id?{registrationId:id}:{})}};
        });
        update({projects:restored,sttModelId:restored[0]?.sttRegistrationId??registrations.defaults.stt??sttDefault?.route.modelId??''});
        await publishRegistrations(registrations,job);
        publishRegistry(creating ? (state.preferences.uiLanguage === 'en' ? 'No model is selected automatically. Discover and explicitly enable a compatible route in Settings.' : '모델을 자동으로 선택하지 않아요. 설정에서 호환 경로를 조회하고 직접 활성화하세요.') : state.preferences.uiLanguage === 'en' ? 'First-run STT choices use documented static metadata, not account discovery. Verify limits and long-chunk completeness.' : '초기 전사 모델은 문서의 정적 메타데이터예요. 계정 목록 조회가 아니며 한도와 긴 청크의 완전성을 확인하세요.');
        await refreshConsent(job);
        const savedScreen = await session.loadScreenState(job); job.assertActive();
        if (savedScreen) {
            const restored = savedScreen.restore;
            uiDrafts = restored ? structuredClone(restored.drafts) : {};
            const projectExists = restored?.selectedProjectId && state.projects.some(p => p.id === restored.selectedProjectId);
            const screens = ['home', 'import', 'stt', 'review', 'minutes', 'settings', 'history'];
            const tabs = ['connections', 'keys', 'models', 'defaults', 'appearance', 'security', 'history'];
            update({ preferences: { ...state.preferences, autoLockSeconds: savedScreen.autoLockSeconds, lockWorkPolicy: savedScreen.lockWorkPolicy ?? 'standard' }, uiDrafts,
                ...(restored && screens.includes(restored.screen) ? { screen: (projectExists || ['home','settings','history'].includes(restored.screen) ? restored.screen : 'home') as AppScreen,
                    selectedProjectId: projectExists ? restored.selectedProjectId : null,
                    settingsTab: (tabs.includes(restored.settingsTab) ? restored.settingsTab : 'models') as SettingsTab } : {}) });
        }
        if (typeof globalThis.navigator?.storage?.estimate === "function") {
            try {
                const estimate = await navigator.storage.estimate();
                job.assertActive();
                if (typeof estimate.usage === "number" && typeof estimate.quota === "number")
                    update({ storageEstimate: { usage: estimate.usage, quota: estimate.quota } });
            }
            catch {
                job.assertActive();
            }
        }
        const strictHidden = state.preferences.lockWorkPolicy === 'strict' && typeof document !== 'undefined' && document.visibilityState === 'hidden';
        update({ screenAccess: strictHidden ? 'locked' : 'open', screenUnlockError: false });
        if (!strictHidden) idle.start(state.preferences.autoLockSeconds === undefined ? 60 : state.preferences.autoLockSeconds);
    }
    function applyInventory(inventory: StorageInventory): void {
        availability.clear();
        recordingDraftBytes.clear();
        for (const item of inventory.projects) {
            availability.set(item.projectId, item.retainedAudio);
            recordingDraftBytes.set(item.projectId, item.draftIds.length ? item.draftBytes : null);
        }
        update({ storageInventory: inventory });
    }
    async function readInventory(job: JobContext): Promise<void> {
        const inventory = await session.getStorageInventory(job); job.assertActive(); assertUnlocked(); applyInventory(inventory);
    }
    async function restoreLocalConnections(job: JobContext): Promise<void> {
        registry = await session.loadModelRegistry(job); job.assertActive(); assertUnlocked();
        const selectionLists = await session.loadSelectionLists(job); job.assertActive(); assertUnlocked();
        const connections: UIConnection[] = [];
        for (const provider of ['openai', 'openrouter'] as const) {
            const present = !!(await session.getProviderKey(provider)); job.assertActive(); assertUnlocked();
            connections.push({ provider, status: present ? 'saved' : 'none' });
        }
        update({ connections, selectionLists }); publishRegistry();
    }
    async function deletePlannedAudio(token: string): Promise<void> {
        assertUnlocked();
        if (storageOperation || state.busy || cancelling || saveBlocked || recordingOwner || recordingDrains.size) throw new ProviderError('busy');
        const plan = state.audioDeletionPlan;
        if (!plan || !['source', 'chunks'].includes(plan.scope) || !plan.projectId || token !== plan.versionToken) throw new ProviderError('invalid-input');
        const revision = ++storageRevision, resourceBefore = resourcesRevision;
        const guard = () => { assertUnlocked(); if (revision !== storageRevision) throw new DOMException('Cleanup no longer current', 'AbortError'); };
        update({ storageWorking: true, busy: true, audioDeletionPlan: null, storageError: null, storageNotice: null, minutesConsentToken: null, comparisonConsentToken: null, minutesSelection: null, minutesComparison: null });
        const operation = (async () => {
            let failure: unknown;
            try {
                // This API intentionally cancels the supplied public job. Its
                // definitive result must not be discarded by execute's old guard.
                await session.executeDeletion(plan, { accepted: true, token }, createJobContext()); guard();
                availability.clear();
            } catch (error) { failure = error; }
            try {
                guard(); const job = createJobContext();
                if (resourcesRevision !== resourceBefore) {
                    metadataRevision++; comparisonRevision++; comparisonCandidate = null;
                    update({ sourcePreviewUrl: null, playback: null, preparation: null, minutesInstructionsSaving: false, meetingEditsSaving: false });
                    await restoreLocalConnections(job); guard();
                }
                // Failure captures can be newer than the durable project. Keep
                // completed editor state until retry/lock actually saves it.
                if (!failure) {
                    const projects = await session.store.listProjects(job); job.assertActive(); guard(); update({ projects });
                }
                const inventory = await session.getStorageInventory(job); job.assertActive(); guard(); applyInventory(inventory);
                await refreshConsent(job); job.assertActive(); guard();
                if (failure) throw failure;
                update({ storageNotice: state.preferences.uiLanguage === 'en' ? 'Selected audio deletion is confirmed.' : '선택한 음성 삭제를 확인했어요.' });
            } catch (error) {
                guard();
                const message = state.preferences.uiLanguage === 'en'
                    ? 'Audio deletion is not confirmed. Completed edits remain visible; lock to save them if needed. Refresh storage and request a new confirmation before retrying.'
                    : '음성 삭제 완료를 확인하지 못했어요. 완료된 수정은 화면에 유지돼요. 필요하면 잠가서 저장하고, 저장소를 새로 확인한 뒤 새 확인을 요청하세요.';
                update({ storageError: message, storageNotice: null }); throw error;
            }
        })();
        storageOperation = operation;
        try { await operation; } finally {
            if (storageOperation === operation) storageOperation = null;
            if (!disposed && revision === storageRevision && state.session === 'unlocked') update({ storageWorking: false, busy: saveBlocked || cancelling });
        }
    }
    async function activate(secret: string, creating: boolean): Promise<void> {
        if (state.session !== "new" && state.session !== "locked")
            throw new ProviderError("busy");
        activating = true; idle.stop(); update({ error: null, screenAccess: 'verifying', screenUnlockError: false });
        const revision = resetRevision;
        try {
            if (creating)
                await session.create(secret, secret);
            else
                await session.unlock(secret);
            secret = "";
            // A successful activation ends a prior failed reset attempt. Future lock
            // failures must retain ordinary save recovery, not stale reset-only UI.
            update({ resettingVault: false, resetVaultError: null });
            await restore(creating);
            if (state.screenAccess === 'locked' && session.state === 'unlocked') await core.lock();
        }
        catch {
            secret = "";
            // A response from the discarded vault cannot lock or annotate its successor.
            if (revision !== resetRevision)
                throw new DOMException('Activation no longer current', 'AbortError');
            if (session.state === "unlocked") {
                try {
                    await session.lock("manual");
                }
                catch { /* Save failure keeps the generic lock recovery gate. */ }
            }
            update({ screenAccess: 'open', error: safeFailure(new ProviderError("permission"), state.preferences.uiLanguage) });
            throw new ProviderError("permission");
        }
        finally { activating = false; emit(); }
    }
    async function selectProject(screen: AppScreen, id?: string, stopCapture = false): Promise<void> {
        if (screen === "review") screen = "stt";
        assertUnlocked();
        if (runtimeWork() && (screen === 'settings' || state.screen === 'settings' && screen === workReturnScreen && (id ?? state.selectedProjectId) === state.selectedProjectId)) {
            if (screen === 'settings' && state.screen !== 'settings') workReturnScreen = state.screen;
            clearPlayback(); update({ screen }); return;
        }
        if (recordingOwner && !stopCapture) throw new ProviderError('busy');
        if (recordingOwner) await abortCapture(true);
        else recordingView = null;
        assertUnlocked();
        if (state.busy || recordingDrains.size)
            throw new ProviderError("busy");
        const selected = id ?? state.selectedProjectId;
        workReturnScreen = null;
        if (selected)
            getProject(selected);
        clearPlayback();
        comparisonCandidate = null;
        update({ ...emptyComparison, screen, historyProjectId: screen === 'history' ? id ?? null : null, preparationEditor:null, preparationResetPlan:null, audioDeletionPlan: null, preparation: null, ...(screen === 'settings' && state.settingsTab === 'history' ? { settingsTab: 'models' as const } : {}), selectedProjectId: selected, sourcePreviewUrl: selected ? previews.get(selected) ?? null : null, minutesConsentToken: null, minutesSelection: null });
        if (screen === 'history') return;
        const job = createJobContext();
        if (screen === 'settings') await readInventory(job);
        const project = selected ? getProject(selected) : null;
        if(project?.sttRegistrationId)update({sttModelId:project.sttRegistrationId});
        if (selected) { const audio = await session.getAudioAvailability(selected, job); job.assertActive(); assertUnlocked(); availability.set(selected, audio); await readRecordingDrafts(selected, job); emit(); }
        if (project?.minutesSettings.modelId) {
            try {
                await loadEndpoints(project.minutesSettings.modelId, job);
            }
            catch {
                job.assertActive();
            }
        }
        await refreshConsent(job);
    }
    async function changeVersion(id: string, versionId: string, action?: (p: MeetingProject) => MeetingProject): Promise<void> {
        await execute(async (job) => {
            comparisonRevision++;
            const p = getProject(id);
            if (!p.transcriptVersions.some((version) => version.id === versionId))
                throw new ProviderError("invalid-input");
            await saveProject(action ? action(p) : { ...p, selectedTranscriptVersionId: versionId }, job);
            await refreshConsent(job);
        });
    }
    async function cancelWork(localPreparation = false): Promise<void> {
        assertUnlocked();
        if (cancelling)
            throw new ProviderError("busy");
        const titleSave = meetingEditSave;
        const stoppedPreparation = localPreparation ? activePreparation : null;
        cancelling = true;
        update({ busy: true, preparation: null });
        try {
            cancelJobs();
            const job = createJobContext();
            clearPlayback();
            try {
                await activeOperation;
            }
            catch { /* Public work is now fenced. */ }
            job.assertActive();
            if (state.session !== "unlocked")
                return;
            if (saveBlocked)
                throw new ProviderError("storage");
            // A completed private snapshot is newer than the public requesting
            // project. Promote it before classifying genuinely unfinished runs.
            for (const write of [...pending.values()]) {
                job.assertActive();
                await saveProject(write.project, job, write.audioRecords, write.runId);
            }
            for (const p of state.projects) {
                const runs = p.runs.map((run) => run.state === "requesting" ? { ...run, state: "outcome-unknown" as const, checkpoint: null } : run.state === "queued" ? { ...run, state: "cancelled" as const, checkpoint: null } : run);
                if (runs.some((run, index) => run !== p.runs[index]))
                    await saveProject({ ...p, runs }, job);
            }
            job.assertActive();
            let preparation: UIPreparation | null = null;
            if (stoppedPreparation) {
                const durable = await session.store.readProject(stoppedPreparation.projectId, job); job.assertActive();
                if (durable) preparation = preparationSummary(stoppedPreparation, durable, 'stopped');
            }
            update({ minutesGenerating: false, preparation, notice: localPreparation ? (state.preferences.uiLanguage === "en" ? "Local preparation stopped. Encrypted saved chunks are retained." : "로컬 음성 준비를 중지했어요. 암호화 저장된 청크는 유지돼요.") : state.preferences.uiLanguage === "en" ? "Work stopped. Dispatched requests may still incur charges; unknown attempts require explicit retry." : "작업을 중지했어요. 전송된 요청에는 비용이 생길 수 있고, 결과가 불명확하면 명시적으로 다시 요청해야 해요." });
        }
        catch (error) {
            if (error instanceof ProviderError && error.code === "storage")
                saveBlocked = true;
            throw error;
        }
        finally {
            clearMeetingEditSave(titleSave);
            cancelling = false;
            if (state.session === "unlocked")
                update({ busy: saveBlocked, minutesGenerating: false });
        }
    }
    async function play(id: string, chunkId: string, startMs?: number, endMs?: number): Promise<void> {
        assertUnlocked();
        if (saveBlocked) throw new ProviderError("storage");
        if (state.storageWorking) throw new ProviderError('busy');
        const chunk = retainedChunks(getProject(id)).find(item => item.id === chunkId);
        if (!chunk) throw new ProviderError("invalid-input");
        const job = createJobContext();
        await playback.play({ projectId: id, chunkId, kind: startMs === undefined ? 'chunk' : 'segment',
            startSeconds: ((startMs ?? chunk.sourceStartMs) - chunk.sourceStartMs + chunk.encodingOffsetMs) / 1000,
            ...(endMs === undefined ? {} : { endSeconds: (endMs - chunk.sourceStartMs + chunk.encodingOffsetMs) / 1000 }) }, (signal, assertPlayback) =>
            session.store.readAudio(chunk.audioRecordId, { epoch: job.epoch, signal, assertActive: () => { job.assertActive(); assertPlayback(); assertUnlocked(); } }));
    }
    function changeComparison(project: MeetingProject, comparisonId: string, member: 0 | 1, change: (record: MinutesComparison["members"][number]) => MinutesComparison["members"][number]): MeetingProject {
        if (!project.minutesComparisons?.some(record => record.id === comparisonId)) throw new ProviderError("invalid-input");
        return { ...project, minutesComparisons: project.minutesComparisons.map(record => record.id !== comparisonId ? record : { ...record, members: record.members.map((entry, index) => index === member ? change(entry) : entry) as unknown as MinutesComparison["members"] }) };
    }
    // Both single and comparison members use the same intent, generator, raw
    // response and encrypted result checkpoint path. A resolves this before B.
    async function generateAndCheckpoint(id: string, transcript: TranscriptVersion, settings: MinutesSettings, selection: MinutesChoice, outputTokens: number, reasoningReserveTokens: number, job: JobContext, acknowledgement?: PartialAcknowledgement, comparison?: Readonly<{ record: MinutesComparison; member: 0 | 1; consentToken: string }>): Promise<void> {
        const registered='registration' in selection?freezeExecutionModel(selection.registration):null;
        const legacy='model' in selection?selection:null;
        const executionModel=registered?freezeExecutionModel({...registered,llm:{...registered.llm,maxTokens:outputTokens}}):null;
        const provider = registered?createRegisteredMinutesProvider({model:executionModel!,getKey:()=>registeredKey(registered,job),fetch:options.fetch,minutesMessages:comparison?.record.messages}):createOpenRouterProvider({ getKey: () => session.getProviderKey("openrouter"), fetch: options.fetch, selection:legacy!, buildMessages: comparison ? () => comparison.record.messages : buildMinutesMessages, maxOutputTokens: outputTokens, reasoningReserveTokens });
        const requestedModel=registered?.modelId??legacy!.model.id;
        const requestedEndpoint=registered?registrationEndpoint(registered):legacy!.endpoint.tag;
        const rates=registered?.catalogEvidence?.pricing.snapshot??(legacy?.endpoint.pricing?{source:legacy.endpoint.source,checkedAt:legacy.endpoint.checkedAt,currency:'USD',rates:[{unit:'text-input-token' as const,units:1,price:legacy.endpoint.pricing.prompt},{unit:'text-output-token' as const,units:1,price:legacy.endpoint.pricing.completion},...(legacy.endpoint.pricing.request===null?[]:[{unit:'request' as const,units:1,price:legacy.endpoint.pricing.request}])]}:null);
        let record: RunRecord | null = null;
        const generator = createMinutesGenerator({ frozenInput: comparison?.record, preflight: request => provider.preflightMinutes(request), provider: { async generate(request, context) {
            record = transitionRunState({ id: request.runId, projectId: id, state: "queued", checkpoint: null, intent: { kind: "minutes", chunkId: null, requestedModel, expectedLanguages: [], requestedEndpoint, rateSnapshot:rates, ...(executionModel?{modelSnapshot:executionModel}:{}) } }, "requesting");
            const current = getProject(id);
            let intent: MeetingProject = { ...current, runs: [...current.runs, record] };
            if (comparison) intent = changeComparison(intent, comparison.record.id, comparison.member, member => ({ ...member, attempts: [...member.attempts, { runId: request.runId, revisionId: null, consentToken: comparison.consentToken, selectionSnapshot: minutesChoiceSnapshot(selection, outputTokens, reasoningReserveTokens) }] }));
            await saveProject(intent, context); context.assertActive();
            return provider.generate(request, context);
        } } });
        try {
            const run = await generator.generateMinutes(transcript, settings, job, acknowledgement); job.assertActive();
            const current = getProject(id); const revision = reviseMinutes(run, run.generatedMarkdown);
            const requesting = current.runs.find(item => item.id === run.id);
            if (!requesting) throw new ProviderError("malformed");
            const saving = transitionRunState(transitionRunState(requesting, "response-received"), "saving");
            let result: MeetingProject = { ...current, minutesRuns: [...current.minutesRuns, run], minutesRevisions: [...current.minutesRevisions, revision], selectedMinutesRevisionId: revision.id, runs: current.runs.map(item => item.id === run.id ? saving : item) };
            if (comparison) result = changeComparison(result, comparison.record.id, comparison.member, member => ({ ...member, attempts: member.attempts.map(attempt => attempt.runId === run.id ? { ...attempt, revisionId: revision.id } : attempt) }));
            await saveProject(result, job, [], run.id); job.assertActive();
        } catch (error) {
            job.assertActive();
            if (record && !(error instanceof ProviderError && error.code === "storage")) {
                const current = getProject(id);
                const failed = transitionRunState(record, error instanceof ProviderError && error.outcomeUnknown ? "outcome-unknown" : "failed");
                const response = error instanceof ProviderError ? error.readSensitiveResponse() : undefined;
                const failureProject: ControllerProject = { ...current, runs: current.runs.map(item => item.id === failed.id ? failed : item), ...(response === undefined ? {} : { failedProviderResponses: [...(current.failedProviderResponses ?? []), { runId: failed.id, response }] }) };
                const snapshot = snapshotProject(failureProject);
                if (error instanceof ProviderError) error.clearSensitiveResponse();
                await saveProject(snapshot, job); job.assertActive();
            }
            throw error;
        }
    }
    function recordingSupported(): boolean {
        return globalThis.isSecureContext === true && typeof globalThis.navigator?.mediaDevices?.getUserMedia === 'function' && typeof globalThis.AudioContext === 'function' && typeof globalThis.AudioWorkletNode === 'function';
    }
    function emptyForRecording(p: MeetingProject): boolean {
        return !p.sourceAssets.length && !p.preparedChunks.length && !p.rawTranscripts.length && !p.transcriptVersions.length && !p.minutesRuns.length && !p.minutesRevisions.length && !p.runs.length && !p.sttBatches?.length && !p.minutesComparisons?.length && p.selectedTranscriptVersionId === null && p.selectedMinutesRevisionId === null;
    }
    function assertCapture(owner: CaptureOwner): void {
        owner.job.assertActive(); assertUnlocked();
        if (recordingOwner !== owner || owner.generation !== recordingGeneration) throw new DOMException('Capture owner no longer current', 'AbortError');
    }
    function retainDrain(operation: Promise<void>): Promise<void> {
        const drain = operation.finally(() => { recordingDrains.delete(drain); emit(); });
        recordingDrains.add(drain); void drain.catch(() => {}); return drain;
    }
    function cutRecording(clearView: boolean): Promise<void> {
        const owner = recordingOwner;
        recordingOwner = null; recordingGeneration++;
        if (clearView) recordingView = null;
        if (!owner) return Promise.resolve();
        // Cancel the original job and native graph before any next screen/project publication.
        cancelJobs();
        let operation: Promise<void>;
        try { operation = owner.recorder?.abort() ?? Promise.resolve(); }
        catch (error) { operation = Promise.reject(error); }
        if (!clearView && owner.recorder) recordingView = { projectId: owner.projectId, snapshot: owner.recorder.getSnapshot() };
        const drain = retainDrain(operation); emit(); return drain;
    }
    async function readRecordingDrafts(id: string, job: JobContext): Promise<void> {
        const drafts = await session.listSourceDrafts(id, job); job.assertActive(); assertUnlocked();
        recordingDraftBytes.set(id, drafts.length ? drafts.reduce((bytes, draft) => bytes + draft.bodyBytes, 0) : null);
    }
    async function adoptRecordedProject(id: string, job: JobContext, expectedSource?: NonNullable<RecordingSnapshot['source']>): Promise<MeetingProject> {
        const project = await session.store.readProject(id, job); job.assertActive(); assertUnlocked();
        if (!project) throw new ProviderError('storage');
        const retained = await session.getAudioAvailability(id, job); job.assertActive(); assertUnlocked();
        await readRecordingDrafts(id, job); job.assertActive();
        if (expectedSource) {
            const matches = project.sourceAssets.filter(asset => asset.id === expectedSource.id);
            if (matches.length !== 1 || Object.keys(expectedSource).some(key => matches[0][key as keyof typeof expectedSource] !== expectedSource[key as keyof typeof expectedSource]) || !retained.sourceIds.includes(expectedSource.id)) throw new ProviderError('storage');
        }
        availability.set(id, retained); showProject(project); update({ storageInventory: null });
        return project;
    }
    function abortCapture(clearView: boolean): Promise<void> {
        const id = recordingOwner?.projectId;
        const drain = cutRecording(clearView);
        // The original capture job is cancelled above; bind its handoff before any await.
        const generation = recordingGeneration, job = createJobContext();
        const assertHandoff = () => {
            job.assertActive();
            if (disposed || generation !== recordingGeneration || state.session !== 'unlocked' || session.state !== 'unlocked') throw new DOMException('Capture handoff no longer current', 'AbortError');
        };
        const operation = (async () => {
            try {
                await drain; assertHandoff();
                if (id) await adoptRecordedProject(id, { ...job, assertActive: assertHandoff });
            } catch (error) {
                assertHandoff();
                saveBlocked = true; update({ error: safeFailure(new ProviderError('storage'), state.preferences.uiLanguage) });
                throw error;
            }
        })();
        // Keep admissions fenced through the fresh durable handoff, not merely the graph drain.
        return retainDrain(operation);
    }
    async function startCapture(id: string): Promise<void> {
        assertUnlocked();
        if (recordingOwner || recordingDrains.size || state.busy || cancelling || saveBlocked || pending.has(id)) throw new ProviderError('busy');
        if (state.screen !== 'import' || id !== state.selectedProjectId || !emptyForRecording(getProject(id)) || !recordingSupported()) throw new ProviderError('invalid-input');
        const owner: CaptureOwner = { projectId: id, generation: ++recordingGeneration, job: createJobContext(), recorder: null, pending: 'start' };
        recordingOwner = owner; recordingView = { projectId: id, snapshot: idleRecording }; clearPlayback(); emit();
        try {
            const project = await session.store.readProject(id, owner.job); assertCapture(owner);
            if (!project || !emptyForRecording(project)) { if (project) showProject(project); throw new ProviderError('invalid-input'); }
            await readRecordingDrafts(id, owner.job); assertCapture(owner);
            if (recordingDraftBytes.get(id) !== null) throw new ProviderError('invalid-input');
            const ownerSourceId = crypto.randomUUID();
            const recorder = (options.recorderFactory ?? createMicrophoneRecorder)({ sourceId: ownerSourceId, fileName: `Recording-${new Date().toISOString().replace(/[:.]/g, '-')}.wav`, job: owner.job,
                createWriter: async (config, job) => {
                    assertCapture(owner); if (job !== owner.job) throw new ProviderError('invalid-input');
                    const writer = await session.createSourceWriter(id, ownerSourceId, config, job);
                    try { assertCapture(owner); return writer; } catch (error) { await writer.abort(); throw error; }
                },
                onState: snapshot => {
                    try { assertCapture(owner); } catch { return; }
                    // Finalized core state stays private until the durable project/availability handoff.
                    if (snapshot.state !== 'saved') { recordingView = { projectId: id, snapshot }; emit(); }
                },
            });
            owner.recorder = recorder;
            await recorder.start(); assertCapture(owner);
        } catch (error) {
            if (recordingOwner === owner) {
                if (!owner.recorder) { recordingOwner = null; recordingView = null; }
                else recordingView = { projectId: id, snapshot: owner.recorder.getSnapshot() };
                throw error;
            }
            throw new DOMException('Capture no longer active', 'AbortError');
        } finally { if (recordingOwner === owner) owner.pending = null; emit(); }
    }
    async function recordingAction(id: string, action: 'pause' | 'resume' | 'stop'): Promise<void> {
        assertUnlocked(); const owner = recordingOwner;
        if (!owner || owner.projectId !== id || !owner.recorder) throw new ProviderError('invalid-input');
        assertCapture(owner);
        if (owner.pending && !(action === 'stop' && (owner.pending === 'pause' || owner.pending === 'resume'))) throw new ProviderError('busy');
        owner.pending = action; emit();
        try {
            if (action === 'stop') {
                const source = await owner.recorder.stop(); assertCapture(owner);
                await adoptRecordedProject(id, owner.job, source); assertCapture(owner);
                recordingView = { projectId: id, snapshot: owner.recorder.getSnapshot() };
                recordingOwner = null; recordingGeneration++; emit();
            } else { await owner.recorder[action](); assertCapture(owner); }
        } catch (error) {
            if (recordingOwner !== owner || owner.job.signal.aborted) throw new DOMException('Capture action no longer active', 'AbortError');
            if (owner.recorder.getSnapshot().state === 'saved') { saveBlocked = true; await cutRecording(false); }
            throw error;
        } finally { if (recordingOwner === owner && owner.pending === action) owner.pending = null; emit(); }
    }
    const core: MeetingController = {
        startRecording: startCapture,
        pauseRecording: id => recordingAction(id, 'pause'), resumeRecording: id => recordingAction(id, 'resume'), stopRecording: id => recordingAction(id, 'stop'),
        abortRecording: id => { assertUnlocked(); if (!recordingOwner || recordingOwner.projectId !== id) return Promise.reject(new ProviderError('invalid-input')); return abortCapture(false); },
        refreshStorage: () => execute(async job => { update({ audioDeletionPlan: null, storageError: null, storageNotice: null }); await readInventory(job); }),
        planAudioDeletion: (scope, id) => execute(async job => {
            if (!['source', 'chunks'].includes(scope)) throw new ProviderError('invalid-input'); getProject(id);
            update({ audioDeletionPlan: null, storageError: null, storageNotice: null });
            const plan = await session.planDeletion(scope, id, job); job.assertActive(); update({ audioDeletionPlan: plan }); return plan;
        }),
        cancelAudioDeletion() { if (!state.storageWorking) update({ audioDeletionPlan: null }); },
        deletePlannedAudio,
        discoverModels: (provider, stage) => execute(job => discover(provider, stage, job)),
        prepareModelSelection: provider => execute(async job => {
            if (!registry) throw new ProviderError('permission');
            // Existing decisions, including explicitly disabled entries, are authoritative.
            // OpenAI authenticated discovery remains a separate user action.
            if (provider !== 'openrouter' || registry.entries.some(entry => entry.route.provider === provider && entry.route.stage === 'minutes')) return;
            metadataRevision++; comparisonRevision++; comparisonCandidate = null;
            discovered = discovered.filter(item => item.route.provider !== provider || item.route.stage !== 'minutes');
            routerModels = []; endpointCatalog.clear();
            update({ minutesConsentToken: null, minutesSelection: null, comparisonConsentToken: null, minutesComparison: null });
            publishRegistry(null, null);
            try {
                const models = await discovery.loadOpenRouterMinutes(job), endpoints = new Map<string, readonly RouterEndpoint[]>();
                const observations = models.map(model => observeMinutesRoute(route(provider, 'minutes', model.id), model, null));
                for (const candidate of FIRST_USE_MINUTES_ROUTES) {
                    const model = models.find(model => model.id === candidate.id);
                    if (!model) continue;
                    const found = await discovery.loadOpenRouterEndpoints(model.id, job); job.assertActive(); endpoints.set(model.id, found);
                    // Keep other exact alternatives visible, but only the named tag may be recommended.
                    observations.push(...found.map(endpoint => observeMinutesRoute(route(provider, 'minutes', model.id, endpoint.tag), model, endpoint)));
                }
                job.assertActive(); routerModels = models; for (const [id, found] of endpoints) endpointCatalog.set(id, found);
                discovered = [...discovered, ...observations]; metadataRevision++;
                const count = observations.filter(item => item.metadata.compatible && FIRST_USE_MINUTES_ROUTES.some(candidate => candidate.id === item.route.modelId && candidate.tag === item.route.endpointTag)).length;
                publishRegistry(state.preferences.uiLanguage === 'en' ? count ? 'Public metadata checked. Recommended exact routes are draft choices; Apply saves them. Inference and final cost are unverified.' : 'No recommended exact route is available. Retry public discovery or load another model’s endpoints.' : count ? '공개 메타데이터를 확인했어요. 추천 경로는 초안이며 적용해야 저장돼요. 실제 추론과 최종 비용은 미확인이에요.' : '추천할 정확한 경로가 없어요. 공개 목록을 다시 조회하거나 다른 모델의 엔드포인트를 불러오세요.', null);
            } catch {
                job.assertActive();
                publishRegistry(null, state.preferences.uiLanguage === 'en' ? 'Public model metadata could not be loaded. Retry discovery or reopen Select models. No draft route was selected.' : '공개 모델 정보를 불러오지 못했어요. 목록을 다시 조회하거나 모델 선택을 다시 여세요. 초안 경로를 선택하지 않았어요.');
                throw new ProviderError('catalog');
            }
        }),
        loadModelEndpoints: route => execute(async job => {
            if (route.provider !== 'openrouter' || route.stage !== 'minutes') throw new ProviderError('invalid-input');
            const model = routerModels.find(model => model.id === route.modelId);
            if (!model) throw new ProviderError('invalid-input');
            metadataRevision++; publishRegistry(null, null);
            try {
                const endpoints = await discovery.loadOpenRouterEndpoints(model.id, job); job.assertActive();
                const observations = endpoints.map(endpoint => observeMinutesRoute({ ...route, endpointTag: endpoint.tag }, model, endpoint));
                // Refresh only this model's saved exact endpoints. Other routes retain
                // their status, and accepted metadata never changes during discovery.
                if (registry && registry.entries.some(entry => entry.route.provider === route.provider && entry.route.stage === route.stage && entry.route.modelId === model.id && entry.route.endpointTag)) {
                    const at = new Date().toISOString();
                    const next = normalizeModelRegistry({ ...registry, entries: registry.entries.map(entry => {
                        if (entry.route.provider !== route.provider || entry.route.stage !== route.stage || entry.route.modelId !== model.id || !entry.route.endpointTag) return entry;
                        const observation = observations.find(item => registryRouteKey(item.route) === registryRouteKey(entry.route));
                        return { ...entry, ...(observation ? { observedMetadata: observation.metadata } : {}), refresh: { status: observation ? 'current' as const : 'unavailable' as const, attemptedAt: at, error: null } };
                    }) });
                    await saveRegistry(next, job);
                }
                // Endpoint-only discovery is never an authoritative full-stage merge.
                discovered = [...discovered.filter(item => item.route.provider !== route.provider || item.route.stage !== route.stage || item.route.modelId !== model.id || !item.route.endpointTag), ...observations];
                endpointCatalog.set(model.id, endpoints); metadataRevision++;
                const eligibleCount = observations.filter(item => item.metadata.compatible).length;
                publishRegistry(eligibleCount ? (state.preferences.uiLanguage === 'en' ? 'Endpoints loaded. Review the refreshed list, then explicitly check an exact route.' : '엔드포인트를 불러왔어요. 최신 목록을 확인한 뒤 정확한 경로를 직접 선택하세요.') : state.preferences.uiLanguage === 'en' ? 'No supported endpoint is available with these limits and capabilities. Retry loading endpoints or choose another model.' : '현재 한도와 기능으로 지원되는 엔드포인트가 없어요. 다시 불러오거나 다른 모델을 선택하세요.', null);
                await refreshConsent(job);
            } catch (error) {
                job.assertActive();
                const failure = error instanceof ProviderError && error.code === 'storage' ? error : new ProviderError('catalog');
                publishRegistry(null, safeFailure(failure, state.preferences.uiLanguage)); throw failure;
            }
        }),
        applyModelSelection: submission => execute(async job => {
            job.assertActive();
            if (!registry || !submission || !Number.isSafeInteger(submission.baseRevision) || submission.baseRevision !== metadataRevision ||
                !Array.isArray(submission.changes) || submission.defaultChanges !== undefined && !Array.isArray(submission.defaultChanges)) throw new ProviderError('invalid-input');
            const rows = modelManagementRows(registry, discovered), byKey = new Map(rows.map(row => [row.key, row]));
            const seen = new Set<string>(); let next = registry;
            for (const change of submission.changes) {
                if (!change || typeof change.key !== 'string' || typeof change.enabled !== 'boolean' || seen.has(change.key)) throw new ProviderError('invalid-input');
                seen.add(change.key); const row = byKey.get(change.key);
                if (!row) throw new ProviderError('invalid-input');
                const observation = discovered.find(item => registryRouteKey(item.route) === change.key);
                if (observation) next = addRegistryObservation(next, observation);
                const enabled = setRegistryEnabled(next, change.key, change.enabled);
                if (change.enabled && !projectModelRegistry(enabled, row.route.stage).choices.some(choice => choice.key === change.key)) throw new ProviderError('invalid-input');
                next = enabled;
            }
            const stages = new Set<string>();
            for (const change of submission.defaultChanges ?? []) {
                if (!change || !['stt', 'minutes'].includes(change.stage) || typeof change.key !== 'string' || stages.has(change.stage) || !byKey.has(change.key)) throw new ProviderError('invalid-input');
                stages.add(change.stage);
                try { next = setRegistryDefault(next, change.stage, change.key); } catch { throw new ProviderError('invalid-input'); }
            }
            job.assertActive();
            if (submission.baseRevision !== metadataRevision) throw new ProviderError('invalid-input');
            await saveRegistry(normalizeModelRegistry(next), job);
        }),
        setModelEnabled: (key, enabled) => execute(async job => {
            const next = preferenceWith(key), entry = next.entries.find(entry => registryRouteKey(entry.route) === key);
            if (!entry) throw new ProviderError('invalid-input');
            if (enabled && !projectModelRegistry(setRegistryEnabled(next, key, true), entry.route.stage).choices.some(choice => choice.key === key)) throw new ProviderError('invalid-input');
            await saveRegistry(setRegistryEnabled(next, key, enabled), job);
        }),
        setModelAlias: (key, alias) => execute(job => saveRegistry(setRegistryAlias(preferenceWith(key), key, alias), job)),
        setModelDefault: (stage, key) => execute(job => saveRegistry(setRegistryDefault(preferenceWith(key), stage, key), job)),
        acceptModelMetadata: (key, reviewedRevision) => execute(job => {
            job.assertActive();
            if (!Number.isSafeInteger(reviewedRevision) || reviewedRevision !== metadataRevision) throw new ProviderError('invalid-input');
            return saveRegistry(acceptRegistryMetadata(preferenceWith(key), key), job);
        }),
        setRouterSTTPreference: (connectionId, preference) => execute(async job => {
            if (!registry || connectionId !== 'openrouter') throw new ProviderError('invalid-input');
            let normalized: RouterSTTPreference;
            try { normalized = normalizeRouterSTTPreference(preference); } catch { throw new ProviderError('invalid-input'); }
            if (normalized.initialDefaultApplied !== (registry.openRouterSTT?.[connectionId]?.initialDefaultApplied ?? false)) throw new ProviderError('invalid-input');
            await saveRegistry({ ...registry, openRouterSTT: { ...registry.openRouterSTT, [connectionId]: normalized } }, job);
        }),
        applyRouterSTTRecommendation: (connectionId, modelId) => execute(async job => {
            const preference = registry?.openRouterSTT?.[connectionId];
            if (!registry || connectionId !== 'openrouter' || preference?.acknowledgedDisclosureVersion !== 'or-stt-1' || preference.initialDefaultApplied || registry.defaults.stt !== null ||
                state.projects.some(project => project.sourceAssets.length || project.preparedChunks.length || project.runs.length || project.rawTranscripts.length || project.transcriptVersions.length)) throw new ProviderError('invalid-input');
            const recommendation = recommendRouterSTT(routerSTTModels).recommendedId;
            if (!recommendation || recommendation !== modelId) throw new ProviderError('invalid-input');
            const choice = sttChoice(modelId);
            if (!choice || choice.route.connectionId !== connectionId || choice.route.provider !== 'openrouter') throw new ProviderError('invalid-input');
            const next = setRegistryDefault(registry, 'stt', choice.key);
            await saveRegistry({ ...next, openRouterSTT: { ...next.openRouterSTT, [connectionId]: { ...preference, initialDefaultApplied: true } } }, job);
        }),
        setMinutesRoute: (id, key) => execute(async job => {
            const registered=registeredModel(key,'llm');
            if(registered){
                const p=getProject(id);
                await saveProject({...p,minutesSettings:{...p.minutesSettings,modelId:registered.modelId,registrationId:registered.id},minutesEndpointTag:registrationEndpoint(registered)} as ControllerProject,job);
                comparisonRevision++;comparisonCandidate=null;await refreshConsent(job);return;
            }
            const choice = registry && projectModelRegistry(registry, 'minutes').choices.find(choice => choice.key === key);
            if (!choice) throw new ProviderError('invalid-input');
            const p = getProject(id);
            await saveProject({ ...p, minutesSettings: { ...p.minutesSettings, modelId: choice.route.modelId }, minutesEndpointTag: choice.route.endpointTag } as ControllerProject, job);
            comparisonRevision++; comparisonCandidate = null;
            await refreshConsent(job);
        }),
        getSnapshot() {
            const selected = state.projects.find((p) => p.id === state.selectedProjectId);
            const states = selected?.preparedChunks.map((chunk) => { const runs = selected.runs.filter((run) => run.intent?.kind === "stt" && run.intent.chunkId === chunk.id || selected.rawTranscripts.some(raw => raw.chunkId === chunk.id && raw.runId === run.id)); const run = runs[runs.length - 1]; return { chunkId: chunk.id, state: run?.state ?? "queued" as const }; }) ?? [];
            const history: UIHistoryItem[] = state.projects.flatMap(project => projectHistory(project));
            const captureActive = !!recordingOwner || recordingDrains.size > 0;
            const interrupted = selected ? recordingDraftBytes.get(selected.id) ?? null : null;
            const startBlockedReason = !selected || state.busy || cancelling || saveBlocked || recordingDrains.size || pending.has(selected.id) ? 'busy' as const : !emptyForRecording(selected) ? 'project-not-empty' as const : interrupted !== null ? 'interrupted-draft' as const : null;
            const recording = state.session === 'unlocked' && state.screen === 'import' && selected ? {
                projectId: selected.id, language: state.preferences.uiLanguage, supported: recordingSupported(),
                snapshot: recordingView?.projectId === selected.id ? recordingView.snapshot : idleRecording,
                pendingAction: recordingOwner?.projectId === selected.id ? recordingOwner.pending : recordingDrains.size ? 'abort' as const : null,
                startBlockedReason, interruptedCommittedBytes: interrupted,
                onStart: () => launch(() => core.startRecording(selected.id)), onPause: () => launch(() => core.pauseRecording(selected.id)), onResume: () => launch(() => core.resumeRecording(selected.id)), onStop: () => launch(() => core.stopRecording(selected.id)), onAbort: () => launch(() => core.abortRecording(selected.id)),
            } : null;
            return Object.freeze({ ...state, uiDrafts, workReturnScreen, recording, recordingActive: captureActive, busy: !!state.busy || saveBlocked || cancelling || captureActive, projects: state.projects.map(project => ({ ...project, retainedAudio: availability.get(project.id) })), ...handlers, chunkStates: states, history,
                sttConsentToken: selected ? sttConsentBase(selected) : String(metadataRevision),
                routerSTTSelection: selected && state.session === "unlocked" ? sttDisclosure(selected) : null,
                routerSTTRecommendation: state.session === "unlocked" ? recommendRouterSTT(routerSTTModels) : null,
                sttUnavailableReason: sttUnavailableReason(),
                sttPolicyBlockedModels: state.modelRegistrations?.entries.filter(model => model.stage === 'stt' && sttPolicyBlocked(model)).map(model => model.id) ?? [],
                minutesUnavailableReason: state.modelRegistrations?.version === 2 ? state.minutesUnavailableReason : state.minutesUnavailableReason ?? (!state.minutesEndpointTag ? (state.preferences.uiLanguage === "en" ? "Choose an exact provider endpoint." : "정확한 제공사 엔드포인트를 선택하세요.") : state.connections.find((connection) => connection.provider === "openrouter")?.status === "none" ? (state.preferences.uiLanguage === "en" ? "Enter your OpenRouter key in Settings." : "설정에서 OpenRouter 키를 입력하세요.") : undefined),
                comparisonUnavailableReason: state.modelRegistrations?.version === 2 ? state.minutesUnavailableReason ?? (registeredModel(state.comparisonBEndpointTag,'llm') ? registrationProblem(registeredModel(state.comparisonBEndpointTag,'llm')!) : undefined) : state.connections.find(connection => connection.provider === "openrouter")?.status === "none" ? (state.preferences.uiLanguage === "en" ? "Enter your OpenRouter key in Settings." : "설정에서 OpenRouter 키를 입력하세요.") : undefined,
            });
        },
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        async initialize() {
            if (initialized)
                return;
            initialized = true;
            const revision = resetRevision;
            try {
                if (!factory)
                    throw new ProviderError("storage");
                const db = await openVaultDatabase(factory, databaseName);
                const header = await readHeader(db);
                db.close();
                if (!disposed && revision === resetRevision && !resetOperation)
                    update({ session: header ? "locked" : "new" });
            }
            catch {
                update({ error: safeFailure(new ProviderError("storage"), state.preferences.uiLanguage) });
            }
        },
        async dispose() { idle.stop(); clearTimeout(duplicateNoticeTimer); disposed = true; const drain = cutRecording(true); storageRevision++; availability.clear(); listeners.clear(); clearPlayback(); await session.dispose(); await drain; releaseResources(); },
        checkScreenExpiry() {
            idle.check();
            const context = activePreparation;
            if (!context || context.job.signal.aborted || !context.snapshot) return;
            const now = Date.now();
            if (context.backgroundStartedAtMs !== null) { context.backgroundDurationMs += Math.max(0, now - context.backgroundStartedAtMs); context.backgroundStartedAtMs = null; }
            context.snapshot = { ...context.snapshot, lastForegroundAtMs: now, backgroundDurationMs: context.backgroundDurationMs };
            update({ preparation: context.snapshot });
        },
        async noteBackground() {
            const context = activePreparation;
            if (context && !context.job.signal.aborted && context.snapshot && context.backgroundStartedAtMs === null) {
                context.backgroundStartedAtMs = Date.now(); context.backgroundCount++;
                context.snapshot = { ...context.snapshot, backgroundCount: context.backgroundCount };
                update({ preparation: context.snapshot });
            }
            if (state.preferences.lockWorkPolicy === 'strict') await core.screenLock();
            else idle.check();
        },
        noteActivity() {
            if (!disposed && session.state === 'unlocked' && state.screenAccess !== 'locked' && state.screenAccess !== 'verifying') idle.activity();
        },
        createVault: (secret) => activate(secret, true), unlock: (secret) => activate(secret, false), lock: async () => { idle.stop(); retainScreenState(); const drain = cutRecording(true); await session.lock("manual"); await drain; },
        async screenLock() {
            if (session.state !== 'unlocked') return;
            if (state.screenAccess === 'locked') { queueScreenFinalization(); return; }
            screenRevision++; idle.stop(); clearPlayback(); releaseSourcePreview();
            for (const url of previews.values()) urls.revoke(url);
            previews.clear();
            flushSync(() => update({ screenAccess: 'locked', screenUnlockError: false, sourcePreviewUrl: null }));
            retainScreenState();
            if (state.preferences.lockWorkPolicy === 'strict' || !runtimeWork()) {
                if (!finishingScreenLock) finishingScreenLock = core.lock().finally(() => { finishingScreenLock = null; });
                await finishingScreenLock;
            }
        },
        async unlockScreen(secret) {
            if (session.state === 'locked') { try { await activate(secret, false); } catch (error) { update({ screenAccess: 'locked', screenUnlockError: true }); throw error; } return; }
            if (session.state !== 'unlocked' || state.screenAccess !== 'locked') throw new ProviderError('permission');
            const revision = ++screenRevision;
            update({ screenAccess: 'verifying', screenUnlockError: false });
            try {
                await session.verifyScreenPassphrase(secret); secret = '';
                if (disposed || revision !== screenRevision || session.state !== 'unlocked') throw new ProviderError('permission');
                const file = state.selectedProjectId ? files.get(state.selectedProjectId) : undefined;
                let preview: string | null = null;
                try { if (file && state.selectedProjectId) { preview = urls.create(file); previews.set(state.selectedProjectId, preview); } } catch { /* Preview remains optional; retained audio is unchanged. */ }
                update({ screenAccess: 'open', screenUnlockError: false, sourcePreviewUrl: preview });
                idle.start(state.preferences.autoLockSeconds === undefined ? 60 : state.preferences.autoLockSeconds);
            } catch {
                secret = '';
                if (revision === screenRevision && session.state === 'unlocked') update({ screenAccess: 'locked', screenUnlockError: true });
                queueScreenFinalization(); throw new ProviderError('permission');
            }
        },
        async saveSelectionLists(value) {
            assertUnlocked();
            if (state.busy || cancelling || recordingOwner || recordingDrains.size) throw new ProviderError('busy');
            const lists = normalizeSelectionLists(value), job = createJobContext();
            update({ busy: true, error: null, notice: null });
            // Invoke synchronously so an immediate lock can finalize the accepted edit.
            const operation = session.saveSelectionLists(lists, job); activeOperation = operation;
            try {
                await operation; job.assertActive(); assertUnlocked(); update({ selectionLists: lists });
            } catch (error) {
                if (state.session === 'unlocked' && !job.signal.aborted) update({ error: state.preferences.uiLanguage === 'en' ? 'The lists could not be saved. Previous settings remain applied. Check storage and retry.' : '목록을 저장하지 못했어요. 이전 설정은 유지돼요. 저장 공간을 확인하고 다시 저장하세요.' });
                throw error;
            } finally {
                if (activeOperation === operation) { activeOperation = null; if (state.session === 'unlocked') update({ busy: saveBlocked || cancelling }); }
            }
        },
        resetVault() {
            if (resetOperation) return resetOperation;
            if (disposed || state.resettingVault || !['locked', 'unlocked', 'save-failed'].includes(state.session))
                return Promise.reject(new ProviderError('busy'));
            const language = state.preferences.uiLanguage;
            resetRevision++;
            void cutRecording(true).catch(() => {});
            update({ resettingVault: true, resetVaultError: null, busy: true, error: null, notice: null });
            // Session reset owns fencing, cleanup, native ownership and the definitive atomic outcome.
            // A locked non-owner must not cancel another owner's work here.
            const operation = session.reset().then(() => {
                pending.clear(); activeOperation = null; saveBlocked = false; cancelling = false;
                metadataRevision++; comparisonRevision++; minutesLanguageRevision++;
                state = Object.freeze({ ...initialSnapshot(), session: 'new', modelRegistry: null, modelManagement: null, modelCatalog: null,
                    minutesRoutes: [], minutesRouteKey: null, comparisonBRouteKey: null, resettingVault: false, resetVaultError: null });
                emit();
            }, () => {
                const message = language === 'en'
                    ? 'The vault could not be reset. Close other MoM tabs, check browser storage, and retry reset explicitly. Deletion is not confirmed.'
                    : '보관함을 초기화하지 못했어요. 다른 MoM 탭을 닫고 브라우저 저장소를 확인한 뒤 초기화를 명시적으로 다시 시도하세요. 삭제 완료는 확인되지 않았어요.';
                update({ session: stateMap(session.state), resettingVault: false, resetVaultError: message, busy: false });
                throw new Error(message);
            }).finally(() => { if (resetOperation === operation) resetOperation = null; });
            resetOperation = operation;
            return operation;
        },
        async createMeeting() {
            return execute(async (job) => {
                clearPlayback();
                const id = crypto.randomUUID();
                const defaultRoute = registry ? projectModelRegistry(registry, 'minutes').choices.find(choice => choice.key === registry!.defaults.minutes)?.route : null;
                // A disabled saved STT default stays visible and blocked rather than silently falling back.
                const sttDefaultKey = registry?.defaults.stt;
                const sttDefault = registry?.entries.find(entry => registryRouteKey(entry.route) === sttDefaultKey)?.route;
                const registeredSTT=registeredModel(state.modelRegistrations?.defaults?.stt,'stt');
                const registeredLLM=registeredModel(state.modelRegistrations?.defaults?.llm,'llm');
                const date = new Date().toISOString();
                const p: ControllerProject = { id, title: state.preferences.uiLanguage === "en" ? "New voice memo" : "새 음성 메모", icon: "mic", color: "#2B59C3", pinned: false, createdAt: date, updatedAt: date,
                    sourceAssets: [], audioOptions: structuredClone(state.defaultAudioOptions), preparedChunks: [], rawTranscripts: [], transcriptVersions: [], selectedTranscriptVersionId: null,
                    minutesSettings: { outputLanguageMode: "app", outputLanguage: state.preferences.uiLanguage, sections: ["summary", "topics", "decisions", "actions", "open"], instructions: "", modelId: registeredLLM?.modelId ?? defaultRoute?.modelId ?? "", ...(registeredLLM?{registrationId:registeredLLM.id}:{}) }, minutesRuns: [], minutesRevisions: [], selectedMinutesRevisionId: null, runs: [], minutesEndpointTag: registeredLLM?registrationEndpoint(registeredLLM):defaultRoute?.endpointTag ?? null, ...(registeredSTT?{sttRegistrationId:registeredSTT.id}:{}) };
                await saveProject(p, job);
                comparisonCandidate = null;
                update({ ...emptyComparison, selectedProjectId: id, screen: "import", preparation: null, sourcePreviewUrl: null, sttModelId: registeredSTT?.id ?? sttDefault?.modelId ?? '', minutesEndpointTag: registeredLLM?registrationEndpoint(registeredLLM):defaultRoute?.endpointTag ?? null, minutesConsentToken: null, minutesSelection: null, minutesEndpoints: [] });
                publishRegistry();
                return id;
            });
        },
        async updateMeeting(id, patch) {
            await execute(async (job) => {
                if (patch.title !== undefined && !patch.title.trim())
                    throw new ProviderError("invalid-input");
                await saveProject({ ...getProject(id), ...patch }, job);
            });
        },
        async importFile(id, file) {
            await execute(async (job) => {
                const p = getProject(id);
                const preparation = beginPreparation(p, job);
                try {
                const original = p.sourceAssets[0];
                if (original) {
                    if (!retainedSource(p)) throw new ControllerError('source-deleted');
                    if (!Number.isSafeInteger(original.bytes) || original.bytes <= 0 || file.size !== original.bytes)
                        throw new ControllerError("source-mismatch");
                    reportPreparation(preparation, 'reading');
                    let offset = 0;
                    for await (const bytes of session.streamSource(original.id, job)) {
                        job.assertActive();
                        if (bytes.byteLength <= 0 || bytes.byteLength > 1024 * 1024 || bytes.byteLength > file.size - offset)
                            throw new ControllerError("source-mismatch");
                        const candidate = new Uint8Array(await file.slice(offset, offset + bytes.byteLength).arrayBuffer());
                        try {
                            job.assertActive();
                            if (candidate.byteLength !== bytes.byteLength || candidate.some((byte, index) => byte !== bytes[index]))
                                throw new ControllerError("source-mismatch");
                            offset += bytes.byteLength;
                            reportPreparation(preparation, 'reading');
                        }
                        finally {
                            candidate.fill(0);
                        }
                    }
                    job.assertActive();
                    if (offset !== file.size)
                        throw new ControllerError("source-mismatch");
                    // Exact byte identity retains all existing immutable source,
                    // prepared-chunk, raw and edited-version IDs. No replacement.
                    files.set(id, file);
                    const old = previews.get(id);
                    if (old)
                        urls.revoke(old);
                    try {
                        previews.set(id, urls.create(file));
                    }
                    catch {
                        previews.delete(id);
                    }
                    update({ preparation: null, sourcePreviewUrl: previews.get(id) ?? null, notice: state.preferences.uiLanguage === "en" ? "Original file verified. Existing chunks and transcripts were retained." : "원본 파일 일치를 확인했어요. 기존 청크와 전사문을 유지했어요." });
                    return;
                }
                if (p.rawTranscripts.length || p.minutesRuns.length)
                    throw new ControllerError("source-mismatch");
                reportPreparation(preparation, 'inspecting');
                const source = await inspectAudio(file, job, progress => reportMediaPreparation(preparation, progress));
                assertPreparation(preparation);
                reportPreparation(preparation, 'saving', { durationMs: source.durationMs });
                await saveProject({ ...p, sourceAssets: [source], preparedChunks: [] }, job, [{ recordId: source.id, audio: file }]);
                job.assertActive();
                preparation.sourceId = source.id;
                reportPreparation(preparation, 'saving');
                files.set(id, file);
                const old = previews.get(id);
                if (old)
                    urls.revoke(old);
                try {
                    previews.set(id, urls.create(file));
                }
                catch { /* Preview support is optional; preparation remains real. */ }
                update({ preparation: null, sourcePreviewUrl: previews.get(id) ?? null });
                } finally { if (activePreparation === preparation) activePreparation = null; }
            });
        },
        async saveKey(provider, key, mode) {
            await execute(async job => {
                const revision = ++keyAttemptRevision;
                const message = (ko: string, en: string) => state.preferences.uiLanguage === 'ko' ? ko : en;
                const attempt = (status: 'saving' | 'saved' | 'failed', text: string) => update({ keySaveAttempts: { ...state.keySaveAttempts, [provider]: { status, revision, message: text } } });
                metadataRevision++; comparisonRevision++;
                update({ minutesConsentToken: null, comparisonConsentToken: null }); publishRegistry();
                attempt('saving', message('키를 저장하고 있어요…', 'Saving key…'));
                try {
                    await session.saveProviderKey(provider, key, mode); key = ''; job.assertActive();
                    update({ connections: state.connections.map(item => item.provider === provider ? { provider, status: 'saved' } : item) });
                    attempt('saved', message('키를 저장했어요. 모델은 따로 선택하세요.', 'Key saved. Select models separately.'));
                    metadataRevision++; publishRegistry(); await refreshConsent(job);
                } catch (error) {
                    key = ''; job.assertActive();
                    attempt('failed', message('이번 키를 저장하지 못했어요. 저장 공간과 보관함 상태를 확인하세요.', 'This key could not be saved. Check browser storage and vault status.'));
                    throw error;
                }
            });
        },
        refreshModels: () => execute(job => discover('openrouter', 'minutes', job)),
        setComparisonView: (id, open) => execute(async job => {
            comparisonRevision++;
            getProject(id); comparisonCandidate = null;
            update({ comparisonOpen: open, comparisonConsentToken: null, selectedComparisonId: null, comparisonRetryMember: null });
            await refreshConsent(job);
        }),
        setComparisonB: (id, modelId, endpointTag) => execute(async job => {
            comparisonRevision++;
            getProject(id);
            const registered=registeredModel(endpointTag??modelId,'llm');
            if(registered){comparisonCandidate=null;update({comparisonBModelId:registered.modelId,comparisonBEndpointTag:registered.id,comparisonConsentToken:null,selectedComparisonId:null,comparisonRetryMember:null});await refreshConsent(job);return;}
            if (!routerModels.some(model => model.id === modelId)) throw new ProviderError("invalid-input");
            comparisonCandidate = null;
            update({ comparisonBModelId: modelId, comparisonBEndpointTag: endpointTag, comparisonConsentToken: null, selectedComparisonId: null, comparisonRetryMember: null });
            await loadEndpoints(modelId, job);
            if (endpointTag && !endpointCatalog.get(modelId)?.some(endpoint => endpoint.tag === endpointTag)) throw new ProviderError("invalid-input");
            await refreshConsent(job);
        }),
        selectComparison: (id, comparisonId, retryMember = null) => execute(async job => {
            comparisonRevision++;
            const p = getProject(id);
            const record = p.minutesComparisons?.find(record => record.id === comparisonId);
            if (comparisonId && !record) throw new ProviderError("invalid-input");
            if (retryMember !== null && (!record || ![0, 1].includes(retryMember) || comparisonMemberState(p, record, retryMember) === "saved")) throw new ProviderError("invalid-input");
            comparisonCandidate = null;
            update({ comparisonOpen: true, selectedComparisonId: comparisonId, comparisonRetryMember: retryMember, comparisonConsentToken: null });
            if (record) for (const member of record.members) await loadEndpoints(member.modelId, job);
            await refreshConsent(job);
        }),
        async setMinutesSettings(id, settings) {
            await execute(async (job) => {
                comparisonRevision++;
                const p = getProject(id);
                if (settings.registrationId ? registeredModel(settings.registrationId,'llm')?.modelId!==settings.modelId : settings.modelId && !routerModels.some((model) => model.id === settings.modelId))
                    throw new ProviderError("invalid-input");
                validateMinutesBudget(settings);
                const next: ControllerProject = { ...p, minutesSettings: structuredClone(settings), minutesEndpointTag: p.minutesSettings.modelId === settings.modelId ? p.minutesEndpointTag ?? null : null };
                await saveProject(next, job);
                update({ minutesConsentToken: null, minutesSelection: null });
                await loadEndpoints(settings.modelId, job);
                await refreshConsent(job);
            });
        },
        setMinutesInstructions: stageMinutesInstructions,
        async selectMinutesEndpoint(id, tag) {
            await execute(async (job) => {
                comparisonRevision++;
                const p = getProject(id);
                const endpoint = endpointCatalog.get(p.minutesSettings.modelId)?.find((item) => item.tag === tag);
                if (!endpoint)
                    throw new ProviderError("invalid-input");
                const next: ControllerProject = { ...p, minutesEndpointTag: tag };
                await saveProject(next, job);
                await refreshConsent(job);
            });
        },
        async planPreparationReset(id,audioOptions) {
            await execute(async job=>{
                validateOptions(audioOptions);
                getProject(id);
                clearPlayback();
                update({preparationResetPlan:null});
                for(const write of [...pending.values()]) await saveProject(write.project,job,write.audioRecords,write.runId);
                const plan=await session.planPreparationReset(id,audioOptions,job); job.assertActive();
                update({preparationResetPlan:plan});
            });
        },
        async resetPreparation(token) {
            const plan=state.preparationResetPlan;
            if(!plan || plan.versionToken!==token || plan.projectId!==state.selectedProjectId) throw new ProviderError('invalid-input');
            preparationContinuations++;
            try {
            await execute(async job=>{
                clearPlayback();
                update({preparationResetPlan:null});
                const reset=await session.resetPreparation(plan,token,job);job.assertActive();
                pending.delete(reset.id);
                availability.set(reset.id,reset.retainedAudio!);
                showProject(reset);
                comparisonCandidate=null;comparisonRevision++;metadataRevision++;
                update({...emptyComparison,screen:'import',preparation:null,minutesConsentToken:null,minutesSelection:null,routerSTTSelection:null,storageInventory:null,preparationEditor:{projectId:reset.id,requestId:++preparationEditorRevision}});
                await refreshConsent(job);
            });
            await core.prepareAudio(plan.projectId);
            if(state.session==='unlocked')update({notice:state.preferences.uiLanguage==='en'?'Previous processing records were retained and fresh chunks are ready. Start transcription when ready.':'이전 처리 기록을 보존하고 새 청크를 준비했어요. 전사는 직접 실행하세요.'});
            } finally { preparationContinuations--; emit(); }
        },
        async prepareAudio(id) {
            await execute(async job => {
                let p = getProject(id);
                const source = p.sourceAssets[0];
                if (!source) throw new ProviderError("invalid-input");
                const preparation = beginPreparation(p, job);
                try {
                if (preparedAudioReady(p)) {
                    reportPreparation(preparation, 'complete', { sourceProcessedMs: source.durationMs });
                    return;
                }
                if (!retainedSource(p)) throw new ControllerError('source-deleted');
                let file: MediaInput | undefined = files.get(id);
                const prepare = createAudioPreparer({ sourceId: source.id, maxEncodedBytes: registeredModel(state.sttModelId,'stt')?.stt?.maxBytes??24_900_000, safetyMarginBytes: Math.min(100000,Math.floor((registeredModel(state.sttModelId,'stt')?.stt?.maxBytes??24_900_000)/10)), workerFactory: options.mediaWorkerFactory,
                    onProgress: progress => reportMediaPreparation(preparation, progress),
                    sink: async (chunk, audio, context) => {
                        p = assertPreparation(preparation);
                        if (retainedChunks(p).some((saved) => saved.sourceId === chunk.sourceId && saved.sourceStartMs === chunk.sourceStartMs && saved.sourceEndMs === chunk.sourceEndMs))
                            return;
                        reportPreparation(preparation, 'saving');
                        p = await saveProject({ ...p, preparedChunks: [...p.preparedChunks, chunk] }, context, [{ recordId: chunk.audioRecordId, audio }]);
                        p = assertPreparation(preparation);
                        reportPreparation(preparation, 'preparing');
                    },
                });
                reportPreparation(preparation, file ? 'inspecting' : 'reading');
                try {
                    if (!file) {
                        if (!Number.isSafeInteger(source.bytes) || source.bytes <= 0)
                            throw new ControllerError("source-mismatch");
                        const reader = await session.openRetainedSource(source.id, job);
                        job.assertActive();
                        if (reader.size !== source.bytes) throw new ControllerError("source-mismatch");
                        file = namedSourceReader(reader, source.fileName);
                    }
                    const chunks = prepare(file, p.audioOptions, job)[Symbol.asyncIterator]();
                    file = undefined;
                    try { while (!(await chunks.next()).done) job.assertActive(); }
                    finally { await chunks.return?.(); }
                    if (!preparedAudioReady(p)) throw new ProviderError("invalid-input");
                    reportPreparation(preparation, 'complete');
                } catch (error) {
                    job.assertActive();
                    reportPreparation(preparation, 'failed', { errorCode: preparationFailureCode(error) });
                    throw error;
                } finally { file = undefined; }
                } finally { if (activePreparation === preparation) activePreparation = null; }
            });
        },
        async startSTT(id, consent, chunkIds, request) {
            await execute(async (job) => {
                let p = getProject(id);
                const purpose = request?.purpose ?? (chunkIds === undefined ? "initial" : "retry-failed");
                const batchId = request?.batchId ?? consent.batchId;
                if (request?.batchId && consent.batchId && request.batchId !== consent.batchId) throw new ProviderError("invalid-input");
                let batch = batchId ? p.sttBatches?.find(batch => batch.id === batchId) : undefined;
                if (batchId && (!batch || purpose !== "retry-failed")) throw new ProviderError("invalid-input");
                if (batch) { try { validateSTTBatch(p, batch); } catch { throw new ProviderError("invalid-input"); } }
                if (consent.acknowledged !== true || consent.modelId !== (batch?.modelSnapshot?.id ?? batch?.modelId ?? state.sttModelId)) throw new ProviderError("invalid-input");
                const registered=registeredModel(batch?.modelSnapshot?.id??consent.modelId,'stt');
                if (sttPolicyBlocked(registered, id)) throw new ProviderError('data-policy');
                if(registered&&(registrationProblem(registered)||batch?.modelSnapshot&&registrationSignature(registered)!==registrationSignature(batch.modelSnapshot)))throw new ProviderError('permission');
                if(batch?.modelSnapshot&&!registered)throw new ProviderError('permission');
                const choice = registered?null:sttChoice(consent.modelId,batch?.route.provider==='openai-compatible'?undefined:batch?.route as ModelRegistryRoute|undefined);
                if (!choice&&!registered) throw new ProviderError("invalid-input");
                const chosenRoute=registered?{connectionId:registered.id,provider:registered.adapter!,stage:'stt' as const,modelId:registered.modelId,endpointTag:null}:choice!.route;
                const model = !registered&&chosenRoute.provider === 'openai' ? getSTTModel(consent.modelId) : null;
                const source = p.sourceAssets[0];
                if (!source || (batch && source.id !== batch.sourceId))
                    throw new ProviderError("invalid-input");
                if (purpose === "initial" && !preparedAudioReady(p)) throw new ProviderError("invalid-input");
                const selected = chunkIds ?? retainedInitialChunkIds(p);
                if (purpose === "initial" && selected.some(id => !retainedInitialChunkIds(p).includes(id))) throw new ProviderError("invalid-input");
                const token = sttActionToken(sttConsentBase(p), p, { purpose, chunkIds: selected, modelId: registered?.id??chosenRoute.modelId, ...(batchId ? { batchId } : {}) });
                // Legacy programmatic initial calls retain their two-field API.
                // Runtime UI supplies the bound token for every paid action.
                if ((consent.consentToken !== undefined && consent.consentToken !== token) || ((registered||chosenRoute.provider === "openrouter") && consent.consentToken !== token) || (purpose !== "initial" && (consent.additionalChargeAcknowledged !== true || consent.consentToken !== token))) throw new ProviderError("invalid-input");
                // A retry retains its disclosed original languages while current
                // route, policy, profile, rates and retained descriptors are revalidated.
                const selectionProject = batch ? { ...p, audioOptions: { ...p.audioOptions, expectedLanguages: batch.languages } } : p;
                const routerSelection = !registered&&choice?.route.provider === 'openrouter' ? routerSTTSelectionFor(selectionProject, batch?.chunkIds ?? selected, choice.route) : null;
                if (!registered&&chosenRoute.provider === 'openrouter' && (!routerSelection || batch && (!batch.routerSelection || routerSTTConsentSignature(batch.routerSelection) !== routerSTTConsentSignature(routerSelection)))) throw new ProviderError('invalid-input');
                const ranges = planChunkRanges(source.durationMs, p.audioOptions);
                if (!selected.length || selected.some(id => {
                    const chunk = p.preparedChunks.find(item => item.id === id);
                    return !chunk || !p.retainedAudio?.chunkIds.includes(chunk.id) || chunk.sourceId !== source.id ||
                        !Number.isFinite(chunk.sourceStartMs) || !Number.isFinite(chunk.sourceEndMs) || chunk.sourceStartMs < 0 || chunk.sourceEndMs <= chunk.sourceStartMs || chunk.sourceEndMs > source.durationMs ||
                        (chunkIds === undefined && !ranges.some(range => range.sourceStartMs === chunk.sourceStartMs && range.sourceEndMs === chunk.sourceEndMs)) ||
                        chunk.encodedBytes <= 0 || !chunk.audioRecordId ||
                        (registered ? chunk.encodedBytes > registered.stt!.maxBytes! || !registered.stt?.formats?.some(format=>format==='mp3'?chunk.mimeType==='audio/mpeg'&&chunk.codec==='mp3':chunk.mimeType==='audio/wav'&&chunk.codec==='pcm-s16le') || registered.stt.maxSeconds!==undefined&&(chunk.sourceEndMs-chunk.sourceStartMs)/1000>registered.stt.maxSeconds : model ? chunk.encodedBytes >= model.maxBytes - 100000 || !model.formats.some(format => format.mime === chunk.mimeType && format.codec === chunk.codec) : !routerSelection?.chunks.some(bound => bound.id === chunk.id));
                })) throw new ProviderError("invalid-input");
                if (!batch) {
                    try { batch = createSTTBatch(p, { purpose, chunkIds: selected, modelId: chosenRoute.modelId, languages: p.audioOptions.expectedLanguages, route: chosenRoute, ...(registered?{modelSnapshot:freezeExecutionModel(registered)}:{}), ...(routerSelection ? { routerSelection } : {}) }); }
                    catch { throw new ProviderError("invalid-input"); }
                    p = await saveProject(replaceSTTBatch({...p,...(registered?{sttRegistrationId:registered.id}:{})}, batch), job);
                }
                const provider = batch.modelSnapshot?createRegisteredSTTProvider({model:batch.modelSnapshot,getKey:()=>registeredKey(batch!.modelSnapshot!,job),fetch:options.fetch}):batch.routerSelection ? createOpenRouterSTTProvider({ selection: batch.routerSelection, getKey: () => session.getProviderKey("openrouter"), fetch: options.fetch }) : createOpenAIProvider({ getKey: () => session.getProviderKey("openai"), fetch: options.fetch });
                update({ ...(state.screen === 'settings' ? {} : { screen: "stt" as const }), preparation: null });
                const result = await runTranscriptionQueue({ project: p, batch, purpose, chunkIds: selected, modelId: batch.modelId, languages: batch.languages, provider, vault: session.store, job, rateSnapshot: registered?registered.catalogEvidence?.pricing.snapshot??null:batch.routerSelection ? batch.routerSelection.rateSnapshot : model!.rateSnapshot, acknowledgeAdditionalCharge: consent.additionalChargeAcknowledged === true, acknowledgeUnknownOutcome: purpose !== "initial" && consent.additionalChargeAcknowledged === true,
                    onProject: (project) => {
                        job.assertActive();
                        p = project;
                        showProject(project);
                        const captured = pending.get(id);
                        if (captured?.runId && project.runs.some((run) => run.id === captured.runId && run.state === "saved"))
                            pending.delete(id);
                    },
                    onPending: (project) => { job.assertActive(); const saving = project.runs.find((run) => run.state === "saving"); pending.set(id, { project, runId: saving?.id ?? null, audioRecords: [] }); },
                    onState: () => emit(),
                });
                job.assertActive();
                p = result.project;
                if (result.pendingProject)
                    pending.set(id, { project: result.pendingProject, runId: result.pendingProject.runs.find((run) => run.state === "saving")?.id ?? null, audioRecords: [] });
                if (result.failure?.code === "storage")
                    throw result.failure;
                if (result.failure) {
                    const failedRun = [...p.runs].reverse().find((run) => run.intent?.kind === "stt" && selected.includes(run.intent.chunkId ?? "") && run.state !== "saved");
                    const response = result.failure.readSensitiveResponse();
                    if (failedRun && response !== undefined) {
                        const next = snapshotProject({ ...p, failedProviderResponses: [...((p as ControllerProject).failedProviderResponses ?? []), { runId: failedRun.id, response, failureCode: result.failure.code }] } as ControllerProject);
                        result.failure.clearSensitiveResponse();
                        p = await saveProject(next, job);
                    }
                }
                if (p.transcriptVersions.length) {
                    await refreshConsent(job);
                }
                if (result.failure)
                    throw result.failure;
                update({ ...(state.screen === 'settings' ? {} : { screen: "stt" as const }), preparation: null });
            });
        },
        async editTranscript(id, versionId, segmentId, text) { await changeVersion(id, versionId, (p) => { const version = p.transcriptVersions.find((item) => item.id === versionId)!; const next = { ...editTranscript(version, [{ segmentId, text }]), createdAt: new Date().toISOString() }; return { ...p, transcriptVersions: [...p.transcriptVersions, next], selectedTranscriptVersionId: next.id }; }); },
        async generateMinutes(id, consent) {
            await execute(async (job) => {
                const p = getProject(id);
                const selected = p.transcriptVersions.find((version) => version.id === p.selectedTranscriptVersionId);
                const transcript = selected ? withChunkSources(selected, p.rawTranscripts, p.preparedChunks) : null;
                if (!transcript || consent.acknowledged !== true || consent.transcriptVersionId !== transcript.id)
                    throw new ProviderError("invalid-input");
                const settings = await refreshConsent(job);
                if (!consent.consentToken || consent.consentToken !== state.minutesConsentToken)
                    throw new ProviderError("invalid-input");
                if (!settings) throw new ProviderError("invalid-input");
                const registered=registeredModel(settings.registrationId,'llm');
                if(registered){
                    if(registrationProblem(registered)||state.minutesSelection?.status!=='fits'||!state.minutesSelection.limits.outputTokens)throw new ProviderError('context');
                    const acknowledgement=consent.partialAcknowledged?await acknowledgePartialTranscript(transcript):undefined;
                    job.assertActive();update({minutesGenerating:true});
                    await generateAndCheckpoint(id,transcript,settings,{registration:registered},state.minutesSelection.limits.outputTokens,0,job,acknowledgement);
                    job.assertActive();if(state.screen!=='settings')update({screen:'minutes'});return;
                }
                const model = routerModels.find((entry) => entry.id === p.minutesSettings.modelId);
                const endpoint = endpointCatalog.get(p.minutesSettings.modelId)?.find((entry) => entry.tag === p.minutesEndpointTag);
                if (!model || !endpoint || model.maxOutputTokens === null || endpoint.maxOutputTokens === null)
                    throw new ProviderError("context");
                const budget = state.minutesSelection?.limits;
                if (!budget?.outputTokens || state.minutesSelection?.status !== "fits") throw new ProviderError("context");
                const acknowledgement = consent.partialAcknowledged ? await acknowledgePartialTranscript(transcript) : undefined;
                job.assertActive(); update({ minutesGenerating: true });
                await generateAndCheckpoint(id, transcript, settings, { model, endpoint }, budget.outputTokens, budget.reasoningReserveTokens, job, acknowledgement);
                job.assertActive(); if (state.screen !== 'settings') update({ screen: "minutes" });
            });
        },
        generateComparison: (id, consent) => execute(async job => {
            if (state.selectedProjectId !== id || !state.comparisonOpen || consent.acknowledged !== true) throw new ProviderError("invalid-input");
            await refreshComparisonConsent(job); job.assertActive();
            const frozen = comparisonCandidate;
            if (!frozen || !state.comparisonConsentToken || consent.consentToken !== state.comparisonConsentToken || consent.transcriptVersionId !== frozen.transcript.id) throw new ProviderError("invalid-input");
            const preview = state.minutesComparison;
            if (preview?.status !== "fits" || (preview.unknownTotal && consent.unknownTotalAcknowledged !== true)) throw new ProviderError("invalid-input");
            const choices = frozen.members.map(member => minutesChoice(member.modelId,member.endpointTag,member.modelSnapshot?.id,member.modelSnapshot)) as unknown as readonly [MinutesChoice, MinutesChoice];
            if (!choices[0] || !choices[1]) throw new ProviderError("context");
            // Pure preview preflights both routes before an intent or paid call.
            if (previewComparison({ transcript: frozen.transcript, settings: frozen.settings, choices, outputTokens: frozen.outputTokens }).status !== "fits") throw new ProviderError("context");
            const retry = state.comparisonRetryMember ?? null;
            const p = getProject(id);
            if (retry !== null) {
                const current = p.minutesComparisons?.find(record => record.id === frozen.id);
                if (!current || JSON.stringify(current) !== JSON.stringify(frozen) || comparisonMemberState(p, current, retry) === "saved") throw new ProviderError("invalid-input");
                const memberState = comparisonMemberState(p, current, retry);
                if (!["queued", "failed", "cancelled", "outcome-unknown"].includes(memberState)) throw new ProviderError("busy");
            }
            const acknowledgement = consent.partialAcknowledged ? await acknowledgePartialTranscript(frozen.transcript) : undefined;
            job.assertActive();
            if (frozen.transcript.missingRanges.length && !acknowledgement) throw new ProviderError("invalid-input");
            update({ minutesGenerating: true, comparisonConsentToken: null }); comparisonCandidate = null;
            if (retry === null) {
                await saveProject({ ...p, minutesComparisons: [...(p.minutesComparisons ?? []), frozen] }, job); job.assertActive();
                update({ selectedComparisonId: frozen.id });
            }
            const members: readonly (0 | 1)[] = retry === null ? [0, 1] : [retry];
            for (const member of members) {
                job.assertActive();
                const baseSettings={...frozen.settings};delete baseSettings.registrationId;
                await generateAndCheckpoint(id, frozen.transcript, { ...baseSettings, modelId: frozen.members[member].modelId,...(frozen.members[member].modelSnapshot?{registrationId:frozen.members[member].modelSnapshot!.id}:{}) }, choices[member], frozen.outputTokens, frozen.reasoningReserveTokens, job, acknowledgement, { record: frozen, member, consentToken: consent.consentToken });
                job.assertActive();
            }
            update({ ...(state.screen === 'settings' ? {} : { screen: "minutes" as const }), comparisonRetryMember: null });
            await refreshComparisonConsent(job);
        }),
        async editMinutes(id, revisionId, markdown) {
            await execute(async (job) => {
                const p = getProject(id);
                const previous = p.minutesRevisions.find((revision) => revision.id === revisionId);
                const run = p.minutesRuns.find((item) => item.id === previous?.runId);
                if (!previous || !run)
                    throw new ProviderError("invalid-input");
                const revision = reviseMinutes(run, markdown, previous);
                await saveProject({ ...p, minutesRevisions: [...p.minutesRevisions, revision], selectedMinutesRevisionId: revision.id }, job);
            });
        },
    };
    const launch = (operation: () => Promise<unknown>) => {
        void operation().catch((error: unknown) => {
            if (error instanceof DOMException && error.name === "AbortError")
                return;
            if (error instanceof ProviderError && error.code === 'busy') {
                const notice = state.preferences.uiLanguage === 'ko' ? '작업 중이에요.' : 'Work is in progress.';
                if (state.session === 'unlocked') {
                    if (state.notice !== notice) update({ notice });
                    clearTimeout(duplicateNoticeTimer);
                    duplicateNoticeTimer = setTimeout(() => {
                        duplicateNoticeTimer = undefined;
                        if (!disposed && state.session === 'unlocked' && state.notice === notice) update({ notice: null });
                    }, 3000);
                }
                return;
            }
            if (state.session === "unlocked")
                update({ error: safeFailure(error, state.preferences.uiLanguage) });
        });
    };
    function clearMeetingEditSave(save: Readonly<{ id: string }> | null): void {
        // Cancel clears its own save even after abortion; old cleanup cannot clear a newer session/save.
        if (!save || meetingEditSave !== save) return;
        meetingEditSave = null;
        if (state.session === "unlocked") update({ meetingEditsSaving: false });
    }
    function stageMeetingEdit(id: string, patch: Partial<Pick<MeetingProject, "title" | "icon" | "color" | "pinned">>): void {
        try {
            assertUnlocked();
            // Only this meeting's title may change during its own save; other work stays exclusive.
            const ownTitleSave = state.busy && state.meetingEditsSaving && meetingEditSave?.id === id && Object.keys(patch).every(key => key === 'title');
            if ((state.busy && !ownTitleSave) || cancelling || saveBlocked || recordingOwner || recordingDrains.size)
                throw new ProviderError(saveBlocked ? "storage" : "busy");
            const project = snapshotProject({ ...getProject(id), ...patch, updatedAt: new Date().toISOString() });
            const write: CheckpointWrite = { project, runId: null, audioRecords: [] };
            pending.set(id, write);
            showProject(project);
            const previous = editTimers.get(id);
            if (previous)
                clearTimeout(previous);
            editTimers.delete(id);
            if (ownTitleSave) return;
            const epoch = createJobContext();
            editTimers.set(id, setTimeout(() => {
                editTimers.delete(id);
                launch(async () => {
                    try {
                        await activeOperation;
                    }
                    catch { /* A failed operation keeps its completed snapshot. */ }
                    epoch.assertActive();
                    if (pending.get(id) !== write)
                        return;
                    if (saveBlocked) throw new ProviderError("storage");
                    const titleSave = { id };
                    meetingEditSave = titleSave;
                    update({ meetingEditsSaving: true });
                    try {
                        await execute(async job => {
                            // An older encrypted receipt must not end saving newer staged typing.
                            while (pending.has(id)) {
                                await saveProject(pending.get(id)!.project, job);
                                job.assertActive();
                            }
                        });
                    } finally {
                        clearMeetingEditSave(titleSave);
                    }
                });
            }, 250));
        }
        catch (error) {
            if (state.session === "unlocked")
                update({ error: safeFailure(error, state.preferences.uiLanguage) });
        }
    }
    function stageMinutesInstructions(id: string, instructions: string, composing = false): void {
        assertUnlocked();
        if ((state.busy && !state.minutesInstructionsSaving) || cancelling || saveBlocked || recordingOwner || recordingDrains.size)
            throw new ProviderError(saveBlocked ? "storage" : "busy");
        const p = getProject(id);
        const project = snapshotProject({ ...p, minutesSettings: { ...p.minutesSettings, instructions } });
        pending.set(id, { project, runId: null, audioRecords: [] });
        showProject(project);
        comparisonCandidate = null; comparisonRevision++;
        update({ minutesConsentToken: null, comparisonConsentToken: null });
        const timer = instructionsTimers.get(id);
        if (timer) clearTimeout(timer);
        instructionsTimers.delete(id);
        if (composing || state.minutesInstructionsSaving) return;
        const epoch = createJobContext();
        instructionsTimers.set(id, setTimeout(() => {
            instructionsTimers.delete(id);
            launch(async () => {
                try { await activeOperation; } catch { /* Preserve staged text on failure. */ }
                epoch.assertActive();
                if (saveBlocked) throw new ProviderError("storage");
                update({ minutesInstructionsSaving: true });
                try {
                    await execute(async job => {
                        do {
                            while (pending.has(id)) {
                                await saveProject(pending.get(id)!.project, job);
                                job.assertActive();
                            }
                            await refreshConsent(job);
                            job.assertActive();
                        } while (pending.has(id));
                    });
                } finally {
                    if (state.session === "unlocked") update({ minutesInstructionsSaving: false });
                }
            });
        }, 250));
    }
    const handlers: Partial<AppController> & {
        onMinutesEndpoint: (id: string, tag: string) => void;
    } = {
        onSaveSelectionLists: lists => core.saveSelectionLists(lists),
        onRouterSTTPreference: (connectionId, preference) => core.setRouterSTTPreference(connectionId, preference),
        onApplyRouterSTTRecommendation: (connectionId, modelId) => core.applyRouterSTTRecommendation(connectionId, modelId),
        onRefreshStorage: () => launch(core.refreshStorage),
        onPlanAudioDeletion: (scope, id) => launch(() => core.planAudioDeletion(scope, id)),
        onCancelAudioDeletion: core.cancelAudioDeletion,
        onConfirmAudioDeletion: token => launch(() => core.deletePlannedAudio(token)),
        onEditPreparation:id=>launch(async()=>{await selectProject('import',id);update({preparationEditor:{projectId:id,requestId:++preparationEditorRevision}});}),
        onPlanPreparationReset:(id,audioOptions)=>launch(()=>core.planPreparationReset(id,audioOptions)),
        onConfirmPreparationReset:token=>launch(()=>core.resetPreparation(token)),
        onCancelPreparationReset:()=>{if(!state.busy)update({preparationResetPlan:null});},
        onNavigate: (screen, id) => launch(() => selectProject(screen, id)), onNavigateAfterStop: (screen, id) => launch(() => selectProject(screen, id, true)), onSettingsTab: (settingsTab: SettingsTab) => { if (settingsTab === 'history') launch(() => selectProject('history')); else { update({ settingsTab, audioDeletionPlan: null }); if (settingsTab === 'security' && state.session === 'unlocked' && !state.busy) launch(core.refreshStorage); } },
        onCreateVault: (secret) => launch(() => core.createVault(secret)), onUnlock: (secret) => launch(() => core.unlock(secret)), onLock: () => launch(core.screenLock), onHardLock: () => launch(core.lock), onScreenUnlock: secret => { void core.unlockScreen(secret).catch(() => {}); },
        autoLockRemaining: idle.remaining,
        onUIDraft: (key, value) => { if (!interactive()) return; const next = { ...uiDrafts, [key]: structuredClone(value) }; validateScreenState({ ...screenState(), restore: { ...screenState().restore!, drafts: next } }); uiDrafts = next; }, onRetryLock: () => launch(() => session.retryLock()), onDiscardAndLock: () => launch(() => session.discardPendingAndLock()),
        onResetVault: () => launch(core.resetVault),
        onCreateMeeting: () => launch(core.createMeeting), onUpdateMeeting: stageMeetingEdit, onPickFile: (id, file) => launch(() => core.importFile(id, file)),
        onDeleteMeeting: (id) => launch(() => execute(async (job) => {
            getProject(id);
            clearPlayback();
            await session.store.deleteProject(id, job);
            job.assertActive();
            releaseSourcePreview(id);
            pending.delete(id);
            for (const timers of [editTimers, instructionsTimers]) {
                const timer = timers.get(id);
                if (timer) clearTimeout(timer);
                timers.delete(id);
            }
            files.delete(id); availability.delete(id); recordingDraftBytes.delete(id);
            uiDrafts = withoutDeletedProjectDrafts(uiDrafts, new Set([id]));
            const selectedDeleted = state.selectedProjectId === id;
            if (selectedDeleted) { workReturnScreen = null; comparisonCandidate = null; }
            update({ ...(selectedDeleted ? { ...emptyComparison, minutesSelection: null, minutesConsentToken: null, routerSTTSelection: null } : {}),
                projects: state.projects.filter((p) => p.id !== id), selectedProjectId: selectedDeleted ? null : state.selectedProjectId,
                uiDrafts, historyProjectId: state.historyProjectId === id ? null : state.historyProjectId, storageInventory: null,
                preparation: selectedDeleted ? null : state.preparation,
                preparationEditor: state.preparationEditor?.projectId === id ? null : state.preparationEditor,
                preparationResetPlan: state.preparationResetPlan?.projectId === id ? null : state.preparationResetPlan,
                audioDeletionPlan: state.audioDeletionPlan?.projectId === id ? null : state.audioDeletionPlan,
                screen: "home", notice: state.preferences.uiLanguage === 'ko' ? '음성 메모와 해당 작업 데이터를 삭제했어요.' : 'The voice memo and its work data were deleted.' });
            retainScreenState();
        })),
        onClearFile: (id) => launch(() => execute(async (job) => {
            const p = getProject(id);
            if (p.sourceAssets.length && !retainedSource(p)) throw new ControllerError('source-deleted');
            if (p.rawTranscripts.length || p.minutesRuns.length || p.preparedChunks.some(chunk => !p.retainedAudio?.chunkIds.includes(chunk.id)))
                throw new ProviderError("invalid-input");
            clearPlayback();
            await saveProject({ ...p, sourceAssets: [], preparedChunks: [] }, job);
            files.delete(id);
            const preview = previews.get(id);
            if (preview)
                urls.revoke(preview);
            previews.delete(id);
            update({ sourcePreviewUrl: null });
        })),
        onAudioOptions: (id, audioOptions) => launch(() => execute(async (job) => {
            validateOptions(audioOptions);
            const p = getProject(id);
            const changesEncoding = audioOptions.chunkMinutes !== p.audioOptions.chunkMinutes || audioOptions.overlapSeconds !== p.audioOptions.overlapSeconds || audioOptions.bitrateKbps !== p.audioOptions.bitrateKbps || audioOptions.sampleRateHz !== p.audioOptions.sampleRateHz;
            if (changesEncoding && (p.preparedChunks.length || p.rawTranscripts.length || p.transcriptVersions.length || p.minutesRuns.length || p.runs.length))
                throw new ControllerError("audio-options-locked");
            // Deleted descriptors still belong to historical provenance; an
            // encoding change invalidates retained audio, not those identities.
            const chunks = changesEncoding ? p.preparedChunks.filter(chunk => !p.retainedAudio?.chunkIds.includes(chunk.id)) : p.preparedChunks;
            await saveProject({ ...p, audioOptions: structuredClone(audioOptions), preparedChunks: chunks }, job);
        })),
        onDefaultAudioOptions: (audioOptions) => {
            try {
                assertUnlocked();
                validateOptions(audioOptions);
                update({ defaultAudioOptions: structuredClone(audioOptions) });
            }
            catch (error) {
                update({ error: safeFailure(error, state.preferences.uiLanguage) });
            }
        },
        onSTTModel: (sttModelId) => {
            try {
                assertUnlocked();
                if (state.busy)
                    throw new ProviderError("busy");
                const registered=registeredModel(sttModelId,'stt');
                if(registered){
                    launch(()=>execute(async job=>{
                        if(state.selectedProjectId)await saveProject({...getProject(state.selectedProjectId),sttRegistrationId:registered.id},job);
                        job.assertActive();metadataRevision++;update({sttModelId});publishRegisteredChoices();
                    }));return;
                }
                if (!eligible(sttModelId, null, 'stt')) throw new ProviderError('invalid-input');
                if (sttChoice(sttModelId)?.route.provider === 'openai') getSTTModel(sttModelId);
                update({ sttModelId }); publishRegistry();
            }
            catch (error) {
                update({ error: safeFailure(error, state.preferences.uiLanguage) });
            }
        },
        onPrepareAudio: id => launch(() => core.prepareAudio(id)), onCancelPreparation: () => launch(() => cancelWork(true)),
        onTranscribeChunks: (id, chunks, consent) => launch(() => core.startSTT(id, consent, chunks, { purpose: "transcribe-selected" })),
        onSelectChunkTranscript: (id, chunkId, rawId, parentVersionId) => launch(() => execute(async job => {
            const project = getProject(id);
            if (project.selectedTranscriptVersionId !== parentVersionId) throw new ProviderError('invalid-input');
            let next: MeetingProject;
            try { next = selectChunkRaw(project, chunkId, rawId); } catch { throw new ProviderError('invalid-input'); }
            comparisonRevision++;
            await saveProject(next, job);
            await refreshConsent(job);
        })),
        onStartSTT: (id, consent) => launch(() => core.startSTT(id, consent)), onRetrySTT: (id, chunks, consent) => launch(() => core.startSTT(id, consent, chunks, { purpose: "retry-failed", ...(consent.batchId ? { batchId: consent.batchId } : {}) })), onRerunSTT: (id, chunks, consent) => launch(() => core.startSTT(id, consent, chunks, { purpose: "rerun-successful" })), onCancelSTT: () => launch(cancelWork),
        onPlayChunk: (id, chunkId) => launch(() => play(id, chunkId)),
        onPauseChunk: (id, chunkId) => playback.pause(id, chunkId),
        onResumeChunk: (id, chunkId) => { if (!disposed && state.session === 'unlocked' && !saveBlocked && !state.storageWorking && retainedChunks(getProject(id)).some(chunk => chunk.id === chunkId)) playback.resume(id, chunkId); },
        onStopPlayback: playback.stop,
        onLoadSourcePreview: id => { void restoreSourcePreview(id); },
        onReleaseSourcePreview: releaseSourcePreview,
        onSourcePreviewPlay: audio => {
            if (disposed || state.session !== 'unlocked' || state.screenAccess !== 'open' || saveBlocked || state.storageWorking || !state.selectedProjectId || !retainedSource(getProject(state.selectedProjectId))) { audio.pause(); return; }
            playback.stop(); if (sourcePlayer !== audio) pauseSource(); sourcePlayer = audio;
        },
        onPlaySegment: (id, versionId, segmentId) => launch(async () => {
            const p = getProject(id);
            const segment = p.transcriptVersions.find((version) => version.id === versionId)?.segments.find((item) => item.id === segmentId);
            if (!segment)
                throw new ProviderError("invalid-input");
            const chunk = retainedChunks(p).find((item) => item.sourceStartMs <= segment.sourceStartMs && item.sourceEndMs > segment.sourceStartMs);
            if (!chunk)
                throw new ProviderError("invalid-input");
            await play(id, chunk.id, segment.sourceStartMs, segment.sourceEndMs);
        }),
        onSelectTranscript: (id, versionId) => launch(() => changeVersion(id, versionId)), onEditTranscript: (id, versionId, segmentId, text) => launch(() => core.editTranscript(id, versionId, segmentId, text)),
        onResolveBoundary: (id, versionId, issueId, alternative) => launch(() => changeVersion(id, versionId, (p) => { const next = { ...resolveBoundary(p.transcriptVersions.find((item) => item.id === versionId)!, issueId, alternative), createdAt: new Date().toISOString() }; return { ...p, transcriptVersions: [...p.transcriptVersions, next], selectedTranscriptVersionId: next.id }; })),
        onReconcileBoundary: (id, versionId, issueId, edits: readonly TranscriptEdit[]) => launch(() => changeVersion(id, versionId, (p) => { const next = { ...reconcileBoundary(p.transcriptVersions.find((item) => item.id === versionId)!, issueId, edits), createdAt: new Date().toISOString() }; return { ...p, transcriptVersions: [...p.transcriptVersions, next], selectedTranscriptVersionId: next.id }; })),
        onMinutesRoute: (id, key) => launch(() => core.setMinutesRoute(id, key)),
        onComparisonBRoute: (id, key) => launch(async () => {const registered=registeredModel(key,'llm');if(registered){await core.setComparisonB(id,registered.modelId,registered.id);return;} const choice = registry && projectModelRegistry(registry, 'minutes').choices.find(choice => choice.key === key); if (!choice) throw new ProviderError('invalid-input'); await core.setComparisonB(id, choice.route.modelId, choice.route.endpointTag); }),
        onMinutesSettings: (id, settings) => launch(() => core.setMinutesSettings(id, settings)), onMinutesEndpoint: (id, tag) => launch(() => core.selectMinutesEndpoint(id, tag)), onGenerateMinutes: (id, consent) => launch(() => core.generateMinutes(id, consent as GenerationConsent)),
        onMinutesInstructions: (id, instructions, composing) => {
            try { stageMinutesInstructions(id, instructions, composing); }
            catch (error) { if (state.session === "unlocked") update({ error: safeFailure(error, state.preferences.uiLanguage) }); }
        },
        onRefreshMinutesMetadata: () => launch(() => core.refreshModels()),
        onComparisonView: (id, open) => launch(() => core.setComparisonView(id, open)),
        onComparisonB: (id, modelId, endpointTag) => launch(() => core.setComparisonB(id, modelId, endpointTag)),
        onSelectComparison: (id, comparisonId, retryMember) => launch(() => core.selectComparison(id, comparisonId, retryMember)),
        onGenerateComparison: (id, consent) => launch(() => core.generateComparison(id, consent)),
        onCancelMinutes: () => launch(cancelWork),
        onSelectMinutes: (id, revisionId) => launch(() => execute(async (job) => {
            const p = getProject(id);
            if (!p.minutesRevisions.some((revision) => revision.id === revisionId))
                throw new ProviderError("invalid-input");
            await saveProject({ ...p, selectedMinutesRevisionId: revisionId }, job);
        })), onEditMinutes: (id, revisionId, markdown) => launch(() => core.editMinutes(id, revisionId, markdown)),
        onCopyMinutes: (id, revisionId) => launch(() => execute(async (job) => {
            const p = getProject(id);
            if (p.selectedMinutesRevisionId !== revisionId)
                throw new ProviderError("invalid-input");
            const revision = p.minutesRevisions.find((item) => item.id === revisionId)!;
            await copyMarkdown(revision);
            job.assertActive();
            update({ notice: state.preferences.uiLanguage === "en" ? "Markdown copied. The copied text is plaintext outside the vault." : "Markdown을 복사했어요. 복사한 텍스트는 보관함 밖의 평문이에요." });
        })),
        onDownloadMinutes: (id, revisionId) => launch(() => execute(async (job) => {
            const p = getProject(id);
            if (p.selectedMinutesRevisionId !== revisionId)
                throw new ProviderError("invalid-input");
            const revision = p.minutesRevisions.find((item) => item.id === revisionId)!;
            downloadMarkdown(revision, p.title);
            job.assertActive();
            update({ notice: state.preferences.uiLanguage === "en" ? "Markdown download started. The file is plaintext outside the vault." : "Markdown 다운로드를 시작했어요. 파일은 보관함 밖의 평문이에요." });
        })),
        onPreferences: (preferences) => {
            try {
                assertUnlocked();
                const seconds = preferences.autoLockSeconds === undefined ? 60 : preferences.autoLockSeconds;
                validateScreenState({ ...screenState(), autoLockSeconds: seconds, lockWorkPolicy: preferences.lockWorkPolicy ?? 'standard' });
                const languageChanged = preferences.uiLanguage !== state.preferences.uiLanguage;
                if (languageChanged) {
                    minutesLanguageRevision++; comparisonRevision++; comparisonCandidate = null;
                }
                // Clear acknowledgment identity in the same synchronous update
                // as language; late old-language digests cannot restore it.
                update({ preferences: structuredClone(preferences), ...(languageChanged ? { minutesConsentToken: null, minutesSelection: null, comparisonConsentToken: null, minutesComparison: null } : {}) });
                idle.start(seconds); retainScreenState();
                if (languageChanged) launch(() => refreshConsent(createJobContext()));
            }
            catch (error) {
                update({ error: safeFailure(error, state.preferences.uiLanguage) });
            }
        },
        onSaveRegistration: saveRegistration,
        onDeleteRegistration: deleteRegistration,
        onCheckApiCredential: checkApiCredential,
        onSaveApiCredential: changeApiCredential,
        onDeleteApiCredential: deleteApiCredential,
        onImportRegistrations: importRegistrations,
        onSetRegistrationDefault: setRegistrationDefault,
        onSaveRegistrationKey: (id,key,mode)=>execute(async job=>{const saved=await session.saveRegistrationKey(id,key,mode,job);job.assertActive();await publishRegistrations(saved,job);update({apiCredentialChecks:{},registrationTest:null});}),
        onTestRegistration: testRegistration,
        onCancelRegistrationTest: ()=>registrationAbort?.abort(),
        onRetryRegistrationResult: retryRegistrationResult,
        onSaveKey: (provider, key, mode) => launch(() => core.saveKey(provider, key, mode)), onClearKey: (provider) => launch(() => execute(async (job) => { await session.clearProviderKey(provider); job.assertActive(); metadataRevision++; comparisonRevision++; comparisonCandidate = null; update({ keySaveAttempts: Object.fromEntries(Object.entries(state.keySaveAttempts ?? {}).filter(([id]) => id !== provider)), minutesConsentToken: null, comparisonConsentToken: null, connections: state.connections.map((item) => item.provider === provider ? { provider, status: "none" } : item) }); publishRegistry(); await refreshConsent(job); })),
        onTestConnection: (provider) => launch(() => execute(async (job) => {
            update({ connections: state.connections.map((item) => item.provider === provider ? { provider, status: "checking" } : item) });
            try {
                if (provider === "openai")
                    await createOpenAIProvider({ getKey: () => session.getProviderKey(provider), fetch: options.fetch }).checkConnection(job);
                else {
                    const headers = await authHeaders(() => session.getProviderKey(provider), job);
                    const body = await readOnlyJson(options.fetch ?? globalThis.fetch.bind(globalThis), "https://openrouter.ai/api/v1/key", { headers, signal: job.signal, redirect: "error", credentials: "omit" }, Date.now, job);
                    if (!asObject(body.data))
                        throw new ProviderError("malformed");

                }
                job.assertActive();
                update({ connections: state.connections.map((item) => item.provider === provider ? { provider, status: "verified", message: state.preferences.uiLanguage === "en" ? "Read-only authentication verified. Inference remains unverified." : "읽기 전용 인증을 확인했어요. 실제 추론은 아직 확인하지 않았어요." } : item) });
            }
            catch (error) {
                job.assertActive();
                update({ connections: state.connections.map((item) => item.provider === provider ? { provider, status: "failed", message: safeFailure(error, state.preferences.uiLanguage) } : item) });
                throw error;
            }
        })),
    };
    const recoveryAllowed = () => ['locked', 'save-failed'].includes(state.session);
    const allowed = new Set(['getSnapshot', 'subscribe', 'initialize', 'dispose', 'noteActivity', 'noteBackground', 'checkScreenExpiry', 'createVault', 'unlock', 'lock', 'screenLock', 'unlockScreen']);
    const gateActions = <T extends object>(snapshot: T): T => Object.freeze(Object.fromEntries(Object.entries(snapshot).map(([key, value]) => {
        if (key === 'onResetVault') return [key, (...args: unknown[]) => { if (recoveryAllowed() || interactive()) return Reflect.apply(value, undefined, args); }];
        if (!key.startsWith('on') || typeof value !== 'function' || ['onUnlock','onScreenUnlock','onLock','onHardLock','onRetryLock','onDiscardAndLock','onCreateVault'].includes(key)) return [key, value];
        return [key, (...args: unknown[]) => { if (interactive()) return Reflect.apply(value, undefined, args); }];
    }))) as T;
    const gateSnapshot = (snapshot: ControllerSnapshot): ControllerSnapshot => gateActions({ ...snapshot,
        recording: snapshot.recording ? gateActions(snapshot.recording) : snapshot.recording,
        modelManagement: snapshot.modelManagement ? gateActions(snapshot.modelManagement) : snapshot.modelManagement });
    return new Proxy(core, { get(target, key) {
        if (key === 'getSnapshot') return () => gateSnapshot(target.getSnapshot());
        const value = Reflect.get(target, key);
        if (key === 'resetVault' && recoveryAllowed()) return value;
        if (typeof value !== 'function' || allowed.has(String(key))) return value;
        return (...args: unknown[]) => interactive() ? Reflect.apply(value, target, args) : Promise.reject(new ProviderError('permission'));
    } });
}
/** Create per effect so React StrictMode cleanup cannot retain a prior owner. */
export function useMeetingController(options: ControllerOptions = {}): ControllerSnapshot {
    const [snapshot, setSnapshot] = useState<ControllerSnapshot>(initialSnapshot);
    useEffect(() => {
        const core = createMeetingController(options);
        const refresh = () => setSnapshot(core.getSnapshot());
        const unsubscribe = core.subscribe(refresh);
        refresh();
        void core.initialize().catch(() => { });
        const activity = (event: Event) => {
            if (!event.isTrusted || document.visibilityState === 'hidden') return;
            if (event.type === 'pointermove' && !(event as PointerEvent).buttons) return;
            core.noteActivity();
        };
        const checkExpiry = () => core.checkScreenExpiry();
        const visibility = () => { if (document.visibilityState === 'hidden') void core.noteBackground().catch(() => {}); else checkExpiry(); };
        const departure = () => { void core.lock().catch(() => {}); };
        const activityEvents = ['pointerdown', 'pointermove', 'keydown', 'click', 'input', 'beforeinput', 'compositionupdate', 'wheel', 'touchmove'];
        for (const name of activityEvents) document.addEventListener(name, activity, { capture: true, passive: true });
        document.addEventListener('visibilitychange', visibility);
        window.addEventListener('focus', checkExpiry); window.addEventListener('pageshow', checkExpiry);
        // Capture runs before the vault's best-effort departure listener, staging the latest UI draft first.
        window.addEventListener('pagehide', departure, true);
        return () => { unsubscribe(); for (const name of activityEvents) document.removeEventListener(name, activity, true);
            document.removeEventListener('visibilitychange', visibility); window.removeEventListener('focus', checkExpiry); window.removeEventListener('pageshow', checkExpiry);
            window.removeEventListener('pagehide', departure, true);
            void core.dispose().catch(() => { }); };
        // Injected dependencies are stable for a mount; production defaults have no props.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return snapshot;
}
