import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
    getStudentField,
    parseHoldingStatus,
} from '../services/googleSheetsService';
import {
    completeMakeupRequest,
    getMakeupRequestsByWeek,
    getAbsencesByDate,
    getHolidays,
    getAllActiveWaitlist,
    getHoldingsByWeek,
    getFreeWorkoutByDateRange,
    getFreeWorkoutRoster,
} from '../services/firebaseService';
import {
    parseSheetDate,
    formatDateISO,
    isClassWithinMinutes,
} from '../utils/scheduleUtils';

/**
 * 주간 Firebase 데이터(보강, 홀딩, 결석, 공휴일, 대기) 로딩 + 자동 리프레시 훅
 */
export function useWeeklyData({ students, mode }) {
    const [weekMakeupRequests, setWeekMakeupRequests] = useState([]);
    const [firebaseHoldings, setFirebaseHoldings] = useState([]);
    const [weekAbsences, setWeekAbsences] = useState([]);
    const [weekHolidays, setWeekHolidays] = useState([]);
    const [weekWaitlist, setWeekWaitlist] = useState([]);
    const [weekFreeWorkout, setWeekFreeWorkout] = useState([]); // 이번 주 자율운동 출석(날짜별)
    const [freeWorkoutRoster, setFreeWorkoutRoster] = useState([]); // 자율운동 고정 명단(요일별, 화면 전용)
    // 주간 Firebase 데이터(보강/홀딩/결석 등) 최초 로드 완료 여부 — 보강대기 백스톱이 여석을
    // 잘못 계산(보강 인원 0으로)하지 않도록 게이트하는 데 사용.
    const [weeklyDataLoaded, setWeeklyDataLoaded] = useState(false);
    const [weeklyDataError, setWeeklyDataError] = useState('');
    const requestId = useRef(0);

    // 시트 변경은 홀딩 계산만 갱신한다. Firebase 10여 건을 다시 읽지 않는다.
    const weekHoldings = useMemo(() => {
        const today = new Date();
        const monday = new Date(today);
        monday.setDate(today.getDate() + (today.getDay() === 0 ? 1 : 1 - today.getDay()));
        const friday = new Date(monday);
        friday.setDate(monday.getDate() + 4);
        const start = formatDateISO(monday);
        const end = formatDateISO(friday);
        const datesByHolding = new Map(firebaseHoldings.map(h => [`${h.studentName}|${h.startDate}|${h.endDate}`, h.holdingDates]));
        return (students || []).flatMap(student => {
            if (!parseHoldingStatus(getStudentField(student, '홀딩 사용여부')).isCurrentlyUsed) return [];
            const from = parseSheetDate(getStudentField(student, '홀딩 시작일'));
            const to = parseSheetDate(getStudentField(student, '홀딩 종료일'));
            if (!from || !to) return [];
            const startDate = formatDateISO(from);
            const endDate = formatDateISO(to);
            if (endDate < start || startDate > end) return [];
            const studentName = student['이름'];
            const holdingDates = datesByHolding.get(`${studentName}|${startDate}|${endDate}`);
            return [{ studentName, startDate, endDate, ...(holdingDates?.length ? { holdingDates } : {}) }];
        });
    }, [students, firebaseHoldings]);

    const loadWeeklyData = useCallback(async () => {
        const id = ++requestId.current;
        // 로드 시작 시 게이트를 다시 잠근다 — 로드 실패(catch에서 배열을 비움)나 낡은/부분 스냅샷으로
        // 보강대기 백스톱이 만석 슬롯을 빈자리로 오판해 오알림하는 것을 막는다. 성공 완료 시에만 다시 연다.
        setWeeklyDataLoaded(false);
        setWeeklyDataError('');
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

            // Firebase calls in parallel
            const dates = [];
            for (let i = 0; i < 5; i++) {
                const date = new Date(monday);
                date.setDate(monday.getDate() + i);
                dates.push(formatDateISO(date));
            }

            const [makeups, absenceArrays, holidays, waitlist, firebaseHoldings, freeWorkout, roster] = await Promise.all([
                getMakeupRequestsByWeek(startDate, endDate),
                Promise.all(dates.map(date => getAbsencesByDate(date))),
                getHolidays(),
                getAllActiveWaitlist(),
                getHoldingsByWeek(startDate, thisWeekEndDate),
                getFreeWorkoutByDateRange(startDate, endDate),
                getFreeWorkoutRoster()
            ]);
            if (id !== requestId.current) return;

            const allAbsences = absenceArrays.flat();

            // Auto-complete passed active makeups (병렬 처리)
            const passedActiveMakeups = (makeups || []).filter(m =>
                m.status === 'active' && isClassWithinMinutes(m.makeupClass.date, m.makeupClass.period, 0)
            );
            await Promise.all(passedActiveMakeups.map(async (makeup) => {
                try {
                    await completeMakeupRequest(makeup.id);
                    makeup.status = 'completed';
                } catch (err) {
                    console.error('보강 자동 완료 실패:', makeup.id, err);
                }
            }));

            if (id !== requestId.current) return;
            setWeekMakeupRequests(makeups || []);
            setFirebaseHoldings(firebaseHoldings || []);
            setWeekAbsences(allAbsences || []);
            setWeekHolidays(holidays || []);
            setWeekWaitlist(waitlist || []);
            setWeekFreeWorkout(freeWorkout || []);
            setFreeWorkoutRoster(roster || []);
            setWeeklyDataLoaded(true);
        } catch (error) {
            if (id !== requestId.current) return;
            console.error('Failed to load weekly data:', error);
            setWeeklyDataError('최신 시간표 정보를 불러오지 못했습니다. 새로고침을 눌러 다시 확인해주세요.');
            // 마지막 정상 화면 유지. 불완전한 조회로 여석 백스톱을 열지 않는다.
            throw error;
        }
    }, []);

    const cancelPending = useCallback(() => { requestId.current++; }, []);
    useEffect(() => {
        const timeoutId = window.setTimeout(() => {
            void loadWeeklyData().catch(() => {});
        }, 0);
        return () => { window.clearTimeout(timeoutId); cancelPending(); };
    }, [mode, loadWeeklyData, cancelPending]);

    // 자동 폴링 제거(Firestore 읽기 절감) — 코치는 시간표의 새로고침 버튼(handleManualRefresh)으로
    // 필요할 때만 갱신한다. 진입 시 1회 로드(위 effect) + 수동 새로고침으로 충분.

    return {
        weeklyDataLoaded,
        weeklyDataError,
        weekFreeWorkout,
        freeWorkoutRoster,
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
