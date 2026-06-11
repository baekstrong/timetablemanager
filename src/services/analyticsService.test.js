import { describe, it, expect } from 'vitest';
import { categorizeOccupation, tallyOccupations, computeRevenueTrend, tallyGenders, tallyPaymentMethods, countNewVsRenewal, computeChurnByMonth, parseYmd, tallyReferralSources, parseAggregateBlock } from './analyticsService';

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

describe('parseYmd', () => {
  it('YYMMDD/YYYYMMDD 파싱, 잘못된 값은 null', () => {
    expect(parseYmd('260313')).toBe(new Date(2026, 2, 13).getTime());
    expect(parseYmd('20260313')).toBe(new Date(2026, 2, 13).getTime());
    expect(parseYmd('')).toBeNull();
    expect(parseYmd('12')).toBeNull();
    expect(parseYmd(undefined)).toBeNull();
  });
});

describe('computeChurnByMonth', () => {
  const today = new Date(2026, 5, 11).getTime(); // 2026-06-11
  const win = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'];

  it('종료날짜 기준: 마지막 종료월에 이탈 집계 (이름별 dedup)', () => {
    const rows = [
      { 이름: '류채림', 종료날짜: '260213' },
      { 이름: '류채림', 종료날짜: '260313' }, // 마지막 = 3월
      { 이름: '김지연', 종료날짜: '260413' }, // 4월
    ];
    expect(computeChurnByMonth(rows, [], win, today)).toEqual({ '2026-03': 1, '2026-04': 1 });
  });

  it('오늘 이후까지 가는 등록이 있으면 이탈 아님', () => {
    const rows = [
      { 이름: '활성', 종료날짜: '260710' },           // 미래 → 활성
      { 이름: '복수', 종료날짜: '260213' },
      { 이름: '복수', 종료날짜: '260730' },           // 미래 등록 존재 → 활성
    ];
    expect(computeChurnByMonth(rows, [], win, today)).toEqual({});
  });

  it('Firebase 종료기록은 종료날짜보다 우선 (중도 종료, H가 미래여도 그 달 이탈)', () => {
    const terms = [{ studentName: '박종료', ms: new Date(2026, 4, 15).getTime() }]; // 5월
    const rows = [{ 이름: '박종료', 종료날짜: '260910' }]; // 9월(미래)이지만 종료기록 우선
    expect(computeChurnByMonth(rows, terms, win, today)).toEqual({ '2026-05': 1 });
  });

  it('표시 범위 밖 이탈은 집계 안 함', () => {
    const rows = [{ 이름: '옛날', 종료날짜: '251220' }]; // 2025-12, 범위 밖
    expect(computeChurnByMonth(rows, [], win, today)).toEqual({});
  });

  it('종료날짜 없으면 판정 불가(제외)', () => {
    expect(computeChurnByMonth([{ 이름: '미정', 종료날짜: '' }], [], win, today)).toEqual({});
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
