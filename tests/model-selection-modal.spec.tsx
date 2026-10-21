// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Settings from '../src/react-app/ui/screens/Settings';
import { defaultPreferences, type AppController } from '../src/react-app/App';
import { emptyModelRegistry, observeRouterSTTRoute } from '../src/react-app/providers/model-registry';
import { modelManagementRows } from '../src/react-app/providers/registry-consumer';
const route = { connectionId: 'openrouter', provider: 'openrouter', stage: 'stt', modelId: 'openai/gpt-4o-mini-transcribe', endpointTag: null } as const;
const observed = observeRouterSTTRoute(route, { id: route.modelId, name: 'TEST_ONLY Mini', source: 'TEST_ONLY catalog', checkedAt: '2026-10-04T00:00:00Z', inputModalities: ['audio'], outputModalities: ['transcription'], adapterStatus: 'unsupported', pricing: { status: 'unknown', raw: null } });
function fixture(patch: Partial<AppController> = {}): AppController { return { session: 'unlocked', projects: [], selectedProjectId: null, screen: 'settings', settingsTab: 'connections', preferences: { ...defaultPreferences, uiLanguage: 'en' }, defaultAudioOptions: { chunkMinutes: 10, overlapSeconds: 10, expectedLanguages: ['en'], bitrateKbps: 32, sampleRateHz: 16000 }, modelCatalog: [], sttModelId: '', storageEstimate: null, connections: [{ provider: 'openrouter', status: 'saved' }], modelRegistry: emptyModelRegistry(), modelManagement: { rows: modelManagementRows(emptyModelRegistry(), [observed]), revision: 10, language: 'en', busy: false, discoveryAvailability: { openai: false, openrouter: true }, onApplySelection: vi.fn(async () => {}) }, ...patch }; }
afterEach(() => cleanup());
async function open(user: ReturnType<typeof userEvent.setup>) { await user.click(screen.getByRole('button', { name: 'Select OpenRouter models' })); return screen.getByRole('dialog', { name: 'Select models' }); }
it('waits for public metadata preparation from the explicit opener before showing an actionable draft', async () => {
 const user = userEvent.setup(), c = fixture(); let release!: () => void;
 const prepare = vi.fn(() => new Promise<void>(resolve => { release = resolve; })); c.modelManagement = { ...c.modelManagement!, onPrepareSelection: prepare };
 render(<Settings controller={c} />); await user.click(screen.getByRole('button', { name: 'Select OpenRouter models' }));
 expect(prepare).toHaveBeenCalledExactlyOnceWith('openrouter'); expect(screen.queryByRole('dialog')).toBeNull(); expect(screen.getByRole('status').textContent).toMatch(/public metadata/i);
 release(); await vi.waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
});
it('edits only a draft; Escape restores focus and reopen restores saved/recommended choices', async () => {
 const user = userEvent.setup(), c = fixture(); render(<Settings controller={c} />); const dialog = await open(user); const choice = within(dialog).getByRole('checkbox', { name: 'TEST_ONLY Mini' }); expect((choice as HTMLInputElement).checked).toBe(true); await user.click(choice); expect(c.modelManagement!.onApplySelection).not.toHaveBeenCalled(); await user.keyboard('{Escape}'); expect(screen.queryByRole('dialog')).toBeNull(); expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Select OpenRouter models' })); const again = await open(user); expect((within(again).getByRole('checkbox', { name: 'TEST_ONLY Mini' }) as HTMLInputElement).checked).toBe(true);
});
it('records an unchecked recommendation on Apply and retains a failed draft with a safe error', async () => {
 const user = userEvent.setup(), c = fixture(), apply = vi.fn(async () => { throw new Error('TEST_ONLY private upstream'); }); c.modelManagement = { ...c.modelManagement!, onApplySelection: apply }; render(<Settings controller={c} />); const dialog = await open(user); await user.click(within(dialog).getByRole('checkbox', { name: 'TEST_ONLY Mini' })); await user.click(within(dialog).getByRole('button', { name: 'Apply' })); expect(apply).toHaveBeenCalledExactlyOnceWith({ baseRevision: 10, changes: [{ key: c.modelManagement!.rows[0].key, enabled: false }], defaultChanges: [] }); expect((within(dialog).getByRole('checkbox', { name: 'TEST_ONLY Mini' }) as HTMLInputElement).checked).toBe(false); expect(within(dialog).getByRole('alert').textContent).not.toContain('TEST_ONLY private');
});
it('shows saved blocked routes for removal; unsupported new rows require Show all; OpenAI text is unavailable', async () => {
 const user = userEvent.setup(), c = fixture(), base = c.modelManagement!.rows[0]; c.modelManagement = { ...c.modelManagement!, rows: [base, { ...base, key: 'TEST_ONLY_BLOCKED', alias: 'Blocked saved', userEnabled: true, status: 'stale', blockedReason: 'stale' }, { ...base, key: 'TEST_ONLY_NEW_UNSUPPORTED', route: { ...route, modelId: 'TEST_ONLY unsupported' }, metadata: { ...base.metadata, name: 'Unsupported new', compatible: false, blockers: ['unsupported-adapter'] }, blockedReason: 'unsupported-adapter' }] }; render(<Settings controller={c} />); const dialog = await open(user); expect(within(dialog).getByRole('checkbox', { name: 'Blocked saved' })).toBeTruthy(); expect(within(dialog).queryByRole('checkbox', { name: 'Unsupported new' })).toBeNull(); await user.click(within(dialog).getByRole('button', { name: 'Show all models' })); expect((within(dialog).getByRole('checkbox', { name: 'Unsupported new' }) as HTMLInputElement).disabled).toBe(true); await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Provider' }), 'openai'); await user.click(within(dialog).getByRole('tab', { name: 'Text generation' })); expect(within(dialog).getByText(/Direct OpenAI text generation is not available/)).toBeTruthy();
});
it('invalidates stale drafts explicitly and removes them from the DOM on lock', async () => {
 const user = userEvent.setup(), c = fixture(), view = render(<Settings controller={c} />); await open(user); view.rerender(<Settings controller={{ ...c, modelManagement: { ...c.modelManagement!, revision: 11 } }} />); expect((screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled).toBe(true); expect(screen.getByRole('alert').textContent).toMatch(/changed/i); view.rerender(<Settings controller={{ ...c, session: 'locked', modelManagement: null }} />); expect(screen.queryByRole('dialog')).toBeNull(); expect(screen.queryByText('TEST_ONLY Mini')).toBeNull();
});
it('traps Tab focus and keeps saving controls truthful until a confirmed receipt', async () => {
 const user = userEvent.setup(); let release!: () => void; const c = fixture(); c.modelManagement = { ...c.modelManagement!, onApplySelection: () => new Promise<void>(r => { release = r; }) }; render(<Settings controller={c} />); const dialog = await open(user), apply = within(dialog).getByRole('button', { name: 'Apply' }); apply.focus(); await user.keyboard('{Tab}'); expect(dialog.contains(document.activeElement)).toBe(true); await user.click(apply); expect((within(dialog).getByRole('button', { name: 'Saving…' }) as HTMLButtonElement).disabled).toBe(true); await user.keyboard('{Escape}'); expect(screen.getByRole('dialog')).toBeTruthy(); release(); await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

it('preserves an existing explicit disabled decision and only submits an intentionally chosen prospective default', async () => {
 const user = userEvent.setup(), c = fixture(); c.modelManagement = { ...c.modelManagement!, rows: c.modelManagement!.rows.map(r => ({ ...r, status: 'current' })) }; render(<Settings controller={c} />); const dialog = await open(user), choice = within(dialog).getByRole('checkbox', { name: 'TEST_ONLY Mini' }); expect((choice as HTMLInputElement).checked).toBe(false); await user.click(choice); await user.click(within(dialog).getByText('Additional information', { exact: true })); await user.click(within(dialog).getByRole('radio', { name: 'Use as stage default for new voice memos' })); await user.click(within(dialog).getByRole('button', { name: 'Apply' })); expect(c.modelManagement!.onApplySelection).toHaveBeenCalledWith({ baseRevision: 10, changes: [{ key: c.modelManagement!.rows[0].key, enabled: true }], defaultChanges: [{ stage: 'stt', key: c.modelManagement!.rows[0].key }] });
});
it('disables Apply honestly when no owned revision/save callback is available', async () => {
 const user = userEvent.setup(), c = fixture(); c.modelManagement = { ...c.modelManagement!, revision: undefined, onApplySelection: undefined }; render(<Settings controller={c} />); const dialog = await open(user); expect((within(dialog).getByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled).toBe(true);
});
it('shows the latest replacement failure even while the previous key remains saved', () => {
 const c = fixture({ keySaveAttempts: { openrouter: { status: 'failed', revision: 2, message: 'This key could not be saved.' } } }); render(<Settings controller={c} />); expect(screen.getByText('Saved · connection unverified')).toBeTruthy(); expect(screen.getByRole('alert').textContent).toBe('This key could not be saved.'); expect((screen.getByRole('button', { name: 'Select OpenRouter models' }) as HTMLButtonElement).disabled).toBe(false);
});
it('keeps retention acknowledgement explicit and clears it when the selected policy changes', async () => {
 const user = userEvent.setup(), savePolicy = vi.fn(async () => {}), c = fixture({ onRouterSTTPreference: savePolicy }); render(<Settings controller={c} />);
 await user.click(screen.getByText('Additional information · retention policy')); const save = screen.getByRole('button', { name: 'Save transcription policy' }), acknowledgement = screen.getByRole('checkbox', { name: 'I reviewed OpenRouter audio transmission and the selected retention policy' });
 expect((save as HTMLButtonElement).disabled).toBe(true); await user.click(acknowledgement); await user.selectOptions(screen.getByRole('combobox', { name: 'OpenRouter transcription retention' }), 'standard'); expect((acknowledgement as HTMLInputElement).checked).toBe(false); expect((save as HTMLButtonElement).disabled).toBe(true); expect(savePolicy).not.toHaveBeenCalled();
 await user.click(acknowledgement); await user.click(save); expect(savePolicy).toHaveBeenCalledExactlyOnceWith('openrouter', { policy: { dataCollection: 'deny', requireZdr: false }, acknowledgedDisclosureVersion: 'or-stt-1', initialDefaultApplied: false });
});
it('blocks stale metadata acceptance until the refreshed revision is explicitly reviewed', async () => {
 const user = userEvent.setup(), c = fixture(), accept = vi.fn(), base = c.modelManagement!.rows[0];
 const old = { ...base, userEnabled: true, status: 'current' as const, metadataAcceptanceRequired: true, blockedReason: 'metadata-changed', metadata: { ...base.metadata, name: 'TEST_ONLY reviewed metadata A' } };
 c.modelManagement = { ...c.modelManagement!, rows: [old], onAcceptMetadata: accept };
 const view = render(<Settings controller={c} />), dialog = await open(user);
 await user.click(within(dialog).getByText('Additional information', { exact: true }));
 const fresh = { ...c, modelManagement: { ...c.modelManagement!, revision: 11, rows: [{ ...old, metadata: { ...old.metadata, name: 'TEST_ONLY unseen metadata B' } }] } };
 view.rerender(<Settings controller={fresh} />);
 expect(within(dialog).getByRole('checkbox', { name: 'TEST_ONLY reviewed metadata A' })).toBeTruthy();
 expect(within(dialog).queryByText('TEST_ONLY unseen metadata B')).toBeNull();
 const button = within(dialog).getByRole('button', { name: 'Accept changed metadata' }) as HTMLButtonElement;
 expect(button.disabled).toBe(true); await user.click(button); expect(accept).not.toHaveBeenCalled();
 await user.click(within(dialog).getByRole('button', { name: 'Review refreshed list' }));
 expect(within(dialog).getByRole('checkbox', { name: 'TEST_ONLY unseen metadata B' })).toBeTruthy();
 await user.click(within(dialog).getByRole('button', { name: 'Accept changed metadata' }));
 expect(accept).toHaveBeenCalledExactlyOnceWith(old.key, 11);
});
it('undoes a newly chosen draft default when that route is unchecked', async () => {
 const user = userEvent.setup(), c = fixture(); render(<Settings controller={c} />); const dialog = await open(user);
 await user.click(within(dialog).getByText('Additional information', { exact: true }));
 const radio = within(dialog).getByRole('radio', { name: 'Use as stage default for new voice memos' }) as HTMLInputElement;
 await user.click(radio); expect(radio.checked).toBe(true);
 await user.click(within(dialog).getByRole('checkbox', { name: 'TEST_ONLY Mini' })); expect(radio.checked).toBe(false);
 await user.click(within(dialog).getByRole('button', { name: 'Apply' }));
 expect(c.modelManagement!.onApplySelection).toHaveBeenCalledExactlyOnceWith({ baseRevision: 10, changes: [{ key: c.modelManagement!.rows[0].key, enabled: false }], defaultChanges: [] });
});
it('preserves the saved authoritative default when its route is unchecked', async () => {
 const user = userEvent.setup(), c = fixture(); c.modelManagement = { ...c.modelManagement!, rows: c.modelManagement!.rows.map(row => ({ ...row, status: 'current', userEnabled: true, isDefault: true })) };
 render(<Settings controller={c} />); const dialog = await open(user); await user.click(within(dialog).getByText('Additional information', { exact: true }));
 const radio = within(dialog).getByRole('radio', { name: 'Use as stage default for new voice memos' }) as HTMLInputElement;
 await user.click(within(dialog).getByRole('checkbox', { name: 'TEST_ONLY Mini' })); expect(radio.checked).toBe(true); expect(radio.disabled).toBe(true);
 await user.click(within(dialog).getByRole('button', { name: 'Apply' }));
 expect(c.modelManagement!.onApplySelection).toHaveBeenCalledExactlyOnceWith({ baseRevision: 10, changes: [{ key: c.modelManagement!.rows[0].key, enabled: false }], defaultChanges: [] });
});
it.each([undefined, NaN, 1.5])('disables metadata acceptance for a missing or invalid reviewed revision: %s', async revision => {
 const user = userEvent.setup(), c = fixture(), accept = vi.fn(); c.modelManagement = { ...c.modelManagement!, revision, onAcceptMetadata: accept, rows: c.modelManagement!.rows.map(row => ({ ...row, status: 'current', userEnabled: true, metadataAcceptanceRequired: true })) };
 render(<Settings controller={c} />); const dialog = await open(user); await user.click(within(dialog).getByText('Additional information', { exact: true }));
 const button = within(dialog).getByRole('button', { name: 'Accept changed metadata' }) as HTMLButtonElement;
 expect(button.disabled).toBe(true); await user.click(button); expect(accept).not.toHaveBeenCalled();
});
