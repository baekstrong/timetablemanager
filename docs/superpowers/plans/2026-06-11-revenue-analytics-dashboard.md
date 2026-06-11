# 매출·통계 대시보드 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 근력학교 코치 전용 매출·통계 대시보드를 추가한다 — 매출/증감, 결제방식, 총원/신규/재등록/이탈, 남녀·직업·유입경로를 한 화면에서 본다.

**Architecture:** 집계 로직은 순수 함수 위주의 신규 서비스 `src/services/analyticsService.js`에 모은다(시트/Firebase IO는 기존 `googleSheetsService.js`·`firebaseService.js` 함수 재사용). 화면은 신규 컴포넌트 `AnalyticsDashboard.jsx`에서 Recharts로 그린다. 코치 전용 `analytics` 라우트를 추가하고 수강생 관리 화면에서 진입한다.

**Tech Stack:** React 19, Vite 7, Recharts(기존 의존성), Google Sheets API, Firebase Firestore, Vitest.

**핵심 데이터 사실 (구현 전제):**
- 학생 객체 필드는 한글 헤더 키. 접근은 `getStudentField(student, '결제방식')` 사용. 주요 키: `이름`, `요일 및 시간`(D), `신규/재등록`(F), `결제금액`(I), `결제유무`(K), `결제방식`(L), `성별`(Q), `직업`(R), `시작날짜`(G), `종료날짜`(H).
- `getAllStudents(year, month)` → 해당 월 시트 1개의 학생 배열.
- 단일 셀 읽기: `readSheetData(\`${getSheetNameByYearMonth(y,m)}!F1\`)` → `rows?.[0]?.[0]`.
- 종료 버튼(`handleEndClass`)은 모든 시트에서 해당 학생 D열만 비움. D열을 비우는 동작은 종료뿐 → "D 비어있음"이 코치 종료의 신호.
- Firebase 헬퍼: `createDoc(col, data)`(createdAt 자동), `queryDocs(col, ...constraints)`, `safeWrite`, `safeRead`. 컬렉션 함수는 `firebaseService.js`에 `export const`로 추가.
- 테스트는 소스 옆에 `*.test.js` 콜로케이션(예: `src/services/analyticsService.test.js`). 실행: `npm run test`.

---

## File Structure

| 파일 | 책임 |
|------|------|
| `src/services/analyticsService.js` (신규) | 모든 집계 로직(순수 함수 + IO 오케스트레이션) |
| `src/services/analyticsService.test.js` (신규) | 순수 함수 단위 테스트 |
| `src/services/firebaseService.js` (수정) | `createStudentTermination`, `getTerminations` 추가 |
| `src/components/AnalyticsDashboard.jsx` (신규) | 대시보드 화면 |
| `src/components/AnalyticsDashboard.css` (신규) | 대시보드 스타일(플랫+코발트) |
| `src/components/StudentManager.jsx` (수정) | 진입 버튼 + `handleEndClass`에 종료 기록 추가 |
| `src/components/NewStudentRegistration.jsx` (수정) | 유입경로 1문항 추가, `referralSource` 제출 |
| `src/App.jsx` (수정) | `analytics` 라우트 추가, StudentManager에 `onNavigate` 전달 |
| `CLAUDE.md` (수정) | 신규 컬렉션/필드/라우트 문서화 |

---

## Task 1: analyticsService — 직업 키워드 그룹핑 (순수 함수)

**Files:**
- Create: `src/services/analyticsService.js`
- Test: `src/services/analyticsService.test.js`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/services/analyticsService.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { categorizeOccupation, tallyOccupations } from './analyticsService';

describe('categorizeOccupation', () => {
  it('회사/직장 키워드를 회사원으로 분류', () => {
    expect(categorizeOccupation('회사원')).toBe('회사원');
    expect(categorizeOccupation('직장인')).toBe('회사원');
    expect(categorizeOccupation('사무직')).toBe('회사원');
  });
  it('사업/자영 키워드를 자영업으로 분류', () => {
    expect(categorizeOccupation('자영업')).toBe('자영업');
    expect(categorizeOccupation('개인사업')).toBe('자영업');
  });
  it('학생/대학 키워드를 학생으로 분류', () => {
    expect(categorizeOccupation('대학생')).toBe('학생');
  });
  it('전문직 키워드 분류', () => {
    expect(categorizeOccupation('의사')).toBe('전문직');
    expect(categorizeOccupation('개발자')).toBe('전문직');
  });
  it('주부 분류', () => {
    expect(categorizeOccupation('가정주부')).toBe('주부');
  });
  it('빈 값/미매칭은 기타', () => {
    expect(categorizeOccupation('')).toBe('기타');
    expect(categorizeOccupation('우주비행사')).toBe('기타');
  });
});

describe('tallyOccupations', () => {
  it('학생 배열을 카테고리별로 집계', () => {
    const students = [
      { 직업: '회사원' }, { 직업: '직장인' }, { 직업: '자영업' }, { 직업: '' },
    ];
    expect(tallyOccupations(students)).toEqual({
      회사원: 2, 자영업: 1, 기타: 1,
    });
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm run test -- analyticsService`
Expected: FAIL — "categorizeOccupation is not a function" / 모듈 없음.

- [ ] **Step 3: 최소 구현**

`src/services/analyticsService.js`:
```js
import { getStudentField } from './googleSheetsService';

// ─── 직업 키워드 그룹핑 ───
const OCCUPATION_RULES = [
  { category: '회사원', keywords: ['회사', '직장', '사무', '직장인'] },
  { category: '자영업', keywords: ['사업', '자영', '대표', '사장', '장사'] },
  { category: '전문직', keywords: ['의사', '변호사', '약사', '교사', '강사', '디자이너', '개발', '간호'] },
  { category: '학생', keywords: ['학생', '대학', '대학생'] },
  { category: '주부', keywords: ['주부', '가정'] },
];

export function categorizeOccupation(text) {
  const t = (text || '').trim();
  if (!t) return '기타';
  for (const rule of OCCUPATION_RULES) {
    if (rule.keywords.some(k => t.includes(k))) return rule.category;
  }
  return '기타';
}

export function tallyOccupations(students) {
  const result = {};
  for (const s of students || []) {
    const cat = categorizeOccupation(getStudentField(s, '직업'));
    result[cat] = (result[cat] || 0) + 1;
  }
  return result;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm run test -- analyticsService`
Expected: PASS (8 tests).

- [ ] **Step 5: 커밋**

```bash
git add src/services/analyticsService.js src/services/analyticsService.test.js
git commit -m "feat(analytics): 직업 키워드 그룹핑 순수 함수 추가"
```

---

## Task 2: analyticsService — 매출 증감 계산 (순수 함수)

**Files:**
- Modify: `src/services/analyticsService.js`
- Test: `src/services/analyticsService.test.js`

- [ ] **Step 1: 실패하는 테스트 추가**

`analyticsService.test.js`에 추가:
```js
import { computeRevenueTrend } from './analyticsService';

describe('computeRevenueTrend', () => {
  it('전월 대비 증감액·증감률을 계산 (오래된→최신 순서 입력)', () => {
    const input = [
      { year: 2026, month: 1, revenue: 1000000 },
      { year: 2026, month: 2, revenue: 1500000 },
      { year: 2026, month: 3, revenue: 1200000 },
    ];
    const out = computeRevenueTrend(input);
    expect(out[0]).toMatchObject({ year: 2026, month: 1, revenue: 1000000, delta: null, deltaPct: null });
    expect(out[1]).toMatchObject({ revenue: 1500000, delta: 500000, deltaPct: 50 });
    expect(out[2]).toMatchObject({ revenue: 1200000, delta: -300000, deltaPct: -20 });
  });
  it('전월 매출이 0이면 deltaPct는 null', () => {
    const out = computeRevenueTrend([
      { year: 2026, month: 1, revenue: 0 },
      { year: 2026, month: 2, revenue: 500000 },
    ]);
    expect(out[1].delta).toBe(500000);
    expect(out[1].deltaPct).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm run test -- analyticsService`
Expected: FAIL — "computeRevenueTrend is not a function".

- [ ] **Step 3: 최소 구현**

`analyticsService.js`에 추가:
```js
// ─── 매출 증감 ───
export function computeRevenueTrend(monthlyRevenues) {
  return (monthlyRevenues || []).map((cur, i) => {
    if (i === 0) return { ...cur, delta: null, deltaPct: null };
    const prev = monthlyRevenues[i - 1].revenue;
    const delta = cur.revenue - prev;
    const deltaPct = prev > 0 ? Math.round((delta / prev) * 100) : null;
    return { ...cur, delta, deltaPct };
  });
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm run test -- analyticsService`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/services/analyticsService.js src/services/analyticsService.test.js
git commit -m "feat(analytics): 매출 증감 계산 함수 추가"
```

---

## Task 3: analyticsService — 학생 구성 집계 (성별/결제방식/신규·재등록, 순수 함수)

**Files:**
- Modify: `src/services/analyticsService.js`
- Test: `src/services/analyticsService.test.js`

- [ ] **Step 1: 실패하는 테스트 추가**

```js
import { tallyGenders, tallyPaymentMethods, countNewVsRenewal } from './analyticsService';

describe('tallyGenders', () => {
  it('남/여 정규화 후 집계', () => {
    const students = [{ 성별: '남' }, { 성별: '남자' }, { 성별: '여' }, { 성별: '' }];
    expect(tallyGenders(students)).toEqual({ 남: 2, 여: 1 });
  });
});

describe('tallyPaymentMethods', () => {
  it('결제방식별 건수와 금액 합', () => {
    const students = [
      { 결제방식: '카드', 결제금액: '450000' },
      { 결제방식: '카드', 결제금액: '390000' },
      { 결제방식: '계좌', 결제금액: '310000' },
    ];
    expect(tallyPaymentMethods(students)).toEqual({
      카드: { count: 2, amount: 840000 },
      계좌: { count: 1, amount: 310000 },
    });
  });
});

describe('countNewVsRenewal', () => {
  it('신규/재등록 카운트', () => {
    const students = [
      { '신규/재등록': '신규' }, { '신규/재등록': '재등록' }, { '신규/재등록': '재등록' },
    ];
    expect(countNewVsRenewal(students)).toEqual({ 신규: 1, 재등록: 2 });
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm run test -- analyticsService`
Expected: FAIL.

- [ ] **Step 3: 최소 구현**

```js
// ─── 학생 구성 ───
export function normalizeGender(g) {
  const t = (g || '').trim();
  if (t.startsWith('남')) return '남';
  if (t.startsWith('여')) return '여';
  return '';
}

export function tallyGenders(students) {
  const result = {};
  for (const s of students || []) {
    const g = normalizeGender(getStudentField(s, '성별'));
    if (!g) continue;
    result[g] = (result[g] || 0) + 1;
  }
  return result;
}

export function tallyPaymentMethods(students) {
  const result = {};
  for (const s of students || []) {
    const method = (getStudentField(s, '결제방식') || '').trim();
    if (!method) continue;
    const amount = parseInt((getStudentField(s, '결제금액') || '0').replace(/[^0-9]/g, ''), 10) || 0;
    if (!result[method]) result[method] = { count: 0, amount: 0 };
    result[method].count += 1;
    result[method].amount += amount;
  }
  return result;
}

export function countNewVsRenewal(students) {
  const result = { 신규: 0, 재등록: 0 };
  for (const s of students || []) {
    const v = (getStudentField(s, '신규/재등록') || '').trim();
    if (v === '신규') result.신규 += 1;
    else if (v === '재등록') result.재등록 += 1;
  }
  return result;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm run test -- analyticsService`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/services/analyticsService.js src/services/analyticsService.test.js
git commit -m "feat(analytics): 성별·결제방식·신규/재등록 집계 함수 추가"
```

---

## Task 4: analyticsService — 시트 기반 이탈 판정 (순수 함수)

**Files:**
- Modify: `src/services/analyticsService.js`
- Test: `src/services/analyticsService.test.js`

판정 규칙: 월 M(다음 달 M+1 시트가 데이터에 존재)에서 — M월 시트에 행이 있고 **D열(요일 및 시간)이 비어 있으며**, M+1월 이후에 **활성(D 채워짐) 등록이 없는** 이름. 한 이름은 마지막 자격 월에만 1회 집계. 가장 최근 달(다음 달 없음)은 제외(Firebase가 담당).

- [ ] **Step 1: 실패하는 테스트 추가**

```js
import { computeSheetChurnByMonth } from './analyticsService';

describe('computeSheetChurnByMonth', () => {
  it('D열 비고 다음달 활성 없음 → 해당 월 이탈로 집계', () => {
    const months = [
      { year: 2026, month: 1, students: [
        { 이름: '김철수', '요일 및 시간': '월1수1' },
        { 이름: '이영희', '요일 및 시간': '' },
      ]},
      { year: 2026, month: 2, students: [
        { 이름: '김철수', '요일 및 시간': '월1수1' },
      ]},
      { year: 2026, month: 3, students: [
        { 이름: '김철수', '요일 및 시간': '' },
      ]},
    ];
    // 2월은 다음달(3월) 존재 → 판정 / 3월은 최근달 → 제외
    // 이영희: 1월 D비어있고 2월 이후 활성 없음 → 1월 이탈
    // 김철수: 3월에 D비었지만 3월은 최근달이라 제외
    const out = computeSheetChurnByMonth(months);
    expect(out['2026-01']).toEqual(['이영희']);
    expect(out['2026-02']).toBeUndefined();
    expect(out['2026-03']).toBeUndefined();
  });

  it('D열 비었어도 이후 달에 활성 등록 있으면 이탈 아님', () => {
    const months = [
      { year: 2026, month: 1, students: [{ 이름: '박민수', '요일 및 시간': '' }] },
      { year: 2026, month: 2, students: [{ 이름: '박민수', '요일 및 시간': '화5목5' }] },
      { year: 2026, month: 3, students: [{ 이름: '박민수', '요일 및 시간': '화5목5' }] },
    ];
    const out = computeSheetChurnByMonth(months);
    expect(out['2026-01']).toBeUndefined();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm run test -- analyticsService`
Expected: FAIL.

- [ ] **Step 3: 최소 구현**

```js
// ─── 이탈 (시트 기반) ───
const ymKey = (year, month) => `${year}-${String(month).padStart(2, '0')}`;

export function computeSheetChurnByMonth(months) {
  // months: [{ year, month, students }] — 입력 순서 무관, 내부에서 정렬
  const ordered = [...(months || [])].sort((a, b) =>
    (a.year * 100 + a.month) - (b.year * 100 + b.month)
  );
  const hasSchedule = (s) => (getStudentField(s, '요일 및 시간') || '').trim() !== '';

  // 이름이 특정 인덱스 이후(배타적)에 활성 등록을 갖는지
  const activeAfter = (name, idx) => {
    for (let j = idx + 1; j < ordered.length; j++) {
      const found = ordered[j].students.find(s => (s['이름'] || '').trim() === name);
      if (found && hasSchedule(found)) return true;
    }
    return false;
  };

  const churnedNames = new Set();
  const result = {};
  // 가장 최근 달(마지막 인덱스)은 제외 → length - 1 까지만
  for (let i = 0; i < ordered.length - 1; i++) {
    const { year, month, students } = ordered[i];
    for (const s of students) {
      const name = (s['이름'] || '').trim();
      if (!name || churnedNames.has(name)) continue;
      if (hasSchedule(s)) continue;            // D열 채워짐 → 종료 아님
      if (activeAfter(name, i)) continue;      // 이후 활성 → 이탈 아님
      const key = ymKey(year, month);
      if (!result[key]) result[key] = [];
      result[key].push(name);
      churnedNames.add(name);
    }
  }
  return result;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm run test -- analyticsService`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/services/analyticsService.js src/services/analyticsService.test.js
git commit -m "feat(analytics): 시트 기반 이탈 판정 함수 추가"
```

---

## Task 5: Firebase 종료 기록 — 컬렉션 함수 추가 + 종료 버튼 연동

**Files:**
- Modify: `src/services/firebaseService.js` (newStudentRegistrations 블록 근처, line 664 이후)
- Modify: `src/components/StudentManager.jsx:76-90` (`handleEndClass`)

- [ ] **Step 1: firebaseService에 종료 기록 함수 추가**

`src/services/firebaseService.js`의 `deleteNewStudentRegistration`(line 660-664) 바로 아래에 추가:
```js
// ============================================
// STUDENT TERMINATION FUNCTIONS (수강 종료 기록)
// ============================================

export const createStudentTermination = async (studentName, reason = '') => {
    return safeWrite(async () => {
        return createDoc('studentTerminations', {
            studentName,
            terminatedBy: 'coach',
            reason,
            terminatedAt: serverTimestamp(),
        });
    });
};

export const getTerminations = async () => {
    return safeRead([], async () => {
        return queryDocs('studentTerminations');
    });
};
```

- [ ] **Step 2: StudentManager의 `handleEndClass`에 기록 추가**

`src/services/googleSheetsService.js` import 줄(StudentManager.jsx:4)에 종료 기록 함수를 추가한다. 현재:
```js
import { createHoldingRequest, getHoldingsByStudent, cancelHolding, getActiveMakeupRequests } from '../services/firebaseService';
```
다음으로 교체:
```js
import { createHoldingRequest, getHoldingsByStudent, cancelHolding, getActiveMakeupRequests, createStudentTermination } from '../services/firebaseService';
```

그리고 `handleEndClass`(StudentManager.jsx:81-89)의 try 블록에서 시트 삭제 직후 기록을 남긴다. 현재:
```js
        try {
            // 모든 시트에서 해당 학생의 스케줄 삭제
            await clearStudentScheduleAllSheets(student['이름']);
            if (refresh) await refresh();
            alert('수강 종료 처리되었습니다. (모든 시트에서 스케줄 삭제)');
```
다음으로 교체:
```js
        try {
            // 모든 시트에서 해당 학생의 스케줄 삭제
            await clearStudentScheduleAllSheets(student['이름']);
            // 이탈 통계용 종료 기록 (실패해도 종료 처리는 유지)
            try {
                await createStudentTermination(student['이름']);
            } catch (recErr) {
                console.warn('종료 기록 저장 실패:', recErr);
            }
            if (refresh) await refresh();
            alert('수강 종료 처리되었습니다. (모든 시트에서 스케줄 삭제)');
```

- [ ] **Step 3: 빌드/린트 확인**

Run: `npm run lint`
Expected: 새 코드 관련 에러 없음.

- [ ] **Step 4: 커밋**

```bash
git add src/services/firebaseService.js src/components/StudentManager.jsx
git commit -m "feat(analytics): 종료 버튼에 Firebase 종료 기록 추가 (이탈 집계용)"
```

---

## Task 6: 유입경로 — 등록 위자드 문항 추가 + Firebase 저장

**Files:**
- Modify: `src/components/NewStudentRegistration.jsx` (개인정보 단계 + 제출 data, line 248)

- [ ] **Step 1: referralSource state 추가**

`NewStudentRegistration.jsx`에서 `occupation` state 선언부를 찾아(예: `const [occupation, setOccupation] = useState('')`) 그 아래에 추가:
```js
    const [referralSource, setReferralSource] = useState('');
```

- [ ] **Step 2: 개인정보 단계 UI에 선택 버튼 추가**

직업 입력 필드 UI 블록 바로 아래에 유입경로 선택 UI를 추가(기존 성별/주횟수 선택 버튼의 마크업 패턴을 그대로 따른다):
```jsx
    <div className="form-group">
      <label>어떻게 알고 오셨나요?</label>
      <div className="option-buttons">
        {['인스타그램', '네이버', '지인추천', '직접방문', '기타'].map(opt => (
          <button
            type="button"
            key={opt}
            className={`option-btn ${referralSource === opt ? 'selected' : ''}`}
            onClick={() => setReferralSource(opt)}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
```
(실제 className은 해당 파일의 기존 선택 버튼 클래스에 맞춘다. 기존 버튼 그룹 마크업을 복사해 옵션만 교체할 것.)

- [ ] **Step 3: 제출 data에 referralSource 포함**

`NewStudentRegistration.jsx:248-269`의 `data` 객체에서 `occupation` 줄 아래에 추가:
```js
                occupation: occupation.trim(),
                referralSource,
```

- [ ] **Step 4: 동작 확인**

Run: `npm run dev` 후 `?register=true` 로 접속 → 개인정보 단계에 "어떻게 알고 오셨나요?" 선택지가 보이고 선택되는지 확인. (수동 확인)

- [ ] **Step 5: 커밋**

```bash
git add src/components/NewStudentRegistration.jsx
git commit -m "feat(analytics): 신규 등록에 유입경로 문항 추가"
```

---

## Task 7: analyticsService — 유입경로 집계 + 대시보드 조립(buildDashboard)

**Files:**
- Modify: `src/services/analyticsService.js`
- Test: `src/services/analyticsService.test.js`

- [ ] **Step 1: 유입경로 집계 순수 함수 테스트 추가**

```js
import { tallyReferralSources } from './analyticsService';

describe('tallyReferralSources', () => {
  it('referralSource별 집계, 빈 값은 미입력', () => {
    const regs = [
      { referralSource: '인스타그램' }, { referralSource: '인스타그램' },
      { referralSource: '지인추천' }, { referralSource: '' }, {},
    ];
    expect(tallyReferralSources(regs)).toEqual({
      인스타그램: 2, 지인추천: 1, 미입력: 2,
    });
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm run test -- analyticsService`
Expected: FAIL.

- [ ] **Step 3: 구현 — 유입경로 집계 + IO 오케스트레이션**

`analyticsService.js` 상단 import에 IO 함수 추가:
```js
import { getStudentField, getAllStudents, readSheetData, getSheetNameByYearMonth } from './googleSheetsService';
import { getNewStudentRegistrations, getTerminations } from './firebaseService';
```
(이미 있는 `getStudentField` import 줄을 위 줄로 교체.)

순수 집계 함수 추가:
```js
// ─── 유입경로 ───
export function tallyReferralSources(registrations) {
  const result = {};
  for (const r of registrations || []) {
    const key = (r.referralSource || '').trim() || '미입력';
    result[key] = (result[key] || 0) + 1;
  }
  return result;
}
```

월 목록 생성 + 매출 셀 읽기 + 대시보드 조립 함수 추가:
```js
// ─── IO 오케스트레이션 ───

// 최근 N개월의 {year, month} 목록 (오래된→최신). baseDate 기본 오늘.
export function recentMonths(n, baseDate = new Date()) {
  const list = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(baseDate.getFullYear(), baseDate.getMonth() - i, 1);
    list.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
  }
  return list;
}

// 시트의 사전 계산 매출 합계 셀 읽기. CELL은 구현 중 확정(F1 또는 AF3).
const REVENUE_CELL = 'F1';
export async function getMonthlyRevenue(year, month) {
  const sheet = getSheetNameByYearMonth(year, month);
  try {
    const rows = await readSheetData(`${sheet}!${REVENUE_CELL}`);
    const raw = rows?.[0]?.[0];
    const num = parseInt(String(raw ?? '').replace(/[^0-9]/g, ''), 10);
    return Number.isFinite(num) ? num : 0;
  } catch {
    return 0;
  }
}

// 이탈 합치기: 과거달=시트, 최근달=Firebase 종료기록
function mergeChurn(sheetChurnByMonth, terminations, months) {
  const counts = {};
  for (const { year, month } of months) {
    const key = ymKey(year, month);
    counts[key] = (sheetChurnByMonth[key] || []).length;
  }
  // 가장 최근 달은 Firebase 종료기록으로 대체
  const latest = months[months.length - 1];
  const latestKey = ymKey(latest.year, latest.month);
  const inLatest = (terminations || []).filter(t => {
    const ms = t.terminatedAt?.toMillis?.();
    if (!ms) return false;
    const d = new Date(ms);
    return d.getFullYear() === latest.year && (d.getMonth() + 1) === latest.month;
  });
  counts[latestKey] = inLatest.length;
  return counts;
}

export async function buildDashboard(monthsCount = 6, baseDate = new Date()) {
  const months = recentMonths(monthsCount, baseDate);
  const latest = months[months.length - 1];

  // 월별 학생 배열 + 매출 (병렬)
  const perMonth = await Promise.all(months.map(async ({ year, month }) => ({
    year, month,
    students: await getAllStudents(year, month).catch(() => []),
    revenue: await getMonthlyRevenue(year, month),
  })));

  const latestMonthData = perMonth[perMonth.length - 1];
  const [registrations, terminations] = await Promise.all([
    getNewStudentRegistrations().catch(() => []),
    getTerminations().catch(() => []),
  ]);

  const revenueTrend = computeRevenueTrend(
    perMonth.map(m => ({ year: m.year, month: m.month, revenue: m.revenue }))
  );
  const sheetChurn = computeSheetChurnByMonth(
    perMonth.map(m => ({ year: m.year, month: m.month, students: m.students }))
  );
  const churnByMonth = mergeChurn(sheetChurn, terminations, months);

  // 최근 N개월 내 신청만 유입경로 집계
  const cutoff = new Date(months[0].year, months[0].month - 1, 1).getTime();
  const recentRegs = registrations.filter(r => (r.createdAt?.toMillis?.() || 0) >= cutoff);

  return {
    months,
    latest,
    revenueTrend,
    payments: tallyPaymentMethods(latestMonthData.students),
    genders: tallyGenders(latestMonthData.students),
    occupations: tallyOccupations(latestMonthData.students),
    referrals: tallyReferralSources(recentRegs),
    newVsRenewal: countNewVsRenewal(latestMonthData.students),
    totalStudents: latestMonthData.students.filter(s => (s['이름'] || '').trim()).length,
    churnByMonth,
    churnLatest: churnByMonth[ymKey(latest.year, latest.month)] || 0,
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm run test -- analyticsService`
Expected: PASS (유입경로 포함 전체 통과). 주의: `buildDashboard`/`getMonthlyRevenue`는 IO라 단위 테스트 대상 아님 — 순수 함수만 테스트됨.

- [ ] **Step 5: 커밋**

```bash
git add src/services/analyticsService.js src/services/analyticsService.test.js
git commit -m "feat(analytics): 유입경로 집계 + 대시보드 조립(buildDashboard) 추가"
```

---

## Task 8: AnalyticsDashboard 컴포넌트 (UI + 차트)

**Files:**
- Create: `src/components/AnalyticsDashboard.jsx`
- Create: `src/components/AnalyticsDashboard.css`

- [ ] **Step 1: 컴포넌트 작성**

`src/components/AnalyticsDashboard.jsx`:
```jsx
import { useState, useEffect } from 'react';
import {
  BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { buildDashboard } from '../services/analyticsService';
import './AnalyticsDashboard.css';

// 코발트 + 중립 팔레트 (상태색 토큰 오용 금지)
const PALETTE = ['#329BE7', '#47C8FF', '#327AB8', '#A7A7AA', '#242428', '#7FB8E0'];
const won = (n) => `${(n || 0).toLocaleString('ko-KR')}원`;

const AnalyticsDashboard = ({ onBack }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await buildDashboard(6));
    } catch (e) {
      console.error(e);
      setError('통계를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const toPie = (obj) => Object.entries(obj || {}).map(([name, v]) => ({
    name, value: typeof v === 'object' ? v.count : v,
  }));

  return (
    <div className="analytics-page">
      <header className="analytics-header">
        <button className="analytics-back" onClick={onBack}>← 수강생 관리</button>
        <h1>매출·통계</h1>
        <button className="analytics-refresh" onClick={load} disabled={loading}>새로고침</button>
      </header>

      {loading && <div className="analytics-state">불러오는 중…</div>}
      {error && <div className="analytics-state error">{error}</div>}

      {data && !loading && (
        <>
          {/* KPI 카드 */}
          <section className="kpi-row">
            <KpiCard label="이번 달 매출" value={won(data.revenueTrend.at(-1)?.revenue)} />
            <KpiCard label="전월 대비" value={fmtDelta(data.revenueTrend.at(-1))} />
            <KpiCard label="총 수강생" value={`${data.totalStudents}명`} />
            <KpiCard label="신규/재등록/이탈"
              value={`${data.newVsRenewal.신규}/${data.newVsRenewal.재등록}/${data.churnLatest}`} />
          </section>

          {/* 매출 추세 */}
          <ChartCard title="매출 추세 (최근 6개월)">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={data.revenueTrend.map(m => ({ name: `${m.month}월`, 매출: m.revenue }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EFEFF0" />
                <XAxis dataKey="name" /><YAxis tickFormatter={(v) => `${v / 10000}만`} />
                <Tooltip formatter={(v) => won(v)} />
                <Bar dataKey="매출" fill="#329BE7" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* 이탈 추세 */}
          <ChartCard title="이탈 추세 (최근 6개월)">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={data.months.map(m => ({
                name: `${m.month}월`,
                이탈: data.churnByMonth[`${m.year}-${String(m.month).padStart(2, '0')}`] || 0,
              }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EFEFF0" />
                <XAxis dataKey="name" /><YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="이탈" fill="#A7A7AA" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* 도넛 차트들 */}
          <div className="pie-grid">
            <PieCard title="결제방식" data={toPie(data.payments)} />
            <PieCard title="남녀 비율" data={toPie(data.genders)} />
            <PieCard title="유입 경로" data={toPie(data.referrals)} />
            <PieCard title="직업 비율" data={toPie(data.occupations)} />
          </div>
        </>
      )}
    </div>
  );
};

const fmtDelta = (m) => {
  if (!m || m.delta == null) return '—';
  const sign = m.delta > 0 ? '▲' : m.delta < 0 ? '▼' : '';
  const pct = m.deltaPct == null ? '' : ` (${m.deltaPct}%)`;
  return `${sign} ${Math.abs(m.delta).toLocaleString('ko-KR')}원${pct}`;
};

const KpiCard = ({ label, value }) => (
  <div className="kpi-card"><div className="kpi-label">{label}</div><div className="kpi-value">{value}</div></div>
);

const ChartCard = ({ title, children }) => (
  <section className="chart-card"><h2>{title}</h2>{children}</section>
);

const PALETTE_PIE = ['#329BE7', '#47C8FF', '#327AB8', '#A7A7AA', '#242428', '#7FB8E0'];
const PieCard = ({ title, data }) => (
  <section className="chart-card">
    <h2>{title}</h2>
    {data.length === 0 ? <div className="analytics-state">데이터 없음</div> : (
      <ResponsiveContainer width="100%" height={240}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} innerRadius={45} label>
            {data.map((_, i) => <Cell key={i} fill={PALETTE_PIE[i % PALETTE_PIE.length]} />)}
          </Pie>
          <Tooltip /><Legend />
        </PieChart>
      </ResponsiveContainer>
    )}
  </section>
);

export default AnalyticsDashboard;
```
(상단 `PALETTE` 상수는 `PALETTE_PIE`와 중복이므로 하나만 남기고 정리할 것 — 자기 리뷰 시 제거.)

- [ ] **Step 2: 스타일 작성 (플랫 + 코발트, CSS 변수 사용)**

`src/components/AnalyticsDashboard.css`:
```css
.analytics-page { padding: 16px; padding-bottom: 96px; max-width: 960px; margin: 0 auto; font-family: var(--font); color: var(--text); }
.analytics-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.analytics-header h1 { font-size: 20px; font-weight: 700; }
.analytics-back { background: none; border: none; color: var(--accent); font-size: 14px; cursor: pointer; }
.analytics-refresh { border: 1px solid var(--hairline); background: var(--canvas); color: var(--text); border-radius: var(--r-chip); padding: 6px 12px; cursor: pointer; }
.analytics-state { padding: 24px; text-align: center; color: var(--text-muted); }
.analytics-state.error { color: var(--error); }
.kpi-row { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 16px; }
.kpi-card { border: 1px solid var(--hairline); border-radius: var(--r-md); background: var(--surface); padding: 14px; }
.kpi-label { font-size: 12px; color: var(--text-secondary); margin-bottom: 6px; }
.kpi-value { font-size: 18px; font-weight: 700; }
.chart-card { border: 1px solid var(--hairline); border-radius: var(--r-card); background: var(--canvas); padding: 16px; margin-bottom: 16px; }
.chart-card h2 { font-size: 15px; font-weight: 700; margin-bottom: 12px; }
.pie-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }
@media (max-width: 640px) { .pie-grid { grid-template-columns: 1fr; } }
```

- [ ] **Step 3: 빌드 확인**

Run: `npm run build`
Expected: 빌드 성공(에러 없음).

- [ ] **Step 4: 커밋**

```bash
git add src/components/AnalyticsDashboard.jsx src/components/AnalyticsDashboard.css
git commit -m "feat(analytics): 매출·통계 대시보드 컴포넌트 추가"
```

---

## Task 9: 라우팅 + 진입 버튼

**Files:**
- Modify: `src/App.jsx` (import, switch case, StudentManager props)
- Modify: `src/components/StudentManager.jsx` (진입 버튼)

- [ ] **Step 1: App.jsx에 import + 라우트 추가**

`App.jsx` 상단 컴포넌트 import 부근에 추가:
```js
import AnalyticsDashboard from './components/AnalyticsDashboard';
```
`renderPage` switch의 `case 'ranking'` 블록(App.jsx:386-387) 아래에 추가:
```js
      case 'analytics':
        return <AnalyticsDashboard onBack={() => setCurrentPage('students')} />;
```
그리고 `case 'students'`(App.jsx:374-375)에서 StudentManager에 `onNavigate` 전달:
```js
      case 'students':
        return <StudentManager user={user} onBack={handleBackToDashboard} onImpersonate={handleStartImpersonation} onNavigate={handleNavigate} />;
```

- [ ] **Step 2: StudentManager에서 onNavigate 받고 버튼 추가**

`StudentManager.jsx:11` 컴포넌트 시그니처를 수정:
```js
const StudentManager = ({ onImpersonate, onNavigate }) => {
```
화면 상단(목록 헤더/툴바 영역)에 진입 버튼을 추가한다. 기존 상단 컨트롤(예: viewMode 토글 버튼) 근처에 다음을 삽입:
```jsx
    <button
      type="button"
      className="analytics-entry-btn"
      onClick={() => onNavigate && onNavigate('analytics')}
    >
      📊 매출·통계
    </button>
```
`StudentManager.css`에 버튼 스타일 추가:
```css
.analytics-entry-btn { border: 1px solid var(--hairline); background: var(--canvas); color: var(--text); border-radius: var(--r-chip); padding: 8px 14px; cursor: pointer; font-weight: 700; }
.analytics-entry-btn:hover { border-color: var(--accent); color: var(--accent); }
```

- [ ] **Step 3: 동작 확인**

Run: `npm run dev` → 코치로 로그인 → 수강생 관리 → `📊 매출·통계` 버튼 클릭 → 대시보드 진입/뒤로가기 확인. (수동 확인)

- [ ] **Step 4: 커밋**

```bash
git add src/App.jsx src/components/StudentManager.jsx src/components/StudentManager.css
git commit -m "feat(analytics): analytics 라우트 + 수강생 관리 진입 버튼 추가"
```

---

## Task 10: 매출 합계 셀 확정 + CLAUDE.md 문서화 + 최종 검증

**Files:**
- Modify: `src/services/analyticsService.js` (REVENUE_CELL 확정)
- Modify: `CLAUDE.md`

- [ ] **Step 1: 매출 합계 셀 확정**

로컬 백엔드(`npm run backend`) 실행 후 브라우저 콘솔 또는 임시 스크립트로 현재 월 시트의 F1·AF3 값을 확인한다(개발 서버에서 `readSheetData` 호출). 실제 월 매출 합계가 들어있는 셀로 `analyticsService.js`의 `REVENUE_CELL` 상수를 확정한다. 둘 다 비어있으면, `getMonthlyRevenue`를 컬럼 I 합산 폴백으로 교체:
```js
export async function getMonthlyRevenue(year, month) {
  const students = await getAllStudents(year, month).catch(() => []);
  return students.reduce((sum, s) => {
    const paid = (getStudentField(s, '결제유무') || '').trim().toUpperCase() === 'O';
    if (!paid) return sum;
    const amt = parseInt((getStudentField(s, '결제금액') || '0').replace(/[^0-9]/g, ''), 10) || 0;
    return sum + amt;
  }, 0);
}
```
확정 결과를 `docs/superpowers/specs/2026-06-11-매출-통계-대시보드-design.md`의 Open Items 1번에 반영(한 줄).

- [ ] **Step 2: CLAUDE.md 문서화**

`CLAUDE.md`의 다음 위치를 갱신:
1. Firestore 컬렉션 표에 행 추가:
   `| studentTerminations | 코치가 종료 버튼으로 수강 종료한 기록 (이탈 통계용) {studentName, terminatedBy, reason, terminatedAt} |`
2. `newStudentRegistrations` 설명에 `referralSource`(유입경로) 필드 추가 언급.
3. 라우팅 표에 행 추가:
   `| analytics | AnalyticsDashboard | 매출·통계 대시보드 (코치용, 수강생 관리에서 진입) |`
4. 디렉토리 구조의 components 목록에 `AnalyticsDashboard.jsx`, services에 `analyticsService.js` 추가.

- [ ] **Step 3: 전체 테스트 + 린트 + 빌드**

Run:
```bash
npm run test
npm run lint
npm run build
```
Expected: 테스트 전체 PASS, 린트 신규 에러 없음, 빌드 성공.

- [ ] **Step 4: 커밋**

```bash
git add src/services/analyticsService.js CLAUDE.md docs/superpowers/specs/2026-06-11-매출-통계-대시보드-design.md
git commit -m "docs(analytics): 매출 셀 확정 + CLAUDE.md 컬렉션/라우트 문서화"
```

- [ ] **Step 5: 푸시**

```bash
git push -u origin feat/revenue-analytics-dashboard
```

---

## Self-Review 결과 (작성자 점검)

- **스펙 커버리지:** 10개 지표 모두 태스크에 매핑됨 — 매출(T7/T10), 증감(T2), 결제방식(T3), 총원·신규·재등록(T3/T7), 이탈(T4·T5·T7), 남녀(T3), 유입경로(T6·T7), 직업(T1). 위치/진입(T9), 디자인 토큰(T8), 문서(T10) 포함.
- **타입 일관성:** `computeSheetChurnByMonth`·`mergeChurn`·`buildDashboard`가 모두 `ymKey(year,month)`='YYYY-MM' 키를 공유. `tallyPaymentMethods`는 `{count,amount}` 객체, `toPie`가 이를 처리.
- **알려진 정리 항목:** T8의 `PALETTE`/`PALETTE_PIE` 중복 상수는 구현 시 하나로 통합(자기 리뷰에 명시).
- **미수집 데이터 한계 명시:** 유입경로는 T6 배포 이후 신규 등록부터만 집계(과거='미입력'). 이탈은 시트(과거)+Firebase(최근달) 병행, 경계 분리로 중복 방지.
