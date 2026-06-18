import { TAG_STYLES } from './scheduleStyles';

// 이름칩을 '파스텔 배경 + 검은 굵은 글씨 + 색 뱃지'로 표기하는 상태 (보강·보강이동·홀딩·신규·결석)
// 값은 각 상태 색의 연한(파스텔) 톤.
const NAME_PASTEL = {
    makeup: '#E8F2FC',      // 파스텔 블루
    newStudent: '#E8F2FC',  // 파스텔 블루
    makeupMoved: '#FDF6E3', // 파스텔 앰버
    absent: '#FDECEE',      // 파스텔 레드
    holding: '#FDECEE',     // 파스텔 레드
};

const extraBadges = (lastClass, reregX, unpaid) => (
    <>
        {lastClass && <span className="last-class">마지막</span>}
        {reregX && <span className="rereg-x">재등록X</span>}
        {unpaid && <UnpaidBadge />}
    </>
);

/** 보강·보강이동·홀딩·신규·결석: 파스텔 이름칩(검은 굵은 글씨)+색 뱃지. 그 외: 칩 배경 색 형태. */
export function StudentTag({ name, status, label, unpaid = false, reregX = false, lastClass = false }) {
    const tagStyle = TAG_STYLES[status] || {};

    if (NAME_PASTEL[status]) {
        const chipStyle = {
            backgroundColor: NAME_PASTEL[status],
            border: tagStyle.border,
            color: 'var(--text)',
            fontWeight: 700,
        };
        const badgeStyle = { ...tagStyle };
        delete badgeStyle.textDecoration; // 뱃지엔 취소선 없음
        return (
            <span className="student-tag" style={chipStyle}>
                {name}
                {label && <span className="status-badge" style={badgeStyle}>{label}</span>}
                {extraBadges(lastClass, reregX, unpaid)}
            </span>
        );
    }

    // 칩 배경 색 형태(합의결석·보강결석·시작지연·보강대기·보강승인중)
    const style = { ...tagStyle };
    delete style.textDecoration; // 취소선 제거
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
