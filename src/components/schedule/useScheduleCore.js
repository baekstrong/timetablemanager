import { useCallback, useMemo } from 'react';
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
import { getUnpaidStudentNames } from '../../utils/studentList';
import { secondClassDayISO, cappedEndForFirstClassMove } from '../../utils/makeupEndDate';

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

    // 임의 날짜가 본인(학생) 홀딩 기간 내인지 판정
    const isMyHoldingDate = (date) => {
        if (!date) return false;
        const myHolding = weekHoldings.find(h => h.studentName === user?.username);
        if (myHolding) return isDateHeld(myHolding, date);
        if (!studentHoldingRange) return false;
        return date >= studentHoldingRange.start && date <= studentHoldingRange.end;
    };

    // 보강 목적지가 본인(학생) 홀딩 기간 내인지 판정
    const isMakeupHeld = (makeup) => isMyHoldingDate(makeup.makeupClass?.date);

    const studentSchedule = useMemo(() => {
        if (!studentData) return [];
        const scheduleStr = getStudentField(studentData, '요일 및 시간');
        return parseScheduleString(scheduleStr);
    }, [studentData]);

    const scheduleData = useMemo(() => {
        if (!students || students.length === 0) return MOCK_DATA;
        return transformGoogleSheetsData(students);
    }, [students]);

    // 미결제(K열=X) 수강생 이름 집합 — 코치 시간표 배지용
    const unpaidStudentNames = useMemo(() => {
        if (user?.role !== 'coach') return new Set();
        return getUnpaidStudentNames(students || []);
    }, [user, students]);

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
    const getEffectiveEndDate = useCallback((student, endDate) => {
        if (!endDate || !weekMakeupRequests || weekMakeupRequests.length === 0) return endDate;
        const name = student['이름'];
        if (!name) return endDate;

        const endDateStr = formatDateISO(endDate);
        const isActiveOrCompleted = (m) => m.status === 'active' || m.status === 'completed';
        const isMakeupForCurrentMembership = (m) =>
            m.studentName === name &&
            isActiveOrCompleted(m) &&
            m.originalClass?.date &&
            m.originalClass.date <= endDateStr;

        // 종료일 이후 보강 중, 기존 수강 기간 안의 수업을 옮긴 보강만 종료일 연장에 반영한다.
        // 이미 종료된 뒤 남아 있는 정규 시간표에서 신청한 보강은 재등록 지연 판정을 가리면 안 된다.
        const makeupsAfterEnd = weekMakeupRequests.filter(m =>
            isMakeupForCurrentMembership(m) &&
            m.makeupClass?.date > endDateStr
        );

        // 종료일 당일 수업을 보강으로 옮긴 경우
        const makeupFromEndDate = weekMakeupRequests.find(m =>
            isMakeupForCurrentMembership(m) &&
            m.originalClass.date === endDateStr &&
            m.makeupClass?.date
        );

        // 종료일 이후 보강이 있으면, 가장 늦은 보강일을 effective end로
        if (makeupsAfterEnd.length > 0) {
            // 종료일이 그 주 '첫 수업일'인 경우: 그 종료일 수업을 뒤로 옮겨도
            // '두번째 수업일'(그 수업도 보강이면 그 보강일)까지만 인정. (makeupEndDate 규칙)
            const scheduleStr = student['요일 및 시간'] || '';
            const secondScheduledISO = secondClassDayISO(scheduleStr, endDateStr);
            let secondMakeupISO = null;
            if (secondScheduledISO) {
                const secondM = weekMakeupRequests.find(m =>
                    m.studentName === name && isActiveOrCompleted(m) &&
                    m.originalClass?.date === secondScheduledISO
                );
                secondMakeupISO = secondM?.makeupClass?.date || null;
            }

            let latestDate = new Date(endDate);
            for (const m of makeupsAfterEnd) {
                let makeupISO = m.makeupClass.date;
                // 종료일(첫 수업일) 수업을 전진 보강한 건만 두번째 수업일로 캡
                if (secondScheduledISO && m.originalClass.date === endDateStr) {
                    const capped = cappedEndForFirstClassMove({
                        scheduleStr, endDateISO: endDateStr, firstMakeupISO: makeupISO, secondMakeupISO,
                    });
                    if (capped) makeupISO = capped.capISO;
                }
                const makeupDate = new Date(makeupISO + 'T00:00:00');
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
    }, [weekMakeupRequests]);

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
            return effectiveEnd.getTime() === today.getTime();
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
    }, [user, students, weekMakeupRequests, getEffectiveEndDate]);

    // 이름 → 마지막 수업 { 날짜ISO, 교시 }. 셀에서 "(마지막)" 표기용.
    // effectiveEnd(보강 반영 종료일)이 떨어지는 날짜의 교시(보강이면 보강 교시, 아니면 정규 교시).
    const lastClassByName = useMemo(() => {
        const map = new Map();
        if (user?.role !== 'coach' || !students || students.length === 0) return map;
        const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
        students.forEach(student => {
            const name = student['이름'];
            if (!name) return;
            const endDateStr = student['종료날짜'];
            if (!endDateStr) return;
            const endDate = parseSheetDate(endDateStr);
            if (!endDate) return;
            endDate.setHours(0, 0, 0, 0);
            const effectiveEnd = getEffectiveEndDate(student, endDate);
            effectiveEnd.setHours(0, 0, 0, 0);
            const dateISO = formatDateISO(effectiveEnd);

            const makeup = weekMakeupRequests && weekMakeupRequests.find(m =>
                m.studentName === name &&
                m.makeupClass?.date === dateISO &&
                (m.status === 'active' || m.status === 'completed')
            );
            let period;
            if (makeup) {
                period = makeup.makeupClass.period;
            } else {
                const parsed = parseScheduleString(student['요일 및 시간'] || '');
                const cls = parsed.find(p => p.day === dayNames[effectiveEnd.getDay()]);
                period = cls ? cls.period : null;
            }
            if (period == null) return;

            // 같은 이름 여러 등록 → 가장 늦은 마지막 수업만 유지
            const prev = map.get(name);
            if (!prev || dateISO > prev.dateISO) map.set(name, { dateISO, period });
        });
        return map;
    }, [user, students, weekMakeupRequests, getEffectiveEndDate]);

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
    }, [user, students, getEffectiveEndDate]);

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
        isMyHoldingDate,
        isMakeupHeld,
        getEffectiveEndDate,
        lastDayStudents,
        delayedReregistrationStudents,
        lastClassByName,
        getCellData,
        getHolidayInfo,
        unpaidStudentNames,
    };
}
