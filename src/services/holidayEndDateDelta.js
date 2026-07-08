// 순수 날짜 계산 모듈 — Sheets/Firebase/env를 import하지 않는다.

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * E열 특이사항에서 '결석' 기록에 속한 YY.M.D 날짜만 'YYYY-MM-DD'로 추출.
 * 결석 메모 형식: "26.2.10, 26.2.12 결석" (여러 날짜가 하나의 '결석' 접미 공유).
 * 결석이 아닌 날짜 메모(상담/보강 등)는 제외 — 휴일 연장의 보수적 스킵 용도이며,
 * 실제 결석은 이미 종료일에 반영돼 있어 휴일 중복 연장을 막기 위함.
 * @param {string|null|undefined} notes
 * @returns {string[]}
 */
export function parseAbsenceDatesFromNotes(notes) {
  if (!notes) return [];
  const out = [];
  // "(날짜[, 날짜...]) 결석" 형태의 구간만 추출
  const segRe = /((?:\d{2}\.\d{1,2}\.\d{1,2}\s*,?\s*)+)결석/g;
  const dateRe = /(\d{2})\.(\d{1,2})\.(\d{1,2})/g;
  let seg;
  while ((seg = segRe.exec(String(notes))) !== null) {
    let m;
    dateRe.lastIndex = 0;
    while ((m = dateRe.exec(seg[1])) !== null) {
      const yyyy = 2000 + parseInt(m[1], 10);
      out.push(`${yyyy}-${pad2(parseInt(m[2], 10))}-${pad2(parseInt(m[3], 10))}`);
    }
  }
  return out;
}

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

export function filterEffectiveHolidayDeltaDates({ changedDates, mode, isBuiltInHoliday }) {
  if (!changedDates || changedDates.length === 0) return [];
  if (!['add', 'delete'].includes(mode)) return [...changedDates];
  return changedDates.filter((ds) => !isBuiltInHoliday(ds));
}

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

/**
 * 홀딩/결석으로 이번에 새로 빠지는 수업일 수만큼 "저장된" 종료일을 뒤로 민다.
 * 종료일을 시작일부터 다시 계산하지 않으므로, 시간표를 중간에 바꾼 등록에서
 * 이미 소진한(다른 요일의) 수업이 재계산으로 증발하는 문제를 피한다.
 * @param {Object} p
 * @param {Date} p.endDate                 - 현재 저장된 종료일(H열)
 * @param {Date} p.startDate               - 활성 등록 시작일
 * @param {number[]} p.classDays           - 정규 수업요일 (0=일 .. 6=토)
 * @param {string[]} p.newHeldDates        - 이번에 빠지는 날짜 'YYYY-MM-DD' (홀딩/결석)
 * @param {(d:Date)=>boolean} p.isHoliday
 * @param {Array<{start:Date,end:Date}>} [p.priorHoldingRanges] - 이미 종료일에 반영된 기존 홀딩/결석 범위
 * @param {number} [p.extraSessions]       - 정규요일이 아닌 보강일 홀딩 등 추가 연장분
 * @returns {Date|null} 밀린 종료일, 가드 소진 시 null
 */
export function extendEndDateForHeldSessions({
  endDate, startDate, classDays, newHeldDates,
  isHoliday, priorHoldingRanges = [], extraSessions = 0,
}) {
  const start = atMidnight(startDate);
  const end = atMidnight(endDate);
  const heldRanges = [];
  let held = 0;
  for (const ds of newHeldDates || []) {
    const d = atMidnight(new Date(`${ds}T00:00:00`));
    heldRanges.push({ start: d, end: d });
    if (!classDays.includes(d.getDay())) continue;    // 정규 수업요일 아님
    if (d < start || d > end) continue;                // 수강기간 밖
    if (isHoliday(d)) continue;                         // 원래 수업이 아니던 날(휴일)
    if (inAnyRange(d, priorHoldingRanges)) continue;    // 이미 종료일에 반영됨 → 중복 연장 방지
    held += 1;
  }
  return shiftEndDateBySessions({
    endDate,
    deltaSessions: held + (extraSessions || 0),
    classDays,
    holdingRanges: [...priorHoldingRanges, ...heldRanges],
    isHoliday,
  });
}
