import { expect, it } from 'vitest';
import { previewRegisteredMinutesSelection } from '../src/react-app/minutes/selection';
import { validateRegistration } from '../src/react-app/providers/model-registrations';
const model = () => validateRegistration({ id: 'local-notes', name: 'Local notes', stage: 'llm', baseUrl: 'http://localhost:8000/v1', modelId: 'local-text', auth: 'none', credentialOrigin: null, credentialVersion: 0, enabled: true, llm: { contextTokens: 8000, maxTokens: 1024, tokenField: 'max_tokens' } });
const transcript = { id: 'transcript', parentId: null, rawIds: [], segments: [{ id: 's', text: 'SYNTHETIC_SELECTED_SPEECH', sourceStartMs: 0, sourceEndMs: 1000, rawIds: [] }], issues: [], missingRanges: [] };
const settings = { modelId: 'local-text', registrationId: 'local-notes', outputLanguage: 'en', sections: ['summary' as const], instructions: '' };
it('previews the registered server without inventing a price or a provider endpoint', () => {
  const preview = previewRegisteredMinutesSelection(model(), transcript, settings);
  expect(preview.status).toBe('fits');
  expect(preview.route).toMatchObject({ modelId: 'local-text', modelName: 'Local notes', endpointTag: 'http://localhost:8000/v1/chat/completions', providerName: 'localhost:8000' });
  expect(preview.projection.total).toBeNull(); expect(preview.pricing.complete).toBe(false);
  expect(JSON.stringify(preview)).not.toContain('SYNTHETIC_SELECTED_SPEECH');
});
it('uses rendered model instructions in the actual context fit', () => {
  const preview = previewRegisteredMinutesSelection({ ...model(), instructionTemplate: 'x'.repeat(7000) }, transcript, settings);
  expect(preview.status).toBe('overflow');
});
