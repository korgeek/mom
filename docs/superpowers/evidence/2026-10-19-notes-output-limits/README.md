# 2026-10-19 정리 기본 분량과 모델 출력 상한 분리

사용자가 4K만 활성화되는 이유를 확인한 뒤 분량 기본값과 모델 출력 상한을 분리하도록 승인했다. 기존 등록 설정과 메모별 선택값, 전사·수정본·정리 결과는 보존한다. 새 의존성·보관함 스키마·자동 AI 호출은 추가하지 않는다.

## 변경

- `providers/model-registrations.ts`: 4K 이하의 기본 요청 예산을 한 곳에서 계산한다. 모델 테스트와 요청 미리보기는 이 기본값을 사용하고, 실제 생성은 검증한 메모별 예산을 명시 전달한다. 설정·카탈로그 상한과 양의 정수 검증은 유지한다.
- `providers/model-profiles.ts`: 예시 모델의 최대 출력은 Luna/Haiku 128,000, DeepSeek/GLM/Muse 943,718로 갱신했다. 요청 기본값은 4,096을 유지한다. 이 값은 공개 모델 카탈로그 상한이며 개별 계정·실행 경로의 추론 성공 보장이 아니다. 보존된 더 낮은 경로 상한은 우선한다.
- `minutes/selection.ts`, `providers/registered-runtime.ts`, `minutes/compare.ts`: 단일 미리보기·요청·비교가 같은 기본 분량을 사용한다. 비교는 두 경로 중 더 낮은 상한을 따른다. 명시한 8K/16K/직접 입력을 임의로 4K로 줄이지 않는다.
- `ui/components/ModelRegistrations.tsx`: 필드를 `모델 최대 출력 토큰`으로 명확히 표시했다. 어댑터·모델 ID·엔드포인트가 일치하는 예시 모델은 `예시 모델 출력 한도 적용`으로 출력 한도만 수정한 뒤 저장한다. 이름·키 연결·작성 지침·나머지 매개변수는 유지한다. 기존 설정을 자동 덮어쓰지 않는다.
- `ui/screens/Minutes.tsx`: 분량 초안의 보관 키를 메모 ID로 고정했다. 8K → 16K → 직접 입력 8K를 저장할 때 예전 16K 초안이 재표시되던 문제를 고쳤다.

## 공개 한도 출처

2026-10-19에 [OpenAI GPT-6 Luna 문서](https://developers.openai.com/api/docs/models/gpt-6-luna)에서 최대 출력 128,000과 최대 입력 922,000을 확인했다. [OpenRouter 공개 모델 API](https://openrouter.ai/api/v1/models)의 정확한 모델 ID `top_provider.max_completion_tokens`를 키 없이 조회했다: `openai/gpt-6-luna`와 `anthropic/claude-haiku-5.5`는 128,000, `deepseek/deepseek-v4.1-flash`, `z-ai/glm-5.3-flash`, `meta/muse-spark-1.3-contributor`는 943,718이다. 실제 공급자 실행·과금·음성/정리 품질은 검사하지 않았다.

## 선별 검증

전체 스위트는 실행하지 않았다. 변경한 요청 예산과 직접 연결된 모델 등록·미리보기·비교·컨트롤러·설정 보존·UI만 선택했다.

```sh
npx vitest run tests/minutes-budget.spec.ts tests/model-registrations.spec.ts tests/model-registrations-ui.spec.tsx tests/registered-stage-ui.spec.tsx tests/registered-runtime.spec.ts tests/registered-selection.spec.ts tests/registered-comparison.spec.ts tests/unified-model-controller.spec.tsx tests/model-registration-migration.spec.ts
npx vitest run tests/registered-stage-ui.spec.tsx
npm run build
npx playwright test --config playwright.config.ts tests/e2e/notes-options.spec.ts
node scripts/check-public-artifacts.mjs
git diff --check
```

- 초기 회귀 검사는 상한을 기본 요청으로 쓰는 기존 동작과 예시 한도·UI에서 의도대로 실패했다. 별도 회귀 검사로 낮은 카탈로그 상한의 비교 및 과거 분량 초안 재표시도 재현했다.
- 9개 선별 파일의 최초 통합 실행은 111개 통과, 기존 STT 중복 모델명 선택자 1개 실패였다. 같은 파일의 선택자를 실제 보이는 모델명 확인으로 맞추고 초안 회귀 검사를 추가한 뒤 해당 파일 13개가 모두 통과했다. 변경 없는 8개 파일의 100개 통과 근거를 재사용해 중복 제외 113개 통과다.
- `npm run build` 통과. 기존 혼합 정적/동적 import와 500 kB 번들 경고는 남는다. 변경한 소스·검사 12개 파일의 지정 ESLint, 공개 산출물 검사, `git diff --check` 통과. 원본 디자인 레퍼런스 6개는 HEAD와 SHA-256이 일치한다.
- 격리된 별도 headed Chrome에서 1440×900, 360×800 한국어 화면을 확인했다. 기존 Luna의 4K 상한을 명시 갱신하고 암호화 저장·새로고침 후 128,000 유지, 기본 4K와 8K/16K 선택, 잘못된 직접 입력 차단, 8K 실제 요청 필드, 전송 재확인, 지침만 출력, 암호화 저장/복원을 확인했다. 합성 WAV·가로챈 localhost 응답만 사용했고 외부 유료 요청과 실제 자격증명은 사용하지 않았다. 모바일 완료 설정은 펼친 뒤 검사한다. Chrome pageerror 0개다.

## 화면

- [1440px 모델 최대 출력](1440-ko-model-ceiling.png), [360px 모델 최대 출력](360-ko-model-ceiling.png)
- [1440px 정리 설정](1440-ko-settings.png), [1440px 분량](1440-ko-budget.png), [360px 분량](360-ko-budget.png), [360px 저장 결과](360-ko-result.png)

운영 배포와 공개 원점 확인은 실제 결과를 얻은 뒤 별도 기록한다. 실제 제공사 인증 추론·계정 한도·최종 청구는 미검증이다.
