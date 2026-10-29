import { ScheduleStatusBadge } from './ScheduleCell';
import { classStatusLabel } from './studentClassModel';
import './StudentMakeupSlot.css';

const STATUS_TAGS = {
    makeup: 'makeup',
    moved: 'makeupMoved',
    absence: 'absent',
    holding: 'holding',
    holiday: 'absent',
};
const normalizeLabel = value => String(value || '').replace(/\s+/g, '');

/**
 * A presentation-only cell for the student's makeup grid.
 * session: one buildStudentWeek result, when this slot belongs to the student.
 * now: Date used by the parent; label/reason: its existing availability result.
 * disabled/onClick: passed through unchanged; this component never decides eligibility.
 * existingWait: optional waiting/notified entry, used only to label the existing action.
 * waitCount: 이 칸의 보강 대기 인원(만석일 때만). 대기 신청 전에 줄 길이를 알 수 있게 작게 표시.
 */
export default function StudentMakeupSlot({
    session = null,
    now = new Date(),
    label = '',
    reason = '',
    disabled = false,
    onClick,
    ariaLabel,
    isFull = false,
    existingWait = null,
    waitCount = 0,
    className = '',
}) {
    const fallbackType = reason === '홀딩' || label === '홀딩' ? 'holding' : reason === '휴일' || label === '휴일' ? 'holiday' : null;
    const type = session?.type || fallbackType;
    const isRegular = type === 'regular';
    const isAttendance = type === 'freeWorkoutAttendance';
    const statusLabel = session ? classStatusLabel(session, now) : fallbackType === 'holding' ? '홀딩' : fallbackType === 'holiday' ? '휴일' : '';
    const primaryLabel = isRegular ? '내 수업' : isAttendance ? '자율운동' : statusLabel;
    const hasPersonalStatus = Boolean(primaryLabel);
    const regularDetail = isRegular ? statusLabel : '';
    const availableLabel = existingWait ? existingWait.status === 'notified' ? '자리 도착' : '대기 중' : label;
    const redundantLabels = [primaryLabel, statusLabel, regularDetail];
    if (type === 'makeup') redundantLabels.push('내 보강');
    if (isAttendance) redundantLabels.push('자율 운동');
    const secondaryLabel = hasPersonalStatus && availableLabel && !redundantLabels.some(item => normalizeLabel(item) === normalizeLabel(availableLabel)) ? availableLabel : '';
    const visibleLabels = hasPersonalStatus ? [primaryLabel, regularDetail, isAttendance ? statusLabel : '', secondaryLabel] : [availableLabel];
    const waitCountLabel = !hasPersonalStatus && waitCount > 0 ? `대기 ${waitCount}명` : '';
    const accessibleLabel = [ariaLabel, ...[...visibleLabels, waitCountLabel].filter(item => item && !ariaLabel?.includes(item)), reason && !ariaLabel?.includes(reason) && !visibleLabels.includes(reason) ? reason : ''].filter(Boolean).join(' · ');
    const badgeStatus = statusLabel === '보강결석' ? 'makeupAbsent' : STATUS_TAGS[type];
    // ponytail: 여석/마감/대기 색상 구분용
    const availabilityKind = hasPersonalStatus ? undefined : existingWait ? 'wait' : isFull ? 'full' : availableLabel === '마감' ? 'closed' : availableLabel.endsWith('자리') ? 'open' : undefined;

    return <button type="button"
        className={`student-class-slot student-makeup-slot${hasPersonalStatus ? ' has-personal-status' : isFull ? ' full' : ''}${type ? ` status-${type}` : ''}${className ? ` ${className}` : ''}`}
        data-personal-status={type || undefined}
        data-availability={availabilityKind}
        disabled={disabled}
        onClick={onClick}
        title={reason || undefined}
        aria-label={accessibleLabel || undefined}>
        {hasPersonalStatus ? <>
            {isRegular || isAttendance ? <strong className="student-makeup-slot-title">{primaryLabel}</strong> : <ScheduleStatusBadge status={badgeStatus} label={primaryLabel} className="student-makeup-slot-badge" />}
            {regularDetail && <span className="student-makeup-slot-detail">{regularDetail}</span>}
            {isAttendance && <ScheduleStatusBadge label={statusLabel} className="student-makeup-slot-badge is-attendance" />}
            {secondaryLabel && <span className={`student-makeup-slot-availability${existingWait ? ' is-wait' : ''}`}>{secondaryLabel}</span>}
        </> : <>
            <span className="student-makeup-slot-label">{availableLabel}</span>
            {waitCountLabel && <span className="student-makeup-slot-wait-count">{waitCountLabel}</span>}
        </>}
    </button>;
}
