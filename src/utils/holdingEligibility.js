import { PERIODS } from '../data/mockData';

export const parseHoldingDate = value => {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : new Date(value.getFullYear(), value.getMonth(), value.getDate());
    const digits = String(value ?? '').replace(/\D/g, '');
    if (!/^\d{6}$|^\d{8}$/.test(digits)) return null;
    const full = digits.length === 6 ? `20${digits}` : digits;
    const year = Number(full.slice(0, 4));
    const month = Number(full.slice(4, 6));
    const day = Number(full.slice(6, 8));
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
};

export const holdingDateISO = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export const holdingSchedule = registration => [...String(registration?.['요일 및 시간'] || '').replace(/\s/g, '').matchAll(/([월화수목금])([1-6])/g)]
    .map(([, day, period]) => ({ day, period: Number(period) }));

// Sheets 쓰기와 동일하게 실제 날짜를 포함하는 등록을 찾는다. 표시용 전체 기간은 쓰지 않는다.
export const getHoldingRegistration = (date, studentData) => {
    const day = parseHoldingDate(date);
    if (!day) return null;
    return [['current', studentData], ['previous', studentData?._prevRegistration], ['next', studentData?._nextRegistration]]
        .map(([key, registration]) => ({ key, registration, start: parseHoldingDate(registration?.['시작날짜']), end: parseHoldingDate(registration?.['종료날짜'] || registration?.['종료일'] || registration?.endDate) }))
        .filter(item => item.start && item.end && day >= item.start && day <= item.end)
        .sort((a, b) => a.start - b.start)[0] || null;
};

export const getHoldingClass = (date, studentData, makeups = []) => {
    const day = parseHoldingDate(date);
    if (!day) return null;
    const iso = holdingDateISO(day);
    const active = makeups.filter(item => !item.status || ['active', 'completed'].includes(item.status));
    const makeup = active.find(item => item.makeupClass?.date === iso);
    const registration = getHoldingRegistration(day, studentData)
        || (makeup && getHoldingRegistration(makeup.originalClass?.date, studentData));
    if (!registration) return null;
    const schedule = holdingSchedule(registration.registration);
    const weeklyFrequency = Number.parseInt(registration.registration['주횟수'], 10) || 2;
    if (makeup) return { ...registration, schedule, weeklyFrequency, period: Number(makeup.makeupClass.period), makeup };
    if (active.some(item => item.originalClass?.date === iso)) return null;
    const slot = schedule.find(item => item.day === ['일', '월', '화', '수', '목', '금', '토'][day.getDay()]);
    return slot ? { ...registration, schedule, weeklyFrequency, period: slot.period, makeup: null } : null;
};

export const isBeforeHoldingDeadline = (date, periodId, minutes, now = new Date()) => {
    const day = parseHoldingDate(date);
    const period = PERIODS.find(item => item.id === Number(periodId));
    if (!day || !period) return false;
    day.setHours(period.startHour, period.startMinute, 0, 0);
    return now.getTime() < day.getTime() - minutes * 60_000;
};

// 달력·문맥 날짜 버튼·최종 제출이 같은 규칙을 사용하며 마감은 호출할 때마다 계산한다.
export const getHoldingRequestDateError = ({ date, classInfo, requestType, holiday, holdings = [], absences = [], now = new Date() }) => {
    const day = parseHoldingDate(date);
    if (!day || !classInfo) return '수강 기간 내의 실제 수업일만 신청할 수 있습니다.';
    const iso = holdingDateISO(day);
    if (holiday) return '휴일에는 홀딩·결석을 신청할 수 없습니다.';
    if (holdings.some(item => item.status !== 'cancelled' && (item.holdingDates?.includes(iso) || (iso >= item.startDate && iso <= item.endDate)))) {
        return '이미 홀딩을 신청한 날짜입니다.';
    }
    if (absences.some(item => item.status !== 'cancelled' && item.date === iso)) return '이미 결석을 신청한 날짜입니다.';
    const isAbsence = requestType === 'absence';
    if (!isBeforeHoldingDeadline(day, classInfo.period, isAbsence ? 10 : 120, now)) {
        return isAbsence ? '결석 신청은 수업 시작 10분 전까지만 가능합니다.' : '홀딩 신청은 수업 시작 2시간 전까지만 가능합니다.';
    }
    return null;
};

// 계약서: 주N회는 연속 N수업일까지 홀딩할 수 있다. 남은 수업이 N회보다 적으면
// 종료일 뒤에 이어질 수업일까지 포함해야 N일을 채울 수 있으므로, 마지막 등록의
// 실질 종료일(보강 포함) 뒤 정규 수업 요일을 최대 N-1일까지 '연장 홀딩일'로 연다.
// 휴일은 건너뛰며, 이 날짜만 단독으로 홀딩할 수는 없다(검증은 HoldingManager).
export const getHoldingExtensionClasses = (studentData, makeups = [], isOffDay = () => false) => {
    const registrations = [['current', studentData], ['previous', studentData?._prevRegistration], ['next', studentData?._nextRegistration]]
        .map(([key, registration]) => ({ key, registration, start: parseHoldingDate(registration?.['시작날짜']), end: parseHoldingDate(registration?.['종료날짜'] || registration?.['종료일'] || registration?.endDate) }))
        .filter(item => item.start && item.end);
    const last = registrations.sort((a, b) => b.end - a.end)[0];
    const result = new Map();
    if (!last) return result;
    const schedule = holdingSchedule(last.registration);
    const weeklyFrequency = Number.parseInt(last.registration['주횟수'], 10) || 2;
    if (schedule.length === 0 || weeklyFrequency < 2) return result;
    const active = makeups.filter(item => !item.status || ['active', 'completed'].includes(item.status));
    const anchor = new Date(last.end);
    for (const item of active) {
        const day = parseHoldingDate(item.makeupClass?.date);
        if (day && day > anchor) anchor.setTime(day.getTime());
    }
    const cursor = new Date(anchor);
    for (let guard = 0; guard < 60 && result.size < weeklyFrequency - 1; guard++) {
        cursor.setDate(cursor.getDate() + 1);
        const slot = schedule.find(item => item.day === ['일', '월', '화', '수', '목', '금', '토'][cursor.getDay()]);
        if (!slot || isOffDay(cursor)) continue;
        result.set(holdingDateISO(cursor), { ...last, schedule, weeklyFrequency, period: slot.period, makeup: null, extension: true });
    }
    return result;
};
