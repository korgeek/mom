import { expect, it } from 'vitest';
import { parseRouterModels, parseRouterEndpoints } from '../src/react-app/providers/catalog';
import { previewMinutesFit, createOpenRouterProvider } from '../src/react-app/providers/openrouter';
import { emptyModelRegistry, observeMinutesRoute, normalizeModelRegistry, setRegistryEnabled, projectModelRegistry, registryRouteKey } from '../src/react-app/providers/model-registry';
import { addRegistryObservation } from '../src/react-app/providers/registry-consumer';
import { previewMinutesSelection } from '../src/react-app/minutes/selection';
import { createJobContext } from '../src/react-app/domain/jobs';
const at = '2026-10-04T00:00:00Z';
const model = parseRouterModels({ data: [{ id: 'google/gemini-3.8-flash', context_length: 16000, top_provider: { max_completion_tokens: 4096 }, architecture: { input_modalities: ['text'], output_modalities: ['text'] }, supported_parameters: ['max_tokens'] }] }, at)[0];
const endpoint = parseRouterEndpoints({ data: { endpoints: [{ tag: 'google-ai-studio', context_length: 8000, max_prompt_tokens: null, max_completion_tokens: 2048, supported_parameters: ['max_tokens'] }] } }, model.id, at)[0];
const messages = [{ role: 'user' as const, content: 'TEST_ONLY multilingual 한글 日本語' }];
const request = { runId: 'TEST_ONLY_run', settings: { modelId: model.id, outputLanguage: 'en', sections: ['summary' as const], instructions: '' }, transcript: { id: 'TEST_ONLY_transcript', parentId: null, rawIds: [], segments: [], issues: [], missingRanges: [] } };
it('uses published context minus reserved output when the endpoint prompt cap is unknown across registry and preflight', () => {
 const selected = { model, endpoint }, fit = previewMinutesFit(selected, messages, 1000);
 expect(fit.status).toBe('fits'); expect(fit.maxPromptTokens).toBeNull();
 expect(fit).toMatchObject({ contextTokens: 8000, derivedInputBudgetTokens: 7000, effectiveInputBudgetTokens: 7000 });
 expect(previewMinutesSelection({ ...selected, messages, outputTokens: 1000, reasoningReserveTokens: 0 }).status).toBe('fits');
 const observation = observeMinutesRoute({ provider: 'openrouter', connectionId: 'openrouter', stage: 'minutes', modelId: model.id, endpointTag: endpoint.tag }, model, endpoint);
 expect(observation.metadata.compatible).toBe(true); expect(observation.metadata.limits.maxPromptTokens).toBeNull();
 const registry = normalizeModelRegistry(setRegistryEnabled(addRegistryObservation(emptyModelRegistry(), observation), registryRouteKey(observation.route), true));
 expect(projectModelRegistry(registry, 'minutes').choices).toHaveLength(1);
 const provider = createOpenRouterProvider({ selection: selected, getKey: () => { throw new Error('must not read key'); }, buildMessages: () => messages, maxOutputTokens: 1000 });
 expect(provider.preflightMinutes(request).contextTokens).toBe(8000);
});
it('continues to enforce explicit smaller prompt caps and the reserved context ceiling', () => {
 expect(previewMinutesFit({ model, endpoint: { ...endpoint, maxPromptTokens: 400 } }, [{ role: 'user', content: 'x'.repeat(17) }], 1000).status).toBe('overflow');
 expect(previewMinutesFit({ model, endpoint }, [{ role: 'user', content: 'x'.repeat(6617) }], 1000).status).toBe('overflow');
});
it.each([400, 413])('translates provider context/limit rejection %s without retry, route switching or response text exposure', async status => {
 const requests: Record<string, unknown>[] = [];
 const provider = createOpenRouterProvider({ selection: { model, endpoint }, getKey: () => 'TEST_ONLY_KEY', buildMessages: () => messages, maxOutputTokens: 1000, fetch: async (_url, init) => {
  requests.push(JSON.parse(String(init?.body)));
  return new Response(JSON.stringify({ error: { code: status, message: 'TEST_ONLY_PRIVATE maximum context length exceeded' } }), { status });
 } });
 await expect(provider.generate(request, createJobContext())).rejects.toMatchObject({ code: 'context' });
 expect(requests).toHaveLength(1); expect(requests[0].provider).toEqual({ only: [endpoint.tag], order: [endpoint.tag], allow_fallbacks: false, require_parameters: true });
});
it.each([-1, 0, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid published limits %s before key access', value => {
 expect(previewMinutesFit({ model, endpoint: { ...endpoint, contextTokens: value } }, messages, 1000).status).toBe('invalid-input');
 expect(previewMinutesFit({ model, endpoint: { ...endpoint, maxPromptTokens: value } }, messages, 1000).status).toBe('invalid-input');
});
it.each([-1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1])('does not turn malformed published prompt cap %s into an eligible unknown cap', value => {
 const parsed = parseRouterEndpoints({ data: { endpoints: [{ tag: endpoint.tag, context_length: 8000, max_prompt_tokens: value, max_completion_tokens: 2048, supported_parameters: ['max_tokens'] }] } }, model.id, at);
 expect(parsed).toHaveLength(0);
});
it.each([{ cap: 6000, reverse: false }, { cap: 6000, reverse: true }, { cap: null, reverse: false }, { cap: null, reverse: true }])('quarantines a duplicate exact tag with a malformed prompt cap regardless of record order ($cap, $reverse)', ({ cap, reverse }) => {
 const base = { tag: endpoint.tag, context_length: 8000, max_completion_tokens: 2048, supported_parameters: ['max_tokens'] };
 const duplicates = [{ ...base, max_prompt_tokens: cap }, { ...base, max_prompt_tokens: 0 }];
 const parsed = parseRouterEndpoints({ data: { endpoints: [...(reverse ? duplicates.reverse() : duplicates), { ...base, tag: 'TEST_ONLY/unrelated', max_prompt_tokens: null }] } }, model.id, at);
 expect(parsed.map(item => item.tag)).toEqual(['TEST_ONLY/unrelated']); expect(parsed[0].maxPromptTokens).toBeNull();
});
