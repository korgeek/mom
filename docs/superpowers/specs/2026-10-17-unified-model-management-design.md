# 모델 관리 통합 설계안

작성일: 2026-10-17 · 상태: 사용자 승인 후 로컬 구현·검증 중

**최신 사용자 결정 — 통합 목록과 독립 동작:** STT·LLM을 합친 목록이 기본이고 `전체 / STT / LLM`으로 필터링한다. 각 행의 수정·테스트·삭제는 별도 모달로 연다. STT·LLM 기본 모델은 따로 관리한다. 삭제는 모델 등록과 해당 기본 선택만 제거하며 공유 키·기존 음성 메모·실행 결과를 보존한다. 키 카드의 읽기 전용 인증 확인과 실제 모델 테스트를 구분한다. OpenAI/OpenRouter는 기존 인증 경로를 재사용하고 사용자 지정 서버는 임의 경로로 전송하지 않고 확인 불가로 표시한다. 인증 결과는 세션에만 두고 키 변경·잠금 시 지운다. 모델 수정 안에서 키 모달을 열어도 초안을 유지한다. 테스트는 짧은 음성 또는 준비된 합성 예문으로 시작하며 세부 옵션·요청 전문은 접는다. 전송·공유 안내는 정보 버튼과 별도 모달로 연다. 아래 분리 탭·수정과 테스트 결합·큰 안내 영역 배치는 이 결정으로 대체한다. [구현·검증 기록](../evidence/2026-10-17-model-list-actions/README.md)을 따른다.

**이전 배치 결정 — API 키 보조 카드와 모달:** 모델 관리 왼쪽에 `STT / LLM` 탭과 짧은 설명을 두고, 오른쪽에 공통 API 키 카드를 둔다. 좁은 화면에서는 아래로 쌓는다. 키 추가·수정은 모달에서 처리하고 이름·제공사·수정/삭제만 목록에 표시한다. 모델 없이 키를 먼저 등록할 수 있고 STT·LLM 모두 같은 origin의 키를 선택한다. 모델 초안은 키 모달을 열거나 저장해도 유지된다. 취소·Escape는 미저장 키를 제거하고 초점을 돌려주며 잠금 시 모달의 민감한 입력을 제거한다. 인증 없는 로컬 모델에는 키가 필요하지 않다. 암호화 저장 기본·접힌 세션 저장 옵션·키 ID/origin/버전·공유 참조 계약은 유지한다. 키 쪽에 모델 목록을 저장하지 않는다. 사용자가 선택한 간결한 설정 푸터에 라이선스·소스/재빌드 링크를 유지한다. 앞선 독립 API 키 탭과 아래의 직접 키 입력·접힌 키 관리·큰 라이선스 카드 배치는 이 결정으로 대체한다. [구현·검증 기록](../evidence/2026-10-17-model-settings-layout/README.md)을 따른다. 키 독립 저장의 이전 구현은 [기존 검증 기록](../evidence/2026-10-17-api-keys/README.md)에 보존한다.

**2026-10-17 구현 승인과 추가 요구:** 사용자는 이 계획의 구현과 로컬 앱의 전사→정리 검증을 요청했고 실제 제공사는 OpenRouter로 선택했다. 모델별 설정의 JSON 가져오기·내보내기, 제공사별 선택 파라미터, 정리 지시의 템플릿도 이번 범위에 포함한다. 키는 공유 파일에서 제외한다. 아래 이전 제외 범위 중 일괄 가져오기는 이 최신 요청으로 대체한다.

### 추가 결정: 키와 모델 조립 분리

- 키는 이름·허용 origin·저장 방식·버전을 가진 별도 `ApiCredential`로 관리한다. 비밀 원문은 기존 암호화 vault 또는 세션 Map에만 저장하고 모델에는 `credentialId` 참조만 연결한다.
- 모델은 API 종류·전체 URL·모델 ID·선택 파라미터와 키 선택으로 조립한다. 같은 origin의 기존 키를 재사용하거나 새 키를 추가한다. 인증 없는 로컬 서버에는 키 참조가 없다.
- 모델 JSON에는 키 원문뿐 아니라 키 ID·이름·저장 메타데이터도 포함하지 않는다. 가져온 뒤 해당 환경의 키를 선택한다.
- 키 교체·저장 방식 변경은 연결된 모델의 키 버전과 테스트/실행 동의를 함께 갱신한다. 모델에서 키 연결 해제는 공유 키 삭제가 아니다. 키 자체 삭제는 영향을 받는 모델 수를 확인하고 참조를 원자적으로 해제한다.
- 별도 연결 설정 탭은 만들지 않는다. 모델 관리의 키 선택과 접힌 키 관리 영역에서 처리한다. 기존 등록별 키는 잠금·세션 경계를 보존해 별도 키 레코드로 이전한다.

### 추가 구현 계약: 간단한 폼과 공유 JSON

- 기본 폼에는 이름·API 종류·모델 ID·주소·키를 둔다. 프리셋이 공통 옵션을 채우고 세부 한도·정책·파라미터는 고급 항목으로 접는다.
- 공유 포맷은 `format: "mom-models"`, `version: 1`, `models: [...]`다. 모델의 공개 설정만 내보내며 ID·키·credential 정보·테스트 입력/결과·실제 음성/전사문은 포함하지 않는다. 가져오기는 전체 검증·미리보기 후 새 ID의 비활성 모델로 한 번에 저장한다. 기존 모델·키를 덮어쓰거나 요청을 실행하지 않는다.
- 모델의 `requestParameters` JSON으로 예시의 `provider.options.azure`, 응답 포맷·시간값 등 제공사별 설정을 다룬다. URL·키·model·file·input_audio·messages·stream·보관 정책 같은 앱 관리 필드는 덮어쓸 수 없다. JSON 크기/깊이와 위험 키를 검증하며 eval·임의 header·remote audio URL·도구 실행은 허용하지 않는다.
- 정리 모델의 추가 지시 템플릿은 알려진 변수만 텍스트로 치환한다. 선택 전사·출력 언어·항목·사용자 지시를 사용할 수 있으며 기존 근거 기반 프롬프트와 동의/입력 한도 검사를 거친다. 공유 파일에는 변수만 담고 실제 사용자 내용을 채워 내보내지 않는다.
- MAI-Transcribe 2, Scribe v2, Whisper Large V3 Turbo 예시를 제공한다. MAI의 verbose/word·화자 구분·phraseList·스타일은 명시적 설정으로 보내고 실제 응답의 speaker/word 정보를 보존한다. 기본 ZDR 정책은 옵션 JSON으로 완화할 수 없다.

## 1. 목표와 확정된 방향

`연결 설정`을 `모델 관리`로 합친다. 모델마다 엔드포인트를 등록하고 별도 키를 선택하여 연결하고, **전사와 요약·정리 노트에 사용할 모델을 각각 선택**한다. 두 작업 모두 OpenAI, OpenRouter, 로컬의 OpenAI 호환 서버를 지원한다. 전사는 OpenAI, 정리는 OpenRouter라는 역할 구분을 없앤다.

이 방향과 설계·계획 문서 작성은 사용자가 요청했다. 아래 스키마·화면 세부 동작·이전 방식·초기 지원 범위는 구현을 위한 제안이다. 구현·실제 추론·배포 완료를 뜻하지 않는다.

| ID | 수용할 요구사항 |
| --- | --- |
| U1 | 연결 탭을 없애고 모델별 주소·키·옵션·테스트를 한곳에서 관리한다. |
| U2 | 전사와 정리 노트는 서로 독립적으로 모델을 고른다. 각 단계에서 세 종류의 서버를 모두 사용한다. |
| U3 | 등록한 모델을 실제 음성 메모 처리에 사용한다. 등록·테스트만 가능한 상태로 끝내지 않는다. |
| U4 | 키 안내는 키 저장 방식 아래에 한 번만 표시한다. 전송·보관 안내는 공통 안내와 해당 모델의 정책으로 줄인다. 한국어·영어를 제공한다. |
| U5 | 기존 키·모델 선택·완료된 전사·노트·이력을 보존한다. 암호화·잠금·저장 복구·명시적 실행 동의를 유지한다. |
| U6 | 인증 없는 로컬 서버는 키 없이 호출한다. 서버·브라우저의 지원 조건과 실제 검증 범위를 구분한다. |

로컬 Whisper 전사 → OpenAI 정리, OpenRouter 전사 → 로컬 LLM 정리, 로컬 전사 → 로컬 정리를 같은 흐름으로 처리한다. 완료한 전사를 재사용해 정리 모델만 바꿀 수 있다.

## 2. 현재 소스와 변경 범위

기준: main `9383099`와 로컬의 별도 문구 변경. 다음은 소스 확인 결과이며 실제 제공사 추론 결과가 아니다.

| 위치 | 현재 동작 | 변경 방향 |
| --- | --- | --- |
| `App.tsx`, `ui/screens/Settings.tsx` | 연결·모델 탭 분리, 키 안내와 OpenRouter 전사 정책 중복 | 모델 관리로 통합, 공통 안내 한 번 표시 |
| `ui/components/ModelRegistrations.tsx` | 모델별 주소·키와 제한된 테스트를 이미 제공 | 이 등록 목록을 실제 작업의 단일 모델 목록으로 확장 |
| `providers/model-registrations.ts`, `registration-test.ts` | 기본 주소에 경로 부착, OpenRouter 호스트 판별, 테스트 한도 적용 | 명시적 API 종류·전체 요청 URL, 테스트와 production 한도 분리 |
| `providers/openai.ts`, `openrouter-stt.ts`, `openrouter.ts` | 전사는 고정 카탈로그, 정리는 OpenRouter 경로에 의존 | 기존 요청·응답 처리를 등록 모델의 실행 스냅샷으로 구동 |
| `controller.tsx`, `domain/pipeline.ts`, `transcript/batches.ts`, `minutes/*` | 선택·동의·배치·비교·비용도 기존 제공사 경로에 종속 | 등록 ID와 요청 당시 설정을 모든 실행 경로에 연결 |
| `vault/store.ts`, `vault/session.ts` | 제공사 공통 키와 등록별 키가 함께 존재 | 기존 암호화·세션 저장 재사용, 원자적 이전 |

새 공용 `Connection` 엔티티나 연결 관리 화면은 만들지 않는다. 기존 카탈로그는 명시적 모델 추가 시 참고·미리 채우기에 재사용할 수 있다. 실제 선택 목록은 통합 등록 목록 하나로 결정한다.

## 3. 화면 구성

설정에서 `연결 설정`을 제거하고 `모델 관리 / Models`를 사용한다. 내부에 `음성 전사 / Transcription`, `요약·정리 / Notes` 목록을 둔다. 단계별 기본 모델을 등록 ID로 저장하며 음성 메모의 작업 화면에서 변경할 수 있다.

```text
모델 관리                              [+ 모델 추가]
[음성 전사] [요약·정리]

기본 전사 모델: [내 로컬 Whisper ▾]
내 로컬 Whisper    localhost:8000     키 없음 · 테스트 전     [편집] [테스트]
OpenRouter 전사    openrouter.ai      키 저장됨 · 테스트 성공  [편집] [테스트]

모델 추가 / 편집
  용도                 음성 전사 | 요약·정리
  이름                 내 로컬 Whisper
  API 종류             OpenAI | OpenRouter | OpenAI 호환·로컬
  모델 ID              서버에서 사용하는 정확한 ID
  요청 URL             http://localhost:8000/v1/audio/transcriptions
  인증                 API 키 사용 | 인증 없음
  API 키               [새 키 입력]  기존 키는 표시하지 않음
  API 키 저장 방식     암호화해 보관 | 잠금 전까지만 사용
  API 키 안내          공통 문구 한 번
  [고급 옵션 ▸]        지원 기능·한도·해당 제공사 보관 정책
  [ ] 작업에서 사용
  [저장] [취소]

[데이터 전송·보관 안내 ▸]
[앱 정보·라이선스 ▸]
```

### 등록과 편집

- OpenAI·OpenRouter는 단계별 공식 URL을 미리 채운다. 호환 서버는 URL과 모델 ID를 직접 입력한다. API 종류는 요청 규격이며 로컬 주소만으로 모델의 기능을 추정하지 않는다.
- URL은 **완성된 요청 URL**로 저장한다. 기본 주소를 입력하면 저장 전에 완성될 URL을 보여준다. 실행 시 경로를 다시 덧붙이지 않는다.
- 설정과 키를 한 폼에서 저장한다. 저장만으로 모델 검색·인증·추론 요청을 보내지 않는다. 모델 테스트는 별도의 명시적인 버튼으로 실행한다.
- 빈 키 입력은 기존 키 유지다. `키 교체`와 `저장된 키 삭제`를 명시적으로 구분한다. 기존 키를 입력란·미리보기·이력에 다시 표시하지 않는다.
- 새 모델은 `작업에서 사용` 기본 해제다. 사용자가 활성화하고 기본값도 직접 고른다. 검색·키 저장·테스트 성공으로 자동 활성화하거나 기본 모델을 바꾸지 않는다.
- 키·한도가 없는 모델도 초안 저장할 수 있다. 실제 선택·실행에서는 부족한 필드와 수정 방법을 표시한다. 테스트 성공은 필수로 강제하지 않으며 긴 음성의 호환성을 보장하지 않는다.
- 같은 모델 ID를 다른 주소에 등록할 수 있다. 목록과 선택기에 이름·모델 ID·서버를 함께 보여준다. 모델 제외는 비활성화로 처리한다. 영구 삭제·키 공유·일괄 가져오기는 추가하지 않는다.
- 저장한 등록의 용도는 고정한다. 같은 서버를 두 용도에 쓰려면 전사·정리 등록을 각각 만든다. 이미 연결된 기본값·배치의 용도를 편집으로 바꾸지 않는다.

### 안내 문구와 정책

키를 쓰는 모델의 `API 키 저장 방식` 아래에 한 번만 표시한다.

> 제공사 또는 모델 서버에서 발급받은 API 키를 입력하세요. 보관함 암호는 API 키로 사용할 수 없어요. 저장한 키는 다시 표시하지 않아요. 저장만으로 서버에 요청을 보내지 않아요.

> Enter the API key issued by your provider or model server. Your vault passphrase is not an API key. Saved keys are never shown again. Saving does not send a request to the server.

보관함 암호인지 판별하려고 암호를 별도 저장·비교하지 않는다. `인증 없음`이면 키 입력과 키 저장 방식을 숨긴다.

공통 전송 안내는 짧게 표시하고 상세는 접는다.

> 데이터는 로컬에 암호화해서 저장돼요. 전사는 음성을, 요약·정리는 선택한 전사문과 작성 지시를 선택한 모델 서버로 보내요. 로컬 서버를 선택하면 해당 주소로 전송해요.

> Your data is encrypted and stored locally. Transcription sends audio; summarization and notes generation send the selected transcript and instructions to your chosen model server. When you select a local server, requests go to that address.

이는 새 모델 관리 화면의 제안이며 현재 보관함 화면의 별도 사용자 지정 문구를 이 문서 작업에서 바꾸지 않는다.

상세에는 로컬 암호화로 서버의 로그·보관을 제어할 수 없다는 점, 정리 시 음성을 다시 보내지 않는다는 점, 복사·다운로드한 평문은 보관함 밖에 있다는 점을 둔다. OpenRouter 정책 링크·동적 처리 제공사·ZDR는 OpenRouter 모델에만 표시한다. 호환 서버의 보관 정책은 운영자에게 확인하도록 안내하며 보장하지 않는다.

OpenRouter 전사는 기존 `data_collection: deny`, ZDR 필수 기본값을 유지한다. 정책·설명 버전 확인은 모델별로 저장하고 완화 시 명시적으로 확인한다. 경로가 없을 때 자동 완화하거나 다른 모델의 동의를 복사하지 않는다. 폼의 저장에 정책도 포함하므로 별도 `전사 정책 저장` 버튼을 없앤다.

`앱 정보·라이선스`는 설정 공통 하단의 접기 항목으로 줄인다. 제3자 라이선스·소스·재빌드·재연결 링크와 키보드 접근성을 유지한다.

## 4. API와 로컬 지원 범위

| API 종류 | 음성 전사 | 요약·정리 |
| --- | --- | --- |
| OpenAI | `/v1/audio/transcriptions`, multipart 파일 업로드 | `/v1/chat/completions`, 기존 정리 프롬프트 |
| OpenRouter | `/api/v1/audio/transcriptions`, 기존 JSON/base64·보관 정책 | `/api/v1/chat/completions`, 기존 처리 경로 고정·fallback 금지 의미 보존 |
| OpenAI 호환·로컬 | 전체 URL, OpenAI 호환 multipart 전사 | 전체 URL, OpenAI 호환 Chat Completions |

API 종류와 용도는 별도 값이다. 공식 프리셋은 `https://api.openai.com`, `https://openrouter.ai`의 올바른 단계별 경로만 허용한다. 다른 주소는 compatible로 등록한다. OpenRouter용 payload·정책을 임의 서버에 적용하지 않는다.

vLLM 등에서 **해당 API를 지원하는 모델을 별도 서버로 실행**하는 방식이다. ASR 모델은 전사 API를, 대화 모델은 텍스트 API를 실제 제공해야 한다. 모든 LLM이 전사를 하거나 모든 서버가 모든 필드를 받는다는 뜻은 아니다. 초기 텍스트 지원은 비스트리밍 Chat Completions다. Responses API 전용 모델은 범위 밖이다.

실제 음성 메모는 기존 준비 파이프라인의 MP3 청크를 사용한다. 초기 전사 지원은 이 포맷을 받는 서버다. WAV 전용 서버는 등록·테스트와 실제 메모 지원을 구분해 실행 제한 사유를 표시한다. 이번 변경에 새 오디오 인코더를 추가하지 않는다.

초기 주소 범위는 현재 CSP와 맞춘다.

- HTTPS 서버와 같은 기기의 `http://localhost:<port>`, `http://127.0.0.1:<port>`를 지원한다.
- HTTP 사설 LAN·HTTP IPv6 loopback은 초기 범위에서 제외한다. 기존 IPv6 등록은 보존하되 실행 제한 사유를 표시한다. LAN 서버는 신뢰 가능한 HTTPS 주소로 연결할 수 있다.
- 서버의 CORS에서 앱 원점과 필요한 OPTIONS·Authorization을 허용해야 한다. 브라우저별 로컬 네트워크 권한도 필요할 수 있다. 관측 불가능한 CORS·접근 거부를 키 오류로 단정하지 않는다.
- 브라우저 보안 해제·`no-cors`·MoM 프록시·모델 자동 설치/기동·브라우저 내부 추론은 추가하지 않는다. HTTP LAN 지원은 주소 검증·CSP·브라우저 동작을 함께 검토할 별도 변경이다.

## 5. 저장 계약과 실행 식별자

기존 `ModelRegistration`을 v2로 확장한다. 새 연결 테이블은 만들지 않는다. 다음은 변경 계약이며 기존 단계별 옵션·테스트 결과 구조를 재사용한다.

```ts
type ModelAdapter = 'openai' | 'openrouter' | 'openai-compatible';
type RegistrationKeyUpdate =
  | { action: 'keep' }
  | { action: 'replace'; value: string }
  | { action: 'clear' }; // 임시 저장 명령. 모델 설정에 비밀 원문을 저장하지 않음

// ModelRegistration 공통 필드:
// id, stage:'stt'|'llm', name, modelId, auth, credentialOrigin,
// credentialVersion, stt?, llm?, lastTest? 유지
// baseUrl → endpointUrl (완성된 URL)
// adapter, revision, enabled, keyStorage:'encrypted'|'session' 추가
// limits, catalogEvidence?, router? 추가

type ModelRegistrations = Readonly<{
  version: 2;
  entries: readonly ModelRegistration[];
  credentials: readonly ApiCredential[]; // 비밀 원문 없음; 모델은 credentialId 참조
  defaults: Readonly<{ stt: string | null; llm: string | null }>;
  legacyRouteIds: Readonly<Record<string, string>>;
}>;
```

- 선택은 등록 `id`, 요청의 모델 이름은 `modelId`다. 기존 등록 최대 100개+legacy 경로 최대 50개를 손실 없이 합치도록 v2 상한은 150개다. 초과 입력은 거부하고 잘라 저장하지 않는다.
- `limits`는 STT 요청 파일 바이트·길이, LLM context/input/output 한도다. STT 파일 한도와 지원 포맷, LLM context/output 한도는 실행에 필요하다. 별도 길이·입력 한도가 공개되지 않았다면 null로 보존하며 무한대나 확인된 값처럼 표시하지 않는다. 지원 힌트·시간값·token parameter는 기존 `stt`/`llm` 옵션을 확장한다. 필수값 누락 시 설정 보완을 요구한다.
- `catalogEvidence`는 채택한 카탈로그의 지원 파라미터·한도·가격·출처·확인일이다. 가격 미확인은 unknown이다. `router`는 OpenRouter 전사 보관 정책·확인 버전 또는 텍스트 처리 경로를 보존한다. URL인 `endpointUrl`과 처리 경로인 `endpointTag`를 구분한다.
- 키는 기존 `registration:<id>` 비밀 레코드 또는 세션 Map에만 둔다. 설정에는 원문 키·보관함 암호·임의 header를 넣지 않는다. 모델별 같은 키 입력은 허용하되 키 공유·자동 상속 UI는 만들지 않는다.
- 이름 변경은 표시만 바꾼다. URL·모델 ID·API 종류·인증·지원 옵션·정책 변경은 `revision`을 증가시키고 테스트·미실행 동의를 무효화한다. 키 변경은 `credentialVersion`도 증가시킨다. origin/인증 변경 시 기존 키를 자동 재사용하지 않는다.
- 설정과 암호화 키는 같은 IndexedDB 트랜잭션으로 저장한다. 세션 Map 갱신은 영속 커밋 성공 후 공개한다. 암호화→세션 전환 시 영속 사본도 같은 커밋에서 제거한다. 실패하면 이전 모드·설정·키를 유지한다.

새 작업의 `ModelExecutionSnapshot`에는 등록 ID/revision, 용도, API 종류, 전체 URL, 모델 ID, 인증·키 버전, 지원 옵션·한도, 정책·처리 경로, 가격 근거를 복제·고정한다. 키 원문은 제외한다. 현재 편집 객체를 참조하지 않는다.

프로젝트 전사 선택과 `MinutesSettings`에 등록 ID를 추가한다. 새 `RunIntent`, `STTBatch`, 정리 실행·비교 구성원에 실행 스냅샷을 추가한다. 기존 modelId·요청/반환 모델·처리 제공사·raw·타임스탬프·비용 이력을 보존한다. 과거 레코드에서 새 필드는 선택 사항이며 일괄 다시 쓰지 않는다.

## 6. 실행·재시도·저장

실행 순서는 `등록 ID 선택 → 준비 상태/한도 검사 → 입력·모델 스냅샷 고정 → 전송 내용·주소·정책·비용 확인 → 실행 의도 암호화 저장 → 1회 요청 → 결과 암호화 저장 → 화면 반영`이다.

- 기존 `STTProvider`, `MinutesProvider`, `runPaidRequest`, `runTranscriptionQueue`, 프롬프트·전사 병합을 재사용한다. `registered-runtime.ts`에서 스냅샷으로 어댑터를 고른다. 테스트 runner를 production runner로 이름만 바꿔 쓰지 않는다.
- 전사는 지원·설정된 필드만 보낸다. 지원하지 않는 언어·용어·화자·시간값을 만들거나 필요한 옵션을 조용히 누락하지 않는다. 정리는 선택한 전사 버전 전체와 기존 지시를 사용하고 오디오를 다시 보내지 않는다.
- 파일과 인코딩 후 body 크기를 각각 검사한다. OpenRouter의 기존 검토 상한인 파일 16,000,000 bytes·JSON body 24,000,000 bytes를 유지하고 모델 한도가 작으면 작은 값을 쓴다. 테스트의 30초·5 MiB를 긴 메모 실행 한도로 복사하지 않는다.
- 음성 준비에 선택 모델의 파일 한도를 반영한다. 보관 중인 청크는 전송 전에 다시 검사한다. 모델 변경 후 포맷·크기·길이가 맞지 않으면 로컬 준비 설정 수정을 안내하고 전송을 차단한다. 완료된 전사를 자동 반복하지 않는다.
- 정리 preflight는 기존 보수적 UTF-8 기준 검사와 context/input/output 한도를 사용한다. 지원 token parameter 하나만 보내고 조용한 입력 자르기·파라미터 추측 재요청을 하지 않는다.
- 응답은 stream 누적 바이트를 제한한 후 JSON으로 읽는다. 제안 초기 상한은 production 8 MiB, 테스트 기존 512 KiB다. 초과·200 error·refusal·tool-only·빈 응답·불완전 출력을 성공으로 표시하지 않는다. 잘린 결과 저장이나 자동 재요청은 하지 않는다.
- `credentials: omit`, `redirect: error`를 유지한다. Authorization은 선택한 origin에만 보낸다. 인증 없음은 header 자체가 없어야 한다. 키를 URL·진단·테스트 raw·로그·내보내기에 노출하지 않고 반사 응답도 마스킹한다.
- reported usage와 추정 비용을 구분한다. 로컬·호환 서버의 usage 누락을 0원/무료로 표시하지 않는다. 가격 미확인은 매 요청 확인에 명시한다. 서버의 보관이나 총비용을 보장하지 않는다.
- timeout·429·연결 단절·CORS·중단 후 결과를 알 수 없으면 그대로 표시한다. 자동 재시도·fallback·정책 완화는 없다. `저장 다시 시도`는 네트워크를 반복하지 않는다.

배치는 최초 스냅샷·입력 청크·선택 raw·동의를 묶는다. 실행 중 모델 편집으로 미완료 청크가 새 서버에 섞여 전송되지 않는다. 재시도는 원래 스냅샷과 일치하는 등록·키를 확인하고 다시 동의받는다. 설정 변경·비활성·키 부재면 이유를 표시하고 새 배치를 안내한다. 저장 결과는 계속 읽을 수 있다.

비교는 기존 두 모델·동일 입력·A 저장 후 B 실행·실패 구성원만 재시도 규칙을 유지한다. 현재 서로 다른 modelId를 요구하는 규칙도 유지한다. 각 구성원의 API 종류는 독립적으로 선택한다. 정리 모델·출력 언어·항목 변경으로 STT를 반복하지 않는다.

잠금 시 새 작업 중지·완료분 저장·abort/늦은 응답 차단·세션 키/복호화 참조/민감 DOM 정리를 유지한다. 테스트·이전·모델 편집에도 동일 세션 가드를 적용한다. 저장 실패·잠금 경합을 성공으로 표시하지 않는다.

## 7. 기존 데이터 이전

잠금 해제 후 목록을 공개하기 전에 외부 요청 없이 원자적으로 이전한다.

1. v1 등록 ID를 유지하고 기존 `registrationEndpoint()` 규칙으로 URL을 한 번 계산한다. 공식 호스트만 해당 프리셋으로 분류한다. 테스트 결과는 보존하되 새 실행 signature로 검증되었다고 표시하지 않는다. v1 등록은 자동 활성화하지 않는다.
2. legacy `modelRegistry` 경로마다 새 ID와 `registryRouteKey → 등록 ID` 매핑을 저장한다. 별칭·활성 상태·기본값·채택 metadata·OpenRouter 처리 경로·정책 확인을 보존한다. modelId가 같아도 별도 등록과 합치지 않는다.
3. 기존 제공사 키는 vault 내부에서 별도 credential 비밀 레코드로 이전하고 모델 참조를 연결한다. 실제 암호화/세션 상태를 기준으로 하고 전역 keyStorage 기본값으로 추정하지 않는다. 세션 키는 영속화하거나 잠금 뒤 되살리지 않는다.
4. v2 목록·키 복사·매핑을 같은 트랜잭션에서 커밋한다. ID 충돌·개수·origin·스키마를 검증한다. 실패 시 기존 데이터를 유지하고 로컬 재시도를 제공한다. 부분 목록·부분 키 복사를 공개하지 않는다. 세션 Map은 커밋 후 갱신한다.
5. 옛 프로젝트는 매핑으로 선택을 해석하고 다음 정상 저장에 등록 ID를 추가한다. 기존 음성·raw·완료 결과·버전·비교·usage를 바꾸지 않는다. 누락 한도는 `설정 확인 필요`로 표시한다.
6. v2를 다시 열 때 중복 이전하지 않는다. legacy 데이터·제공사 키는 이번 릴리스에서 정리 삭제하지 않는다. v2를 모르는 과거 앱으로의 쓰기 롤백을 보장하지 않는다.

암호화 알고리즘·KDF·잠금 방식·Cloudflare 백엔드 구조는 이 변경 범위가 아니다.

## 8. 수용 테스트와 출시 조건

| ID | 시나리오와 기대 결과 |
| --- | --- |
| A1 | 저장·활성화·기본값 변경 시 네트워크 0회, 키 재표시 없음, 같은 modelId/다른 주소 구분 |
| A2 | 3 API × 2 작업의 6개 fixture로 URL/body/auth·응답·미지원 필드 검사 |
| A3 | 3 전사 × 3 정리의 9조합을 브라우저에서 선택→전사→정리→암호화 저장→새로고침. 정리 변경 시 STT 추가 호출 없음 |
| A4 | 실제 localhost HTTP fixture의 CORS 허용/거부·인증 없음/bearer·중단. 주소 검사/CSP 제외 범위 확인. 실제 모델 추론 증거와 구분 |
| A5 | v1+legacy+암호화/세션 키 혼합 이전, ID 충돌·150개·커밋 실패 rollback·멱등성. 과거 결과/선택 보존 |
| A6 | origin/키/정책 변경 시 이전 테스트/동의 무효화. redirect·키 반사·200 error·8 MiB 초과·usage/한도 누락 |
| A7 | 부분 전사 재시도·비교·A 저장 실패·저장만 재시도·실행 중 편집·잠금 뒤 늦은 응답에서 재전송/교차 저장 방지 |
| A8 | 한국어·영어·모바일에서 안내 중복 제거, 오류 필드/수정 방법, 접기·폼·선택기의 키보드/스크린리더 사용 |

공개 지원 주장은 자동화와 분리해 실제 인증된 OpenAI/OpenRouter 추론, 실제 로컬 ASR→로컬 텍스트 모델의 end-to-end 실행, 운영 원점의 CORS/로컬 접근을 기록한 뒤 판단한다. 사용자 키·음성·비용 검증은 해당 실행이 허용된 범위에서 수행한다. 이번 문서 작업에서는 실행하지 않았다.

## 9. 순서와 제외 범위

계약/검증 → 원자적 저장/이전 → 실행 어댑터 → 전사 연결 → 정리·비교 연결 → UI 통합 → 브라우저 검증 순으로 진행한다. 기존 UI는 새 선택·실행·이전이 연결된 뒤 제거한다. [구현 계획](../plans/2026-10-17-unified-model-management.md)에 파일·테스트·순서를 정리한다.

실시간/스트리밍·범용 HTTP 편집기·임의 header·모델 설치·자동 검색/검증·프록시·HTTP LAN은 추가하지 않는다.

## 10. 공식 자료와 해석 범위

2026-10-17 확인. API 형식·제약의 근거이며 MoM 실제 통합 성공의 증거는 아니다.

- [OpenAI Speech to text](https://developers.openai.com/api/docs/guides/speech-to-text), [Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create): 전사/텍스트 API와 모델별 지원 차이.
- [OpenRouter Speech-to-Text](https://openrouter.ai/docs/guides/overview/multimodal/stt), [데이터 수집](https://openrouter.ai/docs/guides/privacy/data-collection), [처리 제공사 로그·보관](https://openrouter.ai/docs/guides/privacy/provider-logging): 요청·처리 경로·정책. 문서에 새 형식이 있어도 검토 없이 기존 지원 프로필을 넓히지 않는다.
- [vLLM OpenAI-compatible server](https://docs.vllm.ai/en/stable/serving/online_serving/openai_compatible_server/), [Speech to Text](https://docs.vllm.ai/en/stable/serving/online_serving/speech_to_text/): 모델·서버가 해당 API를 지원할 때의 전사/텍스트 연결 근거.
- [Chrome Local Network Access](https://developer.chrome.com/blog/local-network-access): CORS와 별개일 수 있는 브라우저 로컬 접근 조건.

기존 [모델 등록 설계](2026-10-14-model-registration-design.md)의 등록·테스트 전용 범위와 분리 저장 흐름은 실제 실행 통합·단일 폼 저장으로 대체한다. 이전 문서는 당시 기록으로 보존한다.
