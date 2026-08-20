import { describe, it, expect } from 'vitest';
import { evaluatePR, pastSetsFrom } from './pr-logic.js';

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

describe('pastSetsFrom', () => {
    it('여러 문서의 세트를 하나로 모은다', () => {
        const docs = [{ id: 'a', sets: [kg(60, 10)] }, { id: 'b', sets: [kg(70, 5)] }];
        expect(pastSetsFrom(docs)).toHaveLength(2);
    });

    it('excludeId 문서는 뺀다 — 방금 저장한 기록이 자기 자신과 비교되면 안 됨', () => {
        // 저장 쓰기와 PR 읽기가 동시에 출발하므로, 읽기 결과에 새 문서(new)가 섞일 수 있다.
        const docs = [{ id: 'old', sets: [kg(60, 10)] }, { id: 'new', sets: [kg(80, 3)] }];
        // 안 빼면 과거 최고가 80이 되어 신기록이 안 잡힌다.
        expect(evaluatePR(pastSetsFrom(docs), [kg(80, 3)])).toBe(null);
        // 빼면 과거 최고 60 대비 80이 신기록으로 잡힌다.
        expect(evaluatePR(pastSetsFrom(docs, 'new'), [kg(80, 3)]).weightPR).toBe(true);
    });

    it('그 종목 첫 기록이면 자기 자신을 뺀 뒤 비어서 축하 없음', () => {
        const docs = [{ id: 'new', sets: [kg(80, 3)] }];
        expect(evaluatePR(pastSetsFrom(docs, 'new'), [kg(80, 3)])).toBe(null);
    });

    it('sets 없는 문서·null도 견딘다', () => {
        expect(pastSetsFrom([null, { id: 'a' }, { id: 'b', sets: [kg(50, 5)] }])).toHaveLength(1);
        expect(pastSetsFrom(undefined)).toEqual([]);
    });
});
