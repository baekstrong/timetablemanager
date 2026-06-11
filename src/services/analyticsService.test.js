import { describe, it, expect } from 'vitest';
import { categorizeOccupation, tallyOccupations, computeRevenueTrend, tallyGenders, tallyPaymentMethods, countNewVsRenewal, computeSheetChurnByMonth, tallyReferralSources, parseAggregateBlock } from './analyticsService';

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

describe('tallyGenders', () => {
  it('남/여 정규화 후 집계', () => {
    const students = [{ 성별: '남' }, { 성별: '남자' }, { 성별: '여' }, { 성별: '' }];
    expect(tallyGenders(students)).toEqual({ 남: 2, 여: 1 });
  });
});

describe('tallyPaymentMethods', () => {
  it('결제방식별 건수와 금액 합', () => {
    const students = [
      { 결제방식: '카드', 결제금액: '450000' },
      { 결제방식: '카드', 결제금액: '390000' },
      { 결제방식: '계좌', 결제금액: '310000' },
    ];
    expect(tallyPaymentMethods(students)).toEqual({
      카드: { count: 2, amount: 840000 },
      계좌: { count: 1, amount: 310000 },
    });
  });
});

describe('countNewVsRenewal', () => {
  it('신규/재등록 카운트', () => {
    const students = [
      { '신규/재등록': '신규' }, { '신규/재등록': '재등록' }, { '신규/재등록': '재등록' },
    ];
    expect(countNewVsRenewal(students)).toEqual({ 신규: 1, 재등록: 2 });
  });
});

describe('tallyReferralSources', () => {
  it('referralSource별 집계, 빈 값은 미입력', () => {
    const regs = [
      { referralSource: '인스타그램' }, { referralSource: '인스타그램' },
      { referralSource: '지인추천' }, { referralSource: '' }, {},
    ];
    expect(tallyReferralSources(regs)).toEqual({
      인스타그램: 2, 지인추천: 1, 미입력: 2,
    });
  });
});

describe('computeSheetChurnByMonth', () => {
  it('D열 비고 다음달 활성 없음 → 해당 월 이탈로 집계', () => {
    const months = [
      { year: 2026, month: 1, students: [
        { 이름: '김철수', '요일 및 시간': '월1수1' },
        { 이름: '이영희', '요일 및 시간': '' },
      ]},
      { year: 2026, month: 2, students: [
        { 이름: '김철수', '요일 및 시간': '월1수1' },
      ]},
      { year: 2026, month: 3, students: [
        { 이름: '김철수', '요일 및 시간': '' },
      ]},
    ];
    // 2월은 다음달(3월) 존재 → 판정 / 3월은 최근달 → 제외
    // 이영희: 1월 D비어있고 2월 이후 활성 없음 → 1월 이탈
    // 김철수: 3월에 D비었지만 3월은 최근달이라 제외
    const out = computeSheetChurnByMonth(months);
    expect(out['2026-01']).toEqual(['이영희']);
    expect(out['2026-02']).toBeUndefined();
    expect(out['2026-03']).toBeUndefined();
  });

  it('D열 비었어도 이후 달에 활성 등록 있으면 이탈 아님', () => {
    const months = [
      { year: 2026, month: 1, students: [{ 이름: '박민수', '요일 및 시간': '' }] },
      { year: 2026, month: 2, students: [{ 이름: '박민수', '요일 및 시간': '화5목5' }] },
      { year: 2026, month: 3, students: [{ 이름: '박민수', '요일 및 시간': '화5목5' }] },
    ];
    const out = computeSheetChurnByMonth(months);
    expect(out['2026-01']).toBeUndefined();
  });
});

describe('parseAggregateBlock', () => {
  const labels = ['계좌','카드','네이버','탈잉','제로페이','어플','총합','단말기와 차액','<-네이버+탈잉+제로+어플','기타(HR)','총 매출','환불',' 최종 매출\n(환불 포함)'];

  it('만원→원 환산, 0 방식 제외, 최종매출 추출 (6월: 환불 없음)', () => {
    const values = ['39','190','0','0','62','0','291','291','62','0','291','0','291'];
    expect(parseAggregateBlock(labels, values)).toEqual({
      payments: { 계좌: 390000, 카드: 1900000, 제로페이: 620000 },
      refund: 0,
      finalRevenue: 2910000,
    });
  });

  it('환불은 절대값, 소수 최종매출 처리 (5월: 환불 -53.025)', () => {
    const values = ['39','39','0','0','0','0','78','78','0','0','871','-53.025','817.975'];
    expect(parseAggregateBlock(labels, values)).toEqual({
      payments: { 계좌: 390000, 카드: 390000 },
      refund: 530250,
      finalRevenue: 8179750,
    });
  });

  it('빈 입력은 안전하게 0/빈 객체', () => {
    expect(parseAggregateBlock([], [])).toEqual({ payments: {}, refund: 0, finalRevenue: 0 });
    expect(parseAggregateBlock(undefined, undefined)).toEqual({ payments: {}, refund: 0, finalRevenue: 0 });
  });
});
