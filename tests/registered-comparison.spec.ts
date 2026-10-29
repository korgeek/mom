import { expect, it } from 'vitest';
import { previewComparison, freezeMinutesComparison, comparisonConsentToken } from '../src/react-app/minutes/compare';
import { validateRegistration } from '../src/react-app/providers/model-registrations';
import { createModelPreset } from '../src/react-app/providers/model-profiles';
const registration = (id: string, origin: string) => validateRegistration({ id, name: id, stage: 'llm', baseUrl: origin + '/v1', modelId: id, auth: 'none', credentialOrigin: null, credentialVersion: 0, enabled: true, llm: { contextTokens: 32000, maxTokens: 1024, tokenField: 'max_tokens' } });
const transcript = { id: 'transcript', parentId: null, rawIds: [], segments: [{ id: 's', text: 'Synthetic selected content', sourceStartMs: 0, sourceEndMs: 1000, rawIds: [] }], issues: [], missingRanges: [] };
const settings = { modelId: 'A', registrationId: 'A', outputLanguage: 'en', sections: ['summary' as const], instructions: '' };
it('freezes two registered servers and binds later model parameter edits to fresh comparison consent', async () => {
  const a = registration('A', 'http://localhost:8000'), b = registration('B', 'http://127.0.0.1:9000');
  const choices = [{ registration: a }, { registration: b }] as const;
  const preview = previewComparison({ transcript, settings, choices });
  expect(preview.status).toBe('fits'); expect(preview.unknownTotal).toBe(true);
  const frozen = await freezeMinutesComparison('project', transcript, settings, choices, 1024);
  expect(frozen.members[0].modelSnapshot?.id).toBe('A');
  expect(frozen.members[1].endpointTag).toBe('http://127.0.0.1:9000/v1/chat/completions');
  const before = await comparisonConsentToken(frozen, choices, 1, null);
  const changed = [{ registration: { ...a, llm: { ...a.llm, temperature: 0.2 } } }, choices[1]] as const;
  expect(await comparisonConsentToken(frozen, changed, 1, null)).not.toBe(before);
  expect(frozen.members[0].modelSnapshot?.requestParameters).toEqual({});
});
it('blocks a comparison when either model cannot accept the memo effort', () => {
  const a = { ...createModelPreset('openai-text'), enabled: true };
  const b = { ...createModelPreset('router-glm-5.3-flash'), enabled: true };
  const choices = [{ registration: a }, { registration: b }] as const;
  expect(previewComparison({ transcript, settings: { ...settings, modelId: a.modelId, registrationId: a.id, reasoningEffort: 'none' }, choices }).status).toBe('invalid-input');
  expect(previewComparison({ transcript, settings: { ...settings, modelId: a.modelId, registrationId: a.id, reasoningEffort: 'low' }, choices }).status).toBe('fits');
});
