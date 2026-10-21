import { useEffect, useRef, useState } from 'react';
import type { AppController } from '../../App';
import type { MeetingProject } from '../../domain/types';
import { copy } from '../copy';
import SettingsDialog from './SettingsDialog';
import './memo-deletion.css';

export default function MemoDeletion({ controller: c, project: p }: { controller: AppController; project: MeetingProject }) {
  const [open, setOpen] = useState(false), submitted = useRef(false);
  const t = (ko: string, en: string) => copy(c.preferences.uiLanguage, ko, en);
  const blocked = !c.onDeleteMeeting || !!(c.busy || c.storageWorking || c.recordingActive);
  useEffect(() => { if (!c.busy && c.error) submitted.current = false; }, [c.busy, c.error]);
  return <>
    <button type="button" className="danger-outline memo-delete-action" disabled={blocked} onClick={() => { submitted.current = false; setOpen(true); }}>{t('음성 메모 삭제', 'Delete voice memo')}</button>
    {open && <SettingsDialog title={t('음성 메모를 삭제할까요?', 'Delete this voice memo?')} closeLabel={t('취소', 'Cancel')} busy={!!(c.busy || c.storageWorking)} role="alertdialog" onClose={() => setOpen(false)}>
      <strong>{p.title}</strong>
      <p>{t('이 브라우저에서 이 메모의 원본 음성, 녹음 조각, 준비된 청크, 원본·편집 전사문, 정리 노트와 편집본, 요청·사용 기록을 모두 삭제해요. 되돌릴 수 없어요.', 'This deletes this memo’s original audio, recording fragments, prepared chunks, raw and edited transcripts, notes and edits, and request and usage history from this browser. This cannot be undone.')}</p>
      <p className="hint">{t('다른 음성 메모와 공용 API 키·모델 설정은 유지해요. 기기의 원본 파일, 내보낸 사본과 제공업체의 보관 데이터·요금은 삭제하지 않아요.', 'Other memos and shared API keys and model settings stay. Original files on your device, exported copies, and provider retention and charges are unaffected.')}</p>
      {c.error && <p className="error" role="alert">{c.error}</p>}
      {c.busy && <p role="status">{t('삭제 결과를 확인하고 있어요…', 'Waiting for confirmed deletion…')}</p>}
      <div className="actions"><button type="button" className="danger" disabled={blocked} onClick={() => { if (blocked || submitted.current) return; submitted.current = true; c.onDeleteMeeting?.(p.id); }}>{t('이 음성 메모 삭제', 'Delete this memo')}</button></div>
    </SettingsDialog>}
  </>;
}
