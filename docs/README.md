# MoM 문서 안내

MoM은 브라우저에서 음성을 준비하고, 사용자가 선택한 외부 AI로 전사·정리한 뒤 결과를 암호화 보관하는 앱입니다. 사용법·실행 방법·현재 지원 범위는 [프로젝트 README](../README.md), 남은 과제는 [TODO](TODO.md)에서 확인합니다.

이 문서는 자료를 찾는 길잡이입니다. 초기 기획, 구현 계획, 날짜별 검증 기록은 각각 작성 당시의 상태를 담고 있습니다. 과거 문서의 미구현 표기나 배포 예정 문구를 현재 상태로 해석하지 않습니다. 현재 구현은 코드와 해당 변경의 검증 기록을 함께 확인합니다.

## 목적별 시작점

| 확인할 내용 | 문서 |
| --- | --- |
| 사용법·로컬 실행·기능과 한계 | [프로젝트 README](../README.md) |
| 암호화·잠금·키 수명·저장 실패 | [보안과 암호화](security-and-encryption.md) |
| 미해결 문제·추가 결정·검증 과제 | [TODO](TODO.md) |
| 라이선스·허용 범위·제3자 권리 | [현행 라이선스](../LICENSE), [채택 기록](16-mom-source-available-license-draft.md), [제3자 고지](../public/THIRD_PARTY_NOTICES.txt) |
| 변경별 검사 범위 선택 | [변경 영향 테스트 지침](prompts/change-impact-test-agent.md) |
| 테스트 음성·글꼴 출처 | [합성 미디어](../tests/fixtures/media/README.md), [자체 호스팅 글꼴](../public/fonts/README.md) |

## 제품·기술 기준

| 문서 | 내용과 읽는 기준 |
| --- | --- |
| [01 제품 목적과 요구사항](01-product-requirements.md) | 확정 요구사항, 사용 시나리오와 범위 |
| [02 처리 구조와 데이터](02-architecture-and-data.md) | 처리 흐름, 상태, 로컬 데이터와 버전 관계 |
| [03 오디오 준비](03-audio-pipeline.md) | 포맷 검사, 메모리, 분할·압축과 업로드 제한 |
| [04 전사와 회의록](04-transcript-and-minutes.md) | 시간축, 겹침, 다국어와 근거 있는 정리 |
| [05 제공자와 모델 비교](05-providers-and-comparison.md) | 직접 연결, CORS, 비교와 비용의 구분 |
| [06 개인정보와 로컬 보관](06-privacy-and-local-storage.md) | 외부 전송, 위협 모델, 저장과 백업의 설계 기준 |
| [07 초기 화면 제안](07-design-feature-inventory.md) | 초기 UI 제안이며 사용자 제공 레퍼런스를 대체하지 않음 |
| [08 검증과 출시 조건](08-verification-and-release-gates.md) | 수용 항목과 초기 실험; 실제 통과 범위는 변경별 기록 확인 |
| [09 결정과 로드맵](09-decisions-and-roadmap.md) | 요구·제안·미결정 사항의 배경; 남은 실행 과제는 TODO 확인 |
| [10 출처와 조사](10-sources-and-research.md) | 공식 자료, 확인일과 해석 범위 |
| [11 레퍼런스 검토](11-design-reference-review.md) | 원본 관찰, 모의 기능과 제품 간격, 사용자 결정 |
| [12 초기 구현 계획](12-implementation-plan.md) | 초기 단계별 계획; 체크박스만으로 현재 완료 여부를 판단하지 않음 |
| [14 시험 빌드 기록](14-test-build-evidence.md) | 해당 빌드의 환경·명령·관찰과 한계 |
| [15 작업 트리 정합화](15-worktree-reconciliation.md) | 과거 문서/제품 작업 트리 조정 기록 |

주제별 후속 설계와 실행 계획은 [specs](superpowers/specs/)와 [plans](superpowers/plans/)에 있습니다. 요구사항의 승인, 코드 구현, 검사 통과, 운영 배포는 서로 다른 상태로 기록합니다. 사용자 최신 결정이 우선하며, 화면 요구와 기술 제약이 충돌하면 영향과 근거를 밝히고 결정받습니다.

## 디자인 레퍼런스

주 실행 레퍼런스는 [Minutes of Meeting (standalone).html](<design-reference/Minutes of Meeting (standalone).html>)입니다. [레퍼런스 폴더](design-reference/)의 동반 HTML, `support.js`, `.thumbnail`, 업로드 이미지와 [검토 문서](11-design-reference-review.md)를 함께 읽습니다. 원본은 보존하며, 샘플의 모델·비용·타이머·성공 화면을 실제 제품 검증으로 취급하지 않습니다.

## 검증과 배포 기록

각 기록에는 해당 변경의 명령, 입력·환경, 결과와 확인하지 못한 범위가 있습니다. 배포 메타데이터, 운영 자산 확인, 실제 브라우저 동작을 구분합니다. 합성 오디오·가짜 응답으로 통과한 검사는 실제 키를 사용한 제공사 추론이나 회의록 품질의 증거가 아닙니다.

| 변경 주제 | 구현·검증·배포 근거 |
| --- | --- |
| 보관 정책 거절·명시적 정책 검토·새 전송 동의 | [전사 정책 복구](superpowers/evidence/2026-10-19-stt-policy-recovery/README.md) |
| OpenAI/OpenRouter 전사 설정과 실패 요청 상세 | [STT 표준화·오류 기록](superpowers/evidence/2026-10-29-stt-standardization/README.md) |
| 저장소 목록의 얇은 행·우측 삭제 버튼 | [저장소 목록](superpowers/evidence/2026-10-19-storage-rows/README.md) |
| 예정된 겹침 처리·선택 전사·정리 입력 | [겹침과 회의록](superpowers/evidence/2026-10-19-overlap-minutes/README.md) |
| 공통 접기 설명·정리 출력 한도 | [접기 설명](superpowers/evidence/2026-10-19-shared-disclosures/README.md), [출력 한도](superpowers/evidence/2026-10-19-notes-output-limits/README.md) |
| JSON 응답·재시도 범위·잠금 경고 | [JSON·레이아웃](superpowers/evidence/2026-10-19-json-response-release/README.md), [잠금 경고](superpowers/evidence/2026-10-19-lock-warning/README.md) |
| 전사 모달·결과 선택·음성 미리듣기·메모 삭제 | [전사와 음성](superpowers/evidence/2026-10-19-review-audio-release/README.md), [전체 전사 범위](superpowers/evidence/2026-10-19-stt-scope-choice/README.md), [배포](superpowers/evidence/2026-10-19-review-audio-release/release/README.md) |
| STT 예시·소프트웨어 라이선스 | [STT 프리셋](superpowers/evidence/2026-10-19-zdr-stt-presets/README.md), [라이선스](superpowers/evidence/2026-10-19-license/README.md) |
| 모델·API 키·전송 정책 | [모델과 키](superpowers/evidence/2026-10-18-model-api-presets/README.md), [배포](superpowers/evidence/2026-10-18-model-api-presets/release/README.md) |
| 오디오 준비·진행률·취소·재개 | [준비 처리](superpowers/evidence/2026-10-18-preparation-progress/README.md), [배포](superpowers/evidence/2026-10-18-preparation-progress/release/README.md) |
| 반응형 화면·작업 정책·잠금 | [화면과 잠금](superpowers/evidence/2026-10-18-screen-lock-responsive/README.md), [배포](superpowers/evidence/2026-10-18-screen-lock-responsive/release/README.md) |
| 앞선 통합·보안·화면 정리 | [통합 릴리스](superpowers/evidence/2026-10-17-release/README.md) |

[전체 evidence 폴더](superpowers/evidence/)에서 이전 화면·기능 기록을 찾을 수 있습니다. 날짜별 README는 당시의 증거이므로 이후 상태를 덧붙여 다시 쓰지 않습니다. 이후 배포 사실은 해당 릴리스의 근거와 Git/Cloudflare 기록으로 확인합니다.

## 문서 유지 원칙

- README에는 현재 목적·사용법·찾아갈 위치를 설명합니다. 날짜별 업데이트를 본문에 계속 이어 붙이지 않습니다.
- 기능이 바뀌면 관련 설명을 다시 구성하고, 완료된 과제는 TODO에서 정리합니다. 상세 검증 이력은 날짜별 근거로 남깁니다.
- 확정 요구, 제안, 관찰, 검증 결과를 구분합니다. 실제 추론·배포·보안 검증은 확인한 조건까지만 표현합니다.
- 키·암호·토큰·실제 회의 원문과 민감한 녹음은 문서나 공개 산출물에 넣지 않습니다. 제공사 키는 사용자가 앱 UI에 입력합니다.
