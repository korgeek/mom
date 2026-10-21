# Active memo deletion implementation

Worktree: /Users/jinik/.codex/worktrees/desktop-lock-countdown/mom
No staging, commit, push, real credentials, real user vaults or actual memo deletion by this agent.

## Changed files

- `src/react-app/App.tsx`: exposes `MemoDeletion` in the active memo header on import/transcription/notes; preserves countdown and license changes. Also added source waveform/loading/error fields and lazy-preview callbacks requested by the audio agent.
- `src/react-app/ui/components/MemoDeletion.tsx` (new): labelled Korean/English action, named native alertdialog using house SettingsDialog, Cancel default focus, explicit irreversible original/fragment/chunk/raw+edited transcript/notes/request+usage scope. Explains other memos/shared keys/settings survive and disk originals/export/provider copies remain. Blocks busy/storage/recording or missing handlers, prevents duplicate confirmation, displays failure and permits explicit retry. Dialog is local ephemeral state, unmounted on screen/project change or lock.
- `src/react-app/ui/components/memo-deletion.css` (new): bounded wrapping header action aligned with existing responsive header.
- `src/react-app/vault/screen-state.ts`: exact draft identity pruning for every current memo draft format; preserves independent settings and other memo IDs even if their ID contains the deleted ID. Clears selected navigation only when the deleted memo was selected.
- `src/react-app/vault/store.ts`: atomically deletes owned records/project/catalog membership AND retained screen drafts; adds deleted project/owned IDs to existing tombstones. Stale checkpoint writes cannot recreate deleted data; late screen-state writes are pruned using tombstones. Pending screen state is pruned after successful transaction only.
- `tests/memo-deletion-ui.spec.tsx` (new): 9 tests, three active stages, named confirmation/scope, Cancel/default Enter/native cancel, duplicate submit, disabled states, failure/retry, lock removal.
- `tests/memo-deletion-drafts.spec.ts` (new): 1 exact identity-pruning regression covering all current draft formats and other memo/settings preservation.
- `tests/storage-management.spec.ts`: 3 synthetic encrypted-store regressions: all authenticated owned records including older source generations, raw/edited outputs and checkpoints removed while other memo/key/registry survive; interrupted recording fragments fully removed; failed deletion rolls back records/tombstones together. Includes stale checkpoint/screen writes and lock/unlock persistence.

## Controller integration required from parent

Import `withoutDeletedProjectDrafts` from vault/screen-state.ts. After successful onDeleteMeeting store deletion, prune `uiDrafts` with `new Set([id])`; `availability.delete(id)`; releaseSourcePreview(id); clear active selected sourcePreviewUrl/waveform/loading/error and selected project-only consent/comparison/preparation/editor/reset state. Clear matching historyProjectId, invalidate inventory/deletion plans that retain this memo. Retain other memo and shared settings. Publish uiDrafts then retainScreenState. Existing pending.delete(id), edit timer cancellation, files.delete(id), preview revoke remain necessary. Parent owns controller changes and integration test.

## Exact checks and results

1. `npx vitest run --config /private/tmp/mom-lock-placement.vitest.config.mts tests/memo-deletion-drafts.spec.ts tests/storage-management.spec.ts --testNamePattern 'removes every memo draft|verifies all owned memo records'`
   Exit 0: 2 passed, 27 skipped (before adding two additional store regressions).
2. `npx vitest run --config /private/tmp/mom-lock-placement.vitest.config.mts tests/memo-deletion-ui.spec.tsx`
   Exit 0: 9 passed.
3. `npx vitest run --config /private/tmp/mom-lock-placement.vitest.config.mts tests/storage-management.spec.ts --testNamePattern 'verifies all owned memo records|deletes every owned interrupted recording'`
   Exit 0: 2 passed, 27 skipped.
4. `npx vitest run --config /private/tmp/mom-lock-placement.vitest.config.mts tests/storage-management.spec.ts --testNamePattern 'rolls back memo deletion'`
   Exit 0: 1 passed, 29 skipped.
5. `npx vitest run --config /private/tmp/mom-lock-placement.vitest.config.mts tests/vault.spec.ts tests/controller.spec.tsx tests/playback-controller.spec.ts tests/vault-model-registry.spec.ts tests/ui.spec.tsx --testNamePattern 'does not delete another project|does not resurrect a deleted meeting|releases active playback when deleting its meeting|preserves registry on project creation/checkpoint/delete|creates, renames, pins and explicitly confirms deletion'`
   Exit 0: 5 passed, 270 skipped.
6. `npx eslint src/react-app/App.tsx src/react-app/ui/components/MemoDeletion.tsx src/react-app/vault/screen-state.ts src/react-app/vault/store.ts tests/memo-deletion-drafts.spec.ts tests/memo-deletion-ui.spec.tsx tests/storage-management.spec.ts`
   Exit 0: zero errors, one pre-existing App.tsx react-refresh export warning.

One intermediate synthetic fixture attempt to put an interrupted writer in an already imported project failed with the intended `Source writer conflicts with existing imported audio` guard. Corrected the test to use a separate empty memo; final tests pass. One large UI-test apply_patch automatic review timed out; one permitted smaller retry succeeded. No automatic rejection remains.

## Limits

Synthetic IndexedDB and jsdom only. Parent still needs controller integration and local visible-browser responsive/dialog/lock smoke. This agent did not run a build/typecheck/full suite, inspect actual vaults, transmit to providers, deploy, or claim physical disk erasure. Logical deletion controls app vault data; provider retention, device input files and exported copies are outside it.

## Controller integration follow-up

Parent integrated controller cleanup; this agent added only `tests/memo-deletion-controller.spec.ts` afterward. It creates synthetic A/B memos and an actual synthetic WAV; seeds an A request; persists A/B review-text and shared-setting drafts; loads A's preview and actual waveform; selects A history and registers a fake source player; deletes A and verifies player stop, URL revoke, waveform/loading cleanup, request/history removal, selective draft cleanup, and encrypted screen restoration after lock/unlock. B and shared drafts remain. No production controller file was changed by this agent.

`npx vitest run --config /private/tmp/mom-lock-placement.vitest.config.mts tests/memo-deletion-controller.spec.ts`

Exit 0: 1 passed (2026-10-19 14:51 local tool time). Controller integration gap above is now covered by this targeted regression. Visible-browser smoke and deployment remain parent-owned.
