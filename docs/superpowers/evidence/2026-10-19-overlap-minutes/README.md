# 2026-10-19 정상 청크 겹침과 실제 누락 분리

사용자는 구조적으로 생기는 5초 겹침을 매번 수동 확인하는 방식을 거절했다. 같은 정리 요청에 실제 겹침 범위·길이를 전달해 LLM이 문맥·중복·경계 전사 차이를 정리하고, 실제 미전사 구간만 별도로 다루도록 승인했다. 기존 원본·선택·수정본·노트는 보존한다.

## 구현

- `minutes/prompt.ts`: `mom-minutes-v2`. 선택 원문의 각 청크 범위·시간 정밀도와 실제 겹침 구간·길이를 포함한다. 5초를 고정하지 않는다. 같은 발화를 한 번 반영하되 실제 반복·나중의 정정·취소를 보존한다. 중요한 사실이 해소되지 않으면 그 사실만 한정하며 경계마다 검토를 요구하지 않는다. 선택에서 제외된 대안과 그 전체 텍스트를 다시 보내지 않는다.
- `domain/types.ts`, `transcript/merge.ts`, `controller.tsx`: 선택 원본에만 청크 출처를 연결한다. 기존 전사 버전도 보존된 메타데이터에서 요청 시 보강하며 버전 ID·텍스트·이력을 변경하지 않는다. 전송 확인 서명·컨텍스트 검사·실행에 같은 입력을 사용한다.
- `minutes/generate.ts`, `ui/screens/Minutes.tsx`, `ui/copy.ts`: 겹침은 부분 전사·단계 미완료의 조건에서 제외한다. 실제 누락은 기존처럼 정확한 선택 전사에 묶인 명시적 동의를 요구한다. 선택 전사에 포함되지 않은 범위라는 안내로 표현을 수정했다.
- `transcript/batches.ts`: 재시도로 처음 완료된 빈 청크를 기존 선택·수정을 보존한 새 버전에 이어 붙인다. 시간·텍스트가 같은 경계가 합쳐질 때도 이미 수정한 텍스트를 보존한다. 이미 선택된 청크의 재전사본은 자동으로 교체하지 않는다. 원본·응답·요청·전사 버전은 기존 암호화 체크포인트에서 저장한다.
- `minutes/compare.ts`, `minutes/selection.ts`, `providers/registered-runtime.ts`: 저장된 비교 재시도의 원래 메시지·프롬프트 버전·입력 서명을 보존한다. 등록 모델에서도 같은 저장 메시지로 한도를 계산하고 실행한다. 새 요청의 정상 겹침에 부분 입력 동의를 요구하지 않는다.
- `ui/screens/Review.tsx`: 청크 경계별 수동 선택 카드·확인 배지를 제거했다. 원본/선택 전사·버전 선택·검색·원음 재생·선택적 편집은 유지한다. 이미 저장된 과거 경계 선택도 삭제하지 않는다.
- `ui/components/ChunkPlayback.tsx`, `ui/components/ChunkTranscript.tsx`, `ui/screens/STT.tsx`: 기존 청크 재생 컴포넌트를 공유해 청크 원문 모달에서 재생·일시정지·이어서 재생·정지할 수 있다. 수정은 기존 전체 전사 편집에서 별도 버전으로 저장한다.

새 의존성·라이선스·외부 서비스·서버·보관함 스키마 변경은 없다. 겹침 정리용 추가 LLM 호출·자동 STT 재실행은 없다.

## 검사 범위와 결과

Git diff가 닿는 병합·선택·동의·요청문·비교·등록 모델 실행·전사/정리 UI와 실제 로컬 저장 흐름만 검사했다. 전체 스위트는 실행하지 않았다.

```sh
npx vitest run tests/minutes.spec.ts tests/transcript.spec.ts tests/stt-batches.spec.ts tests/registered-batches.spec.ts tests/stt-rerun-ui.spec.tsx tests/registered-runtime.spec.ts tests/registered-comparison.spec.ts tests/comparison.spec.ts tests/registered-stage-ui.spec.tsx tests/minutes-budget.spec.ts
npx vitest run tests/ui.spec.tsx -t 'transcript and notes state'
npx vitest run tests/unified-model-controller.spec.tsx -t 'enriches a legacy|executes .* notes'
npm run build
npx playwright test --config playwright.config.ts tests/e2e/overlap-minutes.spec.ts
node scripts/check-public-artifacts.mjs
git diff --check
```

- 위 선별 단위/화면 검사 각각 **145 / 39 / 10개 통과, 합계 194개**. 5/10/15초의 실제 겹침 메타데이터, 텍스트 중복 전송 제거, 폐기된 대안 미전송, 원본 불변, 선택 수정 보존, 실제 누락 동의·서명, 저장된 비교 메시지 유지, 9개 STT→LLM 어댑터 조합과 레거시 전사 보강을 확인했다.
- 수정 전 회귀 검사는 겹침만으로 부분 동의를 요구했고, 재시도한 빈 청크가 선택 전사에 들어가지 않는 것으로 각각 실패했다. 수정 후 위 검사에서 통과한다.
- 별도의 headed Chrome에서 한국어 라이트 **1440×900 / 360×800**, **1개 시나리오 통과(6.5초, 실행 전체 8.6초)**. 601초 합성 WAV를 실제 브라우저에서 3개 MP3 청크로 준비했다. 2번째 요청 실패 → 실제 누락 05:00–10:01의 명시적 동의 → 나머지 2청크 재시도 → 수동 경계 검토 없이 정리 생성 → 원음 재생·일시정지·정지 → 선택적 수정 → 재생성 → 잠금 해제/재열기에서 수정 노트·원본 보존을 확인했다. 실제 측정은 [observations.json](observations.json).
- STT 요청 4개(가로챈 실패 1개 포함), 정리 요청 3개(부분·전체·수정 후 각 1개). 겹침 정리를 위한 별도 요청은 없다. 각 전체 요청에 **295000–300000 / 590000–595000ms, 각각 5000ms** 겹침을 전달했다. 청크 모달 가로 넘침 없음, pageerror 0개, 외부 제공사 요청 0개다.
- 빌드·변경 TS/TSX 파일의 ESLint·공개 산출물 검사·diff 공백 검사 통과. 디자인 원본 6개는 HEAD와 바이트/SHA-256 동일하다. 기존 번들 크기·혼합 import 경고는 유지된다.

## 기존 테스트 실패의 구분

처음 확인한 `tests/ui.spec.tsx` 전체 파일은 변경 범위 39개를 포함해 93개 통과·7개 실패였다. `tests/controller.spec.tsx -t 'minutes|comparison|real encoded chunks|partial consent'`는 2개 통과·36개 실패였다. 수정 전 HEAD `d81db8e`를 임시 경로에 별도로 펼쳐 **동일한 7개 UI 실패와 2개 통과·36개 컨트롤러 실패를 재현**했다. 이들은 오래된 파일 재선택/잠금 선택자·용어 검사와 구형 모델 설정·STT 확인 토큰 준비에서 실패한다. 이번 변경의 성공 증거로 세지 않았으며 무관한 테스트 전체를 고치지 않았다. 최신 등록 모델 경로는 위 10개 검사와 실제 Chrome 시나리오로 별도 확인했다. 오래된 `tests/e2e/workflow.spec.ts`와 구형 컨트롤러의 겹침 기대값은 새 정책에 맞췄지만 그 전체 흐름이 통과했다고 주장하지 않는다.

## 화면

- [1440px 실제 누락](1440-actual-missing.png)
- [1440px 정상 겹침 정리](1440-normal-overlap-notes.png)
- [360px 정상 겹침 정리](360-normal-overlap-notes.png)
- [360px 청크 원문·음성 재생](360-chunk-playback.png)
- [360px 선택적 전사 수정](360-optional-edit.png)

## 제한

합성 보관함·합성 음성·가로챈 localhost 응답만 사용했다. 실제 사용자 음성·키·보관함과 유료 제공사 추론은 사용하지 않았다. 실제 다국어 STT/LLM의 이름·숫자·부정·겹침 해소 품질은 미검증이다. 이미 저장된 부분 선택 전사는 자동으로 다른 과거 결과로 교체하지 않으며, 필요하면 청크 모달의 `이 결과 사용` 또는 기존 전사 버전 선택으로 반영한다. 배포 상태와 공개 운영 주소 확인은 별도 릴리스 검증 기록으로 구분한다.
