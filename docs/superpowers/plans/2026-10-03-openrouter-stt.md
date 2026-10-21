# OpenRouter STT Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an OpenRouter-only setup transcribe prepared audio with explicit dynamic-provider consent, while preserving direct OpenAI and encrypted result history.

**Architecture:** Add a reviewed STT profile/catalog projection and one dedicated JSON transport adapter. Bind its immutable selection to the existing registry, batch, queue and encrypted checkpoint paths; retain the existing paid gate, cancellation and ownership boundaries. UI recommendations never enable models or authorize requests.

**Tech Stack:** Existing React 19.2.1, TypeScript 5.9.3, Vite 7, Web Crypto/IndexedDB, Vitest and separate headed Playwright Chrome; no new runtime dependency or server endpoint.

**Spec:** [Approved design and initial-default addendum](../specs/2026-10-03-openrouter-stt-design.md).

## Global Constraints

- Baseline: clean `/Users/korgeek/Workspace/mom/.worktrees/mom-models`, `f5ad6bd3b52148991f5601ab4e86f230ebf3425c`; verify recorded refs/status before execution. The legacy root checkout is documentation-only; preserve its untracked documents and references.
- Start isolated `/Users/korgeek/Workspace/mom/.worktrees/mom-openrouter-stt`, branch `feat/mom-openrouter-stt`. Preserve the selected Sol Extra High implementer/independent-review workflow and parent's Max setting. Assign exact paths in the ledger; never overwrite another active worker.
- Direct browser → OpenRouter → dynamic processing provider; no MoM account, AI relay, application storage or telemetry. No real key, user profile/vault, microphone, paid inference or authenticated API probe.
- Initial profiles: `openai/gpt-4o-mini-transcribe` and `openai/whisper-large-v3`, basic JSON, encoded MP3/PCM WAV only. Require audio input + transcription output, exact non-alias ID and explicit user enablement. Unknown profiles stay blocked.
- Prioritize those two supported profiles in the existing shortlist; do not expand the model inventory or make unsupported catalog entries look usable. Beginner copy distinguishes local encrypted storage from STT audio and Minutes transcript/instruction transmission; retention/training follows provider policies/settings, never local-encryption claims.
- Ceiling: `16,000,000` encoded bytes and `24,000,000` UTF-8 JSON-body bytes, or a smaller confirmed profile limit. Preserve preparation's 10/15-minute and 10/15-second overlap choices; bound encoding/body memory to one chunk. Never truncate or silently reprepare during a paid run.
- Default policy: `data_collection: deny`, required ZDR; only explicit disclosure permits standard retention. STT ignores `only/order/ignore`; do not promise pinning, fixed downstream prices or control of service-internal retries.
- Initial recommendation: Mini, ranked first by weekly token usage in the dated 24-model public snapshot; Whisper is an explicit alternative. No confirmed free STT candidate. Existing selections, disabled routes and explicitly cleared defaults survive refresh/migration. Key save/discovery never sets defaults, consent or enablement.
- Preserve raw responses, source ranges, attempts and transcript versions. STT `usage.cost` is provider-reported USD; estimates, unknown totals and token/duration counters remain distinct. Do not reuse Minutes credit semantics or infer audio tokens from bytes.
- Tests follow Git diff and directly affected flows. Reuse unchanged media/crypto/playback evidence; no full suite. No implementation, commit or push until this plan is reviewed; subsequent main push uses the existing parent release gate.

## Review Focus

1. Replacing/refreshing a saved or explicitly cleared default preserves the user's choice; recommendation alone never sends audio (Tasks 1, 4).
2. A legacy OpenAI batch and an OR retry survive reload without route guessing; unavailable/changed policy blocks a paid retry (Task 3).
3. Boundary-size, MIME/codec mismatch and invalid source ranges fail before key access/POST; JSON body size is measured after serialization (Task 2).
4. Missing cost/provider fields and mixed expected languages remain unknown/autodetected, without fabricated metadata or first-language selection (Tasks 1, 2, 4).
5. Lock, other-tab ownership or encrypted-save failure prevents another request and rejects late results without losing completed history (Task 3).

---

## File ownership and interfaces

All paths below are relative to the feature worktree. Parent owns shared contracts, registry, persistence boundary and controller edits; a transport worker owns the new adapter/tests; a UI worker owns the named screens/tests after contracts freeze. Tasks 1 → 3 are sequential dependencies; transport and UI work may overlap only after their consumed interfaces freeze. One independent review covers the final changed increment and existing focused evidence, without an added mandatory review chain.

Shared types, defined in `src/react-app/domain/types.ts`:

```ts
type RouterSTTPolicy = Readonly<{ dataCollection: "deny"; requireZdr: boolean }>;
type RouterSTTPreference = Readonly<{ policy: RouterSTTPolicy; acknowledgedDisclosureVersion: "or-stt-1" | null; initialDefaultApplied: boolean }>;
type RouterSTTSelection = Readonly<{
  version: 1; route: ModelRegistryRoute; profileId: string; profileVersion: 1;
  catalogFingerprint: string; catalogSource: string; catalogCheckedAt: string;
  policy: RouterSTTPolicy; sourceId: string; chunks: readonly PreparedChunk[];
  expectedLanguages: readonly string[]; appliedLanguage: string | null;
  responseFormat: "json"; rateSnapshot: RateSnapshot | null; rawPricing: unknown;
  billingBasis: "audio-second" | "tokens" | "unknown"; disclosureVersion: "or-stt-1";
}>;
```

Add `STTBatch.routerSelection?: RouterSTTSelection` and, in Task 3, `STTBatchInput.routerSelection?: RouterSTTSelection`. Add optional `ModelRegistry.openRouterSTT?: Readonly<Record<string, RouterSTTPreference>>`, keyed by connection ID, using the existing encrypted registry save/load path. Add `RawTranscript.responseMetadata?: Readonly<{ generationId: string | null; returnedModel: string | null; actualProvider: string | null }>` for actually returned documented body/header identifiers. Absence on legacy records grants no acknowledgment. No credential/header dump/base64 audio enters these serialized types.

### Task 1: Reviewed profiles, pricing and initial recommendations

**Files:** Create `src/react-app/providers/stt-catalog.ts`, `tests/openrouter-stt-catalog.spec.ts`; modify `src/react-app/domain/types.ts`. Consume existing `src/react-app/providers/discovery.ts` STT observations without replacing the text catalog or its bounded discovery parser.

**Interfaces:** Export `RouterSTTProfile = Readonly<{ id: string; version: 1; modelId: string; formats: readonly Readonly<{ mime: string; codec: string }>[]; maxAudioBytes: number; maxBodyBytes: number; singleLanguageHint: boolean; source: string; checkedAt: string }>` and `resolveRouterSTTProfile(model: DiscoveredSTTModel): RouterSTTProfile | null`, `routerSTTRateSnapshot(model: DiscoveredSTTModel, profile: RouterSTTProfile): RateSnapshot | null`, and `recommendRouterSTT(models: readonly DiscoveredSTTModel[]): Readonly<{ recommendedId: string | null; freeId: string | null; source: string; checkedAt: string }>`.

- [ ] Record baseline/status, ignored worktree destination and file ownership in `.superpowers/sdd/openrouter-stt/ledger.md`; read both spec and this plan. Create the isolated feature worktree from the verified integration SHA without pull/reset.
- [ ] Write failing catalog tests with these exact assertions:

```ts
expect(resolveRouterSTTProfile(audioChatOnly)).toBeNull();
expect(resolveRouterSTTProfile(aliasOrUnknown)).toBeNull();
expect(recommendRouterSTT(confirmed24).recommendedId).toBe("openai/gpt-4o-mini-transcribe");
expect(recommendRouterSTT(confirmed24).freeId).toBeNull();
expect(routerSTTRateSnapshot(ambiguousPricing, supportedProfile)).toBeNull();
```

- [ ] Run `npm run test:unit -- tests/openrouter-stt-catalog.spec.ts`; expect missing exports/assertion failures before implementation, not unrelated setup failure.
- [ ] Implement the named exports and shared types. Preserve raw rate dimensions and date/source. Confirm documented MP3/WAV tuples before making the profile available; unconfirmed tuples remain blocked. Advertised Mini token rates do not establish preflight audio token count; a Whisper per-second rate needs its documented billing basis. Conditional/missing dimensions never establish a free route.
- [ ] Keep the dated popularity evidence separate from runtime prices. Recommendation is a pure projection of currently compatible exact candidates; never mutate registry/defaults. Preserve unsupported discovery records as observations, without claiming all 24 are implemented.
- [ ] Rerun the same focused command; expect all new cases PASS. Run `npx tsc -p tsconfig.app.json --noEmit --incremental false` and record its exit code; do not run product-wide tests.
- [ ] Commit only the three named product/test paths, message `feat: define OpenRouter STT profiles and selection contracts`; retain ledger/evidence privately in ignored `.superpowers/`, and report full SHA and frozen interfaces.

### Task 2: Bounded OpenRouter transcription transport

**Files:** Create `src/react-app/providers/openrouter-stt.ts`, `tests/openrouter-stt-provider.spec.ts`; consume `src/react-app/domain/types.ts`, `src/react-app/domain/pipeline.ts` request controls and Task 1 profile exports. Do not modify the OpenAI or Minutes adapters.

**Interfaces:** Export `createOpenRouterSTTProvider(options: Readonly<{ selection: RouterSTTSelection; getKey: RuntimeKeyGetter; fetch?: FetchTransport; now?: () => number; timeoutMs?: number }>): STTProvider`. Its `transcribe(request: STTRequest, job: JobContext): Promise<RawTranscript>` validates against the frozen selection and uses the existing `runPaidRequest("openrouter", ...)` once; the queue must not wrap that gate again.

- [ ] Write failing `sends_one_json_chunk_with_managed_policy`, `rejects_bytes_body_and_format_before_credentials`, `keeps_mixed_languages_auto_and_unknown_fields_unknown`, and `reports_usd_and_never_retries_or_falls_back` cases in the new file. Assert POST count 1; endpoint `/api/v1/audio/transcriptions`; raw base64 without data-URL prefix; policy fields present; `only/order/ignore`, ignored `prompt` and speaker/timestamp options absent.
- [ ] Include assertions for exact raw limit and limit+1; measured UTF-8 JSON-body limit; Blob/chunk byte mismatch, MIME/codec mismatch and invalid source ranges. Rejected cases assert `getKey` and fetch counts 0. Token-only usage cannot fabricate per-modality counters; missing `cost/model/provider` stays null. `usage.cost: 0.01` gives `costKind: "reported"`, `currency: "USD"`.
- [ ] Run `npm run test:unit -- tests/openrouter-stt-provider.spec.ts`; expect targeted failures before implementation.
- [ ] Implement the adapter. Serialize one chunk; check actual body bytes before key lookup. Send exact model, `response_format: "json"`, documented audio payload and `provider.data_collection`/`provider.zdr`; omit unsupported fields. Apply a supported single ISO hint only; several expected languages omit the hint. Recheck epoch before/after awaits, release local body/audio references after transport, and sanitize public errors.
- [ ] Normalize original JSON plus truthful chunk-level ranges; validate any returned structured ranges before use. Preserve actually returned provider/model/generation metadata, never infer provider from namespace. Map authentication/payment/429/timeout/malformed/incomplete errors to existing typed failure/outcome-unknown rules. A service error cannot relax policy or create another POST.
- [ ] Rerun the same file; expect PASS, including abort/late-response and cooldown cases using injected fetch/clock and synthetic key strings. Run `npx eslint src/react-app/providers/openrouter-stt.ts tests/openrouter-stt-provider.spec.ts`; expect exit 0.
- [ ] Commit only these owned paths, message `feat: add bounded OpenRouter STT transport`; report full SHA and fixture-only limits.

### Task 3: Registry, immutable consent, batches and encrypted orchestration

**Files:** Create `src/react-app/providers/stt-selection.ts`, `tests/openrouter-stt-orchestration.spec.tsx`; modify `src/react-app/providers/model-registry.ts`, `src/react-app/providers/registry-consumer.ts`, `src/react-app/transcript/batches.ts`, `src/react-app/domain/pipeline.ts`, `src/react-app/controller.tsx`, and `src/react-app/App.tsx` controller types. Inspect `src/react-app/vault/store.ts` and `src/react-app/vault/session.ts`; change them only if their existing encrypted registry boundary needs the new optional field. Extend directly affected cases in `tests/model-registry.spec.ts`, `tests/registry-consumer.spec.ts`, `tests/stt-batches.spec.ts`, `tests/vault-model-registry.spec.ts`.

**Interfaces:** Export `freezeRouterSTTSelection(project: MeetingProject, chunkIds: readonly string[], route: ModelRegistryRoute, model: DiscoveredSTTModel, policy: RouterSTTPolicy): RouterSTTSelection` and `routerSTTConsentSignature(selection: RouterSTTSelection): string` from `stt-selection.ts`. Export `observeRouterSTTRoute(route: ModelRegistryRoute, model: DiscoveredSTTModel): RegistryObservation` from `model-registry.ts`. Keep existing `createSTTBatch`, `validateSTTBatch`, queue and `STTConsent` entry points; bind their tokens to this snapshot without weakening existing project/action tokens.

Extend `AppController` with `routerSTTSelection?: RouterSTTSelection | null`, `onRouterSTTPreference?: (connectionId: string, preference: RouterSTTPreference) => Promise<void>`, and `onApplyRouterSTTRecommendation?: (connectionId: string) => Promise<void>`. The latter validates a new empty setup, explicit acknowledgment and eligible enabled route before a one-time default save. UI uses existing model-enable/default and initial/retry/rerun callbacks for all other actions.

- [ ] Write failing `OR_STT_only` orchestration cases: an OR-only encrypted connection reaches the OR adapter without requesting an OpenAI key; legacy OpenAI batch remains valid; new OR batch requires exact `provider: openrouter`, `stage: stt`, `endpointTag: null` and matching snapshot. Assert changed chunks/ranges/rates/policy/route/languages invalidate consent before POST.
- [ ] Add `OR_STT_boundary` cases: completed chunk/checkpoint survives lock/reload; aborted late response cannot append raw results; checkpoint failure and lost ownership each keep fetch count at 1 and prevent the next chunk. Original retry snapshot is retained, extra-charge/outcome-unknown acknowledgment is required, and changed/unavailable profiles block retry rather than switching models. Successful rerun creates a new batch/version and leaves previous raw history intact.
- [ ] Add `OR_STT_registry` cases: discovery/key save leaves userEnabled false and defaults unchanged; old optional-field absence reloads without acknowledgment; new policy preferences round-trip encrypted; invalid policy/connection/snapshot is rejected. Existing explicitly cleared/disabled selections remain unchanged.
- [ ] Run `npm run test:unit -- tests/openrouter-stt-orchestration.spec.tsx tests/model-registry.spec.ts tests/registry-consumer.spec.ts tests/stt-batches.spec.ts tests/vault-model-registry.spec.ts -t 'OR_STT'`; expect the newly named cases to FAIL before changes.
- [ ] Implement registry/profile projection and strict preference normalization. Use existing encrypted registry save/load; do not persist policy or provenance to plaintext storage. Construct fresh snapshots only after required acknowledgment; dispatch exact frozen adapter and key. Preserve raw request provenance by IDs/parameters, without storing base64 bodies or headers.
- [ ] Update batch validation and queue's rate fallback: `undefined` preserves legacy OpenAI default lookup; explicit `null` stays unknown for OR. Existing historical OpenAI validation is preserved. Compare frozen chunk identity/ranges/encoded bytes to current retained records, save completed results before scheduling the next request, and require owner/epoch at every boundary.
- [ ] Add the smallest controller callbacks for Settings policy/acknowledgment and fresh presend disclosure; saving a key performs no STT inference. Reuse the shared paid gate and existing lock/DOM/key cleanup instead of implementing another queue or security framework.
- [ ] Rerun the same `OR_STT` command. Check affected legacy paths with `npm run test:unit -- tests/stt-batches.spec.ts tests/registry-consumer.spec.ts tests/vault-model-registry.spec.ts -t 'retries only the chosen failed batch member|rejects a changed|requires exact runtime route metadata|disabling never silently selects|loads legacy absence|quota transaction failure'`; expect PASS. Record selected case names/counts, not a full-suite claim. Run `npx tsc -p tsconfig.app.json --noEmit --incremental false` and `npx tsc -p tsconfig.tests.json --noEmit --incremental false`; expect exit 0.
- [ ] Commit an explicit changed-path list, message `feat: integrate consent-bound OpenRouter STT batches`; report SHA, checkpoint/failure evidence and unchanged evidence reused.

### Task 4: Settings, presend UI and scoped release

**Files:** Create `tests/openrouter-stt-ui.spec.tsx`, `tests/e2e/openrouter-stt.spec.ts`; modify `src/react-app/ui/screens/Settings.tsx`, `src/react-app/ui/screens/STT.tsx`, `src/react-app/ui/components/ModelManager.tsx`, `src/react-app/ui/copy.ts` only for affected copy/helpers, and `src/react-app/App.tsx`/`src/react-app/controller.tsx` only for finalized callbacks. Update `docs/14-test-build-evidence.md` and `README.md` in the product worktree; update legacy-root `docs/TODO.md` separately without committing its unrelated notes. Preserve reference originals.

**Interfaces:** UI consumes Task 3 controller actions and frozen snapshot/signature. Settings policy/acknowledgment applies to the exact connection and disclosure version; initial-default application is an explicit user action, once in a new setup. Start/retry/rerun each consumes fresh matching `STTConsent`; rendering or checking Settings alone cannot authorize it.

- [ ] Write failing `OR_STT_UI` tests: both acknowledgment boxes initially unchecked; policy/model/source changes invalidate fresh consent; missing OpenAI key is irrelevant to OR-only selection; unknown profile is disabled. Default suggestion remains inactive until explicit enable/default action; saved/cleared/disabled prior choices remain untouched. Free request with no verified candidate leaves no free selection and shows absence, without paid replacement.
- [ ] Assert KO/EN presend contains browser → OpenRouter → dynamically selected processor, exact model/policy, chunk count/measured bytes, applied hint/autodetection, and available/unknown price. Explain separately: saved data/keys stay encrypted in this browser; STT sends audio; Minutes sends the selected transcript and writing instructions. Retention/training depends on provider policies/settings; no MoM storage is not no external transmission. Included context remains future explicit scope. Provider identity and total cost may be unknown; exported text is plaintext. Do not add a global build banner or a broad catalog-first UI.
- [ ] Run `npm run test:unit -- tests/openrouter-stt-ui.spec.tsx -t 'OR_STT_UI'`; expect targeted failures before screen wiring.
- [ ] Implement the existing Settings/STT/ModelManager surfaces and callbacks. Seed Mini recommendation from dated weekly-token evidence, using fresh compatible catalog metadata for eligibility/prices; retain Whisper alternative. Make standard-retention selection explicit; no automatic ZDR relaxation or unsupported speaker/timestamp controls.
- [ ] Rerun that focused command; expect PASS. Write a separate synthetic headed-browser fixture covering OR-only setup → unchecked consent → prepared chunk → raw result/version → encrypted reload, plus policy-change and lock/checkpoint failure states. Exercise KO 1440 and EN 360 within the changed flow; record actual viewports, keyboard labels/focus and overflow. Block all nonfixture authenticated/provider POSTs and use a separate temporary profile.
- [ ] Run affected-path ESLint, both type commands and `git diff --check`; expect exit 0. Run `npm run build` once for the changed runtime bundle, then `npm run test:secret` for its actual shipped artifacts. Record warnings and exact artifact hashes; reused unchanged codec/media assets do not need new functional suites.
- [ ] Run `npm run test:e2e -- tests/e2e/openrouter-stt.spec.ts` against the built local app; expect changed-flow fixtures PASS with zero unexpected network calls. Have the existing independent reviewer inspect the final diff, safety cases and receipts; resolve actual findings and rerun only invalidated cases. Commit explicit UI/test/doc paths, message `feat: expose OpenRouter STT with managed-provider disclosure`.
- [ ] Provide parent the final scope, full commit SHAs, targeted counts, types/build/artifact/browser evidence and live-inference limits for the existing release gate. No unfinished feature push or deadline-based gate waiver.
- [ ] After the parent gate, safely integrate verified feature commits into canonical `mom-models`; preserve user edits and non-force push coherent main. Recheck only integration-invalidated evidence. Verify exact remote SHA, terminal CI/Cloudflare version and changed served JS/HTML hashes/MIME.
- [ ] Run one proportional hosted smoke of this changed fixture flow in a separate visible test browser, including OR-only consent/result/reload and one boundary failure; reuse local contract tests, do not replay a whole browser inventory. Confirm no authenticated POST escaped fixtures; collect screenshots and close the test browser.
- [ ] Report deployed URL/SHA, actual focused commands/counts, policy behavior and known limits. Authenticated native CORS, actual provider routing/retention acceptance, speech quality, actual usage/charges and all-format support remain unverified until the user's controlled first request.

## Completion and review handoff

Planning completion means this file and its spec/default addendum are saved, reread, linked and checked for preserved reference hashes; it does not mean STT works. Plan review precedes product edits under `superpowers:writing-plans`. Execution retains the selected method; no new model/execution-choice loop.

Release completion requires the coherent OR-only feature, affected cancellation/storage/ownership tests, scoped UI/build/artifact evidence, existing independent review, parent gate, exact pushed/deployed SHA and changed-flow hosted smoke. Provider errors must remain visible and retriable only under the frozen consent rules; no real-inference pass can be claimed from fixtures.

Context/glossary, reusable prompt management, waveform/normalization, app licensing/publication, password policy and real credential use are subsequent separate scopes. Denoise is excluded. None is a blocker that broadens this STT implementation.
