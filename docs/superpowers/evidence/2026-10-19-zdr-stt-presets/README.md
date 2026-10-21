# 2026-10-19 OpenRouter ZDR 전사 예시 템플릿

사용자는 Qwen 2개, Whisper 2개, ElevenLabs 2개, Microsoft 2개, Mistral 3개와 NVIDIA 모델로 예시를 변경하도록 요청했다. NVIDIA는 앞서 조사한 2개를 포함한다. OpenRouter 전사 예시는 총 13개다.

## 적용 범위

`src/react-app/providers/model-profiles.ts`의 예시 목록을 갱신했다. 기존 요청 조립·등록 UI를 그대로 사용하며, `tests/model-registrations.spec.ts`와 `tests/model-registrations-ui.spec.tsx`의 직접 관련 검증을 갱신했다. 최상위 README에 현재 목록과 이 기록을 연결했다.

| 계열 | 모델 ID |
| --- | --- |
| Qwen | `qwen/qwen3-asr-1.7b`, `qwen/qwen3-asr-0.6b` |
| Whisper | `openai/whisper-large-v3`, `openai/whisper-large-v3-turbo` |
| ElevenLabs | `elevenlabs/scribe-v2`, `elevenlabs/scribe-v2-medical` |
| Microsoft | `microsoft/mai-transcribe-2`, `microsoft/mai-transcribe-1.5` |
| Mistral | `mistralai/voxtral-mini-transcribe`, `mistralai/voxtral-mini-3b-2507`, `mistralai/voxtral-small-24b-2507-stt` |
| NVIDIA | `nvidia/parakeet-tdt-0.6b-v3`, `nvidia/nemotron-3.5-asr-streaming-multilingual-0.6b` |

Grok STT 1.0, OpenRouter Whisper 1, Gemini 3.5 Transcribe는 예시에서 제거했다. 저장된 등록·키·기본 모델·전사 결과를 변경하거나 삭제하는 마이그레이션은 없다. 직접 OpenAI STT와 로컬 호환 API 예시는 유지한다. MAI-Transcribe 2의 기존 Azure 옵션과 단어 타임스탬프를 유지하고, 나머지 새 예시는 기존 보수적 JSON/타임스탬프 없음 구성을 사용한다. 16,000,000-byte/900-second 설정은 앱의 보수적 상한이며 각 제공사의 보장으로 해석하지 않는다.

모든 OpenRouter 예시는 `requireZdr:true`를 유지한다. 실제 요청의 정책은 연결한 API 자격 증명에서 상속되며 예시 변경으로 정책을 완화하지 않는다.

## 공개 정보 근거

2026-10-19T09:59Z에 인증 헤더 없이 [공개 전사 모델 목록](https://openrouter.ai/api/v1/models?output_modalities=transcription)과 [ZDR 전사 모델 목록](https://openrouter.ai/api/v1/models?output_modalities=transcription&zdr=true)을 GET으로 조회했다. 전체 26개, ZDR 19개이며 다음 페이지가 없었다. 선택한 13개 ID의 중복 없음과 ZDR 목록 포함을 별도 Python assert로 확인했다. [공식 모델 API 문서](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties)는 `zdr=true`가 ZDR 엔드포인트가 있는 모델만 반환한다고 설명한다.

이는 공개 목록의 당시 상태다. 계정별 허용 제공사·추가 정책·브라우저 CORS·지원 언어·입력 형식·실제 추론 성공이나 품질을 증명하지 않는다. ZDR은 실행 엔드포인트 기준이며 변경될 수 있다. [공식 ZDR 설명](https://openrouter.ai/blog/insights/zero-data-retention/).

## 실행한 검증

전체 스위트는 실행하지 않았다. 변경한 예시의 소비자인 요청 조립과 모델 등록 화면, MAI 옵션·STT 입력 설정만 검사했다.

| 명령 | 결과 |
| --- | --- |
| `npm run test:unit -- tests/model-registrations.spec.ts tests/model-registrations-ui.spec.tsx` | 구현 전 새 템플릿 누락으로 9개 실패, 34개 통과를 확인했다. |
| `npm run test:unit -- tests/model-registrations.spec.ts tests/model-registrations-ui.spec.tsx tests/registered-runtime.spec.ts tests/stt-input-settings.spec.ts` | 구현 후 4개 파일, **69개 통과**. 13개 예시의 실제 요청 모델 ID·주소·음성 body·ZDR/수집 거부 정책, 기존 런타임과 MAI 옵션을 확인했다. |
| `npm run test:unit -- tests/model-registrations-ui.spec.tsx` | 테스트의 타입 오류 수정 후 **12개 재통과**. 위 69개 중 UI 파일만 다시 실행했다. |
| `npm run build` | 최종 종료 0. 최초에는 테스트의 지원하지 않는 `exact` 옵션 때문에 타입 검사가 실패했고, 해당 옵션을 제거한 뒤 통과했다. 기존 혼합 import·500 kB 초과 번들 경고가 남는다. |
| `npx eslint src/react-app/providers/model-profiles.ts tests/model-registrations.spec.ts tests/model-registrations-ui.spec.tsx` | 종료 0. |
| `node /private/tmp/mom-zdr-presets-smoke.mjs` | 최종 통과. 별도 Chrome 창, 실제 빌드 미리보기 `127.0.0.1:4176`, 격리된 합성 보관함. 최초 스크립트의 초기화 대기와 select 탐색을 수정한 후 13개 선택·필드 자동 입력·새 NVIDIA 등록의 암호화 저장·새로고침·잠금 해제·재열기를 확인했다. 1440×900과 390×844 렌더링, 가로 넘침 없음, 외부 요청 0, 페이지 오류 0. |
| `node scripts/check-public-artifacts.mjs` | 종료 0. 소유 앱 소스·정적 자산·클라이언트 빌드에서 금지 패턴 검출 없음. |
| `git diff --check` 및 Python 문서/참조 검사 | 종료 0. 새 증거 링크·브라우저 결과 JSON과 원본 레퍼런스 6개의 작업 전후 SHA-256 일치를 확인했다. |

실제 키·회의 자료·유료 전사는 사용하지 않았다. 다른 화면이나 모델별 음성 품질·인증 실행·운영 배포는 이 검증 범위에 포함하지 않는다.

- [브라우저 결과](browser-results.json)
- [데스크톱 새 모델](desktop-nemotron.png)
- [모바일 저장 모델 재열기](mobile-nemotron.png)

로컬 구현과 검증 기록이며 원격 push·배포는 실행하지 않았다.
