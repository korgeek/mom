# OpenAI 호환 STT·LLM 모델 등록 - confirmed scope

Updated 2026-10-15, Asia/Jakarta. User approved inline implementation in an isolated worktree. [Implementation and verification](../plans/2026-10-15-model-registration-verification.md) distinguish synthetic checks from actual authenticated inference.

## 목적과 결정 경계

사용자가 원하는 것은 제공사별 고정 모델 목록에 맞추는 설정 대신, 자신이 사용할 OpenAI 호환 모델을 직접 등록하는 설정이다. STT와 LLM 목록에서 등록 화면을 열고, 현재와 같은 방식으로 키를 저장하며, 아래에서 `{{값}}`이 포함된 요청 형태를 확인한다.

확정된 방향:

- STT와 LLM 등록 화면을 구분한다. OpenAI 호환 API를 공통 기준으로 사용한다.
- OpenAI와 OpenRouter 주소를 쉽게 채울 수 있게 한다. vLLM 등 사용자가 운영하는 호환 서버의 주소·모델 ID도 등록할 수 있어야 한다.
- 연결·모델 설정, 실행할 때 들어오는 파일·언어·전사문, 응답에서 읽는 값을 구분한다.
- API 키는 기존 보관함 방식으로 암호화 저장하고, 세션 전용 대안도 유지한다.
- 등록 화면 하단에 `{{값}}` 요청 표현을 제공한다. 저장은 외부 음성·전사문 전송이나 추론을 자동 시작하지 않는다.
- **추가 확정 요구:** `테스트 호출` 버튼으로 저장한 secret, 현재 폼에서 조립한 실제 주소·파라미터, 명시적으로 지정한 테스트 입력을 사용해 실제 STT/LLM 요청을 보낸다. 모델 목록 조회만으로 이 테스트를 대체하지 않는다.

2026-10-15 사용자 선택으로 범위를 확인했다. 폼에서 설정을 편집하고 하단 요청은 읽기 전용으로 자동 갱신한다. 첫 단계는 실제 등록·저장·목록·수정·미리보기와 추가 요청한 명시적 테스트 호출까지다. 새로운 등록을 회의의 전사·회의록 실행기로 연결하는 작업은 후속 단계로 둔다. 범용 요청 템플릿 편집 기능은 만들지 않는다.

이는 [기존 모델 선택 설계](2026-10-04-model-selection-settings-design.md)의 고정 OpenAI/OpenRouter 목록 중심 설정을 바꾸는 새 방향이다. 첫 단계에서 기존 실행 모델, 회의의 선택, 보관 정책과 결과를 자동 변환·삭제하지 않는다. [저장소 작업 지침](../../../AGENTS.md)의 과거 기획 단계 제한보다 최신 구현 요청이 우선한다. 사용자가 앱에서 명시적으로 테스트 요청을 보내는 기능은 구현 범위이며, 개발 에이전트가 기존 키를 찾거나 실제 자격 증명·회의 데이터를 사용해 호출하는 것과 배포는 포함하지 않는다.

## 화면과 동작

기존 설정의 `모델` 영역에 `전사 모델` / `LLM 모델` 두 하위 탭을 둔다. 각 탭은 등록한 항목만 보여 주며, 상단에 `모델 등록` 버튼을 둔다. 목록 행에는 이름, 모델 ID, 서버 주소와 저장/키 상태, `수정`을 표시한다. 서버 전체 카탈로그나 미지원 모델을 자동으로 추가하지 않는다.

기존 연결·실행 모델 설정은 계속 접근 가능하게 유지한다. 새 등록 목록에는 첫 단계 안내 `모델을 등록하고 테스트할 수 있어요. 회의의 전사·회의록 실행 연결은 다음 단계에서 제공해요.`를 표시한다. 등록만으로 실제 실행 성공을 표시하거나 회의 실행 기본값 지정 버튼을 넣지 않는다.

등록·수정은 설정 안의 폼으로 제공한다. 상단은 기본 연결과 키, 하단은 요청 미리보기다. 모바일에서는 한 열로 배치하고 긴 주소·JSON이 화면 전체 너비를 늘리지 않게 한다. 기존 글꼴·색·버튼·카드 스타일을 사용한다.

```text
설정 > 모델 > 전사 모델                  [모델 등록]

등록한 전사 모델 목록
  내 전사 모델   model-id   api.example   저장됨 · 테스트 전   [수정]

모델 등록
  이름
  서비스 도움값: OpenAI / OpenRouter / 호환 서버
  Base URL                 실제 호출 주소
  모델 ID
  인증: 없음 / Bearer API 키
  키 입력                  [키 저장]
  키 보관 방식: 암호화 저장 / 이 탭에서만

  고급 호환 설정
  요청 미리보기            {{audio}}, {{languages}}, ...
  결과에서 읽는 값          text / segments 등

  테스트 입력              음성 파일 또는 테스트 전사문
  실제 주소·전송 내용·외부 전송/과금 가능성
  [테스트 호출] [호출 취소]
  실제 결과·HTTP 상태·소요 시간·사용량·원본 응답
                                      [취소] [등록 저장]
```

서비스 도움값은 주소·인증 기본값을 채울 뿐, 허용 모델 목록을 결정하지 않는다. OpenAI의 Base URL은 `https://api.openai.com/v1`, OpenRouter는 `https://openrouter.ai/api/v1`다. 호환 서버는 직접 입력한다. 도움값을 바꿔도 기존 키를 다른 서버에 자동 연결하지 않는다.

키 저장과 모델 등록 저장은 별도 동작이다. 키는 기존과 같이 명시적인 `키 저장`으로 저장하고 입력란을 비운다. 이후 등록 저장이 실패해도 키 저장까지 실패했다고 표시하지 않는다. 취소는 등록 초안을 버리며, 이미 별도로 저장한 키는 유지된다는 짧은 안내를 제공한다. 잘못된 키·설정 때문에 기존 등록을 먼저 지우지 않는다.

새 항목은 먼저 모델 설정을 등록한 뒤 해당 항목의 키를 저장한다. 등록 전에는 `키 저장`을 비활성화하고 순서를 짧게 안내한다. 이렇게 하면 취소한 신규 폼에만 연결된 키가 보관함에 남지 않는다. 이미 등록된 항목의 키 저장은 등록 목록과 연결된 비밀값·키 버전을 한 트랜잭션으로 갱신해, 키 교체 후 예전 테스트 성공이 현재 키의 검증으로 남지 않게 한다.

이 단계에 등록 삭제, 기본값 지정, 전체 카탈로그 동기화, 자동 재시도·대체 모델, 가져오기·내보내기 기능은 추가하지 않는다. `테스트 호출`은 실제 추론이며 제공사에 따라 비용이 발생할 수 있다.

## 설정과 작업 입력

| 항목 | 등록 설정 | 작업 실행 때 들어오는 값 |
| --- | --- | --- |
| 공통 | 이름, Base URL, 모델 ID, 인증 방식, 비밀값 참조 | 선택한 등록 ID와 설정 스냅샷 |
| STT 요청 | OpenAI 호환 multipart, 응답 형식 | 실제 음성 청크를 `file`로 첨부 |
| STT 언어 | 미사용 / 단일 `language` / 복수 `languages[]` | 예상 언어 목록 |
| STT 용어·맥락 | 미사용 / 지원되는 `prompt` 또는 `keywords[]` 방식 | 참고 용어 목록, 녹음 맥락 |
| STT 시간 | 지원되는 응답 형식·시간 정밀도 | 요청할 시간 정보 |
| LLM 요청 | Chat Completions JSON | 선택·편집한 전사문과 회의록 설정으로 구성한 `messages` |
| LLM 출력 한도 | 사용 필드명과 선택적 기본 예산 | 이번 실행의 출력 예산 |
| LLM 생성 옵션 | 선택적 `temperature`, `top_p` | 설정된 기본값만 사용 |

STT·LLM의 기본 필드만 먼저 노출하고 호환 설정은 접힌 고급 영역에 둔다. 모델 ID는 필수이며 직접 입력한다. 서버 모델 목록 조회는 이번 단계에 추가하지 않는다. ID에 제공사 접두사나 `/`를 강제하지 않는다.

STT의 기본 응답은 JSON이며, 고급 설정에서 지원을 명시한 경우에만 다른 JSON 형식을 선택한다. 언어·용어 지원은 미설정/미지원과 구분한다. 미리보기는 지원하지 않는 필드가 실제로 적용되는 것처럼 보여 주지 않는다. OpenRouter 최상위 `prompt`는 무시되므로, 이 설정을 OpenRouter의 검증된 용어 전달 기능으로 안내하지 않는다.

LLM 출력 언어·섹션·추가 지침은 `messages`에 들어가는 작업 값이다. 임의의 `output_language`, `sections`, `response_format: markdown` 필드를 만들지 않는다. 출력 한도 필드는 `max_completion_tokens` 또는 `max_tokens` 중 지정한 하나만 사용한다. 설정하지 않은 생성 옵션은 임의의 숫자로 채우지 않는다.

분할 시간·겹침·압축과 청크 ID·시간축·버전 ID는 MoM 내부의 음성 준비·근거 관리 값이다. 서버로 전달할 요청 필드와 분리한다. 테스트 호출은 아래의 명시적인 테스트 입력만 연결한다. 현재 회의 데이터가 자동으로 테스트에 들어가지 않는다.

## `{{값}}` 요청·응답 미리보기

표시용 변수 이름은 고정한다. 폼 값에서 미리보기 텍스트를 생성하며 임의 치환 문자열을 실행하거나 `eval`을 사용하지 않는다. 실제 키, 로컬 파일명, 현재 회의 제목·음성·전사문을 미리보기에 채우지 않는다.

STT:

```text
POST {{base_url}}/audio/transcriptions
Authorization: Bearer {{api_key}}       # 인증 사용 시에만 표시
본문: multipart/form-data
  model: {{model}}
  file: {{audio}}                      # 파일 첨부
  response_format: json
  language: {{language}}               # 단일 힌트를 설정한 경우
  languages[]: {{languages}}           # 복수 힌트를 설정한 경우, 항목별 반복

읽을 결과: response.text
선택 결과: response.segments / response.words / response.usage
```

단일·복수 언어 필드를 동시에 표시하지 않는다. 용어·시간 등 선택 필드는 해당 설정이 있을 때만 표시한다. multipart boundary는 브라우저가 만든다는 안내만 두고 고정 `Content-Type` 헤더를 구성하지 않는다.

LLM:

```text
POST {{base_url}}/chat/completions
Authorization: Bearer {{api_key}}       # 인증 사용 시에만 표시
Content-Type: application/json
{
  "model": "{{model}}",
  "messages": [
    { "role": "system", "content": "{{minutes_instructions}}" },
    { "role": "user", "content": "{{selected_transcript_and_settings}}" }
  ],
  "stream": false
}

읽을 결과: response.choices[0].message.content
검사할 값: response.choices[0].finish_reason
선택 결과: response.usage / response.model / response.id
```

이 예시는 설명용이며 사용자 데이터가 아니다. 지시문 역할과 지원 옵션은 호환 설정에 따라 달라질 수 있다. 첫 구현은 비스트리밍 요청과 미리보기를 제공한다. 요청·응답 경로를 편집하는 범용 템플릿 엔진은 포함하지 않는다.

## 실제 테스트 호출

`테스트 호출`은 저장한 secret을 보관함에서 실행 시점에 가져와 현재 폼의 요청 스냅샷과 결합한다. 폼의 미저장 키 입력을 몰래 사용하지 않는다. 인증이 없는 로컬 연결은 secret 없이 호출한다. Bearer 인증은 저장한 키가 있어야 활성화한다. 테스트가 모델 등록 설정을 자동 저장하거나 기존 회의 모델을 변경하지 않는다.

테스트 입력:

- STT: 사용자가 테스트 용도로 직접 선택한 음성 파일과 테스트 언어·용어·맥락. 현재 회의 파일을 자동 선택하지 않는다. 기존 음성 검사를 재사용하며, 테스트의 앱 제한은 30초·5 MiB 중 먼저 도달하는 값이다. 설정된 모델 제한이 더 작으면 그 제한을 적용한다. 실제 형식·인코딩된 바이트·길이를 검사하고, 이 앱 제한을 제공사 공식 한도로 표시하지 않는다.
- LLM: 테스트용임을 표시한 짧은 합성 전사문을 기본 입력으로 보여 주고 편집할 수 있게 한다. 테스트 출력 언어·섹션·추가 지침을 설정해 기존 작업 입력과 같은 `messages` 구성 경로를 사용한다. 현재 회의의 실제 전사문은 자동으로 가져오지 않는다. 등록한 생성 옵션·토큰 한도는 임의로 바꾸지 않고 실제 전송 값을 표시한다.

폼 입력, placeholder 미리보기, 테스트 요청은 하나의 요청 구성 함수를 사용한다. 실제 실행 요청에만 File·배열·문자열 등의 타입을 유지해 작업 값을 바인딩한다. API 키는 인증 헤더 구성 직전에 별도로 읽고, 표시용 요청·오류·로그·클립보드에는 넣지 않는다. 외부 응답이 키를 되돌려 주는 경우에도 표시용 응답에서 해당 비밀값을 가린다. 외부 텍스트는 HTML로 실행하지 않는다.

전송 직전에는 완성된 endpoint, 모델, 파일의 실제 바이트/길이 또는 테스트 전사문, 적용할 언어·용어·옵션과 외부 전송·비용 가능성을 확인할 수 있게 한다. 이 내용을 본 사용자의 `테스트 호출` 클릭이 해당 한 번의 전송 동작이다. 주소·키 연결·파라미터·입력이 바뀌면 이전 성공 표시를 현재 설정의 검증으로 재사용하지 않는다. 키는 확인한 origin에만 전송하고 리다이렉트로 다른 대상으로 보내지 않는다. OpenRouter의 기존 외부 전송·보관 정책 확인도 유지한다.

호출은 기존 job/epoch·취소·timeout·응답 크기 경계를 사용한다. 중복 클릭을 막고 호출 중에는 관련 주소·모델·키·입력의 변경과 저장을 잠근다. 호출 취소나 잠금은 새 전송을 멈추고 진행 중 요청을 취소하며, 이미 보낸 요청의 비용이나 제공사 처리가 취소됐다고 보장하지 않는다. 자동 재시도·대체 모델 호출은 하지 않는다.

결과 영역에는 실제 HTTP 상태, 측정한 소요 시간, 요청·반환 모델, 파싱한 전사문 또는 생성 텍스트, 제공된 사용량과 마스킹된 원본 응답을 표시한다. HTTP 200만으로 성공 처리하지 않고 표준 응답 구조·종료 이유·거절/오류를 검사한다. 출력 한도 도달 등 부분 결과는 미완료로 보존한다. 네트워크 실패에서 CORS·인증·서버 장애를 증거 없이 단정하지 않는다. 없는 사용량·비용은 미제공으로 표시한다.

완료된 테스트 결과와 해당 설정/입력 스냅샷은 기존 암호화 저장 경계로 보존한다. 테스트 음성은 이 등록 기능에서 별도로 영구 보관하지 않는다. 잠금 때 미완료 입력 참조를 정리하고 완료 결과의 저장 실패는 기존 잠금 실패 경로로 처리한다. 결과 저장 완료와 외부 호출 완료를 구분해, 저장 실패 때문에 자동으로 유료 재호출하지 않는다. 원본 응답의 secret은 표시 전에 마스킹하며 저장할 테스트 결과에도 secret 자체를 포함하지 않는다.

테스트 성공은 그 설정·그 입력의 실행 성공이다. 긴 녹음의 완전성, 전체 언어·화자 기능, 다른 모델·파일 형식, 운영 환경까지 검증했다는 의미가 아니다.

## 저장·잠금·오류 경계

새 등록은 기존 암호화 catalog의 선택적 버전 필드에 저장한다. 기존 `modelRegistry`와 다른 catalog 필드는 보존한다. 오래된 보관함에 등록 필드가 없으면 빈 목록으로 읽는다. DB 버전·암호화 알고리즘·기존 회의 형식은 바꾸지 않는다. 기존 coordinator 직렬화·트랜잭션·소유권 검사를 재사용한다.

등록 필드의 최소 계약은 `id`, `stage`(stt/llm), `name`, `baseUrl`, `modelId`, `auth`(없음 또는 Bearer의 keyRef), 해당 작업의 선택적 호환 설정이다. 실제 키나 미리보기 문자열은 이 계약에 넣지 않는다. 저장/로드에서 버전·필드 타입·유효 범위를 검증하고, 알려지지 않은 버전을 빈 목록으로 덮어쓰지 않는다.

새 키는 `registration:<opaque id>` 같은 기존 비밀값 저장소의 별도 참조로 저장한다. 기존 `openai`, `openrouter` 키를 덮어쓰거나 가져오지 않는다. 같은 제공사의 기존 키를 재사용하는 UI는 이번 단계에 추가하지 않는다. 서버 origin을 변경하면 기존 credential 연결을 해제하고 새 주소를 확인해 키를 연결하도록 한다. 세션 전용 키는 잠금/탭 종료 후 없는 상태로 표시한다.

Base URL은 사용자정보·query·fragment·제어문자를 거부한다. 원격 주소는 HTTPS, 첫 로컬 지원은 HTTP loopback 주소로 제한한다. 완성된 요청 URL을 표시해 `/v1` 중복과 잘못된 경로를 확인할 수 있게 한다. 서비스 도움값·URL 검증은 브라우저 CORS나 로컬 접근 권한 통과의 증거가 아니다. 실제 연결을 시작할 때에는 브라우저 직접 호출과 전송 대상·내용을 별도로 확인한다.

잠금 시 목록과 초안·키 입력·미리보기를 DOM/접근성 트리에서 제거하고 민감 참조를 정리한다. 저장 중 잠금/다른 탭 소유권 변경은 기존 epoch/job 경계로 처리한다. 뒤늦게 완료된 저장을 현재 폼의 성공으로 표시하지 않는다. 암호화 트랜잭션의 실제 결과를 기준으로 새로고침 후 읽고, 저장 실패를 빈 목록이나 성공 상태로 숨기지 않는다.

저장된 항목은 `저장됨 · 테스트 전`으로 표시한다. 키가 필요한데 없으면 `키 필요`로 표시한다. 등록이나 미리보기 생성은 연결 검증·모델 지원 확인·실제 추론 성공이 아니다. 성공·실패·미완료·취소·결과 불명은 실제 테스트와 그 스냅샷에만 연결한다.

## 후속 실행 연결에서 유지할 결과 계약

STT는 raw 응답, text, 지원되는 구간·단어 시간, 시간 정밀도, 감지 언어·화자, 요청 모델·실제 반환 모델, 실제 사용량을 구분한다. 시간은 청크 기준에서 원본 시간으로 변환하고 반환되지 않은 값을 만들어 채우지 않는다. 빈 전사문과 없는/잘못된 필드를 구분한다.

LLM은 생성 Markdown과 편집본, 사용한 전사 버전, 종료 이유·거절/오류·실제 사용량을 구분한다. 출력 한도 도달 등 미완료 텍스트는 보존하며 자동 유료 후속 요청은 보내지 않는다. 가격·컨텍스트 한도 미확인을 무료·무제한으로 표시하지 않는다. 선택/편집한 전사문만 회의록 입력으로 사용한다.

첫 등록 단계에서는 기존 회의 실행기를 바꾸지 않는다. 테스트 호출에는 표준 STT/Chat Completions 요청 구성과 응답 검증을 구현하고, 이후 회의 실행 연결에서도 이 경로를 재사용한다. 고정 모델 ID 허용목록을 풀었다는 이유만으로 파일/크기/응답/잠금 검증을 제거하지 않는다.

## 영향 범위와 검증

예상 변경 영역은 `App.tsx`의 UI 계약, `controller.tsx`의 등록·테스트 상태와 동작, 설정 화면·등록 폼·목록·미리보기·테스트 결과, 기존 암호화 vault catalog/session의 load/save, 입력 검증·공유 요청 구성·표준 응답 검증이다. 테스트 음성의 검사와 요청 취소/timeout은 기존 경로를 재사용한다. 현재 사용자의 미커밋 변경이 있는 `Settings.tsx`와 보관함 초기화 관련 파일을 덮어쓰지 않는다. 구현은 분리된 작업 폴더에서 시작해 기존 변경을 보존한다.

현재 기준점: HEAD `b126c5818b79d85f016a209f4fe57ed33aaddfda`, 기록된 `origin/main` `abd1dad`. 실제 원격 최신 상태를 뜻하지 않는다. 이번 문서 작성은 pull/reset/기존 파일 덮어쓰기 없이 수행한다.

구현 검증은 변경과 직접 영향받는 흐름으로 한정한다:

- 등록 입력 검증, 주소 조합, 모델 ID 직접 입력, 선택적 설정과 placeholder 미리보기. 실제 키가 미리보기·상태·로그에 들어가지 않음을 합성 표식으로 확인한다.
- 등록의 암호화 저장·reload, legacy catalog 보존, 저장 실패 시 이전 목록 유지, 세션 키·잠금·늦은 저장 처리.
- STT/LLM 목록·등록·수정·취소·키 저장 상태, 한국어/영어, 키보드 탐색과 폼 오류.
- 저장된 합성 secret과 조립된 URL·파일/JSON·옵션이 테스트 transport에 정확히 전달됨을 확인한다. 미저장 키 사용 방지, origin 변경·중복 클릭·취소·잠금·늦은 응답·timeout·잘못된 응답·HTTP 200 오류·부분 결과·결과 저장 실패를 직접 영향받는 사례로 검사한다. 합성 secret이 미리보기·오류·응답 표시·저장 결과에 노출되지 않음을 확인한다.
- 별도 headed Chrome에서 1440×900과 360×800의 목록·폼·긴 미리보기·저장 후·테스트 성공/실패·잠금 상태를 실제 렌더링한다. 독립 합성 보관함과 명시적인 테스트 transport를 사용하며 실제 제공사 전송을 차단한다. 합성 응답을 실제 추론 성공이라고 보고하지 않는다.
- 타입 검사와 관련 산출물/비밀정보 검사는 실제 변경 범위에 맞춰 선택한다. 전체 테스트를 실행하지 않는다. 실행 명령·결과·한계를 기록한다.

기존 사용자 보관함/키·인증된 추론·전사 품질·배포는 검사하지 않는다. 기존 미커밋 초기화 변경의 전체 검증을 이 작업에 섞지 않는다. 레퍼런스 원본은 보존한다.

## 공식 자료와 확인 범위

- [OpenAI STT API](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create): multipart와 모델별 입력/응답 필드.
- [OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create): messages, 출력 한도와 응답/종료 이유.
- [OpenRouter STT](https://openrouter.ai/docs/guides/overview/multimodal/stt): OpenAI 호환 multipart, 지원 범위와 제공사별 옵션 차이.
- [vLLM serving](https://docs.vllm.ai/en/latest/serving/online_serving/): Chat Completions와 ASR Transcriptions 지원. 모든 모델의 기능을 보장하지 않는다.
- 기존 [요구사항](../../01-product-requirements.md), [처리 구조](../../02-architecture-and-data.md), [제공사](../../05-providers-and-comparison.md), [개인정보](../../06-privacy-and-local-storage.md), [검증 기준](../../08-verification-and-release-gates.md), [레퍼런스 검토](../../11-design-reference-review.md)를 따른다.

공식 자료는 이 대화의 2026-10-14 조회를 근거로 한다. 이번 초안은 실제 키 사용·인증 호출·화면 구현·브라우저 검증의 증거가 아니다.

## Implementation notes (2026-10-15)

OpenAI and generic compatible STT use multipart. OpenRouter STT reuses the documented JSON/base64 transport to transmit the selected retention policy (deny collection, require ZDR by default; standard retention only by explicit selection). Both preview and test share the request builder. Malformed JSON raw bodies are omitted to guarantee credential non-disclosure; valid JSON raw bodies are redacted and retained. These refine the transport details above without changing the approved user flow. Actual authenticated inference remains unverified.

### Approved deployment policy (2026-10-15)

The user explicitly approved `connect-src 'self' https: http://localhost:* http://127.0.0.1:*` and pushing main after verification. HTTP literal `[::1]` requests are disabled with a localhost instruction; existing registrations remain readable without automatic origin or credential migration. This supersedes the earlier HTTP IPv6 support detail. Browser local-access permission and actual provider CORS/authentication still require user-led qualification.
