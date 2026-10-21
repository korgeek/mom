# 업로드 파일 요약과 청크 준비 상태 정리

2026-10-17 Asia/Jakarta. 기준 HEAD `eca55da`. [사용자가 요청한 화면 정리](../../../11-design-reference-review.md#2026-10-17-업로드-요약과-준비-상태-정리).

## 변경 범위

- `src/react-app/ui/screens/Import.tsx`: 업로드 완료 후 파일명·용량·교체 요약 표시. 마이크 탭도 같은 요약 영역에 상태 왼쪽/새 메모 액션 오른쪽 배치. 정상 원본의 긴 중복 안내 제거. 원본 삭제/미확인 경고 유지. 재생 URL이 없는 보관 원본에만 `미리듣기용 파일 선택` 표시. 새로고침 후 준비 완료 표시도 청크 수·실제 encodedBytes 합계의 작은 요약으로 표시. 마지막 사용자 지정 문구 “음성 준비는 로컬 브라우저에서 진행돼요. 전사는 다음 단계에서 지정된 STT를 이용해서 실행해요.” 반영.
- `src/react-app/ui/PreparationStatus.tsx`: 처리 시간과 저장된 청크 수를 보조 크기로 정리하고 `청크 용량`을 바로 옆에 표시. 용량 전용 details 제거. 진행 시간·계획 미확인·완료·실패·실제 저장 완료량의 의미 유지.
- `src/react-app/ui/styles.css`: 두 입력 탭의 공통 요약 영역, 좁은 화면에서도 액션 버튼 줄바꿈 방지, 청크 요약 12px/줄바꿈 처리.
- `tests/ui.spec.tsx`, `tests/storage-ui.spec.tsx`: 파일 요약·미리듣기 파일 선택과 삭제/보존 경계·접힌 영역 밖의 준비 용량 검사. 직접 영향 검사 안의 오래된 준비 버튼 이름도 현재 이름으로 갱신.
- `tests/e2e/upload-summary.spec.ts`: 업로드 → 준비 완료 → 화면 너비 변경 → 새로고침 → 같은 파일로 미리듣기 연결 → 교체의 한 실제 로컬 흐름. 두 너비에서 교체/새 메모 액션의 오른쪽 끝 위치도 실제 비교.
- E2E 호출자: 파일명이 입력 요약과 준비 상세 두 곳에 표시되므로 `endpoint-limits.spec.ts`, `flow.spec.ts`, `m4a.spec.ts`, `minutes-comparison.spec.ts`, `model-modalities.spec.ts`, `preparation-progress.spec.ts`, `recovery.spec.ts`, `stt-rerun.spec.ts`, `workflow.spec.ts`의 파일명 검사를 준비 영역으로 한정했다. `preparation-layout.spec.ts`의 기존 마이크 차단 기대를 최신 새 메모 동작에 맞췄다. 이 기존 시나리오들은 타입·린트 검사만 했고 전체 실행하지 않았다.
- 문서: 이 증거 폴더와 `docs/README.md`, `docs/11-design-reference-review.md`.

컨트롤러의 실제 바이트 일치 확인, 파일/청크 저장, 암호화·잠금·제공사 요청은 변경하지 않았다. `청크 용량`은 저장 완료된 인코딩 청크 바이트이며 원본 파일 크기나 실제 디스크/암호문 오버헤드 크기가 아니다. 기존 사용자 `src/react-app/App.tsx` 수정은 보존하고 커밋에서 제외한다. 새 의존성·실제 키·사용자 파일 없음.

## 실행한 검사

| 명령 | 결과 |
| --- | --- |
| `npx vitest run tests/ui.spec.tsx -t 'reselects an existing original\|separates real source time'` | RED 4: 업로드 파일 요약/새 미리듣기 동작 및 바로 표시된 청크 용량 없음 |
| `npx vitest run tests/ui.spec.tsx -t 'groups recording and upload tabs\|reselects an existing original\|separates real source time'` | 5 PASS / 94 제외. 마지막 준비 완료 JSX 정리 후 직접 영향을 받는 `-t 'groups recording and upload tabs'` 1건만 재실행해 PASS |
| `npx vitest run tests/storage-ui.spec.tsx -t 'original-byte loss\|allows local reprepare'` | 2 PASS / 10 제외. 삭제된 원본 연결 차단과 보관 원본 재준비/기록 보존 |
| `npx eslint src/react-app/ui/PreparationStatus.tsx src/react-app/ui/screens/Import.tsx tests/ui.spec.tsx tests/storage-ui.spec.tsx tests/e2e/upload-summary.spec.ts tests/e2e/endpoint-limits.spec.ts tests/e2e/flow.spec.ts tests/e2e/m4a.spec.ts tests/e2e/minutes-comparison.spec.ts tests/e2e/model-modalities.spec.ts tests/e2e/preparation-layout.spec.ts tests/e2e/preparation-progress.spec.ts tests/e2e/recovery.spec.ts tests/e2e/stt-rerun.spec.ts tests/e2e/workflow.spec.ts` | PASS. 후속 수정한 Import/새 E2E는 해당 파일만 재검사 |
| `npx tsc --project tsconfig.e2e.json --noEmit` | 최종 PASS |
| `npm run build` | 최종 PASS. 기존 큰 bundle·미디어 혼합 import 경고 유지 |
| `npm run test:secret` | 최종 PASS. 소유 소스·공개 자산·client build 검사, 일치값 미출력 |
| `npm run test:e2e -- tests/e2e/upload-summary.spec.ts` | 최종 1 PASS. 처음에는 홈 열기 버튼의 접근성 이름 선택자가 잘못되어 FAIL. 선택자 수정 후 통과. 360px 캡처에서 교체 글자 줄바꿈을 고치고 새로고침 준비 요약도 맞춘 뒤 최종 빌드의 이 한 흐름만 재검사 |
| `git diff --check` | PASS |
| `node /tmp/mom-upload-summary-doc-check.mjs` | 로컬 문서 3개의 링크·앵커 57개 PASS. 레퍼런스 원본 6개의 SHA-256 일치 |

최종 관련 단위 7건과 브라우저 한 흐름을 확인했다. 바뀌지 않은 녹음·저장 코어는 [이전 검증](../2026-10-17-recording-input/README.md)을 재사용했고 전체 화면·전체 스위트·기존 대형 E2E 행렬은 반복하지 않았다. 검사 중 들어온 사용자 추가 요청(액션 오른쪽 정렬, 지정 문구)을 최종 빌드에 반영해 동일 한 흐름의 검사·캡처만 갱신했다.

## 실제 브라우저

별도 가시적 로컬 Chrome, `127.0.0.1:4174`의 최종 preview build. 한국어 1440×900 → 같은 입력 화면 360×800 → 다시 1440×900. 시험 WAV의 파일명·31.3 KB·교체, 정상 미리듣기, 긴 중복 안내 없음 → 실제 WAV→MP3 로컬 준비·암호화 저장 → 청크 수·실제 준비 용량 표시와 12px 글꼴/접힘 없음 → 가로 넘침/교체 글자 줄바꿈 없음 → 새로고침·보관함 잠금 해제 → 같은 파일을 명시적으로 선택해 미리듣기 연결 → 준비된 청크 유지/전사 이동 가능 → 교체 후 파일 선택 상태를 확인했다. 외부 HTTPS를 빈 공개 카탈로그/차단으로 격리했으며 실제 추론 요청·마이크 사용은 없다. 캡처를 직접 열어 확인했다.

- [업로드 및 준비 완료](1440-ko-prepared.png)
- [좁은 화면의 파일 요약·청크 용량](360-ko-prepared.png)
- [같은 오른쪽 위치의 마이크 액션](1440-ko-microphone-action.png)
- [좁은 화면의 마이크 액션](360-ko-microphone-action.png)
- [새로고침 후 필요한 경우만 미리듣기 파일 선택](1440-ko-preview-needed.png)

실제 사용자 오디오·물리 마이크·인증된 AI·전체 제품 회귀·푸시·배포는 확인하지 않았다.
