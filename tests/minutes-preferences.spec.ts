import { expect, it } from 'vitest';
import type { MinutesSettings } from '../src/react-app/domain/types';

const modulePath = '../src/react-app/minutes/preferences';
async function preferences() {
  const imported = await import(/* @vite-ignore */ modulePath).catch(() => null);
  expect(imported, 'pure minutes preference resolver is implemented').not.toBeNull();
  return imported as typeof import('../src/react-app/minutes/preferences');
}
const settings: MinutesSettings = { outputLanguage: 'fr-CA', sections: ['summary', 'actions'], instructions: 'Keep the saved instructions', modelId: 'fixture/saved-model' };

it.each(['ko', 'en'] as const)('resolves app mode to %s without changing saved settings', async language => {
  const { resolveMinutesSettings } = await preferences();
  const saved = { ...settings, outputLanguageMode: 'app' as const }, before = structuredClone(saved);
  const effective = resolveMinutesSettings(saved, language);
  expect(effective).toEqual({ ...saved, outputLanguage: language });
  expect(saved).toEqual(before); expect(Object.isFrozen(saved)).toBe(false);
  expect(effective).not.toBe(saved); expect(effective.sections).not.toBe(saved.sections);
  expect(Object.isFrozen(effective)).toBe(true); expect(Object.isFrozen(effective.sections)).toBe(true);
});
it.each([undefined, 'explicit'] as const)('preserves legacy/custom explicit language with mode %s across app changes', async mode => {
  const { resolveMinutesSettings } = await preferences();
  const saved = { ...settings, ...(mode ? { outputLanguageMode: mode } : {}) };
  expect(resolveMinutesSettings(saved, 'ko')).toEqual(saved); expect(resolveMinutesSettings(saved, 'en')).toEqual(saved);
  expect(resolveMinutesSettings(saved, 'en').outputLanguage).toBe('fr-CA');
});
it('keeps a resolved run snapshot immutable while each new app-mode resolution uses the current app language', async () => {
  const { resolveMinutesSettings } = await preferences(); const saved = { ...settings, outputLanguageMode: 'app' as const };
  const priorRun = resolveMinutesSettings(saved, 'ko'), nextRun = resolveMinutesSettings(saved, 'en');
  expect(priorRun.outputLanguage).toBe('ko'); expect(nextRun.outputLanguage).toBe('en'); expect(saved.outputLanguage).toBe('fr-CA');
  expect(() => { (priorRun.sections as string[]).push('refs'); }).toThrow();
});
