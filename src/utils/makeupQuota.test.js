import { describe, expect, it } from 'vitest';
import { getMakeupWeeklyLimit, countWeekMakeupCommitments } from './makeupQuota';

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

describe('countWeekMakeupCommitments (보강+대기 합산)', () => {
  const S = '2026-07-13', E = '2026-07-17';

  it('보강 이력과 활성 대기를 합산한다', () => {
    const makeups = [{ status: 'active' }];
    const waits = [{ status: 'waiting', date: '2026-07-15' }];
    expect(countWeekMakeupCommitments(makeups, waits, S, E)).toBe(2);
  });
  it('취소된 보강도 이력에 있으면 함께 센다(이미 주 단위 필터됨)', () => {
    const makeups = [{ status: 'cancelled' }, { status: 'active' }];
    expect(countWeekMakeupCommitments(makeups, [], S, E)).toBe(2);
  });
  it('waiting/notified만 대기로 센다', () => {
    const waits = [
      { status: 'waiting', date: '2026-07-14' },
      { status: 'notified', date: '2026-07-15' },
      { status: 'declined', date: '2026-07-15' },
      { status: 'expired', date: '2026-07-15' },
    ];
    expect(countWeekMakeupCommitments([], waits, S, E)).toBe(2);
  });
  it('이번 주 밖 날짜의 대기는 제외한다', () => {
    const waits = [
      { status: 'waiting', date: '2026-07-15' },
      { status: 'waiting', date: '2026-07-20' },
    ];
    expect(countWeekMakeupCommitments([], waits, S, E)).toBe(1);
  });
  it('빈 입력이면 0', () => {
    expect(countWeekMakeupCommitments(null, null, S, E)).toBe(0);
  });
});
