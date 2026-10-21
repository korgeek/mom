# 운영 배포 기록

2026-10-19. 사용자 승인에 따라 `git merge --ff-only a13514d`로 주 체크아웃의 기존 라이선스 커밋을 보존해 통합했다. 새로 fetch한 원격 `c4076fe`와 feature의 조상 관계, 주 체크아웃의 clean 상태를 확인한 뒤 `git push origin main`을 실행했다. 원격은 `a13514daba8735f859ce7e1cf37f53d784c6a3f1`로 일치했다. 강제 push/reset/stash는 사용하지 않았다.

## 빌드와 배포

- `gh api repos/korgeek/mom/commits/a13514daba8735f859ce7e1cf37f53d784c6a3f1/check-runs --jq ...`: [Workers Builds: mom](https://github.com/korgeek/mom/commit/a13514daba8735f859ce7e1cf37f53d784c6a3f1/checks) `completed/success`, 2026-10-19T08:02:57Z. Build ID `1abd6b33-6a85-49af-9e9b-28427b4183fc`.
- `WRANGLER_LOG_PATH=/private/tmp/mom-release-deployment.log npx wrangler deployments list --json`: [최신 생성 시각으로 선택한 배포](deployment.json)는 `df006b3e-fe9b-43b5-8351-d7de043b028c`, 버전 `9d62ea65-5112-48a2-8d52-dac75625d3a8` **100%**, 2026-10-19T08:02:50.664479Z. 배열 첫 항목은 오래된 배포였으므로 최신 생성 시각을 사용했다.
- 최종 commit revision이 포함된 `npm run build && npm run test:secret` 통과. `wrangler deploy --dry-run`은 85 자산·바인딩 없음으로 통과했다. main 자동 배포를 사용했으며 CLI 직접 배포를 중복 실행하지 않았다.
- 문서 상대 링크 165개 실재 확인. 최초 정규식은 파일명의 괄호를 잘못 잘라 2개를 오탐했고 괄호를 지원한 검사로 통과했다. 원본 6개 Git 객체/해시 보존과 이전 선별 통과 결과를 재사용했다.

## 실제 운영 화면

별도 Chrome 자동화는 앱 첫 진입 전에 `ERR_CONNECTION_RESET`/`ERR_ABORTED`와 인증서 오류로 중단됐다. 2개의 hosted Playwright는 통과하지 않았다. curl도 30초 및 IPv4 15초 연결 timeout이어서 전체 자산의 SHA-256 대조를 완료하지 못했다. 인증서 경고를 우회하거나 브라우저 보안을 변경하지 않았다. 이 실패를 앱 기능 오류나 배포 실패로 단정하지 않는다.

앱 내 브라우저는 [운영 주소](https://mom.korgeek.workers.dev/)가 정상 열렸으며 `새 보관함 만들기`부터 별도의 합성 보관함만 사용했다. 실제 사용자 Chrome 프로필·보관함·키·회의 파일을 사용하지 않았다. 약 528px 폭에서 다음을 직접 확인했다.

1. OpenRouter/OpenAI의 GPT-6 Luna 프리셋 이름·모델 ID·Chat Completions URL. 키 입력/저장과 실제 추론 없음. [Luna 캡처](production-luna.png).
2. 인증 없는 localhost 합성 모델 A/B 등록, 새 합성 메모와 전사 화면. 압축된 전송 확인, 사용량 요약과 `전체 전사 확인·편집` 준비 전 차단. [전사 화면](production-stt.png).
3. 사용량 명세 모달 열기/닫기, 미확인 비용·전송 기록의 한계·좌우 탐색 안내. [명세](production-usage.png).
4. 삭제 확인의 범위, 취소 기본 초점과 취소 후 메모 유지. 운영에서는 삭제 확정하지 않았다. [확인 모달](production-delete-confirm.png).
5. 실제 60초 자동 화면 잠금과 합성 암호로 해제, 새로 나타난 잠금 화면에서 민감 DOM 제거. 파일 선택 도구가 오랫동안 대기해 업로드가 완료되지 않았고 합성 세션이 잠겼다. 이 환경에서 운영의 파형/전사 성공/재시도/삭제 완료 흐름은 검증하지 못했다. 해당 흐름은 별도 로컬 프로덕션 preview의 2/2 통과 근거와 구분한다.

운영 DOM의 script `/assets/index-6EqP4nmY.js`, CSS `/assets/index-DpR4-S0O.css`는 같은 커밋의 로컬 빌드 파일명과 일치했다. 이것은 전체 파일의 바이트 해시 대조를 대신하지 않는다. 본문 모델/요약/모달의 실제 렌더링을 별도로 확인했다.

## 라이선스 문자 인코딩 후속

운영의 라이선스 TXT가 앱 내 브라우저에서 한국어를 잘못 해석하는 것을 관찰했다. 정본 내용은 바꾸지 않고 `/licenses/*.txt`의 `Content-Type: text/plain; charset=utf-8`을 명시했다. [Cloudflare 정적 자산 헤더 문서](https://developers.cloudflare.com/workers/static-assets/headers/)의 규칙을 확인했다. `node --test tests/artifacts.test.mjs` 4/4 통과에 UTF-8 배포 헤더 확인을 포함한다. 이 후속은 기능/의존성/보관 정책을 바꾸지 않는다. 후속 main 커밋의 자동 빌드와 실제 라이선스 재열기를 확인한다.

실제 인증 추론·제공사 수용/보관/청구·음성/노트 품질은 여전히 미검증이다. 전체 스위트와 전체 제품의 운영 행렬은 실행하지 않았다.
