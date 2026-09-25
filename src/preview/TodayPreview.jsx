/* eslint-disable react-refresh/only-export-components -- Dedicated local preview entry, not a production module. */
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import { StudentToday, CoachToday, ActionButton } from '../features/today/TodayViews';
import ReviewModal from '../features/today/ReviewModal';
import BottomNav from '../components/BottomNav';
import './preview.css';
import StudentTimetablePreview from './StudentTimetablePreview';

const roster = (...names) => names.map(name => ({ name }));
const lessons = [
    { id: 1, startMinute: 600, endMinute: 690, time: '10:00 — 11:30', attendees: ['김민서', '이준호'], availableSeats: 5, roster: roster('김민서', '이준호') },
    { id: 2, startMinute: 720, endMinute: 810, time: '12:00 — 13:30', attendees: ['박서연', '최지수', '김도윤'], availableSeats: 4, roster: roster('박서연', '최지수', '김도윤') },
    { id: 4, startMinute: 1080, endMinute: 1170, time: '18:00 — 19:30', attendees: ['이주리', '이귀정'], availableSeats: 5, roster: roster('이주리', '이귀정') },
    { id: 5, startMinute: 1190, endMinute: 1280, time: '19:50 — 21:20', attendees: ['이주리', '이귀정', '김수미'], availableSeats: 4, roster: [...roster('이주리', '이귀정'), { name: '송영훈', status: 'makeupMoved', label: '보강이동' }, { name: '김수미', status: 'makeup', label: '보강' }, { name: '정순영', status: 'holding', label: '홀딩' }] },
];
const coachGroups = [
    { id: 'end', title: '오늘 마지막 수업', items: [
        { id: 'e1', title: '조동환(월5수5, 31) · 5교시', period: 5, type: 'renewal', name: '조동환', actionLabel: '재등록' },
        { id: 'e2', title: '박서연(월2수2, 31) · 2교시', period: 2, type: 'renewal', name: '박서연', actionLabel: '재등록' },
    ] },
    { id: 'pay', title: '미결제', items: [{ id: 'p1', title: '이귀정(월5수5, 31) · 5교시', period: 5, type: 'payment', name: '이귀정', actionLabel: '결제 확인' }] },
    { id: 'new', title: '신규 신청', items: [{ id: 'n1', title: '한지민', description: '화·목 4교시 신청', type: 'new', name: '한지민', actionLabel: '신청 확인' }] },
];
const studentTasks = [{ id: 'student', items: [
    { id: 'offer', type: 'offer', title: '보강 자리가 났어요', description: '9/24 목 18:00 · 응답 45분 남음', actionLabel: '자리 확인' },
    { id: 'contract', type: 'contract', title: '재등록 계약을 확인해주세요', description: '다음 수강권 · 주 2회', actionLabel: '계약 확인' },
] }];
const regularWeek = [
    { id: 'wed', date: '2026-09-23', day: '수', time: '19:50 — 21:20', status: '정규', description: '오늘 수업' },
    { id: 'fri', date: '2026-09-25', day: '금', time: '19:50 — 21:20', status: '정규', description: '정규 수업' },
];
const posts = [
    { id: 'b1', category: '칼럼', timeLabel: '30분 전', title: '같은 무게가 가벼워졌다면', excerpt: '중량이 그대로여도, 몸은 성장하고 있어요.', unread: true },
    { id: 'b2', category: '자유', timeLabel: '1시간 전', title: '처음으로 스쿼트 40kg 성공했어요!', excerpt: '처음엔 빈 봉도 무거웠는데 오늘 드디어…', unread: true },
];

function Preview() {
    const [refreshedAt, setRefreshedAt] = useState(() => Date.now());
    const [role, setRole] = useState(new URLSearchParams(location.search).get('role') === 'coach' ? 'coach' : 'student');
    const [page, setPage] = useState('today');
    const [empty, setEmpty] = useState(false);
    const [done, setDone] = useState([]);
    const [minutes, setMinutes] = useState(1200);
    const [notes, setNotes] = useState({ 이주리: '스쿼트 때 왼쪽 무릎 위치 확인.\n지난 수업보다 깊이가 안정적이었음.', 이귀정: '데드리프트 시작 자세에서 바를 몸에 가깝게.', 김수미: '오늘 보강 참석. 지난 수업 진도부터 확인.' });
    const [modal, setModal] = useState(null);
    const [draft, setDraft] = useState('');
    const [agreed, setAgreed] = useState(false);
    const [dates, setDates] = useState([]);
    const [month, setMonth] = useState(8);
    const [requestType, setRequestType] = useState('홀딩');
    const [held, setHeld] = useState({});
    const [fixedWaiting, setFixedWaiting] = useState(true);
    const groups = empty ? [] : (role === 'coach' ? coachGroups : studentTasks).map(group => ({ ...group, items: group.items.filter(item => !done.includes(item.id)) }));
    const week = regularWeek.flatMap(item => item.id === 'wed' && done.includes('offer') ? [{ ...item, cancelled: true, status: '보강으로 변경', description: '9/24 목 18:00으로 이동' }, { id: 'makeup', date: '2026-09-24', day: '목', time: '18:00 — 19:30', status: '보강', description: '9/23 수업에서 변경' }] : [{ ...item, ...(held[item.date] ? { cancelled: true, status: held[item.date], description: '오지 않는 날이에요' } : {}) }]);
    const open = item => { setModal(item); setAgreed(false); };
    const navigate = target => { setPage(target); window.scrollTo(0, 0); };
    const finish = () => { if (modal.id) setDone(previous => [...previous, modal.id]); setModal(null); };
    if (role === 'student') return <><aside className="today-preview-toolbar" aria-label="미리보기 설정"><strong>수강생 홈 · 목업 · 9/24 13:00 기준</strong><div><button onClick={() => setRole('coach')}>코치 보기</button><label><input type="checkbox" checked={empty} onChange={event => setEmpty(event.target.checked)} /> 확인할 일 없음</label></div></aside><StudentTimetablePreview empty={empty} /></>;
    return <>
        <aside className="today-preview-toolbar" aria-label="미리보기 설정"><strong>로컬 검토 · 예시 데이터</strong><div><button onClick={() => { setRole('student'); setPage('today'); }} aria-pressed={role === 'student'}>수강생</button><button onClick={() => { setRole('coach'); setPage('today'); }} aria-pressed={role === 'coach'}>코치</button><label><input type="checkbox" checked={empty} onChange={event => setEmpty(event.target.checked)} /> 확인할 일 없음</label>{role === 'coach' && <label>시각 <select value={minutes} onChange={event => setMinutes(Number(event.target.value))}><option value={610}>10:10</option><option value={735}>12:15</option><option value={1000}>16:40</option><option value={1200}>20:00</option><option value={1300}>21:40</option></select></label>}</div></aside>
        {page === 'today' && (role === 'student' ? <StudentToday name="민서" taskGroups={groups} lessons={week} weekLabel="9월 21일 — 27일" waiting={fixedWaiting ? [{ id: 'fixed', type: 'fixed', title: '고정 시간 변경 대기', description: '수·금 19:50 → 화·목 19:50' }] : []} posts={posts} onAction={open} onNavigate={navigate} onPost={post => open({ type: 'post', ...post })} /> : <CoachToday refreshedAt={refreshedAt} onRefresh={() => setRefreshedAt(Date.now())} dateLabel="9월 23일 수요일" lessons={lessons} minutes={minutes} taskGroups={groups} notes={notes} onAction={open} onEditNote={name => { setDraft(notes[name] || ''); open({ type: 'note', name }); }} onNavigate={navigate} />)}
        {page === 'schedule' && <main className={`today-page today-${role}`}><header className="today-header"><h1>시간표</h1><ActionButton onClick={() => open({ type: 'holding' })}>홀딩·결석 신청</ActionButton></header><section className="today-card"><h2>이번 주 · 9/21 — 9/25</h2>{week.map(item => <div className="today-task-row" key={item.id}><span>{item.day} {item.time}</span><span className="today-status">{item.status}</span></div>)}<p className="today-muted">전체 시간표는 앱의 기존 주간 시간표에 연결됩니다.</p></section></main>}
                {!['today', 'schedule'].includes(page) && <main className={`today-page today-${role}`}><section className="today-card"><h1>{{ dashboard: '게시판', 'training-log': '훈련일지', students: '수강생', newstudents: '신규', logout: '로그인', myinfo: '내 정보' }[page]}</h1><p className="today-empty">기존 화면으로 연결되는 메뉴입니다.</p><ActionButton onClick={() => navigate('today')}>오늘로 돌아가기</ActionButton></section></main>}
        <BottomNav user={{ role }} currentPage={page} onNavigate={navigate} preview />
        {modal && <ReviewModal title={{ note: `${modal.name} · 코치 전용 메모`, holding: '홀딩·결석 신청', offer: '보강 자리 확인', contract: '재등록 계약 확인', fixed: '고정 시간 변경 대기', renewal: `${modal.name} · 재등록`, payment: `${modal.name} · 결제 확인`, new: '신규 신청 확인', post: modal.title }[modal.type] || '확인'} onClose={() => setModal(null)}>
            {modal.type === 'note' ? <><label className="today-field">메모<textarea rows={6} value={draft} onChange={event => setDraft(event.target.value)} /></label><ActionButton primary onClick={() => { setNotes(previous => ({ ...previous, [modal.name]: draft })); setModal(null); }}>저장</ActionButton></> :
                modal.type === 'holding' ? <><div className="today-actions">{['홀딩', '결석'].map(type => <ActionButton key={type} primary={requestType === type} onClick={() => setRequestType(type)}>{type}</ActionButton>)}</div><div className="preview-month"><ActionButton onClick={() => setMonth(value => value - 1)} aria-label="이전 달">‹</ActionButton><strong>2026년 {month + 1}월</strong><ActionButton onClick={() => setMonth(value => value + 1)} aria-label="다음 달">›</ActionButton></div><div className="preview-calendar">{['일', '월', '화', '수', '목', '금', '토'].map(day => <span key={day}>{day}</span>)}{Array.from({ length: new Date(2026, month, 1).getDay() }, (_, index) => <span key={`blank-${index}`} />)}{Array.from({ length: new Date(2026, month + 1, 0).getDate() }, (_, index) => { const date = `2026-${String(month + 1).padStart(2, '0')}-${String(index + 1).padStart(2, '0')}`; const day = new Date(2026, month, index + 1).getDay(); return <button key={date} disabled={![3, 5].includes(day) || date < '2026-09-23'} aria-pressed={dates.includes(date)} aria-label={`${month + 1}월 ${index + 1}일`} onClick={() => setDates(previous => previous.includes(date) ? previous.filter(value => value !== date) : [...previous, date])}>{index + 1}</button>; })}</div><p className="today-muted">선택: {dates.toSorted().join(', ') || '날짜를 선택해주세요'}</p><ActionButton primary disabled={!dates.length} onClick={() => { setHeld(previous => ({ ...previous, ...Object.fromEntries(dates.map(date => [date, requestType])) })); setDates([]); setModal(null); }}>{requestType} 신청 반영 보기</ActionButton></> :
                modal.type === 'offer' ? <><p>9/23 수 19:50 → 9/24 목 18:00</p><p className="today-muted">수락하면 이번 주 수업에 보강으로 반영됩니다.</p><div className="today-actions"><ActionButton onClick={() => { setDone(previous => [...previous, 'offer-declined']); setModal(null); }}>닫기</ActionButton><ActionButton primary onClick={finish}>자리 수락</ActionButton></div></> :
                modal.type === 'contract' ? <><p>주 2회 · 수·금 19:50</p><p className="today-empty">계약 본문은 실제 앱의 기존 계약서 모달을 사용합니다.</p><label><input type="checkbox" checked={agreed} onChange={event => setAgreed(event.target.checked)} /> 계약 내용을 확인했고 동의합니다.</label><div className="today-actions"><ActionButton primary disabled={!agreed} onClick={finish}>동의 완료</ActionButton></div></> :
                modal.type === 'fixed' ? <><p>수·금 19:50 → 화·목 19:50</p><p className="today-empty">고정 시간 변경 자리를 기다리고 있습니다.</p><ActionButton onClick={() => { setFixedWaiting(false); setModal(null); }}>대기 취소</ActionButton></> :
                modal.type === 'post' ? <p>{modal.excerpt}</p> : <><p>{modal.name}님의 {modal.type === 'renewal' ? '재등록' : modal.type === 'payment' ? '결제' : '신청'} 내역</p><p className="today-empty">실제 앱에서는 기존 등록 모달 또는 해당 업무 화면으로 연결됩니다.</p><ActionButton primary onClick={finish}>처리 완료 예시</ActionButton></>}
        </ReviewModal>}
    </>;
}

// This entry is served by Vite locally; it never imports app services or credentials.
if (import.meta.env.DEV) createRoot(document.getElementById('root')).render(<StrictMode><Preview /></StrictMode>);
