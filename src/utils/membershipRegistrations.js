// 표시용 합산 범위. 수업 신청/시트 쓰기는 각 등록의 원래 경계를 계속 사용한다.
const field = (row, name) => Object.entries(row || {})
    .find(([key]) => key.replace(/\s/g, '') === name.replace(/\s/g, ''))?.[1];
const dateKey = value => {
    const digits = String(value || '').replace(/\D/g, '');
    return digits.length === 6 ? `20${digits}` : digits.length === 8 ? digits : '';
};

export function getMembershipRegistrations(student) {
    if (!student) return [];
    const upcoming = student._upcomingRegistrations || (student._nextRegistration ? [student._nextRegistration] : []);
    const start = dateKey(field(student, '시작날짜'));
    const seen = new Set();
    return [student, ...upcoming].filter((row, index) => {
        if (!row) return false;
        const rowStart = dateKey(field(row, '시작날짜'));
        const rowEnd = dateKey(field(row, '종료날짜'));
        if (index && (!rowStart || !rowEnd || rowEnd < rowStart || rowStart < start || !field(row, '요일 및 시간'))) return false;
        const key = `${rowStart}/${rowEnd}/${field(row, '요일 및 시간')}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

export function registrationContainsDate(registration, date) {
    const start = dateKey(field(registration, '시작날짜'));
    const end = dateKey(field(registration, '종료날짜'));
    const target = dateKey(date);
    return !!(start && end && target && target >= start && target <= end);
}

export function getRegistrationHoldings(registration, holdings = [], makeups = []) {
    const start = dateKey(field(registration, '시작날짜'));
    const end = dateKey(field(registration, '종료날짜'));
    if (!start || !end) return [];
    return holdings.filter(holding => {
        if (holding.status === 'cancelled') return false;
        const from = dateKey(holding.startDate);
        const to = dateKey(holding.endDate);
        if (!from || !to) return false;
        if (from <= end && to >= start) return true;
        return makeups.some(makeup => ['active', 'completed'].includes(makeup.status) &&
            registrationContainsDate(registration, makeup.originalClass?.date) &&
            dateKey(makeup.makeupClass?.date) >= from && dateKey(makeup.makeupClass?.date) <= to);
    });
}

export function getMembershipHoldings(student, holdings = [], makeups = []) {
    return [...new Set(getMembershipRegistrations(student)
        .flatMap(registration => getRegistrationHoldings(registration, holdings, makeups)))];
}
