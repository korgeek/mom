// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ModelManager, type ModelManagementRow, type ModelManagerProps } from '../src/react-app/ui/components/ModelManager';
import type { ModelRegistryMetadata, ModelRegistryRoute } from '../src/react-app/domain/types';
import { registryRouteKey } from '../src/react-app/providers/model-registry';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const stamp = '2026-10-02T10:00:00Z';
function row(id: string, patch: Partial<Omit<ModelManagementRow, 'route' | 'metadata' | 'key'>> & {
  route?: Partial<ModelRegistryRoute>; metadata?: Partial<ModelRegistryMetadata>;
} = {}): ModelManagementRow {
  const route: ModelRegistryRoute = { connectionId: 'synthetic-connection', provider: 'openai', stage: 'stt', modelId: id, endpointTag: null, ...patch.route };
  const metadata: ModelRegistryMetadata = { route, name: `Actual ${id}`, source: 'Synthetic catalog source', checkedAt: stamp,
    endpointSource: 'Synthetic endpoint source', endpointCheckedAt: stamp, compatible: true, blockers: [], warnings: [],
    inputModalities: ['text'], outputModalities: ['text'], modelSupportedParameters: ['max_tokens'], endpointSupportedParameters: ['max_tokens'], completionParameter: 'max_tokens',
    limits: { maxBytes: 24_900_000, contextTokens: 4096, maxPromptTokens: 3072, maxOutputTokens: 1024 },
    pricing: { kind: 'priced', snapshot: { source: 'Synthetic rate source', checkedAt: stamp, currency: 'USD', rates: [{ unit: 'text-input-token', units: 1, price: 0.000002 }] }, missingDimensions: [], unsupportedDimensions: [], conditionalDimensions: [] },
    description: { text: 'A supplied description.', source: 'Description source', checkedAt: stamp }, retirement: null, ...patch.metadata };
  return { key: registryRouteKey(route), alias: null, developer: 'Supplied owner A', userEnabled: false, isDefault: false,
    status: 'current', blockedReason: null, metadataAcceptanceRequired: false, mayLoadEndpoints: false, ...patch, route, metadata };
}
function props(rows: readonly ModelManagementRow[], extra: Partial<ModelManagerProps> = {}): ModelManagerProps {
  return { rows, language: 'en', busy: false, discoveryAvailability: { openai: true, openrouter: true }, ...extra };
}
function results() { return within(screen.getByRole('list', { name: 'Model routes' })).queryAllByRole('listitem'); }
async function minutes(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('tab', { name: 'Notes' }));
  await user.click(screen.getByRole('button', { name: 'Show all models' }));
}
async function details(user: ReturnType<typeof userEvent.setup>, item: HTMLElement) { await user.click(within(item).getByText('Details · metadata')); }

describe('central props-driven model manager', () => {
  it('bounds 1005 candidates to 20 rows, paginates deterministically and resets on search/row changes', async () => {
    const user = userEvent.setup(); const rows = Array.from({ length: 1005 }, (_, i) => row(`model-${String(i).padStart(4, '0')}`)).reverse();
    const { rerender } = render(<ModelManager {...props(rows)} />);
    expect(results()).toHaveLength(20); expect(results()[0].textContent).toContain('model-0000');
    expect(screen.getByText('1005 routes · Page 1 of 51')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(results()).toHaveLength(20); expect(results()[0].textContent).toContain('model-0020');
    await user.type(screen.getByRole('searchbox', { name: 'Search models' }), 'model-1004');
    expect(results()).toHaveLength(1); expect(screen.getByText('1 routes · Page 1 of 1')).toBeTruthy();
    await user.clear(screen.getByRole('searchbox', { name: 'Search models' }));
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    rerender(<ModelManager {...props(rows.slice(-3))} />);
    expect(results()).toHaveLength(3); expect(screen.getByText('3 routes · Page 1 of 1')).toBeTruthy();
  });
  it('keeps STT/notes separate and keyboard tabs select the discovery stage', async () => {
    const user = userEvent.setup(); const onDiscover = vi.fn();
    render(<ModelManager {...props([row('speech'), row('text', { route: { provider: 'openrouter', stage: 'minutes', endpointTag: 'Fixture/east' } })], { onDiscover })} />);
    expect(results()).toHaveLength(1); expect(results()[0].textContent).toContain('speech');
    const stt = screen.getByRole('tab', { name: 'STT' }); stt.focus(); await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Notes' }).getAttribute('aria-selected')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Show all models' }));
    expect(results()[0].textContent).toContain('text');
    await user.click(screen.getByRole('button', { name: 'Discover OpenRouter' }));
    expect(onDiscover).toHaveBeenLastCalledWith('openrouter', 'minutes');
    await user.click(stt); await user.click(screen.getByRole('button', { name: 'Discover OpenAI' }));
    expect(onDiscover).toHaveBeenLastCalledWith('openai', 'stt');
    expect(screen.getByText(/public keyless catalog/)).toBeTruthy();
    expect(screen.getByText(/authenticated model listing/)).toBeTruthy();
    expect(screen.getByText(/does not prove inference permission/)).toBeTruthy();
  });
  it.each(['alias term', 'Actual search-target', 'search-target', 'Supplied owner A', 'Fixture/region-e'])(
    'searches supplied alias/name/ID/owner/endpoint: %s', async query => {
      const user = userEvent.setup();
      render(<ModelManager {...props([row('search-target', { alias: 'alias term', route: { stage: 'minutes', provider: 'openrouter', endpointTag: 'Fixture/region-e' } }),
        row('other', { developer: null, route: { stage: 'minutes', provider: 'openrouter', endpointTag: 'Fixture/other' } })])} />);
      await minutes(user); await user.type(screen.getByRole('searchbox', { name: 'Search models' }), query);
      expect(results()).toHaveLength(1); expect(results()[0].textContent).toContain('search-target');
    });
  it('filters actual provider and supplied owners with Unknown separate', async () => {
    const user = userEvent.setup();
    render(<ModelManager {...props([row('direct'), row('gateway', { developer: null, route: { provider: 'openrouter' }, metadata: { compatible: false } })])} />);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Provider' }), 'openrouter');
    expect(results()).toHaveLength(1); expect(results()[0].textContent).toContain('gateway');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Provider' }), 'all');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Catalog owner / namespace' }), 'unknown');
    expect(results()).toHaveLength(1); expect(results()[0].textContent).toContain('gateway');
  });
  it('separates known zero, nonzero and unknown pricing and excludes unknown requested capacities', async () => {
    const user = userEvent.setup(); const zero = row('zero', { metadata: { pricing: { kind: 'zero', snapshot: null, missingDimensions: [], unsupportedDimensions: [], conditionalDimensions: [] } } });
    const unknown = row('unknown', { metadata: { pricing: { kind: 'unknown', snapshot: null, missingDimensions: ['input'], unsupportedDimensions: [], conditionalDimensions: [] }, limits: { maxBytes: null, contextTokens: null, maxPromptTokens: null, maxOutputTokens: null } } });
    render(<ModelManager {...props([zero, row('priced'), unknown])} />);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Catalog price' }), 'zero'); expect(results()).toHaveLength(1); expect(results()[0].textContent).toContain('zero');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Catalog price' }), 'unknown'); expect(results()[0].textContent).toContain('unknown');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Catalog price' }), 'all');
    await user.type(screen.getByRole('spinbutton', { name: 'Minimum context tokens' }), '4000'); expect(results()).toHaveLength(2);
    await user.type(screen.getByRole('spinbutton', { name: 'Minimum output tokens' }), '2000'); expect(results()).toHaveLength(0);
    await user.clear(screen.getByRole('spinbutton', { name: 'Minimum output tokens' }));
    await user.type(screen.getByRole('spinbutton', { name: 'Minimum output tokens' }), '1000'); expect(results()).toHaveLength(2);
    expect(screen.getByText(/do not guarantee a request cost/)).toBeTruthy();
  });
  it('keeps duplicate aliases and distinct endpoints tied to immutable callback keys', async () => {
    const user = userEvent.setup(); const onDefault = vi.fn(), onAlias = vi.fn(), onEnabled = vi.fn();
    const a = row('namespace/same', { alias: 'Same alias', userEnabled: true, route: { provider: 'openrouter', stage: 'minutes', endpointTag: 'Fixture/east' } });
    const b = row('namespace/same', { alias: 'Same alias', userEnabled: true, route: { provider: 'openrouter', stage: 'minutes', endpointTag: 'Fixture/west' } });
    render(<ModelManager {...props([b, a], { onDefault, onAlias, onEnabled })} />); await minutes(user);
    expect(results()).toHaveLength(2); const west = results().find(item => item.textContent?.includes('Fixture/west'))!;
    await details(user, west);
    await user.click(within(west).getByRole('button', { name: 'Use as stage default' })); expect(onDefault).toHaveBeenCalledWith('minutes', b.key);
    const alias = within(west).getByRole('textbox', { name: 'Display alias' }); await user.clear(alias); await user.type(alias, 'Renamed local draft');
    expect(onAlias).not.toHaveBeenCalled(); await user.click(within(west).getByRole('button', { name: 'Save alias' }));
    expect(onAlias).toHaveBeenCalledWith(b.key, 'Renamed local draft');
    await user.click(within(west).getByRole('checkbox', { name: 'Enable this route' })); expect(onEnabled).toHaveBeenCalledWith(b.key, false);
    expect(west.textContent).toContain('namespace/same'); expect(west.textContent).toContain('Fixture/west');
  });
  it.each(['new', 'stale', 'unavailable'] as const)('shows a blocked saved default honestly and allows disabling it: %s', async status => {
    const user = userEvent.setup(); const onEnabled = vi.fn(), onDefault = vi.fn();
    const r = row('blocked', { userEnabled: true, isDefault: true, status, blockedReason: 'Known unsupported route', metadata: { compatible: false } });
    render(<ModelManager {...props([r], { onEnabled, onDefault })} />);
    expect(screen.getByText(/Saved default is blocked/)).toBeTruthy();
    await details(user, results()[0]);
    expect((within(results()[0]).getByRole('button', { name: 'Default for this stage' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(within(results()[0]).getByRole('checkbox', { name: 'Enable this route' })); expect(onEnabled).toHaveBeenCalledWith(r.key, false);
    await user.type(screen.getByRole('searchbox', { name: 'Search models' }), 'no match'); expect(results()).toHaveLength(0);
    expect(screen.getByText(/Saved default is blocked/)).toBeTruthy(); expect(onDefault).not.toHaveBeenCalled();
  });
  it('accepts changed metadata separately without enabling or replacing a default', async () => {
    const user = userEvent.setup(); const onAcceptMetadata = vi.fn(), onEnabled = vi.fn(), onDefault = vi.fn();
    const r = row('changed', { userEnabled: false, metadataAcceptanceRequired: true, blockedReason: 'metadata-changed' });
    const { rerender } = render(<ModelManager {...props([r], { revision: 10, onAcceptMetadata, onEnabled, onDefault })} />);
    const item = results()[0]; expect((within(item).getByRole('checkbox') as HTMLInputElement).disabled).toBe(true);
    await user.click(within(item).getByRole('button', { name: 'Accept changed metadata' }));
    expect(onAcceptMetadata).toHaveBeenCalledWith(r.key, 10); expect(onEnabled).not.toHaveBeenCalled(); expect(onDefault).not.toHaveBeenCalled();
    rerender(<ModelManager {...props([{ ...r, metadataAcceptanceRequired: false, blockedReason: null }], { onAcceptMetadata, onEnabled, onDefault })} />);
    await user.click(within(results()[0]).getByRole('checkbox')); expect(onEnabled).toHaveBeenCalledWith(r.key, true); expect(onDefault).not.toHaveBeenCalled();
  });
  it.each([undefined, NaN, 1.5])('disables metadata acceptance for a missing or invalid reviewed revision: %s', async revision => {
    const user = userEvent.setup(), accept = vi.fn(); render(<ModelManager {...props([row('changed', { metadataAcceptanceRequired: true })], { revision, onAcceptMetadata: accept })} />);
    const button = within(results()[0]).getByRole('button', { name: 'Accept changed metadata' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true); await user.click(button); expect(accept).not.toHaveBeenCalled();
  });
  it('blocks new notes without an actual endpoint and OpenRouter audio chat as STT', async () => {
    const user = userEvent.setup(); const onEnabled = vi.fn(), onDefault = vi.fn(), onLoadEndpoints = vi.fn();
    const chat = row('audio-chat', { route: { provider: 'openrouter' }, metadata: { compatible: false, inputModalities: ['audio', 'text'] }, blockedReason: 'Unsupported STT adapter' });
    const candidate = row('needs-endpoint', { route: { provider: 'openrouter', stage: 'minutes' }, status: 'new', mayLoadEndpoints: true });
    render(<ModelManager {...props([chat, candidate], { onEnabled, onDefault, onLoadEndpoints })} />);
    await user.click(screen.getByRole('button', { name: 'Show all models' }));
    expect((within(results()[0]).getByRole('checkbox') as HTMLInputElement).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Show shortlist' }));
    await minutes(user); const item = results()[0]; expect((within(item).getByRole('checkbox') as HTMLInputElement).disabled).toBe(true);
    await user.click(within(item).getByRole('button', { name: 'Load endpoints' })); expect(onLoadEndpoints).toHaveBeenCalledWith(candidate.route);
    expect(onEnabled).not.toHaveBeenCalled(); expect(onDefault).not.toHaveBeenCalled();
  });
  it('clears an alias to the actual model name and enforces the registry 256 UTF-8 byte bound', async () => {
    const user = userEvent.setup(); const onAlias = vi.fn(); const r = row('alias-model', { alias: 'Saved alias' });
    const { rerender } = render(<ModelManager {...props([r], { onAlias })} />); const item = results()[0];
    await details(user, item);
    const input = within(item).getByRole('textbox', { name: 'Display alias' }); await user.clear(input);
    await user.click(within(item).getByRole('button', { name: 'Save alias' })); expect(onAlias).toHaveBeenLastCalledWith(r.key, null);
    rerender(<ModelManager {...props([{ ...r, alias: null }], { onAlias })} />);
    expect(within(results()[0]).getByRole('heading', { name: 'Actual alias-model' })).toBeTruthy();
    await user.type(input, '한'.repeat(100)); expect((within(item).getByRole('button', { name: 'Save alias' }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(item).getByText(/256 UTF-8 bytes/)).toBeTruthy();
    await user.clear(input); await user.type(input, 'x'.repeat(256)); await user.click(within(item).getByRole('button', { name: 'Save alias' }));
    expect(onAlias).toHaveBeenLastCalledWith(r.key, 'x'.repeat(256));
  });
  it.each(['missing callbacks', 'busy'] as const)('disables every unavailable action without simulated success: %s', async reason => {
    const onDiscover = vi.fn(), onLoadEndpoints = vi.fn(), onEnabled = vi.fn(), onAlias = vi.fn(), onDefault = vi.fn(), onAcceptMetadata = vi.fn();
    const r = row('disabled', { userEnabled: true, metadataAcceptanceRequired: true, mayLoadEndpoints: true, alias: 'old' });
    render(<ModelManager {...props([r], reason === 'busy' ? { busy: true, onDiscover, onLoadEndpoints, onEnabled, onAlias, onDefault, onAcceptMetadata } : {})} />);
    await details(userEvent.setup(), results()[0]);
    for (const button of [screen.getByRole('button', { name: 'Discover OpenAI' }), screen.getByRole('button', { name: 'Discover OpenRouter' }), ...within(results()[0]).getAllByRole('button')]) expect((button as HTMLButtonElement).disabled).toBe(true);
    expect((within(results()[0]).getByRole('checkbox') as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Discover OpenAI' })); expect(onDiscover).not.toHaveBeenCalled();
  });
  it('retains immutable route identity and sourced provenance beneath native Details', async () => {
    const user = userEvent.setup(); const r = row('provenance', { alias: 'My alias' });
    render(<ModelManager {...props([r], { error: 'Supplied discovery failure', statusText: 'Previously checked catalog' })} />);
    const item = results()[0]; expect(item.textContent).toContain('provenance'); expect(item.textContent).toContain('openai');
    const summary = within(item).getByText('Details · metadata'); const details = summary.closest('details')!; expect(details.open).toBe(false);
    await user.click(summary); expect(details.open).toBe(true);
    expect(within(details).getByText('Synthetic catalog source')).toBeTruthy(); expect(details.textContent).toContain(stamp);
    expect(details.textContent).toContain('Description source'); expect(details.textContent).toContain('USD');
    expect(details.textContent).toContain('not a verified creator or execution provider');
    expect(screen.getByRole('alert').textContent).toBe('Supplied discovery failure');
  });
  it('does not mutate frozen inputs or perform network/storage work when callbacks run', async () => {
    const user = userEvent.setup(); const r = row('frozen'); Object.freeze(r.route); Object.freeze(r.metadata); Object.freeze(r);
    const rows = Object.freeze([r]); const before = JSON.stringify(rows); const onDiscover = vi.fn(), onEnabled = vi.fn();
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const get = vi.spyOn(Storage.prototype, 'getItem'), set = vi.spyOn(Storage.prototype, 'setItem');
    render(<ModelManager {...props(rows, { onDiscover, onEnabled })} />);
    await user.click(screen.getByRole('button', { name: 'Discover OpenRouter' })); await user.click(within(results()[0]).getByRole('checkbox'));
    expect(JSON.stringify(rows)).toBe(before); expect(fetch).not.toHaveBeenCalled(); expect(get).not.toHaveBeenCalled(); expect(set).not.toHaveBeenCalled();
    expect(onDiscover).toHaveBeenCalledWith('openrouter', 'stt'); expect(onEnabled).toHaveBeenCalledWith(r.key, true);
  });
});

describe('notes shortlist regression', () => {
  const ids = ['deepseek/deepseek-v4.1-flash', 'openai/gpt-6-luna', 'google/gemini-3.8-flash', 'anthropic/claude-opus-5.5', 'nvidia/nemotron-3-ultra-550b-a55b:free'];
  const candidate = (id: string, endpointTag: string | null = null) => row(id, { route: { provider: 'openrouter', stage: 'minutes', endpointTag }, mayLoadEndpoints: endpointTag === null });
  it('keeps every saved route first and only five distinct dated candidate models', async () => {
    const user = userEvent.setup(); const onEnabled = vi.fn(), onDefault = vi.fn(), onAlias = vi.fn(), onLoadEndpoints = vi.fn();
    const saved = row('saved/model', { alias: 'My saved route', userEnabled: true, route: { provider: 'openrouter', stage: 'minutes', endpointTag: 'Fixture/east' } });
    const blocked = row('saved/model', { alias: 'Blocked saved default', isDefault: true, status: 'stale', blockedReason: 'refresh-failed', route: { provider: 'openrouter', stage: 'minutes', endpointTag: 'Fixture/west' } });
    const candidates = ids.flatMap(id => [candidate(id), candidate(id, 'Fixture/a'), candidate(id, 'Fixture/z')]);
    const other = Array.from({ length: 30 }, (_, i) => candidate(`other/model-${i}`));
    render(<ModelManager {...props([...other, ...candidates.reverse(), saved, blocked], { onEnabled, onDefault, onAlias, onLoadEndpoints })} />);
    await user.click(screen.getByRole('tab', { name: 'Notes' }));
    expect(results()).toHaveLength(7);
    expect(results()[0].textContent).toContain('Blocked saved default'); expect(results()[1].textContent).toContain('My saved route');
    expect(screen.getByText(/Saved default is blocked/)).toBeTruthy();
    for (const id of ids) {
      const items = results().filter(item => item.getAttribute('aria-label')?.includes(` · ${id} · `));
      expect(items).toHaveLength(1); expect(items[0].getAttribute('aria-label')).toContain('Fixture/a');
    }
    expect(results().some(item => item.textContent?.includes('other/model'))).toBe(false);
    expect(onEnabled).not.toHaveBeenCalled(); expect(onDefault).not.toHaveBeenCalled(); expect(onAlias).not.toHaveBeenCalled(); expect(onLoadEndpoints).not.toHaveBeenCalled();
  });
  it('searches and filters the entire catalog and resets full-view pagination without changing preferences', async () => {
    const user = userEvent.setup(); const onEnabled = vi.fn(), onDefault = vi.fn(), onAlias = vi.fn(), onLoadEndpoints = vi.fn();
    const rows = [...ids.map(id => candidate(id)), ...Array.from({ length: 45 }, (_, i) => candidate(`other/model-${String(i).padStart(2, '0')}`))];
    render(<ModelManager {...props(rows, { onEnabled, onDefault, onAlias, onLoadEndpoints })} />);
    await user.click(screen.getByRole('tab', { name: 'Notes' })); expect(results()).toHaveLength(5);
    await user.click(screen.getByRole('button', { name: 'Show all models' })); expect(results()).toHaveLength(20);
    await user.click(screen.getByRole('button', { name: 'Next page' })); expect(screen.getByText('50 routes · Page 2 of 3')).toBeTruthy();
    await user.type(screen.getByRole('searchbox', { name: 'Search models' }), 'other/model-44'); expect(results()).toHaveLength(1);
    expect(results()[0].textContent).toContain('other/model-44'); expect(screen.getByText('1 routes · Page 1 of 1')).toBeTruthy();
    await user.clear(screen.getByRole('searchbox', { name: 'Search models' })); expect(screen.getByText('50 routes · Page 1 of 3')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Show shortlist' })); expect(results()).toHaveLength(5);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Provider' }), 'openrouter'); expect(results()).toHaveLength(20);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Provider' }), 'all'); expect(results()).toHaveLength(5);
    expect(onEnabled).not.toHaveBeenCalled(); expect(onDefault).not.toHaveBeenCalled(); expect(onAlias).not.toHaveBeenCalled(); expect(onLoadEndpoints).not.toHaveBeenCalled();
  });
  it('keeps explicit endpoint loading visible and verbose alias/default controls inside native Details', async () => {
    const user = userEvent.setup(); const onLoadEndpoints = vi.fn(), onAlias = vi.fn(); const r = candidate(ids[0]);
    render(<ModelManager {...props([r], { onLoadEndpoints, onAlias })} />); await user.click(screen.getByRole('tab', { name: 'Notes' }));
    const item = results()[0]; const aliasInput = within(item).getByLabelText('Display alias') as HTMLInputElement;
    const details = aliasInput.closest('details'); expect(details).not.toBeNull(); expect(details!.open).toBe(false);
    expect(within(item).getByRole('button', { name: 'Load endpoints' }).closest('details')).toBeNull();
    await user.click(within(item).getByRole('button', { name: 'Load endpoints' })); expect(onLoadEndpoints).toHaveBeenCalledWith(r.route);
    await user.click(within(item).getByText('Details · metadata')); expect(details!.open).toBe(true);
    await user.type(aliasInput, 'Local candidate alias'); expect(onAlias).not.toHaveBeenCalled();
    await user.click(within(item).getByRole('button', { name: 'Save alias' })); expect(onAlias).toHaveBeenCalledWith(r.key, 'Local candidate alias');
  });
  it.each(['en', 'ko'] as const)('attributes the dated top-20 subset without inventing price or quality (%s)', async language => {
    const user = userEvent.setup(); const r = candidate(ids[4]);
    render(<ModelManager {...props([{ ...r, metadata: { ...r.metadata, pricing: { kind: 'unknown', snapshot: null, missingDimensions: ['prompt'], unsupportedDimensions: [], conditionalDimensions: [] } } }], { language })} />);
    await user.click(screen.getByRole('tab', { name: language === 'en' ? 'Notes' : '정리 노트' }));
    await user.click(screen.getByText(language === 'en' ? 'Details · shortlist basis' : '자세히 보기 · 선정 기준'));
    const details = screen.getByText(language === 'en' ? 'Details · shortlist basis' : '자세히 보기 · 선정 기준').closest('details')!;
    expect(details.textContent).toContain('2026-10-02T16:51:45Z'); expect(details.textContent).toMatch(language === 'en' ? /top 20/ : /상위 20/);
    expect(within(details).getByRole('link', { name: 'OpenRouter' }).getAttribute('href')).toBe('https://openrouter.ai/api/v1/models?sort=most-popular&limit=20');
    expect(within(details).getByRole('link', { name: 'CC BY 4.0' }).getAttribute('href')).toBe('https://creativecommons.org/licenses/by/4.0/');
    expect(details.textContent).toMatch(language === 'en' ? /not a quality/ : /품질.*순위가 아니/);
    expect(details.textContent).toMatch(language === 'en' ? /does not guarantee/ : /보장하지/);
    const item = within(screen.getByRole('list', { name: language === 'en' ? 'Model routes' : '모델 경로' })).getByRole('listitem');
    expect(item.textContent).toContain(language === 'en' ? 'Unknown pricing' : '요금 확인 불가');
    expect(item.textContent).not.toContain('0 USD');
  });
});
