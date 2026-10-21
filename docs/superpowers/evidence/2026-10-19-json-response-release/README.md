# 2026-10-19 JSON 원본 보기와 화면 정리

사용자가 `키·값 목록` 디자인을 선택하고 구현·배포를 승인했다. 이어서 설정 보안 안내의 글자 크기, 재전사 모달의 선택 청크 표시, 제목 행의 삭제 버튼 배치를 요청했다. 앞선 OpenRouter STT 예시 13개와 10초 잠금 경고 커밋도 같은 배포에 포함한다.

## 변경

- `JsonResponse.tsx`와 `json-response.css`: 기존 React와 CSS로 만든 읽기 전용 키·값 목록. 긴 문자열·객체·배열은 native details로 펼친다. 자식은 펼칠 때 렌더링하고 큰 묶음은 50개씩 추가 표시하며 모든 값을 확인할 수 있다. 원본 JSON으로 전환할 수 있고, 다른 원본 결과를 고르면 보기 상태를 초기화한다. API 키·외부 요청·편집·복사 기능을 추가하지 않는다.
- `ChunkTranscript.tsx`: 저장된 `raw.response`를 그대로 전달한다. 원본·선택 전사·수정본·정리 노트는 변경하지 않는다. React 텍스트 렌더링으로 HTML을 실행하지 않는다. 원본 JSON은 기존과 같이 저장된 응답 객체를 JSON 문자열로 표현한다.
- `ScreenLock.tsx`, `screen-lock.css`, `Settings.tsx`: `작업과 데이터는 어떻게 되나요?` 제목은 14px·600 굵기, 설명과 `내 음성 메모는 내 기기에.`의 본문은 기존 12px hint 스타일로 맞췄다. 잠금·저장 정책과 문구의 의미는 변경하지 않는다.
- `STT.tsx`, `stt-review.css`: 재전사할 실제 청크 번호와 원본 시간 구간을 접힌 상세 정보 밖에 표시한다. 전체/남은 청크 범위를 바꾸면 목록도 해당 전송 범위를 따른다. 본문 13px·보조 안내 12px, 긴 청크 목록은 키보드로도 스크롤할 수 있다. 전송 동의와 결과 불명·중복 비용 고지는 유지한다.
- `App.tsx`, `memo-deletion.css`: 삭제 버튼을 제목과 같은 행 오른쪽에 배치했다. 모바일은 제목·길이를 줄바꿈해 가로 넘침을 막는다. 삭제 확인·진행 중 비활성화·실제 삭제 경로는 그대로 유지한다.

외부 라이브러리·의존성·라이선스 파일·API 어댑터·보관함 스키마를 변경하지 않았다. 원본 레퍼런스 6개의 SHA-256은 HEAD의 원본과 일치한다.

## 실제 선별 검증

전체 스위트는 실행하지 않았다. JSON 표시와 직접 연결된 원본 선택·재전사·삭제 UI, 설정 설명을 검사했다. 이전 STT 예시의 변경 없는 코드에 대한 [69개 검사](../2026-10-19-zdr-stt-presets/README.md)와 [10초 잠금 경고 검사](../2026-10-19-lock-warning/README.md)는 해당 기록을 따른다.

| 명령 | 결과 |
| --- | --- |
| `npm run test:unit -- tests/json-response-ui.spec.tsx tests/stt-rerun-ui.spec.tsx tests/screen-lock-ui.spec.tsx` | **29개 통과**. 문자열/배열 펼치기, 페이지별 표시와 전체 값 접근, 원본 JSON 동등성, HTML 이스케이프, 원본 선택 시 상태 초기화, 청크 구간의 상시 표시, 기존 재전사/동의·잠금 UI 포함. 최초 새 뷰어가 없을 때 import 실패를 확인했고, 긴 문자열 검사의 공백 정규화 기대를 실제 텍스트 보존 방식으로 수정했다. |
| `npm run test:unit -- tests/stt-rerun-ui.spec.tsx tests/memo-deletion-ui.spec.tsx` | **23개 통과**. JSON을 연 채 잠그면 원본이 DOM에서 제거되는 검사와 기존 삭제 확인·차단 검사 포함. STT UI 14개는 위 그룹과 중복이며 전체 서로 다른 검사는 **38개**다. |
| `npm run build` | 최종 종료 0. 기존 혼합 import·500 kB 초과 번들 경고가 남는다. |
| 변경 TS/TSX 파일에 `npx eslint` | 오류 0. `App.tsx`의 기존 react-refresh 경고 1개는 별도 확인했다. |
| `node scripts/check-public-artifacts.mjs`, `git diff --check` | 종료 0. 앱 소스·정적 자산·클라이언트 빌드의 금지 패턴 검출 없음. |
| `MOM_RELEASE_EVIDENCE=… MOM_SCOPE_EVIDENCE=… npx playwright test --config playwright.config.ts tests/e2e/stt-review-release.spec.ts tests/e2e/stt-scope-choice.spec.ts` | 프로덕션 빌드 미리보기의 별도 headed Chrome. 범위·원본 선택 흐름 **통과**. 확장한 JSON 흐름은 잘못 중첩한 locator에서 실패했다. |
| `MOM_RELEASE_EVIDENCE=… npx playwright test --config playwright.config.ts tests/e2e/stt-review-release.spec.ts` | locator만 수정한 뒤 실패한 흐름만 재실행해 **통과**. 제품 소스는 바꾸지 않았다. 최종 서로 다른 브라우저 흐름 2개가 통과했다. |

브라우저에서 실제 합성 WAV → MP3 청크 → 가로챈 합성 응답 → 암호화 저장을 사용했다. 키보드 Enter로 긴 문자열을 펼치고, 120개 배열의 추가 표시와 JSON 원문을 확인했다. 모델 전환 재시도, 편집본 보존, 다른 메모를 유지하는 전체 메모 삭제, 새로고침·잠금 해제 흐름을 확인했다. 외부 HTTPS 추론 요청·페이지 오류는 0이다. 실제 키·사용자 보관함·회의 자료·유료 추론을 사용하지 않았다.

## 렌더링 확인

1440×900 데스크톱과 390×844 모바일을 실제 렌더링했다. 설정의 제목 14px·600/본문 12px을 계산 스타일로 확인했다. JSON·재전사 모달의 가로 넘침이 없고 삭제 버튼은 제목 행에 포함된다. 원본 선택·삭제의 기존 확인 절차도 통과했다.

- [데스크톱 설정](1440-security-copy.png) · [모바일 설정](390-security-copy.png)
- [모바일 JSON](390-json-response.png) · [모바일 재전사 구간](390-selected-chunk.png)
- [제목 행과 삭제 버튼](1440-stt.png) · [청크 원본 모달](1440-chunk.png)

## 배포와 한계

검증한 변경을 main에 fast-forward로 반영하고 기존 Cloudflare Workers Builds 자동 배포를 사용한다. 배포 성공·활성 버전과 운영 도달·실제 UI 검사를 구분해 최종 응답에 보고한다. 이 기록은 로컬 합성 검사이며 실제 제공사 추론·품질·과금과 다른 브라우저를 검증한 것은 아니다.

사용자가 보고한 `ERR_HTTP2_PROTOCOL_ERROR`는 HTTP/2 통신 오류이며 이 UI 변경으로 해결했다고 주장하지 않는다. 원인과 제공사 처리·청구 여부는 해당 요청의 네트워크/제공사 증거가 추가로 필요하다. ZDR 404와 구분하며 계정 정책을 완화하거나 자동으로 유료 재전송하지 않는다.
