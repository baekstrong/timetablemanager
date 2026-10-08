import { useState } from 'react';
import { getNotificationDeadline } from '../../utils/makeupWaitlist';

/**
 * 보강 대기 수락/거절 모달 — notified 상태 칩 클릭 시 표시.
 * entry: 정규화된 makeupWaitlists 항목 (notifiedAtMs 포함)
 */
export default function MakeupWaitlistResponseModal({ entry, isSubmitting, onAccept, onDecline, onClose }) {
    const deadline = getNotificationDeadline(entry);
    const [openedAtMs] = useState(() => Date.now()); // 모달 오픈 시점 기준 잔여 시간 표시
    const remainMin = deadline ? Math.max(0, Math.floor((deadline.getTime() - openedAtMs) / 60000)) : 0;

    return (
        <div className="makeup-modal-overlay" onClick={onClose}>
            <div className="makeup-modal" onClick={(e) => e.stopPropagation()}>
                <h2>보강 자리 수락</h2>
                <p className="makeup-modal-subtitle">
                    대기하신 <strong>{entry.date} {entry.day}요일 {entry.periodName}</strong> 수업에 자리가 났습니다.
                </p>
                <div style={{
                    margin: '0 0 12px', padding: '10px 12px', borderRadius: '8px',
                    backgroundColor: '#329BE71A', border: '1px solid #329BE74D',
                    color: '#327AB8', fontSize: '0.86rem', lineHeight: 1.5,
                }}>
                    수락하면 <strong>{entry.originalClass.day}요일 {entry.originalClass.periodName}</strong>({entry.originalClass.date}) 수업이
                    이 시간으로 이동(보강 확정)됩니다.<br />
                    남은 수락 가능 시간: <strong>약 {remainMin}분</strong>
                </div>
                <div className="makeup-modal-actions">
                    <button className="btn-cancel" onClick={onDecline} disabled={isSubmitting}>
                        거절 (다음 순번에게)
                    </button>
                    <button className="btn-submit" onClick={onAccept} disabled={isSubmitting}>
                        {isSubmitting ? '처리 중...' : '수락 — 보강 확정'}
                    </button>
                </div>
                <button
                    onClick={onClose}
                    style={{ width: '100%', marginTop: '8px', padding: '8px', border: 'none', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.85rem' }}
                >
                    나중에 결정하기
                </button>
            </div>
        </div>
    );
}
