import { describe, it, expect } from 'vitest';
import { evaluatePR } from './pr-logic.js';

const kg = (w, r) => ({ intensity: { value: String(w), unit: 'kg' }, reps: { value: String(r), unit: '회' } });
const bw = (r) => ({ intensity: { unit: '맨몸' }, reps: { value: String(r), unit: '회' } });

describe('evaluatePR', () => {
    it('첫 기록(과거 없음)은 축하 없음(null)', () => {
        expect(evaluatePR([], [kg(60, 10)])).toBe(null);
    });

    it('새 최고 무게면 weightPR', () => {
        const r = evaluatePR([kg(60, 10)], [kg(65, 8)]);
        expect(r.weightPR).toBe(true);
        expect(r.weight).toBe(65);
        expect(r.repsPR).toBe(false);
    });

    it('새 최다 반복이면 repsPR', () => {
        const r = evaluatePR([kg(60, 10)], [kg(60, 12)]);
        expect(r.repsPR).toBe(true);
        expect(r.reps).toBe(12);
        expect(r.weightPR).toBe(false);
    });

    it('무게·반복 둘 다 과거 이하면 null', () => {
        expect(evaluatePR([kg(60, 10)], [kg(55, 8)])).toBe(null);
    });

    it('여러 과거 세트 중 최댓값과 비교', () => {
        const past = [kg(50, 12), kg(70, 5), kg(60, 8)];
        expect(evaluatePR(past, [kg(69, 6)])).toBe(null);      // 70 미달
        expect(evaluatePR(past, [kg(71, 3)]).weightPR).toBe(true);
    });

    it('맨몸(kg 아님)은 무게 PR 대상 아니고 반복만 비교', () => {
        const res = evaluatePR([bw(10)], [bw(15)]);
        expect(res.repsPR).toBe(true);
        expect(res.weightPR).toBe(false);
    });
});
