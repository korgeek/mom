# API 키 상태 칩

2026-10-29 사용자가 API 키의 설명형 인증 결과를 간단한 칩으로 표시하도록 요청했다. 기존 모델 배지와 색상을 재사용해 `키 필요·확인 전·확인 중·인증 확인·확인 실패·확인 불가`를 표시한다. 상세 메시지가 있으면 칩을 눌러 펼칠 수 있다. `인증 확인`은 인증 경로 확인을 뜻하며 모델 추론 성공을 뜻하지 않는다. 키 값이 없는 상태에서는 이전 인증 성공 기록보다 `키 필요`를 우선한다.

연결 확인·키 보관·모델 테스트·암호화 경로는 변경하지 않는다. 기본 상태에서 긴 결과 문장을 숨기며, 실패 이유와 실제 모델 테스트가 별도로 필요하다는 안내는 상세 내용에 보존한다. 칩 상태는 `role=status`로 제공하고 펼침에는 상태를 포함한 접근성 이름을 붙인다.

## 검증 범위와 결과

API 키 UI와 키 추가 창을 공유하는 모델 등록 UI만 검사했다. 새 칩·메시지 펼침·키 없음 우선 검사 6개가 기존 구현에서 실패함을 확인한 뒤 수정했다. 최종 상태 매핑, 상세 보존, 자동 API 호출 없음, 기존 저장·취소·삭제·잠금 동작을 확인했다.

```sh
npx vitest run tests/api-keys-ui.spec.tsx tests/model-registrations-ui.spec.tsx
# 2 files, 30 passed.
npx vitest run tests/api-keys-ui.spec.tsx -t 'compact authentication chips|key-required chip'
# 접근성 이름 보정 후 6 passed, 8 skipped.
WRANGLER_LOG_PATH=/private/tmp/mom-api-key-chips-build.log npm run build
# tsc -b와 Vite build 통과.
WRANGLER_LOG_PATH=/private/tmp/mom-api-key-chips-build.log npx vite build
# 접근성 이름 보정 후 최종 산출물 갱신 통과.
npx eslint src/react-app/ui/components/ApiKeys.tsx tests/api-keys-ui.spec.tsx tests/e2e/unified-model-management.spec.ts
# 통과.
npm run test:secret
# 앱 소스·정적 자산·최종 클라이언트 산출물 검사 통과.
git diff --check
# 통과.
```

빌드의 기존 미디어 import 혼용·큰 chunk 경고는 유지된다. E2E 파일의 결과 문구 기대값과 상세 펼침 절차도 갱신했지만 E2E 자체는 실행하지 않았다. 전체 저장소·전체 테스트는 실행하지 않았다.

## 화면 확인

별도 Chrome 로컬 창의 1610×1124 데스크톱에서 실제 Settings/ApiKeys 컴포넌트에 명시적인 합성 상태를 제공했다. [접힌 칩](chip-collapsed.jpg), [펼친 상세](chip-expanded.jpg)를 확인하고 클릭으로 펼침·Enter로 접기를 실행했다. 키 값·음성·실제 제공사 요청 없이 확인했으며 임시 HTML/TSX와 탭은 제거했다. 실제 사용자 보관함의 키와 모델은 변경하지 않았다. 모바일·실제 인증 요청·추론·배포는 확인하지 않았다.

## 변경 파일

- `src/react-app/ui/components/ApiKeys.tsx`
- `tests/api-keys-ui.spec.tsx`
- `tests/e2e/unified-model-management.spec.ts`
- `docs/README.md`, 이 기록과 화면 2개

앞선 작업 트리 변경을 보존했다. 디자인 원본 6개 파일의 SHA-256은 동일하며 새 로컬 문서 링크를 검사했다. 커밋·푸시·배포 없이 로컬 변경으로 남긴다.
