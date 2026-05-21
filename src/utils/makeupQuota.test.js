import { describe, expect, it } from 'vitest';
import { getMakeupWeeklyLimit } from './makeupQuota';

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
