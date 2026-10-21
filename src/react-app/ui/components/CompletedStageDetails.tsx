import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { copy } from '../copy';

export default function CompletedStageDetails({ stage, language, complete, initiallyCollapsed = false, forceOpen = false, summary, onCollapse, children }: {
  stage: 'preparation' | 'transcription'; language: 'ko' | 'en'; complete: boolean; initiallyCollapsed?: boolean;
  forceOpen?: boolean; summary: string; onCollapse?: () => void; children: ReactNode;
}) {
  const id = useId(), body = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(initiallyCollapsed && complete && !forceOpen);
  const [mobile, setMobile] = useState(() => globalThis.matchMedia?.('(max-width: 759px)').matches ?? true);
  if (collapsed && (!complete || forceOpen)) setCollapsed(false);
  useEffect(() => {
    const media = globalThis.matchMedia?.('(max-width: 759px)');
    if (!media) return;
    const resize = () => {
      if (media.matches && body.current?.contains(document.activeElement)) setCollapsed(false);
      setMobile(media.matches);
    };
    media.addEventListener('change', resize);
    return () => media.removeEventListener('change', resize);
  }, []);
  const closed = mobile && collapsed && complete && !forceOpen;
  const t = (ko: string, en: string) => copy(language, ko, en);
  const label = stage === 'preparation' ? t('음성 준비', 'preparation') : t('전사', 'transcription');
  return <div className="completed-stage">
    {complete && <div className="completed-stage-summary card">
      <div className="stack"><strong>{stage === 'preparation' ? t('음성 준비 완료', 'Audio preparation complete') : t('전사 완료', 'Transcription complete')}</strong><span className="hint">{summary}</span></div>
      <button aria-controls={id} aria-expanded={!closed} disabled={forceOpen} onClick={() => { if (!closed) onCollapse?.(); setCollapsed(!closed); }}>{closed ? t(`${label} 상세 펼치기`, `Show ${label} details`) : t(`${label} 상세 접기`, `Hide ${label} details`)}</button>
    </div>}
    <div ref={body} id={id} className="completed-stage-body" data-collapsed={closed}>{children}</div>
  </div>;
}
