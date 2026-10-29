# 모델 상태 표시와 최신 OpenAI 프리셋

## 범위와 동작

2026-10-29 사용자는 관리자 모델 목록에서도 설정 전·비활성 상태의 색상과 구분, 테스트 전 및 테스트 결과 표시, 최신 모델 추가를 요청했다. 앞선 API 준비 상태·전사 입력 변경과 사용자의 저장 모델·기본값·키를 보존한다.

- 설정 상태와 테스트 상태를 서로 다른 배지로 항상 표시한다. `설정 전`은 주황, `활성`과 테스트 성공은 초록, 비활성·테스트 전은 회색, 테스트 실패는 빨강, 진행 중은 파랑이다. 색상과 함께 상태 문구를 표시한다.
- 키가 없고 사용도 중지한 모델은 `설정 전`과 `비활성`을 함께 표시한다. 미완료·결과 불명은 주황, 취소는 회색이다.
- 현재 설정의 서명과 다른 기록은 `이전 테스트 · 성공 (설정 변경)`처럼 표시하고 회색으로 둔다. 저장하지 못한 현재 테스트 결과에는 `(저장 전)`을 붙인다. 연결 확인 결과를 추론 성공으로 바꾸지 않는다.
- 상태 열을 104px로 늘리고 한국어 단어를 보존해 배지 문구의 한 글자 줄바꿈을 줄였다. 기존 Pretendard 글꼴, 테마 색상과 1100px 경계는 유지한다.

## 추가한 프리셋과 공식 근거

2026-10-29 공식 OpenAI 모델 문서와 OpenRouter 카탈로그·모델 페이지에서 모델 ID와 요청 지원을 확인했다. 새 프리셋은 등록 창에 추가하며, 기존 모델을 교체하거나 자동 등록·활성화·키 연결하지 않는다.

| 연결 | 프리셋 | 모델 ID | 추론 설정 |
| --- | --- | --- | --- |
| OpenAI | GPT-6.1 Sol | `gpt-6.1-sol` | `reasoning_effort: low` |
| OpenAI | GPT-6.1 Terra | `gpt-6.1-terra` | `reasoning_effort: none` |
| OpenRouter | GPT-6.1 Sol | `openai/gpt-6.1-sol` | `reasoning: {effort: low}` |
| OpenRouter | GPT-6.1 Terra | `openai/gpt-6.1-terra` | `reasoning: {effort: none}` |

Sol은 `none`을 지원하지 않아 `low`로 시작한다. Terra는 `none`을 지원한다. 요청 본문에 `temperature`·`top_p`를 추가하지 않는다. 현재 정리 구현이 사용하는 Chat Completions 경로를 유지하고, OpenAI에는 `max_completion_tokens`, OpenRouter에는 `max_tokens`를 보낸다. 기본 요청은 4,096 토큰이며, 모델 최대 출력은 128,000 토큰이다. 공개된 전체 컨텍스트는 1,050,000 토큰, 최대 입력은 922,000 토큰이다. 앱의 기존 사전 예산 필드에는 최대 입력인 922,000을 보수적으로 적용한다.

OpenRouter 프리셋은 기존의 ZDR 요구·데이터 수집 거부·fallback 금지 정책을 유지한다. 카탈로그 존재와 요청 생성 검사는 계정별 접근 가능 여부나 제공사의 실제 추론·보관 정책 이행 증거가 아니다.

- [OpenAI GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol)
- [OpenAI GPT-6.1 Terra](https://developers.openai.com/api/docs/models/gpt-6.1-terra)
- [OpenRouter GPT-6.1 Sol](https://openrouter.ai/openai/gpt-6.1-sol)
- [OpenRouter GPT-6.1 Terra 제공사](https://openrouter.ai/openai/gpt-6.1-terra/providers)
- [OpenRouter 모델 카탈로그](https://openrouter.ai/api/v1/models)

## 검증

범위는 모델 프리셋 생성·등록 요청 본문·등록 실행 경로와 관리자 UI다. 새 프리셋의 요청 검사에서 미등록 프리셋 오류를 먼저 확인한 뒤 추가했다. 키 없는 비활성 초기값, 모델 ID·추론·토큰 필드 매핑, 정책 유지, 테스트 배지의 현재/과거/저장 전 상태를 검사한다.

```sh
npx vitest run tests/model-registrations.spec.ts tests/model-registrations-ui.spec.tsx tests/registered-runtime.spec.ts
# 3 files, 72 passed.

WRANGLER_LOG_PATH=/private/tmp/mom-model-status-build.log npm run build
# tsc -b 및 Vite build 통과.
WRANGLER_LOG_PATH=/private/tmp/mom-model-status-build.log npx vite build
# 마지막 상태 열 CSS 보정 후 클라이언트 산출물 갱신 통과.

npx eslint src/react-app/providers/model-profiles.ts src/react-app/ui/components/ModelRegistrations.tsx tests/model-registrations.spec.ts tests/model-registrations-ui.spec.tsx
# 통과.
npm run test:secret
# 앱 소스·정적 자산·최종 클라이언트 산출물 검사 통과.
git diff --check
# 통과.
```

빌드에는 기존 미디어 모듈의 정적·동적 import 혼용 및 500kB 초과 chunk 경고가 남아 있다. 전체 저장소·전체 E2E는 실행하지 않았다. 앞선 넓은 UI 실행의 기존 실패 7개와 baseline 근거는 [이전 검증 기록](../2026-10-29-stt-input-readiness/README.md)에 있으며 이번 72개 검사 범위에 포함하지 않았다.

## 실제 브라우저 확인

별도 Chrome 로컬 창의 데스크톱에서 확인했다. 합성 상태 비교 화면은 1610×1124, 실제 보관함은 1610×1068이었다. 임시 합성 HTML/TSX와 탭은 검증 후 제거했으며 사용자 로컬 서버 `127.0.0.1:4185`는 계속 실행한다.

- [설정 전·비활성·테스트 전·성공·실패·설정 변경 배지](status-desktop.jpg): 실제 컴포넌트에 명시적으로 합성 데이터라고 표시한 메모리 상태를 제공했다. 실제 키나 추론 없이 색상·폰트·간격·줄바꿈을 확인했다.
- [실제 로컬 모델 관리](local-settings.jpg): 사용자가 제공한 테스트 보관함 암호로 잠금을 해제한 뒤 기존 두 모델의 `활성·테스트 전`을 확인했다. 암호와 키 값은 검증 산출물에 남기지 않았다.
- [최신 프리셋 선택](latest-presets.jpg): 새 모델 → LLM에서 OpenAI/OpenRouter Sol·Terra 네 항목이 표시됨을 접근성 트리로 확인했다. OpenAI Terra를 선택해 `gpt-6.1-terra`와 Chat Completions URL이 채워지는 것을 확인한 뒤 저장 없이 닫았다.

실제 API 연결 확인·모델 테스트·오디오 전송은 실행하지 않았다. 저장 모델·기본값·API 키를 수정하지 않았다. 모바일, 실제 모델 품질·지연·과금, 인증된 제공사 응답, 배포는 검증하지 않았다.

## 변경 파일과 보존

- `src/react-app/providers/model-profiles.ts`
- `src/react-app/ui/components/ModelRegistrations.tsx`
- `src/react-app/ui/styles.css`
- `tests/model-registrations.spec.ts`
- `tests/model-registrations-ui.spec.tsx`
- `docs/README.md`와 이 기록·화면 3개

변경 전후 디자인 원본 6개 파일의 SHA-256과 새 문서의 로컬 링크를 확인했다. 이전 작업부터 남아 있던 STT·정리 선택 UI, 전사 카드, 테스트, 문서 변경은 보존했다. 이번 변경은 로컬 작업 트리에 남기며 푸시·배포하지 않는다.
