# Mac mini 원격 업데이트와 모바일 개선 — 2026-10-17

사용자가 원격 main의 로컬 통합을 요청했고, 진행 중 모바일 개선을 추가로 승인했다. 당초 원격 push·배포는 범위 밖이었으며, 이후 병합·배포 승인과 기존 실패 수정은 아래 후속 기록을 따른다. 실제 AI·자격증명 변경은 수행하지 않는다. [짧은 설계](../../specs/2026-10-17-mobile-ui-design.md)를 먼저 기록하고 헤더/설정 구현과 독립 QA의 파일 담당을 분리했다.

## 로컬 업데이트

- 갱신 전 `main`: `c003d0f28729384d84208ebc84172ab8ff62dc20`.
- fetch한 `origin/main`: `888ca3dcaf7ef3e8753419d9216d23ff8bb934c4`. 로컬 전용 커밋 0개, 원격 24개 앞섬. `git merge --ff-only --no-stat 888ca3dcaf7ef3e8753419d9216d23ff8bb934c4`로 충돌 없이 통합했다. 원격 읽기 재확인도 같은 SHA다.
- 본 폴더와 기존 작업트리 4개는 시작 때 clean이었다. 기존 브랜치/HEAD/작업트리를 유지했고 `archive/mom-before-update-20261017`에 갱신 전 SHA를 보존했다. 과거 로컬 커밋 `0e95b42`, `4bc79a4`, `b126c58`은 모두 main의 조상으로 남는다.
- `npm ci --ignore-scripts --no-audit --no-fund --cache /tmp/mom-update-20261017-0m1lyioi/npm-cache`: 303개 패키지 설치. 설치본과 lockfile의 Vite 7.3.7 / Cloudflare plugin 1.64.0 / Wrangler 4.151.1 일치. Node 26.5.0, npm 12.0.1. 별도 설치 스크립트나 보안 설정을 변경하지 않았다.
- main은 위 원격과 0 ahead/0 behind로 유지한다. 모바일 결과는 `.worktrees/mom-mobile-ui`, `feat/mobile-ui-20261017`에 별도 로컬 커밋한다. 원격과 모바일 브랜치의 차이를 혼동하지 않는다.

## 모바일 변경

제품 파일은 `App.tsx`, `ui/components/MobileNavigation.tsx`, `ui/mobile-navigation.css`, `ui/screens/Settings.tsx`, `ui/styles.css`와 세 펼치기 요소의 클래스만 추가한 `ui/screens/STT.tsx`, `ui/components/ModelRegistrations.tsx`, `ui/components/ApiKeys.tsx`다. 전체 경로는 [변경 파일 목록](changed-files.txt)에 남긴다.

- 759px 이하에서 브랜드/홈과 우측 ⋯를 한 줄로 표시한다. 처리 기록·설정·잠금을 SVG 아이콘과 텍스트로 제공하고 기존 busy/recording 조건과 잠금 컨트롤러를 사용한다. Tab/Enter, Escape, 바깥 터치/초점, 탐색 후 제목 초점, 잠금 시 DOM 제거를 확인했다.
- 설정 탭은 한 줄 스크롤이며 44px 터치 영역을 제공한다. 선택·언어 변경·resize 때 활성 탭을 노출한다. 기존 화살표/Home/End와 단일 tab stop을 유지한다.
- 모바일 보안 설명은 라벨 위/본문 아래로 표시한다. 보안 문구는 전후 동일하다. 입력 글자 16px, 모달의 동적 높이와 하단 safe-area 여백을 적용했다.
- QA가 발견한 전사 요청 이력·모델 고급 설정·키 보관 옵션의 펼치기 영역만 `19→44px`로 넓혔다. native marker와 터치/Space 토글을 유지한다. PC의 이 세 영역은 기존 크기를 유지한다.
- 기존 E2E의 앱 탐색 호출은 공통 `clickAppAction`으로 모바일 메뉴를 거치도록 갱신했다. 테스트가 새 메뉴를 우회해 상태를 주입하지 않는다. 별도 소스/데이터/제공사 경로 변경이나 의존성 추가는 없다.

## 실제 화면

별도 보이는 sandboxed Chrome의 새 합성 보관함에서 360×800, 390×844, 430×932, 1440×900을 렌더링했다. Home, 가져오기/준비, 전사 전/후, 정리 전/후, 처리 기록, 모델/보안 설정, 모델/API 키 모달, 잠금을 확인했다. 390×430은 줄어든 화면 높이와 입력 초점의 모사다.

| 항목 | 수정 전 | 수정 후 |
| --- | --- | --- |
| 모바일 헤더 | 157px, 세 줄 | 61px, 한 줄 |
| 모바일 설정 탭 | 91px, 두 줄 | 51px, 한 줄 |
| 보안 설명 | 라벨 약 59px 옆에 본문 | 라벨 위/본문 아래 |
| 발견한 펼치기 터치 영역 3개 | 19px | 44px |
| 1440px PC 탭 | 41px | 41px |

1440px Home geometry는 전후 동일하고 PC 보안 설명 배치도 유지된다. 문서/본문/모달 가로 넘침은 발견되지 않았다. 탭과 기존 정리 결과 표는 각각의 스크롤 영역 안에서 이동한다. 390×430 최종 키 모달은 y=16, 높이 398px로 화면 안에 있고, 초점 입력은 44px 높이/16px 글자다. [측정 요약](metrics-summary.json).

대표 합성 캡처: [390px 수정 전](before-390-security.png) · [390px 수정 후](after-390-security.png) · [⋯ 메뉴](after-390-menu.png) · [360px 준비](after-360-prepared.png) · [430px 정리](after-430-notes.png) · [1440px PC](after-1440-security.png) · [390×430 입력](after-390-key-short.png) · [44px 펼치기](after-390-stt-touch.png).

위 캡처를 직접 시각 확인했다. 첫 화면 대조 뒤 펼치기 3곳만 추가 변경되어 해당 390px 상태와 PC의 해당 요소만 새 빌드로 다시 확인했다. 나머지 동일 코드/스타일의 통과 근거는 재사용했다. 전체 로그·추가 화면·초기 실패·명령은 로컬 `.superpowers/mobile-ui/QA-REPORT.md`와 같은 폴더에 보존한다. 제공된 실제 사용자 참고 이미지는 같은 폴더의 `reference/3470.jpg`에만 유지하며 이 문서에 복제하지 않았다.

## 명령과 결과

| 실제 명령/범위 | 결과 |
| --- | --- |
| `npm run test:unit -- tests/mobile-navigation.spec.tsx` | RED 12 실패 → GREEN 12 통과 |
| `npx vitest run tests/mobile-settings.spec.tsx` | 초기 reveal 3 실패 후 수정, resize 포함 최종 7 통과 |
| `npx vitest run tests/mobile-settings.spec.tsx tests/api-keys-ui.spec.tsx tests/vault-reset-ui.spec.tsx` | 당시 새 6 + 기존 20 통과. 새 resize 검사는 위 최종 7개에 포함 |
| `npx vitest run tests/ui.spec.tsx -t 'Settings\|settings\|appearance\|security'` | 기존 관련 25 통과, 나머지 제외 |
| `node node_modules/vitest/vitest.mjs run tests/ui.spec.tsx -t 'disables native workflow and sidebar navigation' --maxWorkers=1` | 새 메뉴를 통해 잠금에 접근하려면 trigger는 busy 중에도 활성이어야 함. 기존 assertion 1 실패를 조정한 뒤 1 통과/99 제외. 메뉴 안 탐색 비활성·잠금 활성은 신규 검사에서 유지 |
| `node node_modules/typescript/bin/tsc --noEmit --incremental false -p tsconfig.tests.json`; `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.e2e.json` | 통과. 최종 QA 검사/탐색 호출 변경 후 E2E 타입만 재확인 |
| 변경/추가 TS·TSX 파일의 `eslint` | 오류 0. App의 기존 Fast Refresh 경고 1. 최초에는 기존 테스트의 prefer-const 1건을 발견해 해당 선언만 const로 바꾸고 그 파일만 재확인 |
| `npm run build` | 통과. 펼치기 CSS 변경으로 이전 산출물 근거를 갱신한 최종 JS `index-DGHpntqA.js`, CSS `index-Cq2W9ONi.css`. 기존 혼합 import·큰 bundle 경고 유지 |
| `npm run test:secret`; `node --test tests/artifacts.test.mjs` | 최종 공개 산출물 scan 통과; scanner 검사 3 통과. scanner 코드가 같아 그 단위 검사는 재실행하지 않음 |
| `MOM_QA_PHASE=after MOM_QA_URL=http://127.0.0.1:4187 node node_modules/@playwright/test/cli.js test --config .superpowers/mobile-ui/mobile-qa.config.mjs` | 주요 화면 4폭 시나리오 4/4 통과, 12.6초 |
| `node node_modules/@playwright/test/cli.js test --config .superpowers/mobile-ui/focused.config.mjs -g 'mobile UI at\|390px reduced-height\|phone 360 navigation keeps legal links and scrollable settings tabs reachable'` | 신규 5 + 갱신한 기존 1 시나리오. 초기 4건은 보안/저장소 dl을 함께 고른 선택자 오류로 실패, 선택자 수정 후 실패 4건만 4/4 통과(3.9초). 앞서 통과한 2건 재사용 |
| `MOM_QA_PHASE=after-touch MOM_QA_URL=http://127.0.0.1:4187 node node_modules/@playwright/test/cli.js test --config .superpowers/mobile-ui/mobile-qa.config.mjs -g 'after-touch 390\|desktop 1440 touch summaries'` | 최종 빌드의 영향 상태/PC 요약 2/2 통과, 5.9초 |
| `node node_modules/@playwright/test/cli.js test --config .superpowers/mobile-ui/focused.config.mjs -g '390px reduced-height' --output .superpowers/mobile-ui/focused/touch-results` | 최종 펼치기 터치/Space와 모달 입력의 변경된 1건만 1/1 통과, 1.6초 |
| `git diff --check`, 문서 로컬 링크, 참고 원본 6개 SHA-256 | 통과. macOS의 분해/조합 한글 경로 표기 차이는 Unicode 정규화 후 비교했고 파일 바이트는 동일 |

원격 통합 단계에서는 변경된 단위 파일 31개+직접 연결된 저장/잠금 4개, 532개 중 **527 통과/5 실패**였다. `playback-ui`의 원본 미리듣기 2개는 이전 c003d0f에서도 실패한다. `ui`의 처리 기록 1개는 갱신 전 통과했지만 새 상세 화면 선택 계약과 다르며, 새 `preparation-reset-ui` 1개는 이전 문구, 새 `registered-stage-ui` 1개는 draft/apply 전 동작을 기대한다. 이 5개는 **모바일 변경 전 원격 기준선 실패**로 보존하며 모바일 검사 통과로 재분류하지 않는다. 원격 통합의 별도 Chrome 33/33, build/types/artifacts 통과 기록은 `/tmp/mom-update-20261017-0m1lyioi/UPDATE-RESULT.md`에 있다. 동일 전수 테스트를 반복하지 않았다.

실제 사용자 보관함/키/음성이나 유료 AI를 사용하지 않았다. 합성 STT/정리 응답은 가로챘으며 물리 휴대폰·실제 OS 키보드/IME·0이 아닌 하드웨어 safe-area·인증 추론·음성 품질·전체 브라우저/장시간 검증은 하지 않았다. QA 소유 preview만 종료했고 기존 사용자 서버·작업트리·데이터는 건드리지 않았다. 제품 전체 출시 통과를 뜻하지 않는다.

## 병합·배포 후속 승인과 기존 실패 수정

사용자가 “메인으로 머지하고 배포합시다”라고 요청하고, `888ca3d`는 MacBook 작업을 완료해 푸시한 main이며 그 뒤 작업이 없다고 확인했다. 일반 main 푸시로 기존 Cloudflare 자동 배포를 사용하고 실제 운영 자산·모바일/PC 화면을 확인하는 범위다. 강제 푸시나 실제 키·유료 AI는 사용하지 않는다. 병합된 작업과 이번 작업의 임시 자원만 정리하며 기존 미병합 작업은 보존한다.

원격 기준선의 실패 5개를 먼저 그대로 재현한 뒤 **테스트 4파일만** 수정했다. 제품 회귀는 발견되지 않았다.

- 미리듣기 2개: 소스 메타데이터만 있고 보관된 원본 표시가 빠진 fixture에 `retainedAudio`를 추가했다. 재생 조정·pause·URL 교체·해제 검사는 유지한다.
- 초기화 1개: 현재 원본 부재 경고에 맞췄다. 적용 비활성·초기화 미호출·처리 중 편집 차단 검사는 유지한다.
- 기본값/힌트 1개: 기존 즉시 저장 기대를 draft → Apply → 초기화 계획 계약에 맞췄다. 실제 인코딩 차이가 있는 기본값을 사용하고 언어·용어·맥락 보존과 즉시 저장하지 않음을 확인한다.
- 처리 기록 1개: 메모 상세를 선택한 fixture로 수정했다. 요청 adapter/model/endpoint와 실제 응답 model/provider를 구분하는 기존 6개 assertion은 그대로다.

정확히 위 5개를 이름으로 선택한 검사에서 RED 5 실패 → GREEN 5 통과, 각각 관련 없는 121개 제외였다. 이어 `npm run test:unit -- tests/playback-ui.spec.tsx tests/preparation-reset-ui.spec.tsx tests/registered-stage-ui.spec.tsx tests/ui.spec.tsx --reporter=json --outputFile=.superpowers/mobile-ui/release/integrated-unit.json`으로 **126/126 통과**했다. `node node_modules/typescript/bin/tsc --noEmit --incremental false -p tsconfig.tests.json`과 `node node_modules/eslint/bin/eslint.js tests/playback-ui.spec.tsx tests/preparation-reset-ui.spec.tsx tests/registered-stage-ui.spec.tsx tests/ui.spec.tsx`도 종료 코드 0이다. 기존 전체 검사를 반복하지 않았다. 독립 읽기 전용 검토에서 모바일 변경과 이 fixture 수정의 차단 사항은 없었다.

배포 전 마지막 main 통합 빌드·공개 산출물 검사와 배포 후 실제 응답/운영 화면 검증은 해당 단계에서 수행한다. 이 문서의 로컬 검사 결과만으로 배포 성공을 선행 주장하지 않는다. 원본 로그는 로컬 `.superpowers/mobile-ui/release/`에 있으며 작업트리 정리 전에 본 저장소의 `.superpowers/releases/`로 보존한다.

## 실행

병합 후 본 저장소에서 `npm run dev -- --host 127.0.0.1 --port 5174 --strictPort`로 실행할 수 있다. 기존 다른 프로젝트의 5173 서버는 유지했다. 실제 AI는 앱에서 사용자가 키와 전송 동의를 직접 제공하는 별도 단계다. 운영 배포 결과는 위 후속 승인에 따라 실제 검증 후 별도로 보고한다.
