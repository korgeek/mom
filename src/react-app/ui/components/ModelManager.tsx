import type { ModelRegistryMetadata, ModelRegistryRoute } from '../../domain/types';
import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { curatedModelEvidence, projectMinutesShortlist, SHORTLIST_SOURCE } from '../../providers/model-shortlist';
import { routeBlock } from '../../providers/model-presentation';

export type ModelManagementRow = Readonly<{
  key: string; route: ModelRegistryRoute; metadata: ModelRegistryMetadata; alias: string | null; developer: string | null;
  userEnabled: boolean; isDefault: boolean; status: 'new' | 'current' | 'stale' | 'unavailable'; blockedReason: string | null;
  metadataAcceptanceRequired: boolean; mayLoadEndpoints: boolean; catalogListedAt?: string | null;
}>;
export type ModelSelectionSubmission = Readonly<{
  baseRevision: number; changes: readonly Readonly<{ key: string; enabled: boolean }>[];
  defaultChanges?: readonly Readonly<{ stage: 'stt' | 'minutes'; key: string }>[];
}>;
export type ModelManagerProps = Readonly<{
  onPrepareSelection?: (provider: ModelRegistryRoute['provider']) => Promise<void>;
  revision?: number; onApplySelection?: (submission: ModelSelectionSubmission) => Promise<void>;
  rows: readonly ModelManagementRow[]; language: 'ko' | 'en'; busy: boolean;
  discoveryAvailability: Readonly<{ openai: boolean; openrouter: boolean }>; error?: string | null; statusText?: string | null;
  onDiscover?: (provider: ModelRegistryRoute['provider'], stage: ModelRegistryRoute['stage']) => void;
  onLoadEndpoints?: (route: ModelRegistryRoute) => void;
  onEnabled?: (key: string, enabled: boolean) => void;
  onAlias?: (key: string, alias: string | null) => void;
  onDefault?: (stage: ModelRegistryRoute['stage'], key: string) => void;
  onAcceptMetadata?: (key: string, reviewedRevision: number) => void;
}>;

const PAGE_SIZE = 20;
const routerSTTIds = ['openai/gpt-4o-mini-transcribe', 'openai/whisper-large-v3'];
const sttPriority = (row: ModelManagementRow) => row.route.provider === 'openrouter' && routerSTTIds.includes(row.route.modelId) ? routerSTTIds.indexOf(row.route.modelId) : 2;
const aliasBytes = (value: string) => new TextEncoder().encode(value).byteLength;
function minimum(value: string): number | null | 'invalid' {
  if (!value.trim()) return null;
  const count = Number(value);
  return Number.isSafeInteger(count) && count > 0 ? count : 'invalid';
}
function capacityMatches(value: number | null, required: ReturnType<typeof minimum>) {
  return required === null || required !== 'invalid' && value !== null && Number.isFinite(value) && value >= required;
}
function defaultEligible(row: ModelManagementRow) {
  return row.status === 'current' && row.userEnabled && routeBlock(row) === null;
}

function ModelRow({ row, controls }: { row: ModelManagementRow; controls: ModelManagerProps }) {
  const { language, busy, onEnabled, onAlias, onDefault, onAcceptMetadata, onLoadEndpoints } = controls;
  const t = (ko: string, en: string) => language === 'ko' ? ko : en; const unknown = t('확인 불가', 'Unknown');
  const [draft, setDraft] = useState({ saved: row.alias, value: row.alias ?? '' });
  // A supplied saved alias is authoritative; an unsaved draft never changes route identity.
  if (draft.saved !== row.alias) setDraft({ saved: row.alias, value: row.alias ?? '' });
  const value = draft.saved === row.alias ? draft.value : row.alias ?? '';
  const alias = value.trim() || null; const tooLong = aliasBytes(alias ?? '') > 256;
  const aliasId = useId(); const block = routeBlock(row);
  const canToggle = !busy && !!onEnabled && (row.userEnabled || block === null);
  const canAlias = !busy && !!onAlias && !tooLong && alias !== row.alias;
  const canDefault = !busy && !!onDefault && defaultEligible(row);
  const canAccept = !busy && Number.isSafeInteger(controls.revision) && !!onAcceptMetadata && row.metadataAcceptanceRequired && ['new', 'current'].includes(row.status);
  const canLoad = !busy && !!onLoadEndpoints && row.mayLoadEndpoints;
  const price = { zero: t('카탈로그 0 요금', 'Known catalog zero'), priced: t('카탈로그 유료 항목', 'Catalog nonzero rate'), unknown: t('요금 확인 불가', 'Unknown pricing') }[row.metadata.pricing.kind];
  const status = { new: t('새 경로 · 비활성 기본', 'New route · disabled by default'), current: t('현재 메타데이터', 'Current metadata'), stale: t('새로고침 실패 · 이전 메타데이터', 'Refresh failed · stale metadata'), unavailable: t('현재 사용 불가', 'Currently unavailable') }[row.status];
  const candidate = row.route.stage === 'minutes' ? curatedModelEvidence(row.route.modelId, row.route.provider) : null;
  const basis = row.isDefault ? t('저장된 기본 경로', 'Saved default route') : row.userEnabled ? t('저장된 활성 경로', 'Saved enabled route') : row.route.stage === 'stt' && row.route.provider === 'openrouter' && routerSTTIds.includes(row.route.modelId) ? t('문서화된 전사 호환 경로 · 실제 추론 미확인', 'Documented transcription compatibility · live inference unverified') : candidate ? t('날짜가 명시된 사용량 목록의 후보', 'Candidate from the dated usage subset') : t('전체 카탈로그 경로', 'Full catalog route');
  return <article role="listitem" aria-label={`${row.route.provider} · ${row.route.stage} · ${row.route.connectionId} · ${row.route.modelId} · ${row.route.endpointTag ?? 'none'}`} className="card stack gap12">
    <div className="row-between wrap"><h3 className="file-name">{row.alias ?? row.metadata.name}</h3><span className="badge">{status}</span></div>
    <span className="mono model-route">{row.route.provider} · {row.route.stage} · {row.route.connectionId}</span>
    <span className="mono model-route">{t('실제 모델 ID', 'Actual model ID')}: {row.route.modelId}</span>
    <span className="mono model-route">{t('엔드포인트', 'Endpoint')}: {row.route.stage === 'stt' && row.route.provider === 'openrouter' ? t('OpenRouter가 처리 제공사를 동적으로 선택해요', 'OpenRouter dynamically selects the processor') : row.route.endpointTag ?? t('명시적 엔드포인트 없음', 'No explicit endpoint')}</span>
    <span className="hint">{basis}</span>
    <span className="hint">{price} · {row.route.stage === 'minutes' ? <>{t('컨텍스트', 'Context')}: {row.metadata.limits.contextTokens ?? unknown} · {t('최대 출력 토큰', 'Max output tokens')}: {row.metadata.limits.maxOutputTokens ?? unknown}</> : <>{t('청크 바이트 한도', 'Chunk byte limit')}: {row.metadata.limits.maxBytes ?? unknown}</>}</span>
    {block && <div className="warning">{t('사용 차단 사유', 'Blocked reason')}: {block}. {t('지원되지 않는 경로는 키 오류를 뜻하지 않아요.', 'An unsupported route does not imply a key failure.')}</div>}
    {row.metadataAcceptanceRequired && <span className="warning">{t('변경된 요금·한도·기능을 확인하고 별도로 수락하세요.', 'Review and explicitly accept changed prices, limits and capabilities.')}</span>}
    <label className="checkbox-line"><input type="checkbox" checked={row.userEnabled} disabled={!canToggle} onChange={event => { if (canToggle) onEnabled?.(row.key, event.target.checked); }} /><span>{t('이 경로 활성화', 'Enable this route')}</span></label>
    <div className="actions wrap">
      {row.metadataAcceptanceRequired && <button disabled={!canAccept} onClick={() => { if (canAccept) onAcceptMetadata?.(row.key, controls.revision!); }}>{t('변경 메타데이터 수락', 'Accept changed metadata')}</button>}
      {row.mayLoadEndpoints && <button disabled={!canLoad} onClick={() => { if (canLoad) onLoadEndpoints?.(row.route); }}>{t('엔드포인트 불러오기', 'Load endpoints')}</button>}
    </div>
    <details className="usage-stage-details"><summary>{t('자세히 보기 · 메타데이터', 'Details · metadata')}</summary><div className="stack gap12">
      <label><span className="field-label">{t('표시 별칭', 'Display alias')}</span><input autoComplete="off" placeholder={row.metadata.name} maxLength={256} value={value} aria-describedby={aliasId} disabled={busy || !onAlias} onChange={event => setDraft({ saved: row.alias, value: event.target.value })} /></label>
      <span id={aliasId} className={tooLong ? 'warning' : 'hint'}>{tooLong ? t('별칭은 UTF-8 256바이트 이하여야 해요.', 'Alias must fit 256 UTF-8 bytes.') : t('비우면 실제 모델 이름을 사용해요. 저장 전에는 이 화면의 초안이에요.', 'Clear to use the actual model name. Until Save, this is a local draft.')}</span>
      <div className="actions wrap"><button disabled={!canAlias} onClick={() => { if (canAlias) onAlias?.(row.key, alias); }}>{t('별칭 저장', 'Save alias')}</button>
        <button disabled={!canDefault} onClick={() => { if (canDefault) onDefault?.(row.route.stage, row.key); }}>{row.isDefault ? t('이 단계 기본 모델', 'Default for this stage') : t('단계 기본 모델로', 'Use as stage default')}</button></div>
      {candidate && <span className="hint">{t('선정 근거', 'Selection basis')}: {basis} · {t('주간 사용량 스냅샷 위치', 'Weekly usage snapshot position')}: {candidate.weeklyPosition} · {SHORTLIST_SOURCE.checkedAt}</span>}
      <dl className="facts"><dt>{t('실제 모델 이름', 'Actual model name')}</dt><dd>{row.metadata.name}</dd>
        <dt>{t('카탈로그 소유자 / 네임스페이스', 'Catalog owner / namespace')}</dt><dd>{row.developer ?? unknown}</dd>
        <dt>{t('모델 출처', 'Model source')}</dt><dd>{row.metadata.source}</dd><dt>{t('확인 시각', 'Checked at')}</dt><dd>{row.metadata.checkedAt}</dd>
        <dt>{t('엔드포인트 출처', 'Endpoint source')}</dt><dd>{row.metadata.endpointSource ?? unknown}</dd><dt>{t('엔드포인트 확인 시각', 'Endpoint checked at')}</dt><dd>{row.metadata.endpointCheckedAt ?? unknown}</dd>
        <dt>{t('입력 / 출력 형식', 'Input / output modalities')}</dt><dd>{row.metadata.inputModalities.join(', ') || unknown} / {row.metadata.outputModalities.join(', ') || unknown}</dd>
        <dt>{t('청크 바이트 한도', 'Chunk byte limit')}</dt><dd>{row.metadata.limits.maxBytes ?? unknown}</dd><dt>{t('컨텍스트 토큰', 'Context tokens')}</dt><dd>{row.metadata.limits.contextTokens ?? unknown}</dd>
        <dt>{t('입력 / 출력 토큰 한도', 'Prompt / output token limits')}</dt><dd>{row.metadata.limits.maxPromptTokens ?? unknown} / {row.metadata.limits.maxOutputTokens ?? unknown}</dd>
        {row.route.stage === 'minutes' && row.route.endpointTag && row.metadata.limits.maxPromptTokens === null && <><dt>{t('입력 예산 추정', 'Input budget estimate')}</dt><dd>{t('미확인 엔드포인트 입력 한도. 공개 모델·엔드포인트의 작은 컨텍스트에서 출력 예산을 빼서 보수적으로 추정하며 제공사가 거절할 수 있어요.', 'Unknown endpoint prompt cap. Fit is conservatively estimated from the smaller published model/endpoint context minus reserved output; the provider may reject it.')}</dd></>}
        <dt>{t('출력 한도 매개변수', 'Output ceiling parameter')}</dt><dd>{row.metadata.completionParameter ?? unknown}</dd>
        <dt>{t('모델 / 엔드포인트 매개변수', 'Model / endpoint parameters')}</dt><dd>{row.metadata.modelSupportedParameters.join(', ') || unknown} / {row.metadata.endpointSupportedParameters.join(', ') || unknown}</dd>
      </dl>
      <span className="hint">{t('소유자·네임스페이스는 전달받은 카탈로그 정보이며 실제 제작자나 실행 제공사를 검증하지 않아요.', 'Supplied catalog owner / namespace is not a verified creator or execution provider.')}</span>
      {row.metadata.pricing.snapshot ? <div className="stack"><strong>{t('표시 요금 · 실제 청구 아님', 'Advertised rates · not actual billing')}</strong><span>{row.metadata.pricing.snapshot.currency} · {row.metadata.pricing.snapshot.source} · {row.metadata.pricing.snapshot.checkedAt}</span>
        {row.metadata.pricing.snapshot.rates.map((rate, index) => <span key={index} className="mono">{rate.price} / {rate.units} {rate.unit}</span>)}</div> : <span>{t('요금 상세 확인 불가', 'Rate details unavailable')}</span>}
      {!!row.metadata.pricing.missingDimensions.length && <span>{t('누락 요금 항목', 'Missing rate dimensions')}: {row.metadata.pricing.missingDimensions.join(', ')}</span>}
      {!!row.metadata.pricing.unsupportedDimensions.length && <span>{t('지원하지 않는 요금 항목', 'Unsupported rate dimensions')}: {row.metadata.pricing.unsupportedDimensions.join(', ')}</span>}
      {!!row.metadata.pricing.conditionalDimensions.length && <span>{t('조건부 요금 항목', 'Conditional rate dimensions')}: {row.metadata.pricing.conditionalDimensions.join(', ')}</span>}
      {!!row.metadata.blockers.length && <span>{t('기능 차단', 'Capability blockers')}: {row.metadata.blockers.join('; ')}</span>}
      {!!row.metadata.warnings.length && <span>{t('메타데이터 주의', 'Metadata warnings')}: {row.metadata.warnings.join('; ')}</span>}
      {row.metadata.description && <div className="stack"><span>{row.metadata.description.text}</span><span className="hint">{row.metadata.description.source} · {row.metadata.description.checkedAt}</span></div>}
      {row.metadata.retirement && <span>{t('종료 안내', 'Retirement notice')}: {row.metadata.retirement.retiredOn} · {row.metadata.retirement.source} · {row.metadata.retirement.checkedAt}</span>}
    </div></details>
  </article>;
}

export function ModelManager(props: ModelManagerProps) {
  const { rows, language, busy, discoveryAvailability, onDiscover, error, statusText } = props;
  const t = (ko: string, en: string) => language === 'ko' ? ko : en; const baseId = useId();
  const [stage, setStage] = useState<ModelRegistryRoute['stage']>('stt'); const [provider, setProvider] = useState('all');
  const [developer, setDeveloper] = useState('all'); const [price, setPrice] = useState('all'); const [query, setQuery] = useState('');
  const [context, setContext] = useState(''); const [output, setOutput] = useState('');
  const [showAll, setShowAll] = useState(false);
  const signature = JSON.stringify([stage, provider, developer, price, query, context, output, showAll]);
  const [pagination, setPagination] = useState({ rows, signature, page: 0 });
  const resetPage = pagination.rows !== rows || pagination.signature !== signature;
  if (resetPage) setPagination({ rows, signature, page: 0 });
  const contextMinimum = minimum(context), outputMinimum = minimum(output);
  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    return rows.filter(row => row.route.stage === stage && (provider === 'all' || row.route.provider === provider)
      && (developer === 'all' || developer === 'unknown' && row.developer === null || developer === `known:${row.developer}`)
      && (price === 'all' || row.metadata.pricing.kind === price)
      && capacityMatches(row.metadata.limits.contextTokens, contextMinimum) && capacityMatches(row.metadata.limits.maxOutputTokens, outputMinimum)
      && [row.alias, row.metadata.name, row.route.modelId, row.developer, row.route.endpointTag].filter(Boolean).join(' ').toLowerCase().includes(search))
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || Number(b.userEnabled) - Number(a.userEnabled) || (stage === 'stt' ? sttPriority(a) - sttPriority(b) : 0) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }, [rows, stage, provider, developer, price, query, contextMinimum, outputMinimum]);
  const fullCatalog = showAll || !!query.trim() || provider !== 'all' || developer !== 'all' || price !== 'all' || !!context.trim() || !!output.trim();
  const visibleRows = useMemo(() => fullCatalog ? filtered : stage === 'stt' ? filtered.filter(row => row.route.provider === 'openai' || row.userEnabled || row.isDefault || routerSTTIds.includes(row.route.modelId)) : projectMinutesShortlist(filtered, row => ({
    ...row.route, key: row.key, userEnabled: row.userEnabled, isDefault: row.isDefault,
    priority: routeBlock(row) === null && row.route.endpointTag ? row.status === 'current' ? 0 : 1 : row.mayLoadEndpoints && ['new', 'current'].includes(row.status) ? 2 : 3,
  })), [filtered, fullCatalog, stage]);
  const pageCount = Math.max(1, Math.ceil(visibleRows.length / PAGE_SIZE));
  const page = resetPage ? 0 : Math.min(pagination.page, pageCount - 1);
  const owners = [...new Set(rows.flatMap(row => row.developer === null ? [] : [row.developer]))].sort();
  const keyboardStage = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (busy || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); const next = event.key === 'Home' ? 'stt' : event.key === 'End' ? 'minutes' : stage === 'stt' ? 'minutes' : 'stt';
    setStage(next); event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-stage="${next}"]`)?.focus();
  };
  return <section className="stack gap16" aria-label={t('중앙 모델 관리', 'Central model management')}>
    <h3>{t('모델 관리', 'Model management')}</h3>
    <div role="tablist" aria-label={t('처리 단계', 'Processing stage')} className="segmented">{(['stt', 'minutes'] as const).map(id => <button key={id} id={`${baseId}-${id}`} data-stage={id} role="tab" aria-selected={stage === id} aria-controls={`${baseId}-results`} tabIndex={stage === id ? 0 : -1} disabled={busy} onClick={() => setStage(id)} onKeyDown={keyboardStage}>{id === 'stt' ? t('전사', 'STT') : t('정리 노트', 'Notes')}</button>)}</div>
    <div className="card stack gap12"><strong>{t('제공사 목록 확인', 'Provider discovery')}</strong>
      <span className="hint">{t('OpenRouter는 공개 카탈로그를 키 없이 조회해요.', 'OpenRouter lists a public keyless catalog.')}</span>
      <span className="hint">{t('OpenAI 모델 목록은 인증이 필요해요. 요청 시 설정에서 직접 키를 입력하세요.', 'OpenAI uses authenticated model listing; enter the key in Settings only when requested.')}</span>
      <span className="hint">{t('목록 조회는 추론 권한을 증명하지 않아요. 요금 표시가 요청 비용을 보장하지 않아요.', 'Listing does not prove inference permission. Catalog rates do not guarantee a request cost.')}</span>
      <div className="actions wrap">{(['openai', 'openrouter'] as const).map(id => { const available = !busy && !!onDiscover && discoveryAvailability[id]; return <button key={id} disabled={!available} onClick={() => { if (available) onDiscover?.(id, stage); }}>{id === 'openai' ? t('OpenAI 목록 조회', 'Discover OpenAI') : t('OpenRouter 목록 조회', 'Discover OpenRouter')}</button>; })}</div>
      {error && <div className="error" role="alert">{error}</div>}{statusText && <span role="status">{statusText}</span>}
    </div>
    <div role="tabpanel" id={`${baseId}-results`} aria-labelledby={`${baseId}-${stage}`} className="stack gap16">
      {rows.filter(row => row.route.stage === stage && row.isDefault).map(row => <div key={row.key} className={`model-default-notice ${defaultEligible(row) ? 'notice' : 'warning'}`}>{defaultEligible(row) ? t('저장된 기본 모델', 'Saved stage default') : t('저장된 기본 모델 사용 불가', 'Saved default is blocked')}: {row.alias ?? row.metadata.name} · {row.route.provider} · {row.route.modelId} · {row.route.endpointTag ?? t('명시적 엔드포인트 없음', 'No explicit endpoint')}{!defaultEligible(row) && <> · {routeBlock(row) ?? t('현재 활성 경로가 필요해요', 'A current enabled route is required')}</>}</div>)}
      {stage === 'stt' && <div className="row-between wrap"><span className="hint">{t('OpenRouter 전사는 Mini와 Whisper의 문서화된 호환 경로와 저장된 선택을 먼저 보여줘요. 목록 조회는 경로를 활성화하거나 기본값을 바꾸지 않아요.', 'OpenRouter transcription shows documented Mini and Whisper routes and saved choices first. Discovery never enables a route or changes a default.')}</span><button disabled={busy} onClick={() => setShowAll(!showAll)}>{showAll ? t('간단한 목록 보기', 'Show shortlist') : t('전체 모델 보기', 'Show all models')}</button></div>}
      {stage === 'minutes' && <>
        <div className="row-between wrap"><span className="hint">{t('저장된 경로와 최대 5개 선정 후보를 먼저 보여줘요. 검색·필터는 전체 카탈로그에 적용돼요.', 'Saved routes and up to five selected candidates appear first. Search and filters cover the full catalog.')}</span><button disabled={busy} onClick={() => setShowAll(!showAll)}>{showAll ? t('간단한 목록 보기', 'Show shortlist') : t('전체 모델 보기', 'Show all models')}</button></div>
        <details className="usage-stage-details"><summary>{t('자세히 보기 · 선정 기준', 'Details · shortlist basis')}</summary><div className="stack gap12">
          <span className="hint">{t('주간 토큰 사용량 상위 20개에서 고른 5개 후보를 현재 카탈로그와 대조해 보여줘요. 이 5개가 전체 상위 5개라는 뜻은 아니에요. 품질·정확도·정리 노트 성능 순위가 아니며 실시간 순위나 추론 검증도 아니에요.', 'Five candidates selected from the weekly token-usage top 20 are intersected with the current catalog. These are not the global top five. This is not a quality, accuracy or voice memo-performance ranking, a live ranking or inference verification.')}</span>
          <span className="hint">{t('출처', 'Source')}: <a href={SHORTLIST_SOURCE.url} target="_blank" rel="noreferrer">OpenRouter</a> · {t('확인 시각', 'Checked at')}: {SHORTLIST_SOURCE.checkedAt} · <a href={SHORTLIST_SOURCE.licenseUrl} target="_blank" rel="noreferrer">CC BY 4.0</a> · <a href={SHORTLIST_SOURCE.rankingsUrl} target="_blank" rel="noreferrer">{t('사용량 기준', 'Usage methodology')}</a></span>
          <span className="hint">{t('요금·컨텍스트·한도는 현재 전달받은 메타데이터를 표시해요. 요금 확인 불가와 조건부 항목은 그대로 유지하며 :free 이름은 계정·요청 비용 0을 보장하지 않아요. 높은 요금이나 사용량은 품질 우위를 증명하지 않아요.', 'Prices, context and limits use the currently supplied metadata. Unknown and conditional prices stay uncertain; a :free name does not guarantee zero account or request cost. Higher prices or usage do not prove better quality.')}</span>
        </div></details>
      </>}
      <div className="model-picker-tools">
        <label><span className="field-label">{t('모델 검색', 'Search models')}</span><input type="search" autoComplete="off" value={query} disabled={busy} onChange={event => setQuery(event.target.value)} /></label>
        <label><span className="field-label">{t('제공사', 'Provider')}</span><select value={provider} disabled={busy} onChange={event => setProvider(event.target.value)}><option value="all">{t('전체', 'All')}</option><option value="openai">OpenAI</option><option value="openrouter">OpenRouter</option></select></label>
        <label><span className="field-label">{t('카탈로그 소유자 / 네임스페이스', 'Catalog owner / namespace')}</span><select value={developer} disabled={busy} onChange={event => setDeveloper(event.target.value)}><option value="all">{t('전체', 'All')}</option><option value="unknown">{t('확인 불가', 'Unknown')}</option>{owners.map(owner => <option key={owner} value={`known:${owner}`}>{owner}</option>)}</select></label>
        <label><span className="field-label">{t('카탈로그 요금', 'Catalog price')}</span><select value={price} disabled={busy} onChange={event => setPrice(event.target.value)}><option value="all">{t('전체', 'All')}</option><option value="zero">{t('확인된 0 요금', 'Known zero')}</option><option value="priced">{t('유료 항목 있음', 'Nonzero rate')}</option><option value="unknown">{t('확인 불가', 'Unknown')}</option></select></label>
        <label><span className="field-label">{t('최소 컨텍스트 토큰', 'Minimum context tokens')}</span><input type="number" min={1} step={1} value={context} disabled={busy} onChange={event => setContext(event.target.value)} /></label>
        <label><span className="field-label">{t('최소 출력 토큰', 'Minimum output tokens')}</span><input type="number" min={1} step={1} value={output} disabled={busy} onChange={event => setOutput(event.target.value)} /></label>
      </div>
      {(contextMinimum === 'invalid' || outputMinimum === 'invalid') && <span className="warning" role="alert">{t('최소 한도는 양의 정수로 입력하세요.', 'Enter positive whole-number minimum capacities.')}</span>}
      <span role="status" className="hint">{t(`${visibleRows.length}개 경로 · ${page + 1}/${pageCount} 페이지`, `${visibleRows.length} routes · Page ${page + 1} of ${pageCount}`)}</span>
      <div role="list" aria-label={t('모델 경로', 'Model routes')} className="stack gap12">{visibleRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(row => <ModelRow key={row.key} row={row} controls={props} />)}</div>
      {!visibleRows.length && <span className="empty">{stage === 'minutes' && !fullCatalog ? t('현재 카탈로그에 선정 후보가 없어요. 전체 모델 보기에서 경로를 찾아보세요.', 'No shortlist candidates are in this catalog. Use Show all models to find a route.') : t('조건에 맞는 경로가 없어요.', 'No matching routes.')}</span>}
      <div className="actions wrap"><button disabled={busy || page === 0} onClick={() => setPagination({ rows, signature, page: page - 1 })}>{t('이전 페이지', 'Previous page')}</button><button disabled={busy || page + 1 >= pageCount} onClick={() => setPagination({ rows, signature, page: page + 1 })}>{t('다음 페이지', 'Next page')}</button></div>
    </div>
  </section>;
}
export default ModelManager;
