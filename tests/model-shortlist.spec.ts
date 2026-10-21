import { describe, expect, it } from 'vitest';
const modulePath = '../src/react-app/providers/model-shortlist';
async function shortlist() {
  const imported = await import(/* @vite-ignore */ modulePath).catch(() => null);
  expect(imported, 'dated shortlist projection is implemented').not.toBeNull();
  return imported as typeof import('../src/react-app/providers/model-shortlist');
}
type Route = { key: string; modelId: string; provider: 'openai' | 'openrouter'; stage: 'stt' | 'minutes'; userEnabled: boolean; isDefault: boolean; priority: number };
const row = (key: string, modelId: string, patch: Partial<Route> = {}): Route => ({ key, modelId, provider: 'openrouter', stage: 'minutes', userEnabled: false, isDefault: false, priority: 0, ...patch });
const id = (route: Route) => route;
describe('pure shortlist regression', () => {
  it('intersects exact dated IDs with available minutes rows without filling missing candidates', async () => {
    const { projectMinutesShortlist } = await shortlist();
    const a = row('a', 'deepseek/deepseek-v4.1-flash'), b = row('b', 'openai/gpt-6-luna');
    expect(projectMinutesShortlist([row('c', 'unlisted/model'), b, a, row('stt', a.modelId, { stage: 'stt' }), row('other-provider', b.modelId, { provider: 'openai' })], id)).toEqual([a, b]);
    expect(projectMinutesShortlist([row('only', 'unlisted/model')], id)).toEqual([]);
  });
  it('retains each saved endpoint and connection independently before dated candidates', async () => {
    const { projectMinutesShortlist } = await shortlist();
    const model = 'deepseek/deepseek-v4.1-flash';
    const east = row('east', model, { userEnabled: true }), west = row('west', model, { isDefault: true }), another = row('another-connection', model, { userEnabled: true });
    expect(projectMinutesShortlist([east, row('unsaved', model), west, another], id)).toEqual([west, another, east]);
  });
  it('chooses the supported exact representative deterministically without changing its identity', async () => {
    const { projectMinutesShortlist } = await shortlist(); const model = 'openai/gpt-6-luna';
    const raw = row('raw', model, { priority: 2 }), failed = row('failed', model, { priority: 3 });
    const west = row('west', model), east = row('east', model);
    const rows = [raw, west, failed, east]; const expected = [east];
    expect(projectMinutesShortlist(rows, id)).toEqual(expected); expect(projectMinutesShortlist([...rows].reverse(), id)).toEqual(expected);
    expect(projectMinutesShortlist(rows, id)[0]).toBe(east);
  });
  it('copies only the returned array and never mutates frozen authoritative rows', async () => {
    const { projectMinutesShortlist } = await shortlist(); const a = Object.freeze(row('a', 'openai/gpt-6-luna'));
    const rows = Object.freeze([a]); const before = JSON.stringify(rows); const projected = projectMinutesShortlist(rows, id);
    expect(Object.isFrozen(projected)).toBe(true); expect(projected[0]).toBe(a); expect(JSON.stringify(rows)).toBe(before);
  });
  it('records actual weekly positions and dated attribution without assigning evidence to fallbacks', async () => {
    const { MINUTES_SHORTLIST, SHORTLIST_SOURCE, curatedModelEvidence } = await shortlist();
    expect(MINUTES_SHORTLIST.map(model => model.weeklyPosition)).toEqual([2, 9, 13, 14, 8]);
    expect(SHORTLIST_SOURCE.checkedAt).toBe('2026-10-02T16:51:45Z');
    expect(SHORTLIST_SOURCE.url).toBe('https://openrouter.ai/api/v1/models?sort=most-popular&limit=20');
    expect(SHORTLIST_SOURCE.licenseUrl).toBe('https://creativecommons.org/licenses/by/4.0/');
    expect(curatedModelEvidence('owner/model', 'openrouter')).toBeNull(); expect(curatedModelEvidence('openai/gpt-6-luna', 'openai')).toBeNull();
    expect(Object.isFrozen(MINUTES_SHORTLIST)).toBe(true); expect(Object.isFrozen(MINUTES_SHORTLIST[0])).toBe(true);
  });
});
