# 근력학교 수강 관리 시스템 (timetable-manager)

<!-- GIT-WORKFLOW-RULE:START -->
## ⚠️ Git 작업 규칙 (필수)

이 저장소에서 작업할 때는 아래 순서를 **반드시** 지킨다.

### 1. 작업 시작 시 — 가장 먼저 `git pull`
원격의 최신 변경사항을 받아온 뒤에 작업을 시작한다.
```bash
git pull
```
- 충돌(conflict)이 나면 작업 전에 먼저 해결한다.
- pull 없이 곧바로 코드를 수정하지 않는다.

### 2. 작업 종료 시 — `add` → `commit` → `push`
변경사항을 반드시 커밋하고 원격에 푸시한 뒤 작업을 마친다.
```bash
git add -A
git commit -m "<한글 커밋 메시지>"
git push
```
- 커밋 메시지는 **한글**로, 무엇을·왜 바꿨는지 알 수 있게 작성한다.
- 변경사항이 있는데 커밋/푸시하지 않고 작업을 끝내지 않는다.
<!-- GIT-WORKFLOW-RULE:END -->


> **이 파일은 프로젝트 변경 시 반드시 함께 업데이트해야 합니다**.코드 수정, 파일 추가/삭제, 구조 변경, 비즈니스 로직 변경이 있으면 해당 섹션을 갱신하세요.

## 프로젝트 개요

개인 트레이닝 스튜디오 "근력학교"를 위한 React PWA. 수강생 등록/관리, 주간 시간표, 홀딩/결석, 보강, 공휴일, 신규 수강 신청, SMS 알림을 통합 관리합니다.

## 기술 스택

- **프론트엔드**: React 19, Vite 7 (ES modules)
- **데이터 저장 (주)**: Google Sheets API v4 (서비스 계정 인증)
- **데이터 저장 (보조)**: Firebase Firestore (실시간 운영 데이터)
- **백엔드 (프로덕션)**: Netlify Functions (서버리스)
- **백엔드 (로컬)**: Express 서버 (`functions/server.js`, 포트 5001)
- **SMS**: Solapi API (HMAC-SHA256 인증)
- **캘린더**: Google Calendar API v3 (입학반 일정 — `calendarService.js` + Netlify `calendar.js`, 종료일 동기화 — `google-apps-script/CalendarSync.gs`)
- **차트**: Recharts
- **이미지 업로드**: Cloudinary(unsigned upload preset) + `browser-image-compression`(`cloudinaryService.js`, 게시판 첨부)
- **에러 모니터링**: Sentry(`@sentry/react`, `src/main.jsx`에서 프로덕션만 init)
- **훈련일지 서브앱**: Vanilla JS SPA (`public/training-log/`, Tailwind CDN, Firebase)

## 디자인 시스템 (플랫 + 단일 코발트)

Channel Talk/Bezier 기반. **완전 플랫**(그라데이션·장식 그림자 없음) + **단일 코발트 액센트**. 토큰은 `src/index.css`의 `:root`에 정의되며 모든 컴포넌트는 하드코딩 색 대신 이 변수를 참조한다.

### 핵심 원칙 (반드시 지킬 것)
1. **그라데이션 0개** — `linear-gradient` 신규 사용 금지. 단색 토큰만.
2. **단일 브랜드 액센트는 코발트 `--accent #329BE7`** — 큰 면적 배경엔 쓰지 말고 액센트로만. 보라/인디고/바이올렛(`#667eea`·`#6366f1`·`#8b5cf6` 등) 도입 금지.
3. **본문 텍스트는 `--text` (rgba(0,0,0,.85))** — 순수 `#000` 금지.
4. **그림자는 모달/팝오버 본체에만** — 카드 깊이는 `1px solid var(--hairline)` 보더 + 표면 틴트로.
5. **라디우스는 사다리값에서만** — `--r-chip 8` / `--r-md 12` / `--r-cta 18` / `--r-card 20` / `--r-band 32`. 보간(24 등) 금지.
6. **상태색은 상태표시에만** — `--success`/`--caution`/`--error`/`--info`. 장식에 쓰지 말 것. 상태칩 패턴: 배경 `{색}1A` + 보더 `1px solid {색}4D` + 텍스트 해당 색.

### 주요 토큰
- 액센트: `--accent #329BE7`, `--accent-hover #327AB8`, `--accent-light #47C8FF`, `--accent-10/20/30`(알파)
- 표면: `--canvas #fff`, `--surface #FCFCFC`, `--canvas-tint #F7F7F8`, `--hairline #EFEFF0`
- 텍스트: `--text`, `--text-secondary`, `--text-muted #A7A7AA`, `--cta-dark #242428`
- 상태: `--success #31A552`, `--caution #EDBC40`, `--error #E94E58`, `--info #5E56F0`
- 모션: `--ease cubic-bezier(0.3,0,0,1)`, `--dur-s/m/l` 150/300/450ms
- 폰트: `--font` = Inter + Noto Sans KR (weight 400/700)

### 훈련일지 서브앱
`public/training-log/`는 별도 HTML이라 `:root` 변수를 못 쓴다. 코발트 hex(`#329BE7`) 또는 Tailwind arbitrary value(`bg-[#329BE7]`)를 직접 사용한다.

## 배포

- **프론트엔드**: GitHub Pages (`.github/workflows/deploy.yml`로 자동 배포, `main` 브랜치 push 시 트리거)
- **백엔드 (Netlify Functions)**: Netlify 자동 배포 (`netlify.toml` 설정, `main` 브랜치 push 시 트리거)
  - `netlify.toml`의 `functions = "netlify/functions"` 경로에서 서버리스 함수 배포
  - 프론트엔드 빌드는 Netlify에서 하지 않음 (`command = ""`)
- **API 연결**: 프론트엔드에서 `VITE_FUNCTIONS_URL` 환경변수로 Netlify Functions URL 지정
- **Firebase**: 별도 배포 없음 (Firestore는 클라이언트 SDK로 직접 접근, `src/config/firebase.js`에서 초기화)

## 개발 명령어

```bash
npm run dev        # Vite 개발 서버 (React 앱)
npm run backend    # 로컬 백엔드 (functions/server.js, 포트 5001)
npm run build      # 프로덕션 빌드
npm run preview    # 빌드 결과 미리보기
npm run lint       # ESLint (eslint .)
npm run test       # Vitest 단위 테스트 (vitest run)
```

## 운영/버그 픽스 규칙

- ops cron `ops 근력학교 repo weekly pull 매주 월 03:20`가 매주 월요일 03:20 KST에 로컬 repo를 최신화한다.
- 자동 최신화는 `git pull --ff-only`만 허용한다. 충돌/실패 시 임의 merge하지 말고 보고한다.
- 근학 앱 버그 픽스 작업을 시작하기 전에는 항상 먼저 최신 main을 pull 한다.

```bash
git -C /Users/baeggwanjangjadonghwa/workspace/repos/timetablemanager pull --ff-only
```

- pull 실패, 로컬 변경 충돌, fast-forward 불가 상태면 수정하지 말고 원인과 필요한 선택지를 보고한다.
- 버그 원인 분석/수정안 제안은 가능하지만 실제 수정·push·배포는 백관장 승인 후 진행한다.

## 업데이트 공지 규칙 (관리자봇)

main에 푸시(배포)하는 변경이 **수강생이 체감하는 변경**(새 기능, 화면/동작 변화)이면:

1. Claude가 공지 초안(제목+본문)을 터미널에 제시하고 **백관장 승인을 받는다**. 승인 전에는 절대 게시하지 않는다.
2. 승인 시 아래 스크립트를 실행한다. 기존 관리자봇 업데이트 공지는 자동으로 내려가고 새 공지로 교체된다.

```bash
node --env-file=.env scripts/post-update-notice.js "제목" "본문"
```

3. 거절 시 공지 없이 배포만 진행한다.
4. 내부 리팩토링·마이너 버그 픽스는 공지 제안 자체를 하지 않는다.
5. Node 20.6 미만 환경에서는 `set -a; source .env; set +a; node scripts/post-update-notice.js ...`로 실행한다.

## 디렉토리 구조

```
src/
├── App.jsx                          # 루트 컴포넌트, 수동 라우팅 (currentPage state + switch/case)
├── main.jsx                         # React 진입점
├── config/firebase.js               # Firebase 초기화
├── contexts/GoogleSheetsContext.jsx  # 전역 상태 (students, selectedMonth, 각종 유틸)
├── services/
│   ├── googleSheetsService.js       # Google Sheets API 호출 (~1768줄)
│   ├── firebaseService.js           # Firestore CRUD (~1123줄)
│   ├── smsService.js                # Solapi SMS 발송 (sendManualSMS 포함)
│   ├── analyticsService.js          # 매출·통계 집계 로직
│   └── makeupWaitlistService.js     # 보강 대기 자리 발생 감지·순차 SMS 알림 오케스트레이션 (CRUD는 firebaseService)
├── utils/
│   └── makeupWaitlist.js            # 보강 대기 순번/만료 판정 순수 로직 (1시간·수업시작 마감)
├── components/
│   ├── Login.jsx                    # 로그인 (Firestore 평문 비밀번호 비교)
│   ├── Dashboard.jsx                # 대시보드 (커뮤니티 게시판)
│   ├── WeeklySchedule.jsx           # 주간 시간표 (핵심 컴포넌트; 진행중/임박 셀 강조, 미결제 배지)
│   ├── StudentManager.jsx           # 코치용 수강생 목록/관리 (이름·전화번호 검색 포함)
│   ├── StudentRegistrationModal.jsx # 코치용 직접 등록 모달 (신규/재등록)
│   ├── StudentInfo.jsx              # 학생용 내 정보 조회
│   ├── HoldingManager.jsx           # 홀딩/결석 신청
│   ├── HolidayManager.jsx           # 코치용 공휴일 관리
│   ├── MakeupRequestManager.jsx     # 보강 관리
│   ├── CoachNewStudents.jsx         # 신규 신청 승인/거절
│   ├── ContractView.jsx            # 재등록 계약 동의 페이지 (학생용)
│   ├── ContractHistory.jsx         # 계약 이력 모달 (코치/학생 공용)
│   ├── NewStudentRegistration.jsx   # 신규 수강생 7단계 위자드 (외부 접근: ?register=true)
│   ├── schedule/                    # 시간표 분리 컴포넌트 (CoachSchedule, StudentSchedule, MakeupModal, MakeupWaitlistModal=대기 수락/거절 모달, ScheduleCell 등)
│   ├── MonthSelector.jsx            # 월 선택 드롭다운 (6개월전~3개월후)
│   ├── BottomNav.jsx                # 하단 네비게이션 (코치/학생 탭 다름)
│   ├── Ranking.jsx                  # 랭킹·내 PR·성장 그래프 페이지 (3 탭)
│   ├── PRSubmitModal.jsx            # 공식 PR 측정 등록 모달 (prType별 동적 폼)
│   ├── AnalyticsDashboard.jsx       # 매출·통계 대시보드 (코치용)
│   ├── SmsSendModal.jsx             # 코치 수동 문자 발송 모달 (수신자 선택 + 발송 결과 상태창)
│   ├── PasswordChangeCard.jsx       # 수강생 비밀번호 변경 카드 (내 정보 하단)
│   ├── GoogleSheetsSync.jsx         # Sheets 동기화 UI
│   ├── GoogleSheetsEmbed.jsx        # Sheets 임베드
│   └── GoogleSheetsTest.jsx         # Sheets 연결 테스트
├── board/
│   ├── PostList.jsx               # 게시판 글 목록 + 카테고리 탭
│   ├── PostDetail.jsx             # 글 상세 + 댓글 + 좋아요
│   ├── PostForm.jsx               # 글 작성/수정 모달
│   ├── CommentItem.jsx            # 댓글 컴포넌트
│   └── Board.css                  # 게시판 스타일
└── data/
    ├── mockData.js                  # 교시 정의, 요금제, 상수
    ├── contractTerms.js             # 재등록 계약 조건 상수
    └── boardConstants.js            # 게시판 카테고리, 입력 제한 상수

netlify/functions/
├── sheets.js    # Google Sheets 서버리스 함수
└── sms.js       # Solapi SMS 서버리스 함수

functions/
├── server.js    # 로컬 개발용 Express (Sheets + SMS API)
└── package.json

scripts/
└── post-update-notice.js  # 관리자봇 업데이트 공지 게시 스크립트

public/training-log/   # 훈련일지 서브앱 (별도 Vanilla JS SPA)
├── index.html
└── js/ (main.js, state.js, config.js, ui.js, utils.js, modules/*)
```

## 라우팅

React Router 미사용. `App.jsx`의 `currentPage` state로 수동 관리:

| currentPage | 컴포넌트 | 설명 |
| --- | --- | --- |
| `dashboard` | Dashboard | 커뮤니티 게시판 |
| `schedule` | WeeklySchedule | 주간 시간표 |
| `holding` | HoldingManager | 홀딩/결석 (학생용) |
| `myinfo` | StudentInfo | 내 정보 (학생용) |
| `students` | StudentManager | 수강생 관리 (코치용) |
| `holidays` | HolidayManager | 공휴일 (코치용) |
| `newstudents` | CoachNewStudents | 신규 승인 (코치용) |
| `contractView` | ContractView | 재등록 계약 동의 (학생용) |
| `ranking` | Ranking | 랭킹·내 PR·성장 그래프 (코치/학생 공용, Dashboard 카드로 진입) |
| `analytics` | AnalyticsDashboard | 매출·통계 대시보드 (코치용, 수강생 관리에서 진입) |

- URL `?register=true` → 로그인 없이 `NewStudentRegistration` 직접 렌더링
- 훈련일지 탭 → `window.location.href = './training-log/index.html'` (React 외부)

## 인증

- Firebase Auth 미사용
- Firestore `users/{이름}` 문서에서 평문 비밀번호 직접 비교
- `isCoach` 필드로 코치/학생 역할 구분
- 자동 로그인: `localStorage.login_credentials`, `localStorage.savedUser`
- 수강생은 내 정보에서 비밀번호 변경 가능 (`firebaseService.updateUserPassword`, localStorage 자격증명 동기화)

## Google Sheets 구조

### 시트 탭 명명

```
등록생 목록(26년1월)  → 2026년 1월 데이터
등록생 목록(26년2월)  → 2026년 2월 데이터
```

### 행 구조

- Row 1 (인덱스 0): 병합된 헤더 (무시)
- Row 2 (인덱스 1): 컬럼 헤더
- Row 3+ (인덱스 2+): 데이터
- `actualRow = _rowIndex + 3` (배열 인덱스 → 시트 행번호)

### 컬럼 매핑 (A\~R)

| 열 | 필드 | 설명 | 형식 |
| --- | --- | --- | --- |
| A | 번호 | 자동 순번 (A열 최대값+1) | 숫자 |
| B | 이름 | 수강생 이름 | 텍스트 |
| C | 주횟수 | 주 몇 회 | 2, 3, 4 |
| D | 요일 및 시간 | 수업 일정 인코딩 | `월1수1`, `화5목5금5` |
| E | 특이사항 | 메모, 결석 기록 | `26.2.10 결석` |
| F | 신규/재등록 | 등록 유형 | `신규` / `재등록` |
| G | 시작날짜 |  | `YYMMDD` (예: `260111`) |
| H | 종료날짜 |  | `YYMMDD` |
| I | 결제금액 |  | 숫자 |
| J | 결제일 |  | `YYMMDD` |
| K | 결제유무 |  | `O` / `X` |
| L | 결제방식 |  | `카드`/`계좌`/`네이버`/`제로페이` |
| M | 홀딩 사용여부 |  | `X`, `O`, `X(0/2)`, `O(1/3)` |
| N | 홀딩 시작일 |  | `YYMMDD` |
| O | 홀딩 종료일 |  | `YYMMDD` |
| P | 핸드폰 |  | 전화번호 |
| Q | 성별 |  | `남` / `여` |
| R | 직업 |  | 텍스트 |

### 수업 일정 인코딩 (D열)

```
"월1수1"   → 월요일 1교시, 수요일 1교시
"화5목5"   → 화요일 5교시, 목요일 5교시
"월1수1금1" → 주3회 (월수금 1교시)
```

파싱: 한국어 요일(월화수목금) + 숫자(교시)를 순서대로 읽음.

### 홀딩 상태 인코딩 (M열)

| 값 | 의미 |
| --- | --- |
| `X` | 1개월 등록, 홀딩 미사용 |
| `O` | 1개월 등록, 홀딩 사용 중 |
| `X(0/2)` | 2개월 등록, 0회 사용 |
| `O(1/3)` | 3개월 등록, 1회 사용 중 |

## 교시 정의 (mockData.js)

| ID | 이름 | 시간 | 비고 |
| --- | --- | --- | --- |
| 1 | 1교시 | 10:00\~11:30 |  |
| 2 | 2교시 | 12:00\~13:30 |  |
| 3 | 3교시(자율) | 15:00\~17:00 | type: 'free' |
| 4 | 4교시 | 18:00\~19:30 |  |
| 5 | 5교시 | 19:50\~21:20 |  |
| 6 | 6교시 | 21:40\~23:10 |  |

- `MAX_CAPACITY = 7` (슬롯당 최대 수강생)
- 요일: `['월', '화', '수', '목', '금']`

## Firebase Firestore 컬렉션

| 컬렉션 | 용도 |
| --- | --- |
| `users` | 로그인 계정 `{password, isCoach, createdAt}` |
| `makeupRequests` | 보강 신청 (status: active/completed/cancelled) |
| `holdingRequests` | 홀딩 신청 |
| `absenceRequests` | 결석 신청 |
| `posts` | 커뮤니티 게시판 (category: notice/free/exercise/question, soft delete) |
| `posts/{postId}/comments` | 게시글 댓글 (서브컬렉션, soft delete) |
| `holidays` | 코치 커스텀 공휴일 |
| `disabledClasses` | 비활성화된 수업 슬롯 (키: `"월-1"`) |
| `waitlistRequests` | 시간표 대기 신청 — 영구 시간표 변경 (status: waiting/notified/accepted/cancelled) |
| `newStudentRegistrations` | 신규 수강 신청 (pending/approved/rejected). `smsLog{reception,approval,reminder}` 필드에 자동 문자 발송 결과 기록 → 신규 페이지 SMS 상황판(상태칩+재발송)이 이를 읽음. `registeredByCoach=true`(코치 직접 등록)는 자동문자 대상 아님. `referralSource`(유입경로: 인스타그램/네이버/지인추천/직접방문/기타) 필드를 포함하며 매출·통계 대시보드 유입경로 집계에 사용 |
| `entranceClasses` | 입학반 정보 |
| `registrationFAQ` | 신규 등록 FAQ |
| `coachPinnedMemos` | 코치가 수강생별 고정한 메모 (훈련일지) |
| `pinnedMemos` | 수강생 자신의 고정 메모 (훈련일지) |
| `renewalContracts` | 재등록 계약 (status: pending/agreed/cancelled) |
| `personalBests` | 공식 PR 측정 결과 (`prType`별 비교 룰; doc id: `{userName}__{exercise}` 또는 `{userName}__{exercise}__{intensity}{unit}` for `weightThenReps`) |
| `studentTerminations` | 코치가 '종료' 버튼으로 수강 종료한 기록 (이탈 통계용). `{studentName, terminatedBy:'coach', reason, terminatedAt}` |
| `makeupWaitlists` | 만석 슬롯 보강 대기 (status: waiting/notified/accepted/declined/expired/cancelled). 자리 발생 시 선착순 1명에게 SMS → 1시간(수업 시작이 더 가까우면 그때까지) 내 앱 시간표 '보강승인중' 칩에서 수락, 무응답/거절 시 다음 순번. 트리거: 홀딩/결석/보강취소/거절 + 코치 시간표 로드 백스톱 |

### `personalBests` 상세

**저장 시점**: `Ranking` 페이지 → `PRSubmitModal` → `submitPersonalBest()` (firebaseService.js)

**문서 ID 규칙**:
- `oneRM`/`timeHold`/`bodyweightReps`: `{userName}__{exercise}` (운동당 1개)
- `weightThenReps`: `{userName}__{exercise}__{intensity.value}{intensity.unit}` (중량별 분리)

**필드**: `{userName, exercise, prType, intensity:{value,unit}, reps:{value,unit}, date, note, history:[…], createdAt, updatedAt}`

**갱신 룰 (`isNewPRBetter`)**:
- `oneRM`: `intensity.value` 큰 쪽
- `weightThenReps`: 같은 도큐먼트(=같은 중량) 내 `reps.value` 큰 쪽
- `timeHold` / `bodyweightReps`: `reps.value` 큰 쪽

갱신 안 되어도 `history` 배열에는 측정 시도 기록 추가됨.

## 데이터 흐름

### Google Sheets API 경로

```
React → googleSheetsService.js → [프로덕션] netlify/functions/sheets.js
                                → [로컬]     functions/server.js (포트 5001)
                                → Google Sheets API v4
```

- `VITE_FUNCTIONS_URL` 설정 시 해당 URL 사용, 미설정 시 `/.netlify/functions/sheets`

### API 엔드포인트

| 메서드 | 경로 | 기능 |
| --- | --- | --- |
| GET | `/read?range=` | 시트 데이터 읽기 |
| POST | `/write` | 셀 값 업데이트 |
| POST | `/append` | 행 추가 |
| GET | `/info` | 시트 목록 조회 |
| POST | `/batchUpdate` | 여러 범위 일괄 업데이트 |
| POST | `/formatCells` | 셀 색상 하이라이트 |

### 이중 쓰기 패턴

홀딩/결석 데이터는 **Firebase + Google Sheets** 두 곳에 동시 저장:

- Firebase: 실시간 조회, 상태 관리 (취소/완료)
- Google Sheets: 영구 기록, 종료일 재계산 기준

## 핵심 비즈니스 로직

### 종료일 계산

`calculateEndDate(startDate, totalSessions, scheduleStr, holdingRanges, firebaseHolidays)`

- 시작일부터 하루씩 전진, 유효한 수업일만 카운트
- 제외 조건: 수업 요일 아님, 홀딩 기간, 한국 공휴일, Firebase 커스텀 공휴일
- 총 수업 횟수 = `주횟수 × 4 × 등록개월수`
- 최대 365번 반복 (무한 루프 방지)

### 홀딩 신청 흐름

1. 학생이 날짜 선택 후 신청 → Firebase `holdingRequests` 생성
2. Google Sheets M/N/O열 업데이트
3. 홀딩 기간 포함하여 종료일(H열) 재계산
4. **미리 등록(다음 등록)이 있으면 시작일/종료일 자동 조정**
5. 변경 셀 노란색 하이라이트

- 신청 데드라인: 홀딩 시작일 수업 시작 **1시간** 전
- 취소 데드라인: 홀딩 시작일 수업 시작 **30분** 전 (보강일 포함, `getClassPeriod` 사용)
- 코치모드에서는 데드라인 제약 없이 취소 가능 (StudentManager)
- 코치모드에서도 수강생 관리 페이지의 '홀딩' 버튼으로 직접 처리 가능 (Firebase + Sheets 동시 기록)

### 중복 등록 처리 (미리 등록)

- 같은 이름의 수강생이 같은 시트에 여러 행(현재 등록 + 미리 등록)으로 존재 가능
- `pickActiveRegistration()`, `pickActiveRowIndex()`: 오늘 기준 수강 기간 내인 등록을 우선 선택
- `_nextRegistration` 필드: 미리 등록된 다음 수강 정보를 보존
- `adjustNextRegistration()`: 홀딩/취소로 현재 종료일이 변경되면 다음 등록의 시작일/종료일도 자동 조정

### 결석 처리

- E열(특이사항)에 `"26.2.10 결석"` 형식으로 추가
- 결석일을 홀딩 범위에 포함 → 종료일 연장
- 데드라인: 수업 시작 **10분** 전

### 보강 시스템

- 학생이 WeeklySchedule에서 원래 수업 → 보강 날짜/교시 선택
- Firebase `makeupRequests` 생성 (status: active)
- 당주 최대 보강 횟수 = `weeklyFrequency`
- 향후 14일 이내 선택 가능
- 지난 날짜의 활성 보강 → 자동 `completed` 처리
- 신청 데드라인: 원본 수업과 보강 대상 수업 모두 시작 **1시간** 전까지
- 취소 데드라인: 보강 수업 시작 **30분** 전까지

### 만석 슬롯 보강 대기 흐름 (makeupWaitlists)

만석 슬롯 클릭 시 대기 신청 모달(`MakeupModal` 재사용)에서 원래 수업을 선택해 `makeupWaitlists` 컬렉션에 등록한다. 자리 발생 트리거(홀딩 신청/결석 신청/보강 취소·거절 + 코치 시간표 로드 백스톱)가 실행되면 대기 1순위에게 자리 안내 SMS를 발송하고 status를 `notified`로 변경한다. 수강생은 시간표의 '보강승인중' 칩을 클릭해 1시간(수업 시작이 더 가까우면 그때까지) 내에 수락 또는 거절할 수 있다. 수락 시 정식 보강(`makeupRequests`)으로 확정되고 종료일이 재계산된다. 거절하거나 시간 초과로 만료되면 다음 순번에게 동일하게 안내한다. 대기 신청은 주간 보강 쿼터를 미리 소진하지 않으며, 수락 시점에 쿼터를 검증한다.

### WeeklySchedule 수강생 상태

| 상태 | 설명 |
| --- | --- |
| `regular` | 정규 등록 |
| `makeup` | 보강 온 수강생 |
| `makeup-absent` | 보강으로 자리 비움 |
| `holding` | 홀딩 중 |
| `delayed` | 시작일 전 |
| `new` | 신규 수강생 |
| `agreed-absent` | 합의 결석 |
| `absent` | 결석 신청 처리됨 |
| `makeup-pending`(보강승인중) | 만석 대기 중 자리 안내 문자를 받고 수락 대기 중 |
| 보강대기 | 만석 슬롯 대기열 등록 상태 (코치 시간표 칩) |

### 신규 수강생 등록 → 승인

**등록** (NewStudentRegistration, 7단계): 개인정보 → 주횟수 → 시간표 → 입학반 → 결제방식 → 상담여부 → 요약+제출

**승인** (CoachNewStudents):

1. Firestore `users/{name}` 계정 생성
2. 시트 빈 행 탐색 → A열 번호 자동 부여 (A열 최대값+1)
3. A\~R열 전체 작성 (시작/종료일 자동 계산)
4. 행 주황색 하이라이트
5. 승인 SMS + 입학반 3일 전 예약 SMS 발송

### 요금제

| 주횟수 | 수강료 | 입학비 포함 |
| --- | --- | --- |
| 주4회 | 450,000원 | 530,000원 |
| 주3회 | 390,000원 | 470,000원 |
| 주2회 | 310,000원 | 390,000원 |

입학비: 80,000원

## 날짜 형식 규칙

| 용도 | 형식 | 예시 |
| --- | --- | --- |
| Google Sheets 저장 | `YYMMDD` | `260111` |
| JavaScript 내부 | `YYYY-MM-DD` | `2026-01-11` |
| 특이사항 결석 기록 | `YY.M.D` | `26.2.10` |
| Solapi 예약 발송 | `YYYY-MM-DD HH:mm:ss` (KST) | `2026-02-13 09:00:00` |

## SMS 시스템 (Solapi)

| 발송 시점 | 수신자 | 내용 |
| --- | --- | --- |
| 신규 신청 | 학생 | 접수 확인 |
| 신규 신청 | 코치 | 신청 알림 + 정보 |
| 승인 | 학생 | 승인 확인 + 준비 메시지 + 결제 링크 |
| 승인 (예약) | 학생 | 입학반 3일 전 오전 9시 리마인더 |
| 수동 발송 | 코치가 선택한 수강생 | 수강생 관리 → 문자 보내기 (수신자별 성공/실패 상태창) |
| 보강 대기 자리 발생 | 대기 1순위 수강생 | 자리 발생 시 자동, 1시간 내 시간표에서 수락 안내, 무응답 시 다음 순번 |

## Google Calendar 연동 (입학반 일정)

- `calendarService.js` → Netlify `calendar.js`(로컬은 `server.js`) → Google Calendar API v3
- 입학반 일정 추가/수정/삭제 시 `[입학반] M월 D일 (요일)` 형식 이벤트를 `GOOGLE_CALENDAR_ID` 캘린더에 자동 반영
- `calendarService.getCalendarBaseUrl()`은 `VITE_FUNCTIONS_URL`의 `/sheets`를 떼고 `/calendar`를 붙여 엔드포인트를 결정(없으면 `/.netlify/functions/calendar`, 로컬 `http://localhost:5001/calendar`)
- 별개로 `google-apps-script/CalendarSync.gs`는 시트에 바인딩되어 수강생 **종료일**을 전용 캘린더로 동기화 (앱과 독립적으로 시트에서 직접 실행)

## 훈련일지 서브앱 (training-log)

`public/training-log/`에 위치한 별도 Vanilla JS SPA.

- Firebase 프로젝트: `traininglogforclients` (주 앱과 동일 프로젝트 사용 가능)
- 주 앱과 `localStorage.savedUser`로 세션 공유
- 코치 → 훈련일지: `localStorage.coachSelectedStudents`로 수강생 목록 전달
- 훈련일지 → 시간표 복귀: `sessionStorage.quickReturn` + `login_credentials.autoLogin`

## 환경변수

### 프론트엔드 (VITE\_ 접두사)

- `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`
- `VITE_GOOGLE_SHEETS_ID`
- `VITE_FUNCTIONS_URL` (로컬 개발: `http://localhost:5001`)
- `VITE_CLOUDINARY_CLOUD_NAME`, `VITE_CLOUDINARY_UPLOAD_PRESET` (게시판 이미지 업로드)
- `VITE_SENTRY_DSN` (선택, 미설정 시 코드 내 기본 DSN 사용; 프로덕션에서만 init)

### 서버 (Netlify Functions)

- `GOOGLE_PROJECT_ID`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_CLIENT_EMAIL`, `GOOGLE_SHEETS_ID`
- `SOLAPI_API_KEY`, `SOLAPI_API_SECRET`, `SOLAPI_SENDER_PHONE`
- `COACH_PHONE`
- `NAVER_STORE_LINK_2`, `NAVER_STORE_LINK_3`, `NAVER_STORE_LINK_4`
- `PREPARATION_MESSAGE`
- `GOOGLE_CALENDAR_ID` (입학반 일정 동기화 대상 캘린더)

> ⚠️ 루트의 `*-<해시>.json`(Google 서비스 계정 키)은 시크릿이다. `.gitignore`에 있어야 하며 커밋·노출 금지.

## 작업 시 주의사항

1. **Google Sheets 컬럼 순서(A\~R)를 절대 변경하지 말 것** — 전체 서비스 로직이 컬럼 인덱스에 의존
2. **시트 탭 명명 규칙** `등록생 목록(YY년M월)` **유지** — `getCurrentSheetName()` 함수가 이 패턴에 의존
3. **이중 쓰기 패턴 유지** — 홀딩/결석은 Firebase + Sheets 양쪽 모두 업데이트
4. **종료일 재계산 누락 주의** — 홀딩/결석/보강 변경 시 반드시 `calculateEndDate` 호출하여 H열 업데이트
5. **actualRow = \_rowIndex + 3** — 시트 행 번호 변환 시 이 공식 준수
6. **날짜 형식 혼용 주의** — Sheets는 YYMMDD, JS 내부는 YYYY-MM-DD, 특이사항은 YY.M.D
7. **코치/학생 역할에 따라 UI가 다름** — BottomNav 탭, 기능 접근 권한 확인
8. **A열 번호 자동 부여** — 신규 등록 시 A열 최대값+1로 부여 (중복 방지)