# 모바일 음성 준비 지연·진행 진단 — 로컬 QA 인계

**후속 상태:** 부모가 최종 390px 캡처 3장의 실제 픽셀과 기능 증거를 검토해 QA를 통과시키고 커밋·main 반영·푸시·Worker 배포를 승인했다. 아래 미커밋/배포 보류 표현은 당시 로컬 QA 기록으로 보존한다. 현재 반영 상태는 [릴리스 기록](release/README.md)을 따른다. baseline 4개 실패는 [TODO M09](../../../TODO.md)의 미해결 부채다.

2026-10-18 기준. 기준 main/로컬 origin/main은 `c0838c29c5954a197012d90658725d03c4ad0bb7`이다. 작업은 `.worktrees/mom-preparation-progress`, 브랜치 `fix/mobile-preparation-progress-20261018`에 격리했다. 사용자 승인 범위는 35분 파일의 전사 준비 지연 조사, 실제 진행·저장 범위·취소/재시도 안내와 작은 수동 진단 기능이다. **부모 QA 전이며 커밋·푸시·병합·배포하지 않았다.** 실제 사용자 보관함·녹음·키·유료 AI는 사용하지 않았다.

로컬 수정 빌드: `http://127.0.0.1:4192/`. 종료됐다면 해당 worktree에서 `npx vite preview --host 127.0.0.1 --port 4192`로 연다. 기존 설치된 node_modules만 링크했고 의존성을 설치하지 않았다. 별도 백업 구현과 암호화 형식·KDF·vault 저장소·session 파일은 변경하지 않았다.

## 확인한 원인과 한계

사용자 증상은 Galaxy Android Chrome에서 **업로드가 끝난 뒤 전사 준비를 누르고** 35분 파일을 1시간 이상 기다린 경우다. 사용자는 다른 앱과 화면 꺼짐도 기억한다. 실시간 녹음이나 제공사 STT 대기와 구분했다. 실제 파일 형식과 해당 OS의 중단 원인은 확인하지 않았다.

코드상 AAC 패킷마다 원본을 다시 읽던 경로를 확인했다. 암호화 원본은 각 작은 요청마다 저장 프로젝트/manifest 검증과 겹치는 암호화 블록 복호화를 반복한다. 패킷은 수백 바이트여도 같은 최대 1MiB 블록을 반복 처리하므로 읽기 증폭이 발생했다. 직접 File 경로도 패킷별 Blob read가 반복됐다. [M4A 디코더](../../../../src/react-app/media/m4a.ts)는 이제 generator당 최대 1MiB의 **인코딩 바이트 창 하나**를 재사용하고 교체·취소·반환 시 지운다. 전체 파일이나 전체 PCM을 메모리에 보관하지 않는다.

원본 검사에서 MP3/M4A를 전체 디코딩하지만 그동안 진행 이벤트가 없었고, 생성 청크의 독립 디코딩 검증도 UI에서 구분되지 않았다. [미디어 진행](../../../../src/react-app/media/mp3.ts), [Worker 검증](../../../../src/react-app/media/worker.ts), [controller](../../../../src/react-app/controller.tsx)를 연결해 실제 읽기/검사·디코딩·분할/압축·검증·암호화 저장을 표시한다. 실제 처리 이벤트는 빠른 디코딩에서도 최소 100ms 간격으로 제한하고 종료/청크 경계는 전달한다. 표시용 1초 시계는 진행 이벤트나 사용자 활동을 만들지 않는다.

Chrome의 [Page Lifecycle 문서](https://developer.chrome.com/docs/web-platform/page-lifecycle-api)는 hidden과 frozen을 구분하며 frozen 상태에서 작업 실행이 중단될 수 있음을 설명한다. 이는 Android에서 앱 전환·화면 꺼짐이 영향을 줄 수 있다는 근거이며, 해당 사용자의 정지 원인을 입증한 관찰은 아니다. Standard 화면 잠금은 기존대로 작업을 계속하며 Strict/전체 잠금은 중단한다. 이 변경으로 OS 백그라운드 실행을 보장하지 않는다.

## 사용자에게 보이는 동작

- 로컬 처리 위치와 외부 AI 요청 없음, 단계별 실제 음성 시간, 분할/압축한 원본 시간, 경과시간·마지막 실제 진행을 표시한다. 원본 검사·청크 검증 시간을 분할/압축 시간에 더하지 않는다.
- **실제 암호화 저장 청크 수·용량·연속 저장 원본 범위**를 메모리상의 계산 진행과 나눈다. 30초 동안 새 이벤트가 없으면 느림/일시 중단 가능성을 안내하며 정지를 단정하지 않는다. 화면 복귀는 복귀 시각만 기록하고 새 Worker 진행으로 간주하지 않는다.
- 취소는 진행 중 작업을 drain/fence하고 실제 저장 프로젝트를 다시 읽은 뒤 중지 요약을 보인다. 원본과 완료 청크를 보존한다. 취소 중 새 준비는 busy로 막고 늦은 결과를 저장하지 않는다. 작업/원본/옵션 식별을 확인한다. 기존 저장소의 원자적 checkpoint를 재사용한다.
- 재시도는 디코딩·압축 계산을 처음부터 다시 할 수 있다. 동일 원본·범위의 완료 청크는 **저장만 건너뛴다**. 중간 PCM에서 이어 계산하는 기능은 구현하지 않았다. 새로고침 뒤에도 준비 미완료와 실제 저장 청크 수, 재계산 안내가 남는다. STT 성공 청크 건너뛰기·불명확 결과의 명시적 재요청/비용 안내는 변경하지 않았다.
- 취소 옆의 44×44px 저강조 아이콘을 누르면 짧은 기술 정보 미리보기가 열리고 별도의 복사를 눌러야 복사한다. [허용 목록 formatter](../../../../src/react-app/ui/preparation-diagnostic.ts)는 앱 버전·단계·진행/저장량·가시성 이력 요약·안전 오류 코드만 9행으로 만든다. 제목·파일명·내용·식별자·설정 fingerprint·키·암호·오류 원문·URL은 넣지 않는다. 자동 전송하지 않으며 locked/verifying 중 UI와 실행을 막는다.

## 같은 35분 합성 파일 측정

파일은 저장소의 `node tests/fixtures/media/generate-m4a.mjs 2100 /tmp/mom-preparation-diagnostic/SYNTHETIC_35_MIN_AAC_AF.m4a 44100 1`로 만든 AAC-LC M4A, 44.1kHz 모노, 64kbps 합성음이다. 네이티브 Worker/WebCodecs와 실제 암호화 저장을 사용했다. 별도 **headful macOS Chrome** 프로필, 390×844 터치/모바일 viewport이며 Android 하드웨어는 아니다. 아래 시간 비교에는 CPU throttle을 쓰지 않았다. 모든 외부 요청을 차단했고 실제 시도 0회·pageerror 0회였다.

| 경로 | clean c0838c2 | 수정 빌드 |
| --- | --- | --- |
| 업로드 검사 Worker | 13,653.5ms | 2,747.1ms |
| 직접 업로드 파일의 전사 준비 | 32,445ms, 완료 8청크 | 10,072ms, 완료 8청크 |
| 재접속한 암호화 원본 | 60초에도 검사 중. read 약 5.96MB에 복호화 입력 약 38.64GB, 401,343회. 진행 이벤트 0 | 10,089ms에 완료 8청크. read 39회/28,456,782 bytes, 복호화 입력 약 66.90MB/524회(준비 전 값 제외) |
| 직접 경로의 실제 진행 이벤트 | 2,100개 | 154개, 검사/검증 포함 |

단일 합성 파일·한 번씩의 비교다. 사용자의 실제 파일 속도나 1시간 증상 해결을 보장하지 않는다. 재접속 baseline은 70초 계측 경계 이후 화면 잠금 해제 버튼을 테스트가 잘못 찾아 취소 확인을 마치지 못했다. 그 뒤 쌓인 최종 83.7GB 수치를 70초 값으로 사용하지 않았다. 수정 빌드의 잠금/취소 검사는 아래 별도 QA로 확인했다.

원시 계측과 harness는 `/tmp/mom-preparation-diagnostic/`의 `run.mjs`, `baseline-valid.json`, `baseline-retained.json`, `after-direct.json`, `after-retained.json`에 있다. baseline-valid의 `importElapsedMs`는 초기 harness가 준비 시간까지 포함해 기록했으므로 사용하지 않았다. 해당 콘솔의 실제 import 완료는 14,187ms이고 위 표는 Worker operation 시간을 비교한다. 수정 harness는 별도 import 시간을 3,068/3,064ms로 기록했다. 최초 ffmpeg 생성 fixture는 지원하지 않는 메타데이터로 즉시 거절된 설정 실패이며 지연 재현으로 세지 않았다. 수정 빌드 첫 시도도 초기 locked→new 전환 전에 암호를 입력한 harness 대기 실패였다. 새 보관함 heading을 기다린 뒤 측정했다.

정확한 비교 명령:

```sh
MOM_DIAG_PHASE=baseline-valid node /tmp/mom-preparation-diagnostic/run.mjs
MOM_DIAG_PHASE=baseline-retained MOM_DIAG_RETAINED=1 node /tmp/mom-preparation-diagnostic/run.mjs
MOM_DIAG_URL=http://127.0.0.1:4192 MOM_DIAG_PHASE=after-direct node /tmp/mom-preparation-diagnostic/run.mjs
MOM_DIAG_URL=http://127.0.0.1:4192 MOM_DIAG_PHASE=after-retained MOM_DIAG_RETAINED=1 node /tmp/mom-preparation-diagnostic/run.mjs
```

baseline은 동일 main의 로컬 preview 4191, 수정 빌드는 worktree의 preview 4192에서 실행했다.

## 직접 영향 검사와 실제 렌더

전체 저장소/전체 suite는 실행하지 않았다. 변경 코드와 직접 데이터 손실·잠금 경로만 검사했다. 이미 통과한 동일 코드/환경 검사는 근거를 재사용하고 변경·실패한 검사만 갱신했다.

| 검사 명령 | 결과와 범위 |
| --- | --- |
| `npm run test:unit -- tests/m4a.spec.ts tests/m4a-compat.spec.ts` | **60 PASS**. 캐시 재사용·경계 동일성·늦은 취소·짧은 read·버퍼 폐기. 새 핵심 2개 실제 RED→GREEN |
| `npm run test:unit -- tests/audio.spec.ts tests/source-worker.spec.ts` | **73 PASS**. 검사/출력 검증 진행, 이벤트 수 제한, 잘못된 단계·음수/무한값 거절. 신규 검사별 실제 RED→GREEN |
| `npm run test:unit -- tests/audio.spec.ts tests/source-worker.spec.ts tests/source-media.spec.ts` | 앞선 **83 PASS** 중 변경 없는 source-media **15개** 근거 재사용. 위 73개 최종 결과와 합쳐 단일 run이라고 표현하지 않음 |
| `npm run test:unit -- tests/controller-source-reader.spec.tsx -t '^(?!.*rejects unsafe/nonpositive source byte metadata)'` | **15 PASS**, 기존 baseline 실패 2개 제외. 실제 phase/복귀 구분·취소 drain/중복 방지·저장 실패·lazy read/lock/cancel |
| `npm run test:unit -- tests/screen-lock-controller.spec.tsx tests/screen-lock-races.spec.tsx` | controller **5 PASS**, 기존 Standard/Strict 및 재인증 경계. races는 아래 WASM 수집 오류여서 **명령 전체 exit 1**. 단독 controller 실행으로 표현하지 않음 |
| `npm run test:unit -- tests/controller.spec.tsx -t 'keeps failed encrypted preparation\|clears preparation immediately'` | **3 PASS / 116 제외**. 저장 실패 및 취소/전체 잠금 후 늦은 이벤트만 선택 |
| `npx vitest run tests/preparation-diagnostic.spec.ts tests/preparation-status-ui.spec.tsx --reporter=dot` | 최초 **26 PASS**. 이후 ByRole exact 타입 수정의 해당 UI 1개 PASS, formatter 짧은 9행/고정 오류 코드 추가 후 formatter **10 PASS**. 단일 27개 run으로 표현하지 않음. 최초 UI 13개와 진단 13개는 실제 RED→GREEN |
| `npx vitest run tests/preparation-reset-ui.spec.tsx --reporter=dot` | 직접 연결 기존 UI **11 PASS** |
| `npx vitest run tests/preparation-status-ui.spec.tsx --reporter=dot -t 'reveals the diagnostics panel in its nearest scroll area'` | 진단 패널 노출 회귀 **1개 RED→GREEN / 17 제외**. 진행 rerender·locked/verifying는 스크롤하지 않음 |
| `npm run build` | **PASS**, `tsc -b` 포함. 최초 새 테스트의 exact 옵션 타입 오류는 수정 후 통과. 기존 정적/동적 import 및 큰 bundle 경고는 남음 |
| `npm run test:secret` | **PASS**, owned source/static/client 산출물. 실제 비밀값을 읽지 않음 |
| 변경 TS/TSX·테스트·vite만 `npx eslint` | 오류 0, App.tsx의 기존 Fast Refresh 경고 1. 정확한 파일 인자는 `verification.json`의 lint.commands에 기록. 패널 변경 후 해당 2파일만 재검사 |
| `git diff --check` | PASS |

수정 built 검증 명령은 `node /tmp/mom-preparation-diagnostic/qa.mjs`다. 390×844/1440×1000의 별도 headful Chrome에서 실제 준비/취소/복원/재계산을 렌더했다. 버튼을 누를 시간을 확보하기 위해 이 **동작 검증에만 4배 CPU throttle**을 썼으며 모바일 성능 수치로 사용하지 않았다.

- 390px: 진단 아이콘 44×44px, 미리보기 342px 폭/가로 overflow 없음, 9행 허용 목록, 명시적 복사와 미리보기 동일, Escape 초점 복귀. 클립보드는 OS에 쓰지 않는 별도 API test double로 전달 문자열만 확인했다.
- Standard 수동 잠금: 준비·진단·파일명 DOM 제거, 실제 Worker progress 증가 확인. 잠금 해제 후 같은 작업을 취소했다.
- 취소: 완료 저장 청크 **2개**, 계산 진행과 다른 연속 저장 범위를 표시. 새로고침/재인증 뒤 같은 2개·재계산 안내 복원.
- 1440px: 재시도 시 이미 저장된 2개를 보존하며 최종 **8개/35:00** 완료, 중복 저장 없음. 첫 harness는 복귀 후 현재 메모 화면을 홈으로 가정해 열기 버튼을 기다렸다. 제품은 현재 메모를 정상 복원했으며 테스트의 화면 가정을 수정했다. `qa-first.json`은 실패를 보존한다.
- desktop의 진단 패널이 viewport 아래에 열리는 문제는 픽셀 검사에서 발견했다. 열 때만 `scrollIntoView({block:'nearest'})`로 보이게 수정했고 프로그램 스크롤은 사용자 활동에 포함하지 않는다. 이 변경으로 main JS 산출물만 달라져 빌드/공개 산출물 검사와 패널 표시의 선별 built QA를 갱신했다. Worker와 CSS 자산이 동일하므로 위 오디오 측정·잠금/저장 QA 근거는 재사용한다.

캡처는 같은 `/tmp` 폴더의 `qa-390-diagnostic.png`, `qa-390-locked.png`, `qa-390-stopped.png`, `qa-1440-retry.png`다. 자동 전송하거나 Library에 업로드하지 않았다.

최종 패널 선별 명령은 `node /tmp/mom-preparation-diagnostic/qa-panel.mjs`와 실패한 desktop만의 `MOM_PANEL_WIDTH=1440 node /tmp/mom-preparation-diagnostic/qa-panel.mjs`다. 첫 묶음은 390px PASS, desktop의 엄격한 bounds predicate 실패를 기록했다. 스크롤 반올림을 위해 1 CSS px 허용해 desktop만 다시 확인했고, 실제 최종 bounds는 **x1009/y711.125/360×288.59375**로 1440×1000 안에 들어왔다. 390px는 **x13/y555.109375/342×288.59375**로 390×844 안에 들어왔다. 두 화면 모두 새 main JS `index-BZevfVdl.js`를 사용했고 전체 패널·복사 버튼이 보이는 캡처와 Escape 초점 복귀를 확인했다. `qa-panel.json`의 최초 실패와 `qa-panel-1440.json`의 선별 통과를 구분한다. 최종 캡처는 `qa-panel-390-final.png`, `qa-panel-1440-final.png`다.

## 남은 제한과 부모 QA

1. 실제 Galaxy Chrome의 같은 파일로 포그라운드/화면 켬 준비와 다른 앱·화면 꺼짐 후 복귀를 확인한다. 원본을 지우거나 기존 처리 중 화면을 무단 새로고침하지 않는다. 진단은 사용자가 직접 미리보기·복사한 허용 정보만 받는다.
2. 390/1440에서 작은 진단 창의 실제 보임, 상태 문구와 저장 범위, Standard 복귀·Strict 중단, 취소/재시도를 부모가 검토한다. 현재 built Standard 준비는 확인했고 실제 Android Strict/OS suspend/discard/브라우저 강제 종료는 확인하지 않았다.
3. `controller-source-reader`의 unsafe source bytes 0/9007199254740992 두 검사는 clean c0838c2에서도 unlock 단계에서 동일 실패한다. `controller.spec`의 기존 STT 연계 `reports real source time…`, `keeps legacy options…`도 baseline에서 동일 invalid-input/timeout이다. 해당 STT를 이번 범위에서 바꾸지 않았고 통과라고 표시하지 않는다.
4. 최초 `screen-lock-races` jsdom 수집은 symlink 의존성의 WASM 경로가 worktree root 밖이라 차단됐다. 후속 부모 QA 요청으로 비교·해결한 테스트 환경 및 4개 통과 근거는 아래에 기록한다. 제품 설정은 변경하지 않았다.
5. 실제 제공사 인증 추론·음성/회의록 품질·모바일 OS 보장·메모리 완전 소거·운영 배포는 검증하지 않았다.

기존 실패 재현은 clean primary `/Users/korgeek/Workspace/mom`의 c0838c2에서 아래 선별 명령으로 실행했다. 별도 로그 파일은 없고 도구 출력 chunk `4f1f25`/`499663`에 남아 있다. controller/races 묶음 출력은 `bd4a4b`다.

```sh
npm run test:unit -- tests/controller-source-reader.spec.tsx -t 'rejects unsafe/nonpositive source byte metadata'
npm run test:unit -- tests/controller.spec.tsx -t 'reports real source time before the first encrypted receipt|keeps legacy options and completed data'
```

정확한 변경 파일·산출물 SHA-256·main 보존·디자인 참고 6개 hash 비교와 문서 링크 결과는 이 폴더의 `verification.json`에 기록한다. 부모 승인 전까지 미커밋 상태를 유지한다.

## 부모 QA 요청 후 추가 증거

실패를 기존이라고 부른 근거를 재현 로그로 남기기 위해 14:03:53 UTC에 **clean main c0838c2와 수정 worktree에 같은 선별 명령**을 실행했다. 두 명령 모두 exit 1, 같은 4개 실패와 같은 1개 미처리 거절이다. 전체 suite를 실행하지 않았다.

```sh
npm run test:unit -- tests/controller-source-reader.spec.tsx tests/controller.spec.tsx -t 'rejects unsafe/nonpositive source byte metadata|reports real source time before the first encrypted receipt|keeps legacy options and completed data'
```

| 정확한 실패 이름 | 양쪽 오류·도달 위치 | 이번 변경과의 관계 |
| --- | --- | --- |
| `controller retained range-reader preparation > rejects unsafe/nonpositive source byte metadata 0 before opening or dispatching` | `ProviderError: permission`, `activate`→unlock. 원래 검사하려던 prepare 단계에 도달 못함 | baseline에도 동일 실패. prepare byte 검사 통과로 세지 않음 |
| `controller retained range-reader preparation > rejects unsafe/nonpositive source byte metadata 9007199254740992 before opening or dispatching` | 위와 동일 | 위와 동일 |
| `preparation defaults and durable progress > reports real source time before the first encrypted receipt and saved bytes only after it` | STT 시작의 `invalid-input` 미처리 거절 후 5000ms timeout | baseline과 수정의 STT consent/model 불일치 거절 조건은 동일함. 이 검사 전체 통과를 주장하지 않음. 준비·저장 전후는 별도 5개 및 built QA로 확인 |
| `preparation defaults and durable progress > keeps legacy options and completed data through encrypted reload while defaults affect only new meetings` | STT 시작의 `ProviderError: invalid-input` | 같은 STT 거절 조건. 이번 수정은 STT 코드를 변경하지 않음. 기존 실패라는 분류는 해결/릴리스 승인과 다름 |

로그는 `/tmp/mom-preparation-diagnostic/baseline-known-failures.log`, `fix-known-failures.log`다. baseline은 4 failed/130 skipped, 수정은 신규 검사 2개가 늘어 4 failed/132 skipped다. stack의 `activate`는 baseline controller:891 / 수정:934, STT 거절은 baseline:1696 / 수정:1760이며 같은 조건이다.

### WASM 수집 차단의 실제 분류

`npm run test:unit -- tests/screen-lock-races.spec.tsx`를 양쪽에서 실행했다. clean main은 **4 PASS**, worktree는 `Denied ID /Users/korgeek/Workspace/mom/node_modules/wasm-media-encoders/wasm/mp3.wasm?url`로 0개 수집/exit 1이었다. **기존 제품 실패가 아니라 worktree 테스트 경로 문제**로 분류한다. `baseline-races.log`, `fix-races.log`에 기록했다.

`/tmp/mom-preparation-diagnostic/vitest-worktree.config.mts`에서 원래 프로젝트 설정을 가져오고 테스트 프로세스의 `server.fs.allow`에 worktree와 실제 설치 의존성 디렉터리 두 곳만 넣었다. 제품 vite.config.ts·브라우저/OS 보안 설정을 변경하지 않았다.

```sh
npx vitest run --config /tmp/mom-preparation-diagnostic/vitest-worktree.config.mts tests/screen-lock-races.spec.tsx tests/preparation-reset-controller.spec.tsx
```

최초 **7 PASS/1 FAIL**, 실패는 `stages the latest unsaved UI draft on page departure before vault locking`의 `selectedProjectId` null이었다. 동일 실패만 선별하면 baseline/수정 모두 1 PASS여서 상시 제품 실패로 확정하지 않았다. 소스상 `session=unlocked`가 먼저 나오고 `screenAccess=verifying`가 유지되는 동안 `interactive()`는 새 메모 명령을 막는다. 기존 hook fixture는 session만 기다린 뒤 콜백을 보냈으므로, 실제 화면의 조작 가능 경계인 **screenAccess=open도 기다리도록 테스트 한 줄만 보정**했다. 당시 verifying 값을 직접 기록하지 않았으므로 정확한 실패 시점 원인은 이 소스에 근거한 설명이다. 제품 guard는 완화하지 않았다.

```sh
npx vitest run --config /tmp/mom-preparation-diagnostic/vitest-worktree.config.mts tests/screen-lock-races.spec.tsx
```

보정 후 **4 PASS**. `fix-races-ready-green.log`다. 최초 `fix-races-reset-test-config.log`와 양쪽 단일 `*-race-departure-recheck.log`도 보존한다. preparation-reset-controller 4개는 앞선 묶음에서 PASS했다. 테스트 두 파일의 타입·lint를 다시 확인하고 제품 번들은 동일하므로 오디오 속도/산출물 검사를 반복하지 않았다.

### 재시도·새 원본·새 설정·완료 판정

재시도에서 **디코딩·압축·출력 검증 계산은 처음부터 다시 수행**한다. 생성한 각 출력이 sink에 왔을 때 현재 프로젝트의 `retainedChunks` 중 sourceId와 sourceStartMs/sourceEndMs가 일치하면 새 출력을 저장하지 않고 기존 chunk/audioRecord ID와 바이트를 보존한다. 계산을 생략하거나 PCM 중간부터 이어 처리하지 않는다. 새로 계산한 출력의 메모리 복사는 버리고 실제 보관 중인 완료 청크를 재사용한다. UI의 `다시 준비하면 디코딩·압축 계산은 처음부터 다시 진행될 수 있어요` 및 `저장된 청크는 유지돼요`와 일치한다.

런타임 작업은 active context/job, 현재 sourceId와 audioOptions JSON이 모두 같아야 진행/저장을 받는다. 완료 청크가 존재하면 chunkMinutes·overlapSeconds·bitrateKbps·sampleRateHz를 직접 변경할 수 없다(`audio-options-locked`). 변경은 검토한 reset token으로 **원자적 초기화 후** 새 설정·새 청크를 생성한다. expectedLanguages/어휘 힌트는 오디오 인코딩 변경이 아니므로 기존 청크를 유지한다. 새 원본 교체는 명시적으로 기존 원본/청크 참조를 비운 뒤 새 sourceId로 저장하는 경로이며, 전사/정리 결과가 있으면 단순 교체를 거부한다. 실행 중 명령은 busy/잠금 guard로 차단된다.

영속 checkpoint에 별도의 encoding fingerprint를 추가하지 않았다. 재사용 검증은 **현재 원본 ID·계획 범위·실제 retained 청크와 bytes/record ID**, 인코딩 변경 금지 및 원자 reset 경로에 의존한다. 런타임 settingsFingerprint를 영속 재개 토큰이라고 주장하지 않는다. 허용 UI 밖에서 암호화 저장 객체를 직접 임의 수정하는 경우까지 검증했다고 주장하지 않는다.

`preparedAudioReady`는 현재 원본의 모든 계획 범위에 동일 sourceId·정확한 시작/끝·양수 encodedBytes·audioRecordId가 있는 retained chunk가 존재해야 true다. Worker iterator가 끝나도 이 조건이 false면 controller는 failed로 남기고 complete를 내지 않는다. STT 화면 이동 버튼과 최초 STT 실행도 이 조건을 사용한다. 부분 2/8 상태는 `준비 미완료`/전사 비활성으로 남았고, 재계산·검증·저장이 끝난 뒤에만 8/8 완료가 노출됐다.

추가 선별 증거:

```sh
npm run test:unit -- tests/controller-source-reader.spec.tsx -t 'skips a matching durable chunk|retains the completed snapshot|keeps completion failed|rejects a reader size|publishes a durable stopped summary'
npm run test:unit -- tests/preparation-reset-vault.spec.ts -t 'atomically resets|rejects wrong, changed|rejects stale storage|requires retained|rolls back|refuses missing source|authenticates retained'
npx vitest run tests/preparation-status-ui.spec.tsx --reporter=dot -t 'blocks transcription for partial'
```

각각 **5 PASS/12 제외**, **7 PASS/6 제외**, **1 PASS/18 제외**. 첫 묶음은 기존 청크 ID/원문/편집/배치/정리 보존, 저장 실패 시 이전 snapshot 보존, 필수 청크 누락 시 완료 거부, reader 크기 불일치와 취소 후 실제 저장 요약을 확인한다. 둘째는 잘못된 옵션·토큰·오래된 revision·원본 부재/인증 실패·transaction rollback을 확인한다. UI 추가 검사는 실제 onNavigate가 있어도 부분/다른 sourceId/미보관/0바이트 청크로 전사를 열지 못하고 모든 계획 범위가 저장됐을 때만 활성화되는 것을 확인한다. 기존 정상 동작을 검증한 추가 검사이며 새 제품 수정을 위한 RED→GREEN으로 표시하지 않는다.

### 승인된 합성 캡처 Library 전달

부모 요청으로 최종 빌드에서 상태/취소/복원/재시도를 다시 실행해 캡처를 생성했다. `qa-parent-captures.log`와 `qa.json`은 실제 2개 보존→reload 2개→재시도 8개/35분 완료, pageerror/외부 요청 0회를 기록한다. 클립보드는 전송 문자열만 기록하는 별도 API test double이며 OS 클립보드에 쓰지 않았다.

| 캡처 | Library |
| --- | --- |
| 390px 최종 진단 창 | [PNG](https://chatgpt.com/api/library/files/libfile_d8d9a92fbb208191870afa03d17f899c/download) |
| 1440px 최종 진단 창 | [PNG](https://chatgpt.com/api/library/files/libfile_b9c914b9afb481918bd98ca17e067ed4/download) |
| 390px 실제 진행·검증 단계 | [PNG](https://chatgpt.com/api/library/files/libfile_11f8a5d275948191b94cde0c468f05e5/download) |
| 390px 취소·저장 완료분 보존 | [PNG](https://chatgpt.com/api/library/files/libfile_e4a360744708819194c71d43ede760de/download) |
| 390px 화면 잠금 | [PNG](https://chatgpt.com/api/library/files/libfile_afecbd2442988191b362e1fd278ce1bf/download) |
| 1440px 재시도 | [PNG](https://chatgpt.com/api/library/files/libfile_b3e7114d46808191a21e6d98f5530b91/download) |
| 1440px 최종 8/8 완료 | [PNG](https://chatgpt.com/api/library/files/libfile_25236298bca081918805f04025204a1e/download) |

두 진단 캡처를 먼저 저장해 ID를 전달한 뒤 나머지 상태 캡처를 순서대로 저장했다. 합성 QA 캡처 첨부 승인 범위만 사용했고 사용자 자료는 포함하지 않았다. 진단 미리보기는 클릭 시점의 고정 사본이므로 이후 완료 화면에서도 이전 기술 단계가 남을 수 있다. 새 사본은 아이콘을 닫았다 다시 열어 만든다. 부모 UI 검수에서 이 동작/문구도 확인한다.

## 부모 픽셀 QA 후 — 준비 우선 배치·사본 시각 보정

부모가 기능 증거와 이전 5개 상태 캡처를 검토한 뒤 요청한 작은 UX 변경만 반영했다. 1100px 이하에서 준비 중·중단 후 미완료·저장 청크가 있는 복귀 상태의 메모 정보와 완료된 원본 선택/미리듣기를 요약 접기로 보인다. 녹음의 기존 메모 정보 요약을 확장하고 원본 선택의 펼침은 원본별 세션 초안으로 보존한다. 명시적 펼침과 초점이 있는 본문은 유지하며 hidden/inert로 닫은 본문을 조작·접근성 트리에서 제외한다. 미리듣기는 닫을 때 정지한다. 완료 후에도 자동으로 다시 펼쳐 화면을 밀어내지 않으며, 1100px 초과의 독립 행/3열은 유지한다. 자동 진행 때 앱의 스크롤 함수를 호출하지 않는다. 진단을 명시적으로 여는 기존 스크롤만 유지한다.

진단에는 **열었을 때의 진단 정보 · 캡처 시각**을 짧게 보인다. 캡처 시각과 미리보기 본문을 한 snapshot으로 보관하고, 이후 실제 단계나 시계가 바뀌어도 보이는 사본을 몰래 갱신하지 않는다. 복사도 그 미리보기 그대로다. 현재 stage와 별도의 경과시간 시계 원칙은 그대로다. 재시도 문구는 현재 동작에 맞춰 `디코딩·압축을 처음부터 다시 계산해요. 저장된 청크는 유지돼요.`로 통일했다.

이번 직접 변경은 `Import.tsx`, `PreparationStatus.tsx`, `compact-work.css`, 두 UI 테스트와 기록 문서다. controller/media/provider/vault 코드는 이 후속에서 변경하지 않았다. baseline 4개 실패는 해결했다고 주장하지 않으며 [TODO M09](../../../TODO.md)에 별도 미해결 검사 부채로 추가했다.

| 정확한 후속 검사 명령 | 결과 |
| --- | --- |
| `npx vitest run --config /tmp/mom-preparation-diagnostic/vitest-worktree.config.mts tests/compact-work-priority.spec.tsx tests/preparation-status-ui.spec.tsx -t 'prioritizes preparation\|retains explicitly opened preparation\|keeps focused source controls\|shows a compact diagnostics trigger'` | **6 RED→6 GREEN**. 390/820/1100 요약, 중단/재시도/remount 명시적 펼침, 넓은 화면/초점 보호, 고정 사본 시각 |
| `npx vitest run --config /tmp/mom-preparation-diagnostic/vitest-worktree.config.mts tests/compact-work-priority.spec.tsx -t 'preparation\|recording\|metadata\|focused source'` | **11 PASS / 7 제외**, 직접 연결 녹음/준비만 |
| `npx vitest run --config /tmp/mom-preparation-diagnostic/vitest-worktree.config.mts tests/preparation-status-ui.spec.tsx tests/preparation-reset-ui.spec.tsx` | **30 PASS**, 상태·복사/잠금·초기화 UI |
| `npx vitest run --config /tmp/mom-preparation-diagnostic/vitest-worktree.config.mts tests/ui.spec.tsx -t 'keeps native preview usable'` | **1 PASS / 99 제외**, 미리듣기 source/cleanup |
| `npm run build` | **PASS**, 타입 포함. 기존 bundle/import 경고 유지 |
| `npm run test:secret` | **PASS** |
| `npx eslint src/react-app/ui/screens/Import.tsx src/react-app/ui/PreparationStatus.tsx tests/compact-work-priority.spec.tsx tests/preparation-status-ui.spec.tsx` | **PASS**, 오류·경고 0 |
| `node /tmp/mom-preparation-diagnostic/qa-ux-review.mjs` | 변경 built의 390px 진행·중단·진단과 820px 펼침 보존 **PASS**. 새 성능 비교·전체 검사 없음 |

로그는 `/tmp/mom-preparation-diagnostic/ux-review-{red,green,compact-regression,status-reset,preview,build,browser}.log`, browser receipt는 `ux-review-browser.json`이다. 390×844에서 실제 진행 region **y380.17**, 취소 버튼 **y664.33~708.33**으로 같은 viewport 안에 보였다. 자동 준비 전후 앱 `scrollIntoView` 호출은 **0회**였고, 중단 뒤 저장 **1/8청크**, 미완료 전사 비활성을 확인했다. 진단은 사본 라벨·고정 캡처 시각·동일 미리보기의 명시적 복사를 확인했다. 820×1000 전환 시 사용자가 펼친 메모/원본은 열린 상태를 유지했다. 실제 Galaxy OS 동작을 검증한 것은 아니다.

최신 자산은 `index-DMKzhr98.js`, `index-DAySg1Xu.css`다. Worker는 같은 `worker-C2o35iJn.js`이므로 앞선 실제 오디오 처리·성능 근거를 재사용하고 새 속도 수치를 만들지 않았다. 과거 캡처/패널 좌표는 당시 증거이며 아래가 최신 UX 캡처다.

| 최신 390px 재검수 캡처 | Library |
| --- | --- |
| 준비 진행·취소 우선 | [PNG](https://chatgpt.com/api/library/files/libfile_67ba27c668088191887cacffd8af5560/download) |
| 중단 후 미완료·재시도 문구 | [PNG](https://chatgpt.com/api/library/files/libfile_3b5c4586b3bc8191b92844847dd5906c/download) |
| 고정 진단 사본·캡처 시각 | [PNG](https://chatgpt.com/api/library/files/libfile_7fa00e1055208191bfc77b51921faca5/download) |

이 후속도 미커밋이며 부모 재검수 전 푸시·배포하지 않았다.
