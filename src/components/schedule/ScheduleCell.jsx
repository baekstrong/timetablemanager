import { TAG_STYLES } from './scheduleStyles';

/** Styled student tag with status-specific styling. */
export function StudentTag({ name, status, label }) {
    const style = TAG_STYLES[status] || {};
    const suffix = label ? `(${label})` : '';
    const className = status === 'makeup' ? 'student-tag substitute' : 'student-tag';
    return <span className={className} style={style}>{name}{suffix}</span>;
}

/** Available seats display cell (reused in student mode). */
export function AvailableSeatsCell({ seats, onClick }) {
    return (
        <div className="schedule-cell cell-available" onClick={onClick}>
            <span className="seat-count">{seats}</span>
            <span style={{ fontSize: '0.8em', color: '#666' }}>자리</span>
        </div>
    );
}

/** Holiday cell for student mode. */
export function HolidayCell({ reason }) {
    return (
        <div className="schedule-cell" style={{ backgroundColor: '#f3f4f6', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ color: '#ef4444', fontWeight: 'bold', fontSize: '0.9rem' }}>휴일</span>
            {reason && <span style={{ color: '#6b7280', fontSize: '0.7rem', marginTop: '2px' }}>{reason}</span>}
        </div>
    );
}
