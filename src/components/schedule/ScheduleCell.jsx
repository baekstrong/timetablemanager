import { TAG_STYLES } from './scheduleStyles';

// 뱃지 형태(이름칩 + 색 뱃지)로 표기하는 상태 — 나머지는 칩 배경 색 형태
const BADGE_STATUSES = new Set(['makeup', 'newStudent', 'holding', 'makeupMoved']);
// 이름에 취소선을 긋는 '빠짐/결석류' 상태
const AWAY_STATUSES = new Set(['makeupMoved', 'makeupAbsent', 'agreedAbsent', 'absent', 'holding', 'delayed']);
// 이름을 굵게 표시하는 상태 (보강·보강이동·결석·신규·홀딩)
const BOLD_STATUSES = new Set(['makeup', 'makeupMoved', 'absent', 'newStudent', 'holding']);

const extraBadges = (lastClass, reregX, unpaid) => (
    <>
        {lastClass && <span className="last-class">마지막</span>}
        {reregX && <span className="rereg-x">재등록X</span>}
        {unpaid && <UnpaidBadge />}
    </>
);

/** 보강·신규·홀딩·보강이동은 뱃지 형태, 그 외는 칩 배경 색 형태. */
export function StudentTag({ name, status, label, unpaid = false, reregX = false, lastClass = false }) {
    const tagStyle = TAG_STYLES[status] || {};

    if (BADGE_STATUSES.has(status)) {
        const badgeStyle = { ...tagStyle };
        delete badgeStyle.textDecoration; // 취소선은 이름에만
        const lightInk = tagStyle.color === '#ffffff' || tagStyle.color === '#fff';
        const nameStyle = {
            color: lightInk ? '#327AB8' : tagStyle.color,
            textDecoration: AWAY_STATUSES.has(status) ? 'line-through' : undefined,
            fontWeight: BOLD_STATUSES.has(status) ? 700 : undefined,
        };
        return (
            <span className="student-tag">
                <span style={nameStyle}>{name}</span>
                {label && <span className="status-badge" style={badgeStyle}>{label}</span>}
                {extraBadges(lastClass, reregX, unpaid)}
            </span>
        );
    }

    // 칩 배경 색 형태(결석류·시작지연·보강대기·보강승인중)
    const style = { ...tagStyle };
    if (BOLD_STATUSES.has(status)) style.fontWeight = 700;
    return (
        <span className="student-tag" style={style}>
            {name}{label ? ` ${label}` : ''}
            {extraBadges(lastClass, reregX, unpaid)}
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
