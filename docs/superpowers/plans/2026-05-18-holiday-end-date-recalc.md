# 휴일 변경 시 종료일 자동 증분 조정 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 코치가 휴일을 추가/삭제하면 영향받는 수강생의 Google Sheets 종료일(H열)을 증분 방식으로 자동 ±이동한다.

**Architecture:** 순수 날짜 계산 로직(`src/services/holidayEndDateDelta.js`, import 없음)을 vitest로 단위 테스트하고, I/O 오케스트레이터(`applyHolidayDeltaToEndDates`)를 `googleSheetsService.js`에 추가해 `HolidayManager.jsx`에서 호출한다.

**Tech Stack:** React 19, Vite 7, vitest(신규), Google Sheets API, Firebase Firestore.

설계 문서: `docs/superpowers/specs/2026-05-18-holiday-end-date-recalc-design.md`

---

## File Structure

- Create: `src/services/holidayEndDateDelta.js` — 순수 함수 3개 (zero imports, 테스트 대상)
- Create: `src/services/holidayEndDateDelta.test.js` — vitest 단위 테스트
- Create: `vitest.config.js` — vitest 설정 (node 환경)
- Modify: `package.json` — `vitest` devDependency + `test` 스크립트
- Modify: `src/services/googleSheetsService.js` — `applyHolidayDeltaToEndDates` export 추가
- Modify: `src/components/HolidayManager.jsx` — 추가/삭제 핸들러에서 호출

순수 모듈은 Sheets/Firebase/env를 import하지 않는다. 오케스트레이터가 시트 파싱
후 1차 가공된 값(Date, 배열, Set, 콜백)만 순수 함수에 넘긴다.

---

## Task 1: vitest 도입

**Files:**
- Modify: `package.json`
- Create: `vitest.config.js`

- [ ] **Step 1: vitest 설치**

Run: `npm install -D vitest`
Expected: `package.json`의 `devDependencies`에 `vitest` 추가, 설치 성공.

- [ ] **Step 2: test 스크립트 추가**

`package.json`의 `"scripts"` 객체에 `test` 항목을 추가한다 (기존 키 유지):

```json
"scripts": {
  "dev": "vite",
  "build": "vite build",
  "lint": "eslint .",
  "preview": "vite preview",
  "backend": "node functions/server.js",
  "test": "vitest run"
}
```

- [ ] **Step 3: vitest 설정 파일 생성**

Create `vitest.config.js`:

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
  },
});
```

- [ ] **Step 4: 빈 통과 테스트로 러너 동작 확인**

Create `src/services/holidayEndDateDelta.test.js` (임시):

```js
import { describe, it, expect } from 'vitest';

describe('vitest sanity', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

Run: `npm test`
Expected: PASS (1 passed). 동작 확인용 — 다음 태스크에서 이 파일 내용을 교체한다.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.js src/services/holidayEndDateDelta.test.js
git commit -m "chore: vitest 도입 (날짜 로직 단위테스트용)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

> 주의: `package-lock.json`에 무관한 기존 로컬 변경이 섞여 있을 수 있다.
> 커밋 전 `git diff --staged -- package.json` 으로 vitest 추가만 들어갔는지 확인할 것.

---

## Task 2: parseAbsenceDatesFromNotes (순수)

E열 특이사항 텍스트에서 `YY.M.D` 토큰을 모두 추출해 `YYYY-MM-DD` 배열로 반환.
보수적 용도(확장 제외)이므로 결석 키워드 유무와 무관하게 모든 날짜 토큰을 추출한다.

**Files:**
- Create: `src/services/holidayEndDateDelta.js`
- Modify: `src/services/holidayEndDateDelta.test.js` (Task 1 임시 내용 전체 교체)

- [ ] **Step 1: 실패 테스트 작성**

`src/services/holidayEndDateDelta.test.js` 전체를 다음으로 교체:

```js
import { describe, it, expect } from 'vitest';
import { parseAbsenceDatesFromNotes } from './holidayEndDateDelta.js';

describe('parseAbsenceDatesFromNotes', () => {
  it('단일 결석 기록을 ISO로 변환', () => {
    expect(parseAbsenceDatesFromNotes('26.2.10 결석')).toEqual(['2026-02-10']);
  });

  it('쉼표로 묶인 여러 날짜 추출', () => {
    expect(parseAbsenceDatesFromNotes('26.2.10, 26.2.12 결석'))
      .toEqual(['2026-02-10', '2026-02-12']);
  });

  it('한 자리 월/일 0 padding', () => {
    expect(parseAbsenceDatesFromNotes('26.3.1 결석')).toEqual(['2026-03-01']);
  });

  it('빈 값/널은 빈 배열', () => {
    expect(parseAbsenceDatesFromNotes('')).toEqual([]);
    expect(parseAbsenceDatesFromNotes(null)).toEqual([]);
    expect(parseAbsenceDatesFromNotes(undefined)).toEqual([]);
  });

  it('날짜 토큰 없는 메모는 빈 배열', () => {
    expect(parseAbsenceDatesFromNotes('상담 완료')).toEqual([]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test`
Expected: FAIL — `holidayEndDateDelta.js` 없음 / `parseAbsenceDatesFromNotes` 미정의.

- [ ] **Step 3: 최소 구현**

Create `src/services/holidayEndDateDelta.js`:

```js
// 순수 날짜 계산 모듈 — Sheets/Firebase/env를 import하지 않는다.

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * E열 특이사항에서 YY.M.D 날짜 토큰을 모두 추출해 'YYYY-MM-DD' 배열로 반환.
 * 보수적 용도(확장 제외)이므로 결석 키워드 유무와 무관하게 추출한다.
 * @param {string|null|undefined} notes
 * @returns {string[]}
 */
export function parseAbsenceDatesFromNotes(notes) {
  if (!notes) return [];
  const out = [];
  const re = /(\d{2})\.(\d{1,2})\.(\d{1,2})/g;
  let m;
  while ((m = re.exec(String(notes))) !== null) {
    const yyyy = 2000 + parseInt(m[1], 10);
    out.push(`${yyyy}-${pad2(parseInt(m[2], 10))}-${pad2(parseInt(m[3], 10))}`);
  }
  return out;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test`
Expected: PASS (모든 `parseAbsenceDatesFromNotes` 케이스).

- [ ] **Step 5: Commit**

```bash
git add src/services/holidayEndDateDelta.js src/services/holidayEndDateDelta.test.js
git commit -m "feat: parseAbsenceDatesFromNotes 순수함수 + 테스트

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: isHolidayRelevantToStudent (순수)

변경된 휴일 한 날짜가 특정 수강생의 종료일 변경을 유발하는지 판정.

**Files:**
- Modify: `src/services/holidayEndDateDelta.js`
- Modify: `src/services/holidayEndDateDelta.test.js`

- [ ] **Step 1: 실패 테스트 추가**

`holidayEndDateDelta.test.js` 상단 import를 다음으로 교체:

```js
import { parseAbsenceDatesFromNotes, isHolidayRelevantToStudent } from './holidayEndDateDelta.js';
```

파일 맨 아래에 다음 describe 블록 추가:

```js
describe('isHolidayRelevantToStudent', () => {
  // 수업: 월(1)·수(3), 등록기간 2026-02-02 ~ 2026-03-31
  const base = {
    classDays: [1, 3],
    startDate: new Date(2026, 1, 2),
    endDate: new Date(2026, 2, 31),
    holdingRanges: [],
    absenceDateSet: new Set(),
  };

  it('수업요일 + 기간 내 → true (2026-02-09 월)', () => {
    expect(isHolidayRelevantToStudent({ ...base, holidayDate: new Date(2026, 1, 9) })).toBe(true);
  });

  it('비수업요일(화) → false (2026-02-10)', () => {
    expect(isHolidayRelevantToStudent({ ...base, holidayDate: new Date(2026, 1, 10) })).toBe(false);
  });

  it('시작일 이전 → false', () => {
    expect(isHolidayRelevantToStudent({ ...base, holidayDate: new Date(2026, 0, 26) })).toBe(false);
  });

  it('종료일 이후 → false (2026-04-06 월)', () => {
    expect(isHolidayRelevantToStudent({ ...base, holidayDate: new Date(2026, 3, 6) })).toBe(false);
  });

  it('홀딩 기간 내 → false', () => {
    const ranges = [{ start: new Date(2026, 1, 1), end: new Date(2026, 1, 15) }];
    expect(isHolidayRelevantToStudent({
      ...base, holdingRanges: ranges, holidayDate: new Date(2026, 1, 9),
    })).toBe(false);
  });

  it('결석일과 겹침 → false', () => {
    const set = new Set(['2026-02-09']);
    expect(isHolidayRelevantToStudent({
      ...base, absenceDateSet: set, holidayDate: new Date(2026, 1, 9),
    })).toBe(false);
  });

  it('시작일 당일 경계 포함 → true (2026-02-02 월)', () => {
    expect(isHolidayRelevantToStudent({ ...base, holidayDate: new Date(2026, 1, 2) })).toBe(true);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test`
Expected: FAIL — `isHolidayRelevantToStudent` 미정의.

- [ ] **Step 3: 구현 추가**

`holidayEndDateDelta.js`에 다음을 추가:

```js
const atMidnight = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

const toISO = (d) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

const inAnyRange = (date, ranges) =>
  (ranges || []).some(
    (r) => r && atMidnight(date) >= atMidnight(r.start) && atMidnight(date) <= atMidnight(r.end),
  );

/**
 * 변경된 휴일 1건이 이 수강생 종료일 변경을 유발하는지.
 * @param {Object} p
 * @param {Date} p.holidayDate
 * @param {number[]} p.classDays  - 0=일 .. 6=토
 * @param {Date} p.startDate
 * @param {Date} p.endDate
 * @param {Array<{start:Date,end:Date}>} p.holdingRanges
 * @param {Set<string>} p.absenceDateSet - 'YYYY-MM-DD'
 * @returns {boolean}
 */
export function isHolidayRelevantToStudent({
  holidayDate, classDays, startDate, endDate, holdingRanges, absenceDateSet,
}) {
  if (!holidayDate || !startDate || !endDate) return false;
  const h = atMidnight(holidayDate);
  if (!classDays.includes(h.getDay())) return false;
  if (h < atMidnight(startDate) || h > atMidnight(endDate)) return false;
  if (inAnyRange(h, holdingRanges)) return false;
  if (absenceDateSet && absenceDateSet.has(toISO(h))) return false;
  return true;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test`
Expected: PASS (모든 describe).

- [ ] **Step 5: Commit**

```bash
git add src/services/holidayEndDateDelta.js src/services/holidayEndDateDelta.test.js
git commit -m "feat: isHolidayRelevantToStudent 순수함수 + 테스트

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: shiftEndDateBySessions (순수)

종료일을 deltaSessions만큼 ±이동(비수업요일·휴일·홀딩 건너뜀).

**Files:**
- Modify: `src/services/holidayEndDateDelta.js`
- Modify: `src/services/holidayEndDateDelta.test.js`

- [ ] **Step 1: 실패 테스트 추가**

import 라인을 다음으로 교체:

```js
import {
  parseAbsenceDatesFromNotes,
  isHolidayRelevantToStudent,
  shiftEndDateBySessions,
} from './holidayEndDateDelta.js';
```

파일 맨 아래에 추가:

```js
function toISOForTest(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

describe('shiftEndDateBySessions', () => {
  const classDays = [1, 3]; // 월, 수
  const noHoliday = () => false;

  it('delta +1: 종료일(월 2/9) 다음 수업일은 수 2/11', () => {
    const r = shiftEndDateBySessions({
      endDate: new Date(2026, 1, 9), deltaSessions: 1,
      classDays, holdingRanges: [], isHoliday: noHoliday,
    });
    expect(toISOForTest(r)).toBe('2026-02-11');
  });

  it('delta +2: 두 수업일 전진 (2/9 → 2/16)', () => {
    const r = shiftEndDateBySessions({
      endDate: new Date(2026, 1, 9), deltaSessions: 2,
      classDays, holdingRanges: [], isHoliday: noHoliday,
    });
    expect(toISOForTest(r)).toBe('2026-02-16');
  });

  it('전진 중 휴일(2/11) 건너뜀 → 2/16', () => {
    const isHol = (d) => toISOForTest(d) === '2026-02-11';
    const r = shiftEndDateBySessions({
      endDate: new Date(2026, 1, 9), deltaSessions: 1,
      classDays, holdingRanges: [], isHoliday: isHol,
    });
    expect(toISOForTest(r)).toBe('2026-02-16');
  });

  it('delta -1: 종료일(수 2/11) 이전 수업일은 월 2/9', () => {
    const r = shiftEndDateBySessions({
      endDate: new Date(2026, 1, 11), deltaSessions: -1,
      classDays, holdingRanges: [], isHoliday: noHoliday,
    });
    expect(toISOForTest(r)).toBe('2026-02-09');
  });

  it('후진 중 홀딩(2/9) 건너뜀 → 2/4', () => {
    const ranges = [{ start: new Date(2026, 1, 9), end: new Date(2026, 1, 9) }];
    const r = shiftEndDateBySessions({
      endDate: new Date(2026, 1, 11), deltaSessions: -1,
      classDays, holdingRanges: ranges, isHoliday: noHoliday,
    });
    expect(toISOForTest(r)).toBe('2026-02-04');
  });

  it('delta 0이면 종료일 그대로', () => {
    const r = shiftEndDateBySessions({
      endDate: new Date(2026, 1, 11), deltaSessions: 0,
      classDays, holdingRanges: [], isHoliday: noHoliday,
    });
    expect(toISOForTest(r)).toBe('2026-02-11');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test`
Expected: FAIL — `shiftEndDateBySessions` 미정의.

- [ ] **Step 3: 구현 추가**

`holidayEndDateDelta.js`에 추가:

```js
/**
 * 종료일을 deltaSessions만큼 이동. >0 미래, <0 과거, 0이면 그대로.
 * 비수업요일·휴일·홀딩기간은 카운트하지 않고 건너뛴다. 최대 365회 가드.
 * @param {Object} p
 * @param {Date} p.endDate
 * @param {number} p.deltaSessions
 * @param {number[]} p.classDays
 * @param {Array<{start:Date,end:Date}>} p.holdingRanges
 * @param {(d:Date)=>boolean} p.isHoliday
 * @returns {Date|null} 이동된 종료일, 가드 소진 시 null
 */
export function shiftEndDateBySessions({
  endDate, deltaSessions, classDays, holdingRanges, isHoliday,
}) {
  if (!deltaSessions) return new Date(endDate);
  const step = deltaSessions > 0 ? 1 : -1;
  let remaining = Math.abs(deltaSessions);
  const cursor = atMidnight(endDate);
  let guard = 365;
  while (remaining > 0 && guard-- > 0) {
    cursor.setDate(cursor.getDate() + step);
    if (
      classDays.includes(cursor.getDay()) &&
      !isHoliday(cursor) &&
      !inAnyRange(cursor, holdingRanges)
    ) {
      remaining -= 1;
    }
  }
  return remaining === 0 ? new Date(cursor) : null;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test`
Expected: PASS (전체).

- [ ] **Step 5: Commit**

```bash
git add src/services/holidayEndDateDelta.js src/services/holidayEndDateDelta.test.js
git commit -m "feat: shiftEndDateBySessions 순수함수 + 테스트

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: applyHolidayDeltaToEndDates 오케스트레이터

**Files:**
- Modify: `src/services/googleSheetsService.js`

- [ ] **Step 1: 순수 모듈 import 추가**

`src/services/googleSheetsService.js` 상단 import 영역에 추가:

```js
import {
  parseAbsenceDatesFromNotes,
  isHolidayRelevantToStudent,
  shiftEndDateBySessions,
} from './holidayEndDateDelta.js';
```

- [ ] **Step 2: 오케스트레이터 함수 추가**

`googleSheetsService.js`의 `adjustNextRegistration` 함수 정의 **이후** 위치에
다음 export를 추가한다. 기존 동일 파일 헬퍼 `findColumnIndex`,
`getColumnLetter`, `getClassDays`, `parseSheetDate`, `parseHoldingStatus`,
`isHolidayDate`, `formatDateToYYMMDD`, `findAllStudentRowIndices`,
`getSheetNameByYearMonth`, `getAllSheetNames`, `readSheetData`,
`batchUpdateSheet`, `highlightCells`, `adjustNextRegistration` 를 재사용한다:

```js
/**
 * 휴일 추가/삭제 시 영향받는 수강생의 종료일(H열)을 증분 조정.
 * @param {Object} p
 * @param {string[]} p.changedDates - 방금 추가/삭제된 날짜 'YYYY-MM-DD'
 * @param {'add'|'delete'} p.mode
 * @param {Array<{date:string}>} p.firebaseHolidays - 변경 반영된 전체 커스텀 휴일
 * @returns {Promise<{affectedStudents:number, perSheet:Object, errors:string[]}>}
 */
export const applyHolidayDeltaToEndDates = async ({ changedDates, mode, firebaseHolidays }) => {
  const result = { affectedStudents: 0, perSheet: {}, errors: [] };
  if (!changedDates || changedDates.length === 0) return result;

  const sorted = [...changedDates].sort();
  const earliest = new Date(sorted[0] + 'T00:00:00');
  const baseY = earliest.getFullYear();
  const baseM = earliest.getMonth() + 1; // 1-12

  // 휴일 달 -3개월 ~ 휴일 달 시트 이름
  const wanted = [];
  for (let back = 3; back >= 0; back--) {
    const d = new Date(baseY, baseM - 1 - back, 1);
    wanted.push(getSheetNameByYearMonth(d.getFullYear(), d.getMonth() + 1));
  }
  let existing = [];
  try {
    existing = await getAllSheetNames();
  } catch (e) {
    result.errors.push(`시트 목록 조회 실패: ${e.message}`);
    return result;
  }
  const sheetNames = wanted.filter((n) => existing.includes(n));

  // 삭제 모드: 여전히 한국 공휴일인 날짜는 변화 없음 → 제외
  const effectiveChanged =
    mode === 'delete'
      ? changedDates.filter((ds) => !isHolidayDate(new Date(ds + 'T00:00:00'), []))
      : [...changedDates];
  if (effectiveChanged.length === 0) return result;

  const isHoliday = (date) => isHolidayDate(date, firebaseHolidays);

  for (const sheetName of sheetNames) {
    try {
      const rows = await readSheetData(`${sheetName}!A:R`);
      if (!rows || rows.length < 3) {
        result.perSheet[sheetName] = 0;
        continue;
      }
      const headers = rows[1];
      const nameCol = headers.indexOf('이름');
      const startCol = findColumnIndex(headers, '시작날짜');
      const endCol = findColumnIndex(headers, '종료날짜');
      const schedCol = findColumnIndex(headers, '요일 및 시간');
      const notesCol = findColumnIndex(headers, '특이사항');
      const holdUsedCol = findColumnIndex(headers, '홀딩 사용여부');
      const holdStartCol = findColumnIndex(headers, '홀딩 시작일');
      const holdEndCol = findColumnIndex(headers, '홀딩 종료일');

      if (endCol === -1 || startCol === -1 || schedCol === -1) {
        result.errors.push(`${sheetName}: 필수 컬럼 없음`);
        result.perSheet[sheetName] = 0;
        continue;
      }

      const shifted = []; // { rowIndex, newEndDate(Date), studentName }
      const updates = [];

      for (let i = 2; i < rows.length; i++) {
        const row = rows[i];
        if (!row || !row[nameCol]) continue;
        const startDate = parseSheetDate(row[startCol]);
        const endDate = parseSheetDate(row[endCol]);
        const scheduleStr = row[schedCol] || '';
        if (!startDate || !endDate || !scheduleStr) continue;
        const classDays = getClassDays(scheduleStr);
        if (classDays.length === 0) continue;

        const holdingInfo = parseHoldingStatus(holdUsedCol !== -1 ? row[holdUsedCol] : '');
        const holdingRanges = [];
        if (holdingInfo.isCurrentlyUsed && holdStartCol !== -1 && holdEndCol !== -1) {
          const hs = parseSheetDate(row[holdStartCol]);
          const he = parseSheetDate(row[holdEndCol]);
          if (hs && he) holdingRanges.push({ start: hs, end: he });
        }
        const absenceDateSet = new Set(
          parseAbsenceDatesFromNotes(notesCol !== -1 ? row[notesCol] : ''),
        );

        let n = 0;
        for (const ds of effectiveChanged) {
          const hd = new Date(ds + 'T00:00:00');
          if (
            isHolidayRelevantToStudent({
              holidayDate: hd, classDays, startDate, endDate, holdingRanges, absenceDateSet,
            })
          ) {
            n += 1;
          }
        }
        if (n === 0) continue;

        const delta = mode === 'add' ? n : -n;
        const newEnd = shiftEndDateBySessions({
          endDate, deltaSessions: delta, classDays, holdingRanges, isHoliday,
        });
        if (!newEnd) {
          result.errors.push(`${sheetName} ${row[nameCol]}: 종료일 계산 실패(가드 소진)`);
          continue;
        }
        updates.push({
          range: `${sheetName}!${getColumnLetter(endCol)}${i + 1}`,
          values: [[formatDateToYYMMDD(newEnd)]],
        });
        shifted.push({ rowIndex: i, newEndDate: newEnd, studentName: row[nameCol] });
      }

      if (updates.length > 0) {
        await batchUpdateSheet(updates);
        try {
          await highlightCells(updates.map((u) => u.range.split('!')[1]), sheetName);
        } catch (e) {
          console.warn('휴일 종료일 조정 하이라이트 실패:', e);
        }

        // 미리 등록(다음 등록) 자동 조정
        for (const s of shifted) {
          const sameName = findAllStudentRowIndices(rows, headers, s.studentName);
          if (sameName.length < 2) continue;
          const curStart = parseSheetDate(rows[s.rowIndex][startCol]);
          let nextIdx = -1;
          let nextStart = null;
          for (const idx of sameName) {
            if (idx === s.rowIndex) continue;
            const st = parseSheetDate(rows[idx][startCol]);
            if (st && curStart && st > curStart && (!nextStart || st < nextStart)) {
              nextStart = st;
              nextIdx = idx;
            }
          }
          if (nextIdx !== -1) {
            try {
              await adjustNextRegistration(
                sheetName, rows, headers, nextIdx, s.newEndDate, firebaseHolidays,
              );
            } catch (e) {
              console.warn(`다음 등록 조정 실패 (${s.studentName}):`, e);
            }
          }
        }
        result.affectedStudents += shifted.length;
      }
      result.perSheet[sheetName] = updates.length;
    } catch (e) {
      result.errors.push(`${sheetName}: ${e.message}`);
    }
  }

  return result;
};
```

- [ ] **Step 3: lint 통과 확인**

Run: `npm run lint`
Expected: 신규 코드에 lint 에러 없음(기존 경고는 무관).

- [ ] **Step 4: 빌드 확인**

Run: `npm run build`
Expected: 빌드 성공(에러 없음).

- [ ] **Step 5: Commit**

```bash
git add src/services/googleSheetsService.js
git commit -m "feat: applyHolidayDeltaToEndDates 오케스트레이터 추가

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: HolidayManager.jsx 연결

**Files:**
- Modify: `src/components/HolidayManager.jsx`

- [ ] **Step 1: import 확장**

`HolidayManager.jsx:2` 의 import 라인 바로 아래에 한 줄 추가
(기존 firebaseService import 라인은 유지):

```js
import { createHoliday, getHolidays, deleteHoliday } from '../services/firebaseService';
import { applyHolidayDeltaToEndDates } from '../services/googleSheetsService';
```

- [ ] **Step 2: 추가 핸들러에서 종료일 조정 호출**

`handleSubmit`의 다음 기존 블록을:

```js
            for (const date of selectedDates) {
                await createHoliday(date, reason || '휴무');
            }

            alert(`${selectedDates.length}일이 휴일로 설정되었습니다.`);

            // 데이터 새로고침
            const data = await getHolidays();
            setHolidays(data);
            setSelectedDates([]);
            setReason('');
```

다음으로 교체:

```js
            for (const date of selectedDates) {
                await createHoliday(date, reason || '휴무');
            }

            // 갱신된 전체 휴일 목록으로 종료일 증분 조정
            const data = await getHolidays();
            setHolidays(data);

            let summary = `${selectedDates.length}일이 휴일로 설정되었습니다.`;
            try {
                const r = await applyHolidayDeltaToEndDates({
                    changedDates: selectedDates,
                    mode: 'add',
                    firebaseHolidays: data,
                });
                summary += `\n수강생 ${r.affectedStudents}명의 종료일이 연장되었습니다.`;
                if (r.errors.length > 0) {
                    summary += `\n⚠️ 일부 처리 경고: ${r.errors.join(' / ')}`;
                }
            } catch (e) {
                summary += `\n⚠️ 종료일 자동 조정 실패: ${e.message} (휴일 설정은 완료됨)`;
            }
            alert(summary);

            setSelectedDates([]);
            setReason('');
```

- [ ] **Step 3: 삭제 핸들러에서 종료일 조정 호출**

`handleDeleteHoliday`의 다음 기존 try 블록을:

```js
        try {
            await deleteHoliday(holidayId);
            const data = await getHolidays();
            setHolidays(data);
            alert('휴일이 삭제되었습니다.');
        } catch (error) {
            alert(`휴일 삭제에 실패했습니다: ${error.message}`);
        }
```

다음으로 교체:

```js
        const removed = holidays.find((h) => h.id === holidayId);
        try {
            await deleteHoliday(holidayId);
            const data = await getHolidays();
            setHolidays(data);

            let summary = '휴일이 삭제되었습니다.';
            if (removed && removed.date) {
                try {
                    const r = await applyHolidayDeltaToEndDates({
                        changedDates: [removed.date],
                        mode: 'delete',
                        firebaseHolidays: data,
                    });
                    summary += `\n수강생 ${r.affectedStudents}명의 종료일이 단축되었습니다.`;
                    if (r.errors.length > 0) {
                        summary += `\n⚠️ 일부 처리 경고: ${r.errors.join(' / ')}`;
                    }
                } catch (e) {
                    summary += `\n⚠️ 종료일 자동 조정 실패: ${e.message} (휴일 삭제는 완료됨)`;
                }
            }
            alert(summary);
        } catch (error) {
            alert(`휴일 삭제에 실패했습니다: ${error.message}`);
        }
```

- [ ] **Step 4: 진행 표시 문구 변경**

다음 라인을 찾아:

```js
                            <span>{isSubmitting ? '설정 중...' : '휴일로 설정하기'}</span>
```

다음으로 교체:

```js
                            <span>{isSubmitting ? '설정 및 종료일 반영 중...' : '휴일로 설정하기'}</span>
```

- [ ] **Step 5: lint + 빌드 확인**

Run: `npm run lint && npm run build`
Expected: 신규 코드 lint 에러 없음, 빌드 성공.

- [ ] **Step 6: Commit**

```bash
git add src/components/HolidayManager.jsx
git commit -m "feat: 휴일 추가/삭제 시 수강생 종료일 자동 증분 조정 연결

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: 통합 수동 검증 + 마무리

**Files:** 없음 (검증만)

- [ ] **Step 1: 전체 단위 테스트 재실행**

Run: `npm test`
Expected: 전체 PASS.

- [ ] **Step 2: 개발 서버 수동 검증 시나리오**

Run: `npm run dev` (필요 시 별도 터미널에서 `npm run backend`)

검증 항목(실제 시트의 테스트용 행 또는 사본으로 확인 권장):
1. 코치 로그인 → 휴일 설정 → 어떤 수강생의 수업요일에 해당하는 평일 1개 추가
   → alert에 "수강생 N명 종료일 연장" 표시, 해당 수강생 H열이 1 수업일만큼
   뒤로 밀리고 노란색 하이라이트.
2. 방금 추가한 휴일 삭제 → 그 수강생 H열이 원래대로 복귀(1 수업일 단축).
3. 아무도 수업 안 하는 평일 추가 → H열 변경 없음, "0명".
4. 종료일이 이미 지난(과거) 수강생 → 변경 없음.
5. 미리 등록(같은 이름 2행) 수강생 → 현재 등록 종료일 연장 시 다음 등록
   시작/종료일도 자동 조정 확인.

- [ ] **Step 3: 안내문 일치 확인**

`HolidayManager.jsx`의 안내문("설정된 휴일은 수강생의 종료일 계산에 자동
반영됩니다")이 이제 실제 동작과 일치함을 확인(추가 코드 변경 불필요).

- [ ] **Step 4: 최종 정리 커밋(필요 시)**

수동 검증 중 수정이 있었다면 커밋. 없으면 생략.

- [ ] **Step 5: 완료 처리**

superpowers:finishing-a-development-branch 스킬로 PR/머지 옵션 진행.

---

## Self-Review (작성자 점검 완료)

- **Spec coverage:** 증분 알고리즘(spec §3)→Task 2~4, 추가/삭제 트리거(§2)→
  Task 6, 대상 범위 -3개월~휴일달(§2)→Task 5 Step 2 `wanted` 루프,
  미리등록(§3.3)→Task 5 미리등록 블록, 엣지케이스(§5)→Task 3 테스트 + Task 5
  필터, 안전성(§6)→Task 5 errors/가드, 작업 브랜치(§7)→이미
  `feat/holiday-end-date-recalc`.
- **Placeholder scan:** 모든 코드 단계에 실제 코드 포함, TBD/TODO 없음.
- **Type consistency:** 순수 함수 시그니처(`isHolidayRelevantToStudent`의
  `absenceDateSet`, `shiftEndDateBySessions`의 `isHoliday` 콜백)가 Task 3·4
  정의와 Task 5 호출부에서 동일. `applyHolidayDeltaToEndDates` 반환
  `{affectedStudents, perSheet, errors}`가 Task 6 사용부와 일치.
