import { expect, it } from 'vitest';
import { withoutDeletedProjectDrafts, withoutDeletedProjectScreenState } from '../src/react-app/vault/screen-state';

it('removes every memo draft identity while preserving another memo and unrelated settings', () => {
  const id = 'SYNTHETIC_MEMO', other = `${id}_OTHER`, deleted = new Set([id]);
  const keys = (owner: string) => [
    ...['recording-metadata-open:', 'minutes-setup-open:', 'minutes-setup-editing:'].map(prefix => `${prefix}${owner}`),
    `preparation-source-open:${owner}:source`,
    ...['stt-input:', 'minutes-language:', 'minutes-budget:'].map(prefix => `${prefix}${JSON.stringify([owner, 'settings'])}`),
    ...['review-segment', 'review-text', 'minutes-view', 'minutes-text'].map(kind => JSON.stringify([kind, owner, 'version'])),
    JSON.stringify(['preparation-options', null, JSON.stringify([owner, {}])]),
  ];
  const drafts = Object.fromEntries([...keys(id), ...keys(other), 'settings', `unknown:${id}`].map(key => [key, key]));
  const remaining = withoutDeletedProjectDrafts(drafts, deleted);
  expect(Object.keys(remaining)).toEqual([...keys(other), 'settings', `unknown:${id}`]);
  const state = {version: 1 as const, autoLockSeconds: 60 as const, restore: { screen: 'minutes', selectedProjectId: id, settingsTab: 'security', drafts }};
  expect(withoutDeletedProjectScreenState(state, deleted)).toEqual({...state, restore: {...state.restore, screen: 'home', selectedProjectId: null, drafts: remaining}});
  const otherState = {...state, restore: {...state.restore, selectedProjectId: other}};
  expect(withoutDeletedProjectScreenState(otherState, deleted).restore).toMatchObject({screen: 'minutes', selectedProjectId: other});
});
