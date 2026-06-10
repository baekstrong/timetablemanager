import { PERIODS, MAX_CAPACITY } from '../../data/mockData';
import {
    cancelWaitlistRequest,
    notifyWaitlistRequest,
    revertWaitlistNotification,
    deleteNewStudentRegistration,
} from '../../services/firebaseService';

const SECTION_STYLES_WAITLIST = {
    background: '#EDBC401A',
    border: '1px solid #EDBC404D',
    borderRadius: '12px',
    padding: '1rem 1.25rem',
    marginBottom: '1rem',
};

const DELETE_BTN_STYLE = {
    fontSize: '0.75rem',
    padding: '2px 8px',
    borderRadius: '4px',
    border: '1px solid #E94E58',
    background: '#E94E581A',
    color: '#E94E58',
    cursor: 'pointer',
    fontWeight: '600',
};

export default function CoachWaitlistPanel({
    weekWaitlist,
    setWeekWaitlist,
    newStudentWaitlist,
    setNewStudentWaitlist,
    showWaitlistDeleteMode,
    setShowWaitlistDeleteMode,
    scheduleData,
}) {
    return (
        <section style={SECTION_STYLES_WAITLIST}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <div style={{ fontWeight: '700', fontSize: '1rem', color: '#9a7a12' }}>
                    시간표 대기 현황 <span style={{ fontSize: '0.85rem', fontWeight: '500' }}>({weekWaitlist.length + newStudentWaitlist.length}명)</span>
                </div>
                <button
                    onClick={() => setShowWaitlistDeleteMode(prev => !prev)}
                    style={{
                        fontSize: '0.75rem',
                        padding: '3px 8px',
                        borderRadius: '4px',
                        border: showWaitlistDeleteMode ? '1px solid #E94E58' : '1px solid #EDBC404D',
                        background: showWaitlistDeleteMode ? '#E94E581A' : 'transparent',
                        color: showWaitlistDeleteMode ? '#E94E58' : '#9a7a12',
                        cursor: 'pointer',
                        fontWeight: '600'
                    }}
                >
                    {showWaitlistDeleteMode ? '완료' : '삭제'}
                </button>
            </div>
            <div style={{ color: '#9a7a12', fontSize: '0.9rem', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                {weekWaitlist.map(w => {
                    const desiredP = PERIODS.find(p => p.id === w.desiredSlot.period);
                    const currentP = PERIODS.find(p => p.id === w.currentSlot.period);
                    const slot = scheduleData.regularEnrollments.find(
                        e => e.day === w.desiredSlot.day && e.period === w.desiredSlot.period
                    );
                    const hasSpace = (slot ? slot.names.length : 0) < MAX_CAPACITY;
                    return (
                        <div key={w.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span>
                                {w.studentName}
                                <span style={{ fontSize: '0.8rem', color: '#9a7a12', marginLeft: '4px' }}>
                                    {w.currentSlot.day}{currentP ? currentP.id : w.currentSlot.period}교시 → {w.desiredSlot.day}{desiredP ? desiredP.id : w.desiredSlot.period}교시
                                </span>
                                <span style={{ fontSize: '0.75rem', color: '#9a7a12', marginLeft: '4px' }}>
                                    ({w.status === 'waiting' ? '대기중' : w.status === 'notified' ? '승인완료' : w.status})
                                </span>
                            </span>
                            <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                                {w.status === 'waiting' && (
                                    <button
                                        onClick={async () => {
                                            try {
                                                await notifyWaitlistRequest(w.id);
                                                setWeekWaitlist(prev => prev.map(item =>
                                                    item.id === w.id ? { ...item, status: 'notified' } : item
                                                ));
                                            } catch (err) {
                                                alert('승인 실패: ' + err.message);
                                            }
                                        }}
                                        disabled={!hasSpace}
                                        style={{
                                            fontSize: '0.75rem', padding: '2px 8px', borderRadius: '4px',
                                            border: hasSpace ? '1px solid #31A5524D' : '1px solid #9ca3af',
                                            background: hasSpace ? '#31A5521A' : '#F7F7F8',
                                            color: hasSpace ? '#2a8f46' : '#9ca3af',
                                            cursor: hasSpace ? 'pointer' : 'not-allowed',
                                            fontWeight: '600'
                                        }}
                                    >
                                        {hasSpace ? '승인' : '승인(만석)'}
                                    </button>
                                )}
                                {w.status === 'notified' && (
                                    <>
                                        <span style={{
                                            fontSize: '0.75rem', padding: '2px 8px', borderRadius: '4px',
                                            background: '#329BE71A', color: '#327AB8', fontWeight: '600'
                                        }}>
                                            수락중...
                                        </span>
                                        <button
                                            onClick={async () => {
                                                try {
                                                    await revertWaitlistNotification(w.id);
                                                    setWeekWaitlist(prev => prev.map(item =>
                                                        item.id === w.id ? { ...item, status: 'waiting' } : item
                                                    ));
                                                } catch (err) {
                                                    alert('승인 취소 실패: ' + err.message);
                                                }
                                            }}
                                            style={DELETE_BTN_STYLE}
                                        >
                                            취소
                                        </button>
                                    </>
                                )}
                                {showWaitlistDeleteMode && (
                                    <button
                                        onClick={async () => {
                                            if (!confirm(`"${w.studentName}"의 대기 신청을 삭제하시겠습니까?`)) return;
                                            try {
                                                await cancelWaitlistRequest(w.id);
                                                setWeekWaitlist(prev => prev.filter(item => item.id !== w.id));
                                            } catch (err) {
                                                alert('삭제 실패: ' + err.message);
                                            }
                                        }}
                                        style={DELETE_BTN_STYLE}
                                    >
                                        삭제
                                    </button>
                                )}
                            </div>
                        </div>
                    );
                })}
                {newStudentWaitlist.map(r => {
                    const slots = r.requestedSlots || [];
                    const slotStr = slots.length > 0
                        ? slots.map(s => `${s.day}${s.period}`).join('')
                        : (r.scheduleString || '');
                    return (
                        <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span>
                                {r.name}
                                <span style={{ fontSize: '0.8rem', color: '#9a7a12', marginLeft: '4px' }}>{slotStr}</span>
                                <span style={{ fontSize: '0.75rem', color: '#9a7a12', marginLeft: '4px', fontWeight: '600' }}>(신규대기)</span>
                            </span>
                            {showWaitlistDeleteMode && (
                                <button
                                    onClick={async () => {
                                        if (!confirm(`"${r.name}"의 신규 대기 신청을 삭제하시겠습니까?`)) return;
                                        try {
                                            await deleteNewStudentRegistration(r.id);
                                            setNewStudentWaitlist(prev => prev.filter(item => item.id !== r.id));
                                        } catch (err) {
                                            alert('삭제 실패: ' + err.message);
                                        }
                                    }}
                                    style={{ ...DELETE_BTN_STYLE, flexShrink: 0 }}
                                >
                                    삭제
                                </button>
                            )}
                        </div>
                    );
                })}
            </div>
        </section>
    );
}
