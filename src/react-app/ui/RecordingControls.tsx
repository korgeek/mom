import { useId } from 'react';
import type { RecordingFailure, RecordingSnapshot, RecordingState } from '../recording/recorder';
import { copy, formatBytes } from './copy';
import './compact-work.css';

export type RecordingAction = 'start' | 'pause' | 'resume' | 'stop' | 'abort';
export type RecordingControlsProps = Readonly<{
  snapshot: RecordingSnapshot; language: 'ko' | 'en'; supported: boolean;
  startBlockedReason: 'project-not-empty' | 'busy' | 'interrupted-draft' | null;
  /** The owner supplies acknowledgment/drain state that the snapshot cannot express. */
  pendingAction: RecordingAction | null; interruptedCommittedBytes?: number | null;
  /** Start must create a fresh recorder owner; an aborted recorder is single-use. */
  onStart(): void; onPause(): void; onResume(): void; onStop(): void; onAbort(): void;
}>;

/** Controlled presentation only. Microphone, source writer and lifecycle ownership stay with the caller. */
export default function RecordingControls({ snapshot, language, supported, startBlockedReason, pendingAction, interruptedCommittedBytes, onStart, onPause, onResume, onStop, onAbort }: RecordingControlsProps) {
  const headingId = useId();
  const t = (ko: string, en: string) => copy(language, ko, en);
  const state = snapshot.state;
  const saved = state === 'saved' && snapshot.source !== null;
  const seconds = Math.floor(snapshot.durationMs / 1000);
  const duration = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(value => String(value).padStart(2, '0')).join(':');
  const megabytes = (bytes: number) => `${(bytes / 1024 ** 2).toFixed(2)} MB`;
  // Signal-relative dB scale keeps quiet input visible; it is not calibrated loudness.
  const level = state === 'recording' && snapshot.inputLevel > 0 ? Math.round(Math.max(0, Math.min(100, (20 * Math.log10(snapshot.inputLevel) + 60) / 60 * 100))) : 0;
  const capture = state === 'recording' || state === 'paused';
  const canStartState = state === 'idle' || state === 'aborted';
  const canAbortState = capture || state === 'permission' || state === 'saving' || state === 'error';
  const interruptedBytes = interruptedCommittedBytes ?? ((state === 'error' || state === 'aborted') && snapshot.committedBytes > 0 ? snapshot.committedBytes : null);
  const inactiveDraft = state === 'idle' && interruptedBytes !== null;
  const blocker = startBlockedReason === 'project-not-empty' ? t('기존 음성과 결과를 보존하려면 새 메모에서 녹음하세요.', 'Record in a new memo to keep existing audio and results.')
    : startBlockedReason === 'busy' ? t('진행 중인 작업을 마친 뒤 녹음을 시작하세요.', 'Finish the current operation before starting a recording.')
    : startBlockedReason === 'interrupted-draft' || interruptedBytes !== null ? t('중단된 녹음이 남아 있어요. 새 메모에서 녹음하세요.', 'This memo has an interrupted recording. Record in a new memo.') : null;
  const statuses: Record<RecordingState, string> = {
    idle: !supported ? t('녹음 사용 불가', 'Recording unavailable') : blocker ?? t('녹음 준비', 'Ready to record'), permission: t('마이크 권한을 기다리고 있어요', 'Waiting for microphone permission'),
    recording: t('녹음 중', 'Recording'), paused: t('녹음 일시정지', 'Recording paused'), saving: t('녹음을 암호화 저장 중…', 'Saving encrypted recording…'),
    saved: saved ? t('녹음 저장 완료', 'Recording saved') : t('녹음 저장을 확인할 수 없어요', 'Recording save could not be confirmed'),
    error: t('녹음이 중단됐어요', 'Recording stopped'), aborted: t('녹음을 취소했어요', 'Recording cancelled'),
  };
  const unsupported = t('이 브라우저에서는 마이크 녹음을 사용할 수 없어요. HTTPS에서 지원되는 브라우저를 사용하고 마이크 권한을 허용하세요.', 'Microphone capture is unavailable. Use a supported browser over HTTPS and allow microphone access.');
  const errors: Record<RecordingFailure, string> = {
    unsupported,
    permission: t('마이크 권한을 얻지 못했어요. 브라우저의 사이트 권한을 확인한 뒤 새 녹음을 시작하세요.', 'Microphone permission was not granted. Check the browser site permission before starting a new recording.'),
    'sample-rate': t('마이크의 오디오 형식을 지원하지 않아요. 다른 마이크나 지원되는 브라우저를 사용하세요.', 'This microphone audio format is unsupported. Try another microphone or a supported browser.'),
    backpressure: t('녹음 저장 속도가 입력을 따라가지 못해 중단했어요. 저장 공간과 기기 상태를 확인하세요.', 'Recording stopped because saving could not keep up with capture. Check available storage and the device.'),
    'invalid-pcm': t('마이크 오디오를 확인할 수 없어 녹음을 중단했어요. 저장 완료된 원본으로 사용하지 마세요.', 'Recording stopped because microphone audio could not be verified. Do not use it as a completed audio source.'),
    storage: t('암호화 저장을 완료하지 못했어요. 브라우저 저장 공간을 확인하세요. 저장 완료된 원본으로 표시하지 않아요.', 'Encrypted saving could not complete. Check browser storage. This recording is not a completed audio source.'),
    empty: t('녹음된 음성이 없어 저장하지 못했어요. 마이크 입력을 확인한 뒤 새 녹음을 시작하세요.', 'No audio was captured, so the recording could not be saved. Check the microphone before starting a new recording.'),
    busy: t('녹음 작업이 아직 진행 중이에요. 작업이 끝나기를 기다리거나 취소하세요.', 'A recording operation is still pending. Wait for it to finish or cancel the recording.'),
    'capture-ended': t('마이크 연결이나 오디오 처리가 중단됐어요. 입력 기기를 확인한 뒤 새 녹음을 시작하세요.', 'Microphone capture ended unexpectedly. Check the input device before starting a new recording.'),
    'size-limit': t('이 녹음의 저장 가능한 크기에 도달해 중단했어요. 더 짧은 새 녹음을 사용하세요.', 'Recording stopped at its supported size limit. Use a shorter new recording.'),
  };
  const error = !supported ? unsupported : snapshot.error ? errors[snapshot.error]
    : state === 'error' || (state === 'saved' && !saved) ? t('녹음 저장을 확인하지 못했어요. 완료된 원본으로 사용하지 말고 저장 공간을 확인하세요.', 'The saved recording could not be verified. Check storage and do not use it as a completed audio source.') : null;
  return <section className="card stack gap16" aria-labelledby={headingId}>
    <h2 id={headingId}>{t('마이크 녹음', 'Microphone recording')}</h2>
    <span className="hint">{t('기기의 마이크 소리만 녹음해요. 시작을 누르면 마이크 권한을 요청해요.', 'Capture uses the microphone only. Start requests microphone permission.')}</span>
    <span role="status" aria-live="polite" aria-atomic="true">{statuses[state]}</span>
    {error && <span role="alert">{error}</span>}
    <div className="actions recording-actions align-end">
      {capture && <button type="button" className="tall" disabled={pendingAction !== null} onClick={state === 'paused' ? onResume : onPause}>{state === 'paused' ? t('계속 녹음', 'Resume') : t('일시정지', 'Pause')}</button>}
      {canAbortState && <button type="button" className="tall recording-cancel" disabled={pendingAction === 'abort'} onClick={onAbort}>{t('녹음 취소', 'Cancel recording')}</button>}
      {(canStartState || state === 'permission') && <button type="button" className="primary tall" disabled={!canStartState || !supported || !!blocker || pendingAction !== null} onClick={onStart}>{t('녹음 시작', 'Start recording')}</button>}
      {capture && <button type="button" className="primary tall" disabled={pendingAction !== null && pendingAction !== 'pause' && pendingAction !== 'resume'} onClick={onStop}>{t('저장 후 종료', 'Save and stop')}</button>}
    </div>
    {inactiveDraft ? <span className="hint">{t('현재 진행 중인 녹음은 없어요.', 'No recording is running.')}</span> : <div className="recording-monitor">
      <dl className="recording-metrics">
        <div className="recording-clock"><dt>{t('녹음 길이', 'Recorded duration')}</dt><dd><span className="mono recording-duration" aria-label={t('녹음 길이', 'Recorded duration')}>{duration}</span></dd></div>
        <div><dt>{t('입력', 'Captured')}</dt><dd><span className="mono" aria-label={t('입력된 음성', 'Captured audio')}>{megabytes(saved ? snapshot.source!.bytes : snapshot.bodyBytes)}</span></dd></div>
        <div><dt>{t('암호화 저장', 'Encrypted saved')}</dt><dd><span className="mono" aria-label={t('암호화 저장된 음성', 'Encrypted saved audio')}>{megabytes(snapshot.committedBytes)}</span></dd></div>
      </dl>
      <div className="stack recording-level"><span className="field-label">{t('입력 음량', 'Input level')}</span><div className="recording-meter" role="meter" aria-label={t('입력 음량', 'Input level')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={level}><span style={{ width: `${level}%` }} /></div></div>
    </div>}
    {state === 'paused' && <span className="hint">{t('일시정지 중에도 마이크 연결은 유지돼요. 마이크 사용을 끝내려면 저장 후 종료하거나 녹음을 취소하세요.', 'While paused, the microphone tracks are still active. Save and stop or cancel to release the microphone.')}</span>}
    {interruptedBytes !== null && <div className="stack"><span className="hint">{t('중단된 녹음의 저장 완료분은 암호화된 조각으로 남아 있어요. 완성된 음성 원본이 아니며 자동으로 이어 녹음하지 않아요.', 'Interrupted committed audio remains encrypted. It is not a complete audio source and recording does not resume automatically.')}</span><span className="mono" aria-label={t('중단된 암호화 음성', 'Interrupted encrypted audio')}>{formatBytes(interruptedBytes)}</span></div>}
    {blocker && state !== 'idle' && <span className="hint">{blocker}</span>}
    {saved && <span className="file-name">{snapshot.source!.fileName}</span>}
  </section>;
}
