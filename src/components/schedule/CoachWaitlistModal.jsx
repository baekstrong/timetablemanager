import { PERIODS } from '../../data/mockData';
import { parseScheduleString } from '../../utils/scheduleUtils';

export default function CoachWaitlistModal({
    waitlistDesiredSlot,
    isDirectTransfer,
    weekWaitlist,
    students,
    waitlistStudentName,
    setWaitlistStudentName,
    waitlistStudentSearch,
    setWaitlistStudentSearch,
    onDirectTransfer,
    onWaitlistSubmit,
    onWaitlistCancel,
    onClose,
}) {
    return (
        <div className="makeup-modal-overlay" onClick={onClose}>
            <div className="makeup-modal" onClick={(e) => e.stopPropagation()} style={{ maxHeight: '80vh', overflowY: 'auto' }}>
                <h2>{isDirectTransfer ? '시간표 이동' : '대기 등록'}</h2>
                <p className="makeup-modal-subtitle">
                    목표: <strong>{waitlistDesiredSlot.day}요일 {PERIODS.find(p => p.id === waitlistDesiredSlot.period)?.name}</strong>
                    {isDirectTransfer ? ' (여석 있음)' : ' (만석)'}
                </p>
                <p style={{ fontSize: '0.85rem', color: '#666', margin: '4px 0 12px' }}>
                    {isDirectTransfer
                        ? '수강생을 선택하면 시간표가 즉시 변경됩니다'
                        : '자리가 나면 수강생에게 알림 → 수락 시 시간표 영구 변경'}
                </p>

                {/* Existing waiters (waitlist mode only) */}
                {!isDirectTransfer && (() => {
                    const existingWaiters = weekWaitlist.filter(w =>
                        w.desiredSlot.day === waitlistDesiredSlot.day &&
                        w.desiredSlot.period === waitlistDesiredSlot.period
                    );
                    if (existingWaiters.length === 0) return null;
                    return (
                        <div style={{ marginBottom: '12px', padding: '8px 12px', borderRadius: '6px', backgroundColor: '#fffbeb', border: '1px solid #fde68a' }}>
                            <div style={{ fontSize: '0.85rem', fontWeight: 'bold', color: '#92400e', marginBottom: '4px' }}>현재 대기 ({existingWaiters.length}명)</div>
                            {existingWaiters.map(w => (
                                <div key={w.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem', padding: '2px 0' }}>
                                    <span>{w.studentName} ({w.currentSlot.day}{w.currentSlot.period} → {w.desiredSlot.day}{w.desiredSlot.period})</span>
                                    <button onClick={() => onWaitlistCancel(w.id)} style={{ fontSize: '0.75rem', padding: '2px 6px', border: '1px solid #d97706', borderRadius: '4px', backgroundColor: 'transparent', color: '#b45309', cursor: 'pointer' }}>취소</button>
                                </div>
                            ))}
                        </div>
                    );
                })()}

                {/* Student search */}
                <div className="makeup-modal-content">
                    <h3>수강생 선택</h3>
                    <input
                        type="text"
                        placeholder="수강생 이름 검색..."
                        value={waitlistStudentSearch}
                        onChange={(e) => { setWaitlistStudentSearch(e.target.value); setWaitlistStudentName(''); }}
                        style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.9rem', marginBottom: '8px', boxSizing: 'border-box' }}
                    />
                    {waitlistStudentSearch && !waitlistStudentName && (
                        <div style={{ maxHeight: '120px', overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: '6px', marginBottom: '8px' }}>
                            {(() => {
                                const uniqueNames = [...new Set(students.filter(s => s['요일 및 시간']).map(s => s['이름']))];
                                const filtered = uniqueNames.filter(name => name && name.includes(waitlistStudentSearch));
                                if (filtered.length === 0) return <div style={{ padding: '8px 12px', color: '#9ca3af', fontSize: '0.85rem' }}>검색 결과 없음</div>;
                                return filtered.map(name => (
                                    <div key={name}
                                        onClick={() => { setWaitlistStudentName(name); setWaitlistStudentSearch(name); }}
                                        style={{ padding: '6px 12px', cursor: 'pointer', fontSize: '0.9rem', borderBottom: '1px solid #f3f4f6' }}
                                        onMouseEnter={(e) => e.target.style.backgroundColor = '#f0f9ff'}
                                        onMouseLeave={(e) => e.target.style.backgroundColor = 'transparent'}
                                    >
                                        {name}
                                    </div>
                                ));
                            })()}
                        </div>
                    )}

                    {/* Selected student's class list */}
                    {waitlistStudentName && (
                        <>
                            <h3 style={{ marginTop: '8px' }}>{waitlistStudentName}님의 수업 중 옮길 수업 선택</h3>
                            <div className="original-class-list">
                                {(() => {
                                    const studentEntry = students.find(s => s['이름'] === waitlistStudentName && s['요일 및 시간']);
                                    if (!studentEntry) return <div style={{ padding: '8px', color: '#999' }}>수강생 정보를 찾을 수 없습니다.</div>;
                                    const parsed = parseScheduleString(studentEntry['요일 및 시간']);
                                    if (parsed.length === 0) return <div style={{ padding: '8px', color: '#999' }}>등록된 수업이 없습니다.</div>;

                                    return parsed.map((schedule, index) => {
                                        const periodInfo = PERIODS.find(p => p.id === schedule.period);
                                        const isSameSlot = schedule.day === waitlistDesiredSlot.day && schedule.period === waitlistDesiredSlot.period;
                                        const alreadyWaiting = !isDirectTransfer && weekWaitlist.some(w =>
                                            w.studentName === waitlistStudentName &&
                                            w.desiredSlot.day === waitlistDesiredSlot.day &&
                                            w.desiredSlot.period === waitlistDesiredSlot.period
                                        );
                                        const isDisabled = isSameSlot || alreadyWaiting;

                                        return (
                                            <div key={index}
                                                className={`original-class-item ${isDisabled ? 'disabled' : ''}`}
                                                style={isDisabled ? { opacity: 0.5, cursor: 'not-allowed', backgroundColor: '#f3f4f6' } : {}}
                                                onClick={() => {
                                                    if (isDisabled) return;
                                                    const slotData = {
                                                        day: schedule.day,
                                                        period: schedule.period,
                                                        periodName: periodInfo?.name || ''
                                                    };
                                                    if (isDirectTransfer) {
                                                        onDirectTransfer(waitlistStudentName, slotData);
                                                    } else {
                                                        onWaitlistSubmit(waitlistStudentName, slotData);
                                                    }
                                                }}
                                            >
                                                <span className="period-name">{schedule.day}요일 {periodInfo?.name}</span>
                                                {isSameSlot && <span style={{ fontSize: '0.8em', color: '#999', marginLeft: '8px' }}>같은 시간</span>}
                                                {alreadyWaiting && <span style={{ fontSize: '0.8em', color: '#d97706', marginLeft: '8px' }}>이미 대기 중</span>}
                                            </div>
                                        );
                                    });
                                })()}
                            </div>
                        </>
                    )}
                </div>

                <div className="makeup-modal-actions">
                    <button className="btn-cancel" onClick={onClose}>닫기</button>
                </div>
            </div>
        </div>
    );
}
