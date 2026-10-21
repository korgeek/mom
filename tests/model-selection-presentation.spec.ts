import { expect, it } from 'vitest';
import * as presentation from '../src/react-app/providers/model-presentation';
import { observeSTTRoute, observeUnsupportedRoute } from '../src/react-app/providers/model-registry';
import { getSTTModel } from '../src/react-app/providers/catalog';
const route = { provider: 'openai', connectionId: 'openai', stage: 'stt', modelId: 'gpt-4o-mini-transcribe', endpointTag: null } as const;
it('shows exact currency and audio/token/request billing units without converting to invented minutes', () => {
 expect(presentation.compactModelPresentation).toBeTypeOf('function');
 const metadata = observeSTTRoute(route, getSTTModel(route.modelId)).metadata;
 const value = presentation.compactModelPresentation({ route, metadata }, 'en'); expect(value.prices.join(' ')).toContain('USD'); expect(value.prices.join(' ')).toMatch(/audio.*tokens/); expect(value.prices.join(' ')).not.toMatch(/minute/); expect(value.feature).toMatch(/audio/i);
});
it('keeps unknown/partial prices distinct from a complete advertised zero', () => {
 expect(presentation.compactModelPresentation).toBeTypeOf('function'); const metadata = observeSTTRoute(route, getSTTModel(route.modelId)).metadata;
 const unknown = presentation.compactModelPresentation({ route, metadata: { ...metadata, pricing: { kind: 'unknown', snapshot: null, missingDimensions: ['rates'], unsupportedDimensions: [], conditionalDimensions: [] } } }, 'en'); expect(unknown.prices).toEqual(['Price unavailable']);
 const partial = presentation.compactModelPresentation({ route, metadata: { ...metadata, pricing: { ...metadata.pricing, kind: 'unknown' } } }, 'en'); expect(partial.priceNote).toMatch(/total.*unknown/i);
 const zero = presentation.compactModelPresentation({ route, metadata: { ...metadata, pricing: { ...metadata.pricing, kind: 'zero', snapshot: { ...metadata.pricing.snapshot!, rates: [{ unit: 'request', units: 1, price: 0 }] } } } }, 'en'); expect(zero.prices).toEqual(['USD 0 / 1 request']);
});
it('never infers a release from aliases, date-looking IDs, catalog registration or fetch time', () => {
 expect(presentation.compactModelPresentation).toBeTypeOf('function'); const r = { ...route, modelId: 'fixture-2026-10-04' }, metadata = observeUnsupportedRoute(r, { name: 'New alias', source: 'TEST_ONLY', checkedAt: '2026-10-04T00:00:00Z' }).metadata;
 expect(presentation.compactModelPresentation({ route: r, metadata }, 'en').date).toEqual({ kind: 'unknown' });
 expect(presentation.compactModelPresentation({ route: r, metadata, catalogListedAt: '2026-10-01T00:00:00Z' }, 'en').date).toEqual({ kind: 'listed', value: '2026-10-01T00:00:00Z' });
});

it('labels the verified exact direct snapshot release with source, checked date and day precision only', () => {
 const exact = { ...route, modelId: 'gpt-4o-mini-transcribe-2025-12-15' }, metadata = observeSTTRoute(exact, getSTTModel(exact.modelId)).metadata;
 const evidence = presentation.compactModelPresentation({ route: exact, metadata }, 'en'); expect(evidence.dateLabel).toBe('Version released'); expect(evidence.date).toEqual({ kind: 'released', value: '2025-12-15', precision: 'day', source: 'https://developers.openai.com/api/docs/changelog', checkedAt: '2026-10-04T04:12:38.870600+00:00' });
 expect(presentation.compactModelPresentation({ route, metadata }, 'en').date.kind).toBe('unknown');
 expect(presentation.compactModelPresentation({ route: { ...exact, provider: 'openrouter' }, metadata }, 'en').date.kind).toBe('unknown');
});
it('describes a text catalog candidate awaiting an explicit endpoint without calling it an unsupported adapter', () => {
 const r = { ...route, provider: 'openrouter' as const, stage: 'minutes' as const, modelId: 'fixture/text' }, metadata = observeUnsupportedRoute(r, { name: 'Text candidate', source: 'TEST_ONLY', checkedAt: '2026-10-04T00:00:00Z' }).metadata;
 expect(presentation.compactModelPresentation({ route: r, metadata: { ...metadata, blockers: ['exact-endpoint-required', 'missing-limits'], inputModalities: ['text'], outputModalities: ['text'] } }, 'en').feature).toBe('Text → text · select endpoint');
});
it('scales tiny advertised token rates to a faithful per-million token amount', () => {
 const metadata = observeSTTRoute(route, getSTTModel(route.modelId)).metadata;
 const view = presentation.compactModelPresentation({ route, metadata: { ...metadata, pricing: { ...metadata.pricing, snapshot: { ...metadata.pricing.snapshot!, rates: [{ unit: 'text-input-token', units: 1, price: 0.000001 }, { unit: 'request', units: 1, price: 0.25 }, { unit: 'audio-second', units: 60, price: 0.003 }] } } } }, 'en');
 expect(view.prices).toEqual(['USD 1 / 1,000,000 text input tokens', 'USD 0.25 / 1 request', 'USD 0.003 / 60 audio seconds']);
});
