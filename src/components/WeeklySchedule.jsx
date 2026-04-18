import { useState, useMemo, useEffect } from 'react';
import { useGoogleSheets } from '../contexts/GoogleSheetsContext';
import {
    getActiveMakeupRequests,
    getWeekMakeupRequests,
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
    checkWaitlistAvailability,
    updateWaitlistAvailability,
} from '../services/firebaseService';
import { writeSheetData } from '../services/googleSheetsService';
import { PERIODS, DAYS, MAX_CAPACITY } from '../data/mockData';
import MakeupModal from './schedule/MakeupModal';
import CoachWaitlistPanel from './schedule/CoachWaitlistPanel';
import CoachWaitlistModal from './schedule/CoachWaitlistModal';
import { StudentTag, AvailableSeatsCell, HolidayCell } from './schedule/ScheduleCell';
import { SECTION_STYLES } from './schedule/scheduleStyles';
import { useScheduleCore } from './schedule/useScheduleCore';
import {
    weekDateToISO,
    isClassWithinMinutes,
    getThisWeekRange,
    buildUpdatedSchedule,
    getWaitlistCountForSlot,
} from '../utils/scheduleUtils';
import './WeeklySchedule.css';

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
    // 내(학생) 이번 주 보강 이력 (active/completed/cancelled 모두 포함 — 주 1회 쿼터 계산용)
    const [myWeekMakeupHistory, setMyWeekMakeupHistory] = useState([]);
    // 활성/완료 보강만 — 시간표 그리드/패널 렌더링용 (취소 제외)
    const activeMakeupRequests = useMemo(
        () => myWeekMakeupHistory.filter(m => m.status !== 'cancelled'),
        [myWeekMakeupHistory]
    );
    const [isSubmittingMakeup, setIsSubmittingMakeup] = useState(false);

    // Pending new student registrations (선언 위치: useScheduleCore에 전달 필요)
    const [pendingRegistrations, setPendingRegistrations] = useState([]);

    // 코치/학생 공통 파생 데이터 + useWeeklyData 래핑
    const {
        weekAbsences,
        weekWaitlist, setWeekWaitlist,
        loadWeeklyData,
        studentSchedule, scheduleData, weekDates,
        isMakeupHeld,
        lastDayStudents, delayedReregistrationStudents,
        getCellData, getHolidayInfo,
    } = useScheduleCore({ user, students, mode, studentData, refresh, pendingRegistrations });

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
            Promise.all([
                getNewStudentRegistrations('pending').catch(() => []),
                getNewStudentRegistrations('waitlist').catch(() => [])
            ]).then(([pending, waitlist]) => {
                setPendingRegistrations(pending);
                setNewStudentWaitlist(waitlist);
            });
        }
    }, [user]);

    // 대기(만석) 건의 여석 자동 감지
    useEffect(() => {
        if (user?.role !== 'coach' || newStudentWaitlist.length === 0 || !scheduleData) return;

        // scheduleData.regularEnrollments에서 슬롯 점유율 계산
        const slotOccupancy = {};
        (scheduleData.regularEnrollments || []).forEach(({ day, period, names }) => {
            slotOccupancy[`${day}-${period}`] = names.length;
        });
        // pending 등록 슬롯도 반영
        (pendingRegistrations || []).forEach(reg => {
            (reg.requestedSlots || []).forEach(({ day, period }) => {
                const key = `${day}-${period}`;
                slotOccupancy[key] = (slotOccupancy[key] || 0) + 1;
            });
        });

        const updates = checkWaitlistAvailability(
            newStudentWaitlist, slotOccupancy, disabledClasses, MAX_CAPACITY
        );

        if (updates.length > 0) {
            updates.forEach(({ regId, hasAvailableSlots, availableSlots }) => {
                updateWaitlistAvailability(regId, { hasAvailableSlots, availableSlots }).catch(err => {
                    console.error('대기 여석 업데이트 실패:', err);
                });
            });
            // 로컬 상태에도 반영
            setNewStudentWaitlist(prev => prev.map(reg => {
                const update = updates.find(u => u.regId === reg.id);
                if (update) return { ...reg, hasAvailableSlots: update.hasAvailableSlots, availableSlots: update.availableSlots };
                return reg;
            }));
        }
    }, [user, newStudentWaitlist.length, scheduleData, disabledClasses, pendingRegistrations]);

    // Load student makeup data
    useEffect(() => {
        if (mode !== 'student' || user?.role === 'coach') return;

        async function loadStudentMakeupData() {
            try {
                // 1. 지난 보강 자동 완료 처리 (active → completed)
                const activeAndCompleted = await getActiveMakeupRequests(user.username);
                for (const m of activeAndCompleted) {
                    if (m.status === 'active' && isClassWithinMinutes(m.makeupClass.date, m.makeupClass.period, 0)) {
                        try {
                            await completeMakeupRequest(m.id);
                            m.status = 'completed';
                        } catch (err) {
                            console.error('수강생 보강 자동 완료 실패:', m.id, err);
                        }
                    }
                }

                // 2. 이번 주 내 보강 이력 전체(cancelled 포함)를 쿼터 계산용으로 로드
                const { start, end } = getThisWeekRange();
                const thisWeekMakeups = await getWeekMakeupRequests(user.username, start, end);
                setMyWeekMakeupHistory(thisWeekMakeups);
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
        const { start, end } = getThisWeekRange();
        const thisWeekMakeups = await getWeekMakeupRequests(user.username, start, end);
        setMyWeekMakeupHistory(thisWeekMakeups);
    }

    function handleAvailableSeatClick(day, periodId, date) {
        if (mode !== 'student' || user?.role === 'coach') return;

        if (isSlotLocked(day, periodId)) {
            alert('해당 시간은 코치에 의해 보강이 차단되었습니다.');
            return;
        }

        // 주횟수와 무관하게 당주 최대 1회까지 보강 신청 가능 (취소 내역도 소진으로 간주)
        if (myWeekMakeupHistory.length >= 1) {
            alert('보강은 주 1회만 신청 가능합니다.\n이번 주 보강 신청 내역(취소 포함)이 있어 추가 신청이 불가합니다.');
            return;
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (new Date(date + 'T00:00:00') < today) {
            alert('과거 날짜로는 보강 신청을 할 수 없습니다.');
            return;
        }

        if (isClassWithinMinutes(date, periodId, 120)) {
            const period = PERIODS.find(p => p.id === periodId);
            alert(`${period?.name} 수업이 곧 시작됩니다.\n수업 시작 2시간 전까지만 보강 신청이 가능합니다.`);
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

        if (isClassWithinMinutes(selectedOriginalClass.date, selectedOriginalClass.period, 120)) {
            alert(`${selectedOriginalClass.day}요일 ${selectedOriginalClass.periodName} 수업이 이미 시작되었거나 곧 시작됩니다.\n원래 수업 시작 2시간 전까지만 보강 신청이 가능합니다.`);
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
        if (!makeupId) return;
        const makeup = activeMakeupRequests.find(m => m.id === makeupId);
        if (makeup && isClassWithinMinutes(makeup.makeupClass.date, makeup.makeupClass.period, 60)) {
            alert('보강 수업 시작 1시간 전부터는 보강 취소가 불가합니다.');
            return;
        }
        if (!confirm('이 보강 신청을 취소하시겠습니까?')) return;
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
        let isMakeupToAbsent = false;
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
            if (makeupTo) {
                isMakeupToHeld = isMakeupHeld(makeupTo);
                isMakeupToAbsent = weekAbsences.some(a =>
                    a.studentName === user?.username && a.date === cellDate
                );
            }
            if (makeupFrom) isMakeupFromHeld = isMakeupHeld(makeupFrom);
        }

        // My class (with or without makeup-moved)
        if (myClass) {
            // 보강이 홀딩된 경우: 원래 수업은 다시 정상 (보강이동이 아님)
            const showMakeupMoved = isMakeupFrom && !isMakeupFromHeld;
            return (
                <div
                    className={`schedule-cell cell-available my-class ${showMakeupMoved ? 'makeup-moved' : ''}`}
                    onClick={cellClick}
                >
                    <div className="cell-content">
                        <span className="seat-count">{data.availableSeats}/{MAX_CAPACITY}</span>
                        {showMakeupMoved ? (
                            <span className="my-class-badge" style={{ backgroundColor: '#fef3c7', color: '#92400e' }}>보강이동</span>
                        ) : (
                            <span className="my-class-badge">MY</span>
                        )}
                    </div>
                </div>
            );
        }

        // Makeup TO cell
        if (isMakeupTo) {
            // 보강일에 결석 신청한 경우 → 보강결석 (붉은색) 표시
            if (isMakeupToAbsent) {
                return (
                    <div
                        className="schedule-cell cell-available makeup-absent"
                        onClick={cellClick}
                        style={{ borderColor: '#dc2626', borderWidth: '2px' }}
                    >
                        <div className="cell-content">
                            <span className="seat-count">{data.availableSeats}/{MAX_CAPACITY}</span>
                            <span className="my-class-badge" style={{ backgroundColor: '#fecaca', color: '#991b1b' }}>보강결석</span>
                        </div>
                    </div>
                );
            }
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
                        <span style={{ fontSize: '0.7em', color: '#fff', fontWeight: 'bold' }}>대기 {waitCount}명</span>
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
            data.makeupMovedStudents.length > 0 ||
            data.makeupAbsentOnMakeupSlot.length > 0 ||
            data.makeupHeldStudents.length > 0 ||
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
                        if (data.makeupMovedStudents.includes(name)) {
                            return <StudentTag key={name} name={name} status="makeupMoved" label="보강이동" />;
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
                    {data.makeupAbsentOnMakeupSlot.map(name => (
                        <StudentTag key={`makeup-absent-slot-${name}`} name={name} status="makeupAbsent" label="보강결석" />
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
                    <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid #bae6fd' }}>
                        <strong>📌 보강 신청 조건</strong>
                        <div style={{ marginTop: '4px' }}>
                            · 원래 수업과 보강 대상 수업 모두 시작 <strong>2시간 전</strong>까지 신청 가능<br/>
                            · 주횟수와 무관하게 당주 <strong>최대 1회</strong>까지 신청 가능<br/>
                            · 본인 정규 수업 요일로는 이동 불가
                        </div>
                    </div>
                    <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid #bae6fd' }}>
                        <strong>📌 보강 취소 조건</strong>
                        <div style={{ marginTop: '4px' }}>
                            · 보강 수업 시작 <strong>1시간 전</strong>까지 취소 가능<br/>
                            · <strong>취소 시 이번 주 보강은 사용한 것으로 간주</strong>되어 재신청이 불가합니다
                        </div>
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
                        🔄 이번 주 보강 ({activeMakeupRequests.length}/1개)
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
                                {!held && makeup.status === 'active' && !isClassWithinMinutes(makeup.makeupClass.date, makeup.makeupClass.period, 30) && (
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
