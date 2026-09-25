// Shared, side-effect-free rules for the student calendar, references and drafts.
export const localDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
export const draftKey = (date, exercise = '') => JSON.stringify([date, exercise.trim()]);
export const cloneSets = sets => (sets || []).map(set => ({ intensity: { value: set.intensity?.value ?? set.weight ?? '', unit: set.intensity?.unit || 'kg' }, reps: typeof set.reps === 'object' ? { ...set.reps } : { value: set.reps ?? '', unit: '회' } }));
export const hasSetValues = sets => (sets || []).some(set => {
    const value = set.intensity?.value ?? set.weight ?? '';
    const reps = typeof set.reps === 'object' ? set.reps.value : set.reps;
    return (String(value).trim() !== '' && value !== '맨몸') || String(reps ?? '').trim() !== '' || String(set.reps?.count ?? '').trim() !== '';
});
export const hasDraftContent = draft => Boolean(draft && (draft.exercise || draft.query || draft.memo || draft.painCheck || hasSetValues(draft.sets)));
export function recentExerciseDays(records, exercise, writingDate, today = localDate()) {
    const cutoff = writingDate < today ? writingDate : today;
    const grouped = new Map();
    records.filter(record => record.exercise === exercise && record.date < cutoff && Array.isArray(record.sets) && record.sets.length).sort((a, b) => a.date.localeCompare(b.date) || (a.order ?? 0) - (b.order ?? 0)).forEach(record => {
        const entry = grouped.get(record.date) || { date: record.date, sets: [], feedback: [] };
        entry.sets.push(...cloneSets(record.sets));
        if (record.feedback) entry.feedback.push(record.feedback);
        grouped.set(record.date, entry);
    });
    return [...grouped.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);
}
export function calendarSummary(records, month, today = localDate()) {
    const dates = new Set();
    const feedbackDates = new Set();
    records.forEach(record => {
        if (!record.date?.startsWith(`${month}-`) || record.date > today) return;
        dates.add(record.date);
        if (String(record.feedback || '').trim()) feedbackDates.add(record.date);
    });
    return { dates, feedbackDates };
}
export function setSummary(set) {
    const normalized = cloneSets([set])[0];
    const intensity = normalized.intensity.unit === '맨몸' ? '맨몸' : normalized.intensity.unit === '자율' ? normalized.intensity.value || '자율' : `${normalized.intensity.value}${normalized.intensity.unit}`;
    const reps = normalized.reps.unit === '초 x 회' ? `${normalized.reps.value}초 × ${normalized.reps.count || ''}회` : `${normalized.reps.value}${normalized.reps.unit}`;
    return `${intensity} × ${reps}`;
}
