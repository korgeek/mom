# 전사 입력·메모 정리 옵션 · 변경 영향 검증

2026-10-17 Asia/Jakarta. 기준 HEAD `67b7e71`. [사용자 결정](../../../11-design-reference-review.md#2026-10-17-전사-입력과-메모-정리-옵션).

## 구현 범위

- `src/react-app/ui/screens/STT.tsx`: 초기 전송 사실을 항상 표시한다. 메모별 사용 언어·용어·맥락 편집/적용, 지원하지 않는 값의 미전송 안내, 수정 중 실행 차단과 확인 해제를 연결했다. 재시도는 고정한 입력을 표시한다. 어려운 보관 정책 문구를 바꾸되 정책은 유지한다.
- `src/react-app/domain/types.ts`, 새 `domain/stt-settings.ts`, `media/mp3.ts`, `transcript/batches.ts`, `domain/pipeline.ts`: 선택적 전사 힌트를 암호화 프로젝트/요청 묶음에 저장하고 실제 요청에 전달한다. 용어 수·길이·제어 문자와 맥락 길이를 검사한다. 기존 묶음에 필드가 없으면 이후 메모의 힌트를 가져오지 않는다.
- `src/react-app/providers/model-registrations.ts`, `providers/registered-runtime.ts`, `providers/openai.ts`: 검토된 네이티브 prompt, 등록된 호환 서버 prompt/keywords, MAI Azure phraseList 매핑을 재사용한다. diarize 모델은 prompt를 보내지 않는다. OpenRouter 공통 prompt 지원을 가정하지 않는다. 기존 개인정보 보호 라우팅을 유지한다. 호환 서버의 실제 지원과 MAI의 Azure 외 경로 적용은 검증하지 않았다.
- `src/react-app/ui/screens/Import.tsx`: 준비 기본값 복원 시 메모의 전사 힌트를 보존한다.
- `src/react-app/ui/screens/Minutes.tsx`, `ui/styles.css`: 왼쪽 모델/설정/실행, 오른쪽 결과로 같은 폭을 사용한다. 960px 이하는 순서대로 쌓인다. 출력 언어는 설정의 관리된 목록, 앱 언어, 직접 입력을 제공한다. 직접 입력과 출력 예산은 명시적 적용으로 기존 암호화 저장 경로에 연결한다. 새 언어/예산 수정 중 단일·비교 요청을 차단하고 확인을 해제한다. 요청 옵션은 항상 표시하며 값 없는 요금/제작자/소요 시간/한도 행을 제거했다. 결과의 모델 이름은 생성 당시 snapshot을 사용한다.
- `src/react-app/minutes/preferences.ts`, `minutes/prompt.ts`, `minutes/selection.ts`, `minutes/compare.ts`, `providers/registered-runtime.ts`, `controller.tsx`: 선택적 메모별 출력 예산을 저장 경계에서 검증하고, 문맥 적합성/한도/요금 추정/동의 토큰/실제 token 필드/새 비교에 반영한다. 한도 누락·초과는 우회하지 않는다. 기존 비교는 고정한 예산을 유지한다.
- 테스트: 새 `tests/stt-input-settings.spec.ts`, `tests/minutes-budget.spec.ts`; `registered-batches`, `registered-stage-ui`, `stt-rerun-ui`, `openrouter-stt-ui`, `ui`, `unified-model-controller`의 직접 영향 검사. e2e의 모델/확인/언어 선택자 호출도 새 문구로 갱신했다. `transcription-layout` 한 흐름만 브라우저로 실행했다.
- 문서: 이 기록, `docs/README.md`, `docs/11-design-reference-review.md`, `docs/02-architecture-and-data.md`.

기존 `App.tsx`의 암호·전송 안내 두 사용자 수정은 보존하며 이 커밋에서 제외한다. 의존성 추가, 실제 키 사용, 푸시·배포 없음.

## 선별 검사

전체 스위트를 실행하지 않았다. 이전에 통과한 동일 코드의 검사는 재사용했으며, 새 출력 예산 때문에 영향을 받은 요청/동의/저장 경로만 추가했다.

| 실제 명령 | 결과 |
| --- | --- |
| `npx vitest run tests/stt-input-settings.spec.ts tests/stt-rerun-ui.spec.tsx tests/registered-stage-ui.spec.tsx` | 초기 16 PASS / Notes의 이전 URL 기대 1 FAIL. 실제 경로 표시와 기대를 맞춤 |
| `npx vitest run tests/stt-input-settings.spec.ts tests/registered-batches.spec.ts tests/registered-stage-ui.spec.tsx -t 'maps \|does not send unsupported\|bounds memo\|dispatches memo\|binds the exact registered\|custom STT\|applies memo-only\|registered Notes'` | 11 PASS / 2 제외. 모델 매핑·실제 runtime·구/신 묶음 입력 고정·수정 후 확인 |
| `npx vitest run tests/openrouter-stt-ui.spec.tsx tests/registered-runtime.spec.ts -t 'managed presend\|invalidates presend\|OR_STT_review blocked\|unavailable advertised\|frozen original retry\|executes .* STT and LLM\|preserves MAI\|shared OpenRouter preset'` | 14 PASS / 23 제외. 직접 영향 정책/요청/재시도 |
| `npx vitest run tests/ui.spec.tsx tests/registered-stage-ui.spec.tsx -t 'orders selected sections\|preserves memo hints'` | 2 PASS / 105 제외 |
| `npx vitest run tests/stt-input-settings.spec.ts tests/ui.spec.tsx -t 'combines direct OpenAI\|sends the reviewed notes identity'` | 3 PASS / 103 제외 |
| `npx vitest run tests/ui.spec.tsx -t 'configured output languages\|legacy custom language\|keyboard-typed language\|unapplied language draft\|compact known request\|blocking limit visible\|neutral disclosure\|orders selected sections'` | 12 PASS / 88 제외 |
| `npx vitest run tests/ui.spec.tsx tests/registered-stage-ui.spec.tsx -t 'configured output languages\|legacy custom language\|keyboard-typed language\|unapplied language draft\|compact known request\|blocking limit visible\|neutral disclosure\|orders selected sections\|historical requested\|endpoint prices and fit\|selected route and blocked\|connected central model\|enabled exact routes\|current snapshot token\|registered Notes\|omits unavailable'` | 새 Notes 이름 검증 2 PASS. UI 시험 편집 중 History의 비동기 선언 누락으로 수집 실패; 이를 고친 뒤 아래 선별 재검사 |
| `npx vitest run tests/ui.spec.tsx -t 'configured output languages\|legacy custom language\|keyboard-typed language\|unapplied language draft\|compact known request\|blocking limit visible\|neutral disclosure\|orders selected sections\|historical requested\|endpoint prices and fit\|selected route and blocked\|connected central model\|enabled exact routes\|current snapshot token'` | 17 PASS / 같은 이름의 region과 select를 함께 찾은 selector 3 FAIL / 80 제외. combobox 역할로 좁힘 |
| `npx vitest run tests/ui.spec.tsx -t 'connected central model\|selected route and blocked\|same enabled exact routes'` | 보완한 3 PASS / 97 제외 |
| `npx vitest run tests/minutes-budget.spec.ts tests/registered-stage-ui.spec.tsx -t 'saved per-memo\|blocks invalid budgets\|output budget edits'` | 3 PASS / 8 제외. 실제 요청 예산·원래 모델 보존·한도/누락 차단·적용/새 확인 |
| `npx vitest run tests/controller.spec.tsx tests/ui.spec.tsx -t 'matching completion-only single endpoint\|unapplied language draft\|current snapshot token\|actual blocking limit'` | UI 5 PASS. 오래된 controller fixture가 예산 설정 전 STT 선택 ID 검증에서 실패. 해당 fixture의 시도한 변경은 철회하고 현재 등록 모델 통합 경로를 아래에서 확인함 |
| `npx vitest run tests/unified-model-controller.spec.tsx -t 'executes openai-compatible transcription → openai-compatible notes'` | 1 PASS / 18 제외. 실제 vault를 통한 예산 저장·기존 동의 거절·512 token 실제 요청·잠금/해제 복원 |
| `git diff --name-only -- '*.ts' '*.tsx' \| rg -v '^src/react-app/App.tsx$' \| xargs npx eslint` 및 `npx eslint src/react-app/domain/stt-settings.ts tests/stt-input-settings.spec.ts tests/minutes-budget.spec.ts` | 소유 변경 파일만 검사. 마지막 E2E assertion의 불필요한 quote escape 4개 수정 후 `npx eslint tests/e2e/transcription-layout.spec.ts` PASS. assertion 문자열 값은 동일하여 브라우저 재실행 없음 |
| `npx tsc -b`, `npx tsc --project tsconfig.e2e.json --noEmit` | 최종 PASS. 초기 UI 이동/미사용 import/타입 오류는 수정함 |
| `npm run build` | 최종 PASS. 기존 미디어 혼합 import·큰 bundle 경고 유지 |
| `npm run test:secret` | 최종 PASS. 소유 앱 소스·공개 자산·최종 build. 일치값 미출력 |
| `npm run test:e2e -- tests/e2e/transcription-layout.spec.ts` | 최종 별도 headed Chrome 1 PASS, 시험 3.0초/전체 5.1초. 용어·맥락·언어·출력 예산 실제 요청과 렌더링 |
| `git diff --check` | PASS |
| `node /tmp/mom-input-notes-doc-check.mjs` | 문서 4개의 로컬 링크/앵커 72개 PASS, 레퍼런스 원본 6개 SHA-256 일치 |

초기 브라우저의 Notes 합성 모델에 필수 한도가 누락돼 실행이 막혔다. 제품 차단을 유지하고 fixture에 context 8192/output 512를 명시한 뒤 그 한 흐름만 재실행했다. 이후 언어/예산 사용자 요청 반영으로 같은 변경 흐름을 갱신했으며 다른 화면 전수검사는 하지 않았다.

## 실제 브라우저와 한계

별도 보이는 Chrome, 최종 preview `127.0.0.1:4174`. 합성 6초 WAV의 실제 로컬 준비 → 전사 입력 저장 → reload/잠금 DOM 제거 → 해제/복원 → 언어·용어·맥락이 포함된 시험 STT 요청 1회 → 저장된 전사문 → 영어 출력/384 token 예산 적용 → 시험 Notes 요청 1회 → 저장 결과. 외부 HTTPS는 빈 공개 카탈로그 외 차단하고 localhost만 Playwright가 가로챘다. 실제 키/실제 서버 추론/실사용 자료는 없다. 요청 총 2개이며 Notes 요청은 음성을 다시 보내지 않는다. pageerror 0.

1440×900의 좌우 배치와 360×800의 같은 폭 단일 열을 실제 렌더링했다. 설정·결과/버튼 정렬, 글꼴·색·문구, 가로 넘침 없음, 생성 후 결과가 보이는 위치, 초기 확인 해제와 실행 차단을 확인했다. 캡처를 직접 열어 확인했다.

- [데스크톱 전송 확인과 실제 입력](1440-ko-confirmation.png)
- [좁은 화면 전송 확인](360-ko-confirmation.png)
- [전사 요청 중](1440-ko-requesting.png)
- [Notes 생성 전](1440-ko-notes-empty.png)
- [데스크톱 Notes 결과](1440-ko-notes-result.png)
- [좁은 화면 언어·예산·요청 옵션·결과](360-ko-notes-result.png)

물리 모바일/마이크, 장시간 음성, 전체 잠금/저장 오류/멀티탭 행렬, 실제 인증 추론과 품질 향상, 최종 제공사 청구, 운영 배포는 확인하지 않았다. 사용량 명세의 기존 상세 기록과 비용 불명확 상태는 이번 모델 선택/설정 정리 범위 밖이라 보존한다. 전사 힌트를 보내는 요청 형식을 확인했으며 정확도 향상 자체를 검증했다고 주장하지 않는다.
