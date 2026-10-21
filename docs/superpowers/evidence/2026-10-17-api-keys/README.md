# API 키 독립 관리 · 로컬 검증

기준일: 2026-10-17 (Asia/Jakarta). 시작 HEAD는 `1f25555018259e1cab0c300517f4ce03310326c6`, 로컬에 기록된 `origin/main`은 `9383099`였다. 원격 조회·pull·push·배포를 수행하지 않았다. 기존 `App.tsx`의 보관함 문구 2개 변경은 보존하고 이번 커밋에서는 제외한다.

## 승인한 구성과 구현

- `설정 → API 키`에서 모델 없이 키를 먼저 등록한다. 목록에는 이름·제공사·행별 수정/삭제만 표시한다. 연결 모델·사용량·만료·한도는 추가하지 않는다.
- 입력은 이름·제공사·API 키다. OpenAI/OpenRouter는 기존 허용 origin을 자동 지정하고 기타 서버만 주소를 입력한다. 암호화 저장이 기본이고 기존 세션 저장 선택은 접힌 보관 옵션에 유지한다.
- 모델에는 같은 origin의 기존 키 선택만 남긴다. 모델 화면의 비밀값 입력·키 생성·키 관리 영역은 제거한다. 키의 역방향 모델 목록이나 제공사 필드를 새로 저장하지 않는다.
- 기존 credential ID·허용 origin·저장 방식·버전, 암호화 저장, 교체·삭제·연결 해제 계약을 재사용한다. 스키마 이전·새 의존성·외부 서버를 추가하지 않는다.
- 키 저장만으로 외부 요청을 보내지 않는다. 저장 실패·탭 이동·잠금 시 입력한 비밀값을 지우며, 저장된 비밀값을 다시 표시하지 않는다. 전체 메모리 소거를 보증하는 주장은 아니다.

## 변경 파일

| 구분 | 파일과 역할 |
| --- | --- |
| 화면 | [ApiKeys.tsx](../../../../src/react-app/ui/components/ApiKeys.tsx): 기존 키 관리·편집을 추출하고 독립 목록·제공사 선택 제공 |
| 모델 | [ModelRegistrations.tsx](../../../../src/react-app/ui/components/ModelRegistrations.tsx): 키 선택만 유지하고 직접 키 입력 제거 |
| 설정 | [Settings.tsx](../../../../src/react-app/ui/screens/Settings.tsx), [App.tsx](../../../../src/react-app/App.tsx): API 키 탭과 탭 타입 추가 |
| 스타일 | [styles.css](../../../../src/react-app/ui/styles.css): 기존 테마를 사용하는 키 표·행 메뉴·모바일 간격 |
| 검사 | [api-keys-ui.spec.tsx](../../../../tests/api-keys-ui.spec.tsx), [model-registrations-ui.spec.tsx](../../../../tests/model-registrations-ui.spec.tsx), [ui.spec.tsx](../../../../tests/ui.spec.tsx), [unified-model-management.spec.ts](../../../../tests/e2e/unified-model-management.spec.ts) |
| 문서 | [문서 시작점](../../../README.md), [결정 기록](../../../09-decisions-and-roadmap.md), [TODO](../../../TODO.md), [기존 설계의 후속 결정](../../specs/2026-10-17-unified-model-management-design.md), 이 검증 기록과 합성 화면 11개 |

## 실행 명령과 결과

전체 저장소·전체 테스트 스위트는 실행하지 않았다. 변경한 화면과 직접 호출하는 키 저장·모델 참조·실행 경로만 선택했다.

| 명령 | 결과와 범위 |
| --- | --- |
| `npx vitest run tests/api-keys-ui.spec.tsx` (구현 전) | API 키 탭이 없어서 신규 5개가 의도대로 실패. 이후 구현·검증했다. |
| `DEBUG_PRINT_LIMIT=700 npx vitest run tests/api-keys-ui.spec.tsx tests/model-registrations-ui.spec.tsx tests/api-credentials.spec.ts tests/unified-model-controller.spec.tsx` | 30 PASS. 키의 독립 저장, 모델의 선택·서버 변경, 키 교체·삭제·세션 저장·원자적 실패와 실행 동의 갱신. |
| `DEBUG_PRINT_LIMIT=700 npx vitest run tests/api-keys-ui.spec.tsx` (최종) | 6 PASS. 사용자 지정 주소 저장·목적지 변경 시 입력 제거·비밀값 교체 없는 이름 변경을 포함한다. 이 파일의 이전 5개를 대체하므로 위 4개 파일의 중복 제외 유효 결과는 31 PASS다. |
| `DEBUG_PRINT_LIMIT=700 npx vitest run tests/ui.spec.tsx -t 'separates API keys\|isolates the write-only API\|keeps preparation choices\|voice-memo terminology\|opens one model manager'` | 선택한 7 PASS, 나머지 91개는 선택 범위 밖. 키 입력의 자동완성·저장 후 제거와 기존 설정 탭·키보드 이동을 확인했다. |
| `npm run build` | 최종 타입 검사·프로덕션 빌드 PASS. 미사용 분할과 500 kB 초과 번들에 대한 Vite 경고는 남아 있다. 이 UI 변경의 범위에서 번들 분할을 수정하지 않았다. |
| `npx eslint src/react-app/ui/components/ApiKeys.tsx src/react-app/ui/components/ModelRegistrations.tsx src/react-app/ui/screens/Settings.tsx` | PASS. |
| `npm run test:secret` | 최종 소스·정적 자산·클라이언트 빌드 검사 PASS. 일치한 비밀값을 출력하지 않았다. |
| `npx playwright test tests/e2e/unified-model-management.spec.ts --grep 'one named key\|360px .*model editor\|API key list\|openrouter STT → openrouter notes' --output /tmp/mom-api-keys-e2e` | 최초 서버 실행은 sandbox의 inspector 포트 바인딩 거부로 시작하지 못했다. 허용된 로컬 서버/Chrome 실행으로 재시도했다. 모델 편집 모바일 2 PASS. 키 화면 2건은 새 제공사 select의 테스트 선택자가 달라 실패했고 1건은 중단, 3건은 미실행이었다. 접근성 트리를 확인하여 테스트 선택자만 수정했다. |
| `npx playwright test tests/e2e/unified-model-management.spec.ts --grep 'one named key\|API key list\|openrouter STT → openrouter notes' --output /tmp/mom-api-keys-e2e-keys` | 관련 6개 중 4 PASS. 합성 STT→정리와 키 독립 등록·재열기·재사용·교체·연결 해제·삭제를 확인했다. 영어 2건은 기존 잠금 제목의 `your`를 빠뜨린 테스트 기대값 때문에 실패했다. 제품은 잠금 상태였으며 테스트 문구를 수정했다. |
| `npx playwright test tests/e2e/unified-model-management.spec.ts --grep 'API key list' --output /tmp/mom-api-keys-e2e-final` | 최종 4 PASS, 5.3초. 모바일 표 간격과 영어 잠금 기대값에 영향받는 4개만 재실행했다. 앞선 모델 편집 2개·키 수명주기/합성 실행 2개는 로직 변경이 없어 유지한다. 선택한 브라우저 사례는 중복 제외 8개가 통과했다. |
| `git diff --check` | PASS. |

타입 검사 초기 실행은 신규 테스트의 Testing Library `getByRole`에 지원하지 않는 `exact` 옵션 3곳을 사용해 실패했다. 이 테스트 옵션을 제거한 뒤 빌드를 통과했다. 모델 초안 검사도 생략된 `credentialId` 속성을 명시적 `undefined` 속성과 동일하게 요구했던 기대값을 수정했다. 제품 저장 계약을 바꾸지 않았다.

## 실제 브라우저 관찰

제품 브라우저 검사는 별도 headed Chrome 창과 격리된 합성 보관함에서 `http://127.0.0.1:4174`의 빌드로 실행했다. 원본 레퍼런스는 별도 Chrome 검토 탭에서 기존 5173 서버가 제공한 standalone을 렌더링하고, 데모 해제→설정 화면을 확인했다. 이미지 참고자료도 확인했으며 원본은 수정하지 않았다.

- [한국어 1440×900 키 목록](api-keys-1440-ko.png), [영어 1440×900 키 목록](api-keys-1440-en.png)
- [한국어 360×800 키 목록](api-keys-360-ko.png), [영어 360×800 키 목록](api-keys-360-en.png)
- [한국어 데스크톱 편집](api-key-editor-1440-ko.png), [영어 데스크톱 편집](api-key-editor-1440-en.png)
- [한국어 모바일 편집](api-key-editor-360-ko.png), [영어 모바일 편집](api-key-editor-360-en.png)
- [모델보다 먼저 저장한 키의 재열기](key-before-models-desktop-ko.png)
- [한국어 모바일 모델 편집](models-mobile-ko.png), [영어 모바일 모델 편집](models-mobile-en.png)

위 뷰포트에서 실제 표·탭·입력·보관 옵션을 렌더링하고 수평 넘침이 없는지 검사했다. 행 메뉴를 키보드 Enter로 열고 수정 진입, 제공사 변경 잠금, 비밀값 미표시, 새 비밀값 초안이 있는 상태의 잠금 후 DOM 제거를 확인했다. 한국어 모바일 목록과 영어 편집 화면 등을 직접 시각 확인하고 OpenRouter가 한 줄로 표시되도록 모바일 셀 간격을 조정했다.

키만 저장하는 브라우저 흐름은 OpenAI/OpenRouter 전송 0건을 확인했다. 합성 STT→정리 사례는 준비한 음성과 선택된 키가 전달되는 요청을 가로채 고정된 테스트 응답으로 검증했고, 결과 재열기·Markdown 내보내기까지 확인했다. 실제 IndexedDB에서 합성 비밀값·음성/전사/노트 표식의 평문 노출 여부를 검사했다. 가짜 응답은 테스트 파일에만 있으며 제품에 포함되지 않는다.

## 한계

실제 키·비공개 음성·인증된 추론·제공사 비용/한도/보관 정책은 검증하지 않았다. 실제 사용자 보관함·기존 비밀 파일·브라우저/OS 보안 설정을 사용하거나 변경하지 않았다. Safari·Edge·물리 기기 검증, 전체 저장소 검사, 푸시·배포·운영 스모크는 수행하지 않았다. 키 삭제는 이 브라우저의 키 저장·참조만 제거하며 제공사 키를 폐기하지 않는다.

최종 확인에서 레퍼런스 6개 파일의 SHA-256이 작업 전과 같았다. 변경 문서 5개를 다시 읽었고 로컬 링크 72개가 존재함을 확인했다.
