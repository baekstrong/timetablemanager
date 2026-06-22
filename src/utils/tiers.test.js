import { describe, it, expect } from 'vitest';
import { scoreToTier, compareTiers, computeActiveScore } from './tiers';

describe('scoreToTier', () => {
    it('buckets by 활동일', () => {
        expect(scoreToTier(0).key).toBe('rookie');
        expect(scoreToTier(5).key).toBe('rookie');
        expect(scoreToTier(8).key).toBe('steady'); // 주2회 개근
        expect(scoreToTier(12).key).toBe('passion');
        expect(scoreToTier(16).key).toBe('core');
        expect(scoreToTier(20).key).toBe('iron');
    });
});

describe('compareTiers', () => {
    it('승급/강등/유지', () => {
        expect(compareTiers('steady', 'passion')).toBe(1);
        expect(compareTiers('passion', 'steady')).toBe(-1);
        expect(compareTiers('iron', 'iron')).toBe(0);
        expect(compareTiers(null, 'steady')).toBe(0);
    });
});

describe('computeActiveScore', () => {
    it('기록∪자율 합집합, 중복 날짜는 1일', () => {
        const score = computeActiveScore({
            recordDates: new Set(['2026-06-01', '2026-06-03']),
            freeDates: new Set(['2026-06-03', '2026-06-07']), // 06-03 중복
        });
        expect(score).toBe(3); // 06-01, 06-03, 06-07
    });
    it('기록이 없으면 0 (예정 수업일은 인정 안 함)', () => {
        expect(computeActiveScore({ recordDates: new Set(), freeDates: new Set() })).toBe(0);
        expect(computeActiveScore({})).toBe(0);
    });
    it('자율운동만 있어도 인정', () => {
        const score = computeActiveScore({ freeDates: new Set(['2026-06-10', '2026-06-11']) });
        expect(score).toBe(2);
    });
});
