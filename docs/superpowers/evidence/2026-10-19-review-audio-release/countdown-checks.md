# 데스크톱 잠금 카운트다운 위치 변경 — 2026-10-19

데스크톱에서 남은 시간 안내를 왼쪽 ‘화면 잠금’ 버튼 바로 위로 배치했다. 기존 반응형 경계에 따라 1100px 이하는 원래의 본문 상단 위치를 유지한다. 문구·잠금 정책·시간 계산 코드는 수정하지 않았다.

원래 체크아웃 `/Users/jinik/workspace/mom`은 별도의 라이선스 커밋 `e941131`이 있는 상태로 보존했다. 최신 원격 `c4076fe6a11d974eeb3c6ceda0fa5f56541927bb`를 기준으로 `/Users/jinik/.codex/worktrees/desktop-lock-countdown/mom`, `codex/desktop-lock-countdown` 브랜치에 변경했다. 커밋·푸시·배포하지 않았다.

변경 파일:

- [App.tsx](/Users/jinik/.codex/worktrees/desktop-lock-countdown/mom/src/react-app/App.tsx:291): 데스크톱 잠금 버튼 앞에 기존 상태 컴포넌트 재사용.
- [screen-lock.css](/Users/jinik/.codex/worktrees/desktop-lock-countdown/mom/src/react-app/ui/screen-lock.css:7): 데스크톱에서 본문 안내를 숨기고 사이드바 안내를 버튼 폭에 맞춰 가운데 정렬.
- [screen-lock-ui.spec.tsx](/Users/jinik/.codex/worktrees/desktop-lock-countdown/mom/tests/screen-lock-ui.spec.tsx:23): 미디어쿼리를 적용하지 않는 jsdom에서 두 표시 위치의 내용과 접근성 속성을 확인하도록 기존 검사 조정.

## 검증

동일한 기존 의존성을 임시 심볼릭 링크로 재사용했다. 제품 의존성을 설치하지 않았다. 별도 headed Chrome 창과 폐기 가능한 합성 보관함을 사용했고 모든 외부 HTTPS 요청을 차단했다. 실제 사용자 보관함·API 키·AI 추론을 사용하지 않았다.

| 명령 | 결과 |
| --- | --- |
| `npm run dev -- --host 127.0.0.1 --port 4176 --strictPort` | 분리 작업 공간의 개발 화면 제공. 검증 후 종료. |
| `node /private/tmp/mom-lock-layout-check.mjs before` | 변경 전 1440×900, 1101×900, 1100×844, 390×844, 360×844 캡처. 원본 standalone도 실제 렌더링. 초기 검사 스크립트가 모바일의 숨겨진 잠금 버튼을 기다리던 문제를 고친 뒤 성공. |
| `node /private/tmp/mom-lock-layout-check.mjs after` | 같은 5개 너비에서 통과. 데스크톱 안내와 버튼의 좌우 정렬·위아래 간격, 모바일 원래 위치, 접근성 트리의 타이머 1개, 가로 넘침 없음, 실제 1초 감소·수동 잠금·해제·60초 만료 잠금 확인. pageerror 0. |
| `npx eslint src/react-app/App.tsx && npx tsc -b` | 종료 코드 0. 기존 `react-refresh/only-export-components` 경고 1건. |
| `npx vitest run --config /private/tmp/mom-lock-placement.vitest.config.mts tests/screen-lock-ui.spec.tsx --testNamePattern 'always exposes the seconds counter'` | 영향받은 기존 검사 조정 후 선택한 1건 통과. 선택하지 않은 4건 미실행. 공유 의존성 경로를 임시 설정에 허용하기 전 실행은 wasm 경로 해석 단계에서 중단됐다. |
| `npx eslint tests/screen-lock-ui.spec.tsx` | 종료 코드 0. |
| `npx playwright test --config /private/tmp/mom-lock-placement.playwright.config.mts screen-lock.spec.ts --grep 'inactivity uses'` | 기존 검사 미통과. 수정본은 휠 이벤트의 `deltaY`가 예상 240 대신 480으로 관찰돼 중단됐다. 재실행도 같은 실패. |
| 같은 Playwright 검사에 `--output /private/tmp/mom-lock-countdown/baseline-e2e` 추가, 두 제품 파일만 원격 기준 코드로 임시 복원 | 기준 코드도 미통과. 휠 검사는 지나갔지만 현재 UI에서 제거된 ‘보관함 키 참조를 해제했어요’ 문구를 기다리다 실패했다. 종료 후 수정본 두 파일을 `finally`에서 복원했다. 동일한 휠 실패를 기준 코드에서 재현하지 못했으므로 그 원인을 확정하지 않는다. |
| `git diff --check` 및 추적된 원본 파일과 SHA-256 비교 | 공백 오류 없음. `docs/design-reference/`의 원본 6개 해시 변경 없음. |

모바일의 변경 전후 타이머 위치는 동일하며, 폰트 로딩 시점의 소수점 크기 차이는 최대 0.5px였다. 새 브라우저 검사에서는 폰트 준비 완료를 기다린다. 전체 저장소 검사, 프로덕션 빌드, 실제 인증 추론, 운영 배포·운영 화면 검증은 수행하지 않았다.

## 실제 캡처

- [데스크톱 1440px](/private/tmp/mom-lock-countdown/after-1440.png)
- [데스크톱 경계 1101px](/private/tmp/mom-lock-countdown/after-1101.png)
- [모바일 390px](/private/tmp/mom-lock-countdown/after-390.png)
- [모바일 360px](/private/tmp/mom-lock-countdown/after-360.png)
- [잠금 해제 후](/private/tmp/mom-lock-countdown/after-unlocked.png)
- [실제 좌표](/private/tmp/mom-lock-countdown/after-geometry.json)

기존 장시간 자동 잠금 회귀 검사는 통과하지 않았으므로 전체 잠금 검증 완료로 확대하지 않는다. 이번 배치와 기본 잠금 동작의 별도 검사 결과만 통과로 기록한다.
