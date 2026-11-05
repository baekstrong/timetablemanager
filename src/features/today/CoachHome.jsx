import { publishRoster, publishLastClasses, publishReregX, syncStudentFrequencies, syncStudentSchedules, syncUnpaidStudents } from '../../services/firebaseService';
import { weekDateToISO } from '../../utils/scheduleUtils';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { PERIODS, DAYS } from '../../data/mockData';
import { readCoachChecklists, confirmStudentPayment } from './todayService';
import { attendingNames, lessonRefreshId, buildCoachTaskGroups } from './todayModel';
import { CoachToday, ActionButton } from './TodayViews';
import ReviewModal from './ReviewModal';
import { createVisibleTask } from '../../utils/visibleTask';

const StudentRegistrationModal = lazy(() => import('../../components/StudentRegistrationModal'));

export default function CoachHome({ user, freeWorkoutByDate = {}, hasNewPostNotification = false, core, students, disabledClasses, registrations, scheduleTransfers, onNavigate, refresh, refreshedAt, refreshing, refreshMessage, dataReady = core.weeklyDataLoaded }) {
    const [now, setNow] = useState(() => new Date());
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [renewal, setRenewal] = useState(null);
    const [payment, setPayment] = useState(null);
    const [paymentDate, setPaymentDate] = useState(() => new Date().toLocaleDateString('sv-SE'));
    const [method, setMethod] = useState('카드');
    // 수강생 체크리스트 캐시 {이름: memos | null(실패)}. 고른 수업 참석자만 읽고, 앱 복귀 때 읽은 사람을 다시 읽는다.
    const [checklists, setChecklists] = useState({});
    const checklistNames = useRef(new Set());
    const loadChecklists = useCallback(async (names, force = false) => {
        const targets = names.filter(name => force || !checklistNames.current.has(name));
        if (!targets.length) return;
        targets.forEach(name => checklistNames.current.add(name));
        try {
            const result = await readCoachChecklists(targets);
            setChecklists(previous => ({ ...previous, ...result }));
        } catch {
            targets.forEach(name => checklistNames.current.delete(name));
            if (!force) setChecklists(previous => ({ ...previous, ...Object.fromEntries(targets.map(name => [name, null])) }));
        }
    }, []);
    const loadChecklistsRef = useRef(loadChecklists);
    const refreshRef = useRef(refresh);
    useEffect(() => { refreshRef.current = refresh; }, [refresh]);
    useEffect(() => {
        // 2026-11-05: 첫 화면에서 예전 코치 전용 메모(coachNotes)는 보이지 않는다 — 체크리스트로 일원화.
        const timer = setInterval(() => setNow(new Date()), 15_000);
        // 훈련일지·다른 기기·수업 음성 메모 자동화가 바꾼 체크리스트도 복귀 때 다시 읽는다. 실패하면 보던 것 유지.
        const refreshOnVisible = createVisibleTask(() => Promise.all([
            refreshRef.current(),
            loadChecklistsRef.current([...checklistNames.current], true),
        ]));
        const visible = () => { if (!document.hidden) { setNow(new Date()); void refreshOnVisible(); } };
        document.addEventListener('visibilitychange', visible);
        return () => { clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
    }, []);
    useEffect(() => {
        if (!dataReady || !core.weeklyDataLoaded || !students.length) return;
        for (const day of DAYS) {
            if (!core.weekDates[day]) continue;
            const roster = Object.fromEntries(PERIODS.map(period => [String(period.id), core.getHolidayInfo(day) !== null || disabledClasses.includes(`${day}-${period.id}`) ? [] : attendingNames(core.getCellData(day, period))]));
            void publishRoster(weekDateToISO(core.weekDates[day]), roster);
        }
        void publishLastClasses(Object.fromEntries([...core.lastClassByName].map(([name, item]) => [name, { date: item.dateISO, period: item.period }])));
        void publishReregX(core.delayedReregistrationStudents.map(student => student.name).sort());
    }, [core, students, disabledClasses, dataReady]);
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
    // 자율운동은 선택·코치 메모 대상이 아닌 표시 전용. 시간표 3교시 칸과 같은 명단을 쓴다.
    const freePeriod = PERIODS.find(period => period.type === 'free');
    const freeWorkout = freePeriod && core.weekDates[day] && core.getHolidayInfo(day) === null ? {
        time: freePeriod.time.replace('~', '—'),
        startMinute: freePeriod.startHour * 60 + freePeriod.startMinute,
        names: (freeWorkoutByDate[weekDateToISO(core.weekDates[day])] || []).map(item => item.studentName),
    } : null;
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
    async function savePayment() {
        if (busy) return;
        setBusy(true); setError('');
        try { await confirmStudentPayment(payment, paymentDate, method); setPayment(null); await refresh(); }
        catch (reason) { setError(reason.message); }
        finally { setBusy(false); }
    }
    return <>
        {error && <p className="today-error" role="alert">{error}</p>}
        <CoachToday scheduleTransferCount={core.weekWaitlist.filter(item => ['waiting', 'notified'].includes(item.status)).length} scheduleTransfers={scheduleTransfers} user={user} hasNewPostNotification={hasNewPostNotification} onRefresh={refresh} refreshedAt={refreshedAt} refreshing={refreshing} refreshMessage={refreshMessage} freeWorkout={freeWorkout} dateLabel={now.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' })} lessons={lessons} minutes={minutes} taskGroups={groups} checklists={checklists} onLoadChecklists={loadChecklists} onAction={onAction} onNavigate={onNavigate} />
        {payment && <ReviewModal title={`${payment['이름']} · 결제 확인`} busy={busy} onClose={() => setPayment(null)}><p>{payment['요일 및 시간']} · {payment['결제금액']}만원</p><label className="today-field">결제일<input type="date" value={paymentDate} onChange={event => setPaymentDate(event.target.value)} /></label><label className="today-field">결제 방식<select value={method} onChange={event => setMethod(event.target.value)}>{['카드', '네이버', '제로페이', '계좌'].map(value => <option key={value}>{value}</option>)}</select></label>{error && <p role="alert">{error}</p>}<ActionButton primary disabled={busy || !paymentDate} onClick={savePayment}>{busy ? '저장 중…' : '결제 완료로 저장'}</ActionButton></ReviewModal>}
        {renewal && <Suspense fallback={<p role="status">등록 화면을 불러오는 중…</p>}><StudentRegistrationModal initialRenewalName={renewal} onClose={() => setRenewal(null)} onSuccess={async () => { setRenewal(null); await refresh(); }} /></Suspense>}
    </>;
}
