import { batchReadSheetData, getAllSheetNames, getStudentField as field, parseSheetDate, parseScheduleString,
    parseHoldingStatus, isHolidayDate, todaySessionDone, calculateEndDateWithHolidays, invalidateStudentSheetCache } from './googleSheetsService';
import { parseAbsenceDatesFromNotes } from './holidayEndDateDelta';
import { contractChangeNotes, readContractChange, scheduleOnDate } from '../utils/contractChange';
import { PRICING, DAYS, PERIODS } from '../data/mockData';

export const isoDay = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const nextDay = date => { const d = new Date(date); d.setDate(d.getDate() + 1); return d; };
const sheetDay = date => isoDay(date).replaceAll('-', '').slice(2);
const dayNumber = day => ({ 월: 1, 화: 2, 수: 3, 목: 4, 금: 5 }[day]);
export const contractSnapshot = entries => JSON.stringify(entries.map(e => [e.sheetName, e.rowIndex, e.row]));

export async function loadContractRegistrations(name) {
    const sheets = (await getAllSheetNames()).filter(s => s.startsWith('등록생 목록('));
    const values = await batchReadSheetData(sheets.map(s => `${s}!A:R`));
    if (values.length !== sheets.length) throw new Error('등록 정보를 모두 불러오지 못했습니다.');
    return sheets.flatMap((sheetName, i) => (values[i].values || []).slice(2).flatMap((row, index) => {
        if (String(row[1] || '') !== name) return [];
        const student = Object.fromEntries((values[i].values[1] || []).map((h, c) => [h, row[c] ?? '']));
        return [{ sheetName, rowIndex: index + 2, row, student }];
    }));
}

export function buildContractChangePlan({ entry, entries, frequency, schedule, holidays = [], holdings = [], makeups = [], now = new Date(), amount, paymentDate, paymentMethod, paid = true, id }) {
    const student = entry.student;
    const start = parseSheetDate(field(student, '시작날짜'));
    const end = parseSheetDate(field(student, '종료날짜'));
    const oldSchedule = field(student, '요일 및 시간');
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (!start || !end || today < start || today > end || !oldSchedule) throw new Error('현재 수강 중인 등록만 계약변경할 수 있습니다.');
    const slots = parseScheduleString(schedule);
    if (![2, 3, 4].includes(frequency) || slots.length !== frequency || new Set(slots.map(s => s.day)).size !== frequency ||
        slots.some(s => !DAYS.includes(s.day) || !PERIODS.some(p => p.id === s.period && p.type !== 'free')) || slots.map(s => `${s.day}${s.period}`).join('') !== schedule) {
        throw new Error('주 횟수에 맞는 정규 시간표를 선택해주세요.');
    }
    if (Number(field(student, '주횟수')) === frequency && schedule === oldSchedule) throw new Error('변경할 주 횟수 또는 시간표를 선택해주세요.');
    const holding = parseHoldingStatus(field(student, '홀딩 사용여부'));
    const total = frequency * 4 * holding.months;
    const oldTotal = Number(field(student, '주횟수')) * 4 * holding.months;
    // 당일 수업이 끝나기 전에는 당일을 잔여에 포함한다.
    const oldDone = todaySessionDone(oldSchedule, now);
    const newDone = todaySessionDone(schedule, now);
    const oldToday = parseScheduleString(oldSchedule).some(s => dayNumber(s.day) === today.getDay());
    if (!oldDone && newDone && oldToday) throw new Error('오늘 기존 수업이 끝난 뒤 계약변경해주세요. 지난 시간으로 수업을 옮길 수 없습니다.');
    const from = oldDone || newDone ? nextDay(today) : today;
    const consumptionFrom = oldDone ? nextDay(today) : today;
    const fromISO = isoDay(from);
    const excluded = new Set(parseAbsenceDatesFromNotes(field(student, '특이사항')));
    const ranges = holdings.filter(h => h.status !== 'cancelled' && h.startDate && h.endDate);
    if (holding.isCurrentlyUsed) {
        const hs = parseSheetDate(field(student, '홀딩 시작일')), he = parseSheetDate(field(student, '홀딩 종료일'));
        if (hs && he) ranges.push({ startDate: isoDay(hs), endDate: isoDay(he) });
    }
    const isHeld = day => ranges.some(h => day >= h.startDate && day <= h.endDate && (!h.holdingDates?.length || h.holdingDates.includes(day)));
    // 과거 소진은 기존 종료일에서 남은 정규 회차를 빼서 계산한다. 일반 학생 결석은 소진,
    // 시트에 연장 반영한 합의결석·홀딩·휴일은 미소진이다.
    let oldRemaining = 0;
    for (let d = new Date(consumptionFrom), guard = 0; d <= end && guard++ < 1500; d = nextDay(d)) {
        const day = isoDay(d);
        if (parseScheduleString(scheduleOnDate(student, day, field)).some(s => dayNumber(s.day) === d.getDay()) &&
            !isHolidayDate(d, holidays) && !excluded.has(day) && !isHeld(day)) oldRemaining++;
    }
    const relevantMakeups = makeups.filter(m => ['active', 'completed'].includes(m.status) && m.originalClass?.date >= isoDay(start) && m.originalClass.date <= isoDay(end));
    // 기예약 보강은 원수업에서 별도로 소진된다. 향후 보강을 새 정규15회에 또 넣지 않는다.
    let reserved = 0;
    const countedAt = (date, period, scheduleText, cutoff) => {
        const d = parseSheetDate(date);
        return date >= cutoff && date <= isoDay(end) && d && !isHolidayDate(d, holidays) && !excluded.has(date) && !isHeld(date) &&
            parseScheduleString(scheduleText).some(s => dayNumber(s.day) === d.getDay() && (!period || s.period === Number(period)));
    };
    const makeupKeys = new Set();
    const makeupPending = m => {
        const date = m.makeupClass.date;
        const d = parseSheetDate(date);
        const day = DAYS.find(day => dayNumber(day) === d?.getDay());
        return date > isoDay(today) || (date === isoDay(today) && !todaySessionDone(`${day}${m.makeupClass.period}`, now));
    };
    for (const m of relevantMakeups) {
        const original = m.originalClass.date, moved = m.makeupClass?.date;
        if (!moved) continue;
        const key = `${original}:${m.originalClass.period || ''}`;
        if (makeupKeys.has(key)) throw new Error('같은 원수업의 보강이 중복되어 있습니다. 보강 내역을 먼저 확인해주세요.');
        makeupKeys.add(key);
        const oldOriginalCounted = countedAt(original, m.originalClass.period, scheduleOnDate(student, original, field), isoDay(consumptionFrom));
        if (oldOriginalCounted) oldRemaining--;
        if (makeupPending(m) && !isHeld(moved)) oldRemaining++;
        // 새 시간표의 같은 원수업 칸이 유지되면 기존 보강 이동을 그대로 사용한다.
        // 원수업이 이미 지났거나 교시가 바뀌면 기예약 보강을 별도 잔여로 보존한다.
        const newOriginalCounted = countedAt(original, m.originalClass.period, schedule, fromISO);
        if (makeupPending(m) && !isHeld(moved) && !newOriginalCounted) reserved++;
    }
    const consumed = Math.max(0, Math.min(oldTotal, oldTotal - oldRemaining));
    const remaining = total - consumed;
    if (remaining <= 0 || remaining - reserved <= 0) throw new Error('변경 후 남는 정규 수업이 없습니다. 수강권을 확인해주세요.');
    const excludedFuture = [...excluded];
    for (let d = new Date(from), guard = 0; guard++ < 1500 && d <= nextDay(new Date(from.getFullYear() + 1, from.getMonth(), from.getDate())); d = nextDay(d)) {
        if (isHeld(isoDay(d))) excludedFuture.push(isoDay(d));
    }
    const newEnd = calculateEndDateWithHolidays(from, remaining - reserved, schedule, holidays, excludedFuture);
    if (!newEnd) throw new Error('종료일을 계산하지 못했습니다.');
    const future = entries.filter(e => e !== entry && field(e.student, '요일 및 시간') && parseSheetDate(field(e.student, '시작날짜')) > today);
    if (future.some(e => parseSheetDate(field(e.student, '시작날짜')) <= newEnd)) throw new Error('변경 종료일이 미리 등록한 다음 계약과 겹칩니다. 다음 등록 일정을 먼저 조정해주세요.');
    const previous = readContractChange(field(student, '특이사항'));
    const segments = [...(previous?.segments || []), { from: previous?.from || isoDay(start), until: fromISO, schedule: oldSchedule }];
    const metadata = { v: 1, id, from: fromISO, consumed, reserved, segments, reservations: relevantMakeups.map(m => ({ status: m.status, originalClass: m.originalClass, makeupClass: m.makeupClass })) };
    const oldPrice = PRICING.find(p => p.frequency === Number(field(student, '주횟수')))?.baseCost;
    const newPrice = PRICING.find(p => p.frequency === frequency).baseCost;
    const difference = amount ?? ((newPrice - (oldPrice || newPrice)) * holding.months / 10000);
    if (!Number.isFinite(Number(difference)) || Number(difference) < 0) throw new Error('추가 결제액은 0 이상의 만원 단위로 입력해주세요. 환불은 별도 처리해주세요.');
    const row = Array.from({ length: 18 }, (_, i) => entry.row[i] ?? '');
    row[0] = ''; row[2] = String(frequency); row[3] = schedule;
    const changeMemo = `${isoDay(now).slice(2).replaceAll('-', '.')} 계약변경: 주${field(student, '주횟수')}회 → 주${frequency}회 (소진 ${consumed}회 · 잔여 ${remaining}회)`;
    row[4] = contractChangeNotes(`${field(student, '특이사항') || ''}\n${changeMemo}`.trim(), metadata);
    row[5] = '계약변경'; row[6] = sheetDay(start); row[7] = sheetDay(newEnd);
    row[8] = String(difference); row[9] = paymentDate ? paymentDate.replaceAll('-', '').slice(2) : ''; row[10] = paid ? 'O' : 'X'; row[11] = paymentMethod || '카드';
    // 이전 계약을 과거 날짜에서 재구성할 수 있도록 D열을 비우기 전 원본을 E열에 보존한다.
    const retired = entries.filter(e => String(field(e.student, '요일 및 시간') || '').trim() &&
        parseSheetDate(field(e.student, '시작날짜')) <= today && ['신규', '재등록', '계약변경'].includes(field(e.student, '신규/재등록')));
    if (!retired.includes(entry)) throw new Error('신규·재등록·계약변경 등록만 변경할 수 있습니다.');
    return { row, retired, consumed, total, remaining, reserved, endDate: isoDay(newEnd), from: fromISO, amount: difference, metadata };
}

export async function saveContractChange(context, options, expectedPlan) {
    const entries = await loadContractRegistrations(context.name);
    if (contractSnapshot(entries) !== context.snapshot) throw new Error('등록 정보가 변경됐습니다. 닫은 뒤 다시 확인해주세요.');
    const entry = entries.find(e => e.sheetName === context.entry.sheetName && e.rowIndex === context.entry.rowIndex);
    const plan = buildContractChangePlan({ ...options, entry, entries });
    if (JSON.stringify(plan.row) !== JSON.stringify(expectedPlan.row)) throw new Error('소진 횟수 또는 종료일이 변경됐습니다. 최신 계산을 다시 확인해주세요.');
    const base = import.meta.env.VITE_FUNCTIONS_URL || (import.meta.env.PROD ? '/.netlify/functions/sheets' : 'http://localhost:5001');
    const response = await fetch(`${base}/contractChange`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(20000), body: JSON.stringify({
        name: context.name, targetSheet: entry.sheetName, id: options.id, row: plan.row,
        retired: plan.retired.map(e => ({ sheetName: e.sheetName, rowIndex: e.rowIndex, expected: e.row,
            notes: `${field(e.student, '특이사항') || ''}\n${isoDay(options.now || new Date()).slice(2).replaceAll('-', '.')}에 주${field(e.student, '주횟수')}회 → 주${options.frequency}회로 수강 변경 함\n[이전시간표:${field(e.student, '요일 및 시간')}] [계약변경연결:${options.id}]`.trim() })),
    }) });
    const data = await response.json();
    invalidateStudentSheetCache();
    if (!response.ok || !data.success) throw new Error(data.error || '저장 결과를 확인하지 못했습니다. 최신 시트를 확인해주세요.');
    return plan;
}
