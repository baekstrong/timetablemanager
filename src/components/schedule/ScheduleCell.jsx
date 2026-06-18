import { TAG_STYLES } from './scheduleStyles';

// 이름을 굵게 표시하는 상태 (보강·보강이동·결석·신규·홀딩)
const BOLD_STATUSES = new Set(['makeup', 'makeupMoved', 'absent', 'newStudent', 'holding']);

/** 상태 색을 칩 전체에 입힘(이전 방식). 라벨은 칩 안 인라인. 마지막/재등록X/미결제는 별도 뱃지. */
export function StudentTag({ name, status, label, unpaid = false, reregX = false, lastClass = false }) {
    const style = { ...(TAG_STYLES[status] || {}) };
    if (BOLD_STATUSES.has(status)) style.fontWeight = 700;
    const suffix = label ? ` ${label}` : '';
    return (
        <span className="student-tag" style={style}>
            {name}{suffix}
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
