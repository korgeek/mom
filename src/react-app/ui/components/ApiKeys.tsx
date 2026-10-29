import { Ellipsis } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { AppController } from '../../App';
import { validateApiCredential, type ApiCredential } from '../../providers/model-registrations';
import { copy } from '../copy';
import SettingsDialog from './SettingsDialog';

const origins = { openai: 'https://api.openai.com', openrouter: 'https://openrouter.ai' } as const;
const providerFor = (origin: string) => origin === origins.openai ? 'openai' : origin === origins.openrouter ? 'openrouter' : 'custom';
const providerLabel = (origin: string) => origin === origins.openai ? 'OpenAI' : origin === origins.openrouter ? 'OpenRouter' : origin;

export default function ApiKeys({ controller }: { controller: AppController }) {
  return controller.session === 'unlocked' ? <CredentialManager controller={controller} /> : null;
}

function CredentialManager({ controller: c }: { controller: AppController }) {
  const t = (ko: string, en: string) => copy(c.preferences.uiLanguage, ko, en);
  const checkStates = {
    missing: { label: t('키 필요', 'Key required'), tone: 'setup' },
    unchecked: { label: t('확인 전', 'Not checked'), tone: 'neutral' },
    checking: { label: t('확인 중', 'Checking'), tone: 'running' },
    verified: { label: t('인증 확인', 'Authenticated'), tone: 'success' },
    failed: { label: t('확인 실패', 'Check failed'), tone: 'failed' },
    unsupported: { label: t('확인 불가', 'Unavailable'), tone: 'setup' },
  };
  const [editing, setEditing] = useState<ApiCredential | null>(null), [deleting, setDeleting] = useState<ApiCredential | null>(null);
  const [working, setWorking] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const credentials = c.modelRegistrations?.credentials ?? [], busy = !!c.busy || working;
  function select(key: ApiCredential, action: 'edit' | 'delete') {
    setEditing(action === 'edit' ? key : null); setDeleting(action === 'delete' ? key : null); setError(''); setNotice('');
  }
  async function remove() {
    if (!deleting || !c.onDeleteApiCredential || busy) return;
    setWorking(true); setError('');
    try { await c.onDeleteApiCredential(deleting.id); setDeleting(null); setNotice(t('키를 삭제했어요.', 'API key deleted.')); }
    catch { setError(t('키를 삭제하지 못했어요. 기존 키와 연결은 유지돼요. 다시 시도하세요.', 'Could not delete the key. The existing key and links are retained. Try again.')); }
    finally { setWorking(false); }
  }
  return <section className="card api-keys stack gap16" aria-label={t('API 키 관리', 'API key management')}>
    <strong>{t('API 키', 'API keys')}</strong>
    {!!credentials.length && <ul className="api-key-list" aria-label={t('저장된 API 키', 'Saved API keys')}>
      {credentials.map(key => {
        const ready = c.credentialKeyReady?.includes(key.id), check = c.apiCredentialChecks?.[key.id];
        const status = checkStates[!ready ? 'missing' : check?.state ?? 'unchecked'];
        const chip = <span role="status" className={`model-status model-status--${status.tone}`}>{status.label}</span>;
        return <li className="api-key-row" key={key.id}><div className="stack"><strong>{key.name}</strong><span className="hint">{providerLabel(key.origin)}</span><div>{ready && check?.message ? <details><summary aria-label={`${status.label} ${t('상세 보기', 'details')}`}>{chip}</summary><p className="hint">{check.message}</p></details> : chip}</div><button type="button" className="align-start" disabled={busy||!c.onCheckApiCredential||!ready} onClick={()=>void c.onCheckApiCredential?.(key.id).catch(()=>{})}>{t('연결 확인','Check connection')}</button></div><details className="api-key-actions"><summary aria-label={t(`${key.name} 관리`, `Manage ${key.name}`)}><Ellipsis aria-hidden="true" /></summary><div className="stack">
        <button type="button" disabled={busy || !c.onSaveApiCredential} onClick={event => { const menu = event.currentTarget.closest('details'); menu?.removeAttribute('open'); menu?.querySelector('summary')?.focus(); select(key, 'edit'); }}>{t('키 수정', 'Edit key')}</button>
        <button type="button" disabled={busy || !c.onDeleteApiCredential} onClick={event => { const menu = event.currentTarget.closest('details'); menu?.removeAttribute('open'); menu?.querySelector('summary')?.focus(); select(key, 'delete'); }}>{t('키 삭제', 'Delete key')}</button>
      </div></details></li>})}
    </ul>}
    {!credentials.length && <span className="hint">{t('저장된 API 키가 없어요.', 'No saved API keys.')}</span>}
    <button type="button" disabled={busy || !c.onSaveApiCredential} onClick={() => select({ id: crypto.randomUUID(), name: '', origin: '', keyStorage: 'encrypted', version: 0 }, 'edit')}>{t('API 키 추가', 'Add API key')}</button>
    <span className="hint">{t('모델 없이 먼저 등록할 수 있어요. STT·LLM에서 함께 선택하며, 저장된 키 값은 다시 표시하지 않아요.', 'Register keys before models, then select them in STT or LLM. Saved key values are never shown again.')}</span>
    {editing && <CredentialForm key={editing.id} initial={editing} saved={credentials.some(key => key.id === editing.id)} controller={c} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setNotice(t('API 키를 저장했어요.', 'API key saved.')); }} />}
    {deleting && <section role="alertdialog" aria-label={t('API 키 삭제 확인', 'Confirm API key deletion')} className="warning stack gap12"><strong>{deleting.name}</strong><span>{t('보관함에서 이 키를 삭제해요. 모델과 기존 결과는 유지되며, 이 키를 쓰던 모델은 다시 키를 선택해야 해요. 제공사에서 키를 폐기하거나 이미 발생한 요금을 취소하지는 않아요.', 'Delete this key from the vault. Models and existing results are retained; models using this key will need another key. This does not revoke the key at the provider or undo charges.')}</span><div className="actions wrap"><button type="button" disabled={busy} onClick={() => setDeleting(null)}>{t('취소', 'Cancel')}</button><button type="button" className="danger" disabled={busy} onClick={() => void remove()}>{t('키 영구 삭제', 'Permanently delete key')}</button></div></section>}
    {error && <span role="alert" className="error">{error}</span>}{notice && <span role="status" className="hint">{notice}</span>}
  </section>;
}

export function CredentialForm({ initial, saved, controller: c, onClose, onSaved }: { initial: ApiCredential; saved: boolean; controller: AppController; onClose: () => void; onSaved: () => void }) {
  const t = (ko: string, en: string) => copy(c.preferences.uiLanguage, ko, en), input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(initial.name), [origin, setOrigin] = useState(initial.origin), [provider, setProvider] = useState(initial.origin ? providerFor(initial.origin) : '');
  const [mode, setMode] = useState(initial.keyStorage), [hasKey, setHasKey] = useState(false), [working, setWorking] = useState(false), [error, setError] = useState('');
  const [routerPolicy,setRouterPolicy]=useState(initial.routerPolicy??{requireZdr:true,acknowledged:false});
  useEffect(()=>{const field=input.current;return ()=>{if(field)field.value='';};},[]);
  const busy = !!c.busy || working;
  let valid: ApiCredential | null = null;
  const router=origin===origins.openrouter;
  try { valid = validateApiCredential({ ...initial, name, origin, keyStorage: mode,routerPolicy:router?routerPolicy:undefined }); } catch { /* The save hint identifies the missing field. */ }
  const policyReady=!router||routerPolicy.acknowledged;
  function destination(next: string) { setOrigin(next);setRouterPolicy({requireZdr:true,acknowledged:false}); if (input.current) input.current.value = ''; setHasKey(false); }
  async function save() {
    if (!valid || !policyReady || busy || !c.onSaveApiCredential || !saved && !hasKey) return;
    const raw = input.current?.value ?? ''; if (input.current) input.current.value = ''; setHasKey(false); setWorking(true); setError('');
    try { await c.onSaveApiCredential(valid, raw ? { action: 'replace', value: raw } : { action: 'keep' }); onSaved(); }
    catch { setError(t('키를 저장하지 못했어요. 기존 키는 유지돼요. 설정을 확인하고 새 키 값이 필요하면 다시 입력하세요.', 'Could not save the key. The existing key is retained. Check settings and re-enter a new key value if needed.')); }
    finally { setWorking(false); }
  }
  return <SettingsDialog className="api-key-dialog" title={saved?t('API 키 수정','Edit API key'):t('API 키 추가','Add API key')} closeLabel={t('닫기','Close')} busy={busy} onClose={onClose}>
    <fieldset disabled={busy} className="stack gap12">
      <label>{t('키 이름', 'Key name')}<input value={name} maxLength={512} autoComplete="off" onChange={event => setName(event.target.value)} /></label>
      <label>{t('제공사', 'Provider')}<select value={provider} disabled={saved} onChange={event => { const next = event.target.value; setProvider(next); destination(next === 'openai' || next === 'openrouter' ? origins[next] : ''); }}><option value="">{t('제공사 선택', 'Choose provider')}</option><option value="openai">OpenAI</option><option value="openrouter">OpenRouter</option><option value="custom">{t('기타 서버', 'Custom server')}</option></select></label>
      {provider === 'custom' && <label>{t('서버 주소', 'Server address')}<input value={origin} type="url" readOnly={saved} autoComplete="off" spellCheck={false} placeholder="https://api.example.com" onChange={event => destination(event.target.value)} /></label>}
      <label>{t('새 API 키', 'New API key')}<input ref={input} type="password" autoComplete="new-password" spellCheck={false} onChange={event => setHasKey(!!event.target.value.trim())} /></label>
      {router&&<section className="notice stack gap12"><strong>{t('OpenRouter 전송·보관','OpenRouter transmission & retention')}</strong><label>{t('OpenRouter 보관 정책','OpenRouter retention policy')}<select value={routerPolicy.requireZdr?'zdr':'standard'} onChange={e=>setRouterPolicy({requireZdr:e.target.value==='zdr',acknowledged:false})}><option value="zdr">{t('데이터 수집 거부 · ZDR 필수','Deny collection · require ZDR')}</option><option value="standard">{t('데이터 수집 거부 · 표준 보관 허용','Deny collection · allow standard retention')}</option></select></label><span className="hint">{t('적합한 경로가 없으면 실패하며 정책을 자동 완화하지 않아요. 처리 제공사와 총비용은 요청 전에 알 수 없을 수 있어요.','Fails if no eligible route exists; policy never relaxes automatically. Processor and total cost may be unknown before the request.')}</span><div className="actions wrap"><a href="https://openrouter.ai/docs/guides/privacy/data-collection" target="_blank" rel="noreferrer">{t('데이터 수집 정책','Data collection policy')}</a><a href="https://openrouter.ai/docs/guides/privacy/provider-logging" target="_blank" rel="noreferrer">{t('제공사 로그·보관 정책','Provider logging & retention')}</a></div><label className="checkbox-line"><input type="checkbox" checked={routerPolicy.acknowledged} onChange={e=>setRouterPolicy({...routerPolicy,acknowledged:e.target.checked})}/><span>{t('선택한 OpenRouter 전송·보관 정책을 확인했어요','I reviewed the selected OpenRouter transmission and retention policy')}</span></label></section>}
      <details><summary className="touch-summary">{t('보관 옵션', 'Storage options')}</summary><label>{t('키 저장 방식', 'Key storage')}<select value={mode} onChange={event => setMode(event.target.value as 'encrypted' | 'session')}><option value="encrypted">{t('암호화 저장 (기본)', 'Encrypted storage (default)')}</option><option value="session">{t('이 탭에서만 · 잠금 시 해제', 'This tab only · cleared on lock')}</option></select></label></details>
      <span className="hint">{saved ? t('새 API 키를 비우면 기존 값을 유지해요. 제공사와 서버 주소는 바꿀 수 없어요.', 'Leave New API key blank to keep the existing value. The provider and server address cannot be changed.') : t('제공사가 발급한 키를 입력하세요. 기본으로 이 브라우저에 암호화 저장하며, 저장만으로 서버에 요청하지 않아요.', 'Enter a provider-issued key. Keys are encrypted in this browser by default. Saving does not send a request to the server.')}</span>
      {saved && <span className="hint">{t('키 교체·보관 방식·전송 정책 변경은 이 키를 사용하는 모든 모델에 적용돼요. 기존 테스트와 전송 확인은 다시 필요해요.', 'Changes to the key, storage or transmission policy apply to every model using it. Tests and transmission consent must be reviewed again.')}</span>}
      {router && <span className="hint">{t('표준 보관을 허용하면 제공사가 음성을 보관할 수 있어요. 데이터 수집 거부는 유지해요. 앱에서 ZDR을 해제해도 OpenRouter 계정·가드레일에서 강제한 ZDR은 해제되지 않아요. 저장 후 전사 화면에서 전송을 다시 확인하세요.', 'Allowing standard retention can let the provider retain audio. Data collection remains denied. Turning off ZDR here cannot override ZDR enforced by your OpenRouter account or guardrails. After saving, review transmission again in Transcription.')} <a href="https://openrouter.ai/settings/privacy" target="_blank" rel="noreferrer">{t('OpenRouter 계정 보관 정책', 'OpenRouter account retention settings')}</a></span>}
      {!valid && <span className="hint">{!name.trim() ? t('키 이름을 입력하세요.', 'Enter a key name.') : !provider ? t('제공사를 선택하세요.', 'Choose a provider.') : t('서버 주소에 HTTPS 주소 또는 localhost·127.0.0.1의 HTTP 주소를 경로 없이 입력하세요.', 'Enter an HTTPS server address, or a localhost/127.0.0.1 HTTP address, without a path.')}</span>}
      <div className="actions wrap"><button type="button" onClick={() => { if (input.current) input.current.value = ''; onClose(); }}>{t('취소', 'Cancel')}</button><button type="button" className="primary" disabled={!valid || !policyReady || !saved && !hasKey || !c.onSaveApiCredential} onClick={() => void save()}>{t('키 저장', 'Save key')}</button></div>
    </fieldset>{error && <span role="alert" className="error">{error}</span>}
  </SettingsDialog>;
}
