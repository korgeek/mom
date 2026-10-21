// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App, { defaultPreferences, type AppController } from '../src/react-app/App';

afterEach(cleanup);
function controller(extra: Partial<AppController> = {}): AppController {
  return { session: 'locked', projects: [], selectedProjectId: null, screen: 'home', settingsTab: 'security',
    preferences: { ...defaultPreferences, uiLanguage: 'en' }, defaultAudioOptions: { chunkMinutes: 5, overlapSeconds: 5, expectedLanguages: ['ko', 'en'], bitrateKbps: 32, sampleRateHz: 16000 },
    modelCatalog: null, sttModelId: '', connections: [], storageEstimate: null, ...extra };
}
const resetButton = 'Delete all MoM data in this browser and start over';
describe('explicit passwordless reset UI', () => {
  it.each(['locked', 'unlocked'] as const)('replaces reset help with confirmation and restores it on cancel: %s', async session => {
    const user = userEvent.setup(), onResetVault = vi.fn();
    render(<App controller={controller({ session, screen: session === 'unlocked' ? 'settings' : 'home', onResetVault })} />);
    if (session === 'unlocked') await user.click(screen.getByText('Vault reset', { exact: true }));
    const help = 'You can delete this browser vault and start over without recovering the passphrase.';
    expect(screen.getByText(help)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: resetButton }));
    expect(screen.queryByText('Forgot your passphrase?')).toBeNull();
    expect(screen.queryByText(help)).toBeNull();
    expect(screen.queryByRole('button', { name: resetButton })).toBeNull();
    const dialog = screen.getByRole('dialog', { name: 'Delete this browser vault?' });
    await user.type(within(dialog).getByRole('textbox'), 'delete');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('Forgot your passphrase?')).toBeTruthy();
    expect(screen.getByText(help)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: resetButton }));
    expect((within(screen.getByRole('dialog')).getByRole('textbox') as HTMLInputElement).value).toBe('');
    expect((within(screen.getByRole('dialog')).getByRole('button', { name: 'Permanently delete vault data' }) as HTMLButtonElement).disabled).toBe(true);
    expect(onResetVault).not.toHaveBeenCalled();
  });
  it('offers reset while locked, defaults focus to cancel and rejects missing/wrong confirmation', async () => {
    const user = userEvent.setup(), onResetVault = vi.fn(); render(<App controller={controller({ onResetVault })} />);
    await user.click(screen.getByRole('button', { name: resetButton })); const dialog = screen.getByRole('dialog', { name: 'Delete this browser vault?' });
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(dialog.textContent).toContain('voice memos, audio copies, transcripts, notes, saved provider keys and preferences');
    expect(dialog.textContent).toContain('original files, exported copies, provider retention or charges');
    const final = within(dialog).getByRole('button', { name: 'Permanently delete vault data' }); expect((final as HTMLButtonElement).disabled).toBe(true);
    const input = within(dialog).getByRole('textbox');
    for (const phrase of ['wrong', 'delet', 'delete!', 'delete now', ' delete', 'delete ', 'DELETE MOM DATA', 'MoM 데이터 삭제']) {
      await user.clear(input); await user.type(input, phrase); expect((final as HTMLButtonElement).disabled).toBe(true);
    }
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' })); expect(screen.queryByRole('dialog')).toBeNull(); expect(onResetVault).not.toHaveBeenCalled();
  });
  it.each([
    ['ko', 'delete'], ['ko', 'DELETE'], ['ko', 'DeLeTe'],
    ['en', 'delete'], ['en', 'DELETE'], ['en', 'DeLeTe'],
  ] as const)('accepts case-insensitive delete with an explicit final click: %s / %s', async (language, phrase) => {
    const user = userEvent.setup(), onResetVault = vi.fn(); render(<App controller={controller({ preferences: { ...defaultPreferences, uiLanguage: language }, onResetVault })} />);
    await user.click(screen.getByRole('button', { name: language === 'ko' ? '이 브라우저의 MoM 데이터 모두 삭제하고 새로 시작' : resetButton }));
    const dialog = screen.getByRole('dialog'); await user.type(within(dialog).getByRole('textbox'), phrase);
    expect(onResetVault).not.toHaveBeenCalled(); await user.click(within(dialog).getByRole('button', { name: language === 'ko' ? '보관함 데이터 영구 삭제' : 'Permanently delete vault data' }));
    expect(onResetVault).toHaveBeenCalledOnce(); expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('uses the same final confirmation in unlocked Security settings', async () => {
    const user = userEvent.setup(), onResetVault = vi.fn(); render(<App controller={controller({ session: 'unlocked', screen: 'settings', onResetVault })} />);
    await user.click(screen.getByText('Vault reset', { exact: true }));
    await user.click(screen.getByRole('button', { name: resetButton })); const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByRole('textbox'), 'DeLeTe'); expect(onResetVault).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Permanently delete vault data' })); expect(onResetVault).toHaveBeenCalledOnce();
  });
  it('shows reset pending and then failed recovery without ordinary save/discard actions or false success', () => {
    const onResetVault = vi.fn(), onRetryLock = vi.fn(), onDiscardAndLock = vi.fn();
    const { rerender } = render(<App controller={controller({ session: 'locking', resettingVault: true, onResetVault, onRetryLock, onDiscardAndLock })} />);
    expect(screen.getByRole('status').textContent).toContain('Deleting this browser vault'); expect((screen.getByRole('button', { name: resetButton }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<App controller={controller({ session: 'save-failed', resetVaultError: 'Reset failed. Close other MoM tabs and retry explicitly.', onResetVault, onRetryLock, onDiscardAndLock })} />);
    expect(screen.getByRole('alert').textContent).toContain('Reset failed'); expect(screen.queryByRole('button', { name: 'Retry saving and lock' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Discard unsaved work and lock' })).toBeNull(); expect(screen.queryByRole('heading', { name: 'Create a new vault' })).toBeNull();
    expect((screen.getByRole('button', { name: resetButton }) as HTMLButtonElement).disabled).toBe(false); expect(onResetVault).not.toHaveBeenCalled();
  });
  it('never exposes ordinary lock recovery during a pending reset cleanup failure', () => {
    render(<App controller={controller({ session: 'save-failed', resettingVault: true, onResetVault: vi.fn(), onRetryLock: vi.fn(), onDiscardAndLock: vi.fn() })} />);
    expect(screen.queryByRole('button', { name: 'Retry saving and lock' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Discard unsaved work and lock' })).toBeNull();
    expect((screen.getByRole('button', { name: resetButton }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('never offers unavailable reset or reset on a new vault, and preserves ordinary save-failed recovery', () => {
    const { rerender } = render(<App controller={controller()} />); expect((screen.getByRole('button', { name: resetButton }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<App controller={controller({ session: 'new', onResetVault: vi.fn() })} />); expect(screen.queryByRole('button', { name: resetButton })).toBeNull();
    rerender(<App controller={controller({ session: 'save-failed', onRetryLock: vi.fn(), onDiscardAndLock: vi.fn() })} />);
    expect(screen.getByRole('button', { name: 'Retry saving and lock' })).toBeTruthy(); expect(screen.getByRole('button', { name: 'Discard unsaved work and lock' })).toBeTruthy();
  });
});
