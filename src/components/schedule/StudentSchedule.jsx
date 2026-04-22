import { useState, useMemo, useEffect } from 'react';
import { PERIODS, DAYS, MAX_CAPACITY } from '../../data/mockData';
import {
    getActiveMakeupRequests,
    getWeekMakeupRequests,
    createMakeupRequest,
    cancelMakeupRequest,
    completeMakeupRequest,
} from '../../services/firebaseService';
import {
    weekDateToISO,
    isClassWithinMinutes,
    getThisWeekRange,
    getWaitlistCountForSlot,
} from '../../utils/scheduleUtils';
import MakeupModal from './MakeupModal';
import { StudentTag, AvailableSeatsCell, HolidayCell } from './ScheduleCell';

/**
 * 학생 모드(mode === 'student') 화면 전체를 렌더.
 * 실제 학생(user.role === 'student')과 코치의 "신규 전용" 뷰(user.role === 'coach' && mode === 'student') 모두 처리.
 *
 * 코치의 신규 전용 뷰에서의 셀 클릭(만석/여석 → 대기/직접 이동)은 부모의 CoachWaitlistModal에 위임하기 위해
 * onCoachCellClick 콜백으로 올려보낸다.
 */
export default function StudentSchedule({
    user,
    mode,
    students,
    // scheduleCore 파생 데이터
    weekDates,
    weekAbsences,
    weekWaitlist,
    studentSchedule,
    isMakeupHeld,
    getCellData,
    getHolidayInfo,
    loadWeeklyData,
    // 셀 상태 판정
    isClassDisabled,
    isSlotLocked,
    // 코치 신규 전용 연동
    newStudentWaitlist,
    onCoachCellClick,
}) {
    // ── 학생 전용 state ──
    const [showMakeupModal, setShowMakeupModal] = useState(false);
    const [selectedMakeupSlot, setSelectedMakeupSlot] = useState(null);
    const [selectedOriginalClass, setSelectedOriginalClass] = useState(null);
    // 이번 주 보강 이력 (cancelled 포함 — 주 1회 쿼터 계산용)
    const [myWeekMakeupHistory, setMyWeekMakeupHistory] = useState([]);
    // 활성/완료 보강만 — 그리드/패널 렌더링용
    const activeMakeupRequests = useMemo(
        () => myWeekMakeupHistory.filter(m => m.status !== 'cancelled'),
        [myWeekMakeupHistory]
    );
    const [isSubmittingMakeup, setIsSubmittingMakeup] = useState(false);

    // ── 보강 데이터 로드 ──
    useEffect(() => {
        if (user?.role === 'coach') return;

        async function loadStudentMakeupData() {
            try {
                // 지난 보강 자동 완료 처리 (active → completed)
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

                const { start, end } = getThisWeekRange();
                const thisWeekMakeups = await getWeekMakeupRequests(user.username, start, end);
                setMyWeekMakeupHistory(thisWeekMakeups);
            } catch (error) {
                console.error('Failed to load student makeup data:', error);
            }
        }
        loadStudentMakeupData();
    }, [user]);

    // ── 헬퍼 ──
    function isMyClass(day, periodId) {
        return studentSchedule.some(s => s.day === day && s.period === periodId);
    }

    async function reloadStudentMakeups() {
        const { start, end } = getThisWeekRange();
        const thisWeekMakeups = await getWeekMakeupRequests(user.username, start, end);
        setMyWeekMakeupHistory(thisWeekMakeups);
    }

    // ── 핸들러 ──
    function handleAvailableSeatClick(day, periodId, date) {
        if (user?.role === 'coach') return;

        if (isSlotLocked(day, periodId)) {
            alert('해당 시간은 코치에 의해 보강이 차단되었습니다.');
            return;
        }

        // 주횟수와 무관하게 당주 최대 1회까지 보강 신청 (취소 내역도 소진으로 간주)
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

    function handleCellClick(day, periodObj, cellData) {
        if (periodObj.type === 'free') return;

        if (user?.role === 'coach') {
            onCoachCellClick?.(day, periodObj.id, cellData);
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
    }

    // ── 셀 렌더 ──
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

        // Makeup status for this cell
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

        // My class
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

    function renderCell(day, periodObj) {
        if (periodObj.type === 'free') {
            return <div className="schedule-cell cell-free">자율 운동</div>;
        }
        return renderStudentCell(day, periodObj);
    }

    // ── Render ──
    const isRealStudent = user?.role !== 'coach';

    return (
        <>
            {/* Student usage guide */}
            {isRealStudent && (
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
                            · 주횟수와 무관하게 당주 <strong>최대 1회</strong>까지 신청 가능
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
                {isRealStudent ? (
                    <>
                        <div className="legend-item"><span className="legend-color" style={{ background: '#ef4444' }}></span> 만석 (대기 가능)</div>
                        <div className="legend-item"><span className="legend-color" style={{ background: 'white', border: '1px solid #ccc' }}></span> 신청 가능 (숫자: 여석)</div>
                        <div className="legend-item"><span className="legend-color" style={{ background: '#f59e0b' }}></span> 자율 운동</div>
                    </>
                ) : (
                    <>
                        <div className="legend-item"><span className="legend-color" style={{ background: 'white', border: '1px solid #ccc' }}></span> 여석 있음 (클릭: 시간표 이동)</div>
                        <div className="legend-item"><span className="legend-color" style={{ background: '#ef4444' }}></span> 만석 (클릭: 대기 등록)</div>
                    </>
                )}
            </div>

            {/* Makeup Request Modal (real student only) */}
            {showMakeupModal && isRealStudent && selectedMakeupSlot && (
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

            {/* Active makeup banners */}
            {isRealStudent && activeMakeupRequests.length > 0 && (
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
        </>
    );
}
