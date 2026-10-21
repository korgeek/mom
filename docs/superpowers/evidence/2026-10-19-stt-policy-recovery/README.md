# STT 보관 정책 거절과 명시적 복구

## 변경 범위

OpenRouter가 `data-policy`로 거절한 등록 STT 요청은 같은 메모·모델 설정으로 다시 보내지 않는다. 암호화 보관한 실패 분류와 원래 실행 스냅샷을 사용하며, 과거 응답에 분류가 없으면 구조화된 404/Data Policy 메타데이터를 확인한다. 화면에는 다른 모델 선택과 보관 정책 검토를 제공한다. 전송 버튼뿐 아니라 컨트롤러에서도 중복 요청을 거절한다.

정책 검토는 기존 API 키 편집 대화상자를 재사용한다. 기존 키 값은 표시하지 않고 유지하며, 연결된 모든 모델에 적용된다는 안내와 명시적 정책 동의를 유지한다. 표준 보관은 제공사 보관을 허용할 수 있고 데이터 수집 거부는 유지한다. 저장 자체가 음성을 전송하지 않는다. 같은 모델의 설정이 달라졌으면 과거 정책을 고정한 요청을 재사용하지 않고 새 요청 묶음과 새 전송 동의를 사용한다. 과거 원본·편집·선택 결과는 보존한다.

[OpenRouter ZDR 문서](https://openrouter.ai/docs/guides/features/zdr)의 계정·가드레일·요청 정책 결합 규칙을 확인했다. 앱의 `zdr:false`는 계정·가드레일의 강제 ZDR을 해제하지 않는다. 외부 계정 설정은 앱에서 변경하지 않으며 사용자가 검토할 링크만 제공한다. 카탈로그만으로 최초 요청의 계정별 가용성을 보장하거나 모든 모델을 사전 검증했다고 표시하지 않는다.

## 검사와 관찰

- `npm run test:unit -- tests/stt-rerun-ui.spec.tsx tests/provider-data-policy.spec.ts tests/api-credentials.spec.ts tests/api-keys-ui.spec.tsx`: **34 통과**. 모델 선택 위치, 정책 취소, 재동의, 공유 키 변경과 저장 실패 보존을 확인했다.
- `npm run test:unit -- tests/stt-rerun-controller.spec.tsx -t '^(?!preserves an initial partial selection|chooses a new transcript for minutes consent)'`: **18 통과, 기존 실패 2개 제외**. 새 정책 거절 사례는 응답에 numeric code가 있는 경우와 없는 경우 모두 검증했다. 동일 설정 재시도는 전송·묶음 추가 없이 거절하며 잠금/재열기 뒤에도 유지한다. 정책 저장은 전송하지 않으며 이후 명시적 새 요청만 변경된 정책으로 보낸다.
- `npm run build`: **통과**. 기존 동적/정적 import 혼용과 큰 번들 경고는 유지된다.
- `npm run test:secret`: **통과**. 공개 소스·자산·빌드에 일치한 민감값을 출력하지 않는다.
- `node --test tests/artifacts.test.mjs`: **4 통과**. 배포 라이선스 일치와 산출물 검사 동작을 확인했다.
- `npm run test:e2e -- stt-policy-recovery.spec.ts`: **1 통과, 2.1초**(전체 4.2초). 별도 보이는 sandboxed Chrome, 한국어 라이트 **1440×900 / 360×800**. 실제 앱에서 합성 WAV 4초를 MP3로 준비했다. 가짜 정책 거절 → 실행 차단 → 정책 편집 취소 → 재검토·명시적 저장 → 새 동의·새 요청 → 결과 저장을 확인했다. 전송은 ZDR 요청 1회와 사용자가 확인한 표준 보관 요청 1회뿐이다. 모든 외부 요청을 가로채며 실제 키·유료 추론·외부 계정 변경은 사용하지 않았다. 페이지 오류와 예상하지 않은 외부 요청은 0건이다.

## 기존 실패의 구분

관련 검사에서 확인한 아래 2개 실패는 수정 전 HEAD `58c8254`의 소스·동일 검사를 별도 임시 경로에 펼쳐 동일하게 재현했다. [원본 실행 로그](baseline-existing-failures.txt)를 보존하며 이번 변경의 통과 근거로 세지 않는다.

- `preserves an initial partial selection on explicit failed-chunk retry and reloads exact frozen lineage`: 부분 선택 전사가 유지된다는 오래된 기대와 현재 빈 청크 자동 채움 동작의 차이.
- `chooses a new transcript for minutes consent without extra STT and counts each saved run once`: 기존 정리 호출 fixture에서 실패. 이번 정책 복구 변경과 별도 조사 대상이다.

전체 스위트, 실제 제공사 인증 추론·최종 요금·보관 여부·물리 모바일 장비는 검사하지 않았다. 최초 요청의 계정별 경로 가용성도 사전 보장하지 않는다. Git/Cloudflare 배포 메타데이터와 공개 주소 실제 접근 검증은 별도로 구분한다.

## 실제 화면

- [데스크톱 정책 거절과 복구 액션](1440-policy-blocked.png)
- [모바일 정책 검토](360-policy-review.png)
- [모바일 공유 적용·외부 계정 정책 안내](360-policy-disclosure.png)
