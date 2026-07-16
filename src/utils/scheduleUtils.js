import { PERIODS } from '../data/mockData';
import { getStudentField, parseHoldingStatus } from '../services/googleSheetsService';

/**
 * Parse schedule string from Google Sheets.
 * Examples: "월5수5" -> [{day: '월', period: 5}, {day: '수', period: 5}]
 */
export function parseScheduleString(scheduleStr) {
    if (!scheduleStr || typeof scheduleStr !== 'string') return [];

    const result = [];
    const validDays = new Set(['월', '화', '수', '목', '금', '토', '일']);
    const chars = scheduleStr.replace(/\s/g, '');

    let i = 0;
    while (i < chars.length) {
        const char = chars[i];
        if (validDays.has(char)) {
            const day = char;
            i++;
            let periodStr = '';
            while (i < chars.length && /\d/.test(chars[i])) {
                periodStr += chars[i];
                i++;
            }
            if (periodStr) {
                const period = parseInt(periodStr);
                if (period >= 1 && period <= 6) {
                    result.push({ day, period });
                }
            }
        } else {
            i++;
        }
    }

    return result;
}

/**
 * Parse date string from Google Sheets (YYMMDD format).
 * Example: "260111" -> Date(2026, 0, 11)
 */
export function parseSheetDate(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return null;

    const cleaned = dateStr.replace(/\D/g, '');
    if (cleaned.length !== 6) return null;

    const year = parseInt('20' + cleaned.substring(0, 2));
    const month = parseInt(cleaned.substring(2, 4)) - 1;
    const day = parseInt(cleaned.substring(4, 6));

    return new Date(year, month, day);
}

/**
 * Parse 특이사항 field to extract agreed absence dates.
 * Format: "26.2.10, 26.2.12 결석" -> ["2026-02-10", "2026-02-12"]
 */
export function parseAgreedAbsenceDates(notesStr) {
    if (!notesStr || typeof notesStr !== 'string') return [];

    const absencePattern = /((?:\d{2}\.\d{1,2}\.\d{1,2}(?:\s*,\s*)?)+)\s*결석/g;
    const dates = [];

    let match;
    while ((match = absencePattern.exec(notesStr)) !== null) {
        const dateStrings = match[1].split(',').map(s => s.trim()).filter(Boolean);
        for (const dateStr of dateStrings) {
            const parts = dateStr.split('.');
            if (parts.length === 3) {
                const year = 2000 + parseInt(parts[0]);
                const month = parseInt(parts[1]);
                const day = parseInt(parts[2]);
                if (!isNaN(year) && !isNaN(month) && !isNaN(day)) {
                    dates.push(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
                }
            }
        }
    }

    return dates;
}

/** Format a Date object as "YYYY-MM-DD". */
export function formatDateISO(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/** Convert "M/D" weekDate string to "YYYY-MM-DD" using current year. */
export function weekDateToISO(mmdd) {
    if (!mmdd) return '';
    const [month, dayNum] = mmdd.split('/');
    const year = new Date().getFullYear();
    return `${year}-${month.padStart(2, '0')}-${dayNum.padStart(2, '0')}`;
}

/**
 * Get the datetime for a class period on a given date.
 * Returns null if periodId is not found.
 */
export function getClassDateTime(dateStr, periodId) {
    const periodInfo = PERIODS.find(p => p.id === periodId);
    if (!periodInfo) return null;
    const classDate = new Date(dateStr + 'T00:00:00');
    classDate.setHours(periodInfo.startHour, periodInfo.startMinute, 0, 0);
    return classDate;
}

/** Check if a class has started or is within `minutesBefore` minutes of starting. */
export function isClassWithinMinutes(dateStr, periodId, minutesBefore) {
    const classDateTime = getClassDateTime(dateStr, periodId);
    if (!classDateTime) return false;
    const threshold = new Date(classDateTime.getTime() - minutesBefore * 60 * 1000);
    return new Date() >= threshold;
}

/** Check if student is currently on hold based on Sheets data. */
export function isCurrentlyOnHold(student) {
    const holdingStatus = getStudentField(student, '홀딩 사용여부');
    const holdingInfo = parseHoldingStatus(holdingStatus);
    if (!holdingInfo.isCurrentlyUsed) return false;

    const startDateStr = getStudentField(student, '홀딩 시작일');
    const endDateStr = getStudentField(student, '홀딩 종료일');
    if (!startDateStr || !endDateStr) return true;

    const startDate = parseSheetDate(startDateStr);
    const endDate = parseSheetDate(endDateStr);
    if (!startDate || !endDate) return true;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today >= startDate && today <= endDate;
}

/** Check if student has a valid schedule string (= currently enrolled). */
export function isCurrentlyEnrolled(student) {
    return !!student['요일 및 시간'];
}

/** Transform Google Sheets student data into timetable format. */
export function transformGoogleSheetsData(students) {
    const regularEnrollments = [];
    const holds = [];

    const enrolledStudents = students.filter(isCurrentlyEnrolled);

    enrolledStudents.forEach((student) => {
        const name = student['이름'];
        const scheduleStr = student['요일 및 시간'];
        const isHolding = isCurrentlyOnHold(student);

        if (!name || !scheduleStr) return;

        const schedules = parseScheduleString(scheduleStr);
        schedules.forEach(({ day, period }) => {
            const existing = regularEnrollments.find(
                e => e.day === day && e.period === period
            );
            if (existing) {
                if (!existing.names.includes(name)) {
                    existing.names.push(name);
                }
            } else {
                regularEnrollments.push({ day, period, names: [name] });
            }

            if (isHolding) {
                holds.push({ day, period, name });
            }
        });
    });

    return { regularEnrollments, holds, substitutes: [] };
}

/** Get schedule sort key for ordering by first class day+period. */
export function getScheduleSortKey(scheduleStr) {
    if (!scheduleStr) return 999;
    const parsed = parseScheduleString(scheduleStr);
    if (parsed.length === 0) return 999;
    const dayOrder = { '월': 0, '화': 1, '수': 2, '목': 3, '금': 4, '토': 5, '일': 6 };
    const first = parsed[0];
    return (dayOrder[first.day] || 0) * 10 + first.period;
}

/**
 * 코치 시간표 '재등록X'(재등록 지연) 배지 판정 — 순수 함수.
 * effectiveEnd: 보강 반영 마지막 실제 수업일(자정 정규화 Date). today: 오늘(자정 정규화 Date).
 * 이미 다음(미리) 등록이 있으면(=재등록 완료) 지연으로 보지 않는다.
 * 보강으로 마지막 수업을 종료일보다 앞당기면 effectiveEnd < 종료날짜라 지연 오탐이 나던 버그 방지.
 */
export function isDelayedReregistration({ effectiveEnd, today, schedule, hasNextRegistration }) {
    if (hasNextRegistration) return false;
    if (effectiveEnd >= today) return false;
    return !!(schedule && schedule.trim());
}

/** Get Monday~Sunday date range for the current week. */
export function getThisWeekRange() {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const monday = new Date(today);
    // 일요일(0)에는 다음 월요일 기준 (시간표 표시와 동일하게)
    const diff = dayOfWeek === 0 ? 1 : 1 - dayOfWeek;
    monday.setDate(today.getDate() + diff);
    monday.setHours(0, 0, 0, 0);
    const friday = new Date(monday);
    friday.setDate(monday.getDate() + 4);
    return { start: formatDateISO(monday), end: formatDateISO(friday) };
}

/**
 * Build a new schedule string by replacing one slot with another.
 * Returns the sorted schedule string (e.g. "화5금5").
 */
export function buildUpdatedSchedule(currentSchedule, fromSlot, toSlot) {
    const parsed = parseScheduleString(currentSchedule);
    const updated = parsed.map(s => {
        if (s.day === fromSlot.day && s.period === fromSlot.period) {
            return { day: toSlot.day, period: toSlot.period };
        }
        return s;
    });
    const dayOrder = { '월': 0, '화': 1, '수': 2, '목': 3, '금': 4, '토': 5, '일': 6 };
    updated.sort((a, b) => (dayOrder[a.day] || 0) - (dayOrder[b.day] || 0) || a.period - b.period);
    return updated.map(s => `${s.day}${s.period}`).join('');
}

/**
 * Count waitlist entries for a given slot (existing + new student waitlist combined).
 */
export function getWaitlistCountForSlot(day, periodId, weekWaitlist, newStudentWaitlist) {
    const existingCount = weekWaitlist.filter(w =>
        w.desiredSlot.day === day && w.desiredSlot.period === periodId
    ).length;
    const newCount = newStudentWaitlist.filter(r => {
        const slots = r.requestedSlots || [];
        if (slots.length > 0) return slots.some(s => s.day === day && s.period === periodId);
        const parsed = (r.scheduleString || '').match(/([월화수목금])(\d)/g);
        return parsed ? parsed.some(m => m[0] === day && parseInt(m[1]) === periodId) : false;
    }).length;
    return existingCount + newCount;
}

/**
 * 보강/대기 신청 시 대상 요일이 '이중 수강'이 되는지 판정(true면 차단).
 * - 같은 날 안에서 시간만 옮기면(목4→목1) 그 날 수강 수가 늘지 않으므로 허용(false).
 * - 다른 날 수업을 그 요일로 옮기는데(월4→목1) 대상 요일에 아직 출석하는 정규 수업(목4)이
 *   남아 있으면 이중 수강이 되므로 차단(true).
 * 이미 다른 보강으로 그 날 자리를 비운 정규 수업은 '남은 것'으로 치지 않는다(재신청 허용).
 * @param {{day:string,period:number}[]} studentSchedule - 원래 시간표(요일 및 시간 파싱 결과)
 * @param {{originalClass:{day:string,period:number,date:string}}[]} activeMakeupRequests - 이번 주 활성 보강(취소 제외)
 * @param {{day:string,period:number}} originalClass - 이번에 옮기는 원래 수업
 * @param {string} targetDay - 보강 대상 요일
 * @param {string} targetDate - 보강 대상 날짜(YYYY-MM-DD)
 */
export function wouldDoubleBookDay(studentSchedule, activeMakeupRequests, originalClass, targetDay, targetDate) {
    // 같은 날 안에서 시간만 옮기는 경우 — 그 날 수강 수가 늘지 않으므로 허용
    if (originalClass && originalClass.day === targetDay) return false;
    // 다른 날 수업을 옮겨오는 경우 — 대상 요일에 아직 출석하는 정규 수업이 있으면 이중 수강
    return (studentSchedule || []).some(s => {
        if (s.day !== targetDay) return false;
        const movedAway = (activeMakeupRequests || []).some(m =>
            m.originalClass?.day === s.day &&
            m.originalClass?.period === s.period &&
            m.originalClass?.date === targetDate
        );
        return !movedAway;
    });
}

/** 교시 종료 시각(분). time 문자열("19:50 ~ 21:20")의 끝 시간 기준, 파싱 실패 시 시작+90분. */
export function getPeriodEndMinutes(period) {
    const m = (period.time || '').match(/~\s*(\d{1,2}):(\d{2})/);
    if (m) return parseInt(m[1]) * 60 + parseInt(m[2]);
    return period.startHour * 60 + period.startMinute + 90;
}

/** 지금이 수업 시작 30분 전 ~ 종료 시각 사이인지 (오늘 요일 셀 강조용). */
export function isPeriodImminentOrOngoing(period, now = new Date()) {
    const startMin = period.startHour * 60 + period.startMinute;
    const endMin = getPeriodEndMinutes(period);
    const nowMin = now.getHours() * 60 + now.getMinutes();
    return nowMin >= startMin - 30 && nowMin <= endMin;
}
