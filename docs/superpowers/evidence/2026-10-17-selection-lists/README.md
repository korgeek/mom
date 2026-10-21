# 색상·입력 언어 목록 구현 및 로컬 검증

날짜: 2026-10-17 (Asia/Jakarta). 사용자 승인: 색상·입력 언어만 구현하고 JSON 가져오기·내보내기·AI 수정 프롬프트를 포함하며 **로컬 커밋까지만**, 배포하지 않는다. 기준은 `2a05a47`, 저장 기반 커밋은 `bafa0f9`다. 최종 화면·기록 커밋은 Git 기록을 따른다.

관련 문서: [승인 설계](../../specs/2026-10-17-color-language-settings-design.md), [실행 계획](../../plans/2026-10-17-color-language-settings.md), [결정 기록](../../../09-decisions-and-roadmap.md).

## 구현 결과

- 설정의 `색상 · 언어 / Colors & languages` 탭에서 색상 HEX/선택기와 입력 언어 코드·이름을 추가·수정·삭제하고 영역별 기본값을 복원한다.
- 현재 적용 목록만 조회·내보내며 행 저장, 가져오기 적용과 복원은 암호화 저장 성공 후 반영한다. 실패한 편집은 재시도할 수 있고 이전 적용 목록은 보존한다.
- 기본 목록은 색상 6개·언어 5개다. 기본값과 다른 영역의 배열만 버전 1 Catalog 설정으로 보관한다. 이전 보관함의 필드 부재는 기본값으로 읽고 잘못된 저장 필드는 오류로 처리한다.
- 접수된 목록 변경은 잠금 시 private finalizer가 보존한다. 저장 실패 후 재시도, 잠금·다른 탭 소유권·늦은 응답, 다른 Catalog 쓰기와의 보존을 검사했다. 저장 전 미완성 행 입력은 임시이며 잠금·화면 이동 전에 저장해야 함을 표시한다.
- JSON은 실제 바이트 256 KiB, 목록별 1~64개, 지정 형식/버전/필드만 허용한다. 색상·언어 코드 정규화와 중복·타입·길이·UTF-8 검증을 한다. 언어 이름은 일반 텍스트로 표시한다.
- 가져오기는 변경 전/후 미리보기와 취소·명시적 적용을 거친다. 내보내기와 프롬프트에는 두 목록과 형식 식별자·버전만 들어간다. 외부 AI를 자동 호출하지 않는다. JSON과 복사한 프롬프트는 보관함 밖의 평문이다.
- 음성 준비 화면에서 직접 언어 코드 입력을 제거하고 설정 링크를 제공한다. 목록에 없는 기존 색상·선택 언어도 표시하고 그대로 유지한다. 새 메모의 기본 색상 `#2B59C3`와 입력 언어 `ko`, `en`은 유지한다.
- 아이콘·문구 편집·제공사 어댑터·오디오 인코딩·의존성·호스팅 설정은 변경하지 않았다.

## 환경과 명령 결과

Node v26.5.0, npm 12.0.1, 기존 설치 의존성. Vitest 단위 테스트와 Playwright의 별도 headful Chrome, `http://127.0.0.1:4174`를 사용했다. 실제 Chrome 버전 번호는 별도로 기록하지 않았다. 브라우저는 합성 보관함·설정만 사용하고 HTTPS 외부 요청을 차단했다. 클립보드 권한은 버려지는 테스트 Chrome context에만 지정했다. 기존 사용자 Chrome 프로필·보관함·API 키는 사용하지 않았다.

| 실제 실행 명령 | 결과와 범위 |
| --- | --- |
| `npx vitest run tests/settings-lists.spec.ts` | 19 PASS. 정규화·변경분·신뢰 경계·UTF-8·명시적 내보내기 필드. 처음에는 구현 모듈 부재로 RED를 확인했다. |
| `npx vitest run tests/settings-lists-persistence.spec.ts tests/settings-lists.spec.ts` | 25 PASS (저장 6 + 순수 19). 암호화 재열기·호출자 변경 분리·quota·즉시 잠금·소유권·Catalog 보존. 저장 API 부재의 RED 후 통과했다. |
| `npx vitest run tests/settings-lists-persistence.spec.ts -t 'malformed decoded'` | 추가 1 PASS, 6 제외. 테스트에서 복호화된 합성 Catalog에 잘못된 설정을 넣어 오류와 원래 저장값 보존을 확인했다. 암호 인증 우회를 제품에 추가한 검사가 아니다. |
| `npx vitest run tests/settings-lists-controller.spec.ts` | 4 PASS. 화면 적용 경계·기존/신규 메모 선택값·재시도·즉시 잠금·늦은 응답. 처음 API/상태 부재의 RED를 확인했다. |
| `npx vitest run tests/lock.spec.ts tests/vault-model-registry.spec.ts` | 33 PASS. 직접 영향받는 기존 잠금·Catalog 보존 경계. 이후 이 코드·입력·환경은 동일해 반복하지 않았다. |
| `npx vitest run tests/selection-list-settings-ui.spec.tsx tests/ui.spec.tsx -t 'managed lists\|color/language Settings\|legacy spoken languages\|adds, edits\|rejected edit\|atomically imports\|oversized\|copies current'` | 9 PASS, 91 제외. 새 편집 UI 5 + 연결 화면 4. 모듈 부재 및 기존 화면의 RED를 확인한 뒤 통과했다. 실제 명령의 정규식은 백슬래시 없이 `|`를 사용했다. |
| `npx vitest run tests/selection-list-settings-ui.spec.tsx` | 5 PASS, 비동기 오류 0. 행 편집/복원·재시도·취소/적용·파일 한도/알 수 없는 필드·늦은 파일 읽기·클립보드 실패. |
| `npx vitest run tests/ui.spec.tsx -t 'color/language Settings'` | 2 PASS, 93 제외. 한국어·영어 새 탭 및 다음 탭으로 키보드 이동/포커스. |
| `npx vitest run tests/storage-controller.spec.tsx` | 12 PASS, 기존 전사 모델 활성화 전제를 가진 3건 FAIL. 아래 기준 커밋 비교와 준비 과정 수정 후 해당 실패를 재검증했다. |
| `npx vitest run tests/storage-controller.spec.tsx -t 'blocks deleted historical chunks\|pending list preferences'` | 수정 후 4 PASS, 11 제외. 위 3개와 새 목록 재동기화 사례. 실제 명령의 정규식은 백슬래시 없이 `|`를 사용했다. 나머지 같은 12건의 통과 근거를 재사용한다. |
| `npx tsc --project tsconfig.app.json --noEmit` | PASS. 이후 최종 build의 타입 검사도 PASS. |
| `npx tsc --project tsconfig.tests.json --noEmit` | PASS. 테스트 도구 옵션/목 반환 타입의 초기 타입 오류를 수정한 뒤 재확인했다. |
| `npx tsc --project tsconfig.e2e.json --noEmit` | PASS. 새 브라우저 검사와 변경한 탭 개수 선택자. |
| `npm run build` | 최종 PASS. JS `index-DsWsHVYb.js`, CSS `index-Bav7-a-y.css`. 기존 혼합 import 경고 2개와 500 kB 초과 청크 경고는 유지된다. |
| `npm run test:secret` | 최종 build 후 PASS. 소유 소스·정적 자산·빌드 패턴 검사이며 일치값을 출력하지 않았다. |
| `npm run test:e2e -- tests/e2e/selection-lists.spec.ts` | 최종 build 4 PASS, 12.0초. 한국어·영어 × 360×800·1440×900. 초기 통과 뒤 내부 스크롤 하단 캡처를 보완했고, 저장 경계 수정으로 build가 바뀐 뒤 최종 4건을 다시 확인했다. 외부 요청 0, page error 0. |
| `npm run test:e2e -- tests/e2e/selection-lists.spec.ts -g 'ko 1440'` | 1 PASS, 4.7초. 클립보드 불일치 시 원문 대신 비교 boolean만 출력하도록 검사 코드를 정리한 뒤 해당 검사만 확인했다. 제품 코드는 동일하다. |

관련 단위 사례는 중복 실행을 제외하고 87개다. 전체 스위트는 실행하지 않았다. 위 표는 단일 전체 스위트의 통과 주장 대신 변경된 경로의 실제 명령·결과와 재사용한 근거를 구분한다.

## 발견·수정한 경계와 기준 커밋 비교

목록 저장 실패 후 private finalizer가 접수된 변경을 저장하는 경우, 오디오 정리 뒤 화면에는 이전 목록이 남을 수 있었다. 새 사례 `refreshes pending list preferences committed by an audio cleanup finalizer`가 저장소/화면 불일치로 실패하는 것을 확인한 후, `restoreLocalConnections`에서 목록도 다시 읽어 해결했다. 다른 정리·복구 흐름의 통과도 함께 확인했다.

기존 실패는 `blocks deleted historical chunks from initial dispatch before provider or audio reads`, 같은 이름의 `retry-failed`, `rerun-successful` 세 사례다. 테스트가 새 보관함의 전사 모델 자동 활성화를 가정해 실제 삭제 보호 검사 전에 `enabled === true`에서 실패했다. `git archive 2a05a47`로 `/tmp/mom-lists-baseline.vXAiei`에 관련 tracked 소스와 테스트만 복사하고 기존 node_modules를 연결해, 그 폴더에서 `vitest run tests/storage-controller.spec.tsx -t 'blocks deleted historical chunks'`를 실행했다. 동일한 3 FAIL·11 제외를 확인했으며 현재 checkout을 reset/pull하지 않았다.

해당 세 테스트의 준비 과정에서 합성 전사 경로를 명시적으로 등록·활성화·기본 선택하도록 수정했다. 삭제 보호·음성 읽기·외부 호출 없음에 대한 검사는 약화하지 않았고 제품의 제공사 선택 정책은 변경하지 않았다. 그 외 초기 테스트 문제는 동결 session의 Proxy 준비 방식과 FileList 준비 방식이었다. 기존 테스트 패턴에 맞춰 수정했고 진단 출력은 제거했다.

## 실제 렌더링 확인

네 조합에서 기본 목록, 편집, 가져오기 미리보기/취소/적용, 현재 목록, 하단 내보내기·복사, 기존 메모 선택지, 잠금·재로드 상태를 실제 조작했다. JSON 다운로드 내용과 복사한 프롬프트의 적용 목록 포함 여부도 확인했다. 행 이름은 합성 시험 자료다. 네 조합의 적용·미리보기·하단 캡처와 대표 편집/메모 선택 캡처 총 14개를 보존했다.

| 화면 | 한국어 360 | 한국어 1440 | 영어 360 | 영어 1440 |
| --- | --- | --- | --- | --- |
| 적용 목록 | [보기](360-ko-applied.png) | [보기](1440-ko-applied.png) | [보기](360-en-applied.png) | [보기](1440-en-applied.png) |
| 가져오기 미리보기 | [보기](360-ko-preview.png) | [보기](1440-ko-preview.png) | [보기](360-en-preview.png) | [보기](1440-en-preview.png) |
| 하단 내보내기·복사 | [보기](360-ko-controls.png) | [보기](1440-ko-controls.png) | [보기](360-en-controls.png) | [보기](1440-en-controls.png) |

대표 상태: [편집](360-en-edit.png), [기존 메모 선택 보존](360-ko-import-choices.png). 데스크톱은 내부 스크롤 아래의 조작 영역을 별도 캡처했다. 영어 화면에서도 파일 입력의 기본 버튼 문구는 OS/브라우저 언어를 따른다. 별도의 OS 설정을 변경하지 않았다.

## 변경 파일

제품: `src/react-app/settings/lists.ts`, `src/react-app/App.tsx`, `src/react-app/controller.tsx`, `src/react-app/vault/store.ts`, `src/react-app/vault/session.ts`, `src/react-app/ui/copy.ts`, `src/react-app/ui/components/SelectionListSettings.tsx`, `src/react-app/ui/screens/Settings.tsx`, `src/react-app/ui/screens/Import.tsx`, `src/react-app/ui/styles.css`.

검사: `tests/settings-lists.spec.ts`, `tests/settings-lists-persistence.spec.ts`, `tests/settings-lists-controller.spec.ts`, `tests/selection-list-settings-ui.spec.tsx`, `tests/ui.spec.tsx`, `tests/storage-controller.spec.tsx`, `tests/e2e/selection-lists.spec.ts`, `tests/e2e/responsive.spec.ts` (탭 개수만 5→6, 해당 파일의 전체 시나리오는 재실행하지 않음).

문서: `docs/09-decisions-and-roadmap.md`, `docs/11-design-reference-review.md`, 승인 설계·실행 계획, 이 README와 같은 폴더의 합성 PNG 14개.

## 한계와 마무리 검사

실제 오디오/STT/회의록 품질·인증된 제공자 호출·다른 장비·브라우저·전체 제품 출시 검증은 수행하지 않았다. 이 변경의 로컬 기능 검증이며 배포·push·의존성 설치는 하지 않았다. 내보낸 설정은 평문이고 언어 목록 등록은 모델 지원을 보증하지 않는다.

마무리 `git diff --check` PASS, markdown-it으로 변경 문서 5개의 로컬 링크 42개 PASS, SHA-256 및 파일 목록 비교로 레퍼런스 6/6 원본 보존을 확인했다. 저장된 합성 PNG는 14개·1,146,096 bytes다. 최종 diff에서 두 목록의 저장·선택·출력 경계와 호출부를 다시 확인했다.

## 후속 확인: 음성 준비 선택지와 배포 승인

사용자는 첨부 화면으로 회사 색이 메모 아이콘 색상 선택지임을 명확히 했다. 기존 테마·화면 언어 선택을 유지하고, 기본 아이콘 9개를 준비 화면에서 선택하며, 사용 언어의 표시 이름·코드 쌍을 관리한다. 이 최신 요청에는 커밋·배포가 명시되어 최초 로컬 전용 결정을 대체한다.

변경은 `SelectionListSettings.tsx`, `Settings.tsx`, `Import.tsx`, `ui/styles.css`와 직접 연결된 UI/E2E fixture, 설계·계획·결정·검증 기록이다. 탭을 `음성 준비`로 명명하고 기본 아이콘 세트·색상 적용 미리보기·언어 이름/코드 안내와 두 목록의 관리 링크를 추가했다. 저장·가져오기·내보내기 형식과 잠금·제공사 처리는 변경하지 않아 앞의 저장/파서 검증을 재사용한다.

| 명령 | 결과 |
| --- | --- |
| `npx vitest run tests/selection-list-settings-ui.spec.tsx -t 'shows the built-in memo icons'` | 구현 전 RED: 기본 아이콘 영역 없음. |
| `npx vitest run tests/selection-list-settings-ui.spec.tsx tests/ui.spec.tsx -t 'shows the built-in\|adds, edits and deletes\|keeps a rejected edit\|previews, cancels\|rejects oversized\|copies current applied\|uses managed lists\|opens the color/language Settings tab'` | PASS 9, 변경 밖 92 skip. |
| `npm run build` | PASS. JS `index-ByjUeX_y.js`, CSS `index-DB69GK_V.css`. 기존 미디어 mixed-import와 큰 chunk 경고 유지. |
| `npx tsc --noEmit -p tsconfig.tests.json && npx tsc --noEmit -p tsconfig.e2e.json && git diff --check` | PASS. |
| `npm run test:secret` | 최종 build 대상 PASS, 일치값 출력 없음. |
| `npx playwright test --config playwright.config.ts tests/e2e/selection-lists.spec.ts` | 별도 로컬 headed Chrome PASS 4 (12.9초), 한국어/영어 × 360×800/1440×900. 외부 요청 0, pageerror 0. |
| `git ls-remote origin refs/heads/main` | 배포 전 원격 `2f79138`, 로컬 기록과 같음. pull/reset 없음. |

실제 회사 색 `#123456` 선택이 제목·상단 제목 아이콘의 `rgb(18, 52, 86)`에 반영됨, 중요 아이콘 선택 유지, 기존에 고른 색상·언어 보존, 기존 Theme/Color palette/Interface language 제어와 theme/palette 속성 보존, 언어 표시 이름의 복수 선택, 저장·재로드, 가져오기·내보내기·실제 클립보드를 확인했다. 합성 테스트 데이터만 사용했다. 아래 8개 캡처를 직접 보고 레이아웃·문구·색상·줄바꿈을 확인했다.

- [한국어 데스크톱 설정](preparation-1440-ko-defaults.png), [한국어 좁은 설정](preparation-360-ko-defaults.png)
- [영어 데스크톱 설정](preparation-1440-en-defaults.png), [영어 좁은 설정](preparation-360-en-defaults.png)
- [회사 색 적용 데스크톱](preparation-1440-ko-import.png), [회사 색 적용 좁은 화면](preparation-360-ko-import.png)
- [한국어 언어/입출력](preparation-1440-ko-controls.png), [영어 언어/입출력](preparation-1440-en-controls.png)

원본 레퍼런스 파일 6개의 경로·SHA-256은 기존 스냅샷과 동일하다. 전체 스위트와 실제 제공사 추론은 실행하지 않았다. 내보낸 JSON·프롬프트는 평문이며 언어 등록은 모델 지원을 보증하지 않는다.

### 배포·운영 확인

`68f5531`을 `git push origin main`으로 배포했다. 이전 로컬 홈 문구/저장/목록 UI 커밋도 함께 포함했으며 원격 `2f79138..68f5531`로 정상 진행했다. 강제 푸시·pull/reset·직접 wrangler 배포는 하지 않았다. `gh api repos/korgeek/mom/commits/68f5531/check-runs --jq '.check_runs[] | {name,status,conclusion}'`에서 `Workers Builds: mom`, `completed`, `success`를 확인했다.

사용자의 기존 Chrome 운영 탭 [MoM](https://mom.korgeek.workers.dev/)을 새로고침하고 제공된 테스트 암호로 로컬 잠금을 해제했다. 실제 표시 크기는 1492×1103이다. 홈 문구/LOCAL 제거, 기존 제목·중요 아이콘·선택 색·입력 언어 보존, 화면·언어 탭의 라이트/코발트/한국어 선택과 다른 기존 옵션, 음성 준비 탭의 기본 아이콘·색상·언어 이름/코드·초기화·입출력·프롬프트 버튼을 확인했다. 언어 편집을 열어 현재 코드/이름 필드를 확인한 뒤 저장 없이 취소했다. 기존 메모의 준비 화면에서 직접 코드 입력이 제거되고 `색상 · 언어 목록 관리 →`가 같은 설정 탭으로 연결됨을 확인했다. 운영 저장값·키·녹음·제공사 호출은 변경하지 않았다.

운영 DOM의 자산 경로가 로컬 검증 build의 `/assets/index-ByjUeX_y.js`, `/assets/index-DB69GK_V.css`와 일치했다. [운영 설정 캡처](production-settings.jpg), [운영 언어·입출력 캡처](production-language-controls.jpg)를 저장하고 직접 확인했다. 운영에서는 기능 표시/탐색 smoke를 수행했으며 실제 저장·입출력·회사 색 변경은 앞의 합성 로컬 Chrome 검증을 따른다.
