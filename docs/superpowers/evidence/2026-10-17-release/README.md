# 2026-10-17 릴리스 보안·정리·배포 확인

기준: 원격 `main` 9383099 → 작업 브랜치 d1b0e68의 19개 커밋과 후속 보안·정리 변경. 사용자가 커밋·점검·브랜치 정리·푸시·운영 빌드 확인을 승인했다. 기존 변경 부분의 동일 코드 검증은 재사용하고 전체 스위트를 실행하지 않는다.

## 사용자 문구 포함 후속 작업

사용자가 `App.tsx` 두 문구를 직접 수정한 것이라고 확인하고 함께 커밋·푸시하도록 명시 승인했다. 위/아래 기존 제외 기록은 이전 단계의 이력으로 보존한다. 이번 후속 변경은 보관함 암호 안내와 로컬 암호화/외부 AI 전송 안내 두 줄이며 암호 검증·암호화·전송 정책을 바꾸지 않는다.

- 최종 `npm run build` PASS(Vite 7.3.7, `index-BRL4iVYe.js`), `npm run test:secret` PASS, `git diff --check` PASS. 기존 bundle/혼합 import 경고는 유지한다.
- `npx playwright test --config /tmp/mom-release-smoke/local.config.mjs 00-vault-copy.spec.ts`: 1 PASS(3.4초). 새 문구 두 줄을 정확히 검사하고 1440×900/360×800 렌더링·좁은 화면 넘침 없음·보관함 생성/잘못된 암호/재열기를 확인했다. 기존 다른 기능의 검증은 재사용한다.
- 문구 커밋 `8ff4b3974315cb67fcd116374aba899cb77ebb90`을 main에 푸시했다. `gh api repos/korgeek/mom/commits/8ff4b39/check-runs`: `Workers Builds: mom` completed/success, build `54301d28-42ab-4ced-bb9c-143dc90e4295`, version `d535c3c5-8f7b-40cf-96be-72ac2fd55e1a`. `npx wrangler deployments list --json`으로 2026-10-17T13:46:43Z 해당 버전 트래픽 100%를 확인했다.
- 새 문구 최종 빌드로 `node /tmp/mom-release-verify-assets.mjs`를 다시 실행했지만 연결 timeout으로 실패했다. 푸시 전 `curl -I --connect-timeout 5 --max-time 10`도 연결 timeout이었다. 운영 파일·HTTP 헤더 일치는 미확인이다.
- `npx playwright test --config /tmp/mom-release-smoke/production.config.mjs 00-vault-copy.spec.ts --max-failures=1`: 재시도 1 FAIL. 운영 URL의 첫 `page.goto(..., waitUntil: 'domcontentloaded')`가 15초 timeout이며 문구 assertion까지 도달하지 않았다(전체 25.3초). 이후 불필요한 화면 검사는 실행하지 않았다. 로컬 렌더링 PASS와 운영 화면 미확인을 구분한다.

## 점검과 수정

- 등록 모델·키·STT/LLM 설정, 녹음/업로드, 전사/정리 배치, 홈/처리 기록과 청크 초기화의 기존 구현을 포함한다. 각 단계의 [이전 검증 목록](../../../README.md)은 당시 증거로 보존한다.
- 변경 범위 코드 리뷰에서 확인된 배포 차단 보안 결함은 없었다. endpoint HTTPS/loopback 제한, credential origin 결합, redirect 거절·쿠키 미전송, 응답 크기 제한과 키 redaction, JSON 공유의 키 제외, 잠금 시 작업/키/UI 해제, Markdown 정제, 원본 인증과 원자적 초기화·암호화 이력 보존을 확인했다. 전체 저장소 보안 감사나 침투테스트 결과는 아니다.
- `npm audit --omit=dev --json`: production 취약점 0. 전체 `npm audit --json`: 최초 low 2/moderate 1/high 13, 총 16. Vite 7.3.7, Cloudflare Vite plugin 1.64.0, Wrangler 4.151.1과 허용 범위 내 전이 의존성 수정 후 총 0. 제품 runtime 의존성의 직접 버전은 유지했다. 자동 설치 스크립트는 실행하지 않았다.
- 등록 STT의 WAV 판정을 `audio/wav` + `pcm-s16le`로 통일했다. controller의 `pcm`/느슨한 MIME 검사 때문에 올바른 descriptor가 요청 전에 차단되던 불일치를 고쳤다. 합성 바이트의 controller/전송 계약 시험이며 실제 WAV 인코더를 추가하지 않는다.
- 기존 사용자 보관함 안내 두 줄은 원래 작업 트리에 보존하고 커밋/배포에서 제외한다. 자동 승인 검토가 해당 사용자 수정을 포함한 staging/푸시를 거절해, 이 파일을 제외한 명시적 staging과 별도 배포 체크아웃을 사용한다. 암호 검증 정책은 변경하지 않았다.
- README 도구 버전, TODO의 오래된 배포 전 목록과 전사 힌트 미구현 상태를 정리했다. 기획 문서·예전 시험 실패/배포 없음 기록은 당시 증거로 보존한다. 추가 버전 체계·서버·API relay·계정·공유 기능은 만들지 않는다.

## 최종 선별 검사

검증 환경은 Node 24.19.0과 설치된 별도 보이는 Google Chrome이다. 기본 셸 Node 24.11.1은 현재 jsdom 엔진 범위 밖이라 사용하지 않는다. 로컬 명령은 `PATH=/Users/jinik/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH`를 앞에 두었다.

- `npx vitest run tests/unified-model-controller.spec.tsx -t 'dispatches retained PCM WAV'`: 수정 전 1 FAIL/19 제외, 수정 후 1 PASS/19 제외.
- `npx eslint src/react-app/controller.tsx tests/unified-model-controller.spec.tsx`: PASS. App 별도 검사 0 오류/기존 Fast Refresh export 경고 1.
- `npm ci --ignore-scripts`: lockfile로 깨끗이 설치한 뒤 실제 Vite 7.3.7/Cloudflare plugin 1.64.0/Wrangler 4.151.1 버전 일치 assert PASS. 최초 업데이트 직후 Vite 설치 파일과 lockfile 버전 불일치를 발견해 앞선 빌드 근거를 폐기하고 재설치 후 재검증했다.
- `npm run build`: 최종 Vite 7.3.7 PASS. 기존 media 혼합 import와 500 kB 초과 bundle 경고는 남는다. `npx tsc --project tsconfig.e2e.json --noEmit`: PASS.
- `npm run test:secret`: 최종 빌드 PASS. `node --test tests/artifacts.test.mjs`: 3 PASS. 비밀값·provider relay·fixture payload·평문 web storage·source map 검사에서 일치값을 출력하지 않는다.
- `npx playwright test --config /tmp/mom-release-smoke/local.config.mjs`: 별도 headed Chrome 2 PASS(8.8초). 기존 history-reset/passphrase 시험을 /tmp로 복사해 기존 증거 캡처를 덮어쓰지 않았다. 사용자 문구를 제외한 커밋된 관리 체크아웃에서 최종 빌드·공개 산출물 검사·dry-run을 다시 통과하고 같은 두 브라우저 흐름도 2 PASS(6.7초)로 확인했다. 최종 앱 파일은 `index-H0tHSPwn.js`다. 암호 입력 제약·생성·잘못된 암호·재열기, 실제 합성 WAV 준비와 가로챈 STT/LLM 2회, 초기화 취소/확인·원본/이력 보존·자동 호출 없음·reload, 홈 15+1개와 정보성 sidebar를 확인했다. 1440×900/360×800을 렌더링했다.
- `WRANGLER_LOG_PATH=/tmp/mom-release-dry-run.log npx wrangler deploy --dry-run --outdir /tmp/mom-release-worker`: PASS, 정적 자산 84개·binding 없음. 실제 배포 명령은 실행하지 않았다.
- `npm audit --json`: clean install 후 최종 0건. `git diff --check`: PASS. `node /tmp/mom-release-doc-check.mjs`: 문서 4개의 링크/앵커 74개 PASS, 원본 참고자료 6개의 SHA-256 불변.

## 배포 상태

`1a55d31b092bb005b90f296c959ce4d188552079`을 main으로 fast-forward하여 푸시했고 원격 main과 일치를 확인했다. [GitHub 커밋 검사](https://github.com/korgeek/mom/commit/1a55d31b092bb005b90f296c959ce4d188552079/checks)의 `Workers Builds: mom`은 `completed/success`다. build `bc9ae344-a9eb-4ee8-af9c-413983cbf152`, version `1d8d835e-1575-46de-98c8-5e44f28b4220`, 2026-10-17T13:39:17Z 배포를 관리 API에서 확인했다.

- `gh api repos/korgeek/mom/commits/1a55d31/check-runs`: 위 성공 상태와 버전 연결 확인.
- `npx wrangler deployments list --json`: 위 version 트래픽 100% 확인.
- `npx wrangler versions view 1d8d835e-1575-46de-98c8-5e44f28b4220 --json`: 정적 자산 직접 제공·SPA 설정, CSP/COOP/Permissions-Policy/Referrer-Policy/nosniff 5개 헤더 설정, binding 0 확인. 실제 HTTP 응답에서 확인한 것은 아니다. 계정 이메일/식별자 등 불필요한 관리 메타데이터는 이 기록에 포함하지 않는다.
- `node /tmp/mom-release-verify-assets.mjs`: 운영 HTML/JS/CSS/Worker/WASM 등 8개 파일의 SHA-256·MIME·보안 헤더를 비교하려 했으나 연결 timeout으로 실패했다. 원격 파일 일치를 주장하지 않는다.
- `npx playwright test --config /tmp/mom-release-smoke/production.config.mjs`: 첫 history/reset 흐름은 시작 주소 연결에서 timeout으로 1 FAIL, 다음 passphrase 흐름도 주소 연결 대기 상태여서 중단했다(1 interrupted). 앱 동작 assertion에 도달하지 않았다. 운영 origin은 같은 origin 요청만 실제 통과시키고 외부 provider는 가로채도록 했다. 실제 사용자 데이터나 유료 요청은 없다.
- `curl -I --max-time 20 https://mom.korgeek.workers.dev/`: 20초 연결 timeout. 환경 프록시 설정을 따르는 Node HEAD도 10초 timeout. 별도 Chrome 탭도 navigation timeout이며 버전 미리보기 주소 HEAD도 5초 timeout이다. 원인을 앱 결함이나 특정 네트워크 제한으로 단정하지 않는다. 반복 전수검사나 보안 설정 변경은 하지 않았다.

서버 빌드·배포 확인은 완료했으나 **운영 화면·파일 일치 검증은 미완료**다. 운영 주소에 접속할 수 있는 환경에서 위 두 대표 흐름과 파일/헤더 대조만 이어서 확인해야 한다. [Cloudflare 빌드 이미지 문서](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/)는 빌드 환경 참고이며 운영 성공의 대체 근거가 아니다.

이 기록의 후속 커밋은 문서만 변경한다. 제품 소스·lockfile·정적 자산은 1a55d31과 동일하므로 통과한 로컬 빌드·검증은 재사용한다. main을 원래 작업 폴더로 돌리고 합쳐진 기능 브랜치와 이번 관리 작업트리를 정리한다. 기존 사용자 App.tsx 두 문구는 로컬 미커밋 상태로 보존한다.

실제 사용자 보관함/키/회의는 읽지 않는다. 브라우저는 새 격리 컨텍스트의 합성 자료만 사용하고 provider 요청을 가로챈다. 실제 인증 추론·음성/정리 품질·청구·장시간 음성·전체 장비/다중탭 행렬은 이번 검증 범위가 아니다.
