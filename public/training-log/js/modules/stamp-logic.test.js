import { describe, it, expect } from 'vitest';
import { suggestGrade, prevMonthRange, computeStampStats } from './stamp-logic.js';

describe('suggestGrade', () => {
    it('활동일 13 이상이면 great', () => {
        expect(suggestGrade(18)).toBe('great');
        expect(suggestGrade(13)).toBe('great');
    });
    it('활동일 6~12면 good', () => {
        expect(suggestGrade(12)).toBe('good');
        expect(suggestGrade(6)).toBe('good');
    });
    it('활동일 6 미만이면 tryharder', () => {
        expect(suggestGrade(5)).toBe('tryharder');
        expect(suggestGrade(0)).toBe('tryharder');
    });
});

describe('prevMonthRange', () => {
    it('일반 달은 직전 달 범위', () => {
        expect(prevMonthRange('2026-06')).toEqual({
            prevMonth: '2026-05', start: '2026-05-01', end: '2026-05-31',
        });
    });
    it('1월은 전년 12월로 롤오버', () => {
        expect(prevMonthRange('2026-01')).toEqual({
            prevMonth: '2025-12', start: '2025-12-01', end: '2025-12-31',
        });
    });
    it('2월 말일(평년 28일) 계산', () => {
        expect(prevMonthRange('2026-03').end).toBe('2026-02-28');
    });
});

describe('computeStampStats', () => {
    it('같은 날 여러 종목이면 활동일 1, 일평균은 종목수', () => {
        const recs = [
            { date: '2026-05-01', exercise: '벤치' },
            { date: '2026-05-01', exercise: '스쿼트' },
            { date: '2026-05-01', exercise: '데드' },
        ];
        expect(computeStampStats(recs)).toEqual({
            activeDays: 1, totalExercises: 3, avgExercises: 3,
        });
    });
    it('건성 케이스: 활동일 높고 일평균 1점대', () => {
        const recs = [
            { date: '2026-05-01', exercise: 'a' },
            { date: '2026-05-02', exercise: 'b' },
            { date: '2026-05-03', exercise: 'c' },
            { date: '2026-05-03', exercise: 'd' },
        ];
        const s = computeStampStats(recs);
        expect(s.activeDays).toBe(3);
        expect(s.avgExercises).toBe(1.3);
    });
    it('빈 배열은 0', () => {
        expect(computeStampStats([])).toEqual({
            activeDays: 0, totalExercises: 0, avgExercises: 0,
        });
    });
});
