# 진행 상태 우선 UI와 요청·응답 기록 — 2026-10-29

사용자 요청은 메모를 진행 상태에 맞는 단계로 열고, 기본 화면에는 진행률·상태·오류와 다음 행동을 남기며 자세한 설명과 단계별 사용량은 원할 때 펼치는 것이다. 모델별 언어 안내는 실제 매핑으로 명확히 하고 처리 기록에서 요청·응답과 오류 이유를 확인하도록 요청했다. 아래 진입 우선순위는 해당 요구에 맞춘 구현 판단이다.

## 구현

- 홈의 열기, 왼쪽 메모 목록, 처리 기록의 메모 열기는 같은 `memoEntryScreen`을 사용한다. 정리 시도/결과 또는 선택된 완전 전사문이 있으면 메모 정리, STT 시도·부분 전사·준비 완료면 전사, 나머지는 음성 준비로 연다. 준비가 일부만 남았다고 완료로 판단하지 않으며, 원본 음성을 삭제했어도 읽을 수 있는 완전 전사문·정리 결과가 있으면 그 단계로 연다. 화면을 여는 것만으로 재실행하지 않는다. 단계 버튼의 명시적 이동은 유지한다.
- 전사 준비는 실제 처리 단계·진행바·처리 시간/저장 청크 수를 기본으로 표시한다. 처리 위치, 상세 경과시간/최근 이벤트/용량/연속 저장 범위와 진단 복사는 **자세히 보기**, 원본 정보와 미리듣기는 **음성 정보·미리듣기**로 접는다. 원본이 없거나 저장 여부가 미확인일 때는 해당 경고가 처음부터 보이도록 한다. 갱신 지연은 짧은 상태와 필요한 행동을 표시하고 원인 설명은 상세에 둔다.
- 언어 안내는 실제 등록의 `sttInputSupport`를 사용한다. 미전송, 자동 감지/미설정, 단일 언어 힌트, 복수 언어 힌트를 구분하며 단일 설정에 여러 언어를 넣으면 수정이 필요하다고 표시한다. 사용자 서버는 등록 설정 기준이며 실제 서버 지원은 별도 확인이 필요함을 상세에 남긴다. 불명확한 “지원될 수 있음” 설명을 제거했다.
- 전사 기본 안내는 전송 대상·요금/외부 보관·실제 힌트·청크 범위로 줄이고, 상세 보관 설명과 재전사/취소 설명은 접었다. 전송 동의, 실패 청크, 오류 원인, 취소/재시도와 필요한 경고는 기본 화면에 유지한다.
- 정리 모델 경로·모델/가격/한도 상세와 긴 분량 설명을 접고, 입력 옵션·전송 동의·오류는 계속 노출한다. 단계별 사용량 표는 데스크톱에서도 기본 접힘이다. 전사 사용량도 요청 수와 비용 요약·기존 명세 열기 버튼만 두고 자세한 수치는 기존 창으로 연결한다. 모르는 비용을 0으로 합산하지 않는다.
- 처리 기록은 실패 배지와 HTTP 상태를 요약에 표시하고, 실행을 펼치면 오류 상세를 먼저 표시한다. HTTP 상태와 `error.message`, `error.code`, `error.type`, `error.param`을 확인할 수 있다. 그 아래 요청·응답 상세에서 구조 보기와 JSON 원문 보기를 제공한다. 요청 JSON과 응답 JSON의 접근성 이름도 구분한다.
- 등록 모델 및 기존 OpenAI STT/OpenRouter STT·LLM의 실제 전송 본문을 캡처한다. 요청에는 음성 바이너리/base64 대신 bytes/type/format만 남기고, 인증 헤더를 수집하지 않으며 실제 키 문자열과 인증 관련 필드를 마스킹한다. 요청·응답과 원문 오류는 기존 암호화 프로젝트 저장 경로 안에서만 보존한다. 이전 미기록 데이터나 취소·잠금으로 저장을 끝내지 못한 데이터는 미기록으로 표시하며 재구성하지 않는다. 추가 외부 로그나 서버를 만들지 않았다.

변경 경로는 `App.tsx`, `ui/copy.ts`, Home/Import/STT/Minutes/History 화면, `PreparationStatus`, `UsageStatement`, `JsonResponse`와 해당 테스트다. 요청 기록은 `providers/request-history.ts`, 등록/기존 제공사 어댑터, `domain/types.ts`, `domain/pipeline.ts`, controller의 암호화 저장 연결을 사용한다. 기존 사용자 키·메모·전사·결과를 수정하지 않았다.

## 검증

이전 UI/모델 변경이 함께 남아 있는 작업 트리에서 이번 호출자와 데이터 경로만 검사했다. 전체 테스트 모음은 실행하지 않았다. 수치는 명령별이며 중복 테스트를 합산하지 않는다.

| 명령 | 결과 |
|---|---|
| `npx vitest run tests/providers.spec.ts tests/openrouter-stt-provider.spec.ts tests/registered-runtime.spec.ts tests/history-listing.spec.tsx` | 담당 에이전트의 최종 요청 기록/마스킹 연동 검사 206개 통과. 후속 History 표시 변경은 아래 UI 검사로 확인 |
| `npx vitest run tests/memo-entry.spec.ts tests/preparation-status-ui.spec.tsx tests/usage-ui.spec.tsx tests/registered-stage-ui.spec.tsx tests/history-listing.spec.tsx tests/json-response.spec.tsx` | 실제 일치한 UI 5파일 63개 통과. 마지막 JSON 필터는 파일명 불일치로 실행되지 않아 올바른 파일을 아래에서 별도 검사 |
| `npx vitest run tests/json-response-ui.spec.tsx` | 9개 통과. provider HTML 문자열은 실행되지 않고 텍스트로 표시, 배열/긴 문자열 지연 표시 포함 |
| 암호화 실패 기록 필터 검사(아래 명령) | 실패 요청·JSON/비JSON 응답의 암호화 재열기 3개 통과, 20개 제외 |
| `npx vitest run tests/ui.spec.tsx -t 'opens the same completed memo stage'` | 홈·사이드바 진입 통일과 자동 전송 없음 1개 통과, 102개 제외 |
| 준비·포커스·사용량 필터 검사(아래 명령) | 7개 통과, 11개 제외. 390/820/1100px 상태, 상세 열림 유지와 포커스 보호 검사 포함 |
| 변경한 소스/테스트를 지정한 `npx eslint ...` | 오류 0. 기존 `App.tsx:41`의 `react-refresh/only-export-components` 경고 1개 유지 |
| `npm run build` | 타입 검사와 Vite 빌드 통과. 기존 큰 클라이언트 chunk 경고 유지 |
| `npm run test:secret` | 최종 소스·정적 파일·클라이언트 빌드 검사 통과 |
| `git diff --check` | 통과 |

필터 검사의 실제 명령은 다음과 같다.

```sh
npx vitest run tests/stt-rerun-controller.spec.tsx -t 'retains encrypted failure diagnostics|retains LLM failure diagnostics'
npx vitest run tests/compact-work-priority.spec.tsx -t 'preparation|source controls|summarizes compact usage'
```

진행 지연 문구 변경으로 기존 UI 기대값이 실패해 짧은 기본 상태와 펼친 원인 설명을 나눠 검증하도록 수정했다. 포커스 검사도 현재 없는 옛 파일 선택 버튼 대신 실제 **미리듣기 다시 열기**에 초점을 둬 축소 시 포커스가 유지되는지 확인했다.

별도 Chrome 창의 합성 페이지에서 실제 App 컴포넌트를 1610×1124와 360×800으로 확인했다. 준비 진행/상세 펼침, 정리 결과의 명세 접힘/펼침, 실제 복수 힌트 안내, 실패 기록의 HTTP 400 및 request/response 원문 토글을 확인했다. 홈의 정리 결과 메모는 메모 정리로, 사이드바의 전사 실패 메모는 전사로 열렸다. 모바일에서 문서 가로 넘침이 없었다(360px 뷰포트/345px 문서). 사용자의 실제 보관함·키를 열거나 요청을 보내지 않았다. 합성 페이지 파일과 탭은 제거하고 뷰포트를 복원했다.

- [간결한 준비 기본 화면](preparation-default.jpg)
- [모바일 준비 화면](preparation-mobile.jpg)
- [정리 결과·명세 기본 접힘](notes-usage-collapsed.jpg)
- [전사 힌트와 사용량 요약](stt-hints-compact.jpg)
- [요청·응답 JSON](history-request-response.jpg)
- [오류 원인 우선 모바일 화면](history-mobile-error.jpg)

## 한계

실제 API 인증·CORS·유료 추론·전사/정리 품질·배포는 검사하지 않았다. 참고 실행한 `model-modalities.spec.tsx`에는 현재 화면의 모델 정보와 맞지 않는 기대값으로 UI 6건의 실패가 남아 있으며 이번 통과 수치에 포함하지 않았다. HEAD 별도 사본 검사는 해당 사본의 WASM 로더 접근 제한으로 실행되지 않아 이 파일의 기준선 재현을 확인했다고 주장하지 않는다. 과거 미기록 요청과 잠금/취소로 암호화 저장을 완료하지 못한 요청의 본문은 복원할 수 없다. 기존 STT 재시도 선택 전사 UUID 불일치 테스트 실패 1건은 이전 HEAD 기준으로 재현된 별도 문제이며 해결됐다고 주장하지 않는다. [앞선 제한](../2026-10-29-openai-file-options/README.md)을 참고한다. 커밋·푸시·배포는 실행하지 않았다.
