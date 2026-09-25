import { Fragment, useState } from 'react';
import { ActionButton, RecentStories } from '../features/today/TodayViews';
import ReviewModal from '../features/today/ReviewModal';
import BottomNav from '../components/BottomNav';
import './student-timetable.css';

const days = ['월', '화', '수', '목', '금'];
const periods = ['10:00', '12:00', '15:00', '18:00', '19:50', '21:40'];
const seats = [[3, 2, 0, 2, 3], [2, 0, 3, 1, 2], [null, null, null, null, null], [0, 2, 1, 2, 0], [2, 1, 2, 0, 2], [null, 2, null, 1, null]];
const dateAt = (week, day) => new Date(2026, 8, 21 + week * 7 + day);
const shortDate = date => `${date.getMonth() + 1}.${date.getDate()}`;
const label = slot => `${shortDate(dateAt(slot.week, slot.day))}(${days[slot.day]}) ${periods[slot.row]}`;

export default function StudentTimetablePreview({ empty }) {
    const [page, setPage] = useState('today');
    const [week, setWeek] = useState(0);
    const [modal, setModal] = useState(null);
    const [selected, setSelected] = useState(false);
    const [moved, setMoved] = useState(null);
    const [waiting, setWaiting] = useState(null);
    const [absence, setAbsence] = useState('');
    const [contract, setContract] = useState(true);
    const [agreed, setAgreed] = useState(false);
    const [notice, setNotice] = useState('');
    const navigate = target => { setPage(target); window.scrollTo(0, 0); };
    const openSlot = slot => { setSelected(false); setModal({ type: seats[slot.row][slot.day] === 0 ? 'wait' : 'makeup', slot }); };
    const nextLabel = absence ? `${absence} 신청됨 · 신청 내역을 확인해주세요` : moved ? `다음 수업 · ${label(moved)} 보강` : '다음 수업 · 내일 금요일 19:50';
    const complete = () => {
        if (modal.type === 'wait') { setWaiting(modal.slot); setNotice('보강 대기를 신청했어요. 원래 수업은 그대로 유지됩니다.'); }
        else { setMoved(modal.slot); setWaiting(null); setNotice('보강 신청 완료 · 시간표에 반영했어요.'); }
        setModal(null);
    };
    return <>
        <main className="today-page today-student student-timetable-preview">
            <header className="student-home-header"><div><span>근력학교</span><h1>민서님의 수업</h1></div><button className="today-link" onClick={() => setModal({ type: 'account' })}>내 정보</button></header>
            {page === 'today' ? <>
                {!empty && contract && <button className="student-task-strip" onClick={() => { setAgreed(false); setModal({ type: 'contract' }); }}><span><b>확인할 일 1</b> 재등록 계약이 도착했어요</span><span aria-hidden="true">›</span></button>}
                <section className="today-card student-grid-card" aria-label="주간 시간표">
                    <div className="student-week-heading"><h2>내 시간표</h2><div><button aria-label="이전 주" disabled={week === -1} onClick={() => setWeek(value => value - 1)}>‹</button><strong>{shortDate(dateAt(week, 0))} — {shortDate(dateAt(week, 4))}</strong><button aria-label="다음 주" disabled={week === 1} onClick={() => setWeek(value => value + 1)}>›</button></div></div>
                    <div className="student-next"><span>{week === 0 ? nextLabel : '지난주·다음 주 수업도 한눈에 확인하세요'}</span>{week !== 0 && <button className="today-link" onClick={() => setWeek(0)}>이번 주</button>}</div>
                    <div className="student-grid" role="group" aria-label="요일과 시간별 수업">
                        <span className="student-grid-corner">시간</span>{days.map((day, i) => <div key={day} className={`student-day ${week === 0 && i === 3 ? 'is-today' : ''}`}><span>{day}</span><strong>{dateAt(week, i).getDate()}</strong></div>)}
                        {periods.map((time, row) => <Fragment key={time}>
                            <div className="student-time"><strong>{time}</strong><span>{row + 1}교시{row === 2 ? '·자율' : ''}</span></div>
                            {days.map((day, col) => {
                                const slot = { row, day: col, week };
                                const original = row === 4 && [2, 4].includes(col);
                                const movedHere = week === 0 && moved?.row === row && moved.day === col;
                                const movedFrom = week === 0 && original && col === 4 && moved;
                                const held = week === 0 && original && col === 4 && absence;
                                const past = week < 0 || (week === 0 && (col < 3 || (col === 3 && row < 2)));
                                const unavailable = seats[row][col] == null;
                                const text = held || (movedFrom ? '이동' : movedHere ? '보강' : original ? '내 수업' : unavailable ? '—' : past ? '종료' : seats[row][col] === 0 ? '만석' : `여석 ${seats[row][col]}`);
                                const disabled = past || unavailable;
                                const mine = (original && !held && !movedFrom) || movedHere;
                                return <button key={day} className={`student-slot ${mine ? 'is-mine' : ''} ${movedFrom || held ? 'is-changed' : ''} ${unavailable ? 'is-off' : ''} ${past ? 'is-past' : ''}`} disabled={disabled} aria-label={`${label(slot)} ${text}`} onClick={() => {
                                    if (week !== 0) { setModal({ type: 'future' }); return; }
                                    if (original || movedHere) { setModal({ type: 'lesson', slot }); return; }
                                    if (moved || absence) { setModal({ type: 'already' }); return; }
                                    openSlot(slot);
                                }}><span>{text}</span>{mine && <small>{past ? '지난 수업' : '예정'}</small>}</button>;
                            })}
                        </Fragment>)}
                    </div>
                    <p className="student-grid-hint"><i /> 내 수업 <span>빈자리를 누르면 보강 신청</span></p>
                    <div className="today-actions"><ActionButton onClick={() => setModal({ type: 'holding' })}>홀딩·결석 신청</ActionButton><ActionButton onClick={() => navigate('training-log')}>훈련일지 쓰기</ActionButton></div>
                    <details className="student-help"><summary>보강 이용 안내</summary><p>원래 수업과 보강 수업 모두 시작 2시간 전까지 신청할 수 있어요. 만석인 칸은 대기 신청이 가능합니다. 취소한 신청도 주간 보강 횟수에 포함됩니다.</p></details>
                </section>
                {notice && <p className="student-feedback" role="status">{notice}</p>}
                <details className="today-card today-waiting"><summary>대기·신청 내역 <span>{Number(Boolean(moved || waiting || absence))}건</span></summary><p className="today-muted">{moved ? `보강 · 9/25(금) 19:50 → ${label(moved)}` : waiting ? `보강 대기 · ${label(waiting)}` : absence ? `${absence} · 9/25(금) 19:50` : '진행 중인 신청이 없습니다.'}</p>{waiting && <ActionButton onClick={() => { setWaiting(null); setNotice('대기를 취소했어요.'); }}>대기 취소</ActionButton>}</details>
                <RecentStories posts={[{ id: 'post', category: '칼럼', timeLabel: '오늘', title: '같은 무게가 가벼워졌다면', excerpt: '중량이 그대로여도, 몸은 성장하고 있어요.', unread: true }]} onPost={() => navigate('dashboard')} onBoard={() => navigate('dashboard')} />
            </> : <section className="today-card"><h2>{{ 'training-log': '훈련일지', dashboard: '게시판', myinfo: '내 정보' }[page]}</h2><p className="today-empty">실제 앱에서는 기존 { { 'training-log': '훈련일지', dashboard: '게시판', myinfo: '내 정보' }[page]} 화면으로 연결됩니다.</p><ActionButton onClick={() => navigate('today')}>홈으로 돌아가기</ActionButton></section>}
        </main>
        <BottomNav user={{ role: 'student' }} currentPage={page} onNavigate={navigate} preview />
        {modal && <ReviewModal title={{ makeup: '보강 신청', wait: '보강 대기', holding: '홀딩·결석 신청', contract: '재등록 계약 확인', lesson: '내 수업', future: '다음 주 수업', already: '신청 내역 확인', account: '내 정보' }[modal.type]} onClose={() => setModal(null)}>
            {['makeup', 'wait'].includes(modal.type) ? <>
                <p className="today-muted">1. 옮길 수업을 선택해주세요</p><button className="student-original" aria-pressed={selected} onClick={() => setSelected(value => !value)}><span>9/25(금) 19:50 <small>정규 수업</small></span><b>{selected ? '✓' : '○'}</b></button>
                <p className="today-muted">2. {modal.type === 'wait' ? '대기할' : '변경할'} 시간</p><div className="student-destination"><strong>{label(modal.slot)}</strong><span>{modal.type === 'wait' ? '만석 · 자리 안내 후 수락' : `여석 ${seats[modal.slot.row][modal.slot.day]}자리`}</span></div>
                <p className="student-confirm-note">{modal.type === 'wait' ? '지금은 대기만 신청됩니다. 자리가 나고 수락하면 수업이 이동해요.' : '금요일 수업이 선택한 시간으로 이동해요. 이번 주 수업 횟수는 그대로예요.'}</p>
                <p className="today-muted">예시: 이번 신청 후 보강·대기 1/2회 사용</p><div className="today-actions"><ActionButton onClick={() => setModal(null)}>돌아가기</ActionButton><ActionButton primary disabled={!selected} onClick={complete}>{modal.type === 'wait' ? '대기 신청' : '이 시간으로 변경'}</ActionButton></div>
            </> : modal.type === 'holding' ? <><p className="today-muted">이 목업에서는 다음 정규 수업 1건을 선택할 수 있어요. 실제 신청은 월간 달력으로 연결할 예정입니다.</p><div className="student-destination"><strong>9/25(금) 19:50</strong><span>{moved ? '이미 보강으로 이동한 수업' : '다음 정규 수업'}</span></div><div className="today-actions">{['홀딩', '결석'].map(type => <ActionButton key={type} disabled={Boolean(moved)} onClick={() => { setAbsence(type); setWaiting(null); setModal(null); setNotice(`${type} 신청을 예시 시간표에 반영했어요.`); }}>{type} 반영 보기</ActionButton>)}</div></> : modal.type === 'contract' ? <><p>주 2회 · 수·금 19:50</p><p className="today-empty">화면 검토용 예시입니다. 실제 계약은 체결되지 않습니다.</p><label><input type="checkbox" checked={agreed} onChange={event => setAgreed(event.target.checked)} /> 예시 계약 확인</label><div className="today-actions"><ActionButton primary disabled={!agreed} onClick={() => { setContract(false); setModal(null); }}>확인 완료</ActionButton></div></> : <><p className="today-empty">{modal.type === 'future' ? '보강은 당주 수업에서 신청할 수 있어요. 이번 주로 돌아가 빈자리를 선택해주세요.' : modal.type === 'already' ? '이미 이동하거나 홀딩·결석을 신청한 수업이에요. 홈의 신청 내역을 확인해주세요.' : modal.type === 'lesson' ? `${label(modal.slot)} · 일정 변경은 시간표의 빈자리에서 신청하세요.` : '수강권·남은 횟수·설정은 내 정보에서 확인합니다.'}</p><ActionButton onClick={() => { if (modal.type === 'account') navigate('myinfo'); setModal(null); }}>확인</ActionButton></>}
        </ReviewModal>}
    </>;
}
