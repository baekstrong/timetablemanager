import { useEffect, useRef, useState } from 'react';
import { MAX_CAPACITY } from '../../data/mockData';
import { cancelWaitlistRequest, notifyWaitlistRequest, revertWaitlistNotification } from '../../services/firebaseService';
import { acceptScheduleTransfer } from '../../services/scheduleTransferService';
import { ActionButton } from '../../features/today/TodayViews';
import ReviewModal from '../../features/today/ReviewModal';
import './ScheduleTransferPanel.css';

export default function ScheduleTransferPanel({ entries = [], coach = false, studentName, studentData, scheduleData, ready = false, onUpdate, onRefresh }) {
    const [busyId, setBusyId] = useState(null);
    const [error, setError] = useState('');
    const lock = useRef(false);
    const visible = entries.filter(item => ['waiting', 'notified'].includes(item.status) && (coach || item.studentName === studentName));
    useEffect(() => {
        if (!busyId) return;
        const handler = event => { event.preventDefault(); event.returnValue = ''; };
        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, [busyId]);

    async function act(entry, action) {
        if (lock.current || !ready) return;
        const message = action === 'accept'
            ? `${entry.currentSlot.day}${entry.currentSlot.period}교시 → ${entry.desiredSlot.day}${entry.desiredSlot.period}교시로 고정 시간표를 변경하시겠습니까?\n승인하면 앞으로의 수업 시간표와 종료일이 변경됩니다.`
            : action === 'cancel' ? (entry.status === 'notified' ? '시간표 변경을 거절하시겠습니까?' : '시간표 변경 대기를 취소하시겠습니까?') : '';
        if (message && !confirm(message)) return;
        lock.current = true;
        setBusyId(entry.id); setError('');
        try {
            let status;
            if (action === 'accept') {
                const result = await acceptScheduleTransfer(studentName, entry.id, studentData);
                status = 'accepted';
                alert(`시간표 변경 완료!\n${result.currentSchedule} → ${result.newSchedule}\n새 종료일: ${result.newEndDate}`);
            } else if (action === 'approve') { await notifyWaitlistRequest(entry.id); status = 'notified'; }
            else if (action === 'revert') { await revertWaitlistNotification(entry.id); status = 'waiting'; }
            else { await cancelWaitlistRequest(entry.id); status = 'cancelled'; }
            onUpdate(entry.id, status);
            if (action === 'accept') await onRefresh?.();
        } catch (reason) { setError(reason.message || '처리하지 못했습니다. 다시 시도해주세요.'); }
        finally { lock.current = false; setBusyId(null); }
    }

    if (!visible.length && !error) return null;
    return <section className="today-card transfer-panel" aria-label="시간표 변경 대기">
        <div className="today-section-title"><h2>시간표 변경 대기</h2><span className="today-count">{visible.length}</span></div>
        {error && <p className="today-error" role="alert">{error}</p>}
        {visible.map(entry => {
            const slot = scheduleData?.regularEnrollments.find(item => item.day === entry.desiredSlot.day && Number(item.period) === Number(entry.desiredSlot.period));
            const hasSpace = ready && Boolean(scheduleData) && (slot?.names.length || 0) < MAX_CAPACITY;
            const disabled = Boolean(busyId) || !ready;
            return <div className="transfer-row" key={entry.id}>
                <div className="transfer-detail">{coach && <strong>{entry.studentName}</strong>}<p>{entry.currentSlot.day}{entry.currentSlot.period}교시 → {entry.desiredSlot.day}{entry.desiredSlot.period}교시</p>
                    <span className={`transfer-status${entry.status === 'notified' ? ' is-approved' : ''}`}>{entry.status === 'waiting' ? '대기 중' : coach ? '수강생 승인 대기' : '코치 승인 완료'}</span>
                    {!coach && <p className="today-muted">{entry.status === 'waiting' ? '코치 승인 후 여기에서 시간표 변경을 승인할 수 있어요.' : '승인하면 고정 시간표가 변경돼요.'}</p>}
                </div>
                <div className="today-actions transfer-actions">{coach ? entry.status === 'waiting'
                    ? <ActionButton pending disabled={disabled || !hasSpace} onClick={() => act(entry, 'approve')}>{!ready ? '확인 중' : hasSpace ? '승인' : '만석'}</ActionButton>
                    : <ActionButton disabled={disabled} onClick={() => act(entry, 'revert')}>승인 취소</ActionButton>
                    : <><ActionButton disabled={disabled} onClick={() => act(entry, 'cancel')}>{entry.status === 'notified' ? '거절' : '대기 취소'}</ActionButton>{entry.status === 'notified' && <ActionButton primary disabled={disabled} onClick={() => act(entry, 'accept')}>승인</ActionButton>}</>}
                </div>
            </div>;
        })}
        {busyId && <ReviewModal title={coach ? '승인 상태를 저장하고 있습니다' : '시간표 변경을 처리하고 있습니다'} busy onClose={() => {}}><p role="status">처리가 끝날 때까지 화면을 닫지 말고 잠시 기다려주세요.</p></ReviewModal>}
    </section>;
}
