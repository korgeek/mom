# 2026-10-21 Lucide 아이콘

사용자의 아이콘 통일 요청을 반영했다. 이전 턴의 폭 정렬·파일 업로드 기본 탭 변경은 그대로 보존했다. 로컬 작업이며 커밋·푸시·배포는 수행하지 않았다.

## 변경

- `package.json`, `package-lock.json`: 공식 `lucide-react` 1.61.0을 고정했다. 실제 사용하는 아이콘만 이름으로 import한다. 새 패키지는 1개이며 기존 React 타입 패키지의 optional peer 표시도 npm이 갱신했다.
- `src/react-app/settings/icons.ts`, `settings/lists.ts`, `ui/copy.ts`: 손으로 작성한 SVG path 대신 Lucide 컴포넌트를 연결했다. 내부 목록 이름은 `iconPaths`에서 `memoIcons`로 맞췄다. 24개 ID, 기본 9개 선택, 한국어/영어 이름과 설정 JSON 형식은 유지한다.
- `src/react-app/App.tsx`, `ui/screens/Home.tsx`, `ui/screens/Import.tsx`, `ui/components/SelectionListSettings.tsx`: 메모 아이콘, 추가·완료·홈 조작·선택 미리보기를 같은 아이콘으로 표시한다. 기존 색상과 선택값을 보존한다.
- `ui/components/MobileNavigation.tsx`, `ApiKeys.tsx`, `ChunkPlayback.tsx`, `ui/PreparationStatus.tsx`, `ui/Pagination.tsx`, `ui/UsageStatement.tsx`, `ui/screens/History.tsx`, `Minutes.tsx`, `STT.tsx`: 메뉴·재생/정지·진단·이동·순서·편집 아이콘을 교체했다. 기존 버튼의 접근성 이름·disabled·동작은 유지한다. 화면의 문자 화살표/더하기는 SVG로 표시하되 기존 접근성 이름을 유지한다.
- `ui/styles.css`, `ui/mobile-navigation.css`, `ui/components/json-response.css`, `public/icons/chevron-right.svg`: 선 굵기는 1.8, 조작 아이콘은 18px를 기준으로 맞춘다. 기존 메모/모바일 메뉴 크기와 터치 영역은 유지한다. 공통 details와 JSON 접기 표시는 Lucide에서 생성한 로컬 SVG 마스크를 사용하며 키보드 기본 동작을 유지한다. JSON의 기존 줄바꿈·종류 표시 배치는 보존한다.
- `public/THIRD_PARTY_NOTICES.txt`, `public/licenses/lucide-react-1.61.0-LICENSE.txt`: Lucide ISC 및 Feather 유래 아이콘의 MIT 원문을 패키지의 LICENSE와 바이트 단위로 동일하게 제공한다.
- `tests/ui.spec.tsx`, `tests/selection-list-settings-ui.spec.tsx`, `tests/artifacts.test.mjs`, `tests/e2e/lucide-icons.spec.ts`: 전체 메모 아이콘의 장식 처리·알 수 없는 ID 대체, 기존 선택 목록, 라이선스 배포, 실제 화면 조작을 확인한다. 변경한 선택 목록 검사 파일의 기존 unused mock 인자 4개는 타입으로 옮겨 lint 오류를 제거했다.

원본 디자인 레퍼런스, 사용자 메모/설정, 암호화 형식, 제공사 요청, 브랜드 문자 및 실제 파형 SVG는 변경하지 않았다. 제품 TSX에 직접 작성한 SVG는 파형만 남아 있다.

## 실제 검사

변경과 직접 관련된 검사만 실행했다. 같은 소스에 대한 통과 근거는 재사용했다.

```sh
npm install --save-exact lucide-react --ignore-scripts --no-audit --no-fund
npm run build
npx vite build
npx vitest run tests/settings-lists.spec.ts tests/selection-list-settings-ui.spec.tsx tests/playback-ui.spec.tsx tests/json-response.spec.tsx
npx vitest run tests/ui.spec.tsx -t 'memo icon catalog'
npx vitest run tests/json-response-ui.spec.tsx
npx vitest run tests/selection-list-settings-ui.spec.tsx
node --test tests/artifacts.test.mjs
npx playwright test --config playwright.config.ts tests/e2e/lucide-icons.spec.ts
npx playwright test --config playwright.config.ts tests/e2e/lucide-icons.spec.ts --grep '360px'
node /private/tmp/mom-lucide-gallery.mjs
npm run test:secret
git diff --check
```

- 단위 검사 42개와 배포물 검사 5개 통과. 첫 단위 명령의 JSON 파일명은 현재 파일과 달라 그 파일은 선택되지 않았고, 실제 `tests/json-response-ui.spec.tsx` 9개를 별도로 실행해 통과했다. 선택 목록 mock 타입을 수정한 뒤 해당 파일 7개만 재실행했다.
- 빌드와 최신 CSS 재빌드 성공. JS gzip 크기는 직전 빌드의 422.01kB에서 425.22kB로 약 3.21kB 늘었다. Vite의 기존 정적/동적 import 및 큰 chunk 경고는 남아 있다. 설치 시 기존 jsdom 계열 패키지의 Node 엔진 경고가 있었지만 이번 실행의 빌드와 검사들은 완료됐다.
- 별도 headed Chrome에서 1440×900, 360×900 두 검사 통과. 합성 보관함과 5초 합성 음성만 사용하고 외부 HTTPS 요청은 차단했다. 일정 아이콘 선택, 음성 준비/전사 이동, 재생·정지 아이콘, 정리 항목 순서 아이콘, 고정/해제, 모바일 메뉴, 설정 목록 9개와 접기 키보드 동작을 확인했다. [데스크톱 결과](1440.json), [모바일 결과](360.json).
- 첫 모바일 검사는 접두어가 같은 버튼 2개를 함께 찾아 실패했다. 검사 선택자를 실제 녹음 아이콘 표시 버튼으로 한정하고 모바일 항목만 다시 실행해 통과했다. 제품 코드는 이 실패로 변경하지 않았다.
- 실제 MeetingIcon/JsonResponse 컴포넌트를 렌더링한 임시 `/private/tmp/mom-lucide-gallery.mjs`에서도 1440×1000, 360×1000을 확인했다. 24개 모두 Lucide·1.8px 선 굵기이며 가로 넘침·브라우저 오류가 없었다. 긴 JSON 문자열의 접기/펼치기를 키보드로 확인했다. [수치](gallery.json). 점검 스크립트는 제품에 포함하지 않았다.
- 변경 TS/TSX 및 테스트 파일을 명시한 ESLint는 오류 0개. 기존 App Fast Refresh 및 SelectionListSettings effect cleanup 경고 2개는 남아 있다. 비밀정보 패턴 검사와 `git diff --check` 성공. 참고자료 6개 파일의 SHA-256은 작업 전과 동일하다.
- 최초 Chrome 검사 요청은 자동 승인 검토 시간 초과로 실행되지 않았다. 안내된 한 번의 동일 범위 재시도는 승인되어 검사 완료했다.

## 화면

- 홈: [1440px](1440-home.png), [360px](360-home.png)
- 전사/재생: [1440px](1440-stt.png), [360px](360-stt.png)
- 보안 설정/접기: [1440px](1440-settings.png), [360px](360-settings.png)
- [모바일 메뉴](360-menu.png)
- 전체 24개와 JSON: [1440px](1440-catalog-json.png), [360px](360-catalog-json.png)

전체 스위트, 실제 키/제공사 추론, 물리 장비 및 운영 배포는 확인하지 않았다. 실제 저장 자료를 변환하거나 삭제하지 않았다.
