# OpenRouter STT local evidence — 2026-10-03

This records the local OpenRouter STT increment on `feat/mom-openrouter-stt`, based on frozen core commit `ff10370fe6d47bcd3255c28f8d4a897e25566874`. It is not a deployment, live-inference or full-suite qualification. The parent owns combined independent review and release. The local task report and receipts live in ignored `.superpowers/sdd/openrouter-stt/` and are not distributed product assets.

## Implemented behavior

- Settings separates encrypted browser saving from prepared-audio transmission and selected-transcript/Minutes-instruction transmission. It explains dynamic OpenRouter processing, service retention/training, unknown processor/total cost and plaintext copies/downloads.
- Fresh vaults have no automatically enabled models/defaults. Real public discovery projects the dated Mini recommendation; route enablement, saved policy acknowledgment, exact displayed-ID initial-default application and fresh request consent are separate actions. Stored registries/defaults, disabled entries and explicitly cleared defaults survive unlock/refresh. Registry-absent older vaults retain the prior Direct OpenAI migration seed.
- Mini (`openai/gpt-4o-mini-transcribe`) and Whisper (`openai/whisper-large-v3`) are the implemented documented profiles; unsupported entries remain blocked. The default shortlist preserves saved choices and prioritizes the two supported OpenRouter profiles. No verified free candidate is offered and no paid replacement is selected for a free-only request.
- The default policy denies data collection and requires ZDR. Standard retention needs an explicit policy choice and acknowledgment. Presend shows the actual model/policy, measured encoded bytes, chosen chunk scope, applied hint/autodetection, conditional advertised rates and unknown total. Every start/retry/rerun uses a fresh matching core token; retry/rerun also acknowledges possible additional charges. An absent OpenAI key does not block an OR-only request.
- Saved raw and usage provenance names the saved batch API route. Downstream execution identity remains derived only from response metadata. Existing cost aggregation and USD/credits separation remain unchanged.

See the [product workflow](../README.md), [new UI cases](../tests/openrouter-stt-ui.spec.tsx), [new native fixture flow](../tests/e2e/openrouter-stt.spec.ts), and [initialization cases](../tests/openrouter-stt-orchestration.spec.tsx).

## Scoped test evidence

| Exact command | Result and scope |
| --- | --- |
| `npm run test:unit -- tests/openrouter-stt-ui.spec.tsx -t 'OR_STT_UI'` | Initial RED: 14 failed, 3 passed. GREEN before the two provenance extensions: 17 passed. Those unaffected assertions were reused. |
| `npm run test:unit -- tests/openrouter-stt-ui.spec.tsx -t 'labels saved raw provenance'` | RED: 1 failed / 17 skipped; GREEN: 1 passed / 17 skipped. |
| `npm run test:unit -- tests/openrouter-stt-orchestration.spec.tsx tests/openrouter-stt-ui.spec.tsx -t 'OR_STT_new_setup\|projects the recorded OR requested route'` | RED: 2 failed / 1 passed / 75 skipped. GREEN: 3 passed / 75 skipped (two core initialization cases, one usage UI case). The `\|` in this table is Markdown escaping; the shell argument uses a literal `|`. |
| `npm run test:unit -- tests/stt-rerun-ui.spec.tsx tests/model-manager-ui.spec.tsx -t 'saved-chunk rerun\|original frozen retry\|invalidates rerun acknowledgment\|initial runtime confirmation\|frozen retry submission\|bounds 1005\|STT/minutes separate\|blocks new minutes\|accepts changed metadata'` | 3 passed / 6 failed / 22 skipped initially. Five rerun UI fixtures also fail identically on the archived baseline (see below). The changed shortlist expectation was corrected narrowly. |
| `npm run test:unit -- tests/model-manager-ui.spec.tsx -t 'blocks new minutes without an actual endpoint and OpenRouter audio chat as STT'` | 1 passed / 24 skipped after adding explicit full-list/shortlist steps to inspect the intentionally hidden unsupported row. The unchanged Minutes assertions remain. |
| `npm run test:unit -- tests/usage.spec.ts -t 'uses saved request/response provenance\|keeps sparse legacy\|contradictory STT intent/result'` | 3 passed / 18 skipped. |
| `npm run test:e2e -- tests/e2e/openrouter-stt.spec.ts` | Final frozen-bundle run: 3 passed in 9.3 seconds, no retries. |

These runs cover **28 distinct passing selected unit/UI cases** (19 new UI, two new core, four existing ModelManager and three existing usage cases), plus **five unchanged baseline-failing rerun UI fixtures** and **three distinct passing headed cases**. Filtered cases are not passing evidence. No full suite was run.

Five unchanged names fail on both the feature and exact archived `ff10370fe6d47bcd3255c28f8d4a897e25566874` baseline because their screen fixtures omit retained-audio availability; dispatch remains disabled:

1. `offers a saved-chunk rerun only after a fresh explicit additional-charge confirmation`
2. `displays the original frozen retry model/languages when current settings changed, and does not call a failed rerun complete`
3. `invalidates rerun acknowledgment when metadata or selected parent changes and Cancel dispatches nothing`
4. `binds the initial runtime confirmation to its untouched chunk scope and never reuses it for a retry`
5. `keeps frozen retry submission blocked when the required provider key is absent`

The separate Task 3 baseline limit also remains: `production controller keyless vertical slice > fences a dispatched STT response on lock and retains unknown intent without automatic replay` expects `ambiguous-attempt` but receives `invalid-input`. The earlier Task 3 receipt is historical: although that test file was unchanged, final Task 4 creating-empty-registry initialization invalidated its seeded `opened()` dependency, so its held POST is no longer reachable with that setup. The old saved-default receipt is likewise dependency-invalidated; the old before-preparation rejection stops earlier on empty selection and does not isolate the preparation guard. None qualifies final-code Direct OpenAI behavior. The scoped review-fix replacements below configure real synthetic discovery, explicit enablement/default and retained preparation before execution.

## Build, types and artifacts

Environment: Node **26.5.0**, npm **12.0.1**, Google Chrome **154.0.8037.97**. Final affected ESLint exited 0 with zero errors and the existing App Fast Refresh warning. Test type checks exited 0:

```sh
npx tsc -p tsconfig.tests.json --noEmit --incremental false
npx tsc -p tsconfig.e2e.json --noEmit
npx eslint src/react-app/App.tsx src/react-app/controller.tsx src/react-app/usage/statement.ts src/react-app/ui/screens/Settings.tsx src/react-app/ui/screens/STT.tsx src/react-app/ui/screens/Review.tsx src/react-app/ui/components/ModelManager.tsx tests/openrouter-stt-ui.spec.tsx tests/openrouter-stt-orchestration.spec.tsx tests/model-manager-ui.spec.tsx tests/e2e/openrouter-stt.spec.ts tests/e2e/model-settings.spec.ts
npm run build
npm run test:secret
git diff --check
```

The final `npm run build` exited 0 and includes app type validation. No duplicate standalone final app type pass was run. Existing Worker static/dynamic-import and large-JS-chunk warnings remain. `npm run test:secret` passed against the actual final client distribution. All **78 artifact hashes** are recorded in `task-4-artifact-hashes.json`.

| Final artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `dist/client/index.html` | 580 | `fb180fa51d679b9a5e03cb3b4504fabf468d28e730fd872128fd3ad4f83b60c5` |
| `dist/client/assets/index-_EdIl5e5.js` | 1,032,561 | `56194dc6d9fabc5ed8389fa18dc0b398bd9155e6f95d56fd955af7c5b6dd317a` |
| `dist/client/assets/index-BL8ZAwvr.css` | 31,150 | `1b2ba5e7e9c5a948ac327964ddc711449fc638693818f532e9ad5aafafc12df6` |

Two earlier builds were invalidated by the narrowly authorized raw-route and initialization/usage-route runtime fixes. Their receipts remain separate; only the final hashes above qualify the final browser run. Unchanged media/codec/crypto/playback evidence was reused. No dependencies were installed, and no product reference was edited; the six original reference hashes remain unchanged.

## Actual native states and transmission guard

Separate temporary visible sandboxed Chrome contexts rendered Korean **1440×900** and English **360×800** Settings, ZDR presend, saved raw result and encrypted reload. Korean **1440×900** additionally rendered the lock save-failure gate and retained-result state after a late rerun. Ten screenshots and per-state viewport/overflow/focus receipts are saved under `task-4-browser/`. Desktop `main` scroll/client widths were 1204/1204; phone document/main widths were 360/360. The restricted lock gate had no `main`. Checkbox labels, Space activation, Tab to Transcribe and visible focus were verified. The screenshots were inspected for layout, typography, palette, copy, navigation and the rendered changed states; this is not a complete browser/accessibility matrix.

The final run made **four intercepted synthetic STT POSTs** and **six intercepted keyless catalog GETs**, with **zero unexpected network requests**, **zero page errors** and no OpenAI request. Generated one-second tone/WAV input produced an actual **4,320-byte MP3**; request bodies measured **5,917 bytes** for explicit standard retention and **5,916 bytes** for ZDR. No body/audio/key value is recorded in receipts. All external/provider requests and non-GET off-flow requests are blocked unless they match the fixture; the only accepted fake Authorization value is the declared test sentinel. No real credentials, user profile/vault, microphone or user recording was used.

Raw response/version selection survived lock/reload without a new POST. Encrypted native IndexedDB inspection found no saved-key, transcript or source-filename sentinel in stored plaintext across **48 records** in each successful new-vault context. Actual checkpoint transactions were aborted to produce save failure; completed work was then saved through explicit lock recovery without a repeated POST. A later held rerun response was released after lock and was discarded, retaining the selected version and raw history.

Authenticated inference, production-origin native CORS, actual OpenRouter routing/ZDR acceptance/provider retention, speech/overlap quality, actual usage/charges and all-format support remain unverified. These fixtures do not prove zero retention or actual provider charges. Root still owns independent review, main integration/push, deployment and a proportional hosted smoke; none occurred in this task.


## Scoped review fix evidence

The single review fix wave addresses managed-route copy when current discovery facts are unavailable, separate OpenRouter collection/processor-retention policy links, original-batch retry after a meeting language edit, and the dependency-invalidated Direct OpenAI receipts. README now distinguishes Minutes endpoint pinning from dynamic STT routing and STT reported USD from Minutes credits. No transport, crypto, store, session, dependency or reference was changed.

| Exact command | Result and scope |
| --- | --- |
| `npx vitest run tests/openrouter-stt-ui.spec.tsx tests/openrouter-stt-orchestration.spec.tsx -t 'OR_STT_review'` | RED: 5 failed / 1 passed / 77 skipped. KO/EN blocked-route and policy-link assertions fail, and fresh original retry after actual language action rejects. The changed-language frozen dialog already passes. |
| `npx vitest run tests/openrouter-stt-ui.spec.tsx tests/openrouter-stt-orchestration.spec.tsx -t 'OR_STT_review\|a changed (unavailable\|price\|modality) profile blocks retry\|policy changes invalidate fresh consent\|rejects a changed (languages\|policy\|rate\|profile) snapshot\|rejects persisted (positive-rate\|raw-pricing\|fingerprint\|billing-basis) tampering'` | GREEN: 18 passed / 65 skipped. Includes fresh project/action consent, frozen original language/hint/rates, two distinct attempt records in one batch, no automatic request, and affected policy/profile/rate/snapshot guards. |
| `npx vitest run tests/controller.spec.tsx -t 'E1_review explicit Direct OpenAI new setup'` | 2 passed / 117 skipped. Two ADD-only replacements use a synthetic authenticated model-list fixture plus explicit route enable/default. Prospective default selection and saved-disabled blocking pass; real local prepared/retained chunk dispatches one held fixture POST, lock discards its late raw response and preserves unknown intent, and fresh initial replay rejects `invalid-input` with final POST count one. No old unreachable held-POST case was run. |

This wave has 20 distinct selected passing unit/UI cases; it does not relabel historical baseline failures or filtered cases as passes. Earlier Task 4 runtime bundles and affected Settings/blocked-route captures are invalidated by these changes. Prior evidence remains under its original names; fresh receipts use the `review-fix` prefix. Unchanged adapter/media/crypto evidence is reused. The five retained-audio screen fixture failures remain failed and unchanged.


Final scoped checks: `npx tsc -p tsconfig.tests.json --noEmit --incremental false`, `npx tsc -p tsconfig.e2e.json --noEmit`, affected-file ESLint, `npm run build`, `npm run test:secret` and `git diff --check` pass. An initial test-type/build attempt stopped at TS2367 because the corrected OR-only branch made the old generic branch's OR comparison unreachable. Removing that dead comparison restored type checking; the build then passed, and only the affected blocked-route UI cases were rerun (2 passed / 21 skipped). The failed attempt generated no qualifying bundle. The successful final build includes app types, with only the existing Worker import/large-chunk warnings. Affected ESLint has zero errors or warnings.

Fresh final artifacts: `dist/client/index.html` is 580 bytes, SHA-256 `00d985d742cc3efa367b88748417a3220b57902bd8b2214893969ba551512e91`; `dist/client/assets/index-Bu7apA_F.js` is 1,033,572 bytes, SHA-256 `5ea02db8dcc2e27a10563641461659a19c52ae73cf8e2c8e8cd02a23092e8bef`; unchanged CSS `index-BL8ZAwvr.css` is 31,150 bytes, SHA-256 `1b2ba5e7e9c5a948ac327964ddc711449fc638693818f532e9ad5aafafc12df6`. All 78 artifact hashes are in `review-fix-artifact-hashes.json`; six original design-reference hashes still match.

`npm run test:e2e -- tests/e2e/openrouter-stt.spec.ts` passed 3/3 in 9.2 seconds against those bytes with no retries. These are three directly affected cases: Korean desktop policy anchors, English narrow-screen policy anchors, and Korean post-lock/pre-refresh managed-routing copy when current facts are unavailable. The existing step sequences were reused, with new exact-link and blocked-copy assertions; this was not an unrelated browser matrix. Ten new captures and viewport/focus receipts are under `review-fix-browser/`; visual inspection of the two Settings captures and the unavailable-facts capture confirms readable links, truthful routing, wrapping, palette, typography and navigation. Korean main widths remain 1204/1204 at 1440×900; English document/main widths remain 360/360 at 360×800. Unavailable-facts initial dispatch stays disabled.

The new guarded browser run intercepted four synthetic STT POSTs and six keyless catalog GETs, zero unexpected requests and zero page errors. Each successful vault still had 48 encrypted records with no inspected plaintext sentinel. No real credential, user vault/profile, microphone, recording, authenticated provider network call, paid inference, push or deployment was used. Existing unverified live-inference, retention, CORS, charges, speech-quality and broader release gates remain unchanged. Root owns the existing reviewer's scoped re-review and release decision.

## 2026-10-14 공통 삭제 확인 입력

사용자 결정에 따라 보관함 전체 삭제 확인 입력을 언어 공통 `delete`로 바꾸고 대소문자를 무시한다. 화면과 삭제 계획 검증을 함께 수정했다. 최종 버튼 클릭, 취소, 오입력 거부, 소유권 및 원자적 삭제 실패 처리는 유지한다.

변경 파일: `src/react-app/ui/screens/Settings.tsx`, `src/react-app/vault/storage-management.ts`, `tests/vault-reset-ui.spec.tsx`, `tests/storage-management.spec.ts`, `tests/e2e/vault-reset.spec.ts`, `docs/09-decisions-and-roadmap.md`, `docs/14-test-build-evidence.md`.

| 실제 명령 | 결과·범위 |
| --- | --- |
| `npm run test:unit -- tests/vault-reset-ui.spec.tsx tests/storage-management.spec.ts -t 'explicit passwordless reset UI\|case-insensitive typed vault reset'` | 수정 전 11 실패·3 통과, 수정 후 14 통과·24 필터 제외. 한국어/영어 × `delete`/`DELETE`/`DeLeTe`, 최종 클릭, 오입력·옛 문구·앞뒤 공백 거부, 취소, 실제 합성 보관함 삭제 및 별도 DB 보존. |
| `npx eslint src/react-app/ui/screens/Settings.tsx src/react-app/vault/storage-management.ts tests/vault-reset-ui.spec.tsx tests/storage-management.spec.ts tests/e2e/vault-reset.spec.ts` | 오류·경고 0. |
| `npx tsc -p tsconfig.tests.json --noEmit --incremental false` 및 `npx tsc -p tsconfig.e2e.json --noEmit` | 모두 exit 0. |
| `npm run build` | exit 0. 기존 media worker 정적/동적 import 및 큰 번들 경고는 남는다. |
| `npm run test:e2e -- tests/e2e/vault-reset.spec.ts` | 별도 임시 프로필의 headed Chrome에서 4/4 통과, 10.5초. 실제 IndexedDB 삭제·새로고침, 취소 보존, 다중 탭 소유권 거부/재시도, 원자적 삭제 중단 후 데이터 보존/명시적 재시도. |
| `git diff --check` | 통과. 수정 문서를 다시 읽고 로컬 문서 링크 및 원본 레퍼런스 6개 SHA-256의 불변을 확인했다. |

한국어 1440×900 잠금 화면의 `DeLeTe` 입력/활성 버튼과 영어 360×800 설정의 `DELETE` 입력/활성 버튼 캡처를 직접 시각 확인했다. 새 문구와 입력·버튼이 읽을 수 있게 배치되며 가로 넘침 검사를 통과했다. 캡처·측정은 `.superpowers/sdd/model-details/task-vault-reset-native/captures/1440-ko-delete-enabled.*` 및 `360-en-settings-reconfirmed-enabled.*`에 있다. 원본 standalone 잠금 화면도 별도 headed Chrome 1440×900에서 읽기 전용으로 렌더링했다. 첫 원본 화면 Chrome 실행은 샌드박스 권한 오류로 시작되지 않았고 허용된 실행 권한으로 재시도해 확인했다.

실제 사용자 데이터·키·유료 AI 호출은 사용하지 않았다. 전수 테스트, 다른 기능·브라우저, 원격 푸시 및 배포는 수행하지 않았다. 운영 반영과 기존 AI·품질 검증 한계는 이번 로컬 결과에 포함되지 않는다.

검증 후 로컬 커밋을 요청했으나 자동 승인 검토가 `AGENTS.md`의 현재 단계 커밋 금지 및 이를 명시적으로 해제한 승인 부재를 이유로 거부했다. stage/commit은 실행되지 않았으며 HEAD `b126c58`에서 위 7개 파일을 미커밋 상태로 보존했다.

## 2026-10-15 통합·푸시 요청

사용자가 기존 작업의 정리·브랜치 통합·커밋·푸시를 명시적으로 승인했다. 위 삭제 확인 변경은 `9a32b1c`에 보존하고 STT/LLM 등록을 `22f1819`에서 병합했다. 통합 후 삭제 확인 관련 14개, 등록 UI/controller 7개, 두 기능의 headed Chrome 6개와 타입·빌드·secret 검사를 통과했다. 이전 미푸시 모델 선택·출력 예산의 관련 159개와 브라우저 8개도 확인했으며, 옛 공개 조회 횟수를 기대하던 3개는 정확한 새 조회 순서로 고친 뒤 통과했다. [통합·출시 기록](superpowers/plans/2026-10-15-model-registration-verification.md)에 명령·실패·수정·CSP 승인 대기 상태를 구분한다.

사용자가 CSP를 모든 HTTPS 및 HTTP localhost·127.0.0.1로 확장하고 검증 후 main에 푸시하도록 명시 승인했다. 승인 후 등록·전송/UI 관련 27개, 실제 CSP가 적용된 headed Chrome 3개, E2E 타입·제품 빌드·secret 검사가 통과했다. HTTP `[::1]`는 localhost 사용을 안내하고 secret 조회 전에 호출을 차단한다. [최종 기록](superpowers/plans/2026-10-15-model-registration-verification.md)의 승인 후 결과와 앞선 승인 대기를 구분한다.

## 2026-10-15 eight-character passphrase minimum

The user explicitly lowered the minimum from 16 to 8 characters for usability. Changed files: `src/react-app/App.tsx`, `src/react-app/vault/crypto.ts`, `tests/ui.spec.tsx`, `tests/vault.spec.ts`, `tests/e2e/autofill.spec.ts`, new `tests/e2e/passphrase.spec.ts`, `README.md`, `06-privacy-and-local-storage.md`, this record and the screenshot below. Numeric-only rejection, maximum length, encryption/KDF and existing data remain unchanged.

| Actual command | Result |
| --- | --- |
| `npm run test:unit -- tests/vault.spec.ts tests/ui.spec.tsx -t 'native vault cryptography\|retains old passphrase\|eight-character minimum\|requires a strong new passphrase\|keeps saved-password autofill'` | RED: 5 FAIL, 3 PASS; GREEN: 8 PASS, 104 outside-scope cases filtered. Includes 7/8 Unicode codepoint boundary, numeric-only rejection, existing long secrets, 8-character encryption and atomic passphrase-change failure handling |
| `npx tsc -p tsconfig.e2e.json --noEmit` | PASS, repeated after the final E2E-only edit |
| `npm run build` | PASS, client `index-Bi4WZkGU.js`; existing bundle size and import warnings remain |
| `npm run test:e2e -- tests/e2e/passphrase.spec.ts tests/e2e/autofill.spec.ts` | Passphrase creation/mismatch/wrong-secret/lock/reload/unlock: 1 PASS. Existing autofill case failed because its clear button is now inside collapsed Additional information |
| `npm run test:e2e -- tests/e2e/autofill.spec.ts` | 1 PASS after updating the test to open that section through a normal user action. No product code changed; reuse the preceding passphrase PASS |
| `npm run test:secret` | PASS |
| `git diff --check` | PASS |

Rendered in a separate headed Chrome window at 1440x900: Korean creation, home, locked, reload and unlock states. [Eight-character creation screenshot](superpowers/evidence/2026-10-15-passphrase/1440-ko-create.png) was visually inspected. All six design-reference originals match the baseline Git blobs. Tests used disposable synthetic passphrases and made no external requests. Full suite, actual user vaults and native OS password-manager UI were not checked. Short or predictable secrets remain easier to guess even when they meet the minimum.

Post-push production receipts are stored locally in `.superpowers/release-passphrase-2026-10-15/`.
