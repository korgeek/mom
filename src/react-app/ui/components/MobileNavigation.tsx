import { Ellipsis, History, Settings, Lock } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { AppScreen } from '../../App';

type Props = {
  language: 'ko' | 'en'; screen: AppScreen; navigationDisabled: boolean;
  settingsDisabled?: boolean;
  onNavigate?: (screen: 'history' | 'settings') => void; onLock?: () => void;
};

export default function MobileNavigation({ language, screen, navigationDisabled, settingsDisabled = navigationDisabled, onNavigate, onLock }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const t = (ko: string, en: string) => language === 'ko' ? ko : en;
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => { if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false); };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); setOpen(false); trigger.current?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  const navigate = (next: 'history' | 'settings') => {
    setOpen(false);
    if (next === screen) trigger.current?.focus();
    onNavigate?.(next);
  };
  return <div className="mobile-navigation" ref={root}>
    <button ref={trigger} type="button" className="mobile-navigation-trigger" aria-label={t('탐색 메뉴', 'Navigation menu')} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)}>
      <Ellipsis aria-hidden="true" />
    </button>
    {open && <nav id={panelId} className="mobile-navigation-panel" aria-label={t('빠른 탐색', 'Quick navigation')}>
      <button type="button" aria-current={screen === 'history' ? 'page' : undefined} disabled={navigationDisabled} onClick={() => navigate('history')}>
        <History aria-hidden="true" /><span>{t('처리 기록', 'History')}</span>
      </button>
      <button type="button" aria-current={screen === 'settings' ? 'page' : undefined} disabled={settingsDisabled} onClick={() => navigate('settings')}>
        <Settings aria-hidden="true" /><span>{t('설정', 'Settings')}</span>
      </button>
      <button type="button" disabled={!onLock} onClick={() => { setOpen(false); onLock?.(); }}>
        <Lock aria-hidden="true" /><span>{t('화면 잠금', 'Lock screen')}</span>
      </button>
    </nav>}
  </div>;
}
