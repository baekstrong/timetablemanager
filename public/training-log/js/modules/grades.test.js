import { describe, it, expect } from 'vitest';
import { GRADES as TL, xpToGrade, recordVolume, gradeRank } from './grades.js';
import { GRADES as MAIN } from '../../../../src/utils/grades.js';

// 훈련일지 grades.js는 메인앱 src/utils/grades.js의 복제다. 두 표가 어긋나면
// 같은 XP인데 앱마다 레벨이 달라진다. 경계값 일치를 강제한다.
describe('훈련일지 GRADES ≡ 메인앱 GRADES', () => {
    it('키·min 경계가 완전히 일치', () => {
        expect(TL.map(g => [g.key, g.min])).toEqual(MAIN.map(g => [g.key, g.min]));
    });
});

describe('xpToGrade / recordVolume', () => {
    it('min 경계에서 학년이 넘어간다', () => {
        expect(xpToGrade(0).key).toBe('e1');
        expect(xpToGrade(2499).key).toBe('e2');
        expect(xpToGrade(2500).key).toBe('e3');
        expect(xpToGrade(45000).key).toBe('m3');
    });
    it('recordVolume은 kg×회 세트만 합산(맨몸/초 등은 0)', () => {
        const rec = { sets: [
            { intensity: { value: '10', unit: 'kg' }, reps: { value: '5', unit: '회' } }, // 50
            { intensity: { value: '20', unit: 'kg' }, reps: { value: '3', unit: '회' } }, // 60
            { intensity: { unit: '맨몸' }, reps: { value: '10', unit: '회' } },            // 0
        ] };
        expect(recordVolume(rec)).toBe(110);
        expect(recordVolume({})).toBe(0);
    });
    it('gradeRank는 낮은 학년일수록 작다', () => {
        expect(gradeRank('e1')).toBeLessThan(gradeRank('m3'));
        expect(gradeRank('없는키')).toBe(-1);
    });
});
