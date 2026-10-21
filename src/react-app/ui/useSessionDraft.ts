import { useCallback, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { AppController } from '../App';

export function useSessionDraft<T>(controller: Pick<AppController, 'uiDrafts' | 'onUIDraft'>, key: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const read = () => controller.uiDrafts && Object.prototype.hasOwnProperty.call(controller.uiDrafts, key)
    ? controller.uiDrafts[key] as T
    : typeof initial === 'function' ? (initial as () => T)() : initial;
  const [state, setState] = useState(() => ({ key, value: read() }));
  const current = state.key === key ? state : { key, value: read() };
  if (state.key !== key) setState(current);
  const latest = useRef(current);
  useLayoutEffect(() => { latest.current = current; });
  const onDraft = controller.onUIDraft;
  const setDraft = useCallback<Dispatch<SetStateAction<T>>>(update => {
    const value = typeof update === 'function' ? (update as (previous: T) => T)(latest.current.value) : update;
    const next = { key, value };
    // Record within the input event: a lock may unmount this editor before an effect runs.
    onDraft?.(key, value);
    latest.current = next;
    setState(next);
  }, [key, onDraft]);
  return [current.value, setDraft];
}
