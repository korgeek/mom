# 정리 분량·지침만 사용·생성 가능 여부

2026-10-17 Asia/Jakarta. 기준 HEAD `f30a1d2`. [사용자 결정](../../../11-design-reference-review.md#2026-10-17-정리-분량과-추가-지침만-사용).

## 변경과 원인

- `src/react-app/ui/screens/Minutes.tsx`: 읽기 어려운 출력 예산 입력을 `정리 분량` 선택으로 바꿨다. 4K/8K/16K는 각각 4096/8192/16384를 기존 암호화 설정에 저장한다. 직접 입력의 검증/적용과 동의 해제를 유지한다. 모델 설정 한도 초과 선택지는 비활성화한다. 최대 길이·시간/비용·실제 분량의 차이를 쉬운 말로 표시하며 임의 페이지 수를 제시하지 않는다.
- 같은 화면에 `추가 지침만 사용`을 추가한다. 이 선택은 항목을 모두 끄고 기존 지침을 보존한다. 지침이 없으면 명확히 입력을 요청하고 지침이 있으면 생성할 수 있다. 선택 전사문/설정 전송·요금·음성 미재전송 확인 문구를 합치고 반복 안내를 제거한다.
- 기존에는 비활성 버튼의 많은 조건이 한 bool 식에만 있었고 항목을 모두 끄면 지침 유무와 무관하게 차단됐다. 생성 이유를 하나의 분기로 결정하고 같은 이유로 버튼을 제어한다. 전사/모델/한도/미적용 수정/동의 등 필요한 조치를 버튼 위와 aria-describedby/live status로 제공한다. 사용자의 실제 선택 상태는 읽지 않았으므로 당시 개인 환경의 원인을 단정하지 않는다.
- `src/react-app/minutes/prompt.ts`: 기존의 무조건 sections.length 검사 대신 항목 또는 비어 있지 않은 지침을 요구한다. sections=[]일 때만 지침으로 구조를 정하고 기본 항목을 추가하지 않는 규칙을 사용한다. 기존 sections 기반 system prompt의 문구/버전, 근거 준수와 불확실성·보안 규칙은 유지한다.
- `src/react-app/providers/registration-test.ts`: 같은 입력을 사용하는 모델 테스트의 초기 검사도 항목/지침 조건으로 맞췄다.
- `tests/registered-stage-ui.spec.tsx`, `tests/minutes-budget.spec.ts`, `tests/minutes.spec.ts`, `tests/ui.spec.tsx`: 프리셋/직접 입력/한도/지침만 생성/차단 이유/동의·부분 전사 보호를 선별 확인한다. 기존 최소 UI fixture의 빈 전사문은 실제 비어 있지 않은 합성 전사문으로 보완했다.
- `tests/e2e/notes-options.spec.ts`: 새 Notes 중심 흐름 하나를 별도 headed Chrome에서 실행한다. 다른 e2e의 정확한 확인 문구 및 이전 분량 입력 선택자 호출은 새 UI로 갱신만 했다.
- 문서는 이 기록과 `docs/README.md`, `docs/11-design-reference-review.md`. 기존 사용자 `App.tsx`의 두 문구 수정은 보존하고 이번 커밋에서 제외한다. 의존성 추가/키 사용/푸시/배포 없음.

## 실제 검사 명령과 결과

전체 테스트/전체 화면 검사를 실행하지 않았다. 변경된 Notes 설정·입력 검증·생성 조건·직접 영향을 받는 동의/부분 전사 검사만 수행했다.

| 명령 | 결과 |
| --- | --- |
| `npx vitest run tests/registered-stage-ui.spec.tsx tests/minutes-budget.spec.ts -t 'readable length presets\|instructions-only'` | 구현 전 RED 3 (길이 선택자/지침만 선택/요청 검증 부재). 구현 후 GREEN 3 / 11 제외 |
| `npx vitest run tests/registered-stage-ui.spec.tsx tests/minutes-budget.spec.ts tests/minutes.spec.ts tests/ui.spec.tsx -t 'readable length presets\|instructions-only\|output budget edits\|grounded prompt\|unapplied language draft\|actual blocking limit\|current snapshot token\|orders selected sections'` | 13 PASS, 기존 한도 fixture의 전사문이 비어 있어 전사부터 요구하는 1 FAIL, 112 제외. 실제 합성 발화 fixture로 보완 |
| `npx vitest run tests/ui.spec.tsx -t 'actual blocking limit\|current snapshot token\|explicit partial\|sends the reviewed notes identity\|unapplied language draft'` | 보완 후 8 PASS / 92 제외. 동의·부분 전사 보호와 버튼 조건 |
| `npx vitest run tests/registered-stage-ui.spec.tsx tests/minutes-budget.spec.ts -t 'readable length presets\|instructions-only\|output budget edits'` | 최종 해당 4 PASS / 10 제외. 실제 provider 사전 검증 및 요청 본문에 지침/빈 항목 반영, 한도 초과·지침 공백 차단 |
| `npx eslint src/react-app/ui/screens/Minutes.tsx src/react-app/minutes/prompt.ts src/react-app/providers/registration-test.ts tests/minutes.spec.ts tests/minutes-budget.spec.ts tests/registered-stage-ui.spec.tsx tests/ui.spec.tsx tests/e2e/notes-options.spec.ts tests/e2e/transcription-layout.spec.ts` | 최종 PASS. 초기 mock fetch의 미사용 인자 2개는 타입을 지정한 mock으로 보완 |
| `npx tsc -b`, `npx tsc --project tsconfig.e2e.json --noEmit` | 최종 PASS. 초기 새 mock의 빈 tuple 인덱스 타입을 fetch signature로 보완 |
| `npm run build` | 최종 PASS. 기존 미디어 혼합 import·큰 bundle 경고 유지 |
| `npm run test:secret` | PASS. 소유 소스·정적 자산·최종 client build. 일치값 미출력 |
| `npm run test:e2e -- tests/e2e/notes-options.spec.ts` | 1 PASS, 시험 2.7초/전체 4.7초. 첫 브라우저 실행에서 통과 |
| `git diff --check` | PASS |
| `node /tmp/mom-notes-length-doc-check.mjs` | 문서 3개 로컬 링크/앵커 65개 PASS, 레퍼런스 6개 SHA-256 일치 |

## 실제 브라우저

새 vault와 무인증 합성 localhost 모델만 사용했다. 준비/STT는 Notes 화면에 실제 선택 전사문을 만드는 setup으로만 사용하고 해당 화면의 전수 검사는 반복하지 않았다. HTTPS는 빈 카탈로그 외 차단하며, localhost POST만 시험이 가로챘다.

- 1440×900: 모델 선택 → 전송 확인 전 비활성 이유 → 16K에서 4K/8K 선택 → 확인 해제 → 직접 입력 한도 초과 차단 → 4096 적용 → 추가 지침만 사용/여섯 항목 해제 → 빈 지침 차단 이유 → 지침 입력 → 새 확인 → 생성/암호화 저장.
- Notes 요청은 max_tokens=4096, sections=[], 정확한 합성 지침과 선택 전사문을 포함한다. 음성을 다시 보내지 않는다. 요청은 setup STT 1회와 Notes 1회, 총 2회다.
- 360×800: 같은 설정·결과를 렌더링하고 문서/main 가로 넘침 없음을 확인했다. reload/잠금 해제 후 메모별 분량·지침·빈 항목 선택과 저장 결과를 복원했다. 추가 요청 없음, pageerror 0.
- [데스크톱 지침만 설정](1440-ko-settings.png), [좁은 화면 분량·확인·저장 결과](360-ko-result.png). 두 캡처를 직접 열어 배치·글꼴·색·문구를 확인했다.

실제 사용자 보관함·선택 모델·키는 읽지 않았고 실제 인증 추론/AI 글 품질/제공사 최종 청구는 검증하지 않았다. 물리 모바일/마이크, 장시간 음성·전체 저장/잠금 오류 행렬, 처리 기록 페이지·청크 초기화, 푸시·배포는 수행하지 않았다.
