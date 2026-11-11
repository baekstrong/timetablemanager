import { describe, expect, it } from 'vitest';
import { getMakeupWeeklyLimit, countWeekMakeupUsage, hasMakeupQuotaLeft } from './makeupQuota';

describe('getMakeupWeeklyLimit', () => {
  it('uses the student weekly frequency as the makeup weekly limit', () => {
    expect(getMakeupWeeklyLimit({ 주횟수: '주1회' }, [])).toBe(1);
    expect(getMakeupWeeklyLimit({ 주횟수: '주2회' }, [])).toBe(2);
    expect(getMakeupWeeklyLimit({ 주횟수: '주3회' }, [])).toBe(3);
    expect(getMakeupWeeklyLimit({ 주횟수: '주4회' }, [])).toBe(4);
  });

  it('falls back to the parsed weekly schedule count when weekly frequency is missing', () => {
    expect(getMakeupWeeklyLimit(null, [])).toBe(1);
    expect(getMakeupWeeklyLimit({}, [])).toBe(1);
    expect(getMakeupWeeklyLimit({}, [{}, {}, {}])).toBe(3);
  });
});

describe('countWeekMakeupUsage (대기는 성공해야 1회)', () => {
  it('보강 이력만 센다(취소 포함)', () => {
    expect(countWeekMakeupUsage([{ status: 'cancelled' }, { status: 'active' }])).toBe(2);
  });
  it('빈 입력이면 0', () => {
    expect(countWeekMakeupUsage(null)).toBe(0);
  });
});

describe('hasMakeupQuotaLeft (자리 안내 직전 확인)', () => {
  it('남은 횟수가 있으면 안내한다', () => {
    expect(hasMakeupQuotaLeft({ weeklyLimit: 2 }, [{ status: 'active' }])).toBe(true);
  });
  it('이번 주 횟수를 다 썼으면 안내하지 않는다(취소한 보강 포함)', () => {
    expect(hasMakeupQuotaLeft({ weeklyLimit: 2 }, [{ status: 'cancelled' }, { status: 'active' }])).toBe(false);
  });
  it('한도가 없는 예전 대기는 막지 않는다', () => {
    expect(hasMakeupQuotaLeft({}, [{ status: 'active' }, { status: 'active' }])).toBe(true);
  });
});
