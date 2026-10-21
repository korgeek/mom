# 전사 좌우 배치와 청크 조작 정렬 · 변경 영향 검증

2026-10-17 Asia/Jakarta. 기준 HEAD `b68a216`. [사용자 결정](../../../11-design-reference-review.md#2026-10-17-전사-좌우-배치와-청크-상태-정리).

## 변경 범위

- `src/react-app/ui/screens/STT.tsx`: 왼쪽에 모델 선택/전송 전 확인, 오른쪽에 처리 상태/청크 목록/요청 이력과 해당 안내를 묶었다. 전사 검토와 사용량 명세는 아래 기존 전체 폭을 유지한다. `전사 결과 대기 중` → `전사 대기 중`, `0 / 4 저장된 결과 있음` → `전사 결과 0 / 4`로 변경한다. 분자는 기존과 동일한 저장 완료 결과 수이며 응답 수신/저장 중 결과는 세지 않는다.
- 청크 재생의 대기/정지 문구는 기존 visually-hidden 패턴으로 화면에서 숨기고 live status의 정지 알림은 유지한다. 실제 상태는 정지 시 null로 돌아가며 별도 가짜 stopped 상태를 추가하지 않는다. 재생/일시정지/불러오기/오류, 음성 삭제·보관 미확인 안내는 보인다.
- `src/react-app/ui/styles.css`: 동일 폭 2열과 기존 960px 반응형 기준의 단일 열, 모델 행 줄바꿈, 오른쪽 결과 수를 작은 13px 글씨로 표시한다. 청크 행은 번호/시간/상태 행과 조작 행으로 구분하고 재생·정지·재시도는 오른쪽에서 윗선을 맞춘다. 대기 문구의 빈 높이는 제거한다.
- `tests/stt-rerun-ui.spec.tsx`: 왼쪽 모델/확인 묶음과 오른쪽 대기 상태, 4개 청크 미실행의 `Transcript results 0 / 4`와 대기 문구 숨김 검사.
- `tests/playback-ui.spec.tsx`: idle/재생/정지/삭제 안내 표시와 접근성 상태를 확인한다. 기존 키보드 검사 fixture에 누락된 retainedAudio를 명시했다. 실제 보관 여부가 확인되지 않으면 재생을 막는 제품 규칙은 바꾸지 않는다.
- `tests/ui.spec.tsx`: 저장 중 응답을 결과 수에 포함하지 않는 기존 검사의 문구만 갱신.
- `tests/e2e/transcription-layout.spec.ts`: 기존 한 흐름에서 열 배치/위아래 쌓임·같은 카드 폭·버튼 윗선 정렬·실제 합성 음성 재생/일시정지/정지·새 결과 수 문구를 확인한다. 합성 WAV를 6초로 늘려 일시정지 조작을 확인한다. 이전 캡처를 덮지 않고 이 폴더에 보존한다.
- 문서: 이 기록과 `docs/README.md`, `docs/11-design-reference-review.md`.

제공사 호출·외부 전송·동의 토큰·재시도 범위·암호화·저장/재생 코어는 바꾸지 않았다. 기존 사용자 `App.tsx`의 암호·전송 안내 두 수정은 그대로 보존하고 이번 커밋에서 제외한다. 의존성 추가 없음.

## 검사 범위와 결과

이번 diff에 직접 영향을 받는 전사 화면의 DOM 배치, 청크 조작/상태, 결과 수 문구만 검사했다. 전체 스위트나 다른 화면을 반복 검사하지 않았다. 이전 동일 제어 흐름의 동의/재시도/키 누락 안전 검사 근거는 재사용한다.

| 명령 | 결과 |
| --- | --- |
| `npx vitest run tests/playback-ui.spec.tsx -t 'offers keyboard accessible'` | 구현 전 기존 시험 FAIL: fixture에 보관 음성 정보가 없어 재생 버튼이 차단됨. fixture 보완 후 아래 선별 검사에서 PASS |
| `npx vitest run tests/stt-rerun-ui.spec.tsx tests/playback-ui.spec.tsx -t 'keeps the initial model selector visible\|hides idle playback'` | RED 2: 기존 대기 문구와 보이는 정지 상태. 구현 후 관련 3건 GREEN |
| `npx vitest run tests/stt-rerun-ui.spec.tsx tests/playback-ui.spec.tsx -t 'keeps the initial model selector visible\|hides idle playback\|offers keyboard accessible'` | 3 PASS / 8 제외 |
| `npx vitest run tests/stt-rerun-ui.spec.tsx tests/playback-ui.spec.tsx tests/ui.spec.tsx -t 'keeps the initial model selector visible\|four untouched chunks\|hides idle playback\|offers keyboard accessible\|derives STT progress'` | 5 PASS / 107 제외 |
| `npx vitest run tests/playback-ui.spec.tsx -t 'hides idle playback'` | 실제 null 정지 상태에 맞춘 마지막 보완 후 해당 1 PASS / 3 제외. 다른 동일 제어 흐름 시험은 반복하지 않음 |
| `npx eslint src/react-app/ui/screens/STT.tsx tests/stt-rerun-ui.spec.tsx tests/playback-ui.spec.tsx tests/ui.spec.tsx tests/e2e/transcription-layout.spec.ts` | 최종 오류/경고 0 |
| `npx tsc --project tsconfig.e2e.json --noEmit` | 최종 PASS |
| `npm run build` | 최종 PASS. 최초에는 playback의 stopped 타입이 존재하지 않아 새 비교/fixture 타입 오류 3개. 실제 null 상태를 그대로 이용하도록 보완. 기존 미디어 혼합 import·큰 bundle 경고 유지 |
| `npm run test:secret` | 최종 PASS. 소유 app 소스·공개 자산·최종 client build, 일치값 미출력 |
| `npm run test:e2e -- tests/e2e/transcription-layout.spec.ts` | 별도 headed Chrome 1 PASS (시험 2.4초/전체 4.3초). 이 변경에서 브라우저 1회 실행, 실패 없음 |
| `git diff --check` | PASS |
| `node /tmp/mom-stt-columns-doc-check.mjs` | 로컬 문서 3개의 링크·앵커 64개 PASS. 레퍼런스 원본 6개 SHA-256 일치 |

## 실제 브라우저 확인

최종 preview `127.0.0.1:4174`, 별도 보이는 Chrome. 한국어 1440×900 대기 → 같은 화면 360×800 대기 → 1440×900 상세 펼침/접힘 → 재생/일시정지/정지 → 합성 전사 요청 중/취소. 캡처를 직접 열어 정렬·문구·글꼴·팔레트와 가로 넘침 없음을 확인했다. 모바일 실기기는 사용하지 않았다.

- [1440px 좌우 배치와 대기 상태](1440-ko-confirmation.png)
- [360px 동일 폭 단일 열](360-ko-confirmation.png)
- [상세 펼침](1440-ko-details.png)
- [일시정지 중 버튼 윗선 정렬](1440-ko-paused.png)
- [합성 요청 중](1440-ko-requesting.png)

시험용 두 무인증 호환 모델과 합성 WAV의 실제 로컬 준비·실제 브라우저 음성 재생을 사용했다. 모델 선택 시 확인 해제, 확인 전 자동 요청 0, 명시적 실행 후 모델 B 요청 1, 처리 중 선택/확인/실행 차단, 취소도 기존 한 흐름에서 함께 확인했다. `pageerror` 0. STT endpoint는 Playwright가 localhost 시험 요청만 가로채며 HTTPS는 빈 시험 카탈로그 외 차단한다. 실제 키·외부 모델 서버·인증된 추론의 근거가 아니다. 설정 화면 경유는 fixture 준비이며 설정 전체 검증이 아니다.

4청크 미실행의 결과 수와 네 개 대기 문구 숨김은 단위 DOM 시험으로 확인했다. 실제 브라우저는 1청크이며 4청크 장시간 파일을 별도로 처리하지 않았다. 미실행·일시정지·처리 중 외 모든 화면/상태 전수검사, 물리 마이크·실사용 음성·실제 제공사 전사·푸시·배포는 수행하지 않았다.
