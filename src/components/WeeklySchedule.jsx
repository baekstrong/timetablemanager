import { useState, useEffect } from 'react';
import { useGoogleSheets } from '../contexts/GoogleSheetsContext';
import {
    getDisabledClasses,
    getLockedSlots,
    getNewStudentRegistrations,
    createWaitlistRequest,
    cancelWaitlistRequest,
    checkWaitlistAvailability,
    updateWaitlistAvailability,
} from '../services/firebaseService';
import { writeSheetData } from '../services/googleSheetsService';
import { PERIODS, MAX_CAPACITY } from '../data/mockData';
import CoachWaitlistModal from './schedule/CoachWaitlistModal';
import CoachSchedule from './schedule/CoachSchedule';
import StudentSchedule from './schedule/StudentSchedule';
import { useScheduleCore } from './schedule/useScheduleCore';
import { buildUpdatedSchedule } from '../utils/scheduleUtils';
import './WeeklySchedule.css';

const WeeklySchedule = ({ user, studentData, onBack, onNavigate }) => {
    const [mode, setMode] = useState(user?.role === 'coach' ? 'coach' : 'student');
    const { students, isAuthenticated, loading, refresh } = useGoogleSheets();

    // Pending new student registrations (선언 위치: useScheduleCore에 전달 필요)
    const [pendingRegistrations, setPendingRegistrations] = useState([]);

    // 코치/학생 공통 파생 데이터 + useWeeklyData 래핑
    const scheduleCore = useScheduleCore({ user, students, mode, studentData, refresh, pendingRegistrations });
    const {
        weekAbsences,
        weekWaitlist, setWeekWaitlist,
        loadWeeklyData,
        studentSchedule, scheduleData, weekDates,
        isMakeupHeld,
        lastDayStudents, delayedReregistrationStudents,
        getCellData, getHolidayInfo,
    } = scheduleCore;

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

    // StudentSchedule에 내려줄 셀 상태 판정 (disabledClasses/lockedSlots는 여기서 소유)
    function isClassDisabled(day, periodId) {
        return disabledClasses.includes(`${day}-${periodId}`);
    }

    function isSlotLocked(day, periodId) {
        return lockedSlots.includes(`${day}-${periodId}`);
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

    // 학생 뷰에서 코치가 셀 클릭: 대기/직접 이동 모달 오픈
    function handleCoachWaitlistCellClick(day, periodId, cellData) {
        setWaitlistDesiredSlot({ day, period: periodId });
        setIsDirectTransfer(!cellData.isFull);
        setShowWaitlistModal(true);
    }

    const pageTitle = mode === 'coach' ? '코치 시간표' : '수강생 시간표';

    // ── Loading / not-authenticated states ──

    if (loading) {
        return (
            <div className="schedule-container">
                <div className="schedule-page-header">
                    <h1 className="schedule-page-title">
                        {pageTitle}
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
                        {pageTitle}
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
                    {pageTitle}
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

            {/* Coach mode (코치 전용 뷰) */}
            {mode === 'coach' && (
                <CoachSchedule
                    scheduleData={scheduleData}
                    weekDates={weekDates}
                    weekWaitlist={weekWaitlist}
                    setWeekWaitlist={setWeekWaitlist}
                    lastDayStudents={lastDayStudents}
                    delayedReregistrationStudents={delayedReregistrationStudents}
                    getCellData={getCellData}
                    getHolidayInfo={getHolidayInfo}
                    newStudentWaitlist={newStudentWaitlist}
                    setNewStudentWaitlist={setNewStudentWaitlist}
                    showWaitlistDeleteMode={showWaitlistDeleteMode}
                    setShowWaitlistDeleteMode={setShowWaitlistDeleteMode}
                    disabledClasses={disabledClasses}
                    setDisabledClasses={setDisabledClasses}
                    lockedSlots={lockedSlots}
                    setLockedSlots={setLockedSlots}
                    onNavigate={onNavigate}
                />
            )}

            {/* Student mode (실제 학생 + 코치 신규 전용) */}
            {mode === 'student' && (
                <StudentSchedule
                    user={user}
                    mode={mode}
                    students={students}
                    weekDates={weekDates}
                    weekAbsences={weekAbsences}
                    weekWaitlist={weekWaitlist}
                    studentSchedule={studentSchedule}
                    isMakeupHeld={isMakeupHeld}
                    getCellData={getCellData}
                    getHolidayInfo={getHolidayInfo}
                    loadWeeklyData={loadWeeklyData}
                    isClassDisabled={isClassDisabled}
                    isSlotLocked={isSlotLocked}
                    newStudentWaitlist={newStudentWaitlist}
                    onCoachCellClick={handleCoachWaitlistCellClick}
                />
            )}

            {/* Waitlist / Transfer Modal (코치가 신규 전용 뷰에서 셀 클릭 시) */}
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
        </div>
    );
};

export default WeeklySchedule;
