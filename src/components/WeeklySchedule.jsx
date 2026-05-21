import { useState, useEffect, useMemo } from 'react';
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
import { processScheduleTransfer } from '../services/googleSheetsService';
import { getHolidays } from '../services/firebaseService';
import { PERIODS, MAX_CAPACITY } from '../data/mockData';
import CoachWaitlistModal from './schedule/CoachWaitlistModal';
import CoachSchedule from './schedule/CoachSchedule';
import StudentSchedule from './schedule/StudentSchedule';
import { useScheduleCore } from './schedule/useScheduleCore';
import { buildUpdatedSchedule, parseSheetDate } from '../utils/scheduleUtils';
import './WeeklySchedule.css';

const WeeklySchedule = ({ user, studentData, onBack, onNavigate }) => {
    const [mode, setMode] = useState(user?.role === 'coach' ? 'coach' : 'student');
    const { students, isAuthenticated, loading, refresh } = useGoogleSheets();

    // Pending new student registrations (선언 위치: useScheduleCore에 전달 필요)
    const [pendingRegistrations, setPendingRegistrations] = useState([]);

    // 코치 "수강생 전용" 강제 모드: 코치가 특정 수강생으로 빙의해 보강 신청/취소를 데드라인 없이 처리
    const [forceModeStudent, setForceModeStudent] = useState('');

    // 강제 모드 후보(수강생) 목록: 시간표가 있는 등록행을 이름 기준으로 중복 제거
    const studentForceCandidates = useMemo(() => {
        if (!students || students.length === 0) return [];
        const seen = new Set();
        const list = [];
        for (const s of students) {
            const name = s['이름'];
            if (!name || !(s['요일 및 시간'] || '').trim()) continue;
            if (seen.has(name)) continue;
            seen.add(name);
            list.push(name);
        }
        return list.sort((a, b) => a.localeCompare(b, 'ko'));
    }, [students]);

    // 빙의 대상 수강생의 등록행 — 오늘 날짜가 수강 기간 내인 행을 우선 선택
    const forceModeStudentData = useMemo(() => {
        if (mode !== 'studentForce' || !forceModeStudent || !students) return null;
        const matches = students.filter(s => s['이름'] === forceModeStudent && (s['요일 및 시간'] || '').trim());
        if (matches.length === 0) return null;
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        const active = matches.find(s => {
            const start = parseSheetDate(s['시작날짜']);
            const end = parseSheetDate(s['종료날짜']);
            if (!start || !end) return false;
            return start.getTime() <= now.getTime() && now.getTime() <= end.getTime();
        });
        return active || matches[0];
    }, [mode, forceModeStudent, students]);

    const isForceMode = mode === 'studentForce' && !!forceModeStudent && !!forceModeStudentData;

    // useScheduleCore에 넘길 effective user/studentData — 강제 모드일 때는 빙의 대상으로 치환
    const effectiveUser = useMemo(() => {
        if (isForceMode) return { username: forceModeStudent, role: 'student' };
        return user;
    }, [isForceMode, forceModeStudent, user]);
    const effectiveStudentData = isForceMode ? forceModeStudentData : studentData;

    // 코치/학생 공통 파생 데이터 + useWeeklyData 래핑
    const scheduleCore = useScheduleCore({ user: effectiveUser, students, mode, studentData: effectiveStudentData, refresh, pendingRegistrations });
    const {
        weekAbsences,
        weekWaitlist, setWeekWaitlist,
        loadWeeklyData,
        studentSchedule, scheduleData, weekDates,
        isMyHoldingDate,
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

    // 시간표 변경(직접 이동) 처리 중 플래그 — 화면 이탈 방지 + 로딩 UI
    const [isTransferring, setIsTransferring] = useState(false);
    useEffect(() => {
        if (!isTransferring) return;
        const handler = (e) => { e.preventDefault(); e.returnValue = ''; };
        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, [isTransferring]);

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
        if (!waitlistDesiredSlot || isTransferring) return;
        const period = PERIODS.find(p => p.id === waitlistDesiredSlot.period);
        if (!confirm(
            `시간표를 이동하시겠습니까?\n\n` +
            `${studentName}: ${currentSlot.day}요일 ${currentSlot.periodName} → ${waitlistDesiredSlot.day}요일 ${period?.name}\n\n` +
            `※ 영구적으로 시간표가 변경됩니다.`
        )) return;

        setIsTransferring(true);
        try {
            const studentEntry = students.find(s => s['이름'] === studentName && s['요일 및 시간']);
            if (!studentEntry) {
                alert('수강생 정보를 찾을 수 없습니다.');
                return;
            }

            const currentSchedule = studentEntry['요일 및 시간'];
            const newSchedule = buildUpdatedSchedule(currentSchedule, currentSlot, waitlistDesiredSlot);

            // D열(요일 및 시간) + H열(종료날짜) 동시 업데이트 — 스케줄 바뀌면 수업일 달라지므로 종료일 재계산 필요
            // 미래 등록 행이면 G열(시작날짜)도 자동 이동, 다음 등록(미리 등록)이 있으면 그쪽도 동일 적용
            const firebaseHolidays = await getHolidays().catch(() => []);
            const result = await processScheduleTransfer(studentName, newSchedule, firebaseHolidays, {
                preferredSheetName: studentEntry._foundSheetName,
                preferredRowIndex: studentEntry._rowIndex,
            });

            alert(`시간표 이동 완료!\n${studentName}: ${currentSchedule} → ${newSchedule}\n새 종료일: ${result.newEndDate}`);
            closeWaitlistModal();
            await refresh();
            await loadWeeklyData();
        } catch (error) {
            alert(`시간표 이동 실패: ${error.message}`);
            console.error('시간표 이동 실패:', error);
        } finally {
            setIsTransferring(false);
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

    const pageTitle = mode === 'coach'
        ? '코치 시간표'
        : mode === 'studentForce'
            ? (forceModeStudent ? `수강생 전용 — ${forceModeStudent}` : '수강생 전용 시간표')
            : '수강생 시간표';

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

    const containerModeClass = mode === 'studentForce' ? 'mode-student' : `mode-${mode}`;

    return (
        <div className={`schedule-container ${containerModeClass}`}>
            {isTransferring && (
                <div style={{
                    position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 9999,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                    <div style={{
                        backgroundColor: '#fff', padding: '24px 32px', borderRadius: '12px',
                        textAlign: 'center', maxWidth: '320px', boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
                    }}>
                        <div className="loading-spinner" style={{ margin: '0 auto 16px' }} />
                        <div style={{ fontSize: '1rem', fontWeight: 'bold', color: '#111827', marginBottom: '8px' }}>
                            시간표를 변경하고 있습니다
                        </div>
                        <div style={{ fontSize: '0.85rem', color: '#6b7280', lineHeight: '1.5' }}>
                            처리가 끝날 때까지<br/>화면을 닫지 말고 잠시 기다려주세요.
                        </div>
                    </div>
                </div>
            )}
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
                        onClick={() => { setMode('student'); setForceModeStudent(''); }}
                    >
                        신규 전용
                    </button>
                    <button
                        className={`mode-toggle ${mode === 'coach' ? 'active' : ''}`}
                        onClick={() => { setMode('coach'); setForceModeStudent(''); }}
                    >
                        코치 전용
                    </button>
                    <button
                        className={`mode-toggle ${mode === 'studentForce' ? 'active' : ''}`}
                        onClick={() => setMode('studentForce')}
                    >
                        수강생 전용
                    </button>
                </div>
            )}

            {/* 수강생 전용 모드 — 수강생 선택 및 강제 모드 안내 */}
            {user?.role === 'coach' && mode === 'studentForce' && (
                <div style={{
                    margin: '0 0 12px',
                    padding: '12px 14px',
                    borderRadius: '8px',
                    backgroundColor: '#fef2f2',
                    border: '1px solid #fecaca',
                    fontSize: '0.88rem',
                    color: '#7f1d1d',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <strong>수강생 선택:</strong>
                        <select
                            value={forceModeStudent}
                            onChange={e => setForceModeStudent(e.target.value)}
                            style={{
                                padding: '4px 8px',
                                fontSize: '0.9rem',
                                border: '1px solid #fca5a5',
                                borderRadius: '4px',
                                backgroundColor: '#fff',
                                minWidth: '160px'
                            }}
                        >
                            <option value="">-- 선택 --</option>
                            {studentForceCandidates.map(name => (
                                <option key={name} value={name}>{name}</option>
                            ))}
                        </select>
                        {forceModeStudent && (
                            <button
                                onClick={() => setForceModeStudent('')}
                                style={{
                                    padding: '4px 10px',
                                    fontSize: '0.8rem',
                                    border: '1px solid #fca5a5',
                                    borderRadius: '4px',
                                    backgroundColor: '#fff',
                                    color: '#7f1d1d',
                                    cursor: 'pointer'
                                }}
                            >
                                선택 해제
                            </button>
                        )}
                    </div>
                    <div style={{ fontSize: '0.82rem', lineHeight: '1.5' }}>
                        ⚠️ <strong>강제 모드</strong> — 보강 신청/취소 시 시간 데드라인(2시간/1시간), 주 1회 제한, 홀딩 기간 제약을 무시합니다.<br />
                        수강생을 선택하면 해당 수강생의 시간표가 나타나고, 코치가 그 수강생을 대신해 보강을 처리할 수 있습니다.
                    </div>
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
                    studentData={effectiveStudentData}
                    isMyHoldingDate={isMyHoldingDate}
                    isMakeupHeld={isMakeupHeld}
                    getCellData={getCellData}
                    getHolidayInfo={getHolidayInfo}
                    loadWeeklyData={loadWeeklyData}
                    refreshStudents={refresh}
                    isClassDisabled={isClassDisabled}
                    isSlotLocked={isSlotLocked}
                    newStudentWaitlist={newStudentWaitlist}
                    onCoachCellClick={handleCoachWaitlistCellClick}
                />
            )}

            {/* 수강생 전용(강제) 모드 — 코치가 빙의 대상 학생의 시간표를 렌더하고 데드라인 없이 보강 처리 */}
            {mode === 'studentForce' && !forceModeStudent && (
                <div style={{
                    padding: '24px',
                    textAlign: 'center',
                    color: '#6b7280',
                    backgroundColor: '#fff',
                    border: '1px dashed #d1d5db',
                    borderRadius: '8px',
                    fontSize: '0.9rem'
                }}>
                    위 드롭다운에서 수강생을 선택하면 시간표가 표시됩니다.
                </div>
            )}
            {mode === 'studentForce' && forceModeStudent && !isForceMode && (
                <div style={{
                    padding: '24px',
                    textAlign: 'center',
                    color: '#991b1b',
                    backgroundColor: '#fef2f2',
                    border: '1px solid #fecaca',
                    borderRadius: '8px',
                    fontSize: '0.9rem'
                }}>
                    <strong>{forceModeStudent}</strong>님의 수강 정보를 찾을 수 없습니다.<br />
                    Google Sheets에서 시간표(요일 및 시간) 컬럼이 비어 있거나 등록행이 누락된 상태일 수 있습니다.
                </div>
            )}
            {mode === 'studentForce' && isForceMode && (
                <StudentSchedule
                    user={effectiveUser}
                    mode="student"
                    students={students}
                    weekDates={weekDates}
                    weekAbsences={weekAbsences}
                    weekWaitlist={weekWaitlist}
                    studentSchedule={studentSchedule}
                    studentData={effectiveStudentData}
                    isMyHoldingDate={isMyHoldingDate}
                    isMakeupHeld={isMakeupHeld}
                    getCellData={getCellData}
                    getHolidayInfo={getHolidayInfo}
                    loadWeeklyData={loadWeeklyData}
                    refreshStudents={refresh}
                    isClassDisabled={isClassDisabled}
                    isSlotLocked={isSlotLocked}
                    forceMode={true}
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
