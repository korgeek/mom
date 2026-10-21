# 모델 통합 목록 · 수정·테스트·삭제 분리

2026-10-17 (Asia/Jakarta). 시작 HEAD `95ab76a`, 로컬 기록 `origin/main`은 `9383099`였다. 원격 조회·pull·push·배포는 하지 않았다. 기존 `App.tsx`의 보관함 문구 2개 편집은 보존하며 이번 커밋에서 제외한다.

## 구현한 승인 범위

- 기본은 STT·LLM 통합 목록이고 `전체 / STT / LLM`으로 필터링한다. 목록에는 이름·모델 ID·서버·종류·상태와 테스트·수정·삭제를 표시한다. STT·LLM 기본 모델은 별도 설정 모달에서 각각 관리한다.
- 수정·테스트·가져오기·삭제 확인은 별도 모달이다. 수정 저장 후 목록으로 돌아온다. 기존 모델별 JSON 내보내기는 수정 모달 안에 유지하며 키·참조·테스트 입력/응답을 제외한다.
- STT 테스트는 기존 제한(30초·5 MiB 이하)의 실제 음성 파일을 선택한다. LLM은 명시적으로 표시한 편집 가능한 합성 예문으로 시작한다. 추가 옵션·요청 전문은 접고 반환 텍스트와 성공/실패를 먼저 보여준다. 기존 요청 검증·요금/전송 안내·OpenRouter 정책 확인·취소·결과 저장 재시도를 유지한다.
- 모델 삭제는 해당 등록·기본 선택·이전 경로 매핑만 제거한다. 다른 모델을 자동 선택하지 않으며 공유 키·기존 음성 메모·실행 스냅샷·전사/정리 결과를 유지한다. 기존 암호화 카탈로그의 원자적 저장을 재사용한다.
- API 키의 `연결 확인`은 모델 없이 저장한 키로 읽기 전용 인증을 확인한다. OpenAI는 `GET /v1/models`, OpenRouter는 `GET /api/v1/key`를 사용한다. 사용자 지정 서버의 경로를 추측하거나 그쪽으로 키를 보내지 않고 `확인 불가`로 안내한다. 전사·생성 성공과 구분하며 결과는 세션에만 두고 키 변경·잠금 시 제거한다. 15초 제한·자동 재시도 없음·리디렉션 거부·쿠키 제외·잠금 후 늦은 응답 차단을 적용했다.
- 전송·공유 안내는 삼각형 펼침 대신 정보 버튼과 별도 안내 모달로 바꿨다. 간결한 라이선스 푸터는 유지한다.
- 브라우저 기본 dialog를 공통 컴포넌트로 재사용한다. 모델 수정 안에서 키 모달을 열어도 초안을 유지하고, 중첩 모달의 Escape가 바깥 모달을 닫지 않도록 취소 이벤트 전파를 막는다. 키 취소·잠금 시 미저장 비밀값을 지우고 초점을 복귀한다. 스키마·의존성·서버는 추가하지 않았다.

## 변경 파일

- [ModelRegistrations.tsx](../../../../src/react-app/ui/components/ModelRegistrations.tsx): 통합 목록·필터·분리된 동작·안내
- [ApiKeys.tsx](../../../../src/react-app/ui/components/ApiKeys.tsx), [SettingsDialog.tsx](../../../../src/react-app/ui/components/SettingsDialog.tsx), [styles.css](../../../../src/react-app/ui/styles.css): 키 인증 확인·공통 모달·배치와 초점/스크롤 처리
- [controller.tsx](../../../../src/react-app/controller.tsx), [App.tsx](../../../../src/react-app/App.tsx): 삭제·인증 확인 계약과 실제 저장/요청 경로. `App.tsx`에서는 새 controller 인터페이스만 커밋한다.
- [model-registrations-ui.spec.tsx](../../../../tests/model-registrations-ui.spec.tsx), [api-keys-ui.spec.tsx](../../../../tests/api-keys-ui.spec.tsx), [unified-model-controller.spec.tsx](../../../../tests/unified-model-controller.spec.tsx), [브라우저 검사](../../../../tests/e2e/unified-model-management.spec.ts)
- [openrouter-stt-ui.spec.tsx](../../../../tests/openrouter-stt-ui.spec.tsx): 변경한 모달로 제공사 정책·저장 실패·기본 선택 검사의 동선 갱신
- [문서 시작점](../../../README.md), [TODO](../../../TODO.md), [결정 기록](../../../09-decisions-and-roadmap.md), [설계의 최신 결정](../../specs/2026-10-17-unified-model-management-design.md), 이 기록과 합성 화면 9개

## 실행 명령·결과

전수 테스트는 하지 않았다. 변경한 UI·controller와 직접 영향받는 키·삭제·결과 보존 경로만 검사했다. 동일한 로직의 기존 PASS를 재사용하며 실패·변경한 부분만 재실행했다.

| 명령 | 실제 결과 |
| --- | --- |
| `DEBUG_PRINT_LIMIT=400 npx vitest run tests/unified-model-controller.spec.tsx tests/model-registrations-ui.spec.tsx -t 'shows one unified list\|opens model testing separately\|deletes a model registration\|failed deletion\|checks a named API key\|failed key check\|custom key check\|fences a key check'` | 구현 전 10 FAIL, 20개 선택 제외. 통합 목록·독립 동작·controller 콜백 부재를 확인했다. |
| `DEBUG_PRINT_LIMIT=400 npx vitest run tests/unified-model-controller.spec.tsx -t 'deletes a model registration\|failed deletion\|checks a named API key\|failed key check\|custom key check\|fences a key check'` | 8 PASS, 11개 선택 제외. 실제 암호화 저장/재열기·삭제 실패 보존·인증 GET의 목적지/헤더/본문 없음·실패/사용자 서버/잠금 경계를 확인했다. |
| `DEBUG_PRINT_LIMIT=500 npx vitest run tests/model-registrations-ui.spec.tsx tests/api-keys-ui.spec.tsx` | 새 동선 구현 후 12 PASS, 6개는 이전 결합 버튼/직접 폼 선택자 때문에 실패. 새 모달과 별도 기본 모델 설정으로 검사 동선을 갱신했다. |
| `DEBUG_PRINT_LIMIT=450 npx vitest run tests/model-registrations-ui.spec.tsx tests/api-keys-ui.spec.tsx` | 17 PASS, 1 FAIL. 중첩 키 모달의 cancel 이벤트가 바깥 모델 모달까지 닫는 실제 문제를 발견했다. |
| `DEBUG_PRINT_LIMIT=400 npx vitest run tests/api-keys-ui.spec.tsx -t 'cancels the key modal'` | 공통 모달의 이벤트 전파를 수정한 뒤 1 PASS, 6개 선택 제외. 위 UI 결과와 합쳐 중복 제외 18 PASS. |
| `DEBUG_PRINT_LIMIT=400 npx vitest run tests/ui.spec.tsx -t 'keeps shared API keys\|isolates the write-only API\|places legal links\|keeps preparation choices\|voice-memo terminology\|opens one model manager'` | 9 PASS, 89개 선택 제외. 기존 설정 진입·키 자동완성/제거·푸터 링크·용어를 확인했다. |
| `DEBUG_PRINT_LIMIT=400 npx vitest run tests/unified-model-controller.spec.tsx -t 'executes openrouter transcription → openrouter notes'` | 1 PASS, 18개 선택 제외. 합성 STT→정리 후 두 모델을 삭제해도 기존 결과·실행 스냅샷이 보존되고 암호화 재열기되는 것을 확인했다. |
| `DEBUG_PRINT_LIMIT=400 npx vitest run tests/unified-model-controller.spec.tsx -t 'checks a named API key\|executes openrouter transcription → openrouter notes'` | 기존 모델 키 저장 경로의 인증 확인 상태도 지우도록 한 뒤 영향받는 3 PASS, 16개 선택 제외. |
| `DEBUG_PRINT_LIMIT=350 npx vitest run tests/model-registrations-ui.spec.tsx -t 'exports public options'` | 모델별 내보내기를 수정 모달에서 유지하는 기대값을 먼저 추가해 1 FAIL 확인. 버튼 추가 중 JSX 괄호 오류로 1회 transform/타입 검사 실패했고 수정 후 1 PASS, 10개 선택 제외. 단위·UI의 중복 제외 유효 결과는 36 PASS다. |
| `DEBUG_PRINT_LIMIT=350 npx vitest run tests/openrouter-stt-ui.spec.tsx -t 'OpenRouter policies only\|explicitly selected policy\|model save failure safe\|separates encrypted saving\|preserves .* choices'` | 새 모달 동선에 직접 영향받는 정책 확인·안내·기본 선택·저장 실패 8 PASS, 12개 선택 제외. 단위·UI의 최종 중복 제외 결과는 44 PASS다. |
| `npm run build` | 최종 타입·프로덕션 빌드 PASS. 기존 동적/정적 import 중복과 500 kB 초과 번들 경고는 남아 있다. |
| `npx eslint src/react-app/ui/components/ModelRegistrations.tsx src/react-app/ui/components/SettingsDialog.tsx src/react-app/ui/components/ApiKeys.tsx src/react-app/controller.tsx` | PASS. |
| `npm run test:secret` | 소스·정적 자산·클라이언트 빌드 검사 PASS. 일치한 비밀값은 출력하지 않았다. |
| `npx tsc -b && git diff --check` | 마지막 테스트 동선 수정 후 타입·공백 검사 PASS. 저장한 문서 5개의 로컬 링크 78개를 검사해 누락 0개를 확인했다. 참조 원본 6개의 SHA256과 파일 목록은 작업 시작 때와 동일하다. |
| `npx playwright test tests/e2e/unified-model-management.spec.ts --grep 'openrouter STT → openrouter notes\|one named key\|saving a key modal\|unified model list' --output /tmp/mom-unified-list-e2e` | 2 PASS, 3 FAIL. 키 수명주기·중첩 키 저장/모델 초안은 통과. 실패는 제거한 행별 내보내기 버튼, 중복 status, textarea의 exact label 선택자였다. 접근성 역할에 맞춰 수정했다. |
| `npx playwright test tests/e2e/unified-model-management.spec.ts --grep 'openrouter STT → openrouter notes\|saving a key modal\|unified model list' --output /tmp/mom-unified-list-e2e-final` | 2 PASS, 2 FAIL. 합성 STT→정리·결과 재열기/내보내기와 중첩 키 모달은 통과. 화면 사례는 기본 모델 select의 exact label과 재시작 후 언어에 대한 검사 가정 때문에 실패했다. |
| `npx playwright test tests/e2e/unified-model-management.spec.ts --grep 'unified model list' --output /tmp/mom-unified-list-e2e-verified` | 한국어 1440px 1 PASS. 영어 360px는 알려진 재시작 언어 가정에서 중단하고 해당 사례만 수정했다. |
| `npx playwright test tests/e2e/unified-model-management.spec.ts --grep '360px en unified model list' --output /tmp/mom-unified-list-e2e-en` 및 출력 경로 `/tmp/mom-unified-list-e2e-en-final` | 첫 실행은 재시작 후에도 영어 설정이 유지된다는 가정 때문에 1 FAIL. 현재 동작처럼 언어를 다시 선택한 뒤 1 PASS, 4.5초. |
| `npx playwright test tests/e2e/unified-model-management.spec.ts --grep '360px en unified model list' --output /tmp/mom-unified-list-e2e-en-export` | 수정 모달에 유지한 모델별 내보내기까지 확인한 최종 영어 360px 1 PASS, 4.8초. 앞선 동일한 키 수명주기·합성 실행·중첩 모달·한국어 화면 결과와 합쳐 중복 제외 5 PASS다. |

선택한 브라우저 흐름은 키 수명주기, 합성 STT→정리, 중첩 키 입력, 한국어 데스크톱, 영어 좁은 화면의 5개다. 실제 키나 제공사 추론을 사용한 PASS가 아니다. 음성 준비·암호화 저장·controller·브라우저는 실제 경로이고 외부 응답만 테스트에서 가로챘다. key check는 GET 1회, 수동 모델 테스트는 POST 1회임을 확인하며 저장·목록·필터·안내·편집·삭제만으로 추가 요청이 발생하지 않았다.

## 실제 렌더링과 한계

별도 headed Chrome 창의 격리된 합성 보관함, `http://127.0.0.1:4174`, 한국어 1440×900와 영어 360×800에서 렌더링했다. 아래는 full-page 캡처이며 긴 이미지의 높이는 뷰포트 높이와 다르다.

- [한국어 통합 목록](unified-model-list-1440-ko.png), [영어 좁은 화면 목록](unified-model-list-360-en.png)
- [한국어 수정](model-edit-1440-ko.png), [영어 수정](model-edit-360-en.png)
- [한국어 STT 테스트](model-test-1440-ko.png), [영어 LLM 테스트](model-test-360-en.png)
- [모델 안의 키 모달](nested-key-dialog.png), [키 저장 후 유지된 초안](model-draft-after-key-save.png), [합성 정리 결과](notes-desktop-ko.png)

키보드 필터·Escape/초점 복귀, 테스트와 수정의 입력 분리, 안내 모달, 읽기 전용 인증과 모델 실행 구분, 삭제 취소/확정/재열기·기본 선택 해제·키 유지, pagehide 잠금 후 모달/민감 입력 제거와 수평 넘침을 확인했다. 실제 탭 숨김을 자동화한 증거가 아니라 합성 pagehide 이벤트로 세션 잠금 경계를 검사했다.

재시작 후 UI 언어가 한국어로 돌아오는 기존 동작을 발견했다. `onPreferences`는 현재 메모리 상태만 갱신한다. 이번 범위에서는 언어 영속화를 구현하지 않았고, 영어 재열기 검사에서 언어를 다시 선택했다. 이는 모델·키의 암호화 저장 성공과 구분한다.

`tests/e2e/model-registrations.spec.ts`는 이전 단계의 모델 탭·직접 키 입력·수정/테스트 결합 화면을 기준으로 한 오래된 검사다. 시작 HEAD의 화면과도 초기 진입부터 맞지 않아 이번 범위에서 실행하거나 전체를 재작성하지 않았다. 현재 화면의 관련 검증은 위 `unified-model-management.spec.ts`에서 수행했다. 전체 E2E 스위트가 통과한다고 주장하지 않는다. 초기 타입 검사에서 신규 Testing Library 선택자의 지원하지 않는 `exact` 옵션도 제거한 뒤 빌드를 통과했다.

실제 키·인증된 제공사 호출·비공개 회의·음성 품질·실제 비용/한도는 미검증이다. 사용자 지정 서버 인증 확인은 지원하지 않는다. 기존 사용자 보관함이나 비밀 파일·브라우저/OS 보안 설정을 읽거나 바꾸지 않았다. Safari·Edge·물리 기기·전체 스위트·푸시·배포·운영 스모크는 실행하지 않았다. 완전한 메모리 소거를 보증하지 않으며 키 삭제는 제공사 키 폐기가 아니다.
