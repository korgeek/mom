# 주 실행 버튼을 오른쪽에 배치

2026-10-29 사용자 요청에 따라 파란 주 실행 버튼과 흰색 보조 버튼을 함께 쓰는 가로 버튼 묶음에서 주 실행 버튼을 마지막·오른쪽에 배치했다. CSS 시각 순서만 바꾸지 않고 JSX 순서를 바꿔 Tab 순서도 같게 유지한다. 혼합 `.actions` 묶음은 오른쪽 정렬하며 줄바꿈한 마지막 줄도 오른쪽에 맞춘다. 선택 탭·색상 선택·개별 세로 컨트롤은 이 규칙으로 재배열하지 않는다.

- 모델 관리: JSON 가져오기·내보내기 뒤 새 모델, 저장 설정 내보내기 뒤 저장, 호출 취소 뒤 테스트 호출.
- 키·목록 설정: 취소 뒤 저장, 가져오기 취소 뒤 가져온 설정 적용.
- 음성 메모 목록: 보조 아이콘 뒤 열기.
- 전사·정리 편집: 취소 뒤 저장. 전사 결과의 재시도 뒤 전체 전사 확인·편집.
- 음성 준비: 준비 전에는 전사하기 뒤 전사 준비, 준비 완료 후에는 전사 준비 뒤 전사하기. 동일한 버튼 key와 기존 실행 조건·핸들러를 유지한다.
- 녹음: 일시정지·취소 뒤 저장 후 종료, 권한 대기에서는 취소 뒤 비활성 시작 버튼. 단독 시작 버튼도 오른쪽에 고정해 권한 대기 때 취소 버튼이 나타나도 시작 버튼의 좌우 위치가 이동하지 않게 했다.

## 검사 범위·명령·결과

직접 바꾼 모델·키·목록 관리, 녹음·준비, 전사·정리 편집의 UI만 검사했다. 최초 7파일 실행은 111개 통과·1개 실패였다. 실패는 녹음 권한 대기 상태의 예전 `시작 → 취소` 순서를 기대하던 검사였다. 최신 사용자 요구에 맞게 `취소 → 시작`으로 기대값을 바꾸고 동일한 시작 DOM 노드·비활성 상태·취소 동작 검사도 유지했다. 이후 녹음 파일 25개가 모두 통과했다. 변경하지 않은 나머지 6파일 87개 통과 결과를 재사용해 해당 실행 범위는 총 112개 통과다.

```sh
npx vitest run tests/api-keys-ui.spec.tsx tests/model-registrations-ui.spec.tsx tests/selection-list-settings-ui.spec.tsx tests/recording-ui.spec.tsx tests/registered-stage-ui.spec.tsx tests/preparation-status-ui.spec.tsx tests/stt-rerun-ui.spec.tsx
# 최초 111 passed, 1 failed; 위의 기대값 갱신 뒤 녹음 파일만 재실행.
npx vitest run tests/recording-ui.spec.tsx
# 25 passed. 나머지 87개 결과 유지.
npx vitest run tests/ui.spec.tsx -t 'creates, renames, pins and explicitly confirms deletion|allows encoding drafts after raw transcripts while keeping language hints editable|selects existing comparison results and protects dirty Markdown without generation|keeps the Korean search label on one line while filtering the selected transcript'
# 4 passed, 97 skipped. 관련 없는 기존 실패 검사는 실행하지 않음.
WRANGLER_LOG_PATH=/private/tmp/mom-primary-right-build.log npm run build
# tsc -b 및 Vite build 통과.
WRANGLER_LOG_PATH=/private/tmp/mom-primary-right-build.log npx vite build
# 녹음 단독 시작 버튼 정렬 보정 후 최종 산출물 갱신 통과.
npx eslint src/react-app/ui/RecordingControls.tsx src/react-app/ui/components/ApiKeys.tsx src/react-app/ui/components/ModelRegistrations.tsx src/react-app/ui/components/SelectionListSettings.tsx src/react-app/ui/screens/Home.tsx src/react-app/ui/screens/Import.tsx src/react-app/ui/screens/Minutes.tsx src/react-app/ui/screens/Review.tsx src/react-app/ui/screens/STT.tsx tests/recording-ui.spec.tsx
# 오류 0개. SelectionListSettings의 기존 effect cleanup ref 경고 1개 유지.
npm run test:secret
# 앱 소스·정적 자산·최종 클라이언트 산출물 검사 통과.
git diff --check
# 통과.
```

전체 저장소·전체 테스트·E2E는 실행하지 않았다. 마지막 녹음 보정의 영향이 없는 87개 검사는 동일 코드이므로 반복하지 않았다. 빌드에는 기존 미디어 import 혼용·큰 chunk 경고가 남아 있다. 7개 관련 파일의 정적 주 실행 버튼 묶음 13곳도 TypeScript AST로 검사해 마지막 위치임을 확인했다.

## 브라우저 확인

별도 Chrome 로컬 창에서 실제 컴포넌트에 합성 프로젝트와 콜백만 제공했다. 실제 사용자 보관함·키·오디오·마이크·제공사 호출 없이 확인했으며 합성 화면임을 표시했다. 각 혼합 묶음에서 주 실행 버튼의 DOM 순서가 마지막이고 묶음 우측 경계와 차이가 1px 이하인지 확인했다. [버튼 순서 실측](button-order.json)은 12개 UI 상태·17개 혼합 버튼 묶음의 검사 결과를 담는다.

- [모델 관리](models-desktop.jpg), [API 키 추가](key-form-desktop.jpg), [음성 메모 목록](home-desktop.jpg)
- [준비 전](prepare-before.jpg), [준비 완료](prepare-complete.jpg), [녹음 중](recording-desktop.jpg)
- [정리 편집](minutes-edit-desktop.jpg), [전사 편집](transcript-edit-desktop.jpg), [모바일 모델 관리](models-mobile.jpg)

모델 수정의 설정 JSON 내보내기에서 Tab을 누르면 저장 버튼으로 이동했다. 목록 편집·권한 대기도 실측했다. 권한 대기 전후 시작 버튼의 좌우 좌표가 동일했다. 모바일은 360×800으로 렌더링했으며, 줄바꿈한 모델 관리의 새 모델 버튼이 마지막 줄 오른쪽에 놓임을 확인했다. 임시 뷰포트는 기본값으로 복원했고 합성 HTML/TSX와 탭은 제거했다.

## 변경 파일과 한계

제품 변경은 `src/react-app/ui/RecordingControls.tsx`, `components/ApiKeys.tsx`, `components/ModelRegistrations.tsx`, `components/SelectionListSettings.tsx`, `screens/Home.tsx`, `screens/Import.tsx`, `screens/Minutes.tsx`, `screens/Review.tsx`, `screens/STT.tsx`와 `ui/styles.css`다. 경로가 생략된 components·screens는 모두 `src/react-app/ui/` 아래다. `tests/recording-ui.spec.tsx`, `docs/README.md`, 이 기록·실측 JSON·화면 9개도 갱신했다.

앞선 작업 트리 변경을 보존했으며 디자인 원본 6개 파일의 SHA-256과 새 문서의 로컬 링크를 검사했다. 실행 조건·동의·전송·저장 로직과 실제 사용자 데이터는 변경하지 않았다. 모든 조건부 상태·다른 브라우저 엔진·실제 음성 준비나 제공사 추론·운영 배포는 검증하지 않았다. 커밋·푸시·배포 없이 로컬 변경으로 남긴다.
