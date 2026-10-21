import { ArrowLeft, ArrowRight } from 'lucide-react';
import { copy } from './copy';
import { PAGE_SIZE } from '../usage/history';

export default function Pagination({ page, total, onChange, language }: { page: number; total: number; onChange: (page: number) => void; language: 'ko' | 'en' }) {
  const pages = Math.ceil(total / PAGE_SIZE); const t = (ko: string, en: string) => copy(language, ko, en);
  if (pages <= 1) return null;
  return <nav className="list-pagination" aria-label={t('목록 페이지', 'List pages')}>
    <span className="hint" aria-live="polite">{(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} / {total}</span>
    <div className="actions"><button aria-label={t('이전 페이지', 'Previous page')} disabled={page === 1} onClick={() => onChange(page - 1)}><ArrowLeft aria-hidden="true" /></button>
      <span className="mono">{page} / {pages}</span><button aria-label={t('다음 페이지', 'Next page')} disabled={page === pages} onClick={() => onChange(page + 1)}><ArrowRight aria-hidden="true" /></button></div>
  </nav>;
}
