import { useState } from 'react';
import { classLabel, classTime, classStartMs, periodClassLabel, CLASS_LABELS, classStatusLabel, nextStudentClass, sourceUnavailableReason } from './studentClassModel';
import { canKeepAfterOriginal, canConvertWaitToMakeup, getNotificationDeadline } from '../../utils/makeupWaitlist';
import { ScheduleStatusBadge } from './ScheduleCell';
import ReviewModal from '../../features/today/ReviewModal';
import { courseNoticeSession } from '../../utils/courseNoticeSession';
import { groupWaits } from '../../utils/makeupSwap';
import './StudentClassView.css';

const STATUS_TAGS = { makeup: 'makeup', moved: 'makeupMoved', absence: 'absent', holding: 'holding' };

function ClassStatusChip({ session, now, detail = false }) {
    return <ScheduleStatusBadge status={STATUS_TAGS[session.type]} className={`student-class-status${session.type === 'holiday' ? ' is-holiday' : ''}`} label={detail && session.type === 'regular' ? CLASS_LABELS.regular : classStatusLabel(session, now)} />;
}

export default function StudentClassView({
    days, sessions = [], now, tab, onTabChange, readOnly = false, suppressCourseNotice = false,
    loading = false, error = '', onRetry, studentName, membership, source, quotaUsed, quotaLimit,
    requestUnavailableReason = '', requestError = '',
    waits = [], onWaitlist, onKeepWait, onConvertWait, onCancelWaitGroup, onMakeup, onCancelMakeup, onNavigate, swapBoard = null, swapOffers = [], topNotice = null, children,
}) {
    const [selection, setSelection] = useState(null);
    const [dismissedCourseNotice, setDismissedCourseNotice] = useState('');
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const next = nextStudentClass(sessions, now);
    const selectedDate = days.some(day => day.date === selection) ? selection : null;
    const focus = selectedDate ? sessions.filter(item => item.date === selectedDate) : next ? [next] : [];
    const offers = waits.filter(item => item.status === 'notified');
    const waiting = waits.filter(item => item.status === 'waiting');
    const shortDate = date => date ? `${Number(date.slice(5, 7))}/${Number(date.slice(8))}` : '—';
    const endDate = membership?.endDate;
    const courseNoticeKey = endDate && endDate <= today ? `${endDate}/${today}` : '';
    const showCourseNotice = !suppressCourseNotice && !loading && !error && courseNoticeKey && studentName
        && dismissedCourseNotice !== studentName && !courseNoticeSession.isDismissed(studentName);
    const closeCourseNotice = () => {
        courseNoticeSession.dismiss(studentName);
        setDismissedCourseNotice(studentName);
    };

    const waitGroups = groupWaits(waiting);
    const showSwapBoard = () => {
        onTabChange('mine');
        requestAnimationFrame(() => document.getElementById('swap-board-title')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    };

    return <div className="student-classes">
        {topNotice}
        {showCourseNotice && <ReviewModal title={endDate < today ? '수강 기간이 만료되었습니다' : '오늘은 마지막 수업일입니다'} onClose={closeCourseNotice}>
            <p>재등록을 원하시면 코치에게 문의해주세요.</p>
            <div className="today-actions student-course-notice-actions"><button type="button" className="student-class-button primary" onClick={closeCourseNotice}>확인</button></div>
        </ReviewModal>}
        {offers.map(entry => {
            const deadline = getNotificationDeadline(entry);
            return <button type="button" className="student-class-offer" key={entry.id} disabled={readOnly || Boolean(requestUnavailableReason)} onClick={() => onWaitlist(entry)}>
                <span><strong>기다리던 자리가 났어요</strong><small>{classLabel(entry)} · {deadline?.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })}까지 수락</small></span><span aria-hidden="true">›</span>
            </button>;
        })}
        {/* 내가 받아줄 수 있는 맞교환 요청 (2026-11-12) — 현황판이 아래에 있어 놓치기 쉬워 위에 한 줄로 */}
        {swapOffers.length > 0 && <button type="button" className="student-class-offer is-swap" onClick={showSwapBoard}>
            <span><strong>{swapOffers[0].studentName}님{swapOffers.length > 1 ? ` 외 ${swapOffers.length - 1}명` : ''}이 내 수업과 바꾸고 싶어해요</strong><small>내 {periodClassLabel(swapOffers[0].session)} ↔ {periodClassLabel(swapOffers[0].originalClass)} · 눌러서 맞교환 보기</small></span><span aria-hidden="true">›</span>
        </button>}
        <div className="student-class-tabs" aria-label="수업 보기">
            <button type="button" aria-pressed={tab === 'mine'} onClick={() => onTabChange('mine')}>내 일정</button>
            <button type="button" aria-pressed={tab === 'all'} onClick={() => onTabChange('all')}>보강 시간표</button>
        </div>
        <div className="student-class-week-heading"><div><h2>이번 주</h2><span>{shortDate(days[0]?.date)} — {shortDate(days[4]?.date)}</span></div></div>
        {!loading && !error && requestUnavailableReason && <div className="student-class-notice" role={requestError ? 'alert' : 'status'}><p>{requestError || '보강 신청에 필요한 최신 정보를 확인하고 있어요.'}</p>{requestError && <button type="button" className="student-class-button" onClick={onRetry}>다시 불러오기</button>}</div>}
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
                    const unavailable = requestUnavailableReason || sourceUnavailableReason(session, { now, quotaUsed, quotaLimit, waits });
                    const swapped = session.type === 'makeup' && Boolean(session.makeup?.swapWith);
                    const canCancel = session.type === 'makeup' && !swapped && classStartMs(session) - now.getTime() > 60 * 60 * 1000;
                    return <div className="student-class-session" key={`${session.date}-${session.period}`}>
                        <div className="student-class-eyebrow">{selectedDate ? '선택한 수업' : '이 주의 다음 수업'}<ClassStatusChip session={session} now={now} detail /></div>
                        <div className="student-class-time">{classTime(session)}</div><p className="student-class-date">{classLabel(session).split(' ')[0]} · {session.periodName}</p>
                        {session.type === 'makeup' && <p className="student-class-help">{classLabel(session.origin)} 수업을 옮겼어요.{swapped && ` ${session.makeup.swapWith}님과 맞교환했어요.`}</p>}
                        {session.type === 'moved' && <p className="student-class-help">{classLabel(session.makeup?.makeupClass)} 보강으로 이동했어요.</p>}
                        {session.type === 'holding' && <p className="student-class-help">홀딩한 수업이에요. 수강 기간 연장은 내 정보에서 확인할 수 있어요.</p>}
                        {session.type === 'absence' && <p className="student-class-help">결석 신청한 수업이에요. 수강 횟수는 사용하고 기간은 유지돼요.</p>}
                        {session.type === 'holiday' && <p className="student-class-help">{session.reason || '휴일'}로 쉬는 날이에요.</p>}
                        {session.type === 'freeWorkoutAttendance' && <p className="student-class-help">자율운동 출석 기록이에요.</p>}
                        {!past && ['regular', 'holiday', 'makeup'].includes(session.type) && <>
                            {session.type !== 'makeup' && unavailable && <p className="student-class-help">{unavailable}</p>}
                            <div className="student-class-actions">{session.type === 'makeup' ? <button type="button" className="student-class-button primary" disabled={readOnly || !canCancel || Boolean(requestUnavailableReason)} onClick={() => onCancelMakeup(session.makeup.id)}>보강 취소</button> : <button type="button" className="student-class-button primary" disabled={readOnly || Boolean(unavailable)} onClick={() => onMakeup(session)}>보강 신청</button>}{session.type !== 'holiday' && <button type="button" className="student-class-button" onClick={() => onNavigate?.('holding', session.date)}>홀딩·결석</button>}</div>
                            {session.type === 'makeup' && !canCancel && <p className="student-class-help">{swapped ? '맞교환한 수업은 취소할 수 없어요.' : '보강 수업 시작 1시간 전까지 취소할 수 있어요.'}</p>}
                        </>}
                        {past && <p className="student-class-help">이미 시작했거나 지난 수업이에요.</p>}
                    </div>;
                }) : <div className="student-class-empty"><h3>{selectedDate ? '이날은 수업이 없어요' : '이 주에 남은 수업이 없어요'}</h3><p>다른 날짜를 선택해 수업 내역을 확인해보세요.</p>{selectedDate && next && <button type="button" className="student-class-link" onClick={() => setSelection(next.date)}>다음 수업 보기 · {classLabel(next)} ›</button>}</div>}
            </section>
            {waitGroups.map(group => {
                const first = group.entries[0];
                // '대기 유지'는 원래 수업이 모든 대기 칸보다 먼저일 때만(묶음이 결석 하나를 함께 쓴다)
                const canKeep = onKeepWait && group.entries.every(entry => canKeepAfterOriginal(entry, now));
                const canConvert = onConvertWait && canConvertWaitToMakeup(first, now);
                const many = group.entries.length > 1;
                const blocked = readOnly || Boolean(requestUnavailableReason);
                return <div key={group.key} className="student-class-wait"><div><span className="student-class-chip">{many ? `보강 대기 중 · ${group.entries.length}곳 중 한 곳` : '보강 대기 중'}</span>
                    {many ? <ul className="student-class-wait-targets">{group.entries.map(entry => <li key={entry.id}><strong>{classLabel(entry)}</strong><button type="button" className="student-class-link" disabled={blocked} onClick={() => onWaitlist(entry)} aria-label={`${classLabel(entry)} 대기 취소`}>취소</button></li>)}</ul>
                        : <strong>{classLabel(first)}</strong>}
                    {first.keepAfterOriginal
                        ? <p>원래 수업 · {classLabel(first.originalClass)} (결석 처리됨)<br />자리가 안 나면 원래 수업은 소진돼요.</p>
                        : <p>원래 수업 · {classLabel(first.originalClass)}<br />{many ? '먼저 성사되는 한 곳으로 옮겨지고 나머지는 자동 취소돼요. ' : ''}{canKeep ? '원래 수업이 시작되면 대기는 자동 취소돼요.' : '수락 전까지 원래 수업은 유지돼요.'}</p>}
                    {(canKeep || canConvert) && <div className="student-class-wait-actions">
                        {canKeep && <button type="button" className="student-class-button student-class-keep-wait" disabled={blocked} onClick={() => onKeepWait(first)}>원래 수업 빠지고 대기 유지</button>}
                        {canConvert && <button type="button" className="student-class-button student-class-convert-wait" disabled={blocked} onClick={() => onConvertWait(first)}>다른 시간으로 보강 변경</button>}
                    </div>}
                </div>{many
                    ? <button type="button" className="student-class-link" disabled={blocked} onClick={() => onCancelWaitGroup?.(group.entries)}>전체 취소</button>
                    : <button type="button" className="student-class-link" disabled={blocked} onClick={() => onWaitlist(first)}>대기 취소</button>}</div>;
            })}
            {/* 남은 수업·훈련일지·홀딩 내역 링크는 첫 화면에서 뺐다(2026-11-11 사용자 요청). 이번 주 남은 수업이 없으면
                홀딩·결석 버튼도 없으므로 그때만 내역으로 가는 길을 남긴다. */}
            {!focus.length && <button type="button" className="student-class-link" onClick={() => onNavigate?.('holding')}>홀딩·결석 신청 및 내역 ›</button>}
            {swapBoard}
        </> : requestUnavailableReason ? null : <>
            <div className="student-class-grid-heading"><p>{source ? <><strong>{classLabel(source)}</strong> → 원하는 시간을 선택하세요</> : '옮길 내 수업 칸을 먼저 누르세요'}</p><span>{quotaUsed}/{quotaLimit}회 사용</span></div>
            {quotaUsed >= quotaLimit && <p className="student-class-notice">이번 주 보강 횟수를 모두 사용했어요.{waits.length > 0 && ' 걸어 둔 대기는 자리가 나도 안내되지 않고 취소돼요.'}</p>}
            {children}
            <p className="student-class-help">대기 신청만으로 수업이 이동하지 않아요. 자리가 나면 직접 수락해요.</p>
            <details className="student-class-policy"><summary>보강 신청·취소 기준</summary><p>원래 수업과 보강 수업 모두 시작 2시간 전까지 신청할 수 있어요. 취소는 보강 수업 시작 1시간 전까지 가능해요.</p><p>보강 대기 중인 수업은 원래 수업 시작 전까지 내 일정의 대기 카드에서 다른 시간 보강으로 바꿀 수 있어요.</p><p>이번 주 신청 한도는 {quotaLimit}회예요. 취소한 보강도 사용 횟수에 포함돼요. 대기는 보강이 확정될 때 1회로 세요. 단, 자리가 났을 때 이번 주 횟수를 다 썼다면 안내 없이 대기가 취소돼요.</p><p>원래 수업이 만석이면 취소로 돌아갈 수 없어요. 남은 횟수가 있으면 다른 시간으로 변경할 수 있어요.</p></details>
        </>}
    </div>;
}
