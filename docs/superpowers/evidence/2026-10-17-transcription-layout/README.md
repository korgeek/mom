# 전사 화면과 MoM 타이틀 · 변경 영향 검증

2026-10-17 Asia/Jakarta. 기준 HEAD `a72a746`. [사용자 결정](../../../11-design-reference-review.md#2026-10-17-전사-화면과-제품-타이틀-정리).

## 변경 범위

- `src/react-app/ui/screens/STT.tsx`: 상단 오른쪽에 항상 보이는 모델 선택. 반복된 선택 모델명·주소와 일반 설명 제거, 비활성 사유 유지. 전사에 관계없는 정리 노트·복사/다운로드 문단 제거. 제공사 전송·보관·요금 안내는 한 문단으로 정리. 왼쪽 확인/오른쪽 실행, 재시도 모달의 액션 오른쪽 정렬. 모델 선택 변경 즉시 기존 확인 해제. 처리 진행률 미확인 안내는 처리 중에만 표시.
- `src/react-app/ui/styles.css`: 전사 모델/확인/실행 행의 정렬과 좁은 화면 줄바꿈만 추가.
- `src/react-app/App.tsx`: 사이드바와 보관함의 제품 타이틀만 `Minutes of Meeting`으로 변경. 기존 사용자 암호/전송 안내 수정 두 곳은 그대로 보존하고 그 두 변경을 커밋에서 제외한다.
- `index.html`: 브라우저 탭 타이틀 `MoM`.
- `tests/stt-rerun-ui.spec.tsx`: 펼치지 않아도 모델 선택 가능, 확인 전 실행 차단, 모델 변경 이벤트 즉시 확인 해제, 전사 전용 설명과 실제 콜백 없음 검사 추가.
- `tests/ui.spec.tsx`: 모델 선택 펼침 동작 제거 및 보관함 타이틀 기대 변경. `tests/e2e/helpers.ts`, `workflow.spec.ts`, `preparation-progress.spec.ts`는 모델 펼침 호출 제거, `copy-placement.spec.ts`, `responsive.spec.ts`, `vault-reset.spec.ts`는 타이틀 기대만 갱신. 이 기존 E2E 전체를 실행하지 않고 타입·린트로 확인했다.
- `tests/e2e/transcription-layout.spec.ts`: 실제 브라우저의 전사 화면 한 흐름. 시험에서만 두 인증 없는 합성 호환 모델을 설정하고 로컬 합성 전사 요청을 가로챔. 실제 모델 서버·키·제공사 추론 없음.
- 문서: 이 기록과 `docs/README.md`, `docs/11-design-reference-review.md`.

컨트롤러·제공사 어댑터·저장/암호화·원시 전사와 버전 처리·전송 payload·과금 계산은 바꾸지 않았다. 최초/재시도 토큰, 원래 묶음 모델/언어, 보관 정책과 키 누락 차단을 유지한다. 실제 STT/회의록 품질이나 인증된 추론을 검증한 변경이 아니다.

## 실행한 관련 검사

| 명령 | 결과 |
| --- | --- |
| `npx vitest run tests/stt-rerun-ui.spec.tsx -t 'keeps the initial model selector visible'` | RED 1: 모델 선택이 details 안에 있음. 구현 후 GREEN. 마지막 정상 모델 note 제거 후 해당 1건만 다시 PASS |
| `npx vitest run tests/stt-rerun-ui.spec.tsx` | 7 PASS. 이 STT UI 파일의 최초/재시도 동의·고정 모델·키 누락·이전 자료 보존 |
| `npx vitest run tests/openrouter-stt-ui.spec.tsx -t 'managed presend\|invalidates presend\|OR_STT_review blocked\|unavailable advertised\|frozen original retry'` | 9 PASS / 11 제외. 전송 정보/정책·미확인 비용·선택 변경 확인·원래 재시도 조건 |
| `npx vitest run tests/registered-stage-ui.spec.tsx -t 'custom STT endpoint'` | 1 PASS / 3 제외. 등록 모델의 실제 엔드포인트/ID와 준비된 전사 확인 |
| `npx vitest run tests/ui.spec.tsx -t 'labels direct OpenAI in the Transcribe\|does not enable transmission\|hides test-build'` | 2 PASS / 97 제외. 직접 OpenAI 표기와 모델/준비 미완료 차단. 마지막 필터 항목은 일치하는 시험이 없음 |
| `npx vitest run tests/ui.spec.tsx -t 'omits the build banner.*ko/(new\|locked)$'` | 2 PASS / 97 제외. 새/잠긴 보관함 타이틀과 민감한 내용 숨김만 선별 |
| `npx eslint src/react-app/App.tsx src/react-app/ui/screens/STT.tsx tests/ui.spec.tsx tests/stt-rerun-ui.spec.tsx tests/e2e/helpers.ts tests/e2e/workflow.spec.ts tests/e2e/preparation-progress.spec.ts tests/e2e/copy-placement.spec.ts tests/e2e/responsive.spec.ts tests/e2e/vault-reset.spec.ts` | 오류 0. App의 기존 Fast Refresh 경고 1개 유지. 새 E2E와 후속 수정한 STT는 해당 파일만 추가 검사해 오류 0 |
| `npx tsc --project tsconfig.e2e.json --noEmit` | 최종 PASS |
| `npm run build` | 최종 PASS. 기존 미디어 혼합 import·큰 client bundle 경고 유지 |
| `npm run test:secret` | 최종 PASS. 소유 소스·공개 자산·최종 client build, 일치값 미출력 |
| `npm run test:e2e -- tests/e2e/transcription-layout.spec.ts` | 최종 1 PASS (4.0초). 최초에는 별도 시점의 좌표 측정에서 7.5px 차이로 FAIL. 화면에서는 정렬돼 있어 두 좌표를 같은 브라우저 시점에 읽도록 시험을 보완한 뒤 통과. 실패를 제품 고장 수정으로 집계하지 않음 |
| `git diff --check` | PASS |
| `node /tmp/mom-stt-layout-doc-check.mjs` | 로컬 문서 3개의 링크·앵커 56개 PASS. 레퍼런스 원본 6개의 SHA-256 일치 |

관련 단위 21건과 별도 headful Chrome의 한 흐름만 확인했다. 바뀌지 않은 전체 제품·다른 화면·기존 대형 E2E 행렬은 반복하지 않았다. 마지막 note 제거는 제어 흐름을 바꾸지 않아 기존 안전 검사 근거를 재사용하고 직접 영향 시험 1건과 최종 빌드/브라우저만 재실행했다.

## 실제 브라우저에서 확인한 것

`127.0.0.1:4174`의 최종 preview build. 한국어, 1440×900 → 같은 전사 화면 360×800 → 다시 1440×900. 모델 설정은 시험 입력을 준비하기 위한 경유이며 설정 전체를 검증하지 않았다.

두 인증 없는 합성 모델 설정 → 시험 WAV 실제 로컬 준비 → 전사 화면에서 펼침 없는 모델 선택 → 확인 전 실행 차단 → 확인 후 활성화 → 모델 변경 즉시 확인 해제/실행 차단/자동 요청 0 → 같은 시점에서 모델 선택과 실행의 오른쪽 끝 일치, 체크박스 왼쪽, 가로 넘침 없음 → 새 확인 후 명시적 실행에서 합성 모델 B 요청 1건만 발생 → 처리 중 선택/확인/실행 비활성화 → 취소. 보이는 고정 결과를 주입하지 않았고 실제 외부 서비스나 모델에 요청하지 않았다. 앱 사이드바 `Minutes of Meeting`과 `document.title === 'MoM'`도 확인했다. 캡처를 직접 열어 확인했다.

- [데스크톱 전송 확인](1440-ko-confirmation.png)
- [360px 전송 확인](360-ko-confirmation.png)
- [합성 요청 중 선택/실행 차단](1440-ko-requesting.png)

실제 API 키·인증된 전사·물리 마이크·실사용 음성·전체 회귀·푸시·배포는 확인하지 않았다.
