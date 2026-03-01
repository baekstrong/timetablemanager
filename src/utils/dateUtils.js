// YYYY-MM-DD → "2026년 2월 21일(토)"
export const formatEntranceDate = (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr + 'T00:00:00');
    if (isNaN(date.getTime())) return dateStr;
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const dayOfWeek = dayNames[date.getDay()];
    return `${year}년 ${month}월 ${day}일(${dayOfWeek})`;
};

// YYYY-MM-DD → YYMMDD
export const convertToYYMMDD = (dateStr) => {
    if (!dateStr) return '';
    return dateStr.slice(2).replace(/-/g, '');
};

// 요일 이름 → JS getDay() 값 매핑 (월=1, 화=2, ..., 금=5)
const dayNameToIndex = { '월': 1, '화': 2, '수': 3, '목': 4, '금': 5 };

// 로컬 시간 기준 YYYY-MM-DD 포맷 (UTC 변환 방지)
const fmtLocal = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
};

/**
 * 입학반 다음주 기준 시작일/종료일 계산
 * @param {string} entranceDateStr - 입학반 날짜 (YYYY-MM-DD)
 * @param {Array} requestedSlots - [{day: '화', period: 2}, {day: '목', period: 2}]
 * @returns {{ startDate: string, endDate: string }} YYYY-MM-DD 형식
 */
export const calculateStartEndDates = (entranceDateStr, requestedSlots) => {
    if (!entranceDateStr || !requestedSlots || requestedSlots.length === 0) {
        const today = new Date();
        const end = new Date(today);
        end.setDate(end.getDate() + 30);
        return { startDate: fmtLocal(today), endDate: fmtLocal(end) };
    }

    const entranceDate = new Date(entranceDateStr + 'T00:00:00');

    // 입학반 다음주 월요일 찾기
    const dayOfWeek = entranceDate.getDay(); // 0=일, 1=월, ..., 6=토
    const daysUntilNextMonday = dayOfWeek === 0 ? 1 : (8 - dayOfWeek);
    const nextMonday = new Date(entranceDate);
    nextMonday.setDate(entranceDate.getDate() + daysUntilNextMonday);

    // 수강 요일 인덱스 정렬
    const classDayIndices = requestedSlots
        .map(s => dayNameToIndex[s.day])
        .filter(Boolean)
        .sort((a, b) => a - b);

    if (classDayIndices.length === 0) {
        const end = new Date(nextMonday);
        end.setDate(end.getDate() + 27);
        return { startDate: fmtLocal(nextMonday), endDate: fmtLocal(end) };
    }

    // 시작일: 다음주 첫 수업 요일
    const firstClassDayOffset = classDayIndices[0] - 1; // 월=0 offset
    const startDate = new Date(nextMonday);
    startDate.setDate(nextMonday.getDate() + firstClassDayOffset);

    // 종료일: 4주차 마지막 수업 요일
    const lastClassDayOffset = classDayIndices[classDayIndices.length - 1] - 1;
    const week4Monday = new Date(nextMonday);
    week4Monday.setDate(nextMonday.getDate() + 21); // 3주 후 = 4주차 월요일
    const endDate = new Date(week4Monday);
    endDate.setDate(week4Monday.getDate() + lastClassDayOffset);

    return { startDate: fmtLocal(startDate), endDate: fmtLocal(endDate) };
};
