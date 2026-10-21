# 설정·전사 재시도 보안 재검증

2026-10-17. 사용자가 수정·커밋·보안 재검증·main 푸시와 배포를 요청했다. 시작 기준 `e1398bb04a613d0f973125759e5a5597bb60a8bc`, main/origin/main/실제 원격 main 일치, 작업 트리 깨끗함. 이전 [설정 통합 검증](../2026-10-17-memo-appearance/README.md)의 UI 실패도 이번에 해결했다.

## 수정과 범위

- `src/react-app/ui/screens/STT.tsx`: 최신 요청의 원시 결과와 일치하는 암호화 저장 영수증이 있으면 늦게 남은 실패 진행 상태보다 완료 상태를 우선한다. 열린 실패 재시도 창에서도 전송을 차단한다. 이전 저장 결과 뒤에 새로운 실패 요청이 있으면 그 요청은 계속 명시적으로 재시도할 수 있다. 별도 재전사 동의와 버전 보존 경계는 유지한다.
- `tests/ui.spec.tsx`: 기존 10개 실패의 오래된 모델 문구·접힌 관리 화면 선택자·음성 보관 여부 fixture·진행 문구를 현재 계약에 맞췄다. 필요한 fixture에만 실제 보관 상태를 명시했고 안전성 기대값을 삭제하지 않았다. 복구된 검사가 위 재시도 문제를 재현했다. 저장 후 차단과 이전 결과를 보존한 새 실패의 재시도를 함께 검사한다.
- `tests/stt-rerun-ui.spec.tsx`: 보관 중인 음성을 합성 fixture에 명시해 추가 요금 동의·고정 경로/언어·키 누락 차단 검사가 실제로 동작하도록 했다.
- `tests/settings-lists.spec.ts`, `tests/e2e/selection-list-security.spec.ts`: prototype 키/미등록·중복 아이콘, 실행 가능한 색상 문자열, 비밀값·알 수 없는 필드 거부를 검사한다. 허용된 표시 이름의 HTML 형태 문자열은 텍스트로 표시된다. 내보내기는 허용된 목록만 포함하며 잠금 시 편집 입력·목록이 DOM에서 사라지고 재로드/잠금 해제 뒤 저장값이 복원된다.

설정 파일 크기·UTF-8·형식/버전·필드·아이콘 allowlist·색상·언어 코드/이름 검증, 암호화 Catalog 저장/실패/재시도/소유권, 잠금 중 새 작업 차단·늦은 응답 경계를 따라 읽었다. 새 의존성·암호 구성·보안 헤더 변경은 없다. 실제 제공사 키나 개인 음성은 사용하지 않았다.

## 실제 명령과 결과

변경과 직접 연결된 UI·설정·저장·잠금·재시도만 검사했다. 전체 스위트는 실행하지 않았다.

| 명령 | 결과 |
| --- | --- |
| `npx vitest run tests/ui.spec.tsx` | 시작 10 FAIL/87 PASS → 최종 **98 PASS**. fixture 수정 후 저장 완료와 늦은 실패 상태가 공존하는 재시도 검사가 RED, 제품 수정 후 GREEN. |
| `npx vitest run tests/ui.spec.tsx -t 'keeps a newer failed attempt'` | 저장 결과가 있으면 무조건 제외하는 초안은 RED. 최신 요청의 영수증만 우선하는 최종 수정으로 위 98개 검사에서 GREEN. |
| `npx vitest run tests/settings-lists.spec.ts tests/settings-lists-persistence.spec.ts tests/settings-lists-controller.spec.ts tests/lock.spec.ts tests/vault-model-registry.spec.ts` | 최초 64 PASS, 새 입력 경계 검사 포함 최종 **65 PASS**. |
| `npx vitest run tests/settings-lists.spec.ts tests/settings-lists-persistence.spec.ts tests/settings-lists-controller.spec.ts tests/stt-rerun-ui.spec.tsx` | 오래된 재전사 fixture로 5 FAIL/33 PASS. 다음 행으로 해당 파일 수정·재검증. |
| `npx vitest run tests/stt-rerun-ui.spec.tsx` | 음성 보관 fixture 수정 후 **6 PASS**. |
| `npx vitest run tests/vault.spec.ts -t 'altered\|roundtrips\|fresh IVs\|operation limit'` | **6 PASS**, 14 skip. 변조 거부·암호화 키/영수증 왕복·새 IV·작업 한도. |
| `node --test tests/artifacts.test.mjs` | **3 PASS**. |
| `npm audit --omit=dev --json` | 운영 의존성 알려진 취약점 **0**. 개발 의존성/미공개 취약점의 부재를 보증하지 않는다. |
| `npm run build` | PASS. JS `index-CjUmcgNV.js`, CSS `index-DB69GK_V.css`. 기존 mixed media import/큰 chunk 경고 유지. |
| `npx tsc --noEmit -p tsconfig.tests.json && npx tsc --noEmit -p tsconfig.e2e.json && npm run test:secret && git diff --check` | PASS. 앱 타입 검사는 build에 포함. 공개 소스·정적 자산·최종 빌드 검사에서 비밀값 패턴/fixture/평문 Web Storage 쓰기/공개 소스맵 탐지 없음. |
| `npx playwright test --config playwright.config.ts tests/e2e/selection-lists.spec.ts tests/e2e/selection-list-security.spec.ts tests/e2e/stt-rerun.spec.ts --grep 'ko 1440\|settings reject executable\|explicit saved-chunk rerun'` | **3 PASS**, 12.8초. 별도 headed Chrome, 한국어 1440×900 합성 보관함. |

Chrome에서 설정 편집·복원·새/이전 JSON·프롬프트 복사·메모 선택 반영·잠금/재로드를 확인했다. 설정 검사에서는 외부 HTTPS 요청과 JS 대화상자 0, pageerror 0. 전사 검사는 생성한 음성·가짜 키·차단/대체한 제공사 응답을 사용했다. 재전사·결과 불명 재시도·원본/수정본/정리 노트 보존·고정 요청 언어·암호문 sentinel 누출 없음·잠금 후 늦은 결과 폐기를 확인했으며 pageerror 0이었다. 실제 인증/요금/추론 품질 검증은 아니다.

직접 본 화면:

- [가져온 이름의 안전한 텍스트 표시](escaped-name.png)
- [잠금 후 편집 화면 제거](locked.png)
- [새 실패 요청과 이전 저장 결과 보존](retained-results.png)
- [재시도 후 버전·요청 이력](retry-history.png)

원본 레퍼런스 6개 파일의 SHA-256과 경로 집합은 작업 전 스냅샷과 동일하다. 실행 코드 변경은 `STT.tsx` 한 파일, 직접 변경된 테스트는 위 4개다. 문서 변경은 이 기록·이전 기록의 해결 상태·결정/레퍼런스 문서의 연결이다.

운영 사이트 `curl --silent --show-error --head https://mom.korgeek.workers.dev/` 결과 HTTP 200과 CSP, `nosniff`, `no-referrer`, COOP `same-origin`, 카메라/위치/결제 제한 및 마이크 self 정책을 확인했다. 헤더 존재만으로 전체 보안을 보증하지 않는다. 전수 침투 테스트, 전체 스위트, 실제 인증 AI·음성 품질 및 메모리 완전 삭제는 검증하지 않았다.

## 푸시·운영 배포 확인

수정 커밋 `8dc671760af2bada81a97edaf3be05b9c74877ea`을 main에 푸시했다. `gh api repos/korgeek/mom/commits/8dc671760af2bada81a97edaf3be05b9c74877ea/check-runs`에서 `Workers Builds: mom`의 `completed/success`를 확인했다.

운영 Chrome의 사용자 탭에서 새로고침 후 JS `index-CjUmcgNV.js`와 CSS `index-DB69GK_V.css`가 로컬 최종 빌드와 일치함을 DOM에서 확인했다. 제공된 테스트 암호로 잠금을 해제하고 1492×1103 화면에서 설정의 테마·UI 언어·아이콘/색상/언어 목록과 전사 화면을 직접 봤다. 파일·모델이 없는 상태의 전사 실행은 비활성이다. 다시 잠근 뒤 `main`과 `#settings-panel`이 모두 DOM에 0개임을 확인했다.

운영 화면·언어 설정과 전사 화면의 스크린샷은 로컬 검증 자료로만 보관한다. 자동 승인 검토가 인증된 운영 화면 스크린샷의 GitHub 전송을 민감정보 외부 전송 승인 부족으로 차단했으므로, 이 텍스트 기록만 추가로 푸시한다. 위 합성 브라우저 화면은 실제 사용자 데이터가 없다.

기존 사용자 제목·본문·키·설정은 편집하지 않았다. 저장된 제목 `새 회의`는 사용자 데이터로 보존되어 화면에 남는다. 실제 운영 AI 요청이나 유료 재시도는 하지 않았다. 경합·결과 보존 검증은 위 로컬 합성 브라우저 검사이며 운영 확인은 자산·표시·탐색·실행 차단·잠금의 smoke 검사다.
