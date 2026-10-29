import { ArrowRight } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { MeetingProject, RateSnapshot } from '../domain/types';
import { aggregateProjectUsage, type CostStatement, type DimensionSubtotal, type StageUsageStatement, type UsageDimension, type UsageHistoryItem } from '../usage/statement';
import { copy } from './copy';
import './compact-work.css';

type Language = 'ko' | 'en';
const labels: Record<UsageDimension, readonly [string, string]> = {
  inputTokens: ['총 입력 토큰', 'Aggregate input tokens'], outputTokens: ['총 출력 토큰', 'Aggregate output tokens'],
  audioInputTokens: ['음성 입력 토큰', 'Audio input tokens'], textInputTokens: ['텍스트 입력 토큰', 'Text input tokens'],
  audioOutputTokens: ['음성 출력 토큰', 'Audio output tokens'], textOutputTokens: ['텍스트 출력 토큰', 'Text output tokens'],
  durationSeconds: ['응답 음성 길이 (초)', 'Returned audio duration (seconds)'], elapsedMs: ['응답 실측 시간 합계 (ms)', 'Measured response elapsed sum (ms)'],
};
const count = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 8 });
const stageName = (kind: 'stt' | 'minutes', language: Language) => kind === 'stt' ? 'STT' : copy(language, '정리 노트', 'Notes');
const routeName = (route: UsageHistoryItem['route'], language: Language) => route === 'openai' ? 'Direct OpenAI' : route === 'openrouter' ? 'OpenRouter' : route === 'openai-compatible' ? copy(language,'OpenAI 호환 · 로컬','OpenAI-compatible / local') : copy(language, '확인 불가', 'Unknown');
function attemptState(state: UsageHistoryItem['state'], language: Language): string {
  const names = { queued: ['대기', 'Queued'], requesting: ['요청 준비·진행', 'Requesting'], 'response-received': ['응답 수신', 'Response received'], saving: ['저장 중', 'Saving'], saved: ['저장됨', 'Saved'], failed: ['실패', 'Failed'], cancelled: ['취소됨', 'Cancelled'], 'outcome-unknown': ['결과 불명', 'Outcome unknown'] } as const;
  return state ? names[state][language === 'ko' ? 0 : 1] : copy(language, '확인 불가', 'Unknown');
}
function costKind(kind: 'reported' | 'estimated' | 'mixed', language: Language) {
  return kind === 'reported' ? copy(language, '응답 보고값', 'Reported') : kind === 'estimated' ? copy(language, '추정값', 'Estimated') : copy(language, '보고·추정 혼합 · 잠정값', 'Mixed reported/estimated · provisional');
}
function CostSummary({ costs, language, combined = false }: { costs: CostStatement; language: Language; combined?: boolean }) {
  const t = (ko: string, en: string) => copy(language, ko, en);
  return <div className="stack usage-costs">
    {costs.components.map(component => <span key={`${component.currency}:${component.kind}`} className="mono">{count(component.amount)} {component.currency} · {costKind(component.kind, language)} {t('확인된 소계', 'known subtotal')} ({component.resultCount} {t('결과', 'results')})</span>)}
    {!costs.components.length && <span>{t('비용 확인 불가', 'Cost unavailable')}</span>}
    <span>{combined ? t('전체 합계:', 'Complete combined total:') : t('확인된 비용 합계:', 'Complete known cost total:')} {costs.completeTotal ? `${count(costs.completeTotal.amount)} ${costs.completeTotal.currency} · ${costKind(costs.completeTotal.kind, language)}` : t('확인 불가', 'Unavailable')}</span>
    {(costs.missingResults > 0 || costs.uncertainAttempts > 0) && <span className="hint">{t(`부분 소계 · 비용 없는 결과 ${costs.missingResults}개 · 비용 발생 여부가 불확실한 기록 ${costs.uncertainAttempts}개`, `Partial subtotal · ${costs.missingResults} results lack cost · ${costs.uncertainAttempts} records have uncertain charges`)}</span>}
  </div>;
}
function dimensionText(value: DimensionSubtotal, language: Language): string {
  if (value.subtotal === null) return copy(language, '확인 불가', 'Unavailable');
  const coverage = `${value.reportedResults}/${value.resultCount}`;
  return `${count(value.subtotal)} · ${value.reportedResults < value.resultCount ? copy(language, '보고된 부분 소계', 'reported partial subtotal') : copy(language, '응답 실측·보고값', 'measured/reported')} (${coverage} ${copy(language, '결과', 'results')})`;
}
function StageDetails({ stage, language }: { stage: StageUsageStatement; language: Language }) {
  const [expanded, setExpanded] = useState(false);
  const t = (ko: string, en: string) => copy(language, ko, en);
  return <details className="usage-stage-details" onToggle={event => setExpanded(event.currentTarget.open)}><summary>{stageName(stage.kind, language)} · {t('토큰·시간·상태 상세', 'Token, timing and state details')}</summary><div className="stack gap12">
    {stage.kind === 'stt' && <div className="stack hint"><span>{t('원본 길이 (초)', 'Original source duration (seconds)')}: {stage.sourceDurationSeconds === null ? t('확인 불가', 'Unavailable') : count(stage.sourceDurationSeconds)}</span><span>{t('준비된 청크 길이 합계 · 겹침 포함 (초)', 'Prepared chunk duration sum · includes overlap (seconds)')}: {stage.preparedDurationSeconds === null ? t('확인 불가', 'Unavailable') : count(stage.preparedDurationSeconds)}</span><span>{t('준비 길이는 실제 전송·과금 길이가 아니며 재시도 전송량을 나타내지 않아요.', 'Prepared duration is not transmitted or billed duration and does not represent retries.')}</span></div>}
    <div className="usage-dimensions">{Object.entries(stage.dimensions).filter(([, value]) => value.subtotal !== null).map(([key, value]) => <span key={key}>{labels[key as UsageDimension][language === 'ko' ? 0 : 1]}: {dimensionText(value, language)}</span>)}</div>
    <span className="hint">{t('확인 불가 항목', 'Unavailable fields')}: {Object.entries(stage.dimensions).filter(([, value]) => value.subtotal === null).map(([key]) => labels[key as UsageDimension][language === 'ko' ? 0 : 1]).join(' · ') || t('없음', 'None')}</span>
    <span className="hint">{t('저장된 요청 기록 상태', 'Durable request record states')}: {Object.entries(stage.states).map(([state, total]) => `${attemptState(state === 'unknown' ? null : state as UsageHistoryItem['state'], language)} ${total}`).join(' · ') || t('없음', 'None')}</span>
    {expanded && stage.items.map(item => <UsageAttempt key={item.id} item={item} language={language} statement />)}
    {!!stage.conflictingRunIds.length && <span className="warning">{t('동일 ID의 상충 기록은 사용량·비용 합계에서 제외했어요.', 'Conflicting records with the same ID are excluded from usage and cost totals.')}: {stage.conflictingRunIds.join(', ')}</span>}
  </div></details>;
}
export function UsageIdentity({ item, language }: { item: UsageHistoryItem; language: Language }) {
  const t = (ko: string, en: string) => copy(language, ko, en); const unknown = t('확인 불가', 'Unknown');
  return <div className="stack usage-identity">
    <span>{t('요청 어댑터 (저장된 의도에서 도출)', 'Requested adapter (from recorded intent)')}: {routeName(item.route, language)}</span>
    <span className="mono">{t('요청 모델', 'Requested model')}: {item.model ?? unknown}</span>
    <span className="hint">{item.route === 'openai' ? t('직접 제공사', 'Direct provider') : t('카탈로그 네임스페이스', 'Catalog namespace')}: {item.publisher ?? unknown}</span>
    {item.executionRequestedModel && item.executionRequestedModel !== item.model && <span className="warning">{t('결과에 저장된 요청 모델', 'Request model stored with result')}: {item.executionRequestedModel}</span>}
    <span className="hint">{t('요청 실행 엔드포인트', 'Requested execution endpoint')}: {item.requestedEndpoint ?? unknown}</span>
    <span className="mono">{t('반환 모델', 'Returned model')}: {item.returnedModel ?? unknown}</span>
    <span className="hint">{t('응답에 보고된 실행 제공사', 'Reported execution provider')}: {item.actualProvider ?? unknown}</span>
  </div>;
}
function Rates({ snapshot, source, checkedAt, language, label }: { snapshot: RateSnapshot | null; source?: string | null; checkedAt?: string | null; language: Language; label: string }) {
  const t = (ko: string, en: string) => copy(language, ko, en); const unknown = t('확인 불가', 'Unknown');
  return <div className="stack hint"><strong>{label}</strong><span>{snapshot?.source ?? source ?? unknown} · {snapshot?.checkedAt ?? checkedAt ?? unknown}</span>{snapshot?.rates.map((rate, index) => <span key={index} className="mono">{rate.unit}: {count(rate.price)} {snapshot.currency} / {count(rate.units)} {t('단위', 'units')}</span>)}<span>{t('요금 출처는 실행 제공사의 증거가 아니에요.', 'Rate provenance does not establish the execution provider.')}</span></div>;
}
export function UsageAttempt({ item, language, statement = false }: { item: UsageHistoryItem; language: Language; statement?: boolean }) {
  const t = (ko: string, en: string) => copy(language, ko, en); const unknown = t('확인 불가', 'Unknown');
  const dimensionEntries = Object.entries(labels) as [UsageDimension, readonly [string, string]][];
  return <details role="group" aria-label={`${statement ? t('명세 실행', 'Statement run') : t('실행', 'Run')} ${item.id}`} className="usage-attempt"><summary><strong>{item.modelName ?? item.model ?? t('요청 기록', 'Request record')}</strong><span className="badge idle">{attemptState(item.state, language)}</span><span className="hint">{item.kind ? stageName(item.kind, language) : unknown} · {item.hasResult ? t('응답 보존', 'Response preserved') : t('응답 없음', 'No response')}</span></summary><div className="stack gap12">
    <span>{t('단계', 'Stage')}: {item.kind ? stageName(item.kind, language) : unknown}</span>
    <span className="hint">{t('완료 체크포인트 시각', 'Completed checkpoint time')}: {item.date ?? unknown}</span>
    <span className="hint">{t('저장된 요청 기록', 'Durable request record')}: {item.recordedAttempt ? t('있음', 'Present') : unknown} · {t('결과', 'Result')}: {item.hasResult ? t('보존됨', 'Preserved') : t('없음', 'Absent')}</span>
    {item.kind === 'stt' && <span className="mono">{t('청크 연결', 'Chunk association')}: {item.chunkId ?? unknown}</span>}
    {item.conflict && <span className="warning">{t('저장된 증거 상충 · 사용량과 비용 확인 불가', 'Conflicting saved evidence · usage and cost unavailable')}</span>}
    <details className="usage-diagnostics"><summary>{t('요청 ID·경로 상세', 'Request ID & route details')}</summary><div className="stack gap12"><span className="mono">{t('요청 ID', 'Request ID')}: {item.id}</span><UsageIdentity item={item} language={language} /></div></details>
    <div className="usage-dimensions">{dimensionEntries.filter(([key]) => item.usage?.[key] != null).map(([key, label]) => <span key={key}>{label[language === 'ko' ? 0 : 1]}: {count(item.usage![key]!)}</span>)}</div>
    <span className="hint">{t('확인 불가 항목', 'Unavailable fields')}: {dimensionEntries.filter(([key]) => item.usage?.[key] == null).map(([, label]) => label[language === 'ko' ? 0 : 1]).join(' · ') || t('없음', 'None')}</span>
    <span>{t('결과 비용', 'Result cost')}: {item.usage?.cost == null || !item.usage.currency || item.usage.costKind === 'unavailable' ? unknown : `${count(item.usage.cost)} ${item.usage.currency} · ${costKind(item.usage.costKind, language)}`}</span>
    <Rates snapshot={item.usage?.rateSnapshot ?? null} source={item.usage?.rateSource} checkedAt={item.usage?.rateCheckedAt} language={language} label={t('결과 요금 스냅샷', 'Result rate snapshot')} />
    {item.intentRateSnapshot && <Rates snapshot={item.intentRateSnapshot} language={language} label={t('요청 의도 요금 스냅샷', 'Request intent rate snapshot')} />}
  </div></details>;
}
export default function UsageStatement({ project, language, sttOnly = false, detailed = false }: { project: MeetingProject; language: Language; sttOnly?: boolean; detailed?: boolean }) {
  const body = useRef<HTMLDivElement>(null), bodyId = useId();
  const [compact, setCompact] = useState(() => globalThis.matchMedia?.('(max-width: 1100px)').matches ?? false);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const media = globalThis.matchMedia?.('(max-width: 1100px)');
    if (!media) return;
    const resize = () => {
      if (media.matches && body.current?.contains(document.activeElement)) setExpanded(true);
      setCompact(media.matches);
    };
    media.addEventListener('change', resize);
    return () => media.removeEventListener('change', resize);
  }, []);
  const t = (ko: string, en: string) => copy(language, ko, en); const statement = aggregateProjectUsage(project);
  const stages = sttOnly ? [statement.stt] : [statement.stt, statement.minutes];
  const costs = sttOnly ? statement.stt.costs : statement.combined;
  const summary = `${stages.map(stage => `${stageName(stage.kind, language)} ${t('요청 기록', 'request records')} ${stage.attemptCount}`).join(' · ')} · ${costs.completeTotal ? `${count(costs.completeTotal.amount)} ${costs.completeTotal.currency} · ${costKind(costs.completeTotal.kind, language)}` : t('비용 합계 확인 불가', 'Cost total unavailable')}`;
  const closed = !detailed && !expanded;
  return <section className="card stack gap12 usage-statement" aria-label={sttOnly ? t('STT 사용량 명세', 'STT usage statement') : t('사용량 명세', 'Usage statement')}>
    {!detailed && <div className="compact-work-summary"><span>{summary}</span><button aria-label={closed ? t('사용량·비용 상세 펼치기', 'Show usage and cost details') : t('사용량·비용 상세 접기', 'Hide usage and cost details')} aria-expanded={!closed} aria-controls={bodyId} onClick={() => { if (!closed && body.current?.contains(document.activeElement)) return; setExpanded(closed); }}>{closed ? t('상세', 'Details') : t('접기', 'Hide')}</button></div>}
    <div id={bodyId} ref={body} className="compact-work-body stack gap12" hidden={closed} inert={closed}>
    <strong>{t('단계별 사용량 명세', 'Usage by processing stage')}</strong>
    {detailed && compact && <span className="hint">{t('표를 좌우로 움직여 비용 구성까지 확인하세요.', 'Scroll the table sideways to see cost components.')}</span>}
    <div className="table-scroll" tabIndex={0} role="region" aria-label={t('단계별 사용량 표', 'Usage by stage table')}><table><thead><tr><th>{t('단계', 'Stage')}</th><th>{t('고유 청크 · 준비/전사', 'Unique chunks · prepared/transcribed')}</th><th>{t('저장된 요청 기록', 'Durable request records')}</th><th>{t('보존된 응답 결과', 'Preserved response results')}</th><th>{t('비용 구성', 'Cost components')}</th></tr></thead><tbody>{stages.map(stage => <tr key={stage.kind}><th scope="row">{stageName(stage.kind, language)}</th><td>{stage.kind === 'stt' ? `${stage.preparedChunks} / ${stage.transcribedChunks}` : '—'}</td><td>{stage.attemptCount}</td><td>{stage.responseCount}</td><td><CostSummary costs={stage.costs} language={language} /></td></tr>)}</tbody></table></div>
    {stages.map(stage => <div key={stage.kind} className="stack usage-stage"><span className="hint">{stageName(stage.kind, language)} · {t('저장된 요청 경로·모델', 'Recorded requested adapters/models')}: {[...new Set(stage.items.map(item => `${routeName(item.route, language)} / ${item.model ?? t('확인 불가', 'Unknown')}`))].join(' · ') || t('없음', 'None')}</span><StageDetails stage={stage} language={language} /></div>)}
    {!sttOnly && <div className="usage-combined stack gap12"><strong>{t('전체 확인된 비용 구성', 'Combined known components')}</strong><CostSummary costs={statement.combined} language={language} combined /></div>}
    {!!statement.unclassifiedAttempts && <span className="warning">{t(`${statement.unclassifiedAttempts}개 요청 기록의 단계가 확인 불가해요. 전체 비용은 불완전해요.`, `${statement.unclassifiedAttempts} attempts have an unknown stage. Combined costs are incomplete.`)}</span>}
    <span className="hint">{t('요청 의도 기록은 전송 전에 저장되며 제공사 수신·과금을 증명하지 않아요. 응답 결과는 실행 ID별로 한 번만 합산해요. 실패·취소·결과 불명 기록에도 비용이 있을 수 있어요.', 'Request intents are saved before transport and do not prove provider receipt or billing. Results are counted once per run ID. Failed, cancelled and unknown outcomes may incur charges.')}</span>
    <span className="hint">{t('실제 제공사 최종 청구액은 미검증이에요. credits와 USD는 환산하거나 합산하지 않아요.', 'Final provider billing is unverified. Credits and USD are not converted or added together.')}</span>
    </div>
  </section>;
}

export function STTUsageSummary({ project, language, onDetails }: { project: MeetingProject; language: Language; onDetails: () => void }) {
  const t = (ko: string, en: string) => copy(language, ko, en);
  const stage = aggregateProjectUsage(project).stt;
  const total = stage.costs.completeTotal;
  const cost = total ? `${count(total.amount)} ${total.currency} · ${costKind(total.kind, language)}` : [t('비용 확인 불가', 'Cost unavailable'), ...stage.costs.components.map(component => `${count(component.amount)} ${component.currency} · ${costKind(component.kind, language)} ${t('확인된 부분 소계', 'known partial subtotal')}`)].join(' · ');
  return <section className="card compact-work-summary stt-usage-summary" aria-label={t('전사 사용량 요약', 'Transcription usage summary')}>
    <span className="hint">{t('요청 기록', 'Request records')} {stage.attemptCount} · {cost}</span>
    <button className="plain accent-text icon-label" aria-label={t('명세·요청 이력 보기 →', 'View statement & request history →')} onClick={onDetails}>{t('명세·요청 이력 보기', 'View statement & request history')}<ArrowRight aria-hidden="true" /></button>
  </section>;
}
