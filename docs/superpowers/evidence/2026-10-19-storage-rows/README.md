# 2026-10-19 저장소 목록 압축

사용자 스크린샷의 메모별 세로 목록을 `제목 | 원본·청크·미완성 개수/용량 | 오른쪽 삭제 버튼`으로 바꿨다. 메모 20~30개에서도 한 줄씩 훑을 수 있게 한다.

- `src/react-app/ui/components/StorageManagement.tsx`: 메모 목록을 묶고 용량을 가로로 배치했다. 긴 제목은 말줄임하고 전체 제목을 툴팁·접근성 이름에 보존한다. 버튼 문구는 `원본 삭제 / 청크 삭제`로 줄이되 기존 접근성 이름·삭제 범위·비활성 조건·확인 절차·초점 복귀는 유지한다.
- `src/react-app/ui/styles.css`: 데스크톱 행 높이 55px, 용량 본문·버튼 12px, 오른쪽 버튼 정렬을 적용했다. 모바일은 너비에 맞춰 줄을 나누며 44px 터치 영역을 유지한다. 요약·전체 바이트 상세·데이터 삭제 동작은 바꾸지 않았다.
- `tests/e2e/storage-rows.spec.ts`: 실제 저장소 컴포넌트와 CSS를 별도 headed Chrome 창에서 렌더링한다. 30개의 합성 메모·용량만 사용하며 제품에 데모 경로나 데이터를 추가하지 않는다. 기존 esbuild로 검사 번들을 만들고 새 의존성은 설치하지 않는다.

## 실제 검사

```sh
npx vitest run tests/storage-ui.spec.tsx -t 'current-vault|acknowledgement|current-plan|cleanup focus|audio sizes'
npx playwright test --config playwright.config.ts tests/e2e/storage-rows.spec.ts
npm run build
npx eslint src/react-app/ui/components/StorageManagement.tsx tests/e2e/storage-rows.spec.ts
node scripts/check-public-artifacts.mjs
git diff --check
```

저장소 관련 단위 검사 8개 통과(무관한 전사·가져오기 검사 4개 제외). 확인 토큰, 확인 전 비활성, 취소/Enter/Escape, 삭제 진행 중 중복 차단, 완료·실패·잠금 뒤 초점 처리, 정확한 바이트 상세를 확인했다.

레이아웃 수정 전에는 데스크톱 행 높이 기준에서 실패했다. 수정 후 한국어 라이트·영어 다크 각각 **1280×900 / 360×900**, 30개씩 총 120행의 실제 렌더링을 검사해 **4개 시나리오 통과(4.2초)**했다. 데스크톱은 모든 행 **55px·한 줄**, 버튼 오른쪽 오차 **0px**다. 모바일은 116/138px이고 가로 넘침이 없다. 마지막 긴 제목의 말줄임, 빈 메모의 삭제 비활성, 마지막 메모의 정확한 삭제 확인·취소와 초점 복귀도 통과했다. 실제 삭제는 한 번도 실행하지 않았다.

- 한국어: [데스크톱](1280-ko.png), [모바일](360-ko.png), [측정](1280-ko.json), [모바일 측정](360-ko.json)
- 영어 다크: [데스크톱](1280-en.png), [모바일](360-en.png), [측정](1280-en.json), [모바일 측정](360-en.json)

빌드·지정 ESLint·공개 산출물 검사·문서 링크·diff 검사와 디자인 원본 6개의 해시 일치를 확인했다. 기존 번들 크기·혼합 import 경고는 유지된다. 실제 보관함·음성·API 키·유료 모델·삭제 실행은 사용하지 않았다. 전체 테스트 스위트는 실행하지 않았다. 운영 배포/공개 주소 확인은 별도 릴리스 기록으로 구분한다.
