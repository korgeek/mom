// @vitest-environment jsdom
import { expect, it, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import App, { defaultPreferences, type AppController } from '../src/react-app/App';
afterEach(() => { cleanup(); vi.useRealTimers(); });
const controller = (patch: Partial<AppController> = {}): AppController => ({ session: 'unlocked', screenAccess: 'locked', preferences: defaultPreferences, projects: [], selectedProjectId: null, screen: 'home', settingsTab: 'models', defaultAudioOptions: { chunkMinutes: 10, overlapSeconds: 10, bitrateKbps: 32, sampleRateHz: 16000, expectedLanguages: ['ko'] }, sttModelId: '', modelCatalog: [], connections: [], storageEstimate: null, ...patch });
it('removes app controls while work remains live and reauthenticates through the separate screen action', () => {
  const unlock = vi.fn(), hard = vi.fn();
  render(<App controller={controller({ busy: true, onScreenUnlock: unlock, onHardLock: hard })} />);
  expect(screen.queryByRole('heading', { name: '음성 메모' })).toBeNull();
  expect(screen.getByRole('heading', { name: '화면이 잠겼어요' })).toBeTruthy();
  expect(screen.getByText(/진행 중인 작업은 계속/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('암호', {}), { target: { value: 'synthetic screen phrase' } });
  fireEvent.click(screen.getByRole('button', { name: '화면 잠금 해제' }));
  expect(unlock).toHaveBeenCalledWith('synthetic screen phrase');
  expect((screen.getByLabelText('암호', {}) as HTMLInputElement).value).toBe('');
  fireEvent.click(screen.getByRole('button', { name: '작업 중단하고 완전히 잠그기' }));
  expect(hard).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '작업 중단과 전체 잠금 확인' }));
  expect(hard).toHaveBeenCalledOnce();
});
it('always exposes the seconds counter without announcing every tick', () => {
  render(<App controller={controller({ screenAccess: 'open', autoLockRemaining: () => 59 })} />);
  // jsdom does not apply the desktop/mobile media queries.
  const timers = screen.getAllByRole('timer');
  expect(timers).toHaveLength(2);
  for (const timer of timers) {
    expect(timer.textContent).toContain('59'); expect(timer.getAttribute('aria-live')).toBe('off');
  }
});
it('warns in the last ten seconds and clears the warning after activity or disabling automatic lock', () => {
  vi.useFakeTimers();
  let remaining: number | null = 11;
  render(<App controller={controller({ screenAccess: 'open', autoLockRemaining: () => remaining })} />);
  const timers = screen.getAllByRole('timer');
  for (const value of [11, 10, 1, 60, null, 0]) {
    remaining = value; act(() => { vi.advanceTimersByTime(1000); });
    for (const timer of timers) {
      expect(timer.classList.contains('auto-lock-status-warning')).toBe(value === 10 || value === 1);
      expect(timer.getAttribute('aria-live')).toBe('off');
    }
  }
});
it('explains both work policies and applies a choice without an immediate stop command', () => {
  const preferences = vi.fn(), hard = vi.fn();
  render(<App controller={controller({ screenAccess: 'open', screen: 'settings', settingsTab: 'security', busy: true, onPreferences: preferences, onHardLock: hard })} />);
  const standard = screen.getByRole('button', { name: '표준 · 작업 이어가기' });
  const strict = screen.getByRole('button', { name: '엄격 · 잠글 때 작업 중지' });
  expect(standard.getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(strict);
  expect(preferences).toHaveBeenCalledWith(expect.objectContaining({ lockWorkPolicy: 'strict' }));
  expect(hard).not.toHaveBeenCalled();
  expect(screen.getByText(/다음 잠금/)).toBeTruthy();
});
it('keeps settings and an explicit work return accessible while another operation runs', () => {
  const navigate = vi.fn();
  render(<App controller={controller({ screenAccess: 'open', screen: 'settings', busy: true, workReturnScreen: 'stt', onNavigate: navigate })} />);
  const settings = screen.getAllByRole('button', { name: '설정' }).find(button => button.classList.contains('side-nav'))!;
  expect((settings as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '진행 중 작업으로 돌아가기' }));
  expect(navigate).toHaveBeenCalledWith('stt', undefined);
});
it('confirms a conflicting recording navigation once and leaves settings visits uninterrupted', () => {
  const navigate = vi.fn(), afterStop = vi.fn();
  render(<App controller={controller({ screenAccess: 'open', screen: 'import', recordingActive: true, busy: true, onNavigate: navigate, onNavigateAfterStop: afterStop })} />);
  fireEvent.click(screen.getByRole('button', { name: 'Minutes of Meeting' }));
  const dialog = screen.getByRole('dialog', { name: '녹음을 중단하고 이동할까요?' });
  expect(navigate).not.toHaveBeenCalled();
  const stop = dialog.querySelector('button:last-child')!;
  fireEvent.click(stop); fireEvent.click(stop);
  expect(afterStop).toHaveBeenCalledOnce();
  fireEvent.click(screen.getAllByRole('button', { name: '설정' }).find(button => button.classList.contains('side-nav'))!);
  expect(navigate).toHaveBeenCalledWith('settings');
});
