import { DAYS, PERIODS, PRICING, ENTRANCE_FEE } from '../data/mockData';
import { calculateStartEndDates } from './dateUtils';
import { calculateEndDateWithHolidays } from '../services/googleSheetsService';

const formatLocal = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

// 승인 전 미리보기와 실제 승인에 동일한 신규 1개월 계산을 사용한다.
export function buildNewRegistrationPlan(reg, slots, frequency, holidays = [], disabledClasses = []) {
    const weeklyFrequency = Number(frequency);
    const pricing = PRICING.find(p => p.frequency === weeklyFrequency);
    if (!pricing) throw new Error('주 횟수를 선택해주세요.');
    if (!Array.isArray(slots) || slots.length !== weeklyFrequency) {
        throw new Error(`시간표를 정확히 ${weeklyFrequency}개 선택해주세요.`);
    }
    const days = new Set();
    for (const slot of slots) {
        if (!DAYS.includes(slot.day) || !PERIODS.some(p => p.id === slot.period && p.type !== 'free')
            || disabledClasses.includes(`${slot.day}-${slot.period}`)) {
            throw new Error('수업이 없는 시간은 선택할 수 없습니다.');
        }
        if (days.has(slot.day)) throw new Error('같은 요일에는 한 교시만 선택해주세요.');
        days.add(slot.day);
    }
    const requestedSlots = [...slots].sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day));
    const scheduleString = requestedSlots.map(s => `${s.day}${s.period}`).join('');
    const entranceDate = reg.entranceInquiry || reg.entranceDate;
    let startDate = '', endDate = '';
    if (entranceDate) {
        const entrance = new Date(`${entranceDate}T00:00:00`);
        if (Number.isNaN(entrance.getTime()) || formatLocal(entrance) !== entranceDate) {
            throw new Error('입학반 날짜를 확인해주세요.');
        }
        const candidate = calculateStartEndDates(entranceDate, requestedSlots).startDate;
        const first = calculateEndDateWithHolidays(new Date(`${candidate}T00:00:00`), 1, scheduleString, holidays);
        const last = first && calculateEndDateWithHolidays(first, weeklyFrequency * 4, scheduleString, holidays);
        if (!first || !last) throw new Error('수강 기간을 계산할 수 없습니다. 공휴일과 시간표를 확인해주세요.');
        startDate = formatLocal(first);
        endDate = formatLocal(last);
    }
    return {
        weeklyFrequency, requestedSlots, scheduleString, startDate, endDate,
        baseCost: pricing.baseCost, entranceCost: ENTRANCE_FEE,
        totalCost: pricing.baseCost + ENTRANCE_FEE,
    };
}
