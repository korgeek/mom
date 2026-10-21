import { FileText } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { AppController } from '../App';
import { copy, formatBytes, formatTime } from './copy';
import { formatPreparationDiagnostic } from './preparation-diagnostic';

const known = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const canExposePreparation = (c: AppController) => c.session === 'unlocked' && c.screenAccess !== 'locked' && c.screenAccess !== 'verifying' && !!c.preparation;

export function PreparationDiagnosticControl({ controller: c }: { controller: AppController }) {
  const id = useId(), trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null), latest = useRef(c);
  latest.current = c;
  const [preview, setPreview] = useState<{ text: string; capturedAtMs: number } | null>(null), [copying, setCopying] = useState(false);
  const [feedback, setFeedback] = useState<'copied' | 'failed' | null>(null);
  const revealed = canExposePreparation(c);
  useEffect(() => { if (!revealed) { setPreview(null); setFeedback(null); } }, [revealed]);
  useEffect(() => { if (revealed && preview !== null) panel.current?.scrollIntoView?.({ block: 'nearest' }); }, [revealed, preview]);
  if (!revealed) return null;
  const t = (ko: string, en: string) => copy(c.preferences.uiLanguage, ko, en);
  const toggle = () => {
    const current = latest.current;
    if (!canExposePreparation(current)) return;
    setFeedback(null);
    const capturedAtMs = Date.now();
    setPreview(preview === null ? { text: formatPreparationDiagnostic(current.preparation!, capturedAtMs, document.visibilityState, import.meta.env.MOM_BUILD_REVISION), capturedAtMs } : null);
  };
  const copyPreview = async () => {
    if (!canExposePreparation(latest.current) || preview === null || copying) return;
    setCopying(true); setFeedback(null);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(preview.text);
      if (canExposePreparation(latest.current)) setFeedback('copied');
    } catch { if (canExposePreparation(latest.current)) setFeedback('failed'); }
    finally { setCopying(false); }
  };
  return <div className="preparation-diagnostics" onKeyDown={event => {
    if (event.key === 'Escape' && preview !== null) { event.stopPropagation(); setPreview(null); trigger.current?.focus(); }
  }}>
    <button ref={trigger} type="button" className="plain icon-button preparation-diagnostics-trigger" aria-label={t('진단 정보 보기', 'Show preparation diagnostics')} title={t('진단 정보 보기', 'Show preparation diagnostics')} aria-expanded={preview !== null} aria-controls={id} onClick={toggle}>
      <FileText aria-hidden="true" />
    </button>
    {preview !== null && <div ref={panel} id={id} className="preparation-diagnostics-panel stack gap10" role="region" aria-label={t('진단 정보', 'Preparation diagnostics')}>
      <span className="hint"><span>{t('열었을 때의 진단 정보', 'Diagnostics when opened')}</span> · <time aria-label={t('캡처 시각', 'Captured at')} dateTime={new Date(preview.capturedAtMs).toISOString()}>{new Date(preview.capturedAtMs).toLocaleTimeString(c.preferences.uiLanguage, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time></span>
      <span className="hint">{t('미리보기 그대로 복사해요. 자동 전송하지 않아요.', 'Copies this preview exactly. Nothing is sent automatically.')}</span>
      <pre tabIndex={0} aria-label={t('진단 정보 미리보기', 'Preparation diagnostic preview')}>{preview.text}</pre>
      <button type="button" className="align-start" disabled={copying} onClick={() => void copyPreview()}>{t('진단 정보 복사', 'Copy diagnostics')}</button>
      {feedback && <span className="hint" role={feedback === 'failed' ? 'alert' : 'status'}>{feedback === 'copied' ? t('진단 정보를 복사했어요.', 'Diagnostics copied.') : t('진단 정보를 복사하지 못했어요. 클립보드 사용 가능 여부를 확인하세요.', 'Could not copy diagnostics. Check clipboard availability.')}</span>}
    </div>}
  </div>;
}

export default function PreparationStatus({ controller: c }: { controller: AppController }) {
  const preparation = c.preparation;
  const revealed = canExposePreparation(c);
  const active = revealed && !!preparation && !['complete', 'failed', 'stopped'].includes(preparation.stage);
  const clockKnown = known(preparation?.startedAtMs) || known(preparation?.lastProgressAtMs);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active || !clockKnown) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const refresh = () => {
      clearInterval(timer);
      setNow(Date.now());
      if (!document.hidden) timer = setInterval(() => setNow(Date.now()), 1000);
    };
    refresh();
    document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [active, clockKnown, preparation?.startedAtMs]);
  if (!revealed || !preparation) return null;
  const t = (ko: string, en: string) => copy(c.preferences.uiLanguage, ko, en);
  const labels = {
    inspecting: ['이 브라우저에서 음성 파일 확인 중…', 'Inspecting audio file locally…'],
    reading: ['암호화된 원본 음성 읽는 중…', 'Reading encrypted source audio locally…'],
    decoding: ['원본 음성 디코딩 중…', 'Decoding source audio locally…'],
    preparing: ['로컬 음성 분할 · 압축 중…', 'Splitting & compressing audio locally…'],
    verifying: ['압축한 음성 청크 검증 중…', 'Verifying encoded audio chunk locally…'],
    saving: ['음성 청크 암호화 저장 중…', 'Saving encrypted audio chunk…'],
    complete: ['로컬 음성 준비 완료', 'Local audio preparation complete'],
    failed: ['로컬 음성 준비 실패 · 저장 완료분 유지', 'Local audio preparation failed · saved chunks retained'],
    stopped: ['로컬 음성 준비 중지 · 저장 완료분 유지', 'Local audio preparation stopped · saved chunks retained'],
  } as const;
  const label = labels[preparation.stage];
  const status = t(label[0], label[1]);
  const phaseLabels = { inspecting: ['검사한 음성 시간:', 'Inspection audio processed:'], reading: ['읽은 원본 음성 시간:', 'Source audio read:'],
    decoding: ['디코딩한 원본 시간:', 'Decoded source audio:'], verifying: ['검증한 청크 음성 시간:', 'Chunk audio verified:'] } as const;
  const phase = preparation.stage in phaseLabels ? phaseLabels[preparation.stage as keyof typeof phaseLabels] : null;
  const unknown = t('확인 중', 'Unknown');
  const time = (value: number | null | undefined) => known(value) ? formatTime(value) : unknown;
  const knownDuration = known(preparation.durationMs) && preparation.durationMs > 0;
  const displayTime = active ? now : known(preparation.lastProgressAtMs) ? preparation.lastProgressAtMs : now;
  const elapsed = known(preparation.startedAtMs) ? formatTime(Math.max(0, displayTime - preparation.startedAtMs)) : unknown;
  const eventAge = known(preparation.lastProgressAtMs) ? Math.max(0, now - preparation.lastProgressAtMs) : null;
  const lastProgress = eventAge === null ? unknown : active ? `${formatTime(eventAge)} ${t('전', 'ago')}`
    : new Date(preparation.lastProgressAtMs!).toLocaleTimeString(c.preferences.uiLanguage, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const returned = active && known(preparation.lastProgressAtMs) && known(preparation.lastForegroundAtMs) && preparation.lastProgressAtMs < preparation.lastForegroundAtMs;
  const stalled = active && eventAge !== null && eventAge >= 30000;
  const progressTime = phase ? preparation.phaseProcessedMs : preparation.sourceProcessedMs;
  const progressDuration = phase ? preparation.phaseDurationMs : preparation.durationMs;
  const determinate = known(progressTime) && known(progressDuration) && progressDuration > 0;
  return <div className="stack preparation-status" role="region" aria-label={t('로컬 음성 준비', 'Local audio preparation')}>
    <strong role="status">{status}</strong>
    <span className="hint">{t('처리 위치: 이 기기 · 외부 AI 요청 없음', 'Processing location: this device · no external AI requests')}</span>
    {phase && <span className="hint mono">{t(phase[0], phase[1])} {time(preparation.phaseProcessedMs)} / {time(preparation.phaseDurationMs)}</span>}
    <span className="hint mono">{t('분할·압축한 원본 시간:', 'Source time processed:')} {time(preparation.sourceProcessedMs)} / {knownDuration ? time(preparation.durationMs) : unknown}</span>
    {active && <progress aria-label={phase ? t(phase[0], phase[1]) : t('로컬 음성 처리 시간', 'Local source time processed')} max={known(progressDuration) && progressDuration > 0 ? progressDuration : undefined} value={determinate ? progressTime! : undefined} />}
    <div className="preparation-summary hint"><span>{t('암호화 저장된 음성 청크:', 'Encrypted audio chunks saved:')} {preparation.completed}{preparation.total === null ? ` · ${t('계획 청크 수 확인 중', 'Planned count unknown')}` : ` / ${t('계획', 'planned')} ${preparation.total}`}</span><span className="mono">{t('청크 용량:', 'Chunk size:')} {preparation.savedEncodedBytes == null ? t('확인 중', 'Unknown') : formatBytes(preparation.savedEncodedBytes)}</span></div>
    {known(preparation.savedThroughMs) && <span className="hint mono">{t('연속으로 저장된 원본 구간:', 'Contiguous source audio saved:')} {time(preparation.savedThroughMs)} / {knownDuration ? time(preparation.durationMs) : unknown}</span>}
    <div className="preparation-summary hint mono"><span>{t('경과시간:', 'Elapsed:')} {elapsed}</span><span>{t('마지막 실제 진행:', 'Last real progress:')} {lastProgress}</span></div>
    {returned && <span className="hint" role="status">{t('화면 복귀 후 새 처리 이벤트를 기다리고 있어요.', 'Waiting for a new processing event after returning to this page.')}</span>}
    {stalled && <span className="warning" role="status">{t('30초 이상 새 처리 정보가 없어요. 느리게 처리 중이거나 브라우저에서 일시 중단됐을 수 있으며, 작업이 멈췄다고 단정할 수는 없어요.', 'No new processing update for at least 30 seconds. Processing may be slow or paused by the browser; this does not confirm that work has stopped.')}</span>}
    {(returned || stalled) && <span className="hint">{t('기다리는 동안 MoM을 화면에 열어 두세요. 다른 앱 사용이나 화면 꺼짐으로 모바일 브라우저가 작업을 중단할 수 있어요. 백그라운드 완료는 보장되지 않아요.', 'Keep MoM in the foreground while waiting. Mobile browsers may suspend work when another app is open or the screen is off. Background completion is not guaranteed.')}</span>}
    {preparation.stage === 'stopped' && <span className="hint">{t('디코딩·압축을 처음부터 다시 계산해요. 저장된 청크는 유지돼요.', 'Decoding and compression restart from the beginning. Saved chunks are kept.')}</span>}
  </div>;
}
