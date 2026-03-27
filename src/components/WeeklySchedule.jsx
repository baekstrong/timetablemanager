import { useState, useMemo, useEffect } from 'react';
import { useGoogleSheets } from '../contexts/GoogleSheetsContext';
import { getStudentField, parseHoldingStatus, parseSheetDate as parseSheetDateSvc } from '../services/googleSheetsService';
import {
    getActiveMakeupRequests,
    createMakeupRequest,
    cancelMakeupRequest,
    completeMakeupRequest,
    getDisabledClasses,
    toggleDisabledClass,
    getLockedSlots,
    toggleLockedSlot,
    getNewStudentRegistrations,
    createWaitlistRequest,
    cancelWaitlistRequest,
} from '../services/firebaseService';
import { writeSheetData } from '../services/googleSheetsService';
import { useWeeklyData } from '../hooks/useWeeklyData';
import { PERIODS, DAYS, MOCK_DATA, MAX_CAPACITY, KOREAN_HOLIDAYS } from '../data/mockData';
import MakeupModal from './schedule/MakeupModal';
import CoachWaitlistPanel from './schedule/CoachWaitlistPanel';
import CoachWaitlistModal from './schedule/CoachWaitlistModal';
import {
    parseScheduleString,
    parseSheetDate,
    parseAgreedAbsenceDates,
    formatDateISO,
    weekDateToISO,
    getClassDateTime,
    isClassWithinMinutes,
    isCurrentlyOnHold,
    isCurrentlyEnrolled,
    transformGoogleSheetsData,
    getScheduleSortKey,
    getThisWeekRange,
    buildUpdatedSchedule,
    getWaitlistCountForSlot,
} from '../utils/scheduleUtils';
import './WeeklySchedule.css';

// ──────────────────────────────────────────────
// Style constants (shared across sub-components)
// ──────────────────────────────────────────────

const TAG_STYLES = {
    makeupAbsent: { backgroundColor: '#fef3c7', color: '#92400e', textDecoration: 'line-through' },
    agreedAbsent: { backgroundColor: '#fce7f3', color: '#be185d', textDecoration: 'line-through' },
    absent: { backgroundColor: '#fecaca', color: '#991b1b', textDecoration: 'line-through' },
    holding: { backgroundColor: '#fee2e2', color: '#991b1b', textDecoration: 'line-through' },
    newStudent: { backgroundColor: '#dbeafe', color: '#1e40af' },
    delayed: { backgroundColor: '#dcfce7', color: '#166534', textDecoration: 'line-through' },
};

const SECTION_STYLES = {
    lastDay: {
        background: 'linear-gradient(135deg, #dcfce7, #bbf7d0)',
        border: '1px solid #4ade80',
        borderRadius: '12px',
        padding: '1rem 1.25rem',
        marginBottom: '1rem',
    },
    delayedRereg: {
        background: 'linear-gradient(135deg, #fef3c7, #fde68a)',
        border: '1px solid #f59e0b',
        borderRadius: '12px',
        padding: '1rem 1.25rem',
        marginBottom: '1rem',
    },
    waitlist: {
        background: 'linear-gradient(135deg, #fef9c3, #fde047)',
        border: '1px solid #eab308',
        borderRadius: '12px',
        padding: '1rem 1.25rem',
        marginBottom: '1rem',
    },
};

const DELETE_BTN_STYLE = {
    fontSize: '0.75rem',
    padding: '2px 8px',
    borderRadius: '4px',
    border: '1px solid #dc2626',
    background: '#fee2e2',
    color: '#dc2626',
    cursor: 'pointer',
    fontWeight: '600',
};

// ──────────────────────────────────────────────
// Sub-components (same file to avoid import complexity)
// ──────────────────────────────────────────────

/** Styled student tag with status-specific styling. */
function StudentTag({ name, status, label }) {
    const style = TAG_STYLES[status] || {};
    const suffix = label ? `(${label})` : '';
    const className = status === 'makeup' ? 'student-tag substitute' : 'student-tag';
    return <span className={className} style={style}>{name}{suffix}</span>;
}

/** Available seats display cell (reused in student mode). */
function AvailableSeatsCell({ seats, onClick }) {
    return (
        <div className="schedule-cell cell-available" onClick={onClick}>
            <span className="seat-count">{seats}</span>
            <span style={{ fontSize: '0.8em', color: '#666' }}>자리</span>
        </div>
    );
}

/** Holiday cell for student mode. */
function HolidayCell({ reason }) {
    return (
        <div className="schedule-cell" style={{ backgroundColor: '#f3f4f6', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ color: '#ef4444', fontWeight: 'bold', fontSize: '0.9rem' }}>휴일</span>
            {reason && <span style={{ color: '#6b7280', fontSize: '0.7rem', marginTop: '2px' }}>{reason}</span>}
        </div>
    );
}

/** Coach info banner section (last day / delayed re-registration). */
function CoachInfoSection({ title, items, style, titleColor, itemColor, renderItem }) {
    if (items.length === 0) return null;
    return (
        <section style={style}>
            <div style={{ fontWeight: '700', fontSize: '1rem', color: titleColor, marginBottom: '0.5rem' }}>
                {title}
            </div>
            <div style={{ color: itemColor, fontSize: '0.95rem', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {items.map(renderItem)}
            </div>
        </section>
    );
}

// ──────────────────────────────────────────────
// Main component
// ──────────────────────────────────────────────

const WeeklySchedule = ({ user, studentData, onBack, onNavigate }) => {
    const [mode, setMode] = useState(user?.role === 'coach' ? 'coach' : 'student');
    const { students, isAuthenticated, loading, refresh } = useGoogleSheets();

    // Makeup request state
    const [showMakeupModal, setShowMakeupModal] = useState(false);
    const [selectedMakeupSlot, setSelectedMakeupSlot] = useState(null);
    const [selectedOriginalClass, setSelectedOriginalClass] = useState(null);
    const [activeMakeupRequests, setActiveMakeupRequests] = useState([]);
    const [isSubmittingMakeup, setIsSubmittingMakeup] = useState(false);

    // Weekly frequency for current student
    const weeklyFrequency = useMemo(() => {
        if (!studentData) return 2;
        const freq = parseInt(getStudentField(studentData, '주횟수'));
        return isNaN(freq) ? 2 : freq;
    }, [studentData]);

    // Weekly data from custom hook
    const {
        weekMakeupRequests, setWeekMakeupRequests,
        weekHoldings, weekAbsences, weekHolidays,
        weekWaitlist, setWeekWaitlist,
        loadWeeklyData,
    } = useWeeklyData({ user, students, mode, refresh });

    // Pending new student registrations
    const [pendingRegistrations, setPendingRegistrations] = useState([]);

    // New student waitlist (coach only)
    const [newStudentWaitlist, setNewStudentWaitlist] = useState([]);
    const [showWaitlistDeleteMode, setShowWaitlistDeleteMode] = useState(false);
    const [showWaitlistModal, setShowWaitlistModal] = useState(false);
    const [waitlistDesiredSlot, setWaitlistDesiredSlot] = useState(null);
    const [waitlistStudentName, setWaitlistStudentName] = useState('');
    const [waitlistStudentSearch, setWaitlistStudentSearch] = useState('');
    const [isDirectTransfer, setIsDirectTransfer] = useState(false);

    // Class disabled / locked state
    const [disabledClasses, setDisabledClasses] = useState([]);
    const [disabledClassesLoading, setDisabledClassesLoading] = useState(true);
    const [lockedSlots, setLockedSlots] = useState([]);
    const [lockedSlotsLoading, setLockedSlotsLoading] = useState(true);

    // Manual refresh state
    const [isRefreshing, setIsRefreshing] = useState(false);

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

    // Check if a makeup request's target date is within the student's holding period
    // 단, 홀딩 시작 이후 생성된 보강은 학생이 의도적으로 신청한 것이므로 활성 처리
    const isMakeupHeld = (makeup) => {
        if (!studentHoldingRange) return false;
        const makeupDate = makeup.makeupClass?.date;
        const isMakeupInHolding = makeupDate >= studentHoldingRange.start && makeupDate <= studentHoldingRange.end;
        if (!isMakeupInHolding) return false;
        // 보강이 홀딩 시작일 이후에 생성되었으면 의도적 보강 → 활성
        const createdDate = makeup.createdAt?.toDate ? formatDateISO(makeup.createdAt.toDate()) : null;
        if (createdDate && createdDate >= studentHoldingRange.start) return false;
        return true;
    };

    // ── Derived data ──

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

            // 기본: effectiveEnd가 오늘이면 마지막 수업일
            if (effectiveEnd.getTime() === today.getTime()) return true;

            // 보강으로 종료일이 연장된 경우:
            // 원래 종료일 ≤ 오늘 < effectiveEnd이고,
            // 오늘이 정규 수업 요일이며,
            // 오늘~effectiveEnd 사이에 더 이상 정규 수업일이 없으면 마지막 정규 수업일
            if (endDate.getTime() <= today.getTime() && effectiveEnd.getTime() > today.getTime()) {
                const schedule = student['요일 및 시간'] || '';
                const parsed = parseScheduleString(schedule);
                const scheduleDays = parsed.map(p => p.day);

                // 오늘이 정규 수업 요일인지 확인
                if (!scheduleDays.includes(todayDay)) return false;

                // 오늘 수업을 보강으로 옮긴 경우 제외 (보강결석 상태)
                const name = student['이름'];
                const hasMakeupFromToday = weekMakeupRequests && weekMakeupRequests.some(m =>
                    m.studentName === name &&
                    m.originalClass.date === todayStr &&
                    (m.status === 'active' || m.status === 'completed')
                );
                if (hasMakeupFromToday) return false;

                // 오늘 이후 ~ effectiveEnd 이하에 정규 수업일 또는 보강 수업이 있는지 확인
                const dayNamesArr = ['일', '월', '화', '수', '목', '금', '토'];
                const checkDate = new Date(today);
                for (let i = 0; i < 7; i++) {
                    checkDate.setDate(checkDate.getDate() + 1);
                    if (checkDate.getTime() > effectiveEnd.getTime()) break;
                    const checkDateStr = formatDateISO(checkDate);
                    const dayName = dayNamesArr[checkDate.getDay()];

                    // 정규 수업이 있는지 (보강으로 옮기지 않은)
                    const hasRegularClass = scheduleDays.includes(dayName) &&
                        !(weekMakeupRequests && weekMakeupRequests.some(m =>
                            m.studentName === name &&
                            m.originalClass.date === checkDateStr &&
                            (m.status === 'active' || m.status === 'completed')
                        ));
                    if (hasRegularClass) return false;

                    // 보강 수업이 있는지
                    const hasMakeupClass = weekMakeupRequests && weekMakeupRequests.some(m =>
                        m.studentName === name &&
                        m.makeupClass.date === checkDateStr &&
                        (m.status === 'active' || m.status === 'completed')
                    );
                    if (hasMakeupClass) return false;
                }
                return true; // 오늘이 마지막 수업일 (정규 또는 보강 포함)
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

    // ── Data loading effects ──

    useEffect(() => {
        getDisabledClasses()
            .then(setDisabledClasses)
            .catch((error) => {
                console.error('Failed to load disabled classes:', error);
                const saved = localStorage.getItem('disabled_classes');
                if (saved) setDisabledClasses(JSON.parse(saved));
            })
            .finally(() => setDisabledClassesLoading(false));
    }, []);

    useEffect(() => {
        getLockedSlots()
            .then(setLockedSlots)
            .catch(error => console.error('Failed to load locked slots:', error))
            .finally(() => setLockedSlotsLoading(false));
    }, []);

    useEffect(() => {
        if (user?.role === 'coach') {
            getNewStudentRegistrations('pending').then(setPendingRegistrations).catch(() => {});
            getNewStudentRegistrations('waitlist').then(setNewStudentWaitlist).catch(() => {});
        }
    }, [user]);

    // Load student makeup data
    useEffect(() => {
        if (mode !== 'student' || user?.role === 'coach') return;

        async function loadStudentMakeupData() {
            try {
                const makeups = await getActiveMakeupRequests(user.username);
                const { start, end } = getThisWeekRange();

                for (const m of makeups) {
                    if (m.status === 'active' && isClassWithinMinutes(m.makeupClass.date, m.makeupClass.period, 0)) {
                        try {
                            await completeMakeupRequest(m.id);
                            m.status = 'completed';
                        } catch (err) {
                            console.error('수강생 보강 자동 완료 실패:', m.id, err);
                        }
                    }
                }

                const thisWeekMakeups = makeups.filter(m => {
                    const makeupDate = m.makeupClass?.date;
                    const originalDate = m.originalClass?.date;
                    // 보강 날짜 또는 원래 수업 날짜가 이번 주 범위에 포함되는 경우만 표시
                    return (makeupDate >= start && makeupDate <= end) ||
                           (originalDate >= start && originalDate <= end);
                });
                setActiveMakeupRequests(thisWeekMakeups);
            } catch (error) {
                console.error('Failed to load student makeup data:', error);
            }
        }
        loadStudentMakeupData();
    }, [mode, user]);

    // ── Handlers ──

    async function handleManualRefresh() {
        setIsRefreshing(true);
        try {
            await refresh();
            await loadWeeklyData();
        } catch (error) {
            console.error('Refresh failed:', error);
        } finally {
            setIsRefreshing(false);
        }
    }

    function isClassDisabled(day, periodId) {
        return disabledClasses.includes(`${day}-${periodId}`);
    }

    function isSlotLocked(day, periodId) {
        return lockedSlots.includes(`${day}-${periodId}`);
    }

    function isMyClass(day, periodId) {
        return studentSchedule.some(s => s.day === day && s.period === periodId);
    }

    async function toggleClassDisabledHandler(day, periodId) {
        const key = `${day}-${periodId}`;
        try {
            const isNowDisabled = await toggleDisabledClass(key);
            setDisabledClasses(prev =>
                isNowDisabled ? [...prev, key] : prev.filter(k => k !== key)
            );
        } catch (error) {
            console.error('Failed to toggle class disabled status:', error);
            alert('수업 상태 변경에 실패했습니다.');
        }
    }

    async function toggleLockedSlotHandler(day, periodId) {
        const key = `${day}-${periodId}`;
        const dateMMDD = weekDates[day];
        if (!dateMMDD) return;
        const date = weekDateToISO(dateMMDD);

        try {
            const isNowLocked = await toggleLockedSlot(key, date);
            setLockedSlots(prev =>
                isNowLocked ? [...prev, key] : prev.filter(k => k !== key)
            );
        } catch (error) {
            console.error('Failed to toggle locked slot:', error);
            alert('슬롯 잠금 상태 변경에 실패했습니다.');
        }
    }

    async function reloadStudentMakeups() {
        const makeups = await getActiveMakeupRequests(user.username);
        const { start, end } = getThisWeekRange();
        const thisWeekMakeups = makeups.filter(m => {
            const makeupDate = m.makeupClass?.date;
            const originalDate = m.originalClass?.date;
            return (makeupDate >= start && makeupDate <= end) ||
                   (originalDate >= start && originalDate <= end);
        });
        setActiveMakeupRequests(thisWeekMakeups);
    }

    function handleAvailableSeatClick(day, periodId, date) {
        if (mode !== 'student' || user?.role === 'coach') return;

        if (isSlotLocked(day, periodId)) {
            alert('해당 시간은 코치에 의해 보강이 차단되었습니다.');
            return;
        }

        // Calculate effective makeup limit considering holidays
        let holidayClassCount = 0;
        if (studentSchedule.length > 0 && weekDates) {
            studentSchedule.forEach(schedule => {
                const slotDateStr = weekDateToISO(weekDates[schedule.day]);
                if (!slotDateStr) return;
                const isFirebaseHoliday = weekHolidays.some(h => h.date === slotDateStr);
                const isKoreanHoliday = !!KOREAN_HOLIDAYS[slotDateStr];
                if (isFirebaseHoliday || isKoreanHoliday) holidayClassCount++;
            });
        }
        const effectiveMakeupLimit = Math.max(0, weeklyFrequency - holidayClassCount);

        if (activeMakeupRequests.filter(m => m.status === 'active').length >= effectiveMakeupLimit) {
            if (effectiveMakeupLimit < weeklyFrequency) {
                alert(`이번 주 휴일로 인해 보강 신청이 최대 ${effectiveMakeupLimit}개까지 가능합니다.\n(주 ${weeklyFrequency}회 중 ${weeklyFrequency - effectiveMakeupLimit}회 휴일)\n기존 보강을 취소 후 다시 신청해주세요.`);
            } else {
                alert(`주 ${weeklyFrequency}회 수업이므로 보강 신청은 최대 ${weeklyFrequency}개까지 가능합니다.\n기존 보강을 취소 후 다시 신청해주세요.`);
            }
            return;
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (new Date(date + 'T00:00:00') < today) {
            alert('과거 날짜로는 보강 신청을 할 수 없습니다.');
            return;
        }

        if (isClassWithinMinutes(date, periodId, 30)) {
            const period = PERIODS.find(p => p.id === periodId);
            alert(`${period?.name} 수업이 곧 시작됩니다.\n수업 시작 30분 전까지만 보강 신청이 가능합니다.`);
            return;
        }

        if (isMyClass(day, periodId)) {
            const isAlreadyMakeupAbsent = activeMakeupRequests.some(m =>
                m.originalClass.day === day &&
                m.originalClass.period === periodId &&
                m.originalClass.date === date
            );
            if (!isAlreadyMakeupAbsent) {
                alert('본인의 정규 수업 시간에는 보강 신청을 할 수 없습니다.\n다른 시간을 선택해주세요.');
                return;
            }
        }

        const period = PERIODS.find(p => p.id === periodId);
        setSelectedMakeupSlot({ day, period: periodId, periodName: period.name, date });
        setShowMakeupModal(true);
    }

    async function handleMakeupSubmit() {
        if (!selectedOriginalClass || !selectedMakeupSlot) return;

        if (selectedOriginalClass.day === selectedMakeupSlot.day &&
            selectedOriginalClass.period === selectedMakeupSlot.period &&
            selectedOriginalClass.date === selectedMakeupSlot.date) {
            alert('같은 수업으로 보강 신청할 수 없습니다.\n다른 시간을 선택해주세요.');
            return;
        }

        // 다른 요일 수업을 본인 정규 수업 요일로 옮기는 것 차단 (같은 요일 내 교시 변경은 허용)
        if (selectedOriginalClass.day !== selectedMakeupSlot.day) {
            const isTargetMyScheduleDay = studentSchedule.some(s => s.day === selectedMakeupSlot.day);
            if (isTargetMyScheduleDay) {
                alert('다른 요일의 수업을 본인 정규 수업 요일로 옮길 수 없습니다.\n다른 요일을 선택해주세요.');
                return;
            }
        }

        setIsSubmittingMakeup(true);
        try {
            await createMakeupRequest(user.username, selectedOriginalClass, selectedMakeupSlot);
            alert(`보강 신청 완료!\n${selectedOriginalClass.day}요일 ${selectedOriginalClass.periodName} → ${selectedMakeupSlot.day}요일 ${selectedMakeupSlot.periodName}`);
            await reloadStudentMakeups();
            await loadWeeklyData();
            setShowMakeupModal(false);
            setSelectedMakeupSlot(null);
            setSelectedOriginalClass(null);
        } catch (error) {
            alert(`보강 신청 실패: ${error.message}`);
        } finally {
            setIsSubmittingMakeup(false);
        }
    }

    async function handleMakeupCancel(makeupId) {
        if (!makeupId || !confirm('이 보강 신청을 취소하시겠습니까?')) return;
        try {
            await cancelMakeupRequest(makeupId);
            alert('보강 신청이 취소되었습니다.');
            await reloadStudentMakeups();
            await loadWeeklyData();
        } catch (error) {
            alert(`보강 신청 취소 실패: ${error.message}`);
        }
    }

    function closeWaitlistModal() {
        setShowWaitlistModal(false);
        setWaitlistDesiredSlot(null);
        setWaitlistStudentName('');
        setWaitlistStudentSearch('');
        setIsDirectTransfer(false);
    }

    async function handleDirectTransfer(studentName, currentSlot) {
        if (!waitlistDesiredSlot) return;
        const period = PERIODS.find(p => p.id === waitlistDesiredSlot.period);
        if (!confirm(
            `시간표를 이동하시겠습니까?\n\n` +
            `${studentName}: ${currentSlot.day}요일 ${currentSlot.periodName} → ${waitlistDesiredSlot.day}요일 ${period?.name}\n\n` +
            `※ 영구적으로 시간표가 변경됩니다.`
        )) return;

        try {
            const studentEntry = students.find(s => s['이름'] === studentName && s['요일 및 시간']);
            if (!studentEntry) {
                alert('수강생 정보를 찾을 수 없습니다.');
                return;
            }

            const actualRow = studentEntry._rowIndex + 3;
            const currentSchedule = studentEntry['요일 및 시간'];
            const newSchedule = buildUpdatedSchedule(currentSchedule, currentSlot, waitlistDesiredSlot);

            const range = `${studentEntry._foundSheetName}!D${actualRow}`;
            await writeSheetData(range, [[newSchedule]]);

            alert(`시간표 이동 완료!\n${studentName}: ${currentSchedule} → ${newSchedule}`);
            closeWaitlistModal();
            await refresh();
            await loadWeeklyData();
        } catch (error) {
            alert(`시간표 이동 실패: ${error.message}`);
            console.error('시간표 이동 실패:', error);
        }
    }

    async function handleWaitlistSubmit(studentName, currentSlot) {
        if (!waitlistDesiredSlot) return;
        const period = PERIODS.find(p => p.id === waitlistDesiredSlot.period);
        try {
            await createWaitlistRequest(studentName, currentSlot, {
                day: waitlistDesiredSlot.day,
                period: waitlistDesiredSlot.period,
                periodName: period?.name || ''
            });
            alert(`대기 등록 완료!\n${studentName}: ${currentSlot.day} ${currentSlot.periodName} → ${waitlistDesiredSlot.day} ${period?.name}\n자리가 나면 수강생에게 알림이 갑니다.`);
            closeWaitlistModal();
            await loadWeeklyData();
        } catch (error) {
            alert(`대기 등록 실패: ${error.message}`);
        }
    }

    async function handleWaitlistCancel(waitlistId) {
        if (!confirm('대기 신청을 취소하시겠습니까?')) return;
        try {
            await cancelWaitlistRequest(waitlistId);
            alert('대기 신청이 취소되었습니다.');
            await loadWeeklyData();
        } catch (error) {
            alert(`대기 취소 실패: ${error.message}`);
        }
    }

    function handleCellClick(day, periodObj, cellData) {
        if (periodObj.type === 'free') return;

        if (mode === 'student') {
            if (user?.role === 'coach') {
                setWaitlistDesiredSlot({ day, period: periodObj.id });
                setIsDirectTransfer(!cellData.isFull);
                setShowWaitlistModal(true);
                return;
            }
            if (cellData.isFull) {
                alert('만석입니다.\n자리가 나면 코치에게 문의해주세요.');
            } else {
                const dateStr = weekDates[day];
                if (dateStr) {
                    handleAvailableSeatClick(day, periodObj.id, weekDateToISO(dateStr));
                }
            }
        } else {
            // Coach Mode: go to training log
            const attendingStudents = [
                ...cellData.activeStudents,
                ...cellData.makeupStudents,
                ...cellData.subs.map(s => s.name)
            ];
            localStorage.setItem('coachSelectedStudents', JSON.stringify(attendingStudents));
            window.location.href = './training-log/index.html';
        }
    }

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
        let makeupAbsentStudents = [];
        let absenceStudents = [];
        let agreedAbsenceStudents = [];
        let holdingStudents = [];
        let delayedStartStudents = [];
        let newStudents = [];

        const dateStr = weekDates[day];
        if (dateStr) {
            const slotDate = weekDateToISO(dateStr);

            // 보강 목적지 슬롯: 홀딩되지 않은 보강만 표시
            // 단, 홀딩 시작 이후 생성된 보강은 의도적 신청이므로 활성 처리
            const makeupTargetRequests = weekMakeupRequests
                .filter(m =>
                    m.makeupClass.day === day &&
                    m.makeupClass.period === periodObj.id &&
                    m.makeupClass.date === slotDate
                );

            // 보강이 홀딩 중 의도적으로 생성되었는지 판별
            const isMakeupIntentionalDuringHolding = (m, holding) => {
                const createdDate = m.createdAt?.toDate ? formatDateISO(m.createdAt.toDate()) : null;
                return createdDate && createdDate >= holding.startDate;
            };

            makeupStudents = makeupTargetRequests
                .filter(m => {
                    const holding = weekHoldings.find(h =>
                        h.studentName === m.studentName &&
                        h.startDate <= slotDate &&
                        h.endDate >= slotDate
                    );
                    if (!holding) return true; // 홀딩 아님 → 보강 활성
                    // 홀딩 시작 이후 생성된 보강이면 의도적 → 활성
                    return isMakeupIntentionalDuringHolding(m, holding);
                })
                .map(m => m.studentName);

            // 보강 목적지가 홀딩된 학생 (보강홀딩 표시용)
            // 홀딩 시작 이후 생성된 보강은 제외 (위에서 보강 활성으로 처리)
            makeupHeldStudents = makeupTargetRequests
                .filter(m => {
                    const holding = weekHoldings.find(h =>
                        h.studentName === m.studentName &&
                        h.startDate <= slotDate &&
                        h.endDate >= slotDate
                    );
                    if (!holding) return false; // 홀딩 아님 → 보강홀딩 아님
                    // 홀딩 시작 이후 생성이면 의도적이므로 보강홀딩 아님
                    return !isMakeupIntentionalDuringHolding(m, holding);
                })
                .map(m => m.studentName);

            // 보강 원래 자리: 홀딩된 보강도 포함 (보강결석 표시)
            makeupAbsentStudents = weekMakeupRequests
                .filter(m =>
                    m.originalClass.day === day &&
                    m.originalClass.period === periodObj.id &&
                    m.originalClass.date === slotDate
                )
                .map(m => m.studentName);

            holdingStudents = weekHoldings
                .filter(h => h.startDate <= slotDate && h.endDate >= slotDate)
                .map(h => h.studentName)
                .filter(name => studentNames.includes(name));

            // Find students whose start date is after this slot date
            const slotDateObj = new Date(slotDate + 'T00:00:00');
            const delayedStudentsRaw = students.filter(s => {
                const name = s['이름'];
                if (!name || !studentNames.includes(name)) return false;
                if (holdingStudents.includes(name)) return false;
                const startDateStr = s['시작날짜'];
                if (!startDateStr) return false;
                const startDate = parseSheetDate(startDateStr);
                if (!startDate || startDate <= slotDateObj) return false;
                // 다른 레코드에 활성 등록이 있는지 확인
                const hasActiveEnrollment = students.some(other => {
                    if (other === s || other['이름'] !== name) return false;
                    const endDateStr = other['종료날짜'];
                    if (!endDateStr) return false;
                    const endDate = parseSheetDate(endDateStr);
                    return endDate && endDate >= slotDateObj;
                });
                if (hasActiveEnrollment) return false;
                // 이전 등록의 종료날짜가 보존되어 있으면 그것도 확인
                // (중복 제거로 이전 레코드가 병합된 경우)
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
                .filter(name => !makeupAbsentStudents.includes(name));

            agreedAbsenceStudents = students
                .filter(s => {
                    const name = s['이름'];
                    if (!name || !studentNames.includes(name)) return false;
                    if (makeupAbsentStudents.includes(name) || absenceStudents.includes(name)) return false;
                    const notes = s['특이사항'] || getStudentField(s, '특이사항') || '';
                    return parseAgreedAbsenceDates(notes).includes(slotDate);
                })
                .map(s => s['이름']);
        }

        // Calculate counts
        const allAbsentStudents = [...new Set([...makeupAbsentStudents, ...absenceStudents, ...agreedAbsenceStudents])];
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
            makeupAbsentStudents,
            absenceStudents,
            agreedAbsenceStudents,
            holdingStudents,
            delayedStartStudents,
            newStudents,
            pendingNames,
            regularStudentsPresent
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

    // ── Cell rendering ──

    function renderStudentCell(day, periodObj) {
        const data = getCellData(day, periodObj);
        const holidayReason = getHolidayInfo(day);
        const isHoliday = holidayReason !== null;

        // Holiday cell (not for coach's "신규 전용" mode)
        if (isHoliday && user?.role !== 'coach') {
            return <HolidayCell reason={holidayReason} />;
        }

        const myClass = isMyClass(day, periodObj.id);
        const cellClick = () => handleCellClick(day, periodObj, data);

        // Check makeup status for this cell
        let isMakeupFrom = false;
        let isMakeupTo = false;
        let isMakeupToHeld = false;
        let isMakeupFromHeld = false;
        if (activeMakeupRequests.length > 0 && weekDates[day]) {
            const cellDate = weekDateToISO(weekDates[day]);
            const makeupFrom = activeMakeupRequests.find(m =>
                m.originalClass.date === cellDate &&
                m.originalClass.day === day &&
                m.originalClass.period === periodObj.id
            );
            const makeupTo = activeMakeupRequests.find(m =>
                m.makeupClass.date === cellDate &&
                m.makeupClass.day === day &&
                m.makeupClass.period === periodObj.id
            );
            isMakeupFrom = !!makeupFrom;
            isMakeupTo = !!makeupTo;
            if (makeupTo) isMakeupToHeld = isMakeupHeld(makeupTo);
            if (makeupFrom) isMakeupFromHeld = isMakeupHeld(makeupFrom);
        }

        // My class (with or without makeup-absent)
        if (myClass) {
            // 보강이 홀딩된 경우: 원래 수업은 다시 정상 (보강결석이 아님)
            const showMakeupAbsent = isMakeupFrom && !isMakeupFromHeld;
            return (
                <div
                    className={`schedule-cell cell-available my-class ${showMakeupAbsent ? 'makeup-absent' : ''}`}
                    onClick={cellClick}
                >
                    <div className="cell-content">
                        <span className="seat-count">{data.availableSeats}/{MAX_CAPACITY}</span>
                        {showMakeupAbsent ? (
                            <span className="my-class-badge" style={{ backgroundColor: '#fef3c7', color: '#92400e' }}>보강결석</span>
                        ) : (
                            <span className="my-class-badge">MY</span>
                        )}
                    </div>
                </div>
            );
        }

        // Makeup TO cell
        if (isMakeupTo) {
            // 보강이 홀딩된 경우
            if (isMakeupToHeld) {
                return (
                    <div
                        className="schedule-cell cell-available"
                        onClick={cellClick}
                        style={{ borderColor: '#9ca3af', borderWidth: '2px', opacity: 0.7 }}
                    >
                        <div className="cell-content">
                            <span className="seat-count">{data.availableSeats}/{MAX_CAPACITY}</span>
                            <span className="my-class-badge" style={{ backgroundColor: '#6b7280', color: '#fff', fontSize: '0.65rem' }}>보강홀딩</span>
                        </div>
                    </div>
                );
            }
            return (
                <div
                    className="schedule-cell cell-available makeup-class"
                    onClick={cellClick}
                    style={{ borderColor: '#3b82f6', borderWidth: '2px' }}
                >
                    <div className="cell-content">
                        <span className="seat-count">{data.availableSeats}/{MAX_CAPACITY}</span>
                        <span className="my-class-badge" style={{ backgroundColor: '#3b82f6', color: '#fff' }}>보강</span>
                    </div>
                </div>
            );
        }

        // Disabled class
        if (isClassDisabled(day, periodObj.id)) {
            return <div className="schedule-cell cell-empty"><span style={{ color: '#999' }}>수업 없음</span></div>;
        }

        // Locked slot
        if (isSlotLocked(day, periodObj.id)) {
            return (
                <div className="schedule-cell" style={{ backgroundColor: '#fef2f2', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ fontSize: '1.2rem' }}>🔒</span>
                    <span style={{ color: '#991b1b', fontSize: '0.8rem', fontWeight: 'bold', marginTop: '2px' }}>보강 불가</span>
                </div>
            );
        }

        // Empty or all-on-hold: show available seats
        if (!data.studentNames.length || (data.currentCount === 0 && data.studentNames.length > 0)) {
            return <AvailableSeatsCell seats={data.availableSeats} onClick={cellClick} />;
        }

        // Full
        if (data.isFull) {
            const waitCount = getWaitlistCountForSlot(day, periodObj.id, weekWaitlist, newStudentWaitlist);
            return (
                <div className="schedule-cell cell-full" onClick={cellClick}>
                    <span className="cell-full-text">Full</span>
                    <span style={{ fontSize: '0.8em' }}>(만석)</span>
                    {waitCount > 0 && user?.role === 'coach' && (
                        <span style={{ fontSize: '0.7em', color: '#d97706' }}>대기 {waitCount}명</span>
                    )}
                </div>
            );
        }

        // Available seats
        return <AvailableSeatsCell seats={data.availableSeats} onClick={cellClick} />;
    }

    function renderCoachCell(day, periodObj) {
        const data = getCellData(day, periodObj);
        const classDisabled = isClassDisabled(day, periodObj.id);
        const holidayReason = getHolidayInfo(day);
        const isHoliday = holidayReason !== null;

        // Disabled class
        if (classDisabled) {
            return (
                <div
                    className="schedule-cell cell-disabled"
                    style={{ backgroundColor: '#f3f4f6', cursor: 'pointer' }}
                    onClick={() => {
                        if (confirm(`${day}요일 ${periodObj.name} 수업을 활성화하시겠습니까?`)) {
                            toggleClassDisabledHandler(day, periodObj.id);
                        }
                    }}
                >
                    <div style={{ fontSize: '0.8rem', color: '#6b7280' }}>수업 없음</div>
                    <div style={{ fontSize: '0.7rem', color: '#9ca3af', marginTop: '4px' }}>클릭하여 활성화</div>
                </div>
            );
        }

        // Empty cell (no students at all)
        const hasAnyStudents = data.currentCount > 0 ||
            data.holdingStudents.length > 0 ||
            data.makeupAbsentStudents.length > 0 ||
            data.agreedAbsenceStudents.length > 0 ||
            data.delayedStartStudents.length > 0 ||
            data.newStudents.length > 0;

        if (!hasAnyStudents) {
            return (
                <div
                    className="schedule-cell"
                    onClick={() => toggleClassDisabledHandler(day, periodObj.id)}
                    style={{ cursor: 'pointer' }}
                >
                    <span style={{ color: '#ccc' }}>-</span>
                    <div style={{ fontSize: '0.7rem', color: '#9ca3af', marginTop: '4px' }}>클릭하여 비활성화</div>
                </div>
            );
        }

        // Waitlist count + tooltip for header
        const waitCount = getWaitlistCountForSlot(day, periodObj.id, weekWaitlist, newStudentWaitlist);
        let waitlistTooltipElement = null;
        if (waitCount > 0) {
            const existingWaiters = weekWaitlist.filter(w =>
                w.desiredSlot.day === day && w.desiredSlot.period === periodObj.id
            );
            const newWaiters = newStudentWaitlist.filter(r => {
                const slots = r.requestedSlots || [];
                if (slots.length > 0) return slots.some(s => s.day === day && s.period === periodObj.id);
                const parsed = (r.scheduleString || '').match(/([월화수목금])(\d)/g);
                return parsed ? parsed.some(m => m[0] === day && parseInt(m[1]) === periodObj.id) : false;
            });
            const tooltipParts = [
                ...existingWaiters.map(w => `${w.studentName}(${w.currentSlot.day}${w.currentSlot.period}→)`),
                ...newWaiters.map(r => `${r.name}(신규)`)
            ];
            waitlistTooltipElement = (
                <span
                    style={{ color: '#d97706', fontWeight: 'bold', marginLeft: '4px', fontSize: '0.75rem' }}
                    title={`대기: ${tooltipParts.join(', ')}`}
                >
                    대기 {waitCount}명
                </span>
            );
        }

        const locked = isSlotLocked(day, periodObj.id);

        return (
            <div
                className="schedule-cell"
                onClick={() => handleCellClick(day, periodObj, data)}
                style={{
                    alignItems: 'flex-start',
                    justifyContent: 'flex-start',
                    padding: '8px',
                    ...(isHoliday ? { backgroundColor: '#fef2f2' } : {})
                }}
            >
                {/* Holiday banner */}
                {isHoliday && (
                    <div style={{ width: '100%', textAlign: 'center', marginBottom: '4px', padding: '2px 0', borderBottom: '1px solid #fca5a5', borderRadius: '4px' }}>
                        <span style={{ color: '#ef4444', fontWeight: 'bold', fontSize: '0.75rem' }}>휴일</span>
                        {holidayReason && <span style={{ color: '#6b7280', fontSize: '0.65rem', marginLeft: '4px' }}>{holidayReason}</span>}
                    </div>
                )}

                {/* Header with count and lock toggle */}
                <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px', fontSize: '0.8rem', fontWeight: 'bold', borderBottom: '1px solid #eee' }}>
                    <span>
                        {data.isFull
                            ? <span style={{ color: 'red' }}>Full</span>
                            : <>{data.currentCount}명<span style={{ color: '#666', fontWeight: 'normal', marginLeft: '4px' }}>(여석: {data.availableSeats}자리)</span></>
                        }
                        {waitlistTooltipElement}
                    </span>
                    <span
                        onClick={(e) => { e.stopPropagation(); toggleLockedSlotHandler(day, periodObj.id); }}
                        style={{
                            cursor: 'pointer',
                            fontSize: '0.9rem',
                            padding: '0 2px',
                            borderRadius: '4px',
                            ...(locked
                                ? { border: '1px solid #ef4444', backgroundColor: '#fef2f2' }
                                : { color: '#d1d5db' })
                        }}
                        title={locked ? '보강 잠금 해제' : '보강 잠금'}
                    >
                        {locked ? '🔒' : '🔓'}
                    </span>
                </div>

                {/* Student list */}
                <div className="student-list">
                    {data.regularStudentsPresent.map(name => {
                        if (data.makeupAbsentStudents.includes(name)) {
                            return <StudentTag key={name} name={name} status="makeupAbsent" label="보강결석" />;
                        }
                        if (data.agreedAbsenceStudents.includes(name)) {
                            return <StudentTag key={name} name={name} status="agreedAbsent" label="합의결석" />;
                        }
                        if (data.absenceStudents.includes(name)) {
                            return <StudentTag key={name} name={name} status="absent" label="결석" />;
                        }
                        return <span key={name} className="student-tag">{name}</span>;
                    })}
                    {data.makeupStudents.map(name => (
                        <StudentTag key={`makeup-${name}`} name={name} status="makeup" label="보강" />
                    ))}
                    {data.makeupHeldStudents.map(name => (
                        <StudentTag key={`makeup-held-${name}`} name={name} status="holding" label="보강홀딩" />
                    ))}
                    {data.holdingStudents.map(name => (
                        <StudentTag key={`holding-${name}`} name={name} status="holding" label="홀딩" />
                    ))}
                    {data.newStudents.map(name => (
                        <StudentTag key={`new-${name}`} name={name} status="newStudent" label="신규" />
                    ))}
                    {data.delayedStartStudents.map(name => (
                        <StudentTag key={`delayed-${name}`} name={name} status="delayed" label="시작지연" />
                    ))}
                    {data.subs.map(sub => (
                        <span key={sub.name} className="student-tag substitute">{sub.name}</span>
                    ))}
                </div>
            </div>
        );
    }

    function renderCell(day, periodObj) {
        if (periodObj.type === 'free') {
            return <div className="schedule-cell cell-free">자율 운동</div>;
        }
        if (mode === 'student') {
            return renderStudentCell(day, periodObj);
        }
        return renderCoachCell(day, periodObj);
    }

    // ── Loading / not-authenticated states ──

    if (loading) {
        return (
            <div className="schedule-container">
                <div className="schedule-page-header">
                    <h1 className="schedule-page-title">
                        {mode === 'coach' ? '코치 시간표' : '수강생 시간표'}
                    </h1>
                </div>
                <div style={{ textAlign: 'center', padding: '2rem' }}>
                    <div className="loading-spinner"></div>
                    <p>시간표를 불러오는 중...</p>
                </div>
            </div>
        );
    }

    if (!isAuthenticated) {
        return (
            <div className="schedule-container">
                <div className="schedule-page-header">
                    <h1 className="schedule-page-title">
                        {mode === 'coach' ? '코치 시간표' : '수강생 시간표'}
                    </h1>
                </div>
                <div style={{ textAlign: 'center', padding: '2rem' }}>
                    <h3>⚠️ Google Sheets에 연결되지 않았습니다</h3>
                    <p>대시보드에서 Google 계정을 연결해주세요.</p>
                </div>
            </div>
        );
    }

    // ── Main render ──

    return (
        <div className={`schedule-container mode-${mode}`}>
            <div className="schedule-page-header">
                <h1 className="schedule-page-title">
                    {mode === 'coach' ? '코치 시간표' : '수강생 시간표'}
                </h1>
                {user?.role === 'coach' && (
                    <button
                        onClick={handleManualRefresh}
                        disabled={isRefreshing}
                        style={{
                            marginLeft: 'auto',
                            padding: '4px 12px',
                            fontSize: '0.85rem',
                            border: '1px solid #ddd',
                            borderRadius: '4px',
                            backgroundColor: isRefreshing ? '#f3f4f6' : '#fff',
                            cursor: isRefreshing ? 'not-allowed' : 'pointer',
                            whiteSpace: 'nowrap',
                            flexShrink: 0
                        }}
                    >
                        {isRefreshing ? '새로고침 중...' : '🔄 새로고침'}
                    </button>
                )}
            </div>

            {/* Mode toggle (coach only) */}
            {user?.role === 'coach' && (
                <div className="controls">
                    <button
                        className={`mode-toggle ${mode === 'student' ? 'active' : ''}`}
                        onClick={() => setMode('student')}
                    >
                        신규 전용
                    </button>
                    <button
                        className={`mode-toggle ${mode === 'coach' ? 'active' : ''}`}
                        onClick={() => setMode('coach')}
                    >
                        코치 전용
                    </button>
                </div>
            )}

            {/* Last day students banner */}
            {mode === 'coach' && (
                <CoachInfoSection
                    title="오늘 마지막 수업"
                    items={lastDayStudents}
                    style={SECTION_STYLES.lastDay}
                    titleColor="#166534"
                    itemColor="#14532d"
                    renderItem={(s) => {
                        const now = new Date();
                        const period = PERIODS.find(p => p.id === s.todayPeriod);
                        let isBold = false;
                        if (period) {
                            const classStartMin = period.startHour * 60 + period.startMinute;
                            const classEndMin = classStartMin + 90;
                            const nowMin = now.getHours() * 60 + now.getMinutes();
                            isBold = nowMin >= (classStartMin - 30) && nowMin <= (classEndMin + 30);
                        }
                        return (
                            <div key={s.name} style={{ fontWeight: isBold ? '800' : '400' }}>
                                <span
                                    onClick={() => {
                                        sessionStorage.setItem('renewalStudentName', s.name);
                                        onNavigate?.('students');
                                    }}
                                    style={{ cursor: 'pointer' }}
                                >{s.name}({s.schedule}{s.payment ? `,${s.payment}` : ''})</span> {period ? <span style={{ fontSize: '0.8rem', color: '#15803d' }}>{period.id}교시</span> : ''}
                            </div>
                        );
                    }}
                />
            )}

            {/* Delayed re-registration banner */}
            {mode === 'coach' && (
                <CoachInfoSection
                    title="재등록 지연"
                    items={delayedReregistrationStudents}
                    style={SECTION_STYLES.delayedRereg}
                    titleColor="#92400e"
                    itemColor="#78350f"
                    renderItem={(s) => (
                        <div key={s.name}>
                            <span
                                onClick={() => {
                                    sessionStorage.setItem('renewalStudentName', s.name);
                                    onNavigate?.('students');
                                }}
                                style={{ cursor: 'pointer' }}
                            >{s.name}({s.schedule}{s.payment ? `,${s.payment}` : ''})</span> <span style={{ fontSize: '0.8rem', color: '#b45309' }}>종료: {s.endDate}</span>
                        </div>
                    )}
                />
            )}

            {/* Waitlist status section (coach only) */}
            {mode === 'coach' && (weekWaitlist.length > 0 || newStudentWaitlist.length > 0) && (
                <CoachWaitlistPanel
                    weekWaitlist={weekWaitlist}
                    setWeekWaitlist={setWeekWaitlist}
                    newStudentWaitlist={newStudentWaitlist}
                    setNewStudentWaitlist={setNewStudentWaitlist}
                    showWaitlistDeleteMode={showWaitlistDeleteMode}
                    setShowWaitlistDeleteMode={setShowWaitlistDeleteMode}
                    scheduleData={scheduleData}
                />
            )}

            {/* Student usage guide */}
            {mode === 'student' && user?.role !== 'coach' && (
                <div style={{
                    margin: '0 0 12px',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    backgroundColor: '#f0f9ff',
                    border: '1px solid #bae6fd',
                    fontSize: '0.82rem',
                    color: '#0c4a6e',
                    lineHeight: '1.6'
                }}>
                    <strong>이용 안내</strong>
                    <div style={{ marginTop: '4px' }}>
                        · 여석이 있는 칸을 눌러 <strong>보강 신청</strong>할 수 있습니다 (1회성 수업 이동)<br/>
                        · 시간표 변경은 코치에게 문의해주세요
                    </div>
                </div>
            )}

            {/* Schedule grid */}
            <div className="schedule-grid">
                <div className="grid-header"></div>
                {DAYS.map(day => (
                    <div key={day} className="grid-header">
                        {day} ({weekDates[day]})
                    </div>
                ))}

                {PERIODS.map(period => (
                    <>
                        <div className="time-header">
                            <div className="period-name">{period.name}</div>
                            <div className="period-time">{period.time}</div>
                        </div>
                        {DAYS.map(day => (
                            <div key={`${day}-${period.id}`} style={{ display: 'contents' }}>
                                {renderCell(day, period)}
                            </div>
                        ))}
                    </>
                ))}
            </div>

            {/* Legend */}
            <div className="legend">
                {mode === 'student' ? (
                    user?.role === 'coach' ? (
                        <>
                            <div className="legend-item"><span className="legend-color" style={{ background: 'white', border: '1px solid #ccc' }}></span> 여석 있음 (클릭: 시간표 이동)</div>
                            <div className="legend-item"><span className="legend-color" style={{ background: '#ef4444' }}></span> 만석 (클릭: 대기 등록)</div>
                        </>
                    ) : (
                        <>
                            <div className="legend-item"><span className="legend-color" style={{ background: '#ef4444' }}></span> 만석 (대기 가능)</div>
                            <div className="legend-item"><span className="legend-color" style={{ background: 'white', border: '1px solid #ccc' }}></span> 신청 가능 (숫자: 여석)</div>
                            <div className="legend-item"><span className="legend-color" style={{ background: '#f59e0b' }}></span> 자율 운동</div>
                        </>
                    )
                ) : (
                    <>
                        <div className="legend-item"><span className="student-tag" style={{ fontSize: '0.8rem' }}>김철수</span> 출석 예정</div>
                        <div className="legend-item"><span className="student-tag substitute" style={{ fontSize: '0.8rem' }}>이영희(보강)</span> 보강/대타</div>
                        <div className="legend-item"><span className="student-tag" style={{ fontSize: '0.8rem', backgroundColor: '#fee2e2', textDecoration: 'line-through' }}>박민수</span> 결석/홀딩</div>
                    </>
                )}
            </div>

            {/* Makeup Request Modal */}
            {showMakeupModal && mode === 'student' && selectedMakeupSlot && (
                <MakeupModal
                    selectedMakeupSlot={selectedMakeupSlot}
                    selectedOriginalClass={selectedOriginalClass}
                    setSelectedOriginalClass={setSelectedOriginalClass}
                    studentSchedule={studentSchedule}
                    weekDates={weekDates}
                    activeMakeupRequests={activeMakeupRequests}
                    isSubmittingMakeup={isSubmittingMakeup}
                    onSubmit={handleMakeupSubmit}
                    onClose={() => {
                        setShowMakeupModal(false);
                        setSelectedMakeupSlot(null);
                        setSelectedOriginalClass(null);
                    }}
                />
            )}

            {/* Waitlist / Transfer Modal (coach "신규 전용" mode) */}
            {showWaitlistModal && user?.role === 'coach' && waitlistDesiredSlot && (
                <CoachWaitlistModal
                    waitlistDesiredSlot={waitlistDesiredSlot}
                    isDirectTransfer={isDirectTransfer}
                    weekWaitlist={weekWaitlist}
                    students={students}
                    waitlistStudentName={waitlistStudentName}
                    setWaitlistStudentName={setWaitlistStudentName}
                    waitlistStudentSearch={waitlistStudentSearch}
                    setWaitlistStudentSearch={setWaitlistStudentSearch}
                    onDirectTransfer={handleDirectTransfer}
                    onWaitlistSubmit={handleWaitlistSubmit}
                    onWaitlistCancel={handleWaitlistCancel}
                    onClose={closeWaitlistModal}
                />
            )}

            {/* Makeup banners - active + completed for this week */}
            {mode === 'student' && activeMakeupRequests.length > 0 && (
                <div className="active-makeup-banner">
                    <div className="banner-header" style={{ marginBottom: '8px', fontSize: '0.9rem', color: '#666' }}>
                        🔄 이번 주 보강 ({activeMakeupRequests.length}/{weeklyFrequency}개)
                    </div>
                    {activeMakeupRequests.map((makeup, index) => {
                        const held = isMakeupHeld(makeup);
                        return (
                            <div key={makeup.id} className="banner-content" style={{
                                marginBottom: index < activeMakeupRequests.length - 1 ? '8px' : '0',
                                ...(held ? { background: 'linear-gradient(135deg, #9ca3af 0%, #6b7280 100%)' } : {})
                            }}>
                                <div className="banner-text" style={{ whiteSpace: 'normal' }}>
                                    {makeup.originalClass.day}요일 {makeup.originalClass.periodName} →{'\u00A0'}{makeup.makeupClass.day}요일 {makeup.makeupClass.periodName}
                                    {held && <span style={{ marginLeft: '6px', fontWeight: 700 }}>홀딩</span>}
                                    {!held && makeup.status === 'completed' && <span style={{ marginLeft: '6px', color: '#16a34a', fontWeight: 700 }}>완료</span>}
                                </div>
                                {!held && makeup.status === 'active' && !isClassWithinMinutes(makeup.makeupClass.date, makeup.makeupClass.period, 60) && (
                                    <button className="banner-cancel-btn" onClick={() => handleMakeupCancel(makeup.id)}>취소</button>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default WeeklySchedule;
