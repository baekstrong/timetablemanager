import { useState, useEffect } from 'react';
import { getStudentField, parseHoldingStatus } from '../services/googleSheetsService';
import {
    completeMakeupRequest,
    getMakeupRequestsByWeek,
    getAbsencesByDate,
    getHolidays,
    getAllActiveWaitlist,
} from '../services/firebaseService';
import {
    parseSheetDate,
    formatDateISO,
    isClassWithinMinutes,
} from '../utils/scheduleUtils';

/**
 * 주간 Firebase 데이터(보강, 홀딩, 결석, 공휴일, 대기) 로딩 + 자동 리프레시 훅
 */
export function useWeeklyData({ user, students, mode, refresh }) {
    const [weekMakeupRequests, setWeekMakeupRequests] = useState([]);
    const [weekHoldings, setWeekHoldings] = useState([]);
    const [weekAbsences, setWeekAbsences] = useState([]);
    const [weekHolidays, setWeekHolidays] = useState([]);
    const [weekWaitlist, setWeekWaitlist] = useState([]);

    async function loadWeeklyData() {
        try {
            const today = new Date();
            const dayOfWeek = today.getDay();
            const monday = new Date(today);
            const diff = dayOfWeek === 0 ? 1 : 1 - dayOfWeek;
            monday.setDate(today.getDate() + diff);

            const startDate = formatDateISO(monday);
            const nextFriday = new Date(monday);
            nextFriday.setDate(monday.getDate() + 11);
            const endDate = formatDateISO(nextFriday);

            const currentFriday = new Date(monday);
            currentFriday.setDate(monday.getDate() + 4);
            const thisWeekEndDate = formatDateISO(currentFriday);

            // Extract holding data from Google Sheets
            const holdings = [];
            if (students && students.length > 0) {
                students.forEach(student => {
                    const holdingStatus = getStudentField(student, '홀딩 사용여부');
                    const holdingInfo = parseHoldingStatus(holdingStatus);
                    if (!holdingInfo.isCurrentlyUsed) return;

                    const startDateStr = getStudentField(student, '홀딩 시작일');
                    const endDateStr = getStudentField(student, '홀딩 종료일');
                    if (!startDateStr || !endDateStr) return;

                    const holdingStartDate = parseSheetDate(startDateStr);
                    const holdingEndDate = parseSheetDate(endDateStr);
                    if (!holdingStartDate || !holdingEndDate) return;

                    const holdingStartStr = formatDateISO(holdingStartDate);
                    const holdingEndStr = formatDateISO(holdingEndDate);

                    if (holdingEndStr >= startDate && holdingStartStr <= thisWeekEndDate) {
                        holdings.push({
                            studentName: student['이름'],
                            startDate: holdingStartStr,
                            endDate: holdingEndStr
                        });
                    }
                });
            }

            // Firebase calls in parallel
            const dates = [];
            for (let i = 0; i < 5; i++) {
                const date = new Date(monday);
                date.setDate(monday.getDate() + i);
                dates.push(formatDateISO(date));
            }

            const [makeups, absenceArrays, holidays, waitlist] = await Promise.all([
                getMakeupRequestsByWeek(startDate, endDate).catch(() => []),
                Promise.all(dates.map(date => getAbsencesByDate(date).catch(() => []))),
                getHolidays().catch(() => []),
                getAllActiveWaitlist().catch(() => [])
            ]);

            const allAbsences = absenceArrays.flat();

            // Auto-complete passed active makeups
            const passedActiveMakeups = (makeups || []).filter(m =>
                m.status === 'active' && isClassWithinMinutes(m.makeupClass.date, m.makeupClass.period, 0)
            );
            for (const makeup of passedActiveMakeups) {
                try {
                    await completeMakeupRequest(makeup.id);
                    makeup.status = 'completed';
                } catch (err) {
                    console.error('보강 자동 완료 실패:', makeup.id, err);
                }
            }

            setWeekMakeupRequests(makeups || []);
            setWeekHoldings(holdings || []);
            setWeekAbsences(allAbsences || []);
            setWeekHolidays(holidays || []);
            setWeekWaitlist(waitlist || []);
        } catch (error) {
            console.error('Failed to load weekly data:', error);
            setWeekMakeupRequests([]);
            setWeekHoldings([]);
            setWeekAbsences([]);
            setWeekWaitlist([]);
        }
    }

    useEffect(() => {
        loadWeeklyData();
    }, [mode, students]);

    // Coach mode: auto-refresh every 30 minutes
    useEffect(() => {
        if (user?.role !== 'coach' || mode !== 'coach') return;

        const REFRESH_INTERVAL = 30 * 60 * 1000;
        const intervalId = setInterval(async () => {
            try {
                await refresh();
                await loadWeeklyData();
            } catch (error) {
                console.error('자동 리프레시 실패:', error);
            }
        }, REFRESH_INTERVAL);

        return () => clearInterval(intervalId);
    }, [user, mode]);

    return {
        weekMakeupRequests,
        setWeekMakeupRequests,
        weekHoldings,
        weekAbsences,
        weekHolidays,
        weekWaitlist,
        setWeekWaitlist,
        loadWeeklyData,
    };
}
