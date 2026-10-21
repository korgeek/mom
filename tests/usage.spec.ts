import { describe, expect, it } from 'vitest';
import { aggregateProjectUsage } from '../src/react-app/usage/statement';
import type { MeetingProject, MinutesRun, RawTranscript, RunRecord, Usage } from '../src/react-app/domain/types';

const usage = (patch: Partial<Usage> = {}): Usage => ({ inputTokens: null, outputTokens: null, durationSeconds: null, audioInputTokens: null, textInputTokens: null, audioOutputTokens: null, textOutputTokens: null, elapsedMs: 100, cost: null, costKind: 'unavailable', currency: null, rateSource: null, rateCheckedAt: null, rateSnapshot: null, ...patch });
const record = (id: string, kind: 'stt' | 'minutes', state: RunRecord['state'] = 'saved', chunkId: string | null = kind === 'stt' ? 'c1' : null): RunRecord => ({ id, projectId: 'p', state, checkpoint: null, intent: { kind, chunkId, requestedModel: kind === 'stt' ? 'whisper-1' : 'openai/historical', expectedLanguages: [], rateSnapshot: null, requestedEndpoint: kind === 'stt' ? null : 'Requested/region' } });
const raw = (runId: string, reported = usage(), chunkId = 'c1'): RawTranscript => ({ id: `raw-${runId}`, runId, chunkId, text: 'fixture', response: {}, segments: [], timing: 'chunk', speakerScope: 'none', execution: { requestedModel: 'whisper-1', returnedModel: null, actualProvider: null, expectedLanguages: [], usage: reported } });
const minutes = (id: string, reported = usage()): MinutesRun => ({ id, transcriptVersionId: 'v', settings: { outputLanguage: 'en', sections: ['summary'], instructions: '', modelId: 'openai/historical' }, generatedMarkdown: '# Fixture', usage: reported, requestedModel: 'openai/historical', returnedModel: 'returned/model', actualProvider: 'Response Provider' });
function project(patch: Partial<MeetingProject> = {}): MeetingProject {
  return { id: 'p', title: 'Usage fixture', icon: 'mic', color: '#123456', pinned: false, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T01:00:00Z', sourceAssets: [{ id: 'source', fileName: 'fixture.wav', bytes: 100, container: 'wav', codec: 'pcm', durationMs: 1000000, channels: 1, sampleRateHz: 16000 }], audioOptions: { chunkMinutes: 10, overlapSeconds: 10, expectedLanguages: ['en'], bitrateKbps: 32, sampleRateHz: 16000 }, preparedChunks: [{ id: 'c1', sourceId: 'source', index: 0, sourceStartMs: 0, sourceEndMs: 600000, encodingOffsetMs: 0, encodedBytes: 100, mimeType: 'audio/mpeg', codec: 'mp3', audioRecordId: 'audio-1' }, { id: 'c2', sourceId: 'source', index: 1, sourceStartMs: 590000, sourceEndMs: 1000000, encodingOffsetMs: 0, encodedBytes: 100, mimeType: 'audio/mpeg', codec: 'mp3', audioRecordId: 'audio-2' }], rawTranscripts: [], transcriptVersions: [], selectedTranscriptVersionId: null, minutesSettings: { outputLanguage: 'en', sections: ['summary'], instructions: '', modelId: 'CURRENT/selector' }, minutesRuns: [], minutesRevisions: [], selectedMinutesRevisionId: null, runs: [], ...patch };
}

describe('stage usage statements from saved run evidence', () => {
  it('keeps source, overlapped prepared duration, returned duration and audio/text tokens distinct', () => {
    const p = project({ runs: [record('a', 'stt'), record('b', 'stt', 'saved', 'c2')], rawTranscripts: [raw('a', usage({ inputTokens: 105, audioInputTokens: 100, textInputTokens: 5, audioOutputTokens: 0, textOutputTokens: 10, outputTokens: 10, durationSeconds: 601, cost: 0.01, costKind: 'estimated', currency: 'USD' })), raw('b', usage({ durationSeconds: 411 }), 'c2')] });
    const result = aggregateProjectUsage(p);
    expect(result.stt).toMatchObject({ preparedChunks: 2, transcribedChunks: 2, sourceDurationSeconds: 1000, preparedDurationSeconds: 1010, responseCount: 2, attemptCount: 2 });
    expect(result.stt.dimensions.durationSeconds).toEqual({ subtotal: 1012, reportedResults: 2, resultCount: 2 });
    expect(result.stt.dimensions.inputTokens).toEqual({ subtotal: 105, reportedResults: 1, resultCount: 2 });
    expect(result.stt.dimensions.audioInputTokens.subtotal).toBe(100);
    expect(result.stt.dimensions.textInputTokens.subtotal).toBe(5);
  });
  it('keeps absent source and preparation timing unavailable in legacy projects', () => {
    const result = aggregateProjectUsage(project({ sourceAssets: [], preparedChunks: [], rawTranscripts: [{ ...raw('legacy'), execution: null }] }));
    expect(result.stt.sourceDurationSeconds).toBeNull();
    expect(result.stt.preparedDurationSeconds).toBeNull();
    expect(result.stt.dimensions.durationSeconds.subtotal).toBeNull();
  });
  it('retains reported zero while missing token and cost dimensions stay unknown', () => {
    const result = aggregateProjectUsage(project({ runs: [record('a', 'minutes'), record('b', 'minutes')], minutesRuns: [minutes('a', usage({ inputTokens: 0, cost: 0, costKind: 'reported', currency: 'credits' })), minutes('b')] }));
    expect(result.minutes.dimensions.inputTokens).toEqual({ subtotal: 0, reportedResults: 1, resultCount: 2 });
    expect(result.minutes.dimensions.outputTokens.subtotal).toBeNull();
    expect(result.minutes.costs).toMatchObject({ components: [{ currency: 'credits', kind: 'reported', amount: 0, resultCount: 1 }], missingResults: 1, completeTotal: null });
  });
  it('groups credits and USD without conversion or a combined total', () => {
    const result = aggregateProjectUsage(project({ runs: [record('a', 'stt'), record('b', 'minutes')], rawTranscripts: [raw('a', usage({ cost: 0.02, costKind: 'estimated', currency: 'USD' }))], minutesRuns: [minutes('b', usage({ cost: 0.03, costKind: 'reported', currency: 'credits' }))] }));
    expect(result.combined.components).toEqual([{ currency: 'USD', kind: 'estimated', amount: 0.02, resultCount: 1 }, { currency: 'credits', kind: 'reported', amount: 0.03, resultCount: 1 }]);
    expect(result.combined.completeTotal).toBeNull();
  });
  it('labels a fully known same-unit mixture provisional rather than provider-reported', () => {
    const result = aggregateProjectUsage(project({ runs: [record('a', 'stt'), record('b', 'minutes')], rawTranscripts: [raw('a', usage({ cost: 0.02, costKind: 'estimated', currency: 'USD' }))], minutesRuns: [minutes('b', usage({ cost: 0.03, costKind: 'reported', currency: 'USD' }))] }));
    expect(result.combined.completeTotal).toEqual({ amount: 0.05, currency: 'USD', kind: 'mixed' });
  });
  it.each(['failed', 'outcome-unknown', 'requesting', 'queued', 'cancelled', 'saving', 'response-received'] as const)('keeps %s durable attempts and prevents claiming a complete bill', state => {
    const result = aggregateProjectUsage(project({ runs: [record('old', 'minutes', state), record('retry', 'minutes')], minutesRuns: [minutes('retry', usage({ cost: 0.1, costKind: 'estimated', currency: 'USD' }))] }));
    expect(result.minutes.attemptCount).toBe(2); expect(result.minutes.states[state]).toBe(1); expect(result.minutes.responseCount).toBe(1);
    expect(result.minutes.costs).toMatchObject({ uncertainAttempts: 1, completeTotal: null });
    expect(result.minutes.costs.components[0].amount).toBe(0.1);
  });
  it('deduplicates stable run IDs without counting edited revisions, transcript versions or comparison references', () => {
    const a = minutes('a', usage({ cost: 0.1, costKind: 'estimated', currency: 'USD' }));
    const p = project({ runs: [record('a', 'minutes'), record('a', 'minutes')], minutesRuns: [a, structuredClone(a)], minutesRevisions: [{ id: 'r1', runId: 'a', parentId: null, markdown: 'Original' }, { id: 'r2', runId: 'a', parentId: 'r1', markdown: 'Edited' }] });
    // Repeated comparison attempt references never create additional result records.
    const comparisons: MeetingProject['minutesComparisons'] = [{ id: 'comparison', projectId: 'p', createdAt: '', inputSignature: '', promptVersion: '', transcript: { id: 'v', parentId: null, rawIds: [], segments: [], issues: [], missingRanges: [] }, settings: p.minutesSettings, messages: [], outputTokens: 1, reasoningReserveTokens: 0, members: [0, 1].map(() => ({ modelId: a.requestedModel, endpointTag: 'Requested/region', providerName: null, selectionSnapshot: {}, attempts: [{ runId: 'a', revisionId: 'r1', consentToken: '', selectionSnapshot: {} }] })) as unknown as NonNullable<MeetingProject['minutesComparisons']>[number]['members'] }];
    const result = aggregateProjectUsage({ ...p, minutesComparisons: comparisons });
    expect(result.minutes).toMatchObject({ attemptCount: 1, responseCount: 1 });
    expect(result.combined.completeTotal).toEqual({ amount: 0.1, currency: 'USD', kind: 'estimated' });
    expect(result.items).toHaveLength(1);
  });
  it('marks conflicting duplicate results unknown instead of choosing first or double-counting', () => {
    const a = minutes('a', usage({ cost: 0.1, costKind: 'reported', currency: 'credits' })); const b = { ...a, usage: usage({ cost: 0.9, costKind: 'reported', currency: 'credits' }) };
    for (const results of [[a, b], [b, a]]) {
      const result = aggregateProjectUsage(project({ runs: [record('a', 'minutes')], minutesRuns: results }));
      expect(result.minutes.responseCount).toBe(1); expect(result.minutes.conflictingRunIds).toEqual(['a']);
      expect(result.minutes.costs.components).toEqual([]); expect(result.minutes.costs.missingResults).toBe(1); expect(result.combined.completeTotal).toBeNull();
    }
  });
  it('preserves old and new retry IDs for the same chunk while counting unique chunks once', () => {
    const result = aggregateProjectUsage(project({ runs: [record('old', 'stt', 'outcome-unknown'), record('retry', 'stt')], rawTranscripts: [raw('retry', usage({ durationSeconds: 600 }))] }));
    expect(result.stt).toMatchObject({ attemptCount: 2, responseCount: 1, transcribedChunks: 1 });
    expect(result.items.map(item => item.id)).toEqual(['old', 'retry']);
  });
  it('uses saved request/response provenance and rate snapshots despite current selector mismatch', () => {
    const rates: Usage['rateSnapshot'] = { source: 'https://rates.example.test', checkedAt: '2026-09-01', currency: 'USD', rates: [{ unit: 'text-input-token', units: 1000000, price: 1 }] };
    const result = aggregateProjectUsage(project({ runs: [record('a', 'minutes')], minutesRuns: [minutes('a', usage({ rateSnapshot: rates }))] }));
    expect(result.items[0]).toMatchObject({ model: 'openai/historical', route: 'openrouter', requestedEndpoint: 'Requested/region', returnedModel: 'returned/model', actualProvider: 'Response Provider', publisher: 'OpenAI', date: null, usage: { rateSnapshot: rates } });
    expect(result.items[0].model).not.toBe('CURRENT/selector');
  });
  it('keeps sparse legacy results visible and unclassified intents explicit', () => {
    const result = aggregateProjectUsage(project({ runs: [{ id: 'unknown', projectId: 'p', state: 'requesting', checkpoint: null }], rawTranscripts: [{ ...raw('legacy'), execution: null }], minutesRuns: [minutes('orphan')] }));
    expect(result.stt.responseCount).toBe(1); expect(result.minutes.responseCount).toBe(1);
    expect(result.items.find(item => item.id === 'legacy')).toMatchObject({ kind: 'stt', model: null, route: null, requestedEndpoint: null, usage: null });
    expect(result.items.find(item => item.id === 'orphan')).toMatchObject({ route: null, requestedEndpoint: null, state: null });
    expect(result.unclassifiedAttempts).toBe(1); expect(result.items.find(item => item.id === 'unknown')?.kind).toBeNull();
  });
  it('keeps contradictory STT intent/result chunks visible with unknown association and excludes their usage/cost', () => {
    const result = aggregateProjectUsage(project({ runs: [record('a', 'stt', 'saved', 'intent-chunk')], rawTranscripts: [raw('a', usage({ inputTokens: 12, audioInputTokens: 10, durationSeconds: 600, cost: 0.1, costKind: 'estimated', currency: 'USD' }), 'result-chunk')] }));
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ id: 'a', recordedAttempt: true, hasResult: true, state: 'saved', kind: 'stt', chunkId: null, conflict: true, usage: null });
    expect(result.stt).toMatchObject({ attemptCount: 1, responseCount: 1, transcribedChunks: 0, conflictingRunIds: ['a'] });
    expect(result.stt.dimensions.inputTokens.subtotal).toBeNull();
    expect(result.stt.dimensions.audioInputTokens.subtotal).toBeNull();
    expect(result.stt.dimensions.durationSeconds.subtotal).toBeNull();
    expect(result.stt.costs).toMatchObject({ components: [], missingResults: 1, uncertainAttempts: 1, completeTotal: null });
    expect(result.combined.completeTotal).toBeNull();
  });
  it('retains conflicting duplicate attempt states without selecting an arbitrary saved outcome', () => {
    const result = aggregateProjectUsage(project({ runs: [record('a', 'minutes'), record('a', 'minutes', 'outcome-unknown')], minutesRuns: [minutes('a', usage({ cost: 0.1, costKind: 'reported', currency: 'credits' }))] }));
    expect(result.minutes).toMatchObject({ attemptCount: 1, responseCount: 1, states: { unknown: 1 }, conflictingRunIds: ['a'] });
    expect(result.minutes.costs).toMatchObject({ components: [], missingResults: 1, uncertainAttempts: 1, completeTotal: null });
  });
  it('does not infer unavailable cost units from the saved rate snapshot', () => {
    const snapshot: Usage['rateSnapshot'] = { source: 'Fixture rates', checkedAt: '2026-09-01', currency: 'USD', rates: [] };
    const result = aggregateProjectUsage(project({ runs: [record('a', 'minutes')], minutesRuns: [minutes('a', usage({ cost: 0.1, costKind: 'reported', currency: null, rateSnapshot: snapshot }))] }));
    expect(result.combined).toMatchObject({ components: [], missingResults: 1, completeTotal: null });
  });
  it('does not hide a saved run whose result metadata is absent', () => {
    const result = aggregateProjectUsage(project({ runs: [record('missing', 'minutes')] }));
    expect(result.minutes).toMatchObject({ attemptCount: 1, responseCount: 0 });
    expect(result.minutes.costs.uncertainAttempts).toBe(1); expect(result.combined.completeTotal).toBeNull();
  });
});
