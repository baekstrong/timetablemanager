import { describe, it, expect } from 'vitest';
import { countRemainingSessions, todaySessionDone } from './googleSheetsService';

describe('countRemainingSessions (양끝 포함, 공휴일 제외)', () => {
  it('화/목 주2회, 6/17~6/30 → 18·23·25·30 = 4회', () => {
    expect(countRemainingSessions(new Date('2026-06-17'), new Date('2026-06-30'), '화5목5', [])).toBe(4);
  });
  it('미리등록 주2회 한 달치(시작일부터, 8번째 수업일까지) → 8회', () => {
    // 월/목 주2회, 7/2(목)~7/27(월): 2,6,9,13,16,20,23,27 = 8 (calculateEndDate가 잡는 종료일)
    expect(countRemainingSessions(new Date('2026-07-02'), new Date('2026-07-27'), '월2목2', [])).toBe(8);
  });
  it('공휴일은 제외 (firebase 공휴일 6/18)', () => {
    expect(countRemainingSessions(new Date('2026-06-17'), new Date('2026-06-30'), '화5목5', [{ date: '2026-06-18' }])).toBe(3);
  });
});

describe('todaySessionDone (오늘 교시 종료 여부)', () => {
  it('화 2교시(끝 13:30) — 13:31이면 끝남', () => {
    expect(todaySessionDone('화2', new Date('2026-06-16T13:31:00'))).toBe(true);
  });
  it('화 2교시 — 11:59면 아직 안 끝남(시작 전)', () => {
    expect(todaySessionDone('화2', new Date('2026-06-16T11:59:00'))).toBe(false);
  });
  it('오늘(화) 수업 없으면 false', () => {
    expect(todaySessionDone('월5목5', new Date('2026-06-16T23:00:00'))).toBe(false);
  });
});
