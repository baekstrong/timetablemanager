import { useMemo, useState } from 'react';
import StudentSchedule from '../components/schedule/StudentSchedule';
import HoldingManager from '../components/HoldingManager';
import StudentInfo from '../components/StudentInfo';
import BottomNav from '../components/BottomNav';
import NoticeTicker from '../components/board/NoticeTicker';
import StudentGrowthHeader from '../components/StudentGrowthHeader';
import StudentGrowthModal from '../components/StudentGrowthModal';
import MonthlyPRBanner from '../components/MonthlyPRBanner';
import NoticeReviewDetail from './NoticeReviewDetail';
import { GoogleSheetsValueProvider } from '../contexts/GoogleSheetsContext';
import { calculateMembershipStats, generateAttendanceHistory } from '../services/googleSheetsService';
import { createStudentReviewServices, reviewUser, reviewWeekDates, reviewSchedule } from './studentLocalFixtures';
import '../index.css';
import '../components/WeeklySchedule.css';
import './student-local-review.css';

const reviewPRServices = {
    getMonthlyPRPreview: async () => ({ records: [
        { id: 'review-pr-1', userName: '예시 수강생', exercise: '스쿼트', intensity: { value: 80, unit: 'kg' }, reps: { value: 5, unit: '회' }, prType: 'weightThenReps', date: '2026-09-16' },
        { id: 'review-pr-2', userName: '리뷰학생', exercise: '벤치프레스', intensity: { value: 40, unit: 'kg' }, reps: { value: 8, unit: '회' }, prType: 'weightThenReps', date: '2026-09-15' },
        { id: 'review-pr-3', userName: '운동학생', exercise: '데드리프트', intensity: { value: 100, unit: 'kg' }, reps: { value: 5, unit: '회' }, prType: 'weightThenReps', date: '2026-09-15' },
        { id: 'review-pr-4', userName: '성장학생', exercise: '오버헤드프레스', intensity: { value: 30, unit: 'kg' }, reps: { value: 8, unit: '회' }, prType: 'weightThenReps', date: '2026-09-14' },
    ], tierMap: { '예시 수강생': 'rookie', '리뷰학생': 'steady', '운동학생': 'passion', '성장학생': 'rookie' } }),
};

export default function StudentLocalReview() {
    const [page, setPage] = useState(() => new URLSearchParams(location.search).get('page') || 'schedule');
    const [holdingDate, setHoldingDate] = useState('');
    const [noticePostId, setNoticePostId] = useState(null);
    const [, setRevision] = useState(0);
    const [mountKey, setMountKey] = useState(0);
    const [notice, setNotice] = useState('');
    const [growthExample, setGrowthExample] = useState(false);
    const fixtures = useMemo(() => createStudentReviewServices(() => setRevision(value => value + 1)), []);
    const student = fixtures.student;
    const sheets = useMemo(() => ({
        students: [student], calculateMembershipStats, generateAttendanceHistory,
        refresh: async () => setRevision(value => value + 1),
        requestHolding: fixtures.requestHolding,
    }), [fixtures, student]);
    const navigate = (next, date) => {
        if (next === 'training-log') { location.assign('./training-log-review.html'); return; }
        if (next === 'ranking') { setNotice(date === 'graph' ? '실제 앱에서는 성장 보기로 내 누적 훈련량과 학년을 확인할 수 있어요.' : '실제 앱에서는 이달의 PR에서 랭킹 화면으로 이동합니다.'); return; }
        if (next === 'holding') setHoldingDate(date || '');
        setPage(next);
        window.scrollTo(0, 0);
    };
    return <GoogleSheetsValueProvider value={sheets}>
        <div className="slr-banner">
            <span>로컬 검토 · 예시 데이터 · 9월 16일 기준</span>
            <button onClick={() => location.reload()}>예시 초기화</button>
        </div>
        {notice && <p className="slr-notice" role="status">{notice}</p>}
        {(page === 'schedule' || page === 'today') && <div className="schedule-container mode-student student-class-page">
            <StudentGrowthHeader user={reviewUser} tier="rookie" xp={18617} onOpen={() => navigate('ranking', 'graph')} />
            <NoticeTicker user={reviewUser} services={fixtures.noticeServices} onOpen={id => { setNoticePostId(id); navigate('notice'); }} refreshKey={mountKey} />
            <MonthlyPRBanner services={reviewPRServices} onOpen={() => navigate('ranking')} refreshKey={mountKey} />
            <div className="schedule-page-header"><h1 className="schedule-page-title">내 수업</h1><button className="slr-refresh" onClick={() => setMountKey(value => value + 1)}>새로고침</button></div>
            <StudentSchedule key={mountKey} user={reviewUser} mode="student" students={[student]}
                studentData={student} studentSchedule={reviewSchedule} weekDates={reviewWeekDates}
                weekAbsences={fixtures.absences} weekWaitlist={[]} weekHolidays={[]} weekHoldings={fixtures.holdings}
                freeWorkoutByDate={fixtures.freeWorkoutByDate}
                weeklyDataLoaded weeklyDataError="" services={fixtures.services}
                getCellData={fixtures.getCellData} getHolidayInfo={() => null}
                isMyHoldingDate={date => fixtures.holdings.some(row => row.holdingDates.includes(date))}
                isMakeupHeld={makeup => fixtures.holdings.some(row => row.holdingDates.includes(makeup.makeupClass.date))}
                isClassDisabled={() => false} isSlotLocked={() => false}
                loadWeeklyData={sheets.refresh} refreshStudents={sheets.refresh}
                getEffectiveEndDate={(_student, date) => date} onNavigate={navigate} />
            <details className="slr-tools"><summary>예시 상황 바꾸기</summary><button onClick={() => {
                if (fixtures.offerSeat()) { setMountKey(value => value + 1); setNotice('대기 자리가 생긴 상황입니다. 내 수업에서 수락을 확인하세요.'); }
                else setNotice('먼저 보강 시간표의 금요일 5교시 만석 자리에 대기를 신청해주세요.');
            }}>대기한 자리 열기</button><button onClick={() => {
                fixtures.showStatusExamples(); setMountKey(value => value + 1);
                setNotice('출석·보강이동·보강·홀딩·결석 표시 예시입니다. 예시 초기화로 원래 일정으로 돌아갈 수 있어요.');
                window.scrollTo(0, 0);
            }}>출석·보강·결석 예시 보기</button><button onClick={() => setGrowthExample(true)}>티어·학년 변경 팝업 예시</button><p>보강·홀딩·결석은 메모리에서만 바뀌며 새로고침하면 초기화됩니다.</p></details>
        </div>}
        {page === 'holding' && <HoldingManager user={reviewUser} studentData={student} initialDate={holdingDate}
            services={fixtures.services} isLoading={false} onBack={() => navigate('schedule')} />}
        {page === 'notice' && <NoticeReviewDetail user={reviewUser} postId={noticePostId} services={fixtures.noticeServices} readOnly={false} onBack={() => navigate('schedule')} />}
        {page === 'myinfo' && <StudentInfo user={reviewUser} studentData={student} services={fixtures.services}
            isLoading={false} isImpersonating onNavigate={navigate} onLogout={() => setNotice('로컬 예시 화면입니다. 실제 계정은 로그인·로그아웃하지 않습니다.')} />}
        {page === 'dashboard' && <div className="slr-unchanged"><h1>게시판</h1><p>게시판은 기존 화면과 기능을 유지합니다.</p><p>이 로컬 검토에서는 내 수업·훈련일지의 변경 동작을 확인할 수 있습니다.</p><button onClick={() => navigate('schedule')}>내 수업 확인하기</button></div>}
        <BottomNav preview currentPage={page} user={reviewUser} onNavigate={navigate} />
        {growthExample && <StudentGrowthModal tierChange={{ tier: 'steady', prevTier: 'rookie', month: '2026-09', direction: 1 }}
            gradeChange={{ from: 'e5', to: 'e6' }} onConfirm={() => setGrowthExample(false)} onLater={() => setGrowthExample(false)} />}
    </GoogleSheetsValueProvider>;
}
