import type { ModelRegistryMetadata, ModelRegistryRoute, RateSnapshot } from '../domain/types';
import { asObject } from '../domain/pipeline';
import { freezeMetadata, type RouterModel } from './catalog';
import { MINUTES_SHORTLIST, curatedModelEvidence } from './model-shortlist';

export type CatalogMetadata = Readonly<{
  pricingKind: 'zero' | 'priced' | 'uncertain'; createdAt: string | null; checkedAt: string; source: string;
  conflict?: boolean; duplicateSignature?: string;
}>;
export type CatalogChoice = Readonly<{
  id: string; label: string; provider: 'openai' | 'openrouter' | 'openai-compatible'; enabled: boolean;
  catalog?: CatalogMetadata; disabledReason?: string;
}>;
export type CatalogCategory = 'shortlist' | 'free' | 'latest' | 'all';
export type CatalogGroup = Readonly<{ id: 'selected' | 'free' | 'shortlist' | 'latest' | 'all'; models: readonly CatalogChoice[] }>;
const owners = new Map<string, string>([['openai', 'OpenAI'], ['anthropic', 'Anthropic'], ['google', 'Google'], ['meta-llama', 'Meta'], ['mistralai', 'Mistral AI'], ['deepseek', 'DeepSeek'], ['qwen', 'Qwen'], ['cohere', 'Cohere'], ['xai', 'xAI'], ['x-ai', 'xAI']]);

/** A catalog namespace identifies its owner; it does not prove who created or executed a model. */
export function modelIdentity(id: string, provider: CatalogChoice['provider'], name = id) {
  if(provider==='openai-compatible')return {id,name,route:'OpenAI-compatible',owner:null,creator:null,ownerKind:'unknown',namespace:null} as const;
  const namespace = id.includes('/') ? id.split('/')[0] : null;
  return { id, name, route: provider === 'openai' ? 'Direct OpenAI' : 'OpenRouter',
    owner: provider === 'openai' ? 'OpenAI' : namespace ? owners.get(namespace) ?? namespace : null,
    creator: provider === 'openai' ? 'OpenAI' : null,
    ownerKind: provider === 'openai' ? 'direct-provider' : namespace ? 'catalog-namespace' : 'unknown', namespace } as const;
}
export function modelOptionLabel(model: CatalogChoice, language: 'ko' | 'en'): string {
  const identity = modelIdentity(model.id, model.provider, model.label);
  const owner = identity.ownerKind === 'catalog-namespace' ? `${identity.owner} (${language === 'ko' ? '카탈로그 네임스페이스' : 'catalog namespace'})` : identity.owner ?? (language === 'ko' ? '제작자 확인 불가' : 'Unknown creator');
  return `${identity.route} · ${owner} / ${identity.name}${identity.name === identity.id ? '' : ` · ${identity.id}`}`;
}
export function catalogMetadata(model: RouterModel): CatalogMetadata {
  const metadata = model.pricingMetadata;
  const positive = Object.values(metadata.rates).some(rate => rate !== null && rate > 0) || metadata.unsupportedDimensions.some(key => {
    const value = asObject(metadata.raw)?.[key];
    return (typeof value === 'number' || (typeof value === 'string' && !!value.trim())) && Number.isFinite(Number(value)) && Number(value) > 0;
  });
  const conflict = !!model.catalogConflict?.length;
  return freezeMetadata({ pricingKind: conflict ? 'uncertain' : positive ? 'priced' : metadata.complete && Object.values(metadata.rates).every(rate => rate === 0) ? 'zero' : 'uncertain', createdAt: model.createdAt, checkedAt: model.checkedAt, source: model.source, conflict, duplicateSignature: routerDuplicateSignature(model) });
}
function metadataSignature(value: unknown): string {
  return JSON.stringify(value, (_key, entry) => {
    const object = asObject(entry);
    return object ? Object.fromEntries(Object.keys(object).sort().map(key => [key, object[key]])) : entry;
  }) ?? '';
}
function routerDuplicateSignature(model: RouterModel): string {
  const raw = asObject(model.pricingMetadata.raw) ?? {};
  return metadataSignature({
    conflict: !!model.catalogConflict?.length, context: model.contextTokens, output: model.maxOutputTokens, tokenizer: model.tokenizer,
    parameters: [...new Set(model.supportedParameters)].sort(), input: [...new Set(model.inputModalities)].sort(),
    outputModalities: [...new Set(model.outputModalities)].sort(), perRequestLimits: model.perRequestLimits,
    capability: model.capabilityMetadata ? { reasoningBehavior: model.capabilityMetadata.reasoningBehavior, defaultParameters: model.capabilityMetadata.defaultParameters, expirationDate: model.capabilityMetadata.expirationDate, raw: model.capabilityMetadata.raw } : { reasoningBehavior: 'unknown', defaultParameters: null, expirationDate: null, raw: { reasoning: null, defaultParameters: null, expirationDate: null } },
    pricing: {
      rates: model.pricingMetadata.rates, complete: model.pricingMetadata.complete,
      missing: [...model.pricingMetadata.missingDimensions].sort(), unsupported: [...model.pricingMetadata.unsupportedDimensions].sort(),
      conditional: [...model.pricingMetadata.conditionalDimensions].sort(),
      extras: Object.fromEntries(Object.entries(raw).filter(([key]) => !['prompt', 'completion', 'request'].includes(key))),
    },
  });
}
function canonicalDuplicates<T extends { id: string }>(entries: readonly T[], signature: (entry: T) => string, conflict: (duplicates: readonly T[]) => T): readonly T[] {
  const groups = new Map<string, T[]>();
  for (const entry of entries) { const group = groups.get(entry.id) ?? []; group.push(entry); groups.set(entry.id, group); }
  return [...groups.values()].map(group => { const first = signature(group[0]); return group.every(entry => signature(entry) === first) ? group[0] : conflict(group); });
}
/** Normalize before UI projection or any controller lookup. Conflicting public metadata blocks preflight. */
export function canonicalizeRouterModels(models: readonly RouterModel[]): readonly RouterModel[] {
  return freezeMetadata(canonicalDuplicates(models, routerDuplicateSignature, duplicates => ({
    ...duplicates[0], name: duplicates[0].id, canonicalSlug: null, createdAt: null,
    contextTokens: null, maxOutputTokens: null, tokenizer: null, supportedParameters: [],
    inputModalities: ['text'], outputModalities: ['text'], pricing: null, perRequestLimits: null,
    capabilityMetadata: null,
    source: duplicates.map(model => model.source).sort()[0], checkedAt: duplicates.map(model => model.checkedAt).sort().slice(-1)[0],
    catalogConflict: duplicates,
    pricingMetadata: {
      rates: { prompt: null, completion: null, request: null }, complete: false,
      missingDimensions: ['prompt', 'completion', 'request'], unsupportedDimensions: [], conditionalDimensions: [],
      raw: duplicates.map(model => model.pricingMetadata.raw),
    },
  })));
}
/** The same conflict rule protects native picker projections supplied independently of the controller. */
export function canonicalCatalogChoices(choices: readonly CatalogChoice[]): readonly CatalogChoice[] {
  return freezeMetadata(canonicalDuplicates(choices, model => metadataSignature([model.provider, model.enabled, model.catalog?.duplicateSignature ?? model.catalog?.pricingKind ?? null, !!model.catalog?.conflict]), duplicates => {
    const stamps = duplicates.flatMap(model => model.catalog ? [model.catalog] : []);
    return {
      ...duplicates[0], label: duplicates[0].id, enabled: false,
      disabledReason: 'Conflicting catalog entries; refresh metadata or choose another model.',
      catalog: {
        pricingKind: 'uncertain', createdAt: null, conflict: true, duplicateSignature: 'catalog-conflict',
        source: stamps.map(stamp => stamp.source).sort()[0] ?? 'Unknown',
        checkedAt: stamps.map(stamp => stamp.checkedAt).sort().slice(-1)[0] ?? 'Unknown',
      },
    };
  }));
}
const byId = (a: CatalogChoice, b: CatalogChoice) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const namespaceOf = (model: CatalogChoice) => modelIdentity(model.id, model.provider).namespace ?? model.id;

/** Prefer eligible dated Minutes candidates; otherwise retain the deterministic
 * namespace fallback used by direct STT/legacy choices. Neither is a quality rank. */
export function groupCatalogChoices(choices: readonly CatalogChoice[], selectedId: string, category: CatalogCategory, query: string): readonly CatalogGroup[] {
  const all = [...canonicalCatalogChoices(choices)].sort(byId);
  const compatible = all.filter(model => model.enabled);
  const namespaces = new Set<string>();
  const firstPerNamespace = compatible.filter(model => { const namespace = namespaceOf(model); if (namespaces.has(namespace)) return false; namespaces.add(namespace); return true; });
  const firstIds = new Set(firstPerNamespace.map(model => model.id));
  const curated = MINUTES_SHORTLIST.flatMap(candidate => compatible.filter(model => model.provider!=='openai-compatible'&&curatedModelEvidence(model.id, model.provider)?.id === candidate.id));
  const shortlist = curated.length ? curated : [...firstPerNamespace, ...compatible.filter(model => !firstIds.has(model.id))].slice(0, 5);
  const latest = compatible.filter(model => model.catalog?.createdAt != null).sort((a, b) => b.catalog!.createdAt!.localeCompare(a.catalog!.createdAt!) || byId(a, b)).slice(0, 5);
  const free = compatible.filter(model => model.catalog?.pricingKind === 'zero');
  const search = query.trim().toLowerCase();
  const candidates = search ? all : category === 'shortlist' ? shortlist : category === 'free' ? free : category === 'latest' ? latest : all;
  const matching = candidates.filter(model => [model.id, model.label, modelIdentity(model.id, model.provider).owner ?? ''].some(value => value.toLowerCase().includes(search)));
  const result: CatalogGroup[] = [];
  if (selectedId && !matching.some(model => model.id === selectedId)) result.push({ id: 'selected', models: [all.find(model => model.id === selectedId) ?? { id: selectedId, label: selectedId, provider: 'openrouter', enabled: false }] });
  const freeIds = new Set(free.map(model => model.id)); const shortlistIds = new Set(shortlist.map(model => model.id)); const latestIds = new Set(latest.map(model => model.id));
  const groups = new Map<CatalogGroup['id'], CatalogChoice[]>();
  for (const model of matching) {
    const group = !search && category === 'free' ? 'free' : !search && category === 'latest' ? 'latest' : freeIds.has(model.id) ? 'free' : shortlistIds.has(model.id) ? 'shortlist' : latestIds.has(model.id) ? 'latest' : 'all';
    const entries = groups.get(group) ?? []; entries.push(model); groups.set(group, entries);
  }
  for (const id of (category === 'shortlist' && !search ? ['shortlist', 'free', 'latest', 'all'] : ['free', 'shortlist', 'latest', 'all']) as readonly CatalogGroup['id'][]) { const models = groups.get(id); if (models?.length) result.push({ id, models }); }
  return result;
}

export function routeBlock(row: Readonly<{ route: ModelRegistryRoute; metadata: ModelRegistryMetadata; status: 'new' | 'current' | 'stale' | 'unavailable'; blockedReason: string | null; metadataAcceptanceRequired: boolean }>): string | null {
  if (row.status === 'stale' || row.status === 'unavailable') return row.blockedReason ?? row.status;
  if (row.route.stage === 'minutes' && row.route.provider === 'openrouter' && !row.route.endpointTag) return row.blockedReason ?? 'missing-endpoint';
  if (!row.metadata.compatible) return row.blockedReason ?? row.metadata.blockers[0] ?? 'incompatible';
  if (row.metadataAcceptanceRequired) return row.blockedReason ?? 'metadata-changed';
  return row.blockedReason;
}

/** Presentation evidence is separate from encrypted registry v1. Exact versions only. */
export type ModelDate = Readonly<{ kind: 'released'; value: string; precision: 'day'; source: string; checkedAt: string }> | Readonly<{ kind: 'listed'; value: string }> | Readonly<{ kind: 'unknown' }>;
const releases = new Map<string, ModelDate>([['openai:gpt-4o-mini-transcribe-2025-12-15', { kind: 'released', value: '2025-12-15', precision: 'day', source: 'https://developers.openai.com/api/docs/changelog', checkedAt: '2026-10-04T04:12:38.870600+00:00' }]]);
export function compactModelPresentation(row: Readonly<{ route: ModelRegistryRoute; metadata: ModelRegistryMetadata; catalogListedAt?: string | null }>, language: 'ko' | 'en') {
  const t = (ko: string, en: string) => language === 'ko' ? ko : en;
  const units: Record<RateSnapshot['rates'][number]['unit'], string> = {
    'input-token': t('입력 토큰', 'input tokens'), 'output-token': t('출력 토큰', 'output tokens'),
    'text-input-token': t('텍스트 입력 토큰', 'text input tokens'), 'text-output-token': t('텍스트 출력 토큰', 'text output tokens'),
    'audio-input-token': t('음성 입력 토큰', 'audio input tokens'), 'audio-output-token': t('음성 출력 토큰', 'audio output tokens'),
    'audio-second': t('음성 초', 'audio seconds'), request: t('요청', 'request'),
  };
  const snapshot = row.metadata.pricing.snapshot;
  const prices = snapshot?.rates.length ? snapshot.rates.map(rate => {
    // Scale tokens only, retaining their exact billing dimension. No duration estimate.
    const tokenUnits = rate.unit.endsWith('token') ? 1_000_000 : rate.units;
    const scaled = rate.price * (tokenUnits / rate.units);
    const price = Number.isFinite(scaled) ? scaled : rate.price, count = Number.isFinite(scaled) ? tokenUnits : rate.units;
    return `${snapshot.currency} ${price.toLocaleString('en-US', { maximumSignificantDigits: 10 })} / ${count.toLocaleString('en-US')} ${units[rate.unit]}`;
  }) : [t('요금 확인 불가', 'Price unavailable')];
  const date: ModelDate = releases.get(`${row.route.provider}:${row.route.modelId}`) ?? (row.catalogListedAt && Number.isFinite(Date.parse(row.catalogListedAt)) ? { kind: 'listed', value: row.catalogListedAt } : { kind: 'unknown' });
  return { prices, priceNote: row.metadata.pricing.kind === 'unknown' ? t('총요금 확인 불가', 'Total price unknown') : t('표시 요금 · 실제 청구 아님', 'Advertised rates · not actual billing'),
    feature: row.route.stage === 'minutes' && row.metadata.blockers.includes('exact-endpoint-required') ? t('텍스트 → 글 · 엔드포인트 선택 필요', 'Text → text · select endpoint') : !row.metadata.compatible ? t('MoM에서 아직 지원하지 않는 모델', 'MoM does not support this model yet') : row.route.stage === 'stt' ? t('음성 → 전사문', 'Audio → transcript') : t('전사문 → 글 · 명시적 엔드포인트', 'Transcript → text · explicit endpoint'), date,
    dateLabel: date.kind === 'released' ? t('버전 출시', 'Version released') : date.kind === 'listed' ? t('카탈로그 등록', 'Catalog listed') : t('버전 출시 · 확인 불가', 'Version released · Unknown'),
  };
}
