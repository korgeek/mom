# 2026-10-19 라이선스 적용과 Wrangler 설정 검증

사용자가 [라이선스 초안](../../../16-mom-source-available-license-draft.md)의 적용과 README·앱 안내 변경, LGPL 예외 유지를 승인했다. 작업 중 추가로 요청한 관측 설정을 기존 `wrangler.json`에 적용했다. 시작 HEAD는 `888ca3dcaf7ef3e8753419d9216d23ff8bb934c4`이며 기존 초안과 문서 변경을 보존했다. 원격 조회·저장소 공개 설정 변경·푸시·배포는 수행하지 않았다.

## 적용 범위

- [정식 LICENSE](../../../../LICENSE)와 [배포용 원문](../../../../public/licenses/MoM-SOURCE-AVAILABLE-LICENSE.txt): MoM Source Available License 1.0, korgeek, 2026-10-19 시행, 한국어 정본. 승인된 초안 제1~11조의 정책을 유지하고 권리자·범위·시행일과 배포 경로를 확정했다. 별도 표준 라이선스로 표시하지 않는다.
- [README](../../../../README.md), [package.json](../../../../package.json), [package-lock.json](../../../../package-lock.json): 적용된 이용정책·원문·배포 사본과 `SEE LICENSE IN LICENSE` 메타데이터. 의존성 추가·설치·버전 변경은 없다.
- [설정 화면](../../../../src/react-app/ui/screens/Settings.tsx): 한국어/영어 요약, MoM 원문 링크, 기존 제3자 라이선스·소스/재빌드 링크. 기존 푸터 스타일을 재사용했다. 키·저장·잠금 로직은 바꾸지 않았다.
- [제3자 고지](../../../../public/THIRD_PARTY_NOTICES.txt), [소스 안내](../../../../public/sources/REBUILD.md), [코덱 안내](../../../../public/sources/codecs/REBUILD.md), [소스 manifest](../../../../public/sources/codecs/SOURCE_MANIFEST.json): 전체 앱 라이선스 미선택이라는 현행 설명을 정정하고 새 약관과 기존 권리의 우선 관계를 연결했다. 코덱 소스·바이너리·도구·원문 라이선스는 수정하지 않았다.
- [문서 인덱스](../../../README.md), [TODO](../../../TODO.md), [결정 기록](../../../09-decisions-and-roadmap.md), [초안 기록](../../../16-mom-source-available-license-draft.md): 채택 상태와 실제 공개·배포 여부를 구분한다. 원래 초안 본문과 당시 메모는 과거 기록으로 보존했다.
- [Wrangler 설정](../../../../wrangler.json): 요청한 logs/traces의 enabled, head_sampling_rate, invocation_logs, persist 값. 원본과 빌드 설정의 값이 일치한다. traces와 source map은 비활성이고 binding은 없다. 정적 자산의 요청이 실제 Worker 호출 로그를 발생시키는지는 이 로컬 검사로 확인하지 않는다.
- [UI 검사](../../../../tests/ui.spec.tsx), [산출물 검사](../../../../tests/artifacts.test.mjs), [새 브라우저 검사](../../../../tests/e2e/license.spec.ts), 기존 [문구 배치](../../../../tests/e2e/copy-placement.spec.ts)·[반응형](../../../../tests/e2e/responsive.spec.ts)·[보관함](../../../../tests/e2e/vault-reset.spec.ts) 검사의 직접 영향받는 라이선스 링크/개수 선택자를 맞췄다. 기존 브라우저 파일의 다른 흐름은 재실행하지 않았다.

## 검사 명령과 결과

셸 기본 Node 24.11.1 대신 아래 접두어로 설치된 Node 24.19.0을 사용했다.

```sh
PATH=/Users/jinik/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH
```

| 실제 실행한 명령 | 결과와 범위 |
| --- | --- |
| `npx vitest run tests/ui.spec.tsx -t 'places legal links exactly once'` | 구현 전 요약 부재로 한국어/영어 2 FAIL, 98 제외. 의도한 변경 부재를 확인한 실패다. |
| `node --test --test-name-pattern='ships the same MoM license' tests/artifacts.test.mjs` | 구현 전 LICENSE 부재로 1 FAIL. |
| `npx vitest run tests/ui.spec.tsx -t 'places legal links exactly once\|omits the build banner'` | 구현 후 14 PASS, 관련 없는 86 제외. 모든 설정 탭의 한국어/영어 링크·키보드 초점과 설정 밖/잠금 경계만 검사했다. |
| `node --test tests/artifacts.test.mjs` | 4 PASS. 루트와 배포 사본 일치 및 기존 산출물 스캔 계약. |
| `npx eslint src/react-app/ui/screens/Settings.tsx tests/ui.spec.tsx tests/e2e/license.spec.ts tests/artifacts.test.mjs` | PASS. |
| `npx tsc --project tsconfig.e2e.json --noEmit` | PASS. 수정·추가된 브라우저 검사도 타입 검사에 포함된다. |
| `npm run build` | 최종 PASS. 첫 빌드 후 Wrangler 설정이 바뀌어 그 빌드의 설정 근거를 대체하고 최종 빌드를 실행했다. JS는 `index-DS6yq3Wg.js`. 기존 큰 번들·혼합 import 경고가 있다. |
| `npm run test:secret` | 최종 빌드 PASS. 앱 소스·정적 자산·배포 산출물만 검사하며 일치한 비밀값을 출력하지 않는다. |
| `npx playwright test tests/e2e/license.spec.ts --max-failures=1` | 최종 production preview의 별도 보이는 sandboxed Chrome에서 4 PASS, 9.2초. 한국어/영어 × 1440×900/360×900. |
| `WRANGLER_LOG_PATH=/tmp/mom-license-observability-dry-run.log WRANGLER_SEND_METRICS=false npx wrangler deploy --dry-run --outdir /tmp/mom-license-observability-worker` | Wrangler 4.151.1 PASS, 자산 85개·binding 없음. 배포는 실행하지 않았다. |
| `python3 /tmp/mom-license-adoption-check.py` | 변경 문서의 로컬 링크 54개 PASS. 기존 파일 해시·보존된 초안 본문·루트/정적/빌드 원문·관측 설정 일치 확인. 아래 보존 결과 참조. |
| `git diff --check` | PASS. |

브라우저에서는 새 합성 보관함에서 설정으로 이동했다. 영어는 화면에서 직접 선택했으며 각 사례의 세션을 재사용하지 않았다. 세 링크의 경로/응답, 한국어 약관 새 탭 열기, 실제 제공 원문과 루트 LICENSE의 바이트 일치, plain-text MIME, 좁은 화면 넘침 없음을 확인했다. 외부 HTTPS 요청은 차단했고 실제 제공사 키·회의 음성·인증 추론은 사용하지 않았다.

staging 후 `git diff --cached --check`가 새 LICENSE의 마지막 빈 줄을 지적했다. 루트와 배포 사본의 마지막 빈 줄만 정리하고 다시 빌드했다. 화면 코드·JS/CSS 해시는 같아 네 화면의 렌더링 근거를 재사용한다. 변경된 원문 바이트는 `node --test --test-name-pattern='ships the same MoM license' tests/artifacts.test.mjs` 1 PASS, `npm run test:secret` PASS와 `npx playwright test tests/e2e/license.spec.ts --grep 'ko 1440' --max-failures=1`의 해당 원문 링크 1 PASS로 확인했다. 관측 설정이 동일하므로 앞선 Wrangler dry-run 근거는 재사용한다.

## 실제 렌더링 확인

생성된 네 푸터 이미지를 직접 확인했다. 기존 서체·색·간격을 유지하고 세 링크를 표시한다. 360px 한국어는 본문이 줄바꿈되며, 360px 영어는 마지막 소스/재빌드 링크가 다음 줄로 내려온다. 가로 넘침은 없다.

| 상태 | 캡처 |
| --- | --- |
| 한국어 1440×900 | [라이선스 안내](1440-ko-license.png) |
| 한국어 360×900 | [라이선스 안내](360-ko-license.png) |
| 영어 1440×900 | [라이선스 안내](1440-en-license.png) |
| 영어 360×900 | [라이선스 안내](360-en-license.png) |

## 보존과 한계

작업 전 SHA-256과 비교해 기존 라이선스·배포 허용문·helper·소스 아카이브·디자인 참고자료 52개 파일이 그대로임을 확인했다. 특히 `MoM-OBJECT-PERMISSION.txt`와 `MoM-CODEC-HELPERS-MIT.txt`는 바이트 단위로 유지한다. 새 루트 LICENSE·public 배포 사본·dist 배포 사본도 바이트가 일치한다. 요청한 관측 값은 root/dist Wrangler 설정에서 같고 기존 SPA 자산 구조·source map 비활성은 유지된다.

전체 제품 스위트, 실제 AI, 원격 배포·원격 로그·운영 화면, 별도 법률 자문이나 새 LGPL 재링크 실행을 검증한 결과가 아니다. 라이선스의 예외 보존은 실제 결합 배포물 전체의 법률 적합성 판정을 대신하지 않는다. 저장소 공개와 실제 서비스 반영은 별도 작업이다.
