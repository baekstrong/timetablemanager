import { monthLabel } from '../utils/recruitment';
import { PERIODS } from '../data/mockData';
import { slotsToString } from '../utils/newStudentWaitlist';

const slotLabel = ({ day, period }) => `${day} ${PERIODS.find(p => p.id === Number(period))?.name || `${period}교시`}`;

// 모집을 접수중으로 바꾼 직후: 그 달 모집 대기자와 희망 시간 자리 여부. 문자는 자동으로 보내지 않고 코치가 직접 안내한다.
export default function MonthWaitlistNotice({ month, rows, onClose, onOpenList }) {
    const withSeat = rows.filter(r => r.hasSeat).length;
    return <div className="cns-modal-overlay" onClick={onClose}>
        <div className="cns-modal cns-month-notice" onClick={e => e.stopPropagation()} role="dialog" aria-label={`${monthLabel(month)} 모집 대기 안내`}>
            <h3>{monthLabel(month)} 모집 대기 {rows.length}명</h3>
            <p className="cns-modal-sub">희망 시간에 지금 자리가 있는 사람 <strong>{withSeat}명</strong> — 직접 연락해 안내해주세요. 문자는 자동으로 나가지 않습니다.</p>
            <ol className="cns-month-notice-list">
                {rows.map(({ reg, order, hasSeat, availableSlots }) => <li key={reg.id} className={hasSeat ? 'has-seat' : ''}>
                    <div className="cns-month-notice-head">
                        <span className="cns-wait-order">{order}</span>
                        <strong>{reg.name}</strong>
                        <span className="cns-month-notice-meta">주{reg.weeklyFrequency}회 · {reg.phone}</span>
                        <span className={`cns-badge ${hasSeat ? 'seat-open' : 'seat-none'}`}>{hasSeat ? '자리 있음' : '자리 없음'}</span>
                    </div>
                    <div className="cns-month-notice-slots">희망 {slotsToString(reg.requestedSlots || [])}
                        {hasSeat && <> · 가능 {availableSlots.map(slotLabel).join(', ')}</>}</div>
                </li>)}
            </ol>
            <div className="cns-modal-actions">
                <button className="cns-modal-btn cancel" onClick={onClose}>닫기</button>
                <button className="cns-modal-btn save" onClick={onOpenList}>대기 목록 보기</button>
            </div>
        </div>
    </div>;
}
