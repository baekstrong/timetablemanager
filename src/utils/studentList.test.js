import { describe, expect, it } from 'vitest';
import { getCoachStudentListStatus, shouldShowInCoachStudentList, getUnpaidStudentNames, isPausedRegistration } from './studentList';

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

  it('일시정지(스케줄 비고 종료날짜 "N회")는 목록에 계속 표시', () => {
    const paused = { 이름: '정지학생', '요일 및 시간': '', 종료날짜: '5회' };
    expect(isPausedRegistration(paused)).toBe(true);
    expect(shouldShowInCoachStudentList(paused)).toBe(true);
    expect(getCoachStudentListStatus(paused)).toBe('paused');
  });

  it('종료(스케줄 비고 종료날짜가 날짜)는 정지 아님 → 숨김', () => {
    const ended = { 이름: '종료학생', '요일 및 시간': '', 종료날짜: '260630' };
    expect(isPausedRegistration(ended)).toBe(false);
    expect(shouldShowInCoachStudentList(ended)).toBe(false);
  });
});

describe('getUnpaidStudentNames', () => {
    const ref = new Date(2026, 5, 12); // 2026-06-12
    it('결제유무 X인 활성 수강생을 미결제로 판정한다', () => {
        const students = [
            { '이름': '김미납', '요일 및 시간': '월1수1', '시작날짜': '260601', '종료날짜': '260630', '결제유무': 'X' },
            { '이름': '박완납', '요일 및 시간': '화5목5', '시작날짜': '260601', '종료날짜': '260630', '결제유무': 'O' },
        ];
        const result = getUnpaidStudentNames(students, ref);
        expect(result.has('김미납')).toBe(true);
        expect(result.has('박완납')).toBe(false);
    });
    it('같은 이름 여러 행이면 오늘 기준 활성 행으로 판정한다 (미리 등록 무시)', () => {
        const students = [
            { '이름': '이중복', '요일 및 시간': '월1수1', '시작날짜': '260601', '종료날짜': '260630', '결제유무': 'O' },
            { '이름': '이중복', '요일 및 시간': '월1수1', '시작날짜': '260701', '종료날짜': '260731', '결제유무': 'X' },
        ];
        expect(getUnpaidStudentNames(students, ref).has('이중복')).toBe(false);
    });
    it('빈 값/스케줄 없는 행은 미결제로 취급하지 않는다', () => {
        const students = [
            { '이름': '김빈값', '요일 및 시간': '월1', '시작날짜': '260601', '종료날짜': '260630', '결제유무': '' },
            { '이름': '박종료', '요일 및 시간': '', '시작날짜': '260501', '종료날짜': '260531', '결제유무': 'X' },
        ];
        const result = getUnpaidStudentNames(students, ref);
        expect(result.size).toBe(0);
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
