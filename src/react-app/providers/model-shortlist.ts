/** A dated subset of OpenRouter's weekly token-usage top 20, not a quality rank.
 * Only IDs and their source positions are pinned; capabilities and rates always
 * come from the caller's authoritative current metadata. No runtime fetch. */
export const SHORTLIST_SOURCE = Object.freeze({
  checkedAt: '2026-10-02T16:51:45Z',
  url: 'https://openrouter.ai/api/v1/models?sort=most-popular&limit=20',
  documentationUrl: 'https://openrouter.ai/docs/guides/overview/models',
  rankingsUrl: 'https://openrouter.ai/rankings',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
});
export const MINUTES_SHORTLIST = Object.freeze([
  Object.freeze({ id: 'deepseek/deepseek-v4.1-flash', weeklyPosition: 2 }),
  Object.freeze({ id: 'openai/gpt-6-luna', weeklyPosition: 9 }),
  Object.freeze({ id: 'google/gemini-3.8-flash', weeklyPosition: 13 }),
  Object.freeze({ id: 'anthropic/claude-opus-5.5', weeklyPosition: 14 }),
  Object.freeze({ id: 'nvidia/nemotron-3-ultra-550b-a55b:free', weeklyPosition: 8 }),
]);
/** Only these exact public routes are prospective first-use draft choices.
 * Their current metadata must pass eligibility; never substitute another tag. */
export const FIRST_USE_MINUTES_ROUTES = Object.freeze([
  Object.freeze({ id: 'openai/gpt-6-luna', tag: 'openai' }),
  Object.freeze({ id: 'google/gemini-3.8-flash', tag: 'google-ai-studio' }),
  Object.freeze({ id: 'anthropic/claude-opus-5.5', tag: 'anthropic' }),
]);
export function curatedModelEvidence(modelId: string, provider: 'openai' | 'openrouter') {
  return provider === 'openrouter' ? MINUTES_SHORTLIST.find(model => model.id === modelId) ?? null : null;
}
type ShortlistIdentity = Readonly<{
  key: string; modelId: string; provider: 'openai' | 'openrouter'; stage: 'stt' | 'minutes';
  userEnabled: boolean; isDefault: boolean; priority: number; savedPreference?: boolean;
}>;
const keyOrder = (a: ShortlistIdentity, b: ShortlistIdentity) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
/** Saved routes retain each exact connection/endpoint, including blocked ones.
 * Each remaining curated model gets one deterministic representative; lower
 * priority means the caller has a better checked route. Eligibility is unchanged. */
export function projectMinutesShortlist<T>(rows: readonly T[], identify: (row: T) => ShortlistIdentity): readonly T[] {
  const entries = rows.map(row => ({ row, identity: identify(row) })).filter(entry => entry.identity.stage === 'minutes');
  const saved = entries.filter(entry => entry.identity.userEnabled || entry.identity.isDefault || entry.identity.savedPreference)
    .sort((a, b) => Number(b.identity.isDefault) - Number(a.identity.isDefault) || keyOrder(a.identity, b.identity));
  const candidates = MINUTES_SHORTLIST.flatMap(model => {
    if (saved.some(entry => entry.identity.provider === 'openrouter' && entry.identity.modelId === model.id)) return [];
    const matching = entries.filter(entry => entry.identity.provider === 'openrouter' && entry.identity.modelId === model.id)
      .sort((a, b) => a.identity.priority - b.identity.priority || keyOrder(a.identity, b.identity));
    return matching.length ? [matching[0]] : [];
  });
  return Object.freeze([...saved, ...candidates].map(entry => entry.row));
}
