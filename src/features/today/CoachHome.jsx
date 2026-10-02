import { publishRoster, publishLastClasses, publishReregX, syncStudentFrequencies, syncStudentSchedules, syncUnpaidStudents } from '../../services/firebaseService';
import { weekDateToISO } from '../../utils/scheduleUtils';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { PERIODS, DAYS } from '../../data/mockData';
import { readCoachNotes, saveCoachNote, confirmStudentPayment } from './todayService';
import { attendingNames, lessonRefreshId, buildCoachTaskGroups } from './todayModel';
import { CoachToday, ActionButton } from './TodayViews';
import ReviewModal from './ReviewModal';

const StudentRegistrationModal = lazy(() => import('../../components/StudentRegistrationModal'));

export default function CoachHome({ hasNewPostNotification = false, core, students, disabledClasses, registrations, onNavigate, refresh, refreshedAt, refreshing, refreshMessage }) {
    const [now, setNow] = useState(() => new Date());
    const [notes, setNotes] = useState({});
    const [notesReady, setNotesReady] = useState(false);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [renewal, setRenewal] = useState(null);
    const [payment, setPayment] = useState(null);
    const [paymentDate, setPaymentDate] = useState(() => new Date().toLocaleDateString('sv-SE'));
    const [method, setMethod] = useState('카드');
    const refreshRef = useRef(refresh);
    useEffect(() => { refreshRef.current = refresh; }, [refresh]);
    useEffect(() => {
        let alive = true;
        readCoachNotes().then(value => { if (alive) { setNotes(value); setNotesReady(true); } }).catch(() => { if (alive) setError('코치 메모를 불러오지 못했습니다. 새로고침해주세요.'); });
        const timer = setInterval(() => setNow(new Date()), 15_000);
        const visible = () => { if (!document.hidden) { setNow(new Date()); void refreshRef.current(); } };
        document.addEventListener('visibilitychange', visible);
        return () => { alive = false; clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
    }, []);
    useEffect(() => {
        if (!core.weeklyDataLoaded || !students.length) return;
        for (const day of DAYS) {
            if (!core.weekDates[day]) continue;
            const roster = Object.fromEntries(PERIODS.map(period => [String(period.id), core.getHolidayInfo(day) !== null || disabledClasses.includes(`${day}-${period.id}`) ? [] : attendingNames(core.getCellData(day, period))]));
            void publishRoster(weekDateToISO(core.weekDates[day]), roster);
        }
        void publishLastClasses(Object.fromEntries([...core.lastClassByName].map(([name, item]) => [name, { date: item.dateISO, period: item.period }])));
        void publishReregX(core.delayedReregistrationStudents.map(student => student.name).sort());
    }, [core, students, disabledClasses]);
    // 학생 목록이 바뀔 때만 발행한다. 교시 시계/메모/주간 상태 렌더에는 쓰지 않는다.
    useEffect(() => {
        if (!students.length) return;
        void syncStudentFrequencies(students);
        void syncStudentSchedules(students);
        void syncUnpaidStudents(students);
    }, [students]);
    const day = ['일', '월', '화', '수', '목', '금', '토'][now.getDay()];
    const minutes = now.getHours() * 60 + now.getMinutes();
    const newNames = new Set([
        ...registrations.map(item => item.name),
        ...students.filter(student => String(student['신규/재등록'] || '').trim() === '신규' && core.unpaidStudentNames.has(student['이름'])).map(student => student['이름']),
    ]);
    const unpaidRows = students.filter(student => core.unpaidStudentNames.has(student['이름']) && String(student['결제유무'] || '').trim().toUpperCase() === 'X');

    const lessons = !students.length || !core.weekDates[day] || core.getHolidayInfo(day) !== null ? [] : PERIODS.filter(period => period.type !== 'free' && !disabledClasses.includes(`${day}-${period.id}`)).map(period => {
        const cell = core.getCellData(day, period);
        const roster = [
            ...cell.regularStudentsPresent.map(name => ({ name, ...(cell.makeupMovedStudents.includes(name)
                ? { status: 'makeupMoved', label: '보강이동' }
                : cell.agreedAbsenceStudents.includes(name) ? { status: 'agreedAbsent', label: '합의결석' }
                    : cell.absenceStudents.includes(name) ? { status: 'absent', label: '결석' } : {}) })),
            ...cell.makeupStudents.map(name => ({ name, status: 'makeup', label: '보강' })),
            ...cell.makeupHeldStudents.map(name => ({ name, status: 'holding', label: '보강홀딩' })),
            ...cell.makeupAbsentOnMakeupSlot.map(name => ({ name, status: 'makeupAbsent', label: '보강결석' })),
            ...cell.holdingStudents.map(name => ({ name, status: 'holding', label: '홀딩' })),
            ...cell.newStudents.map(name => ({ name, status: 'newStudent', label: '신규' })),
            ...cell.delayedStartStudents.map(name => ({ name, status: 'delayed', label: '시작지연' })),
            ...cell.subs.map(sub => ({ name: sub.name, status: 'makeup', label: '대타' })),
        ].map(person => ({
            ...person,
            unpaid: core.unpaidStudentNames.has(person.name),
            ...(newNames.has(person.name) && !person.status ? { status: 'newStudent', label: '신규' } : {}),
            reregX: core.delayedReregistrationStudents.some(student => student.name === person.name),
            lastClass: core.lastClassByName.get(person.name)?.dateISO === weekDateToISO(core.weekDates[day])
                && core.lastClassByName.get(person.name)?.period === period.id,
        }));
        return { id: period.id, time: period.time.replace('~', '—'), startMinute: period.startHour * 60 + period.startMinute, endMinute: period.startHour * 60 + period.startMinute + 90, roster: [...new Map(roster.map(person => [person.name, person])).values()], attendees: attendingNames(cell), availableSeats: cell.availableSeats };
    }).filter(lesson => lesson.roster.length);
    const refreshPeriod = `${now.toLocaleDateString('sv-SE')}:${lessonRefreshId(lessons, minutes)}`;
    const previousPeriod = useRef(refreshPeriod);
    useEffect(() => {
        if (refreshPeriod !== previousPeriod.current) {
            previousPeriod.current = refreshPeriod;
            if (!document.hidden) void refreshRef.current();
        }
    }, [refreshPeriod]);
    const periodFor = name => lessons.find(lesson => lesson.attendees.includes(name))?.id;
    const groups = buildCoachTaskGroups({
        lastDayStudents: core.lastDayStudents,
        delayedStudents: core.delayedReregistrationStudents,
        unpaidRows, periodFor,
    });
    const onAction = item => {
        setError('');
        if (item.type === 'renewal') setRenewal(item.name);
        else if (item.type === 'payment') setPayment(item.student);
    };
    async function saveNote(name, value) {
        await saveCoachNote(name, value);
        setNotes(previous => ({ ...previous, [name]: value.trim() }));
    }
    async function savePayment() {
        if (busy) return;
        setBusy(true); setError('');
        try { await confirmStudentPayment(payment, paymentDate, method); setPayment(null); await refresh(); }
        catch (reason) { setError(reason.message); }
        finally { setBusy(false); }
    }
    return <>
        {error && <p className="today-error" role="alert">{error}</p>}
        <CoachToday hasNewPostNotification={hasNewPostNotification} onRefresh={refresh} refreshedAt={refreshedAt} refreshing={refreshing} refreshMessage={refreshMessage} dateLabel={now.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' })} lessons={lessons} minutes={minutes} taskGroups={groups} notes={notes} onAction={onAction} notesReady={notesReady} onSaveNote={saveNote} onNavigate={onNavigate} />
        {payment && <ReviewModal title={`${payment['이름']} · 결제 확인`} busy={busy} onClose={() => setPayment(null)}><p>{payment['요일 및 시간']} · {payment['결제금액']}만원</p><label className="today-field">결제일<input type="date" value={paymentDate} onChange={event => setPaymentDate(event.target.value)} /></label><label className="today-field">결제 방식<select value={method} onChange={event => setMethod(event.target.value)}>{['카드', '네이버', '제로페이', '계좌'].map(value => <option key={value}>{value}</option>)}</select></label>{error && <p role="alert">{error}</p>}<ActionButton primary disabled={busy || !paymentDate} onClick={savePayment}>{busy ? '저장 중…' : '결제 완료로 저장'}</ActionButton></ReviewModal>}
        {renewal && <Suspense fallback={<p role="status">등록 화면을 불러오는 중…</p>}><StudentRegistrationModal initialRenewalName={renewal} onClose={() => setRenewal(null)} onSuccess={async () => { setRenewal(null); await refresh(); }} /></Suspense>}
    </>;
}
