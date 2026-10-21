# 공식 자료와 조사 기준

[문서 인덱스](README.md) · 기록 및 링크 확인일 2026-09-30

아래 공식 자료는 이 문서 작성 중 열어 확인했다. 기술·정책은 바뀔 수 있으므로 구현과 실제 요청 전에 선택 모델·계정·브라우저 조건을 다시 확인한다. 공식 API 설명, 제한된 실험, 제품 설계 제안을 서로 구분한다. 가격·최신 모델 목록은 이 문서의 고정 사양으로 채택하지 않았다.

## 공식 링크

| 자료 | 이 기록에서의 사용 범위 | 이 자료만으로 입증하지 않는 것 |
| --- | --- | --- |
| [OpenAI 파일 전사](https://developers.openai.com/api/docs/guides/speech-to-text) | 25 MB 제한, 전사 기능·언어·시간·화자의 모델별 차이 | MoM 실제 인증·브라우저 포맷 변환·다국어 정확도 |
| [OpenAI 데이터 통제](https://developers.openai.com/api/docs/guides/your-data) | 학습 사용과 로그·보관 정책 구분 | 모든 요청의 무보관·모든 계정의 같은 설정 |
| [Cloudflare Workers AI REST 시작](https://developers.cloudflare.com/workers-ai/get-started/rest-api/) | REST 요청과 인증 방식 | 일반 브라우저 CORS 보장 |
| [Cloudflare whisper large v3 turbo](https://developers.cloudflare.com/workers-ai/models/whisper-large-v3-turbo/) | 시험 대상 모델과 옵션의 공식 설명 | 직접 브라우저 성공·제품 모델 채택 |
| [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/) | 정적 자산·SPA 호스팅 구조 | MoM 앱·배포·AI 프록시 구현 |
| [workers.dev 라우팅](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/) | Worker 이름·하위 도메인 주소 규칙 | mom.korgeek.workers.dev의 실제 서비스 응답 |
| [OpenRouter OAuth PKCE](https://openrouter.ai/docs/guides/overview/auth/oauth) | 제공자 연결과 브라우저 요청 참고 | MoM OAuth 채택·모든 요청 조건의 성공 |
| [OpenRouter 제공자 목록](https://openrouter.ai/providers) | 실제 하위 제공자의 존재와 선택 경로 확인 출발점 | 모든 모델·라우팅의 동일 개인정보 정책 |
| [MDN decodeAudioData](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/decodeAudioData) | 전체 파일 데이터 디코딩과 조각 처리 제한 | MoM 순차 컨테이너 처리의 보편적 지원 |
| [MDN 저장 할당량과 퇴거](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria) | IndexedDB·OPFS 공간 추정·실패·퇴거 위험 | MoM 영구 보관·복구 성공 |
| [MDN Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API) | 암호화 기본 연산과 키 관리·검토의 필요성 | 선택 암호 구성이나 MoM 구현의 안전성 |
| [OWASP 암호화 저장 지침](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html) | 위협 모델·인증 암호화·키 관리 검토 기준 | 미구현 보안 기능의 통과 |

## 근거의 종류

사용자 요구와 논의는 [제품 요구사항](01-product-requirements.md)·[결정 기록](09-decisions-and-roadmap.md)에 기록했다. 실험은 [검증 문서](08-verification-and-release-gates.md)에 날짜·원점·입력 조건과 함께 남겼다. 설계 제안은 문서에서 제안임을 표시했다. 공식 문서에 기능이 설명돼 있어도 제품에서 실제로 작동하는지와 정확한지는 별도 시험이다.

로컬 저장소는 기존 MoM 경로, 원격, HEAD, README·Wrangler 설정을 읽어 확인했다. Mini의 OpenRouter 보고서는 `/tmp/openrouter-cors-mini/report.txt`를 읽었다. 이 임시 파일은 영구 출처 링크가 아니므로 필요한 결과와 한계를 검증 문서에 옮겼다. Air의 실험 자료가 Mini에 있다고 가정하거나 존재하지 않는 파일 링크를 만들지 않았다.

## 주장과 수치 관리

합성 입력·시험 환경의 수치를 실제 회의의 품질 보장으로 쓰지 않는다. 키 없는 401 전송을 추론 성공으로 바꾸지 않는다. 일반 CORS 지원을 문서가 보장하지 않는 경우 제한된 요청 결과로만 설명한다. 가격·모델 가용성·약관은 실행 시 다시 확인하고 추정치에는 근거와 날짜를 붙인다.

기획 문서에는 API 키·토큰·Cloudflare Account ID와 실제 회의 자료를 넣지 않는다. 이번 기록은 제품 계획과 필요한 비식별 실험 결과만 보관한다. 공식 문구를 장문 복사하지 않고 링크와 필요한 해석을 남긴다.
