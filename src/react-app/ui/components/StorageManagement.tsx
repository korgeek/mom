import { useEffect, useId, useRef, useState } from 'react';
import type { AppController } from '../../App';
import { copy } from '../copy';

export default function StorageManagement({ controller: c }: { controller: AppController }) {
  const t = (ko: string, en: string) => copy(c.preferences.uiLanguage, ko, en);
  const inventory = c.storageInventory, plan = c.audioDeletionPlan;
  const [acknowledgement, setAcknowledgement] = useState('');
  const heading = useId(), dialog = useRef<HTMLDivElement>(null), cancel = useRef<HTMLButtonElement>(null), confirm = useRef<HTMLButtonElement>(null), opener = useRef<HTMLElement | null>(null);
  const storageHeading = useRef<HTMLHeadingElement>(null), refresh = useRef<HTMLButtonElement>(null), pendingStatus = useRef<HTMLSpanElement>(null), ownsFocus = useRef(false);
  const unavailable = !!(c.busy || c.storageWorking || c.session !== 'unlocked');
  const project = c.projects.find(project => project.id === plan?.projectId);
  const size = (value: number | null) => value === null || !Number.isFinite(value) || value < 0 ? t('알 수 없음', 'Unknown') : value < 1024 ? `${value} B` : `${(value / (value >= 1048576 ? 1048576 : 1024)).toLocaleString(c.preferences.uiLanguage, { maximumFractionDigits: 1 })} ${value >= 1048576 ? 'MiB' : 'KiB'}`;
  const bytes = (value: number) => `${value.toLocaleString(c.preferences.uiLanguage)} B`;
  useEffect(() => {
    if (c.session !== 'unlocked') { ownsFocus.current = false; opener.current = null; return; }
    if (plan) { ownsFocus.current = true; cancel.current?.focus(); return; }
    if (!ownsFocus.current) return;
    // Confirm consumes the plan before cleanup settles. Keep a useful focus
    // target while its opener is disabled, then restore only an enabled target.
    if (c.storageWorking) { pendingStatus.current?.focus(); return; }
    if (c.busy) return;
    ownsFocus.current = false;
    const previous = opener.current; opener.current = null;
    if (previous?.isConnected && !previous.matches(':disabled')) previous.focus();
    else if (refresh.current?.isConnected && !refresh.current.disabled) refresh.current.focus();
    else storageHeading.current?.focus();
  }, [plan, c.busy, c.storageWorking, c.session]);
  const close = () => { if (!c.storageWorking) { setAcknowledgement(''); c.onCancelAudioDeletion?.(); } };
  return <section className="card stack gap16 storage-management" aria-labelledby={heading}>
    <div className="row-between wrap"><h2 ref={storageHeading} id={heading} tabIndex={-1}>{t('저장소 관리', 'Storage management')}</h2><button ref={refresh} type="button" disabled={unavailable || !c.onRefreshStorage} onClick={c.onRefreshStorage}>{t('저장소 새로 확인', 'Refresh storage')}</button></div>
    <span className="hint">{t('이 MoM 보관함의 음성 사본만 선택해서 삭제해요. 전사문과 정리 노트 버전은 유지돼요.', 'Selectively delete audio copies in this MoM vault. Transcript and notes versions remain.')}</span>
    {c.storageWorking && <span ref={pendingStatus} role="status" tabIndex={-1}>{t('작업을 중지하고 선택한 음성을 삭제하고 있어요. 완료 확인을 기다리세요.', 'Stopping work and deleting selected audio. Wait for confirmed completion.')}</span>}
    {c.storageError && <span role="alert">{c.storageError}</span>}{c.storageNotice && <span role="status">{c.storageNotice}</span>}
    {inventory ? <>
      <dl className="storage-summary"><div><dt>{t('원본 음성', 'Original audio')}</dt><dd>{size(inventory.sourceBytes)}</dd></div><div><dt>{t('전송용 음성 조각', 'Audio chunks for upload')}</dt><dd>{size(inventory.chunkBytes)}</dd></div><div><dt>{t('미완성 녹음', 'Incomplete recordings')}</dt><dd>{size(inventory.draftBytes)}</dd></div></dl>
      <details className="usage-stage-details"><summary>{t('저장소 자세히 보기', 'Storage details')}</summary><dl className="facts"><dt>{t('인코딩 원본', 'Encoded originals')}</dt><dd>{bytes(inventory.sourceBytes)}</dd><dt>{t('준비된 청크', 'Prepared chunks')}</dt><dd>{bytes(inventory.chunkBytes)}</dd><dt>{t('미완성 녹음', 'Incomplete recording drafts')}</dt><dd>{bytes(inventory.draftBytes)}</dd><dt>{t('암호문 페이로드', 'Ciphertext payload')}</dt><dd>{bytes(inventory.encryptedBytes)}</dd><dt>{t('음성 메모 페이로드', 'Voice memo payload')}</dt><dd>{bytes(inventory.projectBytes)}</dd><dt>{t('보관함 페이로드', 'Vault payload')}</dt><dd>{bytes(inventory.vaultBytes)}</dd><dt>{t('사이트 전체 추정치', 'Origin-wide estimate')}</dt><dd>{inventory.originUsage === null || inventory.originQuota === null ? t('알 수 없음', 'Unknown') : `${bytes(inventory.originUsage)} / ${bytes(inventory.originQuota)}`}</dd></dl><span className="hint">{t('페이로드 바이트는 정확한 암호문 크기이며 IndexedDB 내부 여유 공간·헤더·논스 오버헤드는 포함하지 않아요. 사이트 전체 추정치는 다른 저장소도 포함할 수 있어요. 물리적 디스크 공간 회수나 안전한 바이트 소거를 보장하지 않아요.', 'Payload bytes are exact ciphertext sizes and exclude IndexedDB overhead, header and nonce records. The origin-wide estimate may include other storage. Physical disk recovery and secure byte erasure are not guaranteed.')}</span></details>
      <div className="storage-meetings">{inventory.projects.map(item => { const meeting = c.projects.find(project => project.id === item.projectId); if (!meeting) return null;
        return <section key={item.projectId} className="storage-meeting" aria-label={`${t('음성 메모 저장소', 'Voice memo storage')}: ${meeting.title}`}><strong className="storage-meeting-title" title={meeting.title}>{meeting.title}</strong><dl className="storage-meeting-stats"><div><dt>{t('원본', 'Original')}</dt><dd>{item.retainedAudio.sourceIds.length} · {size(item.sourceBytes)}</dd></div><div><dt>{t('청크', 'Chunks')}</dt><dd>{item.retainedAudio.chunkIds.length} · {size(item.chunkBytes)}</dd></div><div><dt>{t('미완성', 'Drafts')}</dt><dd>{item.draftIds.length} · {size(item.draftBytes)}</dd></div></dl><div className="actions storage-meeting-actions">{(['source', 'chunks'] as const).map(scope => <button key={scope} type="button" className="danger-outline" aria-label={scope === 'source' ? t('원본 음성 삭제', 'Delete original audio') : t('준비된 청크 삭제', 'Delete prepared chunks')} disabled={unavailable || !c.onPlanAudioDeletion || (scope === 'source' ? !item.sourceBytes && !item.draftIds.length : !item.chunkBytes)} onClick={event => { opener.current = event.currentTarget; setAcknowledgement(''); c.onPlanAudioDeletion?.(scope, item.projectId); }}>{scope === 'source' ? t('원본 삭제', 'Delete original') : t('청크 삭제', 'Delete chunks')}</button>)}</div></section>;
      })}</div>
      {!inventory.projects.length && <span>{t('저장된 음성 메모가 없어요.', 'No stored voice memos.')}</span>}
    </> : <span role="status">{t('저장소를 새로 확인하면 현재 크기와 남아 있는 음성을 표시해요.', 'Refresh storage to show current sizes and retained audio.')}</span>}
    <span className="hint">{t('원본 파일·내보낸 사본·제공사의 데이터 보관이나 비용은 바뀌지 않아요. 음성 메모 전체 삭제는 홈, 보관함 전체 삭제는 기존 초기화 확인에서만 해요.', 'Original files, exported copies, provider retention and charges are unaffected. Delete a whole voice memo from Home or the whole vault through its existing reset confirmation.')}</span>
    {plan && project && (plan.scope === 'source' || plan.scope === 'chunks') && <div className="modal-backdrop" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}><div ref={dialog} role="dialog" aria-modal="true" aria-labelledby={`${heading}-confirm`} className="modal-card stack gap16" onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (event.key === 'Enter' && event.target !== cancel.current && event.target !== confirm.current) event.preventDefault();
      if (event.key === 'Tab') { const controls = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)') ?? [])]; const first = controls[0], last = controls[controls.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }
    }}>
      <h2 id={`${heading}-confirm`}>{plan.scope === 'source' ? t('원본 음성을 삭제할까요?', 'Delete original audio?') : t('준비된 청크를 삭제할까요?', 'Delete prepared chunks?')}</h2><strong className="file-name">{project.title}</strong>
      <span>{plan.scope === 'source' ? t('이 음성 메모의 암호화된 원본과 이전 원본 세대, 아래 미완성 녹음 사본을 삭제해요. 저장된 청크는 유지돼요. 원본 미리듣기와 청크 재준비는 할 수 없고, 원본 바이트가 없어 파일 일치도 확인할 수 없어요. 다시 가져오려면 새 음성 메모를 만드세요.', 'Deletes this voice memo’s encrypted originals, historical original generations and the incomplete drafts listed below. Saved chunks remain. Source preview and re-preparation become unavailable; without original bytes, a reselected file cannot be verified. Create a new voice memo to import again.') : t('이 음성 메모의 준비된 음성 청크를 삭제해요. 암호화된 원본과 미완성 녹음은 유지돼요. 삭제한 청크·구간의 재생과 다시 전사는 할 수 없어요. 원본이 남아 있으면 음성 준비에서 새 청크로 다시 만들 수 있어요.', 'Deletes this voice memo’s prepared audio chunks. Encrypted originals and incomplete drafts remain. Deleted chunks/segments cannot be replayed or re-transcribed. If the original remains, Prepare audio can create new chunks.')}</span>
      {plan.scope === 'source' && <div className="stack"><strong>{t('함께 삭제할 미완성 녹음', 'Incomplete drafts included')}</strong>{plan.draftIds.length ? plan.draftIds.map(id => <span key={id} className="mono file-name">{id}</span>) : <span>{t('없음', 'None')}</span>}</div>}
      <span>{t('원본 STT 응답, 요청 묶음과 시간 매핑, 선택·수정한 전사문, 정리 노트, 사용량과 출처 기록은 그대로 유지돼요. 현재 재생과 작업은 중지돼요.', 'Raw STT responses, batches and time mappings, selected/edited transcripts, notes, usage and provenance remain. Current playback and work stop.')}</span>
      <span>{t('원본 파일, 내보낸 사본, 제공사 데이터 보관이나 비용에는 영향을 주지 않아요.', 'This does not affect original files, exported copies, provider retention or charges.')}</span>
      <label className="checkbox-line"><input type="checkbox" checked={acknowledgement === plan.versionToken} disabled={unavailable} onChange={event => setAcknowledgement(event.target.checked ? plan.versionToken : '')}/><span>{t('음성 삭제로 잃는 기능을 확인했어요', 'I understand the audio loss')}</span></label>
      <div className="actions"><button ref={cancel} type="button" disabled={!!c.storageWorking} onClick={close}>{t('취소', 'Cancel')}</button><button ref={confirm} type="button" className="danger" disabled={unavailable || !c.onConfirmAudioDeletion || acknowledgement !== plan.versionToken} onClick={() => { if (!unavailable && acknowledgement === plan.versionToken) c.onConfirmAudioDeletion?.(plan.versionToken); }}>{t('선택한 음성 삭제', 'Delete selected audio')}</button></div>
    </div></div>}
  </section>;
}
