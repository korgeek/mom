import { History, Pin, PinOff, Pencil, Trash2, Plus } from 'lucide-react';
import { useState } from 'react';
import type { AppController } from '../../App';
import { MeetingIcon } from '../../App';
import { copy, formatBytes, formatTime, savedChunkIds } from '../copy';
import type { MeetingProject } from '../../domain/types';
import Pagination from '../Pagination';
import { currentPage, PAGE_SIZE, newestFirst } from '../../usage/history';
import './history-listing.css';

function Row({ controller: c, project: p }: { controller: AppController; project: MeetingProject }) {
  const [renaming, setRenaming] = useState(false); const [name, setName] = useState(p.title); const [deleting, setDeleting] = useState(false);
  const t = (ko: string, en: string) => copy(c.preferences.uiLanguage, ko, en);
  const saved = savedChunkIds(p).size;
  const failedAttempts = p.runs.some(run => run.state === 'failed');
  const unknownAttempts = p.runs.some(run => run.state === 'outcome-unknown');
  // A linked saved raw result can resolve an earlier failure for this exact chunk.
  // Legacy and text requests have no such equivalence, so retain their review state.
  const savedTranscriptRuns = new Map<string, number>();
  p.runs.forEach((run, index) => {
    const chunkId = run.intent?.kind === 'stt' ? run.intent.chunkId : null;
    if (chunkId && run.state === 'saved' && run.checkpoint?.projectId === p.id && run.checkpoint.runId === run.id && p.rawTranscripts.some(raw => raw.runId === run.id && raw.chunkId === chunkId)) savedTranscriptRuns.set(chunkId, index);
  });
  const failing = p.runs.some((run, index) => (run.state === 'failed' || run.state === 'outcome-unknown') &&
    !(run.intent?.kind === 'stt' && run.intent.chunkId && (savedTranscriptRuns.get(run.intent.chunkId) ?? -1) > index));
  const running = p.runs.some(run => ['requesting', 'response-received', 'saving'].includes(run.state));
  const ready = p.minutesRevisions.some(revision => revision.id === p.selectedMinutesRevisionId);
  const status = ready ? { className: 'done', label: t('정리 노트 완료', 'Notes ready') }
    : running ? { className: 'running', label: t('처리 중', 'Processing') }
    : failing ? { className: 'failed', label: t('일부 실패 · 검토 필요', 'Partly failed · needs review') }
    : { className: 'idle', label: p.transcriptVersions.length ? t('전사 검토 중', 'Reviewing transcript') : t('처리 설정 대기', 'Awaiting setup') };
  const saveName = () => { if (name.trim()) c.onUpdateMeeting?.(p.id, { title: name.trim() }); else setName(p.title); setRenaming(false); };
  return <div className="meeting-row">
    <div className="meeting-identity"><MeetingIcon icon={p.icon} color={p.color} /><div>
      {renaming ? <input autoComplete="off" aria-label={t('메모 제목', 'Memo title')} autoFocus value={name} onChange={event => setName(event.target.value)} onBlur={saveName} onKeyDown={event => { if (event.key === 'Enter') saveName(); if (event.key === 'Escape') { setName(p.title); setRenaming(false); } }} /> : <strong>{p.title}</strong>}
      <span className="mono muted">{new Date(p.updatedAt).toLocaleDateString(c.preferences.uiLanguage === 'ko' ? 'ko-KR' : 'en-GB')} {p.sourceAssets[0] ? `· ${formatTime(p.sourceAssets[0].durationMs)} · ${formatBytes(p.sourceAssets[0].bytes)}` : ''}</span>
    </div></div>
    <div className="meeting-status"><span className={`badge ${status.className}`}>{status.label}</span>
      {ready && running && <span className="hint">{t('다른 요청을 처리 중이에요. 저장된 정리 노트는 계속 사용할 수 있어요.', 'Another request is processing; saved notes remain available.')}</span>}
      {failedAttempts && <span className="hint">{t('실패한 요청 기록이 이 음성 메모에 남아 있어요.', 'Failed attempts are retained in this voice memo.')}</span>}
      {unknownAttempts && <span className="hint">{t('이전 요청의 결과를 알 수 없으며 요금이 발생했을 수 있어요.', 'An earlier request has an unknown outcome and may have incurred a charge.')}</span>}
      {p.preparedChunks.length > 0 && <><div className="meter"><span style={{ width: `${Math.min(100, saved / p.preparedChunks.length * 100)}%` }} /></div><span className="hint">{saved} / {p.preparedChunks.length} {t('청크 저장', 'chunks saved')}</span></>}
    </div>
    <div className="actions"><button className="primary" aria-label={`${t('열기', 'Open')} ${p.title}`} disabled={!c.onNavigate} onClick={() => c.onNavigate?.(ready ? 'minutes' : p.transcriptVersions.length ? 'review' : running ? 'stt' : 'import', p.id)}>{t('열기', 'Open')}</button>
      <button className="icon-button home-history-action" aria-label={`${t('처리 기록', 'Processing history')} ${p.title}`} title={t('처리 기록', 'Processing history')} disabled={!c.onNavigate} onClick={() => c.onNavigate?.('history', p.id)}><History aria-hidden="true" /></button>
      <button className={`icon-button ${p.pinned ? 'selected' : ''}`} style={{ color: p.pinned ? 'var(--accent)' : 'var(--ink3)' }} aria-label={`${p.pinned ? t('고정 해제', 'Unpin') : t('고정', 'Pin')} ${p.title}`} aria-pressed={p.pinned} disabled={!c.onUpdateMeeting || c.busy} onClick={() => c.onUpdateMeeting?.(p.id, { pinned: !p.pinned })}>{p.pinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}</button>
      <button className="icon-button" aria-label={`${t('이름 변경', 'Rename')} ${p.title}`} disabled={!c.onUpdateMeeting || c.busy} onClick={() => { setName(p.title); setRenaming(true); }}><Pencil aria-hidden="true" /></button>
      <button className="icon-button danger-text" aria-label={`${t('삭제', 'Delete')} ${p.title}`} disabled={!c.onDeleteMeeting || c.busy} onClick={() => setDeleting(true)}><Trash2 aria-hidden="true" /></button>
    </div>
    {deleting && <div className="delete-confirm" role="group" aria-label={t('음성 메모 삭제 확인', 'Confirm voice memo deletion')}><span>{t('삭제하면 음성·청크·전사문·정리 노트가 이 브라우저에서 지워지고 되돌릴 수 없어요.', "Deleting removes the audio, chunks, transcript and notes from this browser. This can't be undone.")}</span><div className="actions"><button autoFocus onClick={() => setDeleting(false)}>{t('취소', 'Cancel')}</button><button className="danger" aria-label={`${t('삭제 확인', 'Confirm delete')} ${p.title}`} disabled={!c.onDeleteMeeting || c.busy} onClick={() => c.onDeleteMeeting?.(p.id)}>{t('삭제', 'Delete')}</button></div></div>}
  </div>;
}
export default function Home({ controller: c }: { controller: AppController }) {
  const t = (ko: string, en: string) => copy(c.preferences.uiLanguage, ko, en); const storage = c.storageEstimate;
  const [requestedPage, setPage] = useState(1); const page = currentPage(requestedPage, c.projects.length);
  const projects = newestFirst(c.projects, project => project.updatedAt);
  return <div className="stack gap20"><div className="row-between"><h1 tabIndex={-1}>{t('음성 메모', 'Voice memos')}</h1><button className="primary new-meeting icon-label" aria-label={t('+ 새 음성 메모', '+ New voice memo')} disabled={!c.onCreateMeeting || c.busy} onClick={c.onCreateMeeting}><Plus aria-hidden="true" />{t('새 음성 메모', 'New voice memo')}</button></div>
    <section className="card flush"><div className="card-heading row-between"><strong>{t('저장된 음성 메모', 'Saved voice memos')} {c.projects.length}{t('개', '')}</strong><span className="muted">{t('최근 수정 순', 'Recently updated')}</span></div>
      {projects.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(p => <Row key={p.id} controller={c} project={p} />)}
      <Pagination page={page} total={projects.length} onChange={setPage} language={c.preferences.uiLanguage} />
      {!c.projects.length && <div className="empty">{t('저장된 음성 메모가 없어요. 새 음성 메모를 만들어 파일을 가져오세요.', 'No saved voice memos yet. Create a voice memo and import a file.')}</div>}
    </section>
    <section className="card storage-card"><div className="stack"><div className="row-between"><strong>{t('저장 공간', 'Storage')}</strong><span className="mono">{storage ? `${formatBytes(storage.usage)} / ~${formatBytes(storage.quota)}` : t('추정치 없음', 'Estimate unavailable')}</span></div><div className="meter thick"><span style={{ width: `${storage && storage.quota > 0 ? Math.min(100, storage.usage / storage.quota * 100) : 0}%` }} /></div><span className="hint">{t('한도와 사용량은 브라우저가 알려준 전체 출처 저장소의 추정치예요.', "Usage and quota are the browser's estimate for this origin.")}</span></div>
      <div className="storage-note"><strong>{t('이 브라우저에 보관', 'Stored in this browser')}</strong><span>{t('음성 메모 데이터와 암호화 저장을 선택한 API 키는 보관함에 저장돼요. 브라우저 데이터를 지우거나 다른 기기로 옮기면 보이지 않을 수 있어요. 완성한 정리 노트는 .md로 내려받아 두세요.', 'Voice memo data and keys set to encrypted storage are saved in the vault. Clearing browser data or changing devices can make them unavailable. Download finished notes as .md.')}</span></div>
    </section>
  </div>;
}
