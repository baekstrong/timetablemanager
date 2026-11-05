import PushSettings from '../../components/PushSettings';
import RefreshStatus from '../../components/RefreshStatus';
import { StudentTag } from '../../components/schedule/ScheduleCell';
import { useEffect, useId, useState } from 'react';
import { visibleTaskGroups, currentLessonId, automaticLessonId, groupChecklistByExercise } from './todayModel';
import './TodayViews.css';

export function ActionButton({ children, primary = false, pending = false, ...props }) {
    return <button type="button" className={`today-button${primary ? ' today-button-primary' : ''}${pending ? ' today-button-pending' : ''}`} {...props}>{children}</button>;
}

export function TaskSection({ groups, onAction, currentPeriod, coach = false, extraGroup, extraCount = 0 }) {
    const titleId = useId();
    const visible = visibleTaskGroups(groups);
    // No title, empty card or spacing when there is nothing to act on — both roles.
    if (!visible.length && !extraCount) return null;
    const count = visible.reduce((total, group) => total + group.items.length, extraCount);
    return <section className={`today-card today-tasks${coach ? ' today-tasks-coach' : ''}`} aria-labelledby={titleId}>
        <div className="today-section-title"><h2 id={titleId}>{coach ? '할 일' : '확인할 일'}</h2><span className="today-count">{count}</span></div>
        <div className="today-task-groups">{visible.map(group => <div key={group.id} className="today-task-group">
            {coach && <h3>{group.title}<span>{group.items.length}</span></h3>}
            {group.items.map(item => <div key={item.id} className={`today-task-row${currentPeriod != null && item.period === currentPeriod ? ' is-current' : ''}`}>
                <div><p className="today-task-title">{item.title}{coach && item.unpaid && <span className="today-task-unpaid">미결제</span>}</p>{item.description && <p className="today-muted">{item.description}</p>}</div>
                <div className="today-task-actions">
                    <ActionButton pending={coach && item.type === 'new'} onClick={() => onAction(item)} aria-label={`${item.title} ${item.actionLabel}`}>{item.actionLabel}</ActionButton>
                    {coach && item.paymentAction && <ActionButton onClick={() => onAction(item.paymentAction)} aria-label={`${item.name} 결제 확인`}>결제 확인</ActionButton>}
                </div>
            </div>)}
        </div>)}{extraCount > 0 && extraGroup}</div>
    </section>;
}

export function WeeklyLessons({ lessons, weekLabel, onSchedule, onTraining, onChange }) {
    return <section className="today-card">
        <div className="today-section-title"><h2>이번 주 내 수업</h2><button className="today-link" onClick={onSchedule}>시간표</button></div>
        <p className="today-muted">{weekLabel}</p>
        <div className="today-week-list">{lessons.length ? lessons.map(lesson => <div key={lesson.id} className="today-week-row">
            <div className="today-date"><strong>{lesson.day}</strong><span>{lesson.date.slice(5).replace('-', '/')}</span></div>
            <div className="today-week-time"><strong>{lesson.cancelled ? <s>{lesson.time}</s> : lesson.time}</strong><p className="today-muted">{lesson.description}</p></div>
            <span className={`today-status ${lesson.cancelled ? 'is-cancelled' : ''}`}>{lesson.status}</span>
        </div>) : <p className="today-empty">이번 주 예정된 수업이 없습니다.</p>}</div>
        <div className="today-actions"><ActionButton primary onClick={onTraining}>운동 기록</ActionButton><ActionButton onClick={onChange}>일정 변경</ActionButton></div>
    </section>;
}

export function WaitingList({ entries, onAction }) {
    if (!entries.length) return null;
    return <details className="today-card today-waiting"><summary>대기·신청 내역 <span>{entries.length}건</span></summary>
        {entries.map(entry => <div className="today-task-row" key={entry.id}><div><p>{entry.title}</p><p className="today-muted">{entry.description}</p></div><ActionButton onClick={() => onAction(entry)}>보기</ActionButton></div>)}
    </details>;
}

export function RecentStories({ posts, onPost, onBoard }) {
    if (!posts.length) return null;
    return <section className="today-card"><div className="today-section-title"><h2>학교의 새 이야기</h2><button className="today-link" onClick={onBoard}>전체 보기</button></div>
        {posts.map(post => <button key={post.id} className="today-story" onClick={() => onPost(post)}>
            <span className="today-muted">{post.category} · {post.timeLabel}</span><strong>{post.title} {post.unread && <small>NEW</small>}</strong><span className="today-muted">{post.excerpt}</span>
        </button>)}
    </section>;
}

export function StudentToday({ name, taskGroups, lessons, weekLabel, waiting, posts, onAction, onNavigate, onPost }) {
    return <main className="today-page today-student">
        <header className="today-header"><div><p>근력학교</p><h1>{name}님, 안녕하세요</h1></div><button className="today-link" onClick={() => onNavigate('logout')}>로그아웃</button></header>
        <TaskSection groups={taskGroups} onAction={onAction} />
        <WeeklyLessons lessons={lessons} weekLabel={weekLabel} onSchedule={() => onNavigate('schedule')} onTraining={() => onNavigate('training-log')} onChange={() => onAction({ type: 'holding' })} />
        <WaitingList entries={waiting} onAction={onAction} />
        <RecentStories posts={posts} onPost={onPost} onBoard={() => onNavigate('dashboard')} />
        <div className="today-footnote"><span>수강권·남은 횟수</span><button className="today-link" onClick={() => onNavigate('myinfo')}>내 정보</button></div>
    </main>;
}

export function CoachToday({ scheduleTransfers, scheduleTransferCount = 0, user, hasNewPostNotification = false, onRefresh, refreshedAt, refreshing, refreshMessage, freeWorkout = null, dateLabel, lessons, minutes, taskGroups, checklists = {}, checklistChecks = {}, onLoadChecklists, onToggleChecklist, onAction, onNavigate }) {
    const [manualId, setManualId] = useState(null);
    const currentId = currentLessonId(lessons, minutes);
    const selectedId = manualId ?? automaticLessonId(lessons, minutes);
    const selected = lessons.find(lesson => lesson.id === selectedId);
    const attendeeKey = (selected?.attendees || []).join('\n');
    // 고른 수업 참석자의 체크리스트만 읽는다(이미 읽은 사람은 CoachHome이 캐시).
    useEffect(() => { if (attendeeKey && onLoadChecklists) onLoadChecklists(attendeeKey.split('\n')); }, [attendeeKey, onLoadChecklists]);
    return <main className="today-page today-coach">
        <header className="today-header"><div><div className="today-coach-identity"><h1 className="today-coach-title">근력학교 · {user?.username || '코치'}</h1><PushSettings user={user} /></div><span className="today-coach-date">{dateLabel}</span></div><div className="today-actions"><ActionButton onClick={() => onNavigate('dashboard')} aria-label={hasNewPostNotification ? '게시판 · 새 글 있음' : '게시판'}><span className="today-board-label">게시판{hasNewPostNotification && <span className="today-board-dot" aria-hidden="true" />}</span></ActionButton><button className="today-link" onClick={() => onNavigate('logout')}>로그아웃</button></div></header>
        <TaskSection coach groups={taskGroups} onAction={onAction} currentPeriod={currentId} extraGroup={scheduleTransfers} extraCount={scheduleTransferCount} />
        <div className="today-coach-columns">
            <section className="today-card today-daily"><div className="today-section-title"><h2>오늘 수업</h2><span className="today-muted">{lessons.length}개 수업</span>{onRefresh && <RefreshStatus refreshedAt={refreshedAt} refreshing={refreshing} message={refreshMessage} onRefresh={onRefresh} />}</div>
                {lessons.length === 0 && !freeWorkout && <p className="today-empty">오늘 예정된 수업이 없습니다.</p>}
                {[...lessons, ...(freeWorkout ? [{ ...freeWorkout, free: true }] : [])].sort((a, b) => a.startMinute - b.startMinute).map(lesson => lesson.free ? <div key="free" className="today-lesson today-free">
                    <div className="today-lesson-title"><strong>자율 운동</strong><span>{lesson.time}</span></div>
                    <div className="today-lesson-body">{lesson.names.length ? <><p><strong>{lesson.names.length}명</strong></p><div className="today-roster">{lesson.names.map(name => <StudentTag key={name} name={name} />)}</div></> : <p className="today-muted">신청 없음</p>}</div>
                </div> : <button key={lesson.id} className={`today-lesson${lesson.id === currentId ? ' is-current' : ''}${lesson.id === selectedId ? ' is-selected' : ''}`} aria-pressed={lesson.id === selectedId} onClick={() => setManualId(lesson.id)}>
                    <div className="today-lesson-title"><strong>{lesson.id}교시</strong><span>{lesson.time}</span>{lesson.id === currentId && <b>수업 중</b>}</div>
                    <div className="today-lesson-body"><p><strong>{lesson.attendees.length}명</strong> <span className="today-muted">(여석: {lesson.availableSeats}자리)</span></p>
                        <div className="today-roster">{lesson.roster.map(person => <StudentTag key={person.name} {...person} />)}</div>
                    </div>
                </button>)}
            </section>
            <section className="today-card today-notes" aria-labelledby="today-notes-heading">
                <div className="today-section-title"><h2 id="today-notes-heading">수강생 메모</h2>{manualId != null && <button className="today-link" onClick={() => setManualId(null)}>현재 수업으로</button>}</div>
                <p className="today-muted">{selected ? `${selected.id}교시 · ${selected.time} · 참석 예정 ${selected.attendees.length}명` : '오늘 수업이 모두 끝났습니다.'}{selected && selected.id !== currentId && (manualId == null ? ' · 다음 수업' : ' · 선택한 수업')}</p>
                <div className="today-note-list">{selected?.attendees.map(name => <div className="today-note today-note-editor" key={name}>
                    <div className="today-note-heading"><strong>{name}</strong></div>
                    <ChecklistByExercise memos={checklists[name]} checks={checklistChecks[name]} onToggle={onToggleChecklist && ((item, done) => onToggleChecklist(name, item, done))} />
                </div>)}</div>
                {selected && <button className="today-link today-log-link" onClick={() => onNavigate('training-log', selected)}>이 수업 훈련일지 열기 →</button>}
            </section>
        </div>
    </main>;
}

// 수강생에게 넣은 코치 체크리스트를 운동별로 — 수강생 훈련일지 체크리스트와 같은 앰버 카드(2026-11-05).
const monthDay = iso => { const date = new Date(iso); return Number.isNaN(date.getTime()) ? '' : `${date.getMonth() + 1}/${date.getDate()}`; };
export function ChecklistByExercise({ memos, checks = {}, onToggle }) {
    const [busy, setBusy] = useState(() => new Set());
    const [failed, setFailed] = useState('');
    async function toggle(item) {
        const key = item.key;
        if (!onToggle || busy.has(key)) return;
        setBusy(previous => new Set(previous).add(key)); setFailed('');
        try { await onToggle(item, !item.done); }
        catch (reason) { setFailed(reason?.message || '저장하지 못했습니다. 다시 눌러주세요.'); }
        finally { setBusy(previous => { const next = new Set(previous); next.delete(key); return next; }); }
    }
    if (memos === undefined) return <p className="today-muted">체크리스트 불러오는 중…</p>;
    if (memos === null) return <p className="today-note-error">체크리스트를 불러오지 못했습니다.</p>;
    const { groups, hiddenDone } = groupChecklistByExercise(memos, new Date(), checks);
    if (!groups.length) return <p className="today-muted">체크리스트 없음{hiddenDone ? ` · 지난 완료 ${hiddenDone}개` : ''}</p>;
    return <div className="today-checklist">
        {groups.map(group => <div className="today-checklist-group" key={group.exercise}>
            <h3>{group.exercise}</h3>
            <ul>{group.items.map(item => <li key={item.key} className={item.done ? 'is-done' : ''}>
                <label className="today-check-label">
                    <input type="checkbox" className="today-check" checked={item.done} disabled={!onToggle || busy.has(item.key)} onChange={() => toggle(item)} />
                    <span className="today-check-text">{item.text}</span>
                </label>
                {item.studentDone && <span className="today-check-student">수강생 완료</span>}
                <span className="today-check-date">{item.done ? `완료 ${monthDay(item.doneAt)}` : monthDay(item.createdAt)}</span>
            </li>)}</ul>
        </div>)}
        {hiddenDone > 0 && <p className="today-check-hidden">지난 완료 {hiddenDone}개 숨김</p>}
        {failed && <p className="today-note-error" role="alert">{failed}</p>}
    </div>;
}
