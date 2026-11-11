import { describe, it, expect } from 'vitest';
import {
  applyFreeOnlyDecay, freeOnlyWeeksElapsed, parseFreeOnlyAnchor, replaceFreeOnlyTag, nextMondayOnOrAfter,
} from './freeOnlyPause';

const d = (y, m, day) => new Date(y, m - 1, day);
const rows = [
  { n: 11, notes: '메모 [정지:2/화1목1/260709] [자율전용:261116]' },
  { n: 8, notes: '[정지:2/화1목1/261116] [자율전용:261116]' },
];

describe('자율 전용 주간 차감', () => {
  it('기준일 전·당일·6일 뒤는 차감 없음, 7일째 1회', () => {
    const anchor = d(2026, 11, 16);
    expect(freeOnlyWeeksElapsed(anchor, d(2026, 11, 11))).toBe(0);
    expect(freeOnlyWeeksElapsed(anchor, d(2026, 11, 16))).toBe(0);
    expect(freeOnlyWeeksElapsed(anchor, d(2026, 11, 22))).toBe(0);
    expect(freeOnlyWeeksElapsed(anchor, d(2026, 11, 23))).toBe(1);
  });

  it('오늘은 19회, 다음 차감일 11/23', () => {
    const result = applyFreeOnlyDecay(rows, d(2026, 11, 11));
    expect(result.total).toBe(19);
    expect(result.nextDeduction).toEqual(d(2026, 11, 23));
  });

  it('오래된 등록부터 차감하고 다 쓰면 다음 등록으로 넘어간다', () => {
    const w12 = applyFreeOnlyDecay(rows, d(2027, 2, 8)); // 12주
    expect(w12.rows.map(r => r.n)).toEqual([0, 7]);
    expect(w12.total).toBe(7);
  });

  it('전부 소진되면 0회에서 멈추고 다음 차감일 없음', () => {
    const done = applyFreeOnlyDecay(rows, d(2027, 12, 1));
    expect(done.total).toBe(0);
    expect(done.nextDeduction).toBeNull();
  });

  it('태그가 없으면 그대로', () => {
    const plain = applyFreeOnlyDecay([{ n: 5, notes: '[정지:2/월1수1/260101]' }], d(2027, 1, 1));
    expect(plain.total).toBe(5);
    expect(plain.anchor).toBeNull();
  });

  it('태그 교체·삭제, 잘못된 날짜는 무시', () => {
    expect(replaceFreeOnlyTag('a [자율전용:261116]', d(2026, 11, 30))).toBe('a [자율전용:261130]');
    expect(replaceFreeOnlyTag('a [자율전용:261116]', null)).toBe('a');
    expect(parseFreeOnlyAnchor('[자율전용:261340]')).toBeNull();
  });

  it('다가오는 월요일', () => {
    expect(nextMondayOnOrAfter(d(2026, 11, 11))).toEqual(d(2026, 11, 16));
    expect(nextMondayOnOrAfter(d(2026, 11, 16))).toEqual(d(2026, 11, 16));
  });
});
