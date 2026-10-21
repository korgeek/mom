import { ChevronUp, ChevronDown, ArrowRight } from 'lucide-react';
import SourcePreview from '../components/SourcePreview';
import RecordingControls from '../RecordingControls';
import PreparationStatus, { PreparationDiagnosticControl } from '../PreparationStatus';
import CompletedStageDetails from '../components/CompletedStageDetails';
import { useEffect, useEffectEvent, useId, useRef, useState } from 'react';
import { MeetingIcon, type ProjectScreenProps } from '../../App';
import type { AudioOptions } from '../../domain/types';
import { defaultSelectionLists } from '../../settings/lists';
import { copy, formatBytes, formatTime, memoIcons, preparedAudioReady, retainedSource, retainedChunks } from '../copy';
import '../mobile-metadata.css';
import { useSessionDraft } from '../useSessionDraft';
import '../compact-work.css';

export default function Import({ controller: c, project: p, initiallyCollapsed }: ProjectScreenProps) {
  const [advanced, setAdvanced] = useState(false); const [dragging, setDragging] = useState(false);
  const [appearanceExpanded, setAppearanceExpanded] = useState(false); const appearanceId = useId();
  // Let the media callback preserve focus before mobile CSS can hide desktop choices.
  const [appearanceMobile, setAppearanceMobile] = useState(() => window.matchMedia?.('(max-width: 759px)')?.matches ?? (window.innerWidth <= 759));
  const appearanceChoices = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const mobile = window.matchMedia?.('(max-width: 759px)');
    if (!mobile) return;
    const revealFocusedChoices = () => {
      if (mobile.matches && appearanceChoices.current?.contains(document.activeElement)) setAppearanceExpanded(true);
      setAppearanceMobile(mobile.matches);
    };
    mobile.addEventListener('change', revealFocusedChoices);
    return () => mobile.removeEventListener('change', revealFocusedChoices);
  }, []);
  const filePicker = useRef<HTMLInputElement>(null); const t = (ko: string, en: string) => copy(c.preferences.uiLanguage, ko, en);
  const sourcePlayer = useRef<HTMLAudioElement>(null);
  const options = p.audioOptions; const source = p.sourceAssets[0]; const ready = preparedAudioReady(p);
  const sourceAvailable = retainedSource(p);
  const loadPreview = useEffectEvent((id: string) => c.onLoadSourcePreview?.(id));
  const releasePreview = useEffectEvent((id: string) => c.onReleaseSourcePreview?.(id));
  const sourceId = source?.id;
  useEffect(() => {
    if (sourceAvailable && sourceId) loadPreview(p.id);
    return () => releasePreview(p.id);
  }, [p.id, sourceId, sourceAvailable]);
  const savedPreparationChunks = retainedChunks(p).filter(chunk => chunk.sourceId === source?.id);
  const recording = c.recording?.projectId === p.id ? c.recording : null;
  const metadataBody = useRef<HTMLDivElement>(null), metadataId = useId();
  const sourceInputBody = useRef<HTMLDivElement>(null), sourceDetailsBody = useRef<HTMLDivElement>(null);
  const sourceInputId = useId(), sourceDetailsId = useId();
  const [compact, setCompact] = useState(() => globalThis.matchMedia?.('(max-width: 1100px)').matches ?? false);
  const [metadataOpen, setMetadataOpen] = useSessionDraft(c, `recording-metadata-open:${p.id}`, false);
  const [sourceInputOpen, setSourceInputOpen] = useSessionDraft(c, `preparation-source-open:${p.id}:${source?.id ?? ''}`, false);
  const [metadataEditing, setMetadataEditing] = useState(false);
  const [sourceInputEditing, setSourceInputEditing] = useState(false);
  useEffect(() => {
    const media = globalThis.matchMedia?.('(max-width: 1100px)');
    if (!media) return;
    const resize = () => {
      if (media.matches && metadataBody.current?.contains(document.activeElement)) setMetadataOpen(true);
      if (media.matches && (sourceInputBody.current?.contains(document.activeElement) || sourceDetailsBody.current?.contains(document.activeElement))) setSourceInputOpen(true);
      setCompact(media.matches);
    };
    media.addEventListener('change', resize);
    return () => media.removeEventListener('change', resize);
  }, [setMetadataOpen, setSourceInputOpen]);
  const activeRecording = !!recording && ['permission', 'recording', 'paused', 'saving'].includes(recording.snapshot.state);
  const preparationWork = !!c.preparation || savedPreparationChunks.length > 0;
  const compactWork = activeRecording || preparationWork;
  const metadataClosed = compact && compactWork && !metadataOpen && !metadataEditing;
  const sourceInputCompact = compact && preparationWork && !!source && !activeRecording;
  const sourceInputClosed = sourceInputCompact && !sourceInputOpen && !sourceInputEditing;
  const sourceBlur = (event: { relatedTarget: EventTarget | null }) => setSourceInputEditing(event.relatedTarget instanceof Node && !!(sourceInputBody.current?.contains(event.relatedTarget) || sourceDetailsBody.current?.contains(event.relatedTarget)));
  useEffect(() => { if (sourceInputClosed) sourcePlayer.current?.pause(); }, [sourceInputClosed]);
  const [inputTab, setInputTab] = useState<'record' | 'upload'>(source || !recording || recording.snapshot.state === 'idle' ? 'upload' : 'record');
  const tabId = useId();
  const encodingLocked = p.rawTranscripts.length > 0;
  const hasPreparedWork = !!(p.preparedChunks.length || p.rawTranscripts.length || p.transcriptVersions.length || p.minutesRuns.length || p.minutesRevisions.length || p.runs.length);
  const encoding = ({ chunkMinutes, overlapSeconds, bitrateKbps, sampleRateHz }: Pick<AudioOptions, 'chunkMinutes' | 'overlapSeconds' | 'bitrateKbps' | 'sampleRateHz'>) => ({ chunkMinutes, overlapSeconds, bitrateKbps, sampleRateHz });
  const encodingIdentity = JSON.stringify([p.id, encoding(options)]);
  const [encodingDraft, setEncodingDraft] = useSessionDraft(c, JSON.stringify(['preparation-options', source?.id ?? null, encodingIdentity]), { identity: encodingIdentity, ...encoding(options) });
  if (encodingDraft.identity !== encodingIdentity) setEncodingDraft({ identity: encodingIdentity, ...encoding(options) });
  const draft = encodingDraft.identity === encodingIdentity ? encodingDraft : { identity: encodingIdentity, ...encoding(options) };
  const encodingDirty = JSON.stringify(encoding(draft)) !== JSON.stringify(encoding(options));
  const editingBlocked = !!(c.busy || c.storageWorking || c.recordingActive || c.chunkStates?.some(chunk => ['requesting', 'response-received', 'saving'].includes(chunk.state)));
  const canEditEncoding = !editingBlocked && !!(hasPreparedWork ? c.onPlanPreparationReset : c.onAudioOptions);
  const changeEncoding = (patch: Partial<ReturnType<typeof encoding>>) => setEncodingDraft({ ...draft, ...patch });
  const cancelDraft = () => setEncodingDraft({ identity: encodingIdentity, ...encoding(options) });
  const settings = useRef<HTMLDetailsElement>(null), settingsAnchor = useRef<HTMLElement>(null), resetDialog = useRef<HTMLDivElement>(null);
  const resetPlan = c.preparationResetPlan?.projectId === p.id ? c.preparationResetPlan : null;
  const resetTitle = useId();
  const resetToken = resetPlan?.versionToken;
  useEffect(() => {
    if (c.preparationEditor?.projectId !== p.id) return;
    if (settings.current) settings.current.open = true;
    settingsAnchor.current?.scrollIntoView?.({ block: 'start' });
    settingsAnchor.current?.focus();
  }, [c.preparationEditor?.projectId, c.preparationEditor?.requestId, p.id]);
  useEffect(() => {
    if (!resetToken) return;
    const lastFocus = document.activeElement as HTMLElement | null, anchor = settingsAnchor.current;
    resetDialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => { (lastFocus?.isConnected ? lastFocus : anchor)?.focus(); };
  }, [resetToken]);
  const cancelReset = () => { cancelDraft(); c.onCancelPreparationReset?.(); };
  const deletedChunkHistory = p.preparedChunks.some(chunk => !p.retainedAudio?.chunkIds.includes(chunk.id));
  const audioChange = (patch: Partial<typeof options>) => c.onAudioOptions?.(p.id, { ...options, ...patch });
  const lists = c.selectionLists ?? defaultSelectionLists;
  const icons = lists.icons.includes(p.icon) ? lists.icons : [...lists.icons, p.icon];
  const selectedIcon = memoIcons[p.icon] ?? { ko: p.icon, en: p.icon };
  const colors = lists.colors.includes(p.color) ? lists.colors : [...lists.colors, p.color];
  const selectedLanguages = [...lists.languages.map(({ code: id, name }) => ({ id, name })), ...options.expectedLanguages.filter(id => !lists.languages.some(row => row.code === id)).map(id => ({ id, name: id }))];
  const canPrepare = !!(sourceAvailable && c.onPrepareAudio && !editingBlocked && !ready && !encodingDirty);
  const acceptFile = (file?: File) => { if (file && (!source || sourceAvailable)) c.onPickFile?.(p.id, file); };
  return <><div className="import-grid" inert={!!resetPlan}>
    <section className="card preparation-metadata stack gap20" aria-label={t('메모 정보', 'Memo details')}>
      {compact && compactWork && <div className="compact-work-summary"><div className="stack"><strong>{p.title}</strong><span className="hint">{options.expectedLanguages.join(', ') || t('언어 힌트 없음', 'No language hints')}</span></div><button aria-label={metadataClosed ? t('메모 정보 펼치기', 'Show memo details') : t('메모 정보 접기', 'Hide memo details')} aria-expanded={!metadataClosed} aria-controls={metadataId} onClick={() => { if (!metadataClosed && metadataBody.current?.contains(document.activeElement)) return; setMetadataOpen(metadataClosed); }}>{metadataClosed ? t('펼치기', 'Show') : t('접기', 'Hide')}</button></div>}
      <div id={metadataId} ref={metadataBody} className="compact-work-body stack gap20" hidden={metadataClosed} inert={metadataClosed} onFocusCapture={() => setMetadataEditing(true)} onBlurCapture={event => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setMetadataEditing(false); }}>
      <h2>{t('메모 정보', 'Memo details')}</h2><label><span className="field-label">{t('메모 제목', 'Memo title')}</span><div className="title-input"><MeetingIcon icon={p.icon} color={p.color} /><input autoComplete="off" value={p.title} disabled={!c.onUpdateMeeting || (c.busy && !c.meetingEditsSaving)} onChange={event => c.onUpdateMeeting?.(p.id, { title: event.target.value })} /></div></label>
      <button type="button" className="metadata-appearance-toggle" disabled={c.busy} aria-expanded={appearanceExpanded} aria-controls={appearanceId} aria-label={`${t('아이콘 · 색상', 'Icon & color')} · ${t(selectedIcon.ko, selectedIcon.en)} · ${p.color}`} onClick={() => setAppearanceExpanded(!appearanceExpanded)}><MeetingIcon icon={p.icon} color={p.color} /><span className="metadata-appearance-label">{t('아이콘 · 색상', 'Icon & color')}</span><span className="metadata-color-preview" style={{ background: p.color }} aria-hidden="true" />{appearanceExpanded ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}</button>
      <div ref={appearanceChoices} id={appearanceId} className="metadata-appearance-options wrap gap24" data-collapsed={appearanceMobile && !appearanceExpanded}><div className="stack"><span className="field-label">{t('아이콘', 'Icon')}</span><div className="actions">{icons.map(id => { const icon = memoIcons[id] ?? { ko: id, en: id }; return <button key={id} className={`icon-button ${id === p.icon ? 'selected' : ''}`} aria-label={t(icon.ko, icon.en)} aria-pressed={p.icon === id} disabled={!c.onUpdateMeeting || c.busy} onClick={() => c.onUpdateMeeting?.(p.id, { icon: id })}><MeetingIcon icon={id} color={id === p.icon ? p.color : 'var(--ink3)'} /></button>; })}</div></div>
      <div className="stack"><span className="field-label">{t('색상', 'Color')}</span><div className="actions color-options">{colors.map(color => <button key={color} className={`color-option ${p.color === color ? 'selected' : ''}`} style={{ background: color }} aria-label={`${t('색상', 'Color')} ${color}`} aria-pressed={p.color === color} disabled={!c.onUpdateMeeting || c.busy} onClick={() => c.onUpdateMeeting?.(p.id, { color })} />)}</div></div></div>
      <div role="group" aria-label={t('사용 언어 · 복수 선택', 'Spoken languages · select multiple')} className="stack"><span className="field-label">{t('사용 언어 · 복수 선택', 'Spoken languages · select multiple')}</span><div className="actions">{selectedLanguages.map(({ id, name }) => { const index = options.expectedLanguages.indexOf(id); return <button key={id} className={`chip ${index >= 0 ? 'selected' : ''}`} aria-pressed={index >= 0} disabled={!c.onAudioOptions || c.busy} onClick={() => audioChange({ expectedLanguages: index >= 0 ? options.expectedLanguages.filter(code => code !== id) : [...options.expectedLanguages, id] })}>{index >= 0 ? `${index + 1} · ` : ''}{name}</button>; })}</div></div>
      <button className="plain accent-text align-start icon-label" aria-label={t('아이콘 · 색상 · 언어 관리 →', 'Manage icons, colors & languages →')} disabled={!c.onNavigate || !c.onSettingsTab || c.busy} onClick={() => { c.onSettingsTab?.('appearance'); c.onNavigate?.('settings', p.id); }}>{t('아이콘 · 색상 · 언어 관리', 'Manage icons, colors & languages')}<ArrowRight aria-hidden="true" /></button>
      <details className="hint usage-stage-details"><summary>{t('언어 안내', 'Language guidance')}</summary><span>{t('선택한 언어는 가능한 경우 힌트로 제공돼요. 다른 언어의 발화도 제외하지 않아요. 모델에 따라 힌트가 지원되지 않을 수 있어요.', 'Selected languages are provided as hints when possible. Speech in other languages is also retained. Some models may not support these hints.')}</span></details>
      </div>
    </section>
  <CompletedStageDetails stage="preparation" language={c.preferences.uiLanguage} complete={ready} initiallyCollapsed={initiallyCollapsed}
    forceOpen={!!(editingBlocked || encodingDirty || c.error || c.preparation?.stage === 'failed' || c.preparationEditor?.projectId === p.id || resetPlan)}
    summary={`${source ? formatTime(source.durationMs) : ''} · ${retainedChunks(p).length} ${t('청크 저장됨', 'chunks saved')} · ${formatBytes(retainedChunks(p).reduce((sum, chunk) => sum + chunk.encodedBytes, 0))}`}
    onCollapse={() => sourcePlayer.current?.pause()}>
  <div className="preparation-work stack gap16">
    <section className="card audio-input stack gap16" aria-label={t('음성 추가', 'Add audio')}>
      {sourceInputCompact && <div className="compact-work-summary"><div className="stack"><strong className="file-name">{source.fileName}</strong><span className="hint mono">{formatTime(source.durationMs)} · {formatBytes(source.bytes)}</span></div><button aria-label={sourceInputClosed ? t('음성 선택 펼치기', 'Show audio input') : t('음성 선택 접기', 'Hide audio input')} aria-expanded={!sourceInputClosed} aria-controls={`${sourceInputId} ${sourceDetailsId}`} onClick={() => setSourceInputOpen(sourceInputClosed)}>{sourceInputClosed ? t('펼치기', 'Show') : t('접기', 'Hide')}</button></div>}
      <div id={sourceInputId} ref={sourceInputBody} className="compact-work-body stack gap16" hidden={sourceInputClosed} inert={sourceInputClosed} onFocusCapture={() => setSourceInputEditing(true)} onBlurCapture={sourceBlur}>
      <h2>{t('음성 추가', 'Add audio')}</h2>
      <div className="segmented audio-input-tabs" role="tablist" aria-label={t('음성 입력 방식', 'Audio input method')} onKeyDown={event => {
        if (c.busy || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 'record' : event.key === 'End' ? 'upload' : inputTab === 'record' ? 'upload' : 'record';
        setInputTab(next); document.getElementById(`${tabId}-${next}-tab`)?.focus();
      }}>
        <button id={`${tabId}-record-tab`} role="tab" aria-selected={inputTab === 'record'} aria-controls={`${tabId}-record-panel`} tabIndex={inputTab === 'record' ? 0 : -1} className={inputTab === 'record' ? 'selected' : ''} disabled={c.busy} onClick={() => setInputTab('record')}>{t('마이크 녹음', 'Microphone recording')}</button>
        <button id={`${tabId}-upload-tab`} role="tab" aria-selected={inputTab === 'upload'} aria-controls={`${tabId}-upload-panel`} tabIndex={inputTab === 'upload' ? 0 : -1} className={inputTab === 'upload' ? 'selected' : ''} disabled={c.busy} onClick={() => setInputTab('upload')}>{t('파일 업로드', 'File upload')}</button>
      </div>
      <div id={`${tabId}-record-panel`} className="audio-input-panel" role="tabpanel" aria-labelledby={`${tabId}-record-tab`} hidden={inputTab !== 'record'}>
    {recording && (source && recording.snapshot.state === 'idle' ? <div className="audio-input-summary"><span className="hint">{t('새 녹음은 새 음성 메모에서 시작해요.', 'Start a new recording in a new voice memo.')}</span><button disabled={!c.onCreateMeeting || c.busy} onClick={c.onCreateMeeting}>{t('새 음성 메모 만들기', 'New voice memo')}</button></div> : <><RecordingControls {...recording} />{recording.startBlockedReason && recording.startBlockedReason !== 'busy' && <div className="actions align-end"><button disabled={!c.onCreateMeeting || c.busy} onClick={c.onCreateMeeting}>{t('새 음성 메모 만들기', 'New voice memo')}</button></div>}</>)}
      </div>
      <div id={`${tabId}-upload-panel`} className="audio-input-panel" role="tabpanel" aria-labelledby={`${tabId}-upload-tab`} hidden={inputTab !== 'upload'}>
        {!source ? <div className={`dropzone ${dragging ? 'dragging' : ''}`} onDragOver={event => { event.preventDefault(); if (c.onPickFile && !c.busy) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); if (!c.busy) acceptFile(event.dataTransfer.files[0]); }}>
      <strong>{t('음성 파일이 준비되지 않았어요', 'No audio file is ready yet')}</strong><span className="hint">{t('파일을 여기에 놓거나 직접 선택하세요.', 'Drop an audio file here or choose one.')}</span><details className="hint usage-stage-details"><summary>{t('지원 형식 보기', 'Supported formats')}</summary><span>{t('MP3 · PCM16 WAV · AAC-LC M4A — 모노·스테레오, 16/44.1/48 kHz. M4A는 브라우저의 AAC WebCodecs 지원이 필요해요. ALAC·HE-AAC·영상은 지원하지 않아요. 지원 여부는 실제 파일 검사로 확인해요.', 'MP3 · PCM16 WAV · AAC-LC M4A — mono/stereo, 16/44.1/48 kHz. M4A requires browser AAC WebCodecs support. ALAC, HE-AAC and video are not supported. Actual file inspection checks support.')}</span></details>
      <button className="primary" disabled={!c.onPickFile || c.busy} onClick={() => filePicker.current?.click()}>{t('파일 선택', 'Choose file')}</button>
    </div> : <div className="audio-input-summary"><div className="stack"><span className="file-name">{source.fileName}</span><span className="mono muted">{formatBytes(source.bytes)}</span></div><button disabled={!sourceAvailable || !c.onClearFile || c.busy || encodingLocked || deletedChunkHistory || p.minutesRuns.length > 0} onClick={() => c.onClearFile?.(p.id)}>{t('교체', 'Replace')}</button></div>}
      </div>
    <input ref={filePicker} className="visually-hidden" tabIndex={-1} aria-label={t('음성 파일 선택', 'Audio file')} type="file" accept="audio/mpeg,audio/wav,audio/x-wav,audio/mp4,.m4a,.wav,.mp3" disabled={!c.onPickFile || c.busy || !!source && !sourceAvailable} onChange={event => { acceptFile(event.target.files?.[0]); event.target.value = ''; }} />
      </div>
    </section>
    <section className="card preparation-actions stack gap16" aria-label={t('전사 준비', 'Prepare transcription')}>
      <h2>{t('전사 준비', 'Prepare transcription')}</h2>
      <div id={sourceDetailsId} ref={sourceDetailsBody} className="compact-work-body stack gap16" hidden={sourceInputClosed} inert={sourceInputClosed} onFocusCapture={() => setSourceInputEditing(true)} onBlurCapture={sourceBlur}>
      <div className="preparation-source stack"><span className="field-label">{t('현재 음성', 'Current audio')}</span>{source ? <div className="stack gap16"><div className="row-between wrap"><div className="stack"><strong className="file-name">{source.fileName}</strong><div className="chips mono"><span>{formatTime(source.durationMs)}</span><span>{formatBytes(source.bytes)}</span><span>{source.container} · {source.codec}</span></div></div></div>
      {!sourceAvailable && <span className="warning">{p.retainedAudio ? t('암호화된 원본이 삭제됐어요. 원본 바이트가 없어 다시 선택한 파일의 일치를 확인할 수 없어요. 새 음성 메모에서 다시 가져오세요.', 'The encrypted original was deleted. Without its bytes, a reselected file cannot be verified. Create a new voice memo to import again.') : t('보관된 원본의 실제 저장 여부를 아직 확인하지 못했어요.', 'Retained original availability has not been verified yet.')}</span>}
      {deletedChunkHistory && <span className="hint">{t('삭제된 청크의 기록은 유지돼요. 원본이 남아 있으면 현재 압축 설정으로 새 청크를 준비할 수 있어요. 원본을 교체하려면 새 음성 메모를 만드세요.', 'Deleted chunk history remains. If the original is retained, prepare fresh chunks with the current encoding settings. Create a new voice memo to replace the original.')}</span>}
      {sourceAvailable ? <SourcePreview key={`${source.id}:${c.sourcePreviewUrl ?? ''}`} audioRef={sourcePlayer} url={c.sourcePreviewUrl ?? null} peaks={c.sourceWaveform} durationMs={source.durationMs} language={c.preferences.uiLanguage} loading={c.sourcePreviewLoading} error={c.sourcePreviewError} onPlay={c.onSourcePreviewPlay} onRetry={c.onLoadSourcePreview ? () => c.onLoadSourcePreview?.(p.id) : undefined} /> : <span className="hint">{t('음성 미리듣기 준비 안 됨', 'Audio preview unavailable')}</span>}
    </div> : <span>{t('음성 선택 대기', 'Awaiting audio')}</span>}</div>
      <p className="hint">{t('음성 준비는 로컬 브라우저에서 진행돼요. 전사는 다음 단계에서 지정된 STT를 이용해서 실행해요.', 'Audio preparation runs in your local browser. Transcription runs in the next step using the selected STT.')}</p>
      </div>
      <PreparationStatus controller={c} />
      {ready && !c.preparation && <div className="stack preparation-status"><strong role="status">{t('로컬 음성 준비 완료', 'Local audio preparation complete')}</strong><div className="preparation-summary hint"><span>{retainedChunks(p).length} {t('청크 저장됨', 'chunks saved')}</span><span className="mono">{t('청크 용량:', 'Chunk size:')} {formatBytes(retainedChunks(p).reduce((bytes, chunk) => bytes + chunk.encodedBytes, 0))}</span></div></div>}
      {!ready && !c.preparation && savedPreparationChunks.length > 0 && <strong className="hint" role="status">{t('준비 미완료 · 저장된 청크', 'Preparation incomplete · saved audio chunks:')} {savedPreparationChunks.length}{t('개', '')}</strong>}
      {c.busy && c.preparation && <span className="hint">{t('취소해도 암호화 저장된 청크는 유지돼요. 취소가 끝난 뒤 다시 준비할 수 있어요.', 'Cancelling keeps encrypted saved chunks. Wait for cancellation to finish before preparing again.')}</span>}
      {!c.busy && (c.preparation?.stage === 'failed' || !c.preparation && !ready && savedPreparationChunks.length > 0) && <span className="hint">{t('디코딩·압축을 처음부터 다시 계산해요. 저장된 청크는 유지돼요.', 'Decoding and compression restart from the beginning. Saved chunks are kept.')}</span>}
      <div className="preparation-buttons actions">
        <button className={`${ready ? '' : 'primary '}tall`} disabled={!canPrepare} onClick={() => c.onPrepareAudio?.(p.id)}>{t('전사 준비', 'Prepare transcription')}</button>
        <button className={`${ready ? 'primary ' : ''}tall icon-label`} aria-label={t('전사하기 →', 'Transcribe →')} disabled={!ready || !c.onNavigate || c.busy} onClick={() => c.onNavigate?.('stt', p.id)}>{t('전사하기', 'Transcribe')}<ArrowRight aria-hidden="true" /></button>
        {c.busy && c.preparation && <button className="tall" disabled={!c.onCancelPreparation} onClick={c.onCancelPreparation}>{t('음성 준비 취소', 'Cancel preparation')}</button>}
        <PreparationDiagnosticControl controller={c} />
      </div>
    <details ref={settings} className="processing-settings"><summary ref={settingsAnchor} className="accordion" id="preparation-encoding-settings"><span className="stack"><strong>{t('청크·압축', 'Chunks & compression')}</strong><span className="hint">MP3 · {t('모노', 'mono')}</span><span className="mono muted">{options.chunkMinutes} {t('분', 'min')} · {options.overlapSeconds} {t('초 겹침', 's overlap')} · {options.bitrateKbps} kbps</span></span><span>{t('처리 설정 펼치기', 'Expand processing settings')}</span></summary>
       <div className="processing-options stack gap16"><div className="notice row-between"><span>{t('여기서 바꾼 값은 이 음성 메모에만 적용돼요.', 'Changes here apply to this voice memo only.')}</span><div className="actions"><button disabled={!canEditEncoding} onClick={() => changeEncoding(encoding(c.defaultAudioOptions))}>{t('기본값으로 되돌리기', 'Reset to defaults')}</button><button className="plain accent-text" disabled={!c.onNavigate || !c.onSettingsTab || c.busy} onClick={() => { c.onSettingsTab?.('defaults'); c.onNavigate?.('settings'); }}>{t('기본값 설정 →', 'Edit defaults →')}</button></div></div>
        <div className="wrap gap24"><div role="group" aria-label={t('청크 길이', 'Chunk length')} className="stack"><span className="field-label">{t('청크 길이', 'Chunk length')}</span><div className="segmented">{([5, 10, 15] as const).map(value => <button key={value} className={draft.chunkMinutes === value ? 'selected' : ''} aria-pressed={draft.chunkMinutes === value} disabled={!canEditEncoding} onClick={() => changeEncoding({ chunkMinutes: value })}>{value} {t('분', 'min')}</button>)}</div></div>
        <div role="group" aria-label={t('겹침', 'Overlap')} className="stack"><span className="field-label">{t('겹침', 'Overlap')}</span><div className="segmented">{([5, 10, 15] as const).map(value => <button key={value} className={draft.overlapSeconds === value ? 'selected' : ''} aria-pressed={draft.overlapSeconds === value} disabled={!canEditEncoding} onClick={() => changeEncoding({ overlapSeconds: value })}>{value} {t('초', 's')}</button>)}</div></div></div>
        {hasPreparedWork && <span className="hint">{t('청크·압축 변경을 적용하면 확인 후 기존 청크·전사·정리 노트를 초기화하고 다시 준비해요.', 'Applying chunk or compression changes requires confirmation to reset existing chunks, transcripts and notes, then prepare again.')}</span>}
        {hasPreparedWork && !sourceAvailable && <span className="warning">{t('보관된 원본 음성을 사용할 수 없어 초기화할 수 없어요. 새 음성 메모에서 원본 파일을 가져오세요.', 'The retained original is unavailable, so preparation cannot be reset. Import the original into a new voice memo.')}</span>}
        <span className="hint">{t('겹침 구간은 앞뒤 청크에 모두 들어가요. 표현이 다르거나 불확실한 발화는 전사 검토에서 확인하세요.', 'Overlap is present in both neighbouring chunks. Review differing or uncertain speech in the transcript.')}</span>
        <div className="stack"><strong>{t('자동 압축 · MP3 모노', 'Auto compression · MP3 mono')}</strong><span className="hint">{t('실제 인코딩 바이트와 선택 모델의 형식·용량 지원을 검사한 뒤 전송해요. 예상 용량만으로 업로드 가능 여부를 판단하지 않아요.', 'Actual encoded bytes and model format limits are checked before upload. Estimates do not prove eligibility.')}</span></div>
        <button className="plain align-start" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}>{advanced ? t('고급 설정 접기', 'Hide advanced') : t('고급 설정 ▸', 'Advanced ▸')}</button>
        {advanced && <div className="wrap gap24"><label>{t('비트레이트', 'Bitrate')}<select value={draft.bitrateKbps} disabled={!canEditEncoding} onChange={event => changeEncoding({ bitrateKbps: Number(event.target.value) })}>{[24, 32, 48].map(value => <option key={value} value={value}>{value} kbps</option>)}</select></label><label>{t('샘플레이트', 'Sample rate')}<select value={draft.sampleRateHz} disabled={!canEditEncoding} onChange={event => changeEncoding({ sampleRateHz: Number(event.target.value) })}><option value={16000}>16 kHz</option><option value={24000} disabled>24 kHz — {t('미검증', 'unverified')}</option></select></label><label>{t('채널', 'Channels')}<span>{t('모노 (고정)', 'Mono (fixed)')}</span></label></div>}
        {encodingDirty && <div className="actions"><button disabled={editingBlocked} onClick={cancelDraft}>{t('변경 취소', 'Cancel changes')}</button><button className="primary" disabled={!canEditEncoding || hasPreparedWork && !sourceAvailable} onClick={() => { const next = { ...options, ...encoding(draft) }; if (hasPreparedWork) { if (sourceAvailable) c.onPlanPreparationReset?.(p.id, next); } else c.onAudioOptions?.(p.id, next); }}>{t('변경 적용', 'Apply changes')}</button></div>}
      </div>
    </details>
    </section>
  </div></CompletedStageDetails></div>
    {resetPlan && <div className="modal-backdrop"><div ref={resetDialog} role="dialog" aria-modal="true" aria-labelledby={resetTitle} className="modal-card stack" onKeyDown={event => {
      if (event.key === 'Escape' && !editingBlocked) cancelReset();
      if (event.key === 'Tab') { const controls = [...(resetDialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]; const first = controls[0], last = controls[controls.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }
    }}><h2 id={resetTitle}>{t('청크와 결과를 초기화할까요?', 'Reset chunks & results?')}</h2>
      <p>{t('다음 항목을 영구 삭제해요. 이 작업은 되돌릴 수 없어요.', 'The following items are permanently deleted. This cannot be undone.')}</p>
      <ul><li>{t('기존 암호화된 청크 음성', 'Old encrypted chunk audio')} ({resetPlan.counts.chunks})</li><li>{t('원본·수정 전사', 'Raw and edited transcripts')} ({resetPlan.counts.transcriptVersions} {t('버전', 'versions')})</li><li>{t('생성·수정 정리 노트', 'Generated and edited notes')} ({resetPlan.counts.minutesRevisions} {t('버전', 'versions')})</li></ul>
      <p>{t('원본 음성과 메모 설정은 유지돼요. 호출·사용량 기록은 “초기화 전”으로 보관돼요.', 'Source audio and memo settings are retained. Call and usage records are kept as “before reset”.')}</p>
      <span className="mono">{resetPlan.audioOptions.chunkMinutes} {t('분', 'min')} · {resetPlan.audioOptions.overlapSeconds} {t('초 겹침', 's overlap')} · {resetPlan.audioOptions.bitrateKbps} kbps</span>
      <p>{t('원본 음성으로 청크를 다시 준비해요. 유료 전사는 자동으로 시작하지 않아요.', 'Fresh chunks are prepared from the original source. This does not start paid transcription.')}</p>
      {!sourceAvailable && <span className="warning">{t('보관된 원본 음성이 없어 초기화할 수 없어요. 새 음성 메모에서 원본 파일을 가져오세요.', 'The retained original is unavailable. Import the original into a new voice memo.')}</span>}
      <div className="actions align-end"><button disabled={editingBlocked || !c.onCancelPreparationReset} onClick={cancelReset}>{t('취소', 'Cancel')}</button><button className="danger" disabled={editingBlocked || !sourceAvailable || !c.onConfirmPreparationReset} onClick={() => c.onConfirmPreparationReset?.(resetPlan.versionToken)}>{t('초기화하고 다시 준비', 'Reset & prepare again')}</button></div>
    </div></div>}
  </>;
}
