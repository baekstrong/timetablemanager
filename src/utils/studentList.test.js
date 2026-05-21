import { describe, expect, it } from 'vitest';
import { getCoachStudentListStatus, shouldShowInCoachStudentList } from './studentList';

describe('shouldShowInCoachStudentList', () => {
  it('hides a student when coach ended class by clearing schedule even if end date is in the future', () => {
    expect(shouldShowInCoachStudentList({
      이름: '종료학생',
      '요일 및 시간': '',
      종료날짜: '260630',
    })).toBe(false);
  });

  it('keeps a scheduled student visible even after the nominal end date has passed', () => {
    expect(shouldShowInCoachStudentList({
      이름: '미종료학생',
      '요일 및 시간': '월5수5',
      종료날짜: '260430',
    })).toBe(true);
  });

  it('shows a student with schedule regardless of end date format availability', () => {
    expect(shouldShowInCoachStudentList({
      이름: '활성학생',
      '요일 및 시간': '화6목6',
      종료날짜: '',
    })).toBe(true);
  });
});

describe('getCoachStudentListStatus', () => {
  it('marks scheduled students past their end date as expired instead of hiding them', () => {
    expect(getCoachStudentListStatus({
      이름: '만료학생',
      '요일 및 시간': '월5수5',
      종료날짜: '260430',
    }, new Date('2026-05-21T00:00:00+09:00'))).toBe('expired');
  });

  it('marks scheduled students whose end date is today or later as active', () => {
    expect(getCoachStudentListStatus({
      이름: '활성학생',
      '요일 및 시간': '월5수5',
      종료날짜: '260521',
    }, new Date('2026-05-21T00:00:00+09:00'))).toBe('active');
  });
});
