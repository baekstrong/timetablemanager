import { describe, it, expect } from 'vitest';
import { percentSets } from './onerm.js';

describe('percentSets', () => {
    it('누른 순서를 그대로 유지한다 (무거운 것부터도 가능)', () => {
        expect(percentSets(100, [85, 75, 65])).toEqual([
            { pct: 85, weight: 85 }, { pct: 75, weight: 75 }, { pct: 65, weight: 65 },
        ]);
        expect(percentSets(100, [65, 75, 85]).map(r => r.weight)).toEqual([65, 75, 85]);
    });

    it('0.5kg 단위로 반올림한다', () => {
        expect(percentSets(97.5, [65])).toEqual([{ pct: 65, weight: 63.5 }]);
    });

    it('1RM이 없거나 고른 %가 없으면 빈 배열', () => {
        expect(percentSets(0, [80])).toEqual([]);
        expect(percentSets(100, [])).toEqual([]);
        expect(percentSets(100, undefined)).toEqual([]);
    });
});

import { estimate1RM, trainingTable, sortMyOneRMs } from './onerm.js';

describe('estimate1RM (Epley)', () => {
    it('횟수 1이면 무게 그대로', () => {
        expect(estimate1RM(100, 1)).toBe(100);
    });

    it('100kg×5회 → 116.5kg (0.5 반올림)', () => {
        // 100 × (1 + 5/30) = 116.666… → 116.5
        expect(estimate1RM(100, 5)).toBe(116.5);
    });

    it('무게 0 이하·횟수 1 미만·빈값은 null', () => {
        expect(estimate1RM(0, 5)).toBe(null);
        expect(estimate1RM(100, 0)).toBe(null);
        expect(estimate1RM('', '')).toBe(null);
    });
});

describe('trainingTable', () => {
    it('95%는 1RM×0.95', () => {
        const t = trainingTable(100);
        expect(t[0]).toEqual({ pct: 95, weight: 95 });
        expect(t[t.length - 1]).toEqual({ pct: 50, weight: 50 });
        expect(t.length).toBe(10);
    });

    it('잘못된 1RM은 빈 배열', () => {
        expect(trainingTable(0)).toEqual([]);
    });
});

describe('sortMyOneRMs', () => {
    it('최근 저장(date desc) 순으로 정렬하고 종목명을 붙인다', () => {
        const map = {
            '스쿼트': { oneRM: 140, weight: 120, reps: 8, date: '2026-06-28' },
            '벤치프레스': { oneRM: 116.5, weight: 100, reps: 5, date: '2026-07-03' },
        };
        const list = sortMyOneRMs(map);
        expect(list.map(x => x.exercise)).toEqual(['벤치프레스', '스쿼트']);
        expect(list[0].oneRM).toBe(116.5);
    });

    it('빈 map은 빈 배열', () => {
        expect(sortMyOneRMs({})).toEqual([]);
        expect(sortMyOneRMs(undefined)).toEqual([]);
    });
});
