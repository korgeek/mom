# STT 설정 표준화와 요청 오류 상세

## 사용자 결정과 범위

2026-10-29 사용자는 실패한 `gpt-transcribe` 요청의 이유 확인, 처리 기록의 HTTP/제공사 오류 상세 보존, OpenAI 전사 문서에 따른 관리자 매핑 점검과 OpenRouter를 통한 공통 설정 정리를 요청했다. GPT-6.1 Terra 서브에이전트로 공식 계약 확인과 관리자/매핑 변경을 나눠 진행했다.

기존 등록 폼과 암호화된 프로젝트 저장을 재사용한다. 별도 서버, AI 프록시, 의존성, 자동 재전송은 추가하지 않는다. 모델 설정을 강제로 덮어쓰지 않는다. 배포와 인증 추론은 이 로컬 변경의 완료 근거에 포함하지 않는다.

## 공식 계약과 확인한 차이

근거: [OpenAI 파일 전사](https://developers.openai.com/api/docs/guides/speech-to-text), [OpenAI 마이그레이션](https://developers.openai.com/cookbook/examples/migrating_from_whisper_to_gpt_transcribe), [OpenRouter STT](https://openrouter.ai/docs/guides/overview/multimodal/stt), [OpenRouter 공개 전사 카탈로그](https://openrouter.ai/api/v1/models?output_modalities=transcription).

| 기능 | OpenAI 직접 `gpt-transcribe` | OpenRouter 공통 계약 | 이번 처리 |
| --- | --- | --- | --- |
| 모델과 응답 형식 | JSON 전사 | JSON/verbose JSON, 실제 모델별 제한 | 경로·모델별 지원 선택지와 readiness 검사를 공유 |
| 언어 힌트 | `languages[]` | 단일 `language` | 미지원 선택 비활성화. 자동 감지와 단일 힌트를 구분 |
| 용어와 맥락 | `keywords[]`와 `prompt` 함께 사용 | 최상위 prompt는 무시됨 | 직접 연결의 동시 매핑 추가. OpenRouter 공통 옵션으로 지원한다고 표시하지 않음 |
| 시간정보 | 기존 Whisper 시간정보를 승계하지 않음 | verbose JSON과 모델 지원 필요 | 잘못된 응답 형식/시간정보 조합 실행 차단 |
| temperature | 일반 전사 요청의 선택 필드 | 공통 선택 필드 | 0–1의 형식화된 입력과 실제 요청 매핑 추가 |
| 화자 구분 | 별도 diarize 모델과 형식 필요 | 제공사별 지원 확인 필요 | diarize JSON/diarized JSON 허용, 일반 모델과 구분 |
| streaming·화자 참조·고급 배열 | 별도 처리/직렬화 필요 | 공통 지원으로 가정할 수 없음 | 이번 최소 변경에 추가하지 않음 |

OpenRouter 공개 목록에서 `openai/gpt-transcribe`의 `audio -> transcription` 등록을 확인했다. 모델의 고유 능력 설명은 OpenRouter가 모든 고유 요청 필드를 전달한다는 증거가 아니다. 현재 `provider.options`를 통한 복수 언어·키워드 전달과 실제 추론은 미검증이다.

## 구현

- `openai-gpt-transcribe`와 `router-gpt-transcribe` 프리셋을 추가했다. 기존 Whisper 프리셋은 별도로 유지한다.
- 모델별 응답 형식·언어·용어 선택지와 실행 검사를 한 지원 정의로 관리한다. 기존에 저장된 비호환 값은 그대로 보이며 경고와 실행 제한으로 수정 필요성을 알린다.
- 명시적 용어 전송 안 함은 실제 요청에서 prompt를 생략한다. 필드가 없는 과거 Whisper/4o 등록은 이전 prompt 기본값을 유지한다.
- STT와 LLM 요청의 실패 분류 및 실제 HTTP 상태를 기존 암호화 저장에 포함한다. HTTP 상태와 제공사 본문의 숫자 오류 코드를 구분한다.
- 처리 기록은 요청 ID로 오류 응답을 연결해 `error.message`, `error.code`, `error.type`, `error.param`만 보여준다. 전체 실패 응답이나 전사 본문을 출력하지 않는다. 등록 제공사의 기존 정확한 키 마스킹을 유지하고 표시 문자열의 키/Bearer 형태도 마스킹한다. 자유 형식 오류 메시지에는 입력 일부가 포함될 수 있으므로 오류 내용은 암호화된 프로젝트/잠금 해제 화면에서만 다룬다.
- 오래된 기록의 없는 HTTP 상태는 추측하지 않는다. 준비 초기화는 기존 정책대로 오류 본문을 제거하며 과거 처리 메타데이터에 오류 메시지를 추가하지 않는다.

## 검증

실제 API 키, 개인 회의 파일, 인증된 STT/LLM 호출은 사용하지 않았다. 단위/컨트롤러 검증은 합성 응답과 실제 로컬 암호화 저장을 사용한다.

초기 확인에서 기존 `tests/stt-rerun-controller.spec.tsx` 두 검사가 HEAD 컨트롤러에서도 실패했다. 하나는 완성 전사에 부분 전사 동의를 넘긴 테스트 설정을 수정했다. `preserves an initial partial selection on explicit failed-chunk retry and reloads exact frozen lineage`의 전사 선택 ID 불일치는 이번 변경 전부터 재현되어 별도로 남긴다. 전체 저장소 시험은 실행하지 않는다.

실행 명령과 결과:

```sh
npx vitest run tests/stt-input-settings.spec.ts tests/model-registrations.spec.ts tests/registered-runtime.spec.ts tests/model-registrations-ui.spec.tsx tests/history-listing.spec.tsx tests/provider-data-policy.spec.ts tests/providers.spec.ts tests/stt-rerun-controller.spec.tsx
# 199 passed, 1 failed (위의 기존 부분 재시도 검사)

WRANGLER_LOG_PATH=/private/tmp/mom-stt-build-wrangler.log npm run build
# tsc -b와 Vite build 성공. 기존 동적/정적 import 중복과 500 kB 번들 경고 유지.

npx eslint src/react-app/controller.tsx src/react-app/domain/pipeline.ts src/react-app/domain/types.ts src/react-app/providers/model-profiles.ts src/react-app/providers/model-registrations.ts src/react-app/providers/openrouter.ts src/react-app/ui/components/ModelRegistrations.tsx src/react-app/ui/screens/History.tsx tests/history-listing.spec.tsx tests/model-registrations-ui.spec.tsx tests/provider-data-policy.spec.ts tests/stt-input-settings.spec.ts tests/stt-rerun-controller.spec.tsx
# 성공. 마지막 UI 수정 후 아래 범위만 갱신.
npx eslint src/react-app/providers/model-registrations.ts src/react-app/ui/components/ModelRegistrations.tsx tests/model-registrations-ui.spec.tsx tests/stt-input-settings.spec.ts
# 성공.

npm run test:secret
# 소유 앱 소스·정적 파일·클라이언트 산출물 검사 성공.
git diff --check
# 성공.
```

수정 전 실패 검사를 추가해 오류 상세 미표시/HTTP 상태 미보존을 확인했고, 이후 해당 검사의 통과를 확인했다. HTTP 200 응답 본문에 다른 숫자 오류 코드가 있는 경우도 실제 HTTP 상태를 따로 보존한다. LLM 실패 뒤 완료 전사가 유지되고 잠금/재해제 뒤 상세가 복원되는 경로를 검사했다.

Chrome의 별도 로컬 검증 창에서 1610×1068 데스크톱으로 합성 실패 기록 펼침, 기존 비호환 설정 경고와 값 보존, 명시적 프리셋 적용, OpenAI 직접/라우터의 서로 다른 지원 선택지를 렌더링했다. 이 임시 화면에는 외부 API 호출이 없으며 확인 후 임시 HTML/TSX와 서버를 제거했다. 모바일·인증 추론·운영 배포 검증은 하지 않았다.

- [실패 요청 상세](history-desktop.jpg)
- [기존 비호환 설정](model-stale-desktop.jpg)
- [OpenAI 직접 설정](model-direct-desktop.jpg)
- [OpenRouter 공통 설정](model-openrouter-desktop.jpg)

레퍼런스 디렉터리의 6개 원본 SHA-256은 변경 전후 동일하다. 원본 HTML의 잠금/홈 상태와 제공된 이미지도 확인했다. 로컬 Vite로 원본 HTML을 열 때 기존 noscript 마크업의 parse5 경고가 발생했으며 원본은 수정하지 않았다. 새 문서 및 인덱스의 로컬 링크를 확인했다.

## 남은 범위와 한계

`stream` 수신 처리, 화자 참조 클립과 일반 고급 배열의 multipart 반복 매핑, 감지된 `languages`의 별도 결과 UI는 이번 변경에 포함하지 않았다. 감지 언어 등 원본 응답의 필드는 기존 암호화 원본 응답에 보존된다. OpenRouter의 고유 옵션 전달, 모델별 실제 포맷 허용과 추론 품질은 인증된 실행으로 별도 확인해야 한다. 사용자의 실제 저장 설정·키·회의 데이터는 변경하지 않았다.
