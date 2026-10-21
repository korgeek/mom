# 개발 중 화면 갱신 후 보관함 잠금 해제·초기화 오류

2026-10-17 · 작업 브랜치 `codex/unified-model-management` · 수정 전 HEAD `2da5908`.

사용자는 잠금 화면에서 `delete`를 입력하고 영구 삭제 버튼을 눌러도 화면이 변하지 않는다고 보고했다. 실제 localhost 탭 콘솔에서 이미 사용한 컨테이너에 `ReactDOMClient.createRoot()`를 다시 호출했다는 오류를 확인했다. 진입 모듈이 HMR로 다시 실행될 때 React root도 다시 생성되어 이전 보관함 소유자가 남을 수 있었다.

`main.tsx`에서 Vite HMR data에 React root를 보존하고 다음 갱신에서 재사용한다. 운영 빌드는 기존처럼 root를 한 번 생성한다. 보관함 암호화·삭제 로직과 확인 절차는 바꾸지 않았다.

## 직접 검증한 범위

Node 24.19와 별도 Chrome 테스트 창의 합성 보관함을 사용했다. 실제 사용자 보관함과 API 키는 테스트에서 사용하지 않았다.

| 명령 | 결과 |
| --- | --- |
| `node node_modules/playwright/cli.js test --config playwright.config.ts tests/e2e/vault-hmr-regression.spec.ts --output /private/tmp/mom-vault-hmr-evidence` | 수정 전 중복 `createRoot` 콘솔 오류로 실패. 수정 후 1개 통과: HMR 두 번, 매번 잠금 해제, 다시 잠금, 영구 삭제 후 새 보관함 화면 확인 |
| `node node_modules/playwright/cli.js test --config playwright.config.ts tests/e2e/vault-lifecycle-regression.spec.ts --output /private/tmp/mom-vault-lifecycle-repro` | 3개 통과: 짧은 혼합 암호·앞뒤 공백·한글 암호 생성, 재접속, 잠금 해제, 잘못된 암호 거부, 초기화, 새로고침 |
| `node node_modules/playwright/cli.js test --config playwright.config.ts tests/e2e/vault-reset.spec.ts --grep 'native non-owner reset' --output /private/tmp/mom-vault-owner-repro-fixed` | 1개 통과: 다른 탭이 소유한 보관함의 잠금 해제·삭제 거부, 소유 탭 잠금 후 초기화 |
| `npm run build` | 타입 검사·운영 빌드 통과. 기존 청크 크기 및 혼합 import 경고 유지 |
| `node node_modules/eslint/bin/eslint.js src/react-app/main.tsx tests/e2e/vault-hmr-regression.spec.ts tests/e2e/vault-lifecycle-regression.spec.ts tests/e2e/vault-reset.spec.ts` | 통과 |
| `node scripts/check-public-artifacts.mjs` · `git diff --check` | 통과 |

명령의 Node 실행 경로는 `/Users/jinik/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin`이다. 전체 테스트 모음은 실행하지 않았다.

## 화면 증거와 실제 탭

- 합성 보관함의 [삭제 확인](hmr-reset-confirmation.png) → [삭제 완료 후 새 보관함](hmr-reset-complete.png). 1440×900에서 렌더링했다.
- 실제 localhost 탭은 새로고침하여 기존 중복 root를 정리하고 삭제 확인창까지 다시 열었다. **실제 데이터 영구 삭제 버튼은 누르지 않았으며, 사용자 클릭 후 결과는 아직 확인하지 않았다.**

이 검증은 개발 서버의 HMR과 보관함 재접속·초기화 범위다. 실제 제공사 추론, main 푸시와 운영 배포는 수행하지 않았다. 사용자 작업 중이던 `App.tsx` 문구 변경은 그대로 보존했다.
