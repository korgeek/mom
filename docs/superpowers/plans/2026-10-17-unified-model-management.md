# Unified Model Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 실제 실행 방식은 사용자의 요청과 저장소 지침을 따른다. 이 문서 작성은 구현·추가 에이전트·커밋·배포를 실행하는 지시가 아니다.

**Goal:** 연결 설정을 모델 관리로 통합하고, 전사와 요약·정리에서 각각 OpenAI·OpenRouter·OpenAI 호환/로컬 등록 모델을 실제 사용한다.

**실행 상태:** 사용자가 구현을 승인했고 로컬 feature 브랜치에서 진행했다. 아래 계획의 초기 “문서만 작성” 문구는 당시 범위이며, 최신 구현·검증 결과는 [검증 기록](../evidence/2026-10-17-unified-model-management/README.md)을 따른다. 실제 키 입력은 사용자에게 전달했고 main 푸시·배포는 수행하지 않았다.

**Architecture:** 기존 ModelRegistration을 v2 단일 목록으로 확장한다. 키는 기존 vault/session에 분리하고 고정된 실행 스냅샷을 기존 파이프라인에 전달한다. 암호화·요청 동의·checkpoint·잠금 경계는 유지한다. 별도 Connection 계층·백엔드·새 의존성은 만들지 않는다.

**Tech Stack:** React 19, TypeScript, Vite, IndexedDB/Web Crypto, Vitest/fake-indexeddb/Testing Library, Playwright, 기존 Cloudflare 정적 배포.

**Spec:** [모델 관리 통합 설계안](../specs/2026-10-17-unified-model-management-design.md), 요구 U1–U6와 검증 A1–A8.

## Global Constraints

- 아래 작업은 구현이 요청된 뒤 진행한다. 현재 `App.tsx`의 보관함·암호 설명 수정은 별도 변경이다. 이를 보존하고 관련 없는 커밋에 섞지 않는다.
- 시작할 때 `AGENTS.md`, Git 상태, 실제 타입·호출자·테스트를 재확인한다. 아래 경로는 저장소 상대 경로이고 새 함수는 제안 계약이다.
- 검증 명령은 `package.json`의 Node engines를 충족한 환경에서 실행한다. 작성 당시 범위는 `^22.22.2 || ^24.15.0 || >=26.0.0`이다. 시스템 Node가 범위 밖이면 기존에 준비된 호환 runtime을 사용하고 버전을 증거에 기록한다.
- 테스트는 변경과 직접 영향 범위에 한정한다. 실패 테스트로 요구를 고정한 뒤 구현한다. 전체 unit/e2e suite는 기본 실행하지 않는다.
- 실제 사용자 키·보관함을 읽지 않고 합성 키/음성을 쓴다. 원시 전사·시간축·원본/편집 버전·usage·비교 결과를 삭제하거나 다시 생성하지 않는다.
- 저장·선택·unlock 이전은 네트워크를 발생시키지 않는다. 자동 재시도·fallback·정책 완화는 없다. save-before-dispatch, save-only retry와 잠금 guard를 재사용한다.
- 작업별 커밋은 향후 구현 시의 로컬 체크포인트 제안이다. main push·배포는 별도 요청된 릴리스 작업이며 부분 구현을 배포하지 않는다.
- fixture 통과와 실제 인증/추론, 빌드와 운영 배포를 각각 구분해 보고한다.

## Review Focus

1. 같은 modelId/다른 서버가 선택·동의·키·이력에서 분리되는가?
2. v1 등록과 legacy registry가 원자적으로 하나로 이전되고 세션 키가 영속화되지 않는가?
3. API별 payload·한도·정책·응답 차이가 실제 실행과 테스트 양쪽에서 검증되는가?
4. 배치·비교·재시도·잠금·저장 실패까지 불변 스냅샷을 사용하는가?
5. 연결 탭과 이중 목록을 제거하면서 필수 안내·동의·접근성을 보존하는가?

## 순서와 제안 인터페이스

Task 1 → 2 → 3 → 4 → 5 → 6 → 7 순서다. 컨트롤러 전체 재작성이나 범용 설정 프레임워크는 필요하지 않다.

```ts
// providers/model-registrations.ts
normalizeRegistrations(value: unknown): ModelRegistrations; // v2, v1은 이전기로 전달
validateRegistration(value: unknown): ModelRegistration;
registrationEndpoint(model: ModelRegistration): string; // 검증된 전체 endpointUrl
registrationSignature(model: ModelRegistration): string;
freezeExecutionModel(model: ModelRegistration): ModelExecutionSnapshot;

// vault/model-registration-migration.ts (새 파일, 비밀 원문 없는 이전 계획)
planRegistrationMigration(input: LegacyRegistrationInput): RegistrationMigrationPlan;
// 결과: v2 목록 + 이전 key namespace→등록 ID 매핑. 적용은 vault 내부.

// vault/session.ts → vault/store.ts
saveRegisteredModel(
  model: ModelRegistration, keyUpdate: RegistrationKeyUpdate, job: JobContext
): Promise<ModelRegistrations>;

// providers/registered-runtime.ts (새 파일)
createRegisteredSTTProvider(
  model: ModelExecutionSnapshot, key: RuntimeKeyGetter
): STTProvider;
createRegisteredMinutesProvider(
  model: ModelExecutionSnapshot, key: RuntimeKeyGetter
): MinutesProvider;
```

`ModelExecutionSnapshot`은 `domain/types.ts`, migration 입력/계획 타입은 새 migration 파일에 둔다. 기존 `ProviderMinutesRun`의 raw response·요청 경로 보존을 공통 정리 반환 계약에 반영한다. 옵션 타입은 기존 registration 파일을 재사용하고 runtime 순환 import를 만들지 않는다. key getter는 등록 ID·origin·키 버전·세션 guard를 확인하며 다른 키로 대체하지 않는다.

## Task 1: v2 등록과 실행 스냅샷 계약

**Files:** Modify `src/react-app/providers/model-registrations.ts`, `src/react-app/domain/types.ts`; test `tests/model-registrations.spec.ts`; create test `tests/registered-runtime.spec.ts`.

**Interfaces:** v2 normalization/signature/freeze 계약을 생산한다. v1은 이전 입력용 타입으로 남긴다. 스냅샷에는 키를 제외한 요청 재현 필드를 고정한다.

- [ ] 전체 URL 중복 부착 없음, API/작업 6조합, 같은 modelId/다른 URL, 공식 adapter/잘못된 origin, userinfo/query/fragment/제어문자, 허용되지 않은 HTTP를 먼저 테스트한다.
- [ ] 이름 변경은 signature 유지, URL/모델/옵션/정책/키 버전 변경은 signature 변경, 스냅샷은 후속 편집과 독립임을 검증한다. 중복 ID·150개 초과·잘못된 defaults도 거부한다.
- [ ] `npx vitest run tests/model-registrations.spec.ts tests/registered-runtime.spec.ts`에서 새 사례의 RED를 확인한다.
- [ ] adapter/revision/enabled/keyStorage/limits/evidence/router, defaults/legacyRouteIds를 구현한다. 기존 경로 부착은 v1 이전 helper에 한정한다. 기존 IPv6 등록은 보존 가능한 실행 차단 상태로 읽는다.
- [ ] 실행 준비 상태에 활성 여부·용도·필수 한도·key/origin·정책 확인을 반영한다. 오류에 부족한 필드와 해결 방법을 담고 가격 unknown을 키 누락과 분리한다. 테스트 30초·5 MiB를 production 한도로 복사하지 않는다.
- [ ] focused 테스트와 `npm run typecheck`를 통과시킨다. 기존 호출자는 명시적 호환 경계로 컴파일을 유지한다. 관련 파일만 커밋: `feat: define unified registered model contracts`.

## Task 2: 원자적 저장과 기존 데이터 이전

**Files:** Modify `src/react-app/vault/store.ts`, `src/react-app/vault/session.ts`; create `src/react-app/vault/model-registration-migration.ts`; test `tests/vault-model-registrations.spec.ts`, `tests/vault-model-registry.spec.ts`; create test `tests/model-registration-migration.spec.ts`.

**Interfaces:** Task 1 v2를 소비하고 `saveRegisteredModel`, `planRegistrationMigration`을 제공한다. 비밀 처리는 vault 내부에서만 수행한다.

- [ ] config+key 저장 중 실패 rollback, 빈 필드 keep, 명시적 clear, origin/auth 변경 후 재사용 차단, 저장 후 용도 변경 거부, encrypted↔session 전환을 테스트한다. 실패 시 이전 값과 저장 모드를 유지해야 한다.
- [ ] v1 직접 등록+legacy OpenAI STT/OpenRouter STT/정리+defaults+metadata/정책+암호화/세션 키+과거 결과의 혼합 fixture를 만든다. ID 충돌·100+50개·실패 주입·재unlock 멱등성·잠금 경합을 검증한다.
- [ ] `npx vitest run tests/vault-model-registrations.spec.ts tests/vault-model-registry.spec.ts tests/model-registration-migration.spec.ts`의 새 사례가 실패하는지 확인한다.
- [ ] 기존 `writeRegistrationCatalog`를 확장해 설정과 암호화 키를 같은 트랜잭션에 쓴다. 세션 Map 공개는 커밋 후 guard를 재확인한다. 암호화→세션 전환에서 영속 사본을 같은 커밋으로 제거한다.
- [ ] v1 ID 유지, legacy 경로별 새 UUID/매핑, 활성/기본값/채택 metadata/경로/동의 보존을 구현한다. v1 등록은 자동 활성화하지 않는다. 실제 키 저장 상태로 복사하고 전역 keyStorage로 추정하지 않는다.
- [ ] unlock은 성공한 v2만 공개한다. 실패 시 원본 유지·로컬 이전 재시도·네트워크 0회를 보장한다. 옛 프로젝트 선택은 매핑으로 읽고 다음 저장에 등록 ID를 추가한다. legacy 키·이력은 이번 단계에서 정리 삭제하지 않는다.
- [ ] focused 테스트/typecheck 후 커밋: `feat: migrate model settings and keys atomically`.

## Task 3: 실제 실행 어댑터와 공통 요청 검증

**Files:** Create `src/react-app/providers/registered-runtime.ts`; modify `src/react-app/providers/model-registrations.ts`, `registration-test.ts`, `openai.ts`, `openrouter-stt.ts`, `openrouter.ts`, `src/react-app/domain/pipeline.ts`; test `tests/registered-runtime.spec.ts`, `tests/registration-test.spec.ts`, `tests/providers.spec.ts`, `tests/openrouter-stt-provider.spec.ts`.

**Interfaces:** 스냅샷을 받아 기존 STT/Minutes provider를 반환한다. 기존 payload builder·normalizer를 필요한 만큼 추출해 재사용한다. 테스트 runner는 별도 입력/응답 상한을 유지한다.

- [ ] 3 adapter × 2 작업의 표 형식 fixture로 URL·model·multipart/base64·auth 유무·policy·token field·프롬프트 전문을 검사한다. redirect 차단·키 origin 바인딩도 검증한다.
- [ ] 미지원 옵션 요청은 명확한 오류, 미설정 필드는 전송 없음으로 테스트한다. OpenRouter STT에 무효한 처리 경로 pin을 혼합하지 않는다.
- [ ] 200 error/refusal/tool-only/empty/incomplete/잘못된 JSON, stream 응답 상한, 반사된 키, usage 누락의 테스트를 작성한다.
- [ ] `npx vitest run tests/registered-runtime.spec.ts tests/registration-test.spec.ts tests/providers.spec.ts tests/openrouter-stt-provider.spec.ts`의 새 RED를 확인한다.
- [ ] factory와 공유 payload/normalizer를 구현한다. OpenAI/compatible 전사는 multipart, OpenRouter 전사는 기존 JSON/base64+정책, 텍스트는 비스트리밍 Chat Completions로 보낸다. 공식 API host 제약을 유지한다.
- [ ] 응답 reader의 stream byte 상한을 production 8 MiB/테스트 512 KiB로 분리한다. 파일과 encoding 후 body도 각각 검사한다. parse/상한 오류에서 자동 재요청하거나 비용을 0으로 만들지 않는다.
- [ ] 요청 gate를 한 번만 적용하고 기존 timeout/429 의미를 유지한다. cooldown은 같은 origin의 요청이 공유한다. dispatch 직전 key getter와 guard, secret 마스킹을 적용한다.
- [ ] focused 테스트/typecheck 후 커밋: `feat: execute registered transcription and text models`.

## Task 4: 등록 모델을 전사·배치·재시도에 연결

**Files:** Modify `src/react-app/controller.tsx`, `src/react-app/domain/pipeline.ts`, `src/react-app/domain/types.ts`, `src/react-app/transcript/batches.ts`, 기존 `media/prepare.ts` 호출부와 `src/react-app/ui/screens/STT.tsx`; test `tests/pipeline.spec.ts`, `tests/stt-batches.spec.ts`, `tests/stt-rerun-controller.spec.tsx`, `tests/stt-rerun-ui.spec.tsx`, `tests/audio.spec.ts`의 직접 영향 사례.

**Interfaces:** 선택/동의는 등록 ID+signature, 새 batch/intent는 스냅샷을 사용한다. legacy batch reader는 유지한다. Task 3 STT factory를 기존 queue에 전달한다.

- [ ] `rg -n 'onSTTModel|STTConsent|STTAction|sttModelId' src/react-app`로 선택·동의·재시도 호출자를 전부 나열한다. 고정 카탈로그에 없는 모델과 같은 modelId/다른 URL에서 올바른 요청이 나가는 테스트를 쓴다.
- [ ] 동의 후 설정/키/정책 변경, 실행 중 편집, 재시도 불일치, 완료 raw 재사용을 검사한다. 미완료 청크가 새 설정으로 섞여 실행되면 실패해야 한다.
- [ ] intent 저장 전 HTTP 0회, checkpoint 실패 시 dispatch 0회, 저장만 재시도 시 추가 HTTP 0회, lock 뒤 늦은 결과 공개 0회를 검증한다.
- [ ] `npx vitest run tests/pipeline.spec.ts tests/stt-batches.spec.ts tests/stt-rerun-controller.spec.tsx tests/stt-rerun-ui.spec.tsx`의 새 RED를 확인한다.
- [ ] 선택·프로젝트·consent/action·batch validation을 등록 ID로 연결한다. 신규 queue의 고정 `getSTTModel` fallback을 제거하고 한도·가격은 스냅샷에서 받는다. legacy 읽기와 구분한다.
- [ ] 새 intent에 전체 URL·스냅샷을 저장한다. 원본 시간축·중복 처리·raw 선택·재전사 버전은 기존 로직을 재사용한다. disabled/키 부재/설정 변경 재시도는 설명과 새 배치 안내로 중단한다.
- [ ] 준비 호출의 고정 파일 한도 대신 선택 모델 한도를 반영한다. 기존 MP3 준비 청크의 포맷·바이트·길이를 전송 전에 검사하고, 모델 변경 후 맞지 않으면 로컬 준비 수정을 안내한다. MP3 미지원 서버는 새 인코더 없이 명확히 차단한다. `tests/audio.spec.ts`의 직접 영향 사례도 실행한다.
- [ ] focused 테스트/typecheck 후 커밋: `feat: use registered models for transcription batches`.

## Task 5: 정리·비교·비용을 등록 모델에 연결

**Files:** Modify `src/react-app/controller.tsx`, `src/react-app/domain/types.ts`, `src/react-app/minutes/selection.ts`, `src/react-app/minutes/generate.ts`, `src/react-app/minutes/compare.ts`, `src/react-app/ui/screens/Minutes.tsx`, `src/react-app/ui/screens/Review.tsx`, `src/react-app/ui/screens/History.tsx`, `src/react-app/usage/statement.ts`의 직접 영향 부분; test `tests/selection.spec.ts`, `tests/minutes.spec.ts`, `tests/comparison.spec.ts`, `tests/usage.spec.ts`, `tests/usage-ui.spec.tsx`.

**Interfaces:** `MinutesSettings.registrationId`와 고정 스냅샷/factory를 사용한다. 기존 preview/generator/comparison의 RouterSelection 필수 조건을 일반화하고 modelId/raw/usage 이력은 보존한다.

- [ ] 세 adapter 모두 선택한 전사·지시 전문만 보내고 음성을 보내지 않는 테스트를 쓴다. 정리 모델·언어·항목 변경 시 STT 호출 수가 그대로여야 한다.
- [ ] 가격 unknown/usage 누락을 0원으로 표시하지 않음, 필수 한도 누락 차단, context 초과 시 입력 자르기 금지, token field 하나만 전송을 검증한다.
- [ ] 서로 다른 adapter의 비교에서 입력 고정·A 저장 후 B·실패 구성원만 명시적 재시도·설정 변경 차단을 검사한다. 기존 서로 다른 modelId 규칙은 유지한다.
- [ ] `npx vitest run tests/selection.spec.ts tests/minutes.spec.ts tests/comparison.spec.ts tests/usage.spec.ts tests/usage-ui.spec.tsx`의 새 RED를 확인한다.
- [ ] 선택/preflight·동의·실행·비교를 일반화한다. 기존 프롬프트·Markdown 검토·원본/편집 버전을 유지하고 OpenRouter의 처리 경로 고정과 fallback 금지를 보존한다.
- [ ] 요청 URL/모델·반환 모델·실제 처리 경로·raw/usage를 기록한다. 가격 출처·통화·단위를 보존하고 기존 비용을 다시 계산하지 않는다.
- [ ] 검토·정리·이력 화면에 등록 이름·모델 ID·실제 서버를 표시한다. 새 결과를 기존 OpenAI/OpenRouter route 필드만으로 판별해 `경로 알 수 없음`으로 표시하지 않는다. legacy 결과의 출처 미확인 표시는 보존한다.
- [ ] focused 테스트/typecheck 후 커밋: `feat: use registered models for notes and comparison`.

## Task 6: 모델 관리 UI·영문 통합과 중복 제거

**Files:** Modify `src/react-app/App.tsx`, `src/react-app/controller.tsx`, `src/react-app/ui/screens/Settings.tsx`, `src/react-app/ui/components/ModelRegistrations.tsx`, `ModelManager.tsx` 및 직접 영향받는 model picker/copy/style; test `tests/model-registrations-controller.spec.tsx`, `tests/model-registrations-ui.spec.tsx`, `tests/e2e/model-registrations.spec.ts`, `tests/e2e/model-selection-settings.spec.ts`.

**Interfaces:** 단일 폼은 `saveRegisteredModel(config, keyUpdate, job)`를 호출한다. picker는 통합 목록의 단계별 항목과 defaults를 사용한다. 키 입력은 저장/취소/잠금 후 비운다. 저장한 등록의 용도는 고정한다.

- [ ] 연결 탭 없음·두 용도 목록/기본값·단일 폼·keep/replace/clear·인증 없음·신규 비활성·테스트 무효화를 먼저 테스트한다. 저장/활성화/default 변경 시 HTTP 0회를 검사한다.
- [ ] KO/EN 키 안내 한 번, 다른 adapter의 OpenRouter 정책 숨김, 필드별 오류/해결 방법·focus, 접기/모달의 키보드 사용을 검증한다.
- [ ] `npx vitest run tests/model-registrations-controller.spec.tsx tests/model-registrations-ui.spec.tsx`의 새 RED를 확인한다.
- [ ] 기존 등록 UI를 확장해 endpoint/key/options/policy를 한 저장으로 묶고 테스트는 별도 버튼으로 유지한다. 전체 요청 URL을 보여주고 키 원문은 표시하지 않는다.
- [ ] 저장·키 필요·테스트 전/성공/실패/불완전/결과 불명·설정 변경·저장 대기를 구분한다. 테스트 성공을 당시 signature/입력에만 연결하고 저장 재시도는 HTTP를 반복하지 않는다.
- [ ] 공통 안내·모델별 정책·라이선스를 설계대로 배치한다. 구 Connection/RouterSTTSettings 중복·두 번째 실행 목록을 제거한다. legacy reader/이전 코드는 남기고 카탈로그는 명시적 추가에 필요한 만큼 재사용한다.
- [ ] 제거할 export/fixture/handler의 모든 호출자를 `rg`로 확인한다. focused unit/typecheck/build와 두 관련 browser 파일을 통과시킨다. 커밋: `feat: merge connection settings into model management`.

## Task 7: 브라우저 9조합·로컬 경계 검증과 문서 인계

**Files:** Create `tests/e2e/unified-model-management.spec.ts`, `tests/e2e/fixtures/local-model-server.ts`; 직접 영향 시 update `tests/e2e/openrouter-stt.spec.ts`, `stt-rerun.spec.ts`, `minutes-comparison.spec.ts`, `lock.spec.ts`, `recovery.spec.ts`; modify `README.md`, `docs/TODO.md`; create `docs/superpowers/evidence/2026-10-17-unified-model-management/README.md`.

**Interfaces:** 기존 합성 vault/audio fixture를 재사용한다. 기존 `fixtureTransport`의 OpenAI/OpenRouter 외 요청 abort 전제를 로컬 테스트에 그대로 적용하지 않는다. HTTP fixture는 실제 loopback 서버를 기동·종료하고 수신 origin/auth/body/호출 수를 검사한다.

- [ ] 3 STT × 3 LLM을 parameterize해 등록→선택→합성 음성 전사→정리→암호화 저장→reload/해제를 확인한다. 정확한 URL/body/HTTP 수와 정리 변경 시 STT 재실행 없음도 assert한다.
- [ ] 실제 HTTP fixture에서 CORS 허용/거부·auth 없음/bearer·중단을 검사하고 LNA 환경을 기록한다. 이는 실제 모델 추론 테스트와 구분한다.
- [ ] 이전·세션 키·저장만 재시도·부분 전사·비교 저장 순서·lock 뒤 늦은 응답을 직접 관련된 기존 사례로 확인한다. 동일 코드/환경의 유효한 통과 증거를 의미 없이 반복하지 않는다.
- [ ] KO/EN·데스크톱/모바일 폭을 브라우저에서 확인하고 스크린샷·console error를 기록한다. 실제 사용자 보관함을 재설정하거나 해제하지 않는다.
- [ ] `npm run typecheck`, 변경 파일 한정 ESLint, `npm run build`, `npm run test:secret`를 수행한다. 기존의 무관한 warning은 분리해 보고한다.
- [ ] `npx playwright test --config playwright.config.ts tests/e2e/unified-model-management.spec.ts tests/e2e/model-registrations.spec.ts tests/e2e/model-selection-settings.spec.ts tests/e2e/stt-rerun.spec.ts tests/e2e/minutes-comparison.spec.ts tests/e2e/lock.spec.ts tests/e2e/recovery.spec.ts` 중 실제 영향 사례를 실행한다. 필요하면 `--grep`으로 제한하며 전체 suite로 확대하지 않는다.
- [ ] `rg`로 신규 경로의 connections 탭·제공사 고정 실행·modelId 단독 선택 잔존을 확인한다. 남긴 legacy reader를 설명한다. design-reference 원본 diff가 없는지 확인한다.
- [ ] README/TODO에 API·모델 측 조건·localhost/CORS/LNA·미지원 HTTP LAN/IPv6·가격 unknown을 반영한다. 증거에 명령·환경·결과·미검증을 남긴다. 커밋: `test: verify unified model workflows and local server access`.

### 실제 서비스 검증: 허용된 실행 범위에서 수행할 출시 조건

- [ ] OpenAI/OpenRouter의 STT·텍스트를 짧은 비민감 입력으로 실제 인증·실행한다. 요청/반환 모델·usage·저장/재표시와 한계를 기록한다.
- [ ] 사용자가 실행한 실제 로컬 ASR→로컬 텍스트 모델로 음성부터 정리까지 확인한다. fixture 성공을 이 항목의 PASS로 대체하지 않는다.
- [ ] 릴리스 시 운영 origin의 CORS·로컬 접근 권한도 확인한다. 허용/환경이 없는 항목은 미검증으로 남기며 지원 검증 완료라고 선언하지 않는다. main push/배포는 별도 요청된 릴리스 범위에서 진행한다.

## 요구사항 연결과 현재 완료 기준

| 요구/검증 | 구현 작업 |
| --- | --- |
| U1/U4, A1/A8 | Task 1/2/6/7 |
| U2/U3, A2/A3 | Task 1/3/4/5/7 |
| U5, A5/A6/A7 | Task 1/2/3/4/5/7 |
| U6, A4 | Task 1/3/6/7 |

현재 산출물은 설계안과 이 계획이다. 소스 변경·실제 키 조회·추론·커밋·배포를 수행하지 않는다. 구현 시작 전 명령·타입을 현재 저장소와 다시 맞추고 범위 밖 새 요구는 별도로 다룬다.


## 구현 중 추가된 사용자 결정: 재사용 가능한 별도 키

- [ ] `ApiCredential` 공개 메타데이터와 `credential:<id>` 비밀 레코드를 분리한다. 모델은 선택 참조를 가지며 인증 없는 서버는 참조 없이 동작한다.
- [ ] 등록별 기존 키를 원자적으로 이전한다. 공유 키 교체·저장 방식 변경은 연결 모델 버전/테스트를 함께 갱신하고 삭제는 모델 참조를 해제한다. 세션 전용·잠금 경계를 유지한다.
- [ ] 모델 편집에서 같은 origin의 키 선택/새 키 추가를 제공하고 모델 관리 내부에 접힌 키 관리 영역을 둔다. 공유 파일에는 키 참조도 넣지 않는다.
- [ ] 공유 키를 쓰는 STT/정리 두 모델, 교체·연결 해제·삭제·다른 origin 거부·암호화 저장/새로고침을 관련 테스트와 브라우저에서 확인한다.
