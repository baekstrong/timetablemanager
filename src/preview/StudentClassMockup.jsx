import { Fragment, useState } from 'react';
import ReviewModal from '../features/today/ReviewModal';
import './student-class-mockup.css';
import TrainingLogMockup from './TrainingLogMockup';
import {
    TODAY, NOW, TIMES, DAYS, dateObject, dateLabel, dayName, shortDate,
    slotLabel, slotTime, weekDates, weekOf, isFuture, isActiveWait, initialState,
    getSessions, extendedEnd, quotaUsage, sourceOptions, slotStatus,
    holdingOptions, consecutiveSelection,
} from './studentClassMockupModel';

function Icon({ name, size = 22 }) {
    const paths = {
        calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18M8 15h2M14 15h2M8 18h2" /></>,
        book: <><path d="M12 5v16M12 5C8 2 4 3 2 4v15c3-1 6-1 10 2 4-3 7-3 10-2V4c-2-1-6-2-10 1Z" /><path d="M6 8h2M16 8h2" /></>,
        chat: <><path d="M21 11a8 8 0 0 1-8 8H7l-5 3 2-6a8 8 0 1 1 17-5Z" /><path d="M8 10h8M8 14h5" /></>,
        person: <><circle cx="12" cy="7" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></>,
        arrow: <path d="m9 5 7 7-7 7" />,
        check: <path d="m5 12 4 4L19 6" />,
    };
    return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.calendar}</svg>;
}
function Button({ children, primary = false, quiet = false, className = '', ...props }) {
    return <button type="button" className={`scm-button ${primary ? 'scm-primary' : ''} ${quiet ? 'scm-quiet' : ''} ${className}`} {...props}>{children}</button>;
}
function WeekNav({ week, onChange }) {
    const dates = weekDates(week);
    return <div className="scm-week-heading"><div><h2>{week === 0 ? '이번 주' : week === 1 ? '다음 주' : '다다음 주'}</h2><span>{shortDate(dates[0])} — {shortDate(dates[4])}</span></div><div className="scm-week-arrows"><button type="button" aria-label="이전 주" disabled={week === 0} onClick={() => onChange(week - 1)}>‹</button><button type="button" aria-label="다음 주" disabled={week === 2} onClick={() => onChange(week + 1)}>›</button></div></div>;
}
const typeLabel = type => ({ regular: '정규 수업', makeup: '보강', holding: '홀딩', absence: '결석' }[type]);
const nextId = state => `sample-${state.makeups.length + state.waits.length + state.breaks.length + 1}`;

export default function StudentClassMockup() {
    const [state, setState] = useState(initialState);
    const [mode, setMode] = useState('normal');
    const [page, setPage] = useState(() => new URLSearchParams(window.location.search).get('page') === 'training' ? 'training' : 'classes');
    const [tab, setTab] = useState('mine');
    const [week, setWeek] = useState(0);
    const [selectedDate, setSelectedDate] = useState(null);
    const [origin, setOrigin] = useState(null);
    const [modal, setModal] = useState(null);
    const [feedback, setFeedback] = useState('');
    const [trainingRevision, setTrainingRevision] = useState(0);
    const sessions = getSessions(state);
    const actualSessions = sessions.filter(item => !['holding', 'absence'].includes(item.type));
    const activeWaits = state.waits.filter(isActiveWait);
    const offer = activeWaits.find(item => item.status === 'offered');
    const holdingCount = state.breaks.filter(item => item.type === 'holding').flatMap(item => item.origins).length;
    const endDate = extendedEnd(holdingCount);
    const weekSessions = sessions.filter(item => weekOf(item.date) === week);
    const nextSession = weekSessions.find(item => isFuture(item) && !['holding', 'absence'].includes(item.type));
    const focusSession = selectedDate ? weekSessions.find(item => item.date === selectedDate) : nextSession;
    const remaining = actualSessions.filter(isFuture).length;
    const usage = quotaUsage(state, week);
    const origins = sourceOptions(state, week);
    const title = { classes: '내 수업', training: '훈련일지', board: '게시판', account: '내 정보' }[page];
    const navigate = target => { setPage(target); setModal(null); setFeedback(''); window.scrollTo({ top: 0, behavior: 'instant' }); };
    const changeWeek = value => { setWeek(value); setSelectedDate(null); setOrigin(null); };
    const reset = (scenario = 'normal') => {
        setTrainingRevision(value => value + 1);
        const sample = initialState();
        if (scenario === 'offer') sample.waits.push({ id: 'sample-offer', origin: { date: '2026-09-25', time: '19:50' }, target: { date: '2026-09-24', time: '18:00' }, status: 'offered' });
        setState(sample); setMode(scenario); setPage('classes'); setTab('mine'); setWeek(0); setSelectedDate(null); setOrigin(null); setModal(null); setFeedback('');
    };
    const startMakeup = selected => {
        setTab('all');
        if (selected) { setOrigin(selected.origin); return; }
        setModal({ type: 'source', selected: origin });
    };
    const returnToSchedule = (message, date) => { setModal(null); setTab('mine'); setPage('classes'); setOrigin(null); setSelectedDate(date || null); if (date) setWeek(Math.min(2, Math.max(0, weekOf(date)))); setFeedback(message); };
    const applyMakeup = () => {
        const selectedOrigin = modal.origin;
        const target = modal.target;
        const targetWeek = weekOf(target.date);
        const existingWait = modal.waitId && state.waits.find(item => item.id === modal.waitId && isActiveWait(item));
        if (!selectedOrigin || slotStatus(state, target, selectedOrigin).disabled || (!existingWait && !sourceOptions(state, targetWeek).some(item => item.date === selectedOrigin.date)) || quotaUsage(state, targetWeek) - (existingWait ? 1 : 0) >= 2) {
            setModal(null); setFeedback('이 수업은 지금 변경할 수 없어요. 신청 내역을 확인해주세요.'); return;
        }
        if (modal.waiting) {
            setState(current => ({ ...current, waits: [...current.waits, { id: nextId(current), origin: selectedOrigin, target, status: 'waiting' }] }));
            returnToSchedule(`${slotLabel(target)} 대기를 신청했어요. 원래 수업은 유지돼요.`, selectedOrigin.date);
        } else {
            setState(current => ({ ...current, makeups: [...current.makeups, { id: nextId(current), origin: selectedOrigin, target, status: 'active' }], waits: current.waits.map(item => item.id === modal.waitId ? { ...item, status: 'accepted' } : item) }));
            returnToSchedule(`${slotLabel(target)} 보강으로 옮겼어요.`, target.date);
        }
    };
    const cancelWait = (id, declined = false) => {
        setState(current => ({ ...current, waits: current.waits.map(item => item.id === id ? { ...item, status: declined ? 'declined' : 'cancelled' } : item) }));
        setModal(null); setFeedback(declined ? '제안받은 자리를 거절했어요. 원래 수업은 유지돼요.' : '보강 대기를 취소했어요. 원래 수업은 유지돼요.');
    };
    const applyBreak = () => {
        const options = holdingOptions(state, modal.breakType);
        if (!modal.selected.length || modal.selected.some(date => !options.some(item => item.origin.date === date)) || (modal.breakType === 'holding' && (!consecutiveSelection(options, modal.selected) || holdingCount > 0))) return;
        const request = { id: nextId(state), type: modal.breakType, origins: modal.selected, dates: modal.selected.map(date => options.find(item => item.origin.date === date).date) };
        setState(current => ({ ...current, breaks: [...current.breaks, request] }));
        returnToSchedule(modal.breakType === 'holding' ? `${request.origins.length}회 홀딩했어요. 종료일은 ${dateLabel(extendedEnd(holdingCount + request.origins.length))}이에요.` : `${request.origins.length}회 결석을 신청했어요. 종료일은 그대로예요.`, request.dates[0]);
    };
    const history = [...state.makeups.map(item => ({ ...item, label: item.status === 'cancelled' ? '보강 취소' : '보강', text: `${slotLabel(item.origin)} → ${slotLabel(item.target)}` })), ...state.waits.filter(item => item.status !== 'accepted').map(item => ({ ...item, label: isActiveWait(item) ? '보강 대기' : '대기 종료', text: slotLabel(item.target) })), ...state.breaks.map(item => ({ ...item, label: typeLabel(item.type), text: item.dates.map(dateLabel).join(' · ') }))];

    return <div className="scm-stage">
        <aside className="scm-demo-toolbar" aria-label="목업 설정"><div><strong>수강생 UX 목업</strong><span>예시 9/24(목) 13:00 · 가상 데이터</span></div><div><label><span className="scm-sr-only">예시 상황</span><select value={mode} onChange={event => reset(event.target.value)}><option value="normal">평소 화면</option><option value="offer">자리 제안 도착</option></select></label><button type="button" onClick={() => reset(mode)}>초기화</button></div><p>화면 안에서만 동작해요. 수업·종료일은 휴일을 제외하지 않은 수·금 예시입니다.</p></aside>
        <div className="scm-phone" data-page={page}>
            <header className="scm-header"><div><span className="scm-brand">근력학교</span><h1>{title}</h1></div><button type="button" className="scm-profile" onClick={() => navigate('account')} aria-label="민서님 내 정보"><span>민</span><span>민서님</span></button></header>
            <main className="scm-content">
                {feedback && <div className="scm-feedback" role="status"><Icon name="check" size={18} /><p>{feedback}</p><button type="button" aria-label="안내 닫기" onClick={() => setFeedback('')}>×</button></div>}
                {page === 'classes' && <>
                    {offer && <button type="button" className="scm-offer" onClick={() => setModal({ type: 'confirm', origin: offer.origin, target: offer.target, waitId: offer.id })}><span className="scm-offer-icon"><Icon name="calendar" size={20} /></span><span><strong>기다리던 자리가 났어요</strong><small>오늘 {offer.target.time} · 13:45까지 응답</small></span><Icon name="arrow" size={18} /></button>}
                    <div className="scm-tabs" role="tablist" aria-label="수업 보기"><button type="button" role="tab" aria-selected={tab === 'mine'} onClick={() => setTab('mine')}>내 일정</button><button type="button" role="tab" aria-selected={tab === 'all'} onClick={() => setTab('all')}>보강 시간표</button></div>
                    <WeekNav week={week} onChange={changeWeek} />
                    {tab === 'mine' ? <>
                        <div className="scm-personal-week" aria-label="요일별 내 일정">{weekDates(week).map((date, index) => {
                            const lessons = weekSessions.filter(item => item.date === date);
                            const item = lessons[0];
                            const moved = state.makeups.find(move => move.status === 'active' && move.origin.date === date && move.target.date !== date);
                            const active = item && !['holding', 'absence'].includes(item.type);
                            const isSelected = selectedDate === date;
                            return <button key={date} type="button" className={`scm-day ${active ? 'has-class' : ''} ${date === TODAY ? 'is-today' : ''} ${isSelected ? 'is-selected' : ''} ${item && !isFuture(item) ? 'is-past' : ''}`} aria-pressed={isSelected} aria-label={`${dateLabel(date)} ${item ? `${item.time} ${typeLabel(item.type)}` : moved ? '보강으로 이동' : '수업 없음'}`} onClick={() => setSelectedDate(date)}><span className="scm-day-name">{DAYS[index]}{date === TODAY && <i />}</span><strong>{dateObject(date).getDate()}</strong><span className="scm-day-time">{item ? item.time : '—'}</span><small>{item ? ['holding', 'absence'].includes(item.type) ? typeLabel(item.type) : !isFuture(item) ? '지난 수업' : item.type === 'makeup' ? '보강' : '예정' : moved ? '이동함' : date === TODAY ? '오늘' : '\u00a0'}</small>{lessons.length > 1 && <em>+{lessons.length - 1}</em>}</button>;
                        })}</div>
                        <section className="scm-focus" aria-label="선택한 수업 상세">
                            {focusSession ? <><div className="scm-eyebrow">{selectedDate ? `${dateLabel(selectedDate)} 수업` : '다음 수업'}<span className={`scm-chip ${['holding', 'absence'].includes(focusSession.type) ? 'scm-chip-muted' : ''}`}>{typeLabel(focusSession.type)}</span></div><div className="scm-big-time">{focusSession.time}</div><p className="scm-focus-date">{focusSession.date === '2026-09-25' ? '내일 금요일' : focusSession.date === TODAY ? '오늘 목요일' : `${dateLabel(focusSession.date)}`}<span> · 90분</span></p>
                                {focusSession.type === 'makeup' && <p className="scm-helper">{slotLabel(focusSession.origin)} 수업을 옮겼어요.</p>}
                                {focusSession.type === 'holding' ? <p className="scm-helper">이날은 쉬어가세요. 쉬는 횟수만큼 수강 기간이 늘어났어요.</p> : focusSession.type === 'absence' ? <p className="scm-helper">결석 신청한 수업이에요. 수강 횟수는 사용하고 종료일은 유지돼요.</p> : !isFuture(focusSession) ? <Button quiet onClick={() => navigate('training')}>이날 훈련일지 보기 <Icon name="arrow" size={15} /></Button> : activeWaits.some(wait => wait.origin.date === focusSession.origin.date) ? <p className="scm-helper">보강 대기 중이에요. 수락 전까지 이 수업은 유지돼요.</p> : <div className="scm-actions">{focusSession.type === 'makeup' ? <Button primary onClick={() => setModal({ type: 'cancel-makeup', session: focusSession })}>보강 취소</Button> : <Button primary disabled={week !== 0 || usage >= 2 || slotTime(focusSession) - NOW < 7200000} onClick={() => startMakeup(focusSession)}>보강 신청</Button>}<Button onClick={() => setModal({ type: 'break', step: 1, breakType: 'holding', selected: [] })}>홀딩·결석</Button></div>}</> : <div className="scm-empty-day"><span className="scm-eyebrow">{selectedDate ? `${dateLabel(selectedDate)} 일정` : '이번 주 일정'}</span><h3>{state.makeups.some(item => item.status === 'active' && item.origin.date === selectedDate) ? '다른 시간으로 옮겼어요' : '예정된 수업이 없어요'}</h3><p>{nextSession ? `다음 수업은 ${slotLabel(nextSession)}이에요.` : '다른 주의 수업을 확인해보세요.'}</p>{nextSession && <Button quiet onClick={() => setSelectedDate(nextSession.date)}>다음 수업 보기 <Icon name="arrow" size={15} /></Button>}</div>}
                        </section>
                        {activeWaits.filter(item => item.status === 'waiting').map(wait => <section className="scm-wait-card" key={wait.id}><div><span className="scm-chip">보강 대기 중</span><h3>{slotLabel(wait.target)}</h3><p>원래 수업 · {slotLabel(wait.origin)}</p></div><Button quiet onClick={() => setModal({ type: 'cancel-wait', wait })}>대기 취소</Button></section>)}
                        <div className="scm-membership-strip"><div><span>남은 수업</span><strong>{remaining}<small>회</small></strong></div><div><span>수강 종료일</span><strong>{shortDate(endDate)}<small>{dayName(endDate)}</small></strong></div><button type="button" aria-label="수강권 자세히 보기" onClick={() => navigate('account')}><Icon name="arrow" size={18} /></button></div>
                        <button type="button" className="scm-training-link" onClick={() => navigate('training')}><span><strong>지난 수업, 어떻게 했더라?</strong><small>훈련일지에서 내 기록 이어보기</small></span><Icon name="arrow" size={18} /></button>
                    </> : <>
                        <button type="button" className="scm-source-card" onClick={() => setModal({ type: 'source', selected: origin })}><span><small>옮길 수업</small><strong>{origin ? slotLabel(origin) : '내 수업을 먼저 선택하세요'}</strong></span><span className="scm-link-text">{origin ? '변경' : '선택'} <Icon name="arrow" size={15} /></span></button>
                        <div className="scm-grid-heading"><p>{origin ? '원하는 시간을 선택하세요' : '이번 주 보강 가능한 시간'}</p><span>{usage}/2회</span></div>
                        {week !== 0 && <p className="scm-inline-notice">미래 주는 일정만 확인할 수 있어요. 보강은 이번 주 수업끼리 신청해요.</p>}
                        {usage >= 2 && <p className="scm-inline-notice">이번 주 보강·대기 한도를 모두 사용했어요.</p>}
                        <div className="scm-slot-grid" aria-label="보강 가능한 시간표"><span className="scm-grid-corner">시간</span>{weekDates(week).map((date, index) => <div key={date} className={`scm-grid-day ${date === TODAY ? 'is-today' : ''}`}><span>{DAYS[index]}</span><strong>{dateObject(date).getDate()}</strong></div>)}{TIMES.map(time => <Fragment key={time}><span className="scm-grid-time">{time}</span>{weekDates(week).map(date => {
                            const slot = { date, time };
                            const status = slotStatus(state, slot, origin);
                            return <button type="button" key={date} className={`scm-slot ${status.kind}`} disabled={status.disabled || usage >= 2} aria-label={`${slotLabel(slot)} ${status.label}`} onClick={() => { if (!origin) setModal({ type: 'source', selected: null, target: slot }); else setModal({ type: 'confirm', origin, target: slot, waiting: status.kind === 'wait' }); }}>{status.label}</button>;
                        })}</Fragment>)}</div>
                        <p className="scm-grid-note"><span className="scm-legend" /> 빈자리 · 만석인 수업은 대기 신청</p><p className="scm-helper">대기만으로 수업이 이동하지 않아요. 자리가 나면 직접 수락해요.</p>
                        <details className="scm-details"><summary>보강 신청 기준</summary><p>원래 수업과 보강 수업은 이번 주 안에서, 시작 2시간 전까지 선택해요. 미래 주는 일정만 확인할 수 있어요.</p><p>주 2회 한도에는 보강 신청 이력(취소 포함)과 현재 대기가 포함돼요. 대기를 취소하면 대기 한도는 돌아와요.</p></details>
                    </>}
                </>}
                <div hidden={page !== 'training'}><TrainingLogMockup key={trainingRevision} /></div>
                {page === 'board' && <><div className="scm-page-intro"><span className="scm-eyebrow">함께 오래 운동하기</span><h2>근력학교 소식</h2></div><button type="button" className="scm-post" onClick={() => setModal({ type: 'post', post: 'notice' })}><span className="scm-post-meta">공지 · 9.23</span><strong>처음 오신 분을 위한 수업 안내</strong><p>준비물부터 수업 전 도착 시간까지.</p><span className="scm-post-footer">백관장 <Icon name="arrow" size={15} /></span></button><button type="button" className="scm-post" onClick={() => setModal({ type: 'post', post: 'column' })}><span className="scm-post-meta">칼럼 · 9.21</span><strong>같은 무게가 가벼워졌다면</strong><p>중량이 그대로여도, 몸은 성장하고 있어요.</p><span className="scm-post-footer">백관장 <Icon name="arrow" size={15} /></span></button></>}
                {page === 'account' && <><div className="scm-account-name"><span>민</span><div><h2>민서님</h2><p>오늘도 나답게, 단단하게.</p></div></div><section className="scm-pass"><div className="scm-section-heading"><h2>내 수강권</h2><span className="scm-chip">수강 중</span></div><p className="scm-pass-title">주 2회 · 수요일 · 금요일</p><p className="scm-helper">19:50 — 21:20</p><dl><div><dt>남은 수업</dt><dd>{remaining}회</dd></div><div><dt>수강 종료일</dt><dd>{dateLabel(endDate)}</dd></div><div><dt>홀딩</dt><dd>{holdingCount ? `${holdingCount}회 수업 사용` : '1회 신청 가능 · 최대 2수업'}</dd></div></dl></section><section className="scm-history"><h2>신청 내역</h2>{history.length ? history.slice().reverse().map(item => <div key={item.id}><span className="scm-chip scm-chip-muted">{item.label}</span><p>{item.text}</p>{item.status === 'active' && sessions.some(session => session.makeupId === item.id && session.type === 'makeup') && <Button quiet onClick={() => setModal({ type: 'cancel-makeup', session: sessions.find(session => session.makeupId === item.id) })}>보강 취소</Button>}{isActiveWait(item) && <Button quiet onClick={() => setModal({ type: 'cancel-wait', wait: item })}>대기 취소</Button>}</div>) : <p className="scm-helper">아직 신청한 내역이 없어요.</p>}</section></>}
            </main>
            <nav className="scm-bottom-nav" aria-label="주 메뉴">{[['classes', 'calendar', '내 수업'], ['training', 'book', '훈련일지'], ['board', 'chat', '게시판'], ['account', 'person', '내 정보']].map(([value, icon, label]) => <button type="button" key={value} aria-current={page === value ? 'page' : undefined} onClick={() => navigate(value)}><Icon name={icon} /><span>{label}</span></button>)}</nav>
        </div>
        {modal && <ReviewModal title={modal.type === 'source' ? '어느 수업을 옮길까요?' : modal.type === 'confirm' ? modal.waitId ? '기다리던 자리가 났어요' : modal.waiting ? '이 시간에 대기할까요?' : '이 시간으로 옮길까요?' : modal.type === 'break' ? '홀딩·결석 신청' : modal.type === 'cancel-makeup' ? '보강을 취소할까요?' : modal.type === 'cancel-wait' ? '대기를 취소할까요?' : modal.post === 'notice' ? '처음 오신 분을 위한 수업 안내' : '같은 무게가 가벼워졌다면'} onClose={() => setModal(null)}><div className="scm-modal-body">
            {modal.type === 'source' && <><p className="scm-helper">{shortDate(weekDates(week)[0])} — {shortDate(weekDates(week)[4])} · 이번 주 내 수업</p><div className="scm-choice-list">{origins.length ? origins.map(item => <button type="button" key={item.date} className={modal.selected?.date === item.date ? 'is-selected' : ''} aria-pressed={modal.selected?.date === item.date} onClick={() => setModal(current => ({ ...current, selected: item.origin }))}><span><strong>{slotLabel(item)}</strong><small>정규 수업</small></span><span className="scm-radio">{modal.selected?.date === item.date && <i />}</span></button>) : <p className="scm-helper">이 주에는 옮길 수 있는 수업이 없어요. 이미 변경한 수업이나 신청 내역을 확인해주세요.</p>}</div><Button primary className="scm-full" disabled={!modal.selected || usage >= 2} onClick={() => { setOrigin(modal.selected); if (modal.target) { const status = slotStatus(state, modal.target, modal.selected); if (status.disabled) { setModal(null); setFeedback('이 수업으로는 선택한 시간에 옮길 수 없어요. 다른 시간을 선택해주세요.'); } else setModal({ type: 'confirm', origin: modal.selected, target: modal.target, waiting: status.kind === 'wait' }); } else setModal(null); }}>보강 시간 선택</Button></>}
            {modal.type === 'confirm' && <><div className="scm-route"><div><span>원래 수업</span><strong>{slotLabel(modal.origin)}</strong></div><span className="scm-route-arrow">↓</span><div className="scm-route-target"><span>{modal.waiting ? '대기할 수업' : '보강 수업'}</span><strong>{slotLabel(modal.target)}</strong></div></div><p className="scm-confirm-copy">{modal.waiting ? '자리를 수락하기 전에는 원래 수업이 유지돼요.' : `${dateLabel(modal.origin.date)} ${modal.origin.time} 대신, 선택한 시간에 오세요.`}</p>{modal.waitId && <p className="scm-inline-notice">오늘 13:45까지 수락할 수 있어요.</p>}<div className="scm-policy-note"><p>신청 후 이번 주 보강·대기 {quotaUsage(state, weekOf(modal.target.date)) + (modal.waitId ? 0 : 1)}/2회</p><p>{modal.waiting ? '대기를 취소하면 대기 한도는 돌아와요.' : '보강을 취소해도 사용 횟수는 돌아오지 않아요.'}</p></div><div className="scm-actions"><Button onClick={() => modal.waitId ? cancelWait(modal.waitId, true) : setModal({ type: 'source', selected: modal.origin })}>{modal.waitId ? '이번에는 거절' : '다시 선택'}</Button><Button primary onClick={applyMakeup}>{modal.waiting ? '대기 신청' : modal.waitId ? '자리 수락' : '보강 확정'}</Button></div></>}
            {modal.type === 'cancel-wait' && <><p className="scm-confirm-copy">{slotLabel(modal.wait.target)} 대기를 취소해요.</p><p className="scm-helper">원래 수업인 {slotLabel(modal.wait.origin)}은 그대로 유지돼요.</p><div className="scm-actions"><Button onClick={() => setModal(null)}>유지하기</Button><Button primary onClick={() => cancelWait(modal.wait.id)}>대기 취소</Button></div></>}
            {modal.type === 'cancel-makeup' && <><div className="scm-route"><div><span>보강 취소</span><strong>{slotLabel(modal.session)}</strong></div><span className="scm-route-arrow">↓</span><div><span>원래 수업으로 돌아가요</span><strong>{slotLabel(modal.session.origin)}</strong></div></div><p className="scm-helper">예시에서는 원래 수업에 자리가 있어요. 취소한 보강도 주간 사용 횟수에 포함돼요.</p><div className="scm-actions"><Button onClick={() => setModal(null)}>유지하기</Button><Button primary onClick={() => { setState(current => ({ ...current, makeups: current.makeups.map(item => item.id === modal.session.makeupId ? { ...item, status: 'cancelled' } : item) })); returnToSchedule('보강을 취소하고 원래 수업으로 돌아왔어요.', modal.session.origin.date); }}>보강 취소</Button></div></>}
            {modal.type === 'break' && <><div className="scm-step-label"><span>{modal.step}/3</span>{modal.step === 1 ? '신청 종류' : modal.step === 2 ? '쉬는 수업 선택' : '신청 내용 확인'}</div>{modal.step === 1 ? <><div className="scm-choice-list"><button type="button" disabled={holdingCount > 0} className={modal.breakType === 'holding' ? 'is-selected' : ''} aria-pressed={modal.breakType === 'holding'} onClick={() => setModal(current => ({ ...current, breakType: 'holding' }))}><span><strong>홀딩</strong><small>연속된 수업을 쉬고, 기간을 늘려요.</small><small>{holdingCount ? '이번 수강권에서 이미 사용했어요.' : '최대 2수업 · 주를 넘어 선택할 수 있어요.'}</small></span><span className="scm-radio">{modal.breakType === 'holding' && <i />}</span></button><button type="button" className={modal.breakType === 'absence' ? 'is-selected' : ''} aria-pressed={modal.breakType === 'absence'} onClick={() => setModal(current => ({ ...current, breakType: 'absence' }))}><span><strong>결석</strong><small>수업에 참석하지 않아요.</small><small>수강 횟수는 사용하고, 기간은 유지돼요.</small></span><span className="scm-radio">{modal.breakType === 'absence' && <i />}</span></button></div><Button primary className="scm-full" disabled={modal.breakType === 'holding' && holdingCount > 0} onClick={() => setModal(current => ({ ...current, step: 2 }))}>날짜 선택</Button></> : modal.step === 2 ? <><p className="scm-helper">{modal.breakType === 'holding' ? '연속된 실제 수업을 최대 2개 선택하세요.' : '결석할 수업을 선택하세요.'}</p><div className="scm-choice-list">{holdingOptions(state, modal.breakType).map(item => {
                const selected = modal.selected.includes(item.origin.date);
                const next = selected ? modal.selected.filter(date => date !== item.origin.date) : [...modal.selected, item.origin.date];
                const disabled = !selected && modal.breakType === 'holding' && !consecutiveSelection(holdingOptions(state, modal.breakType), next);
                return <button type="button" key={item.origin.date} disabled={disabled} className={selected ? 'is-selected' : ''} aria-pressed={selected} onClick={() => setModal(current => ({ ...current, selected: next }))}><span><strong>{slotLabel(item)}</strong><small>{typeLabel(item.type)}</small></span><span className="scm-checkbox">{selected && <Icon name="check" size={16} />}</span></button>;
            })}</div>{!holdingOptions(state, modal.breakType).length && <p className="scm-helper">지금 신청할 수 있는 수업이 없어요.</p>}<div className="scm-actions"><Button onClick={() => setModal(current => ({ ...current, step: 1, selected: [] }))}>이전</Button><Button primary disabled={!modal.selected.length || (modal.breakType === 'holding' && !consecutiveSelection(holdingOptions(state, modal.breakType), modal.selected))} onClick={() => setModal(current => ({ ...current, step: 3 }))}>신청 내용 확인</Button></div></> : <><div className="scm-break-summary"><span className="scm-chip">{typeLabel(modal.breakType)} · {modal.selected.length}수업</span>{modal.selected.map(date => <strong key={date}>{slotLabel(holdingOptions(state, modal.breakType).find(item => item.origin.date === date))}</strong>)}</div><div className="scm-result-panel"><span>수강 종료일</span><strong>{modal.breakType === 'holding' ? `${shortDate(endDate)} → ${shortDate(extendedEnd(holdingCount + modal.selected.length))}` : `${shortDate(endDate)} · 변경 없음`}</strong><p>{modal.breakType === 'holding' ? `${modal.selected.length}회 수업만큼 뒤로 늘어나요.` : '선택한 수업은 소진돼요. 수강 기간은 늘어나지 않아요.'}</p></div><div className="scm-actions"><Button onClick={() => setModal(current => ({ ...current, step: 2 }))}>날짜 다시 선택</Button><Button primary onClick={applyBreak}>{typeLabel(modal.breakType)} 신청</Button></div></>}</>}
            {modal.type === 'post' && <article className="scm-article"><span className="scm-post-meta">백관장 · 예시 글</span>{modal.post === 'notice' ? <><p>수업 시작 5분 전까지 도착해서 편하게 몸을 풀어주세요.</p><p>실내용 운동화, 운동하기 편한 옷, 개인 물통이면 충분해요.</p><p>처음이라 낯선 동작은 코치에게 바로 알려주세요. 함께 천천히 맞춰가면 됩니다.</p></> : <><p>지난주와 같은 무게인데 조금 더 편하게 들렸나요? 그것도 분명한 변화예요.</p><p>자세가 안정되고, 호흡이 편해지고, 마지막 한 번을 더 자신 있게 해냈다면 몸은 이미 적응하고 있습니다.</p><p>오늘의 기록에는 숫자와 함께 그 느낌도 한 줄 남겨보세요.</p></>}<Button className="scm-full" onClick={() => setModal(null)}>닫기</Button></article>}
        </div></ReviewModal>}
    </div>;
}
