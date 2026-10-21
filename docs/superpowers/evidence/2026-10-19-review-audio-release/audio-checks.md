# Saved-source audio waveform preview

## Implemented
- Automatically opens the encrypted retained original when entering saved audio preparation, including after reload and lock/unlock. Existing freshly selected File preview still works.
- Native browser play/pause, current/total time, actual source-derived 256-point waveform, accessible native range seeking (click, drag, keyboard).
- Reuses existing incremental WAV/MP3/M4A mono decoder and terminating Worker. Waveform retains only fixed peaks and decoder window; no whole-recording PCM.
- Retained original playback Blob reconstruction uses sequential <=1 MiB reads, clears copied plaintext arrays, and admits at most 64 MiB. Larger retained originals still compute full waveform and show the playback cap. Fresh File previews do not reconstruct retained bytes and are uncapped by this preview limit.
- Independent preview abort owner fences vault epochs, selection/source changes and screen revisions. Lock removes audio/waveform UI, stops/revokes playback and terminates waveform Worker; late results cannot repopulate sensitive state.
- Native playback remains available if waveform decoding or Worker startup is unsupported. No provider requests, credentials, dependencies, or plaintext disk persistence.

## Owned files
- src/react-app/media/mp3.ts: sourceWaveform using existing bounded monoPcm.
- src/react-app/media/worker.ts: waveform RPC, fixed finite result validation, existing bounded retained-source transport.
- src/react-app/media/preview.ts: bounded retained source Blob assembly and Worker lifecycle.
- src/react-app/ui/components/SourcePreview.tsx
- src/react-app/ui/components/source-preview.css
- src/react-app/ui/screens/Import.tsx: automatic load/release, current source waveform component.
- src/react-app/controller.tsx: preview state/job/URL integration (parent later owns final controller integration).
- tests/source-preview.spec.ts
- tests/source-preview-controller.spec.ts
- tests/source-preview-ui.spec.tsx
- tests/e2e/source-preview.spec.ts

## Interface additions (parent implemented in App.tsx)
sourceWaveform?: readonly number[] | null;
sourcePreviewLoading?: boolean;
sourcePreviewError?: string | null;
onLoadSourcePreview?(projectId: string): void;
onReleaseSourcePreview?(projectId: string): void;

## Checks
- npx vitest run --config /private/tmp/mom-lock-placement.vitest.config.mts tests/source-preview.spec.ts tests/source-preview-controller.spec.ts tests/source-preview-ui.spec.tsx tests/source-worker.spec.ts tests/playback-ui.spec.tsx
  - Final set: 5 suites, 52 tests passed. Includes real synthetic WAV amplitude/silence, real synthetic MP3 amplitudes, exact restored bytes, 64 MiB admission, native fallback, late byte zeroing, reload/unlock, deleted source, media time/seek and callback identity stability.
  - The added 52nd test first exposed a global preparation-cancellation loading spinner; final controller cleanup fixed it and the regression now passes.
- npx eslint src/react-app/media/preview.ts src/react-app/media/mp3.ts src/react-app/media/worker.ts src/react-app/ui/components/SourcePreview.tsx src/react-app/ui/screens/Import.tsx tests/source-preview.spec.ts tests/source-preview-controller.spec.ts tests/source-preview-ui.spec.tsx tests/e2e/source-preview.spec.ts
  - Passed after all final production/UI/controller/browser test additions, including controller.tsx.
- npx tsc -b --pretty false
  - Passed after all final production and test edits.
- npx playwright test --config /private/tmp/mom-lock-placement.playwright.config.mts tests/e2e/source-preview.spec.ts
  - Headed Chrome scenario passed real play/time, pause, keyboard/click/drag seek, reload reopen, lock/unlock, no external requests or page errors.
  - Expanded headed scenario passed 1/1 in 3.5 seconds: actual drag plus 390x844 bounds and visual layout. A preceding failure was a test's hard-lock heading expectation while valid soft-lock UI was shown; test now accepts both supported gate variants.
- git diff --check passed after all final edits.

## Runtime/evidence
Vite dev server http://127.0.0.1:4176 uses /private/tmp/mom-lock-placement.vitest.config.mts so the existing symlinked node_modules can serve codec WASM; agent session 96150 remains running for parent integrated checks.
Headed Chrome screenshots /private/tmp/mom-audio-preview-1440.png (1440x900) and /private/tmp/mom-audio-preview-390.png (390x844) inspected: waveform/control panel fits existing source section without horizontal overflow; desktop keyboard focus outline visible.

## Limits
No full suite, actual provider inference/credentials, real private audio, or production deployment tested by this subagent. Retained originals above 64 MiB cannot use native original preview after reload; waveform remains supported, and existing prepared chunk playback remains available in transcription. In-memory waveform is recomputed when reopened, without a new sensitive persistence format. No promise of browser/codec memory zeroization. No git mutation, commit or push performed by this subagent.

## Final results
Final scoped command completed successfully (exit 0): 52 tests in 5 suites, all listed ESLint files including controller.tsx, npx tsc -b --pretty false, git diff --check.
Latest expanded headed browser command passed 1/1 in 3.5 seconds with both viewport screenshots inspected. The final later controller edits cover only the 64 MiB+unavailable-waveform message and the separately regression-tested cancellation loading cleanup; they do not change the passing normal browser flow.
Controller changes are released to parent; no further writes or Git actions planned. Dev server :4176 remains live.
