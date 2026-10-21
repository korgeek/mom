# 녹음·업로드 탭과 녹음 상태 · 변경 영향 검증

2026-10-17, Asia/Jakarta. [승인한 후속 설계](../../../11-design-reference-review.md#2026-10-17-입력-탭과-녹음-상태-표시-구현) · [후속 구현 범위](../../../12-implementation-plan.md#2026-10-17-입력-탭녹음-상태-후속-구현)

## 범위와 변경 파일

기준 HEAD는 `017fb15f1272cab94d5e36a71776405229c61fce`다. 사용자는 입력 탭과 녹음 계기의 구현·관련 테스트·실제 브라우저 확인을 요청했고, 전체 화면/전체 스위트 반복 검사는 피하도록 명시했다. 기존 `src/react-app/App.tsx`의 사용자 문구 수정은 보존하고 이번 커밋에서 제외한다. 푸시·배포는 수행하지 않는다.

| 파일 | 변경 |
| --- | --- |
| `src/react-app/ui/screens/Import.tsx` | 오른쪽 `음성 추가` 카드의 녹음/업로드 탭 → `전사 준비` 카드. 현재 원본·미리듣기·청크/압축은 공통 준비 영역. 탭은 기존 음성을 삭제/교체하지 않으며 busy 중 전환 금지. 키보드 방향키/Home/End, 선택 상태·패널 연결 제공 |
| `src/react-app/recording/recorder.ts` | 이미 검증된 PCM16 패킷에서 RMS를 계산해 일시적 `inputLevel`로 전달. 녹음 외 상태는 0. 새 오디오 그래프·진행 타이머·지속 저장 필드 없음 |
| `src/react-app/controller.tsx` | 초기 녹음 스냅샷에 `inputLevel: 0`. 기존 소유권·잠금·저장 handoff 재사용 |
| `src/react-app/ui/RecordingControls.tsx` | 실제 신호의 상대 레벨 막대, 샘플 기준 `시:분:초`, 기존 1024² 기준 MB 소수점 두 자리. 저장 완료 시 확정 WAV 원본 바이트를 사용. 저장 확인량은 별도 표시 |
| `src/react-app/ui/styles.css` | 기존 팔레트·글꼴을 사용한 탭·패널·입력 레벨·녹음 시간 표시 |
| `tests/recording.spec.ts`, `tests/recording-ui.spec.tsx`, `tests/ui.spec.tsx`, `tests/recording-controller.spec.tsx` | 실제 PCM 레벨/무음/일시정지/재개/종료, 시간·용량 표기, 입력 탭과 준비 이동, 새 스냅샷 계약 |
| `tests/e2e/recording-input.spec.ts` | 이번 변경만 보는 실제 headful Chrome 2흐름 |
| E2E 호출자 | `helpers.ts`, `model-selection-settings.spec.ts`, `preparation-layout.spec.ts`, `preparation-progress.spec.ts`, `recovery.spec.ts`, `unified-model-management.spec.ts`, `workflow.spec.ts`의 준비 버튼 이름/배치 기대와 `copy-placement.spec.ts`의 업로드 탭 진입을 갱신. 전체 시나리오 재실행 없이 타입 검사 |
| 문서 | `docs/README.md`, `docs/TODO.md`, `docs/09-decisions-and-roadmap.md`, `docs/11-design-reference-review.md`, `docs/12-implementation-plan.md`와 이 증거 폴더 |

레벨은 녹음된 신호의 RMS를 표시용 로그 눈금으로 변환한 상대값이다. 물리 dB SPL·음성/화자 감지·음질 점수로 표시하지 않는다. 계산은 한 패킷 안에서 끝나며 원본 음성을 별도로 보관하지 않는다. `pcm-worklet.ts`의 전달·backpressure 프로토콜, 저장 형식·암호화·제공사 요청 계약은 변경하지 않았다.

## 실제 실행한 검사

| 명령 | 결과 |
| --- | --- |
| `npx vitest run tests/recording.spec.ts -t 'measures actual PCM level'` | RED 1: 새 레벨이 undefined. 구현 후 GREEN 1. 실제 Worklet에 무음·0.5·0.25 샘플을 보내 측정과 pause/save 정리 확인 |
| `npx vitest run tests/ui.spec.tsx -t 'groups recording and upload tabs'` | RED 1: 새 입력 영역/탭 없음. 구현 후 GREEN 1 |
| `npx vitest run tests/recording.spec.ts tests/recording-ui.spec.tsx` | 62 PASS. 녹음 코어와 녹음 UI만 실행 |
| `npx vitest run tests/ui.spec.tsx -t 'import configuration'` | 14 PASS / 85 제외. 메모 정보·입력 탭·준비·원본 재생의 직접 영향 범위 |
| `npx vitest run tests/recording-controller.spec.tsx -t 'cuts the real microphone\|keeps core Saved private'` | 최종 6 PASS / 13 제외. 잠금·탐색·dispose·소유권 상실·초기화의 늦은 callback과 확정 저장 handoff |
| `npm run build` | 최종 PASS. 새 필드가 누락된 기존 늦은 callback 시험 데이터를 보완한 뒤 통과. 기존 미디어 혼합 import 및 큰 client bundle 경고 유지 |
| `npx tsc --project tsconfig.e2e.json --noEmit` | PASS. 직접 수정한 호출자를 포함한 E2E 타입 확인 |
| `npx eslint src/react-app/recording/recorder.ts src/react-app/controller.tsx src/react-app/ui/RecordingControls.tsx src/react-app/ui/screens/Import.tsx tests/recording.spec.ts tests/recording-ui.spec.tsx tests/ui.spec.tsx tests/recording-controller.spec.tsx tests/e2e/recording-input.spec.ts tests/e2e/preparation-layout.spec.ts tests/e2e/copy-placement.spec.ts tests/e2e/model-selection-settings.spec.ts tests/e2e/workflow.spec.ts tests/e2e/preparation-progress.spec.ts tests/e2e/helpers.ts tests/e2e/unified-model-management.spec.ts` | PASS. 최종 시험 입력 수정 후 `npx eslint tests/e2e/recording-input.spec.ts tests/e2e/recovery.spec.ts`도 PASS |
| `npm run test:secret` | PASS. 최종 client build·소유 소스·공개 자산 검사 패턴 일치 없음. 일치값 미출력 |
| `npm run test:e2e -- tests/e2e/recording-input.spec.ts` | 모바일 업로드 1 PASS, 데스크톱 녹음 1 FAIL: Chrome 파일형 fake 입력에서 음량이 0 |
| `npm run test:e2e -- tests/e2e/recording-input.spec.ts --grep 'actual synthetic microphone'` | 실패한 데스크톱만 재실행. 파일 입력의 오디오 처리 옵션을 바꿔도 FAIL. 실제 Worklet 메시지를 진단해 92개 패킷의 peak=0인 시험 입력임을 확인. 이후 실제 Web Audio 합성 MediaStream으로 입력을 교체한 최종 실행에서 1 PASS (5.6초) |
| `node /tmp/mom-recording-doc-check.mjs` | 변경 문서 6개의 로컬 링크·앵커 101개 PASS. 레퍼런스 원본 6개의 SHA-256 일치 |
| `git diff --check` | PASS |

최종 관련 단위 82건과 브라우저 2흐름을 확인했다. 모바일은 제품 코드·빌드와 업로드 시나리오가 바뀌지 않아 최초 통과 근거를 재사용했다. 이후 변경은 데스크톱 전용 시험 입력이며, 모바일에서 마이크를 열지 않았다. 예전 다섯 뷰포트 행렬·다른 화면·전체 스위트는 반복하지 않았다. 실패한 실행을 통과로 바꾸거나 숨기지 않는다.

## 브라우저에서 실제 확인한 것

기존 Playwright 설정의 **별도 가시적 로컬 Chrome**, `127.0.0.1:4174`의 최종 preview build를 사용했다. 외부 HTTPS는 차단하거나 빈 공개 카탈로그로 격리했고 실제 추론 요청은 0건이다. 실제 사용자 파일·보관함·API 키를 사용하지 않았다.

- **1440×900 한국어 녹음 한 흐름:** 녹음/업로드 탭과 아래 전사 준비 위치 → 실제 Web Audio의 무음 입력에서 0 → 440 Hz 합성 입력에서 실제 레벨 상승 → 샘플 시간·MB 증가 → 탭 전환 차단 → 일시정지 후 레벨 0과 1.1초 동안 시간/용량 고정 → 재개·실제 입력 반응 → 저장 완료와 실제 입력 track 종료 → 두 탭 전환 후 원본 유지 → 실제 WAV→MP3 준비·암호화 저장 → 기존 전사 전 확인 진입. 화면에 저장 성공이나 음량을 주입하지 않았다.
- **360×800 영어 업로드 한 흐름:** 키보드 방향키로 탭 선택 → 시험 WAV 선택 → 현재 음성이 공통 준비 영역에 표시 → 녹음 탭에서 기존 파일 덮어쓰기 차단 → 업로드 탭 복귀 후 원본 유지 → 실제 전사 준비 완료. 가로 넘침 없음 확인. 영어 선택을 위해 설정을 경유했지만 설정 화면 전체를 검증하지 않았다.

캡처를 직접 열어 카드 순서·색상·글꼴·시간/용량·입력 레벨과 좁은 화면 줄바꿈을 확인했다.

- [데스크톱 빈 상태](1440-ko-empty.png) · [실제 합성 입력 녹음 중](1440-ko-recording.png) · [저장 후 전사 준비 완료](1440-ko-prepared.png)
- [좁은 화면 업로드 탭](360-en-upload.png) · [좁은 화면 준비 완료](360-en-prepared.png)

## 확인하지 않은 범위

물리 마이크·OS/브라우저 권한 설정 변경, 실사용 녹음 품질·모든 장비/브라우저, 전체 화면·전체 스위트, 실제 키·인증된 STT/회의록 생성·비용, 푸시·운영 배포는 수행하지 않았다. 이름/배치 기대만 바꾼 기존 E2E 파일들은 타입 검사했으며 전체 시나리오를 다시 실행하지 않았다. 테스트용 합성 입력 코드는 테스트 파일에만 있으며 제품에는 들어가지 않는다.
