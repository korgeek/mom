import { afterEach, expect, it, vi } from 'vitest';
import { createScreenIdle } from '../src/react-app/screen-idle';

afterEach(() => vi.useRealTimers());
it('expires after 60 seconds, checks expiry before accepting returning activity and never refreshes from progress', () => {
  vi.useFakeTimers(); let now = 0; const lock = vi.fn();
  const idle = createScreenIdle({ now: () => now, monotonic: () => now, onExpire: lock });
  idle.start(60); now = 59_001; expect(idle.remaining()).toBe(1);
  now = 60_001; expect(idle.activity()).toBe(false); expect(lock).toHaveBeenCalledTimes(1);
  expect(idle.remaining()).toBe(0); idle.check(); expect(lock).toHaveBeenCalledTimes(1);
  idle.stop();
});
it('refreshes actual activity and supports the exact options including never', () => {
  vi.useFakeTimers(); let now = 0; const lock = vi.fn();
  const idle = createScreenIdle({ now: () => now, monotonic: () => now, onExpire: lock });
  for (const seconds of [60, 180, 300, 600, 1800, 3600, null] as const) {
    idle.start(seconds); now += 10_000; expect(idle.activity()).toBe(true);
    expect(idle.remaining()).toBe(seconds);
  }
  now += 7_200_000; vi.runOnlyPendingTimers(); expect(lock).not.toHaveBeenCalled();
  idle.stop();
});
it('uses elapsed clocks instead of callback counts and does not gain time after clock reversal', () => {
  vi.useFakeTimers(); let wall = 0, mono = 0; const lock = vi.fn();
  const idle = createScreenIdle({ now: () => wall, monotonic: () => mono, onExpire: lock });
  idle.start(60); wall = 40_000; mono = 40_000; expect(idle.remaining()).toBe(20);
  wall = -1000; mono = 41_000; expect(idle.remaining()).toBe(19);
  wall = 120_000; idle.check(); expect(lock).toHaveBeenCalledTimes(1);
  idle.stop();
});
