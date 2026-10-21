# 공통 3열·무활동 잠금·작업 정책 — 로컬 QA 인계

**후속 승인:** 최종14개 합성 캡처 Library 전달과 부모 실제 픽셀 QA가 통과했다. 사용자가 배포와 배포 검증 후 로컬 정리를 승인했다. 현재 릴리스 단계는 [배포 기록](release/README.md)을 따른다. 아래 로컬 QA의 당시 상태와 실패·재검증 이력은 보존한다.

기준 `main`과 로컬 `origin/main`은 `39be49a7c3fd566d52f20f2b5a6dd8f3c8fc5199`다. fetch/pull/reset 없이 원래 작업 공간을 보존했다. 작업은 `/Users/korgeek/Workspace/mom/.worktrees/mom-screen-lock-responsive`, 브랜치 `feat/screen-lock-responsive-20261018`에 있으며 **이 문단은 로컬 QA 인계 당시 기록이다. 이후 QA·커밋·배포·정리 완료 상태는 위 배포 기록을 따른다.**

로컬 산출물 미리보기: `http://127.0.0.1:4193/` (로컬 QA 당시 사용; 현재 상주 실행을 보장하지 않음). 세션이 종료됐다면 위 worktree에서 `npx vite preview --host 127.0.0.1 --port 4193 --strictPort`로 연다. 이 원점도 테스트 전용으로 사용하고 실제 키·기존 사용자 보관함을 가져오지 않는다. 제품 의존성 설치, 실제 키·유료 AI·실제 사용자 DB·보안 설정 변경도 하지 않았다. 기존 node_modules를 링크해 사용했다.

[승인 계획](../../plans/2026-10-18-responsive-screen-lock.md) · [개인정보 정책](../../../06-privacy-and-local-storage.md) · [결정 기록](../../../09-decisions-and-roadmap.md)

## 부모 UX 검토 1차 반영 — 새 built QA

앞선 전달본에 대한 부모 검토 범위만 수정했다. 화면 잠금은 짧은 복귀 안내를 먼저 보여 주고 키·메모리·보호 한계를 기본 닫힌 상세에 보존한다. 보안 설정은 자동 잠금의 짧은 설명을 먼저 보여 주고 세부 활동 정의를 접는다. 보관함 초기화는 기본 닫힌 관리 항목으로 옮겼으며, 펼쳐도 삭제는 별도의 typed confirmation을 거친다. 관리 항목을 닫으면 이전 확인 입력도 폐기한다.

1100px 이하에서 녹음 중 메모 정보를 제목·언어 요약으로 접어 상태와 저장 후 종료를 먼저 배치한다. 완료된 정리 결과가 있으면 설정을 기본 접어 결과를 먼저 보여 주고 사용량·비용은 요약과 상세로 나눈다. 제목을 먼저 입력하거나 최초 모델을 선택한 것만으로 접기를 해제하지 않는다. 사용자가 직접 펼친 설정, 응답 시점의 편집 초점 및 미적용 언어·분량 초안은 보호한다. 숨긴 본문은 mounted 상태와 값을 유지하며 hidden/inert로 조작·접근성 노출을 막는다. 넓은 화면의 3열 구조와 기존 상세는 유지한다. 재생성 시 전송 동의는 새로 요구한다.

영문 [프로젝트 README](../../../../README.md)와 [보안 상세](../../../security-and-encryption.md)를 추가 정리했다. 백업은 구현하지 않았다. 미래 설계는 원래 vault 암호문·wrapped-key/header·nonce/횟수 구조를 보존한 채 별도 백업 암호로 outer archive를 암호화하며, 복원에는 **백업 암호와 원래 vault 암호 둘 다 필요**하다. archive 형식/KDF는 아직 결정하지 않았다.

이번 수정의 로그는 `/tmp/mom-screen-lock-responsive/ux-pass1/`에 있다. 전체 저장소나 이전 53개 변경 파일의 모든 검사를 반복하지 않았다.

| 이번 직접 영향 검사 | 명령·결과 |
| --- | --- |
| 잠금 문구·설정·삭제 확인 | `npx vitest run --config /tmp/mom-screen-lock-responsive/core/vitest.config.mts tests/lock-information-density.spec.tsx tests/screen-lock-ui.spec.tsx tests/vault-reset-ui.spec.tsx` → **20 PASS**, 신규 2개는 실제 RED→GREEN. `core/lock-density-*.log` |
| 녹음·정리 우선 배치 | 같은 Vitest 설정으로 `tests/compact-work-priority.spec.tsx` → **13 PASS**, 최초 초점/제목 입력 흐름의 RED→GREEN 포함. `ui/normal-flow-{red,green}.log` |
| 직접 연결 UI 회귀 | `tests/mobile-metadata.spec.tsx tests/mobile-workflow.spec.tsx tests/session-drafts.spec.tsx` → **31 PASS**. 같은 Usage 코드의 `tests/usage-ui.spec.tsx` **11 PASS** 근거 재사용. `tests/ui.spec.tsx`의 전송 동의·출력 저장 선별 **8 PASS / 92 제외**. `ui/*regressions*.log` |
| 타입·새 산출물 | `npx tsc -b`, `npx vite build`, `npm run test:secret` → **PASS**. `typecheck.log`, `build.log`, `public-artifacts.log`. 기존 큰 번들/import 경고는 남음 |
| 변경 UI/새 테스트 lint | 해당 TS/TSX만 `npx eslint` → 오류·경고 0. `core/lock-density-eslint.log`, `ui/eslint-final.log`, `built/eslint.log` |
| 별도 built 브라우저 | 새 파일 `tests/e2e/ux-pass1-built.spec.ts`의 **6개 합성 시나리오 모두 통과 근거 확보**: 최초2 PASS + 820녹음1 PASS + notes1 PASS + 수정 후390/빠른입력2 PASS. 단일 clean6 재실행으로 표현하지 않음 |

최초 built 묶음은 2 PASS / 4 실패였다. 제목 암호화 저장 직후 disabled인 Start를 `evaluate().click()`으로 누른 390/820 두 건과, 지침 자동 저장·preflight 갱신 전에 동의/Enter를 보낸 notes 한 건은 harness의 준비 대기 문제로 분리했다. disabled/동의 경계를 약화하지 않고 명령 가능 상태를 기다린 뒤 해당 실패만 재검사한다. 이 과정에서 390px의 실제 종료 버튼 하단 가림과 빠른 Enter·터치의 취소 재타깃은 제품 문제로 확인했다.

빠른 입력은 synthetic getUserMedia를 보류해 결정적으로 재현했다. Start의 trusted Enter click 372.2ms 뒤, 같은 좌표의 touch click 413.5ms가 permission 상태의 `녹음 취소`에 전달됐다(+41.3ms). 무키 DOM 재사용은 코드로 확인되지 않았고, permission에서 메모 정보 접힘과 단일 취소 버튼의 위치가 원인이다. permission 중 동일한 Start DOM/첫 슬롯을 비활성 상태로 유지하고 Cancel은 별도 오른쪽에 정렬했다. 권한 대기 취소 자체를 막거나 시간을 근거로 입력을 버리지 않는다. 상태 뒤에 실행 버튼을 먼저 배치하는 순서와 슬롯 검사는 각각 실제 RED→25 PASS다. 새 built에서 같은 좌표의 +41.7ms touch는 비동작 `입력` 영역에 전달돼 녹음이 유지됐다. 별도의 명시적 Cancel은 정상 동작했고 늦은 permission stream도 정리됐다.

중복 명령의 짧은 `작업 중이에요.` 안내는 기존 코드에서 작업 완료 뒤에도 남았으므로 3초 뒤 같은 안내만 해제하도록 수정했다. 다른 오류·저장 안내를 지우지 않으며 작업·네트워크·무활동 시간을 갱신하지 않는다. `tests/recording-controller.spec.tsx -t 'expires duplicate-command status|synchronously rejects duplicate Start'` → 신규 실제 RED→**2 PASS / 18 제외**, 실제 녹음 한 번과 권한 대기 취소를 유지했다. `core/duplicate-notice-*.log`가 근거다.

별도 QA의 정확한 기본 명령은 `./node_modules/.bin/playwright test --config /tmp/mom-screen-lock-responsive/ux-pass1/built/playwright.config.mjs`다. 최초 묶음은 `run.log`, 820 녹음의 선별 재검사는 `recheck.log`, notes의 최종 단일 검사(`--grep 'built transcript and notes'`)는 `notes-final.log`, 마지막390/빠른입력 선별(`--grep 'controls at 390|built rapid touch'`)은 `final-fixes.log`에 있다. 모든 명령의 output 경로와 실패·재검사 매핑은 `/tmp/mom-screen-lock-responsive/ux-pass1/built/README.md`에 보존했다. notes 재검사에서 지침 autosave/preflight 이후 fresh consent를 기다리고, Enter 뒤 `생성 중…`으로 바뀐 버튼은 원래 element handle로 두 번째 입력을 보내는 harness 수정도 했다. 전송 동의나 중복 방어를 약화하지 않았다.

새로 추가한 3초 busy 안내의 실제 만료/깨끗한 캡처는390 한 건만 다시 확인했다(`clean-captures.log`, PASS). 숫자 기록을 위해 이미 시작됐던 동일390 한 번은 완료 후 중지했다(`geometry-evidence.log`, PASS); 그 뒤 추가 테스트는 하지 않았다. 종료 버튼 bottom은 안내 표시 중 **767.953px**, 해제 후 **707.156px**로 모두844px 안이었다. status와 버튼의 원시 bbox는 `geometry-evidence/*/recording-geometry.json`에 있다.

녹음/notes 요청 수는 각각 캡처1회, STT1회·LLM2회(명시적 재동의 후 생성)였다. 추가 중복 요청은 없었다. notes 감사의 원시 IDB81 records에서 title/raw transcript/notes/미저장 draft sentinel 평문0, local/session Storage 빈 배열, CacheStorage0, SW0을 확인했다. 콘솔은 비민감5건이며 **민감 sentinel0**이다. 오류와 실제 외부 요청은0이었다. 합성localhost:8000 전송은 Playwright가 가로챘다.

첫 UX built는 `index-DuGfzefK.js` / `index-DK1Guq3_.css`였고, 마지막 녹음 버튼/notice 수정 산출물은 **`index-CnThzoZg.js` / `index-DsVIOx9T.css`**다. 각 build 후 preview를 중지/재시작했다. 마지막 `npx tsc -b`, `npx vite build`, `npm run test:secret`도 모두 PASS(`*-final.log`)다. 마지막 두 녹음 검사만 새 산출물에서 재검증했고, 변경되지 않은 notes/설정/strict 근거는 재사용했다. QA는 `/assets/index-*.js`를 확인했고 `/src/`와 `/@vite` 요청은 없었다. 실제 provider 키·유료 AI·사용자 DB는 사용하지 않았다.

최종 브라우저 harness 편집 후에는 `npx tsc -b`와 `npx eslint tests/e2e/ux-pass1-built.spec.ts`만 갱신해 PASS했다(`typecheck-handoff.log`, `built/eslint-handoff.log`). 제품 코드는 바뀌지 않아 빌드·기능 검사를 다시 반복하지 않았다. 저장 문서4개 재독/상대 Markdown 링크82개/`git diff --check` PASS, 원래 checkout은 clean이며 HEAD와 로컬 origin/main은 여전히39be49a다. 정확한 변경 파일은61개다.

이번에 실제 렌더/픽셀 확인한 것은 390×844 녹음/잠금/엄격 완료분, 768×1024 보안 설정, 820×1180 녹음/정리/사용량, 1440×900 녹음3열/홈/전사실행/처리기록목록·상세/모델관리다. 새 캡처는 `ux-pass1/built/{results,recheck,notes-final,final-fixes}/`에 보존했다. 아래 Library 링크는 **앞선 전달본**이며 이번 UX 수정 이미지를 아직 교체하지 않았다.

앞선 인계에서는 Library 서비스 도구가 남아 있어도 prepared-upload helper 원문 리소스를 읽을 수 없어 전달이 보류됐다(`skill package is not available`; 당시 cloud skill 목록도 비었음). 캐시 검색·임의 helper 구현·다른 업로드 방식으로 우회하지 않았다. 후속 요청에서 지원 여부를 한 번 재확인하자 현재 skill과 필수 도우미3개는 모두 제공됐다. 새 private 디렉터리에 원문 그대로 받아 지원된 helper로17개 ordered batch를 요청했다. 시스템 Python3.9는 import 단계에서 문법 미지원으로 종료돼, 이미 설치된 Python3.12로 동일 helper/요청을 실행했다. 이때 **`Library prepare_uploads is not available`**로 중단됐다. 모델 쪽 prepared 도구 이름은 노출돼 있지만 helper 실행 환경에서 필요한 인증된 도구 연결을 사용할 수 없는 것이 현재 blocker다. 별도 prepare/finalize 호출·직접 업로드로 우회하지 않았고 성공 결과가 없어 Library 전달 완료로 표시하지 않는다. 결과/오류는 `ux-pass1/deliverables/prepared-upload-{result.json,stderr.log}`에 보존했다.

이후 부모가 명시적으로 요청한 ‘도구 미제공 시 허용된 fallback’ 분기를 실제 schema와 `writeback-and-conflicts.md`로 확인했다. `create_library_file(files=[...])`가 제공돼 영문 README와 보안 문서2개를 ordered create로 저장했다. 둘 다 succeeded/version0이며 현재 helper로 원래 로컬 경로의 반환 identity/xattrs도 저장했다. 기존 QA 보고서는 새 항목으로 만들지 않고 보관한 ID와 version1 조건으로 교체한다. prepared 요청 결과가 불명확하거나 접근 거절된 상태를 우회한 것이 아니라, helper가 준비 도구 미제공으로 중단된 경우의 명시적으로 허용된 경로를 따른 것이다.

캡처14장은 QA 합성 화면이며 사용자 제공 JPEG/실제 사용자 DB 화면을 포함하지 않는다. 다만 이 실행 대화에는 부모의 이미지 전달 지시만 있고 원사용자의 명시적 스크린샷 파일 전달 요청 원문을 확인하지 못했다. 최신 Library screenshot 제한과 부모의 후속 조건에 따라 이미지 저장은 보류한다. 앞서 부모 전달 지시를 충분한 요청 근거로 취급한17개 helper 시도는 성공 결과가 없었으며, 이번 fallback에는 캡처를 포함하지 않았다.

## 구현한 동작

| 영역 | 이전 | 현재 로컬 구현 |
| --- | --- | --- |
| 큰 화면 본문 | 단계 3등분과 본문 4:6/2분할 기준이 다름 | 동일한 3개 track·20px gap. 준비/전사 실행/정리 1:2, 검토 2:1. 행은 독립 유지 |
| 모바일·태블릿 | 760~1100px에서 사이드바와 좁은 본문이 공존 | 1100px 이하 간결한 상단 탐색·한 열 본문·가로 설정 탭. 759px 이하의 단계 한 줄·완료 상세·초점 유지. 넓은 터치 화면도 44px 조작 영역 |
| 자동 잠금 | 5/15/30분·기본15분, 숨김 즉시 전체잠금 | 1/3/5/10/30분/1시간/잠기지 않음, 기본1분. 실제 경과 시간 기준 |
| 표준(기본) | 잠금이 녹음/요청을 취소 | 화면 가림·재생 중지·새 명령 차단, 승인한 녹음/준비/STT 묶음/정리는 계속. 잠긴 상태의 마지막 작업 저장 후 키 참조 해제 |
| 엄격 | 별도 정책 없음 | 화면잠금 또는 visibility hidden 시 중단·완료분 저장·키 해제. blur 자체는 경계가 아님 |
| 실행 중 정책 변경 | 흐름 없음 | 바로 끊지 않고 다음 잠금/hidden 경계부터 적용. 중단 작업은 사용자 재실행 |
| 편집·복원 | 컴포넌트 재마운트/전체잠금 시 미적용 입력 유실 | 화면/선택 메모/설정 탭과 Review·Minutes·준비/STT 입력 초안을 기존 암호화 경로로 보존. 암호/API키 입력·전송 동의는 제외 |
| 중단 녹음 표시 | 현재0과 이전 조각 용량 혼재 | 현재 녹음이 없음을 표시하고 보존된 조각 용량을 별도 표시. 자동 완성/이어녹음으로 표현하지 않음 |

타이머 갱신은 이 페이지의 trusted pointerdown/누른 상태 drag, 클릭·키보드·입력/IME·wheel·touchmove다. 단순 마우스 이동·프로그램 입력/스크롤·진행 이벤트·네트워크·focus/pageshow는 활동이 아니다. 포커스/복귀와 새 명령은 만료부터 검사한다. wall clock과 monotonic clock을 함께 사용해 숨김·sleep 지연을 반영한다. 카운터는 별도 작은 컴포넌트에서 1Hz, 숨김/사용 안 함에서는 interval 중지, `role=timer`/`aria-live=off`로 매초 읽기를 방지한다.

새 사용자와 이전 암호화 설정이 없는 사용자는 60초·표준이다. 설정은 암호화 catalog에 저장되므로 새로 열어 암호를 확인하면 복원된다. 기존 AppPreferences의 autoLockMinutes/lockOnHide 필드는 이전 호출자 타입 호환용이며 현재 화면 잠금에 사용하지 않는다. 기존 저수준 vault 단독 테스트의 hard-lock 옵션은 유지한다.

잠금은 민감 DOM/접근성 트리를 제거한다. 이미 배포된 요청의 취소는 비용을 되돌리지 않는다. 표준 실행 중 키·데이터는 탭 메모리에 남는다. 암호 재검증은 기존 wrapped key를 검증하며 실행 job·소유권을 다시 만들지 않는다. 전체 잠금 저장 실패는 일반 복구 화면에서 새 작업을 막고 명시적 재시도를 제공한다. 한 탭만 vault를 소유하며, 실제 Web Locks 해제 완료까지 기다린다. 새로고침/종료는 최신 UI 초안을 먼저 stage하고 기존 private finalizer를 쓰는 best effort 경계다. 브라우저 강제 종료가 비동기 저장을 끝낼지는 보장할 수 없다.

설정 왕복은 진행 작업을 유지한다. 완료 응답도 사용자가 보고 있는 설정을 강제로 떠나게 하지 않는다. 작업 시작의 기존 동기 busy/owner guard를 유지하고, 중첩 recording/model callbacks도 잠금 상태를 확인한다. 충돌하는 녹음 화면 이동만 계속 진행/중단하기를 확인하며, 중단 handoff/저장 후 이동한다. 중복 명령은 짧은 상태로 처리하고 같은 상태 알림을 계속 다시 만들지 않는다.

## 저장·전송 감사 근거

- `wrangler.json`: 정적 `dist/client` Assets만 제공, 앱 Worker main/회의 API handler/데이터 바인딩 없음. observability false. 생성된 `dist/client/wrangler.json`도 D1/KV/R2/DO/analytics binding이 비어 있다. 소스의 외부 요청은 선택 제공사 또는 등록 origin으로 직접 전송한다. 이 근거는 현재 소스/산출물이며 운영 계정 전체 설정 재감사를 뜻하지 않는다.
- IndexedDB 기록 전 audio blocks/manifests/pointers, 프로젝트(원시 STT·원문·정리/수정 버전), catalog, API키, sourceDraft와 새 ScreenState를 암호화한다. header의 salt/IV/wrapped key/식별자·횟수 및 암호문 크기 같은 기술 메타데이터는 평문이다.
- 합성 Chrome 감사: 원시 IDB 3개 store·Web Storage에 sentinel 평문 없음, CacheStorage 없음, SW0, 콘솔 sentinel 없음, 외부 호출 없음. 오암호 거절 후 정상 복원. 실제 STT/정리 UI 합성 요청의 raw/notes/draft sentinel도 누출 없음.
- 직접 fetch/공통 JSON transport에 `cache: no-store`를 강제한다. 기존 브라우저 캐시 삭제나 제공사 데이터 보관 보장이 아니다. 화면 잠금 시 preview URL을 revoke하고 전체 해제 시 작업용 File/키 참조를 정리한다.
- 브라우저 Blob은 디스크로 옮겨질 수 있다([Chromium 공식 설명](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/storage/browser/blob/README.md)). 앱의 암호화 IDB 쓰기와 OS swap/브라우저 Blob 저장은 다르다. 전체 메모리 소거·개발자 도구 접근 차단을 보장하지 않는다.
- 시작/설정에 회원가입 없는 음성 메모·현재 기기 브라우저 보관을 짧게 안내한다. AI 전송 직전 서비스/데이터 확인은 유지한다. 제공사 보관, 평문 메타데이터, .md/클립보드의 평문 범위는 설정 상세에 둔다. **기기 이전/전체 보관함 백업·복원은 없다.** 지원되는 정리 결과 `.md` 다운로드를 전체 데이터 마이그레이션으로 설명하지 않는다.

## 검사 명령·실제 결과

모든 로그/캡처는 `/tmp/mom-screen-lock-responsive/`에 있다. 전체 repository test suite는 실행하지 않았다.

| 직접 영향 검사 | 실제 결과·로그 |
| --- | --- |
| `npm run test:unit -- tests/screen-state.spec.ts tests/lock.spec.ts tests/vault.spec.ts` | 62 PASS, `vault/work-policy-vault-green.log`. vault-reset30 PASS는 기존 session finalization 변경 시 별도 확인 |
| provider 10개 선별(-t) | 실제 RED10→GREEN10, `vault/no-store-{red,green}.log`에 정확한 명령 |
| `npx vitest run --config /tmp/mom-screen-lock-responsive/core/vitest.config.mts tests/screen-idle.spec.ts tests/screen-lock-controller.spec.tsx tests/screen-lock-ui.spec.tsx tests/screen-lock-races.spec.tsx tests/preparation-reset-controller.spec.tsx tests/recording-controller.spec.tsx tests/session-drafts.spec.tsx` | 51 PASS, `core/focused-final.log` |
| `... tests/recording-ui.spec.tsx` | 25 PASS. 중단 0계기판 실제 RED→GREEN, `core/interrupted-metrics-*.log` |
| 초안 및 모바일/UI 직접 영향 | 신규초안12, 기존mobile19, ui선별33 PASS. `ui-drafts/` 명령별 로그 |
| 타입 쿼리 수정 | 처음 `npm run build`에서 Testing Library ByRole의 불필요한 exact 옵션 26개 타입 오류. 옵션 제거 후 tests typecheck와 바뀐3파일21 PASS (`final-test-types.log`, `core/query-types-recheck.log`) |
| 최종 브라우저 묶음 `npx playwright test --config /tmp/mom-screen-lock-responsive/final/playwright.config.ts` | 23개 중20 PASS, 3실패를 아래처럼 구분·수정. 전체 묶음 반복 없이 실패/영향만 재검증 |
| native Web Locks / strict late response | 첫째: cold unlock 실패 후 verifying UI에 머무는 실제 버그, 별도 unit RED→GREEN. 둘째: 이전 테스트 getByLabel 중복 선택자. `... tests/e2e/lock.spec.ts -g 'native Web Locks|in-flight request' --output /tmp/mom-screen-lock-responsive/final/failed-lock-recheck` → 2 PASS |
| 타이머 wheel | 테스트 clock 진행 전 실제 wheel delivery를 기다리지 않은 harness 문제. isTrusted:true/delta240 1회와 실제 scrollTop0→61 확인 후 해당1개 PASS. `browser/wheel-fix.log`, `wheel-fix/*/trusted-wheel.json` |
| 캡처 후 발견한 오류 표시 | 오암호 정상 복귀 후 일반 오류가 남음. 재인증 자체 오류 상태로 한정. unit RED→GREEN + `... tests/e2e/screen-lock.spec.ts -g 'standard screen lock hides' --output /tmp/mom-screen-lock-responsive/final/reauth-message-recheck` → 1 PASS, live recording·저장·alert0 확인 |
| 마지막 산출물 | `npx tsc -b`, `npx vite build`, `npm run test:secret` **모두 PASS**. 결과는 final/*-final.log. Vite는 기존 큰 번들/동적·정적 import 경고를 출력했다. 변경 TS/TSX ESLint 오류0, App.tsx 기존 Fast Refresh 경고1개이며 CSS는 ESLint 대상이 아니다. 변경된 마지막 handler/문구로 이전 산출물 근거가 무효여서 이 부분만 갱신 |

독립 코드 검토에서 발견한 복구 gate·중첩 callback·pagehide 초안·strict opening·복합 재준비·완료 후 설정 이탈 6건을 수정했고 focused 검사가 통과했다. 추가 cold unlock/오암호 표시 2건은 최종 통합/픽셀 검토에서 찾고 targeted RED→GREEN으로 확인했다. 독립 검토가 부모의 실제 QA를 대신하지 않는다.

## 실제 렌더·Library 전달

별도 headful Chrome 테스트 창, 합성 데이터만 사용했다. 실제 렌더 폭: **360/390/759/760/768/820/960/961/1024/1100/1101/1180/1440px**. 큰 화면의 세 행 경계·검토 2:1, 한글/영문, 넓은 터치, 단계 한 줄/접기/키보드 초점, 준비/STT/정리/설정, 녹음·오암호·복귀·엄격 중단을 확인했다. 운영 사용자 JPEG도 Library에서 맥미니 `/tmp`로 내려받아 읽기/형식/실제 픽셀을 확인했다. 실제 사용자의 DB는 열지 않았다.

| 캡처 | Library |
| --- | --- |
| 390 최종 산출물 시작 안내 | [PNG](https://chatgpt.com/api/library/files/libfile_2bc83fd880b08191baf75e03a9f1d9ea/download) |
| 1440 최종 산출물 시작 안내 | [PNG](https://chatgpt.com/api/library/files/libfile_0cda087d4c148191b092252ccacd5fdf/download) |
| 1440 준비 1:2 | [PNG](https://chatgpt.com/api/library/files/libfile_f585a0ac3c8c8191b4ac103f5d8aeb7c/download) |
| 1440 전사·검토 2:1 | [PNG](https://chatgpt.com/api/library/files/libfile_46ed239109a481918a67924a9a5ad2f3/download) |
| 768 설정 | [PNG](https://chatgpt.com/api/library/files/libfile_825a1e0b4e588191b3fb41a3ef29872b/download) |
| 390 녹음 정상 복귀(오류 표시 수정판, version1) | [PNG](https://chatgpt.com/api/library/files/libfile_cb37e60201748191b1e4c782e219e007/download) |
| 390 엄격·저장 조각 보존 | [PNG](https://chatgpt.com/api/library/files/libfile_368ee400a2708191bc9797b7868376a6/download) |
| 390 잠금·오암호 | [PNG](https://chatgpt.com/api/library/files/libfile_4093187943e481919426dc5d5309b63f/download) |
| 820 정리 결과 복원 | [PNG](https://chatgpt.com/api/library/files/libfile_f732a59e67608191b81f97795cd1c97e/download) |

네이티브 탭 bringToFront에도 원래 document.visibilityState가 visible로 남는 잠긴 macOS 환경이었다. 숨김/복귀는 test-only visibility 이벤트와 clock으로 구분해 검증했다. 실제 Android/iOS/앱 전환·OS suspend·실제 하드웨어 마이크는 미검증이다. Chrome 합성 Web Audio는 실제 sample clock·track·PCM/암호화 writer를 사용하며 실제 음성/유료 AI 품질을 증명하지 않는다. 테스트 UI는 Vite development 서버를 사용했다. 최종 built preview의 새 보관함 화면도 390×844/1440×900에서 실제 렌더·초점·가로 overflow 없음·pageerror0을 확인하고 위 2장을 추가했다. 보관함은 만들지 않았다. 배포하지 않았다.

## 부모 QA 및 후속 UX 목록

1. 로컬 preview에서 390/768/820/1180/1440 준비→전사→정리·설정·잠금 화면의 문구·대비·여백과 키보드 초점 확인. 초 단위 카운터와 한 줄 단계가 서로 가리지 않는지 확인.
2. 표준 녹음→잠금→오암호→복귀→저장, strict선택→다음 hidden/수동잠금→완료분 보존을 실제 모바일/OS 환경에서 확인. 기기 이전은 .md 결과 내보내기와 구분.
3. 모델/전송 안내·용량·비용·사용량·개인정보 설명 반복을 앱 전체에서 검수. 필요한 전송 경계는 유지하고 상세는 펼침으로 모을 것. 본문 폰트를 줄이는 방식으로 해결하지 말 것.
4. 모든 시작/재시도/취소의 빠른 클릭·터치/Enter 조합, 설정 왕복 후 중복 요청, disabled 이유와 짧은 상태, 오류→재시도 초점/결과 보존 확인. 현재 영역 외 확장 구현은 별도 구체 범위로 진행.
5. 운영에서 남은 interrupted sourceDraft의 안전한 사용자 복구 기능은 별도다. 현재 저수준 writer는 같은 ID/config의 인증된 PCM을 WAV로 원자 승격할 수 있고 source-writer 기존 합성 검사가 있다. 제안: 사용자가 누르는 ‘저장된 녹음 복구’, 완료 블록만 인증/프레임 검증→길이 산출→확정. 실패/빈 조각은 보존하고 원인 안내. 자동 이어녹음·마지막 미저장 구간 복원·원본 삭제를 약속하지 않는다. 실제 5.5MB의 복구 가능/중단 원인은 사용자 DB 검사 없이 확정하지 않았다.

Reference 6개 SHA-256은 작업 전 값과 모두 일치한다. 원본 디자인 파일을 수정하지 않았다. 정확한 변경 파일 목록은 인계 시 `/tmp/mom-screen-lock-responsive/deliverables/changed-files.txt`로 남긴다.

로컬 QA 당시 판단: 앞선 23개 개발 서버 시나리오와 이번 6개 built 시나리오의 통과 근거를 확보했다(최초 실패는 원인과 선별 재검사로 따로 기록). 커밋·푸시·배포하지 않았고 부모 실제 QA는 남아 있다. 운영 준비/실제 모바일·유료 추론·부모 QA 통과를 선언하지 않는다.

<details>
<summary>기능 커밋1e23441의 변경 파일62개</summary>

```text
README.md
docs/06-privacy-and-local-storage.md
docs/09-decisions-and-roadmap.md
docs/README.md
docs/security-and-encryption.md
docs/superpowers/evidence/2026-10-18-screen-lock-responsive/README.md
docs/superpowers/evidence/2026-10-18-screen-lock-responsive/release/README.md
docs/superpowers/plans/2026-10-18-responsive-screen-lock.md
src/react-app/App.tsx
src/react-app/controller.tsx
src/react-app/domain/pipeline.ts
src/react-app/providers/discovery.ts
src/react-app/providers/openai.ts
src/react-app/providers/openrouter-stt.ts
src/react-app/providers/openrouter.ts
src/react-app/providers/registered-runtime.ts
src/react-app/providers/registration-test.ts
src/react-app/screen-idle.ts
src/react-app/ui/RecordingControls.tsx
src/react-app/ui/ScreenLock.tsx
src/react-app/ui/UsageStatement.tsx
src/react-app/ui/compact-work.css
src/react-app/ui/components/MobileNavigation.tsx
src/react-app/ui/mobile-navigation.css
src/react-app/ui/screen-lock.css
src/react-app/ui/screens/Import.tsx
src/react-app/ui/screens/Minutes.tsx
src/react-app/ui/screens/Review.tsx
src/react-app/ui/screens/STT.tsx
src/react-app/ui/screens/Settings.tsx
src/react-app/ui/styles.css
src/react-app/ui/useSessionDraft.ts
src/react-app/vault/crypto.ts
src/react-app/vault/screen-state.ts
src/react-app/vault/session.ts
src/react-app/vault/store.ts
tests/compact-work-priority.spec.tsx
tests/e2e/lock.spec.ts
tests/e2e/minutes-language.spec.ts
tests/e2e/responsive-grid.spec.ts
tests/e2e/screen-lock.spec.ts
tests/e2e/storage-audit.spec.ts
tests/e2e/ux-pass1-built.spec.ts
tests/lock-information-density.spec.tsx
tests/lock.spec.ts
tests/model-discovery.spec.ts
tests/openrouter-stt-provider.spec.ts
tests/pipeline.spec.ts
tests/preparation-reset-controller.spec.tsx
tests/providers.spec.ts
tests/recording-controller.spec.tsx
tests/recording-ui.spec.tsx
tests/registered-runtime.spec.ts
tests/registration-test.spec.ts
tests/screen-idle.spec.ts
tests/screen-lock-controller.spec.tsx
tests/screen-lock-races.spec.tsx
tests/screen-lock-ui.spec.tsx
tests/screen-state.spec.ts
tests/session-drafts.spec.tsx
tests/ui.spec.tsx
tests/vault-reset-ui.spec.tsx
```

</details>
