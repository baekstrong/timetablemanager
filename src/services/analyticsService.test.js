import { describe, it, expect } from 'vitest';
import { categorizeOccupation, tallyOccupations, computeRevenueTrend } from './analyticsService';

describe('categorizeOccupation', () => {
  it('회사/직장 키워드를 회사원으로 분류', () => {
    expect(categorizeOccupation('회사원')).toBe('회사원');
    expect(categorizeOccupation('직장인')).toBe('회사원');
    expect(categorizeOccupation('사무직')).toBe('회사원');
  });
  it('사업/자영 키워드를 자영업으로 분류', () => {
    expect(categorizeOccupation('자영업')).toBe('자영업');
    expect(categorizeOccupation('개인사업')).toBe('자영업');
  });
  it('학생/대학 키워드를 학생으로 분류', () => {
    expect(categorizeOccupation('대학생')).toBe('학생');
  });
  it('전문직 키워드 분류', () => {
    expect(categorizeOccupation('의사')).toBe('전문직');
    expect(categorizeOccupation('개발자')).toBe('전문직');
  });
  it('주부 분류', () => {
    expect(categorizeOccupation('가정주부')).toBe('주부');
  });
  it('빈 값/미매칭은 기타', () => {
    expect(categorizeOccupation('')).toBe('기타');
    expect(categorizeOccupation('우주비행사')).toBe('기타');
  });
});

describe('tallyOccupations', () => {
  it('학생 배열을 카테고리별로 집계', () => {
    const students = [
      { 직업: '회사원' }, { 직업: '직장인' }, { 직업: '자영업' }, { 직업: '' },
    ];
    expect(tallyOccupations(students)).toEqual({
      회사원: 2, 자영업: 1, 기타: 1,
    });
  });
});

describe('computeRevenueTrend', () => {
  it('전월 대비 증감액·증감률을 계산 (오래된→최신 순서 입력)', () => {
    const input = [
      { year: 2026, month: 1, revenue: 1000000 },
      { year: 2026, month: 2, revenue: 1500000 },
      { year: 2026, month: 3, revenue: 1200000 },
    ];
    const out = computeRevenueTrend(input);
    expect(out[0]).toMatchObject({ year: 2026, month: 1, revenue: 1000000, delta: null, deltaPct: null });
    expect(out[1]).toMatchObject({ revenue: 1500000, delta: 500000, deltaPct: 50 });
    expect(out[2]).toMatchObject({ revenue: 1200000, delta: -300000, deltaPct: -20 });
  });
  it('전월 매출이 0이면 deltaPct는 null', () => {
    const out = computeRevenueTrend([
      { year: 2026, month: 1, revenue: 0 },
      { year: 2026, month: 2, revenue: 500000 },
    ]);
    expect(out[1].delta).toBe(500000);
    expect(out[1].deltaPct).toBeNull();
  });
});
