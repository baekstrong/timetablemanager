import { describe, it, expect } from 'vitest';
import { estimate1RM, trainingTable } from './onerm.js';

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
        expect(t.length).toBe(6);
    });

    it('잘못된 1RM은 빈 배열', () => {
        expect(trainingTable(0)).toEqual([]);
    });
});
