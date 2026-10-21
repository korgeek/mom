import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { compactModelPresentation, routeBlock } from '../../providers/model-presentation';
import { FIRST_USE_MINUTES_ROUTES, projectMinutesShortlist } from '../../providers/model-shortlist';
import type { ModelManagementRow, ModelManagerProps } from './ModelManager';

type Provider = ModelManagementRow['route']['provider'];
type Stage = ModelManagementRow['route']['stage'];
function firstSetup(rows: ModelManagerProps['rows'], row: ModelManagementRow) {
  return !rows.some(other => other.route.provider === row.route.provider && other.route.stage === row.route.stage && (other.status !== 'new' || other.isDefault));
}
type SelectionDraft = { revision: ModelManagerProps['revision']; rows: ModelManagerProps['rows']; values: Map<string, boolean>; recommended: Set<string>; defaults: Map<Stage, string>; reviewedProviders: Set<Provider> };
function reviewProvider(draft: SelectionDraft, provider: Provider): SelectionDraft {
  if (draft.reviewedProviders.has(provider)) return draft;
  const values = new Map(draft.values), recommended = new Set(draft.recommended), defaults = new Map(draft.defaults);
  for (const row of draft.rows.filter(row => row.route.provider === provider)) {
    // Saved entries (including an explicit false) make this provider/stage an existing setup.
    const newSet = firstSetup(draft.rows, row);
    const initial = newSet && row.status === 'new' && routeBlock(row) === null && (row.route.stage === 'stt' ?
      (row.route.provider === 'openrouter' ? row.route.modelId === 'openai/gpt-4o-mini-transcribe' : row.route.modelId === 'gpt-4o-mini-transcribe') :
      row.route.provider === 'openrouter' && FIRST_USE_MINUTES_ROUTES.some(candidate => candidate.id === row.route.modelId && candidate.tag === row.route.endpointTag));
    if (initial) { values.set(row.key, true); recommended.add(row.key); }
  }
  if (!defaults.has('stt') && !draft.rows.some(row => row.isDefault && row.route.stage === 'stt')) {
    const initial = draft.rows.find(row => row.route.provider === provider && row.route.stage === 'stt' && recommended.has(row.key));
    if (initial) defaults.set('stt', initial.key);
  }
  if (!defaults.has('minutes') && !draft.rows.some(row => row.isDefault && row.route.stage === 'minutes')) {
    const initial = draft.rows.find(row => row.route.provider === provider && row.route.stage === 'minutes' && row.route.modelId === FIRST_USE_MINUTES_ROUTES[0].id && row.route.endpointTag === FIRST_USE_MINUTES_ROUTES[0].tag && recommended.has(row.key));
    if (initial) defaults.set('minutes', initial.key);
  }
  return { ...draft, values, recommended, defaults, reviewedProviders: new Set([...draft.reviewedProviders, provider]) };
}
function makeDraft(props: ModelManagerProps, provider: Provider) {
  return reviewProvider({ revision: props.revision, rows: props.rows, values: new Map(props.rows.map(row => [row.key, row.userEnabled])), recommended: new Set(), defaults: new Map(), reviewedProviders: new Set() }, provider);
}
export default function ModelSelectionModal({ controls, provider: initialProvider, onClose }: { controls: ModelManagerProps; provider: Provider; onClose: () => void }) {
  const t = (ko: string, en: string) => controls.language === 'ko' ? ko : en;
  const [provider, setProvider] = useState(initialProvider), [stage, setStage] = useState<Stage>('stt');
  const [draft, setDraft] = useState(() => makeDraft(controls, initialProvider)); const [showAll, setShowAll] = useState(false), [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  const dialog = useRef<HTMLDivElement>(null), closeButton = useRef<HTMLButtonElement>(null), alive = useRef(false); const id = useId();
  const stale = draft.revision !== controls.revision;
  const busy = controls.busy || saving;
  const canAcceptMetadata = !busy && !stale && Number.isSafeInteger(draft.revision) && !!controls.onAcceptMetadata;
  const canApply = !busy && !stale && typeof draft.revision === 'number' && !!controls.onApplySelection;
  useEffect(() => {
    alive.current = true; const opener = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    // Inert all sibling branches so background controls cannot be reached by keyboard or AT.
    const prior: { element: HTMLElement; inert: boolean }[] = [];
    let branch: HTMLElement | null = dialog.current?.parentElement ?? null;
    while (branch && branch !== document.body) { for (const sibling of branch.parentElement?.children ?? []) if (sibling !== branch && sibling instanceof HTMLElement) { prior.push({ element: sibling, inert: sibling.inert }); sibling.inert = true; } branch = branch.parentElement; }
    closeButton.current?.focus();
    const contain = (event: FocusEvent) => { if (event.target instanceof Node && !dialog.current?.contains(event.target)) closeButton.current?.focus(); };
    document.addEventListener('focusin', contain);
    return () => { alive.current = false; document.removeEventListener('focusin', contain); document.body.style.overflow = previousOverflow; prior.forEach(item => { item.element.inert = item.inert; }); if (opener?.isConnected && !opener.matches(':disabled')) opener.focus(); };
  }, []);
  const close = () => { if (!saving) onClose(); };
  const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key !== 'Tab') return;
    const controls = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),summary,a[href]') ?? [])].filter(element => element.tabIndex >= 0 && !element.closest('details:not([open])') || element.tagName === 'SUMMARY' && !element.parentElement?.parentElement?.closest('details:not([open])'));
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };
  const tabs = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (busy || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); const next = event.key === 'Home' ? 'stt' : event.key === 'End' ? 'minutes' : stage === 'stt' ? 'minutes' : 'stt'; setStage(next);
    event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-stage="${next}"]`)?.focus();
  };
  const apply = async () => {
    if (!canApply) return; setSaving(true); setError('');
    const changes = draft.rows.filter(row => draft.reviewedProviders.has(row.route.provider) && (draft.values.get(row.key) !== row.userEnabled || draft.recommended.has(row.key))).map(row => ({ key: row.key, enabled: draft.values.get(row.key) ?? false }));
    try { await controls.onApplySelection!({ baseRevision: draft.revision!, changes, defaultChanges: [...draft.defaults].map(([stage, key]) => ({ stage, key })) }); if (alive.current) onClose(); }
    catch { if (alive.current) setError(t('선택을 저장하지 못했어요. 초안은 유지돼요. 저장소와 현재 목록을 확인하세요.', 'Selection could not be saved. Your draft remains. Check storage and the current list.')); }
    finally { if (alive.current) setSaving(false); }
  };
  const providerRows = draft.rows.filter(row => row.route.provider === provider && row.route.stage === stage);
  const shortlist = stage === 'minutes' ? projectMinutesShortlist(providerRows, row => ({ ...row.route, key: row.key, userEnabled: row.userEnabled, isDefault: row.isDefault, savedPreference: row.status !== 'new', priority: draft.recommended.has(row.key) ? 0 : routeBlock(row) === null && row.route.endpointTag ? 1 : row.mayLoadEndpoints ? 2 : 3 })) : providerRows.filter(row => row.status !== 'new' || row.isDefault || row.route.provider === 'openai' && routeBlock(row) === null || ['openai/gpt-4o-mini-transcribe', 'openai/whisper-large-v3'].includes(row.route.modelId));
  const shortKeys = new Set(shortlist.map(row => row.key)), shortModels = new Set(shortlist.map(row => row.route.modelId));
  const recommendedModels = new Set(providerRows.filter(row => draft.recommended.has(row.key)).map(row => row.route.modelId));
  // First-use exact recommendations appear immediately; their model-only rows
  // and other endpoints remain reachable through Show all/search. Existing
  // manual endpoint-selection flows keep their loaded alternatives visible.
  const fullCatalog = showAll || !!query.trim();
  const compactRows = stage === 'minutes' && recommendedModels.size ? providerRows.filter(row => draft.recommended.has(row.key)) : providerRows.filter(row => shortKeys.has(row.key) || stage === 'minutes' && shortModels.has(row.route.modelId) && (row.mayLoadEndpoints || row.route.endpointTag));
  const rows = (fullCatalog ? providerRows : compactRows).filter(row => [row.alias, row.metadata.name, row.route.modelId, row.route.endpointTag].join(' ').toLowerCase().includes(query.trim().toLowerCase()));
  return <div className="modal-backdrop model-selection-backdrop"><div ref={dialog} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-disclosure`} className="modal-card model-selection-modal" onKeyDown={keyboard}>
    <header className="stack gap16"><div className="row-between"><h2 id={`${id}-title`}>{t('모델 선택', 'Select models')}</h2><button ref={closeButton} type="button" disabled={saving} onClick={close}>{t('취소', 'Cancel')}</button></div>
      <span id={`${id}-disclosure`} className="hint">{t('음성 전사는 음성을, 글 생성은 선택한 전사문을 보내요. 적용은 모델 선택만 저장해요.', 'Transcription sends audio; text generation sends the selected transcript. Apply saves model choices only.')}</span>
      <label className="model-provider">{t('제공사', 'Provider')}<select value={provider} disabled={busy} onChange={event => { const next = event.target.value as Provider; setDraft(current => reviewProvider(current, next)); setProvider(next); }}><option value="openai">OpenAI</option><option value="openrouter">OpenRouter</option></select></label>
      <div role="tablist" aria-label={t('처리 단계', 'Processing stage')} className="segmented">{(['stt', 'minutes'] as const).map(value => <button key={value} id={`${id}-${value}`} data-stage={value} className={stage === value ? 'selected' : ''} role="tab" aria-selected={stage === value} aria-controls={`${id}-rows`} tabIndex={stage === value ? 0 : -1} disabled={busy} onClick={() => setStage(value)} onKeyDown={tabs}>{value === 'stt' ? t('음성 전사', 'Transcription') : t('글 생성', 'Text generation')}</button>)}</div>
    </header>
    <div className="model-selection-body stack gap16" role="tabpanel" id={`${id}-rows`} aria-labelledby={`${id}-${stage}`}>
      {stale && !saving && <div className="warning stack" role="alert"><span>{t('키나 모델 정보가 바뀌었어요. 최신 목록을 확인한 뒤 사용할 경로를 선택하세요. 현재 초안은 새로 시작해요.', 'Key or model information changed. Review the refreshed list, then select a route. This starts a new draft.')}</span><button type="button" disabled={busy} onClick={() => { setDraft(makeDraft(controls, provider)); setError(''); }}>{t('최신 목록 확인', 'Review refreshed list')}</button></div>}
      {error && <div className="error" role="alert">{error}</div>}
      {controls.error && <div className="error" role="alert">{controls.error}</div>}
      {controls.statusText && <span className="hint" role="status">{controls.statusText}</span>}
      {stage === 'minutes' && provider === 'openai' ? <div className="notice">{t('직접 OpenAI 글 생성은 아직 제공하지 않아요. OpenRouter에서 지원 경로를 선택하세요.', 'Direct OpenAI text generation is not available. Select a supported route through OpenRouter.')}</div> : <>
        <div className="model-list-tools"><input type="search" aria-label={t('모델 검색', 'Search models')} placeholder={t('이름으로 찾기', 'Search by name')} value={query} disabled={busy} onChange={event => setQuery(event.target.value)} /><button type="button" disabled={busy} onClick={() => setShowAll(!showAll)}>{showAll ? t('추천 목록 보기', 'Show shortlist') : t('전체 모델 보기', 'Show all models')}</button></div>
        <span className="hint">{t('지원 후보와 저장된 선택을 먼저 보여요. 검색은 전체 목록에서 찾아요.', 'Supported candidates and saved choices appear first. Search covers the full catalog.')}</span>
        <div role="list" aria-label={t('모델 경로', 'Model routes')} className="stack gap12">{rows.map(row => {
          const view = compactModelPresentation(row, controls.language), block = routeBlock(row), enabled = draft.values.get(row.key) ?? false;
          const canToggle = !busy && !stale && (row.userEnabled || enabled || block === null), defaultKey = draft.defaults.get(stage) ?? draft.rows.find(item => item.isDefault && item.route.stage === stage)?.key;
          return <article key={row.key} role="listitem" aria-label={`${row.route.provider} · ${row.route.stage} · ${row.route.connectionId} · ${row.route.modelId} · ${row.route.endpointTag ?? 'none'}`} className="model-selection-row stack gap12">
            <div className="model-row-summary"><label className="checkbox-line"><input type="checkbox" aria-label={row.alias ?? row.metadata.name} checked={enabled} disabled={!canToggle} onChange={event => { const values = new Map(draft.values), defaults = new Map(draft.defaults); values.set(row.key, event.target.checked); if (!event.target.checked && defaults.get(row.route.stage) === row.key) defaults.delete(row.route.stage); if (event.target.checked && block === null && firstSetup(draft.rows, row) && !defaults.has(row.route.stage) && !draft.rows.some(item => item.isDefault && item.route.stage === row.route.stage)) defaults.set(row.route.stage, row.key); setDraft({ ...draft, values, defaults }); }} /><span><strong>{row.alias ?? row.metadata.name}</strong><span className="hint model-provider-label">{row.route.provider === 'openai' ? 'OpenAI' : 'OpenRouter'}{row.route.endpointTag && ` · ${row.route.endpointTag}`}</span><span className="hint mono model-route">{row.route.modelId}</span></span></label>
              <div className="model-prices">{view.prices.map(price => <span key={price}>{price}</span>)}<span className="hint">{view.priceNote}</span></div>
              <span className="hint">{view.feature}</span><span className="hint">{view.dateLabel}{view.date.kind !== 'unknown' && ` · ${view.date.value.slice(0, 10)}`}</span>
            </div>
            {block && <span className="warning">{row.mayLoadEndpoints ? t('엔드포인트를 불러온 뒤 사용할 경로를 직접 선택하세요.', 'Load endpoints, then explicitly select a route.') : block === 'unsupported-adapter' ? t('MoM에서 아직 지원하지 않는 모델', 'MoM does not support this model yet') : row.status === 'new' ? t('현재 한도나 기능으로는 이 경로를 사용할 수 없어요.', 'This route is unavailable with the current limits or capabilities.') : t('현재 사용할 수 없는 저장된 경로예요. 해제할 수 있어요.', 'This saved route is currently blocked. You can turn it off.')} · {block}</span>}
            {row.mayLoadEndpoints && <button type="button" className="align-start" disabled={busy || !controls.onLoadEndpoints} onClick={() => controls.onLoadEndpoints?.(row.route)}>{t('엔드포인트 불러오기', 'Load endpoints')}</button>}
            {defaultKey === row.key && <span className="hint">{draft.defaults.has(stage) ? t('새 음성 메모 기본값 · 초안', 'Default for new voice memos · draft') : t('저장된 단계 기본값', 'Saved stage default')}</span>}
            <label className="checkbox-line"><input type="radio" name={`${id}-default-${stage}`} checked={defaultKey === row.key} disabled={busy || stale || !enabled || block !== null || !controls.onApplySelection} onChange={() => { const defaults = new Map(draft.defaults); defaults.set(stage, row.key); setDraft({ ...draft, defaults }); }} /><span>{t('새 음성 메모의 단계 기본값으로', 'Use as stage default for new voice memos')}</span></label>
            <details className="usage-stage-details"><summary>{t('추가 정보', 'Additional information')}</summary><div className="stack gap12">
              <dl className="facts"><dt>{t('실제 모델 ID', 'Actual model ID')}</dt><dd>{row.route.modelId}</dd><dt>{t('경로', 'Route')}</dt><dd>{row.route.provider} · {row.route.connectionId} · {row.route.endpointTag ?? t('별도 엔드포인트 없음', 'No separate endpoint')}</dd><dt>{t('모델 출처', 'Model source')}</dt><dd>{row.metadata.source}</dd><dt>{t('확인 시각', 'Checked at')}</dt><dd>{row.metadata.checkedAt}</dd><dt>{t('엔드포인트 출처', 'Endpoint source')}</dt><dd>{row.metadata.endpointSource ?? t('확인 불가', 'Unknown')}</dd><dt>{t('한도', 'Limits')}</dt><dd>{JSON.stringify(row.metadata.limits)}</dd><dt>{t('엔드포인트 입력 한도', 'Endpoint prompt limit')}</dt><dd>{row.metadata.limits.maxPromptTokens ?? t('확인 불가', 'Unknown')}</dd></dl>
              {row.route.stage === 'minutes' && row.route.endpointTag && row.metadata.limits.maxPromptTokens === null && <span className="hint">{t('엔드포인트 입력 한도는 미확인이에요. 공개 모델·엔드포인트 컨텍스트 중 작은 값에서 출력 예산을 뺀 입력 예산으로 보수적으로 추정해요. 제공사가 요청을 거절할 수 있어요.', 'The endpoint prompt cap is unverified. Input fit is conservatively estimated from the smaller published model/endpoint context minus reserved output. The provider may reject the request.')}</span>}
              {view.date.kind === 'released' && <span className="hint">{view.date.source} · {view.date.checkedAt} · {view.date.precision}</span>}
              {draft.recommended.has(row.key) && <span className="hint">{t('새 설정의 초기 호환 후보예요. 품질 순위나 전송 동의가 아니에요.', 'Initial compatible candidate for a new setup. This is not a quality ranking or transmission consent.')}</span>}
              {block && <span className="hint">{t('차단 사유', 'Blocked reason')}: {block}</span>}
              {row.metadataAcceptanceRequired && <button type="button" disabled={!canAcceptMetadata} onClick={() => { if (canAcceptMetadata) controls.onAcceptMetadata?.(row.key, draft.revision!); }}>{t('변경 메타데이터 수락', 'Accept changed metadata')}</button>}
            </div></details>
          </article>;
        })}</div>
        {!rows.length && <div className="stack gap12"><span>{providerRows.length ? t('추천 후보가 없어요. 전체 목록을 보거나 검색하세요.', 'No shortlist candidates. Show all models or search the full catalog.') : t('표시할 모델이 없어요. 목록을 조회하세요.', 'No models to show. Load the model list.')}</span>{!providerRows.length && <><span className="hint">{provider === 'openai' ? t('저장한 키로 모델 목록만 요청해요. 음성이나 전사문은 보내지 않아요.', 'Requests only the model list using your saved key. No audio or transcript is sent.') : t('키 없이 공개 모델 목록만 조회해요.', 'Loads only the public model catalog without a key.')}</span><button type="button" className="align-start" disabled={busy || !controls.onDiscover || !controls.discoveryAvailability[provider]} onClick={() => controls.onDiscover?.(provider, stage)}>{t('모델 목록 조회', 'Load model list')}</button></>}</div>}
      </>}
      <details className="usage-stage-details"><summary>{t('추가 정보 · 목록 조회', 'Additional information · discovery')}</summary><div className="stack gap12"><span className="hint">{provider === 'openai' ? t('OpenAI 목록 조회는 저장한 키로 인증 요청을 보내요. 음성이나 전사문은 보내지 않아요.', 'OpenAI discovery sends an authenticated request using the saved key. No audio or transcript is sent.') : t('OpenRouter 공개 목록은 키 없이 조회해요. 실제 추론 권한을 증명하지 않아요.', 'OpenRouter discovery uses a public keyless catalog. Listing does not prove inference permission.')}</span><button type="button" disabled={busy || !controls.onDiscover || !controls.discoveryAvailability[provider]} onClick={() => controls.onDiscover?.(provider, stage)}>{provider === 'openai' ? t('OpenAI 목록 조회', 'Discover OpenAI') : t('OpenRouter 목록 조회', 'Discover OpenRouter')}</button></div></details>
    </div>
    <footer className="row-between wrap"><span className="hint">{t('취소하면 초안을 버려요. 적용 후에도 전송은 따로 확인해요.', 'Cancel discards the draft. Transmission still needs a separate review.')}</span><button type="button" className="primary" disabled={!canApply} onClick={() => void apply()}>{saving ? t('저장 중…', 'Saving…') : t('적용', 'Apply')}</button></footer>
  </div></div>;
}
