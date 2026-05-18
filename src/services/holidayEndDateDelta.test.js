import { describe, it, expect } from 'vitest';
import { parseAbsenceDatesFromNotes } from './holidayEndDateDelta.js';

describe('parseAbsenceDatesFromNotes', () => {
  it('단일 결석 기록을 ISO로 변환', () => {
    expect(parseAbsenceDatesFromNotes('26.2.10 결석')).toEqual(['2026-02-10']);
  });

  it('쉼표로 묶인 여러 날짜 추출', () => {
    expect(parseAbsenceDatesFromNotes('26.2.10, 26.2.12 결석'))
      .toEqual(['2026-02-10', '2026-02-12']);
  });

  it('한 자리 월/일 0 padding', () => {
    expect(parseAbsenceDatesFromNotes('26.3.1 결석')).toEqual(['2026-03-01']);
  });

  it('빈 값/널은 빈 배열', () => {
    expect(parseAbsenceDatesFromNotes('')).toEqual([]);
    expect(parseAbsenceDatesFromNotes(null)).toEqual([]);
    expect(parseAbsenceDatesFromNotes(undefined)).toEqual([]);
  });

  it('날짜 토큰 없는 메모는 빈 배열', () => {
    expect(parseAbsenceDatesFromNotes('상담 완료')).toEqual([]);
  });
});
