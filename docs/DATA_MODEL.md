# BareaPlay Firestore 데이터 모델

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
