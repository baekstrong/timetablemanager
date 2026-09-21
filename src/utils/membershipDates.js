// 표시/이력용 전체 기간과 달리, 수업 자격은 각 등록의 실제 기간으로 판정한다.
const parseMembershipDate = (value) => {
    const digits = String(value ?? '').replace(/\D/g, '');
    if (!/^\d{6}$|^\d{8}$/.test(digits)) return null;
    const full = digits.length === 6 ? `20${digits}` : digits;
    const year = Number(full.slice(0, 4));
    const month = Number(full.slice(4, 6));
    const day = Number(full.slice(6, 8));
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
        ? date : null;
};

export const isWithinRegisteredPeriod = (date, studentData, activeMakeups = []) => {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return false;
    const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    // 등록 밖 보강은 예약된 하루만 허용하며 그 사이 정규 수업은 만들지 않는다.
    if (activeMakeups.some(makeup =>
        parseMembershipDate(makeup.makeupClass?.date)?.getTime() === day.getTime())) return true;

    return [studentData, studentData?._prevRegistration, studentData?._nextRegistration]
        .some(registration => {
            if (!registration) return false;
            const start = parseMembershipDate(registration['시작날짜']);
            const end = parseMembershipDate(registration['종료날짜'] || registration['종료일'] || registration.endDate);
            return !!(start && end && day >= start && day <= end);
        });
};
