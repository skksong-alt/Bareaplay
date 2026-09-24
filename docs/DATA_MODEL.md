# BareaPlay Firestore 데이터 모델

## 2026-09-24 승인된 4·6쿼터 호환 필드

`dailyMeetings/{date}`, `shares/{autoId}`, `matchRecords/{date}`에 선택 필드 `quarterCount: 4 | 6`을 추가한다. 값이 없는 기존 문서는 6으로 해석한다. 기존 컬렉션·문서 ID·배치 필드는 유지하며 일괄 이관하지 않는다. 사용자가 이 호환 방식을 승인했다.

- 경기: 편집 저장 시 `quarterCount`를 함께 저장한다. 4쿼터 생성/편집 시 기존 `lineups`, `formations`, `resters`, `referees`, `manualReferees`의 5·6쿼터는 보존한다.
- 공개: 새 `shares`에는 선택 쿼터의 필드·휴식·포메이션을 싣는다. 과거 공유 문서는 변경하지 않는다. 비활성 배치는 `dailyMeetings`에 남는다.
- 기록: `matchRecords.quarterCount`로 시즌 집계를 제한한다. 기존 5·6 스코어·최초 `teamsSnapshot`·자동보정 이력을 유지한다. 빈 입력으로 기존 점수를 삭제하지 않는다.
- 복구: 선택을 6으로 바꾸면 보관 배치를 다시 표시한다. 명단을 바꿨다면 예전 5·6쿼터와 맞지 않을 수 있으므로 공개 전 검증을 통과해야 한다. 불완전한 배치를 자동 보충하지 않는다.
- 회계 저장 큐·공통 UI는 새 운영 컬렉션/필드를 만들지 않는다. 큐는 메모리 저장이므로 강제 종료 후 영구 복구 기능이 아니다.

로컬 코드에서 확인한 방식이며 실제 운영 문서는 수정/이관하지 않았다. 아래 과거 기준점의 저장 동작 설명과 구분한다.

## 2026-09-24 로컬 저장 안전장치 — 기존 스키마 유지

- `dailyMeetings/{date}` 경로와 기존 필드·하위 맵 형식은 변경하지 않는다. 자동 이관은 없다.
- 새 저장 흐름은 편집 당시 날짜·내용을 복사하고, 현재 서버 문서가 화면에서 불러온 내용과 같은지 트랜잭션 안에서 비교한다. 충돌하면 저장하지 않는다.
- 서버 문서의 미지 최상위 필드는 보존한다. `teams`, `teamLineupCache` 등 알려진 전체 상태 맵은 기존처럼 교체하므로 없어진 팀 키가 남지 않는다. 기존에 불러온 라인업 객체의 추가 필드는 그대로 전달한다.
- 기존 `lastWriter:string` 값에는 저장 회차 식별자를 붙이고, `lastUpdatedAt`은 서버 시각을 유지한다. 새 필드는 없다. 시각 필드 자체는 동시 편집 비교에서 제외하고 나머지 문서 내용을 비교한다.
- 8주 훈련 포지션 선택, 현재 미저장 큐, 이 화면의 마지막 공개본 비교 정보는 메모리 전용이다. 기존 선수·설문·경기 문서에 연결 필드를 추가하지 않는다.
- 과거 클라이언트는 여전히 기존 덮어쓰기 동작을 할 수 있으므로 모든 운영자의 새 버전 반영을 확인해야 한다. 새 코드도 오프라인 강제 종료·동시 기기의 구버전 저장까지 복구하는 백업은 아니다.

## 2026-09-24 추가 승인: 8주 고정팀 계획 (로컬 준비, 운영 미적용)

`teamCycles/{autoId}`: `schemaVersion:1`, `startDate`, `endDateExclusive`(시작+56일),
`members:[{name,team:0|1,role,second}]`, `createdBy`(관리자 Auth UID), `createdAt`(서버 시각).

- 관리자 전용 새 계획이며 기존 문서 ID와 구조를 변경하지 않는다. 작성된 계획은 수정/삭제하지 않고 다음 기간은 새 문서로 보존한다.
- 선수 키인 name으로 기존 명단을 참조한다. 설문 note·계정·능력치 원본은 복제하지 않는다.
- 당일 차출은 메모리에서 미리보기만 만들며 원소속은 바꾸지 않는다. 직접 팀 입력칸으로 전달한 후 사용자가 기존 적용 절차를 진행한다.
- 운영 접근 기능은 꺼져 있다. 사용자의 적용 승인을 받았고 통합안의 에뮬레이터 검사는 통과했으나 Firebase Console 게시/규칙 조회 오류로 적용 확인이 막혔다. `TEAM_CYCLE_RULES_DRAFT.txt`의 최소 변경안이 실제 활성 규칙에 반영된 것을 확인하기 전에는 활성화하지 않는다.
- 충돌되는 기간의 동시 생성/중복 생성 제한은 아직 서버에서 보장하지 않는다. 저장된 계획은 사용자가 명시적으로 선택한다.
- 자세한 보존·복구 계약은 `REMODELING.md` 참조. 기존 데이터 자동 이관은 없다.

## 2026-09-23 추가 승인: 로그인 없는 활약투표 상태 / 공개 집계

별도 저장 구조 추가를 승인받았다. 2026-09-23 서버 연결·Rules 변경·운영 배포를 완료했다. 상세 전환/복구 절차는 `docs/RATINGS_SERVICE.md`에 있다.

- 기존 `ratings/{date}.votes.{name}.{picks,at}`를 유지한다. 서버가 사용자의 명시적 제출에 따라 해당 이름만 merge하며 다른 투표와 미지 필드는 보존한다.
- 신규 `ratingParticipation/{date}/voters/{name}`: `submitted:boolean`, `revision:string`, `updatedAt:timestamp`. 선택 원본 없음. 브라우저 직접 접근은 차단하고 서버가 제출 여부만 알려주는 설계다.
- 신규 `ratingResults/{date}`: `date:string`, `leaders:string[]` (최대 3명), `updatedAt:timestamp`. 공개 결과에는 점수와 투표자/개별 선택이 없다. 서버가 투표/제출 표시/공개 결과를 같은 transaction으로 갱신한다.
- 기존 투표는 자동 이관하지 않는다. 상태 조회와 최초 결과 표시는 서버에서 기존 문서를 읽어 계산만 하므로 제출 표시가 없는 과거 투표도 감지할 수 있다.
- 재투표 확인은 본인 인증이 아니다. 이름을 선택하고 교체를 승인하는 다른 사람을 막지는 않는다. 실시간 순위의 간접 추론 가능성도 남는다.

## 2026-09-23 추가 설계: 비공개 희망 포지션 설문

사용자가 Google 로그인 방식과 2026-09-23 권한 적용·배포를 승인했다. 지정 감독 UID를 Firebase Console 계정과 Authentication 사용자 목록에서 대조했다. 본인/지정 감독 전용 Rules를 적용한 뒤 기능을 연다. 감독 UID는 저장소에 기록하지 않는다. 운영 테스트 응답이나 컬렉션을 미리 만들지 않으며 실제 팀원의 제출 때 생성된다. 공개 절차는 `docs/POSITION_SURVEY.md`에 기록한다.

`privatePositionPreferences/{Firebase Auth uid}`: Google 계정당 응답 한 문서.

| 필드 | 형식 | 의미 |
|---|---|---|
| `name` | string | 기존 선수 명단에서 본인이 선택한 이름. Google 프로필명을 자동 사용하지 않는다. 최초 저장 후 이름 변경은 차단하는 Rules 초안 |
| `first`, `second` | string | GK/LB/CB/RB/DM/CM/AM/LW/RW/FW 중 1·2지망. 같은 값 허용 |
| `stable`, `flexible` | boolean | 8주 필드 역할 유지 희망 / 다른 역할 학습 의향 |
| `note` | string | 감독에게 보내는 선택 메모, 최대 500자 |
| `updatedAt` | server timestamp | 마지막 제출 시각 |

- 기존 `players` 주/부/희망 포지션, 참석 투표와 배정 정보를 덮어쓰거나 자동 이관하지 않는다.
- 응답자는 자기 uid 문서만 읽고 수정한다. 전체 응답 조회는 일반 관리자 전체가 아니라 지정된 감독 uid 하나로 제한한다.
- Google 로그인은 계정 소유만 구분한다. 본명과 계정의 일치를 자동 증명하지 않는다. 같은 이름의 여러 계정 응답은 감독 화면에 표시하며 수요 집계에서 제외한다.
- 새 코드에는 설문 삭제 기능이 없다. 문제 시 기능 진입을 닫고 응답은 보존한다.
- 기존 광역 허용 규칙의 읽기·쓰기 모두에서 이 컬렉션을 제외했다. `docs/POSITION_SURVEY_RULES_DRAFT.txt`는 전체 규칙을 대체하는 파일이 아닌 적용 로직 조각이다.

## 2026-09-16 추가: 코칭 기능 (기존 데이터 이관 없음)

아래는 새 코드의 경로이며 운영 문서의 존재를 의미하지 않는다. 사용자 저장 동작 전에는 생성하지 않는다.

| 경로 | 주요 필드 | 관계 / 쓰기 시점 |
|---|---|---|
| `coachWeeks/{YYYY-MM-DD}` | `date`, `ko`, `en`, `actionKo`, `actionEn`, `url`, `segmentKo`, `segmentEn`, `drillKo`, `drillEn`, `reviewDate`, `updatedAt` | 대상 경기 날짜별 콘텐츠. 관리자가 콘텐츠 저장 시 merge. `reviewDate`는 평가할 과거 `dailyMeetings`/`ratings` 날짜, 빈 값은 자동 선택, `none`은 숨김 |
| `coachPlayers/{name}` | `name`, `roles: string[]`, `mentor`, `guest`, `date?`, `skill?`, `positions?: string[]`, `updatedAt` | 기존 선수의 이름 키를 참조. 관리자가 역할 저장 시 merge. 게스트는 `date` 일치 시에만 임시 능력치 사용 |
| `coachPlans/{YYYY-MM-DD}` | `date`, `teamLocks: {name: teamIndex}`, `lineupLocks: {teamIndex: [{name,q}]}`, `updatedAt` | 팀 인덱스는 0부터. `q`는 0~5. 고정은 현재 저장 라인업의 자리/휴식에 적용. 체크 해제 시 고정 맵/해당 팀 배열만 명시 교체 |
| `coachAdjustments/{autoId}` | `date`, `team`, `reason`, `kind: partial-lineup`, `changes: string[]`, `at` | 사용자가 미리보기 후보를 실제 적용한 경우에만 추가 |

`adjustLogs`의 **새 조정**에는 `reason`을 추가한다 (`temporary`, `condition`, `wish`, `learning`, `roleFit`). 기존 로그를 수정하지 않는다. `roleFit`만 반복 성향 제안에 사용한다.

활약 투표를 새 페이지에서 제출해도 기존 `ratings/{date}.votes.{name}.{picks,at}` 구조를 사용한다. 신규 `ratings/.../votes` 하위 컬렉션으로 이관하지 않는다. 참석 투표 역시 기존 응답 문서에 필요한 필드만 merge한다.

이하 문서는 도입 전 기준점 기록이다.

확인일: 2026-08-30

## 표기 기준

- **확인됨**: 현재 저장소의 실제 읽기·쓰기 코드에서 경로 또는 필드가 확인됨.
- **미검증**: 저장소 밖의 Firebase Console, 실제 운영 문서 또는 Security Rules를 확인해야 알 수 있음.
- 필드가 코드에 존재해도 과거 문서에는 없을 수 있다. 현재 코드는 여러 필드에 기본값을 적용해 구버전 문서를 일부 허용한다.
- 이 문서에는 Firebase 설정값이나 인증정보를 기록하지 않는다.

## 전체 관계 요약

```text
players/{name}
  ├─ name으로 attendance, votes/responses, ratings, playerNotes와 논리적으로 연결
  └─ 선수 객체가 dailyMeetings와 shares에 스냅샷 형태로 복제될 수 있음

dailyMeetings/{date}
  ├─ matchRecords/{date}가 팀 명단을 읽음
  ├─ attendance.date와 날짜 문자열로 연결
  └─ shares/{shareId} 생성 시 팀·라인업이 별도 스냅샷으로 복제됨

settings/activeVote ──voteId──> votes/{voteId}/responses/{name}
settings/activeMeeting ──shareId──> shares/{shareId}

matchRecords/{date} ──date──> ratings/{date}
```

Firestore의 외래키나 cascade delete는 사용하지 않는다. 위 관계는 문자열 ID와 필드 값으로 애플리케이션이 연결하는 논리적 관계다. 선수 이름이나 날짜 형식이 달라지면 참조가 자동으로 갱신되지 않는다.

## 컬렉션별 구조

### `players/{playerName}` — 확인됨

문서 ID는 선수 이름이다.

| 필드 | 형태 | 용도 |
|---|---|---|
| `name` | string | 선수 표시 이름, 일반적으로 문서 ID와 동일 |
| `pos1` | string[] | 주 포지션 목록 |
| `s1` | number | 주 능력치 |
| `pos2` | string[] | 부 포지션 목록 |
| `s2` | number | 부 능력치 |
| `feeType` | string | `normal`, `admin`, `student` |
| `wishPos` | string[] | 희망 포지션 목록 |
| `wishQuota` | number | 6쿼터 중 희망 포지션 보장 횟수, 0~6 |
| `side` | string | 빈 문자열, `L`, `R` |
| `memo` | string | 운영진 선수 메모 |

관계 및 주의사항:

- 이름이 사실상 여러 컬렉션의 논리적 키다.
- 이름 변경 코드는 새 문서를 저장한 뒤 이전 문서를 삭제하며 다른 컬렉션의 이름 참조를 갱신하지 않는다.
- 개별 선수 저장은 문서를 전체 덮어쓴다. 코드에 알려지지 않은 추가 필드는 손실될 수 있다.
- 선수 엑셀 업로드는 컬렉션 전체 삭제 후 재생성 방식이다.

### `dailyMeetings/{date}` — 확인됨

문서 ID는 `YYYY-MM-DD` 날짜 문자열이다.

| 필드 | 형태 | 용도 |
|---|---|---|
| `date` | string | 모임 날짜 |
| `teams` | map | `team_0`, `team_1` 등의 키와 선수 객체 배열 |
| `teamLineupCache` | map | 팀 인덱스별 라인업 결과 |
| `initialAttendeeOrder` | array | 최초 참가자 순서 |
| `teamNames` | string[] | 날짜별 사용자 지정 팀 이름 |
| `aceNames` | string[] | 날짜별 에이스 이름 |
| `pinTogether` | string[] | 같은 팀 묶기 입력 행 |
| `pinApart` | string[] | 다른 팀 나누기 입력 행 |
| `lastWriter` | string | 클라이언트 식별자 |
| `lastUpdatedAt` | Firestore Timestamp | 최종 갱신 시각 |

`teamLineupCache` 내부에서 확인된 필드:

- `lineups`: 6개 쿼터의 포지션별 선수 이름 목록
- `resters`: 저장 시 `q_0`~`q_5` 키를 가진 map으로 변환
- `referees`: 저장 시 `q_0`~`q_5` 키를 가진 map으로 변환
- `manualReferees`: 저장 시 `q_0`~`q_5` 키를 가진 map으로 변환
- `members`: 라인업 대상 선수 이름 목록
- `formations`: 6개 쿼터 포메이션 목록
- `score`, `guaranteeShort`, `preferShort`: 생성 결과 평가 값

문서는 `merge` 없이 전체 저장된다. 일부 필드만 수정하는 문서가 아니다.

### `attendance/{attendanceId}` — 확인됨

새 문서의 기본 ID는 `${date}_${normalizedName}`이다. 기존 또는 이관 문서는 다른 ID일 가능성이 있어 코드는 실제 문서 ID도 함께 사용한다.

| 필드 | 형태 | 용도 |
|---|---|---|
| `date` | string | 출석 날짜 |
| `name` | string | 선수 또는 게스트 이름 |
| `paymentStatus` | string | `●` 완납, `△` 일부, `✕` 미납, `N` 노쇼, 또는 빈 값 |
| `paymentAmount` | number 또는 입력 문자열 가능 | 실제 납부액 |
| `payMethod` | string | 빈 값, `cash`, `careem`, `transfer`, `etc` |
| `note` | string | 해당 날짜의 비고 |
| `grass` | boolean | 천연잔디 회비 적용 여부 |

코드 주석에는 과거 이관 문서의 `mig` 태그가 언급되지만 실제 운영 문서의 존재와 정확한 형태는 **미검증**이다.

### `expenses/{autoId}` — 확인됨

| 필드 | 형태 |
|---|---|
| `item` | string |
| `amount` | number |
| `date` | string |
| `createdAt` | Firestore Timestamp |

### `incomes/{autoId}` — 확인됨

회비 외 후원금, 이월금 등의 기타 수입이다.

| 필드 | 형태 |
|---|---|
| `item` | string |
| `amount` | number |
| `date` | string |
| `createdAt` | Firestore Timestamp |

### `votes/{voteId}` — 확인됨

문서 ID는 Firestore 자동 ID다.

| 필드 | 형태 | 용도 |
|---|---|---|
| `title` | string | 투표 제목 |
| `date` | string | 모임 날짜 |
| `time` | string | 모임 시각 |
| `location` | string | 장소 |
| `startAtMs` | number 또는 null | 시작 시각 Unix milliseconds |
| `deadlineMs` | number 또는 null | 자동 마감 시각 |
| `closed` | boolean | 종료 여부 |
| `createdAt` | Firestore Timestamp | 생성 시각 |
| `closedAt` | Firestore Timestamp, 선택 | 종료 시각 |

이전 버전 투표에는 `startAtMs`, `deadlineMs`, `closedAt`이 없을 수 있도록 코드가 작성되어 있다.

#### `votes/{voteId}/responses/{name}` — 확인됨

응답 문서 ID는 정규화된 응답자 이름이다.

| 필드 | 형태 | 용도 |
|---|---|---|
| `name` | string | 응답자 이름 |
| `status` | string | `attend`, `maybe`, `absent` |
| `guest` | boolean | 미등록 선수 여부 |
| `waitlist` | boolean | 마감 후 대기자 여부 |
| `attendingSince` | Firestore Timestamp, 선택 | 참석 처리 시각 |
| `createdAt` | Firestore Timestamp, 선택 | 최초 생성 시각 |
| `updatedAt` | Firestore Timestamp | 최종 수정 시각 |

### `settings/activeVote` — 확인됨

| 필드 | 형태 | 관계 |
|---|---|---|
| `voteId` | string | 현재 `votes/{voteId}` 문서를 가리킴 |

### `shares/{shareId}` — 확인됨

문서 ID는 Firestore 자동 ID다. 생성 시점의 모임 정보를 복제한 스냅샷이다.

| 필드 | 형태 | 용도 |
|---|---|---|
| `meetingInfo` | map | `time`, `location`, `locationUrl` |
| `teams` | map | `team1`, `team2` 등의 키와 선수 객체 배열 |
| `teamNames` | string[] | 공유 당시 팀 이름 |
| `lineups` | map | `team1`, `team2` 등의 팀별 라인업 결과 |
| `attendance` | map 또는 null | `attend`, `maybe`, `absent` 배열의 투표 스냅샷 |
| `createdAt` | ISO 8601 string | 브라우저 생성 시각 |

주의: `dailyMeetings.teams`는 `team_0` 형식이지만 `shares.teams`는 `team1` 형식이다. 쿼터 키도 공유 데이터에서는 `q1` 형식을 사용한다. 이 차이는 현재 소비 코드와 함께 유지해야 한다.

### `settings/activeMeeting` — 확인됨

| 필드 | 형태 | 관계 |
|---|---|---|
| `shareId` | string | 현재 `shares/{shareId}` 문서를 가리킴 |
| `linkText` | string | 메인 화면 링크 문구 |
| `meetingTime` | string | 공유 모임 일시 |

### `matchRecords/{date}` — 확인됨

문서 ID는 `YYYY-MM-DD` 날짜 문자열이다.

| 필드 | 형태 | 용도 |
|---|---|---|
| `date` | string | 경기 날짜 |
| `teamsSnapshot` | map | `team_0`, `team_1` 등의 키와 선수 이름 배열 |
| `quarters` | map | `q_0`~`q_5`별 대진과 점수 |
| `eloApplied` | boolean | 능력치 보정 반영 여부 |
| `eloAppliedAt` | Firestore Timestamp, 선택 | 보정 반영 시각 |
| `lastUpdatedAt` | Firestore Timestamp | 기록 수정 시각 |

각 `quarters.q_n`은 다음 필드를 가진다.

- `a`, `b`: 대진 팀 인덱스
- `sa`, `sb`: 각 팀 점수

### `ratings/{date}` — 확인됨

문서 ID는 `YYYY-MM-DD` 날짜 문자열이다.

| 필드 | 형태 | 용도 |
|---|---|---|
| `date` | string | 경기 날짜 |
| `votes` | map | 투표자 이름을 키로 하는 투표 맵 |

각 `votes.{voterName}` 값은 `picks` 선수 이름 배열과 `at` Unix milliseconds를 가진다. `setDoc(..., {merge: true})`로 투표자 이름 키를 갱신한다.

### `adjustLogs/{autoId}` — 확인됨

문서 ID는 Firestore 자동 ID다. 공통 필드는 `kind`, `date`, `at`이며 동작별 필드는 다음과 같다.

- `team-add`: `name`, `to`
- `team-remove`: `name`, `from`
- `team-move`: `name`, `from`, `to`
- `lineup-swap`: `team`, `q`, `moves[]`; 각 이동은 `name`, `to`

### `locations/{autoId}` — 확인됨

| 필드 | 형태 |
|---|---|
| `name` | string |
| `url` | string |

### `memos/accounting_memo` — 확인됨

| 필드 | 형태 |
|---|---|
| `content` | string |

### `playerNotes/all` — 확인됨

| 필드 | 형태 | 용도 |
|---|---|---|
| `notes` | map | 정규화된 선수 이름 → 다음 모임에 이어 보여줄 비고 |

`notes` 전체 맵을 한 번에 저장한다.

### `admins/{uid}` — 부분 확인

- 문서 ID는 Firebase Authentication 사용자 UID다.
- 애플리케이션은 문서의 존재 여부만 확인하고 내부 필드는 사용하지 않는다.
- 실제 문서 필드, 관리자 수, 생성 절차와 Security Rules는 **미검증**이다.

## 데이터 타입과 호환성 주의사항

- 시각 표현이 혼재한다: Firestore Timestamp, Unix milliseconds, ISO 문자열.
- 이름은 NFC 정규화와 trim을 일부 경로에서 적용하지만 모든 과거 문서가 동일하다는 보장은 없다.
- 날짜는 대부분 `YYYY-MM-DD`지만 공유 데이터의 `meetingInfo.time`은 날짜와 시간이 결합된 문자열이다.
- 일부 문서는 전체 덮어쓰기, 일부는 `{merge: true}`, 일부는 자동 ID 추가를 사용한다. 변경 시 기존 저장 방식을 확인해야 한다.
- 스냅샷 데이터(`dailyMeetings`, `shares`, `matchRecords`)는 원본 `players`가 바뀌어도 자동 갱신되지 않는다.
- 문서 삭제가 관련 컬렉션의 참조를 자동 삭제하거나 수정하지 않는다.

## 저장소만으로 미검증인 데이터 모델 항목

- 운영 Firestore에만 존재하는 레거시 컬렉션과 필드
- 과거 마이그레이션 문서의 정확한 필드와 문서 ID 규칙
- 실제 필드 타입 불일치, 중복 이름, Unicode 정규화 차이 및 잘못된 날짜 문서
- Firestore Security Rules, index, TTL, 백업 및 복구 정책
- 각 컬렉션의 실제 문서 수와 데이터 보존 기간
- 삭제된 문서의 복구 가능 여부
