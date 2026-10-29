# OpenRouter 모델 옵션 확인 — 2026-10-29

2026-10-29 공개 [OpenRouter 모델 카탈로그](https://openrouter.ai/api/v1/models), 모델별 페이지와 [STT 가이드](https://openrouter.ai/docs/guides/overview/multimodal/stt), [추론 가이드](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens), [제공사 라우팅 가이드](https://openrouter.ai/docs/guides/routing/provider-selection)를 확인했다. 카탈로그는 확인 시점의 스냅샷이며 각 경로의 지원, 가용성, 정책과 가격은 바뀔 수 있다. 모델 등록 프리셋 변경은 기존 저장 모델·기본값·키·결과를 자동 수정하지 않는다.

## 정리 모델 7개

`reasoning.effort`의 모델별 범위와 기본값은 카탈로그의 `reasoning.supported_efforts`, `mandatory`, `default_effort`를 옮긴 것이다. 아래 기본값은 제공사/카탈로그 기본값이고 새 앱 프리셋은 일곱 모델 모두 `low`를 명시한다. `none`은 지원 목록에 있을 때만 선택할 수 있다. 정리 화면의 이번 실행 강도는 모델 기본값과 별도로 선택·메모별 저장하고 실제 요청 설정에 기록한다. 변경만으로 기존 결과를 자동 재생성하지 않는다. 모델을 바꿔 선택값이 지원되지 않으면 값을 보존하면서 다시 선택하도록 안내한다.

가격은 카탈로그의 공개 대표 입력/출력 USD per 1M tokens이며, 공급사·경로·할인·캐시·가격 구간에 따라 실제 청구와 다를 수 있다. 표의 맥락과 출력은 카탈로그 값으로, 실제 경로 선택 시 더 작은 한도가 적용될 수 있다.

| 모델 및 공식 예제 | 강도 목록 | 필수 / 카탈로그 기본 | 맥락 / 최대 출력 | 대표 입력 / 출력 |
|---|---|---|---|---|
| [GPT-6.1 Sol](https://openrouter.ai/openai/gpt-6.1-sol) | low, medium, high, xhigh, max | 필수 / medium | 1,050,000 / 128,000 | $2 / $10 |
| [GPT-6.1 Terra](https://openrouter.ai/openai/gpt-6.1-terra) | none, low, medium, high, xhigh, max | 선택 / medium | 1,050,000 / 128,000 | $1 / $5 |
| [GPT-6 Luna](https://openrouter.ai/openai/gpt-6-luna) | none, low, medium, high, xhigh, max | 선택 / medium | 1,050,000 / 128,000 | $0.10 / $0.50 |
| [DeepSeek V4.1 Flash](https://openrouter.ai/deepseek/deepseek-v4.1-flash) | none, low, high, max | 선택 / high | 1,048,576 / 943,718 | $0.045 / $0.50 |
| [GLM 5.3 Flash](https://openrouter.ai/z-ai/glm-5.3-flash) | low, high, max | 필수 / max | 1,048,576 / 131,072 | $0.0457 / $0.0771 |
| [Muse Spark 1.3 Contributor](https://openrouter.ai/meta/muse-spark-1.3-contributor) | minimal, low, medium, high, xhigh, max | 필수 / medium | 1,048,576 / 943,718 | $0.10 / $0.20 |
| [Claude Haiku 5.5](https://openrouter.ai/anthropic/claude-haiku-5.5) | none, low, medium, high, xhigh, max | 선택 / medium | 1,000,000 / 128,000 | $0.10 / $0.50 |

카탈로그의 Sol·Terra·Luna 가격에는 입력 272,000 토큰 기준 추가 요율이 있고 Haiku에는 100,000 토큰 기준 추가 요율이 있다. 가격 구간의 정확한 경계와 적용 대상은 선택된 제공사의 현재 요율을 확인해야 한다. 이 숫자를 요청의 실측 비용으로 기록하지 않는다. 모델별 전체 `supported_parameters` 스냅샷은 `src/react-app/providers/openrouter-llm-options.ts`에 있으며 카탈로그의 합집합은 모든 엔드포인트의 지원을 보장하지 않는다.

OpenRouter 공통 추론 객체는 `reasoning.effort` 또는 `reasoning.max_tokens` 중 하나를 사용하고 `enabled`/`exclude`를 별도로 표현한다. 앱이 모르는 JSON을 자동 삭제하지 않으며, 알려진 미지원 값과 충돌은 실행 전 표시한다. [라우팅 문서](https://openrouter.ai/docs/guides/routing/provider-selection#requiring-providers-to-support-all-parameters)의 `provider.require_parameters: true`는 요청 옵션을 지원하는 제공사로 제한해 무시될 가능성을 줄이지만, 조건을 충족하는 경로가 없어 요청이 실패할 수 있다. 제공사별 매핑과 요청 수락·실제 적용 여부는 인증된 실행으로 검증하지 않았다.

## 전사 모델 13개

| 모델 및 공식 예제 | 확인한 제공사 전용 옵션 또는 확인 범위 |
|---|---|
| [MAI-Transcribe 2](https://openrouter.ai/microsoft/mai-transcribe-2) | Azure `diarization`, `phraseList.phrases`, `enhancedMode.modelOptions.transcribeStyle`; 예제의 `verbose_json`과 단어 시간 정보 |
| [Scribe v2](https://openrouter.ai/elevenlabs/scribe-v2) | ElevenLabs 아래 여섯 필드 |
| [Scribe v2 Medical](https://openrouter.ai/elevenlabs/scribe-v2-medical) | ElevenLabs 아래 여섯 필드; Medical에서 `no_verbatim: true`는 사용 불가 |
| [Whisper large v3 turbo](https://openrouter.ai/openai/whisper-large-v3-turbo) | Groq `prompt`; 추가 제공사별 옵션은 확인하지 않음 |
| [Whisper Large V3](https://openrouter.ai/openai/whisper-large-v3) | Groq `prompt`; 추가 제공사별 옵션은 확인하지 않음 |
| [GPT Transcribe](https://openrouter.ai/openai/gpt-transcribe) | OpenRouter 공통 전사 요청; 추가 제공사 전용 옵션 미확인 |
| [Qwen3 ASR 1.7B](https://openrouter.ai/qwen/qwen3-asr-1.7b) | 공통 전사 요청; 추가 제공사 전용 옵션 미확인 |
| [Qwen3 ASR 0.6B](https://openrouter.ai/qwen/qwen3-asr-0.6b) | 공통 전사 요청; 추가 제공사 전용 옵션 미확인 |
| [Voxtral Mini Transcribe](https://openrouter.ai/mistralai/voxtral-mini-transcribe) | 공통 전사 요청; 추가 제공사 전용 옵션 미확인 |
| [Voxtral Mini 3B 2507](https://openrouter.ai/mistralai/voxtral-mini-3b-2507) | 공통 전사 요청; 추가 제공사 전용 옵션 미확인 |
| [Voxtral Small 24B 2507 STT](https://openrouter.ai/mistralai/voxtral-small-24b-2507-stt) | 공통 전사 요청; 추가 제공사 전용 옵션 미확인 |
| [Parakeet TDT 0.6B v3](https://openrouter.ai/nvidia/parakeet-tdt-0.6b-v3) | 공통 전사 요청; 추가 제공사 전용 옵션 미확인 |
| [Nemotron 3.5 ASR Streaming Multilingual 0.6B](https://openrouter.ai/nvidia/nemotron-3.5-asr-streaming-multilingual-0.6b) | 공통 전사 요청; 추가 제공사 전용 옵션 미확인 |

[ElevenLabs의 OpenRouter 발표](https://openrouter.ai/blog/announcements/elevenlabs-on-openrouter/)가 STT용으로 명시한 `provider.options.elevenlabs` 필드는 **`diarize`, `num_speakers`, `diarization_threshold`, `tag_audio_events`, `no_verbatim`, `seed` 여섯 개**다. `num_speakers`와 `diarization_threshold`는 `diarize: true`가 필요하며 둘을 동시에 지정할 수 없다. `keyterms`는 이 OpenRouter 지원 목록에 없으며 지원한다고 가정하지 않는다.

Azure·Groq·ElevenLabs 옵션은 해당 제공사가 요청을 처리할 때만 적용된다. 알려지지 않은 공급사 전용 JSON은 앱이 임의로 삭제하지 않지만, OpenRouter나 제공사는 미지원 필드를 무시할 수 있다. JSON이 보존되거나 요청이 성공한 것만으로 옵션이 적용됐다고 판단할 수 없다. 음성 파일, 언어 힌트, 타임스탬프와 모든 13개 경로의 실제 전사 품질·CORS·인증 호출은 이 자료 조사로 검증하지 않았다.

[MAI-Transcribe 1.5](https://openrouter.ai/microsoft/mai-transcribe-1.5)는 OpenRouter가 2026-12-22 종료 예정으로 표시해 신규 프리셋에서 제외했다. 이미 저장된 등록은 유지한다. 전사 프리셋의 16,000,000 bytes와 900초는 앱의 보수적 설정값이며 모든 제공사가 보장하는 업로드 한도가 아니다.

## 구현 범위

- 관리자에는 모델별 **기본 추론 강도**, 메모 정리에는 **이번 실행의 추론 강도**를 표시한다. 미설정은 모델 기본값을 사용한다. 직접 OpenAI는 `reasoning_effort`, OpenRouter는 `reasoning.effort`로 전송하며 동의 입력 서명, 단일/비교 요청, 처리 의도와 최종 결과의 모델 스냅샷에 적용된다. 설정만 저장해도 STT나 정리를 재실행하지 않는다.
- 공용 실행기를 직접 호출해도 실행별 추론 강도를 반영한다. 지원되지 않는 강도, 필수 추론 해제, OpenAI의 추론·sampling 충돌과 알려진 OpenRouter 미지원 매개변수는 키 접근·전송 전에 차단한다. 미지원 sampling 저장값은 유지하고 사용자의 명시적 제거 버튼을 제공한다.
- 고급 설정에는 지원되는 sampling·penalty·seed·logprobs·verbosity와 추론 예산/응답 제외를 표시한다. `stop`, `logit_bias` 등은 JSON으로 입력할 수 있다. `model`, `messages`, 출력 토큰 한도, `response_format`, `stream`은 앱이 관리한다. 이 작업의 출력은 Markdown 정리이며 도구 실행과 구조화 출력 흐름은 제공하지 않는다. 해당 요청값은 삭제하지 않고 실행 전에 차단한다.
- OpenRouter Anthropic의 `reasoning.max_tokens`는 정리 출력 한도보다 작아야 한다. 실행별 effort를 선택하면 그 요청에서만 기본 추론 예산을 대체한다. 기본 모델 설정은 유지한다.
- STT 공통 옵션은 언어 1개/자동 감지, temperature, json/verbose_json, segment/word/둘 다다. 모델별 응답 제약을 검사한다. Azure는 화자 분리/최대 화자/기본 용어/전사 스타일, Groq는 명시적으로 켠 prompt 용어·맥락 주입, ElevenLabs는 공식 허용 옵션 입력을 제공한다. 저장한 Groq prompt·Azure phraseList는 메모 별도 입력이 없으면 보존하고, 메모에서 명시적으로 비우면 비운다. Groq 기본 맥락도 전송 전 확인과 편집에 표시한다.
- STT 요청은 데이터 정책과 `provider.options`만 사용한다. 공급사 고정은 제공하지 않는다. 채팅에는 `provider.require_parameters: true`를 앱 관리 값으로 보내고 기존 데이터 수집 거부/ZDR/자동 fallback 금지 조건을 유지한다. 정책을 자동 완화하지 않는다.
- 입력과 스냅샷은 기존 암호화 저장 경로를 사용한다. 키·기본 모델·이전 결과를 자동 변경하거나 외부 전송하지 않았다.

## 검증 상태

기존 변경과 이번 변경이 섞인 작업 트리에서 영향 범위 검사만 실행했다. 전체 테스트 모음은 실행하지 않았다. 수치는 아래 명령별 결과이며 겹치는 테스트를 합산하지 않는다.

| 검사 명령 | 결과 및 범위 |
|---|---|
| `npx vitest run tests/openai-models.spec.ts tests/model-registrations-ui.spec.tsx tests/stt-input-settings.spec.ts tests/gpt-transcribe-stream.spec.ts tests/registration-test.spec.ts` | OpenRouter 변경 전 OpenAI 기준 5파일 60개 통과 |
| `npx vitest run tests/openrouter-llm-options.spec.ts tests/openrouter-stt-options.spec.ts tests/model-registrations.spec.ts tests/model-registrations-ui.spec.tsx tests/registered-runtime.spec.ts tests/registration-test.spec.ts tests/minutes-reasoning.spec.ts tests/registered-comparison.spec.ts tests/comparison.spec.ts tests/minutes-budget.spec.ts tests/registered-stage-ui.spec.tsx tests/stt-input-settings.spec.ts` | 12파일 157개 통과. 뒤의 실행기·UI 보완은 다음 재검사로 확인 |
| `npx vitest run tests/openai-models.spec.ts tests/gpt-transcribe-stream.spec.ts tests/minutes-reasoning.spec.ts tests/minutes-budget.spec.ts tests/registered-runtime.spec.ts tests/model-registrations-controller.spec.tsx tests/vault-model-registrations.spec.ts tests/registered-comparison.spec.ts` | 8파일 71개 통과. 설정 컨트롤러와 암호화 등록 보존 포함 |
| `npx vitest run tests/minutes-reasoning.spec.ts tests/minutes-budget.spec.ts tests/registered-runtime.spec.ts tests/registered-comparison.spec.ts tests/comparison.spec.ts` | 최종 추론·sampling 조합 보완 후 5파일 41개 통과 |
| `npx vitest run tests/model-registrations-ui.spec.tsx` | 최종 옵션 편집 보완 후 22개 통과 |
| `npx vitest run tests/ui.spec.tsx -t 'saves a memo reasoning choice without generating and preserves an unsupported choice until replaced'` | 이번 메모별 설정 1개 통과, 101개 제외 |
| 변경한 source/test 파일만 지정한 `npx eslint ...` | 통과. 새 테스트의 any/미사용 변수 지적 수정 후 해당 파일 재검사 통과 |
| `npm run build` | 타입 검사·Vite 빌드 통과. 기존 큰 클라이언트 chunk 경고 유지 |
| `npm run test:secret` | 앱 소스·정적 파일·최종 클라이언트 빌드 검사 통과 |
| `git diff --check` | 통과 |
| 레퍼런스 원본 SHA-256 비교 | 원본 6개 모두 일치 |

합성 데이터만 사용하는 임시 페이지에서 실제 App/설정/STT/Minutes 컴포넌트를 별도 Chrome 창으로 렌더링했다. 사용자 보관함·키를 열거나 수정하지 않았고 전송 콜백도 연결하지 않았다. 1610×1124에서 GLM 기본 high·top_k JSON 동기화와 명시적 저장, Scribe 화자 수·임계값 충돌 차단/해제, 메모별 max 선택 후 미생성 결과를 확인했다. 360×800에서 Groq prompt opt-in과 맥락 입력, 가로 넘침 없음(문서 345px, dialog 307px)을 확인했다. 임시 파일과 탭은 제거하고 뷰포트를 복원했다.

- [LLM 고급 설정](llm-advanced.jpg)
- [STT 옵션 입력 상태](stt-validation.jpg)
- [메모별 추론 선택](per-memo-reasoning.jpg)
- [360px Groq 옵션](groq-mobile.jpg)

알려진 기존 `stt-rerun-controller`의 선택 전사 UUID 불일치 실패는 이전 기록에서 HEAD 3720e02 기준으로 재현됐다. 이번 선택한 검사에서는 해당 기존 실패를 다시 실행하지 않았으며 해결됐다고 주장하지 않는다. [앞선 제한 기록](../2026-10-29-openai-file-options/README.md)을 참고한다.

실제 키나 회의 데이터를 사용한 요청, 20개 모델 전체의 인증 추론·CORS·비용·전사 품질·제공사별 옵션 적용은 확인하지 않았다. 공식 예제가 없는 전용 옵션을 완전 지원한다고 표시하지 않는다. 외부 문서 링크 일괄 검사는 로컬 DNS 실패로 완료하지 못했으며, 웹 도구로 확인한 공식 문서와 카탈로그 근거를 위에 구분해 기록했다. 로컬 문서 링크는 별도 검사했다. 커밋·푸시·배포는 실행하지 않았다.
