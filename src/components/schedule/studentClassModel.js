import { DAYS, PERIODS } from '../../data/mockData';

export const CLASS_LABELS = { regular: '정규 수업', makeup: '보강', holding: '홀딩', absence: '결석', moved: '보강이동', holiday: '휴일', disabled: '수업 없음', freeWorkoutAttendance: '출석' };

// 정규 시간표의 경과와 실제 출석 기록을 구분한다.
export function classStatusLabel(session, now = new Date()) {
    if (session.type === 'regular') return classStartMs(session) < now.getTime() ? '지난 수업' : '출석 예정';
    const destination = session.makeup?.makeupClass;
    const isMakeupDestination = destination?.date === session.date && Number(destination?.period) === Number(session.period);
    if (isMakeupDestination && session.type === 'holding') return '보강홀딩';
    if (isMakeupDestination && session.type === 'absence') return '보강결석';
    return CLASS_LABELS[session.type];
}

export function studentDateISO(value) {
    const digits = String(value ?? '').replace(/\D/g, '');
    if (!/^\d{6}$|^\d{8}$/.test(digits)) return '';
    const full = digits.length === 6 ? `20${digits}` : digits;
    const year = Number(full.slice(0, 4)), month = Number(full.slice(4, 6)), day = Number(full.slice(6, 8));
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return '';
    return `${full.slice(0, 4)}-${full.slice(4, 6)}-${full.slice(6, 8)}`;
}

function iso(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function field(record, name) {
    const key = Object.keys(record || {}).find(item => item.replace(/\s/g, '') === name.replace(/\s/g, ''));
    return key ? record[key] : '';
}

function agreedAbsenceOn(registration, date) {
    const notes = String(field(registration, '특이사항') || '');
    return [...notes.matchAll(/((?:\d{2}\.\d{1,2}\.\d{1,2}(?:\s*,\s*)?)+)\s*결석/g)]
        .some(match => match[1].split(',').some(value => {
            const [year, month, day] = value.trim().split('.');
            return `20${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` === date;
        }));
}

export function studentWeekDays(weekDates, offset = 0, now = new Date()) {
    // M/D 값의 연도는 가장 가까운 실제 날짜로 복원한다(연말/연초 주 대응).
    const [month, day] = String(weekDates?.['월'] || '').split('/').map(Number);
    let monday;
    if (month && day) {
        monday = [-1, 0, 1].map(delta => new Date(now.getFullYear() + delta, month - 1, day))
            .sort((a, b) => Math.abs(a - now) - Math.abs(b - now))[0];
    } else {
        monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        monday.setDate(monday.getDate() + (monday.getDay() === 0 ? 1 : 1 - monday.getDay()));
    }
    return DAYS.map((dayName, index) => {
        const date = new Date(monday);
        date.setDate(date.getDate() + offset * 7 + index);
        return { day: dayName, date: iso(date), dateNumber: date.getDate() };
    });
}

export function classStartMs(session) {
    const period = PERIODS.find(item => item.id === Number(session?.period));
    if (!period || !studentDateISO(session?.date)) return NaN;
    const date = new Date(`${session.date}T00:00:00`);
    date.setHours(period.startHour, period.startMinute, 0, 0);
    return date.getTime();
}

export function classTime(session) {
    return PERIODS.find(item => item.id === Number(session?.period))?.time.split(' ~ ')[0] || '';
}

export function classLabel(session) {
    if (!session) return '';
    return `${Number(session.date.slice(5, 7))}/${Number(session.date.slice(8))}(${session.day}) ${classTime(session)}`;
}

export function isHeldOn(date, holdings = [], studentName) {
    return holdings.some(item => (!item.studentName || item.studentName === studentName) && item.status !== 'cancelled' &&
        (item.holdingDates?.length ? item.holdingDates.includes(date) : item.startDate <= date && item.endDate >= date));
}

export function buildStudentWeek({ days, studentData, studentName, makeups = [], holdings = [], absences = [], holidays = [], freeWorkoutByDate = {}, isClassDisabled = () => false }) {
    if (!studentData) return [];
    const registrations = [studentData?._prevRegistration, studentData, studentData?._nextRegistration].filter(Boolean);
    const moves = makeups.filter(item => ['active', 'completed'].includes(item.status) && (!item.studentName || item.studentName === studentName));
    const sessions = new Map();
    const holidayOn = date => holidays.find(item => item.date === date);
    const absenceOn = date => absences.some(item => item.status !== 'cancelled' && item.date === date && (!item.studentName || item.studentName === studentName)) || registrations.some(registration => agreedAbsenceOn(registration, date));
    const makeSession = (slot, extra) => ({ ...slot, period: Number(slot.period), periodName: PERIODS.find(item => item.id === Number(slot.period))?.name || '', ...extra });

    for (const { date, day } of days) {
        for (const registration of registrations) {
            const start = studentDateISO(field(registration, '시작날짜'));
            const end = studentDateISO(field(registration, '종료날짜') || field(registration, '종료일') || registration.endDate);
            if (!start || !end || date < start || date > end) continue;
            const slots = [...String(field(registration, '요일 및 시간') || '').replace(/\s/g, '').matchAll(/([월화수목금])([1-6])/g)];
            for (const [, slotDay, periodText] of slots) {
                const period = Number(periodText);
                if (slotDay !== day || PERIODS.find(item => item.id === period)?.type === 'free') continue;
                const slot = { date, day, period };
                const move = moves.find(item => item.originalClass?.date === date && Number(item.originalClass?.period) === period);
                const held = isHeldOn(date, holdings, studentName);
                // 보강 목적지가 홀딩이면 원래 정규 수업은 복귀한다(기존 시간표 규칙).
                const moved = move && !isHeldOn(move.makeupClass?.date, holdings, studentName);
                const holiday = holidayOn(date);
                const type = held ? 'holding' : moved ? 'moved' : holiday ? 'holiday' : absenceOn(date) ? 'absence' : isClassDisabled(day, period) ? 'disabled' : 'regular';
                sessions.set(`${date}-${period}`, makeSession(slot, { type, origin: slot, makeup: move, reason: holiday?.reason || '' }));
            }
        }
    }
    for (const move of moves) {
        const slot = move.makeupClass;
        if (!slot || !days.some(item => item.date === slot.date)) continue;
        const holiday = holidayOn(slot.date);
        const type = holiday ? 'holiday' : isHeldOn(slot.date, holdings, studentName) ? 'holding' : absenceOn(slot.date) ? 'absence' : 'makeup';
        sessions.set(`${slot.date}-${slot.period}`, makeSession(slot, { type, origin: move.originalClass, makeup: move, reason: holiday?.reason || '' }));
    }
    const freePeriod = PERIODS.find(period => period.type === 'free');
    for (const { date, day } of days) {
        // 고정 명단(roster)은 참석 예정이며 실제 출석이 아니다.
        if (freePeriod && freeWorkoutByDate[date]?.some(entry => !entry.roster && entry.studentName === studentName)) {
            sessions.set(`${date}-${freePeriod.id}`, makeSession({ date, day, period: freePeriod.id }, { type: 'freeWorkoutAttendance' }));
        }
    }
    return [...sessions.values()].sort((a, b) => classStartMs(a) - classStartMs(b));
}

export function nextStudentClass(sessions, now = new Date()) {
    return sessions.find(item => ['regular', 'makeup'].includes(item.type) && classStartMs(item) >= now.getTime()) || null;
}

export function sourceUnavailableReason(session, { now = new Date(), quotaUsed = 0, quotaLimit = Infinity, waits = [] } = {}) {
    if (!['regular', 'holiday'].includes(session?.type)) return '이미 변경되었거나 쉬는 수업이에요.';
    if (session.makeup && ['active', 'completed'].includes(session.makeup.status)) return '이미 보강 신청 내역이 있는 수업이에요.';
    if (classStartMs(session) - now.getTime() <= 120 * 60 * 1000) return '원래 수업 시작 2시간 전까지 신청할 수 있어요.';
    if (waits.some(item => ['waiting', 'notified'].includes(item.status) && item.originalClass?.date === session.date && Number(item.originalClass?.period) === Number(session.period))) return '이 수업은 보강 대기 중이에요.';
    if (quotaUsed >= quotaLimit) return '이번 주 보강·대기 한도를 모두 사용했어요.';
    return '';
}
