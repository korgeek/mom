import { expect, it } from 'vitest';
import type { UIPreparation } from '../src/react-app/App';
import { formatPreparationDiagnostic } from '../src/react-app/ui/preparation-diagnostic';

const now = 1000000;
const preparation: UIPreparation = { stage: 'preparing', completed: 1, total: 7, startedAtMs: 940000,
  lastProgressAtMs: 998000, sourceProcessedMs: 60000, durationMs: 2100000, phaseProcessedMs: 1000, phaseDurationMs: 300000,
  savedThroughMs: 300000, backgroundCount: 2, backgroundDurationMs: 25000, lastForegroundAtMs: 990000, errorCode: 'worker-unavailable' };

it('formats only explicitly allowed technical facts with measured times and durable counts', () => {
  expect(formatPreparationDiagnostic(preparation, now, 'visible', 'c0838c2-dirty')).toBe([
    'MoM local audio preparation diagnostics · appVersion: c0838c2-dirty',
    'processingLocation: on-device · externalAIRequests: none (local preparation)',
    'stage: preparing · errorCode: worker-unavailable',
    'elapsedMs: 60000 · lastRealProgressAgeMs: 2000',
    'sourceProcessedMs: 60000 / sourceDurationMs: 2100000',
    'phaseProcessedMs: 1000 / phaseDurationMs: 300000',
    'durableChunks: 1 / plannedChunks: 7 · savedThroughMs: 300000',
    'visibility: visible · backgroundCount: 2',
    'backgroundDurationMs: 25000 · lastForegroundAgeMs: 10000',
  ].join('\n'));
});

it('excludes sentinel secrets, raw errors, identifiers and unknown fields even when provided in the input', () => {
  const secret = 'PRIVATE_DIAGNOSTIC_SENTINEL';
  const hostile = { ...preparation, title: secret, fileName: secret, sourceId: secret, jobId: secret, settingsFingerprint: secret,
    audio: secret, transcript: secret, minutes: secret, apiKey: secret, password: secret, rawError: secret, message: secret,
    unknownFutureField: { content: secret }, url: `https://example.invalid/${secret}`, stage: secret, errorCode: secret,
    phaseProcessedMs: secret, phaseDurationMs: Infinity, backgroundCount: NaN, backgroundDurationMs: -1 } as unknown as UIPreparation;
  const result = formatPreparationDiagnostic(hostile, now, secret, `https://example.invalid/${secret}`);
  expect(result).toContain('sourceProcessedMs: 60000'); expect(result).toContain('durableChunks: 1');
  expect(result).toContain('stage: unknown'); expect(result).toContain('errorCode: unknown');
  expect(result).toContain('phaseProcessedMs: unknown'); expect(result).toContain('phaseDurationMs: unknown');
  expect(result).toContain('backgroundCount: unknown'); expect(result).toContain('backgroundDurationMs: unknown');
  expect(result).toContain('visibility: unknown'); expect(result).toContain('appVersion: unavailable');
  expect(result).not.toContain(secret); expect(result).not.toContain('https:');
  for (const field of ['title:', 'fileName:', 'sourceId:', 'jobId:', 'settingsFingerprint:', 'rawError:', 'message:', 'apiKey:', 'password:']) expect(result).not.toContain(field);
});

it.each(['worker-unavailable', 'unsupported-browser', 'source-mismatch', 'storage', 'busy', 'local-processing-failed'])('retains known safe error code %s', errorCode => {
  expect(formatPreparationDiagnostic({ ...preparation, errorCode }, now, 'hidden')).toContain(`errorCode: ${errorCode}`);
});

it('keeps missing facts unknown instead of inventing timing, progress or build information', () => {
  const result = formatPreparationDiagnostic({ stage: 'saving', completed: 0, total: null }, now, 'visible');
  expect(result).toContain('appVersion: unavailable'); expect(result).toContain('elapsedMs: unknown');
  expect(result).toContain('sourceProcessedMs: unknown'); expect(result).toContain('lastRealProgressAgeMs: unknown');
  expect(result).toContain('plannedChunks: unknown'); expect(result).toContain('errorCode: unknown');
});

it('ends elapsed time at the final recorded event for a stopped job', () => {
  const result = formatPreparationDiagnostic({ ...preparation, stage: 'stopped' }, now + 30000, 'visible', 'c0838c2');
  expect(result).toContain('elapsedMs: 58000'); expect(result).toContain('lastRealProgressAgeMs: 32000');
});
