# Model selection and Settings implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development for this one coherent task. Steps use checkboxes for tracking.

**Goal:** Make key setup and model selection comfortable, cancelable and truthful, while preserving MoM's visual style and safety boundaries.

**Architecture:** Settings opens a provider-specific modal over the existing registry projections. Checkbox/default changes stay in a local draft until one revision-checked encrypted registry save succeeds. Presentation metadata stays outside encrypted registry v1; existing processing, consent and deletion implementations remain authoritative.

**Tech Stack:** Existing React 19, TypeScript, Vite, Vitest, Testing Library and headed Playwright Chrome; no new dependency.

**Spec:** [Approved local scope](../specs/2026-10-04-model-selection-settings-design.md). The earlier draft status describes when that document was written; the latest user explicitly authorizes this local implementation and defers deployment.

## Global constraints

- Base: original main `8abd5540ee9c2aa0e0baf844cd49d3ab217d7335`; worktree `.worktrees/mom-model-settings`, branch `feat/mom-model-settings`.
- Preserve look and feel, exact route identity, encrypted persistence, existing meetings/defaults, ownership/lock fences, explicit metadata/policy acknowledgments and bounded retries.
- No real keys, existing user profile/vault, authenticated provider calls, paid inference, new adapters, license/publication change, push or deployment.
- Saving a key does not auto-discover, auto-open, auto-enable or send meeting content. The user separately chooses **모델 선택 / Select models**.
- Normal modal tabs: **음성 전사 / Transcription**, **글 생성 / Text generation**. Normal rows show name/provider, advertised currency + real billing unit, a short factual feature and a correctly labelled date.
- No invented ratings/quality rankings, token-to-minute conversion, unknown-as-free price, release date inferred from IDs/catalog timestamps or silent model/endpoint fallback.
- Initial recommendations are draft-only and apply only to a genuinely new provider/stage preference set. Persist explicit unchecked recommended choices on Apply; preserve existing enabled/disabled/default choices.
- Unsupported new rows hidden by default, saved blocked rows visible and removable. Direct OpenAI text generation remains visibly unavailable. OpenRouter text requires an explicitly selected supported endpoint.
- Settings max width 960px, section gap 18px, interior rhythm 16px; modal max width 820px and viewport-bound internal scrolling; mobile safe insets 12–16px.
- Default test scope is changed code and directly affected flows. Reuse identical passing lower-level evidence; do not rerun full suites or describe the prior 127 unit / 35 browser failures as resolved.
- One independent feature review covers spec and quality; do not introduce another mandatory review chain. Meaningful local commits and safe original-root integration are authorized.

## Review focus

- Replacing a previously saved key fails: latest save-attempt status must report failure, never borrow an old saved connection's success.
- Metadata/key/ownership changes while a draft is open: stale Apply cannot publish a registry or grant consent; lock removes drafts and sensitive DOM.
- Several checkbox/default changes encounter storage failure: old saved preferences remain intact, draft/error remain visible, no partial durable updates.
- A first-time recommended checkbox is explicitly unchecked: Apply records that decision, reopen/reload cannot reselect it.
- Compact storage presentation preserves cancel, acknowledged deletion, failure and ownership behavior; unknown sizes remain unknown.

### Task 1: Implement and verify the complete local Settings/model-selection flow

**Files and ownership:**
- Modify `src/react-app/App.tsx`: controller-facing nonsecret key-save attempt contract; no unrelated routing changes.
- Modify `src/react-app/controller.tsx`: publish truthful save attempts, registry revision and one batch Apply with existing execute/job/saveRegistry fences.
- Modify `src/react-app/ui/screens/Settings.tsx`: compact connection entry, modal opener, policy/storage copy and simplified normal layout.
- Create `src/react-app/ui/components/ModelSelectionModal.tsx`: provider/stage tabs, local draft, compact rows/details, error/save/focus lifecycle.
- Modify `src/react-app/ui/components/ModelManager.tsx`: share relevant row contracts/helpers; keep legacy detailed controls available only through intentional details/advanced UI where needed.
- Modify `src/react-app/providers/model-presentation.ts`: extend the existing file, never replace its current catalog helpers; present honest pricing/features/date evidence.
- Modify `src/react-app/providers/registry-consumer.ts` only if needed to project catalog-listed dates without altering registry v1.
- Modify `src/react-app/ui/components/StorageManagement.tsx`: friendly summaries, human-readable sizes and details disclosure; preserve delete contracts.
- Modify `src/react-app/ui/styles.css`: scoped Settings/modal layout; no global redesign.
- Create targeted tests `tests/model-selection-modal.spec.tsx`, `tests/model-selection-controller.spec.tsx`, `tests/model-selection-presentation.spec.ts`, `tests/e2e/model-selection-settings.spec.ts`.
- Update directly affected existing `tests/model-manager-ui.spec.tsx`, `tests/storage-ui.spec.tsx`, `tests/e2e/model-settings.spec.ts` / relevant setup helpers only where actual interactions changed; retain behavioral assertions.
- Implementation report lives in ignored `.superpowers/sdd/model-selection-settings/task-1-report.md`; controller updates the ledger, not product source.

**Interfaces:**
- Existing `ModelManagementRow` and `ModelManagerProps` remain the projection source; do not create an alternate saved registry.
- Add `ModelSelectionSubmission` with `baseRevision: number`, `changes: readonly { key: string; enabled: boolean }[]`, and optional explicit `defaultChanges: readonly { stage: 'stt' | 'minutes'; key: string }[]`.
- Extend `ModelManagerProps` with optional `revision: number` and `onApplySelection(submission: ModelSelectionSubmission): Promise<void>`; production controller supplies both. An absent callback/revision disables Apply honestly in fixtures/unavailable states.
- Expose optional nonsecret `AppController.keySaveAttempts`, keyed by `openai | openrouter`, with `status: 'saving' | 'saved' | 'failed'`, monotonically changing attempt revision and safe message. Clear on lock/reset; no secret value is part of this structure.
- Publish the current metadata/preference revision; check it inside the owned job before composing and saving. Key/metadata changes invalidate it. Duplicate/conflicting/unknown route submissions are rejected.
- Compose against latest known observations using `addRegistryObservation`, `setRegistryEnabled`, default helpers and normalization. Validate supported enable/default transitions against current projections, then call existing `saveRegistry(next, job)` once. Turning a blocked saved route off remains allowed.
- Enabling/Apply never acknowledges metadata or OpenRouter policy; retain their separate explicit controls and guards. Default changes affect prospective defaults only, never current meeting selections.
- Dates are a presentation discriminated value `released | listed | unknown`; catalog `createdAt` may display **Catalog listed / 카탈로그 등록**, never **Version released / 버전 출시**. Unknown is explicit. Exact-version release evidence requires source and checked date in internal evidence/details, without widening persisted v1.

- [ ] **Step 1: Write failing targeted tests.**
  - Controller: latest key replacement failure; one save for multiple changes; failed save preserves old state; invalid/stale/locked/ownership input rejected; rejected recommendations stay disabled; defaults and existing meetings untouched unless explicitly changed; no provider request/implicit policy acceptance.
  - Modal: cancel/Escape/reopen preserve saved values; checkbox edits are draft only; failure retains draft; save pending has truthful controls; lock/unmount clears draft; focus trap/restoration; unsupported/new versus blocked saved rows; direct OpenAI text unavailable.
  - Presentation: exact route/provider identity, currency and token/audio/request units, zero versus incomplete unknown, feature facts and released/listed/unknown distinction. Alias/date-looking IDs do not confer official release evidence.
  - Storage: readable summary/details and the existing cancel/delete/failure/ownership assertions for touched controls.

- [ ] **Step 2: Run the new tests and record the expected failure.**
  Run `npx vitest run tests/model-selection-modal.spec.tsx tests/model-selection-controller.spec.tsx tests/model-selection-presentation.spec.ts` (adjust jsdom marker/config following existing tests).
  Expected failure must name missing/new behavior, not a sandbox/collection issue. Keep the red output in this task's evidence.

- [ ] **Step 3: Implement contracts and owned save behavior.**
  Use existing encrypted session/store and controller job fences. Publish attempt-specific safe status for success/failure; replacement failure cannot rely on `connections.status`. Clearing/locking/resetting removes attempts and invalidates stale submissions.
  Batch registry preferences atomically; normalize and validate before one save. Do not loop immediate-save callbacks.

- [ ] **Step 4: Implement the modal and compact Settings presentation.**
  Open separately after saved-key availability. Draft recommended supported exact routes only when genuinely new. Preserve explicit exclusions/defaults and make changed metadata require an explicit refresh/review rather than silently rebasing consent.
  Put IDs/endpoint identity/source/provenance/limits and technical controls under **추가 정보 / Additional information**. Keep normal copy short and understandable in Korean/English.
  Keep discovery explicit with clear authentication disclosure, and endpoint selection explicit. Retention acknowledgment stays distinct. Compact storage rows keep deletion semantics and licensing access.

- [ ] **Step 5: Run scoped unit/component/controller verification.**
  Run the new three files plus directly touched existing model-manager/storage tests and registry-consumer/model-registry contracts if their projection/helpers changed. Record exact commands/counts, changed fixtures and why prior expectations became stale.
  Do not broaden to unrelated audio/model/recording suites. Debug scoped failures before accepting results.

- [ ] **Step 6: Build and render actual changed flows in separate headed Chrome.**
  Run `npm run build`, then the targeted `tests/e2e/model-selection-settings.spec.ts` with existing isolated synthetic-vault/network-fixture patterns. Run directly affected existing model-settings cases after adjusting stale interactions.
  Render 1440×900, 768×900, 360×800: connections, model modal and storage. Include Korean and one English state; measure 18px section separation/no horizontal overflow, usable row/touch layout, keyboard/focus, draft cancel/apply/failure, safe lock and touched storage confirmation. No real API/profile/vault is used.
  Save screenshots/metrics/results and provide their paths for root visual inspection. Use a fresh test profile; do not stop unrelated user browsers.

- [ ] **Step 7: Self-review and commit the coherent feature.**
  Run `git diff --check` and `npm run test:secret` after build, plus targeted ESLint for changed source. Stage only explicit owned source/test files; no ignored evidence, private archives, generated build or dependencies.
  Commit with a descriptive local message. Report status, full commit SHA(s), exact targeted counts, actual viewports/states and remaining limits; no push/deploy.

## Integration and acceptance

- Root packages the exact base-to-feature diff, report and brief for one independent spec+quality review. Reviewer reuses passing evidence, reruns only a concrete changed/failed concern, and never edits source.
- Implementer resolves important/spec findings with scoped reruns and reports. Root inspects actual screenshots and confirms the acceptance items above from actual code/results.
- Verify original root is still clean at expected base and that feature descends from it, then `git merge --ff-only feat/mom-model-settings` locally. If original changed concurrently, stop integration and reconcile safely; no reset/force or blind overwrite.
- Preserve ignored evidence in original `.superpowers/sdd/model-selection-settings/` with hashes/path map before retiring only this merged worktree/branch. Do not touch the five older unmerged trees.
- Final report: original root path and full SHA, changed behavior, targeted checks/results, rendered states, review findings and limits. Deployment remains deliberately pending; the historical failed full audit is not reclassified.
