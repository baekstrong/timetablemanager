import { useMemo } from 'react';
import { useWeeklyData } from '../../hooks/useWeeklyData';
import {
    getStudentField,
    parseHoldingStatus,
    parseSheetDate as parseSheetDateSvc,
} from '../../services/googleSheetsService';
import {
    parseScheduleString,
    parseSheetDate,
    parseAgreedAbsenceDates,
    formatDateISO,
    weekDateToISO,
    transformGoogleSheetsData,
    getScheduleSortKey,
} from '../../utils/scheduleUtils';
import { MOCK_DATA, MAX_CAPACITY, KOREAN_HOLIDAYS } from '../../data/mockData';

/**
 * 코치/학생 시간표 양쪽이 쓰는 파생 데이터와 헬퍼를 한 훅으로 집중.
 * useWeeklyData(주간 Firebase 데이터)를 내부에서 래핑하여 함께 노출한다.
 */
export function useScheduleCore({
    user,
    students,
    mode,
    studentData,
    refresh,
    pendingRegistrations = [],
}) {
    const weeklyData = useWeeklyData({ user, students, mode, refresh });
    const { weekMakeupRequests, weekHoldings, weekAbsences, weekHolidays } = weeklyData;

    // ── Student holding period (from Sheets N/O columns) ──
    const studentHoldingRange = useMemo(() => {
        if (!studentData) return null;
        const holdingStatus = getStudentField(studentData, '홀딩 사용여부');
        const holdingInfo = parseHoldingStatus(holdingStatus);
        if (!holdingInfo.isCurrentlyUsed) return null;
        const startStr = getStudentField(studentData, '홀딩 시작일');
        const endStr = getStudentField(studentData, '홀딩 종료일');
        if (!startStr || !endStr) return null;
        const start = parseSheetDateSvc(startStr);
        const end = parseSheetDateSvc(endStr);
        if (!start || !end) return null;
        return { start: formatDateISO(start), end: formatDateISO(end) };
    }, [studentData]);

    // 홀딩 날짜 체크: holdingDates 배열이 있으면 개별 날짜 비교, 없으면 범위 폴백
    const isDateHeld = (holding, date) => {
        if (holding.holdingDates && holding.holdingDates.length > 0) {
            return holding.holdingDates.includes(date);
        }
        return holding.startDate <= date && holding.endDate >= date;
    };

    // 보강 목적지가 본인(학생) 홀딩 기간 내인지 판정
    const isMakeupHeld = (makeup) => {
        const makeupDate = makeup.makeupClass?.date;
        if (!makeupDate) return false;
        const myHolding = weekHoldings.find(h => h.studentName === user?.username);
        if (myHolding) return isDateHeld(myHolding, makeupDate);
        if (!studentHoldingRange) return false;
        return makeupDate >= studentHoldingRange.start && makeupDate <= studentHoldingRange.end;
    };

    const studentSchedule = useMemo(() => {
        if (!studentData) return [];
        const scheduleStr = getStudentField(studentData, '요일 및 시간');
        return parseScheduleString(scheduleStr);
    }, [studentData]);

    const scheduleData = useMemo(() => {
        if (!students || students.length === 0) return MOCK_DATA;
        return transformGoogleSheetsData(students);
    }, [students]);

    // Week dates (Mon-Fri) as { '월': 'M/D', ... }
    const weekDates = useMemo(() => {
        const today = new Date();
        const dayOfWeek = today.getDay();
        const monday = new Date(today);
        const diff = dayOfWeek === 0 ? 1 : 1 - dayOfWeek;
        monday.setDate(today.getDate() + diff);

        const dates = {};
        const dayNames = ['월', '화', '수', '목', '금'];
        dayNames.forEach((dayName, index) => {
            const date = new Date(monday);
            date.setDate(monday.getDate() + index);
            dates[dayName] = `${date.getMonth() + 1}/${date.getDate()}`;
        });
        return dates;
    }, []);

    // ── Effective end date (considering makeup requests) ──
    function getEffectiveEndDate(student, endDate) {
        if (!endDate || !weekMakeupRequests || weekMakeupRequests.length === 0) return endDate;
        const name = student['이름'];
        if (!name) return endDate;

        const endDateStr = formatDateISO(endDate);
        const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
        const scheduleStr = student['요일 및 시간'] || '';
        const scheduleDays = parseScheduleString(scheduleStr).map(p => p.day);

        // 종료일 당일 수업을 종료일 이후로 보강 이동한 경우 (예: 마지막 월 수업을 다음 목으로)
        // → 종료일 다음의 첫 정규 수업일이 새 "마지막 정규 수업일". 보강일은 보강 attendance로만 취급.
        const makeupFromEndToFuture = weekMakeupRequests.find(m =>
            m.studentName === name &&
            m.originalClass.date === endDateStr &&
            m.makeupClass.date > endDateStr &&
            (m.status === 'active' || m.status === 'completed')
        );
        if (makeupFromEndToFuture && scheduleDays.length > 0) {
            const checkDate = new Date(endDate);
            for (let i = 0; i < 14; i++) {
                checkDate.setDate(checkDate.getDate() + 1);
                const dayName = dayNames[checkDate.getDay()];
                if (scheduleDays.includes(dayName)) {
                    return new Date(checkDate);
                }
            }
        }

        // 종료일 이후로 보강이 잡힌 경우 찾기 (원래 수업이 종료일 이전이어도)
        const makeupsAfterEnd = weekMakeupRequests.filter(m =>
            m.studentName === name &&
            (m.status === 'active' || m.status === 'completed') &&
            m.makeupClass.date > endDateStr
        );

        // 종료일 당일 수업을 보강으로 옮긴 경우
        const makeupFromEndDate = weekMakeupRequests.find(m =>
            m.studentName === name &&
            m.originalClass.date === endDateStr &&
            (m.status === 'active' || m.status === 'completed')
        );

        // 종료일 이후 보강이 있으면, 가장 늦은 보강일을 effective end로
        if (makeupsAfterEnd.length > 0) {
            let latestDate = new Date(endDate);
            for (const m of makeupsAfterEnd) {
                const makeupDate = new Date(m.makeupClass.date + 'T00:00:00');
                if (makeupDate > latestDate) latestDate = makeupDate;
            }
            return latestDate;
        }

        // 종료일 당일 수업만 옮긴 경우 (보강일이 종료일 이전)
        if (makeupFromEndDate) {
            const makeupDate = new Date(makeupFromEndDate.makeupClass.date + 'T00:00:00');

            // 종료일 이전에 남아있는 마지막 정규 수업일 찾기
            const schedule = student['요일 및 시간'] || '';
            const parsed = parseScheduleString(schedule);
            const scheduleDays = parsed.map(p => p.day);
            const dayNames = ['일', '월', '화', '수', '목', '금', '토'];

            let lastRegularDate = null;
            const checkDate = new Date(endDate);
            for (let i = 0; i < 7; i++) {
                checkDate.setDate(checkDate.getDate() - 1);
                const dayName = dayNames[checkDate.getDay()];
                if (scheduleDays.includes(dayName)) {
                    lastRegularDate = new Date(checkDate);
                    break;
                }
            }

            // 보강일 vs 마지막 정규수업일 중 더 늦은 날짜 반환
            if (lastRegularDate && lastRegularDate > makeupDate) {
                return lastRegularDate;
            }
            return makeupDate;
        }
        return endDate;
    }

    // ── Coach banners: last day students & delayed re-registration ──
    const lastDayStudents = useMemo(() => {
        if (user?.role !== 'coach' || !students || students.length === 0) return [];
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayDayNames = ['일', '월', '화', '수', '목', '금', '토'];
        const todayDay = todayDayNames[today.getDay()];
        const todayStr = formatDateISO(today);

        return students.filter(student => {
            const endDateStr = student['종료날짜'];
            if (!endDateStr) return false;
            const endDate = parseSheetDate(endDateStr);
            if (!endDate) return false;
            endDate.setHours(0, 0, 0, 0);
            const effectiveEnd = getEffectiveEndDate(student, endDate);
            effectiveEnd.setHours(0, 0, 0, 0);

            if (effectiveEnd.getTime() === today.getTime()) return true;

            if (endDate.getTime() <= today.getTime() && effectiveEnd.getTime() > today.getTime()) {
                const schedule = student['요일 및 시간'] || '';
                const parsed = parseScheduleString(schedule);
                const scheduleDays = parsed.map(p => p.day);

                if (!scheduleDays.includes(todayDay)) return false;

                const name = student['이름'];
                const hasMakeupFromToday = weekMakeupRequests && weekMakeupRequests.some(m =>
                    m.studentName === name &&
                    m.originalClass.date === todayStr &&
                    (m.status === 'active' || m.status === 'completed')
                );
                if (hasMakeupFromToday) return false;

                const dayNamesArr = ['일', '월', '화', '수', '목', '금', '토'];
                const checkDate = new Date(today);
                for (let i = 0; i < 7; i++) {
                    checkDate.setDate(checkDate.getDate() + 1);
                    if (checkDate.getTime() > effectiveEnd.getTime()) break;
                    const checkDateStr = formatDateISO(checkDate);
                    const dayName = dayNamesArr[checkDate.getDay()];

                    const hasRegularClass = scheduleDays.includes(dayName) &&
                        !(weekMakeupRequests && weekMakeupRequests.some(m =>
                            m.studentName === name &&
                            m.originalClass.date === checkDateStr &&
                            (m.status === 'active' || m.status === 'completed')
                        ));
                    if (hasRegularClass) return false;

                    const hasMakeupClass = weekMakeupRequests && weekMakeupRequests.some(m =>
                        m.studentName === name &&
                        m.makeupClass.date === checkDateStr &&
                        (m.status === 'active' || m.status === 'completed')
                    );
                    if (hasMakeupClass) return false;
                }
                return true;
            }

            return false;
        }).map(s => {
            const name = s['이름'];
            if (!name) return null;
            const schedule = s['요일 및 시간'] || '';
            const payment = s['결제금액'] || s['결제\n금액'] || '';

            const makeupToday = weekMakeupRequests && weekMakeupRequests.find(m =>
                m.studentName === name &&
                m.makeupClass.date === todayStr &&
                (m.status === 'active' || m.status === 'completed')
            );

            let todayPeriod;
            if (makeupToday) {
                todayPeriod = makeupToday.makeupClass.period;
            } else {
                const parsed = parseScheduleString(schedule);
                const todayClass = parsed.find(p => p.day === todayDay);
                todayPeriod = todayClass ? todayClass.period : 999;
            }
            return { name, schedule, payment, todayPeriod };
        }).filter(Boolean).sort((a, b) => a.todayPeriod - b.todayPeriod);
    }, [user, students, weekMakeupRequests]);

    const delayedReregistrationStudents = useMemo(() => {
        if (user?.role !== 'coach' || !students || students.length === 0) return [];
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const latestByName = {};
        students.forEach(student => {
            const name = student['이름'];
            if (!name) return;
            const endDateStr = student['종료날짜'];
            if (!endDateStr) return;
            const endDate = parseSheetDate(endDateStr);
            if (!endDate) return;
            if (!latestByName[name] || endDate > latestByName[name].endDate) {
                latestByName[name] = { student, endDate };
            }
        });

        return Object.values(latestByName).filter(({ student, endDate }) => {
            const ed = new Date(endDate);
            ed.setHours(0, 0, 0, 0);
            const effectiveEnd = getEffectiveEndDate(student, ed);
            effectiveEnd.setHours(0, 0, 0, 0);
            if (effectiveEnd >= today) return false;
            const schedule = student['요일 및 시간'];
            return schedule && schedule.trim();
        }).map(({ student, endDate }) => {
            const name = student['이름'];
            const schedule = student['요일 및 시간'] || '';
            const payment = student['결제금액'] || student['결제\n금액'] || '';
            const endDateFormatted = `${endDate.getMonth() + 1}/${endDate.getDate()}`;
            return { name, schedule, payment, endDate: endDateFormatted };
        }).sort((a, b) => getScheduleSortKey(a.schedule) - getScheduleSortKey(b.schedule));
    }, [user, students, weekMakeupRequests]);

    // ── Cell data computation ──
    function getCellData(day, periodObj) {
        const regularClass = scheduleData.regularEnrollments.find(
            e => e.day === day && e.period === periodObj.id
        );
        const studentNames = regularClass ? [...regularClass.names] : [];

        const subs = scheduleData.substitutes.filter(
            s => s.day === day && s.period === periodObj.id
        );

        let makeupStudents = [];
        let makeupHeldStudents = [];
        let makeupAbsentOnMakeupSlot = [];
        let makeupMovedStudents = [];
        let absenceStudents = [];
        let agreedAbsenceStudents = [];
        let holdingStudents = [];
        let delayedStartStudents = [];
        let newStudents = [];

        const dateStr = weekDates[day];
        if (dateStr) {
            const slotDate = weekDateToISO(dateStr);

            // 보강 목적지 슬롯: 결석/홀딩 여부에 따라 분류
            const makeupRequestsForSlot = weekMakeupRequests.filter(m =>
                m.makeupClass.day === day &&
                m.makeupClass.period === periodObj.id &&
                m.makeupClass.date === slotDate
            );
            for (const m of makeupRequestsForSlot) {
                const name = m.studentName;
                const isAbsent = weekAbsences.some(a =>
                    a.studentName === name && a.date === slotDate
                );
                if (isAbsent) {
                    makeupAbsentOnMakeupSlot.push(name);
                    continue;
                }
                const isHeld = weekHoldings.some(h =>
                    h.studentName === name && isDateHeld(h, slotDate)
                );
                if (isHeld) {
                    makeupHeldStudents.push(name);
                } else {
                    makeupStudents.push(name);
                }
            }

            // 보강 원래 자리: 다른 시간으로 이동한 학생 (보강이동 표시)
            makeupMovedStudents = weekMakeupRequests
                .filter(m =>
                    m.originalClass.day === day &&
                    m.originalClass.period === periodObj.id &&
                    m.originalClass.date === slotDate
                )
                .map(m => m.studentName);

            holdingStudents = weekHoldings
                .filter(h => isDateHeld(h, slotDate))
                .map(h => h.studentName)
                .filter(name => studentNames.includes(name));

            const slotDateObj = new Date(slotDate + 'T00:00:00');
            const delayedStudentsRaw = students.filter(s => {
                const name = s['이름'];
                if (!name || !studentNames.includes(name)) return false;
                if (holdingStudents.includes(name)) return false;
                const startDateStr = s['시작날짜'];
                if (!startDateStr) return false;
                const startDate = parseSheetDate(startDateStr);
                if (!startDate || startDate <= slotDateObj) return false;
                const hasActiveEnrollment = students.some(other => {
                    if (other === s || other['이름'] !== name) return false;
                    const endDateStr = other['종료날짜'];
                    if (!endDateStr) return false;
                    const endDate = parseSheetDate(endDateStr);
                    return endDate && endDate >= slotDateObj;
                });
                if (hasActiveEnrollment) return false;
                const prevEndDateStr = s._prevEndDate;
                if (prevEndDateStr) {
                    const prevEndDate = parseSheetDate(prevEndDateStr);
                    if (prevEndDate && prevEndDate >= slotDateObj) return false;
                }
                return true;
            });

            newStudents = delayedStudentsRaw
                .filter(s => getStudentField(s, '신규/재등록') === '신규')
                .map(s => s['이름']);
            delayedStartStudents = delayedStudentsRaw
                .filter(s => getStudentField(s, '신규/재등록') !== '신규')
                .map(s => s['이름']);

            absenceStudents = weekAbsences
                .filter(a => a.date === slotDate && studentNames.includes(a.studentName))
                .map(a => a.studentName)
                .filter(name => !makeupMovedStudents.includes(name));

            agreedAbsenceStudents = students
                .filter(s => {
                    const name = s['이름'];
                    if (!name || !studentNames.includes(name)) return false;
                    if (makeupMovedStudents.includes(name) || absenceStudents.includes(name)) return false;
                    const notes = s['특이사항'] || getStudentField(s, '특이사항') || '';
                    return parseAgreedAbsenceDates(notes).includes(slotDate);
                })
                .map(s => s['이름']);
        }

        const allAbsentStudents = [...new Set([...makeupMovedStudents, ...absenceStudents, ...agreedAbsenceStudents])];
        const activeStudents = studentNames.filter(name =>
            !allAbsentStudents.includes(name) &&
            !holdingStudents.includes(name) &&
            !delayedStartStudents.includes(name) &&
            !newStudents.includes(name)
        );

        const regularStudentsPresent = studentNames.filter(name =>
            !holdingStudents.includes(name) &&
            !delayedStartStudents.includes(name) &&
            !newStudents.includes(name)
        );

        let currentCount, availableSeats, isFull;
        let pendingNames = [];

        if (mode === 'student' && user?.role === 'coach') {
            // Coach "신규 전용" mode: registered + pending
            const pendingForSlot = pendingRegistrations.filter(reg =>
                reg.requestedSlots?.some(s => s.day === day && s.period === periodObj.id)
            );
            pendingNames = pendingForSlot.map(reg => reg.name);
            currentCount = studentNames.length + pendingForSlot.length;
            availableSeats = Math.max(0, MAX_CAPACITY - currentCount);
            isFull = availableSeats === 0;
        } else {
            currentCount = activeStudents.length + subs.length + makeupStudents.length;
            availableSeats = Math.max(0, MAX_CAPACITY - currentCount);
            isFull = availableSeats === 0;
        }

        return {
            studentNames,
            subs,
            currentCount,
            availableSeats,
            isFull,
            activeStudents,
            makeupStudents,
            makeupHeldStudents,
            makeupAbsentOnMakeupSlot,
            makeupMovedStudents,
            absenceStudents,
            agreedAbsenceStudents,
            holdingStudents,
            delayedStartStudents,
            newStudents,
            pendingNames,
            regularStudentsPresent,
        };
    }

    // ── Holiday detection for a slot ──
    function getHolidayInfo(day) {
        if (!weekDates[day]) return null;
        const slotDateStr = weekDateToISO(weekDates[day]);

        const firebaseMatch = weekHolidays.find(h => h.date === slotDateStr);
        if (firebaseMatch) return firebaseMatch.reason || '';

        if (KOREAN_HOLIDAYS[slotDateStr]) return KOREAN_HOLIDAYS[slotDateStr];
        return null;
    }

    return {
        ...weeklyData,
        studentHoldingRange,
        studentSchedule,
        scheduleData,
        weekDates,
        isDateHeld,
        isMakeupHeld,
        getEffectiveEndDate,
        lastDayStudents,
        delayedReregistrationStudents,
        getCellData,
        getHolidayInfo,
    };
}
