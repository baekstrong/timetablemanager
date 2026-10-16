/* global require, module */
// Server-side daily plan. Dates are ISO calendar strings, never host-local clocks.
const { cappedEndForFirstClassMove, secondClassDayISO } = require('../../src/utils/makeupEndDate.js');

const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
const FIELDS = ['이름', '주횟수', '요일 및 시간', '특이사항', '신규/재등록', '시작날짜', '종료날짜', '결제금액', '결제일', '결제유무', '결제방식', '홀딩 사용여부', '홀딩 시작일', '홀딩 종료일'];
const text = value => String(value ?? '').trim();
const weekday = date => new Date(`${date}T00:00:00Z`).getUTCDay();
const addDays = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

function sheetDate(value) {
  const digits = text(value).replace(/\D/g, '');
  if (digits.length !== 6 && digits.length !== 8) return null;
  const full = digits.length === 6 ? `20${digits}` : digits;
  const iso = `${full.slice(0, 4)}-${full.slice(4, 6)}-${full.slice(6, 8)}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso ? null : iso;
}

function scheduleSlots(schedule) {
  return [...text(schedule).replace(/\s/g, '').matchAll(/([월화수목금토일])(\d+)/g)]
    .map(([, day, period]) => ({ day, period: Number(period) }))
    .filter(slot => slot.period >= 1 && slot.period <= 6);
}

function isPaused(row) {
  return !text(row['요일 및 시간']) && /^\d+\s*회$/.test(text(row['종료날짜'])) && parseInt(row['종료날짜'], 10) > 0;
}

function sheetOrder(name) {
  const match = text(name).match(/^등록생 목록\((\d+)년(\d+)월\)$/);
  return match ? (2000 + Number(match[1])) * 12 + Number(match[2]) - 1 : null;
}

function registrationRanges(titles, date) {
  const [year, month] = date.split('-').map(Number);
  const targetMonth = year * 12 + month - 1;
  return titles.filter(title => sheetOrder(title) != null).map(title => {
    const recent = sheetOrder(title) >= targetMonth - 6 && sheetOrder(title) <= targetMonth + 2;
    return { title, recent, range: `'${title.replaceAll("'", "''")}'!B3:${recent ? 'O' : 'H'}` };
  });
}

function registrationsFromRanges(ranges, valueRanges) {
  if (ranges.length !== valueRanges.length) throw new Error('Incomplete registration response');
  return ranges.flatMap((range, index) => (valueRanges[index].values || []).map((values, rowIndex) => ({
    ...Object.fromEntries(FIELDS.map((field, i) => [field, text(values[i])])),
    _foundSheetName: range.title, _rowIndex: rowIndex,
  })).filter(row => row['이름'] && (range.recent || isPaused(row))));
}

// Mirrors getAllStudentsFromAllSheets: active/latest-sheet, else earliest future,
// else latest start. A paused membership takes precedence without an active row.
function selectRegistrations(rows, date) {
  const byName = new Map();
  for (const row of rows) {
    const name = text(row['이름']);
    if (!name) continue;
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push({ ...row, _start: sheetDate(row['시작날짜']), _end: sheetDate(row['종료날짜']) });
  }
  return [...byName.values()].flatMap(all => {
    const active = all.filter(row => row._start && row._end && row._start <= date && date <= row._end);
    if (!active.length && all.some(isPaused)) return [];
    const registrations = all.filter(row => !(text(row['종료날짜']) === '0회' && !text(row['요일 및 시간'])))
      .sort((a, b) => (a._start || '9999').localeCompare(b._start || '9999'));
    if (!registrations.length) return [];
    const selected = active.sort((a, b) => (sheetOrder(b._foundSheetName) || 0) - (sheetOrder(a._foundSheetName) || 0)
      || (b._start || '').localeCompare(a._start || ''))[0]
      || registrations.find(row => row._start && row._start > date) || registrations.at(-1);
    const index = registrations.indexOf(selected);
    return [{ ...selected, _hasNext: index >= 0 && index < registrations.length - 1 }];
  });
}

function effectiveEndDate(row, makeups) {
  const end = row._end || sheetDate(row['종료날짜']);
  if (!end) return null;
  const own = makeups.filter(makeup => makeup.studentName === row['이름'] && ['active', 'completed'].includes(makeup.status));
  const relevant = own.filter(makeup => makeup.originalClass?.date && makeup.originalClass.date <= end && makeup.makeupClass?.date);
  const after = relevant.filter(makeup => makeup.makeupClass.date > end);
  if (after.length) {
    const second = secondClassDayISO(row['요일 및 시간'], end);
    const secondMakeup = own.find(makeup => makeup.originalClass?.date === second)?.makeupClass?.date;
    return after.reduce((latest, makeup) => {
      const capped = makeup.originalClass.date === end ? cappedEndForFirstClassMove({
        scheduleStr: row['요일 및 시간'], endDateISO: end,
        firstMakeupISO: makeup.makeupClass.date, secondMakeupISO: secondMakeup,
      }) : null;
      const target = capped?.capISO || makeup.makeupClass.date;
      return target > latest ? target : latest;
    }, end);
  }
  const moved = relevant.find(makeup => makeup.originalClass.date === end);
  if (!moved) return end;
  const scheduleDays = new Set(scheduleSlots(row['요일 및 시간']).map(slot => slot.day));
  for (let offset = 1; offset <= 7; offset++) {
    const previous = addDays(end, -offset);
    if (scheduleDays.has(DAYS[weekday(previous)])) return previous > moved.makeupClass.date ? previous : moved.makeupClass.date;
  }
  return moved.makeupClass.date;
}

function agreedAbsent(notes, date) {
  for (const match of text(notes).matchAll(/((?:\d{2}\.\d{1,2}\.\d{1,2}(?:\s*,\s*)?)+)\s*결석/g)) {
    if (match[1].split(',').some(value => {
      const [year, month, day] = value.trim().split('.');
      return `20${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` === date;
    })) return true;
  }
  return false;
}

function isHeld(row, holdings, date) {
  if (!/^(?:O(?:\s*\(\d+\/\d+\))?|Y|사용)$/i.test(text(row['홀딩 사용여부']))) return false;
  const start = sheetDate(row['홀딩 시작일']);
  const end = sheetDate(row['홀딩 종료일']);
  if (!start || !end || date < start || date > end) return false;
  const holding = holdings.find(item => item.studentName === row['이름'] && item.startDate === start && item.endDate === end && item.status !== 'cancelled');
  return !holding?.holdingDates?.length || holding.holdingDates.includes(date);
}

function attendsSlot(row, date, period, makeups, absences, holdings) {
  const name = row['이름'];
  if (absences.some(item => item.studentName === name && item.date === date) || isHeld(row, holdings, date)) return false;
  const matches = slot => slot?.date === date && Number(slot.period) === Number(period);
  const own = makeups.filter(item => item.studentName === name);
  const makeupToday = own.some(item => matches(item.makeupClass));
  const movedAway = own.some(item => matches(item.originalClass));
  const regular = scheduleSlots(row['요일 및 시간']).some(slot => slot.day === DAYS[weekday(date)] && slot.period === period);
  return makeupToday || (regular && !movedAway && !agreedAbsent(row['특이사항'], date));
}

function buildDailySnapshot({ date, registrations, makeups = [], absences = [], holdings = [], holidays = [], disabledClasses = [], periods, koreanHolidays = {} }) {
  if (!sheetDate(date) || !Array.isArray(registrations) || !Array.isArray(periods)) throw new Error('Invalid daily source');
  const day = DAYS[weekday(date)];
  if (['일', '토'].includes(day) || koreanHolidays[date] || holidays.some(item => item.date === date)) return { date, lessons: [] };
  const students = selectRegistrations(registrations, date);
  const validMakeups = makeups.filter(item => ['active', 'completed'].includes(item.status));
  const lessons = periods.filter(period => period.type !== 'free' && !disabledClasses.includes(`${day}-${period.id}`)).map(period => {
    const lastNames = [];
    const delayedNames = [];
    for (const row of students) {
      const name = row['이름'];
      if (!row._start || !row._end || row._start > date || row._hasNext || !text(row['요일 및 시간'])) continue;
      if (!attendsSlot(row, date, period.id, validMakeups, absences, holdings)) continue;
      const effectiveEnd = effectiveEndDate(row, validMakeups);
      // A final day may contain both a makeup and a later regular lesson. Choose
      // the latest actual attendance, independently of makeup query ordering.
      const finalPeriod = effectiveEnd === date ? periods.filter(item => item.type !== 'free'
        && !disabledClasses.includes(`${day}-${item.id}`)
        && attendsSlot(row, date, item.id, validMakeups, absences, holdings))
        .sort((a, b) => (b.startHour * 60 + b.startMinute) - (a.startHour * 60 + a.startMinute))[0]?.id : null;
      if (effectiveEnd === date && finalPeriod === period.id) lastNames.push(name);
      else if (effectiveEnd < date) delayedNames.push(name);
    }
    return { period: period.id, startMinute: period.startHour * 60 + period.startMinute,
      lastNames: [...new Set(lastNames)].sort(), delayedNames: [...new Set(delayedNames)].sort() };
  });
  return { date, lessons };
}

module.exports = { sheetDate, scheduleSlots, registrationRanges, registrationsFromRanges, selectRegistrations, effectiveEndDate, buildDailySnapshot, addDays, weekday };
