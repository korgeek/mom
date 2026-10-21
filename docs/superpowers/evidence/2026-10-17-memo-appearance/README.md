# 음성 메모 개념과 화면·언어 통합

날짜 2026-10-17. 기준 `f706196`, 작업 전 main과 origin/main 일치·작업 트리 깨끗함. 사용자의 최신 요청과 아이콘 선택 방식 답변을 기준으로 구현했다. 이전의 커밋·배포 승인에 이어 같은 기능을 수정한다.

## 범위와 데이터 보존

- 기존 `화면 · 언어` 탭을 유지하고 테마/팔레트/UI 언어 아래에 아이콘·색상·사용 언어·입출력·프롬프트를 통합했다. 별도 음성 준비 설정 탭은 제거했고 준비 화면의 관리 링크도 같은 화면으로 연결한다.
- 앱에 포함된 고정 경로 아이콘 24개 중 기본 9개를 제공하고 목록에 추가·제외·기본값 복원을 지원한다. 최소 한 개를 유지한다. SVG/HTML/외부 자산 입력은 받지 않고 등록된 키만 검증한다.
- 기존 암호화 Catalog의 선택적 목록 설정에 icons를 추가했다. 이전 보관함에 필드가 없으면 기존 9개다. 색상·언어·기존 메모의 아이콘/색상/선택 언어와 코드 순서를 다시 쓰지 않는다. 현재 아이콘이 관리 목록에서 빠져도 해당 메모의 선택으로 표시한다. 기존 저장·잠금·소유권·늦은 응답 경계를 재사용한다.
- 새 내보내기는 `mom-appearance-settings` version 1의 icons/colors/languages만 포함한다. 기존 `mom-color-language-settings` version 1을 계속 읽고 현재 아이콘 선택지는 보존한다. 미리보기·취소·명시적 적용·단일 저장을 유지한다. AI 안내에도 허용된 아이콘 키를 포함한다.
- 앱 소유 화면 문구의 회의→음성 메모, 회의록→정리 노트, 회의록 만들기→메모 정리와 영어 Voice memos/Notes를 반영했다. 제목·상태·탐색·삭제·저장·전송 안내·정리·모델·잠금·앱 브랜드와 문서 title/description을 포함한다. 사용자가 저장한 제목/Markdown, 내부 minutes/meeting 데이터 키, 제공사 프롬프트·전송·인코딩은 바꾸지 않았다.

## 영향 범위 검증

전체 스위트와 실제 인증된 제공사 호출을 실행하지 않았다. 변하지 않은 잠금 구현과 제공사/미디어 검증은 이전 기록을 재사용한다.

| 명령 | 실제 결과 |
| --- | --- |
| `npx vitest run tests/ui.spec.tsx -t 'keeps preparation choices\|uses voice-memo terminology'` | 구현 전 4 RED: 독립 탭/기존 회의 문구. |
| `npx vitest run tests/settings-lists.spec.ts -t 'validates preset icon choices'` | 구현 전 RED: icons 필드 거부. |
| `npx vitest run tests/settings-lists.spec.ts tests/settings-lists-persistence.spec.ts tests/settings-lists-controller.spec.ts tests/selection-list-settings-ui.spec.tsx` | PASS 38: 검증·이전 파일/보관함·암호화 재로드·입력 분리·잠금/실패/재시도·UI 편집. |
| `npx vitest run tests/selection-list-settings-ui.spec.tsx tests/ui.spec.tsx -t 'shows the built-in\|adds catalog icons\|adds, edits and deletes\|keeps a rejected edit\|previews, cancels\|rejects oversized\|copies current applied\|keeps preparation choices\|uses voice-memo terminology\|uses managed lists\|keeps title typing\|omits the build banner'` | PASS 25, 79 skip. 한국어/영어의 앱 소유 전체 화면·설정 탭·aria 문구 검사 포함. |
| `npx vitest run tests/home-status.spec.tsx tests/storage-ui.spec.tsx tests/usage-ui.spec.tsx tests/vault-reset-ui.spec.tsx tests/model-selection-modal.spec.tsx` | PASS 68, 오래된 변경 문구 정규식 2 FAIL. 아래 두 실패만 수정·재검증. |
| `npx vitest run tests/storage-ui.spec.tsx tests/usage-ui.spec.tsx -t 'shows original-byte loss\|shows STT/notes stages'` | PASS 2, 21 skip. |
| `npm run build` | 최종 빌드 PASS. 기존 mixed media import/큰 chunk 경고 유지. |
| `npx tsc --noEmit -p tsconfig.app.json`, `npx tsc --noEmit -p tsconfig.tests.json`, `npx tsc --noEmit -p tsconfig.e2e.json` | PASS. |
| `npm run test:secret`, `git diff --check` | PASS. |

UI 파일 전체를 확인하면서 `tests/ui.spec.tsx`의 기존 실패도 발견했다.기준 `f706196`을 별도 `/tmp/mom-copy-baseline.n2uuhk`에 git archive하고 기존 node_modules를 참조해 동일 파일만 실행했다. 해당 임시 Vite 설정에는 로컬 설치 라이브러리 경로의 fs allow만 추가했고 제품 설정은 변경하지 않았다. 기준 결과는 84 PASS/11 FAIL이었다. 현재의 해당 10개 실패는 기준에서도 같은 원인(오래된 전사/원본/모델 fixture와 기대 문구)으로 실패하며 이번 범위에서 고치지 않았다. 기준의 나머지 한 개는 탭 수 기대값 5와 당시 실제 6의 차이로, 이번 통합 후 5가 되어 통과한다. 이번 변경의 제목 선택자와 한국어 브랜드 기대값은 수정하여 위 대상 검사에서 통과했다.

브라우저 확인 중 아이콘 선택기의 접근성 이름, 한국어 조사, 문구 교체에 잘못 포함된 import/CSS 이름을 발견해 배포 전에 바로잡았다. 내부 경로·CSS 이름은 유지하며 화면 문구만 바꾼다. 임시 클릭 진단 로그는 제거했다.

**보안 재검증 후속:** 위 기존 UI 실패 10개는 같은 날 후속 작업에서 fixture/문구를 갱신하고 실제 전사 재시도 문제를 수정해 해결했다. 최종 해당 파일 98 PASS와 보안·브라우저 검증은 [재검증 기록](../2026-10-17-security-recheck/README.md)을 따른다.

Chrome 최종 화면과 배포 결과, 변경 파일은 아래에 기록한다.

## Chrome 최종 검증

`npx playwright test --config playwright.config.ts tests/e2e/selection-lists.spec.ts`: PASS 4 (14.9초), 별도 headed Chrome 한국어/영어 × 360×800/1440×900. 외부 요청 0/pageerror 0. 아이콘 추가·제외·복원, 회사 색/이름·언어 코드 편집, 새/이전 JSON 미리보기·취소·적용, 내보내기·클립보드, 현재 메모의 제외된 아이콘 보존 및 새 아이콘 선택, 잠금·재로드, 기존 테마·UI 언어 보존, 전사/메모 정리 이동을 확인했다. 합성 보관함만 사용했다.

최종 build 자산은 JS `index-hVetTWYq.js`, CSS `index-DB69GK_V.css`다. 아래 8개 화면을 직접 보고 테마·탭 통합·아이콘·문구·레이아웃·줄바꿈·선택 반영을 확인했다.

- [ko 1440 defaults](1440-ko-defaults.png)
- [en 1440 icons](1440-en-icons.png)
- [ko 360 icons](360-ko-icons.png)
- [en 360 icons](360-en-icons.png)
- [ko 1440 import-choices](1440-ko-import-choices.png)
- [ko 1440 notes](1440-ko-notes.png)
- [en 1440 notes](1440-en-notes.png)
- [en 360 icon-edit](360-en-icon-edit.png)

## 변경 파일

변경된 실행 코드·직접 연결된 테스트/fixture는 다음과 같다. 문서 변경은 이 기록과 결정/레퍼런스/이전 설계의 최신 결정 연결이다.

```text
index.html
src/react-app/App.tsx
src/react-app/controller.tsx
src/react-app/settings/lists.ts
src/react-app/ui/ModelPicker.tsx
src/react-app/ui/RecordingControls.tsx
src/react-app/ui/UsageStatement.tsx
src/react-app/ui/components/ModelManager.tsx
src/react-app/ui/components/ModelRegistrations.tsx
src/react-app/ui/components/ModelSelectionModal.tsx
src/react-app/ui/components/SelectionListSettings.tsx
src/react-app/ui/components/StorageManagement.tsx
src/react-app/ui/copy.ts
src/react-app/ui/screens/History.tsx
src/react-app/ui/screens/Home.tsx
src/react-app/ui/screens/Import.tsx
src/react-app/ui/screens/Minutes.tsx
src/react-app/ui/screens/Review.tsx
src/react-app/ui/screens/STT.tsx
src/react-app/ui/screens/Settings.tsx
tests/e2e/copy-placement.spec.ts
tests/e2e/endpoint-limits.spec.ts
tests/e2e/flow.spec.ts
tests/e2e/helpers.ts
tests/e2e/home-status.spec.ts
tests/e2e/lock.spec.ts
tests/e2e/minutes-comparison.spec.ts
tests/e2e/minutes-language.spec.ts
tests/e2e/model-modalities.spec.ts
tests/e2e/model-selection-settings.spec.ts
tests/e2e/model-settings.spec.ts
tests/e2e/openrouter-stt.spec.ts
tests/e2e/playback.spec.ts
tests/e2e/preparation-progress.spec.ts
tests/e2e/responsive.spec.ts
tests/e2e/selection-lists.spec.ts
tests/e2e/stt-rerun.spec.ts
tests/e2e/title-edit.spec.ts
tests/e2e/vault-reset.spec.ts
tests/e2e/workflow.spec.ts
tests/home-status.spec.tsx
tests/model-first-use-ui.spec.tsx
tests/model-manager-ui.spec.tsx
tests/model-modalities.spec.tsx
tests/model-selection-modal.spec.tsx
tests/openrouter-stt-ui.spec.tsx
tests/selection-list-settings-ui.spec.tsx
tests/settings-lists-controller.spec.ts
tests/settings-lists-persistence.spec.ts
tests/settings-lists.spec.ts
tests/storage-controller.spec.tsx
tests/storage-ui.spec.tsx
tests/ui.spec.tsx
tests/usage-ui.spec.tsx
tests/vault-reset-ui.spec.tsx
src/react-app/settings/icons.ts (new)
```

## 한계

전체 스위트·실제 제공사 추론·다른 브라우저는 검사하지 않았다. 기존 UI 테스트 실패는 위 기준 비교를 따른다. SVG 사용자 등록은 포함하지 않으며 허용된 앱 아이콘 목록에서 추가한다. JSON/프롬프트는 보관함 밖 평문이다. 저장된 제목·Markdown은 변경하지 않는다.

## 배포·운영 smoke

제품 커밋 `95a7a61`을 `git push origin main`으로 반영했다. `gh api repos/korgeek/mom/commits/95a7a61/check-runs --jq '.check_runs[] | {name,status,conclusion}'`의 Workers Builds: mom 결과는 completed/success다. 강제 푸시·pull/reset·직접 wrangler 배포는 하지 않았다.

기존 Chrome의 [운영 사이트](https://mom.korgeek.workers.dev/)를 새로고침하고 제공된 테스트 암호로 기존 보관함을 열었다. 실제 표시 크기는 1492×1103이다. 브라우저 title Voice Memos, 잠금·홈 브랜드/문구, 설정 5개 탭과 화면·언어 통합을 확인했다. 기존 라이트/코발트/한국어 선택을 유지했고, 아이콘 추가 창의 15개 추가 선택지를 확인하고 독서 미리보기를 선택한 뒤 저장 없이 취소했다. 기존 메모의 제목·중요 아이콘·색상·언어 선택을 보존한 상태에서 메모 제목/메모 정리/정리 노트 문구와 관리 링크의 통합 탭 연결을 확인했다. 키·녹음·제공사 호출과 저장값을 변경하지 않았다.

운영 DOM 자산 `/assets/index-hVetTWYq.js`, `/assets/index-DB69GK_V.css`가 최종 로컬 검증 build와 일치한다. [통합 설정 운영 캡처](production-appearance.jpg), [아이콘 추가 운영 캡처](production-icon-add.jpg)를 저장하고 직접 확인했다. 운영은 표시·선택 미리보기/취소·탐색 smoke 범위이며 실제 저장·입출력은 합성 로컬 검증을 따른다.

최종 원본 레퍼런스 6/6 경로·SHA-256 보존, 변경 문서의 로컬 링크와 `git diff --check`를 확인했다. 후속 커밋은 이 배포 검증 기록·캡처만 포함한다.
