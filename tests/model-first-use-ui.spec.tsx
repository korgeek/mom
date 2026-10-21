// @vitest-environment jsdom
// Catalog fixtures only: no provider authentication or inference.
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ModelSelectionModal from '../src/react-app/ui/components/ModelSelectionModal';
import type { ModelManagerProps } from '../src/react-app/ui/components/ModelManager';
import { emptyModelRegistry, observeRouterSTTRoute, observeMinutesRoute } from '../src/react-app/providers/model-registry';
import { parseRouterModels, parseRouterEndpoints } from '../src/react-app/providers/catalog';
import { modelManagementRows } from '../src/react-app/providers/registry-consumer';
import { MINUTES_SHORTLIST } from '../src/react-app/providers/model-shortlist';
const at = '2026-10-04T00:00:00Z';
const sttRoute = { provider: 'openrouter', connectionId: 'openrouter', stage: 'stt', modelId: 'openai/gpt-4o-mini-transcribe', endpointTag: null } as const;
const stt = observeRouterSTTRoute(sttRoute, { id: sttRoute.modelId, name: 'TEST_ONLY Mini', source: 'TEST_ONLY catalog', checkedAt: at, inputModalities: ['audio'], outputModalities: ['transcription'], adapterStatus: 'unsupported', pricing: { status: 'unknown', raw: null } });
function text(id: string, exact = true) {
 const model = parseRouterModels({ data: [{ id, name: `TEST_ONLY ${id}`, context_length: 32000, top_provider: { max_completion_tokens: 4096 }, architecture: { input_modalities: ['text'], output_modalities: ['text'] }, supported_parameters: ['max_tokens'], pricing: { prompt: '0.000001', completion: '0.000002', request: '0' } }] }, at)[0];
 const endpoint = parseRouterEndpoints({ data: { id, endpoints: [{ tag: 'TEST_ONLY/explicit', context_length: 32000, max_prompt_tokens: 28000, max_completion_tokens: 4096, supported_parameters: ['max_tokens'], pricing: { prompt: '0.000001', completion: '0.000002', request: '0' } }] } }, id, at)[0];
 return observeMinutesRoute({ provider: 'openrouter', connectionId: 'openrouter', stage: 'minutes', modelId: id, endpointTag: exact ? endpoint.tag : null }, model, exact ? endpoint : null);
}
function controls(observations = [stt]): ModelManagerProps { return { rows: modelManagementRows(emptyModelRegistry(), observations), revision: 10, language: 'en', busy: false, discoveryAvailability: { openai: false, openrouter: true }, onApplySelection: vi.fn(async () => {}), onLoadEndpoints: vi.fn(), onDiscover: vi.fn() }; }
function firstUseMinutes() {
 return [['openai/gpt-6-luna', 'openai'], ['google/gemini-3.8-flash', 'google-ai-studio'], ['anthropic/claude-opus-5.5', 'anthropic']].map(([id, tag]) => {
  const base = text(id), route = { ...base.route, endpointTag: tag };
  return { route, metadata: { ...base.metadata, route } };
 });
}
afterEach(cleanup);
it('does not save unseen OpenRouter recommendations from an OpenAI modal after cancelling the OpenRouter draft', async () => {
 const user = userEvent.setup(), c = controls(firstUseMinutes()), close = vi.fn();
 const first = render(<ModelSelectionModal controls={c} provider="openrouter" onClose={close} />);
 await user.click(screen.getByRole('tab', { name: 'Text generation' }));
 expect(screen.getAllByRole('checkbox').every(input => (input as HTMLInputElement).checked)).toBe(true);
 await user.click(screen.getByRole('button', { name: 'Cancel' })); expect(close).toHaveBeenCalledOnce(); first.unmount();
 render(<ModelSelectionModal controls={c} provider="openai" onClose={() => {}} />);
 expect(screen.queryByRole('checkbox')).toBeNull();
 await user.click(screen.getByRole('button', { name: 'Apply' }));
 expect(c.onApplySelection).toHaveBeenCalledExactlyOnceWith({ baseRevision: 10, changes: [], defaultChanges: [] });
});
it('initializes a switched-to provider once and keeps its reviewed choices when Apply is clicked from another provider', async () => {
 const user = userEvent.setup(), c = controls(firstUseMinutes());
 render(<ModelSelectionModal controls={c} provider="openai" onClose={() => {}} />);
 await user.selectOptions(screen.getByRole('combobox', { name: 'Provider' }), 'openrouter');
 await user.click(screen.getByRole('tab', { name: 'Text generation' }));
 expect(screen.getAllByRole('checkbox').every(input => (input as HTMLInputElement).checked)).toBe(true);
 const gemini = screen.getByRole('checkbox', { name: 'TEST_ONLY google/gemini-3.8-flash' }); await user.click(gemini);
 await user.selectOptions(screen.getByRole('combobox', { name: 'Provider' }), 'openai');
 await user.selectOptions(screen.getByRole('combobox', { name: 'Provider' }), 'openrouter');
 expect((screen.getByRole('checkbox', { name: 'TEST_ONLY google/gemini-3.8-flash' }) as HTMLInputElement).checked).toBe(false);
 expect((within(screen.getByRole('listitem', { name: /gpt-6-luna · openai$/ })).getByRole('radio') as HTMLInputElement).checked).toBe(true);
 await user.selectOptions(screen.getByRole('combobox', { name: 'Provider' }), 'openai');
 await user.click(screen.getByRole('button', { name: 'Apply' }));
 expect(c.onApplySelection).toHaveBeenCalledExactlyOnceWith({ baseRevision: 10, changes: c.rows.map((row, i) => ({ key: row.key, enabled: i !== 1 })), defaultChanges: [{ stage: 'minutes', key: c.rows[0].key }] });
});
it('preserves another provider saved choices and default without submitting them from the initial provider', async () => {
 const user = userEvent.setup(), base = controls(firstUseMinutes());
 const c: ModelManagerProps = { ...base, rows: base.rows.map((row, i) => ({ ...row, status: 'current', userEnabled: i === 0, isDefault: i === 0 })) };
 render(<ModelSelectionModal controls={c} provider="openai" onClose={() => {}} />);
 await user.selectOptions(screen.getByRole('combobox', { name: 'Provider' }), 'openrouter'); await user.click(screen.getByRole('tab', { name: 'Text generation' }));
 expect((within(screen.getByRole('listitem', { name: /gpt-6-luna · openai$/ })).getByRole('radio') as HTMLInputElement).checked).toBe(true);
 expect(screen.getAllByRole('checkbox').filter(input => (input as HTMLInputElement).checked)).toHaveLength(1);
 await user.selectOptions(screen.getByRole('combobox', { name: 'Provider' }), 'openai'); await user.click(screen.getByRole('button', { name: 'Apply' }));
 expect(c.onApplySelection).toHaveBeenCalledExactlyOnceWith({ baseRevision: 10, changes: [], defaultChanges: [] });
});
it('prechecks at most three famous exact routes and GPT as prospective text default in a fresh draft', async () => {
 const user = userEvent.setup(), ids = ['openai/gpt-6-luna', 'google/gemini-3.8-flash', 'anthropic/claude-opus-5.5'];
 const tags = ['openai', 'google-ai-studio', 'anthropic'];
 const observations = ids.map((id, i) => { const base = text(id); return { route: { ...base.route, endpointTag: tags[i] }, metadata: { ...base.metadata, route: { ...base.route, endpointTag: tags[i] } } }; });
 const alternate = { ...observations[0], route: { ...observations[0].route, endpointTag: 'azure' }, metadata: { ...observations[0].metadata, route: { ...observations[0].route, endpointTag: 'azure' } } };
 const c = controls([text('deepseek/deepseek-v4.1-flash', false), text('nvidia/nemotron-3-ultra-550b-a55b:free', false), ...ids.map(id => text(id, false)), alternate, ...observations]); render(<ModelSelectionModal controls={c} provider="openrouter" onClose={() => {}} />);
 await user.click(screen.getByRole('tab', { name: 'Text generation' }));
 expect(screen.getAllByRole('checkbox').filter(input => (input as HTMLInputElement).checked)).toHaveLength(3);
 expect(screen.getAllByRole('listitem')).toHaveLength(3);
 expect((within(screen.getByRole('listitem', { name: /gpt-6-luna · openai$/ })).getByRole('radio') as HTMLInputElement).checked).toBe(true); expect(c.onApplySelection).not.toHaveBeenCalled();
 await user.click(screen.getByRole('button', { name: 'Show all models' })); expect(screen.getAllByRole('listitem')).toHaveLength(9);
});
it('offers an eligible STT default in the first-use draft without saving before Apply', async () => {
 const user = userEvent.setup(), c = controls(); render(<ModelSelectionModal controls={c} provider="openrouter" onClose={() => {}} />);
 await user.click(screen.getByText('Additional information', { exact: true }));
 expect((screen.getByRole('radio', { name: 'Use as stage default for new voice memos' }) as HTMLInputElement).checked).toBe(true);
 expect(c.onApplySelection).not.toHaveBeenCalled();
});
it('shows only the existing five mainstream text candidates until full catalog or search is requested', async () => {
 const user = userEvent.setup(), observations = [...MINUTES_SHORTLIST.map(({ id }) => text(id)), ...Array.from({ length: 24 }, (_, i) => text(`fixture/text-${i}`))];
 render(<ModelSelectionModal controls={controls(observations)} provider="openrouter" onClose={() => {}} />); await user.click(screen.getByRole('tab', { name: 'Text generation' }));
 expect(within(screen.getByRole('list', { name: 'Model routes' })).getAllByRole('listitem')).toHaveLength(5);
 await user.click(screen.getByRole('button', { name: 'Show all models' })); expect(screen.getAllByRole('listitem')).toHaveLength(29); await user.click(screen.getByRole('button', { name: 'Show shortlist' })); expect(screen.getAllByRole('listitem')).toHaveLength(5);
 await user.type(screen.getByRole('searchbox'), 'fixture/text-23'); expect(screen.getAllByRole('listitem')).toHaveLength(1);
});
it('makes endpoint discovery actionable in the normal text row while keeping activation exact', async () => {
 const user = userEvent.setup(), c = controls([text(MINUTES_SHORTLIST[0].id, false)]); render(<ModelSelectionModal controls={c} provider="openrouter" onClose={() => {}} />); await user.click(screen.getByRole('tab', { name: 'Text generation' }));
 const load = screen.getByRole('button', { name: 'Load endpoints' }); expect(load.closest('details')).toBeNull(); await user.click(load); expect(c.onLoadEndpoints).toHaveBeenCalledWith(c.rows[0].route);
 expect((screen.getByRole('checkbox') as HTMLInputElement).disabled).toBe(true);
});
it('makes the first explicitly checked exact text route the visible draft default, and keeps endpoint alternatives available', async () => {
 const user = userEvent.setup(), id = MINUTES_SHORTLIST[0].id, first = text(id), second = { ...text(id), route: { ...first.route, endpointTag: 'TEST_ONLY/second' }, metadata: { ...first.metadata, route: { ...first.route, endpointTag: 'TEST_ONLY/second' } } };
 const c = controls([text(id, false), first, second]); render(<ModelSelectionModal controls={c} provider="openrouter" onClose={() => {}} />); await user.click(screen.getByRole('tab', { name: 'Text generation' }));
 const exact = screen.getByRole('listitem', { name: /TEST_ONLY\/explicit$/ }), alternative = screen.getByRole('listitem', { name: /TEST_ONLY\/second$/ });
 expect((within(exact).getByRole('checkbox') as HTMLInputElement).checked).toBe(false); expect((within(alternative).getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
 await user.click(within(exact).getByRole('checkbox')); expect((within(exact).getByRole('radio') as HTMLInputElement).checked).toBe(true);
 expect(within(exact).getByText('Default for new voice memos · draft')).toBeTruthy(); await user.click(screen.getByRole('button', { name: 'Apply' }));
 expect(c.onApplySelection).toHaveBeenCalledWith({ baseRevision: 10, changes: [{ key: c.rows[1].key, enabled: true }], defaultChanges: [{ stage: 'minutes', key: c.rows[1].key }] });
});
it('retains saved explicit disabled and blocked uncurated routes in the shortlist without recommending or replacing defaults', async () => {
 const user = userEvent.setup(), base = controls([text(MINUTES_SHORTLIST[0].id), text('fixture/saved-disabled'), text('fixture/saved-blocked')]);
 const c: ModelManagerProps = { ...base, rows: base.rows.map((row, index) => index === 0 ? row : { ...row, status: index === 2 ? 'stale' : 'current', userEnabled: index === 2, isDefault: index === 2, blockedReason: index === 2 ? 'stale' : null }) };
 render(<ModelSelectionModal controls={c} provider="openrouter" onClose={() => {}} />); await user.click(screen.getByRole('tab', { name: 'Text generation' }));
 expect(screen.getByRole('checkbox', { name: 'TEST_ONLY fixture/saved-disabled' })).toBeTruthy(); const blocked = screen.getByRole('checkbox', { name: 'TEST_ONLY fixture/saved-blocked' }); expect((blocked as HTMLInputElement).checked).toBe(true);
 const choice = screen.getByRole('checkbox', { name: `TEST_ONLY ${MINUTES_SHORTLIST[0].id}` }); expect((choice as HTMLInputElement).checked).toBe(false); await user.click(choice);
 expect((within(screen.getByRole('listitem', { name: /fixture\/saved-blocked/ })).getByRole('radio') as HTMLInputElement).checked).toBe(true); await user.click(blocked); await user.click(screen.getByRole('button', { name: 'Apply' }));
 expect(c.onApplySelection).toHaveBeenCalledWith(expect.objectContaining({ defaultChanges: [] }));
});
