// Shared display rules. Data loading and writes belong to the calling screen.
export function visibleTaskGroups(groups = []) {
    return groups.map(group => ({ ...group, items: group.items.filter(item => !item.completed) }))
        .filter(group => group.items.length > 0);
}

export function attendingNames(cell) {
    if (!cell) return [];
    const excluded = new Set([
        ...(cell.makeupMovedStudents || []), ...(cell.absenceStudents || []),
        ...(cell.agreedAbsenceStudents || []), ...(cell.holdingStudents || []),
        ...(cell.makeupHeldStudents || []), ...(cell.makeupAbsentOnMakeupSlot || []),
    ]);
    return [...new Set([
        ...(cell.regularStudentsPresent || []).filter(name => !excluded.has(name)),
        ...(cell.makeupStudents || []).filter(name => !excluded.has(name)),
        ...(cell.subs || []).map(sub => sub.name),
    ])];
}

export function currentLessonId(lessons, minutes) {
    return lessons.find(lesson => minutes >= lesson.startMinute && minutes < lesson.endMinute)?.id ?? null;
}

// 마지막으로 지난 사전 갱신 경계. 시작/종료 시각에는 다시 바뀌지 않는다.
export function lessonRefreshId(lessons, minutes) {
    return lessons.filter(lesson => minutes >= lesson.startMinute - 30)
        .reduce((latest, lesson) => !latest || lesson.startMinute > latest.startMinute ? lesson : latest, null)?.id ?? null;
}

export function automaticLessonId(lessons, minutes) {
    return currentLessonId(lessons, minutes)
        ?? lessons.find(lesson => lesson.startMinute > minutes)?.id
        ?? null;
}

export function sortedWeekLessons(lessons, startISO, endISO) {
    return lessons.filter(lesson => lesson.date >= startISO && lesson.date <= endISO)
        .toSorted((a, b) => a.date.localeCompare(b.date) || a.startMinute - b.startMinute);
}

// 코치 첫 화면에는 수강 종료와 관련된 두 목록만 표시한다.
// 신규/미결제 여부가 마지막 수업·미재등록 안내를 가리지 않게 한다.
export function buildCoachTaskGroups({ lastDayStudents = [], delayedStudents = [], unpaidRows = [], periodFor = () => undefined }) {
    const unpaidByName = new Map(unpaidRows.map(student => [student['이름'], student]));
    const describe = (student, period) => `${student.name}(${student.schedule}${student.payment ? `, ${student.payment}` : ''})${period && period !== 999 ? ` · ${period}교시` : ''}`;
    const itemFor = (student, delayed) => {
        const period = delayed ? periodFor(student.name) : student.todayPeriod;
        const unpaid = unpaidByName.get(student.name);
        return {
            id: `${delayed ? 'late' : 'end'}-${student.name}`,
            title: describe(student, period), period, type: 'renewal', name: student.name,
            actionLabel: '재등록',
            ...(delayed ? { description: `종료: ${student.endDate}` } : {}),
            ...(unpaid ? { unpaid: true, paymentAction: { type: 'payment', student: unpaid, actionLabel: '결제 확인' } } : {}),
        };
    };
    const unique = rows => [...new Map(rows.map(student => [student.name, student])).values()];
    return [
        { id: 'renewal', title: '오늘 마지막 수업', items: unique(lastDayStudents).map(student => itemFor(student, false)) },
        { id: 'delayed', title: '수강 종료·미재등록', items: unique(delayedStudents).map(student => itemFor(student, true)) },
    ];
}

// 코치 첫 화면 '수강생 메모': 수강생에게 넣은 코치 체크리스트(coachPinnedMemos)를 운동별로 묶는다(2026-11-05).
// 체크 상태는 코치 것(coachChecks: {항목키: 체크시각})만 쓴다 — 수강생 체크와 독립. 수강생 완료는 표시만(studentDone).
// 미체크 + 최근 7일 안에 코치가 체크한 항목(줄 그음)을 보이고, 그보다 오래된 체크는 개수만 센다.
export const CHECKLIST_DONE_DAYS = 7;
const itemKey = (id, exercise, text) => id ? `id:${id}` : `t:${exercise || ''}::${text}`;
export function groupChecklistByExercise(memos, now = new Date(), coachChecks = {}) {
    const cutoff = now.getTime() - CHECKLIST_DONE_DAYS * 86_400_000;
    const groups = new Map();
    let hiddenDone = 0;
    for (const memo of memos || []) {
        if (!memo || !String(memo.memo || '').trim()) continue;
        const key = itemKey(memo.id, memo.exercise, String(memo.memo));
        const doneAt = coachChecks[key] || '';
        if (doneAt && !(new Date(doneAt).getTime() >= cutoff)) { hiddenDone += 1; continue; }
        const exercise = String(memo.exercise || '').trim() || '기타';
        if (!groups.has(exercise)) groups.set(exercise, []);
        groups.get(exercise).push({ id: memo.id || '', key, exercise: memo.exercise || '', text: String(memo.memo), done: !!doneAt, doneAt, studentDone: !!memo.done, createdAt: memo.createdAt || '' });
    }
    const list = [...groups].map(([exercise, items]) => ({ exercise, items: items.sort((a, b) => a.done - b.done) }));
    // 할 게 남은 운동을 위로
    list.sort((a, b) => a.items.every(item => item.done) - b.items.every(item => item.done));
    return { groups: list, hiddenDone };
}
