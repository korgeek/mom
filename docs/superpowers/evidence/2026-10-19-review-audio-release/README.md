# 전사 검토·사용량·원본 재생·메모 삭제 릴리스 검증

2026-10-19. 사용자가 대화에서 언급한 모든 변경과 배포, README의 명시적 프로젝트 라이선스 표기를 승인했다. [구현 계획](../../plans/2026-10-19-review-audio-release.md)을 적용했다. 제품 커밋은 `7c29177`(타이머), `e638e6a`(Luna), `4070cdc`(빈 HTTP 오류), `430483e`(전사/사용량), `e0d15cd`(원본/삭제/정책 오류)이며 기존 사용자 라이선스 커밋 `e941131`을 `581e2b7`로 병합해 이력을 보존했다.

## 구현과 결정

- 데스크톱 1101px 이상은 잠금 카운트다운을 왼쪽 화면 잠금 버튼 바로 위에 둔다. 1100px 이하 위치·잠금 시간/정책은 유지한다.
- 청크의 `전사 내용 확인`은 재전사 앞에서 원본 응답·원본별 결과를 모달로 연다. `전체 전사 확인·편집`은 진행 카드에서 기존 버전 선택/문장 수정/누락/겹침 검토를 큰 모달로 연다. 하단 인라인 전사문을 제거했다.
- 승인된 왼쪽 요약 배치: 전송 전 확인 아래 비용·응답·요청·실패 요약을 두고 `명세·요청 이력 보기`로 상세 모달을 연다. 미확인 항목을 묶고 ID/경로/원시 응답은 펼쳐 확인한다. 집계 함수는 유지해 중복 실행 ID·불완전 비용·서로 다른 통화를 합산하지 않는다. 좁은 화면의 표는 좌우 스크롤 안내와 키보드 초점을 제공한다.
- 최근 요청 재시도는 원래 모델/언어/경로가 기본이다. 다른 모델을 고르면 선택 청크만 새 요청 묶음으로 전송하고 비용 확인을 다시 받는다. 기존 원본/수정본/선택 전사/다른 청크/정리 노트를 유지한다.
- 보관된 원본을 자동으로 열고 실제 음성에서 고정 256개 파형 값을 계산한다. 재생/일시정지/시간/클릭·드래그·키보드 탐색을 연결했다. 순차 1MiB 이하 읽기와 기존 디코더/Worker를 재사용한다. 새로고침한 보관 원본의 네이티브 재생용 Blob 복원은 64MiB까지며, 초과 원본도 파형은 계산한다. 새로 선택한 File 재생과 전사 준비에는 이 복원 제한을 적용하지 않는다. 파형 지원 실패 시 가능한 네이티브 재생은 남긴다.
- 메모 헤더에 삭제를 제공한다. 취소를 기본 초점으로 둔 명시적 확인 후 원본 세대/녹음 조각/청크/원시·수정 전사/노트/요청/사용량/메모별 편집 초안을 원자적으로 지우고 늦은 쓰기를 차단한다. 다른 메모·공용 API 키·모델 설정은 보존한다. 기기 원본/내보낸 사본/제공사 데이터 삭제나 물리 디스크 소거를 뜻하지 않는다.
- OpenAI/OpenRouter 텍스트 프리셋은 GPT-6 Luna다. 기존 암호화된 사용자 모델 등록은 자동 변경하지 않으므로 편집에서 Luna 프리셋 선택 후 저장해야 한다. 이전 기록의 모델 이름/ID는 바꾸지 않는다.
- 비JSON/빈 401을 인증 오류로 보존한다. OpenRouter의 구조화된 `Filter by Data Policy` 404는 보관 정책에 맞는 경로가 없다는 안내로 분류한다. 계정 정책이나 ZDR를 완화하지 않는다. 키 연결 확인 성공은 추론 성공을 뜻하지 않는다.
- README 최상단과 배포 조건에 기존 `MoM Source Available License 1.0`을 표시한다. 정본/배포본의 기존 조건 및 제3자 권리는 유지한다.

## 실제 선별 검사

실제 사용자 보관함·키·음성은 읽지 않았다. 기존 의존성을 작업 트리의 임시 심볼릭 링크로 재사용했으며 설치하지 않았다. 전수 검사를 실행하지 않았다. 각 그룹의 재실행은 중복 합산하지 않는다.

| 명령/범위 | 결과 |
| --- | --- |
| `npx vitest run --config /private/tmp/mom-lock-placement.vitest.config.mts tests/source-preview.spec.ts tests/source-preview-controller.spec.ts tests/source-preview-ui.spec.tsx tests/source-worker.spec.ts tests/playback-ui.spec.tsx` | 최종 52 통과. 실제 WAV/MP3 파형·경계 읽기·64MiB 제한·codec/Worker 실패·취소/잠금/삭제/늦은 결과 포함. [상세](audio-checks.md) |
| `npx vitest run tests/stt-rerun-ui.spec.tsx tests/usage-ui.spec.tsx tests/usage.spec.ts tests/stt-rerun-controller.spec.tsx tests/workflow.spec.tsx` | 62 통과. 최종 배치만 수정한 UI 26건 재통과, 직접 관련 UI 14건과 OpenRouter STT 5건 선별 통과. [정확한 필터·결과](stt-checks.md) |
| 삭제 UI/초안/암호화 저장 선별 | 신규 13 통과, 기존 직접 영향 5 통과. 원자적 실패 롤백·다른 메모/키·늦은 저장·과거 원본 세대 포함. [명령](deletion-checks.md) |
| `npx vitest run --config /private/tmp/mom-lock-placement.vitest.config.mts tests/usage-ui.spec.tsx tests/provider-data-policy.spec.ts tests/memo-deletion-controller.spec.ts` | 최종 통합 15 통과. 선택적 초안·미리듣기 해제·이력 제거와 잠금 후 복원 검증 |
| 프리셋/HTTP 및 타이머 선별 | Luna/HTTP/등록 UI 7건, 타이머 UI 1건 통과. [모델·HTTP](luna-http-checks.md), [타이머](countdown-checks.md) |
| `npm run build` | 타입/프로덕션 빌드 통과. 기존 정적/동적 import 및 500kB 초과 chunk 경고 유지 |
| 변경 TS/TSX에 `npx eslint` | 0 오류. 기존 App.tsx react-refresh 경고 1건 |
| `npm run test:secret` | 앱 소스·공개 자산·client build 검사 통과; 탐지 값 출력 없음 |
| `node --test tests/artifacts.test.mjs` | 4 통과. 라이선스 정본/배포본 일치 포함 |
| `git diff --check`, 원본 Git 객체와 SHA-256 비교 | 통과. [레퍼런스 해시](reference-hashes.json) |

## 보이는 별도 Chrome 검증

`MOM_RELEASE_EVIDENCE=/private/tmp/mom-review-release-built npx playwright test --config playwright.config.ts tests/e2e/stt-review-release.spec.ts tests/e2e/source-preview.spec.ts` — **프로덕션 build preview에서 2/2 통과**(9.8초). dev에서도 각 흐름 통과 후 빌드된 코드로 확인했다.

- 1440×900과 390×844. 실제 합성 WAV에서 파형, 네이티브 재생 시간 증가·일시정지, 클릭/드래그/키보드 탐색, 새로고침/메모 재열기, 잠금 DOM 제거/해제 후 재생 확인.
- 합성 301초 원본을 실제 2 MP3 청크로 준비했다. STT는 localhost 요청을 가로채 고정된 TEST_ONLY 결과만 주입했다. 두 결과 → 청크 모달/초점 복귀 → 전체 모달에서 수정 → 청크 1 네트워크 실패 → 모델 A에서 B로 변경/새 확인 → 청크 1만 재전송을 확인했다. 총 요청 4개, 다른 청크·기존 수정 버전·원본 결과 2개 보존을 검증했다.
- 사용량/원본/편집 모달과 삭제 확인을 실제 열었다. 모바일 표는 화살표 키로 좌우 탐색, modal 내부 가로 넘침 없음. 삭제 취소 후 유지, 확정 후 해당 메모 제거, 재로드/잠금 해제 후 다른 메모 유지 확인. 페이지 오류 0, 외부 HTTPS 0, 실제 제공사 전송 0.
- 캡처를 시각 확인했다. [전사](1440-stt.png), [원본](1440-chunk.png), [전체 편집](1440-review.png), [모델 변경](1440-retry-model.png), [명세](1440-usage.png), [모바일 명세](390-usage.png), [모바일 편집](390-review.png), [삭제 확인](1440-delete.png), [원본 파형](1440-source-preview.png), [모바일 파형](390-source-preview.png).

독립 읽기 전용 코드 검토에서 조치할 P1/P2 없음. 새로 추가한 일반 취소 시 파형 로딩 상태를 정리하는 회귀는 RED를 확인한 뒤 수정해 통과했다.

## 한계와 기존 실패

실제 인증 STT/LLM·제공사 보관/경로 수용·청구·실제 회의의 전사/정리 품질·물리 모바일/마이크·전체 스위트는 미검증이다. 계정의 ZDR 때문에 해당 모델이 계속 거절될 수 있으며 정책을 자동 완화하지 않는다. 보관 원본 재생 복원의 64MiB 한계가 있다.

기존 장시간 screen-lock E2E는 휠 이벤트/현재 제거된 문구 기대에서 통과하지 않았으며 새 타이머 배치·자동/수동 잠금의 별도 검증과 구분한다. 기존 OpenRouter 모델 수정 UI의 정책 테스트 3개는 이미 API 키 화면으로 옮겨진 필드를 기대하므로 실패했다. 이번 영향 범위의 STT 필터는 통과했으며 무관한 테스트 전체를 실행하거나 통과로 표시하지 않았다. 정확한 초기 harness/환경/fixture 실패는 각 상세 보고서에 보존했다.

main 자동 배포와 운영 화면의 제한된 스모크를 확인했다. [정확한 SHA·활성 버전·운영 캡처와 환경상 미검증 범위](release/README.md)를 따른다.
