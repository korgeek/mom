# OpenAI 파일 전사와 LLM 옵션

## 확정 범위

2026-10-29 사용자는 OpenAI 문서에 맞춘 옵션 재구성과 Terra/Luna 선택을 요청했고, 후속 답변에서 종료 예정 모델과 Realtime을 이번 범위에서 제외했다. 새 OpenAI 등록 목록은 STT `gpt-transcribe`, LLM `gpt-6.1-terra`·`gpt-6-luna`로 정리했다. 기존 저장 모델·기본값·키·메모를 자동 교체하거나 삭제하지 않는다. 다른 제공사의 프리셋은 유지한다.

등록 순서는 종류 → API 종류 → 제공사별 프리셋이다. 신규 등록은 OpenAI로 시작하고 새 LLM 프리셋 기본은 Terra다. 기존 구형 모델용 지원 정의는 저장 데이터와 과거 결과를 읽기 위해 유지하며 신규 프리셋에는 노출하지 않는다.

## 파일 전사 매핑

| 항목 | 앱 설정·실제 요청 |
| --- | --- |
| 입력 언어 | 메모별 사용 언어 → `languages[]`; 단수 `language`와 함께 보내지 않음 |
| 용어·맥락 | 용어 → `keywords[]`, 맥락 → `prompt`; 각각 생략하거나 함께 사용 가능 |
| 응답 | JSON 또는 `stream=true` SSE 수신; 결과 표시는 완료 후 |
| 응답 형식 | GPT Transcribe는 JSON; 구형 형식·타임스탬프는 실행 전 호환 검사 |
| 기타 등록 값 | 기존 temperature 선택 필드, MP3/WAV 청크, 파일·시간 앱 한도 유지 |

SSE는 기존 한 번의 요청에서 크기를 제한해 수신하고 최종 `transcript.text.done`이 있어야 성공으로 처리한다. 원본 이벤트와 언어 응답을 기존 암호화 결과 저장 경로에 전달한다. 미완료 EOF·잘못된 이벤트·오류·취소는 성공으로 승격하지 않는다. 스트림 오류의 `error.message/code/type/param`과 실제 HTTP 상태도 보존하며 반사된 키는 마스킹한다. 모델 관리자 테스트와 실제 등록 전사 경로가 같은 파서를 사용한다. 중간 텍스트를 화면에 표시하는 Realtime 기능을 구현한 것은 아니다.

GPT Transcribe의 keyword 금지 문자와 언어코드 형식을 저장·전송 전에 검사한다. 지원 언어의 정확한 부분집합은 제공사가 검증한다. 용어 50개·각 100자·맥락 2,000자는 앱 자체 한도이며 공식 모델 한도라고 표시하지 않는다. 파일 전송은 25,000,000 bytes를 넘기지 않는다. 호환성이 확인되지 않은 자유 JSON 옵션은 현재 모델의 실행 경로에서 차단한다. 종료 예정 모델 전용 화자 분리·logprobs·자막·번역 옵션은 최신 프리셋에 추가하지 않았다.

## Terra/Luna와 reasoning

| 모델 | Standard 입력 / 1M tokens | Standard 출력 / 1M tokens | 새 프리셋 추론 |
| --- | --- | --- | --- |
| `gpt-6.1-terra` | USD 1 | USD 5 | `low` |
| `gpt-6-luna` | USD 0.1 | USD 0.5 | `low` |

모델 등록의 `추론 강도`에서 `none/low/medium/high/xhigh/max`를 선택한다. `low`는 회의록 초안의 비용·지연을 고려한 앱 시작값이고 품질 실험으로 검증한 최적값은 아니다. API 자체 기본값은 `medium`이며 기존에 effort를 생략한 등록은 `API 기본값 (medium)`으로 표시해 유지한다. 선택값과 `requestParameters.reasoning_effort` JSON은 양방향으로 연결되고 실제 요청에도 같은 값을 보낸다.

`none` 이외에서는 temperature·top_p 입력을 비활성화하고, 기존 충돌값을 지우지 않은 채 경고·저장·요청 차단으로 수정 필요성을 알린다. logprobs·top_logprobs 충돌도 실행 전에 검사한다. 명시적으로 none을 선택하면 기존 sampling 값을 수정할 수 있다.

공식 기준 단가는 표시용 메타데이터이며 실측 사용료로 기록하지 않는다. 요금 조건에는 272K 초과 입력 시 입력 2배·출력 1.5배와 추론 토큰의 출력 과금을 표시한다. 토큰 상한과 앱 기본 요청량 4K는 기존 계약을 유지한다.

2026-10-29 확인한 공식 근거:

- [파일 전사](https://developers.openai.com/api/docs/guides/speech-to-text)
- [Transcriptions API](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create)
- [GPT Transcribe](https://developers.openai.com/api/docs/models/gpt-transcribe)
- [Terra](https://developers.openai.com/api/docs/models/gpt-6.1-terra), [Luna](https://developers.openai.com/api/docs/models/gpt-6-luna)
- [Reasoning effort](https://developers.openai.com/api/docs/guides/reasoning#reasoning-effort), [공식 요금](https://developers.openai.com/api/docs/pricing)

## 검사 명령과 결과

변경한 프리셋·검증·요청/응답 매핑·UI와 직접 호출자·암호화 모델 저장만 대상으로 했다. 소스가 동일한 통과 검사는 재사용했고, 전체 저장소·전체 테스트·E2E는 실행하지 않았다.

```sh
npx vitest run tests/model-registrations-ui.spec.tsx tests/openai-models.spec.ts tests/stt-input-settings.spec.ts tests/stt-rerun-ui.spec.tsx tests/gpt-transcribe-stream.spec.ts tests/registered-runtime.spec.ts tests/registration-test.spec.ts tests/stt-rerun-controller.spec.tsx tests/model-registrations.spec.ts
# 최초 151 passed, 4 failed. 기존 partial retry 실패 1건 외 3건은 새 프리셋/low 기본값 기대값으로 갱신.
npx vitest run tests/api-keys-ui.spec.tsx tests/registered-stage-ui.spec.tsx tests/model-first-use-ui.spec.tsx
# 최초 37 passed, 1 failed. OpenAI 새 기본값에서 OpenRouter 키를 선택하던 fixture를 명시적 제공사 선택으로 수정.
npx vitest run tests/model-registrations.spec.ts tests/api-keys-ui.spec.tsx tests/vault-model-registrations.spec.ts tests/model-registrations-controller.spec.tsx
# 4 files, 73 passed.
npx vitest run tests/stt-input-settings.spec.ts tests/gpt-transcribe-stream.spec.ts tests/stt-rerun-ui.spec.tsx
# 3 files, 35 passed. 구조화된 SSE 오류·원본·취소·금지 입력 포함.
npx vitest run tests/registered-stage-ui.spec.tsx tests/model-registrations-ui.spec.tsx tests/openai-models.spec.ts
# 3 files, 37 passed. provider 필터·6단계·API 기본·JSON 동기화·저장·입력 검증 포함.
WRANGLER_LOG_PATH=/private/tmp/mom-openai-options-build.log npm run build
# 최종 tsc -b 및 Vite build 통과. 기존 미디어 import 혼용·큰 chunk 경고 유지.
npx eslint src/react-app/providers/openai-models.ts src/react-app/providers/model-profiles.ts src/react-app/providers/model-registrations.ts src/react-app/providers/registered-runtime.ts src/react-app/providers/registration-test.ts src/react-app/ui/components/ModelRegistrations.tsx src/react-app/ui/screens/STT.tsx tests/openai-models.spec.ts tests/gpt-transcribe-stream.spec.ts tests/model-registrations.spec.ts tests/model-registrations-ui.spec.tsx tests/stt-input-settings.spec.ts tests/registered-stage-ui.spec.tsx tests/api-keys-ui.spec.tsx tests/registration-test.spec.ts tests/stt-rerun-controller.spec.tsx
# 통과.
npm run test:secret
# 앱 소스·정적 자산·최종 클라이언트 산출물 검사 통과.
git diff --check
# 통과.
```

`preserves an initial partial selection on explicit failed-chunk retry and reloads exact frozen lineage`는 선택 전사 UUID 비교에서 계속 실패한다. 별도 `/private/tmp/mom-ui-baseline-3720e02`의 HEAD `3720e02` 사본에서 같은 검사만 실행해 1 failed / 22 skipped와 같은 181행 실패를 확인했다. 새 옵션의 통과 결과로 이 기존 실패를 대체하지 않는다.

```sh
# 위 baseline 디렉터리에서 실행
npx vitest run tests/stt-rerun-controller.spec.tsx -t 'preserves an initial partial selection on explicit failed-chunk retry and reloads exact frozen lineage'
```

## 실제 화면과 보존

별도 Chrome 1610×1124 합성 화면에서 OpenAI의 Terra/Luna 두 항목, STT GPT Transcribe 한 항목, 가격·low 초기값·6개 추론 선택지를 확인했다. high 선택 → JSON 반영 → 메모리 저장 → 수정 창 high 복원 및 스트리밍 선택 → 메모리 저장 → 스트리밍 복원을 확인했다. 실제 보관함이나 키는 읽거나 수정하지 않았다.

- [Terra 기본값](terra-default.jpg)
- [Luna 요금](luna-pricing.jpg)
- [STT 스트리밍 옵션](stt-stream-options.jpg)

임시 HTML/TSX와 탭은 제거했다. 레퍼런스 원본 6개의 SHA-256과 새 로컬 링크를 검사했다. 모바일·실제 OpenAI 인증/CORS·인식 품질·추론 품질·실측 요금·운영 배포는 검증하지 않았다. 앞선 작업 트리 변경은 그대로 보존했으며 커밋·푸시·배포는 하지 않았다.

## 변경 파일

- `src/react-app/providers/openai-models.ts`, `model-profiles.ts`, `model-registrations.ts`, `registered-runtime.ts`, `registration-test.ts`
- `src/react-app/ui/components/ModelRegistrations.tsx`, `src/react-app/ui/screens/STT.tsx`
- `tests/openai-models.spec.ts`, `gpt-transcribe-stream.spec.ts`, `model-registrations.spec.ts`, `model-registrations-ui.spec.tsx`, `api-keys-ui.spec.tsx`, `registered-stage-ui.spec.tsx`, `registration-test.spec.ts`, `stt-input-settings.spec.ts`, `stt-rerun-controller.spec.tsx`
- `docs/README.md`, 이 기록과 화면 3개

목록에서 파일명만 이어 쓴 항목은 해당 줄 첫 경로와 같은 디렉터리다.
