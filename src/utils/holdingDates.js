// isClassDay는 휴일과 보강 이동을 반영한 실제 수업일 판정이다.
// 신청 마감·결석·기존 홀딩 때문에 선택할 수 없는 수업일도 임의로 건너뛰지 않는다.
export const validateHoldingDates = (dates, weeklyFrequency, isClassDay) => {
    const sorted = [...new Set(dates)].sort();
    if (sorted.length === 0) return '홀딩 날짜를 선택해주세요.';
    if (sorted.length > weeklyFrequency) {
        return `한 번에 신청할 수 있는 홀딩 수업일은 최대 ${weeklyFrequency}일입니다.`;
    }

    const selected = new Set(sorted);
    for (const value of sorted) {
        const date = new Date(value + 'T00:00:00');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime()) || !isClassDay(date)) {
            return '실제 수업일만 홀딩할 수 있습니다.';
        }
    }
    const end = new Date(sorted[sorted.length - 1] + 'T00:00:00');
    const date = new Date(sorted[0] + 'T00:00:00');
    for (; date <= end; date.setDate(date.getDate() + 1)) {
        const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        if (isClassDay(date) && !selected.has(value)) {
            return '홀딩은 연속된 수업일만 선택할 수 있습니다. 중간 수업일을 건너뛸 수 없습니다.';
        }
    }
    return null;
};
