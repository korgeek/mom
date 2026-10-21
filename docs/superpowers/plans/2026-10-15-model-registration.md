# OpenAI 호환 모델 등록 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 설정에서 OpenAI·OpenRouter·호환 서버의 STT/LLM 모델을 등록·암호화 저장·수정하고, 자동 `{{값}}` 요청 미리보기와 명시적 실제 테스트 호출을 제공한다.

**Architecture:** 기존 설정의 모델 영역에 STT/LLM 등록 목록과 폼을 붙인다. 기존 암호화 catalog·secret 저장과 job/잠금 경계를 재사용한다. 요청 구성은 미리보기와 테스트가 공유하며, 기존 회의 실행기의 모델 선택과 데이터 형식은 변경하지 않는다.

**Tech Stack:** 현재 React/Vite/TypeScript, Web Crypto/IndexedDB, fetch/FormData, Vitest/Testing Library, headed Playwright. 새 제품 의존성을 추가하지 않는다.

**Spec:** [확정 범위와 상세 설계](../specs/2026-10-14-model-registration-design.md).

**Status:** 2026-10-15: user approved inline implementation in an isolated worktree. Registration, encrypted saving, preview and test calls are implemented and checked with synthetic transports. Authenticated inference and deployment remain unverified. [Verification](2026-10-15-model-registration-verification.md).

## Global Constraints

- 실제 회의의 전사/회의록 실행 연결, 범용 템플릿 편집, 자동 모델 조회·재시도·대체 모델, 가져오기·내보내기는 제외한다.
- 기존 미커밋 변경 7개 경로와 기존 모델 registry·키·회의를 보존한다. 현재 HEAD `b126c5818b79d85f016a209f4fe57ed33aaddfda`에서 분리된 작업 폴더를 사용한다. 기록된 원격 ref를 최신이라고 간주하거나 pull/reset하지 않는다.
- 기존 UI 스타일을 사용한다. 등록은 실제 암호화 저장이며, 저장·목록 조회를 추론 성공으로 표시하지 않는다.
- 키는 기존 encrypted/session 모드를 사용한다. 실제 키를 미리보기·응답 표시·로그·소스·URL·클립보드에 넣지 않는다. 새 등록의 키 참조는 `registration:<id>`이며, 기존 `openai`·`openrouter` 키를 읽거나 교체하지 않는다.
- 원격 URL은 HTTPS, 로컬 HTTP는 loopback만 허용한다. URL의 사용자정보·query·fragment·제어문자를 거부하고, 키는 저장 시 결합한 origin으로만 보낸다. fetch는 `redirect: 'error'`, `credentials: 'omit'`를 사용한다.
- STT 테스트는 30초·5 MiB 이하의 사용자 선택 파일만 사용하고, 설정된 더 작은 한도도 적용한다. 실제 파일 검사 경로를 재사용한다. 테스트 입력은 현재 회의에서 자동으로 가져오지 않는다.
- 완료된 테스트 결과는 암호화 보존한다. 취소/timeout은 이미 전송한 요청의 비용 취소를 뜻하지 않는다. 저장 실패를 유료 재호출로 복구하지 않는다.
- 개발 중에는 합성 키·입력과 테스트 transport만 사용한다. 실제 자격 증명 입력·제공사 호출은 사용자에게 맡긴다. 푸시·배포는 하지 않는다.
- 테스트는 변경과 직접 영향받는 사례만 실행한다. 전체 suite·전체 브라우저 행렬을 실행하지 않는다. 의존성 변경이 없으므로 설치를 반복하지 않는다.

## Review Focus

- 신규 등록을 취소했는데 고아 secret이 남지 않음: 등록 저장 전 키 저장 금지, Task 2/4 테스트.
- secret·origin 교체 직후 오래된 성공 결과가 현재 설정의 검증으로 표시되지 않음: 키 버전/설정 서명 결합, Task 2/3/4 테스트.
- HTTP 200 안의 오류·거절·출력 한도 도달을 성공으로 표시하지 않음: Task 3의 표준 응답 테스트.
- 응답을 받은 직후 잠금/저장 실패가 발생해도 완료 결과를 잃거나 자동 재호출하지 않음: Task 2/4의 완료 결과 보존 테스트.
- 서버 모델 목록이 없거나 ID에 `/`가 없어도 등록할 수 있음: Task 1/4의 직접 입력 테스트. 등록 자체는 지원 확인을 뜻하지 않음.

## 파일별 책임

| 파일 | 책임 |
| --- | --- |
| `src/react-app/providers/model-registrations.ts` (신규) | 등록/테스트 결과 타입, 신뢰 경계 검증, 주소·설정 서명, 표시용/실행용 요청 구성 |
| `src/react-app/providers/registration-test.ts` (신규) | 실제 fetch, 제한된 응답 읽기, 응답 검사·마스킹·실측 결과 |
| `src/react-app/vault/store.ts`, `session.ts` | 선택적 catalog 필드와 secret 참조 저장, 키 버전의 원자적 변경, 완료 테스트 결과·잠금 보존 |
| `src/react-app/App.tsx`, `controller.tsx` | 등록 UI 계약, 복원·저장·키·테스트 동작과 상태/소유권 경계 |
| `src/react-app/ui/components/ModelRegistrations.tsx` (신규) | STT/LLM 목록·폼·미리보기·테스트 입력/결과 |
| `src/react-app/ui/screens/Settings.tsx`, `ui/styles.css` | 기존 모델 영역의 하위 탭과 scoped layout; 기존 연결/실행 모델 관리 유지 |
| 아래 각 Task의 명시적 테스트 파일 | 해당 계약·실패 경로 검증 |

## Task 1: 등록 계약과 공유 요청 구성

**Files:** 신규 `src/react-app/providers/model-registrations.ts`, `tests/model-registrations.spec.ts`.

**Interfaces:**

- `ModelRegistration`: `id`, `stage: 'stt' | 'llm'`, `name`, `baseUrl`, `modelId`, `auth: 'none' | 'bearer'`, `credentialOrigin`, `credentialVersion`, 선택적 `stt`/`llm` 옵션과 `lastTest`.
- `ModelRegistrations = { version: 1; entries: readonly ModelRegistration[] }`. Catalog에 없으면 빈 등록 목록이며, 알려지지 않은 버전은 오류다.
- `RegistrationTestInput`: STT의 File·언어·용어·맥락 또는 LLM의 테스트 전사문·출력 언어·섹션·추가 지침.
- `RegistrationTestResult`: 설정/키 버전·입력 서명, 실제 HTTP 상태·시간, `success | incomplete | failed | cancelled | outcome-unknown`, 전사/생성 텍스트, 마스킹된 원본 응답과 제공된 사용량. File/secret/Authorization은 넣지 않는다.
- `normalizeRegistrations(value: unknown): ModelRegistrations`, `validateRegistration(value: unknown): ModelRegistration`.
- `registrationEndpoint(registration: ModelRegistration): string`, `registrationSignature(registration: ModelRegistration): string`.
- `buildRegistrationRequest(registration: ModelRegistration, input: RegistrationTestInput | 'preview'): { url: string; body: FormData | string; contentType: string | null; preview: string }`. 인증 헤더는 이 함수에 넣지 않는다.

- [x] 테스트 먼저 작성: local alias `whisper-local` 허용, OpenAI/OpenRouter Base URL 조합, HTTP loopback 허용/외부 HTTP·URL secret 금지, 단일·복수 언어 동시 전송 금지, 설정되지 않은 옵션 생략, 토큰 한도 필드 하나만 전송, LLM 작업 설정은 messages에 포함, file은 File로 첨부, 실제 secret 없이 `{{api_key}}` 미리보기.
- [x] `npm run test:unit -- tests/model-registrations.spec.ts`를 실행해 아직 없는 구현으로 실패함을 확인한다.
- [x] 타입/검증/요청 구성을 최소 함수로 구현한다. 문자열 전체를 실행하는 템플릿 엔진은 만들지 않는다. `model`·`file`·`messages`를 임의 추가 파라미터로 덮어쓰는 기능은 넣지 않는다.
- [x] 같은 명령으로 통과를 확인하고 `feat: define OpenAI-compatible model registrations`로 해당 파일만 로컬 커밋한다.

## Task 2: 등록·키·테스트 결과의 암호화 보존

**Files:** 수정 `src/react-app/vault/store.ts`, `session.ts`; 신규 `tests/vault-model-registrations.spec.ts`; 직접 영향받는 기존 `tests/vault-model-registry.spec.ts`.

**Interfaces:** Task 1의 catalog를 기존 암호화 Catalog의 선택적 `modelRegistrations` 필드에 보존한다. `VaultSession`과 coordinator에 `loadModelRegistrations(job): Promise<ModelRegistrations>`, `saveModelRegistrations(value, job): Promise<void>`, `saveRegistrationKey(id, value, mode, job): Promise<ModelRegistrations>`, `saveRegistrationTest(id, result, job): Promise<ModelRegistrations>`를 제공한다.

- [x] 테스트 먼저 작성: legacy 빈 등록 필드, 기존 projectIds/modelRegistry/deletedRecordIds 보존, 암호화 round-trip, 저장 abort 시 이전 목록 보존, 미등록 ID의 키 저장 거부, keyRef namespace 분리, encrypted/session 교체 후 실제 저장 상태와 키 버전 결합, origin 교체 때 secret 자동 재사용 금지, 새 키로 옛 성공 무효화.
- [x] 완료 테스트 결과의 pending 보존·잠금·저장 실패/retry가 실제 HTTP 요청을 다시 보내지 않는 테스트를 작성한다. 기존 coordinator의 잠금 직렬화/보존 경계를 확장하고 별도 plaintext 저장소를 만들지 않는다.
- [x] `npm run test:unit -- tests/vault-model-registrations.spec.ts`의 실패를 확인한다.
- [x] 현재 serial queue·encryptedJSON·트랜잭션·guard를 사용해 구현한다. secret 교체와 catalog의 credentialVersion/lastTest 무효화는 같은 트랜잭션으로 저장한다. 세션 key map은 durable transaction 성공 후 변경한다. 기존 데이터·DB 버전·crypto 파라미터는 바꾸지 않는다.
- [x] `npm run test:unit -- tests/vault-model-registrations.spec.ts tests/vault-model-registry.spec.ts` 통과 후 `feat: persist model registrations in the encrypted vault`로 해당 파일만 커밋한다.

## Task 3: 실제 테스트 요청과 표준 응답 검사

**Files:** 신규 `src/react-app/providers/registration-test.ts`, `tests/registration-test.spec.ts`; 필요한 경우 수정 `src/react-app/domain/pipeline.ts`의 기존 전송 gate provider 식별 타입; 영향받는 `tests/providers.spec.ts`.

**Interfaces:**

- `runRegistrationTest(registration, input, job, { getKey, fetch?, now?, timeoutMs? }): Promise<RegistrationTestResult>`.
- `getKey`는 저장한 keyRef와 origin 검증 후에만 값을 돌려준다. API 키를 Request/Result 계약에 반환하지 않는다.
- Task 1의 요청 구성 함수를 사용한다. 기존 전송 gate를 재사용해 유료 요청 중복/timeout/취소를 처리하며, 임의 재시도는 하지 않는다.

- [x] 테스트 먼저 작성: 저장한 합성 key의 Bearer 헤더와 조립한 multipart/JSON, 인증 없음, redirect/cookie 차단, 같은 요청의 미리보기/실행 일치, secret을 echo한 JSON/오류도 표시/보존 결과에서 마스킹.
- [x] 실제 작은 WAV fixture로 30초·5 MiB 경계와 잘못된 형식/길이 미확인을 검사한다. 기존 `inspectAudioDetails`를 재사용한다.
- [x] STT JSON·verbose JSON과 LLM 정상 응답, 잘못된 JSON, HTTP 200 error, refusal/tool_calls, finish_reason length, 빈/missing content, 사용량 미제공, timeout/취소 후 늦은 응답·중복 클릭 사례를 작성한다.
- [x] `npm run test:unit -- tests/registration-test.spec.ts`의 실패를 확인한다.
- [x] 단일 실제 fetch와 제한된 response reader를 구현한다. 테스트 응답 본문 상한은 512 KiB이며 초과 시 미완료/잘못된 응답으로 처리한다. 텍스트만 추출하고 tool call이나 HTML을 실행하지 않는다. 설정된 모델별 기능을 확인했다고 꾸미지 않는다.
- [x] `npm run test:unit -- tests/registration-test.spec.ts tests/providers.spec.ts` 통과 후 `feat: test registered OpenAI-compatible model connections`로 해당 파일만 커밋한다.

## Task 4: 설정 목록·폼·미리보기·테스트 UI 연결

**Files:** 신규 `src/react-app/ui/components/ModelRegistrations.tsx`, `tests/model-registrations-ui.spec.tsx`, `tests/model-registrations-controller.spec.tsx`, `tests/e2e/model-registrations.spec.ts`; 수정 `App.tsx`, `controller.tsx`, `ui/screens/Settings.tsx`, `ui/styles.css`. 기존 `tests/model-manager-ui.spec.tsx`, `tests/model-selection-modal.spec.tsx`는 직접 영향이 있을 때만 갱신/실행한다.

**Interfaces:** `AppController`에 등록 catalog·현재 test/save 상태와 `onSaveRegistration`, `onSaveRegistrationKey`, `onTestRegistration`, `onCancelRegistrationTest`를 추가한다. 이 메서드는 promise로 실제 저장/호출 결과를 알리며, UI는 provider/network 부작용을 직접 소유하지 않는다. 저장된 key의 실제 문자열을 UI state에 넣지 않는다.

- [x] controller 테스트 먼저 작성: unlock 후 복원, 원자적 save 완료 후 목록 갱신, storage 실패 시 draft/기존 목록 보존, 저장된 key만 테스트에 사용, 현재 draft와 등록 ID/origin 결합, 완료 결과 저장 실패 시 재전송 금지, lock/늦은 response/save receipt 경계, 기존 회의 모델·registry 불변.
- [x] UI 테스트 먼저 작성: STT/LLM 하위 탭·빈 목록·등록/수정/취소, 직접 model ID, preset은 주소만 채움, 등록 전 key-save 비활성, key-save 후 입력 비움, 입력과 함께 자동 바뀌는 `{{값}}` 미리보기, 테스트 전 전송 대상/입력/비용 안내, 테스트 중 수정/중복 금지, 실제 결과와 실패/부분/저장 실패 상태, 잠금 때 DOM·접근성 트리에서 데이터 제거.
- [x] `npm run test:unit -- tests/model-registrations-controller.spec.tsx tests/model-registrations-ui.spec.tsx`의 실패를 확인한다.
- [x] 목록·폼과 controller를 연결한다. 기존 연결/모델 관리 접근은 유지한다. 새 목록에는 `모델을 등록하고 테스트할 수 있어요. 회의의 전사·회의록 실행 연결은 다음 단계에서 제공해요.`를 표시한다.
- [x] 같은 단위 명령을 통과시키고 `npm run typecheck`를 실행한다. 수정한 Settings의 기존 모델 관리 인터페이스에 영향이 있을 때만 그 두 관련 UI 테스트를 추가한다.
- [x] 새 headed 브라우저 테스트를 작성한다. 합성 보관함과 provider route interception으로 1440×900의 STT/LLM 등록·저장·reload·테스트 결과·잠금, 360×800 영어의 폼/긴 미리보기를 렌더링하고 screenshot을 직접 확인한다. 실제 provider 요청·사용자 키는 사용하지 않는다.
- [x] `npm run build`와 `npm run test:e2e -- tests/e2e/model-registrations.spec.ts`를 실행한다. 빌드가 실제 변경 artifact를 만들었는지 확인하고 필요하면 `npm run test:secret`으로 공개 artifact의 합성 secret 노출을 확인한다. 전체 suite는 실행하지 않는다.
- [x] `git diff --check`와 reference SHA-256을 확인하고 범위별 결과를 해당 작업 폴더의 검증 기록에 남긴다. `feat: add STT and LLM registration settings`로 해당 파일만 로컬 커밋한다.

## 완료 조건과 인계

- 모델 설정과 키는 실제 보관함에 저장·복원된다. 현재 회의 모델은 자동 변경하지 않는다.
- 미리보기와 테스트는 같은 요청 구성 계약을 사용한다. UI는 secret 자체를 다시 표시하지 않는다.
- 테스트 버튼은 실제 전송 코드로 연결돼 있고, 개발 검증의 합성 응답은 실제 인증 추론과 명확히 구분된다.
- 변경 범위의 단위/타입/빌드/브라우저 검사 결과와 미검증 범위를 보고한다. 기존 사용자 변경을 보존하고 푸시·배포하지 않는다.
- 사용자의 실행 방식 선택 후 시작한다. 이 계획은 계약을 공유하는 네 작업이므로 이 세션에서 직접 구현하는 방식이 적합하다. 사용자 지침에 따라 전체 테스트나 추가 의무 리뷰 체인을 붙이지 않는다.
