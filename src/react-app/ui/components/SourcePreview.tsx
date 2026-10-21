import { useEffect, useState, type RefObject } from 'react';
import { formatTime } from '../copy';
import './source-preview.css';

type Props = {
  url: string | null; peaks?: readonly number[] | null; durationMs: number;
  language: 'ko' | 'en'; loading?: boolean; error?: string | null;
  audioRef: RefObject<HTMLAudioElement | null>;
  onPlay?(audio: HTMLAudioElement): void;
  onRetry?(): void;
};
export default function SourcePreview({ url, peaks, durationMs, language, loading, error, audioRef, onPlay, onRetry }: Props) {
  const t = (ko: string, en: string) => language === 'ko' ? ko : en;
  const [time, setTime] = useState(0), [duration, setDuration] = useState(durationMs / 1000), [playing, setPlaying] = useState(false), [failed, setFailed] = useState(false);
  useEffect(() => {
    const audio = audioRef.current;
    if (audio && url) { audio.src = url; audio.load(); }
    return () => { audio?.pause(); if (audio) { audio.removeAttribute('src'); audio.load(); } };
  }, [url, audioRef]);
  const seek = (value: number) => {
    const audio = audioRef.current;
    if (!audio || !url || !Number.isFinite(value)) return;
    try { audio.currentTime = Math.max(0, Math.min(duration, value)); setTime(audio.currentTime); } catch { setFailed(true); }
  };
  const progress = duration > 0 ? Math.min(1, time / duration) : 0;
  const path = peaks?.map((peak, index) => `M${index + .5},${30 - peak * 28}v${Math.max(.6, peak * 56)}`).join(' ');
  return <div className="source-preview stack">
    {url && <audio ref={audioRef} preload="metadata" src={url} aria-label={t('원본 음성 미리듣기', 'Source audio preview')}
      onLoadedMetadata={event => { const value = event.currentTarget.duration; if (Number.isFinite(value) && value > 0) setDuration(value); }}
      onTimeUpdate={event => setTime(event.currentTarget.currentTime)}
      onPlay={event => { onPlay?.(event.currentTarget); setPlaying(!event.currentTarget.paused); }}
      onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onError={() => { setPlaying(false); setFailed(true); }} />}
    <div className="source-waveform">
      {path ? <svg viewBox="0 0 256 60" preserveAspectRatio="none" aria-hidden="true"><path d={path} /></svg> : <span className="hint">{loading ? t('음성과 파형을 여는 중…', 'Opening audio and waveform…') : t('파형을 사용할 수 없어요.', 'Waveform unavailable.')}</span>}
      {!!url && <span className="source-waveform-position" style={{ left: `${progress * 100}%` }} aria-hidden="true" />}
      <input type="range" min={0} max={duration} step={.1} value={Math.min(time, duration)} disabled={!url}
        aria-label={t('원본 음성 재생 위치', 'Source audio position')} aria-valuetext={`${formatTime(time * 1000)} / ${formatTime(duration * 1000)}`}
        onChange={event => seek(Number(event.target.value))} />
    </div>
    <div className="row-between"><button className="source-preview-toggle" disabled={!url} aria-label={playing ? t('원본 음성 일시정지', 'Pause source audio') : t('원본 음성 재생', 'Play source audio')} onClick={() => {
      const audio = audioRef.current; if (!audio || !url) return;
      if (!audio.paused) audio.pause();
      else { setFailed(false); void audio.play().catch(() => { setPlaying(false); setFailed(true); }); }
    }}>{playing ? t('일시정지', 'Pause') : t('재생', 'Play')}</button><span className="mono hint" aria-label={t('재생 시간', 'Playback time')}>{formatTime(time * 1000)} / {formatTime(duration * 1000)}</span></div>
    {(error || failed) && <span className="warning" role="status">{error || t('음성을 재생하지 못했어요. 다시 시도하세요.', 'Audio playback failed. Try again.')}</span>}
    {error && !loading && onRetry && <button className="align-start" onClick={onRetry}>{t('미리듣기 다시 열기', 'Retry audio preview')}</button>}
  </div>;
}
