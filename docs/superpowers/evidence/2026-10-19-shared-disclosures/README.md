# 2026-10-19 설명·상세 폴딩 디자인 통일

사용자가 설정의 `//*[@id="settings-panel"]/div/div[1]/section[2]/details`에 있는 `작업과 데이터는 어떻게 되나요?`를 기준으로 다른 설명 펼침도 같은 디자인으로 바꾸도록 요청했다. 지정된 제목 14px·600, 본문 12px을 유지한다. 기존 키·원본·전사·노트·문구와 펼침 상태 처리에는 손대지 않는다.

## 변경 파일

- `src/react-app/ui/styles.css`: 설명용 native details/summary에 공통 글꼴·삼각 화살표·열림 표시·10px 본문 간격·키보드 초점을 적용했다. summary는 마우스와 Enter/Space로 기존처럼 동작한다. 모바일/터치 환경은 최소 44px 영역을 유지하고, 펼친 상세의 이름/값을 세로로 배치해 긴 URL과 모델명이 좁은 열에 잘리지 않게 한다. 중복된 사용량/터치/등록 폼 여백 규칙은 삭제했다.
- `src/react-app/ui/screen-lock.css`: 기준 설명·보호 설명·초기화만의 중복 폴딩 규칙을 제거했다.
- `src/react-app/ui/screens/stt-review.css`: 재전사 모달 제목 13px 예외를 제거했다.
- `tests/e2e/disclosure-style.spec.ts`: 실제 렌더링된 기준 XPath와 다른 설명 제목을 비교한다. 보안 설정, 모델 수정, 키 보관 옵션, 음성 준비, 전송 상세, 전사 이력, 원본 출처, 사용량·요청 상세 8개 상태를 확인한다.

앞서 선택한 키·값 JSON 트리와 ⋯ 작업 메뉴는 전용 디자인을 유지한다. JSON 내부 폴딩은 실제 CSS 13px 유지도 확인했다. 라이브러리·의존성·보관함 스키마·API 요청 로직은 바꾸지 않았다.

## 실제 검사

```sh
npm run build
npx playwright test --config playwright.config.ts tests/e2e/disclosure-style.spec.ts
npx eslint tests/e2e/disclosure-style.spec.ts
node scripts/check-public-artifacts.mjs
git diff --check
```

- 수정 전 1440px 검사에서 `저장과 보호 범위 자세히` 제목이 기준 14px과 달리 16px인 것으로 실패했다. 공통 CSS 적용 후 1440×900 한국어 라이트·360×800 영어 다크의 별도 headed Chrome 시나리오 2개 통과(6.0초)다.
- 각 뷰포트에서 8개 상태의 보이는 제목 15개씩, 총 30개의 14px·600 일치를 확인했다. 기준 본문 12px, Enter/Space 열기/닫기와 본문 숨김, 모바일 제목 최소 44px, JSON 전용 제목 13px, 가로 넘침 없음, pageerror 0개를 확인했다. [1440px 측정](1440-metrics.json), [360px 측정](360-metrics.json).
- 합성 보관함과 1초 합성 WAV, 가로챈 localhost 전사 응답만 사용했다. 실제 키·음성 메모·유료 AI는 사용하지 않았다. API 키 보관 옵션은 실제 키를 입력하지 않고 열고 닫았다. 보관함 초기화·삭제는 실행하지 않았다.
- 빌드·지정 ESLint·공개 산출물 검사·diff 공백 검사 통과. 기존 혼합 정적/동적 import와 500kB 번들 경고는 남는다. 디자인 원본 6개의 SHA-256은 HEAD와 일치한다. CSS 변경이므로 전체 단위/브라우저 스위트는 실행하지 않았다.

## 실제 화면

| 화면 | 1440px 한국어 라이트 | 360px 영어 다크 |
| --- | --- | --- |
| 보안·잠금 | [화면](1440-security.png) | [화면](360-security.png) |
| 모델 수정 | [화면](1440-model-editor.png) | [화면](360-model-editor.png) |
| 음성 준비 | [화면](1440-preparation.png) | [화면](360-preparation.png) |
| 전사 원본 출처 | [화면](1440-transcript.png) | [화면](360-transcript.png) |
| 사용량·요청 상세 | [화면](1440-usage.png) | [화면](360-usage.png) |

운영 배포 및 원점 검증 결과는 실제 확인 후 별도 기록한다. 실제 제공사 추론과 다른 브라우저의 시각 검사는 수행하지 않았다.
