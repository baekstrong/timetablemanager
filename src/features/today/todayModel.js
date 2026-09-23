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

export function automaticLessonId(lessons, minutes) {
    return currentLessonId(lessons, minutes)
        ?? lessons.find(lesson => lesson.startMinute > minutes)?.id
        ?? null;
}

export function sortedWeekLessons(lessons, startISO, endISO) {
    return lessons.filter(lesson => lesson.date >= startISO && lesson.date <= endISO)
        .toSorted((a, b) => a.date.localeCompare(b.date) || a.startMinute - b.startMinute);
}

// 신규 신청/등록 > 미결제 > 재등록 순서로 중복 안내를 하나로 정리한다.
export function coachTaskCategory({ isNew = false, unpaid = false }) {
    return isNew ? 'new' : unpaid ? 'unpaid' : 'renewal';
}
