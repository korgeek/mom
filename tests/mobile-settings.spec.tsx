// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Settings from '../src/react-app/ui/screens/Settings';
import { defaultPreferences, type AppController } from '../src/react-app/App';

function controller(extra: Partial<AppController> = {}): AppController {
  return { session: 'unlocked', projects: [], selectedProjectId: null, screen: 'settings', settingsTab: 'models',
    preferences: { ...defaultPreferences, uiLanguage: 'en' },
    defaultAudioOptions: { chunkMinutes: 10, overlapSeconds: 10, expectedLanguages: ['ko', 'en'], bitrateKbps: 32, sampleRateHz: 16000 },
    modelCatalog: null, sttModelId: '', connections: [], storageEstimate: null, ...extra };
}

const reveal = vi.fn();
beforeEach(() => {
  // jsdom has no layout or scrolling; these dimensions represent an overflowing mobile tab row.
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(700);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(328);
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: reveal });
  reveal.mockClear();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView; });

function expectActive(name: string) {
  const tablist = within(screen.getByRole('tablist', { name: 'Settings categories' }));
  const active = tablist.getByRole('tab', { name });
  expect(active.getAttribute('aria-selected')).toBe('true');
  expect(active.tabIndex).toBe(0);
  expect(tablist.getAllByRole('tab').filter(tab => tab.tabIndex === 0)).toEqual([active]);
  expect(document.getElementById('settings-panel')?.getAttribute('aria-labelledby')).toBe(active.id);
  expect(reveal.mock.instances.at(-1)).toBe(active);
  expect(reveal).toHaveBeenLastCalledWith({ block: 'nearest', inline: 'nearest' });
  return active;
}

describe('mobile Settings tabs', () => {
  it('reveals the initial selection and each clicked tab while retaining one tab stop', async () => {
    render(<Settings controller={controller()} />);
    expectActive('Models');
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Security & lock' }));
    expectActive('Security & lock');
  });

  it('reveals and focuses keyboard selections, including wrapping and Home/End', async () => {
    render(<Settings controller={controller()} />);
    const user = userEvent.setup();
    screen.getByRole('tab', { name: 'Models' }).focus();
    for (const [key, name] of [
      ['ArrowLeft', 'Security & lock'], ['ArrowRight', 'Models'],
      ['ArrowRight', 'Processing defaults'], ['End', 'Security & lock'],
      ['Home', 'Models'], ['ArrowRight', 'Processing defaults'],
      ['ArrowRight', 'Appearance & language'],
    ]) {
      await user.keyboard(`{${key}}`);
      expect(document.activeElement).toBe(expectActive(name));
    }
  });

  it('reveals an externally selected tab without moving keyboard focus', () => {
    const onSettingsTab = vi.fn(), c = controller({ onSettingsTab });
    const view = render(<Settings controller={c} />);
    const original = screen.getByRole('tab', { name: 'Models' });
    original.focus();
    view.rerender(<Settings controller={{ ...c, settingsTab: 'security' }} />);
    expectActive('Security & lock');
    expect(document.activeElement).toBe(original);
    expect(onSettingsTab).not.toHaveBeenCalled();
  });

  it('does not scroll the page when desktop tabs fit their container', () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(960);
    render(<Settings controller={controller({ settingsTab: 'security' })} />);
    expect(reveal).not.toHaveBeenCalled();
  });

  it('reveals the selected tab after the viewport narrows without stealing focus', () => {
    let width = 960, resize = () => {};
    const disconnect = vi.fn();
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width);
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resize = callback; }
      observe() {}
      disconnect = disconnect;
    });
    const view = render(<Settings controller={controller({ settingsTab: 'security', onLock: vi.fn() })} />);
    const lock = screen.getByRole('button', { name: 'Lock now' });
    lock.focus();
    expect(reveal).not.toHaveBeenCalled();
    width = 328;
    resize();
    expectActive('Security & lock');
    expect(document.activeElement).toBe(lock);
    view.unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it.each(['ko', 'en'] as const)('keeps security disclosures readable and associated with their labels in %s', language => {
    render(<Settings controller={controller({ settingsTab: 'security', preferences: { ...defaultPreferences, uiLanguage: language } })} />);
    const panel = screen.getByRole('tabpanel');
    const labels = within(panel).getAllByRole('term');
    expect(labels.map(label => label.textContent)).toEqual(language === 'ko' ? ['암호화 대상', '키 보관', '잠금 동작'] : ['Encrypted', 'Key handling', 'Locking']);
    expect(labels[0].nextElementSibling?.textContent).toContain(language === 'ko' ? '암호화 저장 키' : 'keys set to encrypted storage');
    expect(labels[1].nextElementSibling?.textContent).toContain(language === 'ko' ? '키 참조를 해제해요.' : 'releases decrypted data and key references.');
    expect(labels[2].nextElementSibling?.textContent).toContain(language === 'ko' ? '민감한 내용을 제거하고 재생을 멈춰요.' : 'Removes sensitive screens and stops playback.');
    expect(within(panel).getByText(language === 'ko' ? '완전한 메모리 소거를 보장하지 않아요. 로컬 암호화는 외부 제공사의 데이터 보관이나 내보낸 평문을 보호하지 않아요.' : 'Complete memory zeroization is not guaranteed. Local encryption does not control provider retention or exported plaintext.')).toBeTruthy();
  });
});
