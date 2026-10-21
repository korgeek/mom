# 전사 모델과 전송 상세 보기 · 변경 영향 검증

2026-10-17 Asia/Jakarta. 기준 HEAD `b0ddefc`. [사용자 결정](../../../11-design-reference-review.md#2026-10-17-전사-선택과-상세-정보-간소화).

## 변경 범위

- `src/react-app/ui/screens/STT.tsx`: 최초·재시도 모델 선택은 등록 이름 또는 기존 짧은 별칭만 표시한다. 공통 메타데이터 규칙에서 오던 `제작자 확인 불가`, 경로·등록 UUID를 선택지에서 제거한다. 같은 이름은 실제 모델 ID와 등록 서버 host로 구분한다. 공유 모델 이력/제작자 판별 규칙은 바꾸지 않는다.
- 전송 전 확인은 대상 host/서비스와 요금·보관·로컬 암호화 한계만 바로 표시한다. 실제 endpoint·모델 ID·청크 수·전송 내용·측정 바이트·언어·보관 요청은 기본으로 접힌 `상세 보기`로 이동한다. OpenRouter 정보 누락, 비활성 사유·키 누락 등 실행 차단 안내는 접지 않는다.
- `예상 총비용`, 요청 전 미확인 `처리 제공사`, 미확인 공개 요금 placeholder를 제거한다. 확인된 공개 단가가 있으면 상세에만 조건부 요금으로 남기고 실제 청구와 구분한다. 동적 OpenRouter 경로와 보관 정책을 자동 완화하지 않는다는 상세 고지는 유지한다.
- 재시도 모달도 상세를 접고, 선택 범위·이전 결과 보존·원래 요청 조건·추가/중복 비용 고지와 별도 확인을 유지한다. 키보드 focus 순서에 native summary를 포함한다.
- `tests/stt-rerun-ui.spec.tsx`, `tests/registered-stage-ui.spec.tsx`, `tests/openrouter-stt-ui.spec.tsx`, `tests/ui.spec.tsx`: 짧은 선택지와 중복 이름 구분, 기본 접힘·필수 고지 노출, 미확인 항목 제거, 최초/재시도 동의·원래 모델/언어·키 누락 차단만 검사한다.
- `tests/e2e/transcription-layout.spec.ts`: 기존 전사 화면 한 흐름에 짧은 이름·상세 접힘·Enter 펼침/접힘 검사를 추가하고 캡처를 이 폴더로 변경한다.
- 사용자 후속 문구 수정: 하단의 중복 저장 설명을 제거하고 “취소해도 이미 전송된 요청에는 요금이 발생할 수 있어요. 결과를 받지 못해 다시 시도하면 중복 과금될 수 있어요.”로 줄인다. 영어도 동일하게 변경한다. 저장/취소/재시도 동작은 바꾸지 않는다.
- 문서: 이 기록과 `docs/README.md`, `docs/11-design-reference-review.md`.

컨트롤러·payload·제공사 어댑터·원시 결과·버전·암호화·저장·과금 계산은 변경하지 않았다. 실제 요청의 동의 토큰/범위는 유지한다. 처리 중에 요청 전 청크 집계가 줄어드는 것을 전송 개수로 오해하지 않도록 요약 문장의 중복 개수는 제거하고 상세와 청크 목록에 둔다. 기존 `src/react-app/App.tsx`의 사용자 암호 안내/외부 전송 안내 두 수정은 그대로 두고 이번 커밋에서 제외한다. 새 의존성은 없다.

## 실행한 관련 검사

| 명령 | 결과 |
| --- | --- |
| `npx vitest run tests/stt-rerun-ui.spec.tsx -t 'keeps the initial model selector visible'` | RED 1: 기존 긴 option 이름. 구현 후 관련 2건 GREEN |
| `npx vitest run tests/stt-rerun-ui.spec.tsx tests/registered-stage-ui.spec.tsx -t 'keeps the initial model selector visible\|custom STT endpoint'` | 최초 구현 후 2 PASS / 9 제외 |
| `npx vitest run tests/stt-rerun-ui.spec.tsx` | 7 PASS. 초기/재시도 토큰·고정 모델/언어·자료 보존·키 누락 차단 |
| `npx vitest run tests/openrouter-stt-ui.spec.tsx tests/registered-stage-ui.spec.tsx tests/ui.spec.tsx -t 'managed presend\|invalidates presend\|OR_STT_review blocked\|unavailable advertised\|frozen original retry\|custom STT endpoint\|labels direct OpenAI in the Transcribe\|does not enable transmission'` | 13 PASS / 112 제외. 직접 영향이 있는 3개 파일의 전송 정보·정책·모델 선택·차단만 선별 |
| `npx vitest run tests/stt-rerun-ui.spec.tsx tests/registered-stage-ui.spec.tsx tests/ui.spec.tsx -t 'keeps the initial model selector visible\|custom STT endpoint\|labels direct OpenAI in the Transcribe'` | Testing Library 선택자 옵션 보완 후 4 PASS / 108 제외 |
| `npx vitest run tests/stt-rerun-ui.spec.tsx -t 'offers a saved-chunk rerun'` | 재시도 접힘·고지 위치 assertion 보완 후 해당 1 PASS / 6 제외 |
| `npx eslint src/react-app/ui/screens/STT.tsx tests/stt-rerun-ui.spec.tsx tests/openrouter-stt-ui.spec.tsx tests/registered-stage-ui.spec.tsx tests/ui.spec.tsx tests/e2e/transcription-layout.spec.ts` | 최종 오류/경고 0 |
| `npm run build` | 최종 PASS. 최초에는 새 Testing Library role 선택자에 Playwright용 exact 옵션을 넣어 타입 오류 6개, 옵션 제거 후 통과. 기존 미디어 혼합 import·큰 bundle 경고 유지 |
| `npx tsc -b` | 재시도 assertion 보완 후 PASS. 이후 요약 문구 수정까지 포함해 최종 build도 PASS |
| `npx tsc --project tsconfig.e2e.json --noEmit` | 최종 PASS |
| `npm run test:secret` | PASS. 소유 app 소스·공개 자산·최종 client bundle; 일치값 미출력 |
| `npm run test:e2e -- tests/e2e/transcription-layout.spec.ts` | 최종 별도 headed Chrome 1 PASS (시험 2.0초/전체 3.6초). 마지막 요약 문구 수정 후 같은 1건만 재확인해 요청 중 잘못된 0개 청크 표기가 없음을 확인했다. 최초는 모델 선택 전에 대상 host를 기대한 시험 순서 오류로 FAIL. 미선택 상태의 안내는 정상이었으며 선택 뒤 검증하도록 보완해 이 1건만 재실행 |
| `git diff --check` | PASS |
| `node /tmp/mom-stt-details-doc-check.mjs` | 로컬 문서 3개의 링크·앵커 61개 PASS. 레퍼런스 원본 6개 SHA-256 일치 |

마지막 요약 문구 수정 후 `npx vitest run tests/stt-rerun-ui.spec.tsx -t 'keeps the initial model selector visible'`는 1 PASS / 6 제외였다. 사용자 후속 하단 문구 수정은 같은 단위 1건 PASS, 최종 build PASS, 변경 파일 3개의 eslint·E2E 타입·공개 산출물 검사 PASS, 동일 Chrome 1흐름 PASS였다. 새 문구 노출과 이전 중복 문구 제거를 확인했고 전체 안전/회귀 검사는 반복하지 않았다. 단위 검사 20건과 실제 브라우저 한 흐름만 선별했다. 반복 실행은 변경된 assertion/실패한 시험에 한정하고 동일 제품 코드의 기존 안전 검사 근거는 재사용했다. 전체 스위트·다른 화면 행렬은 실행하지 않았다.

## 실제 브라우저 확인

최종 preview build `127.0.0.1:4174`, 별도 보이는 Chrome 창. 한국어 1440×900 기본 접힘 → 같은 전사 화면 360×800 기본 접힘 → 1440×900 키보드 상세 펼침/접힘 → 요청 중 상태. 캡처를 직접 열어 글꼴·팔레트·레이아웃·문구를 확인했다.

시험에서만 인증 없는 두 합성 호환 모델 설정 → 합성 WAV 실제 로컬 준비 → 정확히 짧은 모델 이름만 표시 → 선택 전 실행 차단 → 선택 후 대상·요금/보관 고지 표시 → 확인 후 활성화 → 다른 모델 선택 시 확인 해제·자동 요청 0 → 선택/실행 오른쪽 정렬 및 가로 넘침 없음 → Enter로 실제 주소·모델 ID 펼침/접힘 → 새 확인 후 명시적 실행에서 합성 모델 B 요청 1건 → 요청 중 선택/확인/실행 차단 → 취소. `pageerror` 0.

실제 API 키나 모델 서버 없이 Playwright가 시험용 localhost endpoint만 가로챘고 외부 HTTPS는 차단했다(공개 카탈로그도 빈 합성 응답). 이 fixture는 제공사 추론 성공이나 음성 인식 품질의 근거가 아니다. 모델 설정 화면 경유는 입력 준비용이며 설정 전체 QA가 아니다.

- [1440px 기본 화면](1440-ko-confirmation.png)
- [360px 기본 화면](360-ko-confirmation.png)
- [1440px 상세 펼침](1440-ko-details.png)
- [1440px 합성 요청 중 차단](1440-ko-requesting.png)

실제 키·인증된 STT·물리 마이크·실사용 음성·전체 회귀·푸시·배포는 확인하지 않았다.
