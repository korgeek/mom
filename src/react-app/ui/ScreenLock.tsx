import { useEffect, useState, type ReactNode } from 'react';
import type { AppController } from '../App';
import { copy } from './copy';
import './screen-lock.css';

export function WorkPolicySettings({ controller: c }: { controller: AppController }) {
  const t = (ko: string, en: string) => copy(c.preferences.uiLanguage, ko, en);
  const selected = c.preferences.lockWorkPolicy ?? 'standard';
  return <section className="card stack">
    <strong>{t('잠금 중 작업 처리', 'Work while locked')}</strong>
    <div className="stack gap10">{(['standard', 'strict'] as const).map(policy => <button key={policy} className={selected === policy ? 'selected' : ''} aria-pressed={selected === policy} disabled={!c.onPreferences} onClick={() => c.onPreferences?.({ ...c.preferences, lockWorkPolicy: policy })}>{policy === 'standard' ? t('표준 · 작업 이어가기', 'Standard · keep work running') : t('엄격 · 잠글 때 작업 중지', 'Strict · stop work on lock')}</button>)}</div>
    <span className="hint">{selected === 'standard' ? t('잠겨도 시작한 녹음·전사·정리를 계속하고 결과를 저장해요.', 'Started recordings, transcription and notes keep running while locked; results are saved.') : t('잠그거나 다른 탭·앱으로 전환해 화면이 숨겨지면 작업을 중지해요. 자동 잠금 시간과 별개예요.', 'Work stops on lock or when another tab or app hides this page, independently of the inactivity timer.')}</span>
    <span className="hint">{t('변경은 다음 잠금·백그라운드 전환부터 적용돼요.', 'Changes apply at the next lock or hidden-page boundary.')}</span>
    <details className="stack work-policy-details"><summary>{t('작업과 데이터는 어떻게 되나요?', 'What happens to work and data?')}</summary>
      <div className="stack gap10 hint">
        <p>{t('두 모드 모두 같은 방식으로 암호화 저장해요. 표준은 처리에 필요한 키와 데이터를 탭 메모리에 유지하며, 잠긴 상태에서 마지막 작업 저장이 끝나면 키 참조를 해제해요.', 'Both modes use the same storage encryption. Standard retains runtime keys and data in tab memory, releasing key references once the final locked job is saved.')}</p>
        <p>{t('엄격은 저장 가능한 완료분을 보존해요. 녹음은 미완성 조각으로 남을 수 있어요. 전사 완료 청크와 저장된 정리는 유지돼요. 중단된 작업은 직접 다시 실행해야 하며, AI 요청에는 추가 비용이 생길 수 있어요.', 'Strict preserves savable completed work. Recording may remain as incomplete fragments; completed transcript chunks and saved notes are retained. Restart stopped work explicitly; AI retries may cost extra.')}</p>
        <p>{t('중단된 작업은 필요할 때 직접 다시 실행하세요. 운영체제가 백그라운드 탭이나 마이크를 중단하면 표준에서도 멈출 수 있어요. 새로고침·브라우저 종료 전에는 저장 완료를 확인하세요.', 'Restart stopped work explicitly when needed. The operating system can suspend background tabs or the microphone even in Standard. Check saving is complete before refreshing or closing the browser.')}</p>
      </div>
    </details>
  </section>;
}

export function HardLockAction({ controller: c }: { controller: AppController }) {
  const [confirm, setConfirm] = useState(false);
  const t = (ko: string, en: string) => copy(c.preferences.uiLanguage, ko, en);
  return <div className="stack gap10">
    <button className="danger-outline" disabled={!c.onHardLock} onClick={() => setConfirm(true)}>{t('작업 중단하고 완전히 잠그기', 'Stop work and fully lock')}</button>
    {confirm && <div className="warning stack" role="alert"><span>{t('녹음과 요청을 중단해요. 미완성 녹음은 완성 파일로 복구되지 않을 수 있고, 이미 전송된 요청에는 요금이 발생할 수 있어요. 완료된 작업은 암호화 저장해요.', 'This stops recording and requests. Unfinished recordings may not be recoverable as complete files, and dispatched requests may still incur charges. Completed work is saved encrypted.')}</span>
      <button className="danger-outline" onClick={c.onHardLock}>{t('작업 중단과 전체 잠금 확인', 'Confirm stopping work and full lock')}</button>
      <button onClick={() => setConfirm(false)}>{t('돌아가기', 'Go back')}</button></div>}
  </div>;
}

export function ScreenGate({ controller: c, children }: { controller: AppController; children?: ReactNode }) {
  const [secret, setSecret] = useState('');
  const t = (ko: string, en: string) => copy(c.preferences.uiLanguage, ko, en);
  const working = c.screenAccess === 'verifying' || c.session === 'locking' || c.session === 'unlocking';
  return <div className="vault-gate"><section className="vault-card" aria-labelledby="screen-lock-heading">
    <div className="brand-mark vault-mark" aria-hidden="true">M</div><strong className="centered">Minutes of Meeting</strong>
    <h1 id="screen-lock-heading">{t('화면이 잠겼어요', 'Screen locked')}</h1>
    <p>{c.session === 'locking' || c.session === 'unlocking' ? t('완료된 내용을 저장하거나 보관함을 여는 중입니다. 잠시 기다려 주세요.', 'Saving completed work or opening the vault. Please wait.') : c.session === 'unlocked' ? t('진행 중인 작업은 계속됩니다. 암호를 입력해 음성 메모로 돌아가세요.', 'Work in progress continues. Enter your passphrase to return to your voice memos.') : t('저장된 음성 메모가 준비되어 있습니다. 암호를 입력해 돌아가세요.', 'Your saved voice memos are ready. Enter your passphrase to return.')}</p>
    <form onSubmit={event => { event.preventDefault(); if (working || !secret || !c.onScreenUnlock) return; const value = secret; setSecret(''); c.onScreenUnlock(value); }}>
      <label>{t('암호', 'Passphrase')}<input autoFocus name="screen-passphrase" type="password" autoComplete="current-password" value={secret} disabled={working} onChange={event => setSecret(event.target.value)} /></label>
      {c.screenUnlockError && <span className="error" role="alert">{t('암호를 확인할 수 없어요. 다시 입력하세요.', 'The passphrase could not be verified. Try again.')}</span>}
      <button type="submit" className="primary" disabled={working || !secret || !c.onScreenUnlock}>{working ? t('처리 중…', 'Working…') : t('화면 잠금 해제', 'Unlock screen')}</button>
    </form>
    <details className="protection-details"><summary>{t('화면 잠금의 보호 범위', 'Screen lock protection')}</summary><p className="hint">{c.session === 'unlocked' ? t('작업 중에는 실행에 필요한 키와 데이터가 이 탭 메모리에 남아요. 화면 잠금은 메모리 접근을 막지 않아요. 모든 작업 저장 후 키 참조를 해제해요.', 'Keys and data needed for active work remain in this tab’s memory. Screen locking does not block memory access. Key references are released after all work is saved.') : t('완료된 내용과 화면 복원 정보는 암호화 저장하며, 전체 잠금이 끝나면 보관함 키 참조를 해제해요. 완전한 메모리 소거는 보장하지 않아요.', 'Completed work and screen state are saved encrypted. Full locking releases vault key references; complete memory zeroization is not guaranteed.')}</p></details>
    {c.session === 'unlocked' && <HardLockAction controller={c} />}
    {children}
  </section></div>;
}

export function AutoLockStatus({ controller: c }: { controller: AppController }) {
  const readRemaining = c.autoLockRemaining, seconds = c.preferences.autoLockSeconds;
  const [remaining, setRemaining] = useState(() => readRemaining?.() ?? null);
  useEffect(() => {
    const refresh = () => setRemaining(readRemaining?.() ?? null);
    let timer: ReturnType<typeof setInterval> | undefined;
    const sync = () => {
      clearInterval(timer); timer = undefined;
      if (document.visibilityState === 'hidden') return;
      refresh();
      if (readRemaining && seconds !== null) timer = setInterval(refresh, 1000);
    };
    sync(); document.addEventListener('visibilitychange', sync);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', sync); };
  }, [readRemaining, seconds]);
  if (!c.autoLockRemaining) return null;
  return <div className={`auto-lock-status${remaining !== null && remaining > 0 && remaining <= 10 ? ' auto-lock-status-warning' : ''}`} role="timer" aria-live="off" aria-label={copy(c.preferences.uiLanguage, '화면 자동 잠금까지 남은 시간', 'Time until screen lock')}>
    {remaining === null ? copy(c.preferences.uiLanguage, '화면 자동 잠금 사용 안 함', 'Automatic screen lock off') : copy(c.preferences.uiLanguage, `화면 잠금까지 ${remaining}초`, `Screen locks in ${remaining}s`)}
  </div>;
}
