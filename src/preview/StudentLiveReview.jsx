import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, getDocs } from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import Login from '../components/Login';
import StudentSchedule from '../components/schedule/StudentSchedule';
import NoticeTicker from '../components/board/NoticeTicker';
import BottomNav from '../components/BottomNav';
import StudentGrowthHeader from '../components/StudentGrowthHeader';
import MonthlyPRBanner from '../components/MonthlyPRBanner';
import { useStudentGrowth } from '../hooks/useStudentGrowth';
import LiveBoardReview, { LiveBoardPostDetail } from './LiveBoardReview';
import LiveStudentInfoReview from './LiveStudentInfoReview';
import LiveTrainingLogReview from './LiveTrainingLogReview';
import LiveHoldingReview from './LiveHoldingReview';
import { useScheduleCore } from '../components/schedule/useScheduleCore';
import { findStudentAcrossSheets, getAllStudentsFromAllSheets } from '../services/googleSheetsService';
import { formatDateISO, weekDateToISO } from '../utils/scheduleUtils';
import { studentLiveInitialSelection } from './student-live-guards';
import { parseHoldingDate } from '../utils/holdingEligibility';
import '../index.css';
import '../components/WeeklySchedule.css';
import './student-live-review.css';

const STUDENT_PAGES = new Set(['schedule', 'training-log', 'dashboard', 'myinfo', 'holding']);
const pageFromUrl = () => {
    const page = new URLSearchParams(location.search).get('page');
    return STUDENT_PAGES.has(page) ? page : 'schedule';
};
const holdingDateFromUrl = () => {
    const value = new URLSearchParams(location.search).get('date') || '';
    return /^\d{4}-\d{2}-\d{2}$/.test(value) && parseHoldingDate(value) ? value : '';
};

const identityFromSession = async firebaseUser => {
    if (!firebaseUser) return null;
    const { claims } = await firebaseUser.getIdTokenResult();
    if (typeof claims.name !== 'string' || !claims.name) return null;
    return { username: claims.name, role: claims.isCoach === true ? 'coach' : 'student' };
};

function LiveSchedule({ user, student, students, disabledClasses, lockedSlots, onRefresh, loading, loadedAt, onNavigate, onOpenNotice }) {
    const growth = useStudentGrowth({ user, readOnly: true });
    // Reuse the exact production capacity calculation, with all automatic writes off.
    const core = useScheduleCore({ user, students, mode: 'student', studentData: student, readOnly: true });
    const freeWorkoutByDate = useMemo(() => {
        const map = {};
        for (const row of core.weekFreeWorkout) {
            if (!map[row.date]) map[row.date] = [];
            map[row.date].push(row);
        }
        for (const row of core.freeWorkoutRoster) {
            const date = core.weekDates[row.day] && weekDateToISO(core.weekDates[row.day]);
            if (!date) continue;
            if (!map[date]) map[date] = [];
            if (!map[date].some(item => item.studentName === row.studentName)) map[date].push({ ...row, roster: true });
        }
        return map;
    }, [core.weekFreeWorkout, core.freeWorkoutRoster, core.weekDates]);
    return <div className="schedule-container mode-student student-class-page">
        <StudentGrowthHeader user={user} {...growth} onRetry={growth.retry} onOpen={() => onNavigate('ranking', 'graph')} />
        <NoticeTicker user={user} onOpen={onOpenNotice} />
        <MonthlyPRBanner onOpen={() => onNavigate('ranking')} refreshKey={loadedAt.getTime()} />
        <div className="student-live-heading"><h1>내 수업</h1><button type="button" disabled={loading} onClick={onRefresh}>{loading ? '조회 중…' : '새로고침'}</button></div>
        <p className="student-live-context">{user.username}님의 실제 일정 · {loadedAt.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 조회</p>
        <StudentSchedule user={user} studentData={student} studentSchedule={core.studentSchedule}
            weekDates={core.weekDates} weekAbsences={core.weekAbsences} weekWaitlist={core.weekWaitlist}
            weekHoldings={core.weekHoldings} weekHolidays={core.weekHolidays} freeWorkoutByDate={freeWorkoutByDate}
            isMyHoldingDate={core.isMyHoldingDate} isMakeupHeld={core.isMakeupHeld}
            getCellData={core.getCellData} getHolidayInfo={core.getHolidayInfo}
            loadWeeklyData={core.loadWeeklyData} refreshStudents={onRefresh}
            getEffectiveEndDate={core.getEffectiveEndDate}
            isClassDisabled={(day, period) => disabledClasses.includes(`${day}-${period}`)}
            isSlotLocked={(day, period) => lockedSlots.includes(`${day}-${period}`)}
            weeklyDataLoaded={core.weeklyDataLoaded} weeklyDataError={core.weeklyDataError}
            readOnly onNavigate={onNavigate} />
    </div>;
}

function LiveStudentPages(props) {
    const user = useMemo(() => ({ username: props.student['이름'], role: 'student' }), [props.student]);
    const [page, setPage] = useState(pageFromUrl);
    const [holdingDate, setHoldingDate] = useState(holdingDateFromUrl);
    const [detail, setDetail] = useState(null);
    const [message, setMessage] = useState('');
    const contentRef = useRef(null);
    useEffect(() => {
        const handleBack = () => { setPage(pageFromUrl()); setHoldingDate(holdingDateFromUrl()); setDetail(null); setMessage(''); };
        window.addEventListener('popstate', handleBack);
        return () => window.removeEventListener('popstate', handleBack);
    }, []);
    const navigate = (next, date = '') => {
        if (next === 'ranking') {
            setMessage(date === 'graph' ? '실제 앱에서는 성장 보기를 누르면 누적 훈련량·학년 화면으로 이동합니다.' : '실제 앱에서는 이달의 PR을 누르면 랭킹 화면으로 이동합니다. 이 검토에서는 실제 갱신 기록을 조회합니다.');
            return;
        }
        if (!STUDENT_PAGES.has(next)) {
            setMessage('신청·계약 변경은 실제 앱에서 이용할 수 있어요. 이 화면에서는 조회만 가능합니다.');
            return;
        }
        const url = new URL(location.href);
        url.searchParams.set('page', next);
        const contextDate = next === 'holding' && /^\d{4}-\d{2}-\d{2}$/.test(date) && parseHoldingDate(date) ? date : '';
        if (contextDate) url.searchParams.set('date', contextDate);
        else url.searchParams.delete('date');
        if (url.href !== location.href) history.pushState(null, '', url);
        setHoldingDate(contextDate);
        setPage(next); setDetail(null); setMessage('');
        contentRef.current?.scrollIntoView({ block: 'start' });
    };
    const openPost = id => { setDetail({ id, from: page }); contentRef.current?.scrollIntoView({ block: 'start' }); };
    return <>
        <main ref={contentRef} className="student-live-content">
            {message && <p className="student-live-action-note" role="status">{message}</p>}
            <div className="student-live-page" hidden={page !== 'schedule' || Boolean(detail)}>
                <LiveSchedule {...props} user={user} onNavigate={navigate} onOpenNotice={openPost} />
            </div>
            {!detail && page === 'training-log' && <LiveTrainingLogReview user={user} />}
            {!detail && page === 'dashboard' && <LiveBoardReview user={user} onOpen={openPost} />}
            {!detail && page === 'myinfo' && <LiveStudentInfoReview user={user} studentData={props.student} onNavigate={navigate} />}
            {!detail && page === 'holding' && <LiveHoldingReview user={user} studentData={props.student} initialDate={holdingDate} onBack={() => navigate('schedule')} />}
            {detail && <LiveBoardPostDetail user={user} postId={detail.id} onBack={() => setDetail(null)} />}
        </main>
        <BottomNav preview user={user} currentPage={detail?.from || page} onNavigate={navigate} />
    </>;
}

export default function StudentLiveReview() {
    const [identity, setIdentity] = useState(null);
    const [authState, setAuthState] = useState('loading');
    const [students, setStudents] = useState(null);
    const [selectedName, setSelectedName] = useState('');
    const [search, setSearch] = useState('');
    const [snapshot, setSnapshot] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [reload, setReload] = useState(0);
    const requestId = useRef(0);
    const refresh = useCallback(async () => { setReload(value => value + 1); }, []);

    useEffect(() => {
        if (!auth || !db) { setAuthState('unconfigured'); return; }
        let active = true;
        let identityRequest = 0;
        const unsubscribe = onAuthStateChanged(auth, firebaseUser => {
            const request = ++identityRequest;
            identityFromSession(firebaseUser).then(value => {
                if (!active || request !== identityRequest || firebaseUser?.uid !== auth.currentUser?.uid) return;
                setIdentity(value);
                setAuthState(value ? 'ready' : 'login');
                setStudents(null);
                setSnapshot(null);
                setSelectedName(studentLiveInitialSelection(value, new URLSearchParams(location.search).get('student') || ''));
            }).catch(() => {
                if (active && request === identityRequest) { setIdentity(null); setSnapshot(null); setStudents(null); setSelectedName(''); setAuthState('login'); }
            });
        });
        return () => { active = false; unsubscribe(); };
    }, []);

    useEffect(() => {
        if (!identity) return;
        const id = ++requestId.current;
        let active = true;
        setLoading(true);
        setError('');
        const load = async () => {
            try {
                const rows = await getAllStudentsFromAllSheets();
                if (!active || id !== requestId.current) return;
                if (!rows.length) throw new Error('empty-roster');
                setStudents(rows);
                const targetName = identity.role === 'student' ? identity.username : selectedName;
                if (!targetName) { setSnapshot(null); return; }
                if (identity.role === 'coach' && !rows.some(row => row['이름'] === targetName)) throw new Error('unknown-student');
                // Fail rather than display available slots when their restrictions cannot be read.
                const [result, disabled, locked] = await Promise.all([
                    findStudentAcrossSheets(targetName),
                    getDocs(collection(db, 'disabledClasses')),
                    getDocs(collection(db, 'lockedSlots')),
                ]);
                if (!active || id !== requestId.current) return;
                if (!result?.student) throw new Error('missing-registration');
                const today = formatDateISO(new Date());
                setSnapshot({
                    key: `${targetName}-${id}`, student: result.student, students: rows, loadedAt: new Date(),
                    disabledClasses: disabled.docs.map(doc => doc.data().key),
                    lockedSlots: locked.docs.map(doc => doc.data()).filter(row => !row.date || row.date >= today).map(row => row.key),
                });
            } catch {
                if (!active || id !== requestId.current) return;
                setSnapshot(null);
                setError('실제 수강·시간표 정보를 불러오지 못했습니다. 연결 상태를 확인한 뒤 다시 조회해주세요.');
            } finally { if (active && id === requestId.current) setLoading(false); }
        };
        void load();
        return () => { active = false; };
    }, [identity, selectedName, reload]);

    const candidates = useMemo(() => [...new Set((students || []).map(row => row['이름']).filter(Boolean))]
        .filter(name => name.includes(search.trim())).sort((a, b) => a.localeCompare(b, 'ko')), [students, search]);

    return <>
        <aside className="student-live-banner"><strong>수강생 앱 · 최종 로컬 검토</strong><p>실제 수업·훈련 기록·게시판·내 정보를 확인합니다. 조회 전용으로 신청·저장·알림 발송은 실행되지 않습니다.</p></aside>
        {authState === 'loading' && <div className="student-live-panel" role="status">기존 로그인 확인 중…</div>}
        {authState === 'unconfigured' && <div className="student-live-panel" role="alert">로컬 Firebase 연결 설정이 필요합니다.</div>}
        {authState === 'login' && <Login onLogin={async () => {
            const firebaseUser = auth.currentUser;
            const value = await identityFromSession(firebaseUser);
            if (firebaseUser?.uid !== auth.currentUser?.uid) return;
            setIdentity(value); setAuthState(value ? 'ready' : 'login');
            setSelectedName(studentLiveInitialSelection(value, new URLSearchParams(location.search).get('student') || ''));
        }} />}
        {identity && <>
            {identity.role === 'coach' && <div className="student-live-panel student-live-picker">
                <label htmlFor="live-student-search">수강생 검색</label>
                <input id="live-student-search" type="search" autoComplete="off" placeholder="이름 검색" value={search} onChange={event => setSearch(event.target.value)} />
                <select aria-label="조회할 수강생" size={4} value={selectedName} onChange={event => { setSnapshot(null); setSelectedName(event.target.value); }}>
                    <option value="">수강생을 선택해주세요</option>{candidates.map(name => <option key={name} value={name}>{name}</option>)}
                </select>
                {!loading && students && candidates.length === 0 && <p>검색 결과가 없습니다.</p>}
            </div>}
            {error && <div className="student-live-panel"><p className="student-live-error" role="alert">{error}</p><button type="button" onClick={refresh}>다시 조회</button></div>}
            {loading && !snapshot && <div className="student-live-panel" role="status">실제 수업 정보를 조회하고 있어요.</div>}
            {snapshot && <LiveStudentPages key={snapshot.key} {...snapshot} loading={loading} onRefresh={refresh} />}
        </>}
    </>;
}
