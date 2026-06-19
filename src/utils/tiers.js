// 티어 = 지난달 "활동일 수"(고유 날짜) 버킷.
// 활동일 = 예정 수업일(홀딩·결석·공휴일 제외) ∪ 훈련일지 기록일 ∪ 자율운동일.
// 경계값(min)은 운영하며 조정하는 손잡이 — 주2회 개근이 '성실'에 안착하도록 잡음.
import { KOREAN_HOLIDAYS } from '../data/mockData';
import { parseScheduleString, parseSheetDate } from './scheduleUtils';

// 높은 티어가 배열 앞. scoreToTier는 위에서부터 첫 매칭을 고름.
export const TIERS = [
    { key: 'iron', label: '철인', emoji: '🔥', min: 17, color: '#242428' },
    { key: 'core', label: '코어', emoji: '💎', min: 13, color: '#EDBC40' },
    { key: 'passion', label: '열정', emoji: '🥇', min: 9, color: '#31A552' },
    { key: 'steady', label: '성실', emoji: '🥈', min: 6, color: '#329BE7' },
    { key: 'rookie', label: '입문', emoji: '🥉', min: 0, color: '#A7A7AA' },
];

const ORDER = ['rookie', 'steady', 'passion', 'core', 'iron']; // 낮은→높은

export function scoreToTier(score) {
    const s = Number(score) || 0;
    return TIERS.find(t => s >= t.min) || TIERS[TIERS.length - 1];
}

export function tierByKey(key) {
    return TIERS.find(t => t.key === key) || null;
}

// 승급(+1) / 강등(-1) / 유지(0). 알 수 없으면 0.
export function compareTiers(prevKey, nextKey) {
    const a = ORDER.indexOf(prevKey);
    const b = ORDER.indexOf(nextKey);
    if (a < 0 || b < 0) return 0;
    return Math.sign(b - a);
}

const DAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

// 지난달 예정 수업일('YYYY-MM-DD' Set): 요일 매칭 + 등록기간 내 + 한국 공휴일 + Firebase 커스텀 공휴일 제외.
// extraHolidays: 코치 커스텀 공휴일 'YYYY-MM-DD' Set (getHolidays의 h.date).
export function scheduledDatesInMonth(scheduleStr, startYMD, endYMD, ym, extraHolidays) {
    const parsed = parseScheduleString(scheduleStr);
    if (parsed.length === 0) return new Set();
    const weekdays = new Set(parsed.map(p => p.day));
    const [y, m] = ym.split('-').map(Number);
    const start = startYMD ? parseSheetDate(startYMD) : null;
    const end = endYMD ? parseSheetDate(endYMD) : null;
    const lastDay = new Date(y, m, 0).getDate(); // m은 1-indexed → 그 달 말일
    const out = new Set();
    for (let d = 1; d <= lastDay; d++) {
        const date = new Date(y, m - 1, d);
        if (!weekdays.has(DAY_KO[date.getDay()])) continue;
        if (start && date < start) continue;
        if (end && date > end) continue;
        const iso = `${ym}-${String(d).padStart(2, '0')}`;
        if (KOREAN_HOLIDAYS[iso]) continue;
        if (extraHolidays?.has(iso)) continue;
        out.add(iso);
    }
    return out;
}

// 고유 활동일 수. 홀딩/결석은 '예정일'에서만 빼고, 실제 운동기록(records·자율)이 있는 날은 보호.
export function computeActiveScore({ scheduledDates, recordDates, freeDates, holdingRanges = [], absenceDates } = {}) {
    const days = new Set();
    scheduledDates?.forEach(d => days.add(d));
    recordDates?.forEach(d => days.add(d));
    freeDates?.forEach(d => days.add(d));
    const logged = new Set([...(recordDates || []), ...(freeDates || [])]);
    for (const iso of [...days]) {
        if (logged.has(iso)) continue; // 실제 운동했으면 홀딩/결석과 무관하게 인정
        if (absenceDates?.has(iso)) { days.delete(iso); continue; }
        if (holdingRanges.some(r => iso >= r.start && iso <= r.end)) days.delete(iso);
    }
    return days.size;
}
