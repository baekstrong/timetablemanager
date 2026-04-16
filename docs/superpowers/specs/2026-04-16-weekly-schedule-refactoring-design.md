# WeeklySchedule 리팩토링 설계

## 배경

`src/components/WeeklySchedule.jsx`가 1647줄로 비대해져 한 곳 수정 시 연쇄 버그가 발생하는 문제. `mode === 'coach' | 'student'` 분기가 27곳 산재하여 코치/학생 로직이 얽혀 있음. 이미 `useWeeklyData` 훅, `MakeupModal`, `CoachWaitlistPanel`, `CoachWaitlistModal`은 분리됨. 남은 본체를 코치/학생 컴포넌트로 분할.

## 목표

- 한 파일을 한 번에 머리에 담을 수 있는 크기(≤500줄)로 분할
- 코치/학생 로직 격리 → 한쪽 수정이 다른 쪽에 영향 미치지 않도록
- 모드 분기 27곳 → 8-10곳으로 축소
- **기능 변경 없음** (순수 구조 리팩토링)

## 최종 구조

```
src/
├── hooks/
│   └── useWeeklyData.js                  (기존, 유지)
├── components/
│   ├── WeeklySchedule.jsx                (~80줄, 모드 라우팅)
│   └── schedule/
│       ├── MakeupModal.jsx               (기존)
│       ├── CoachWaitlistPanel.jsx        (기존)
│       ├── CoachWaitlistModal.jsx        (기존)
│       ├── CoachSchedule.jsx             (신규, ~480줄)
│       ├── StudentSchedule.jsx           (신규, ~320줄)
│       ├── ScheduleCell.jsx              (신규, ~220줄)
│       ├── useScheduleCore.js            (신규, ~280줄, 공통 로직)
│       └── scheduleUtils.js              (신규, ~100줄, 순수 함수)
```

## 컴포넌트 책임

### WeeklySchedule.jsx (메인)
- props: `user, studentData, onBack, onNavigate`
- `mode` state 관리 (코치인 경우만 토글)
- `user.role`에 따라 `<CoachSchedule>` 또는 `<StudentSchedule>` 렌더
- 공통 헤더(주간 네비게이션, MonthSelector) 포함

### CoachSchedule.jsx
- 코치 전용 셀 렌더 (`renderCoachCell`)
- 코치 전용 state: `disabledClasses`, `lockedSlots`, `showWaitlistModal`, `waitlistDesiredSlot`, `isDirectTransfer`, `waitlistStudentName`, `waitlistStudentSearch`
- 핸들러: `handleDirectTransfer`, `handleWaitlistSubmit`, `handleWaitlistCancel`, `toggleClassDisabledHandler`, `toggleLockedSlotHandler`
- UI: LastDay/DelayedReregistration 배너, WaitlistPanel, 만석/대기 관리

### StudentSchedule.jsx
- 학생 전용 셀 렌더 (`renderStudentCell`)
- 학생 전용 state: `showMakeupModal`, `selectedMakeupSlot`, `selectedOriginalClass`, `activeMakeupRequests`, `isSubmittingMakeup`
- 핸들러: `handleAvailableSeatClick`, `handleMakeupSubmit`, `handleMakeupCancel`, `reloadStudentMakeups`
- UI: 이용 안내(보강 조건), MakeupModal, 내 시간표 강조

### ScheduleCell.jsx
- 순수 렌더 컴포넌트. props로 받은 데이터만으로 셀 UI 생성
- 내부 presentational 컴포넌트: `StudentTag`, `AvailableSeatsCell`, `HolidayCell`
- props: `day, period, cellData, onClick, mode, userRole`

### useScheduleCore.js (훅)
- 코치/학생 양쪽이 쓰는 데이터/계산 로직 집중
- export: `getCellData`, `getEffectiveEndDate`, `lastDayStudents`, `delayedReregistrationStudents`, `weekDates`, 공휴일/홀딩 조회 헬퍼
- `useWeeklyData`를 내부에서 호출하여 래핑

### scheduleUtils.js (순수 함수)
- 스타일 상수: `TAG_STYLES`, `SECTION_STYLES`, `DELETE_BTN_STYLE`
- 순수 변환 함수: 날짜 포맷, 요일 매핑, 교시 조회

## 데이터 흐름

```
WeeklySchedule
  ├─ useScheduleCore()  → { cellDataMap, lastDayStudents, ... }
  │                       (공통 데이터)
  ├─ user.role === 'coach' ?
  │   └─ CoachSchedule(props = {scheduleCore, student list, ...})
  │       └─ ScheduleCell (mode='coach')
  └─ else
      └─ StudentSchedule(props = {scheduleCore, studentData, ...})
          └─ ScheduleCell (mode='student')
```

공통 데이터는 `useScheduleCore` 훅이 한 번 계산해서 양쪽에 내려줌. 모드별 state/handler는 각 컴포넌트 내부에 격리.

## 마이그레이션 순서 (점진적, 각 단계 커밋)

1. **scheduleUtils.js 분리** — 스타일 상수 + 순수 함수만 이동 (가장 낮은 리스크)
2. **ScheduleCell.jsx 추출** — `StudentTag`, `AvailableSeatsCell`, `HolidayCell` presentational 이동
3. **useScheduleCore.js 훅 생성** — `getCellData`, `getEffectiveEndDate`, `lastDayStudents` 등 공통 계산 이동
4. **StudentSchedule.jsx 추출** — 학생 state/handler/JSX 전부 이동. 메인에서 학생 모드는 이 컴포넌트 렌더
5. **CoachSchedule.jsx 추출** — 코치 state/handler/JSX 전부 이동
6. **WeeklySchedule.jsx 정리** — 라우터만 남기고 껍데기화

각 단계에서 앱이 정상 동작해야 하며, 단계별 검증 체크리스트 통과 후 다음 단계로.

## 검증 체크리스트 (자동화된 테스트 없음 — 수동)

각 단계 후 다음 골든 플로우를 확인:

**코치 모드:**
- [ ] 주간 시간표 정상 표시 (모든 교시/요일)
- [ ] 만석 칸 클릭 → 대기 등록 모달
- [ ] 수강생 태그 우클릭/길게누르기 → 직접 이동 가능
- [ ] 수업 비활성화 토글 정상
- [ ] 마지막 수업일/지연 재등록 배너 정상 표시
- [ ] 대기 목록(CoachWaitlistPanel) 정상 표시

**학생 모드 (본인 일정 보기):**
- [ ] 내 정규 수업 하이라이트
- [ ] 여석 칸 클릭 → 보강 모달
- [ ] 기존 보강 신청 표시 + 취소 버튼
- [ ] 보강 조건 안내(방금 추가한 것) 표시
- [ ] 주간 이동 정상

**역할 전환 (코치 계정만):**
- [ ] "코치 모드/학생 모드" 전환 버튼 동작
- [ ] 전환 시 상태 초기화 없음

## 위험 & 완화

- **위험**: 숨은 closure 의존성(useEffect 내부에서 참조하는 state가 다른 컴포넌트로 이동 시 끊어짐).
  - **완화**: 각 단계에서 `npm run dev` 구동 후 콘솔 에러 + 골든 플로우 수동 확인. 문제 시 단계 rollback.
- **위험**: `useWeeklyData` 훅의 dependencies가 기존 코드에 강결합.
  - **완화**: 훅 자체는 건드리지 않고 `useScheduleCore`가 래핑. 필요 시 추가 export만 늘림.
- **위험**: 프롭 드릴링이 많아져 가독성 저하.
  - **완화**: 공통 데이터는 `scheduleCore` 객체 하나로 묶어 전달. 모드별 prop은 모드 컴포넌트 내부 state로 해결.

## 범위 외 (Out of Scope)

- 테스트 작성 (별도 작업)
- `useWeeklyData` 훅 내부 수정
- Firestore/Sheets 서비스 레이어 변경
- UI/UX 변경 (버튼 위치, 스타일 등)
- 기존 버그 수정 (리팩토링 중 발견한 버그는 별도 커밋/이슈로)

## 완료 기준

- 모든 파일 ≤500줄
- 모드 분기 ≤10곳
- 검증 체크리스트 전부 통과
- 기존 기능 동작 차이 없음
