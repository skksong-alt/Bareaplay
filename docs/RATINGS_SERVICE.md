# 이름 기반 활약투표 개선 — 운영 전환

기준: `master`, `f9a931d`. 이 문서는 해당 기준점 이후 로컬 구현을 설명한다.
사용자는 Google 로그인 없는 활약투표, 기기별 이름 기억, 재투표 확인 및 점수 없는 실시간 상위 3명 공개를 요청했다.
제출 여부와 공개 결과의 별도 저장 구조 추가도 승인했다. 키 없는 연결 설정과 단계적 배포도 승인받았다. 아래 최신 상태가 초기 준비 기록보다 우선한다.

## 2026-09-23 최종 전환 상태

- 서버 준비 코드와 연결 진단 수정은 master에 commit/push했고 Vercel Production Ready를 확인했다. 연결 식별자 입력 오류를 Vercel에서 바로잡은 뒤, 존재하지 않는 경기 날짜의 읽기 전용 API 요청으로 실제 Firestore 접근 성공을 확인했다(없는 경기이므로 HTTP 400). 비밀값은 출력하거나 다시 열어보지 않았다.
- Firebase Console에서 기존 Rules와 비교한 뒤 활약투표 원본과 제출 표시만 비공개로 전환했다. 익명 원본 get 거부 / 공개 결과 get 허용을 Rules Playground로 확인했고, Console의 오늘 15:56 게시 버전으로 성공을 확인했다. 선수·출석·회계·참석투표 등 나머지 기존 권한은 변경하지 않았다.
- Vercel 서버 활성화를 true로 저장하고 프론트도 서버 API 사용으로 전환한다. 캐시는 v65, app v21, voteManagement v15, votePage v7, ratingService v2이다. 예전 화면은 새로고침이 필요할 수 있으며, 서버 오류 때 원본 직접 쓰기로 우회하지 않는다.
- 로컬 서버/캐시 검사 11개와 격리된 브라우저 활약투표 검사가 통과했다. 운영 Firebase에는 투표 제출, 테스트 문서 생성, 기존 데이터 변경·이관·삭제를 하지 않았다. 실제 운영 쓰기 성공은 시험하지 않았으므로 별도 확인 항목이다.
- 이 활약투표 전환 당시에는 포지션 설문을 비활성으로 유지했다. 같은 날 후속 승인으로 설문을 별도 공개하며 최신 상태는 `docs/POSITION_SURVEY.md`를 따른다. 아래 초기 비활성 값들은 준비 이력이다.

## 2026-09-23 연결 준비 이력

- IAM, Service Account Credentials, Security Token Service API를 활성화했다.
- 운영 Vercel용 Workload Identity Pool과 OIDC provider를 생성했다. 서비스 계정 키는 생성하지 않았다.
- 전용 서비스 계정과 아래 네 권한만 포함한 맞춤 역할을 생성했다. 기존 기본 Firestore 데이터베이스만 허용하는 IAM 조건을 붙여 전용 계정에 부여했다. 기존 Firebase 기본 서비스 계정 권한은 변경하지 않았다.
- 공급자 편집 화면에 의도하지 않은 한글 문자가 보였으나, 새로고침하여 서버에서 다시 읽은 issuer, audience, subject 매핑 및 production subject 제한 조건은 정확했다. 화면의 임시 입력 상태와 실제 저장 결과를 구별해야 한다.
- 간편 연결 화면의 IAM 저장은 실패했다. 사용자의 범위 확인 승인 후 전용 서비스 계정의 접근 권한 화면에서 정확한 production subject에만 `roles/iam.workloadIdentityUser`를 부여했고, 저장된 목록으로 확인했다.
- Vercel Production에 연결 식별자 다섯 개와 허용 origin, `BAREA_RATINGS_ENABLED=false`를 저장했다. 활성화 설정을 다른 작업과 묶어 저장하려던 시도는 안전 검사에 차단되어 실행되지 않았다. 역할을 먼저 확인·연결한 다음, 기능은 비활성으로 유지하여 변수만 별도로 저장했다.
- `BAREA_RATING_VERSION_SECRET`는 사용자가 직접 저장했고, 값은 열어보지 않고 등록 여부만 확인했다.
- 첫 서버 배포는 `BAREA_RATINGS_ENABLED=read-only`로 진행한다. 이 모드에서는 제출 여부와 상위 3명 조회만 허용하고 submit은 데이터 접근 전에 거부한다. 프론트 전환 플래그는 아직 false이며, 서버 연결 확인 후 Rules와 함께 전환한다. 운영 데이터 쓰기 시험은 수행하지 않는다.
- 읽기 전용 배포 모드 추가 후 로컬 서버/캐시 검사 11개가 통과했다. 이 검사는 가짜 데이터와 가짜 토큰만 사용하며 운영 Firebase에는 쓰지 않는다.

## 화면과 동작

- 활약투표에서 고른 이름을 해당 브라우저의 localStorage에 기억한다. 참석 신청의 게스트/대리 이름과 공유하지 않는다. 명단에 없는 기억된 이름은 자동 선택하지 않는다.
- 이름 선택은 항상 변경 가능하다. 이름 변경 시 현재 선택한 선수 3명은 지운다. 공용 기기용 기억 해제 설정도 유지한다. 쿠키/사이트 데이터 삭제나 다른 브라우저 사용 시 기억은 사라진다.
- localStorage에는 이름, 기억 여부, 날짜/이름별 이 기기 제출 표시만 저장한다. 선택한 선수/점수는 저장하지 않는다. 이는 본인 인증이 아니다.
- 서버 사용 시 저장 직전에 제출 여부만 확인한다. 이미 제출됐다면 교체 여부를 묻고, 취소하면 원본과 집계 모두 변경하지 않는다. 이전 선택은 읽어오거나 자동 선택하지 않는다.
- 제출 확인 후 같은 이름의 표가 다른 곳에서 바뀌면 409 응답으로 중단한다. 현재 선택은 유지하며 사용자가 저장을 다시 눌러 새 확인을 받아야 한다.
- 점수는 기존 1/2/3지망 3/2/1점으로 서버 내부에서만 집계한다. 화면에는 상위 3명 이름만 표시하며, 경계 동점은 한국어 이름순으로 최대 3명을 표시한다. 이름·점수·투표자별 선택 목록을 모두 내려보내는 방식이 아니다.
- 실시간 순위 변화로 제출 내용을 간접 추측할 여지는 남는다. 사용자에게 설명했으며, 실시간 상위 3명 공개를 요청받았다.
- 포지션 설문의 Google 로그인/접근 권한 방침은 바꾸지 않았다. 설문은 여전히 닫혀 있다.

## 서버 경로와 호환성

Vercel Node 22 서버 함수 `/api/ratings`를 추가했다. 서버의 Cloud Firestore 라이브러리는 Vercel OIDC 단기 토큰을 Google Cloud Workload Identity Federation으로 교환해 사용한다. 서비스 계정 키를 만들거나 보관하지 않는다. 기존 HTML 앱의 프레임워크/빌드 변환은 없다. package.json/lock은 서버 의존성용이며 Firebase CLI는 설치하지 않았다.

- `POST action=status`: 실제 기존 `ratings/{date}`를 서버에서 읽어 `{exists, version}`만 반환한다. 별도 제출 표시가 없는 과거 투표도 감지한다. 선택 원본은 응답하지 않는다.
- `POST action=leaders`: 기존 투표를 서버에서 읽고 `{leaders: [이름 최대 3개]}`만 반환한다. 기존 데이터 이관/새 문서 생성 없이 첫 화면에 결과를 제공한다.
- `POST action=submit`: 명단/자기 선택/중복/3명 여부/확인 버전을 검증하고, 한 Firestore transaction 안에서 아래 세 경로를 갱신한다.
  - 기존 `ratings/{date}`: 기존 형식을 유지하며 선택한 이름의 `{picks,at}`만 merge. 다른 이름/미지 필드는 보존.
  - 신규 `ratingParticipation/{date}/voters/{name}`: `{submitted:true, revision, updatedAt}`. 선택한 선수/점수 없음. 클라이언트 직접 읽기·쓰기 금지, 제출 여부는 API로만 조회.
  - 신규 `ratingResults/{date}`: `{date, leaders:string[], updatedAt}`. 공개 get만 허용할 초안. 클라이언트 쓰기/목록 조회는 금지.
- 기존 관리자의 경기/시즌 집계는 종전 `ratings` 형식을 계속 읽는다. 별도 투표 저장소로 분산하거나 기존 자료를 자동 이관하지 않는다.
- 결과 갱신은 공개 결과 문서의 snapshot을 구독한다. API 응답은 no-store이며 Service Worker도 `/api/`를 캐시하지 않는다.
- 기존 관리자 전체 덮어쓰기나 별도 프로그램의 직접 투표 쓰기는 집계에 반영되지 않을 수 있다. 새 경로 전환 시 일반 클라이언트 직접 쓰기를 막아야 한다.

## 실행 전 필요한 승인/설정

1. 2026-09-23 배포된 운영 Rules를 읽기 전용으로 확인했다. `ratings/{date}`와 오래된 `ratings/{date}/votes/{voter}`는 공개 읽기/쓰기이고, `/{collectionName}/{docId}`의 포괄 규칙도 `ratings`를 공개 읽기 대상으로 포함한다. `docs/RATINGS_RULES_DRAFT.txt`는 현행 규칙을 바탕으로 한 **전체 검토안**이다. 적용 직전에 최신 규칙과 다시 비교하고 Rules 검증 후 승인받는다. `ratings` 원본만 기존 `isAdmin()`으로 읽게 하며, RSVP·회계·선수·라인업의 현재 권한은 유지한다.
2. 사용자는 **키 없는 연결**을 선택했다. Vercel Security의 Team OIDC issuer는 이미 선택돼 있다. 최초 확인에서는 전용 연결 리소스가 없었으며, 승인 후 생성한 리소스의 현재 상태는 위 진행 상황에 기록했다. 기존 기본 서비스 계정을 재사용하거나 키를 발급하지 않는다.
3. 승인 후 연결 시 Vercel의 Team issuer, 해당 프로젝트의 **production subject만** 수락하는 Google Cloud provider를 만든다. `google.subject=assertion.sub`를 매핑하고 허용 audience를 Team audience로 제한한다. 서비스 계정에는 이 production subject만 `Workload Identity User`로 연결한다. 서비스 계정의 Firestore 권한은 소유자/관리자 역할이나 `roles/datastore.user` 전체 부여 대신 `datastore.databases.get`, `datastore.entities.get`, `datastore.entities.create`, `datastore.entities.update` 네 권한만 담은 전용 역할부터 검토한다. 이 역할에는 delete/export/import/Rules 변경 권한을 포함하지 않는다. 다만 서버 IAM은 Firestore 클라이언트 Rules를 우회하며 컬렉션 단위로 좁혀지지 않으므로, API의 경로·이름 검증이 필수다. 실제 역할 권한 목록과 적용 범위는 설정 전 다시 확인한다.
4. 아래 환경변수 **이름만** 문서에 기록한다. 실제 값은 Production 서버 환경변수에 설정하고 코드, 브라우저, 로그 또는 채팅에 넣지 않는다. Google Cloud 식별자는 인증키가 아니지만 공개 프론트에 넣지 않는다.
   - `GCP_PROJECT_ID`, `GCP_PROJECT_NUMBER`: 연결할 Google Cloud 프로젝트 식별자.
   - `GCP_SERVICE_ACCOUNT_EMAIL`: 신규 전용 서비스 계정 식별자.
   - `GCP_WORKLOAD_IDENTITY_POOL_ID`, `GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID`: 신규 연결 풀·provider 식별자.
   - `BAREA_RATING_VERSION_SECRET`: 32자 이상의 별도 무작위 서버 비밀값. 확인 버전 HMAC용.
   - `BAREA_PUBLIC_ORIGIN`: 허용할 운영 origin. 기본값은 기존 운영 도메인.
   - `BAREA_RATINGS_ENABLED`: 초기에는 미설정/false. 승인된 전환 시에만 true.
5. 2026-09-23 운영 설정을 읽기 전용으로 확인했다: Vercel Hobby, Production은 `master` 자동 배포, Framework Preset은 Other, 기본 정적 루트, Node.js 22.x, Production 프로젝트 환경변수 없음, Functions는 Hobby 기본 리소스이며 Team OIDC issuer가 선택되어 있다. Firebase는 Spark 요금제다. IAM 사용 자체는 무료이지만 함수 실행/Firestore 읽기·쓰기와 결과 구독 사용량이 추가된다. 실제 함수 빌드, WIF 토큰 교환, Spark 프로젝트의 연결 허용 여부 및 무료 할당량 소진 여부는 운영 설정 없이 아직 검증하지 못했다.
6. 공개 API는 로그인 없이 이름 선택을 허용하므로 남의 이름으로 교체를 승인하는 사람을 막지 못한다. Origin 검사는 본인 인증이나 봇 방어가 아니다. 공개 전 Vercel 측 요청 제한/남용 대응 방식을 검토한다. 이 코드에는 지속적인 전역 rate limit이 없다.
7. 운영 전환은 명시 승인 후 한다. 서버 API를 먼저 준비하고, legacy 클라이언트의 원본 읽기·쓰기를 차단한 뒤 프론트 `RATING_SERVICE_ENABLED=true`와 새 캐시 버전을 배포한다. 전환 중 이전 화면은 저장 실패할 수 있으므로 안내한다. 서버 오류 시 원본 직접 쓰기로 우회하지 않는다.

준비 단계에서는 프론트/서버를 비활성화했고, 임시 화면에서 모든 저장에 교체 확인을 표시했다. 최종 전환에서는 서버가 실제 기존 표를 확인하고, 화면에는 과거 선택을 보내지 않는다.

## 복구 / 보존

문제가 생기면 설문과 별개로 활약투표 서버 기능을 닫고 기존 ratings와 신규 두 경로를 보존한다. 과거 소스의 공개 원본 접근을 다시 허용하는 것은 안전한 복구 방법이 아니다. 코드를 되돌릴 때도 원본 읽기 제한은 유지한다. 사용자가 명시적으로 재투표한 표만 기존 방식과 동일하게 교체되며, 이 변경은 과거 표의 버전별 백업을 새로 제공하는 기능이 아니다.

## 확인 범위

로컬 가짜 데이터로 이름 기억/해제, 기존 투표 감지, 취소, 다른 표 보존, 동시 수정 충돌, 점수 없는 상위 3명, 오류 시 우회 금지와 캐시 연결을 확인했다. 가짜 OIDC 토큰으로 클라이언트 생성과 토큰 누락 차단도 확인했다. 실제 IAM/OIDC 읽기 연결과 Console Rules 시뮬레이션은 확인했지만, 운영 데이터 쓰기 시험은 하지 않았다. 실제 Firestore transaction 쓰기와 Rules의 Emulator 통합 검증은 별도 필요하다.

참고: [Vercel Node 함수](https://vercel.com/docs/functions/runtimes/node-js), [Vercel–Google Cloud OIDC 연결](https://vercel.com/docs/oidc/gcp), [Google Cloud Workload Identity Federation](https://cloud.google.com/iam/docs/workload-identity-federation), [Firestore 서버 IAM](https://docs.cloud.google.com/firestore/docs/security/iam), [Firestore transaction](https://firebase.google.com/docs/firestore/manage-data/transactions).
