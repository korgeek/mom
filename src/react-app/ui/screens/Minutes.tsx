import { ChevronUp, ChevronDown } from 'lucide-react';
import { registrationEndpoint } from '../../providers/model-registrations';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { ProjectScreenProps } from '../../App';
import type { MinutesSection } from '../../domain/types';
import type { MinutesSelectionPreview } from '../../minutes/selection';
import { resolveMinutesSettings } from '../../minutes/preferences';
import { comparisonMemberState } from '../../minutes/compare';
import { defaultSelectionLists } from '../../settings/lists';
import ModelIdentity from '../ModelIdentity';
import UsageStatement from '../UsageStatement';
import { copy, formatTime } from '../copy';
import { useSessionDraft } from '../useSessionDraft';
import '../compact-work.css';

const sectionNames: Record<MinutesSection, readonly [string, string]> = { summary: ['요약', 'Summary'], topics: ['주제별 논의', 'Discussion by topic'], decisions: ['결정사항', 'Decisions'], actions: ['액션 아이템', 'Action items'], open: ['미결사항', 'Open questions'], refs: ['원문 시간 참조', 'Transcript references'] };
const allSections = Object.keys(sectionNames) as MinutesSection[];
const presets: readonly { ko: string; en: string; sections: readonly MinutesSection[] }[] = [
  { ko: '요약 + 액션 아이템', en: 'Summary + action items', sections: ['summary', 'actions'] },
  { ko: '표준 정리 노트', en: 'Standard notes', sections: ['summary', 'topics', 'decisions', 'actions', 'open'] },
  { ko: '결정 중심', en: 'Decision-focused', sections: ['decisions', 'actions', 'open', 'refs'] },
  { ko: '추가 지침만 사용', en: 'Use instructions only', sections: [] },
];
function MarkdownPreview({ markdown }: { markdown: string }) {
  // Render text through React's escaping. Provider output never becomes executable HTML.
  const lines = markdown.split('\n'); const rendered: ReactNode[] = []; let fence = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line.startsWith('```')) { fence = !fence; rendered.push(<div key={index} className="mono muted">{line}</div>); }
    else if (fence) rendered.push(<pre key={index}>{line}</pre>);
    else if (line.startsWith('# ')) rendered.push(<h2 key={index}>{line.slice(2)}</h2>);
    else if (line.startsWith('## ')) rendered.push(<h3 key={index}>{line.slice(3)}</h3>);
    else if (line.startsWith('### ')) rendered.push(<h4 key={index}>{line.slice(4)}</h4>);
    else if (/^[-*] /.test(line)) rendered.push(<div key={index} className="markdown-list"><span aria-hidden="true">–</span><span>{line.slice(2)}</span></div>);
    else if (line.startsWith('> ')) rendered.push(<blockquote key={index}>{line.slice(2)}</blockquote>);
    else if (line.startsWith('|')) rendered.push(<pre key={index}>{line}</pre>);
    else rendered.push(line ? <p key={index}>{line}</p> : <div key={index} className="markdown-space" />);
  }
  return <div className="markdown-preview">{rendered}</div>;
}
function selectionFitLabel(status: MinutesSelectionPreview['status'], language: 'ko' | 'en') {
  const t = (ko: string, en: string) => copy(language, ko, en);
  const fitLabels: Record<MinutesSelectionPreview['status'], string> = {
    'choose-model': t('모델을 선택하세요', 'Choose a model'), 'choose-endpoint': t('제공사 엔드포인트를 선택하세요', 'Choose a provider endpoint'),
    'choose-transcript': t('사용할 전사문을 선택하세요', 'Select a transcript'), 'fits': t('선택한 한도 안에 들어요', 'Fits the selected limits'),
    'missing-limits': t('필수 한도가 없어 전송할 수 없어요', 'Required limits are unavailable; sending is blocked'),
    'overflow': t('전체 전사문이 한도를 넘어요 · 원문은 유지해요', 'The full transcript exceeds the limits; all text is retained'),
    'invalid-input': t('선택한 입력이나 설정을 확인하세요', 'Check the selected input and settings'),
  };
  return fitLabels[status];
}
function ModelDetails({ preview, language, showIdentity = true }: { preview: MinutesSelectionPreview | null | undefined; language: 'ko' | 'en'; showIdentity?: boolean }) {
  const t = (ko: string, en: string) => copy(language, ko, en);
  if (!preview?.route.modelId) return null;
  const count = (value: number | null | undefined) => value == null ? null : value.toLocaleString(language === 'ko' ? 'ko-KR' : 'en-US');
  const usd = (value: number | null | undefined) => value == null ? null : `$${value.toLocaleString('en-US', { maximumFractionDigits: 8 })}`;
  const fields: readonly [string, string | null][] = [
    [t('컨텍스트 한도', 'Context limit'), count(preview.limits.contextTokens)],
    [t('입력 한도', 'Prompt limit'), count(preview.limits.maxPromptTokens)],
    [t('최대 출력', 'Maximum output'), preview.limits.maxOutputTokens === preview.limits.outputTokens ? null : count(preview.limits.maxOutputTokens)],
    [t('입력 토큰 추정', 'Input token estimate'), count(preview.fit?.inputTokenEstimate)],
    [t('입력 · USD / 100만 토큰', 'Input · USD / 1M tokens'), usd(preview.pricing.inputPerMillion)],
    [t('출력 · USD / 100만 토큰', 'Output · USD / 1M tokens'), usd(preview.pricing.outputPerMillion)],
    [t('요청 1회 · USD', 'Per request · USD'), usd(preview.pricing.requestFee)],
  ];
  return <div role="region" aria-label={t('모델 상세', 'Model details')} className="model-details stack gap12">
    <strong>{t('요청 옵션', 'Request options')}</strong>
    {showIdentity && <span className="hint mono registration-url">{preview.route.modelName ?? preview.route.modelId} · {preview.route.modelId}{preview.route.endpointTag && ` · ${preview.route.endpointTag}`}</span>}
    {preview.status === 'fits' && <span className="hint model-fit">{preview.limits.maxPromptTokens === null ? t('공개 컨텍스트 기준으로 들어올 것으로 추정해요', 'Estimated to fit published context') : selectionFitLabel(preview.status, language)}</span>}
    <dl className="model-details-grid">{fields.filter(([, value]) => value !== null).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    {preview.fit && <span className="hint">{t('입력 토큰은 바이트 기준 추정치예요. 실제 사용량과 다를 수 있어요.', 'Input tokens are estimated from bytes and may differ from actual usage.')}</span>}
    {preview.projection.total !== null && <span className="hint">{t('예상 비용', 'Estimated cost')}: {usd(preview.projection.total)} · {t('출력 예산 기준이며 실제 청구액은 달라질 수 있어요.', 'Based on the output budget; actual charges may differ.')}</span>}
    {(preview.pricing.source || preview.pricing.checkedAt) && <span className="hint">{[preview.pricing.source, preview.pricing.checkedAt].filter(Boolean).join(' · ')}</span>}
  </div>;
}
function ModelRouteSelector({ controller: c, project: p, memberB = false, clear }: ProjectScreenProps & { memberB?: boolean; clear: () => void }) {
  const t = (ko: string, en: string) => copy(c.preferences.uiLanguage, ko, en);
  const key = memberB ? c.comparisonBRouteKey : c.minutesRouteKey;
  const rows = c.minutesRoutes ?? [], current = rows.find(row => row.key === key);
  const action = memberB ? c.onComparisonBRoute : c.onMinutesRoute;
  const savedId = memberB ? c.comparisonBModelId : p.minutesSettings.modelId;
  const registered = c.modelRegistrations?.entries.find(entry => entry.id === key);
  const label = (row: typeof rows[number]) => {
    const entry=c.modelRegistrations?.entries.find(entry=>entry.id===row.key);
    if (!entry) return row.label;
    return rows.some(other=>other.key!==row.key && c.modelRegistrations?.entries.find(item=>item.id===other.key)?.name===entry.name) ? `${entry.name} · ${entry.modelId} (${new URL(registrationEndpoint(entry)).host})` : entry.name;
  };
  return <div className="minutes-route-selector stack gap12">
    <label>{t(memberB ? 'B 모델' : '정리 모델', memberB ? 'Member B model' : 'Notes model')}<select value={key ?? ''} disabled={!action || c.busy || !rows.length} onChange={event => { clear(); if (event.target.value) action?.(p.id, event.target.value); }}><option value="">{t('모델을 선택하세요', 'Choose a model')}</option>{rows.map(row => <option key={row.key} value={row.key} disabled={!row.enabled}>{label(row)}</option>)}</select></label>
    {registered && <span className="hint mono model-route">{registered.modelId} · {registrationEndpoint(registered)}</span>}
    {(current?.enabled === false || !!savedId && !current) && <div className="warning">{t('저장된 경로를 유지했어요. 설정에서 활성화하고 새로 확인하세요.', 'The saved route is retained. Enable and refresh it in Settings.')}</div>}
    <button className="plain accent-text align-start" disabled={!c.onNavigate || c.busy} onClick={() => { c.onNavigate?.('settings', p.id); c.onSettingsTab?.('models'); }}>{t('설정에서 모델 관리', 'Manage models in Settings')}</button>
  </div>;
}

function ComparisonControls({ controller: c, project: p, dirty }: ProjectScreenProps & { dirty: boolean }) {
  const t = (ko: string, en: string) => copy(c.preferences.uiLanguage, ko, en);
  const record = p.minutesComparisons?.find(record => record.id === c.selectedComparisonId);
  const preview = c.minutesComparison; const retry = c.comparisonRetryMember;
  const version = record?.transcript ?? p.transcriptVersions.find(version => version.id === p.selectedTranscriptVersionId);
  const incomplete = !!version && version.missingRanges.length > 0;
  const identity = JSON.stringify([p.id, version?.id, c.comparisonConsentToken, c.selectedComparisonId, retry, dirty, c.preferences.uiLanguage]);
  const [ack, setAck] = useState({ identity, transmission: false, unknown: false, partial: false });
  if (ack.identity !== identity) setAck({ identity, transmission: false, unknown: false, partial: false });
  const current = ack.identity === identity ? ack : { identity, transmission: false, unknown: false, partial: false };
  const canGenerate = !!(version && preview?.status === 'fits' && c.comparisonConsentToken && current.transmission && (!preview.unknownTotal || current.unknown) && (!incomplete || current.partial) && c.onGenerateComparison && !c.busy && !dirty && !c.comparisonUnavailableReason);
  const clear = () => setAck({ identity, transmission: false, unknown: false, partial: false });
  return <section className="comparison-controls stack gap14" aria-label={t('모델 비교 설정', 'Comparison settings')}>
    <div className="row-between wrap"><strong>{t('정확히 두 모델 비교', 'Compare exactly two models')}</strong><button disabled={!c.onNavigate || c.busy} onClick={() => { clear(); c.onNavigate?.('settings', p.id); c.onSettingsTab?.('models'); }}>{t('설정에서 요금·한도 확인', 'Review prices and limits in Settings')}</button></div>
    {!record && <>
      <span className="hint">{t('A는 위에서 선택한 모델·엔드포인트를 사용해요. B를 직접 선택하세요.', 'A uses the model and endpoint selected above. Choose B explicitly.')}</span>
      <ModelRouteSelector controller={c} project={p} memberB clear={clear} />
    </>}
    {record && <div className="notice">{t(`저장된 원래 전사문·출력 언어(${record.settings.outputLanguage})·지침·출력 예산을 사용해요. 위의 새 설정은 이 비교를 바꾸지 않아요.`, `This comparison uses its saved original transcript, output language (${record.settings.outputLanguage}), instructions and output budget. New settings above do not change it.`)}</div>}
    <details className="usage-stage-details"><summary>{t('자세히 보기 · 비교 모델 요금·한도', 'Details · comparison model prices and limits')}</summary><strong>{t('공통 출력 예산:', 'Common output budget:')} {preview?.outputTokens?.toLocaleString() ?? '—'} {t('토큰', 'tokens')}</strong>
    {preview?.members.map((member, index) => <fieldset className="comparison-member-details" key={index}><legend>{t(`${index === 0 ? 'A' : 'B'} 모델·경로`, `Member ${index === 0 ? 'A' : 'B'} route`)}</legend><ModelDetails preview={member} language={c.preferences.uiLanguage} /></fieldset>)}
    </details>
    {preview && ['missing-limits', 'overflow', 'invalid-input'].includes(preview.status) && <div className="warning" role="status" aria-label={t('비교 생성 가능 여부', 'Comparison readiness')}>{selectionFitLabel(preview.status as MinutesSelectionPreview['status'], c.preferences.uiLanguage)}</div>}
    {preview?.status === 'duplicate' && <div className="warning">{t('서로 다른 모델 ID를 선택하세요. 같은 모델의 엔드포인트만 바꾼 비교는 지원하지 않아요.', 'Choose two different model IDs. Changing only the endpoint of the same model does not make a model comparison.')}</div>}
    <span>{t('두 요청의 예상 합계 · USD:', 'Combined estimated total · USD:')} {preview?.combinedTotal == null ? t('확인 불가', 'Unavailable') : `$${preview.combinedTotal.toFixed(6)}`}</span>
    {(!record || retry != null) && <>
      <span className="hint">{retry != null ? t(`원래 입력으로 ${retry === 0 ? 'A' : 'B'}만 다시 요청해요. 이전 요청의 결과가 불명확하면 이미 비용이 청구됐을 수 있어요.`, `Only ${retry === 0 ? 'A' : 'B'} is retried with the original input. An unknown earlier attempt may already have incurred a charge.`) : t('같은 전사문과 지침을 두 경로로 순서대로 보내요. 최대 두 번의 유료 요청이며, 제공사 보관 정책이 적용돼요. A가 암호화 저장된 뒤에만 B를 시작해요.', 'The same transcript and instructions go to both routes sequentially. Up to two chargeable requests and provider retention policies apply. B starts only after A is encrypted and saved.')}</span>
      <label className="checkbox-line"><input type="checkbox" checked={current.transmission} disabled={c.busy} onChange={event => setAck({ ...current, transmission: event.target.checked })} /><span>{retry != null ? t('이 멤버 재시도의 전송·추가 요금을 확인했어요', 'I approve this member retry, transmission and possible additional charge') : t('순차 요청 두 번의 전송·요금을 확인했어요', 'I approve two sequential requests, transmission and charges')}</span></label>
      {preview?.unknownTotal && <label className="checkbox-line"><input type="checkbox" checked={current.unknown} disabled={c.busy} onChange={event => setAck({ ...current, unknown: event.target.checked })} /><span>{t('전체 예상 비용이 확인 불가임을 확인했어요', 'I acknowledge that a complete estimated total is unavailable')}</span></label>}
      {incomplete && <label className="checkbox-line"><input type="checkbox" checked={current.partial} disabled={c.busy} onChange={event => setAck({ ...current, partial: event.target.checked })} /><span>{t('누락 구간이 있는 선택 전사로 부분 비교하는 것을 확인했어요', 'I approve partial comparison with missing ranges disclosed')}</span></label>}
      <button className="primary tall" disabled={!canGenerate} onClick={() => { if (version && c.comparisonConsentToken) c.onGenerateComparison?.(p.id, { acknowledged: true, transcriptVersionId: version.id, consentToken: c.comparisonConsentToken, partialAcknowledged: incomplete && current.partial, unknownTotalAcknowledged: current.unknown }); }}>{retry != null ? t(`${retry === 0 ? 'A' : 'B'}만 다시 요청`, `Retry member ${retry === 0 ? 'A' : 'B'}`) : t('두 모델 비교 실행', 'Compare two models')}</button>
    </>}
    {c.minutesGenerating && <button disabled={!c.onCancelMinutes} onClick={c.onCancelMinutes}>{t('정리 노트 작업 중지', 'Stop notes work')}</button>}
    <span className="hint">{t('결과를 직접 비교해 선택하세요. 자동 심사·대체·재시도는 하지 않아요.', 'Review the outputs yourself and select a result. There is no automatic judge, fallback or retry.')}</span>
  </section>;
}
function ComparisonResults({ controller: c, project: p, dirty }: ProjectScreenProps & { dirty: boolean }) {
  const t = (ko: string, en: string) => copy(c.preferences.uiLanguage, ko, en);
  const record = p.minutesComparisons?.find(record => record.id === c.selectedComparisonId);
  return <section className="stack gap12" aria-label={t('모델 비교 결과', 'Comparison results')}>
    <label><span className="field-label">{t('저장된 비교', 'Saved comparison')}</span><select value={c.selectedComparisonId ?? ''} disabled={!c.onSelectComparison || c.busy} onChange={event => c.onSelectComparison?.(p.id, event.target.value || null)}><option value="">{t('새 비교', 'New comparison')}</option>{p.minutesComparisons?.map((record, index) => <option key={record.id} value={record.id}>{index + 1} · {record.members.map(member => member.modelId).join(' / ')}</option>)}</select></label>
    {record && <div className="comparison-results">{record.members.map((member, index) => {
      const slot = index as 0 | 1; const label = index === 0 ? 'A' : 'B'; const attempt = member.attempts[member.attempts.length - 1];
      const status = comparisonMemberState(p, record, slot);
      const revision = status === 'saved' ? p.minutesRevisions.find(revision => revision.id === attempt?.revisionId) : null;
      const run = p.minutesRuns.find(run => run.id === revision?.runId);
      const stateNames = { queued: t('미실행', 'Not requested'), requesting: t('요청 중', 'Requesting'), 'response-received': t('응답 받음', 'Response received'), saving: t('저장 중', 'Saving'), saved: t('저장됨', 'Saved'), failed: t('실패', 'Failed'), cancelled: t('중지됨', 'Stopped'), 'outcome-unknown': t('결과 불명확', 'Outcome unknown') };
      return <article className="card stack gap12 comparison-result" aria-label={t(`${label} 결과`, `Result ${label}`)} key={label}>
        <strong>{label} · {stateNames[status]}</strong>{member.modelSnapshot?<span className="hint registration-url">{member.modelSnapshot.name} · {member.modelId} · {registrationEndpoint(member.modelSnapshot)}</span>:<ModelIdentity id={member.modelId} name={c.modelCatalog?.find(model => model.id === member.modelId && model.kind === 'minutes')?.label ?? member.modelId} provider="openrouter" requestedEndpoint={member.endpointTag} requestedProvider={member.providerName} language={c.preferences.uiLanguage} />}
        <span className="hint">{t('요청 횟수', 'Attempts')}: {member.attempts.length}</span>
        {run && <><span className="mono">{t('반환 모델', 'Returned model')}: {run.returnedModel ?? t('확인 불가', 'Unknown')}</span><span className="hint">{t('응답에 보고된 실행 제공사', 'Reported execution provider')}: {run.actualProvider ?? t('확인 불가', 'Unknown')}</span><span>{t('경과', 'Elapsed')}: {(run.usage.elapsedMs / 1000).toFixed(2)} s · {t('입력', 'Input')}: {run.usage.inputTokens ?? '—'} {t('토큰', 'tokens')} · {t('출력', 'Output')}: {run.usage.outputTokens ?? '—'} {t('토큰', 'tokens')}</span><span>{t('비용', 'Cost')}: {run.usage.costKind} · {run.usage.cost == null ? t('확인 불가', 'Unavailable') : `${run.usage.cost.toFixed(6)} ${run.usage.currency ?? t('단위 확인 불가', 'unit unavailable')}`}</span></>}
        {revision ? <><div className="comparison-output"><MarkdownPreview markdown={revision.markdown} /></div><button className="primary" disabled={!c.onSelectMinutes || dirty || c.busy} onClick={() => c.onSelectMinutes?.(p.id, revision.id)}>{t(`${label} 결과 사용`, `Use result ${label}`)}</button></> : <><span>{t('암호화 저장된 결과가 없어요.', 'No encrypted saved result is available.')}</span>{status === 'outcome-unknown' && <div className="warning">{t('이전 요청에 비용이 청구됐을 수 있어요. 재시도는 추가 비용을 발생시킬 수 있어요.', 'The previous request may already have incurred a charge. Retrying may add cost.')}</div>}<button disabled={!c.onSelectComparison || c.busy || !['queued', 'failed', 'cancelled', 'outcome-unknown'].includes(status)} onClick={() => c.onSelectComparison?.(p.id, record.id, slot)}>{t(`${label} 요청 검토`, `Review request ${label}`)}</button></>}
      </article>;
    })}</div>}
    {dirty && <div className="notice">{t('결과를 바꾸기 전에 미저장 수정본을 저장하거나 취소하세요.', 'Save or discard unsaved edits before selecting another result.')}</div>}
  </section>;
}
export default function Minutes({ controller: c, project: p }: ProjectScreenProps) {
  const results = useRef<HTMLDivElement>(null);
  const setupBody = useRef<HTMLDivElement>(null), setupId = useId();
  const [compact, setCompact] = useState(() => globalThis.matchMedia?.('(max-width: 1100px)').matches ?? false);
  // A new response remounts this screen with a new revision key. The user's
  // settings disclosure belongs to the memo, rather than to that response.
  const [setupOpen, setSetupOpen] = useSessionDraft(c, `minutes-setup-open:${p.id}`, false);
  const [setupEditing, setSetupEditing] = useSessionDraft(c, `minutes-setup-editing:${p.id}`, false);
  useEffect(() => {
    const media = globalThis.matchMedia?.('(max-width: 1100px)');
    if (!media) return;
    const resize = () => {
      if (media.matches && setupBody.current?.contains(document.activeElement)) setSetupOpen(true);
      setCompact(media.matches);
    };
    media.addEventListener('change', resize);
    return () => media.removeEventListener('change', resize);
  }, [setSetupOpen]);
  const instructionsComposing = useRef(false);
  const selected = p.minutesRevisions.find(item => item.id === p.selectedMinutesRevisionId);
  // Preserve a field that still had focus when the new revision remounted us.
  // Earlier selection followed by transmission review is not an explicit Show.
  if (selected && setupEditing && !setupOpen) setSetupOpen(true);
  const [view, setView] = useSessionDraft<'preview' | 'edit'>(c, JSON.stringify(['minutes-view', p.id, selected?.id ?? null]), 'preview');
  const [draft, setDraft] = useSessionDraft(c, JSON.stringify(['minutes-text', p.id, selected?.id ?? null]), selected?.markdown ?? '');
  const t = (ko: string, en: string) => copy(c.preferences.uiLanguage, ko, en); const settings = p.minutesSettings;
  const effectiveSettings = resolveMinutesSettings(settings, c.preferences.uiLanguage), followsApp = settings.outputLanguageMode === 'app';
  const languageOptions = (c.selectionLists ?? defaultSelectionLists).languages;
  const isCustomLanguage = !languageOptions.some(item => item.code === settings.outputLanguage);
  const languageIdentity = JSON.stringify([p.id, settings.outputLanguageMode ?? null, settings.outputLanguage]);
  const [languageEdit, setLanguageEdit] = useSessionDraft(c, `minutes-language:${languageIdentity}`, { identity: languageIdentity, text: settings.outputLanguage, custom: !followsApp && isCustomLanguage });
  const languageComposing = useRef(false);
  if (languageEdit.identity !== languageIdentity) setLanguageEdit({ identity: languageIdentity, text: settings.outputLanguage, custom: !followsApp && isCustomLanguage });
  const languageText = languageEdit.identity === languageIdentity ? languageEdit.text : settings.outputLanguage;
  const customLanguage = languageEdit.identity === languageIdentity ? languageEdit.custom : !followsApp && isCustomLanguage;
  const languageDirty = languageText !== settings.outputLanguage || customLanguage && followsApp;
  const savedBudget = settings.outputTokens ?? (c.comparisonOpen ? c.minutesComparison?.outputTokens : c.minutesSelection?.limits.outputTokens) ?? null;
  const budgetIdentity = JSON.stringify([p.id, savedBudget]);
  const presetBudget = savedBudget !== null && [4096,8192,16384].includes(savedBudget);
  const [budgetEdit, setBudgetEdit] = useSessionDraft(c, `minutes-budget:${p.id}`, {identity:budgetIdentity,text:savedBudget?.toString() ?? '',custom:savedBudget !== null && !presetBudget});
  if (budgetEdit.identity !== budgetIdentity) setBudgetEdit({identity:budgetIdentity,text:savedBudget?.toString() ?? '',custom:savedBudget !== null && !presetBudget});
  const budgetText = budgetEdit.identity === budgetIdentity ? budgetEdit.text : savedBudget?.toString() ?? '';
  const customBudget = budgetEdit.identity === budgetIdentity ? budgetEdit.custom : savedBudget !== null && !presetBudget;
  const budgetDirty = budgetText !== (savedBudget?.toString() ?? '');
  const budget = Number(budgetText);
  const budgetLimit = c.comparisonOpen ? Math.min(...(c.minutesComparison?.members.map(member=>member.limits.maxOutputTokens ?? Infinity) ?? [Infinity])) : c.minutesSelection?.limits.maxOutputTokens ?? Infinity;
  const budgetValid = Number.isSafeInteger(budget) && budget > 0 && budget <= Math.min(1000000,budgetLimit);
  const settingsDirty = languageDirty || budgetDirty;
  const version = p.transcriptVersions.find(item => item.id === p.selectedTranscriptVersionId);
  const missing = version?.missingRanges ?? []; const incomplete = missing.length > 0; const registration=c.modelRegistrations?.entries.find(item=>item.id===settings.registrationId&&item.stage==='llm'); const model = c.modelCatalog?.find(item => item.kind === 'minutes' && item.id === (settings.registrationId??settings.modelId));
  const snapshotIdentity = JSON.stringify([p.id, version?.id ?? null, c.minutesConsentToken ?? null, c.minutesEndpointTag ?? null, effectiveSettings.outputLanguage, languageText, budgetText, c.preferences.uiLanguage]);
  const [acknowledgments, setAcknowledgments] = useState({ snapshotIdentity, transmission: false, partial: false });
  if (acknowledgments.snapshotIdentity !== snapshotIdentity) setAcknowledgments({ snapshotIdentity, transmission: false, partial: false });
  const consent = acknowledgments.snapshotIdentity === snapshotIdentity && acknowledgments.transmission;
  const partialConsent = acknowledgments.snapshotIdentity === snapshotIdentity && acknowledgments.partial;
  const clearConsent = () => { setAcknowledgments({ snapshotIdentity, transmission: false, partial: false }); };
  const change = (patch: Partial<typeof settings>) => { clearConsent(); c.onMinutesSettings?.(p.id, { ...settings, ...patch }); };
  // Typing is a local draft: one explicit Apply uses the existing encrypted
  // settings checkpoint, without making the field busy after each character.
  const applyLanguage = () => { if (languageDirty && languageText.trim() && !languageComposing.current && !c.busy) change({ outputLanguageMode: 'explicit', outputLanguage: languageText }); };
  const sections = [...settings.sections, ...allSections.filter(section => !settings.sections.includes(section))];
  const move = (section: MinutesSection, direction: -1 | 1) => { const index = settings.sections.indexOf(section); const order = [...settings.sections]; const next = index + direction; if (index < 0 || next < 0 || next >= order.length) return; [order[index], order[next]] = [order[next], order[index]]; change({ sections: order }); };
  const dirty = draft !== (selected?.markdown ?? ''); const run = p.minutesRuns.find(item => item.id === selected?.runId);
  const resultModel = run?.modelSnapshot?.name ?? p.runs.find(item => item.id === run?.id)?.intent?.modelSnapshot?.name ?? run?.requestedModel;
  const endpoint = c.minutesEndpoints?.find(item => item.tag === c.minutesEndpointTag);
  const generationReason = !version || !version.segments.some(segment=>segment.text.trim()) ? t('먼저 2단계에서 전사를 완료하고 사용할 전사문을 선택하세요.', 'Complete transcription in step 2 and select a nonempty transcript first.')
    : !model ? t('위에서 정리 모델을 선택하세요.', 'Choose a notes model above.')
    : c.minutesUnavailableReason ?? (!model.enabled ? t('설정에서 선택한 모델을 활성화하세요.', 'Enable the selected model in Settings.')
    : !settings.sections.length && !settings.instructions.trim() ? t('추가 지침을 입력하거나 포함할 항목을 하나 이상 선택하세요.', 'Enter extra instructions or select at least one section.')
    : languageDirty ? t('출력 언어 수정을 적용하거나 취소하세요.', 'Apply or discard the language edit.')
    : budgetDirty ? t('분량 수정을 적용하거나 취소하세요.', 'Apply or discard the length edit.')
    : c.minutesSelection && c.minutesSelection.status !== 'fits' ? selectionFitLabel(c.minutesSelection.status,c.preferences.uiLanguage)
    : c.busy || c.minutesGenerating ? t('진행 중인 작업이 끝나면 생성할 수 있어요.', 'Generation will be available when the current work finishes.')
    : !c.minutesConsentToken ? t('모델과 입력 설정을 확인하고 있어요. 계속 표시되면 모델 설정을 확인하세요.', 'Checking the model and input. If this persists, review model settings.')
    : !registration && model.provider === 'openrouter' && !endpoint?.enabled ? t('설정에서 사용 가능한 제공사를 선택하세요.', 'Choose an available provider in Settings.')
    : !consent ? t('전송 확인에 체크하면 생성할 수 있어요.', 'Review transcript transmission to enable generation.')
    : incomplete && !partialConsent ? t('선택 전사에 누락된 구간이 있음을 확인하세요.', 'Confirm use of the incomplete transcript.')
    : !c.onGenerateMinutes ? t('생성 기능을 연결하고 있어요. 잠시 후 다시 시도하세요.', 'Generation is not ready. Try again shortly.') : null);
  const canGenerate = generationReason === null;
  const routeProvider = c.minutesSelection?.route.providerName ?? endpoint?.label ?? c.minutesEndpointTag;
  const destination = routeProvider ? `${routeProvider}${c.minutesEndpointTag && routeProvider !== c.minutesEndpointTag ? ` (${c.minutesEndpointTag})` : ''}` : null;
  const generate = () => {
    if (!canGenerate || !version || !c.minutesConsentToken) return;
    c.onGenerateMinutes?.(p.id, { acknowledged: true, transcriptVersionId: version.id, consentToken: c.minutesConsentToken, partialAcknowledged: incomplete && partialConsent });
    results.current?.scrollIntoView?.({ block: 'start' });
  };
  const canExport = !!(selected?.markdown.trim() && !dirty && !c.busy && !c.exportUnavailableReason);
  const setupClosed = compact && !!selected && !setupOpen && !settingsDirty && !c.comparisonOpen;
  const setupSummary = [model?.label ?? t('모델 미선택', 'No model selected'), effectiveSettings.outputLanguage, savedBudget === null ? null : `${savedBudget.toLocaleString()} ${t('토큰', 'tokens')}`].filter(Boolean).join(' · ');
  return <div className="stack gap16"><div className="minutes-grid"><div className="stack gap16 minutes-setup">
    {compact && selected && <div className="card compact-work-summary"><div className="stack"><strong>{t('정리 설정', 'Notes settings')}</strong><span className="hint">{setupSummary}</span></div><button aria-label={setupClosed ? t('정리 설정 펼치기', 'Show notes settings') : t('정리 설정 접기', 'Hide notes settings')} aria-expanded={!setupClosed} aria-controls={setupId} disabled={settingsDirty || !!c.comparisonOpen} onClick={() => { if (!setupClosed && setupBody.current?.contains(document.activeElement)) return; setSetupOpen(setupClosed); }}>{setupClosed ? t('펼치기', 'Show') : t('접기', 'Hide')}</button></div>}
    <div id={setupId} ref={setupBody} className="compact-work-body stack gap16" hidden={setupClosed} inert={setupClosed} onFocusCapture={event => { if ((event.target as HTMLElement).matches('select, textarea, input:not([type="checkbox"])')) setSetupEditing(true); }} onBlurCapture={event => { const next = event.relatedTarget; if (!(next instanceof HTMLElement) || !event.currentTarget.contains(next) || !next.matches('select, textarea, input:not([type="checkbox"])')) setSetupEditing(false); }}>
    <section className="card stack gap12" aria-label={t('정리 모델','Notes model')}><ModelRouteSelector controller={c} project={p} clear={clearConsent} /></section>
    <section className="card stack gap14" aria-label={t('정리 설정','Notes settings')}><strong>{t('정리 설정','Notes settings')}</strong><div className="stack"><span className="field-label">{t('기본 템플릿', 'Template')}</span><div className="actions">{presets.map(preset => <button key={preset.en} className={`chip ${settings.sections.join() === preset.sections.join() ? 'selected' : ''}`} aria-pressed={settings.sections.join() === preset.sections.join()} disabled={!c.onMinutesSettings || c.busy} onClick={() => change({ sections: preset.sections })}>{t(preset.ko, preset.en)}</button>)}</div></div>
      <label>{t('출력 언어', 'Output language')}<select value={customLanguage ? '__custom' : followsApp ? '__app' : settings.outputLanguage} disabled={!c.onMinutesSettings || c.busy} onChange={event => {
        clearConsent();
        if (event.target.value === '__custom') setLanguageEdit({ identity: languageIdentity, text: languageText, custom: true });
        else { setLanguageEdit({ identity: languageIdentity, text: settings.outputLanguage, custom: false }); change(event.target.value === '__app' ? { outputLanguageMode: 'app' } : { outputLanguageMode: 'explicit', outputLanguage: event.target.value }); }
      }}><option value="__app">{t('앱 언어 따르기', 'Follow app language')} ({c.preferences.uiLanguage})</option>{languageOptions.map(({code, name}) => <option key={code} value={code}>{name}</option>)}<option value="__custom">{t('직접 입력', 'Custom language')}</option></select></label>
      {customLanguage && <div className="stack gap12"><label><span className="field-label">{t('정리 노트 언어', 'Notes language')}</span><input autoComplete="off" aria-label={t('정리 노트 언어', 'Notes language')} list="minutes-language-options" value={languageText} disabled={!c.onMinutesSettings || c.busy} onCompositionStart={() => { languageComposing.current = true; }} onCompositionEnd={event => { languageComposing.current = false; setLanguageEdit({ identity: languageIdentity, text: event.currentTarget.value, custom: true }); }} onChange={event => { clearConsent(); setLanguageEdit({ identity: languageIdentity, text: event.target.value, custom: true }); }} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); applyLanguage(); } }} /><datalist id="minutes-language-options">{languageOptions.map(({code, name}) => <option key={code} value={code}>{name}</option>)}</datalist></label>
          {languageDirty && <><span className="hint">{t('수정 중인 언어는 초안으로 유지돼요. 적용하면 이 메모의 언어 설정을 저장해요.', 'This language edit is retained as a draft. Apply to save this memo’s language setting.')}</span><div className="actions"><button disabled={!c.onMinutesSettings || c.busy || !languageText.trim()} onClick={applyLanguage}>{t('언어 적용', 'Apply language')}</button><button disabled={c.busy} onClick={() => { clearConsent(); setLanguageEdit({ identity: languageIdentity, text: settings.outputLanguage, custom: !followsApp && isCustomLanguage }); }}>{t('언어 수정 취소', 'Discard language edit')}</button></div></>}
      </div>}
      <div className="stack"><span className="field-label">{t('포함할 항목 · 순서', 'Sections · order')}</span><div className="section-order">{sections.map(section => { const index = settings.sections.indexOf(section); const name = t(...sectionNames[section]); return <div key={section} className={index >= 0 ? 'enabled' : ''}><label className="checkbox-line"><input type="checkbox" aria-label={name} checked={index >= 0} disabled={!c.onMinutesSettings || c.busy} onChange={() => change({ sections: index >= 0 ? settings.sections.filter(item => item !== section) : [...settings.sections, section] })} /><span>{name}</span></label><button className="plain order-button" aria-label={`${t('위로 이동', 'Move')} ${name} ${t('', 'up')}`} disabled={!c.onMinutesSettings || c.busy || index <= 0} onClick={() => move(section, -1)}><ChevronUp aria-hidden="true" /></button><button className="plain order-button" aria-label={`${t('아래로 이동', 'Move')} ${name} ${t('', 'down')}`} disabled={!c.onMinutesSettings || c.busy || index < 0 || index >= settings.sections.length - 1} onClick={() => move(section, 1)}><ChevronDown aria-hidden="true" /></button></div>; })}</div></div>
      <label><span className="field-label">{t('추가 작성 지침', 'Extra instructions')}</span><textarea autoComplete="off" rows={3} placeholder={t('예: 확인된 액션 아이템을 표로 정리해 주세요', 'e.g. Put confirmed action items in a table')} value={settings.instructions} disabled={!(c.onMinutesInstructions || c.onMinutesSettings) || (c.busy && !c.minutesInstructionsSaving)} onCompositionStart={() => { instructionsComposing.current = true; }} onCompositionEnd={event => { instructionsComposing.current = false; clearConsent(); c.onMinutesInstructions?.(p.id, event.currentTarget.value, false); }} onChange={event => { clearConsent(); if (c.onMinutesInstructions) c.onMinutesInstructions(p.id, event.target.value, instructionsComposing.current); else change({ instructions: event.target.value }); }} /></label>
      <div className="stack gap12"><label>{t('정리 분량', 'Notes length')}<select value={customBudget ? '__custom' : budgetText} disabled={!c.onMinutesSettings || c.busy} onChange={event=>{
        clearConsent();
        if(event.target.value==='__custom')setBudgetEdit({identity:budgetIdentity,text:budgetText,custom:true});
        else {setBudgetEdit({identity:budgetIdentity,text:event.target.value,custom:false});change({outputTokens:Number(event.target.value)});}
      }}><option value="" disabled>{t('분량을 선택하세요','Choose a length')}</option>{[[4096,t('4K · 짧게','4K · Short')],[8192,t('8K · 자세히','8K · Detailed')],[16384,t('16K · 길게','16K · Long')]].map(([value,label])=><option key={value} value={value} disabled={Number(value)>budgetLimit}>{label}</option>)}<option value="__custom">{t('직접 입력','Custom')}</option></select></label>
        <span className="hint">{t('만들 답변의 최대 길이예요. 크게 고르면 더 긴 정리를 담을 수 있고, 시간과 비용이 늘 수 있어요. 실제 분량은 원문·지침·언어에 따라 달라요.', 'The number sets a maximum, not a target. Higher values allow longer notes and may take more time and cost more. Actual length depends on the transcript, instructions and language.')}</span>
        {Number.isFinite(budgetLimit)&&budgetLimit<16384&&<span className="hint">{t(`현재 모델 설정에서는 최대 ${budgetLimit.toLocaleString()}까지 사용할 수 있어요. 더 큰 선택지는 다른 모델이나 모델 설정을 확인하세요.`,`This model is configured for up to ${budgetLimit.toLocaleString()}. Review the model or its settings for larger choices.`)}</span>}
        {customBudget&&<label>{t('직접 입력 · 토큰','Custom maximum · tokens')}<input type="number" min={1} max={Math.min(1000000,budgetLimit)} step={1} value={budgetText} disabled={!c.onMinutesSettings || c.busy} onChange={event=>{clearConsent();setBudgetEdit({identity:budgetIdentity,text:event.target.value,custom:true});}} /></label>}
        {budgetDirty&&customBudget&&<><span className={budgetValid?'hint':'warning'}>{budgetValid?t('적용하면 이 메모의 분량 설정을 저장해요.','Apply to save this memo’s length setting.'):t('현재 모델에서 사용할 수 있는 범위의 양의 정수를 입력하세요.','Enter a positive whole number supported by the current model.')}</span><div className="actions"><button disabled={c.busy||!budgetValid||!c.onMinutesSettings} onClick={()=>change({outputTokens:budget})}>{t('분량 적용','Apply length')}</button><button disabled={c.busy} onClick={()=>{clearConsent();setBudgetEdit({identity:budgetIdentity,text:savedBudget?.toString()??'',custom:!presetBudget});}}>{t('수정 취소','Discard length edit')}</button></div></>}
      </div>
      {!c.comparisonOpen && <>
      <ModelDetails preview={c.minutesSelection} language={c.preferences.uiLanguage} showIdentity={false} />
      <span className="hint">{t('청크 겹침과 경계의 전사 차이는 정리 노트 생성 시 문맥에 맞춰 함께 정리해요. 원본 전사는 보존해요.', 'Intentional chunk overlap and boundary wording are reconciled during notes generation. Original transcripts are preserved.')}</span>
      <div className="generation-disclosure stack"><strong>{t('전송 전 확인', 'Before sending')}</strong><span className="hint">{registration?t(`선택한 전사문과 작성 설정을 ${new URL(registrationEndpoint(registration)).host}에 전송해요.`,`The selected transcript and writing settings go to ${new URL(registrationEndpoint(registration)).host}.`):model?.provider==='openrouter'?t(`선택한 전사문과 작성 설정을 OpenRouter${destination?` 및 ${destination}`:''}에 전송해요.`,`The selected transcript and writing settings go to OpenRouter${destination?` and ${destination}`:''}.`):model?.provider==='openai'?t('선택한 전사문과 작성 설정을 OpenAI에 전송해요.','The selected transcript and writing settings go to OpenAI.'):t('모델을 선택하면 전송 대상을 확인할 수 있어요.','Choose a model to review the destination.')}</span><span className="hint">{t('제공사 요금과 보관·학습 정책이 적용돼요. 로컬 암호화는 외부 보관을 제어하지 않아요.','Provider charges and retention/training policies apply. Local encryption does not control provider retention.')}</span><label className="checkbox-line"><input type="checkbox" checked={consent} disabled={c.busy || c.minutesGenerating} onChange={event => setAcknowledgments({ snapshotIdentity, transmission: event.target.checked, partial: partialConsent })} /><span>{t('선택한 전사문과 설정이 전송되고 요금이 발생할 수 있다는 것을 확인했어요. 음성은 다시 보내지 않아요.', 'I understand that the selected transcript and settings will be sent, and charges may apply. Audio will not be sent again.')}</span></label>{incomplete && <label className="checkbox-line"><input type="checkbox" checked={partialConsent} disabled={c.busy || c.minutesGenerating} onChange={event => setAcknowledgments({ snapshotIdentity, transmission: consent, partial: event.target.checked })} /><span>{t('누락을 표시한 부분 정리 노트 생성을 확인했어요', 'I reviewed generation of partial notes with missing ranges disclosed')}</span></label>}</div>
      {generationReason&&<span id="minutes-generation-readiness" role="status" aria-label={t('생성 가능 여부','Generation readiness')} className="hint">{generationReason}</span>}
      <div className="actions align-end"><button className="primary tall" aria-describedby={generationReason?'minutes-generation-readiness':undefined} disabled={!canGenerate} onClick={generate}>{c.minutesGenerating ? t('생성 중…', 'Generating…') : selected ? t('이 설정으로 다시 생성', 'Regenerate with these settings') : t('정리 노트 생성', 'Generate notes')}</button></div>
      </>}
      {c.comparisonOpen && <ComparisonControls controller={c} project={p} dirty={dirty || settingsDirty} />}
    </section></div></div>
    <div ref={results} className="stack gap12 minutes-results"><div className="row-between"><strong>{t('정리 결과', 'Notes result')}</strong><button className={c.comparisonOpen ? 'selected' : ''} aria-pressed={!!c.comparisonOpen} disabled={!c.onComparisonView || c.busy} onClick={() => c.onComparisonView?.(p.id, !c.comparisonOpen)}>{t('모델 비교', 'Compare models')}</button></div>
      {c.comparisonOpen && <ComparisonResults controller={c} project={p} dirty={dirty || settingsDirty} />}
      {!!missing.length && <div className="warning">{t('선택 전사에 포함되지 않은 구간:', 'Ranges not included in the selected transcript:')} {missing.map(([start, end]) => `${formatTime(start)}–${formatTime(end)}`).join(', ')} {t('실패·미전사 청크와 선택한 전사 버전을 확인하세요. 청크 겹침은 누락이 아니에요.', 'Check failed or untranscribed chunks and the selected transcript version. Chunk overlap is not missing speech.')}</div>}
      {!selected ? <div className="card empty minutes-empty"><strong>{c.minutesGenerating ? t('정리 노트를 만드는 중이에요', 'Generating notes') : t('아직 생성한 정리 노트가 없어요', 'No notes yet')}</strong><span>{t('설정을 고른 뒤 정리 노트를 생성하세요.', 'Choose settings, then generate notes.')}</span>{c.minutesGenerating && <progress aria-label={t('정리 노트 생성', 'Notes generation')} />}</div> : <>
        <div className="row-between wrap"><span className="mono muted">{run ? [resultModel, run.returnedModel && run.returnedModel !== run.requestedModel ? run.returnedModel : null, run.usage.inputTokens != null ? `${t('입력', 'input')} ${run.usage.inputTokens}` : null, run.usage.outputTokens != null ? `${t('출력', 'output')} ${run.usage.outputTokens}` : null].filter(Boolean).join(' · ') : t('선택된 수정본', 'Selected revision')}</span><div className="actions"><div className="segmented"><button className={view === 'preview' ? 'selected' : ''} aria-pressed={view === 'preview'} onClick={() => setView('preview')}>{t('미리보기', 'Preview')}</button><button className={view === 'edit' ? 'selected' : ''} aria-pressed={view === 'edit'} disabled={!c.onEditMinutes || c.busy} onClick={() => setView('edit')}>{t('편집', 'Edit')}</button></div><button disabled={!canExport || !c.onCopyMinutes} onClick={() => c.onCopyMinutes?.(p.id, selected.id)}>{t('Markdown 복사', 'Copy Markdown')}</button><button className="primary" disabled={!canExport || !c.onDownloadMinutes} onClick={() => c.onDownloadMinutes?.(p.id, selected.id)}>{t('.md 다운로드', 'Download .md')}</button></div></div>
        {p.minutesRevisions.length > 1 && <label className="revision-picker">{t('정리 노트 버전', 'Notes revision')}<select value={selected.id} disabled={!c.onSelectMinutes || dirty || settingsDirty || c.busy} onChange={event => c.onSelectMinutes?.(p.id, event.target.value)}>{p.minutesRevisions.map((revision, index) => <option key={revision.id} value={revision.id}>{index + 1} · {revision.parentId ? t('수정본', 'Edited') : t('생성 원본', 'Generated')}</option>)}</select></label>}
        {run && JSON.stringify(run.settings) !== JSON.stringify(effectiveSettings) && <div className="notice">{t('설정이 바뀌었어요. 재생성하면 같은 전사문으로 새 결과를 만들어요.', 'Settings changed. Regenerate to create a new result from the same transcript.')}</div>}
        <section className="card minutes-output">{view === 'edit' ? <div className="stack"><textarea autoComplete="off" className="markdown-editor" aria-label={t('Markdown 편집기', 'Markdown editor')} value={draft} onChange={event => setDraft(event.target.value)} /><div className="actions"><button className="primary" aria-label={t('정리 노트 수정 저장', 'Save notes edit')} disabled={!dirty || !draft.trim() || !c.onEditMinutes || c.busy} onClick={() => c.onEditMinutes?.(p.id, selected.id, draft)}>{t('수정본 저장', 'Save revision')}</button><button disabled={!dirty} onClick={() => setDraft(selected.markdown)}>{t('수정 취소', 'Discard edits')}</button></div></div> : <MarkdownPreview markdown={selected.markdown} />}</section>
        {dirty && <div className="notice">{t('미저장 수정본이 있어요. 저장한 다음 복사하거나 다운로드하세요.', 'Unsaved edits are present. Save the revision before copying or downloading.')}</div>}
        <span className="hint">{t('복사·다운로드한 텍스트는 보관함 밖의 평문이에요.', 'Copied or downloaded text is plaintext outside the vault.')}</span>{c.exportUnavailableReason && <span className="hint">{c.exportUnavailableReason}</span>}
      </>}
    {!!(p.runs.length || p.minutesRuns.length || p.rawTranscripts.length) && <UsageStatement project={p} language={c.preferences.uiLanguage} />}
    </div>
  </div>
  </div>;
}
