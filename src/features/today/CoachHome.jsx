import { publishRoster, publishLastClasses, publishReregX, syncStudentFrequencies, syncStudentSchedules, syncUnpaidStudents } from '../../services/firebaseService';
import { weekDateToISO } from '../../utils/scheduleUtils';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { PERIODS, DAYS } from '../../data/mockData';
import { readCoachNotes, saveCoachNote, confirmStudentPayment } from './todayService';
import { attendingNames, currentLessonId, coachTaskCategory } from './todayModel';
import { CoachToday, ActionButton } from './TodayViews';
import ReviewModal from './ReviewModal';

const StudentRegistrationModal = lazy(() => import('../../components/StudentRegistrationModal'));

export default function CoachHome({ core, students, disabledClasses, registrations, waitlist, onNavigate, refresh }) {
    const [now, setNow] = useState(() => new Date());
    const [notes, setNotes] = useState({});
    const [notesReady, setNotesReady] = useState(false);
    const [editing, setEditing] = useState(null);
    const [draft, setDraft] = useState('');
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
    const categoryFor = name => coachTaskCategory({ isNew: newNames.has(name), unpaid: core.unpaidStudentNames.has(name) });
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
            unpaid: categoryFor(person.name) === 'unpaid',
            ...(newNames.has(person.name) && !person.status ? { status: 'newStudent', label: '신규' } : {}),
            reregX: categoryFor(person.name) === 'renewal' && core.delayedReregistrationStudents.some(student => student.name === person.name),
            lastClass: categoryFor(person.name) === 'renewal' && core.lastClassByName.get(person.name)?.dateISO === weekDateToISO(core.weekDates[day])
                && core.lastClassByName.get(person.name)?.period === period.id,
        }));
        return { id: period.id, time: period.time.replace('~', '—'), startMinute: period.startHour * 60 + period.startMinute, endMinute: period.startHour * 60 + period.startMinute + 90, roster: [...new Map(roster.map(person => [person.name, person])).values()], attendees: attendingNames(cell), availableSeats: cell.availableSeats };
    }).filter(lesson => lesson.roster.length);
    const actualPeriod = currentLessonId(lessons, minutes);
    const previousPeriod = useRef(actualPeriod);
    useEffect(() => {
        if (actualPeriod !== previousPeriod.current) {
            previousPeriod.current = actualPeriod;
            if (!document.hidden) void refreshRef.current();
        }
    }, [actualPeriod]);
    const periodFor = name => lessons.find(lesson => lesson.attendees.includes(name))?.id;
    const describe = (name, schedule, payment, period) => `${name}(${schedule}${payment ? `, ${payment}` : ''})${period ? ` · ${period}교시` : ''}`;
    const groups = [
        { id: 'renewal', title: '오늘 마지막 수업', items: core.lastDayStudents.filter(student => categoryFor(student.name) === 'renewal').map(student => ({ id: `end-${student.name}`, title: describe(student.name, student.schedule, student.payment, student.todayPeriod), period: student.todayPeriod, type: 'renewal', name: student.name, actionLabel: '재등록' })) },
        { id: 'unpaid', title: '미결제', items: unpaidRows.filter(student => categoryFor(student['이름']) === 'unpaid').map(student => ({ id: `pay-${student._foundSheetName}-${student._rowIndex}`, title: describe(student['이름'], student['요일 및 시간'], student['결제금액'], periodFor(student['이름'])), period: periodFor(student['이름']), type: 'payment', student, actionLabel: '결제 확인' })) },
        { id: 'new', title: '신규', items: [
            ...[...registrations, ...waitlist.filter(item => item.hasAvailableSlots)].map(item => ({ id: item.id, title: item.name, description: item.scheduleString || '신청 내역 확인', type: 'new', entry: item, actionLabel: '신청 확인' })),
            ...unpaidRows.filter(student => categoryFor(student['이름']) === 'new' && !registrations.some(item => item.name === student['이름'])).map(student => ({ id: `new-pay-${student._foundSheetName}-${student._rowIndex}`, title: describe(student['이름'], student['요일 및 시간'], student['결제금액'], periodFor(student['이름'])), period: periodFor(student['이름']), type: 'payment', student, actionLabel: '결제 확인' })),
        ] },
        { id: 'delayed', title: '재등록 지연', items: core.delayedReregistrationStudents.filter(student => categoryFor(student.name) === 'renewal').map(student => ({ id: `late-${student.name}`, title: describe(student.name, student.schedule, student.payment, periodFor(student.name)), description: `종료: ${student.endDate}`, type: 'renewal', name: student.name, actionLabel: '재등록' })) },
    ];
    const onAction = item => {
        setError('');
        if (item.type === 'renewal') setRenewal(item.name);
        else if (item.type === 'payment') setPayment(item.student);
        else onNavigate('newstudents', item.entry.status === 'waitlist' ? 'waitlist' : 'pending');
    };
    async function saveNote() {
        if (busy || !editing) return;
        const name = editing;
        setBusy(true); setError('');
        try { await saveCoachNote(name, draft); setNotes(previous => ({ ...previous, [name]: draft.trim() })); setEditing(null); }
        catch { setError('메모 저장에 실패했습니다. 입력 내용은 유지됩니다.'); }
        finally { setBusy(false); }
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
        <CoachToday dateLabel={now.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' })} lessons={lessons} minutes={minutes} taskGroups={groups} notes={notes} onAction={onAction} onEditNote={name => { if (!notesReady) { setError('메모 조회가 완료되지 않았습니다. 새로고침 후 다시 시도해주세요.'); return; } setEditing(name); setDraft(notes[name] || ''); setError(''); }} onNavigate={onNavigate} />
        {editing && <ReviewModal title={`${editing} · 코치 전용 메모`} busy={busy} onClose={() => setEditing(null)}><label className="today-field">메모<textarea value={draft} onChange={event => setDraft(event.target.value)} rows={7} /></label>{error && <p role="alert">{error}</p>}<ActionButton primary disabled={busy} onClick={saveNote}>{busy ? '저장 중…' : '저장'}</ActionButton></ReviewModal>}
        {payment && <ReviewModal title={`${payment['이름']} · 결제 확인`} busy={busy} onClose={() => setPayment(null)}><p>{payment['요일 및 시간']} · {payment['결제금액']}만원</p><label className="today-field">결제일<input type="date" value={paymentDate} onChange={event => setPaymentDate(event.target.value)} /></label><label className="today-field">결제 방식<select value={method} onChange={event => setMethod(event.target.value)}>{['카드', '네이버', '제로페이', '계좌'].map(value => <option key={value}>{value}</option>)}</select></label>{error && <p role="alert">{error}</p>}<ActionButton primary disabled={busy || !paymentDate} onClick={savePayment}>{busy ? '저장 중…' : '결제 완료로 저장'}</ActionButton></ReviewModal>}
        {renewal && <Suspense fallback={<p role="status">등록 화면을 불러오는 중…</p>}><StudentRegistrationModal initialRenewalName={renewal} onClose={() => setRenewal(null)} onSuccess={async () => { setRenewal(null); await refresh(); }} /></Suspense>}
    </>;
}
