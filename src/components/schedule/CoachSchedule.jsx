import { PERIODS, DAYS } from '../../data/mockData';
import { toggleDisabledClass, toggleLockedSlot } from '../../services/firebaseService';
import { weekDateToISO, getWaitlistCountForSlot } from '../../utils/scheduleUtils';
import CoachWaitlistPanel from './CoachWaitlistPanel';
import { StudentTag } from './ScheduleCell';
import { SECTION_STYLES } from './scheduleStyles';

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

/**
 * 코치 전용 시간표 화면.
 * - 마지막 수업/재등록 지연 배너
 * - 대기 관리 패널
 * - 코치 셀 그리드 (수강생 태그, 수업 활성/비활성 토글, 보강 잠금)
 * - 셀 클릭 시 훈련일지로 이동
 */
export default function CoachSchedule({
    scheduleData,
    weekDates,
    weekWaitlist,
    setWeekWaitlist,
    lastDayStudents,
    delayedReregistrationStudents,
    getCellData,
    getHolidayInfo,
    newStudentWaitlist,
    setNewStudentWaitlist,
    showWaitlistDeleteMode,
    setShowWaitlistDeleteMode,
    disabledClasses,
    setDisabledClasses,
    lockedSlots,
    setLockedSlots,
    onNavigate,
}) {
    // ── 헬퍼 ──
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

    // 셀 클릭 → 훈련일지 페이지로 이동 (수업 참석자 localStorage로 전달)
    function handleCellClickToTrainingLog(cellData) {
        const attendingStudents = [
            ...cellData.activeStudents,
            ...cellData.makeupStudents,
            ...cellData.subs.map(s => s.name)
        ];
        localStorage.setItem('coachSelectedStudents', JSON.stringify(attendingStudents));
        window.location.href = './training-log/index.html';
    }

    // ── 셀 렌더 ──
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
                onClick={() => handleCellClickToTrainingLog(data)}
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

    return (
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
    );
}
