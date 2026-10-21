import type { UIPreparation } from '../App';

const stages = new Set(['inspecting', 'reading', 'decoding', 'preparing', 'verifying', 'saving', 'complete', 'failed', 'stopped']);
const errorCodes = new Set(['unsupported-container', 'unsupported-codec', 'unsupported-layout', 'unsupported-browser', 'damaged-input', 'no-audio-track',
  'unsupported-options', 'encoded-too-large', 'media-limit', 'worker-unavailable', 'busy', 'source-mismatch', 'audio-options-locked', 'source-deleted', 'storage', 'invalid-input', 'permission', 'aborted', 'local-processing-failed']);
const number = (value: unknown): number | 'unknown' => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 'unknown';
function age(now: unknown, then: unknown): number | 'unknown' {
  const end = number(now), start = number(then);
  return typeof end === 'number' && typeof start === 'number' && end >= start ? end - start : 'unknown';
}

/** Deliberately list each allowed field; never serialize or spread the input. */
export function formatPreparationDiagnostic(p: UIPreparation, nowMs: number, visibility: string, appVersion?: unknown): string {
  const stage = stages.has(p.stage) ? p.stage : 'unknown';
  const end = ['complete', 'failed', 'stopped'].includes(stage) ? p.lastProgressAtMs : nowMs;
  return [
    `MoM local audio preparation diagnostics · appVersion: ${typeof appVersion === 'string' && /^[a-f0-9]{7,40}(-dirty)?$/i.test(appVersion) ? appVersion : 'unavailable'}`,
    'processingLocation: on-device · externalAIRequests: none (local preparation)',
    `stage: ${stage} · errorCode: ${typeof p.errorCode === 'string' && errorCodes.has(p.errorCode) ? p.errorCode : 'unknown'}`,
    `elapsedMs: ${age(end, p.startedAtMs)} · lastRealProgressAgeMs: ${age(nowMs, p.lastProgressAtMs)}`,
    `sourceProcessedMs: ${number(p.sourceProcessedMs)} / sourceDurationMs: ${number(p.durationMs)}`,
    `phaseProcessedMs: ${number(p.phaseProcessedMs)} / phaseDurationMs: ${number(p.phaseDurationMs)}`,
    `durableChunks: ${number(p.completed)} / plannedChunks: ${number(p.total)} · savedThroughMs: ${number(p.savedThroughMs)}`,
    `visibility: ${visibility === 'visible' || visibility === 'hidden' ? visibility : 'unknown'} · backgroundCount: ${number(p.backgroundCount)}`,
    `backgroundDurationMs: ${number(p.backgroundDurationMs)} · lastForegroundAgeMs: ${age(nowMs, p.lastForegroundAtMs)}`,
  ].join('\n');
}
