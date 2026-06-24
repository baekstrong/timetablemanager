import { describe, it, expect } from 'vitest';
import { GRADES, xpToGrade, gradeProgress, recordVolume, computeUserXp, FEMALE_COEF } from './grades';

describe('xpToGrade', () => {
  it('0 XP는 초등1', () => expect(xpToGrade(0).short).toBe('초1'));
  it('경계 정확: 20000kg는 중등1', () => expect(xpToGrade(20000).short).toBe('중1'));
  it('경계 직전: 19999kg는 초등6', () => expect(xpToGrade(19999).short).toBe('초6'));
  it('최상단 초과: 250000kg는 대학', () => expect(xpToGrade(250000).short).toBe('대학'));
  it('GRADES는 min 오름차순(단조 누진)', () => {
    for (let i = 1; i < GRADES.length; i++) expect(GRADES[i].min).toBeGreaterThan(GRADES[i - 1].min);
  });
});

describe('gradeProgress', () => {
  it('중간값 진척: 26500kg(중1~중2 사이 절반)', () => {
    const p = gradeProgress(26500); // 중1=20000, 중2=30000 → (26500-20000)/10000 = 65%
    expect(p.grade.short).toBe('중1');
    expect(p.next.short).toBe('중2');
    expect(Math.round(p.pct)).toBe(65);
    expect(p.remaining).toBe(3500);
  });
  it('대학(졸업)은 next 없음, pct 100', () => {
    const p = gradeProgress(200000);
    expect(p.next).toBe(null);
    expect(p.pct).toBe(100);
  });
});

describe('recordVolume / computeUserXp', () => {
  const rec = (sets) => ({ sets });
  it('kg×회 세트만 합산', () => {
    expect(recordVolume(rec([
      { intensity: { value: '100', unit: 'kg' }, reps: { value: '5', unit: '회' } }, // 500
      { intensity: { value: '60', unit: 'kg' }, reps: { value: '90', unit: '초' } }, // 시간세트 제외
    ]))).toBe(500);
  });
  it('손상된 sets(배열 아님)는 0', () => expect(recordVolume({ sets: null })).toBe(0));
  it('여성은 ×1.5', () => {
    const recs = [rec([{ intensity: { value: '100', unit: 'kg' }, reps: { value: '10', unit: '회' } }])]; // 1000
    expect(computeUserXp(recs, '남')).toBe(1000);
    expect(computeUserXp(recs, '여')).toBe(1500);
  });
});
