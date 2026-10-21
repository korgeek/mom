import { Pause, Play, Square } from 'lucide-react';

import type { ProjectScreenProps } from '../../App';
import { copy } from '../copy';

export default function ChunkPlayback({ controller: c, project: p, chunkId, index }: ProjectScreenProps & { chunkId: string; index: number }) {
  const t = (ko: string, en: string) => copy(c.preferences.uiLanguage, ko, en);
  const active = c.playback?.projectId === p.id && c.playback.chunkId === chunkId && c.playback.kind === 'chunk';
  const state = active ? c.playback!.state : null;
  const playing = state === 'playing', paused = state === 'paused', loading = state === 'loading';
  const label = playing ? t(`청크 ${index} 일시정지`, `Pause chunk ${index}`) : paused ? t(`청크 ${index} 이어서 재생`, `Resume chunk ${index}`) : t(`청크 ${index} 재생`, `Play chunk ${index}`);
  const action = playing ? c.onPauseChunk : paused ? c.onResumeChunk : c.onPlayChunk;
  const available = !!p.retainedAudio?.chunkIds.includes(chunkId);
  return <div className="chunk-playback stack">
    <div className="actions"><button className="icon-label" aria-label={label} aria-pressed={playing} aria-disabled={loading || undefined} disabled={!available || !!c.storageWorking || !action} onClick={() => { if (!loading) action?.(p.id, chunkId); }}>{playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}{playing ? t('일시정지', 'Pause') : paused ? t('이어서 재생', 'Resume') : t('재생', 'Play')}</button>
      <button className="icon-label" aria-label={t(`청크 ${index} 정지`, `Stop chunk ${index}`)} disabled={!active || !c.onStopPlayback} onClick={c.onStopPlayback}><Square aria-hidden="true" />{t('정지', 'Stop')}</button></div>
    <span className={`hint playback-status${available && !state ? ' visually-hidden' : ''}`} role="status" aria-label={t(`청크 ${index} 재생 상태`, `Chunk ${index} playback`)} aria-live="polite">{!available ? p.retainedAudio ? t('음성 삭제됨', 'Audio deleted') : t('음성 저장 여부 확인 안 됨', 'Audio availability unknown') : loading ? t('불러오는 중', 'Loading') : playing ? t('재생 중', 'Playing') : paused ? t('일시정지됨', 'Paused') : state === 'error' ? t('재생 실패 · 다시 시도하세요', 'Playback failed · try again') : t('정지됨', 'Stopped')}</span>
  </div>;
}
