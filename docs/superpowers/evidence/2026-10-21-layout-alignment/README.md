# 2026-10-21 폭 정렬·업로드 기본 탭

사용자의 화면 수정 요청과 첨부한 전사 화면을 기준으로 변경했다. 실제 키·회의 자료는 사용하지 않았다.

## 변경 범위

- `src/react-app/ui/screens/Minutes.tsx`: 단계별 사용량 명세를 정리 결과 열 아래에 배치한다.
- `src/react-app/ui/screens/Settings.tsx`, `src/react-app/ui/styles.css`: 저장소 관리를 보안 설정 왼쪽 카드 열로 이동하고 제목을 주변 카드와 같은 14px/600으로 맞춘다. 접근성 제목과 저장·삭제 동작은 유지한다.
- `src/react-app/ui/screens/stt-review.css`: 300px 고정 왼쪽 열과 결과 열 span 해제 규칙을 삭제한다. 기존 공통 3분할 그리드와 오른쪽 2칸 span을 재사용한다.
- `src/react-app/ui/screens/Import.tsx`: 새 메모의 idle 녹음 상태에서도 업로드를 기본 선택한다. 녹음 중·일시정지·오류/중단 상태로 돌아올 때의 기존 선택 규칙은 유지한다.
- `tests/ui.spec.tsx`, `tests/e2e/recording-input.spec.ts`: 업로드 기본 선택과 키보드 탭 이동을 확인한다. 녹음 시작은 마이크 탭 선택 후 실행한다.
- `tests/e2e/preparation-layout.spec.ts`, `tests/e2e/screen-lock.spec.ts`, `tests/e2e/ux-pass1-built.spec.ts`: 녹음 검사 준비 단계에 명시적인 마이크 탭 선택을 추가한다.
- `tests/e2e/transcription-layout.spec.ts`: 새 메모에서 상단 단계와 전사 열의 경계 및 모바일 단일 열을 확인하는 짧은 검사를 추가한다. 기존 종합 시나리오는 그대로 보존했다.
- `docs/11-design-reference-review.md`: 최신 화면 결정과 이 기록을 연결한다.

## 실제 검증

별도 임시 headed Chrome 창에서 실제 Minutes/Settings 컴포넌트와 스타일을 합성 자료로 렌더링했다. 임시 점검 스크립트는 `/private/tmp/mom-layout-check.mjs`이며 제품이나 영구 테스트 도구에 추가하지 않았다. 외부 요청은 차단했다.

```sh
node /private/tmp/mom-layout-check.mjs before
node /private/tmp/mom-layout-check.mjs after
node /private/tmp/mom-layout-check.mjs reference
npm run build
npx vitest run tests/ui.spec.tsx -t 'groups recording and upload'
npx playwright test --config playwright.config.ts tests/e2e/recording-input.spec.ts tests/e2e/preparation-layout.spec.ts tests/e2e/transcription-layout.spec.ts --grep 'actual synthetic microphone|keyboard tabs preserve|visible STT selection|microphone denial'
npx playwright test --config playwright.config.ts tests/e2e/recording-input.spec.ts tests/e2e/transcription-layout.spec.ts --grep 'keyboard tabs preserve|visible STT selection'
npx playwright test --config playwright.config.ts tests/e2e/transcription-layout.spec.ts
npx playwright test --config playwright.config.ts tests/e2e/transcription-layout.spec.ts --grep 'STT columns align'
npx eslint src/react-app/ui/screens/Import.tsx src/react-app/ui/screens/Minutes.tsx src/react-app/ui/screens/Settings.tsx tests/ui.spec.tsx tests/e2e/preparation-layout.spec.ts tests/e2e/recording-input.spec.ts tests/e2e/screen-lock.spec.ts tests/e2e/transcription-layout.spec.ts tests/e2e/ux-pass1-built.spec.ts
git diff --check
```

- 빌드 성공. Vite의 기존 정적/동적 import 및 큰 chunk 경고는 남아 있다.
- 단위 검사 1개 통과, 같은 파일의 무관한 99개는 제외했다.
- 관련 브라우저 검사: 합성 마이크 녹음·일시정지·저장·음성 준비, 권한 거절, 좁은 영어 화면의 업로드/키보드 이동/새 메모, 전사 칼럼 정렬 4개 통과. 한국어/영어 입력 시나리오를 확인했으며 실제 물리 마이크나 인증된 AI 추론은 사용하지 않았다.
- Minutes/Settings는 1440×1000, 1100×1000, 360×1000에서 확인했다. 1440px에서 정리 결과/사용량은 각각 726.67px로 일치한다. 저장소 관리는 왼쪽 카드와 같은 628px, 제목은 14px/600이다. 모든 확인 크기에서 문서/본문의 가로 넘침은 없었다. 저장소 새로 확인, 정리 결과 편집 진입, 모바일 사용량 상세 펼치기도 확인했다. [변경 전 수치](before.json), [변경 후 수치](after.json).
- 전사는 1440×900, 1100×900, 360×900에서 확인했다. 데스크톱 왼쪽 열은 첫 단계 버튼 폭, 오른쪽 열은 두 번째 버튼 시작부터 세 번째 버튼 끝까지 일치한다. 좁은 화면에서는 같은 폭으로 위아래에 쌓인다.
- 제공된 standalone 원본도 1440×1000에서 렌더링했다. 동반 HTML/스크립트·썸네일·업로드 이미지를 확인했고, 참고자료 파일 전체의 SHA-256이 작업 전과 동일함을 확인했다.
- 변경 TSX/테스트 파일 대상 ESLint와 `git diff --check` 성공. 이전 날짜의 스크린샷은 테스트가 다시 생성한 뒤 원래 바이트로 복원하고 이번 화면만 이 폴더에 보관했다.

첫 브라우저 실행의 영어 새 메모 검사는 녹음 탭이 기본이라는 기존 가정 때문에 실패했다. 업로드 기본 선택을 확인하고 마이크를 명시적으로 여는 절차로 수정한 뒤 해당 항목만 다시 실행해 통과했다. 기존 전사 종합 시나리오는 접힌 상세 주소를 직접 찾기, 모바일 줄바꿈 버튼의 동일 높이 강제, 처리 중 숨겨지는 확인란을 disabled로 찾기 등 현재 UI와 다른 가정에서 차례로 중단됐다. 임시 진단용 수정은 되돌렸으며 이 종합 시나리오를 통과했다고 표시하지 않는다. 이번 변경에 필요한 폭 검사는 새 메모에서 여는 독립된 짧은 검사로 통과했다.

## 화면

- 정리 화면: [이전](before-1440-minutes.png), [이후](after-1440-minutes.png), [모바일](after-360-minutes.png)
- 보안 설정: [이전](before-1440-settings.png), [이후](after-1440-settings.png), [모바일](after-360-settings.png)
- 전사 화면: [데스크톱](1440-stt.png), [모바일](360-stt.png). 합성 모델/음성만 사용한 확인 화면이다.

## 완료 브랜치 정리

`git fetch origin --prune` 후 로컬/원격 main은 모두 `aa09d761f2183a33b99b61d88c55ab833a50a791`이었다. 별도 작업 트리나 연결된 작업 트리 artifact는 없었다. 다음 각 브랜치에 대해 `git merge-base --is-ancestor <branch> origin/main`이 성공한 후 `git branch -d`로 삭제했다.

- `codex/desktop-lock-countdown` (`a13514d`)
- `codex/stt-result-choice` (`d526887`)
- `codex/zdr-stt-presets` (`2ee26d7`)

남은 로컬 브랜치는 main, 원격 브랜치는 origin/main이다. 현재 미커밋 수정은 보존했다. 원격 브랜치 삭제나 main 푸시는 필요하지 않았다.

전체 스위트·실제 키/제공사 추론·물리 마이크·운영 배포는 이번 확인 범위에 포함하지 않았다. 이번 UI 변경의 커밋·푸시·배포는 수행하지 않았다.
