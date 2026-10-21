# MoM STT result review and model-switch retry

Worktree: `/Users/jinik/.codex/worktrees/desktop-lock-countdown/mom`
No product controller changes, dependency installs, commits, staging, pushes, deployments, real keys or authenticated provider calls by this agent.

## Changed files owned by this task

- `src/react-app/ui/screens/STT.tsx`
- `src/react-app/ui/screens/stt-review.css` (new)
- `src/react-app/ui/components/ChunkTranscript.tsx` (new)
- `src/react-app/ui/UsageStatement.tsx`
- `tests/stt-rerun-ui.spec.tsx`
- `tests/stt-rerun-controller.spec.tsx`
- `tests/usage-ui.spec.tsx`
- `tests/workflow.spec.tsx`
- `tests/openrouter-stt-ui.spec.tsx`
- `tests/compact-work-priority.spec.tsx`

## Result

- Matches selected left-summary artifact: 240–300px desktop setup column, brief visible transmission facts plus full retained disclosure, compact usage summary immediately below.
- Saved chunk's read-only View transcript button precedes retry. Native result dialog selects preserved original versions, displays exact chunk source bounds, recorded model/provider/route, containing transcript versions, IDs, save time and original JSON response. Unknown provenance stays unknown.
- Progress card opens existing Review inside a large native SettingsDialog. Version selection, original results, per-segment edits, overlap reconciliation, missing ranges and minutes navigation remain intact. Existing per-version session drafts survive modal closing; lock unmount removes the content. Native dialog handles focus isolation/restore; closing full review stops playback.
- Summary and modal use the unchanged aggregateProjectUsage projection. Duplicate run IDs counted once; unknown usage/costs stay unknown; known partial subtotals/currencies remain separate; uncertain failures are disclosed. Friendly model/status request headers; diagnostic IDs/routes collapsed. Detailed usage and batch history remain in the modal. Shared UsageStatement compact behavior stays unchanged unless explicit `detailed` prop is supplied by STT.
- Retry defaults to original frozen batch model. Same model keeps batchId and its frozen model/policy/languages. Selecting another model clears batchId, disclosures use the new current route, exact selected chunks are retained, and fresh additional-charge consent is required. Switching again clears consent. Controller's existing batch creation and validation enforce compatibility and preserve prior batches/results/selected edited transcript/notes. No controller patch needed.

## Actual targeted verification

1. `npx vitest run tests/stt-rerun-ui.spec.tsx tests/usage-ui.spec.tsx tests/usage.spec.ts tests/stt-rerun-controller.spec.tsx tests/workflow.spec.tsx` — **62 passed**. Output `/private/tmp/mom-stt-tests.log`.
   - Controller fixture migrated from obsolete modelManagement discovery assumptions to explicit synthetic current model registrations and bound consent. It waits for asynchronous model selection to finish.
   - Covers new-model new batch with original batches byte-for-byte retained, exact selected chunk, prior raw responses and selected edit retained, fresh charge consent, state changes invalidating consent, retry original model/languages, storage failure/reload and cancel/lock late responses, raw immutability/focus, modal editing/overlap/missing ranges/draft close/lock, unique usage counts and partial cost coverage.
2. After final transmission-layout-only change, `npx vitest run tests/stt-rerun-ui.spec.tsx tests/usage-ui.spec.tsx tests/workflow.spec.tsx` — **26 passed**. Output `/private/tmp/mom-stt-final-ui.log`. Reused unchanged controller/aggregation evidence above.
3. `npx vitest run tests/openrouter-stt-ui.spec.tsx -t 'OR_STT_review|labels saved raw provenance|projects the recorded OR requested route'` — **5 passed, 15 intentionally skipped**. Output `/private/tmp/mom-stt-or.log`.
4. `npx vitest run --config /private/tmp/mom-stt-vitest.config.mts tests/ui.spec.tsx tests/compact-work-priority.spec.tsx -t 'retry dialog|STT retry|newer failed|STT progress|immutable raw|whole chunk speech|Korean search label|saved-chunk retranscription|labels direct OpenAI|summarizes compact usage'` — **14 passed, 104 intentionally skipped**. Output `/private/tmp/mom-stt-affected.log`.
   - Temporary config only adds both shared-worktree and real symlinked node_modules roots to Vite's read allowlist; no product config changed. UI tests otherwise encountered `Denied ID .../wasm/mp3.wasm?url` before test collection. UI-only fixture files mock prepare, never codec processing.
5. `npm run typecheck` — **passed**, final run after all STT edits. Output `/private/tmp/mom-stt-typecheck.log`.
6. `npx eslint src/react-app/ui/screens/STT.tsx src/react-app/ui/components/ChunkTranscript.tsx src/react-app/ui/UsageStatement.tsx tests/stt-rerun-ui.spec.tsx tests/stt-rerun-controller.spec.tsx tests/usage-ui.spec.tsx tests/workflow.spec.tsx tests/openrouter-stt-ui.spec.tsx tests/compact-work-priority.spec.tsx` — **passed**, no output.

## Limits / known unrelated failures

- No browser visual verification by this agent; parent is performing visibly separate headed fixture verification for STT layout and all three modals. Unit tests use a native-dialog jsdom shim and do not prove browser focus trapping or responsive appearance.
- Initial broad OpenRouter UI test execution included 3 preexisting model-editor policy tests. They expect retention controls and policy links inside Model Edit, while current retention controls live in ApiKeys.tsx. These are outside this STT change. A subsequent broad name filter accidentally included one of them again; exact affected STT filter above passes. Product policies were not changed or relaxed.
- First combined large write/test tool command never ran because automatic approval review timed out. Retrying once as a prepared script plus short command succeeded.
- Full suite, production smoke, real authenticated STT quality/costs/provider retention and deployment are not verified by this agent. Parent owns integration/release.
