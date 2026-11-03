import { useEffect, useMemo, useState } from 'react';
import NewStudentRegistration from '../../components/NewStudentRegistration';
import CoachNewStudents from '../../components/CoachNewStudents';
import { TaskSection } from '../../features/today/TodayViews';
import { buildNewWaitlistGroup } from '../../features/today/todayModel';
import { computeSlotOccupancy } from '../../utils/slotOccupancy';
import { parseScheduleString } from '../../utils/scheduleUtils';
import { MAX_CAPACITY } from '../../data/mockData';
import { GoogleSheetsValueProvider } from '../../contexts/GoogleSheetsContext';
import { reviewState, reviewStudents } from './fixtures';
import '../../index.css';
import '../../features/today/TodayViews.css';

const TABS = [['register', '① 신규 모집 페이지'], ['coach', '② 코치 신규 › 대기'], ['today', '③ 코치 오늘']];
const sheets = { students: reviewStudents, refresh: async () => {} };

function TodayTop() {
    const [, setTick] = useState(0);
    useEffect(() => { const t = setInterval(() => setTick(v => v + 1), 1000); return () => clearInterval(t); }, []);
    const pending = reviewState.registrations.filter(r => r.status === 'pending');
    const occupancy = computeSlotOccupancy(reviewStudents, pending, parseScheduleString);
    const groups = [
        buildNewWaitlistGroup(reviewState.registrations, occupancy, [], MAX_CAPACITY),
        { id: 'renewal', title: '오늘 마지막 수업', items: [{ id: 'end-예시', title: '예시수강생(월4수4, 카드) · 4교시', type: 'renewal', actionLabel: '재등록' }] },
    ];
    return <main className="today-page today-coach">
        <header className="today-header"><div><h1 className="today-coach-title">근력학교 · 코치</h1><span className="today-coach-date">11월 3일 화요일</span></div></header>
        <TaskSection coach groups={groups} onAction={item => alert(item.type === 'newWaitlist' ? '실제 앱에서는 신규 › 대기 목록으로 이동합니다.' : '목업')} />
        <p className="today-muted" style={{ marginTop: 16 }}>아래 오늘 수업·코치 메모 영역은 기존과 같습니다(목업에서는 생략).</p>
    </main>;
}

export default function WaitlistReview() {
    const [tab, setTab] = useState(() => new URLSearchParams(location.search).get('tab') || 'register');
    const [key, setKey] = useState(0);
    const content = useMemo(() => tab === 'register' ? <NewStudentRegistration key={key} />
        : tab === 'coach' ? <CoachNewStudents key={key} initialFilter="waitlist" onBack={() => {}} />
            : <TodayTop key={key} />, [tab, key]);
    return <GoogleSheetsValueProvider value={sheets}>
        <nav style={{ position: 'sticky', top: 0, zIndex: 3000, display: 'flex', gap: 6, flexWrap: 'wrap', padding: '8px 12px', background: '#242428' }}>
            <strong style={{ color: '#fff', fontSize: 13, alignSelf: 'center', marginRight: 6 }}>신규 대기 목업 (가짜 데이터·저장/문자 없음)</strong>
            {TABS.map(([id, label]) => <button key={id} onClick={() => { setTab(id); setKey(k => k + 1); }}
                style={{ border: 0, borderRadius: 8, padding: '6px 10px', fontSize: 13, cursor: 'pointer', background: tab === id ? '#329BE7' : '#3a3a40', color: '#fff' }}>{label}</button>)}
        </nav>
        {content}
    </GoogleSheetsValueProvider>;
}
