# 음성 준비 진행·진단 릴리스

2026-10-18. 부모가 최종 390px 진행·중단·진단 캡처 3장을 실제 픽셀로 확인하고 승인된 수정 범위의 커밋·main 반영·푸시·Worker 배포와 운영 스모크를 승인했다. [기능·화면 QA 기록](../README.md)의 선별 통과 근거를 재사용하며 전체 suite와 35분 속도 측정을 반복하지 않는다. baseline 4개 실패는 [TODO M09](../../../../TODO.md)의 미해결 부채이며 해결/통과로 처리하지 않는다.

## 배포 준비

- clean main 및 `git fetch origin main` 이후 원격 main은 `c0838c29c5954a197012d90658725d03c4ad0bb7`이다. 기능 worktree는 `fix/mobile-preparation-progress-20261018`이다. 백업 설계·Phase A와 이전 화면 잠금 worktree는 수정하거나 정리하지 않는다.
- 기존 설치 Wrangler4.151.1의 도움말로 확인한 `WRANGLER_LOG_PATH=/tmp/mom-preparation-diagnostic/release/wrangler.log ./node_modules/.bin/wrangler deploy --dry-run --outdir /tmp/mom-preparation-diagnostic/release/worker-dry-run`이 통과했다. 배포 설정이나 원격 리소스 변경은 없다.
- 부모 최종 검수 산출물은 `index-DMKzhr98.js`, `index-DAySg1Xu.css`, `worker-C2o35iJn.js`다. git-derived 진단 앱 버전 때문에 clean 커밋 빌드의 main JS 이름은 달라질 수 있다. 기능 로직은 같으며 실제 배포 SHA로 만든 산출물을 운영과 대조한다.
- main 푸시는 기존 Workers Builds 배포를 실행한다. 중복 CLI 배포는 하지 않고 해당 SHA의 CI 성공·배포 버전·운영 자산을 확인한다.

## 기능 반영·운영 검증 완료

기능 SHA **`25242ab42036b11d591074182656390b469dc9a3`**을 clean main에 fast-forward한 뒤 `git push origin main`으로 c0838c2→25242ab 정상 푸시했다. [Workers Builds 검사](https://github.com/korgeek/mom/commit/25242ab42036b11d591074182656390b469dc9a3/checks)는 **completed/success**, 완료 시각 `2026-10-18T07:33:20Z`다. 중복 CLI 배포는 하지 않았다.

Cloudflare deployment `f0960949-3964-4775-84c5-bfdb13b36ff7`, Worker version **`ce94173c-97de-43e4-933d-8c21f5150a23` 100%**, 생성 시각 `2026-10-18T07:33:17.008882Z`를 읽기 전용으로 확인했다. 기능 반영 SHA는 이 단계에서 먼저 전달했다. 다른 worktree나 백업 작업을 포함하지 않았다.

커밋 SHA가 들어간 clean main에서 `npm run build`, `npm run test:secret`을 실행해 PASS했다. 이전 통과 이후 제품/검사 코드는 바꾸지 않았고, 같은 tree임을 확인해 기능 검사는 재사용했다. 실제 배포 HTML·JS `index-DFVtcyKu.js`·CSS `index-DAySg1Xu.css`·미디어 Worker·MP3 WASM·PCM worklet **6개 모두 HTTP200, SHA-256 일치**다. HTML의 기존 CSP/COOP/Permissions-Policy/Referrer-Policy/nosniff 헤더도 존재했다. [자산 대조](asset-sha256.json)와 [검증 receipt](verification.json)에 계정·인증 정보를 제외한 결과를 저장했다.

운영 스모크 명령은 `node /tmp/mom-preparation-diagnostic/release/production-smoke.mjs`다. 별도 visible sandboxed Chrome, 390×844, 새 격리 보관함, 저장소 fixture generator로 만든 **310초 AAC-LC 합성음**만 사용했다. 실제 사용자 보관함·키·유료 AI는 사용하지 않았다.

- 실제 네이티브 AAC 디코딩·MP3 인코딩/검증 후 두 번째 청크의 **결과 전달만** 테스트에서 보류했다. RAM 계산 완료와 첫 청크의 실제 암호화 저장을 결정적으로 구분하기 위한 test seam이며, 제품 처리 결과/진행을 만들어내지 않았다.
- 표준 화면 잠금 중 실제 Worker progress가 6→30회로 늘었고 원본 시간 계산은 310,000ms까지 진행했다. 준비/진단/파일명 DOM은 제거됐다.
- 재인증 후 중단 시 **실제 저장 1/2청크·연속 원본 300,000ms(05:00/05:10)**를 유지했다. 메모리에서 계산한 마지막 청크는 저장 완료로 표시하지 않았고 미완료 전사를 막았다. Worker 종료로 보류 결과를 폐기했다.
- 새로고침·재인증 뒤에도 `준비 미완료 · 저장된 청크 1개`와 원본 선택 요약을 복원했다. 비정적/외부 요청 시도 **0**, pageerror **0**이었다. OS 클립보드에 쓰지 않았다.

최초 스모크는 테스트용 Worker 관찰기가 EventTarget listener만 전달하고 앱이 사용하는 `onmessage` 프로퍼티를 호출하지 않아 업로드 검사에서 30초 대기했다. 제품 변경 없이 관찰기의 전달을 보정한 같은 경로가 PASS했다. 최초 실패는 `/tmp/mom-preparation-diagnostic/release/production-smoke-harness-first.{log,json}`, 최종 통과는 `production-smoke.{log,json}`에 보존한다. 전체 suite·35분 속도 측정은 반복하지 않았다.

## 문서 후속과 보존

이 결과를 기록하는 문서 커밋은 src/tests/의존성/설정을 변경하지 않는다. git-derived 진단 버전 문자열 때문에 main JS 자산은 새 문서 SHA에 맞춰 달라지므로, 후속 clean 빌드와 CI·운영 자산만 다시 대조한다. 동일한 제품 로직의 위 운영 스모크를 반복하지 않는다. 문서 커밋 자신의 SHA/마지막 CI 결과는 자기참조 커밋을 추가하지 않고 최종 인계와 [전체 QA Library 문서](https://chatgpt.com/api/library/files/libfile_839bcb6e38bc8191b3cf4d4c9dc012c6/download)의 최신 버전에 남긴다.

기능 worktree/브랜치와 백업 설계·Phase A·이전 화면 잠금 worktree는 보존한다. 사용자 작업/원격 브랜치를 정리하거나 force push하지 않는다. baseline 4개 실패는 여전히 TODO M09의 미해결 부채다.

실제 Galaxy/OS 화면 꺼짐·강제 종료·모바일 완료 보장과 인증된 AI 품질은 이 릴리스의 검증 범위가 아니다. 로컬 암호화가 OS 실행 유지나 완전한 메모리 소거를 보장한다고 주장하지 않는다.
