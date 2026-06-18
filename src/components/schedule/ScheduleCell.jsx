import { TAG_STYLES } from './scheduleStyles';

// 이름에 취소선을 긋는 '빠짐/결석류' 상태 (결석·합의결석·보강결석·보강이동·홀딩·시작지연)
const AWAY_STATUSES = new Set(['makeupMoved', 'makeupAbsent', 'agreedAbsent', 'absent', 'holding', 'delayed']);

/** 이름은 중립 회색 칩, 상태는 작은 색 뱃지로 표기. 결석류는 이름에 취소선 유지. */
export function StudentTag({ name, status, label, unpaid = false, reregX = false, lastClass = false }) {
    const away = AWAY_STATUSES.has(status);
    const badgeStyle = TAG_STYLES[status] ? { ...TAG_STYLES[status] } : {};
    delete badgeStyle.textDecoration; // 취소선은 이름에만 적용
    return (
        <span className="student-tag">
            <span style={away ? { textDecoration: 'line-through' } : undefined}>{name}</span>
            {label && <span className="status-badge" style={badgeStyle}>{label}</span>}
            {lastClass && <span className="last-class">마지막</span>}
            {reregX && <span className="rereg-x">재등록X</span>}
            {unpaid && <UnpaidBadge />}
        </span>
    );
}

/** 미결제(K열=X) 상태 배지 — 코치 시간표 전용. */
export function UnpaidBadge() {
    return (
        <span style={{
            display: 'inline-block',
            marginLeft: '3px',
            padding: '0 4px',
            fontSize: '0.62rem',
            fontWeight: 700,
            color: '#E94E58',
            backgroundColor: '#E94E581A',
            border: '1px solid #E94E584D',
            borderRadius: '4px',
            verticalAlign: 'middle',
        }}>미결제</span>
    );
}

/** Available seats display cell (reused in student mode). */
export function AvailableSeatsCell({ seats, onClick }) {
    return (
        <div className="schedule-cell cell-available" onClick={onClick}>
            <span className="seat-count">{seats}</span>
            <span style={{ fontSize: '0.8em', color: 'var(--text-secondary)' }}>자리</span>
        </div>
    );
}

/** Holiday cell for student mode. */
export function HolidayCell({ reason }) {
    return (
        <div className="schedule-cell" style={{ backgroundColor: 'var(--canvas-tint)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ color: 'var(--error)', fontWeight: 'bold', fontSize: '0.9rem' }}>휴일</span>
            {reason && <span style={{ color: 'var(--text-secondary)', fontSize: '0.7rem', marginTop: '2px' }}>{reason}</span>}
        </div>
    );
}
