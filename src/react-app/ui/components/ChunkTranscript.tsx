import ChunkPlayback from './ChunkPlayback';
import { useState } from 'react';
import type { ProjectScreenProps } from '../../App';
import { registrationEndpoint } from '../../providers/model-registrations';
import { copy, formatTime } from '../copy';
import SettingsDialog from './SettingsDialog';
import { selectedRawMap } from '../../transcript/batches';
import JsonResponse from './JsonResponse';

export default function ChunkTranscript({ controller: c, project: p, chunkId, onClose, onReview }: ProjectScreenProps & { chunkId: string; onClose: () => void; onReview: () => void }) {
  const t = (ko: string, en: string) => copy(c.preferences.uiLanguage, ko, en);
  const chunk = p.preparedChunks.find(item => item.id === chunkId);
  const results = p.rawTranscripts.filter(raw => raw.chunkId === chunkId);
  let used: string | undefined;
  try { used = selectedRawMap(p)[chunkId]; } catch { /* Invalid legacy selections remain unconfirmed. */ }
  const [rawId, setRawId] = useState(used ?? results[results.length - 1]?.id ?? '');
  const raw = results.find(item => item.id === rawId);
  const run = p.runs.find(item => item.id === raw?.runId);
  const batch = p.sttBatches?.find(item => item.attemptRunIds.includes(raw?.runId ?? ''));
  const modelName = (id: string) => {
    const attempt = p.runs.find(item => item.id === id), origin = p.sttBatches?.find(item => item.attemptRunIds.includes(id));
    const result = results.find(item => item.runId === id);
    return attempt?.intent?.modelSnapshot?.name ?? origin?.modelSnapshot?.name ?? attempt?.intent?.requestedModel ?? result?.execution?.requestedModel ?? t('모델 알 수 없음', 'Model unknown');
  };
  return <SettingsDialog title={t(`청크 #${chunk ? chunk.index + 1 : '?'} 전사 내용`, `Chunk #${chunk ? chunk.index + 1 : '?'} transcript`)} closeLabel={t('닫기', 'Close')} className="stt-chunk-dialog" onClose={onClose}>
    <span className="mono muted">{chunk ? `${formatTime(chunk.sourceStartMs)}–${formatTime(chunk.sourceEndMs)}` : t('범위 알 수 없음', 'Range unknown')} · {t('청크 원본 범위', 'Original chunk range')}</span>
    {chunk && <ChunkPlayback controller={c} project={p} chunkId={chunkId} index={chunk.index + 1} />}
    <label>{t('원본 결과', 'Original result')}<select value={rawId} onChange={event => setRawId(event.target.value)}>{results.map((item, index) => <option value={item.id} key={item.id}>{modelName(item.runId)} · {t('원본', 'Original')} {index + 1}{item.id === used ? t(' · 사용 중', ' · In use') : ''}</option>)}</select></label>
    <span className="hint">{t('청크별 원본 응답은 그대로 보존해요. 수정은 전체 전사에서 별도 버전으로 저장해요.', 'Original chunk responses are preserved. Edits are saved as separate versions in the full transcript review.')}</span>
    {raw && <><p className="transcript-text stt-original-text">{raw.text}</p><details className="usage-stage-details"><summary>{t('출처 · 원본 응답', 'Provenance · original response')}</summary><dl className="facts">
      <dt>{t('요청 모델', 'Requested model')}</dt><dd>{run?.intent?.requestedModel ?? raw.execution?.requestedModel ?? t('알 수 없음', 'Unknown')}</dd>
      <dt>{t('반환 모델', 'Returned model')}</dt><dd>{raw.execution?.returnedModel ?? t('알 수 없음', 'Unknown')}</dd>
      <dt>{t('실제 제공사', 'Actual provider')}</dt><dd>{raw.execution?.actualProvider ?? t('알 수 없음', 'Unknown')}</dd>
      <dt>{t('요청 경로', 'Requested route')}</dt><dd>{run?.intent?.requestedEndpoint ?? (batch?.modelSnapshot ? registrationEndpoint(batch.modelSnapshot) : batch?.route.provider ?? t('알 수 없음', 'Unknown'))}</dd>
      <dt>{t('저장 시각', 'Saved at')}</dt><dd>{run?.checkpoint?.committedAt ?? t('알 수 없음', 'Unknown')}</dd>
      <dt>{t('포함된 전사 버전', 'Transcript versions containing this original')}</dt><dd>{p.transcriptVersions.flatMap((version, index) => version.rawIds.includes(raw.id) ? [`${index + 1} · ${version.parentId ? t('수정본', 'Edited') : t('병합본', 'Merged')} (${version.id})`] : []).join(', ') || t('없음', 'None')}</dd>
      <dt>{t('요청 · 원본 ID', 'Run · raw ID')}</dt><dd>{raw.runId} · {raw.id}</dd>
      <dt>{t('묶음 · 원본 음성 ID', 'Batch · source audio ID')}</dt><dd>{batch?.id ?? t('알 수 없음', 'Unknown')} · {chunk?.sourceId ?? t('알 수 없음', 'Unknown')}</dd>
    </dl><JsonResponse key={raw.id} value={raw.response} language={c.preferences.uiLanguage} /></details></>}
    <span className="hint">{t('이 결과를 사용하면 새 전사 버전으로 반영해요. 기존 전사·수정본과 정리 노트는 유지하며 음성은 다시 전송하지 않아요. 청크 겹침은 정리 노트 생성 시 함께 정리해요.', 'Using this result creates a new selected transcript version without sending audio. Earlier transcripts, edits and notes stay. Chunk overlap is reconciled during notes generation.')}</span>
    {c.error && <span role="alert" className="error">{c.error}</span>}
    <div className="actions align-end"><button onClick={onReview}>{t('전체 전사에서 수정', 'Edit in full transcript')}</button><button className="primary" disabled={!raw || used === rawId || !!c.busy || !!c.storageWorking || !c.onSelectChunkTranscript} onClick={() => c.onSelectChunkTranscript?.(p.id, chunkId, rawId, p.selectedTranscriptVersionId)}>{used === rawId ? t('현재 사용 중', 'Currently in use') : t('이 결과 사용', 'Use this result')}</button></div>
  </SettingsDialog>;
}
