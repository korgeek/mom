# 2026-10-19 화면 잠금 10초 경고

사용자 요청에 따라 화면 잠금까지 1–10초가 남으면 기존 타이머의 1px 안쪽 테두리만 2초 주기로 부드럽게 밝아졌다 흐려진다. 기존 경고색 토큰을 사용해 라이트·다크 모드를 따른다. 글자·배경·크기·위치는 유지한다. 사용자 활동으로 시간이 초기화되거나 자동 잠금을 끄면 경고가 사라진다. `prefers-reduced-motion: reduce`에서는 깜빡임 없이 경고 테두리를 표시한다.

변경 파일은 `src/react-app/ui/ScreenLock.tsx`, `src/react-app/ui/screen-lock.css`, `tests/screen-lock-ui.spec.tsx`다. 잠금·저장·키 처리 로직은 변경하지 않았다.

| 실제 명령 | 결과와 범위 |
| --- | --- |
| `npm run test:unit -- tests/screen-lock-ui.spec.tsx` | 구현 전 경고 누락 1개 실패·5개 통과, 구현 후 **6개 통과**. 남은 시간 11·10·1·60·null·0에서 경고의 진입·해제와 조용한 타이머 접근성을 확인했다. |
| `npm run build` | 종료 0. 기존 혼합 import·500 kB 초과 번들 경고가 남는다. |
| `npx eslint src/react-app/ui/ScreenLock.tsx tests/screen-lock-ui.spec.tsx` | 종료 0. |
| `node /private/tmp/mom-lock-warning-smoke.mjs` | 최종 통과. 별도 Chrome 창에서 실제 빌드 미리보기 `127.0.0.1:4177`, 격리된 합성 보관함과 Playwright 시계를 사용했다. 최초 스크립트는 화면의 1초 갱신 주기를 고려하지 않아 실패했고, 실제 표시값을 기다리도록 수정했다. 11→10초 경계, 2초 테두리 보간, 글자·배경색 불변, 위치·크기 불변, 실제 키보드 활동으로 경고 해제, 다크 테마 선택, 모바일 표시, 움직임 줄이기, 실제 자동 잠금과 타이머 제거를 확인했다. 외부 요청 0, 페이지 오류 0. |

실제 렌더링은 데스크톱 라이트 1440×900과 모바일 다크 390×844다. 스크린샷은 테두리 애니메이션을 밝은 중간 지점에 멈춰 촬영했다. 0ms·1000ms의 실제 계산 스타일로 테두리만 달라지는 것을 검사했다. [브라우저 결과](browser-results.json), [데스크톱](desktop-warning.png), [모바일 다크](mobile-dark-warning.png).

전체 테스트 스위트·다른 브라우저·운영 배포는 실행하지 않았다. 실제 키·회의 자료·유료 요청은 사용하지 않았다. 앞선 STT 예시 갱신 커밋 위의 별도 로컬 변경이다.
