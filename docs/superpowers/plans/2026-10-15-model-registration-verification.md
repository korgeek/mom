# STT·LLM 등록 구현·검증 기록

2026-10-15, Asia/Jakarta. 사용자 승인: 이 세션 직접 구현, 분리된 작업 폴더. 기준점 `b126c5818b79d85f016a209f4fe57ed33aaddfda`, 브랜치 `codex/model-registration`. [계획](2026-10-15-model-registration.md), [설계](../specs/2026-10-14-model-registration-design.md).

## 구현 결과

설정 → 모델에 STT/LLM 등록 목록·폼·수정, OpenAI/OpenRouter/로컬 주소 도움값, 모델 ID 직접 입력, 등록 전용 키 저장, 읽기 전용 `{{값}}` 요청 미리보기와 실제 테스트 호출을 추가했다. 등록·키·완료 결과는 기존 암호화 vault에 저장한다. DB 버전·암호화 방식·기존 회의 실행기·전역 제공사 키를 변경하지 않는다.

원격 HTTPS/로컬 loopback HTTP만 허용하고 URL 사용자정보·query·fragment·제어문자를 거부한다. 키는 등록 origin과 결합하고 키 교체·origin 변경 때 기존 테스트 성공을 무효화한다. 키·버전·목록 갱신은 원자적 트랜잭션이다. 테스트는 단일 요청, 중복 차단, redirect/cookie 차단, 실제 음성 검사(앱 제한 30초·5 MiB), 512 KiB 응답 상한을 사용한다. HTTP 200 오류·거절·tool call·부분 결과를 구분하고 응답에 echo된 secret을 마스킹한다.

완료 결과는 UI 반영 전에 coordinator의 pending 저장에 등록한다. 저장 실패 때 결과만 다시 저장하고 HTTP 요청을 다시 보내지 않는다. 잠금 중 완료 결과 저장 실패는 기존 lock-save-failed/retry 경로를 사용한다. 잠금 때 목록·초안·키 입력·미리보기·결과를 DOM에서 제거한다.

## 구현 중 판단

- 사용자 지침에 따라 관련 테스트만 실행하고 전체 suite·별도 의무 리뷰 체인은 추가하지 않았다. 동일 코드의 통과 증거를 재사용했다. 별도 새 맥락 리뷰나 관련 없는 흐름의 회귀는 확인하지 않았다.
- OpenRouter STT는 선택한 보관 정책을 확실히 전달하도록 기존 공식 JSON/base64 경로를 재사용했다. OpenAI/일반 호환 서버는 multipart이다. [OpenRouter 공식 문서](https://openrouter.ai/docs/guides/overview/multimodal/stt)는 두 형식과 JSON의 provider 보관 정책을 설명한다. OpenRouter에서 무시되는 최상위 prompt나 미확인 복수 언어·키워드 필드는 제공하지 않는다. 실제 제공사 동작은 인증 테스트가 필요하다.
- 기존 설치의 node_modules 심볼릭 링크는 Vite 파일 경계와 충돌해 분리 작업 폴더에 기존 설치를 복제했다. 새 의존성을 설치하거나 package/lockfile을 바꾸지 않았다. 테스트 tsconfig에 Vite client 타입을 명시해 UI의 Vite 자산 import를 타입 검사한다.
- 잘못된 JSON은 secret 마스킹을 보장할 수 있도록 원문 대신 `Unparseable response omitted`를 저장한다. 유효 JSON은 마스킹된 본문을 보존한다. 마스킹으로 저장 한도를 넘으면 원문·텍스트를 한도에서 자르고 미완료를 명시한다.

## 실행한 검사와 결과

전체 suite는 실행하지 않았다. 아래 9개 파일의 관련 단위 테스트 **184개**를 확인했다. 한 번의 마지막 전체 실행을 뜻하지 않는다: 180개 통과 후, 바뀐 전송/저장/컨트롤러 파일에 추가한 4개와 해당 파일의 기존 사례를 다시 실행했다.

```sh
npm run test:unit -- tests/model-registrations.spec.ts tests/registration-test.spec.ts tests/model-registrations-ui.spec.tsx tests/model-registrations-controller.spec.tsx tests/vault-model-registrations.spec.ts tests/vault-model-registry.spec.ts tests/providers.spec.ts tests/model-manager-ui.spec.tsx tests/model-selection-modal.spec.tsx
# 당시 9 files, 180/180 PASS
npm run test:unit -- tests/registration-test.spec.ts tests/vault-model-registrations.spec.ts tests/model-registrations-controller.spec.tsx
# 최종 관련 변경: 3 files, 28/28 PASS
npm run typecheck
# PASS; 최종 build에도 tsc -b 포함
npm run build
# PASS, 130 modules, client artifact regenerated
npm run test:e2e -- tests/e2e/model-registrations.spec.ts
# 최종 2/2 PASS, headed Chrome
npm run test:secret
# PASS, owned app source / public / dist/client; matched values 출력 없음
```

TDD에서 계약/메서드 미구현 실패, 저장 optional undefined 거부, 완료 응답의 잠금 순간 유실, secret과 필드명이 같을 때 마스킹으로 구조 손상, 빈 tool_calls 호환성 실패를 실제 재현한 뒤 관련 검사가 통과했다. 기존 출력 한도·공급사 전송 gate 테스트를 유지했다. 실패 원인을 확인한 범위만 수정했다.

빌드는 번들 500 kB 초과 및 기존 정적/동적 import의 chunk 경고가 있었다. 번들 분할·성능 최적화는 이 변경에서 검사하지 않았다.

별도 headed Chrome에서 실제 렌더링한 상태:

- 1440×900 한국어: STT 폼/미리보기, 등록·키 저장, 실제 WAV 검사, multipart 요청 구성, 성공 결과·암호화 저장, OpenRouter LLM 요청·성공/HTTP 200 오류, 새로고침 복원, 잠금 후 민감 DOM 제거.
- 360×800 영어: STT/LLM 폼, 키보드 탭 전환, 로컬 주소·인증 없음, 직접 입력한 긴 모델 ID·미리보기·저장 목록. 문서 가로 넘침 검사 통과.
- 모든 제공사 HTTPS 요청은 가로챈 합성 응답이다. 실제 인증 성공·음성 인식 품질의 증거가 아니다. 합성 secret·등록명·STT 결과가 IndexedDB envelope 평문에 없는 것을 확인했다.

저장한 PNG를 직접 열어 레이아웃·글꼴·팔레트·줄바꿈·성공/실패·잠금 상태를 확인했다:

[데스크톱 STT 폼](../evidence/2026-10-15-model-registration/1440-ko-stt-form.png), [요청 미리보기](../evidence/2026-10-15-model-registration/1440-ko-stt-preview.png), [STT 결과](../evidence/2026-10-15-model-registration/1440-ko-stt-result.png), [LLM 결과](../evidence/2026-10-15-model-registration/1440-ko-llm-result.png), [실패](../evidence/2026-10-15-model-registration/1440-ko-llm-failed.png), [잠금](../evidence/2026-10-15-model-registration/1440-ko-locked.png), [모바일 LLM 폼](../evidence/2026-10-15-model-registration/360-en-llm-form.png), [모바일 미리보기](../evidence/2026-10-15-model-registration/360-en-llm-preview.png), [모바일 목록](../evidence/2026-10-15-model-registration/360-en-llm-list.png), [모바일 STT 폼](../evidence/2026-10-15-model-registration/360-en-stt-form.png).

## 정확한 변경 파일

- `src/react-app/providers/model-registrations.ts`, `registration-test.ts`: 신규 계약·검증·요청·전송/응답 처리.
- `src/react-app/domain/pipeline.ts`: 기존 paid gate의 provider 식별자를 origin 문자열에도 사용할 수 있게 타입만 확장.
- `src/react-app/vault/store.ts`, `session.ts`: 등록 catalog·원자적 키 버전·완료 결과 저장/잠금.
- `src/react-app/App.tsx`, `controller.tsx`: 등록 UI 계약·IO·복원·잠금·결과 저장 재시도.
- `src/react-app/ui/components/ModelRegistrations.tsx` 신규, `ui/screens/Settings.tsx`, `ui/styles.css`: 목록·폼·미리보기·테스트 화면.
- `tests/model-registrations.spec.ts`, `registration-test.spec.ts`, `vault-model-registrations.spec.ts`, `model-registrations-ui.spec.tsx`, `model-registrations-controller.spec.tsx`, `e2e/model-registrations.spec.ts`: 신규 관련 검사.
- `tsconfig.tests.json`: Vite client test 타입.
- 이 검증 문서, 승인된 계획·설계 문서, 위 PNG 10개.

## 보존과 미검증 범위

기본 작업 폴더의 기존 사용자 수정 7개는 작업 전 SHA-256과 **7/7 동일**하다. design-reference 원본 6개는 기준 Git blob과 **6/6 동일**하다. Git whitespace와 새 문서 상대 링크를 검사한다. main에 병합·push·배포하지 않는다.

실제 사용자 보관함/키, 인증된 OpenAI/OpenRouter/vLLM 추론, 실제 브라우저의 제공사 CORS·로컬 접근 권한, 전사/회의록 품질, 장시간 음성·전체 제품·운영 배포는 확인하지 않았다. 회의 실행 연결, 범용 템플릿 편집, 가져오기/내보내기, 자동 모델 목록 조회/재시도는 승인된 첫 범위에서 제외했다.

## 2026-10-15 main 통합·출시 준비

사용자가 저장소 정리·브랜치 통합·커밋·푸시를 명시적으로 요청했다. 기존 삭제 확인 변경 7개는 `9a32b1c`에 보존했고, 모델 등록 브랜치를 `22f1819`에서 main에 충돌 없이 병합했다. 초기 미추적 계획/설계 초안 2개는 임시 백업 후 승인·구현된 브랜치의 문서로 정리했다. 이전 단계의 병합/푸시 보류 기록은 당시 상태다.

통합 뒤 제품 코드를 바꾸지 않고 다음 관련 검사를 실행했다. 앞선 동일 코드의 다른 단위 검사 증거는 재사용했다.

| 명령 | 실제 결과 |
| --- | --- |
| `npm run test:unit -- tests/vault-reset-ui.spec.tsx tests/storage-management.spec.ts -t 'explicit passwordless reset UI\|case-insensitive typed vault reset'` | 14 PASS, 범위 밖 24 필터 제외 |
| `npm run test:unit -- tests/model-registrations-ui.spec.tsx tests/model-registrations-controller.spec.tsx` | 7 PASS |
| `npx tsc -p tsconfig.e2e.json --noEmit` | PASS |
| `npm run build` | PASS, 병합된 client `index-BIfVQzc_.js`; 기존 chunk 경고 유지 |
| `npm run test:e2e -- tests/e2e/model-registrations.spec.ts tests/e2e/vault-reset.spec.ts` | headed Chrome 6/6 PASS |
| `npm run test:secret` | PASS |
| `npm run test:unit -- tests/endpoint-limits.spec.ts tests/endpoint-presets-controller.spec.ts tests/model-first-use-ui.spec.tsx tests/model-selection-controller.spec.tsx tests/model-discovery.spec.ts tests/model-recommendations.spec.ts` | 이전 미푸시 모델 선택·출력 예산 커밋의 관련 159 PASS |
| `npm run test:e2e -- tests/e2e/endpoint-limits.spec.ts tests/e2e/model-first-use.spec.ts` | 출력 예산 5 PASS. 초기 모델 선택 3개는 이전 공개 메타데이터 조회 횟수 기대값에서 실패 |
| `npm run test:e2e -- tests/e2e/model-first-use.spec.ts` | 공개 메타데이터 준비의 정확한 URL 순서로 기대값을 고친 뒤 3/3 PASS. 유료/인증 요청 차단 유지 |

출시 헤더 점검에서 `public/_headers`가 기존 두 제공사만 허용해 사용자 지정 API 호출을 차단하는 누락을 확인했다. `npm run test:e2e -- tests/e2e/model-registrations.spec.ts -g 'shipped CSP'`는 실제 배포 CSP가 적용된 Chrome에서 사용자 지정 HTTPS 호출 실패를 재현했다. 제공사 요청은 전부 가로챈 합성 fixture이며 사용자 키나 로컬 모델에 접근하지 않았다.

검토 가능한 수정안은 `connect-src 'self' https: http://localhost:* http://127.0.0.1:*`이다. script/worker/object/frame 등 다른 정책은 유지하며, 앱의 주소 검증·origin별 key 결합도 유지한다. [CSP 표준](https://www.w3.org/TR/CSP/)은 리터럴 IPv6 host source를 지원하지 않아 `[::1]`에는 localhost 안내가 필요하다. 자동 승인 검토가 모든 HTTPS로의 네트워크 허용 범위 확대를 거부했고 사용자에게 정확한 정책의 명시적 승인을 요청했다. 이 기록 시점에 정책 변경·원격 푸시·배포는 실행하지 않았다. 새 CSP 회귀 검사는 수정안 승인·적용 후 다시 실행해야 한다.

## 2026-10-15 CSP 승인 후 최종 검증

사용자가 정확한 `connect-src 'self' https: http://localhost:* http://127.0.0.1:*` 확장과 검증 후 main 푸시를 명시적으로 승인했다. 앞선 자동 승인 거절은 이 사용자 결정으로 해소됐으며 해당 값만 `public/_headers`에 적용했다. HTTP `[::1]` 등록은 기존 암호화 데이터 호환성을 위해 읽고 보존할 수 있지만 호출을 차단하고 localhost 변경·저장 및 origin 변경 후 키 재연결을 안내한다. 주소나 키를 자동으로 바꾸지 않는다.

| 최종 변경 검사 | 실제 결과 |
| --- | --- |
| `npm run test:unit -- tests/model-registrations-ui.spec.tsx tests/registration-test.spec.ts tests/model-registrations-controller.spec.tsx` | 27/27 PASS. IPv6 안내와 secret 조회/전송 전 거부를 RED→GREEN으로 확인 |
| `npx tsc -p tsconfig.e2e.json --noEmit` | PASS |
| `npm run build` | PASS, client `index-BAjHiwXH.js`; 기존 chunk 경고 유지 |
| `npm run test:e2e -- tests/e2e/model-registrations.spec.ts` | headed Chrome 3/3 PASS. 기존 두 UI 흐름과 실제 CSP를 적용한 사용자 지정 HTTPS·127.0.0.1·localhost 요청 성공, 외부 HTTP 등록 차단 |
| `npm run test:secret` | PASS |
| `git diff --check` | PASS |

최종 변경 파일은 `public/_headers`, `src/react-app/providers/registration-test.ts`, `src/react-app/ui/components/ModelRegistrations.tsx`, 해당 두 단위 검사, `tests/e2e/model-registrations.spec.ts` 및 이 승인·검증 기록이다. 기존 보안 지시문·cookie/redirect 차단·origin별 credential 결합을 유지한다. 다른 기능의 동일 코드 통과 증거는 반복하지 않았다. 브라우저의 실제 로컬 접근 권한과 모델 서버의 CORS·인증 추론은 합성 요청 성공으로 검증됐다고 보지 않는다.

운영 반영은 이후 GitHub의 현재 main 확인, Cloudflare build 결과, 실제 root/CSP/JS/CSS의 로컬 검증 산출물 일치, 운영 원점의 별도 합성 보관함 등록·저장·요청·복원·잠금 smoke로 확인한다. 그 결과의 로컬 receipt는 `.superpowers/release-model-registration-2026-10-15/`에 보존한다. 실제 사용자 보관함·키·유료 AI는 사용하지 않는다.

운영 smoke에 사용할 desktop 검사에서 앱과 같은 origin의 HTTPS 자산은 통과시키고 제공사 요청만 fixture로 처리하도록 정리했다. 이후 `npx tsc -p tsconfig.e2e.json --noEmit`와 `npm run test:e2e -- tests/e2e/model-registrations.spec.ts -g 'desktop Korean'`가 통과했다. IPv6 안내를 실제 화면에 표시한 `npm run test:e2e -- tests/e2e/model-registrations.spec.ts -g 'shipped CSP'`도 1/1 PASS다. [1440×900 한국어 localhost 안내](../evidence/2026-10-15-model-registration/1440-ko-ipv6-localhost-guidance.png)를 직접 확인했다. 원본 reference 6개와 변경 문서의 상대 링크도 보존·유효함을 확인했다.
