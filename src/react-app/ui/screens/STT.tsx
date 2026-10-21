import { Pencil } from 'lucide-react';
import ChunkPlayback from '../components/ChunkPlayback';
import { CredentialForm } from '../components/ApiKeys';
import { validateTranscriptionHints } from '../../domain/stt-settings';
import { getSTTModel } from '../../providers/catalog';
import { registrationEndpoint, registrationSignature, sttInputSupport, type ModelRegistration } from '../../providers/model-registrations';
import UsageStatement, { STTUsageSummary } from '../UsageStatement';
import SettingsDialog from '../components/SettingsDialog';
import ChunkTranscript from '../components/ChunkTranscript';
import './stt-review.css';
import Review from './Review';
import CompletedStageDetails from '../components/CompletedStageDetails';
import { useRef, useState } from 'react';
import type { ProjectScreenProps } from '../../App';
import type { RouterSTTSelection } from '../../domain/types';
import type { STTAction } from '../../transcript/batches';
import { batchStatus, selectedRawMap, sttActionToken } from '../../transcript/batches';
import { copy, formatBytes, formatTime, savedChunkIds, preparedAudioReady, retainedChunks, retainedInitialChunkIds, latestSTTChunkState, transcriptionComplete } from '../copy';
import { useSessionDraft } from '../useSessionDraft';

function RouterSTTFacts({ selection, chunkIds, language }: { selection: RouterSTTSelection; chunkIds: readonly string[]; language: 'ko' | 'en' }) {
  const t = (ko: string, en: string) => copy(language, ko, en);
  const chunks = selection.chunks.filter(chunk => chunkIds.includes(chunk.id));
  const bytes = chunks.reduce((sum, chunk) => sum + chunk.encodedBytes, 0);
  return <div className="stack gap12"><dl className="facts">
    <dt>{t('API 경로', 'API route')}</dt><dd>{t('브라우저 → OpenRouter → 동적으로 선택되는 처리 제공사', 'Browser → OpenRouter → dynamically selected processor')}</dd>
    <dt>{t('실제 모델 ID', 'Actual model ID')}</dt><dd className="model-route">{selection.route.modelId}</dd>
    <dt>{t('보내는 것', 'Sent')}</dt><dd>{t('준비된 음성과 적용된 언어 힌트. API 키는 OpenRouter 인증에 사용돼요.', 'Prepared audio and the applied language hint. Your API key authenticates to OpenRouter.')}</dd>
    <dt>{t('보관 요청', 'Retention request')}</dt><dd>{selection.policy.requireZdr ? t('데이터 수집 거부 · ZDR 필수', 'Data collection denied · ZDR required') : t('데이터 수집 거부 · 표준 보관 허용', 'Data collection denied · standard retention allowed')}</dd>
    <dt>{t('측정된 음성', 'Measured audio')}</dt><dd>{chunks.length} {t('청크', 'chunks')} · {bytes.toLocaleString('en-US')} {t('인코딩 바이트', 'encoded bytes')} ({formatBytes(bytes)})</dd>
    <dt>{t('예상 언어', 'Expected languages')}</dt><dd>{selection.expectedLanguages.join(', ') || t('없음', 'None')}</dd>
    <dt>{t('실제 언어 힌트', 'Applied language hint')}</dt><dd>{selection.appliedLanguage ? t(`적용 힌트: ${selection.appliedLanguage}`, `Applied hint: ${selection.appliedLanguage}`) : selection.expectedLanguages.length > 1 ? t('자동 감지 · 여러 예상 언어', 'Automatic detection · multiple expected languages') : t('자동 감지 · 적용 힌트 없음', 'Automatic detection · no applied hint')}</dd>
  </dl>
    {selection.rateSnapshot ? <div className="stack"><strong>{t('조건부 표시 요금 · 실제 청구 아님', 'Conditional advertised rates · not actual billing')}</strong>{selection.rateSnapshot.rates.map((rate, index) => <span key={index} className="mono">USD {rate.price} / {rate.units} {rate.unit}</span>)}<span className="hint model-route">{selection.rateSnapshot.source} · {selection.rateSnapshot.checkedAt}</span></div> : null}
    <span className="hint">{t('보관·학습은 서비스 정책과 선택한 설정을 따라요.', 'Retention and training follow service policies and selected settings.')}</span>
    <span className="hint">{t('청크마다 실제 음성 16,000,000바이트와 JSON 본문 24,000,000바이트 이하인지 확인해요. 더 작은 모델 한도가 있으면 그 한도를 적용해요. 용량으로 토큰 수나 최종 비용을 계산하지 않아요.', 'Each chunk is checked against 16,000,000 encoded audio bytes and 24,000,000 JSON body bytes, or a smaller model limit. Bytes do not establish token counts or final cost.')}</span>
    <span className="hint">{t('처리 제공사는 고정되지 않아요. 요청이 실패해도 자동으로 ZDR 조건을 완화하거나 유료 대체 모델을 사용하지 않아요. 서비스 내부 재시도는 MoM이 제어하지 않아요.', 'The processor is not pinned. A failure never automatically relaxes ZDR or chooses a paid replacement model. MoM does not control service-internal retries.')}</span>
  </div>;
}
function RegisteredSTTFacts({model,project,chunkIds,language}:{model:ModelRegistration;project:ProjectScreenProps['project'];chunkIds:readonly string[];language:'ko'|'en'}) {
  const t=(ko:string,en:string)=>copy(language,ko,en), router=model.adapter==='openrouter';
  const chunks=project.preparedChunks.filter(chunk=>chunkIds.includes(chunk.id));
  const support=sttInputSupport(model), hints=project.audioOptions.transcriptionHints;
  return <div className="stack gap12"><dl className="facts"><dt>{t('API 경로','API route')}</dt><dd className="registration-url">{registrationEndpoint(model)}</dd><dt>{t('실제 모델 ID','Actual model ID')}</dt><dd>{model.modelId}</dd><dt>{t('보내는 것','Sent')}</dt><dd>{t('선택한 음성 청크','Selected audio chunks')}</dd><dt>{t('언어 힌트','Language hint')}</dt><dd>{support.languageMode==='none'?t('자동 감지 · 힌트 미전송','Automatic detection · no hint sent'):project.audioOptions.expectedLanguages.join(', ')||t('자동 감지','Automatic detection')}</dd><dt>{t('용어','Vocabulary')}</dt><dd>{support.termMode==='none'?t('전송하지 않음','Not sent'):(hints?.terms??support.defaultTerms).join(', ')||t('없음','None')}</dd><dt>{t('맥락','Context')}</dt><dd>{support.context?hints?.context||t('없음','None'):t('전송하지 않음','Not sent')}</dd><dt>{t('측정된 음성','Measured audio')}</dt><dd>{chunks.length} {t('청크','chunks')} · {chunks.reduce((sum,chunk)=>sum+chunk.encodedBytes,0).toLocaleString()} {t('인코딩 바이트','encoded bytes')}</dd>{router&&<><dt>{t('보관 요청','Retention request')}</dt><dd>{model.routerPolicy?.requireZdr!==false?t('데이터 수집 거부 · ZDR 필수','Data collection denied · ZDR required'):t('데이터 수집 거부 · 표준 보관 허용','Data collection denied · standard retention allowed')}</dd></>}</dl>{support.termMode==='azure-phrases'&&<span className="hint">{t('용어는 Azure에서 처리될 때 적용돼요. 다른 제공사에서는 적용되지 않을 수 있어요.','Vocabulary applies when Azure handles the request; other providers may ignore it.')}</span>}{router&&<span className="hint">{t('개인정보 보호 조건을 충족하는 제공사가 없으면 전사를 진행하지 않아요.','Transcription stops if no provider meets the privacy requirements.')}</span>}</div>;
}


export default function STT({ controller: c, project: p, initiallyCollapsed }: ProjectScreenProps) {
  const modelSelect = useRef<HTMLSelectElement>(null);
  const [policyCredentialId, setPolicyCredentialId] = useState<string | null>(null);
  const [request, setRequest] = useState<STTAction | null>(null);
  const [requestScope, setRequestScope] = useState<'remaining' | 'all'>('remaining');
  const [resultView, setResultView] = useState<string | null>(c.screen === 'review' ? 'review' : null);
  const [editingInput, setEditingInput] = useState(false);
  const [retryConsent, setRetryConsent] = useState(''); const [startConsent, setStartConsent] = useState('');
  const t = (ko: string, en: string) => copy(c.preferences.uiLanguage, ko, en); const saved = savedChunkIds(p);
  const allIds = retainedChunks(p).map(chunk => chunk.id), remainingIds = allIds.filter(id => !saved.has(id));
  const hasAttempts = !!p.rawTranscripts.length || p.runs.some(run => run.intent?.kind === 'stt');
  const latestRun = (id: string) => [...p.runs].reverse().find(run => run.intent?.kind === 'stt' && run.intent.chunkId === id || p.rawTranscripts.some(raw => raw.chunkId === id && raw.runId === run.id));
  const chunkState = (id: string) => latestSTTChunkState(p, id, c.chunkStates);
  const retryable = (id: string) => ['failed', 'cancelled', 'outcome-unknown'].includes(chunkState(id));
  const failed = retainedChunks(p).filter(chunk => retryable(chunk.id)).map(chunk => chunk.id);
  const retryBatch = (id: string) => latestRun(id)?.intent?.sttBatchId;
  const commonRetryBatch = failed.length && failed.every(id => retryBatch(id) === retryBatch(failed[0]));
  const active = !!(c.busy || retainedChunks(p).some(chunk => ['requesting', 'response-received', 'saving'].includes(chunkState(chunk.id))));
  const models = c.modelCatalog?.filter(model => model.kind === 'stt') ?? []; const model = models.find(m => m.id === c.sttModelId);
  const optionLabel = (choice: typeof models[number]) => {
    const registered = c.modelRegistrations?.entries.find(entry => entry.id === choice.id);
    const name = (registered?.name ?? choice.label) + (c.sttPolicyBlockedModels?.includes(choice.id) ? t(' · 보관 정책 호환 불가', ' · blocked by retention policy') : '');
    if (!models.some(other => other.id !== choice.id && (c.modelRegistrations?.entries.find(entry => entry.id === other.id)?.name ?? other.label) === name)) return name;
    return `${name} · ${registered ? `${registered.modelId} (${new URL(registrationEndpoint(registered)).host})` : choice.id}`;
  };
  const originalBatch = request?.batchId ? p.sttBatches?.find(batch => batch.id === request.batchId) : undefined;
  const originalModelId = originalBatch?.modelSnapshot?.id ?? originalBatch?.modelId;
  const currentOriginal = c.modelRegistrations?.entries.find(model => model.id === originalModelId);
  const originalSettingsCurrent = !originalBatch?.modelSnapshot || !!currentOriginal && registrationSignature(currentOriginal) === registrationSignature(originalBatch.modelSnapshot);
  const frozen = request?.modelId === originalModelId && originalSettingsCurrent ? originalBatch : undefined;
  const registration=c.modelRegistrations?.entries.find(r=>r.id===c.sttModelId&&r.stage==='stt');
  const policyBlocked = c.sttPolicyBlockedModels?.includes(c.sttModelId);
  const policyCredential = c.modelRegistrations?.credentials?.find(key => key.id === policyCredentialId);
  const reviewPolicy = (model: ModelRegistration | undefined) => {
    if (model?.credentialId && c.modelRegistrations?.credentials?.some(key => key.id === model.credentialId)) setPolicyCredentialId(model.credentialId);
    else { c.onNavigate?.('settings'); c.onSettingsTab?.('models'); }
  };
  const legacyModel = !registration && model?.provider === 'openai' ? (() => { try { return getSTTModel(model.id); } catch { return null; } })() : null;
  const support = registration ? sttInputSupport(registration) : { languageMode: legacyModel?.languageHints === 'multiple' ? 'multiple' : legacyModel?.languageHints === 'single-and-prompt' || model?.provider === 'openrouter' ? 'single' : 'none', termMode: legacyModel?.languageHints === 'single-and-prompt' ? 'prompt' : 'none', context: legacyModel?.languageHints === 'single-and-prompt', defaultTerms: [] };
  const inputIdentity = JSON.stringify([p.id, c.sttModelId, p.audioOptions.expectedLanguages, p.audioOptions.transcriptionHints ?? null]);
  const currentInput = { languages: p.audioOptions.expectedLanguages.join(', '), terms: (p.audioOptions.transcriptionHints?.terms ?? support.defaultTerms).join('\n'), context: p.audioOptions.transcriptionHints?.context ?? '' };
  const [inputDraft, setInputDraft] = useSessionDraft(c, `stt-input:${inputIdentity}`, { identity: inputIdentity, ...currentInput });
  if (inputDraft.identity !== inputIdentity) setInputDraft({ identity: inputIdentity, ...currentInput });
  const input = inputDraft.identity === inputIdentity ? inputDraft : currentInput;
  const inputDirty = input.languages !== currentInput.languages || input.terms !== currentInput.terms || input.context !== currentInput.context;
  const parsedLanguages = [...new Set(input.languages.split(/[,\n]/u).map(value => value.trim()).filter(Boolean))];
  const hints = { terms: [...new Set(input.terms.split(/[,\n]/u).map(value => value.trim()).filter(Boolean))], context: input.context };
  let inputInvalid = parsedLanguages.some(value => !/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/u.test(value)) || !!(registration?.stt?.languageMode === 'single' && parsedLanguages.length > 1);
  if (inputDirty || p.audioOptions.transcriptionHints) { try { validateTranscriptionHints(hints); } catch { inputInvalid = true; } }
  const editInput = (patch: Partial<typeof currentInput>) => { setStartConsent(''); setInputDraft({ identity: inputIdentity, ...input, ...patch }); };
  const requestProject = frozen ? { ...p, audioOptions: { ...p.audioOptions, expectedLanguages: frozen.languages, transcriptionHints: frozen.transcriptionHints } } : p;
  const requestModelId = request?.modelId ?? c.sttModelId;
  const requestRegistration=frozen?.modelSnapshot??c.modelRegistrations?.entries.find(r=>r.id===requestModelId&&r.stage==='stt');
  const requestPolicyBlocked = c.sttPolicyBlockedModels?.includes(requestModelId);
  const requestModel = models.find(m => m.id === requestModelId);
  const requestProvider = requestRegistration?.adapter==='openrouter'?'openrouter':requestRegistration?.adapter==='openai'?'openai':requestRegistration?'compatible':frozen?.route?.provider ?? requestModel?.provider;
  const requestRouterSelection = frozen?.routerSelection ?? c.routerSTTSelection;
  const requestKeyMissing = requestRegistration ? requestRegistration.auth==='bearer'&&!c.registrationKeyReady?.includes(requestRegistration.id) : c.connections.find(connection => connection.provider === requestProvider)?.status === 'none';
  const action = request ? { purpose: request.purpose, chunkIds: request.purpose === 'transcribe-selected' ? requestScope === 'all' ? allIds : remainingIds : request.chunkIds, modelId: requestModelId, ...(frozen ? { batchId: frozen.id } : {}) } : null;
  const token = action ? sttActionToken(c.sttConsentToken, p, action) : '';
  const consent = !!action && retryConsent === token;
  const startIds = retainedInitialChunkIds(p);
  const startToken = sttActionToken(c.sttConsentToken, p, { purpose: 'initial', chunkIds: startIds, modelId: c.sttModelId });
  let parentMap: Readonly<Record<string, string>> | null = null;
  try { parentMap = selectedRawMap(p); } catch { /* Ambiguous legacy history requires an explicit valid selection. */ }
  const canRerun = (id: string) => !!(p.retainedAudio?.chunkIds.includes(id) && c.onRerunSTT && parentMap !== null && model?.enabled && !inputDirty && !inputInvalid && !c.sttUnavailableReason);
  const callback = action?.purpose === 'transcribe-selected' ? c.onTranscribeChunks : action?.purpose === 'rerun-successful' ? c.onRerunSTT : c.onRetrySTT;
  const canRetry = !!(action && !active && !requestPolicyBlocked && (frozen || !inputDirty && !inputInvalid) && consent && requestModel?.enabled && callback && (frozen ? !requestKeyMissing : c.sttModelId === requestModelId && !c.sttUnavailableReason) && action.chunkIds.length && action.chunkIds.every(id => p.retainedAudio?.chunkIds.includes(id) && (
    action.purpose === 'transcribe-selected' ? parentMap !== null : action.purpose === 'rerun-successful' ? saved.has(id) && parentMap !== null : retryable(id))));
  const savedRetryUnavailable = t('저장된 청크의 재전사는 아직 지원되지 않아요.', 'Re-transcription of saved chunks is not available yet.');
  const begin = (chunkIds: readonly string[], purpose: 'rerun-successful' | 'retry-failed') => {
    if (active || !chunkIds.length || chunkIds.some(id => !p.retainedAudio?.chunkIds.includes(id))) return;
    const batchId = purpose === 'retry-failed' ? retryBatch(chunkIds[0]) : undefined;
    if (purpose === 'retry-failed' && chunkIds.some(id => !retryable(id) || retryBatch(id) !== batchId)) return;
    if (purpose === 'rerun-successful' && chunkIds.some(id => !canRerun(id))) return;
    setRetryConsent('');
    const batch = batchId ? p.sttBatches?.find(item => item.id === batchId) : undefined;
    setRequest({ purpose, chunkIds: [...chunkIds], modelId: batch?.modelSnapshot?.id ?? batch?.modelId ?? c.sttModelId, ...(batchId ? { batchId } : {}) });
  };
  const beginAll = () => {
    setRetryConsent(''); setRequestScope(remainingIds.length ? 'remaining' : 'all');
    setRequest({ purpose: 'transcribe-selected', chunkIds: allIds, modelId: c.sttModelId });
  };
  const close = () => { setRequest(null); setRetryConsent(''); };
  const status = (state: string) => ({ queued: t('대기', 'Queued'), requesting: t('전사 중', 'Transcribing'), 'response-received': t('응답 수신 · 미저장', 'Response received · unsaved'), saving: t('암호화 결과 저장 중', 'Saving encrypted result'), saved: t('저장됨', 'Saved'), complete: t('완료', 'Complete'), partial: t('일부 저장됨', 'Partially saved'), failed: t('실패', 'Failed'), cancelled: t('취소됨', 'Cancelled'), 'outcome-unknown': t('결과 불명 · 비용 발생 가능', 'Outcome unknown · charges possible') })[state] ?? state;
  const canStart = !!(preparedAudioReady(p) && !inputDirty && !inputInvalid && model?.enabled && (hasAttempts ? c.onTranscribeChunks && allIds.length : startConsent === startToken && c.onStartSTT && startIds.length) && !active && !c.sttUnavailableReason && (!!registration || model?.provider !== 'openrouter' || !!c.routerSTTSelection));
  const destination = registration ? new URL(registrationEndpoint(registration)).host : model?.provider === 'openrouter' ? 'OpenRouter' : model?.provider === 'openai' ? 'api.openai.com' : null;
  const latestComplete = p.preparedChunks.length > 0 && p.preparedChunks.every(chunk => chunkState(chunk.id) === 'saved' && saved.has(chunk.id));
  return <div className="stack gap16">
    <CompletedStageDetails stage="transcription" language={c.preferences.uiLanguage} complete={transcriptionComplete(p, c.chunkStates)} initiallyCollapsed={initiallyCollapsed}
      forceOpen={!!(active || c.storageWorking || c.error || inputDirty || editingInput || inputInvalid || request || resultView || c.playback?.projectId === p.id)}
      summary={`${saved.size} / ${p.preparedChunks.length} ${t('청크 결과 저장됨', 'chunk results saved')}`}>
    <div className="stt-grid">
    <div className="stack gap16 stt-setup">
    <section className="card stack" aria-label={t('전사 모델', 'Transcription model')}>
      <div className="row-between stt-model-row"><strong>{t('전사 모델', 'Transcription model')}</strong>
        <select ref={modelSelect} className="stt-model-select" aria-label={t('전사 모델', 'Transcription model')} value={c.sttModelId} disabled={!c.onSTTModel || !models.length || active} onChange={event => { setStartConsent(''); c.onSTTModel?.(event.target.value); }}><option value="">{t('호환 모델 선택 없음', 'No compatible model selected')}</option>{models.map(m => <option key={m.id} value={m.id} disabled={!m.enabled}>{optionLabel(m)}</option>)}</select>
      </div>
      {model?.disabledReason && <span className="hint">{model.disabledReason}</span>}
      {policyBlocked && <section className="warning stack gap12" aria-label={t('보관 정책으로 전사 차단', 'Transcription blocked by retention policy')}>
        <strong>{t('이 모델은 현재 보관 정책으로 사용할 수 없어요.', 'This model cannot run under the current retention policy.')}</strong>
        <span className="hint">{t('같은 설정으로 다시 보내지 않아요. 다른 모델을 선택하거나 보관 정책을 검토하세요. 정책을 저장해도 음성을 자동 전송하지 않아요.', 'The same settings will not be resent. Choose another model or review the retention policy. Saving a policy does not send audio automatically.')}</span>
        <div className="actions wrap"><button type="button" disabled={active} onClick={() => modelSelect.current?.focus()}>{t('다른 모델 선택', 'Choose another model')}</button><button type="button" disabled={active} onClick={() => reviewPolicy(registration)}>{t('보관 정책 검토', 'Review retention policy')}</button></div>
      </section>}
      {!preparedAudioReady(p) && <div className="warning">{t('음성 준비 단계에서 모든 청크를 먼저 준비하세요.', 'Prepare every chunk in Prepare audio first.')} <button disabled={!c.onNavigate || active} onClick={() => c.onNavigate?.('import', p.id)}>{t('음성 준비로', 'Go to Prepare audio')}</button></div>}
    </section>
    <section className="card stack" aria-label={t('전송 전 확인', 'Before sending')}>
      <strong>{t('전송 전 확인', 'Before sending')}</strong>
      <span>{destination ? t(`선택한 음성과 전사 설정을 ${destination}에 전송해요.`, `Prepared audio and transcription settings will be sent to ${destination}.`) : t('전사 모델을 선택하면 전송 대상을 확인할 수 있어요.', 'Choose a transcription model to review the destination.')}</span>
      <span className="hint">{t('제공사 요금이 발생할 수 있어요. 전송된 음성의 보관·학습은 제공사 정책과 계정 설정을 따라요. 로컬 암호화는 외부 보관을 제어하지 않아요.', 'Provider charges may apply. Retention and training follow provider policies and account settings. Local encryption does not control provider retention.')}</span>
      {model?.provider === 'openrouter' && !registration && !c.routerSTTSelection && <div className="warning">{t('현재 전사 정보를 확인할 수 없어요. 전송 전에 모델 설정에서 OpenRouter 전사 목록을 다시 조회하세요.', 'Current transcription facts unavailable. Refresh the OpenRouter transcription catalog in Models settings before sending.')}</div>}
      <dl className="facts"><dt>{t('모델', 'Model')}</dt><dd>{registration?.modelId ?? model?.id ?? t('선택 없음', 'None selected')}</dd><dt>{t('사용 언어', 'Spoken languages')}</dt><dd>{p.audioOptions.expectedLanguages.join(', ') || t('자동 감지', 'Automatic detection')}</dd><dt>{t('전송 범위', 'Transmission scope')}</dt><dd>{startIds.length} {t('아직 요청하지 않은 청크', 'chunks not yet requested')}</dd></dl>
      <details className="stt-transmission-facts usage-stage-details"><summary>{t('전송 상세 보기', 'Transmission details')}</summary>
        {registration ? <RegisteredSTTFacts model={registration} project={p} chunkIds={startIds} language={c.preferences.uiLanguage}/> : model?.provider === 'openrouter' ? c.routerSTTSelection ? <RouterSTTFacts selection={c.routerSTTSelection} chunkIds={startIds} language={c.preferences.uiLanguage} /> : <div>{t('브라우저 → OpenRouter → 동적으로 선택되는 처리 제공사', 'Browser → OpenRouter → dynamically selected processor')}</div> : <dl className="facts">
          <dt>{t('API 경로', 'API route')}</dt><dd>{model?.provider === 'openai' ? 'Direct OpenAI · api.openai.com/v1/audio/transcriptions' : t('모델 선택 후 확인', 'Choose a model to review the route')}</dd>
          <dt>{t('실제 모델 ID', 'Actual model ID')}</dt><dd>{model?.id || t('선택 없음', 'None selected')}</dd>
          <dt>{t('보내는 것', 'Sent')}</dt><dd>{t('준비된 음성 청크, 언어 힌트와 선택 모델. API 키는 인증에 사용돼요.', 'Prepared audio chunks, language hints and selected model. Your API key authenticates requests.')}</dd>
          <dt>{t('보내지 않는 것', 'Not sent')}</dt><dd>{t('원본 영상, 다른 음성 메모 데이터. 원본 파일명 대신 일반 전송 파일명을 사용해요.', 'Original video and other voice memos. Uploads use a generic filename.')}</dd>
          <dt>{t('요청 방식', 'How')}</dt><dd>{t('이 브라우저에서 제공사로 직접 전송 · 중간 서버 없음', 'Sent directly from this browser to the provider · no intermediate server')}</dd>
          <dt>{t('이번 범위', 'This scope')}</dt><dd>{startIds.length} {t('아직 요청하지 않은 청크', 'chunks not yet requested')}</dd>
          <dt>{t('언어 힌트', 'Language hints')}</dt><dd>{p.audioOptions.expectedLanguages.join(', ') || t('없음', 'None')}</dd>
          <dt>{t('용어','Vocabulary')}</dt><dd>{support.termMode!=='none'?p.audioOptions.transcriptionHints?.terms.join(', ')||t('없음','None'):t('전송하지 않음','Not sent')}</dd>
          <dt>{t('맥락','Context')}</dt><dd>{support.context?p.audioOptions.transcriptionHints?.context||t('없음','None'):t('전송하지 않음','Not sent')}</dd>
        </dl>}
      </details>
      {!editingInput && inputInvalid && <span className="warning">{t('언어 코드와 모델이 허용하는 언어 수를 전사 입력에서 확인하세요.','Review language codes and the supported language count in transcription input.')}</span>}
      {!editingInput && <button className="plain accent-text align-start" disabled={active || !c.onAudioOptions} onClick={()=>setEditingInput(true)}>{t('전사 입력 수정','Edit transcription input')}</button>}
      {editingInput && <fieldset className="stt-input-settings stack gap12"><legend>{t('전사 입력', 'Transcription input')}</legend>
        <label>{t('사용 언어 · 쉼표로 구분', 'Spoken languages · comma-separated')}<input value={input.languages} disabled={active || !c.onAudioOptions} placeholder="ko, en" onChange={event => editInput({ languages: event.target.value })} /></label>
        <span className="hint">{support.languageMode==='none'?t('이 모델 설정에서는 언어 힌트를 보내지 않고 자동으로 감지해요.','This model configuration uses automatic detection without a language hint.'):support.languageMode==='single'?t('단일 언어 힌트를 사용해요. 여러 언어 처리는 모델의 자동 감지 설정을 확인하세요.','Uses a single-language hint. Check automatic detection settings for multilingual audio.'):t('선택한 언어 목록을 힌트로 보내요.','The selected language list is sent as a hint.')}</span>
        {support.termMode!=='none'?<label>{t('용어 · 한 줄에 하나', 'Vocabulary · one per line')}<textarea rows={2} value={input.terms} disabled={active || !c.onAudioOptions} onChange={event => editInput({ terms: event.target.value })} /></label>:<span className="hint">{t('용어: 이 모델 설정에서는 전송하지 않아요.','Vocabulary: not sent with this model configuration.')}</span>}
        {support.context?<label>{t('맥락', 'Context')}<textarea rows={2} maxLength={2000} value={input.context} disabled={active || !c.onAudioOptions} onChange={event => editInput({ context: event.target.value })} /></label>:<span className="hint">{t('맥락: 이 모델 설정에서는 전송하지 않아요.','Context: not sent with this model configuration.')}</span>}
        {registration?.adapter==='openai-compatible'&&<span className="hint">{t('입력 지원은 등록한 모델 설정 기준이에요. 실제 서버 지원은 별도 확인이 필요해요.','Inputs follow the registered configuration. Actual server support requires verification.')}</span>}
        {inputInvalid&&<span className="warning">{t('언어 코드와 모델의 언어 개수를 확인하세요. 용어는 50개·각 100자, 맥락은 2,000자까지 입력할 수 있어요.','Check language codes and the model language count. Use up to 50 terms of 100 characters each and 2,000 context characters.')}</span>}
        {inputDirty&&<span className="hint">{t('수정 내용은 이 모델의 초안으로 유지돼요. 전사 전에 적용하거나 취소하세요.','Edits are retained as a draft for this model. Apply or discard them before transcription.')}</span>}
        {inputDirty&&<div className="actions align-end"><button disabled={active} onClick={()=>{setStartConsent('');setInputDraft({identity:inputIdentity,...currentInput});}}>{t('수정 취소','Discard changes')}</button><button disabled={active||inputInvalid||!c.onAudioOptions} onClick={()=>{setStartConsent('');c.onAudioOptions?.(p.id,{...p.audioOptions,expectedLanguages:parsedLanguages,transcriptionHints:hints});}}>{t('입력 설정 적용','Apply input settings')}</button></div>}
      </fieldset>}
      <div className="stt-execution-row">{hasAttempts ? <span className="hint">{t('완료된 청크를 건너뛸지 다음 화면에서 선택해요.', 'Choose whether to skip completed chunks in the next step.')}</span> : <label className="checkbox-line"><input type="checkbox" checked={startConsent === startToken} disabled={active || inputDirty || inputInvalid} onChange={event => setStartConsent(event.target.checked ? startToken : '')} /><span>{t('위 내용을 확인했어요', "I've reviewed the above")}</span></label>}<button className="primary tall" disabled={!canStart} onClick={() => hasAttempts ? beginAll() : c.onStartSTT?.(p.id, { modelId: c.sttModelId, acknowledged: true, consentToken: startToken })}>{hasAttempts ? t('전체 전사', 'Transcribe all') : t('전사 실행', 'Transcribe')}</button></div>
      {(c.sttUnavailableReason || !c.onStartSTT) && <span className="hint">{c.sttUnavailableReason ?? t('전사 연결 준비 안 됨', 'Transcription unavailable')}</span>}
    </section>
    <STTUsageSummary project={p} language={c.preferences.uiLanguage} onDetails={() => setResultView('usage')} />
    </div>
    <div className="stack gap16 stt-results">
    <section className="card stack gap18">
      <div className="stack"><div className="row-between stt-status-heading"><strong>{active ? t('처리 중', 'Processing') : latestComplete ? t('전사 완료 · 모든 청크 결과가 저장됐어요', 'Transcription complete · all chunks saved') : failed.length ? t('최근 전사 요청 확인 필요 · 이전 저장 결과 유지', 'Latest attempt needs review · previous saved results retained') : t('전사 대기 중', 'Waiting to transcribe')}</strong><span className="mono saved-count">{t('전사 결과', 'Transcript results')} {saved.size} / {p.preparedChunks.length}</span></div><div className="chunk-meter" aria-label={t('암호화 저장된 청크', 'Encrypted saved chunks')}>{p.preparedChunks.map(chunk => <span key={chunk.id} className={saved.has(chunk.id) ? 'saved' : ''} />)}</div></div>
      {!!failed.length && <div className="error row-between"><span>{failed.length} {t('청크의 최근 요청을 완료하지 못했어요. 이전 결과는 유지돼요.', 'chunks have incomplete latest attempts. Previous results are retained.')}</span><button className="danger" disabled={!c.onRetrySTT || active || !commonRetryBatch} onClick={() => begin(failed, 'retry-failed')}>{t('실패한 청크만 다시 실행', 'Retry failed chunks only')}</button></div>}
      {!!failed.length && !commonRetryBatch && <span className="hint">{t('요청 묶음이 다르면 청크별로 원래 전송 조건을 확인하고 다시 시도하세요.', 'Retry each chunk separately when its original batch differs.')}</span>}
      {active && <span className="hint">{t('청크를 순서대로 전송해요. 제공사 처리 진행률은 알 수 없어요.', 'Chunks are sent sequentially. Provider processing progress is unknown.')}</span>}
      <div className="actions align-end"><button className="primary" disabled={!p.rawTranscripts.length && !p.transcriptVersions.length} onClick={() => setResultView('review')}>{t('전체 전사 확인·편집', 'Review & edit full transcript')}</button>{active && <button disabled={!c.onCancelSTT} onClick={() => c.onCancelSTT?.(p.id)}>{t('전사 취소', 'Cancel transcription')}</button>}</div>
    </section>
    <section className="card flush"><div className="card-heading row-between"><strong>{t('청크', 'Chunks')} {p.preparedChunks.length}{t('개', '')}</strong><div className="actions"><span className="mono muted">{p.audioOptions.chunkMinutes} {t('분', 'min')} · {p.audioOptions.overlapSeconds} {t('초 겹침', 's overlap')} · {p.audioOptions.bitrateKbps} kbps</span><button className="icon-button" aria-label={t('청크·압축 편집', 'Edit chunks & compression')} title={t('청크·압축 편집', 'Edit chunks & compression')} disabled={!c.onEditPreparation || active || !!c.storageWorking || c.recordingActive} onClick={() => c.onEditPreparation?.(p.id)}><Pencil aria-hidden="true" /></button></div></div>
      {p.preparedChunks.map(chunk => { const available = !!p.retainedAudio?.chunkIds.includes(chunk.id); const state = chunkState(chunk.id), retry = retryable(chunk.id), rerun = saved.has(chunk.id) && !retry; const error = c.chunkStates?.find(item => item.chunkId === chunk.id)?.error; return <div key={chunk.id} className="chunk-row"><span className="mono chunk-number">#{chunk.index + 1}</span><div className="stack chunk-range"><span className="mono">{formatTime(chunk.sourceStartMs)}–{formatTime(chunk.sourceEndMs)}</span><span className="mono muted">{formatBytes(chunk.encodedBytes)} · {chunk.codec}</span></div><div className="stack chunk-status"><span className={`badge ${state === 'saved' ? 'done' : ['failed', 'outcome-unknown'].includes(state) ? 'failed' : 'idle'}`}>{status(state)}</span>{saved.has(chunk.id) && state !== 'saved' && <span className="hint">{t('이전 저장 결과 유지', 'Previous saved result retained')}</span>}{state === 'requesting' && <progress aria-label={`${t('청크', 'Chunk')} ${chunk.index + 1} ${t('전사 중', 'transcription')}`} />}</div><div className="actions chunk-actions"><ChunkPlayback controller={c} project={p} chunkId={chunk.id} index={chunk.index + 1} /><button className="stt-review-button" disabled={!p.rawTranscripts.some(raw => raw.chunkId === chunk.id)} onClick={() => setResultView(chunk.id)}>{t('전사 내용 확인', 'View transcript')}</button><button disabled={!available || active || (rerun ? !canRerun(chunk.id) : !retry || !c.onRetrySTT)} title={rerun && !c.onRerunSTT ? savedRetryUnavailable : rerun && parentMap === null ? t('이 청크의 원본이 포함된 유효한 전사 버전을 먼저 선택하세요.', 'Select a valid transcript version containing this chunk first.') : undefined} onClick={() => begin([chunk.id], rerun ? 'rerun-successful' : 'retry-failed')}>{rerun ? t('다시 전사', 'Re-transcribe') : retry ? t('최근 요청 다시 시도', 'Retry latest attempt') : t('다시 시도', 'Retry')}</button></div>{error && <div className="chunk-error" role="alert">{t('원인:', 'Cause:')} {error}</div>}</div>; })}
      {!p.preparedChunks.length && <div className="empty">{t('아직 준비된 청크가 없어요. 가져오기에서 파일과 옵션을 확인하세요.', 'No chunks prepared yet. Check the file and options in Import.')}</div>}
    </section>
    {!!saved.size && <span className="hint">{t('다시 전사한 결과는 새 버전으로 저장돼요. 선택 전사·수정본·기존 정리 노트는 유지되며, 전체 전사에서 사용할 버전을 직접 선택하세요.', 'Re-transcription saves a new version. Your selected transcript, edits and existing notes remain; choose the version in the full transcript review.')}</span>}
    <span className="hint">{t('취소해도 이미 전송된 요청에는 요금이 발생할 수 있어요. 결과를 받지 못해 다시 시도하면 중복 과금될 수 있어요.', 'Cancelling may still incur charges for requests already sent. Retrying a request without a result may incur duplicate charges.')}</span>

    </div>
    </div>
    </CompletedStageDetails>
    {resultView === 'review' && <SettingsDialog title={t('전체 전사 확인·편집', 'Review & edit full transcript')} closeLabel={t('닫기', 'Close')} className="stt-review-dialog" onClose={() => { c.onStopPlayback?.(); setResultView(null); }}><Review key={p.id} controller={c} project={p} /></SettingsDialog>}
    {resultView === 'usage' && <SettingsDialog title={t('사용량 명세 · 요청 이력', 'Usage statement · request history')} closeLabel={t('닫기', 'Close')} className="stt-usage-dialog" onClose={() => setResultView(null)}><UsageStatement project={p} language={c.preferences.uiLanguage} sttOnly detailed />
    {!!p.sttBatches?.length && <details className="card stack"><summary className="touch-summary">{t('전사 요청 이력', 'Transcription batch history')}</summary>{p.sttBatches.map(batch => <div key={batch.id} className="stack gap12"><strong>{batch.modelSnapshot?.name??batch.modelId} · {status(batchStatus(p, batch))}</strong><span className="hint">{batch.createdAt} · {batch.languages.join(', ') || t('힌트 없음', 'No hints')} · {batch.chunkIds.length} {t('청크', 'chunks')} · {batch.modelSnapshot?`${registrationEndpoint(batch.modelSnapshot)} · ${batch.modelSnapshot.modelId}`:batch.route?.provider === 'openrouter' ? t('OpenRouter · 동적 처리 제공사', 'OpenRouter · dynamic processor') : 'Direct OpenAI'}</span><span className="hint">{t('묶음', 'Batch')}: {batch.id} · {t('원본', 'Source')}: {batch.sourceId} · {t('상위 묶음', 'Parent batch')}: {batch.parentBatchId ?? t('없음 또는 알 수 없음', 'None or unknown')} · {t('상위 전사', 'Parent transcript')}: {batch.parentTranscriptVersionId ?? t('없음', 'None')}</span><span className="hint">{batch.attemptRunIds.length} {t('요청 기록 · 이전 청크를 상속한 경우 원래 응답의 모델과 사용량을 유지해요.', 'attempt records · inherited chunks retain their original response model and usage.')}</span></div>)}</details>}
    </SettingsDialog>}
    {resultView && resultView !== 'review' && resultView !== 'usage' && <ChunkTranscript controller={c} project={p} chunkId={resultView} onClose={() => setResultView(null)} onReview={() => setResultView('review')} />}
    {policyCredential && <CredentialForm key={policyCredential.id} initial={policyCredential} saved controller={c} onClose={() => setPolicyCredentialId(null)} onSaved={() => { setPolicyCredentialId(null); setStartConsent(''); setRetryConsent(''); }} />}
    {action && <SettingsDialog title={action.purpose === 'transcribe-selected' ? t('전체 전사', 'Transcribe all') : t('선택 청크 다시 전사', 'Re-transcribe selected chunks')} closeLabel={t('닫기', 'Close')} onClose={close} className="stt-chunk-dialog stt-request-dialog">{action.purpose === 'transcribe-selected' && <fieldset className="stack gap12"><legend>{t('전사 범위', 'Transcription scope')}</legend><label className="checkbox-line"><input type="radio" name="stt-scope" checked={requestScope === 'remaining'} disabled={!remainingIds.length || active} onChange={() => { setRequestScope('remaining'); setRetryConsent(''); }} /><span>{t('완료된 청크 건너뛰기', 'Skip completed chunks')} · {remainingIds.length}{t('개 전송', ' to send')}</span></label><label className="checkbox-line"><input type="radio" name="stt-scope" checked={requestScope === 'all'} disabled={active} onChange={() => { setRequestScope('all'); setRetryConsent(''); }} /><span>{t('전체 다시 전사', 'Re-transcribe every chunk')} · {allIds.length}{t('개 전송', ' to send')}</span></label><span className="hint">{t('실패·결과 불명·아직 전송하지 않은 청크도 선택한 범위에 포함해요. 완료된 청크를 다시 보내면 추가 요금이 발생할 수 있어요.', 'The selected scope includes failed, unknown and untouched chunks. Re-sending completed chunks can add charges.')}</span></fieldset>}<span>{action.chunkIds.length} {t('선택 청크를 다시 전송해요. 이전 원본·수정본·선택 전사·정리 노트는 유지돼요.', 'selected chunks will be sent again. Previous raw results, edits, selected transcript and notes are retained.')}</span>
      <section className="stt-selected-chunks" aria-label={t('선택 청크', 'Selected chunks')}>
        <strong>{t('선택 청크', 'Selected chunks')} · {action.chunkIds.length}{t('개', '')}</strong>
        <ul tabIndex={action.chunkIds.length > 4 ? 0 : undefined}>{action.chunkIds.map(id => {
          const chunk = p.preparedChunks.find(item => item.id === id);
          return <li key={id}>{chunk ? <><strong>#{chunk.index + 1}</strong><span className="mono">{formatTime(chunk.sourceStartMs)}–{formatTime(chunk.sourceEndMs)}</span></> : <span>{id}</span>}</li>;
        })}</ul>
      </section>
      {requestPolicyBlocked && <div className="warning stack gap12"><span>{t('선택한 모델은 현재 보관 정책으로 차단됐어요. 다른 모델을 선택하거나 정책을 검토한 뒤 새 요청으로 실행하세요.', 'The selected model is blocked by the current retention policy. Choose another model or review the policy before starting a new request.')}</span><button type="button" disabled={active} onClick={() => { close(); reviewPolicy(requestRegistration); }}>{t('보관 정책 검토', 'Review retention policy')}</button></div>}<label>{t('전사 모델', 'Transcription model')}<select value={requestModelId} disabled={active || !c.onSTTModel || !models.length} onChange={event => { const modelId = event.target.value; setRetryConsent(''); setRequest(current => current ? { ...current, modelId } : null); c.onSTTModel?.(modelId); }}><option value="">{t('호환 모델 선택 없음', 'No compatible model selected')}</option>{requestModelId && !models.some(m => m.id === requestModelId) && <option value={requestModelId} disabled>{originalBatch?.modelSnapshot?.name ?? requestModelId} · {t('사용 불가', 'Unavailable')}</option>}{models.map(m => <option key={m.id} value={m.id} disabled={!m.enabled}>{optionLabel(m)}</option>)}</select></label><details className="usage-stage-details"><summary>{t('상세 보기', 'Details')}</summary><dl className="facts"><dt>{t('실제 모델 ID', 'Actual model ID')}</dt><dd>{requestRegistration?.modelId??requestModelId}</dd><dt>{t('API 경로', 'API route')}</dt><dd>{requestRegistration?registrationEndpoint(requestRegistration):requestProvider === 'openrouter' ? 'OpenRouter · openrouter.ai/api/v1/audio/transcriptions' : 'Direct OpenAI · api.openai.com/v1/audio/transcriptions'}</dd><dt>{t('언어 힌트', 'Language hints')}</dt><dd>{(frozen?.languages ?? p.audioOptions.expectedLanguages).join(', ') || t('없음', 'None')}</dd><dt>{t('전사 기준', 'Transcript parent')}</dt><dd>{frozen?.parentTranscriptVersionId ?? p.selectedTranscriptVersionId ?? t('없음', 'None')}</dd></dl>{requestRegistration&&<RegisteredSTTFacts model={requestRegistration} project={requestProject} chunkIds={action.chunkIds} language={c.preferences.uiLanguage}/>} {!requestRegistration && requestProvider === 'openrouter' && requestRouterSelection && <RouterSTTFacts selection={requestRouterSelection} chunkIds={action.chunkIds} language={c.preferences.uiLanguage} />}</details>{originalBatch && !frozen && <span className="warning">{t('모델 또는 설정이 달라 새 요청 묶음을 만들어요. 이전 요청 묶음과 결과는 그대로 유지돼요.', 'A changed model or settings creates a new batch. Previous batches and results are preserved.')}</span>}{frozen && <span className="hint">{t('원래 요청 묶음의 모델·경로·언어로 다시 시도해요.', 'Retry uses the original batch model, route and languages.')} {frozen.createdAt}</span>}<span className="hint">{t('선택 음성과 언어 힌트가 제공사로 직접 전송되며 추가 요금이 발생할 수 있어요. 결과 불명 요청을 다시 시도하면 중복 비용이 발생할 수 있어요.', 'Selected audio and language hints go directly to the provider and may incur additional charges. Retrying unknown outcomes may cause duplicate charges.')}</span><label className="checkbox-line"><input type="checkbox" checked={consent} disabled={active} onChange={event => setRetryConsent(event.target.checked ? token : '')} /><span>{t('선택 청크 전송과 추가 비용 가능성을 확인했어요', 'I reviewed the selected transmission and possible additional charges')}</span></label><div className="actions align-end"><button onClick={close}>{t('취소', 'Cancel')}</button><button className="primary" disabled={!canRetry} onClick={() => { if (!canRetry || !callback) return; callback(p.id, action.chunkIds, { modelId: requestModelId, acknowledged: true, additionalChargeAcknowledged: true, consentToken: token, ...(action.batchId ? { batchId: action.batchId } : {}) }); close(); }}>{t('전사 실행', 'Transcribe')}</button></div>{requestKeyMissing && <span className="hint">{requestProvider === 'openrouter' ? t('설정에서 OpenRouter 키를 입력하세요.', 'Enter your OpenRouter key in Settings.') : t('설정에서 OpenAI 키를 입력하세요.', 'Enter your OpenAI key in Settings.')}</span>}{!requestModel?.enabled && <span className="hint">{t('원래 모델 경로를 모델 설정에서 활성화해야 해요.', 'Enable the original model route in Models settings.')}</span>}</SettingsDialog>}
  </div>;
}
