# 근력학교 수강 관리 시스템 (timetable-manager)

> **이 파일은 프로젝트 변경 시 반드시 함께 업데이트해야 합니다.**
> 코드 수정, 파일 추가/삭제, 구조 변경, 비즈니스 로직 변경이 있으면 해당 섹션을 갱신하세요.

## 프로젝트 개요

개인 트레이닝 스튜디오 "근력학교"를 위한 React PWA.
수강생 등록/관리, 주간 시간표, 홀딩/결석, 보강, 공휴일, 신규 수강 신청, SMS 알림을 통합 관리합니다.

## 기술 스택

- **프론트엔드**: React 19, Vite 7 (ES modules)
- **데이터 저장 (주)**: Google Sheets API v4 (서비스 계정 인증)
- **데이터 저장 (보조)**: Firebase Firestore (실시간 운영 데이터)
- **백엔드 (프로덕션)**: Netlify Functions (서버리스)
- **백엔드 (로컬)**: Express 서버 (`functions/server.js`, 포트 5001)
- **SMS**: Solapi API (HMAC-SHA256 인증)
- **훈련일지 서브앱**: Vanilla JS SPA (`public/training-log/`, Tailwind CDN, Firebase)

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
```

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
│   └── smsService.js                # Solapi SMS 발송
├── components/
│   ├── Login.jsx                    # 로그인 (Firestore 평문 비밀번호 비교)
│   ├── Dashboard.jsx                # 대시보드 (공지사항)
│   ├── WeeklySchedule.jsx           # 주간 시간표 (~1719줄, 핵심 컴포넌트)
│   ├── StudentManager.jsx           # 코치용 수강생 목록/관리
│   ├── StudentRegistrationModal.jsx # 코치용 직접 등록 모달 (신규/재등록)
│   ├── StudentInfo.jsx              # 학생용 내 정보 조회
│   ├── HoldingManager.jsx           # 홀딩/결석 신청
│   ├── HolidayManager.jsx           # 코치용 공휴일 관리
│   ├── MakeupRequestManager.jsx     # 보강 관리
│   ├── CoachNewStudents.jsx         # 신규 신청 승인/거절
│   ├── NewStudentRegistration.jsx   # 신규 수강생 7단계 위자드 (외부 접근: ?register=true)
│   ├── MonthSelector.jsx            # 월 선택 드롭다운 (6개월전~3개월후)
│   ├── BottomNav.jsx                # 하단 네비게이션 (코치/학생 탭 다름)
│   ├── GoogleSheetsSync.jsx         # Sheets 동기화 UI
│   ├── GoogleSheetsEmbed.jsx        # Sheets 임베드
│   └── GoogleSheetsTest.jsx         # Sheets 연결 테스트
└── data/mockData.js                 # 교시 정의, 요금제, 상수

netlify/functions/
├── sheets.js    # Google Sheets 서버리스 함수
└── sms.js       # Solapi SMS 서버리스 함수

functions/
├── server.js    # 로컬 개발용 Express (Sheets + SMS API)
└── package.json

public/training-log/   # 훈련일지 서브앱 (별도 Vanilla JS SPA)
├── index.html
└── js/ (main.js, state.js, config.js, ui.js, utils.js, modules/*)
```

## 라우팅

React Router 미사용. `App.jsx`의 `currentPage` state로 수동 관리:

| currentPage | 컴포넌트 | 설명 |
|-------------|---------|------|
| `dashboard` | Dashboard | 공지사항 |
| `schedule` | WeeklySchedule | 주간 시간표 |
| `holding` | HoldingManager | 홀딩/결석 (학생용) |
| `myinfo` | StudentInfo | 내 정보 (학생용) |
| `students` | StudentManager | 수강생 관리 (코치용) |
| `holidays` | HolidayManager | 공휴일 (코치용) |
| `newstudents` | CoachNewStudents | 신규 승인 (코치용) |

- URL `?register=true` → 로그인 없이 `NewStudentRegistration` 직접 렌더링
- 훈련일지 탭 → `window.location.href = './training-log/index.html'` (React 외부)

## 인증

- Firebase Auth 미사용
- Firestore `users/{이름}` 문서에서 평문 비밀번호 직접 비교
- `isCoach` 필드로 코치/학생 역할 구분
- 자동 로그인: `localStorage.login_credentials`, `localStorage.savedUser`

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

### 컬럼 매핑 (A~R)

| 열 | 필드 | 설명 | 형식 |
|----|------|------|------|
| A | 번호 | 자동 순번 (A열 최대값+1) | 숫자 |
| B | 이름 | 수강생 이름 | 텍스트 |
| C | 주횟수 | 주 몇 회 | 2, 3, 4 |
| D | 요일 및 시간 | 수업 일정 인코딩 | `월1수1`, `화5목5금5` |
| E | 특이사항 | 메모, 결석 기록 | `26.2.10 결석` |
| F | 신규/재등록 | 등록 유형 | `신규` / `재등록` |
| G | 시작날짜 | | `YYMMDD` (예: `260111`) |
| H | 종료날짜 | | `YYMMDD` |
| I | 결제금액 | | 숫자 |
| J | 결제일 | | `YYMMDD` |
| K | 결제유무 | | `O` / `X` |
| L | 결제방식 | | `카드`/`계좌`/`네이버`/`제로페이` |
| M | 홀딩 사용여부 | | `X`, `O`, `X(0/2)`, `O(1/3)` |
| N | 홀딩 시작일 | | `YYMMDD` |
| O | 홀딩 종료일 | | `YYMMDD` |
| P | 핸드폰 | | 전화번호 |
| Q | 성별 | | `남` / `여` |
| R | 직업 | | 텍스트 |

### 수업 일정 인코딩 (D열)

```
"월1수1"   → 월요일 1교시, 수요일 1교시
"화5목5"   → 화요일 5교시, 목요일 5교시
"월1수1금1" → 주3회 (월수금 1교시)
```

파싱: 한국어 요일(월화수목금) + 숫자(교시)를 순서대로 읽음.

### 홀딩 상태 인코딩 (M열)

| 값 | 의미 |
|----|------|
| `X` | 1개월 등록, 홀딩 미사용 |
| `O` | 1개월 등록, 홀딩 사용 중 |
| `X(0/2)` | 2개월 등록, 0회 사용 |
| `O(1/3)` | 3개월 등록, 1회 사용 중 |

## 교시 정의 (mockData.js)

| ID | 이름 | 시간 | 비고 |
|----|------|------|------|
| 1 | 1교시 | 10:00~11:30 | |
| 2 | 2교시 | 12:00~13:30 | |
| 3 | 3교시(자율) | 15:00~17:00 | type: 'free' |
| 4 | 4교시 | 18:00~19:30 | |
| 5 | 5교시 | 19:50~21:20 | |
| 6 | 6교시 | 21:40~23:10 | |

- `MAX_CAPACITY = 7` (슬롯당 최대 수강생)
- 요일: `['월', '화', '수', '목', '금']`

## Firebase Firestore 컬렉션

| 컬렉션 | 용도 |
|--------|------|
| `users` | 로그인 계정 `{password, isCoach, createdAt}` |
| `makeupRequests` | 보강 신청 (status: active/completed/cancelled) |
| `holdingRequests` | 홀딩 신청 |
| `absenceRequests` | 결석 신청 |
| `announcements` | 공지사항 (soft delete: `deleted: true`) |
| `holidays` | 코치 커스텀 공휴일 |
| `disabledClasses` | 비활성화된 수업 슬롯 (키: `"월-1"`) |
| `waitlistRequests` | 시간표 대기 신청 — 영구 시간표 변경 (status: waiting/notified/accepted/cancelled) |
| `newStudentRegistrations` | 신규 수강 신청 (pending/approved/rejected) |
| `entranceClasses` | 입학반 정보 |
| `registrationFAQ` | 신규 등록 FAQ |
| `coachPinnedMemos` | 코치가 수강생별 고정한 메모 (훈련일지) |
| `pinnedMemos` | 수강생 자신의 고정 메모 (훈련일지) |

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
|--------|------|------|
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
4. 변경 셀 노란색 하이라이트
- 데드라인: 수업 시작 **1시간** 전

### 결석 처리

- E열(특이사항)에 `"26.2.10 결석"` 형식으로 추가
- 결석일을 홀딩 범위에 포함 → 종료일 연장
- 데드라인: 수업 시작 **30분** 전

### 보강 시스템

- 학생이 WeeklySchedule에서 원래 수업 → 보강 날짜/교시 선택
- Firebase `makeupRequests` 생성 (status: active)
- 당주 최대 보강 횟수 = `weeklyFrequency`
- 향후 14일 이내 선택 가능
- 지난 날짜의 활성 보강 → 자동 `completed` 처리

### WeeklySchedule 수강생 상태

| 상태 | 설명 |
|------|------|
| `regular` | 정규 등록 |
| `makeup` | 보강 온 수강생 |
| `makeup-absent` | 보강으로 자리 비움 |
| `holding` | 홀딩 중 |
| `delayed` | 시작일 전 |
| `new` | 신규 수강생 |
| `agreed-absent` | 합의 결석 |
| `absent` | 결석 신청 처리됨 |

### 신규 수강생 등록 → 승인

**등록** (NewStudentRegistration, 7단계):
개인정보 → 주횟수 → 시간표 → 입학반 → 결제방식 → 상담여부 → 요약+제출

**승인** (CoachNewStudents):
1. Firestore `users/{name}` 계정 생성
2. 시트 빈 행 탐색 → A열 번호 자동 부여 (A열 최대값+1)
3. A~R열 전체 작성 (시작/종료일 자동 계산)
4. 행 주황색 하이라이트
5. 승인 SMS + 입학반 3일 전 예약 SMS 발송

### 요금제

| 주횟수 | 수강료 | 입학비 포함 |
|--------|--------|------------|
| 주4회 | 450,000원 | 530,000원 |
| 주3회 | 390,000원 | 470,000원 |
| 주2회 | 310,000원 | 390,000원 |

입학비: 80,000원

## 날짜 형식 규칙

| 용도 | 형식 | 예시 |
|------|------|------|
| Google Sheets 저장 | `YYMMDD` | `260111` |
| JavaScript 내부 | `YYYY-MM-DD` | `2026-01-11` |
| 특이사항 결석 기록 | `YY.M.D` | `26.2.10` |
| Solapi 예약 발송 | `YYYY-MM-DD HH:mm:ss` (KST) | `2026-02-13 09:00:00` |

## SMS 시스템 (Solapi)

| 발송 시점 | 수신자 | 내용 |
|-----------|--------|------|
| 신규 신청 | 학생 | 접수 확인 |
| 신규 신청 | 코치 | 신청 알림 + 정보 |
| 승인 | 학생 | 승인 확인 + 준비 메시지 + 결제 링크 |
| 승인 (예약) | 학생 | 입학반 3일 전 오전 9시 리마인더 |

## 훈련일지 서브앱 (training-log)

`public/training-log/`에 위치한 별도 Vanilla JS SPA.

- Firebase 프로젝트: `traininglogforclients` (주 앱과 동일 프로젝트 사용 가능)
- 주 앱과 `localStorage.savedUser`로 세션 공유
- 코치 → 훈련일지: `localStorage.coachSelectedStudents`로 수강생 목록 전달
- 훈련일지 → 시간표 복귀: `sessionStorage.quickReturn` + `login_credentials.autoLogin`

## 환경변수

### 프론트엔드 (VITE_ 접두사)

- `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`
- `VITE_GOOGLE_SHEETS_ID`
- `VITE_FUNCTIONS_URL` (로컬 개발: `http://localhost:5001`)

### 서버 (Netlify Functions)

- `GOOGLE_PROJECT_ID`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_CLIENT_EMAIL`, `GOOGLE_SHEETS_ID`
- `SOLAPI_API_KEY`, `SOLAPI_API_SECRET`, `SOLAPI_SENDER_PHONE`
- `COACH_PHONE`
- `NAVER_STORE_LINK_2`, `NAVER_STORE_LINK_3`, `NAVER_STORE_LINK_4`
- `PREPARATION_MESSAGE`

## 작업 시 주의사항

1. **Google Sheets 컬럼 순서(A~R)를 절대 변경하지 말 것** — 전체 서비스 로직이 컬럼 인덱스에 의존
2. **시트 탭 명명 규칙 `등록생 목록(YY년M월)` 유지** — `getCurrentSheetName()` 함수가 이 패턴에 의존
3. **이중 쓰기 패턴 유지** — 홀딩/결석은 Firebase + Sheets 양쪽 모두 업데이트
4. **종료일 재계산 누락 주의** — 홀딩/결석/보강 변경 시 반드시 `calculateEndDate` 호출하여 H열 업데이트
5. **actualRow = _rowIndex + 3** — 시트 행 번호 변환 시 이 공식 준수
6. **날짜 형식 혼용 주의** — Sheets는 YYMMDD, JS 내부는 YYYY-MM-DD, 특이사항은 YY.M.D
7. **코치/학생 역할에 따라 UI가 다름** — BottomNav 탭, 기능 접근 권한 확인
8. **A열 번호 자동 부여** — 신규 등록 시 A열 최대값+1로 부여 (중복 방지)
