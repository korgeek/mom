import { useId, useState } from 'react';
import { canonicalCatalogChoices, groupCatalogChoices, modelOptionLabel, type CatalogCategory, type CatalogChoice, type CatalogGroup } from '../providers/model-presentation';
import { copy } from './copy';
import { SHORTLIST_SOURCE } from '../providers/model-shortlist';

export default function ModelPicker({ models, value, language, memberB = false, disabled, onChange }: {
  models: readonly CatalogChoice[]; value: string; language: 'ko' | 'en'; memberB?: boolean; disabled: boolean; onChange(value: string): void;
}) {
  const [category, setCategory] = useState<CatalogCategory>('shortlist'); const [query, setQuery] = useState('');
  const descriptionId = useId(); const t = (ko: string, en: string) => copy(language, ko, en);
  const canonical = canonicalCatalogChoices(models);
  const groups = groupCatalogChoices(canonical, value, category, query);
  const groupNames: Record<CatalogGroup['id'], string> = { selected: t('선택한 모델 · 현재 목록 밖', 'Selected model · outside this list'), free: t('카탈로그 0 요금', 'Catalog zero-priced'), shortlist: t('빠른 선택', 'Quick choices'), latest: t('최근 카탈로그 추가', 'Latest catalog additions'), all: t('전체 목록', 'Full list') };
  const selected = canonical.find(model => model.id === value); const metadata = selected?.catalog;
  const catalogStamp = metadata ?? canonical.find(model => model.catalog)?.catalog;
  return <div className="model-picker stack gap12">
    <label><span className="field-label">{memberB ? t('B 모델', 'Member B model') : t('생성 모델', 'Model')}</span><select value={value} aria-describedby={descriptionId} disabled={disabled} onChange={event => onChange(event.target.value)}><option value="">{memberB ? t('B 모델 선택', 'Choose member B') : t('모델 선택', 'Choose a model')}</option>{groups.map(group => <optgroup key={group.id} label={groupNames[group.id]}>{group.models.map(model => <option key={model.id} value={model.id} disabled={!model.enabled}>{modelOptionLabel(model, language)}{!model.enabled ? ` — ${model.disabledReason ?? t('현재 카탈로그에서 사용 불가', 'Unavailable in the current catalog')}` : ''}</option>)}</optgroup>)}</select></label>
    <details className="usage-stage-details"><summary>{memberB ? t('자세히 보기 · B 모델 카탈로그', 'Details · member B catalog') : t('자세히 보기 · 모델 카탈로그', 'Details · model catalog')}</summary><div className="stack gap12">
    <div className="model-picker-tools"><label><span className="field-label">{memberB ? t('B 모델 분류', 'Member B model category') : t('모델 분류', 'Model category')}</span><select value={category} disabled={disabled} onChange={event => setCategory(event.target.value as CatalogCategory)}>{(['shortlist', 'free', 'latest', 'all'] as const).map(id => <option key={id} value={id}>{groupNames[id]}</option>)}</select></label>
    <label><span className="field-label">{memberB ? t('B 모델 검색', 'Search member B models') : t('모델 검색', 'Search models')}</span><input type="search" autoComplete="off" value={query} disabled={disabled} onChange={event => setQuery(event.target.value)} /></label></div>
    <span id={descriptionId} className="hint">{t('빠른 선택은 날짜가 명시된 사용량 목록의 정리 노트 후보 중 현재 사용 가능한 모델을 먼저 보여줘요. 일치하는 후보가 없으면 네임스페이스별 첫 호환 모델, 이후 ID 순으로 최대 5개를 보여줘요. 대체 목록에 인기 근거는 없으며 품질 순위가 아니에요.', 'Quick choices prefer currently eligible Notes candidates from the dated usage subset. With no matches, the namespace fallback uses the first compatible ID per namespace, then ID order, at most five. Fallbacks have no popularity evidence. This is not a quality ranking.')}</span>
    <span className="hint">{t('선정 근거: 주간 토큰 사용량 상위 20개에서 고른 5개 후보 · 확인 시각', 'Selection basis: five candidates chosen from the weekly token-usage top 20 · Checked at')}: {SHORTLIST_SOURCE.checkedAt} · <a href={SHORTLIST_SOURCE.url} target="_blank" rel="noreferrer">OpenRouter</a> · <a href={SHORTLIST_SOURCE.licenseUrl} target="_blank" rel="noreferrer">CC BY 4.0</a>. {t('실시간 순위나 정리 노트 품질 검증이 아니며 :free 이름은 계정·요청 비용 0을 보장하지 않아요.', 'This is not a live ranking or verified voice memo quality; a :free name does not guarantee zero account or request cost.')}</span>
    <span className="hint">{t('0 요금은 확인한 카탈로그 표시값이에요. 엔드포인트 요금과 계정 조건·한도는 다를 수 있어요. 최근 추가는 모델 출시일이 아니에요. 카탈로그 네임스페이스는 소유자 힌트이며 제작자를 독립 검증하지 않았어요.', 'Zero-priced is a checked catalog indication. Endpoint rates and untested account conditions or limits may differ. Latest additions are not model release dates. Catalog namespaces identify owners; underlying creators are not independently verified.')}</span>
    {catalogStamp && <span className="hint model-catalog-source">{t('출처', 'Source')}: {catalogStamp.source} · {t('확인 시각', 'Checked at')}: {catalogStamp.checkedAt}{metadata && <> · {t('카탈로그 추가', 'Catalog added')}: {metadata.createdAt ?? t('확인 불가', 'Unknown')} · {t('카탈로그 요금', 'Catalog pricing')}: {metadata.pricingKind === 'zero' ? t('0 표시값', 'Zero-priced') : metadata.pricingKind === 'priced' ? t('유료 항목 있음', 'Nonzero fee') : t('확인 불가', 'Uncertain')}</>}</span>}
    </div></details>
    {metadata?.conflict && <span className="hint">{t('동일 ID의 카탈로그 항목이 충돌해 사용할 수 없어요. 저장한 ID는 유지했어요. 새로고침하거나 다른 모델을 선택하세요.', 'Conflicting catalog entries make this model unavailable. The saved ID is retained. Refresh metadata or choose another model.')}</span>}
    {value && !selected && <span className="hint">{t('저장한 모델 ID를 유지했어요. 현재 카탈로그에서는 사용할 수 없어요.', 'The saved model ID is retained; it is unavailable in the current catalog.')}</span>}
  </div>;
}
