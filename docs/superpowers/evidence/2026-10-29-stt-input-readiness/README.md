# API 설정 상태와 전사 입력 화면

## 사용자 결정

2026-10-29 후속 캡처에 따라 API 키가 없는 모델은 전사·정리 선택 목록에서 숨기고, 관리자에는 `설정 전`으로 표시한다. 사용자가 확인 질문에서 프리셋 목록은 유지하는 안을 선택했다. 전송 전 확인 카드의 디자인·폰트를 정리하고 언어·용어·맥락 입력 경로도 확인한다.

## 변경 내용

- 전사·재전사·정리·비교 B 선택 목록에서 키가 없는 bearer 등록을 제외한다. 현재 저장된 선택 ID는 삭제하거나 다른 모델로 바꾸지 않고 `API 설정 전 · 모델을 선택하세요`라는 비활성 항목으로 표시한다. 인증 없는 로컬 모델은 계속 사용할 수 있다.
- 관리자에는 해당 모델의 주 상태를 `설정 전`으로 표시한다. 기본 모델 목록에서도 새 선택을 막으며 기존 기본값은 유지한다. 프리셋·모델 등록·키 자체는 변경하지 않는다.
- 전사 카드 상단에 연필 아이콘과 `전사 입력 수정` 버튼을 둔다. 편집 중에는 읽기 전용 전송 상세를 숨겨 중복 표시를 줄인다. `입력 설정 적용`을 누르면 기존 메모별 설정 저장 경로를 이용하며 음성을 전송하지 않는다.
- 기존 Pretendard 글꼴·색상·컨테이너와 1100px 경계를 유지한다. 본문 13px, 메타데이터 라벨 12px, 고정 72px 라벨 열로 정리하고 API 주소의 origin/path를 나눠 끝 글자만 다음 줄로 떨어지는 문제를 줄였다.
- 직접 OpenAI GPT Transcribe 입력은 언어 → `languages[]`, 용어 → `keywords[]`, 맥락 → `prompt`로 연결된다. 모델 등록의 지원 설정을 따르며 API 키나 모델 설정을 자동으로 바꾸지 않는다.

## 검증 명령과 결과

```sh
npx vitest run tests/registered-stage-ui.spec.tsx tests/model-registrations-ui.spec.tsx tests/notes-model-readiness-ui.spec.tsx tests/stt-rerun-ui.spec.tsx tests/stt-input-settings.spec.ts
# 5 files, 56 passed.

WRANGLER_LOG_PATH=/private/tmp/mom-local-ui-build.log npm run build
# tsc -b 및 Vite build 통과.
WRANGLER_LOG_PATH=/private/tmp/mom-local-ui-build.log npx vite build
# 마지막 CSS 변경 뒤 클라이언트 산출물 갱신 통과.

npx eslint src/react-app/ui/components/ModelRegistrations.tsx src/react-app/ui/screens/Minutes.tsx src/react-app/ui/screens/STT.tsx tests/model-registrations-ui.spec.tsx tests/notes-model-readiness-ui.spec.tsx tests/registered-stage-ui.spec.tsx tests/e2e/unified-model-management.spec.ts
# 통과.
git diff --check
# 통과.
npm run test:secret
# 소유 앱 소스·정적 자산·최종 클라이언트 산출물 검사 통과.
```

미설정 STT 선택이 그대로 노출되는 실패를 먼저 재현한 뒤 수정했다. 단위 검증에는 기존 선택/기본값 보존, 키 없는 모델 숨김, 인증 없는 로컬 모델 선택, 관리자 상태, 비교 B 필터와 실제 입력 편집 후 FormData 필드 매핑이 포함된다. 입력 수정 후 이전 전송 동의가 해제되고 자동 전사 요청이 발생하지 않는 검사도 유지했다.

더 넓은 UI 검사 명령 `npx vitest run tests/registered-stage-ui.spec.tsx tests/model-registrations-ui.spec.tsx tests/notes-model-readiness-ui.spec.tsx tests/stt-rerun-ui.spec.tsx tests/ui.spec.tsx tests/stt-input-settings.spec.ts`는 150개 통과·7개 실패였다. 아래 7개는 HEAD `3720e02`의 별도 임시 사본에서도 같은 실패로 재현됐다. 관련 없는 제품 동작은 수정하지 않았다.

- `disables native workflow and sidebar navigation while busy and keeps lock available`
- `surfaces indeterminate real file inspection without estimating a percentage`
- `reselects an existing original without clearing completed work (en)`
- `reselects an existing original without clearing completed work (ko)`
- `keeps lock available during in-flight work so the controller can stop jobs`
- `uses voice-memo terminology throughout app-owned screens in ko`
- `uses voice-memo terminology throughout app-owned screens in en`

기존 import/navigation/lock/용어 기대값 검사 실패이며 이번 STT 변경 범위의 통과로 대신 해석하지 않는다. 임시 baseline 결과는 `/private/tmp/mom-ui-baseline-3720e02-results.json`이다. 전체 저장소·전체 E2E는 실행하지 않았다. 수정한 E2E 파일은 상태 문구 기대값만 갱신했고 실제 E2E 실행 근거로 사용하지 않는다.

baseline 작업 디렉터리 `/private/tmp/mom-ui-baseline-3720e02`에서 실행한 명령:

```sh
./node_modules/.bin/vitest run tests/ui.spec.tsx -t 'disables native workflow and sidebar navigation while busy and keeps lock available|surfaces indeterminate real file inspection without estimating a percentage|reselects an existing original without clearing completed work|keeps lock available during in-flight work so the controller can stop jobs|uses voice-memo terminology throughout app-owned screens' --reporter=json --outputFile=/private/tmp/mom-ui-baseline-3720e02-results.json > /private/tmp/mom-ui-baseline-3720e02-run.log 2>&1
# 선택된 7개 모두 같은 원인으로 실패.
```

## 브라우저 확인

별도 Chrome 로컬 창에서 1610×1068 데스크톱을 확인했다. 실제 로컬 보관함은 잠긴 상태였으며 암호·키·자료를 열거나 바꾸지 않았다. 명시적으로 합성 데이터라고 표시한 임시 화면에서 아래 상태를 확인했고, 임시 HTML/TSX와 탭은 제거했다. 사용자가 보는 실제 로컬 서버는 계속 실행한다.

- [전송 상세의 URL·폰트](transmission-desktop.jpg)
- [용어·맥락 입력과 적용 버튼](input-editor-desktop.jpg)
- [적용한 내용의 전송 요약 반영](transmission-populated-desktop.jpg)
- [관리자의 설정 전 상태](model-setup-desktop.jpg)

키 없는 합성 metadata와 메모리 상태로 UI를 확인했으며 자격 증명이나 음성을 외부로 전송하지 않았다. API 키 미설정 모델이 전사 목록에서 제외되는 것과 관리자에는 남는 것도 렌더링했다. 모바일 뷰포트와 인증된 제공사 추론은 확인하지 않았다. 실제 모델의 음질·정확도·요금은 이번 결과로 검증하지 않는다.

## 변경 파일

- `src/react-app/ui/components/ModelRegistrations.tsx`
- `src/react-app/ui/screens/Minutes.tsx`
- `src/react-app/ui/screens/STT.tsx`
- `src/react-app/ui/screens/stt-review.css`
- `tests/model-registrations-ui.spec.tsx`
- `tests/notes-model-readiness-ui.spec.tsx`
- `tests/registered-stage-ui.spec.tsx`
- `tests/e2e/unified-model-management.spec.ts`
- `docs/README.md`
- 이 검증 기록 및 위 4개 합성 화면 캡처

원본 레퍼런스 6개 파일의 SHA-256은 변경 전후 동일하다. 앞선 작업부터 남아 있던 STT 표준화 문서의 변경 파일 목록 보완은 그대로 보존했다. 이번 변경은 로컬 작업 트리에 남기며 푸시·배포하지 않는다.
