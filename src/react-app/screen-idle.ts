import type { ScreenState } from './vault/screen-state';

// Timeouts wake the check; elapsed wall time includes background/sleep delays.
export function createScreenIdle(options: { onExpire(): void; now?: () => number; monotonic?: () => number }) {
  const now = options.now ?? Date.now, monotonic = options.monotonic ?? (() => performance.now());
  let duration: ScreenState['autoLockSeconds'] = 60, active = false;
  let wall = 0, mono = 0, elapsed = 0, timer: ReturnType<typeof setTimeout> | null = null;
  const stopTimer = () => { if (timer !== null) clearTimeout(timer); timer = null; };
  const passed = () => elapsed = Math.max(elapsed, now() - wall, monotonic() - mono, 0);
  const remaining = () => duration === null ? null : active ? Math.max(0, Math.ceil((duration * 1000 - passed()) / 1000)) : 0;
  const check = () => {
    if (!active) return false;
    if (duration !== null && passed() >= duration * 1000) {
      active = false; stopTimer(); options.onExpire(); return false;
    }
    return true;
  };
  const arm = () => { stopTimer(); if (active && duration !== null) timer = setTimeout(() => { if (check()) arm(); }, Math.max(1, duration * 1000 - passed())); };
  const reset = () => { wall = now(); mono = monotonic(); elapsed = 0; arm(); };
  return {
    start(seconds: ScreenState['autoLockSeconds']) { duration = seconds; active = true; reset(); },
    activity() { if (!check()) return false; reset(); return true; },
    check, remaining,
    stop() { active = false; stopTimer(); },
  };
}
