# 모델 관리 통합 · 로컬 검증

날짜: 2026-10-17 · 기준 main `9383099` · 작업 브랜치 `codex/unified-model-management`.

사용자가 승인한 구현과 후속 키 분리 결정을 반영했다. 연결 설정을 모델 관리로 합치고 전사와 정리 모델을 독립적으로 선택한다. 아래 브라우저 응답은 합성 fixture이며 실제 OpenAI/OpenRouter/vLLM 추론 결과가 아니다.

## 변경

- 모델: API 종류, 전체 엔드포인트, 모델 ID, 선택 옵션, 키 참조. OpenAI/OpenRouter와 OpenAI 호환 서버를 두 단계 모두에서 사용한다. 실제 메모의 오디오는 기존 로컬 MP3 준비 경로를 사용한다.
- 키: 별도 이름·origin·암호화/세션 저장·버전. 같은 origin에서 재사용하며 로컬 무인증 서버는 키가 없다. 교체·저장 방식 변경은 연결 모델의 버전과 동의를 갱신한다. 연결 해제는 공유 키를 남기고 키 삭제는 모델을 남긴 채 참조만 해제한다.
- 공유: `mom-models` v1 JSON을 미리보기 후 비활성 모델로 가져온다. API 키·키 참조·테스트 입력/응답·신뢰할 수 없는 가격 관측값은 제외한다. 매개변수와 작성 템플릿은 포함되므로 공유 전 검토한다.
- 옵션: MAI/Scribe/Whisper 예시, STT 한도·응답·시간값과 `provider.options.azure`, LLM 한도·token 필드, 제한된 템플릿 변수를 지원한다. 앱 관리 필드·인증·보관 정책은 옵션 JSON으로 덮어쓸 수 없다.
- 실행: 등록 ID로 선택하고 요청 당시 URL·모델·옵션·키 버전을 고정한다. raw 응답·음성 시간축·전사 버전·정리·usage와 기존 체크포인트/잠금 경계를 유지한다. 저장·가져오기·기본값 변경은 네트워크 요청을 하지 않는다.
- 이전: 기존 등록/카탈로그 선택과 키를 원자적으로 이전한다. 세션 키를 영속화하지 않고 기존 음성·결과를 다시 쓰지 않는다. 과거 제공사 키 namespace는 보존하지만 새 실행은 명시적인 credential 참조로만 키를 해석한다. 키 항목 삭제는 해당 credential와 연결을 대상으로 하며 이전 버전 호환용 사본이나 별도로 등록한 동일 값까지 모두 지우는 기능은 아니다.

## 검증 범위와 명령

Node 24.19, 실제 Chrome 별도 테스트 창, preview origin `http://127.0.0.1:4174`. 실제 사용자 보관함/키와 분리된 임시 컨텍스트만 사용했다. 전체 테스트 모음은 실행하지 않고 변경과 직접 관련된 대상을 선택했다.

| 검사 | 명령 또는 대상 | 결과 |
| --- | --- | --- |
| 키·이전·저장 | `vitest run tests/api-credentials.spec.ts tests/model-registration-migration.spec.ts tests/vault-model-registrations.spec.ts tests/model-registrations.spec.ts tests/vault-model-registry.spec.ts` | 54 통과 |
| 실행·키 컨트롤러·프로필 | `vitest run tests/registered-runtime.spec.ts tests/api-credentials.spec.ts tests/unified-model-controller.spec.tsx` | 33 통과 |
| UI | `model-registrations-ui`, `ui`, `openrouter-stt-ui`, `registered-stage-ui`, `stt-rerun-ui` | 140개 관련 사례 통과 |
| 브라우저 | `playwright test --config playwright.config.ts tests/e2e/unified-model-management.spec.ts` | 13개 통과 + 후속 잠금 1개 통과 = 14개 고유 사례 |
| 빌드·타입 | `npm run build` | 통과 |
| 공개 비밀 검사 | `node scripts/check-public-artifacts.mjs` | 통과, 일치 값 출력 없음 |
| 정적 검사 | 변경 source/test 대상 ESLint, `git diff --check` | 통과; 기존 App Fast Refresh 경고 유지 |
| 원본 | 기존 SHA-256과 레퍼런스 6개 비교 | 변경 없음 |

브라우저 9조합은 각 단계의 세 adapter 조합을 선택→실제 WAV 파일 로컬 준비→전사→선택 전사로 정리→`.md` 다운로드→암호화 저장 검사→새로고침/잠금 해제로 검증했다. 공식 제공사 HTTPS는 명시적으로 가로챈 합성 응답이고 로컬 경로는 실제 loopback HTTP/CORS 서버의 합성 응답이다. 요청 URL·Authorization 유무·추가 STT 호출 없음과 plaintext sentinel 유출 없음을 확인했다.

공유 키 생성·두 모델 연결·교체·한 모델 해제·영구 삭제, JSON 내보내기의 비밀/참조 제외, CORS 거부 시 결과 불명 표시와 자동 fallback/재요청 없음, 360px KO/EN 접힌 고급 폼과 가로 넘침 없음을 확인했다. 브라우저에서 발견한 이전 OpenRouter 전역 키 검사 잔존 때문에 로컬 정리가 막히는 문제는 선택한 등록 모델의 준비 상태를 사용하도록 수정하고 회귀 검증했다.

마지막 공유 JSON 변경은 추가로 `registered-runtime`, `api-credentials`, `model-registrations-ui` 34개 검사를 통과했다. 키 저장 방식도 공유 파일에서 제외하고 이전 프로필의 해당 값은 가져올 때 암호화 기본값으로 처리한다.

## 렌더링 증거

직접 렌더링한 1440×900 한국어와 360×800 한국어/영어 화면을 확인했다. 기본 정보·선택 옵션의 접힘 상태와 긴 URL·모바일 폼의 가로 넘침을 확인했다.

- [모델 목록](models-desktop-ko.png), [두 모델이 공유하는 별도 키](shared-key-models-desktop-ko.png), [합성 정리 결과](notes-desktop-ko.png)
- [모바일 한국어](models-mobile-ko.png), [모바일 영어](models-mobile-en.png)

## 실제 추론과 남은 범위

실제 OpenRouter 테스트를 사용자가 선택했다. 실제 키는 도구·파일·채팅에서 읽지 않았고 로컬 앱에 직접 입력하도록 안내했다. 별도로 만든 비민감 영어 음성 7.04초 파일은 준비했지만, 실제 인증 요청·전사 정확도·생성 품질·과금 확인은 사용자 키 입력과 명시적 실행 후 기록해야 한다. OpenAI와 실제 vLLM 모델도 아직 추론하지 않았다.

로컬 지원은 해당 서버가 OpenAI 호환 전사/Chat Completions API와 MP3 입력을 제공할 때 적용된다. HTTP localhost/127.0.0.1 또는 HTTPS 범위이며 HTTP LAN·HTTP IPv6·새 인코더·모델 설치·프록시는 추가하지 않았다. 운영 origin의 CORS/로컬 접근 권한은 미검증이다. 기존 카탈로그·연결 화면을 전제로 한 과거 E2E 파일 전체를 이번 실행에 포함하지 않았으므로 전체 E2E 통과를 주장하지 않는다.

main 푸시·운영 배포는 수행하지 않았다. 현재 단계는 로컬 구현과 위 범위의 검증이다.

## API 참고

- [OpenRouter 공식 STT 문서 소스](https://github.com/OpenRouterTeam/docs/blob/main/guides/overview/multimodal/stt.mdx): 전사 엔드포인트와 제공사 옵션.
- [vLLM 공식 Speech to Text API](https://docs.vllm.ai/en/stable/serving/online_serving/speech_to_text/): 별도 모델 서버의 OpenAI 호환 전사 API.
