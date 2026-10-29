import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useState } from 'react';
import type { AppController } from '../../App';
import type { MeetingProject, RateSnapshot } from '../../domain/types';
import { asObject } from '../../domain/pipeline';
import type { UsageHistoryItem } from '../../usage/statement';
import { currentPage, PAGE_SIZE, newestFirst, projectHistory } from '../../usage/history';
import Pagination from '../Pagination';
import { copy, formatTime } from '../copy';
import './history-listing.css';

type Language = 'ko' | 'en';
const states = { queued: ['대기', 'Queued'], requesting: ['요청 준비·진행', 'Requesting'], 'response-received': ['응답 수신', 'Response received'], saving: ['저장 중', 'Saving'], saved: ['저장됨', 'Saved'], failed: ['실패', 'Failed'], cancelled: ['취소됨', 'Cancelled'], 'outcome-unknown': ['결과 불명', 'Outcome unknown'] } as const;
const count = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 8 });
const known = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
function Timestamp({ value, language }: { value: string | null; language: Language }) {
  return value && Number.isFinite(Date.parse(value)) ? <time dateTime={value}>{new Date(value).toLocaleString(language === 'ko' ? 'ko-KR' : 'en-GB')}</time> : null;
}
function Cost({ item, language }: { item: UsageHistoryItem; language: Language }) {
  const usage = item.usage;
  return usage && known(usage.cost) && usage.currency && usage.costKind !== 'unavailable'
    ? <span>{count(usage.cost)} {usage.currency} · {copy(language, usage.costKind === 'reported' ? '응답 보고값' : '추정값', usage.costKind === 'reported' ? 'Reported' : 'Estimated')}</span> : null;
}
function Rates({ snapshot, label, language }: { snapshot: RateSnapshot | null; label: string; language: Language }) {
  return snapshot && <div className="stack"><strong>{label}</strong><span>{snapshot.source} · {snapshot.checkedAt}</span>
    {snapshot.rates.map((rate, index) => <span key={index}>{rate.unit}: {count(rate.price)} {snapshot.currency} / {count(rate.units)} {copy(language, '단위', 'units')}</span>)}
  </div>;
}
function FailureDetails({ project, item, language }: { project: MeetingProject; item: UsageHistoryItem; language: Language }) {
  if (item.archivedAt || item.state !== 'failed' && item.state !== 'outcome-unknown') return null;
  const saved = project.failedProviderResponses?.find(failure => failure.runId === item.id);
  const body = asObject(saved?.response), error = asObject(body?.error) ?? body;
  const text = (value: unknown) => typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/\bsk-[a-zA-Z0-9_-]+|Bearer\s+\S+/gu, '[redacted]').slice(0, 2000) : null;
  const fields = [
    [copy(language, '앱 오류 분류', 'App failure code'), text(saved?.failureCode)],
    ...['code', 'type', 'param', 'message'].map(key => [`error.${key}`, text(error?.[key])]),
  ];
  return <section className="stack gap12" aria-label={copy(language, '오류 상세', 'Failure details')}>
    <strong>{copy(language, '오류 상세', 'Failure details')}</strong>
    <span>{copy(language, 'HTTP 상태', 'HTTP status')}: {saved?.status ?? copy(language, '기록 없음', 'Not recorded')}</span>
    {fields.filter(([, value]) => value !== null && value !== '').map(([label, value]) => <span key={label}>{label}: {value}</span>)}
    {!saved && <span className="hint">{copy(language, '이 요청에는 오류 상세가 저장되지 않았어요.', 'Failure details were not saved for this request.')}</span>}
  </section>;
}
function Call({ project, item, language }: { project: MeetingProject; item: UsageHistoryItem; language: Language }) {
  const t = (ko: string, en: string) => copy(language, ko, en);
  const archive = item.archivedAt ? project.processingArchives?.find(archive => archive.resetAt === item.archivedAt && archive.items.some(entry => entry.id === item.id)) : null;
  const chunk = (archive?.chunks ?? project.preparedChunks).find(chunk => chunk.id === item.chunkId);
  const dimensions = [
    ['inputTokens', '총 입력 토큰', 'Aggregate input tokens'], ['outputTokens', '총 출력 토큰', 'Aggregate output tokens'],
    ['audioInputTokens', '음성 입력 토큰', 'Audio input tokens'], ['textInputTokens', '텍스트 입력 토큰', 'Text input tokens'],
    ['audioOutputTokens', '음성 출력 토큰', 'Audio output tokens'], ['textOutputTokens', '텍스트 출력 토큰', 'Text output tokens'],
    ['durationSeconds', '응답 음성 길이 (초)', 'Returned audio duration (seconds)'], ['elapsedMs', '응답 실측 시간 (ms)', 'Measured response elapsed (ms)'],
  ] as const;
  const facts = [
    [t('요청 ID', 'Request ID'), item.id],
    [t('저장된 요청 기록', 'Durable request record'), item.recordedAttempt ? t('있음', 'Present') : null],
    [t('결과', 'Result'), item.archivedAt ? t('초기화로 삭제됨', 'Deleted by initialization') : item.hasResult ? t('보존됨', 'Preserved') : null],
    [t('요청 모델', 'Requested model'), item.model],
    [t('결과에 저장된 요청 모델', 'Request model stored with result'), item.executionRequestedModel !== item.model ? item.executionRequestedModel : null],
    [t('요청 어댑터 (저장된 의도에서 도출)', 'Requested adapter (from recorded intent)'), item.route === 'openai' ? 'Direct OpenAI' : item.route === 'openrouter' ? 'OpenRouter' : item.route === 'openai-compatible' ? t('OpenAI 호환 · 로컬', 'OpenAI-compatible / local') : null],
    [item.route === 'openai' ? t('직접 제공사', 'Direct provider') : t('카탈로그 네임스페이스', 'Catalog namespace'), item.publisher],
    [t('요청 실행 엔드포인트', 'Requested execution endpoint'), item.requestedEndpoint],
    [t('반환 모델', 'Returned model'), item.returnedModel],
    [t('응답에 보고된 실행 제공사', 'Reported execution provider'), item.actualProvider],
    [t('청크 연결', 'Chunk association'), item.chunkId],
  ];
  return <details role="group" aria-label={`${t('실행', 'Run')} ${item.id}`} className="history-call"><summary><span className="history-call-summary">
    {item.kind && <span className="badge idle">{item.kind === 'stt' ? 'STT' : 'LLM'}</span>}
    <strong>{item.modelName ?? item.model ?? t('요청 기록', 'Request record')}</strong>
    {item.state && <span className={`badge ${item.state === 'failed' ? 'failed' : item.state === 'saved' ? 'done' : 'idle'}`}>{item.archivedAt ? t('당시 ', 'Previously ') : ''}{states[item.state][language === 'ko' ? 0 : 1]}</span>}
    {chunk && <span className="hint">{t('청크', 'Chunk')} {chunk.index + 1} · {formatTime(chunk.sourceStartMs)}–{formatTime(chunk.sourceEndMs)}</span>}
    <Timestamp value={item.date} language={language} />
    {known(item.usage?.elapsedMs) && <span className="hint">{count(item.usage.elapsedMs / 1000)}s</span>}
    {known(item.usage?.inputTokens) && <span className="hint">{t('입력', 'In')} {count(item.usage.inputTokens)}</span>}
    {known(item.usage?.outputTokens) && <span className="hint">{t('출력', 'Out')} {count(item.usage.outputTokens)}</span>}
    <Cost item={item} language={language} />
    {item.archivedAt && <span className="history-archived">{t('초기화 이전 · 결과 삭제됨', 'Before initialization · results deleted')}</span>}
    {item.conflict && <span className="history-archived">{t('저장된 증거 상충', 'Conflicting saved evidence')}</span>}
  </span></summary><div className="history-call-facts stack gap12">
    {facts.filter(([, value]) => value).map(([label, value]) => <span key={label}>{label}: {value}</span>)}
    <FailureDetails project={project} item={item} language={language} />
    {item.archivedAt && <span>{t('초기화 시각', 'Initialization time')}: <Timestamp value={item.archivedAt} language={language} /></span>}
    {dimensions.map(([key, ko, en]) => known(item.usage?.[key]) && <span key={key}>{t(ko, en)}: {count(item.usage![key]!)}</span>)}
    <Rates snapshot={item.usage?.rateSnapshot ?? null} label={t('결과 요금 스냅샷', 'Result rate snapshot')} language={language} />
    {!item.usage?.rateSnapshot && (item.usage?.rateSource || item.usage?.rateCheckedAt) && <span>{t('요금 출처', 'Rate provenance')}: {[item.usage.rateSource, item.usage.rateCheckedAt].filter(Boolean).join(' · ')}</span>}
    <Rates snapshot={item.intentRateSnapshot} label={t('요청 의도 요금 스냅샷', 'Request intent rate snapshot')} language={language} />
    {(item.intentRateSnapshot || item.usage?.rateSnapshot || item.usage?.rateSource) && <span className="hint">{t('요금 출처는 실행 제공사의 증거가 아니에요.', 'Rate provenance does not establish the execution provider.')}</span>}
    {item.conflict && <span className="warning">{t('저장된 증거 상충 · 사용량과 비용 확인 불가', 'Conflicting saved evidence · usage and cost unavailable')}</span>}
  </div></details>;
}
function Detail({ controller: c, project }: { controller: AppController; project: MeetingProject }) {
  const language = c.preferences.uiLanguage; const t = (ko: string, en: string) => copy(language, ko, en);
  const [filter, setFilter] = useState<'all' | 'stt' | 'minutes'>('all'); const [requestedPage, setPage] = useState(1);
  const items = projectHistory(project).filter(item => filter === 'all' || item.kind === filter); const page = currentPage(requestedPage, items.length);
  return <><div className="row-between"><h2>{project.title}</h2><button disabled={!c.onNavigate} onClick={() => c.onNavigate?.('import', project.id)}>{t('음성 메모 열기', 'Open voice memo')}</button></div>
    <div className="history-filters" role="group" aria-label={t('처리 종류', 'Processing type')}>{(['all', 'stt', 'minutes'] as const).map(value => <button key={value} aria-pressed={filter === value} onClick={() => { setFilter(value); setPage(1); }}>{value === 'all' ? t('전체', 'All') : value === 'stt' ? 'STT' : 'LLM'}</button>)}</div>
    <section className="card flush" aria-label={t('실행별 처리 기록', 'Processing records by run')}>
      {!items.length && <div className="empty">{t('처리 기록이 없어요.', 'No processing records.')}</div>}
      {items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((item, index) => <Call key={`${item.archivedAt ?? 'current'}:${item.id}:${index}`} project={project} item={item} language={language} />)}
      <Pagination page={page} total={items.length} onChange={setPage} language={language} />
    </section>
    <p className="hint">{t('요청 기록은 제공사 수신·과금을 증명하지 않아요. 실패·취소·결과 불명에도 비용이 발생했을 수 있어요. 표시되지 않은 값과 최종 청구액은 확인되지 않았어요.', 'Request records do not prove provider receipt or billing. Failed, cancelled and unknown outcomes may incur charges. Omitted values and final billing are unverified.')}</p>
  </>;
}
export default function History({ controller: c }: { controller: AppController }) {
  const language = c.preferences.uiLanguage; const t = (ko: string, en: string) => copy(language, ko, en);
  const [requestedPage, setPage] = useState(1);
  const projects = newestFirst(c.projects.map(project => ({ project, items: projectHistory(project) })).filter(entry => entry.items.length), entry => entry.items[0]?.date ?? null);
  const page = currentPage(requestedPage, projects.length); const project = c.projects.find(project => project.id === c.historyProjectId);
  return <div className="stack gap18 history-screen"><div className="row-between"><h1 tabIndex={-1}>{t('처리 기록', 'Processing history')}</h1>
    {c.historyProjectId && <button disabled={!c.onNavigate} aria-label={t('처리 기록 목록으로', 'Back to processing history')} onClick={() => c.onNavigate?.('history')}><ArrowLeft aria-hidden="true" /> {t('목록', 'All memos')}</button>}</div>
    {c.historyProjectId ? project ? <Detail key={project.id} controller={c} project={project} /> : <div className="card empty">{t('음성 메모를 찾을 수 없어요.', 'Voice memo not found.')}</div> : <>
      <p className="hint">{t('처리한 음성 메모를 최근 처리 순으로 보여줘요. 메모를 열면 재시도와 초기화 이전 기록도 확인할 수 있어요.', 'Processed memos, ordered by latest processing time. Open a memo to see retries and records from before initialization.')}</p>
      <section className="card flush" aria-label={t('처리한 음성 메모', 'Processed voice memos')}>
        <div className="card-heading row-between"><strong>{t('음성 메모', 'Voice memos')} {projects.length}</strong><span className="muted">{t('최근 처리 순', 'Latest processing first')}</span></div>
        {!projects.length && <div className="empty">{t('아직 처리 기록이 없어요.', 'No processing records yet.')}</div>}
        {projects.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(({ project, items }) => <div key={project.id} className="history-memo"><div><h2>{project.title}</h2><div className="history-memo-facts hint">
          <Timestamp value={items[0]?.date ?? null} language={language} /><span>{items.length} {t('개 기록', 'records')}</span>
          {items.some(item => item.kind === 'stt') && <span className="badge idle">STT {items.filter(item => item.kind === 'stt' && item.recordedAttempt).length}</span>}{items.some(item => item.kind === 'minutes') && <span className="badge idle">LLM {items.filter(item => item.kind === 'minutes' && item.recordedAttempt).length}</span>}
          {items[0]?.archivedAt ? <span className="history-archived">{t('초기화 이전 · 결과 삭제됨', 'Before initialization · results deleted')}</span> : items[0]?.state && <span className={`badge ${items[0].state === 'failed' ? 'failed' : 'idle'}`}>{states[items[0].state][language === 'ko' ? 0 : 1]}</span>}
        </div></div><button aria-label={`${t('처리 기록', 'Processing history')} ${project.title}`} disabled={!c.onNavigate} onClick={() => c.onNavigate?.('history', project.id)}>{t('기록 보기', 'View records')} <ArrowRight aria-hidden="true" /></button></div>)}
        <Pagination page={page} total={projects.length} onChange={setPage} language={language} />
      </section>
    </>}
  </div>;
}
