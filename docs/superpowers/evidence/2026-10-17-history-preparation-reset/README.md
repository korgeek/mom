# 처리 기록·홈 페이지·명시적 청크 재준비

2026-10-17 Asia/Jakarta. 기준 HEAD `2ff9262`. [확정 사용자 결정](../../../11-design-reference-review.md#2026-10-17-처리-기록과-명시적-청크-초기화).

## 변경 파일과 동작

- `ui/screens/History.tsx`, 새 `ui/Pagination.tsx`, `ui/screens/history-listing.css`, `usage/history.ts`: 처리한 메모 목록 → 메모별 호출 상세를 구분한다. 실제 처리 시각순, 메모 15개/호출 15개 페이지, 전체/STT/LLM 필터, 실제 요청 수·모델 이름·상태·측정값을 보여준다. 없는 시각·비용·제공사를 만들어 표시하지 않는다. 이전 기록은 초기화/결과 삭제와 당시 상태를 구분한다. 단위·통화·보고/추정 종류를 유지하며 임의 비용 합산을 하지 않는다.
- `ui/screens/Home.tsx`: 미처리 메모를 포함해 최근 수정순 15개씩 표시하고 각 메모 처리 기록에 연결한다. 기존 열기/이름 변경/삭제/고정 동작은 유지한다.
- `App.tsx`: 전체 개수의 버튼·화살표 제거, 전용 준비 설정/확인 모달의 초점 소유를 보장한다. 새 화면 제어 타입을 추가했다. 기존 사용자 보관함 문구 두 수정은 작업 트리에 그대로 남기고 커밋에서는 제외한다.
- `ui/screens/STT.tsx`, `Import.tsx`: 청크 요약 옆 연필 → 음성 준비에서 청크·압축 펼침/스크롤/초점. 인코딩은 초안/변경 적용/취소로 다룬다. 기존 준비가 있으면 초기화 범위와 되돌릴 수 없음을 확인한 후 진행한다. 원본 부재와 처리 중 적용은 차단한다. 언어/힌트 변경은 이 초기화를 하지 않는다.
- `controller.tsx`: 메모별/전체 처리 기록 이동을 구분한다. 완료된 pending 변경을 먼저 저장하고 계획/확인/초기화/로컬 재인코딩을 연결한다. 오래된 UI의 단순 encoding 변경은 준비된 청크가 있으면 거절한다. 잠금에서 계획·편집 상태를 제거한다. 새 유료 요청은 자동 실행하지 않는다.
- `domain/types.ts`, `usage/statement.ts`: UsageHistoryItem 타입을 공통 계약으로 옮기되 이전 import를 재수출한다. `processingArchives?`는 원시 발화/정리/응답을 포함하지 않는 호출·사용량 메타데이터와 청크 범위다. 현재 사용량 집계는 현재 세대만 계산하고 처리 기록에서만 과거 메타데이터를 합친다.
- `vault/store.ts`, `session.ts`, 새 `vault/preparation-reset.ts`: 정확한 옵션/소유 저장 버전과 단회 토큰을 묶는다. 실제 보관된 원본 블록을 제한된 버퍼로 인증하고, 소유 청크 암호문 삭제 + 암호화 프로젝트/카탈로그 교체를 한 transaction으로 처리한다. 원본·다른 메모·키는 유지한다. 결과 원문/수정본/비교/오류 응답은 제거하고 메타데이터만 남긴다. 잘못된/재사용/오래된 확인, 원본 손상·소유권 충돌, 실행/녹음/저장 중, 잠금/취소와 transaction 실패는 기존 자료를 보존한다.
- 새 시험: `history-listing.spec.tsx`, `preparation-reset-ui.spec.tsx`, `preparation-reset-vault.spec.ts`, `preparation-reset-controller.spec.tsx`, `e2e/history-reset.spec.ts`. 직접 영향받는 `ui.spec.tsx`, `usage-ui.spec.tsx`의 이전 화면 기대만 갱신한다. 문서는 이 기록, `docs/README.md`, `docs/02-architecture-and-data.md`, `docs/11-design-reference-review.md`.

제품/시험 경로는 `src/react-app/`와 `tests/` 기준이다. 의존성 설치, 실제 키 조회/입력, 외부 유료 추론, 푸시·배포 없음.

## 선별 검사 명령·결과

처리 기록/홈 목록 작업, 준비 UI, vault 초기화는 허용된 서브 에이전트 3개로 분리하고 부모가 공통 계약/controller·브라우저·문서를 연결했다. 전체 저장소 스위트나 다른 화면 전수검사는 실행하지 않았다. 같은 코드의 통과 검사는 재사용했다.

| 명령 | 실제 결과 |
| --- | --- |
| `npx vitest run tests/history-listing.spec.tsx tests/home-status.spec.tsx tests/usage-ui.spec.tsx` | 37 PASS. 이전의 모든 상세 펼침/미확인 placeholder 기대 2건을 승인한 목록→상세와 알려진 정보 표시로 보완한 최종 결과 |
| `npx vitest run tests/history-listing.spec.tsx -t 'shows recorded STT/LLM counts'` | 목록 요청 수/최신 상태 추가 2 PASS / 7 제외 |
| `npx vitest run tests/preparation-reset-ui.spec.tsx` | 초기 9 PASS / App heading 초점이 상세/모달 초점을 덮는 2 FAIL. App의 해당 화면 초점 소유를 보완 |
| `npx vitest run tests/preparation-reset-ui.spec.tsx -t 'opens, scrolls\|describes the exact destructive'` | 실패했던 2 PASS / 9 제외. 다른 9개는 동일 구현의 통과 근거 재사용 |
| `npx vitest run tests/preparation-reset-vault.spec.ts tests/storage-management.spec.ts` | 최초 38 PASS. 이후 새 초기화 시험에 source 인증 도중 취소/잠금 2건을 추가 |
| `npx vitest run tests/preparation-reset-vault.spec.ts` | 최종 13 PASS. 기존 저장 관리 27 PASS 근거 재사용. 오류 응답 본문 제거의 새 회귀 검사는 실패를 확인한 후 제거 로직을 보완해 통과 |
| `npx vitest run tests/preparation-reset-controller.spec.tsx tests/history-listing.spec.tsx tests/ui.spec.tsx -t 'resets only confirmed\|opens per-memo\|sidebar total\|five, ten\|legacy spoken\|allows encoding drafts'` | sidebar/새 draft 2 PASS, 새 core fixture의 Node Worker 부재 2 FAIL, Apply selector 옛 이름 2 FAIL. 시험에 기존 createLocalMediaWorker를 지정하고 실제 Apply changes 이름으로 수정 |
| `npx vitest run tests/preparation-reset-controller.spec.tsx tests/ui.spec.tsx -t 'resets only confirmed\|opens per-memo\|five, ten\|legacy spoken'` | 수정 후 4 PASS / 98 제외. 실제 vault·합성 WAV 재인코딩·원본 보존·과거 청크 삭제·호출 수 유지·reload/잠금 복원 |
| `npx vitest run tests/history-listing.spec.tsx -t 'preserves archived\|shows recorded\|sidebar total'` | 3 PASS / 6 제외. 마지막 문구 ‘당시 저장됨’ 구분 후 알려진 요청 상태/정보 개수 검사 |
| `npx vitest run tests/preparation-reset-controller.spec.tsx -t 'resets only confirmed'` | 최종 1 PASS / 1 제외. 초기화 후 raw 결과가 없는 새 준비에도 확인 없는 인코딩 변경 차단, 언어/힌트 변경은 새 파일/아카이브 유지. 해당 시험 파일 ESLint도 PASS |
| `git diff --name-only -- '*.ts' '*.tsx' \| xargs npx eslint` 및 새 파일 명시 ESLint | 오류 0. 기존 App exported preferences의 react-refresh/only-export-components 경고 1개 유지. 각 서브 에이전트 소유 파일 scoped ESLint도 PASS |
| `npx tsc -b`, `npx tsc --project tsconfig.e2e.json --noEmit` | 최종 PASS. 공통 타입 이동 후 미사용 import와 DOM 시험의 Playwright 전용 exact 옵션을 수정 |
| `npm run build` | 최종 PASS. 기존 미디어 혼합 import/500k 이상 bundle 경고 유지 |
| `npm run test:secret` | 최종 PASS. 소유 소스/정적 자산/최종 client build, 일치값 미출력 |
| `npm run test:e2e -- tests/e2e/history-reset.spec.ts` | 최종 별도 headed Chrome 1 PASS, 시험 3.6초/전체 5.2초. 처음에는 제품의 ‘초기화 이전’과 시험의 ‘초기화 전’ 문구 차이로 끝부분에서 실패; 실제 문구에 맞춰 해당 흐름만 재실행 |
| `git diff --check` | PASS |
| `node /tmp/mom-history-reset-doc-check.mjs` | 문서 4개의 로컬 링크/앵커 76개 PASS, 원본 참고자료 6개 SHA-256 불변 |

## 실제 브라우저

preview `127.0.0.1:4174`, 별도 보이는 Chrome. 실제 합성 1초 WAV 로컬 준비와 시험이 가로챈 무인증 localhost STT 1회/Notes 1회만 사용한다. HTTPS는 빈 공개 카탈로그 외 차단한다. 이 두 요청은 setup이며 실제 모델 서버 추론/제공사 CORS/인증의 근거가 아니다.

1440×900에서 메모별 처리 기록 진입·STT/LLM 필터 → 전사 화면 연필 → 열린 설정의 스크롤/키보드 초점 → 10분 변경 → 영구 삭제 범위 확인 → 취소 후 Notes 원본 보존 → 다시 확인/초기화/재준비 → 전사 결과 0/1·Notes 비어 있음 → 과거 2개 호출·범위·당시 상태 보존을 확인했다. 재준비 후 제공사 요청이 늘지 않았다. reload/해제 후 새 청크와 과거 이력은 보존됐다.

홈에는 추가로 만든 미처리 메모를 포함해 16개를 두 페이지(15+1)로 렌더링하고 이전 메모의 기록 상세로 연결했다. 전체 메모 수는 DIV이고 화살표/링크가 없다. 처리 기록 목록에는 처리한 메모 1개만 나타난다. 360×800에서도 상세·필터·초기화 이전 표시와 가로 넘침 없음을 확인했다. pageerror 0.

직접 열어 정렬·글꼴·팔레트·문구를 확인한 캡처:

- [처리한 메모 목록](1440-ko-history-list.png)
- [메모별 호출 상세](1440-ko-history-detail.png)
- [초기화 확인 범위](1440-ko-reset-confirmation.png)
- [좁은 화면 상세](360-ko-history-detail.png)
- [홈 15개 페이지](1440-ko-home-page-1.png)

처리 기록의 15개 메모/15개 호출 페이지는 DOM 단위 시험으로 확인했고, 실제 브라우저 기록은 메모 1개/호출 2개다. 물리 모바일/마이크, 실제 회의·키·인증된 STT/LLM/청구, 장시간 파일, 전체 잠금/다중탭/복구 행렬과 운영 배포는 검증하지 않았다. 파일 삭제 transaction이 끝난 뒤 새 인코딩이 실패하면 삭제는 되돌리지 않으며 원본과 처리 메타데이터로 다시 준비한다. 확인 화면은 초기화가 되돌릴 수 없음을 먼저 알린다.
