# 모델 관리 · API 키 보조 카드와 모달

기준일: 2026-10-17 (Asia/Jakarta). 시작 HEAD는 `fe4f9ba05d485f167dd686d1fdc0d894b25d80de`, 로컬에 기록된 `origin/main`은 `9383099`였다. 원격 조회·pull·push·배포는 수행하지 않았다. 작업 전부터 있던 `App.tsx`의 보관함 문구 2개 변경은 그대로 보존하고 이번 커밋에서 제외한다.

## 승인한 구성과 구현

- 별도 API 키 탭을 제거하고 모델 관리의 왼쪽에 `STT / LLM`, 오른쪽에 공통 API 키 카드를 둔다. 960px 이하에서는 기존 설정 그리드처럼 아래로 쌓는다. 이전 `keys` 탭 상태는 모델 관리로 해석한다.
- 키 목록은 이름·제공사와 행별 수정/삭제 메뉴만 표시한다. 모델 없이 키를 먼저 저장할 수 있고 STT·LLM에서 같은 origin의 키를 선택한다. 인증 없는 로컬 모델에는 키가 필요하지 않다.
- 키 추가·수정은 브라우저 기본 `dialog.showModal()`로 연다. 배경을 비활성화하고 이름 입력에 초점을 둔다. 취소·Escape 시 미저장 비밀값을 비우고 원래 버튼/행 메뉴로 초점을 돌린다. 저장 중에는 닫기를 막고 기존 실패 안내·키 보존 동작을 유지한다. 잠금 시 모달이 제거되며 입력을 비운다.
- 키 저장 후에도 작성 중인 모델 초안을 유지하고 새 키를 바로 선택한다. 기존 credential ID·origin·저장 방식·버전, 암호화 저장·교체·삭제 계약을 재사용한다. 스키마·의존성·서버·키/모델의 역방향 목록을 추가하지 않았다.
- 설정 하단의 큰 라이선스 카드를 사용자가 선택한 간결한 푸터로 바꿨다. 라이선스·소스/재빌드 파일, 전체 접근성 이름, 새 탭 안내와 키보드 접근은 유지한다.

## 변경 파일

| 구분 | 파일과 역할 |
| --- | --- |
| 키 카드·모달 | [ApiKeys.tsx](../../../../src/react-app/ui/components/ApiKeys.tsx): 간결한 목록, 기존 키 입력을 모달로 이동, 초점 복귀·입력 정리 |
| 모델 | [ModelRegistrations.tsx](../../../../src/react-app/ui/components/ModelRegistrations.tsx): STT·LLM 이름과 짧은 설명 |
| 설정·스타일 | [Settings.tsx](../../../../src/react-app/ui/screens/Settings.tsx), [styles.css](../../../../src/react-app/ui/styles.css): 기존 2열 그리드 재사용, 독립 탭·표·큰 라이선스 카드 제거 |
| 검사 | [api-keys-ui.spec.tsx](../../../../tests/api-keys-ui.spec.tsx), [model-registrations-ui.spec.tsx](../../../../tests/model-registrations-ui.spec.tsx), [ui.spec.tsx](../../../../tests/ui.spec.tsx), [unified-model-management.spec.ts](../../../../tests/e2e/unified-model-management.spec.ts) |
| 문서 | [문서 시작점](../../../README.md), [TODO](../../../TODO.md), [결정 기록](../../../09-decisions-and-roadmap.md), [설계의 최신 결정](../../specs/2026-10-17-unified-model-management-design.md), 이 기록과 합성 화면 12개 |

## 실행 명령과 결과

검증은 변경한 설정·키 입력·모델 초안과 직접 영향받는 기존 키 수명주기·합성 실행 흐름으로 제한했다. 전체 저장소·전체 테스트 스위트는 실행하지 않았다.

| 명령 | 결과와 범위 |
| --- | --- |
| `DEBUG_PRINT_LIMIT=650 npx vitest run tests/api-keys-ui.spec.tsx tests/ui.spec.tsx -t 'cancels the key modal\|newly saved key\|places legal links\|keeps shared API keys'` (구현 전) | 신규 기대값 5 FAIL, 100개 선택 제외. 기존 독립 키 탭·직접 폼·큰 라이선스 카드 때문에 실패하는 것을 확인한 뒤 구현했다. |
| `DEBUG_PRINT_LIMIT=650 npx vitest run tests/api-keys-ui.spec.tsx tests/model-registrations-ui.spec.tsx` | 16 PASS. 키 저장·서버 검증·교체 실패·잠금·삭제 확인, 모달 취소/초점 복귀·모델 초안 보존·공유 키 선택과 기존 모델 편집을 확인했다. |
| `DEBUG_PRINT_LIMIT=650 npx vitest run tests/ui.spec.tsx -t 'keeps shared API keys\|isolates the write-only API\|places legal links\|keeps preparation choices\|voice-memo terminology\|opens one model manager'` | 선택한 9 PASS, 89개 선택 제외. 기본 암호화·자동완성 격리·푸터 링크·설정 탭·기존 용어/진입 경로를 확인했다. |
| `DEBUG_PRINT_LIMIT=650 npx vitest run tests/api-keys-ui.spec.tsx` 및 `DEBUG_PRINT_LIMIT=650 npx vitest run tests/ui.spec.tsx -t 'keeps shared API keys\|isolates the write-only API'` (초기 초점 수정 후) | 7 PASS + 선택한 2 PASS, 96개 선택 제외. 변경한 모달 효과에 직접 영향받는 검사만 다시 실행했다. 나머지 16개의 코드와 검증 조건은 그대로라 재사용한다. 위 단위·UI 결과는 중복 제외 25 PASS다. |
| `npm run build` | 초점 수정 후 최종 타입 검사·프로덕션 빌드 PASS. 기존 동적/정적 import 중복과 500 kB 초과 번들 경고가 남아 있다. |
| `npx eslint src/react-app/ui/components/ApiKeys.tsx src/react-app/ui/components/ModelRegistrations.tsx src/react-app/ui/screens/Settings.tsx` | 최종 PASS. |
| `npm run test:secret` | 최종 소스·정적 자산·클라이언트 빌드 검사 PASS. 일치한 비밀값은 출력하지 않았다. |
| `npx playwright test tests/e2e/unified-model-management.spec.ts --grep 'one named key\|360px .*model editor\|API key list\|openrouter STT → openrouter notes\|saving a key modal' --output /tmp/mom-model-layout-e2e` | 키 수명주기·합성 STT→정리·한국어/영어 모바일 모델 편집 4 PASS. 데스크톱 모달 2건은 이름 초기 초점 검사에서 실패했고, 1건 중단·2건 미실행이었다. 아래 원인과 수정 기록을 따른다. |
| `npx playwright test tests/e2e/unified-model-management.spec.ts --grep 'API key list\|saving a key modal' --output /tmp/mom-model-layout-e2e-final` | 초기 초점은 통과했으나 데스크톱 2건이 마지막 버튼에서 Tab 후 즉시 닫기 버튼으로 돌아온다는 검사 가정에서 실패했다. 1건 중단·2건 미실행. |
| `npx playwright test tests/e2e/unified-model-management.spec.ts --grep '1440px ko API key list' --output /tmp/mom-modal-tab-diagnostic` 및 같은 명령의 출력 경로 `/tmp/mom-modal-tab-diagnostic-2` | 각 1건 진단 실패. 초점·문서 활성 여부만 확인해 Chrome의 브라우저 UI 이동을 확인했다. 진단 출력은 제거했다. 비밀값을 읽거나 출력하지 않았다. |
| `npx playwright test tests/e2e/unified-model-management.spec.ts --grep 'API key list\|saving a key modal' --output /tmp/mom-model-layout-e2e-verified` | 한국어 데스크톱이 자동화의 `bringToFront()` 후 실제 탭 숨김을 가정한 검사에서 실패했다. 영어 1건 중단·3건 미실행. 배치·입력·Tab·Escape·초점 복귀는 이 지점 전까지 통과했다. 기존 검사에서 사용하는 pagehide 경계 방식으로 수정했다. |
| `npx playwright test tests/e2e/unified-model-management.spec.ts --grep 'API key list\|saving a key modal' --output /tmp/mom-model-layout-e2e-complete` | 최종 5 PASS, 6.2초. 4개 언어/크기별 목록·모달과 실제 컨트롤러의 모델 초안 보존을 확인했다. 초기 4개 PASS의 수명주기·실행·모델 편집 로직은 바뀌지 않아 재사용한다. 선택한 브라우저 사례는 중복 제외 9 PASS다. |
| `git diff --check` | PASS. |

최초 모달의 React `autoFocus`는 `showModal()` 전에 실행되어 Chrome이 닫기 버튼을 선택했다. `showModal()` 직후 이름 입력에 초점을 주는 것으로 수정했다. Tab 검사는 이름→새 API 키 이동, 모달 상태와 배경에 초점이 가지 않는지를 확인한다. Chrome의 마지막 Tab이 브라우저 UI를 거치는 동작까지 제품의 오류로 취급하거나 브라우저 설정을 바꾸지 않았다. 잠금 검사는 합성 `PageTransitionEvent('pagehide')`를 전달하고 실제 세션 잠금·화면 제거를 확인한다. 실제 탭 숨김 자동화 성공을 주장하지 않는다. JSDOM의 기본 dialog 메서드 대체는 단위 검사에만 있으며 모달/초점 동작은 별도 실제 Chrome 검사로 확인했다.

## 실제 브라우저 관찰

별도 headed Chrome 창, 격리된 합성 보관함, `http://127.0.0.1:4174`의 빌드로 실행했다. 뷰포트는 한국어·영어 각각 1440×900와 360×800이다. 아래 이미지는 full-page 캡처이며 긴 화면의 전체 이미지 높이는 뷰포트 높이와 다르다.

- [한국어 데스크톱 배치](api-keys-1440-ko.png), [영어 데스크톱 배치](api-keys-1440-en.png)
- [한국어 좁은 화면 배치](api-keys-360-ko.png), [영어 좁은 화면 배치](api-keys-360-en.png)
- [한국어 데스크톱 모달](api-key-editor-1440-ko.png), [영어 데스크톱 모달](api-key-editor-1440-en.png)
- [한국어 좁은 화면 모달](api-key-editor-360-ko.png), [영어 좁은 화면 모달](api-key-editor-360-en.png)
- [키 저장 후 유지된 모델 초안](model-draft-after-key-save.png)
- [모델보다 먼저 저장한 키](key-before-models-desktop-ko.png), [한국어 모바일 모델 편집](models-mobile-ko.png), [영어 모바일 모델 편집](models-mobile-en.png)

카드·탭·모달·푸터의 실제 위치와 문구를 렌더링하고 수평 넘침이 없음을 검사했다. 한국어 데스크톱 목록/모달, 한국어 좁은 화면 목록, 영어 좁은 화면 모달과 모델 초안 화면은 이미지로도 시각 확인했다. 행 메뉴의 Enter 열기, 저장된 제공사 변경 금지·비밀값 미표시, 이름 초기 초점·Tab 이동·Escape 닫기/행 메뉴 초점 복귀, 미저장 비밀값이 있는 상태에서 잠금 후 DOM 제거를 확인했다.

키 저장·편집 흐름의 OpenAI/OpenRouter 요청은 0건이다. 합성 STT→정리 사례는 테스트 파일 안의 고정 응답만 사용하며 음성 준비·암호화 저장·선택 키 전달·결과 재열기·Markdown 내보내기는 제품 경로로 실행했다. 키 수명주기 사례는 키를 모델보다 먼저 저장하고 재열기·여러 단계 재사용·교체·연결 해제·삭제와 IndexedDB 합성 평문 노출 검사를 유지했다.

## 한계

실제 키·비공개 음성·인증된 제공사 추론·실제 비용/한도는 검증하지 않았다. 실제 사용자 보관함·기존 비밀 파일·브라우저/OS 보안 설정을 사용하거나 변경하지 않았다. Safari·Edge·물리 기기·실제 탭 숨김 잠금, 전체 스위트, 푸시·배포·운영 스모크는 수행하지 않았다. 완전한 메모리 소거를 보증하지 않으며, 키 삭제는 제공사 키 폐기나 발생한 요금 취소가 아니다.

레퍼런스 디렉터리의 6개 파일 목록과 작업 전 SHA-256이 같음을 확인했다. 변경 문서 5개의 저장 내용을 다시 읽었고 로컬 링크 75개가 모두 존재함을 확인했다.
