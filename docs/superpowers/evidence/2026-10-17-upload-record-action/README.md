# 업로드 후 마이크 탭의 새 음성 메모 동작

2026-10-17 Asia/Jakarta. 기준 HEAD `db8aad1`. [확정된 화면 동작](../../../11-design-reference-review.md#2026-10-17-업로드-후-마이크-탭).

## 변경

- `src/react-app/ui/screens/Import.tsx`: 현재 원본이 있고 녹음 스냅샷이 idle이면 마이크 탭에 짧은 안내와 `새 음성 메모 만들기`만 표시한다. 비활성 녹음 계기·시작 버튼은 숨기고 기존 새 메모 생성·busy 차단 동작을 재사용한다. 실제 녹음·저장·오류·중단 상태는 기존 컨트롤을 유지한다. 다른 차단 상태의 생성 버튼도 같은 이름으로 통일했다.
- `tests/ui.spec.tsx`: 해당 입력 탭 검사에 계기/시작 버튼 없음, 새 메모 동작 호출과 자동 녹음 없음, 현재 원본 유지 검사를 추가했다.
- `tests/e2e/recording-input.spec.ts`: 업로드 한 흐름에 간결한 마이크 탭, 새 메모 생성 후 명시적 시작 대기, 이전 메모로 돌아가 원본이 보존됨을 확인했다. 기존 녹음 흐름 호출자의 한국어 버튼 이름도 갱신했으며 해당 녹음 흐름은 재실행하지 않았다.
- 문서: 이 기록과 `docs/README.md`, `docs/11-design-reference-review.md`.

녹음 코어·컨트롤러·저장 형식·암호화·CSS는 변경하지 않았다. 기존 사용자 `src/react-app/App.tsx` 수정은 보존하고 커밋에서 제외했다. 키·실제 사용자 파일·새 의존성·운영 변경 없음.

## 실행한 관련 검사

| 명령 | 결과 |
| --- | --- |
| `npx vitest run tests/ui.spec.tsx -t 'groups recording and upload tabs'` | 추가 검사 RED 1(계기가 남아 있음) → 구현 후 최종 1 PASS / 98 제외 |
| `npx eslint src/react-app/ui/screens/Import.tsx tests/ui.spec.tsx tests/e2e/recording-input.spec.ts` | PASS |
| `npx tsc --project tsconfig.e2e.json --noEmit` | PASS |
| `npm run build` | 최종 PASS. 처음에는 단위 테스트의 미지원 `exact` 옵션 타입 오류; 제거 후 해당 테스트·린트·빌드만 재검사. 기존 bundle 크기·미디어 혼합 import 경고 유지 |
| `npm run test:secret` | PASS. 소유 소스·공개 자산·최종 client build, 일치값 미출력 |
| `npm run test:e2e -- tests/e2e/recording-input.spec.ts --grep 'keyboard tabs preserve uploaded audio'` | 1 PASS (3.7초). 별도 가시적 로컬 Chrome에서 업로드 한 흐름만 실행 |
| `git diff --check` | PASS |
| `node /tmp/mom-upload-action-doc-check.mjs` | 문서 3개의 로컬 링크/앵커 52개 PASS. 레퍼런스 6개의 SHA-256 일치 |

## 실제 브라우저

최종 preview build, `127.0.0.1:4174`. 영어 360×800에서 시험 WAV 업로드 → 마이크 탭의 계기/시작 버튼 없음과 새 메모 버튼 → 1440×900으로 같은 화면 확인 → 탭 복귀에도 원본 유지 → 실제 로컬 준비 → 새 메모 생성 → Start recording 활성화와 Ready to record(자동 시작 없음) → 원래 메모로 돌아가 원본 파일 유지. 외부 AI 요청 0건이며 실제 마이크도 열지 않았다. 아래 캡처를 직접 열어 확인했다.

- [데스크톱 업로드 후 마이크 탭](1440-en-existing-audio.png)
- [360px 업로드 후 마이크 탭](360-en-existing-audio.png)

전체 화면·전체 스위트·실제 녹음·인증된 AI·푸시·배포는 반복하지 않았다. 변경하지 않은 녹음 경계 검증은 [앞선 기록](../2026-10-17-recording-input/README.md)을 재사용한다.
