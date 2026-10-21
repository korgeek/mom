# 반응형·무활동 잠금 릴리스

2026-10-18. 사용자는 합성 QA 캡처 첨부와 배포를 승인했다. 부모는 최종14개 PNG의 실제 픽셀을 확인하고 모바일 녹음 종료 접근·잠금 상세·태블릿 보안/초기화 접기·결과 우선·명시 펼침 유지·데스크톱3열·홈/전사/처리기록/모델관리의 최종 시각 QA를 통과시켰다.

## 배포 전 검증

- 기준 main과 실제 원격 main은 `39be49a7c3fd566d52f20f2b5a6dd8f3c8fc5199`였다. `git ls-remote --exit-code origin refs/heads/main`으로 확인했다. 원래 main checkout은 clean이다.
- 제품 코드·의존성·설정·최종 build는 마지막 통과 검증 이후 바꾸지 않았다. [단위/컨트롤러/UI 및 built6개 시나리오의 실패·수정·선별 재검증](../README.md)을 재사용한다. 전체 스위트는 반복하지 않았다. 이번 추가 확인은 저장 문서 링크·Git diff·배포 dry-run과 운영 변경 경로 스모크다.
- 설치된 Wrangler4.151.1의 `deploy --help`로 `--dry-run`/`--outdir`를 확인했다. `WRANGLER_LOG_PATH=/tmp/mom-screen-lock-responsive/release/wrangler.log ./node_modules/.bin/wrangler deploy --dry-run --outdir /tmp/mom-screen-lock-responsive/release/worker-dry-run`은 PASS. 정적 자산84개, 바인딩 없음. 설정 변경이나 실제 배포는 하지 않은 준비 검사다.
- 검증된 산출물은 `index-CnThzoZg.js` / `index-DsVIOx9T.css`다. 실제 배포 후 운영 HTML/JS/CSS 바이트와 변경 경로를 확인하고 결과를 아래에 기록한다.

## 사용자 승인 캡처

명시적 요청 근거: 사용자가 합성 화면 첨부와 배포 확인 질문에 “그럼요. 그리고배포도 바로 진행해 주세요”라고 승인했다. 실제 사용자 자료·키·결제정보를 포함하지 않은14개 합성 캡처를 지원되는 ordered owned-file fallback으로 저장했다. 기존5개는 ID/버전 조건을 유지해 교체하고 신규9개는 생성했다. 모든 per-item 저장 및 로컬 identity 적용이 성공했다.

| 캡처 | Library ID | version |
| --- | --- | --- |
| 390-recording-priority.png | `libfile_cb37e60201748191b1e4c782e219e007` | 2 |
| 390-locked-recording.png | `libfile_4093187943e481919426dc5d5309b63f` | 1 |
| 1440-recording-independent-three-track-rows.png | `libfile_34ec982e7c1881919e7831588789fd1f` | 0 |
| 768-security-default-closed.png | `libfile_825a1e0b4e588191b3fb41a3ef29872b` | 1 |
| 768-security-reset-expanded-no-delete.png | `libfile_bbb729a863b08191914f2b12a4aa9425` | 0 |
| 390-strict-fragments-preserved.png | `libfile_368ee400a2708191bc9797b7868376a6` | 1 |
| 820-notes-result-settings-collapsed.png | `libfile_f732a59e67608191b81f97795cd1c97e` | 1 |
| 820-notes-user-settings-open-after-response.png | `libfile_7caff7436a7481919bf9cb2cf216df1d` | 0 |
| 820-usage-details-values-preserved.png | `libfile_5f37ee256e048191b58c500c4a50037b` | 0 |
| 1440-home-synthetic-results.png | `libfile_bd280c6395708191811e8924cd858976` | 0 |
| 1440-transcription-running.png | `libfile_61ae41ee62fc81918340fa772077527a` | 0 |
| 1440-processing-history-list.png | `libfile_456e78ed87b08191885e24d22031c633` | 0 |
| 1440-processing-history-detail.png | `libfile_078bbfb27e3c8191a06f5444c4d72af3` | 0 |
| 1440-model-settings.png | `libfile_f2c5e67f44048191979b3836ea3c0f4a` | 0 |

## 배포 및 운영 검증

기능 커밋 **`1e23441ebd33234d88827bf676308e8a58737565`**을 main에 fast-forward하고 `git push origin main`으로39be49a→1e23441 정상 푸시했다. [Workers Builds: mom 검사](https://github.com/korgeek/mom/commit/1e23441ebd33234d88827bf676308e8a58737565/checks)는 completed/success, 완료 시각2026-10-18T05:30:50Z였다. 별도 중복 CLI 배포는 하지 않았다.

Cloudflare deployment `8f28626f-24a8-415f-894d-8c3a56cb9e25`, version **`7d61176c-5780-4f46-8772-b449bdee8391` 100%**, 생성 시각2026-10-18T05:30:46.421497Z를 확인했다. 배포 목록은 시간 내림차순으로 선택했고 계정·인증 정보는 보관된 검증 JSON에서 제외했다.

[운영 Minutes of Meeting](https://mom.korgeek.workers.dev/)의 HTML/JS/CSS3개는 HTTP200이며 검증한 로컬 산출물과 SHA256이 모두 같았다. HTML의 CSP/COOP/Permissions-Policy/Referrer-Policy/nosniff5개 헤더 존재도 확인했다. 정확한 값은 [자산 대조](asset-sha256.json), 배포·시나리오 결과는 [검증 JSON](verification.json)에 보존한다.

운영 스모크는 별도 visible sandboxed Chrome의 새 격리 보관함·합성 WebAudio만 사용했다. `./node_modules/.bin/playwright test --config /tmp/mom-screen-lock-responsive/release/production-playwright.config.mjs` 최초2개는 녹음1 PASS/레이아웃1 FAIL였다. 새 메모의 비동기 저장·렌더를 기다리지 않고 evaluateAll한 harness 문제였으며 스냅샷에3개 단계와 정렬 화면이 확인됐다. 제품 변경 없이 toHaveCount3 대기 후 `--grep 'production desktop'`만 재실행해1 PASS(2.5s)를 확인했다.

- 390×844: 합성 녹음→화면 잠금→오암호→정상 재인증→암호화 저장. 마이크 요청1회, 잠금 중track1, 저장 후0. 원시 IDB56개에서 제목 sentinel0, 실제 외부 요청0, pageerror0이었다.
- 1440×900: 단계3등분과 본문1:2 기준선을1px 이내로 확인했다. 768×1024에서는1분·표준 기본값, 상세와 초기화 기본 닫힘, 노출된 초기화 실행 버튼 없음·가로 overflow 없음을 확인했다.
- fullPage 스크린샷의 sticky 카운터 재배치를 실제 viewport와 구분하기 위해390 한 건에 scrollTop0·카운터 y<160 확인을 추가했다. `--grep 'production 390'` 단일1 PASS(2.7s), 제품 수정 없음. 다른 통과 검사를 반복하지 않았다.

후속 문서 커밋은 제품 코드/의존성/빌드 설정을 바꾸지 않는다. 그 푸시 후 CI·원격 일치·같은 운영 자산만 확인하고 위 스모크 결과를 재사용한다.

## 승인된 로컬 정리

운영 검증 후 수행했다. 모든 로컬 ref7개의 bundle을 저장소 밖 **`/Users/korgeek/Workspace/mom-archives/2026-10-18/053817-UTC`**에 만들고 `git bundle verify`, list-heads 대조, SHA256 기록을 완료한 뒤 정리했다. bundle 크기는25,814,000bytes이며 SHA256은 `8d7249f8f481d5f1aeaf351012e1e24597cc6e262b1b53d52dcc89c7a5a172fb`다. 전체 SHA/복원 명령은 그 디렉터리의 refs-before.tsv/RESTORE.md에 있다.

clean·미추적0·열린 파일/실행 프로세스가 없는 옛 worktree4개(mom-implementation, mom-m4a, mom-source, mom-writer)를 정상 git worktree remove로 정리했다. 독립 커밋은 사용자의 main 재개발 설명과 bundle 보관을 근거로 로컬 브랜치 feat/mom-local, fix/mom-m4a, feat/mom-source, feat/mom-writer 및 병합된 archive/mom-before-update-20261017까지5개를 정리했다. 독립 commit이 있는4개는 bundle 검증과 head 일치 후 git branch -D로 ref만 삭제했다.

ignored14개 디렉터리/항목은 내용을 읽거나 삭제하지 않고 보관 디렉터리의 ignored-worktree-files/로 그대로 rename했다. .superpowers/.wrangler/dist/node_modules/test-results 등 출처가 불명확한 파일도 그곳에 남아 있다. 원격 브랜치·다른 프로젝트·실제 사용자 자료를 삭제하지 않았고 강제 rm, git gc/prune를 하지 않았다. main과 현재 릴리스 worktree/브랜치는 유지했다. [정리 결과](local-cleanup.json)에 전체 SHA와 보존 개수를 기록했다.

## 한계

실제 마이크·물리 모바일/OS 백그라운드 보장·유료 AI 추론과 품질은 미검증이다. 중단된 녹음 조각의 완성 복구 UI와 이중 암호화 vault 백업/복원은 미구현이다. .md 다운로드는 전체 vault 마이그레이션이 아니다. 현재 암호화 파라미터/메모리 한계와 외부 제공사 전송·보관은 별도이며 보안 인증이나 전체 메모리 소거를 주장하지 않는다.
