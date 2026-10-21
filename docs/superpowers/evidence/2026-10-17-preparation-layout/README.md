# 음성 준비 화면 재배치 · 로컬 검증

검증일: 2026-10-17, Asia/Jakarta. [승인한 설계](../../../11-design-reference-review.md#2026-10-17-음성-준비-화면-재배치-승인) · [구현 계획](../../../12-implementation-plan.md#2026-10-17-음성-준비-화면-재배치-구현-계획)

## 변경 범위

사용자가 설계 승인 후 제품 구현과 관련 테스트·실제 브라우저 확인을 직접 요청했다. 기준 HEAD는 `4327b5c8f8fe410a84d2230393a0485a9e6a6f7a`다. 기존 `src/react-app/App.tsx`의 사용자 문구 수정은 보존하고 이번 커밋에서 제외한다. 원격 갱신·main 푸시·배포는 수행하지 않는다.

- `src/react-app/ui/screens/Import.tsx`: 왼쪽 메모 정보, 오른쪽 준비·전사 → 녹음 → 업로드. 기존 파일 선택·미리듣기·설정·취소·활성 조건을 재사용한다. 청크·압축 요약은 항상 표시하고 설정만 접는다. 전사 버튼은 전송 확인 화면으로 이동한다.
- `src/react-app/ui/styles.css`: 본문 약 40:60, 960px 이하 한 열, 카드 제목과 간격·버튼·접기 조작 정리. 기존 글꼴·팔레트 유지.
- `src/react-app/ui/RecordingControls.tsx`: 공통 전사 설명 중복을 제거한다. 녹음 권한·암호화 저장 안내와 실패·중단·저장 상태는 유지한다.
- `tests/ui.spec.tsx`, `tests/recording-ui.spec.tsx`: 준비/전사 이동 조건·영역 순서·언어 안내·녹음 안내 검증.
- `tests/e2e/preparation-layout.spec.ts`: 이번 화면의 키 없는 로컬 브라우저 검증. `copy-placement.spec.ts`의 언어 안내 선택자를 갱신하고, `helpers.ts`·`preparation-progress.spec.ts`·`unified-model-management.spec.ts`·`workflow.spec.ts`의 `전사하기 →` 선택자를 갱신한다.
- 문서: `docs/09-decisions-and-roadmap.md`, `docs/11-design-reference-review.md`, `docs/12-implementation-plan.md`, `docs/README.md`, `docs/TODO.md`와 이 증거 폴더.

새 의존성·암호화/저장 형식·청크 기본값·제공사 호출 계약·자유 입력 STT 힌트는 추가하거나 변경하지 않았다. 준비 정보에 표시하는 길이·용량·진행률·저장 청크는 실제 파일/기존 처리 상태를 사용한다.

## 실행한 명령과 결과

| 명령 | 결과와 범위 |
| --- | --- |
| `npx vitest run tests/ui.spec.tsx -t 'import configuration'` | 최초 3 FAIL / 11 PASS: 새 영역 배치·언어 안내가 구현 전이어서 실패. 구현 후 최종 14 PASS / 85 제외. 준비 전/후/작업 중 버튼, 전사 이동만으로 추론 미실행, 제목 포커스·복수/기존 언어·처리 설정 잠금·미리듣기 수명 포함 |
| `npx vitest run tests/recording-ui.spec.tsx` | 24 PASS. 권한 요청·취소·일시정지·저장 완료 판정·녹음 제한·오류·중단 저장분 포함 |
| `npm run build` | 최종 PASS. 새 테스트의 누락된 `encodingOffsetMs`와 Testing Library의 잘못된 `exact` 옵션을 수정한 뒤 통과. 기존 미디어 모듈의 혼합 import와 500 kB 초과 번들 경고는 남음 |
| `npx tsc --project tsconfig.e2e.json --noEmit` | PASS. 직접 수정한 E2E 파일과 연결 도우미 타입 확인 |
| `npx eslint src/react-app/ui/screens/Import.tsx src/react-app/ui/RecordingControls.tsx tests/ui.spec.tsx tests/recording-ui.spec.tsx tests/e2e/preparation-layout.spec.ts tests/e2e/copy-placement.spec.ts tests/e2e/helpers.ts tests/e2e/preparation-progress.spec.ts tests/e2e/unified-model-management.spec.ts tests/e2e/workflow.spec.ts` | PASS. 변경한 제품/테스트 TypeScript 범위 |
| `npm run test:secret` | PASS. 소유 앱 소스·정적 자산·최종 client build의 검사 패턴 일치 없음. 일치값 미출력 |
| `npm run test:e2e -- tests/e2e/preparation-layout.spec.ts` | 최초 6 PASS. 마지막 접기 표시 수정 전 근거이므로 최종 화면 근거는 다음 실행 사용 |
| `npm run test:e2e -- tests/e2e/preparation-layout.spec.ts tests/e2e/copy-placement.spec.ts` | 재배치 7 PASS. 기존 문구 회귀 4건은 모델 미선택 상태에서 OpenAI 경로를 기대하던 이전 가정으로 FAIL. 변경하지 않은 `STT.tsx`의 현재 동작인 `모델 선택 후 확인`으로 테스트 기대만 교정 |
| `npm run test:e2e -- tests/e2e/copy-placement.spec.ts` | 4 FAIL. 이어서 기존 라이선스 영역이 `region`에서 `navigation`으로 바뀐 선택자를 수정하고, 현재 잠금 화면의 한국어 브랜드 기대도 맞춤. `Settings.tsx`·`App.tsx`의 제품 동작은 수정하지 않음 |
| `npm run test:e2e -- tests/e2e/copy-placement.spec.ts --grep 'ko 360'` | 최종 한국어 모바일 1 PASS (2.6초) |
| `npm run test:e2e -- tests/e2e/copy-placement.spec.ts --grep 'ko 1440\|en 360\|en 1440'` | 나머지 3 PASS (5.2초). 위 1건은 동일 코드·빌드·환경 근거를 재사용해 반복하지 않음 |
| `node /tmp/mom-preparation-doc-check.mjs` | 변경 문서 6개의 로컬 링크·앵커 100개 PASS, 레퍼런스 6개의 SHA-256 원본 일치 |
| `git diff --check` | PASS |

최종 관련 단위 검증은 38 PASS, 브라우저 검증은 재배치 7건 + 문구 회귀 4건으로 11 PASS다. 최초 실패를 삭제하거나 통과로 바꾸지 않고 위에 분리 기록했다. 제품 코드는 마지막 접기 표시 수정 후 동일하며 문구 테스트만 교정했다. 최종 `copy-placement.spec.ts`의 ESLint와 E2E 타입 검사도 다시 통과했다.

최초 Playwright 실행은 샌드박스의 `0.0.0.0:9229` listen EPERM으로 서버 시작 전 실패했다. 허용된 로컬 서버·Chrome 실행 권한으로 같은 명령을 다시 실행했다. 제공사 인증·보안 설정 변경은 수행하지 않았다.

## 실제 브라우저 확인

Playwright 설정의 **별도 headful 로컬 Chrome**과 `127.0.0.1:4174` preview build를 사용했다. 실제 사용자 브라우저 보관함·파일·키는 사용하지 않았다. 각 테스트가 만든 합성 보관함과 WAV만 사용하고 외부 HTTPS 요청을 차단/격리했다. 실제 제공사 추론 요청은 0건이다.

| 실제 렌더링 | 확인한 상태·행동 |
| --- | --- |
| 1440×900, 한국어·영어 | 왼쪽/오른쪽 너비 약 40:60, 준비·전사 → 녹음 → 업로드의 실제 위치, 빈 상태, 키보드로 언어/처리/지원 형식 접기, 긴 제목·파일명, 실제 WAV→MP3 준비·암호화 저장, 전사 확인 진입과 실행 차단, 잠금 후 민감 UI 제거 |
| 360×800, 한국어·영어 | 같은 상태·조작, 한 열 순서, 줄바꿈·가로 넘침 없음, 하단 업로드·미리듣기 영역 접근 |
| 960×900, 한국어 | 한 열 전환과 같은 화면 조작·파일 준비 흐름 |
| 1440×1100, 한국어 | 전체 카드 배치를 보기 위한 추가 빈 화면 캡처 |
| 1440×900, 한국어 예외 | 301초 합성 WAV 준비 취소 → 다시 준비 → IndexedDB `records.put`의 시험용 용량 오류 → 미저장 전사 차단 → reload/unlock 후 보존된 원본에서 준비 재시도 가능. 시험용 `getUserMedia` 권한 거부도 녹음 카드 안에 표시되고 준비/전사는 비활성 유지 |

화면 캡처를 직접 열어 제목·여백·색상·카드 순서·접기 표시·한국어/영어 줄바꿈을 확인했다. 녹음 권한 거부는 시험용 오류 주입이며 물리 마이크나 OS 권한 설정을 바꾸지 않았다. 용량 오류도 시험용 저장 경계 오류이며 실제 디스크를 채우지 않았다.

- [데스크톱 전체 배치](1440-ko-overview.png)
- [데스크톱 한국어 빈 화면](1440-ko-empty.png) · [영어 빈 화면](1440-en-empty.png)
- [모바일 한국어](360-ko-empty.png) · [모바일 영어](360-en-empty.png) · [960px 한 열](960-ko-empty.png)
- [준비 완료](1440-ko-ready.png) · [업로드·미리듣기](1440-ko-upload.png)
- [저장 실패](1440-ko-storage-failure.png) · [마이크 권한 거부](1440-ko-microphone-denied.png)

## 확인 한계

전체 저장소/전체 테스트, 다른 브라우저·장비, 물리 마이크, 장시간 실녹음 품질, 실제 키·인증된 STT/회의록 생성·비용·운영 배포는 이번 범위에서 확인하지 않았다. 선택자 이름만 갱신한 다른 E2E 3개와 공유 도우미는 타입 검사했지만 전체 시나리오를 재실행하지 않았다. 이번 결과는 변경 화면의 로컬 준비/저장과 전사 확인 진입 근거이며 인증 추론 성공이나 전체 암호화 구현의 신규 감사 근거가 아니다.
