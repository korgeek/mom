# 녹음 상태 공간과 문구 개선

2026-10-17 Asia/Jakarta. 기준 HEAD `2eae190`. [사용자 결정과 화면 기준](../../../11-design-reference-review.md#2026-10-17-녹음-상태-공간과-문구-개선).

## 변경 범위

- `src/react-app/ui/RecordingControls.tsx`: 시간과 두 용량을 왼쪽에 묶고 음량을 오른쪽에 배치. `입력`/`암호화 저장`으로 짧게 표시하되 접근성 이름·확정 저장량 구분·시간·MB 형식 유지. 기존 자료 보존을 위한 시작 차단 이유를 짧게 안내.
- `src/react-app/ui/screens/Import.tsx`: 차단 상태의 버튼을 `새 메모 만들기` / `New voice memo`로 변경. 기존 새 메모 생성 동작·명시적 녹음 시작·덮어쓰기 방지 유지.
- `src/react-app/ui/styles.css`: 한 녹음 상태 영역의 두 열 배치와 간결한 시간/용량 표시만 변경.
- `tests/e2e/recording-input.spec.ts`: 같은 녹음 흐름에 실제 초록 막대 너비, 시간/용량 오른쪽의 음량계, 120px 미만 상태 영역, 360px 너비에서 가로 넘침 없음과 새 문구 확인 추가. 이전 캡처를 보존하기 위해 새 증거 폴더 사용.
- 문서: 이 기록과 `docs/11-design-reference-review.md`, `docs/README.md`.

사용자가 후속 답변에서 초록 막대가 정상 움직인다고 확인했다. PCM 측정·감도·Worklet·암호화 저장·컨트롤러는 수정하지 않았다. 조사 중 임시로 추가한 RMS 0.0005 입력 표시는 기존 -60dB 바닥에서 0이어서 단위 진단이 실패했고, 브라우저 진단은 창 종료로 중단됐다. 이 임시 감도 요구는 사용자 재확인 후 채택하지 않고 시험 코드를 제거했다. 해당 진단을 제품 고장 재현이나 최종 통과 근거로 사용하지 않는다.

기존 사용자 `src/react-app/App.tsx` 수정은 그대로 두고 커밋에서 제외한다. 새 의존성·실제 키·사용자 음성·운영 변경은 없다.

## 실행한 관련 검사

| 명령 | 결과 |
| --- | --- |
| `npx vitest run tests/recording-ui.spec.tsx` | 25 PASS. 표시·pause/resume·저장 실패/차단과 명시적 시작 유지 |
| `npx vitest run tests/ui.spec.tsx -t 'groups recording and upload tabs'` | 1 PASS / 98 제외. 해당 입력 탭과 전사 준비 호출만 확인 |
| `npx eslint src/react-app/ui/RecordingControls.tsx src/react-app/ui/screens/Import.tsx tests/e2e/recording-input.spec.ts` | PASS |
| `npx tsc --project tsconfig.e2e.json --noEmit` | PASS |
| `npm run build` | PASS. 기존 큰 bundle·미디어 혼합 import 경고 유지 |
| `npm run test:secret` | PASS. 소유 소스·공개 자산·최종 client build 검사, 일치값 미출력 |
| `npm run test:e2e -- tests/e2e/recording-input.spec.ts --grep 'actual synthetic microphone'` | 1 PASS (6.4초). 별도 가시적 로컬 Chrome의 녹음 한 흐름만 실행 |
| `git diff --check` | PASS |
| `node /tmp/mom-compact-doc-check.mjs` | 문서 3개의 로컬 링크/앵커 52개 PASS. 레퍼런스 원본 6개 SHA-256 일치 |

이전 코드·환경에 대한 녹음 코어/컨트롤러 안전 경계 검증은 [직전 기록](../2026-10-17-recording-input/README.md)을 재사용했다. 코어 변경이 없어 다시 실행하지 않았으며 모바일 업로드 시나리오·전체 화면·전체 스위트도 반복하지 않았다.

## 실제 브라우저 확인

`127.0.0.1:4174`의 최종 preview build, 한국어, 1440×900 및 같은 녹음 중 360×800으로 크기 변경. 실제 Web Audio의 440Hz 합성 MediaStream을 앱의 실제 Worklet/PCM 경로에 연결하고 무음 0 → 실제 입력 레벨 상승 → 일시정지 0·시간/용량 고정 → 재개 → 확정 저장을 확인했다. 실제 초록 막대 너비가 증가하고 음량계가 시간/용량 오른쪽에 있으며 좁은 화면에서도 넘치지 않았다. 기존 한 흐름 안의 원본 유지·로컬 준비·전사 전 확인도 통과했고 외부 추론은 0건이다. 캡처를 직접 열어 배치와 문구를 확인했다.

- [빈 상태](1440-ko-empty.png)
- [데스크톱 녹음 중](1440-ko-recording.png)
- [360px 녹음 중](360-ko-recording.png)
- [저장 후 준비·새 메모 버튼](1440-ko-prepared.png)

물리 마이크·다른 브라우저/OS·인증된 AI·전체 제품 회귀·푸시·배포는 확인하지 않았다. 합성 입력은 시험 파일에만 있으며 제품에 포함하지 않는다.
