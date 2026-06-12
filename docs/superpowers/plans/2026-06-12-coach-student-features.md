# 코치/수강생 편의 기능 7종(A~G) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 설계 문서 `docs/superpowers/specs/2026-06-12-coach-student-features-design.md`의 A~G 7개 기능(시간표 강조, 미결제 배지, 검색창, 수동 SMS, 비밀번호 변경, 보강 대기+순차 SMS, 관리자봇 공지)을 구현한다.

**Architecture:** React 19 + Vite SPA. 데이터는 Google Sheets(주) + Firestore(보조), SMS는 Solapi(기존 `smsService.js` 경유). 순수 로직(시간 판정·대기열 상태 전이)은 `src/utils/`에 두고 Vitest로 TDD, Firestore/SMS 호출은 서비스 레이어, UI는 기존 컴포넌트에 최소 침습으로 추가한다.

**Tech Stack:** React 19, Vitest, firebase web SDK(Firestore), Solapi(기존 Netlify Function `/sms` 경유), Node ESM 스크립트(G).

**전제:** 현재 브랜치 `feat/coach-student-features-2606`. 디자인 시스템 준수(그라데이션 금지, 상태칩 = `{색}1A` 배경 + `{색}4D` 보더 + 해당 색 텍스트).

**검증 명령어:**
- 단위 테스트: `npm run test` (vitest run)
- 린트: `npm run lint`
- 수동 확인: `npm run dev` (+ 로컬 백엔드 필요 시 `npm run backend`)

---

## 파일 구조 요약

| 파일 | 작업 | 기능 |
|------|------|------|
| `src/utils/scheduleUtils.js` | 수정 | A: 교시 진행/임박 판정 헬퍼 |
| `src/utils/scheduleUtils.test.js` | 신규 | A 테스트 |
| `src/utils/studentList.js` / `.test.js` | 수정 | B: 미결제 이름 집합 |
| `src/utils/makeupWaitlist.js` / `.test.js` | 신규 | F: 대기열 순수 로직 |
| `src/components/schedule/scheduleStyles.js` | 수정 | B/F: 태그 스타일 |
| `src/components/schedule/ScheduleCell.jsx` | 수정 | B: UnpaidBadge, StudentTag 확장 |
| `src/components/schedule/CoachSchedule.jsx` | 수정 | A: 강조, B: 배지, F: 코치 칩 |
| `src/components/schedule/StudentSchedule.jsx` | 수정 | F: 대기 신청/칩/수락·거절 |
| `src/components/schedule/MakeupModal.jsx` | 수정 | F: 제목/버튼 라벨 prop화 |
| `src/components/schedule/MakeupWaitlistModal.jsx` | 신규 | F: 수락/거절 모달 |
| `src/components/WeeklySchedule.jsx` | 수정 | B/F: prop 전달, F: 백스톱 |
| `src/components/StudentManager.jsx` | 수정 | C: 검색창, D: 문자 버튼, F: 트리거 |
| `src/components/SmsSendModal.jsx` | 신규 | D: 발송 모달+상태창 |
| `src/components/StudentInfo.jsx` | 수정 | E: 비밀번호 카드 삽입 |
| `src/components/PasswordChangeCard.jsx` | 신규 | E |
| `src/components/HoldingManager.jsx` | 수정 | F: 트리거 |
| `src/App.jsx` | 수정 | E: isImpersonating 전달 |
| `src/services/firebaseService.js` | 수정 | E: updateUserPassword, F: makeupWaitlists CRUD |
| `src/services/smsService.js` | 수정 | D: sendManualSMS, F: 자리 안내 SMS |
| `src/services/makeupWaitlistService.js` | 신규 | F: 오케스트레이션 |
| `scripts/post-update-notice.js` | 신규 | G |
| `CLAUDE.md` | 수정 | G 규칙 + 문서 갱신 |

---

### Task 1: (A) 코치 시간표 — 진행 중/임박 수업 강조

**Files:**
- Modify: `src/utils/scheduleUtils.js` (파일 끝에 추가)
- Create: `src/utils/scheduleUtils.test.js`
- Modify: `src/components/schedule/CoachSchedule.jsx`

- [ ] **Step 1: 실패하는 테스트 작성** — `src/utils/scheduleUtils.test.js` 생성:

```js
import { describe, it, expect } from 'vitest';
import { getPeriodEndMinutes, isPeriodImminentOrOngoing } from './scheduleUtils';

const P5 = { id: 5, name: '5교시', time: '19:50 ~ 21:20', startHour: 19, startMinute: 50 };
const P3 = { id: 3, name: '3교시(자율)', time: '15:00 ~ 17:00', type: 'free', startHour: 15, startMinute: 0 };

const at = (h, m) => new Date(2026, 5, 12, h, m); // 임의의 날짜, 시각만 의미 있음

describe('getPeriodEndMinutes', () => {
    it('time 문자열의 끝 시간을 분으로 반환한다', () => {
        expect(getPeriodEndMinutes(P5)).toBe(21 * 60 + 20);
        expect(getPeriodEndMinutes(P3)).toBe(17 * 60); // 자율은 120분
    });
    it('time 파싱 실패 시 시작+90분으로 폴백한다', () => {
        expect(getPeriodEndMinutes({ startHour: 10, startMinute: 0, time: '이상한값' })).toBe(10 * 60 + 90);
    });
});

describe('isPeriodImminentOrOngoing', () => {
    it('수업 시작 30분 전부터 true', () => {
        expect(isPeriodImminentOrOngoing(P5, at(19, 20))).toBe(true);
        expect(isPeriodImminentOrOngoing(P5, at(19, 19))).toBe(false);
    });
    it('수업 중에는 true, 종료 후 false', () => {
        expect(isPeriodImminentOrOngoing(P5, at(20, 30))).toBe(true);
        expect(isPeriodImminentOrOngoing(P5, at(21, 20))).toBe(true);
        expect(isPeriodImminentOrOngoing(P5, at(21, 21))).toBe(false);
    });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm run test -- src/utils/scheduleUtils.test.js`
Expected: FAIL — `getPeriodEndMinutes is not a function` 류의 에러

- [ ] **Step 3: 구현** — `src/utils/scheduleUtils.js` 파일 끝에 추가:

```js
/** 교시 종료 시각(분). time 문자열("19:50 ~ 21:20")의 끝 시간 기준, 파싱 실패 시 시작+90분. */
export function getPeriodEndMinutes(period) {
    const m = (period.time || '').match(/~\s*(\d{1,2}):(\d{2})/);
    if (m) return parseInt(m[1]) * 60 + parseInt(m[2]);
    return period.startHour * 60 + period.startMinute + 90;
}

/** 지금이 수업 시작 30분 전 ~ 종료 시각 사이인지 (오늘 요일 셀 강조용). */
export function isPeriodImminentOrOngoing(period, now = new Date()) {
    const startMin = period.startHour * 60 + period.startMinute;
    const endMin = getPeriodEndMinutes(period);
    const nowMin = now.getHours() * 60 + now.getMinutes();
    return nowMin >= startMin - 30 && nowMin <= endMin;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm run test -- src/utils/scheduleUtils.test.js`
Expected: PASS (전체 6개)

- [ ] **Step 5: CoachSchedule에 강조 적용** — `src/components/schedule/CoachSchedule.jsx`:

(a) import 수정 — 1번째 줄 위에 react import 추가, 3번째 줄 import에 헬퍼 추가:

```js
import { useEffect, useState } from 'react';
```

```js
import { weekDateToISO, getWaitlistCountForSlot, isPeriodImminentOrOngoing } from '../../utils/scheduleUtils';
```

(b) 컴포넌트 본문 시작(50행 `// ── 헬퍼 ──` 위)에 60초 타이머 추가:

```js
    // 현재 시각 — 진행 중/임박 수업 강조용 (60초마다 갱신)
    const [now, setNow] = useState(() => new Date());
    useEffect(() => {
        const timer = setInterval(() => setNow(new Date()), 60 * 1000);
        return () => clearInterval(timer);
    }, []);
    const todayDayName = ['일', '월', '화', '수', '목', '금', '토'][now.getDay()];
```

(c) `renderCoachCell(day, periodObj)` 안에서 (기존 `const data = getCellData(...)` 아래에):

```js
        const isOngoingNow = day === todayDayName && isPeriodImminentOrOngoing(periodObj, now);
```

(d) 본 셀(176행 `return (` 의 populated 셀) style에서 기존:

```js
                style={{
                    alignItems: 'flex-start',
                    justifyContent: 'flex-start',
                    padding: '8px',
                    ...(isHoliday ? { backgroundColor: '#E94E581A' } : {})
                }}
```

를 다음으로 교체 (휴일 틴트가 우선하도록 순서 유지):

```js
                style={{
                    alignItems: 'flex-start',
                    justifyContent: 'flex-start',
                    padding: '8px',
                    ...(isOngoingNow ? { backgroundColor: 'var(--accent-10)', border: '1px solid var(--accent)' } : {}),
                    ...(isHoliday ? { backgroundColor: '#E94E581A' } : {})
                }}
```

- [ ] **Step 6: 수동 확인 + 린트**

Run: `npm run lint`
Expected: 에러 0 (기존 워닝 외 신규 없음)
`npm run dev` → 코치 로그인 → 시간표(코치 전용): 현재 시각 기준 오늘 열의 진행/임박 교시 셀에 코발트 틴트+보더 표시 확인 (필요 시 mockData PERIODS 기준 시간대에 맞춰 확인).

- [ ] **Step 7: 커밋**

```bash
git add src/utils/scheduleUtils.js src/utils/scheduleUtils.test.js src/components/schedule/CoachSchedule.jsx
git commit -m "feat(시간표): 코치 시간표에 진행 중/임박(30분 전) 수업 셀 강조 표시"
```

---

### Task 2: (B) 미결제 수강생 배지 (코치 시간표)

**Files:**
- Modify: `src/utils/studentList.js`, `src/utils/studentList.test.js`
- Modify: `src/components/schedule/ScheduleCell.jsx`
- Modify: `src/components/schedule/useScheduleCore.js`
- Modify: `src/components/WeeklySchedule.jsx`, `src/components/schedule/CoachSchedule.jsx`

- [ ] **Step 1: 실패하는 테스트 작성** — `src/utils/studentList.test.js`에 추가 (기존 import 라인에 `getUnpaidStudentNames` 추가):

```js
describe('getUnpaidStudentNames', () => {
    const ref = new Date(2026, 5, 12); // 2026-06-12
    it('결제유무 X인 활성 수강생을 미결제로 판정한다', () => {
        const students = [
            { '이름': '김미납', '요일 및 시간': '월1수1', '시작날짜': '260601', '종료날짜': '260630', '결제유무': 'X' },
            { '이름': '박완납', '요일 및 시간': '화5목5', '시작날짜': '260601', '종료날짜': '260630', '결제유무': 'O' },
        ];
        const result = getUnpaidStudentNames(students, ref);
        expect(result.has('김미납')).toBe(true);
        expect(result.has('박완납')).toBe(false);
    });
    it('같은 이름 여러 행이면 오늘 기준 활성 행으로 판정한다 (미리 등록 무시)', () => {
        const students = [
            { '이름': '이중복', '요일 및 시간': '월1수1', '시작날짜': '260601', '종료날짜': '260630', '결제유무': 'O' },
            { '이름': '이중복', '요일 및 시간': '월1수1', '시작날짜': '260701', '종료날짜': '260731', '결제유무': 'X' },
        ];
        expect(getUnpaidStudentNames(students, ref).has('이중복')).toBe(false);
    });
    it('빈 값/스케줄 없는 행은 미결제로 취급하지 않는다', () => {
        const students = [
            { '이름': '김빈값', '요일 및 시간': '월1', '시작날짜': '260601', '종료날짜': '260630', '결제유무': '' },
            { '이름': '박종료', '요일 및 시간': '', '시작날짜': '260501', '종료날짜': '260531', '결제유무': 'X' },
        ];
        const result = getUnpaidStudentNames(students, ref);
        expect(result.size).toBe(0);
    });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npm run test -- src/utils/studentList.test.js` / Expected: FAIL (함수 없음)

- [ ] **Step 3: 구현** — `src/utils/studentList.js` 파일 끝에 추가:

```js
/**
 * 결제유무(K열)가 'X'인 수강생 이름 집합.
 * 같은 이름의 등록 행이 여러 개면(현재 + 미리 등록) 오늘 기준 활성 행을 우선 판정하고,
 * 활성 행이 없으면 시작날짜가 가장 늦은 행을 기준으로 한다.
 */
export const getUnpaidStudentNames = (students, referenceDate = new Date()) => {
  const today = atStartOfDay(referenceDate);
  const rowsByName = new Map();
  (students || []).forEach(s => {
    const name = getStudentValue(s, '이름');
    if (!name || !shouldShowInCoachStudentList(s)) return;
    if (!rowsByName.has(name)) rowsByName.set(name, []);
    rowsByName.get(name).push(s);
  });

  const unpaid = new Set();
  rowsByName.forEach((rows, name) => {
    const active = rows.find(r => {
      const start = parseSheetDate(getStudentValue(r, '시작날짜'));
      const end = parseSheetDate(getStudentValue(r, '종료날짜'));
      return start && end && atStartOfDay(start) <= today && today <= atStartOfDay(end);
    });
    const target = active || rows.reduce((latest, r) => {
      if (!latest) return r;
      const start = parseSheetDate(getStudentValue(r, '시작날짜'));
      const latestStart = parseSheetDate(getStudentValue(latest, '시작날짜'));
      return (start && (!latestStart || start > latestStart)) ? r : latest;
    }, null);
    if (target && String(getStudentValue(target, '결제유무')).trim() === 'X') {
      unpaid.add(name);
    }
  });
  return unpaid;
};
```

- [ ] **Step 4: 통과 확인** — Run: `npm run test -- src/utils/studentList.test.js` / Expected: PASS

- [ ] **Step 5: UnpaidBadge + StudentTag 확장** — `src/components/schedule/ScheduleCell.jsx`:

`StudentTag`를 다음으로 교체:

```jsx
/** Styled student tag with status-specific styling. */
export function StudentTag({ name, status, label, unpaid = false }) {
    const style = TAG_STYLES[status] || {};
    const suffix = label ? `(${label})` : '';
    const className = status === 'makeup' ? 'student-tag substitute' : 'student-tag';
    return <span className={className} style={style}>{name}{suffix}{unpaid && <UnpaidBadge />}</span>;
}

/** 미결제(K열=X) 상태 배지 — 코치 시간표 전용. */
export function UnpaidBadge() {
    return (
        <span style={{
            marginLeft: '3px',
            padding: '0 4px',
            fontSize: '0.62rem',
            fontWeight: 700,
            color: '#E94E58',
            backgroundColor: '#E94E581A',
            border: '1px solid #E94E584D',
            borderRadius: '4px',
            verticalAlign: 'middle',
        }}>미결제</span>
    );
}
```

- [ ] **Step 6: useScheduleCore에서 집합 계산** — `src/components/schedule/useScheduleCore.js`:

(a) import 추가:

```js
import { getUnpaidStudentNames } from '../../utils/studentList';
```

(b) `lastDayStudents` memo 위쪽 아무 곳(예: `scheduleData` memo 아래)에 추가:

```js
    // 미결제(K열=X) 수강생 이름 집합 — 코치 시간표 배지용
    const unpaidStudentNames = useMemo(() => {
        if (user?.role !== 'coach') return new Set();
        return getUnpaidStudentNames(students || []);
    }, [user, students]);
```

(c) return 객체에 `unpaidStudentNames,` 추가.

- [ ] **Step 7: WeeklySchedule → CoachSchedule prop 전달**

`src/components/WeeklySchedule.jsx`: scheduleCore 구조분해(74-83행)에 `unpaidStudentNames,` 추가하고, `<CoachSchedule ...>`(456행 부근)에 `unpaidStudentNames={unpaidStudentNames}` prop 추가.

`src/components/schedule/CoachSchedule.jsx`: props에 `unpaidStudentNames = new Set(),` 추가. student-list 렌더(222-256행)에서 각 칩에 `unpaid` 적용:

```jsx
                <div className="student-list">
                    {data.regularStudentsPresent.map(name => {
                        const unpaid = unpaidStudentNames.has(name);
                        if (data.makeupMovedStudents.includes(name)) {
                            return <StudentTag key={name} name={name} status="makeupMoved" label="보강이동" unpaid={unpaid} />;
                        }
                        if (data.agreedAbsenceStudents.includes(name)) {
                            return <StudentTag key={name} name={name} status="agreedAbsent" label="합의결석" unpaid={unpaid} />;
                        }
                        if (data.absenceStudents.includes(name)) {
                            return <StudentTag key={name} name={name} status="absent" label="결석" unpaid={unpaid} />;
                        }
                        return <span key={name} className="student-tag">{name}{unpaid && <UnpaidBadge />}</span>;
                    })}
                    {data.makeupStudents.map(name => (
                        <StudentTag key={`makeup-${name}`} name={name} status="makeup" label="보강" unpaid={unpaidStudentNames.has(name)} />
                    ))}
```

(나머지 holding/new/delayed 칩도 동일하게 `unpaid={unpaidStudentNames.has(name)}` 추가. ScheduleCell import 라인을 `import { StudentTag, UnpaidBadge } from './ScheduleCell';`로 변경.)

- [ ] **Step 8: 확인 + 커밋**

Run: `npm run lint && npm run test`
Expected: PASS. `npm run dev`로 코치 시간표에서 K열 X 수강생 칩에 미결제 배지 확인. **학생 모드 시간표에는 미노출 확인** (학생 모드는 칩 자체가 없으므로 자연 충족, useScheduleCore의 coach 가드로 이중 방어).

```bash
git add src/utils/studentList.js src/utils/studentList.test.js src/components/schedule/ScheduleCell.jsx src/components/schedule/useScheduleCore.js src/components/WeeklySchedule.jsx src/components/schedule/CoachSchedule.jsx
git commit -m "feat(시간표): 코치 시간표 수강생 칩에 미결제(K열=X) 배지 표시"
```

---

### Task 3: (C) 수강생 관리 검색창

**Files:**
- Modify: `src/components/StudentManager.jsx`

- [ ] **Step 1: 검색 state + 필터 추가** — `activeStudents` memo(281-285행) 아래에:

```js
    const [searchQuery, setSearchQuery] = useState('');

    // 이름 부분 일치 + 전화번호 숫자 부분 일치 필터
    const filteredStudents = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return activeStudents;
        const qDigits = q.replace(/\D/g, '');
        return activeStudents.filter(s => {
            const name = (s['이름'] || '').toLowerCase();
            if (name.includes(q)) return true;
            if (!qDigits) return false;
            const phone = String(getStudentField(s, '핸드폰') || '').replace(/\D/g, '');
            return phone.includes(qDigits);
        });
    }, [activeStudents, searchQuery]);
```

- [ ] **Step 2: 검색 인풋 렌더** — `header-buttons-row` div(316행) 바로 아래(닫힌 뒤)에 추가:

```jsx
                <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="이름·전화번호 검색"
                    style={{
                        width: '100%',
                        marginTop: '8px',
                        padding: '8px 12px',
                        fontSize: '0.9rem',
                        border: '1px solid var(--hairline)',
                        borderRadius: '8px',
                        background: 'var(--surface)',
                        color: 'var(--text)',
                    }}
                />
```

- [ ] **Step 3: 목록을 filteredStudents로 교체**

- 363행 `activeStudents.length === 0` → `filteredStudents.length === 0`
- empty-message 텍스트를 조건 분기: `{searchQuery.trim() ? '검색 결과가 없습니다.' : '등록된 수강생이 없습니다.'}`
- 370행 `activeStudents.map(...)` → `filteredStudents.map(...)`
- 330행 `총 {activeStudents.length}명`은 그대로 유지(전체 인원 표시).

- [ ] **Step 4: 확인 + 커밋**

Run: `npm run lint` → `npm run dev`로 이름/번호 검색·빈 결과 메시지 확인.

```bash
git add src/components/StudentManager.jsx
git commit -m "feat(수강생관리): 이름·전화번호 검색창 추가"
```

---

### Task 4: (D) 수동 SMS 발송 + 발송 상태창

**Files:**
- Modify: `src/services/smsService.js`
- Create: `src/components/SmsSendModal.jsx`
- Modify: `src/components/StudentManager.jsx`

- [ ] **Step 1: sendManualSMS 추가** — `src/services/smsService.js` 파일 끝에:

```js
// ============================================
// 코치 수동 문자 발송 (수강생 관리 → 문자 보내기)
// ============================================
/**
 * 여러 수신자에게 같은 내용 발송, 수신자별 성공/실패 결과 반환.
 * sendBatchSMS는 그룹 단위 결과만 반환하므로 개별 sendSMS를 병렬 호출한다.
 * @param {Array<{name: string, phone: string}>} recipients
 * @param {string} text
 * @returns {Promise<Array<{name, phone, success, error}>>}
 */
export const sendManualSMS = async (recipients, text) => {
  const results = await Promise.allSettled(
    recipients.map(r => sendSMS(r.phone, text))
  );
  return recipients.map((r, i) => ({
    name: r.name,
    phone: r.phone,
    success: results[i].status === 'fulfilled',
    error: results[i].status === 'rejected'
      ? (results[i].reason?.message || '발송 실패')
      : null,
  }));
};
```

- [ ] **Step 2: SmsSendModal 컴포넌트 생성** — `src/components/SmsSendModal.jsx`:

```jsx
import { useMemo, useState } from 'react';
import { sendManualSMS } from '../services/smsService';

/** EUC-KR 기준 바이트 수 (한글 등 비ASCII 2바이트) — SMS 90바이트 초과 시 LMS */
function getSmsByteLength(text) {
    let bytes = 0;
    for (const ch of text) bytes += ch.charCodeAt(0) > 127 ? 2 : 1;
    return bytes;
}

const overlayStyle = {
    position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.45)', zIndex: 1000,
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px',
};
const modalStyle = {
    background: 'var(--canvas)', borderRadius: '20px', padding: '20px',
    width: '100%', maxWidth: '480px', maxHeight: '85vh', overflowY: 'auto',
    boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
};

/**
 * 코치 수동 문자 발송 모달.
 * recipients: [{name, phone}] — phone 없으면 선택 불가 + 경고 표시.
 * 발송 후 같은 모달이 수신자별 성공/실패 결과 화면으로 전환된다.
 */
export default function SmsSendModal({ recipients, onClose }) {
    const selectable = useMemo(() => recipients.filter(r => r.phone), [recipients]);
    const [selected, setSelected] = useState(() => new Set());
    const [message, setMessage] = useState('');
    const [sending, setSending] = useState(false);
    const [results, setResults] = useState(null); // null이면 작성 화면, 배열이면 결과 화면

    const byteLen = getSmsByteLength(message);
    const allChecked = selectable.length > 0 && selectable.every(r => selected.has(r.name));

    function toggleAll() {
        setSelected(allChecked ? new Set() : new Set(selectable.map(r => r.name)));
    }
    function toggleOne(name) {
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(name)) next.delete(name); else next.add(name);
            return next;
        });
    }

    async function handleSend(targets) {
        if (!message.trim()) { alert('메시지를 입력해주세요.'); return; }
        if (targets.length === 0) { alert('받는 사람을 선택해주세요.'); return; }
        if (!confirm(`${targets.length}명에게 문자를 발송하시겠습니까?`)) return;
        setSending(true);
        try {
            const res = await sendManualSMS(targets, message.trim());
            setResults(res);
        } catch (err) {
            alert(`발송 처리 실패: ${err.message}`);
        } finally {
            setSending(false);
        }
    }

    // ── 결과 화면 ──
    if (results) {
        const failed = results.filter(r => !r.success);
        return (
            <div style={overlayStyle} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
                <div style={modalStyle}>
                    <h2 style={{ margin: '0 0 4px', fontSize: '1.15rem' }}>발송 결과</h2>
                    <p style={{ margin: '0 0 12px', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                        성공 {results.length - failed.length}건 · 실패 {failed.length}건
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '16px' }}>
                        {results.map(r => (
                            <div key={r.name} style={{
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                padding: '8px 10px', borderRadius: '8px',
                                background: r.success ? '#31A5521A' : '#E94E581A',
                                border: `1px solid ${r.success ? '#31A5524D' : '#E94E584D'}`,
                                fontSize: '0.88rem',
                            }}>
                                <span style={{ color: 'var(--text)' }}>{r.name} <span style={{ color: 'var(--text-muted)' }}>{r.phone}</span></span>
                                <span style={{ color: r.success ? '#31A552' : '#E94E58', fontWeight: 700 }}>
                                    {r.success ? '✓ 성공' : `✗ ${r.error || '실패'}`}
                                </span>
                            </div>
                        ))}
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        {failed.length > 0 && (
                            <button
                                onClick={() => { setResults(null); handleSend(failed.map(f => ({ name: f.name, phone: f.phone }))); }}
                                disabled={sending}
                                style={{ flex: 1, padding: '10px', borderRadius: '10px', border: '1px solid #E94E584D', background: '#E94E581A', color: '#E94E58', fontWeight: 700, cursor: 'pointer' }}
                            >
                                실패자만 재발송 ({failed.length}명)
                            </button>
                        )}
                        <button onClick={onClose} style={{ flex: 1, padding: '10px', borderRadius: '10px', border: 'none', background: 'var(--cta-dark)', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
                            닫기
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // ── 작성 화면 ──
    return (
        <div style={overlayStyle} onClick={(e) => { if (e.target === e.currentTarget && !sending) onClose(); }}>
            <div style={modalStyle}>
                <h2 style={{ margin: '0 0 12px', fontSize: '1.15rem' }}>문자 보내기</h2>

                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 4px', fontWeight: 700, fontSize: '0.9rem', borderBottom: '1px solid var(--hairline)' }}>
                    <input type="checkbox" checked={allChecked} onChange={toggleAll} />
                    전체 선택 ({selected.size}/{selectable.length})
                </label>
                <div style={{ maxHeight: '220px', overflowY: 'auto', margin: '4px 0 12px' }}>
                    {recipients.map(r => (
                        <label key={r.name} style={{
                            display: 'flex', alignItems: 'center', gap: '8px',
                            padding: '7px 4px', fontSize: '0.88rem',
                            opacity: r.phone ? 1 : 0.55,
                        }}>
                            <input
                                type="checkbox"
                                checked={selected.has(r.name)}
                                disabled={!r.phone}
                                onChange={() => toggleOne(r.name)}
                            />
                            <span style={{ color: 'var(--text)' }}>{r.name}</span>
                            {r.phone
                                ? <span style={{ color: 'var(--text-muted)', marginLeft: 'auto' }}>{r.phone}</span>
                                : <span style={{ marginLeft: 'auto', color: '#E94E58', fontSize: '0.78rem', fontWeight: 700 }}>⚠ 번호 없음</span>}
                        </label>
                    ))}
                </div>

                <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="보낼 내용을 입력하세요"
                    rows={5}
                    style={{
                        width: '100%', boxSizing: 'border-box', padding: '10px 12px',
                        border: '1px solid var(--hairline)', borderRadius: '8px',
                        fontSize: '0.92rem', fontFamily: 'inherit', resize: 'vertical',
                    }}
                />
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '4px 0 14px' }}>
                    {byteLen}바이트 {byteLen > 90 ? '· 90바이트 초과 — LMS(장문)로 발송됩니다' : '· 90바이트 이하 SMS'}
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={onClose} disabled={sending} style={{ flex: 1, padding: '10px', borderRadius: '10px', border: '1px solid var(--hairline)', background: 'var(--canvas-tint)', color: 'var(--text)', cursor: 'pointer' }}>
                        취소
                    </button>
                    <button
                        onClick={() => handleSend(recipients.filter(r => selected.has(r.name) && r.phone))}
                        disabled={sending || selected.size === 0 || !message.trim()}
                        style={{ flex: 2, padding: '10px', borderRadius: '10px', border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 700, cursor: sending ? 'not-allowed' : 'pointer', opacity: sending || selected.size === 0 || !message.trim() ? 0.6 : 1 }}
                    >
                        {sending ? '발송 중...' : `발송 (${selected.size}명)`}
                    </button>
                </div>
            </div>
        </div>
    );
}
```

- [ ] **Step 3: StudentManager에 버튼 연결**

(a) import 추가: `import SmsSendModal from './SmsSendModal';`

(b) state 추가 (기존 state 선언부에): `const [showSmsModal, setShowSmsModal] = useState(false);`

(c) `filteredStudents` memo 아래에 수신자 목록 (이름 중복 제거, 번호 있는 행 우선):

```js
    // 문자 발송 수신자 목록 — 같은 이름 여러 행이면 전화번호 있는 행 우선
    const smsRecipients = useMemo(() => {
        const seen = new Map();
        activeStudents.forEach(s => {
            const name = s['이름'];
            if (!name) return;
            const phone = String(getStudentField(s, '핸드폰') || '').trim();
            if (!seen.has(name) || (!seen.get(name).phone && phone)) {
                seen.set(name, { name, phone });
            }
        });
        return Array.from(seen.values());
    }, [activeStudents]);
```

(d) `header-buttons-row` 안 매출·통계 버튼 아래에 버튼 추가:

```jsx
                    <button
                        type="button"
                        className="view-switch-btn"
                        onClick={() => setShowSmsModal(true)}
                    >
                        ✉️ 문자 보내기
                    </button>
```

(e) 컴포넌트 return 끝부분(홀딩 모달 아래)에 모달 렌더:

```jsx
            {showSmsModal && (
                <SmsSendModal
                    recipients={smsRecipients}
                    onClose={() => setShowSmsModal(false)}
                />
            )}
```

- [ ] **Step 4: 확인 + 커밋**

Run: `npm run lint`. `npm run dev` + `npm run backend`로: 번호 없는 수강생 비활성 표시 → 본인 번호로 1건 테스트 발송 → 결과 화면 성공/실패 표시 확인 (실제 발송 주의: 본인 번호로만).

```bash
git add src/services/smsService.js src/components/SmsSendModal.jsx src/components/StudentManager.jsx
git commit -m "feat(SMS): 코치 수동 문자 발송 모달 + 수신자별 발송 결과 상태창 추가"
```

---

### Task 5: (E) 비밀번호 변경 (학생)

**Files:**
- Modify: `src/services/firebaseService.js`
- Create: `src/components/PasswordChangeCard.jsx`
- Modify: `src/components/StudentInfo.jsx`, `src/App.jsx`

- [ ] **Step 1: updateUserPassword 추가** — `src/services/firebaseService.js`의 `// MAKEUP REQUEST FUNCTIONS` 섹션 주석(120행) 바로 위에:

```js
// ============================================
// USERS (계정)
// ============================================

/**
 * users/{userName} 비밀번호 변경 — 현재 비밀번호 일치 검증 후 갱신.
 */
export const updateUserPassword = async (userName, currentPassword, newPassword) => {
    return safeWrite(async () => {
        const userRef = doc(db, 'users', userName);
        const userDoc = await getDoc(userRef);
        if (!userDoc.exists()) throw new Error('계정을 찾을 수 없습니다.');
        if (userDoc.data().password !== currentPassword) {
            throw new Error('현재 비밀번호가 올바르지 않습니다.');
        }
        await updateDoc(userRef, { password: newPassword, updatedAt: serverTimestamp() });
        return { success: true };
    });
};
```

- [ ] **Step 2: PasswordChangeCard 생성** — `src/components/PasswordChangeCard.jsx`:

```jsx
import { useState } from 'react';
import { updateUserPassword } from '../services/firebaseService';

const inputStyle = {
    width: '100%', boxSizing: 'border-box', padding: '10px 12px',
    border: '1px solid var(--hairline)', borderRadius: '8px',
    fontSize: '0.92rem', marginBottom: '8px',
};

/** 내 정보 하단 비밀번호 변경 카드. 성공 시 localStorage 자격증명도 함께 갱신. */
export default function PasswordChangeCard({ userName }) {
    const [currentPw, setCurrentPw] = useState('');
    const [newPw, setNewPw] = useState('');
    const [confirmPw, setConfirmPw] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [feedback, setFeedback] = useState(null); // { ok: boolean, text: string }

    function syncLocalPassword(newPassword) {
        try {
            const cred = JSON.parse(localStorage.getItem('login_credentials') || 'null');
            if (cred && cred.username === userName) {
                localStorage.setItem('login_credentials', JSON.stringify({ ...cred, password: newPassword }));
            }
        } catch { /* 손상된 값은 무시 */ }
        try {
            const saved = JSON.parse(localStorage.getItem('savedUser') || 'null');
            if (saved && saved.name === userName) {
                localStorage.setItem('savedUser', JSON.stringify({ ...saved, password: newPassword }));
            }
        } catch { /* 손상된 값은 무시 */ }
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setFeedback(null);
        if (!currentPw || !newPw || !confirmPw) {
            setFeedback({ ok: false, text: '모든 칸을 입력해주세요.' });
            return;
        }
        if (newPw.length < 4) {
            setFeedback({ ok: false, text: '새 비밀번호는 4자 이상이어야 합니다.' });
            return;
        }
        if (newPw !== confirmPw) {
            setFeedback({ ok: false, text: '새 비밀번호 확인이 일치하지 않습니다.' });
            return;
        }
        if (newPw === currentPw) {
            setFeedback({ ok: false, text: '현재 비밀번호와 다른 비밀번호를 입력해주세요.' });
            return;
        }
        setSubmitting(true);
        try {
            await updateUserPassword(userName, currentPw, newPw);
            syncLocalPassword(newPw);
            setFeedback({ ok: true, text: '비밀번호가 변경되었습니다.' });
            setCurrentPw(''); setNewPw(''); setConfirmPw('');
        } catch (err) {
            setFeedback({ ok: false, text: err.message || '비밀번호 변경에 실패했습니다.' });
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div style={{
            background: 'white', borderRadius: '16px', padding: '1.25rem',
            marginTop: '1rem', border: '1px solid var(--hairline)',
        }}>
            <h2 style={{ fontSize: '1.05rem', margin: '0 0 12px' }}>비밀번호 변경</h2>
            <form onSubmit={handleSubmit}>
                <input type="password" value={currentPw} onChange={e => setCurrentPw(e.target.value)}
                    placeholder="현재 비밀번호" autoComplete="current-password" style={inputStyle} />
                <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)}
                    placeholder="새 비밀번호 (4자 이상)" autoComplete="new-password" style={inputStyle} />
                <input type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)}
                    placeholder="새 비밀번호 확인" autoComplete="new-password" style={inputStyle} />
                {feedback && (
                    <div style={{
                        padding: '8px 10px', borderRadius: '8px', fontSize: '0.85rem', marginBottom: '8px',
                        background: feedback.ok ? '#31A5521A' : '#E94E581A',
                        border: `1px solid ${feedback.ok ? '#31A5524D' : '#E94E584D'}`,
                        color: feedback.ok ? '#31A552' : '#E94E58',
                    }}>
                        {feedback.text}
                    </div>
                )}
                <button type="submit" disabled={submitting} style={{
                    width: '100%', padding: '0.75rem', borderRadius: '10px', border: 'none',
                    background: 'var(--accent)', color: '#fff', fontWeight: 700,
                    cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.6 : 1,
                }}>
                    {submitting ? '변경 중...' : '비밀번호 변경'}
                </button>
            </form>
        </div>
    );
}
```

- [ ] **Step 3: StudentInfo에 삽입 + 빙의 모드 숨김**

(a) `src/App.jsx` 373행을 다음으로 교체:

```jsx
        return <StudentInfo user={user} studentData={studentData} isImpersonating={Boolean(impersonationOrigin)} onBack={handleBackToDashboard} />;
```

(b) `src/components/StudentInfo.jsx`:
- 시그니처: `const StudentInfo = ({ user, studentData, isImpersonating = false, onBack }) => {`
- import 추가: `import PasswordChangeCard from './PasswordChangeCard';`
- 계약 이력 카드(`contract-history-card` div) 바로 아래에:

```jsx
                {/* 비밀번호 변경 (빙의 모드에서는 숨김) */}
                {!isImpersonating && <PasswordChangeCard userName={user.username} />}
```

- [ ] **Step 4: 확인 + 커밋**

Run: `npm run lint`. 수동: 학생 로그인 → 내 정보 → 변경 성공/현재 비번 불일치/확인 불일치 케이스 + 변경 후 로그아웃→새 비번 로그인 확인. 코치 빙의 시 카드 미노출 확인.

```bash
git add src/services/firebaseService.js src/components/PasswordChangeCard.jsx src/components/StudentInfo.jsx src/App.jsx
git commit -m "feat(내정보): 수강생 비밀번호 변경 기능 추가 (localStorage 자격증명 동기화 포함)"
```

---

### Task 6: (F-1) 보강 대기열 순수 로직 + 테스트

**Files:**
- Create: `src/utils/makeupWaitlist.js`
- Create: `src/utils/makeupWaitlist.test.js`

엔트리 정규화 형태(서비스 레이어에서 변환): `{ id, studentName, phone, date('YYYY-MM-DD'), day, period, periodName, originalClass, status, createdAtMs(number), notifiedAtMs(number|null) }`

- [ ] **Step 1: 실패하는 테스트 작성** — `src/utils/makeupWaitlist.test.js`:

```js
import { describe, it, expect } from 'vitest';
import {
    getNotificationDeadline,
    isNotificationExpired,
    canStillNotify,
    resolveAfterSeatFreed,
    resolveToTarget,
} from './makeupWaitlist';

// 5교시 = 19:50 시작 (mockData PERIODS 기준)
const SLOT = { date: '2026-06-19', day: '금', period: 5 };
const classStart = new Date('2026-06-19T19:50:00');

function entry(over = {}) {
    return {
        id: 'w1', studentName: '김대기', phone: '01000000000',
        ...SLOT, periodName: '5교시',
        originalClass: { date: '2026-06-17', day: '수', period: 5, periodName: '5교시' },
        status: 'waiting', createdAtMs: 1000, notifiedAtMs: null,
        ...over,
    };
}

describe('getNotificationDeadline / isNotificationExpired', () => {
    it('마감 = notifiedAt + 1시간 (수업 시작이 더 늦을 때)', () => {
        const notifiedAt = new Date('2026-06-19T10:00:00').getTime();
        const e = entry({ status: 'notified', notifiedAtMs: notifiedAt });
        expect(getNotificationDeadline(e).getTime()).toBe(notifiedAt + 60 * 60 * 1000);
        expect(isNotificationExpired(e, new Date('2026-06-19T10:59:00'))).toBe(false);
        expect(isNotificationExpired(e, new Date('2026-06-19T11:00:00'))).toBe(true);
    });
    it('수업 시작까지 1시간 미만이면 마감 = 수업 시작', () => {
        const notifiedAt = new Date('2026-06-19T19:20:00').getTime();
        const e = entry({ status: 'notified', notifiedAtMs: notifiedAt });
        expect(getNotificationDeadline(e).getTime()).toBe(classStart.getTime());
    });
});

describe('canStillNotify', () => {
    it('수업 시작 전이면 true, 이후 false', () => {
        expect(canStillNotify(entry(), new Date('2026-06-19T19:49:00'))).toBe(true);
        expect(canStillNotify(entry(), new Date('2026-06-19T19:50:00'))).toBe(false);
    });
});

describe('resolveAfterSeatFreed', () => {
    const now = new Date('2026-06-19T10:00:00');
    it('자리 1개 → 선착순(createdAt) waiting 1명만 알림', () => {
        const entries = [
            entry({ id: 'b', createdAtMs: 2000 }),
            entry({ id: 'a', createdAtMs: 1000 }),
        ];
        const { toExpire, toNotify } = resolveAfterSeatFreed(entries, now, 1);
        expect(toExpire).toHaveLength(0);
        expect(toNotify.map(e => e.id)).toEqual(['a']);
    });
    it('만료된 notified는 expire하고 그 자리만큼 추가 알림', () => {
        const entries = [
            entry({ id: 'stale', status: 'notified', notifiedAtMs: new Date('2026-06-19T08:00:00').getTime() }),
            entry({ id: 'next1', createdAtMs: 1000 }),
            entry({ id: 'next2', createdAtMs: 2000 }),
        ];
        const { toExpire, toNotify } = resolveAfterSeatFreed(entries, now, 1);
        expect(toExpire.map(e => e.id)).toEqual(['stale']);
        // 새 자리 1 + 만료 반환 자리 1 = 2명 알림
        expect(toNotify.map(e => e.id)).toEqual(['next1', 'next2']);
    });
    it('수업 시작이 지난 waiting은 알림 대상에서 제외', () => {
        const after = new Date('2026-06-19T20:00:00');
        const { toNotify } = resolveAfterSeatFreed([entry()], after, 1);
        expect(toNotify).toHaveLength(0);
    });
});

describe('resolveToTarget', () => {
    const now = new Date('2026-06-19T10:00:00');
    it('여석 수에 맞춰 부족한 만큼만 알림 (유효한 notified는 자리 보유로 계산)', () => {
        const entries = [
            entry({ id: 'held', status: 'notified', notifiedAtMs: now.getTime() - 10 * 60 * 1000 }),
            entry({ id: 'w1', createdAtMs: 1000 }),
            entry({ id: 'w2', createdAtMs: 2000 }),
        ];
        const { toNotify } = resolveToTarget(entries, now, 2);
        expect(toNotify.map(e => e.id)).toEqual(['w1']); // 2자리 - 유효 notified 1 = 1명
    });
    it('여석 0이면 아무도 알리지 않는다', () => {
        const { toNotify } = resolveToTarget([entry()], now, 0);
        expect(toNotify).toHaveLength(0);
    });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npm run test -- src/utils/makeupWaitlist.test.js` / Expected: FAIL (모듈 없음)

- [ ] **Step 3: 구현** — `src/utils/makeupWaitlist.js`:

```js
import { getClassDateTime } from './scheduleUtils';

// 보강 대기 알림 응답 제한 시간 (1시간)
export const NOTIFY_WINDOW_MS = 60 * 60 * 1000;

/** notified 항목의 수락 마감 시각: min(notifiedAt + 1시간, 수업 시작 시각) */
export function getNotificationDeadline(entry) {
    const classStart = getClassDateTime(entry.date, entry.period);
    if (!classStart) return null;
    if (!entry.notifiedAtMs) return classStart;
    return new Date(Math.min(entry.notifiedAtMs + NOTIFY_WINDOW_MS, classStart.getTime()));
}

export function isNotificationExpired(entry, now = new Date()) {
    const deadline = getNotificationDeadline(entry);
    if (!deadline) return true;
    return now >= deadline;
}

/** waiting 항목에 아직 알림을 보낼 수 있는지 (수업 시작 전) */
export function canStillNotify(entry, now = new Date()) {
    const classStart = getClassDateTime(entry.date, entry.period);
    return classStart ? now < classStart : false;
}

function splitQueue(entries, now) {
    const toExpire = entries.filter(e => e.status === 'notified' && isNotificationExpired(e, now));
    const activeNotifiedCount = entries.filter(e => e.status === 'notified' && !isNotificationExpired(e, now)).length;
    const waiting = entries
        .filter(e => e.status === 'waiting' && canStillNotify(e, now))
        .sort((a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0));
    return { toExpire, activeNotifiedCount, waiting };
}

/**
 * 자리가 freedSeats개 새로 빠졌을 때 (홀딩/결석/보강취소/거절 트리거).
 * 만료된 notified가 반납한 자리도 함께 다음 순번에게 배정한다.
 * 반환: { toExpire: entry[], toNotify: entry[] }
 */
export function resolveAfterSeatFreed(entries, now = new Date(), freedSeats = 1) {
    const { toExpire, waiting } = splitQueue(entries, now);
    const claimable = Math.max(0, freedSeats) + toExpire.length;
    return { toExpire, toNotify: waiting.slice(0, claimable) };
}

/**
 * 실제 여석 수(availableSeats)를 알 때 (코치 시간표 로드 백스톱).
 * 유효한 notified는 자리를 선점한 것으로 보고, 남는 자리만큼만 새로 알린다.
 */
export function resolveToTarget(entries, now = new Date(), availableSeats = 0) {
    const { toExpire, activeNotifiedCount, waiting } = splitQueue(entries, now);
    const claimable = Math.max(0, availableSeats - activeNotifiedCount);
    return { toExpire, toNotify: waiting.slice(0, claimable) };
}
```

- [ ] **Step 4: 통과 확인** — Run: `npm run test -- src/utils/makeupWaitlist.test.js` / Expected: PASS (전체)

- [ ] **Step 5: 커밋**

```bash
git add src/utils/makeupWaitlist.js src/utils/makeupWaitlist.test.js
git commit -m "feat(보강대기): 대기열 상태 전이 순수 로직 추가 (1시간/수업시작 마감, 선착순 승급)"
```

---

### Task 7: (F-2) Firestore CRUD + 자리 안내 SMS

**Files:**
- Modify: `src/services/firebaseService.js`
- Modify: `src/services/smsService.js`

- [ ] **Step 1: makeupWaitlists CRUD 추가** — `src/services/firebaseService.js`의 `// BOARD - POSTS` 섹션 주석(1003행) 바로 위에:

```js
// ============================================
// MAKEUP WAITLIST (만석 슬롯 보강 대기)
// ============================================
// status: waiting → notified → accepted | declined | expired | cancelled

export const createMakeupWaitlist = async (studentName, phone, slot, originalClass) => {
    return safeWrite(async () => {
        const existing = await queryDocs('makeupWaitlists',
            where('studentName', '==', studentName),
            where('date', '==', slot.date),
            where('period', '==', slot.period),
            where('status', 'in', ['waiting', 'notified'])
        );
        if (existing.length > 0) throw new Error('이미 이 시간에 보강 대기를 신청했습니다.');
        return createDoc('makeupWaitlists', {
            studentName,
            phone: phone || '',
            date: slot.date,
            day: slot.day,
            period: slot.period,
            periodName: slot.periodName,
            originalClass: {
                date: originalClass.date,
                day: originalClass.day,
                period: originalClass.period,
                periodName: originalClass.periodName,
            },
            status: 'waiting',
            notifiedAt: null,
            respondedAt: null,
            updatedAt: serverTimestamp(),
        });
    });
};

export const getMakeupWaitlistsByStudent = async (studentName) => {
    return safeRead([], () => queryDocs('makeupWaitlists',
        where('studentName', '==', studentName),
        where('status', 'in', ['waiting', 'notified'])
    ));
};

export const getActiveMakeupWaitlists = async () => {
    return safeRead([], () => queryDocs('makeupWaitlists',
        where('status', 'in', ['waiting', 'notified'])
    ));
};

export const updateMakeupWaitlistStatus = async (id, status) => {
    return safeWrite(() => updateDocStatus('makeupWaitlists', id, { status }));
};

export const notifyMakeupWaitlist = async (id) => {
    return safeWrite(() => updateDocStatus('makeupWaitlists', id, {
        status: 'notified', notifiedAt: serverTimestamp(),
    }));
};

export const acceptMakeupWaitlist = async (id) => {
    return safeWrite(() => updateDocStatus('makeupWaitlists', id, {
        status: 'accepted', respondedAt: serverTimestamp(),
    }));
};

export const declineMakeupWaitlist = async (id) => {
    return safeWrite(() => updateDocStatus('makeupWaitlists', id, {
        status: 'declined', respondedAt: serverTimestamp(),
    }));
};
```

- [ ] **Step 2: 자리 안내 SMS 추가** — `src/services/smsService.js` 파일 끝(Task 4의 sendManualSMS 아래)에:

```js
// ============================================
// 만석 슬롯 보강 대기 — 자리 발생 안내 SMS
// ============================================
/**
 * 대기 순번이 된 수강생에게 자리 발생 안내 발송.
 * "1시간 내" + "앱 시간표에서 수락" 문구를 반드시 포함한다.
 */
export const sendMakeupSeatAvailableSMS = async (studentPhone, studentName, dateText, periodLabel) => {
  const text = `[근력학교] ${studentName}님, 대기 신청하신 ${dateText} ${periodLabel} 수업에 자리가 났습니다.\n1시간 내에 앱 시간표에서 [보강승인중] 칸을 눌러 수락해주세요.\n미응답 시 다음 대기자에게 순번이 넘어갑니다.`;
  try {
    await sendSMS(studentPhone, text);
    console.log('보강 대기 자리 안내 SMS 발송 완료:', studentName);
    return true;
  } catch (error) {
    console.error('보강 대기 자리 안내 SMS 발송 실패:', studentName, '-', error.message);
    return false;
  }
};
```

- [ ] **Step 3: 린트 + 커밋**

Run: `npm run lint && npm run test`
Expected: PASS

```bash
git add src/services/firebaseService.js src/services/smsService.js
git commit -m "feat(보강대기): makeupWaitlists Firestore CRUD + 자리 발생 안내 SMS 추가"
```

---

### Task 8: (F-3) 오케스트레이션 서비스

**Files:**
- Create: `src/services/makeupWaitlistService.js`

- [ ] **Step 1: 서비스 생성** — `src/services/makeupWaitlistService.js`:

```js
import {
    getActiveMakeupWaitlists,
    notifyMakeupWaitlist,
    updateMakeupWaitlistStatus,
} from './firebaseService';
import { sendMakeupSeatAvailableSMS } from './smsService';
import { resolveAfterSeatFreed, resolveToTarget } from '../utils/makeupWaitlist';
import { parseScheduleString } from '../utils/scheduleUtils';
import { PERIODS } from '../data/mockData';

/** Firestore 문서 → 순수 로직용 정규화 (Timestamp → ms) */
export function normalizeWaitlistEntry(entry) {
    return {
        ...entry,
        createdAtMs: entry.createdAt?.toMillis?.() ?? 0,
        notifiedAtMs: entry.notifiedAt?.toMillis?.() ?? null,
    };
}

function formatDateText(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    return `${d.getMonth() + 1}/${d.getDate()}(${dayNames[d.getDay()]})`;
}

/** expire 처리 + 다음 순번 notified 전환 + SMS 발송. 알린 인원 수 반환. */
async function applyResolution({ toExpire, toNotify }) {
    for (const e of toExpire) {
        await updateMakeupWaitlistStatus(e.id, 'expired')
            .catch(err => console.error('보강 대기 만료 처리 실패:', e.id, err));
    }
    for (const e of toNotify) {
        try {
            await notifyMakeupWaitlist(e.id);
            const periodInfo = PERIODS.find(p => p.id === e.period);
            if (e.phone) {
                await sendMakeupSeatAvailableSMS(
                    e.phone, e.studentName,
                    formatDateText(e.date),
                    periodInfo?.name || `${e.period}교시`
                );
            } else {
                console.warn('보강 대기 전화번호 없음 — SMS 생략:', e.studentName);
            }
        } catch (err) {
            console.error('보강 대기 알림 실패:', e.id, err);
        }
    }
    return toNotify.length;
}

/**
 * 특정 날짜+슬롯에서 자리가 1개 빠졌을 때 호출.
 * 트리거: 홀딩 처리, 결석 처리, 보강 취소, 대기 거절.
 */
export async function onSeatFreed(date, day, period) {
    try {
        const all = (await getActiveMakeupWaitlists()).map(normalizeWaitlistEntry);
        const slotEntries = all.filter(e => e.date === date && e.day === day && e.period === period);
        if (slotEntries.length === 0) return 0;
        return await applyResolution(resolveAfterSeatFreed(slotEntries, new Date(), 1));
    } catch (err) {
        console.error('보강 대기 자리 알림 처리 실패:', err);
        return 0;
    }
}

/**
 * 여러 날짜에 걸친 자리 발생 (홀딩/결석은 날짜 다중 선택 가능).
 * 각 날짜의 요일에 해당하는 정규 수업 슬롯마다 onSeatFreed 호출.
 * @param {string[]} dates - 'YYYY-MM-DD' 배열
 * @param {string} scheduleStr - 해당 수강생의 D열 값 (예: '월1수1')
 */
export async function onSeatsFreedForDates(dates, scheduleStr) {
    const parsed = parseScheduleString(scheduleStr || '');
    if (parsed.length === 0) return;
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    for (const date of dates) {
        const dayName = dayNames[new Date(date + 'T00:00:00').getDay()];
        for (const s of parsed.filter(p => p.day === dayName)) {
            await onSeatFreed(date, dayName, s.period);
        }
    }
}

/**
 * 백스톱 동기화 — 코치 시간표 로드 시 실제 여석 기준으로 대기열 정리.
 * 만료된 notified를 expire하고, 여석이 있으면 다음 순번에게 알린다.
 * @param {(date, day, period) => number|null} getAvailableSeats - 여석 수, 판단 불가 시 null
 */
export async function syncMakeupWaitlists(getAvailableSeats) {
    try {
        const all = (await getActiveMakeupWaitlists()).map(normalizeWaitlistEntry);
        const bySlot = new Map();
        all.forEach(e => {
            const key = `${e.date}|${e.day}|${e.period}`;
            if (!bySlot.has(key)) bySlot.set(key, []);
            bySlot.get(key).push(e);
        });
        let notified = 0;
        for (const [key, entries] of bySlot) {
            const [date, day, periodStr] = key.split('|');
            const seats = getAvailableSeats(date, day, parseInt(periodStr));
            if (seats === null || seats === undefined) continue;
            notified += await applyResolution(resolveToTarget(entries, new Date(), seats));
        }
        return notified;
    } catch (err) {
        console.error('보강 대기 동기화 실패:', err);
        return 0;
    }
}
```

- [ ] **Step 2: 린트 + 커밋**

Run: `npm run lint`

```bash
git add src/services/makeupWaitlistService.js
git commit -m "feat(보강대기): 자리 발생 감지·순차 알림 오케스트레이션 서비스 추가"
```

---

### Task 9: (F-4) 학생 시간표 UI — 대기 신청 / 칩 / 수락·거절

**Files:**
- Modify: `src/components/schedule/MakeupModal.jsx`
- Create: `src/components/schedule/MakeupWaitlistModal.jsx`
- Modify: `src/components/schedule/StudentSchedule.jsx`

- [ ] **Step 1: MakeupModal 라벨 prop화** — `src/components/schedule/MakeupModal.jsx`:

props에 `title = '보강 신청'`, `submitLabel = '보강 신청'`, `submittingLabel = '신청 중...'` 추가하고, JSX의 `<h2>보강 신청</h2>` → `<h2>{title}</h2>`, 제출 버튼 텍스트 `{isSubmittingMakeup ? '신청 중...' : '보강 신청'}` → `{isSubmittingMakeup ? submittingLabel : submitLabel}`로 교체. (기존 호출부는 기본값으로 동작 불변.)

- [ ] **Step 2: 수락/거절 모달 생성** — `src/components/schedule/MakeupWaitlistModal.jsx`:

```jsx
import { getNotificationDeadline } from '../../utils/makeupWaitlist';

/**
 * 보강 대기 수락/거절 모달 — notified 상태 칩 클릭 시 표시.
 * entry: 정규화된 makeupWaitlists 항목 (notifiedAtMs 포함)
 */
export default function MakeupWaitlistResponseModal({ entry, isSubmitting, onAccept, onDecline, onClose }) {
    const deadline = getNotificationDeadline(entry);
    const remainMin = deadline ? Math.max(0, Math.floor((deadline.getTime() - Date.now()) / 60000)) : 0;

    return (
        <div className="makeup-modal-overlay" onClick={onClose}>
            <div className="makeup-modal" onClick={(e) => e.stopPropagation()}>
                <h2>보강 자리 수락</h2>
                <p className="makeup-modal-subtitle">
                    대기하신 <strong>{entry.date} {entry.day}요일 {entry.periodName}</strong> 수업에 자리가 났습니다.
                </p>
                <div style={{
                    margin: '0 0 12px', padding: '10px 12px', borderRadius: '8px',
                    backgroundColor: '#329BE71A', border: '1px solid #329BE74D',
                    color: '#327AB8', fontSize: '0.86rem', lineHeight: 1.5,
                }}>
                    수락하면 <strong>{entry.originalClass.day}요일 {entry.originalClass.periodName}</strong>({entry.originalClass.date}) 수업이
                    이 시간으로 이동(보강 확정)됩니다.<br />
                    남은 수락 가능 시간: <strong>약 {remainMin}분</strong>
                </div>
                <div className="makeup-modal-actions">
                    <button className="btn-cancel" onClick={onDecline} disabled={isSubmitting}>
                        거절 (다음 순번에게)
                    </button>
                    <button className="btn-submit" onClick={onAccept} disabled={isSubmitting}>
                        {isSubmitting ? '처리 중...' : '수락 — 보강 확정'}
                    </button>
                </div>
                <button
                    onClick={onClose}
                    style={{ width: '100%', marginTop: '8px', padding: '8px', border: 'none', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.85rem' }}
                >
                    나중에 결정하기
                </button>
            </div>
        </div>
    );
}
```

- [ ] **Step 3: StudentSchedule 통합** — `src/components/schedule/StudentSchedule.jsx`:

(a) import 추가:

```js
import {
    createMakeupWaitlist,
    getMakeupWaitlistsByStudent,
    updateMakeupWaitlistStatus,
    acceptMakeupWaitlist,
    declineMakeupWaitlist,
} from '../../services/firebaseService';
import { normalizeWaitlistEntry, onSeatFreed } from '../../services/makeupWaitlistService';
import { isNotificationExpired } from '../../utils/makeupWaitlist';
import { getStudentField } from '../../services/googleSheetsService';
import MakeupWaitlistResponseModal from './MakeupWaitlistModal';
```

(b) state 추가 (기존 보강 state 아래):

```js
    // ── 만석 슬롯 보강 대기 ──
    const [myWaitlists, setMyWaitlists] = useState([]);
    const [showWaitlistRequest, setShowWaitlistRequest] = useState(false);
    const [waitlistSlot, setWaitlistSlot] = useState(null);            // { day, period, periodName, date }
    const [waitlistOriginalClass, setWaitlistOriginalClass] = useState(null);
    const [respondingWaitlist, setRespondingWaitlist] = useState(null); // notified 항목
    const [isSubmittingWaitlist, setIsSubmittingWaitlist] = useState(false);

    async function reloadMyWaitlists() {
        const list = await getMakeupWaitlistsByStudent(user.username);
        setMyWaitlists(list.map(normalizeWaitlistEntry));
    }
```

(c) 데이터 로드 — 기존 `loadStudentMakeupData` useEffect 안 마지막에 `await reloadMyWaitlists();` 호출 추가 (catch는 기존 try/catch가 감쌈).

(d) `handleCellClick`의 만석 분기(258-259행) 교체:

```js
        if (cellData.isFull) {
            const dateStr = weekDates[day];
            if (!dateStr) return;
            const date = weekDateToISO(dateStr);
            const myWait = myWaitlists.find(w =>
                w.date === date && w.day === day && w.period === periodObj.id &&
                (w.status === 'waiting' || w.status === 'notified')
            );
            if (myWait) {
                handleWaitlistChipClick(myWait);
                return;
            }
            openWaitlistRequest(day, periodObj.id, date);
        } else {
```

(e) 핸들러 추가 (`handleMakeupCancel` 아래):

```js
    // ── 보강 대기 핸들러 ──
    function openWaitlistRequest(day, periodId, date) {
        if (isSlotLocked(day, periodId)) {
            alert('해당 시간은 코치에 의해 보강이 차단되었습니다.');
            return;
        }
        if (!forceMode && isMyHoldingDate?.(date)) {
            alert('홀딩 기간 중에는 보강 대기를 신청할 수 없습니다.');
            return;
        }
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (new Date(date + 'T00:00:00') < today) {
            alert('과거 날짜로는 대기 신청을 할 수 없습니다.');
            return;
        }
        if (isClassWithinMinutes(date, periodId, 0)) {
            alert('이미 시작된 수업입니다.');
            return;
        }
        if (isMyClass(day, periodId)) {
            alert('본인의 정규 수업 시간에는 대기 신청을 할 수 없습니다.');
            return;
        }
        const period = PERIODS.find(p => p.id === periodId);
        if (!confirm(`이 시간은 현재 만석입니다.\n${day}요일 ${period?.name}에 보강 대기를 신청하시겠습니까?\n자리가 나면 선착순으로 문자 안내를 드립니다.`)) return;
        setWaitlistSlot({ day, period: periodId, periodName: period?.name || '', date });
        setWaitlistOriginalClass(null);
        setShowWaitlistRequest(true);
    }

    async function handleWaitlistRequestSubmit() {
        if (!waitlistOriginalClass || !waitlistSlot) return;
        setIsSubmittingWaitlist(true);
        try {
            const phone = String(getStudentField(studentData, '핸드폰') || '').trim();
            await createMakeupWaitlist(user.username, phone, waitlistSlot, waitlistOriginalClass);
            alert(`보강 대기 신청 완료!\n자리가 나면 문자로 안내드립니다 (선착순).`);
            setShowWaitlistRequest(false);
            setWaitlistSlot(null);
            setWaitlistOriginalClass(null);
            await reloadMyWaitlists();
        } catch (error) {
            alert(`대기 신청 실패: ${error.message}`);
        } finally {
            setIsSubmittingWaitlist(false);
        }
    }

    function handleWaitlistChipClick(entry) {
        if (entry.status === 'notified' && !isNotificationExpired(entry)) {
            setRespondingWaitlist(entry);
            return;
        }
        if (entry.status === 'waiting') {
            if (confirm('이 시간의 보강 대기를 취소하시겠습니까?')) {
                updateMakeupWaitlistStatus(entry.id, 'cancelled')
                    .then(reloadMyWaitlists)
                    .catch(err => alert(`대기 취소 실패: ${err.message}`));
            }
        }
    }

    async function handleWaitlistAccept() {
        const entry = respondingWaitlist;
        if (!entry) return;
        if (isNotificationExpired(entry)) {
            alert('수락 가능 시간이 지났습니다. 다음 기회에 다시 신청해주세요.');
            setRespondingWaitlist(null);
            await reloadMyWaitlists();
            return;
        }
        if (!forceMode && myWeekMakeupHistory.length >= makeupWeeklyLimit) {
            alert(`보강은 주 ${makeupWeeklyLimit}회까지 가능합니다.\n이번 주 보강 한도를 모두 사용해 수락할 수 없습니다.`);
            return;
        }
        // 이번 주 시간표 범위면 여석 재확인 (그 사이 다시 만석이 됐을 수 있음)
        const expectedDate = weekDates[entry.day] ? weekDateToISO(weekDates[entry.day]) : null;
        if (expectedDate === entry.date) {
            const periodObj = PERIODS.find(p => p.id === entry.period);
            if (periodObj && getCellData(entry.day, periodObj).isFull) {
                alert('그 사이 자리가 다시 찼습니다. 자리가 나면 다시 안내드리겠습니다.');
                return;
            }
        }
        setIsSubmittingWaitlist(true);
        try {
            await createMakeupRequest(user.username, entry.originalClass, {
                date: entry.date, day: entry.day, period: entry.period, periodName: entry.periodName,
            });
            await acceptMakeupWaitlist(entry.id);
            try {
                const activeAndCompleted = await getActiveMakeupRequests(user.username);
                await syncHolidayMakeupEndDate(activeAndCompleted, entry.originalClass.date);
            } catch (endDateError) {
                console.error('보강 대기 수락 후 종료일 재계산 실패:', endDateError);
            }
            alert(`보강이 확정되었습니다!\n${entry.originalClass.day}요일 ${entry.originalClass.periodName} → ${entry.day}요일 ${entry.periodName} (${entry.date})`);
            setRespondingWaitlist(null);
            await reloadMyWaitlists();
            await reloadStudentMakeups();
            await loadWeeklyData();
        } catch (error) {
            alert(`수락 실패: ${error.message}`);
        } finally {
            setIsSubmittingWaitlist(false);
        }
    }

    async function handleWaitlistDecline() {
        const entry = respondingWaitlist;
        if (!entry) return;
        if (!confirm('이 보강 자리를 거절하시겠습니까?\n다음 대기자에게 순번이 넘어갑니다.')) return;
        setIsSubmittingWaitlist(true);
        try {
            await declineMakeupWaitlist(entry.id);
            await onSeatFreed(entry.date, entry.day, entry.period); // 다음 순번에게 즉시 알림
            setRespondingWaitlist(null);
            await reloadMyWaitlists();
        } catch (error) {
            alert(`거절 처리 실패: ${error.message}`);
        } finally {
            setIsSubmittingWaitlist(false);
        }
    }
```

(f) `renderStudentCell`에서 대기 칩 렌더 — Makeup TO cell 분기(355행 `if (isMakeupTo)`) **앞에** 추가:

```js
        // 보강 대기 칩 (만석 슬롯에서 대기중/보강승인중 표시)
        const waitCellDate = weekDates[day] ? weekDateToISO(weekDates[day]) : null;
        const myWaitHere = waitCellDate ? myWaitlists.find(w =>
            w.date === waitCellDate && w.day === day && w.period === periodObj.id &&
            (w.status === 'waiting' || (w.status === 'notified' && !isNotificationExpired(w)))
        ) : null;
        if (myWaitHere && !myClass) {
            const isNotified = myWaitHere.status === 'notified';
            return (
                <div
                    className="schedule-cell cell-available"
                    onClick={() => handleWaitlistChipClick(myWaitHere)}
                    style={isNotified
                        ? { borderColor: 'var(--accent)', borderWidth: '2px', backgroundColor: 'var(--accent-10)' }
                        : { borderColor: '#EDBC40', borderWidth: '2px', backgroundColor: '#EDBC401A' }}
                >
                    <div className="cell-content">
                        <span className="seat-count">{data.availableSeats}/{MAX_CAPACITY}</span>
                        <span className="my-class-badge" style={isNotified
                            ? { backgroundColor: 'var(--accent)', color: '#fff', fontSize: '0.65rem' }
                            : { backgroundColor: '#EDBC40', color: '#5c4a0e', fontSize: '0.7rem' }}>
                            {isNotified ? '보강승인중' : '대기중'}
                        </span>
                    </div>
                </div>
            );
        }
```

주의: 이 분기는 `if (myClass)` 블록(312행) **뒤에** 와야 한다 (`!myClass` 가드 포함, 기존 정규 수업 표시 우선).

(g) 모달 렌더 — 기존 MakeupModal 렌더(551행) 아래에:

```jsx
            {/* 보강 대기 신청 모달 (만석 슬롯) — MakeupModal 재사용 */}
            {showWaitlistRequest && isRealStudent && waitlistSlot && (
                <MakeupModal
                    title="보강 대기 신청"
                    submitLabel="대기 신청"
                    submittingLabel="신청 중..."
                    selectedMakeupSlot={waitlistSlot}
                    selectedOriginalClass={waitlistOriginalClass}
                    setSelectedOriginalClass={setWaitlistOriginalClass}
                    studentSchedule={studentSchedule}
                    weekDates={weekDates}
                    activeMakeupRequests={activeMakeupRequests}
                    isSubmittingMakeup={isSubmittingWaitlist}
                    getHolidayInfo={getHolidayInfo}
                    isMyHoldingDate={isMyHoldingDate}
                    forceMode={forceMode}
                    onSubmit={handleWaitlistRequestSubmit}
                    onClose={() => {
                        setShowWaitlistRequest(false);
                        setWaitlistSlot(null);
                        setWaitlistOriginalClass(null);
                    }}
                />
            )}

            {/* 보강 대기 수락/거절 모달 */}
            {respondingWaitlist && isRealStudent && (
                <MakeupWaitlistResponseModal
                    entry={respondingWaitlist}
                    isSubmitting={isSubmittingWaitlist}
                    onAccept={handleWaitlistAccept}
                    onDecline={handleWaitlistDecline}
                    onClose={() => setRespondingWaitlist(null)}
                />
            )}
```

(h) 학생 이용 안내 박스(450-481행)에 한 줄 추가 — "이용 안내" 목록에:

```jsx
                        · 만석(Full) 칸을 누르면 <strong>보강 대기</strong>를 신청할 수 있습니다 — 자리가 나면 문자로 안내드립니다<br/>
```

- [ ] **Step 4: 확인 + 커밋**

Run: `npm run lint && npm run test`
수동: 학생 모드에서 만석 슬롯 클릭 → 대기 신청 → 셀에 `대기중` 칩 → Firestore에서 해당 문서 status를 `notified` + notifiedAt을 현재로 수동 변경 → 새로고침 → `보강승인중` 칩 클릭 → 수락 → 보강 확정 확인. 거절 경로도 확인.

```bash
git add src/components/schedule/MakeupModal.jsx src/components/schedule/MakeupWaitlistModal.jsx src/components/schedule/StudentSchedule.jsx
git commit -m "feat(보강대기): 만석 슬롯 대기 신청·대기중/보강승인중 칩·수락/거절 모달 (학생 시간표)"
```

---

### Task 10: (F-5) 자리 발생 트리거 연결 + 코치 시간표 표시

**Files:**
- Modify: `src/components/HoldingManager.jsx`
- Modify: `src/components/StudentManager.jsx`
- Modify: `src/components/schedule/StudentSchedule.jsx`
- Modify: `src/components/WeeklySchedule.jsx`, `src/components/schedule/CoachSchedule.jsx`, `src/components/schedule/scheduleStyles.js`

- [ ] **Step 1: 학생 홀딩/결석 신청 트리거** — `src/components/HoldingManager.jsx`:

(a) import 추가 (`getStudentField`는 이미 4행에서 import되어 있음):

```js
import { onSeatsFreedForDates } from '../services/makeupWaitlistService';
```

(b) `handleSubmit` 안에서 홀딩/결석 성공 분기가 합류하는 지점 — `setSelectedDates([]);` (try 블록 마지막) **바로 위**에 추가. 두 분기 모두 `sortedDates`를 사용하므로 한 곳이면 충분하다 (단, `sortedDates`가 try 블록 안에서 선언되어 있으므로 같은 try 블록 안에 넣을 것):

```js
            // 빠진 자리의 보강 대기자에게 순차 알림 (실패해도 신청 자체에는 영향 없음)
            try {
                await onSeatsFreedForDates(sortedDates, getStudentField(studentData, '요일 및 시간'));
            } catch (e) {
                console.error('보강 대기 알림 트리거 실패:', e);
            }

            setSelectedDates([]);
```

(기존 `setSelectedDates([]);` 줄을 위 블록으로 교체.)

- [ ] **Step 2: 코치 홀딩/결석 처리 트리거** — `src/components/StudentManager.jsx`:

(a) import 추가: `import { onSeatsFreedForDates } from '../services/makeupWaitlistService';`

(b) `handleSubmitHolding`의 성공 흐름(`alert('홀딩 처리 완료!...')` 직전 또는 직후)에:

```js
            try {
                await onSeatsFreedForDates(sortedDates, holdingTarget['요일 및 시간'] || '');
            } catch (e) {
                console.error('보강 대기 알림 트리거 실패:', e);
            }
```

(c) `handleSubmitAbsence`의 성공 흐름에:

```js
            try {
                await onSeatsFreedForDates(absenceDates, absenceTarget['요일 및 시간'] || '');
            } catch (e) {
                console.error('보강 대기 알림 트리거 실패:', e);
            }
```

- [ ] **Step 3: 보강 취소 트리거** — `src/components/schedule/StudentSchedule.jsx` `handleMakeupCancel`에서 `cancelMakeupRequest(makeupId)` 성공 후:

```js
            // 보강 취소로 빠진 자리 → 대기자 알림
            if (makeup) {
                try {
                    await onSeatFreed(makeup.makeupClass.date, makeup.makeupClass.day, makeup.makeupClass.period);
                } catch (e) {
                    console.error('보강 대기 알림 트리거 실패:', e);
                }
            }
```

- [ ] **Step 4: 코치 시간표 백스톱 + 칩 표시**

(a) `src/components/schedule/scheduleStyles.js` TAG_STYLES에 추가:

```js
    // 보강승인중: 대기자에게 자리 안내 문자가 나간 상태 (수락 대기)
    makeupPending: { backgroundColor: '#329BE71A', color: '#327AB8', border: '1px solid #329BE74D' },
    // 보강대기: 만석 슬롯 대기열에 등록된 상태
    waitingSeat: { backgroundColor: '#EDBC401A', color: '#9a7a12', border: '1px solid #EDBC404D' },
```

(b) `src/components/WeeklySchedule.jsx`:

import 추가:

```js
import { syncMakeupWaitlists, normalizeWaitlistEntry } from '../services/makeupWaitlistService';
import { getActiveMakeupWaitlists } from '../services/firebaseService';
import { weekDateToISO } from '../utils/scheduleUtils';
```

(기존 scheduleUtils import 라인에 `weekDateToISO` 병합)

state 추가: `const [coachMakeupWaitlist, setCoachMakeupWaitlist] = useState([]);`

기존 "대기(만석) 건의 여석 자동 감지" useEffect(144-178행) 아래에 새 useEffect:

```js
    // 만석 보강 대기 백스톱 — 코치 시간표 로드 시 실제 여석 기준으로 만료/승급 처리 + 표시용 로드
    useEffect(() => {
        if (user?.role !== 'coach' || mode !== 'coach' || !scheduleData) return;
        let cancelled = false;
        (async () => {
            await syncMakeupWaitlists((date, day, period) => {
                // 이번 주 시간표 범위 밖이면 여석 판단 불가 → 건너뜀 (이벤트 트리거가 처리)
                const expectedDate = weekDates[day] ? weekDateToISO(weekDates[day]) : null;
                if (expectedDate !== date) return null;
                const periodObj = PERIODS.find(p => p.id === period);
                if (!periodObj || periodObj.type === 'free') return null;
                return getCellData(day, periodObj).availableSeats;
            });
            const list = await getActiveMakeupWaitlists().catch(() => []);
            if (!cancelled) setCoachMakeupWaitlist(list.map(normalizeWaitlistEntry));
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user, mode, scheduleData]);
```

`<CoachSchedule ...>`에 prop 추가: `makeupWaitlists={coachMakeupWaitlist}`

(c) `src/components/schedule/CoachSchedule.jsx`:

props에 `makeupWaitlists = [],` 추가. `renderCoachCell` 안 student-list 끝(subs 렌더 아래)에:

```jsx
                    {/* 만석 보강 대기 — 문자 발송됨(보강승인중) / 대기중 */}
                    {(() => {
                        const slotDateISO = weekDates[day] ? weekDateToISO(weekDates[day]) : null;
                        if (!slotDateISO) return null;
                        return makeupWaitlists
                            .filter(w => w.date === slotDateISO && w.day === day && w.period === periodObj.id)
                            .map(w => w.status === 'notified'
                                ? <StudentTag key={`mw-${w.id}`} name={w.studentName} status="makeupPending" label="보강승인중" />
                                : <StudentTag key={`mw-${w.id}`} name={w.studentName} status="waitingSeat" label="보강대기" />);
                    })()}
```

- [ ] **Step 5: 확인 + 커밋**

Run: `npm run lint && npm run test`
수동 시나리오: ① 학생A가 만석 슬롯 대기 신청 → ② 코치가 그 슬롯의 학생B를 홀딩 처리 → 학생A에게 SMS 발송 + Firestore status `notified` 확인 → ③ 코치 시간표에 `학생A(보강승인중)` 칩 확인 → ④ 학생A 수락 → 칩이 `보강`으로 전환.

```bash
git add src/components/HoldingManager.jsx src/components/StudentManager.jsx src/components/schedule/StudentSchedule.jsx src/components/WeeklySchedule.jsx src/components/schedule/CoachSchedule.jsx src/components/schedule/scheduleStyles.js
git commit -m "feat(보강대기): 홀딩·결석·보강취소 시 자리 발생 트리거 + 코치 시간표 대기 칩/백스톱 동기화"
```

---

### Task 11: (G) 관리자봇 업데이트 공지 스크립트 + 워크플로 규칙

**Files:**
- Create: `scripts/post-update-notice.js`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Node 버전 확인**

Run: `node -v`
Expected: v20.6 이상 (`--env-file` 지원). 미만이면 스크립트 실행 시 `set -a; source .env; set +a; node scripts/...`로 대체한다고 CLAUDE.md에 명기.

- [ ] **Step 2: 스크립트 생성** — `scripts/post-update-notice.js`:

```js
/**
 * 관리자봇 업데이트 공지 게시 스크립트
 *
 * 사용법: node --env-file=.env scripts/post-update-notice.js "제목" "본문"
 *
 * 동작:
 * 1. posts에서 author='관리자봇' && isUpdateNotice=true인 기존 공지를 소프트 삭제
 * 2. 새 공지를 notice 카테고리로 등록 (앱의 createPost와 동일 스키마)
 *
 * ※ 반드시 백관장 승인 후 실행할 것 (CLAUDE.md '업데이트 공지 규칙' 참고)
 */
import { initializeApp } from 'firebase/app';
import {
    getFirestore, collection, query, where, getDocs,
    updateDoc, addDoc, doc, serverTimestamp,
} from 'firebase/firestore';

const [title, content] = process.argv.slice(2);
if (!title || !content) {
    console.error('사용법: node --env-file=.env scripts/post-update-notice.js "제목" "본문"');
    process.exit(1);
}

const required = ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID'];
const missing = required.filter(k => !process.env[k]);
if (missing.length > 0) {
    console.error(`환경변수 누락: ${missing.join(', ')} — node --env-file=.env 로 실행했는지 확인하세요.`);
    process.exit(1);
}

const app = initializeApp({
    apiKey: process.env.VITE_FIREBASE_API_KEY,
    authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.VITE_FIREBASE_APP_ID,
});
const db = getFirestore(app);

// 1. 기존 관리자봇 업데이트 공지 소프트 삭제
const existing = await getDocs(query(
    collection(db, 'posts'),
    where('author', '==', '관리자봇'),
    where('isUpdateNotice', '==', true),
));
for (const d of existing.docs) {
    if (!d.data().deleted) {
        await updateDoc(doc(db, 'posts', d.id), { deleted: true, updatedAt: serverTimestamp() });
        console.log(`기존 공지 내림: "${d.data().title}" (${d.id})`);
    }
}

// 2. 새 공지 등록 (firebaseService.createPost와 동일 스키마)
const ref = await addDoc(collection(db, 'posts'), {
    title,
    content,
    category: 'notice',
    author: '관리자봇',
    isUpdateNotice: true,
    likes: [],
    commentCount: 0,
    deleted: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
});
console.log(`✅ 새 업데이트 공지 등록 완료: "${title}" (${ref.id})`);
process.exit(0);
```

- [ ] **Step 3: 스크립트 동작 확인 (테스트 공지)**

Run: `node --env-file=.env scripts/post-update-notice.js "테스트 공지" "스크립트 동작 확인용입니다."`
Expected: `✅ 새 업데이트 공지 등록 완료` 출력 → 앱 게시판 공지 탭에 관리자봇 글 확인 → 한 번 더 실행해 기존 공지가 내려가고 새 공지로 교체되는지 확인 → 확인 후 마지막 테스트 공지는 수동 정리(스크립트 재실행 시 자동으로 내려가므로 그대로 둬도 무방하나, Firestore 콘솔에서 deleted=true 처리 권장).

- [ ] **Step 4: CLAUDE.md에 워크플로 규칙 추가** — `## 운영/버그 픽스 규칙` 섹션 아래에 새 섹션:

```markdown
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
```

- [ ] **Step 5: 커밋**

```bash
git add scripts/post-update-notice.js CLAUDE.md
git commit -m "feat(운영): 관리자봇 업데이트 공지 스크립트 + 공지 승인 워크플로 규칙 추가"
```

---

### Task 12: 마무리 — CLAUDE.md 문서 갱신 + 전체 검증

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: CLAUDE.md 갱신** — 아래 항목 반영:

1. **Firestore 컬렉션 표**에 행 추가:
   `| makeupWaitlists | 만석 슬롯 보강 대기 (status: waiting/notified/accepted/declined/expired/cancelled). 자리 발생 시 선착순 1명에게 SMS → 1시간 내 앱 시간표에서 수락, 무응답/거절 시 다음 순번 |`
2. **디렉토리 구조**: `SmsSendModal.jsx`(수동 문자 발송), `PasswordChangeCard.jsx`(비밀번호 변경), `schedule/MakeupWaitlistModal.jsx`, `services/makeupWaitlistService.js`, `utils/makeupWaitlist.js`, `scripts/post-update-notice.js` 추가.
3. **SMS 시스템 표**에 행 추가: 수동 발송(코치→선택 수강생), 보강 대기 자리 안내(자동, 순차).
4. **보강 시스템** 섹션에 만석 대기 흐름 요약 추가 (대기 신청 → 자리 발생 트리거(홀딩/결석/보강취소/거절) → 선착순 SMS → 1시간/수업 시작 전 마감 → 시간표에서 수락).
5. **인증** 섹션에 "수강생은 내 정보에서 비밀번호 변경 가능 (`updateUserPassword`)" 추가.

- [ ] **Step 2: 전체 검증**

Run: `npm run lint && npm run test && npm run build`
Expected: 모두 성공. 실패 시 수정 후 재실행.

- [ ] **Step 3: 커밋**

```bash
git add CLAUDE.md
git commit -m "docs: 보강 대기·수동 SMS·비밀번호 변경·관리자봇 공지 반영하여 CLAUDE.md 갱신"
```

- [ ] **Step 4: 머지/배포는 백관장 승인 후**

CLAUDE.md 운영 규칙에 따라 main 머지·push·배포는 백관장 승인 후 진행. 이번 변경은 수강생 체감 변경이므로, 배포 시 Task 11의 공지 워크플로(초안 제시 → 승인 → 스크립트 실행)를 적용한다.

---

## 비고 (구현 중 판단 기준)

- **F의 2시간 규칙 의도적 우회**: 일반 보강 신청은 2시간 전 마감이지만, 대기 수락은 스펙에 따라 **수업 시작 전까지** 허용한다 (`handleWaitlistAccept`에 2시간 검증을 넣지 말 것).
- **대기 신청은 주간 보강 쿼터를 소진하지 않는다** — 쿼터 검증은 수락 시점에만 수행.
- **다음 주 날짜의 대기 건**: 백스톱(getCellData)은 이번 주만 판단 가능 → null 반환으로 건너뛰고 이벤트 트리거가 담당. 만료 처리는 학생이 앱을 열거나(조회 시) 트리거 실행 시 lazy하게 수행된다.
- **시트 직접 수정으로 자리가 난 경우**는 코치가 시간표를 열 때 백스톱이 잡는다.
- 모든 트리거 호출은 try/catch로 감싸 **원래 작업(홀딩/결석/취소) 성공에 영향을 주지 않는다**.
