import { describe, it, expect } from 'vitest';
import { scoreToTier, compareTiers, scheduledDatesInMonth, computeActiveScore } from './tiers';

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

describe('scheduledDatesInMonth', () => {
    it('요일 매칭 + 기간/공휴일 제외', () => {
        // 2026-06: 월=1,8,15,22,29 / 수=3,10,17,24. 현충일 6/6(토)은 영향 없음.
        const set = scheduledDatesInMonth('월1수1', '260601', '260630', '2026-06');
        expect(set.has('2026-06-01')).toBe(true);
        expect(set.has('2026-06-03')).toBe(true);
        expect(set.has('2026-06-02')).toBe(false); // 화요일
        expect(set.size).toBe(9);
    });
    it('등록 기간 밖은 제외', () => {
        const set = scheduledDatesInMonth('월1', '260615', '260630', '2026-06');
        expect(set.has('2026-06-01')).toBe(false);
        expect(set.has('2026-06-15')).toBe(true);
    });
});

describe('computeActiveScore', () => {
    it('예정+기록+자율 합집합, 중복 제거', () => {
        const score = computeActiveScore({
            scheduledDates: new Set(['2026-06-01', '2026-06-03']),
            recordDates: new Set(['2026-06-01']), // 수업일과 겹침 → 1일
            freeDates: new Set(['2026-06-07']), // 추가 운동 → +1
        });
        expect(score).toBe(3);
    });
    it('홀딩/결석은 예정일에서만 제외, 기록 있으면 보호', () => {
        const score = computeActiveScore({
            scheduledDates: new Set(['2026-06-01', '2026-06-03', '2026-06-08']),
            recordDates: new Set(['2026-06-08']), // 결석 신청일이지만 실제 기록 → 인정
            absenceDates: new Set(['2026-06-01', '2026-06-08']),
            holdingRanges: [{ start: '2026-06-03', end: '2026-06-03' }],
        });
        // 06-01 결석 제외, 06-03 홀딩 제외, 06-08 기록 보호 → 1
        expect(score).toBe(1);
    });
});
