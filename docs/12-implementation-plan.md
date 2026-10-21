# MoM Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkboxes for tracking. Implementation starts only after the user reviews this saved plan.

**Goal:** Build a usable desktop-browser meeting workflow matching the supplied reference, with real local audio preparation, direct provider inference, encrypted persistence, review, editing and Markdown output.

**Architecture:** React/Vite/TypeScript runs in the browser; Cloudflare serves static assets. A bounded media Worker prepares audio, provider adapters call OpenAI/OpenRouter directly, and an encrypted IndexedDB vault stores sensitive records. A coordinator owns job cancellation, checkpoints and lock transitions.

**Tech Stack:** React, Vite, TypeScript, Web Crypto, IndexedDB, Web Workers; Vitest/Testing Library and Playwright for meaningful verification. Adopt the reconciled template's package manager and compatible versions; install nothing during planning.

**Spec:** [AGENTS.md](../AGENTS.md), [requirements](01-product-requirements.md), [architecture](02-architecture-and-data.md), [audio](03-audio-pipeline.md), [transcript/minutes](04-transcript-and-minutes.md), [providers](05-providers-and-comparison.md), [privacy](06-privacy-and-local-storage.md), [release gates](08-verification-and-release-gates.md), [decisions](09-decisions-and-roadmap.md), [reference review](11-design-reference-review.md), [primary HTML](<design-reference/Minutes of Meeting (standalone).html>).

**Status:** Plan for review, 2026-09-30; no product implementation, dependency installation, commit, push or deployment performed by this planning task. The review document is a companion, not a prerequisite for saving this plan.

## 2026-10-17 입력 탭·녹음 상태 후속 구현

사용자가 [후속 설계](11-design-reference-review.md#2026-10-17-입력-탭과-녹음-상태-표시-구현)와 실제 구현·관련 검증을 승인했다. **이 절이 아래 초기 재배치의 카드 순서를 대체하며, 이전 전체 구축 계획을 재실행하지 않는다.**

- [x] `Import.tsx`에서 녹음·업로드 탭을 위로 묶고 공통 원본 확인·미리듣기·청크/압축·전사 준비를 아래로 이동한다. 기존 이벤트·저장값·교체 제한과 키보드 탭 조작을 유지한다.
- [x] `recording/recorder.ts`에서 기존 검증된 PCM 패킷의 RMS를 계산한다. 새 오디오 그래프·타이머·저장 형식 없이 일시적 `inputLevel`을 추가하고 비녹음 상태에서는 0으로 정리한다. `controller.tsx`의 초기 스냅샷과 직접 테스트 데이터를 맞춘다.
- [x] `RecordingControls.tsx`에서 입력 음량, 샘플 시계의 `시:분:초`, 기존 1024² 기준 MB 소수점 두 자리를 표시한다. 저장 완료 시 확정 원본 크기를 사용하고 저장 확인량을 구분한다. CSS는 기존 팔레트·글꼴을 유지한다.
- [x] 먼저 음량/탭 관련 실패를 확인한 뒤 녹음 코어·녹음 UI·가져오기와 관련 잠금/늦은 응답 경계만 검사한다. 이름이 바뀐 E2E 호출자는 갱신·타입 검사하며 해당 전체 시나리오를 반복하지 않는다.
- [x] 별도 로컬 Chrome에서 데스크톱 합성 녹음→일시정지→저장→전사 준비와 360px 영어 업로드→탭 전환→전사 준비만 확인한다. 실제 사용자 파일·키·물리 마이크·제공사 추론을 사용하지 않는다.
- [x] 변경 파일 린트·빌드·E2E 타입과 공개 산출물, 문서 링크·레퍼런스 원본을 확인하고 [명령·결과·캡처·한계](superpowers/evidence/2026-10-17-recording-input/README.md)를 남긴다. 기존 `App.tsx` 사용자 문구 수정은 보존하며 로컬 변경만 커밋한다.

## 2026-10-17 음성 준비 화면 재배치 구현 계획

**상태:** [재배치 디자인](11-design-reference-review.md#2026-10-17-음성-준비-화면-재배치-승인) 승인 후 사용자가 구현·관련 테스트·실제 브라우저 확인을 직접 요청했다. 기존 구현을 재사용해 로컬 구현·검증을 완료했으며 [검증 기록](superpowers/evidence/2026-10-17-preparation-layout/README.md)에 실제 결과를 남긴다. 이 절은 이번 화면 변경에 적용하며 아래 2026-09-30 전체 제품 구축 계획을 다시 실행하지 않는다.

**기준:** HEAD `4327b5c8f8fe410a84d2230393a0485a9e6a6f7a`, 로컬 기록 `origin/main`은 `93830997ffa4f8979a3cfa06d7bb523d2866f42a`. 원격을 새로 조회하지 않았다. 기존 `src/react-app/App.tsx`의 미커밋 문구 수정은 사용자 변경으로 보존한다.

**적용 파일과 역할:**

- `src/react-app/ui/screens/Import.tsx`: 메모 정보/음성 작업 두 열, 오른쪽 카드 순서, 행동별 설명, 준비 상태에 따른 버튼 강조. `Import({ controller: c, project: p }: ProjectScreenProps)`와 기존 이벤트·활성 조건을 재사용한다.
- `src/react-app/ui/styles.css`: `.import-grid`를 약 40:60으로 조정하고 카드·요약·버튼의 간격과 제목을 통일한다. 기존 960px 이하 단일 열 규칙에서 메모 정보 → 음성 작업의 읽기·키보드 순서가 일치해야 한다.
- `src/react-app/ui/RecordingControls.tsx`: 기존 녹음 상태·조작을 재사용한다. 중복 공통 설명만 정리하며 시작 시 권한 요청 안내, 저장 완료 판정, 중단·오류·재시작 제한을 유지한다.
- `tests/ui.spec.tsx`, `tests/recording-ui.spec.tsx`: 직접 바뀌는 화면 조건·문구·상호작용을 검증한다. 기존 `import configuration`과 녹음 UI 테스트를 확장한다.
- `tests/e2e/preparation-layout.spec.ts`: 이번 배치에 한정한 별도 가시적 로컬 브라우저 확인을 추가한다. 기존 합성 음성·격리 보관함 도우미를 재사용한다.
- `tests/e2e/copy-placement.spec.ts`, `tests/e2e/preparation-progress.spec.ts` 등 직접 호출자: 기존 `전사로 →`와 일반 `자세히 보기` 선택자를 검색해 바뀐 이름에 필요한 부분만 갱신한다. 앱·녹음·제공사·보관함의 계약, 의존성, 구성·내보내기 변경은 필요하지 않다.

**변경 중 지킬 조건:** 제목·아이콘·색상·사용 언어의 기존 저장값을 보존한다. 청크·겹침 선택값과 기본값, 코덱·실제 바이트 검사, 암호화 저장·잠금·취소·재생 수명은 변경하지 않는다. 그림의 10분·10초를 새 기본값으로 적용하지 않는다. 자유 입력 힌트·용어집, 새로운 자동 준비·자동 전사, 모델 선택·요금 확인의 이동은 추가하지 않는다. 전사 전 확인·요금 동의는 기존 STT 화면에서 유지한다.

**집중 확인:** 비어 있는 음성, 녹음 중/저장 중, 준비 중/실패/완료, 기존 결과로 인한 교체·설정 잠금, 긴 제목·파일명·복수 언어와 좁은 화면을 다룬다. 저장 실패·중단을 성공으로 표시하지 않고 완료 저장분과 원본 재생 정리를 유지해야 한다.

### 이번 변경의 단일 구현 작업

- [x] `Import.tsx`와 관련 선택자 호출자를 다시 읽고 범위를 확정한다. 음성 준비·전사 이동, 녹음 시작/중단, 파일 선택·교체와 기존 비활성 조건을 목록으로 대조한다.
- [x] `tests/ui.spec.tsx`에 `groups preparation actions before recording and upload without dispatching STT`를 추가한다. `준비·전사 → 녹음 → 업로드`의 화면 영역 순서, 파일 없을 때 준비/전사 비활성, 실제 준비·저장 완료 때 전사 이동 가능, 이동만으로 STT 요청이 발생하지 않음을 확인한다. 제목 저장 중 포커스, 복수/기존 언어값, 전사 결과가 있을 때 처리 설정 잠금은 기존 테스트를 재사용한다.
- [x] 먼저 `npx vitest run tests/ui.spec.tsx -t 'import configuration'`로 새 기대가 기존 배치에서 실패하는지 확인한다.
- [x] 기존 JSX·`PreparationStatus`·`RecordingControls`·파일 입력·재생 요소를 재배치한다. 청크 요약은 항상 표시하고 설정은 기본 접힘으로 유지한다. 버튼은 기존 `canPrepare`/`ready`/`busy` 조건과 `onNavigate('stt', p.id)`를 사용한다.
- [x] 한국어/영어 문구를 함께 정리한다. 공통 처리 설명은 한 번만 표시하고 `언어 안내`·`처리 설정 펼치기`·`지원 형식 보기`처럼 대상을 드러내는 접기 제목을 사용한다. 보존·권한·실패 경고는 관련 행동 옆에 유지한다.
- [x] `npx vitest run tests/ui.spec.tsx -t 'import configuration'`와 `npx vitest run tests/recording-ui.spec.tsx`를 실행해 모두 통과하는지 확인한다. 이름 변경으로 직접 영향받는 E2E 선택자는 `rg`로 검색·수정한다.
- [x] `tests/e2e/preparation-layout.spec.ts`에서 1440×900과 360×800의 한국어/영어 빈 화면·긴 제목·파일 선택·설정 접기/펼치기·준비 후 전사 확인 진입을 확인한다. 960×900 한국어에서는 단일 열 전환을 확인한다. 각 화면에서 1초 합성 WAV의 실제 준비·저장을 확인하고, 준비 취소·용량 실패는 1440 한국어 한 경로에서 확인한다. 외부 AI 호출은 차단하고 실제 STT를 실행하지 않는다.
- [x] `npm run build` 후 `npm run test:e2e -- tests/e2e/preparation-layout.spec.ts`를 실행한다. 문구 접기 선택자가 바뀌면 `npm run test:e2e -- tests/e2e/copy-placement.spec.ts`도 실행한다. 그 밖의 E2E는 직접 바뀐 동작이나 선택자가 있을 때 해당 파일만 선택하며 전체 스위트는 실행하지 않는다.
- [x] 별도 가시적 로컬 Chrome에서 카드 순서·너비·여백·글꼴·강조색, 키보드 이동·접기 조작, 가로 넘침, 권한/저장 실패 표시와 잠금 후 민감 UI 제거를 확인한다. 합성 데이터만 사용하고 실제 키·사용자 녹음을 사용하지 않는다.
- [x] 실제 명령·통과/실패·뷰포트/상태·스크린샷·남은 제한을 검증 기록에 남긴다. 문서 링크와 레퍼런스 6개 해시를 확인한다. 승인된 개발 단계에서 변경 파일만 로컬 커밋하며 `main` 푸시·배포는 별도 출시 범위로 판단한다.

실행 범위 조정: 이름만 바뀐 다른 E2E 3개와 공유 도우미는 타입 검사하고, 동일 전사 이동은 새 화면 E2E에서 검증했다. 전체 시나리오는 재실행하지 않았다. 기존 문구 테스트의 모델 미선택 경로·라이선스 내비게이션·한국어 브랜드 기대를 현재 구현에 맞춰 수정하며 제품의 해당 동작은 바꾸지 않았다. 기존 `App.tsx` 사용자 변경은 보존한다. 실제 실행 명령과 통과 근거·한계는 위 검증 기록이 기준이다.

## Global Constraints

- Latest explicit user decisions override older proposals: encrypted API-key persistence is the default, session-only keys remain available, and lock checkpoints completed work and stops new work.
- Preserve reference originals. Match Home, Import, STT, Review, Minutes and Settings screens, navigation, typography, palette and approved copy; do not repeat settled design discovery.
- No MoM login, application-server meeting storage, AI proxy, telemetry containing meeting data, automatic sharing or browser-security weakening.
- Offer exactly 10/15 **minute** chunks and 10/15 **second** overlap. Actual encoded bytes and supported model/format combinations decide whether an upload is eligible.
- Preserve raw STT responses, source-time mappings, completed results, transcript versions and generated/edited minutes separately. Output-setting changes must reuse the selected transcript without STT.
- Multiple expected input languages are independent of minutes language; the sample language list is not a product restriction. Never invent speakers, owners, deadlines or precise timestamps.
- Encrypt persisted audio, transcripts, minutes, titles, filenames, settings, history and keys. Do not place keys in source, bundles, URLs, logs, exports or clipboard output.
- Fixtures are keyless, explicitly identified and confined to test/demo entry points; production has no canned success, random progress, fixed transcripts or fabricated cost.
- Real credential entry/transmission is a user handoff tomorrow through the app UI, using a limited test key and nonprivate test audio. Never inspect existing secret files or accept keys through chat/Git/VITE variables.
- Meaningful local commits are authorized during development. A push to `main` immediately deploys: only a coherent implemented, tested release may reach it. No planning-stage push/deployment.
- **2026-10-02 user decision:** default verification covers the Git diff and directly affected callers, data flows and UI states, using the smallest relevant checks. Full-repository/full-suite testing requires an explicit user request. Do not broaden a targeted failure into unrelated full testing or repeat existing checks when nothing relevant has changed.

## Review Focus

- Lock races with a paid request, late response or another tab: no new transmission, plaintext UI or falsely saved result (Tasks 1 and 4).
- Real container/codec differences and long recordings: bounded buffers, valid independently decodable chunks and explicit unsupported errors (Task 3).
- Mixed-language overlap containing numbers, names or negation: keep uncertain alternatives and honest timing precision (Task 5).
- Storage quota/interrupted writes and reload: saved results survive, unsaved results remain distinguishable and retries do not duplicate completed inference (Tasks 1 and 4).
- A late reversal of an earlier decision and oversized transcript: preserve final meaning and provenance; never silently truncate or concatenate chunk summaries as final minutes (Task 6).

## Delivery Stages and Scope

| Stage | Deliverable | Exit gate |
| --- | --- | --- |
| A | Reconciled isolated baseline, contracts and reviewed security/copy choices | Task 0 complete; unresolved conflicts block only affected paths |
| B | Reference-shaped UI and real encrypted vault/lock | Tasks 1–2; crypto, storage, DOM and multitab tests pass |
| C | One verified audio path and direct OpenAI STT adapter | Tasks 3–4; keyless pipeline tests pass; authenticated inference still pending user handoff |
| D | Transcript review and real OpenRouter minutes, editor/copy/export | Tasks 5–6; version reuse, grounding fixtures and output tests pass |
| E | Usable local test build for tomorrow and user-led real inference | Task 7 local gates plus user-entered keys; publish only after release gates pass |
| F | Expanded support and optional comparison | Additional verified audio/video formats, long-context generation and G12; separate reviewed increments |

Tomorrow's target is Stage E on a **published, measured support matrix**, initially one desktop Chromium and one verified audio container/codec. It is a target, not a promise of authenticated inference or full format coverage.
Video audio extraction is part of the intended product: add one verified video container/codec path after the first audio path; if not verified tomorrow, disclose it as unavailable instead of accepting it deceptively.
Stretch scope: broader M4A/AAC/Ogg/Opus/WebM/MP4/WAV coverage, Edge/Safari/mobile, automatic speaker continuity, hierarchical long-context generation, encrypted backup/recovery and arbitrary Markdown templates.
Model comparison follows the reference but ships only as a real, explicit additional execution on one frozen transcript/settings snapshot; no fake comparison panel. If deferred, show unavailable status and do not mark G12 passed.

## Ownership, Files and Shared Interfaces

Paths below follow the newer template's documented `src/react-app` layout. Task 0 checks the actual fetched baseline; the parent records any necessary path translation before assigning work.
Parent alone owns shared configuration/contracts, stages explicit files, creates integration commits and approves merges. Each implementer edits only assigned paths; interface changes go through the parent.

| Owner/task | Owned files | Responsibility |
| --- | --- | --- |
| Parent / 0 | `package.json`, existing lockfile, `vite.config.ts`, `tsconfig*.json`, `wrangler.json`, `src/react-app/domain/types.ts`, `src/react-app/domain/jobs.ts`, `docs/13-security-design.md`, `tests/domain.spec.ts` | Baseline, scripts, schemas and reviewed contracts |
| Vault / 1 | `src/react-app/vault/{crypto,store,session}.ts`, `tests/vault.spec.ts`, `tests/lock.spec.ts` | Ciphertext storage, key lifetime, single unlocked owner and lock |
| UI / 2 | `src/react-app/{App,main}.tsx`, `src/react-app/ui/{styles.css,copy.ts}`, `src/react-app/ui/screens/{Home,Import,STT,Review,Minutes,Settings}.tsx`, `tests/ui.spec.tsx` | Reference UI and state-derived controls |
| Media / 3 | `src/react-app/media/{worker,inspect,prepare,mp3}.ts`, `tests/audio.spec.ts`, `tests/fixtures/media/` | Streaming preparation, mapping and byte validation |
| Providers / 4 | `src/react-app/providers/{catalog,openai,openrouter}.ts`, `src/react-app/domain/pipeline.ts`, `tests/providers.spec.ts`, `tests/pipeline.spec.ts` | Capabilities, direct transport and bounded request execution |
| Transcript / 5 | `src/react-app/transcript/{merge,versions}.ts`, `tests/transcript.spec.ts` | Conservative boundary review and immutable edits |
| Minutes / 6 | `src/react-app/minutes/{generate,prompt,output}.ts`, `tests/minutes.spec.ts`, `tests/output.spec.ts` | Grounded generation, revisions and safe Markdown output |
| Parent / 7 | `playwright.config.ts`, `tests/e2e/{flow,lock,recovery}.spec.ts`, `scripts/check-public-artifacts.mjs`, `public/_headers`, `docs/14-test-build-evidence.md` | Integration, security scan, browser evidence and release |

Contracts in `domain/types.ts` use integer milliseconds for source time, UTC timestamps for execution time, opaque IDs, immutable version IDs and no key/auth-header fields:

- `SourceAsset = { id: string; fileName: string; bytes: number; container: string; codec: string; durationMs: number; channels: number; sampleRateHz: number }`; inspection fails explicitly when required facts cannot be established.
- `AudioOptions = { chunkMinutes: 10 | 15; overlapSeconds: 10 | 15; expectedLanguages: string[]; bitrateKbps: number; sampleRateHz: number }`.
- `PreparedChunk = { id: string; sourceId: string; index: number; sourceStartMs: number; sourceEndMs: number; encodedBytes: number; mimeType: string; codec: string; audioRecordId: string }`; display index is `index + 1`.
- `RawTranscript = { id: string; chunkId: string; runId: string; response: unknown; text: string; segments: SourceSegment[]; timing: 'word' | 'segment' | 'chunk'; speakerScope: 'none' | 'chunk' }`.
- `SourceSegment = { id: string; text: string; sourceStartMs: number; sourceEndMs: number; rawIds: string[] }`; chunk-only timing uses the chunk range, never fabricated word times.
- `BoundaryIssue = { id: string; rangeMs: [number, number]; alternatives: SourceSegment[][]; selected: number | null }`.
- `TranscriptVersion = { id: string; parentId: string | null; rawIds: string[]; segments: SourceSegment[]; issues: BoundaryIssue[]; missingRanges: [number, number][] }`.
- `MinutesSettings = { outputLanguage: string; sections: ('summary' | 'topics' | 'decisions' | 'actions' | 'open' | 'refs')[]; instructions: string; modelId: string }`.
- `MinutesRun = { id: string; transcriptVersionId: string; settings: MinutesSettings; generatedMarkdown: string; usage: Usage; requestedModel: string; returnedModel: string | null; actualProvider: string | null }`; `MinutesRevision = { id: string; runId: string; parentId: string | null; markdown: string }`.
- `Usage = { inputTokens: number | null; outputTokens: number | null; elapsedMs: number; cost: number | null; costKind: 'reported' | 'estimated' | 'unavailable'; currency: string | null; rateSource: string | null; rateCheckedAt: string | null }`.
- `RunState = 'queued' | 'requesting' | 'response-received' | 'saving' | 'saved' | 'failed' | 'cancelled' | 'outcome-unknown'`; `saved` requires completed encrypted transaction.
- `JobContext = { signal: AbortSignal; epoch: number; assertActive(): void }`; every asynchronous completion validates its epoch before changing state or starting another request.

## Task 0: Safe Baseline, Contracts and Security Decision Gate

**Interfaces:** Produces the types above and `createJobContext(): JobContext`; subsequent tasks consume them without private duplicates.
- [ ] Record `git status --short`, HEAD and local remote refs; current observed HEAD is `102086a86c59efbe35014ad532e4ce823b26821f`, with untracked docs/AGENTS. Preserve these files and user edits.
- [ ] During authorized development, fetch/read remote history and compare the documented newer `7f60ce8` template with actual remote HEAD. Do not pull/reset/overwrite the current checkout; create an isolated feature worktree from the explicitly selected reconciled commit.
- [ ] Bring approved documentation into that worktree using explicit paths and preserve reference hashes. Parent creates the documentation/baseline commit without staging unrelated untracked files.
- [ ] Record precise prototype conflicts in `docs/13-security-design.md`: fixed `123456`, short-PIN claims, lock-while-continuing copy, key-change copy and export/copy placement. Latest user decisions already resolve key default and stopping work on lock.
- [ ] Propose Web Crypto AES-256-GCM, fresh 96-bit IV per encryption, random data key wrapped by a secret-derived key, authenticated record ID/schema, and ciphertext-only IndexedDB records. Review KDF, exact parameters/secret strength, loss/recovery, rewrap/migration and crash atomicity **before crypto implementation**; prototype labels are not approval.
- [ ] Present concrete security-input/copy changes requiring a user choice before implementing a conflicting screen. Continue contracts/UI/media work unaffected by that gate; no production security claim while unresolved.
- [ ] Write `domain.spec.ts`: settings preserve independent languages; immutable raw/version linkage; `saved` rejected before checkpoint; stale epoch rejects scheduling.
- [ ] Establish `npm run test:unit -- <file>`, `npm run typecheck`, `npm run test:e2e`, `npm run test:secret`, `npm run build` scripts (translate consistently if upstream uses another manager); run the domain test red, then implement contracts/state guards and run green/typecheck.
- [ ] Parent commits only this task's reviewed paths: `chore: establish MoM contracts and reviewed security design`. Gate A: baseline and exact security decisions recorded; no destructive reconciliation.

## Task 1: Ciphertext Vault and Lock State Machine

**Interfaces:** `saveRecord(id: string, value: unknown | Blob): Promise<void>`, `loadRecord<T>(id: string): Promise<T>`, `deleteMeeting(id: string): Promise<void>`, `unlock(secret: string): Promise<void>`, `lock(reason: 'manual' | 'idle' | 'hidden'): Promise<void>`.
- [ ] Write red `vault.spec.ts` cases for round-trip, wrong secret, tampered/truncated ciphertext, fresh IVs, encrypted metadata/key sentinels, quota failure and interrupted transaction; confirm failures before implementation.
- [ ] Implement the reviewed crypto design and transactional checkpoint records. Stream retained audio into bounded encrypted fragments; never use plaintext OPFS/IndexedDB/cache staging. Default retained app copies persist until explicit delete; explain browser eviction and original-file boundaries.
- [ ] Implement keys encrypted by default, session-only alternative, masked UI and no key values in job metadata. Session keys clear on lock and require re-entry after unlock; persisted keys decrypt only while unlocked.
- [ ] Use an exclusive Web Lock for one unlocked vault owner plus BroadcastChannel lock notifications and an epoch check before dispatch. Other tabs show generic locked content; reacquisition requires unlock. Fail closed where required coordination is unsupported.
- [ ] Define lock order: revoke scheduling epoch and hide/unmount sensitive DOM immediately; pause playback/revoke URLs; abort requests and terminate media work; encrypt/checkpoint completed results and pending state; release decrypted state, File/buffer/key references and ownership.
- [ ] Mark aborted in-flight calls `outcome-unknown` if processing/charge cannot be ruled out. Reject late old-epoch responses without rendering/persisting them; never automatically resend after unlock. Cancellation cannot reverse provider charges.
- [ ] On checkpoint failure, remain in a generic `lock-save-failed` state with no sensitive DOM/new work; retain only minimal pending save buffers/key references for retry. Offer retry or explicit discard, and never claim fully locked/saved until those references can be released.
- [ ] Test reload, hidden-tab lock, stale response, missed broadcast/reacquisition, save failure and two-tab ownership; inspect DOM/accessibility and Worker/player teardown. Do not claim JavaScript memory zeroization.
- [ ] Run `npm run test:unit -- tests/vault.spec.ts tests/lock.spec.ts` and typecheck; expected all pass. Parent commits `feat: add encrypted vault and checkpointed lock` after fresh security review. Gate B requires no plaintext persistence or lock race.

## Task 2: Reference UI Connected to Real State

**Interfaces:** Screens consume domain entities and parent-supplied actions; `App` mounts sensitive screens only for an unlocked session. UI never calls providers/storage directly.
- [ ] Write red UI checks for six-screen navigation, meeting create/rename/pin/delete, language multiselect, exact chunk units, section ordering, keyboard focus and locked content absence.
- [ ] Implement reference layout, labels, four-step workflow, Cobalt/Teal/Mono and light/dark settings using the supplied HTML/companions; self-host required assets instead of copying executable prototype scripts.
- [ ] Wire settings tabs for connections/defaults/appearance/security/history, encrypted project list and truthful storage estimate; progress reflects measured preparation or saved chunk counts, with indeterminate inference where no progress exists.
- [ ] Move the existing third-party license and source/rebuild/relink links from both VaultGate and the unlocked sidebar into one Settings location per the confirmed 2026-10-01 placement decision in [reference review](11-design-reference-review.md). The lower "앱 정보 · 라이선스" section and removal of the test-build banner from both locations are copy/layout proposals for acceptance. Trace both shared BuildQualification call sites; preserve deployed notice/license/source/rebuild/relink assets, relative routes, new-tab behavior and keyboard access. Verify the old locations and both links from Settings. Banner removal is not authenticated-AI or release-gate evidence.
- [x] Apply the overriding 2026-10-02 actual-implementation request in [reference review](11-design-reference-review.md): remove the test-build banner at both call sites and display `Minutes of Meeting (MoM)` in VaultGate. Add a working locked-screen forgot-passphrase reset with explicit deletion scope, final confirm/cancel and existing vault ownership/lock boundaries; handle other tabs/open DB/blocked or failed deletion without a false success. The optional onResetVault UI prop alone is insufficient. Verified with synthetic data and deployed as `0c921767305fb93b7a2d5d5f10cdea5d7f41e44d`; relevant hosted browser checks 11 PASS. No user's real vault was deleted during development. This completion covers the bounded reset/branding request, not unrelated full-product release gates.
- [ ] Keep sample states only in a visibly labelled test/demo entry point excluded from the production build. Unsupported/unverified models/formats are disabled with a specific explanation; no unconditional connection success.
- [ ] Add proposed `Markdown 복사` / `Copy Markdown` beside `.md 다운로드` in Minutes, copying the currently selected edited revision; confirm placement/copy through plan/reference review before final visual acceptance.
- [ ] Implement safe reference-aligned empty/error/partial/retry states and transmission disclosure. Apply the confirmed 2026-10-01 empty-state/language-hint copy in [reference review](11-design-reference-review.md); review its proposed omitted row/privacy wording before final copy acceptance. Display the actual selected model's request path and only supported hints included in the request; keep generic upload filenames and the existing transmission boundaries.
- [ ] Run `npm run test:unit -- tests/ui.spec.tsx` and typecheck; render the actual reference and app in a visibly separate local browser test window at 1440×900 and 1280×800. Record exact screens/states viewed; source inspection is not a visual pass.
- [ ] Parent commits `feat: implement reference meeting screens`. Gate: navigation/copy/layout visibly reviewed; no fabricated production data or inaccessible controls.

## Task 3: Bounded Local Audio Preparation

**Interfaces:** `inspectAudio(file: File): Promise<SourceAsset>` and `prepareAudio(file: File, options: AudioOptions, context: JobContext): AsyncIterable<PreparedChunk>`; `SourceAsset` records actual container/codec/duration/bytes, or a typed unsupported error.
- [ ] Write red `audio.spec.ts`: 60min/10min/10sec produces seven ranges; 120min/15min/15sec produces nine; coverage reaches source end, overlaps are exact, and zero-length terminal chunks are absent.
- [ ] Test actual headers/container validity, oversized encoded Blob rejection, cancellation, no audio track, damaged input and unsupported codec; extensions alone never establish support.
- [ ] Start with a verified MP3 streaming path: frame-aware reader, runtime-supported decoder, bounded PCM windows/overlap buffer, one encoder and valid muxed output. Adopt a focused maintained demux/mux dependency only when required; do not default to whole-file `decodeAudioData` or unbounded ffmpeg memory.
- [ ] Bound the media working set to one preparation job, at most 30 seconds of PCM plus overlap and one encoded output awaiting encrypted save; apply backpressure and dispose each result before advancing. Record actual peak memory and duration separately from these algorithmic bounds.
- [ ] Preserve source/encoded offsets and encoder delay measurements. Validate independently decodable output and `Blob.size` below catalog limit with an explicit safety margin; no paid upload before validation/save completes.
- [ ] If configured duration/bitrate cannot fit, return a local actionable error/proposed adjustment rather than silently changing quality or sending the oversized file. Compression capability/rate controls follow the reference only where verified.
- [ ] Add verified video demux/audio extraction incrementally without saving original video externally; unsupported video remains a clear error until its actual container/codec gate passes.
- [ ] Run `npm run test:unit -- tests/audio.spec.ts` and local decode/playback checks on generated outputs; measure a two-hour fixture without memory growth proportional to retained full PCM. Parent commits `feat: prepare validated bounded audio chunks`. G01/G02 remain limited to tested combinations.

## Task 4: Catalog, Direct Adapters and Paid-Request Boundaries

**Interfaces:** `transcribe(chunk: PreparedChunk, modelId: string, languages: string[], context: JobContext): Promise<RawTranscript>`; `completeMinutes(transcript: TranscriptVersion, settings: MinutesSettings, context: JobContext): Promise<MinutesRun>`.
- [ ] Write red provider/pipeline cases for exact request payload, permitted origin, unsupported options, malformed responses, 401/403/429/413/5xx, timeout, abort/late completion, quota failure and retrying only selected unsaved chunks.
- [ ] Catalog records model ID/provider, accepted MIME/codecs/byte limit, timing/speaker capability, supported hints, context/output limits, rate unit/source/check date and nullable routing/usage fields. Verify current official capabilities during implementation; sample names/prices are not validated facts.
- [ ] Implement direct browser OpenAI multipart STT and OpenRouter text requests; obtain keys only from the unlocked vault session. No custom relay, arbitrary endpoint, secret in URL or logging request content.
- [ ] Keep selected multiple languages as context; adapt supported single-language/prompt hints explicitly rather than silently forwarding invalid arrays or dropping other-language speech. Render model-specific timing/speaker limits.
- [ ] Normalize returned relative times exactly once using the chunk's source start and measured encoding offset; `RawTranscript.segments` uses global source milliseconds while `response` preserves untouched provider data.
- [ ] Keep one paid inference request active initially, no automatic paid retry and no model/provider fallback. Explicit retry/re-transcription previews selected scope and possible added cost; respect Retry-After before user-triggered repeat.
- [ ] Connection checks use a verified non-inference endpoint where available; show authentication/transport results separately from successful inference. A read-only model-list success is not a transcription test.
- [ ] After each valid response, encrypt/save raw result/run/checkpoint before `saved`; pause queue on storage failure. Unlock/reload reuses saved results and requires explicit action for ambiguous attempts.
- [ ] Costs show reported/estimated/unavailable separately, include overlap/retries/multiple runs in estimates, and leave missing tokens/cost/provider null. Freeze catalog/rate snapshot per run; expose requested versus returned model/provider.
- [ ] Run `npm run test:unit -- tests/providers.spec.ts tests/pipeline.spec.ts` and typecheck. Parent commits `feat: integrate direct providers with explicit request control`. G03 remains pending actual user-authorized authenticated inference.

## Task 5: Transcript Versions, Boundaries and Playback

**Interfaces:** `mergeTranscripts(raw: RawTranscript[]): TranscriptVersion`, `editTranscript(base: TranscriptVersion, edits: { segmentId: string; text: string }[]): TranscriptVersion`, `resolveBoundary(base: TranscriptVersion, issueId: string, alternative: number): TranscriptVersion`.
- [ ] Write red tests for overlap negation/numbers/names, repeated genuine speech, missing chunks, chunk-only timestamps, independent chunk speaker labels and immutability of raw responses/earlier versions.
- [ ] Consume normalized global source timing without applying the chunk offset again; keep chunk-level ranges when finer timing is absent. Only time/content-confirmed duplicates may consolidate, retaining both raw references; uncertain differences create alternatives for user review.
- [ ] Implement merged/chunk-original tabs, search, source playback, edits and boundary choice. Original tabs read raw data; edits create new versions, never rewrite the provider response.
- [ ] Preserve gaps and incomplete-transcript warning. Partial minutes require explicit acknowledgment and carry missing ranges into generation/output; they cannot be labelled a complete meeting conclusion.
- [ ] Save edited versions encrypted; associate each minutes result with its selected version. Switching settings or browsing old versions never triggers STT.
- [ ] Run `npm run test:unit -- tests/transcript.spec.ts` plus Review screen interaction/playback checks; parent commits `feat: review versioned transcripts and uncertain overlap`. G04 requires later real multilingual speech evaluation.

## Task 6: Grounded Minutes, Revision Editor and Output

**Interfaces:** `generateMinutes(transcript: TranscriptVersion, settings: MinutesSettings, context: JobContext): Promise<MinutesRun>`, `reviseMinutes(run: MinutesRun, markdown: string): MinutesRevision`, `downloadMarkdown(revision: MinutesRevision, title: string): void`, `copyMarkdown(revision: MinutesRevision): Promise<void>`.
- [ ] Write red tests for selected language/ordered sections, later cancelled decision, no invented owner/deadline, missing-range disclosure, prompt-injection text treated as meeting data, input overflow and separate generated/edited revisions.
- [ ] Build a versioned grounding prompt over the selected full transcript and provenance; send only necessary transcript/settings, not keys/other meetings/original filenames. Selected sections are summary/topics/decisions/actions/open/refs per reference.
- [ ] Preflight catalog context/output limits conservatively. If the full transcript does not fit, stop with a clear actionable limit; do not silently truncate or switch models. Hierarchical generation is a later tested feature with additional cost confirmation and final whole-meeting reconciliation.
- [ ] Persist generated Markdown/run and independent edited revisions; regeneration creates a new run and preserves edits. Show stale settings/transcript-version indication using actual input signatures.
- [ ] Render Markdown with raw HTML/script disabled, unsafe links rejected and remote image fetching disabled; preview must not execute transcript content or send meeting-derived URLs elsewhere.
- [ ] Download UTF-8 `.md` and copy the exact selected edited Markdown; sanitize filenames/revoke Blob URLs, handle clipboard denial/download failure, and disclose plaintext leaves vault protection.
- [ ] For optional comparison, freeze identical transcript/settings/prompt, request each selected model explicitly, save each result and real measured duration/available usage; never auto-run or infer missing costs.
- [ ] Run `npm run test:unit -- tests/minutes.spec.ts tests/output.spec.ts` and typecheck; parent commits `feat: generate grounded editable Markdown minutes`. G05/G08 quality claims require user-led inference and manual evidence review.

## Task 7: Integration, Independent Review and Release Gate

**Execution:** Fresh Sol Extra High implementers (host model `gpt-6.1-sol`, effort `xhigh` where available); parent orchestrates/integrates/verifies. Fresh independent reviewers check spec conformance and code/security quality after each task, then the whole branch. Do not silently substitute a different requested model.
- [ ] Run Tasks 0–1 before sensitive-data integration; after shared contracts freeze, UI, media and catalog work may run in parallel on disjoint paths. Parent wires adapters into UI only after task review; parent owns package/config conflicts.
- [ ] Write integration tests first, observe the intended failure, then connect the real modules. Fixture transport is injected only by tests; production entry points require real provider calls and real preparation.
- [ ] Prove file → valid chunks → encrypted saved STT fixtures → selected/edited transcript → grounded minutes fixtures → editor → `.md`/clipboard, plus retry/cancel/storage failure/reload/lock/multitab. Keyless evidence must stay labelled keyless.
- [ ] Run focused unit suites, `npm run typecheck`, `npm run test:e2e`, `npm run test:secret`, `npm run build`, and `git diff --check`; fix failures and rerun affected checks. Scan only owned source/build/commit changes, never existing secret files; report paths/rules without secret values.
- [ ] Inspect actual browser storage for synthetic sensitive sentinels, DOM/accessibility after lock, network destination allowlist, sanitized errors and built artifacts. Configure static CSP/security headers and avoid meeting-content logs; Worker hosts assets only.
- [ ] In a visibly separate browser window, compare reference/app at recorded viewports in all six screens, light/dark/palettes, empty/loading/partial/error/edited/locked states, keyboard navigation, playback, export and copy. Capture nonsecret evidence and any fidelity gaps.
- [ ] Hand off tomorrow: user enters limited keys directly in UI, approves provider transmission and selects nonprivate multilingual audio. Verify authenticated OpenAI STT → encrypted reload → chosen transcript → authenticated OpenRouter minutes → edited export/copy. Record only nonsecret outcomes, model/settings and actual limits.
- [ ] Test real supported long audio and inspect correctness at overlaps/numbers/negation/final decision reversals. No G03/G04/G05 pass from mock transport; no G02 pass from source review or prior experiment alone.
- [ ] Update `docs/14-test-build-evidence.md` and applicable G01–G12 statuses with commands/results, device/browser/origin, support matrix, resource measurements and remaining limits; confirm reference hashes unchanged and documentation links resolve.
- [ ] Obtain independent whole-branch review, address findings and rerun affected verification. Parent commits a coherent completed feature with explicit paths; no blanket staging of user/untracked material.
- [ ] Promote/push `main` only when the intended release's G01–G11 evidence passes (G12 if comparison ships), no unresolved sensitive-data/copy conflict remains, and authenticated flow is verified. An incomplete fixture-only build stays local/on the feature branch.
- [ ] After authorized production reflection, derive the actual deployment URL from Cloudflare result/configuration and smoke-test that actual URL in browser, including assets/navigation and production-origin provider transport. Expected `mom.korgeek.workers.dev` is not deployment evidence; paid smoke requests still require the user handoff.

## Review Handoff and Remaining Gates

User review of this plan precedes implementation; preserve the selected subagent execution method. Approval of a stage is not proof that its tests passed.
Unresolved security design/secret-input copy gates precede vault implementation; narrower audio support, unknown provider capabilities and untested real inference remain explicit until verified.
If tomorrow's target is missed, deliver the runnable local feature build plus exact failed/pending gates and next action; do not push scaffolding, fake success or unverified sensitive-data paths to `main`.
