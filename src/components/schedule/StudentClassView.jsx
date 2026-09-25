import { useState } from 'react';
import { classLabel, classTime, classStartMs, CLASS_LABELS, classStatusLabel, nextStudentClass, sourceUnavailableReason } from './studentClassModel';
import { getNotificationDeadline } from '../../utils/makeupWaitlist';
import { ScheduleStatusBadge } from './ScheduleCell';
import './StudentClassView.css';

const STATUS_TAGS = { makeup: 'makeup', moved: 'makeupMoved', absence: 'absent', holding: 'holding' };

function ClassStatusChip({ session, now, detail = false }) {
    return <ScheduleStatusBadge status={STATUS_TAGS[session.type]} className={`student-class-status${session.type === 'holiday' ? ' is-holiday' : ''}`} label={detail && session.type === 'regular' ? CLASS_LABELS.regular : classStatusLabel(session, now)} />;
}

export default function StudentClassView({
    days, sessions = [], now, tab, onTabChange, readOnly = false,
    loading = false, error = '', onRetry, membership, source, quotaUsed, quotaLimit,
    waits = [], onWaitlist, onSourceChoose, onMakeup, onCancelMakeup, onNavigate, children,
}) {
    const [selection, setSelection] = useState(null);
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const next = nextStudentClass(sessions, now);
    const selectedDate = days.some(day => day.date === selection) ? selection : null;
    const focus = selectedDate ? sessions.filter(item => item.date === selectedDate) : next ? [next] : [];
    const offers = waits.filter(item => item.status === 'notified');
    const waiting = waits.filter(item => item.status === 'waiting');
    const shortDate = date => date ? `${Number(date.slice(5, 7))}/${Number(date.slice(8))}` : '—';

    return <div className="student-classes">
        {offers.map(entry => {
            const deadline = getNotificationDeadline(entry);
            return <button type="button" className="student-class-offer" key={entry.id} disabled={readOnly} onClick={() => onWaitlist(entry)}>
                <span><strong>기다리던 자리가 났어요</strong><small>{classLabel(entry)} · {deadline?.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })}까지 수락</small></span><span aria-hidden="true">›</span>
            </button>;
        })}
        <div className="student-class-tabs" aria-label="수업 보기">
            <button type="button" aria-pressed={tab === 'mine'} onClick={() => onTabChange('mine')}>내 일정</button>
            <button type="button" aria-pressed={tab === 'all'} onClick={() => onTabChange('all')}>보강 시간표</button>
        </div>
        <div className="student-class-week-heading"><div><h2>이번 주</h2><span>{shortDate(days[0]?.date)} — {shortDate(days[4]?.date)}</span></div></div>
        {error ? <div className="student-class-empty" role="alert"><p>{error}</p><button type="button" className="student-class-button" onClick={onRetry}>다시 불러오기</button></div> : loading ? <div className="student-class-empty" role="status">수업 정보를 불러오고 있어요.</div> : tab === 'mine' ? <>
            <div className="student-class-week" aria-label="요일별 내 일정">{days.map(day => {
                const lessons = sessions.filter(item => item.date === day.date);
                const active = lessons.some(lesson => ['regular', 'makeup', 'freeWorkoutAttendance'].includes(lesson.type));
                const holiday = lessons.some(lesson => lesson.type === 'holiday');
                return <button type="button" key={day.date} className={`student-class-day${active ? ' has-class' : ''}${holiday ? ' is-holiday' : ''}${selectedDate === day.date ? ' is-selected' : ''}`} aria-pressed={selectedDate === day.date} aria-label={`${classLabel({ ...day, period: 1 }).split(' ')[0]} ${lessons.map(lesson => `${lesson.type === 'freeWorkoutAttendance' ? '자율운동 ' : ''}${classTime(lesson)} ${classStatusLabel(lesson, now)}`).join(', ') || '수업 없음'}`} onClick={() => setSelection(day.date)}>
                    <span>{day.day}{day.date === today && <i aria-label="오늘" />}</span><strong>{day.dateNumber}</strong>
                    {lessons.length ? lessons.map(lesson => <span className={`student-class-day-lesson${['regular', 'makeup', 'freeWorkoutAttendance'].includes(lesson.type) ? '' : ' is-inactive'}${lesson.type === 'holiday' ? ' is-holiday' : ''}`} key={lesson.period}>
                        <span className="student-class-day-time">{lesson.type === 'freeWorkoutAttendance' ? '자율운동' : classTime(lesson)}</span><ClassStatusChip session={lesson} now={now} />
                    </span>) : <span className="student-class-day-lesson"><span className="student-class-day-time">—</span><small>{day.date === today ? '오늘' : '\u00a0'}</small></span>}
                </button>;
            })}</div>
            <section className="student-class-focus" aria-label="내 수업 상세">
                {focus.length ? focus.map(session => {
                    const past = classStartMs(session) <= now.getTime();
                    const unavailable = sourceUnavailableReason(session, { now, quotaUsed, quotaLimit, waits });
                    const canCancel = session.type === 'makeup' && classStartMs(session) - now.getTime() > 60 * 60 * 1000;
                    return <div className="student-class-session" key={`${session.date}-${session.period}`}>
                        <div className="student-class-eyebrow">{selectedDate ? '선택한 수업' : '이 주의 다음 수업'}<ClassStatusChip session={session} now={now} detail /></div>
                        <div className="student-class-time">{classTime(session)}</div><p className="student-class-date">{classLabel(session).split(' ')[0]} · {session.periodName}</p>
                        {session.type === 'makeup' && <p className="student-class-help">{classLabel(session.origin)} 수업을 옮겼어요.</p>}
                        {session.type === 'moved' && <p className="student-class-help">{classLabel(session.makeup?.makeupClass)} 보강으로 이동했어요.</p>}
                        {session.type === 'holding' && <p className="student-class-help">홀딩한 수업이에요. 수강 기간 연장은 내 정보에서 확인할 수 있어요.</p>}
                        {session.type === 'absence' && <p className="student-class-help">결석 신청한 수업이에요. 수강 횟수는 사용하고 기간은 유지돼요.</p>}
                        {session.type === 'holiday' && <p className="student-class-help">{session.reason || '휴일'}로 쉬는 날이에요.</p>}
                        {session.type === 'freeWorkoutAttendance' && <p className="student-class-help">자율운동 출석 기록이에요.</p>}
                        {!past && ['regular', 'holiday', 'makeup'].includes(session.type) && <>
                            {session.type !== 'makeup' && unavailable && <p className="student-class-help">{unavailable}</p>}
                            <div className="student-class-actions">{session.type === 'makeup' ? <button type="button" className="student-class-button primary" disabled={readOnly || !canCancel} onClick={() => onCancelMakeup(session.makeup.id)}>보강 취소</button> : <button type="button" className="student-class-button primary" disabled={Boolean(unavailable)} onClick={() => onMakeup(session)}>보강 신청</button>}{session.type !== 'holiday' && <button type="button" className="student-class-button" onClick={() => onNavigate?.('holding', session.date)}>홀딩·결석</button>}</div>
                            {session.type === 'makeup' && !canCancel && <p className="student-class-help">보강 수업 시작 1시간 전까지 취소할 수 있어요.</p>}
                        </>}
                        {past && <p className="student-class-help">이미 시작했거나 지난 수업이에요.</p>}
                    </div>;
                }) : <div className="student-class-empty"><h3>{selectedDate ? '이날은 수업이 없어요' : '이 주에 남은 수업이 없어요'}</h3><p>다른 날짜를 선택해 수업 내역을 확인해보세요.</p>{selectedDate && next && <button type="button" className="student-class-link" onClick={() => setSelection(next.date)}>다음 수업 보기 · {classLabel(next)} ›</button>}</div>}
            </section>
            {waiting.map(entry => <div key={entry.id} className="student-class-wait"><div><span className="student-class-chip">보강 대기 중</span><strong>{classLabel(entry)}</strong><p>원래 수업 · {classLabel(entry.originalClass)}<br />수락 전까지 원래 수업은 유지돼요.</p></div><button type="button" className="student-class-link" disabled={readOnly} onClick={() => onWaitlist(entry)}>대기 취소</button></div>)}
            <div className="student-class-membership"><div><span>남은 수업</span><strong>{membership?.remainingSessions ?? '—'}<small>회</small></strong></div><div><span>수강 종료일</span><strong>{shortDate(membership?.endDate)}</strong></div><button type="button" aria-label="수강권 자세히 보기" onClick={() => onNavigate?.('myinfo')}>›</button></div>
            <button type="button" className="student-class-training" onClick={() => onNavigate?.('training-log')}><span><strong>지난 수업, 어떻게 했더라?</strong><small>훈련일지에서 내 기록 이어보기</small></span><span aria-hidden="true">›</span></button>
            <button type="button" className="student-class-link" onClick={() => onNavigate?.('holding')}>홀딩·결석 신청 및 내역 ›</button>
        </> : <>
            <button type="button" className="student-class-source" onClick={onSourceChoose}><span><small>옮길 수업</small><strong>{source ? classLabel(source) : '내 수업을 먼저 선택하세요'}</strong></span><span>{source ? '변경' : '선택'} ›</span></button>
            <div className="student-class-grid-heading"><p>{source ? '원하는 시간을 선택하세요' : '이번 주 보강 가능한 시간'}</p><span>{quotaUsed}/{quotaLimit}회 사용</span></div>
            {quotaUsed >= quotaLimit && <p className="student-class-notice">이번 주 보강·대기 한도를 모두 사용했어요.</p>}
            {children}
            <p className="student-class-help">대기 신청만으로 수업이 이동하지 않아요. 자리가 나면 직접 수락해요.</p>
            <details className="student-class-policy"><summary>보강 신청·취소 기준</summary><p>원래 수업과 보강 수업 모두 시작 2시간 전까지 신청할 수 있어요. 취소는 보강 수업 시작 1시간 전까지 가능해요.</p><p>이번 주 신청 한도는 {quotaLimit}회예요. 취소한 보강도 사용 횟수에 포함되며, 대기 중인 신청도 한도를 차지해요.</p><p>원래 수업이 만석이면 취소로 돌아갈 수 없어요. 남은 횟수가 있으면 다른 시간으로 변경할 수 있어요.</p></details>
        </>}
    </div>;
}
