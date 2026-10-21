// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import App, { type AppController, type AppScreen, defaultPreferences } from '../src/react-app/App';

afterEach(cleanup);

function controller(patch: Partial<AppController> = {}): AppController {
  return {
    session: 'unlocked', projects: [], selectedProjectId: null, screen: 'home', settingsTab: 'connections',
    preferences: { ...defaultPreferences, uiLanguage: 'en' },
    defaultAudioOptions: { chunkMinutes: 10, overlapSeconds: 10, expectedLanguages: ['en'], bitrateKbps: 32, sampleRateHz: 16000 },
    modelCatalog: null, sttModelId: '', connections: [], storageEstimate: null,
    onNavigate: vi.fn(), onLock: vi.fn(), ...patch,
  };
}
const trigger = () => screen.getByRole('button', { name: 'Navigation menu' });
const navigation = () => screen.getByRole('navigation', { name: 'Quick navigation' });

it.each(['en', 'ko'] as const)('opens labelled navigation actions with decorative SVG icons in %s', async language => {
  const user = userEvent.setup();
  render(<App controller={controller({ preferences: { ...defaultPreferences, uiLanguage: language } })} />);
  const button = screen.getByRole('button', { name: language === 'en' ? 'Navigation menu' : '탐색 메뉴' });
  expect(button.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByRole('navigation', { name: language === 'en' ? 'Quick navigation' : '빠른 탐색' })).toBeNull();
  await user.click(button);
  expect(button.getAttribute('aria-expanded')).toBe('true');
  const panel = screen.getByRole('navigation', { name: language === 'en' ? 'Quick navigation' : '빠른 탐색' });
  expect(panel.id).toBe(button.getAttribute('aria-controls'));
  const names = language === 'en' ? ['History', 'Settings', 'Lock now'] : ['처리 기록', '설정', '지금 잠그기'];
  for (const name of names) {
    const action = within(panel).getByRole('button', { name });
    expect(action.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  }
  await user.click(button);
  expect(button.getAttribute('aria-expanded')).toBe('false');
});

it.each(['History', 'Settings'] as const)('dispatches only the selected %s action and closes the disclosure', async name => {
  const user = userEvent.setup(), c = controller();
  render(<App controller={c} />);
  await user.click(trigger());
  expect(c.onNavigate).not.toHaveBeenCalled(); expect(c.onLock).not.toHaveBeenCalled();
  await user.click(within(navigation()).getByRole('button', { name }));
  expect(c.onNavigate).toHaveBeenCalledExactlyOnceWith(name.toLowerCase());
  expect(c.onLock).not.toHaveBeenCalled();
  expect(screen.queryByRole('navigation', { name: 'Quick navigation' })).toBeNull();
});

it.each([
  { name: 'busy', patch: { busy: true }, disabled: true },
  { name: 'recording during busy work', patch: { busy: true, recordingActive: true }, disabled: false },
  { name: 'no navigation controller', patch: { onNavigate: undefined }, disabled: true },
])('preserves navigation availability for $name and keeps lock reachable', async ({ patch, disabled }) => {
  const user = userEvent.setup(), c = controller(patch);
  render(<App controller={c} />);
  expect((trigger() as HTMLButtonElement).disabled).toBe(false);
  await user.click(trigger());
  for (const name of ['History', 'Settings']) {
    const action = within(navigation()).getByRole('button', { name }) as HTMLButtonElement;
    expect(action.disabled).toBe(disabled);
    if (disabled) await user.click(action);
  }
  if (disabled && c.onNavigate) expect(c.onNavigate).not.toHaveBeenCalled();
  const lock = within(navigation()).getByRole('button', { name: 'Lock now' });
  expect((lock as HTMLButtonElement).disabled).toBe(false);
  await user.click(lock);
  expect(c.onLock).toHaveBeenCalledOnce(); expect(trigger().getAttribute('aria-expanded')).toBe('false');
});

it('disables lock when the controller does not provide it', async () => {
  const user = userEvent.setup(); render(<App controller={controller({ onLock: undefined })} />);
  await user.click(trigger());
  const lock = within(navigation()).getByRole('button', { name: 'Lock now' }) as HTMLButtonElement;
  expect(lock.disabled).toBe(true); await user.click(lock);
  expect(trigger().getAttribute('aria-expanded')).toBe('true');
});

it('supports Enter, normal Tab order, and Escape with focus returned to the trigger', async () => {
  const user = userEvent.setup(); render(<App controller={controller()} />);
  const button = trigger(); button.focus(); await user.keyboard('{Enter}');
  expect(document.activeElement).toBe(button);
  await user.tab(); expect(document.activeElement).toBe(within(navigation()).getByRole('button', { name: 'History' }));
  await user.tab(); expect(document.activeElement).toBe(within(navigation()).getByRole('button', { name: 'Settings' }));
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('navigation', { name: 'Quick navigation' })).toBeNull();
  expect(document.activeElement).toBe(button);
});

it('dismisses on outside touch and focus movement without stealing the outside focus', async () => {
  const user = userEvent.setup(); render(<><App controller={controller()} /><button>Outside control</button></>);
  await user.click(trigger());
  const outside = screen.getByRole('button', { name: 'Outside control' });
  fireEvent.pointerDown(outside, { pointerType: 'touch' });
  expect(trigger().getAttribute('aria-expanded')).toBe('false');
  await user.click(trigger()); act(() => outside.focus());
  expect(trigger().getAttribute('aria-expanded')).toBe('false'); expect(document.activeElement).toBe(outside);
});

it('lets navigation focus the destination heading and closes when the route changes elsewhere', async () => {
  function Harness() {
    const [route, setRoute] = useState<AppScreen>('home');
    return <App controller={controller({ screen: route, onNavigate: setRoute })} />;
  }
  const user = userEvent.setup(); render(<Harness />);
  await user.click(trigger()); await user.click(within(navigation()).getByRole('button', { name: 'History' }));
  expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Processing history', level: 1 }));
  await user.click(trigger());
  expect(within(navigation()).getByRole('button', { name: 'History' }).getAttribute('aria-current')).toBe('page');
  await user.click(screen.getByRole('button', { name: 'Minutes of Meeting' }));
  expect(trigger().getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Voice memos', level: 1 }));
});

it('removes open navigation from the DOM at the vault privacy boundary and unlocks closed', async () => {
  const user = userEvent.setup(), c = controller();
  const view = render(<App controller={c} />);
  await user.click(trigger());
  view.rerender(<App controller={{ ...c, session: 'locking' }} />);
  expect(screen.queryByRole('navigation', { name: 'Quick navigation' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Navigation menu' })).toBeNull();
  expect(screen.queryByRole('complementary', { name: 'Voice memo navigation' })).toBeNull();
  view.rerender(<App controller={c} />);
  expect(trigger().getAttribute('aria-expanded')).toBe('false');
});
