import type { MeetingProject, MinutesRun, RawTranscript, RunRecord, RunState, UsageHistoryItem } from '../domain/types';
import { modelIdentity } from '../providers/model-presentation';

export type UsageDimension = 'inputTokens' | 'outputTokens' | 'audioInputTokens' | 'textInputTokens' | 'audioOutputTokens' | 'textOutputTokens' | 'durationSeconds' | 'elapsedMs';
export type DimensionSubtotal = Readonly<{ subtotal: number | null; reportedResults: number; resultCount: number }>;
export type CostComponent = Readonly<{ currency: string; kind: 'reported' | 'estimated'; amount: number; resultCount: number }>;
export type CostStatement = Readonly<{
  components: readonly CostComponent[]; missingResults: number; uncertainAttempts: number;
  completeTotal: Readonly<{ amount: number; currency: string; kind: 'reported' | 'estimated' | 'mixed' }> | null;
}>;
export type { UsageHistoryItem } from '../domain/types';
export type StageUsageStatement = Readonly<{
  kind: 'stt' | 'minutes'; items: readonly UsageHistoryItem[]; attemptCount: number; responseCount: number;
  states: Readonly<Partial<Record<RunState | 'unknown', number>>>; conflictingRunIds: readonly string[];
  preparedChunks: number; transcribedChunks: number; sourceDurationSeconds: number | null; preparedDurationSeconds: number | null;
  dimensions: Readonly<Record<UsageDimension, DimensionSubtotal>>; costs: CostStatement;
}>;
export type ProjectUsageStatement = Readonly<{ stt: StageUsageStatement; minutes: StageUsageStatement; combined: CostStatement; items: readonly UsageHistoryItem[]; unclassifiedAttempts: number }>;
const dimensions: readonly UsageDimension[] = ['inputTokens', 'outputTokens', 'audioInputTokens', 'textInputTokens', 'audioOutputTokens', 'textOutputTokens', 'durationSeconds', 'elapsedMs'];
function signature(value: unknown): string {
  return JSON.stringify(value, (_key, entry) => entry && typeof entry === 'object' && !Array.isArray(entry)
    ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))) : entry);
}
function conflict(values: readonly unknown[]): boolean {
  return values.length > 1 && values.some(value => signature(value) !== signature(values[0]));
}
function nonnegative(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
function costStatement(items: readonly UsageHistoryItem[]): CostStatement {
  const components = new Map<string, CostComponent>(); let missingResults = 0;
  for (const item of items.filter(item => item.hasResult)) {
    const usage = item.usage;
    if (!usage || !nonnegative(usage.cost) || !usage.currency?.trim() || usage.costKind === 'unavailable') { missingResults++; continue; }
    const key = signature([usage.currency, usage.costKind]); const previous = components.get(key);
    components.set(key, { currency: usage.currency, kind: usage.costKind, amount: (previous?.amount ?? 0) + usage.cost, resultCount: (previous?.resultCount ?? 0) + 1 });
  }
  // A requesting intent predates transport. Neither it nor failure/cancellation
  // establishes provider receipt, zero charges, or a complete provider bill.
  const uncertainAttempts = items.filter(item => !item.recordedAttempt || item.state !== 'saved' || !item.hasResult || item.conflict).length;
  const known = [...components.values()]; const currencies = new Set(known.map(component => component.currency));
  const kinds = new Set(known.map(component => component.kind));
  const completeTotal = known.length && currencies.size === 1 && !missingResults && !uncertainAttempts
    ? { amount: known.reduce((sum, component) => sum + component.amount, 0), currency: known[0].currency, kind: kinds.size === 1 ? known[0].kind : 'mixed' as const } : null;
  return { components: known, missingResults, uncertainAttempts, completeTotal };
}
function stageStatement(kind: 'stt' | 'minutes', items: readonly UsageHistoryItem[], project: MeetingProject): StageUsageStatement {
  const stageItems = items.filter(item => item.kind === kind); const results = stageItems.filter(item => item.hasResult);
  const states: Partial<Record<RunState | 'unknown', number>> = {};
  for (const item of stageItems.filter(item => item.recordedAttempt)) { const state = item.state ?? 'unknown'; states[state] = (states[state] ?? 0) + 1; }
  const totals = Object.fromEntries(dimensions.map(key => {
    const values = results.map(item => item.usage?.[key]).filter(nonnegative);
    return [key, { subtotal: values.length ? values.reduce((sum, value) => sum + value, 0) : null, reportedResults: values.length, resultCount: results.length }];
  })) as StageUsageStatement['dimensions'];
  const chunks = [...new Map(project.preparedChunks.map(chunk => [chunk.id, chunk])).values()];
  const sources = [...new Map(project.sourceAssets.map(source => [source.id, source])).values()];
  return { kind, items: stageItems, attemptCount: stageItems.filter(item => item.recordedAttempt).length, responseCount: results.length, states,
    conflictingRunIds: stageItems.filter(item => item.conflict).map(item => item.id),
    preparedChunks: kind === 'stt' ? chunks.length : 0,
    transcribedChunks: kind === 'stt' ? new Set(results.filter(item => !item.conflict && item.chunkId !== null).map(item => item.chunkId)).size : 0,
    sourceDurationSeconds: kind === 'stt' && sources.length ? sources.reduce((sum, source) => sum + source.durationMs / 1000, 0) : null,
    preparedDurationSeconds: kind === 'stt' && chunks.length ? chunks.reduce((sum, chunk) => sum + (chunk.sourceEndMs - chunk.sourceStartMs) / 1000, 0) : null,
    dimensions: totals, costs: costStatement(stageItems) };
}
/** Pure evidence projection; never reads selectors, sends requests or mutates encrypted JSON. */
export function aggregateProjectUsage(project: MeetingProject): ProjectUsageStatement {
  const groups = new Map<string, { records: RunRecord[]; raw: RawTranscript[]; minutes: MinutesRun[] }>();
  const group = (id: string) => { let entries = groups.get(id); if (!entries) { entries = { records: [], raw: [], minutes: [] }; groups.set(id, entries); } return entries; };
  for (const record of project.runs) group(record.id).records.push(record);
  for (const raw of project.rawTranscripts) group(raw.runId).raw.push(raw);
  for (const minutes of project.minutesRuns) group(minutes.id).minutes.push(minutes);
  const items: UsageHistoryItem[] = [...groups].map(([id, entries]) => {
    const recordConflict = conflict(entries.records); const record = recordConflict ? null : entries.records[0] ?? null;
    const stages = new Set([...entries.records.flatMap(record => record.intent ? [record.intent.kind] : []), ...(entries.raw.length ? ['stt' as const] : []), ...(entries.minutes.length ? ['minutes' as const] : [])]);
    const kind = stages.size === 1 ? [...stages][0] : null;
    const resultConflict = conflict(entries.raw.map(raw => Object.fromEntries(Object.entries(raw).filter(([key]) => key !== 'id')))) || conflict(entries.minutes) || stages.size > 1;
    const raw = resultConflict ? null : entries.raw[0] ?? null; const minutes = resultConflict ? null : entries.minutes[0] ?? null;
    const execution = raw?.execution ?? minutes; const intent = record?.intent;
    // A request chunk is not proven transcribed when its saved result names a
    // different chunk. Keep the run visible, but do not resolve the association.
    const associationConflict = kind === 'stt' && intent?.chunkId != null && raw?.chunkId != null && intent.chunkId !== raw.chunkId;
    // Saved batch routes identify the requested STT adapter; they do not prove
    // the downstream execution provider. Pre-batch legacy STT used Direct OpenAI.
    const batch = intent?.kind === 'stt' && intent.sttBatchId ? project.sttBatches?.find(batch => batch.id === intent.sttBatchId && batch.attemptRunIds.includes(id) && batch.modelId === intent.requestedModel) : undefined;
    const route = intent?.modelSnapshot?.adapter ?? (intent?.kind === 'stt' ? intent.sttBatchId ? batch?.route?.provider ?? null : 'openai' as const : intent?.kind === 'minutes' ? 'openrouter' as const : null);
    const model = intent?.requestedModel || execution?.requestedModel || null;
    return { id, projectId: project.id, date: record?.checkpoint?.committedAt ?? null, kind, state: record?.state ?? null,
      recordedAttempt: entries.records.length > 0, hasResult: entries.raw.length + entries.minutes.length > 0, conflict: recordConflict || resultConflict || associationConflict,
      ...(intent?.modelSnapshot?.name || minutes?.modelSnapshot?.name || batch?.modelSnapshot?.name ? {modelName:intent?.modelSnapshot?.name ?? minutes?.modelSnapshot?.name ?? batch?.modelSnapshot?.name} : {}),
      model, executionRequestedModel: execution?.requestedModel ?? null, route,
      publisher: model && route ? modelIdentity(model, route).owner : null,
      requestedEndpoint: intent?.requestedEndpoint ?? null, returnedModel: execution?.returnedModel ?? null, actualProvider: execution?.actualProvider ?? null,
      chunkId: kind === 'stt' && !associationConflict ? intent?.chunkId ?? raw?.chunkId ?? null : null,
      usage: recordConflict || resultConflict || associationConflict ? null : execution?.usage ?? null, intentRateSnapshot: intent?.rateSnapshot ?? null };
  });
  return { stt: stageStatement('stt', items, project), minutes: stageStatement('minutes', items, project), combined: costStatement(items), items,
    unclassifiedAttempts: items.filter(item => item.kind === null && item.recordedAttempt).length };
}
