import { useState, useEffect } from 'react';
import { useGoogleSheets } from '../contexts/GoogleSheetsContext';
import {
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
import CoachWaitlistPanel from './schedule/CoachWaitlistPanel';
import CoachWaitlistModal from './schedule/CoachWaitlistModal';
import StudentSchedule from './schedule/StudentSchedule';
import { StudentTag } from './schedule/ScheduleCell';
import { SECTION_STYLES } from './schedule/scheduleStyles';
import { useScheduleCore } from './schedule/useScheduleCore';
import {
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

    function isClassDisabled(day, periodId) {
        return disabledClasses.includes(`${day}-${periodId}`);
    }

    function isSlotLocked(day, periodId) {
        return lockedSlots.includes(`${day}-${periodId}`);
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

    // 코치 모드: 셀 클릭 시 훈련일지로 이동
    function handleCoachModeCellClick(cellData) {
        const attendingStudents = [
            ...cellData.activeStudents,
            ...cellData.makeupStudents,
            ...cellData.subs.map(s => s.name)
        ];
        localStorage.setItem('coachSelectedStudents', JSON.stringify(attendingStudents));
        window.location.href = './training-log/index.html';
    }

    // 학생 뷰에서 코치가 셀 클릭: 대기/직접 이동 모달 오픈
    function handleCoachWaitlistCellClick(day, periodId, cellData) {
        setWaitlistDesiredSlot({ day, period: periodId });
        setIsDirectTransfer(!cellData.isFull);
        setShowWaitlistModal(true);
    }

    // ── Cell rendering ──

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
                onClick={() => handleCoachModeCellClick(data)}
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

            {/* Coach mode: banners + waitlist panel + grid + legend */}
            {mode === 'coach' && (
                <>
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

                    {(weekWaitlist.length > 0 || newStudentWaitlist.length > 0) && (
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
                                        {period.type === 'free'
                                            ? <div className="schedule-cell cell-free">자율 운동</div>
                                            : renderCoachCell(day, period)}
                                    </div>
                                ))}
                            </>
                        ))}
                    </div>

                    <div className="legend">
                        <div className="legend-item"><span className="student-tag" style={{ fontSize: '0.8rem' }}>김철수</span> 출석 예정</div>
                        <div className="legend-item"><span className="student-tag substitute" style={{ fontSize: '0.8rem' }}>이영희(보강)</span> 보강/대타</div>
                        <div className="legend-item"><span className="student-tag" style={{ fontSize: '0.8rem', backgroundColor: '#fee2e2', textDecoration: 'line-through' }}>박민수</span> 결석/홀딩</div>
                    </div>
                </>
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
