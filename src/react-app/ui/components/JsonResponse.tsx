import { useState } from 'react';
import { copy } from '../copy';
import './json-response.css';

type Language = 'ko' | 'en';
type Container = Record<string, unknown> | unknown[];
const pageSize = 50;
const isContainer = (value: unknown): value is Container => value !== null && typeof value === 'object';

function Scalar({ value, language }: { value: unknown; language: Language }) {
  return <span className="json-response-value" data-type={value === null ? 'null' : typeof value}>{value === undefined ? copy(language, '미제공', 'Unavailable') : String(value)}</span>;
}

function Fields({ value, language, depth }: { value: Container; language: Language; depth: number }) {
  const [visible, setVisible] = useState(pageSize);
  const keys = Object.keys(value), more = Math.min(pageSize, keys.length - visible);
  if (!keys.length) return <span className="json-response-value">{Array.isArray(value) ? '[]' : '{}'}</span>;
  return <div className="json-response-fields">
    {keys.slice(0, visible).map(key => <Field key={key} label={Array.isArray(value) ? `[${key}]` : key} value={Array.isArray(value) ? value[Number(key)] : value[key]} language={language} depth={depth} />)}
    {more > 0 && <button className="json-response-more" onClick={() => setVisible(count => count + pageSize)}>{copy(language, `${more}개 더 보기`, `Show ${more} more`)}</button>}
  </div>;
}

function Field({ label, value, language, depth }: { label: string; value: unknown; language: Language; depth: number }) {
  const [open, setOpen] = useState(depth === 0 && label === 'usage');
  const container = isContainer(value), longText = typeof value === 'string' && value.length > 120;
  if (!container && !longText) return <dl className="json-response-row"><dt><code>{label}</code></dt><dd><Scalar value={value} language={language} /></dd></dl>;
  const kind = container ? Array.isArray(value) ? copy(language, '배열', 'Array') : copy(language, '객체', 'Object') : copy(language, '긴 문자열', 'Long string');
  const count = container ? Array.isArray(value) ? value.length : Object.keys(value).length : null;
  return <details className="json-response-node" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><code>{label}</code><span className="json-response-kind">{kind}{count !== null && ` · ${count.toLocaleString()}`}</span>
      {longText && !open && <span className="json-response-preview">{value.slice(0, 120)}…</span>}
    </summary>
    {open && (container ? <div className="json-response-children"><Fields value={value} language={language} depth={depth + 1} /></div> : <p className="json-response-long">{value as string}</p>)}
  </details>;
}

export default function JsonResponse({ value, language, title }: { value: unknown; language: Language; title?: string }) {
  const [showRaw, setShowRaw] = useState(false);
  const t = (ko: string, en: string) => copy(language, ko, en);
  const label = title ?? t('원본 응답', 'Original response');
  return <section className="json-response" aria-label={label}>
    <div className="json-response-header"><div><strong>{label}</strong><span className="hint">{t('읽기 전용', 'Read only')}</span></div>
      <button aria-pressed={showRaw} onClick={() => setShowRaw(raw => !raw)}>{showRaw ? t('구조로 돌아가기', 'Back to structured view') : t('원본 JSON 보기', 'View original JSON')}</button>
    </div>
    {showRaw ? <pre className="json-response-raw" tabIndex={0} aria-label={`${label} JSON`}>{JSON.stringify(value, null, 2) ?? t('미제공', 'Unavailable')}</pre> :
      <div className="json-response-data">{isContainer(value) ? <Fields value={value} language={language} depth={0} /> : <Scalar value={value} language={language} />}</div>}
  </section>;
}
