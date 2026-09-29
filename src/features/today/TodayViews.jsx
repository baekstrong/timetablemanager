import RefreshStatus from '../../components/RefreshStatus';
import { StudentTag } from '../../components/schedule/ScheduleCell';
import { useId, useRef, useState } from 'react';
import { visibleTaskGroups, currentLessonId, automaticLessonId } from './todayModel';
import './TodayViews.css';

export function ActionButton({ children, primary = false, ...props }) {
    return <button type="button" className={`today-button${primary ? ' today-button-primary' : ''}`} {...props}>{children}</button>;
}

export function TaskSection({ groups, onAction, currentPeriod, coach = false }) {
    const titleId = useId();
    const visible = visibleTaskGroups(groups);
    // No title, empty card or spacing when there is nothing to act on — both roles.
    if (!visible.length) return null;
    const count = visible.reduce((total, group) => total + group.items.length, 0);
    return <section className={`today-card today-tasks${coach ? ' today-tasks-coach' : ''}`} aria-labelledby={titleId}>
        <div className="today-section-title"><h2 id={titleId}>{coach ? '오늘 할 일' : '확인할 일'}</h2><span className="today-count">{count}</span></div>
        <div className="today-task-groups">{visible.map(group => <div key={group.id} className="today-task-group">
            {coach && <h3>{group.title}<span>{group.items.length}</span></h3>}
            {group.items.map(item => <div key={item.id} className={`today-task-row${currentPeriod != null && item.period === currentPeriod ? ' is-current' : ''}`}>
                <div><p className="today-task-title">{item.title}</p>{item.description && <p className="today-muted">{item.description}</p>}</div>
                <ActionButton onClick={() => onAction(item)} aria-label={`${item.title} ${item.actionLabel}`}>{item.actionLabel}</ActionButton>
            </div>)}
        </div>)}</div>
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

export function CoachToday({ onRefresh, refreshedAt, refreshing, refreshMessage, dateLabel, lessons, minutes, taskGroups, notes, notesReady = true, onAction, onSaveNote, onNavigate }) {
    const [manualId, setManualId] = useState(null);
    const [drafts, setDrafts] = useState({});
    const [editingNotes, setEditingNotes] = useState({});
    const [noteStatus, setNoteStatus] = useState({});
    const savingNames = useRef(new Set());
    async function saveNote(name) {
        if (!notesReady || !onSaveNote || savingNames.current.has(name)) return;
        const value = drafts[name] ?? notes[name] ?? '';
        savingNames.current.add(name);
        setNoteStatus(previous => ({ ...previous, [name]: 'saving' }));
        try {
            await onSaveNote(name, value);
            setDrafts(previous => ({ ...previous, [name]: value.trim() }));
            setNoteStatus(previous => ({ ...previous, [name]: 'saved' }));
            setEditingNotes(previous => ({ ...previous, [name]: false }));
        } catch {
            setNoteStatus(previous => ({ ...previous, [name]: 'error' }));
        } finally {
            savingNames.current.delete(name);
        }
    }

    const currentId = currentLessonId(lessons, minutes);
    const selectedId = manualId ?? automaticLessonId(lessons, minutes);
    const selected = lessons.find(lesson => lesson.id === selectedId);
    return <main className="today-page today-coach">
        <header className="today-header"><div><h1 className="today-coach-title">근력학교 · 코치</h1><span className="today-coach-date">{dateLabel}</span></div><div className="today-actions"><ActionButton onClick={() => onNavigate('dashboard')}>게시판</ActionButton><button className="today-link" onClick={() => onNavigate('logout')}>로그아웃</button></div></header>
        <TaskSection coach groups={taskGroups} onAction={onAction} currentPeriod={currentId} />
        <div className="today-coach-columns">
            <section className="today-card today-daily"><div className="today-section-title"><h2>오늘 수업</h2><span className="today-muted">{lessons.length}개 수업</span>{onRefresh && <RefreshStatus refreshedAt={refreshedAt} refreshing={refreshing} message={refreshMessage} onRefresh={onRefresh} />}</div>
                {lessons.length === 0 && <p className="today-empty">오늘 예정된 수업이 없습니다.</p>}
                {lessons.map(lesson => <button key={lesson.id} className={`today-lesson${lesson.id === currentId ? ' is-current' : ''}${lesson.id === selectedId ? ' is-selected' : ''}`} aria-pressed={lesson.id === selectedId} onClick={() => setManualId(lesson.id)}>
                    <div className="today-lesson-title"><strong>{lesson.id}교시</strong><span>{lesson.time}</span>{lesson.id === currentId && <b>수업 중</b>}</div>
                    <div className="today-lesson-body"><p><strong>{lesson.attendees.length}명</strong> <span className="today-muted">(여석: {lesson.availableSeats}자리)</span></p>
                        <div className="today-roster">{lesson.roster.map(person => <StudentTag key={person.name} {...person} />)}</div>
                    </div>
                </button>)}
            </section>
            <section className="today-card today-notes" aria-labelledby="today-notes-heading">
                <div className="today-section-title"><h2 id="today-notes-heading">코치 전용 메모</h2>{manualId != null && <button className="today-link" onClick={() => setManualId(null)}>현재 수업으로</button>}</div>
                <p className="today-muted">{selected ? `${selected.id}교시 · ${selected.time} · 참석 예정 ${selected.attendees.length}명` : '오늘 수업이 모두 끝났습니다.'}{selected && selected.id !== currentId && (manualId == null ? ' · 다음 수업' : ' · 선택한 수업')}</p>
                <div className="today-note-list">{selected?.attendees.map(name => {
                    const value = drafts[name] ?? notes[name] ?? '';
                    const status = noteStatus[name];
                    const saving = status === 'saving';
                    const changed = value !== (notes[name] || '');
                    return <div className="today-note today-note-editor" key={name}>
                        <div className="today-note-heading"><strong>{name}</strong>{!editingNotes[name] && <button type="button" className="today-link" disabled={!notesReady} aria-label={`${name} 메모 수정`} onClick={() => {
                            setDrafts(previous => ({ ...previous, [name]: notes[name] || '' }));
                            setNoteStatus(previous => ({ ...previous, [name]: '' }));
                            setEditingNotes(previous => ({ ...previous, [name]: true }));
                        }}>{notes[name] ? '수정' : '메모 쓰기'}</button>}</div>
                        {editingNotes[name] ? <><label className="today-field"><textarea
                            aria-label={`${name} 코치 전용 메모`} rows={3} value={value}
                            placeholder={notesReady ? '메모를 입력하세요.' : '메모를 불러오는 중…'}
                            disabled={!notesReady || saving}
                            onChange={event => {
                                setDrafts(previous => ({ ...previous, [name]: event.target.value }));
                                setNoteStatus(previous => ({ ...previous, [name]: '' }));
                            }}
                        /></label>
                        <div className="today-note-actions">
                            <span role={status === 'error' ? 'alert' : 'status'} className={status === 'error' ? 'today-note-error' : 'today-muted'}>
                                {status === 'error' ? '저장하지 못했습니다. 다시 저장해주세요.' : saving ? '저장 중…' : changed ? '저장하지 않은 변경사항' : status === 'saved' ? '저장되었습니다.' : ''}
                            </span>
                            <div className="today-actions"><ActionButton disabled={saving} onClick={() => {
                                setEditingNotes(previous => ({ ...previous, [name]: false }));
                                setDrafts(previous => ({ ...previous, [name]: notes[name] || '' }));
                                setNoteStatus(previous => ({ ...previous, [name]: '' }));
                            }} aria-label={`${name} 메모 수정 취소`}>취소</ActionButton><ActionButton primary disabled={!notesReady || saving || !changed} onClick={() => saveNote(name)} aria-label={`${name} 메모 저장`}>{saving ? '저장 중…' : '저장'}</ActionButton></div>
                        </div></> : <><p className={notes[name] ? '' : 'today-muted'}>{notesReady ? notes[name] || '등록된 메모가 없습니다.' : '메모를 불러오는 중…'}</p>{status === 'saved' && <span className="today-muted" role="status">저장되었습니다.</span>}</>}
                    </div>;
                })}</div>
                {selected && <button className="today-link today-log-link" onClick={() => onNavigate('training-log', selected)}>이 수업 훈련일지 열기 →</button>}
            </section>
        </div>
    </main>;
}
