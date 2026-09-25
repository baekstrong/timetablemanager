import { describe, expect, it } from 'vitest';
import { calendarSummary, cloneSets, draftKey, hasDraftContent, hasSetValues, recentExerciseDays, setSummary } from './student-workspace-logic.js';
const set = (weight = '40', reps = '8') => ({ intensity: { value: weight, unit: 'kg' }, reps: { value: reps, unit: '회' } });
const record = (date, extra = {}) => ({ date, exercise: '스쿼트', sets: [set()], ...extra });

describe('student reference days', () => {
    it('uses workout date, groups the same day, and returns three prior days', () => {
        const records = [record('2026-09-01', { timestamp: 999999 }), record('2026-09-10'), record('2026-09-15'), record('2026-09-20', { order: 2, sets: [set('60')] }), record('2026-09-20', { order: 1, sets: [set('50')] }), record('2026-09-25'), record('2026-10-01'), record('2026-09-22', { exercise: '벤치프레스' })];
        const days = recentExerciseDays(records, '스쿼트', '2026-09-25', '2026-09-25');
        expect(days.map(day => day.date)).toEqual(['2026-09-20', '2026-09-15', '2026-09-10']);
        expect(days[0].sets.map(item => item.intensity.value)).toEqual(['50', '60']);
        expect(records[0].date).toBe('2026-09-01');
    });
    it('a past writing date references only workouts before that date', () => {
        const days = recentExerciseDays([record('2026-09-10'), record('2026-09-15'), record('2026-09-20')], '스쿼트', '2026-09-15', '2026-09-25');
        expect(days.map(day => day.date)).toEqual(['2026-09-10']);
    });
    it('never suggests today or the future, even if an invalid future writing date arrives', () => {
        expect(recentExerciseDays([record('2026-09-24'), record('2026-09-25'), record('2026-09-26')], '스쿼트', '2026-09-28', '2026-09-25').map(day => day.date)).toEqual(['2026-09-24']);
    });
});

describe('calendar and persistent draft rules', () => {
    it('counts unique recorded days and keeps feedback independent', () => {
        const summary = calendarSummary([record('2026-09-01'), record('2026-09-01', { feedback: '좋아요' }), record('2026-09-20'), record('2026-10-01'), record('2026-09-27')], '2026-09', '2026-09-25');
        expect([...summary.dates]).toEqual(['2026-09-01', '2026-09-20']);
        expect([...summary.feedbackDates]).toEqual(['2026-09-01']);
    });
    it('separates exercise and date keys without delimiter collisions', () => {
        expect(draftKey('2026-09-25', '스쿼트')).not.toBe(draftKey('2026-09-24', '스쿼트'));
        expect(draftKey('2026-09-25', '스쿼트')).not.toBe(draftKey('2026-09-25', '데드리프트'));
        expect(JSON.parse(draftKey('2026-09-25', ' a::b '))).toEqual(['2026-09-25', 'a::b']);
    });
    it('recognizes memo and pain drafts without counting default empty sets as entered values', () => {
        expect(hasDraftContent({ sets: [set('', '')] })).toBe(false);
        expect(hasDraftContent({ memo: '무릎 상태 확인', sets: [] })).toBe(true);
        expect(hasDraftContent({ painCheck: true, sets: [] })).toBe(true);
        expect(hasSetValues([{ intensity: { value: '맨몸', unit: '맨몸' }, reps: { value: '', unit: '회' } }])).toBe(false);
        expect(hasSetValues([set('', '8')])).toBe(true);
    });
    it('copies sets without sharing objects and preserves nonstandard units', () => {
        const original = [{ intensity: { value: '3단', unit: '높이' }, reps: { value: '20', unit: '초 x 회', count: '3' } }];
        const copy = cloneSets(original);
        copy[0].intensity.value = '4단';
        copy[0].reps.count = '4';
        expect(original[0].intensity.value).toBe('3단');
        expect(original[0].reps.count).toBe('3');
        expect(setSummary(original[0])).toBe('3단높이 × 20초 × 3회');
    });
    it('accepts older weight/reps records for explicit copy', () => {
        expect(cloneSets([{ weight: '40', reps: '8' }])).toEqual([set()]);
    });
});
