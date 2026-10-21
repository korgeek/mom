# 왼쪽 메모 길이와 홈 이동 · 변경 영향 검증

2026-10-17 Asia/Jakarta. 기준 HEAD `9af2fc1`. [확정한 UI 동작](../../../11-design-reference-review.md#2026-10-17-왼쪽-메모-길이와-홈-탐색-정리).

## 변경 범위

- `src/react-app/App.tsx`의 `UnlockedApp`만 수정: 원본이 있는 메모에 실제 durationMs를 기존 `formatTime`으로 표시. 제목은 전체 접근성 이름을 유지하고 길이는 별도 설명으로 제공. 고정/최근 목록에 동일하게 적용. `홈 · 음성 메모` 메뉴 제거, 브랜드 M 아이콘/Minutes of Meeting과 `최근` 제목에 기존 홈 이동 콜백 연결. 최근은 기존 고정 제외·수정 시각순 최대 5개를 유지하며 표시 건수 추가.
- `src/react-app/ui/styles.css`: 긴 제목만 줄임 표시하고 오른쪽 작은 시간은 유지. 브랜드 버튼의 기존 모양/색 유지와 포커스·모바일 44px 높이. 홈 메뉴가 빠진 모바일의 나머지 두 메뉴를 2열로 정리.
- `tests/ui.spec.tsx`: 길이/빈 메모/최근 5개/접근성 이름/최근·브랜드 이동과 busy/recordingActive 조건. 기존 워크플로 키보드 탐색의 홈 이동도 브랜드로 갱신.
- `tests/recording-controller.spec.tsx`: 녹음 중 브랜드 탐색 가능 및 파일 입력 차단의 직접 영향 검사.
- `tests/e2e/sidebar-navigation.spec.ts`: 실제 65초 WAV → 목록 길이·긴 제목 → 최근 홈 이동 → 고정 후 길이 유지 → 빈 메모에는 시간 없음 → 브랜드 키보드 홈 이동 → 모바일 아이콘 홈 이동 한 흐름.
- E2E 호출자는 없어진 홈 메뉴 대신 브랜드 버튼을 사용하도록 갱신했다: `helpers.ts`, `recording-input.spec.ts`, `openrouter-stt.spec.ts`, `unified-model-management.spec.ts`, `responsive.spec.ts`, `model-settings.spec.ts`, `transcription-layout.spec.ts`, `home-status.spec.ts`, `preparation-progress.spec.ts`, `endpoint-limits.spec.ts`, `selection-lists.spec.ts`, `preparation-layout.spec.ts`, `model-modalities.spec.ts`, `minutes-language.spec.ts`, `workflow.spec.ts`, `model-selection-settings.spec.ts`, `copy-placement.spec.ts`. 이 기존 시나리오들은 전체 실행하지 않고 타입/린트 검사만 했다.
- 문서: 이 기록과 `docs/README.md`, `docs/11-design-reference-review.md`.

컨트롤러의 홈 이동·녹음 차단/정리·잠금·저장·외부 요청은 바꾸지 않았다. 새로운 상태·타이머·라이브 길이 추정은 없다. 원본이 없는 메모에 가짜 `00:00`을 붙이지 않는다. 한 시간 넘는 길이도 제목과 동일하게 누적 분:초(예: `90:01`)다. 사용자의 기존 App.tsx 암호/전송 설명 두 수정은 유지하고 커밋에서 제외한다.

## 실행한 관련 검사

| 명령 | 결과 |
| --- | --- |
| `npx vitest run tests/ui.spec.tsx -t 'shows source duration beside sidebar'` | RED 1: 기존 목록에 길이 표시가 없음 |
| `npx vitest run tests/ui.spec.tsx -t 'shows source duration beside sidebar\|workflow screens plus brand Home'` | 최종 2 PASS / 98 제외. 7개 중 최근 5개·90:01·빈 메모·접근성·busy/recordingActive와 키보드 탐색 |
| `npx vitest run tests/recording-controller.spec.tsx -t 'rejects import, preparation and provider work during capture'` | 최종 1 PASS / 18 제외. 처음에는 과거 검사의 숨겨진 업로드 탭 `파일 선택` 버튼 조회가 실패. 실제 파일 입력의 disabled를 확인하도록 시험만 보완해 해당 1건 재실행 |
| `npx tsc --project tsconfig.e2e.json --noEmit` | 최종 PASS |
| `npx eslint src/react-app/App.tsx tests/ui.spec.tsx tests/recording-controller.spec.tsx tests/e2e/sidebar-navigation.spec.ts tests/e2e/recording-input.spec.ts tests/e2e/openrouter-stt.spec.ts tests/e2e/unified-model-management.spec.ts tests/e2e/helpers.ts tests/e2e/responsive.spec.ts tests/e2e/model-settings.spec.ts tests/e2e/transcription-layout.spec.ts tests/e2e/home-status.spec.ts tests/e2e/preparation-progress.spec.ts tests/e2e/endpoint-limits.spec.ts tests/e2e/selection-lists.spec.ts tests/e2e/preparation-layout.spec.ts tests/e2e/model-modalities.spec.ts tests/e2e/minutes-language.spec.ts tests/e2e/workflow.spec.ts tests/e2e/model-selection-settings.spec.ts tests/e2e/copy-placement.spec.ts` | 오류 0. App의 기존 Fast Refresh 경고 1개 유지. 후속 시험 변경은 그 파일만 재검사 |
| `npm run build` | PASS. 기존 미디어 혼합 import·큰 client bundle 경고 유지 |
| `npm run test:secret` | PASS. 소유 소스·공개 자산·최종 client build, 일치값 미출력 |
| `npm run test:e2e -- tests/e2e/sidebar-navigation.spec.ts` | 최종 1 PASS. 처음에는 시간의 접근성 설명(`전체 길이`)을 누락한 시험 텍스트 선택자가 실패. 화면에는 시간이 표시돼 있었으며 선택자를 수정해 통과. 제목 자동 저장 후에 캡처하도록 시험 대기만 추가해 같은 흐름/동일 제품 빌드 재사용 |
| `git diff --check` | PASS |
| `node /tmp/mom-sidebar-doc-check.mjs` | 로컬 문서 3개의 링크·앵커 58개 PASS. 레퍼런스 원본 6개의 SHA-256 일치 |

관련 단위 3건과 브라우저 한 흐름만 실행했다. 기존 전체 화면/전체 스위트/전체 E2E는 반복하지 않았고, 변경하지 않은 녹음 정리·잠금 경계는 [앞선 검증](../2026-10-17-recording-input/README.md)을 재사용한다.

## 실제 브라우저

별도 가시적 로컬 Chrome, `127.0.0.1:4174`의 최종 preview build. 한국어 1440×900 → 같은 메모에서 360×800. 시험용 실제 65초 WAV의 `01:05`가 목록과 제목에 일치하고, 목록 시간 글씨가 제목보다 작으며 긴 제목 오른쪽 안에 남는 것을 확인했다. 고정해도 길이 유지, 최근의 표시 건수 갱신, 원본 없는 메모의 시간 없음, 최근 클릭/브랜드 Enter/모바일 M 아이콘 클릭으로 실제 홈 이동, 홈 제목에 포커스 복귀, 모바일 버튼 높이 44px 이상·가로 넘침 없음도 확인했다. 외부 HTTPS는 빈 공개 카탈로그/차단으로 격리했고 마이크·AI·키는 사용하지 않았다. 캡처를 직접 열어 확인했다.

- [데스크톱 고정/최근 목록과 실제 길이](1440-ko-sidebar.png)
- [홈 메뉴를 뺀 모바일 탐색](360-ko-navigation.png)

물리 마이크·인증된 AI·다른 브라우저·전체 제품 회귀·푸시·배포는 확인하지 않았다.
