import type { MinutesSettings } from '../domain/types';

export function validateMinutesBudget(settings: MinutesSettings): void {
  if (settings.outputTokens !== undefined && (!Number.isSafeInteger(settings.outputTokens) || settings.outputTokens < 1 || settings.outputTokens > 1000000)) throw new Error('Invalid output budget');
}

/** Resolve only a new run; frozen comparison retries keep their original snapshot. */
export function resolveMinutesSettings(settings: MinutesSettings, appLanguage: 'ko' | 'en'): MinutesSettings {
  validateMinutesBudget(settings);
  // Legacy absence is explicit: app language must never rewrite an old saved choice.
  return Object.freeze({
    ...settings,
    outputLanguage: settings.outputLanguageMode === 'app' ? appLanguage : settings.outputLanguage,
    sections: Object.freeze([...settings.sections]),
  });
}
