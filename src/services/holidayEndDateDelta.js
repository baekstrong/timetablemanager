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
