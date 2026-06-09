import { describe, it, expect } from 'vitest';
import { studentRegistrationCoversDate } from './googleSheetsService.js';

// 심성희 케이스 회귀 방지:
// - 활성 등록(Reg A): 시작 260303 ~ 종료 260616 (2월 시트에 행이 남아있음)
// - 미리 등록(Reg B): 시작 260623 ~ 종료 260901 (5월 시트)
// 오늘(2026-06-09) 기준으로 Reg A만 활성, Reg B는 미래 등록이어야 한다.
const regA = { 시작날짜: '260303', 종료날짜: '260616', '홀딩 사용여부': 'O(2/3)' };
const regB = { 시작날짜: '260623', 종료날짜: '260901', '홀딩 사용여부': 'X(0/3)' };
const today = new Date('2026-06-09T00:00:00');

describe('studentRegistrationCoversDate', () => {
  it('현재 활성 등록은 오늘을 포함한다', () => {
    expect(studentRegistrationCoversDate(regA, today)).toBe(true);
  });

  it('미래 미리등록은 오늘을 포함하지 않는다', () => {
    expect(studentRegistrationCoversDate(regB, today)).toBe(false);
  });

  it('종료일 당일(260616)도 수강 기간에 포함된다 — 마지막 수업일 홀딩 가능', () => {
    expect(studentRegistrationCoversDate(regA, new Date('2026-06-16T00:00:00'))).toBe(true);
  });

  it('시작일 하루 전은 포함하지 않는다', () => {
    expect(studentRegistrationCoversDate(regA, new Date('2026-03-02T00:00:00'))).toBe(false);
  });

  it('±2개월 윈도우(4~8월) 매치가 미래 등록뿐이면 활성 매치가 없다고 판단한다', () => {
    // findStudentAcrossSheets가 전체 시트 폴백을 트리거해야 하는 조건 재현
    const windowMatches = [regB]; // 5월 시트의 Reg B만 잡힘
    const hasActive = windowMatches.some(s => studentRegistrationCoversDate(s, today));
    expect(hasActive).toBe(false);
  });

  it('시작/종료날짜를 해석할 수 없으면 false', () => {
    expect(studentRegistrationCoversDate({ 시작날짜: '', 종료날짜: '' }, today)).toBe(false);
    expect(studentRegistrationCoversDate(null, today)).toBe(false);
  });
});
