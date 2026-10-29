import { useEffect, useRef, useState } from 'react';
import { MeetingIcon, type AppController } from '../../App';
import { defaultSelectionLists, exportSelectionLists, normalizeSelectionLists, parseSelectionLists, SELECTION_LIST_FILE_LIMIT, selectionListsPrompt, type SelectionLists } from '../../settings/lists';
import { copy, memoIcons } from '../copy';

type Edit = { kind: 'icons'; icon: string } | { kind: 'colors'; index: number | null; color: string } | { kind: 'languages'; index: number | null; code: string; name: string };
export default function SelectionListSettings({ controller: c }: { controller: AppController }) {
  const t = (ko: string, en: string) => copy(c.preferences.uiLanguage, ko, en);
  const lists = c.selectionLists ?? defaultSelectionLists;
  const availableIcons = Object.keys(memoIcons).filter(id => !lists.icons.includes(id));
  const iconName = (id: string) => t(memoIcons[id]?.ko ?? id, memoIcons[id]?.en ?? id);
  const [edit, setEdit] = useState<Edit | null>(null), [preview, setPreview] = useState<SelectionLists | null>(null);
  const [working, setWorking] = useState(false), [reading, setReading] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; text: string } | null>(null);
  const mounted = useRef(false), readRevision = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; readRevision.current++; }; }, []);
  const disabled = working || reading || !!c.busy || !c.onSaveSelectionLists || !c.selectionLists;
  const save = async (value: SelectionLists) => {
    if (disabled) return;
    let normalized: SelectionLists;
    try { normalized = normalizeSelectionLists(value); }
    catch { setFeedback({ error: true, text: t('형식·중복·목록 개수를 확인하세요. 각 목록은 1~64개예요.', 'Check the format, duplicates and list size. Each list needs 1–64 entries.') }); return; }
    setWorking(true); setFeedback(null);
    try {
      await c.onSaveSelectionLists!(normalized);
      if (mounted.current) { setEdit(null); setPreview(null); setFeedback({ error: false, text: t('목록을 암호화 저장했어요.', 'Lists saved with encryption.') }); }
    } catch { if (mounted.current) setFeedback({ error: true, text: t('저장하지 못했어요. 이전 목록은 유지돼요. 다시 저장하세요.', 'Could not save. Previous lists remain applied. Retry saving.') }); }
    finally { if (mounted.current) setWorking(false); }
  };
  const saveEdit = () => {
    if (!edit) return;
    if (edit.kind === 'colors') {
      const colors = [...lists.colors]; if (edit.index === null) colors.push(edit.color); else colors[edit.index] = edit.color;
      void save({ ...lists, colors });
    } else if (edit.kind === 'icons') {
      void save({ ...lists, icons: [...lists.icons, edit.icon] });
    } else {
      const languages = [...lists.languages], row = { code: edit.code, name: edit.name };
      if (edit.index === null) languages.push(row); else languages[edit.index] = row;
      void save({ ...lists, languages });
    }
  };
  const readFile = async (file: File) => {
    if (disabled) return;
    const revision = ++readRevision.current; setPreview(null); setFeedback(null);
    if (file.size > SELECTION_LIST_FILE_LIMIT) { setFeedback({ error: true, text: t('JSON 파일은 256 KiB 이하여야 해요.', 'The JSON file must be 256 KiB or smaller.') }); return; }
    setReading(true);
    try {
      const imported = parseSelectionLists(new Uint8Array(await file.arrayBuffer()), lists.icons);
      if (mounted.current && revision === readRevision.current) { setPreview(imported); setEdit(null); }
    } catch { if (mounted.current && revision === readRevision.current) setFeedback({ error: true, text: t('설정 파일을 읽을 수 없어요. 아이콘·색상·언어 JSON 형식과 값을 확인하세요.', 'Could not read the settings file. Check its icon/color/language JSON format and values.') }); }
    finally { if (mounted.current && revision === readRevision.current) setReading(false); }
  };
  const download = () => {
    let url: string | null = null; const anchor = document.createElement('a');
    setFeedback(null);
    try {
      url = URL.createObjectURL(new Blob([exportSelectionLists(lists)], { type: 'application/json;charset=utf-8' }));
      anchor.href = url; anchor.download = 'mom-appearance-settings.json'; document.body.append(anchor); anchor.click();
      setFeedback({ error: false, text: t('현재 적용 목록의 JSON 다운로드를 시작했어요.', 'Started downloading the currently applied lists as JSON.') });
    } catch { setFeedback({ error: true, text: t('JSON 다운로드를 시작하지 못했어요.', 'Could not start the JSON download.') }); }
    finally { anchor.remove(); if (url) { const released = url; setTimeout(() => URL.revokeObjectURL(released), 0); } }
  };
  const copyPrompt = async () => {
    setWorking(true); setFeedback(null);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(selectionListsPrompt(lists, c.preferences.uiLanguage));
      if (mounted.current) setFeedback({ error: false, text: t('현재 목록과 AI 수정 프롬프트를 복사했어요.', 'Current lists and AI editing prompt copied.') });
    } catch { if (mounted.current) setFeedback({ error: true, text: t('프롬프트를 복사하지 못했어요. 클립보드 사용 가능 여부를 확인하세요.', 'Could not copy the prompt. Check clipboard availability.') }); }
    finally { if (mounted.current) setWorking(false); }
  };
  return <div className="selection-list-settings stack gap18">
    <p className="hint">{t('각 음성 메모에서 고를 아이콘·색상·사용 언어를 관리해요. 기존 메모의 선택값은 유지돼요.', 'Manage the icon, color and spoken-language choices for each voice memo. Existing memo selections are preserved.')}</p>
    {feedback && <div className={feedback.error ? 'error' : 'notice'} role={feedback.error ? 'alert' : 'status'}>{feedback.text}</div>}
    {(working || reading) && <span role="status">{reading ? t('파일 읽는 중…', 'Reading file…') : t('처리 중…', 'Working…')}</span>}
    <section className="card stack gap14" aria-label={t('아이콘 목록', 'Icon list')}>
      <div className="row-between"><h2>{t('아이콘', 'Icons')}</h2><button disabled={disabled || !!preview} onClick={() => void save({ ...lists, icons: defaultSelectionLists.icons })}>{t('아이콘 기본값 복원', 'Reset icons')}</button></div><p className="hint">{t('준비된 아이콘 목록에서 추가하세요. 각 메모의 제목 앞에 표시할 아이콘은 음성 준비 화면에서 골라요.', 'Add from the built-in icon catalog. Choose the icon shown before each memo title on the audio preparation screen.')}</p>
      <div className="selection-icon-set">{lists.icons.map(id => <div className="stack" key={id}><MeetingIcon icon={id} color={lists.colors[0]} /><span>{iconName(id)}</span><button aria-label={`${t('아이콘 제외', 'Remove icon')} ${id}`} disabled={disabled || !!preview || lists.icons.length <= 1} onClick={() => void save({ ...lists, icons: lists.icons.filter(icon => icon !== id) })}>{t('제외', 'Remove')}</button></div>)}</div>
      <button className="align-start" disabled={disabled || !!preview || !availableIcons.length} onClick={() => { setFeedback(null); setEdit({ kind: 'icons', icon: availableIcons[0] }); }}>{t('아이콘 추가', 'Add icon')}</button>
    </section>
    <section className="card stack gap14" aria-label={t('색상 목록', 'Color list')}>
      <div className="row-between"><h2>{t('색상', 'Colors')}</h2><button disabled={disabled || !!preview} onClick={() => void save({ ...lists, colors: defaultSelectionLists.colors })}>{t('색상 기본값 복원', 'Reset colors')}</button></div>
      <p className="hint">{t('회사 색을 추가하면 음성 준비의 색상 선택지에 나타나요. 선택한 색은 메모 제목 앞 아이콘에 적용돼요.', 'Add your company colors to the preparation screen choices. The selected color applies to the memo title icon.')}</p>
      {lists.colors.map((color, index) => <div className="selection-list-row" key={color}><div className="actions"><span className="selection-color-swatch" style={{ background: color }} aria-hidden="true" /><MeetingIcon icon="mic" color={color} /><code>{color}</code></div><div className="actions"><button aria-label={`${t('색상 수정', 'Edit color')} ${color}`} disabled={disabled || !!preview} onClick={() => { setFeedback(null); setEdit({ kind: 'colors', index, color }); }}>{t('수정', 'Edit')}</button><button aria-label={`${t('색상 삭제', 'Delete color')} ${color}`} disabled={disabled || !!preview || lists.colors.length <= 1} onClick={() => void save({ ...lists, colors: lists.colors.filter((_, i) => i !== index) })}>{t('삭제', 'Delete')}</button></div></div>)}
      <button className="align-start" disabled={disabled || !!preview || lists.colors.length >= 64} onClick={() => { setFeedback(null); setEdit({ kind: 'colors', index: null, color: '#000000' }); }}>{t('색상 추가', 'Add color')}</button>
    </section>
    <section className="card stack gap14" aria-label={t('사용 언어 목록', 'Spoken language list')}>
      <div className="row-between"><h2>{t('사용 언어', 'Spoken languages')}</h2><button disabled={disabled || !!preview} onClick={() => void save({ ...lists, languages: defaultSelectionLists.languages })}>{t('언어 기본값 복원', 'Reset languages')}</button></div>
      <p className="hint">{t('자주 쓰는 언어의 표시 이름과 코드를 등록하면 음성 준비에서 복수 선택할 수 있어요. 언어 등록은 제공사의 지원을 보증하지 않아요.', 'Register frequently used language names and codes to select them on the preparation screen. Registration does not guarantee provider support.')}</p><span className="field-label">{t('표시 이름 / 언어 코드', 'Display name / Language code')}</span>
      {lists.languages.map((row, index) => <div className="selection-list-row" key={row.code}><div className="stack"><strong>{row.name}</strong><code className="muted">{row.code}</code></div><div className="actions"><button aria-label={`${t('언어 수정', 'Edit language')} ${row.code}`} disabled={disabled || !!preview} onClick={() => { setFeedback(null); setEdit({ kind: 'languages', index, ...row }); }}>{t('수정', 'Edit')}</button><button aria-label={`${t('언어 삭제', 'Delete language')} ${row.code}`} disabled={disabled || !!preview || lists.languages.length <= 1} onClick={() => void save({ ...lists, languages: lists.languages.filter((_, i) => i !== index) })}>{t('삭제', 'Delete')}</button></div></div>)}
      <button className="align-start" disabled={disabled || !!preview || lists.languages.length >= 64} onClick={() => { setFeedback(null); setEdit({ kind: 'languages', index: null, code: '', name: '' }); }}>{t('언어 추가', 'Add language')}</button>
    </section>
    {edit && <form className="card stack gap14" aria-label={edit.kind === 'icons' ? t('아이콘 추가', 'Add icon') : edit.kind === 'colors' ? t('색상 편집', 'Edit color') : t('언어 편집', 'Edit language')} onSubmit={event => { event.preventDefault(); saveEdit(); }}>
      <h2>{edit.kind === 'icons' ? t('아이콘 추가', 'Add icon') : edit.kind === 'colors' ? t('색상 편집', 'Edit color') : t('언어 편집', 'Edit language')}</h2>
      {edit.kind === 'colors' ? <div className="selection-list-fields"><label>{t('색상 선택', 'Choose color')}<input type="color" value={/^#[0-9a-f]{6}$/i.test(edit.color) ? edit.color : '#000000'} disabled={disabled} onChange={event => setEdit({ ...edit, color: event.target.value })} /></label><label>{t('HEX 색상', 'HEX color')}<input autoFocus autoComplete="off" value={edit.color} disabled={disabled} onChange={event => setEdit({ ...edit, color: event.target.value })} placeholder="#3B82F6" /></label></div> : edit.kind === 'icons' ? <div className="actions"><MeetingIcon icon={edit.icon} color={lists.colors[0]} /><label>{t('추가할 아이콘', 'Icon to add')}<select aria-label={t('추가할 아이콘', 'Icon to add')} autoFocus value={edit.icon} disabled={disabled} onChange={event => setEdit({ ...edit, icon: event.target.value })}>{availableIcons.map(id => <option key={id} value={id}>{iconName(id)}</option>)}</select></label></div> : <div className="selection-list-fields"><label>{t('언어 코드', 'Language code')}<input autoFocus autoComplete="off" value={edit.code} maxLength={64} disabled={disabled} onChange={event => setEdit({ ...edit, code: event.target.value })} placeholder="fr, sw, pt-BR" /></label><label>{t('표시 이름', 'Display name')}<input autoComplete="off" value={edit.name} disabled={disabled} onChange={event => setEdit({ ...edit, name: event.target.value })} /></label></div>}
      <span className="hint">{t('저장 전 입력은 임시 상태이며, 잠금 또는 화면을 나가면 반영되지 않아요.', 'Unsaved input is temporary and is not applied when you lock or leave this screen.')}</span><div className="actions"><button type="button" disabled={disabled} onClick={() => setEdit(null)}>{t('취소', 'Cancel')}</button><button type="submit" className="primary" disabled={disabled}>{t('저장', 'Save')}</button></div>
    </form>}
    <section className="card stack gap14" aria-label={t('목록 가져오기 · 내보내기', 'List import and export')}>
      <h2>{t('가져오기 · 내보내기', 'Import and export')}</h2><label>{t('설정 JSON 가져오기', 'Import settings JSON')}<input type="file" accept=".json,application/json" disabled={disabled} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void readFile(file); }} /></label>
      <div className="actions wrap"><button disabled={disabled} onClick={download}>{t('설정 JSON 내보내기', 'Export settings JSON')}</button><button disabled={disabled} onClick={() => void copyPrompt()}>{t('AI 수정 프롬프트 복사', 'Copy AI editing prompt')}</button></div>
      <span className="hint">{t('현재 적용된 아이콘·색상·사용 언어 목록만 내보내요. JSON과 복사한 프롬프트는 보관함 밖의 평문이에요. AI로 전송하려면 사용자가 원하는 도구에 직접 붙여넣으세요.', 'Only the applied icon, color and spoken-language lists are exported. JSON and copied prompts are plaintext outside the vault. Paste into your chosen tool yourself to send them to AI.')}</span>
      {preview && <div className="stack gap14 selection-import-preview" role="group" aria-label={t('가져오기 미리보기', 'Import preview')}><h3>{t('변경 전 · 후', 'Before and after')}</h3><div className="selection-list-fields"><div className="stack"><strong>{t('현재 목록', 'Current lists')}</strong><span>{lists.icons.map(iconName).join(', ')}</span><span>{lists.colors.join(', ')}</span><span>{lists.languages.map(row => `${row.code} · ${row.name}`).join(', ')}</span></div><div className="stack"><strong>{t('가져올 목록', 'Incoming lists')}</strong><span>{preview.icons.map(iconName).join(', ')}</span><span>{preview.colors.join(', ')}</span><span>{preview.languages.map(row => `${row.code} · ${row.name}`).join(', ')}</span></div></div><div className="actions wrap"><button disabled={disabled} onClick={() => { readRevision.current++; setPreview(null); }}>{t('가져오기 취소', 'Cancel import')}</button><button className="primary" disabled={disabled} onClick={() => void save(preview)}>{t('가져온 설정 적용', 'Apply imported settings')}</button></div></div>}
    </section>
  </div>;
}
