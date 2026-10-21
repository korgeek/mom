# 모바일 단계와 완료 상세 — 2026-10-17

**2026-10-18 병합·배포 후속 승인:** 아래는 로컬 구현 당시의 기록이다. 이후 사용자가 “머지 커밋 푸시 배포 합시다”라고 승인했다. 새 fetch에서도 원격 main은 `70ff273`이며 완료 커밋 `2fe1467`의 제품 코드를 추가 변경 없이 통합한다. 통과한 19개 신규·154개 기존 단위 검사와 관련 브라우저 6개의 근거를 재사용하고, main의 최종 빌드·공개 산출물 검사와 운영 원점의 모바일/PC smoke를 확인한다. 기존 Git 푸시 기반 Cloudflare 배포를 사용하며 이번 브랜치·작업트리만 정리한다. 실제 키·유료 AI는 사용하지 않는다. 실제 배포 결과와 보존한 원본 로그는 로컬 `.superpowers/releases/20261018-mobile-stages/` 및 최종 보고로 남긴다. 이 승인 기록 자체는 배포 성공을 뜻하지 않는다.

사용자의 배포 후 스크린샷과 “1,2,3을 한 줄”, “완료하면 단계별로 접기” 요청을 반영했다. fetch 후 main과 origin/main은 `70ff273513c0811f3abb248f65ceb68bb7993d8c`로 일치했고 본 폴더는 clean이었다. `.worktrees/mom-mobile-stages`, `feat/mobile-stages-20261017`에서 로컬 구현·검증만 수행했다. main 병합·푸시·배포는 이번 후속 범위에 포함되지 않는다. 기존 작업트리·사용자 데이터·키는 유지했다.

## 짧은 설계와 구현

- 기존 세 단계 버튼을 유일한 단계 이동으로 유지한다. 759px 이하에서 같은 폭의 세 칸 한 줄이며 번호·완료 표시·현재 단계와 기존 busy 조건을 유지한다. 별도 세로 단계 목록은 추가하지 않는다.
- 완료한 음성 준비와 전사 실행 상세를 모바일에서 접을 수 있다. 자동 완료 순간에는 읽던 화면을 유지한다. 다음 단계 이동 요청이 같은 메모의 목적 화면에 실제 반영됐을 때만 이전 완료 작업의 접힘을 기억하고, 돌아왔을 때 실제 길이·저장 청크 수 등의 요약과 상세 펼침 버튼을 보인다.
- 접힘은 원본/청크/전사 버전의 구체적인 식별자에 묶인 잠금 해제 세션의 UI 상태다. 거절되거나 미반영된 탐색에서는 현재 화면을 접지 않고, 초기화 후 새 청크나 다른 메모에 이전 접힘을 적용하지 않는다. 저장 스키마·전송·제공사·키 정책은 바꾸지 않는다.
- 준비에서는 음성 추가/준비 작업만 접고 제목·언어는 유지한다. 아이콘·색상은 현재 선택 요약 후 명시적으로 펼친다. 전사에서는 실행/청크/요청 이력만 접고 선택 전사 검토·편집과 기존 사용량 정보는 보인다. 최종 정리 결과·편집·Markdown 복사·다운로드는 접기에 포함하지 않는다.
- 미저장 준비/전사 입력·활성 처리·실패/결과 불명·누락/미확인 전사·초기화 편집은 상세를 펼친다. 이전에 저장된 성공 결과가 있어도 더 최근 실패를 완료로 숨기지 않는다. 접기/펼치기는 자식을 재생성하지 않으며 입력 상태를 유지한다. 준비 미리듣기는 수동으로 접을 때 일시정지한다.
- PC에서 새 접기 컨트롤을 숨기고 기존 배치를 유지한다. PC에서 내부 컨트롤에 초점을 두고 모바일로 줄일 때도 초점을 잃지 않도록 미디어 변경을 반영한 뒤 접힘을 적용한다. 버튼은 native 키보드 동작과 aria-expanded/controls, 44px 모바일 터치 영역을 갖는다.

제품 변경은 App, UI copy의 기존 STT 상태 계산, Import/STT, 새 CompletedStageDetails와 모바일 CSS 두 파일로 한정한다. 새 의존성은 없다. [전체 변경 경로](changed-files.txt).

## 화면과 Library

별도 보이는 sandboxed Chrome의 새 합성 보관함에서 360×844 / 390×844 / 430×844 / 1440×900을 실제 렌더링했다. 360px 영어의 긴 단계명도 한 줄과 같은 폭을 유지한다. 아이콘/색상·완료 상세의 접기/펼치기, 키보드 Enter/Space, 단계 이동, PC→360px 초점 유지, 실제 로컬 파일 준비와 선택 전사 편집, 정리/Markdown 복사/다운로드까지 확인했다.

[Library 전후 비교 이미지](https://chatgpt.com/api/library/files/libfile_5768f5f3ce588191b89a2b0aef269c74/download)에는 초기 모바일 전후·완료 전사 상세 접힘·PC 전후를 모았다. 합성 캡처를 HTML에 배치한 이미지 한 개이며 모바일은 첫 844px 높이만 표시한다고 명시했다. 원본 전체 캡처는 그대로 보존했다. [390px 전](before-390-preparation.png) · [390px 후](after-390-preparation.png) · [360px 전사 접힘/편집](after-360-transcription-collapsed.png) · [1440px PC](after-1440-preparation.png).

PC 초기 준비 화면은 전후 PNG 바이트가 동일했다(SHA256 `82481446043fa7efe355e2f0e8c9b35a6a6be00a2abf43ec8f93e2033877cbf9`). 단계 바·메모 카드·제목·언어·작업/입력/준비 카드의 7영역 × 위치/크기/스타일 8개, 총 56개 측정값 차이 0이다. [비교 JSON](desktop-geometry-comparison.json).

## 실제 명령과 결과

검사는 diff와 직접 연결된 탐색·미저장 입력·초기화·미리듣기·전사 실패 경로에 한정했다. 전체 저장소/전체 suite는 실행하지 않았다. 동일한 상태의 통과 근거를 재사용하고 변경·실패 부분만 재검사했다.

| 명령 | 결과 |
| --- | --- |
| `npm run test:unit -- tests/mobile-workflow.spec.tsx --reporter=json --outputFile=.superpowers/mobile-stages/core/green-final.json` | 초기 새 동작 9 실패/기존 보호 1 통과 → 최종 12 통과. 완료 중 유지·반영된 전진/재방문·거절 탐색·미저장·최신 실패/결과 불명/진행 중·부분 전사·초기화 초점·새 작업 분리·mounted 입력·PC resize·최종 내보내기 위치 |
| `npx vitest run tests/mobile-metadata.spec.tsx` | 초기 4 실패 → 4 통과, 초점/busy 보강 6 통과, 실제 CSS blur 순서 재현 2 실패 후 최종 7 통과 |
| `npm run test:unit -- tests/ui.spec.tsx tests/preparation-reset-ui.spec.tsx tests/playback-ui.spec.tsx tests/registered-stage-ui.spec.tsx tests/stt-rerun-ui.spec.tsx tests/openrouter-stt-ui.spec.tsx --reporter=json --outputFile=.superpowers/mobile-stages/core/regression.json` | 154개 중 153 통과/1 실패. 새 탐색 래퍼가 home 호출에 불필요한 undefined 두 번째 인수를 추가한 차이를 발견해 기존 호출 형식을 유지하도록 수정 |
| `npm run test:unit -- tests/ui.spec.tsx -t 'shows source duration beside sidebar titles' --reporter=json --outputFile=.superpowers/mobile-stages/core/navigation-retry.json` | 실패한 1개만 재검사: 1 통과/99 제외. 위 153개를 재실행하지 않음. 신규 19개와 기존 154개, 총 173개 서로 다른 단위 검사에 통과 근거 있음 |
| `node node_modules/typescript/bin/tsc --noEmit --incremental false -p tsconfig.tests.json`; `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.e2e.json` | 통과. QA가 마지막 E2E 초점 검사를 추가한 후 `npx tsc -p tsconfig.e2e.json --noEmit`도 통과 |
| `node node_modules/eslint/bin/eslint.js src/react-app/App.tsx src/react-app/ui/copy.ts src/react-app/ui/components/CompletedStageDetails.tsx src/react-app/ui/screens/Import.tsx src/react-app/ui/screens/STT.tsx tests/mobile-workflow.spec.tsx tests/mobile-metadata.spec.tsx tests/e2e/mobile-stages.spec.ts`; QA의 `npx eslint tests/e2e/mobile-stages.spec.ts` | 오류 0. App의 기존 Fast Refresh 경고 1. 마지막 E2E 변경 파일만 QA가 재확인 |
| `WRANGLER_LOG_PATH=/tmp/mom-mobile-stages-build-wrangler.log npm run build`; `npm run test:secret` | 최종 초점 수정 빌드와 공개 산출물 검사 통과. 기존 혼합 import·큰 bundle 경고 유지 |
| `npx playwright test --config .superpowers/mobile-stages/qa/before.config.ts` | 기준 화면 4/4 통과, 5.0초. 기존 main 빌드를 재사용 |
| `npx playwright test --config .superpowers/mobile-stages/qa/after.config.ts` | 새 관련 6건 중 5 통과/1 실패, 26.5초. 3개 모바일 배치/영어·전체 합성 흐름·부분 실패 통과. PC 초점 아이콘→모바일에서 CSS가 먼저 숨겨 초점을 잃는 실제 문제를 발견 |
| `npx playwright test --config .superpowers/mobile-stages/qa/after.config.ts --grep '1440px stage navigation'` | 문제 수정 후 실패한 1건만 1 통과, 3.3초. 아이콘과 완료 준비 내부의 초점을 둔 PC→360px 두 전환 확인. 관련 6개 모두 통과 근거 있음 |
| `node .superpowers/mobile-stages/qa/compare-desktop.mjs`; `git diff --check` | 통과. 최종 참고 원본 6개 SHA256 동일 |

최종 JS `index-CnRwcTIu.js` SHA256 `7edf5cf0db82fdd06e386ccc81024bab09822f9b285cc7db0ce66159256ffadd`; CSS `index-B-X2PIxR.css` SHA256 `81a385b1ca2d4ad0e613bcad0583953b1bfec0b2fb31ab36bfefd2978239dffe`다. 마지막 수정은 메타데이터 resize 초점 처리만 바꿨으므로 통과한 5개 브라우저 상태는 재사용하고 실패한 전환만 최종 빌드에서 확인했다. 독립 읽기 전용 코드 검토와 초점 수정 재검토에 차단 사항 없음.

브라우저 전체 흐름은 6초 합성 PCM WAV를 실제 로컬 MP3로 준비하고, 현재 모델 등록 UI로 합성 STT/LLM을 활성화했다. 선택/수정한 전사로 정리하며 STT가 반복되지 않고, 편집한 Markdown의 clipboard/download 바이트가 같음을 확인했다. 전사/정리 POST 2개는 localhost 합성 응답으로 가로챘다. 별도 301초 합성 파일은 실제 두 청크 중 하나 저장/하나 보류 후 합성 429 실패를 주어 부분/실패·재시도 UI가 유지됨을 확인했다. 실제 인증 추론 성공 주장이 아니다.

전체 로그·초기 실패·35개 전후 원본 캡처·trace·빌드/단위 JSON은 이 작업트리의 ignored `.superpowers/mobile-stages/`에 보존한다. QA 보고서는 같은 경로의 `qa/REPORT.md`다. 최초 preview의 Miniflare 오류 때문에 같은 자산의 static Vite preview 모드를 사용했으며 Cloudflare 헤더/CSP/배포를 검사하지 않았다. QA가 만든 preview 4190/4191은 종료됐고 다른 사용자 서버는 유지했다.

## 실행과 남은 범위

작업트리에서 `npm run dev -- --host 127.0.0.1 --port 5174 --strictPort`로 로컬 검토할 수 있다. 실제 사용자 보관함·키·녹음·유료 제공사 호출은 사용하지 않았다. 물리 휴대폰·실제 OS 키보드/IME·하드웨어 safe-area·음성 품질은 미검증이다. 이번 작업은 로컬 결과이며 운영 반영 완료나 제품 전체 검증 완료를 뜻하지 않는다.
