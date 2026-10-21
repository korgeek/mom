export type ScreenState = Readonly<{
  version: 1;
  autoLockSeconds: 60 | 180 | 300 | 600 | 1800 | 3600 | null;
  lockWorkPolicy?: 'standard' | 'strict';
  restore?: Readonly<{
    screen: string;
    selectedProjectId: string | null;
    settingsTab: string;
    drafts: Readonly<Record<string, unknown>>;
  }>;
}>;

export function withoutDeletedProjectDrafts(drafts: Readonly<Record<string, unknown>>, deleted: ReadonlySet<string>): Record<string, unknown> {
  const identityBelongs = (identity: string) => {
    try { const value: unknown = JSON.parse(identity); return Array.isArray(value) && deleted.has(value[0]); }
    catch { return false; }
  };
  return Object.fromEntries(Object.entries(drafts).filter(([key]) => {
    for (const prefix of ['recording-metadata-open:', 'minutes-setup-open:', 'minutes-setup-editing:']) {
      if (key.startsWith(prefix)) return !deleted.has(key.slice(prefix.length));
    }
    if (key.startsWith('preparation-source-open:')) return !deleted.has(key.slice('preparation-source-open:'.length).split(':')[0]);
    for (const prefix of ['stt-input:', 'minutes-language:', 'minutes-budget:']) {
      if (key.startsWith(prefix)) return !identityBelongs(key.slice(prefix.length));
    }
    try {
      const value: unknown = JSON.parse(key);
      if (!Array.isArray(value)) return true;
      if (['review-segment', 'review-text', 'minutes-view', 'minutes-text'].includes(value[0])) return !deleted.has(value[1]);
      if (value[0] === 'preparation-options' && typeof value[2] === 'string') return !identityBelongs(value[2]);
    } catch { /* Other settings drafts have independent keys. */ }
    return true;
  }));
}

export function withoutDeletedProjectScreenState(state: ScreenState, deleted: ReadonlySet<string>): ScreenState {
  if (!state.restore) return state;
  const selectedDeleted = state.restore.selectedProjectId !== null && deleted.has(state.restore.selectedProjectId);
  return { ...state, restore: { ...state.restore, ...(selectedDeleted ? { screen: 'home', selectedProjectId: null } : {}), drafts: withoutDeletedProjectDrafts(state.restore.drafts, deleted) } };
}

function invalid(): never { throw new Error('Invalid screen state'); }
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function json(value: unknown, ancestors = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') { if (!Number.isFinite(value)) invalid(); return; }
  if (typeof value !== 'object' || (!Array.isArray(value) && !object(value)) || ancestors.has(value)) invalid();
  ancestors.add(value);
  const keys = Reflect.ownKeys(value);
  if (Array.isArray(value)) {
    if (keys.length !== value.length + 1) invalid();
    for (let index = 0; index < value.length; index++) if (!Object.prototype.hasOwnProperty.call(value, index)) invalid();
  }
  for (const key of keys) {
    if (Array.isArray(value) && key === 'length') continue;
    if (typeof key !== 'string') invalid();
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!descriptor.enumerable || !('value' in descriptor)) invalid();
    json(descriptor.value, ancestors);
  }
  ancestors.delete(value);
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Detach only JSON data; UI callers decide which non-secret drafts to retain. */
export function validateScreenState(value: unknown): ScreenState {
  json(value);
  if (!object(value) || value.version !== 1 || ![60, 180, 300, 600, 1800, 3600, null].includes(value.autoLockSeconds as number | null) ||
    Object.keys(value).some(key => !['version', 'autoLockSeconds', 'lockWorkPolicy', 'restore'].includes(key))) invalid();
  if (Object.prototype.hasOwnProperty.call(value, 'lockWorkPolicy') && !['standard', 'strict'].includes(value.lockWorkPolicy as string)) invalid();
  if (Object.prototype.hasOwnProperty.call(value, 'restore')) {
    const restore = value.restore;
    if (!object(restore) || typeof restore.screen !== 'string' || typeof restore.settingsTab !== 'string' ||
      !(restore.selectedProjectId === null || typeof restore.selectedProjectId === 'string') || !object(restore.drafts) ||
      Object.keys(restore).some(key => !['screen', 'selectedProjectId', 'settingsTab', 'drafts'].includes(key))) invalid();
  }
  return freeze(structuredClone(value)) as ScreenState;
}
