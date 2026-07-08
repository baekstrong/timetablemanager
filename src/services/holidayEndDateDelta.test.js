import { describe, it, expect } from 'vitest';
import {
  parseAbsenceDatesFromNotes,
  isHolidayRelevantToStudent,
  shiftEndDateBySessions,
  filterEffectiveHolidayDeltaDates,
  extendEndDateForHeldSessions,
} from './holidayEndDateDelta.js';

const iso = (s) => new Date(s + 'T00:00:00');
const toISOd = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

describe('parseAbsenceDatesFromNotes', () => {
  it('단일 결석 기록을 ISO로 변환', () => {
    expect(parseAbsenceDatesFromNotes('26.2.10 결석')).toEqual(['2026-02-10']);
  });
  it('쉼표로 묶인 여러 날짜(공통 결석 접미)', () => {
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
  it('결석이 아닌 날짜 메모는 제외', () => {
    expect(parseAbsenceDatesFromNotes('26.6.10 상담')).toEqual([]);
    expect(parseAbsenceDatesFromNotes('26.6.10 보강신청')).toEqual([]);
  });
  it('결석 기록과 비결석 메모 혼재 시 결석만', () => {
    expect(parseAbsenceDatesFromNotes('26.2.10 결석, 26.3.1 상담'))
      .toEqual(['2026-02-10']);
  });
  it('여러 결석 구간 누적', () => {
    expect(parseAbsenceDatesFromNotes('26.2.10 결석, 26.3.5 결석'))
      .toEqual(['2026-02-10', '2026-03-05']);
  });
});

describe('filterEffectiveHolidayDeltaDates', () => {
  const builtIn = new Set(['2026-02-16']);
  const isBuiltInHoliday = (ds) => builtIn.has(ds);

  it('추가 모드에서 이미 기본 공휴일인 날짜는 제외한다', () => {
    expect(filterEffectiveHolidayDeltaDates({
      changedDates: ['2026-02-16', '2026-02-17'],
      mode: 'add',
      isBuiltInHoliday,
    })).toEqual(['2026-02-17']);
  });

  it('삭제 모드에서도 여전히 기본 공휴일인 날짜는 제외한다', () => {
    expect(filterEffectiveHolidayDeltaDates({
      changedDates: ['2026-02-16', '2026-02-17'],
      mode: 'delete',
      isBuiltInHoliday,
    })).toEqual(['2026-02-17']);
  });
});

describe('isHolidayRelevantToStudent', () => {
  // 수업: 월(1)·수(3), 등록기간 2026-02-02 ~ 2026-03-31
  const base = {
    classDays: [1, 3],
    startDate: new Date(2026, 1, 2),
    endDate: new Date(2026, 2, 31),
    holdingRanges: [],
    absenceDateSet: new Set(),
  };

  it('수업요일 + 기간 내 → true (2026-02-09 월)', () => {
    expect(isHolidayRelevantToStudent({ ...base, holidayDate: new Date(2026, 1, 9) })).toBe(true);
  });

  it('비수업요일(화) → false (2026-02-10)', () => {
    expect(isHolidayRelevantToStudent({ ...base, holidayDate: new Date(2026, 1, 10) })).toBe(false);
  });

  it('시작일 이전 → false', () => {
    expect(isHolidayRelevantToStudent({ ...base, holidayDate: new Date(2026, 0, 26) })).toBe(false);
  });

  it('종료일 이후 → false (2026-04-06 월)', () => {
    expect(isHolidayRelevantToStudent({ ...base, holidayDate: new Date(2026, 3, 6) })).toBe(false);
  });

  it('홀딩 기간 내 → false', () => {
    const ranges = [{ start: new Date(2026, 1, 1), end: new Date(2026, 1, 15) }];
    expect(isHolidayRelevantToStudent({
      ...base, holdingRanges: ranges, holidayDate: new Date(2026, 1, 9),
    })).toBe(false);
  });

  it('결석일과 겹침 → false', () => {
    const set = new Set(['2026-02-09']);
    expect(isHolidayRelevantToStudent({
      ...base, absenceDateSet: set, holidayDate: new Date(2026, 1, 9),
    })).toBe(false);
  });

  it('시작일 당일 경계 포함 → true (2026-02-02 월)', () => {
    expect(isHolidayRelevantToStudent({ ...base, holidayDate: new Date(2026, 1, 2) })).toBe(true);
  });
});

function toISOForTest(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

describe('shiftEndDateBySessions', () => {
  const classDays = [1, 3]; // 월, 수
  const noHoliday = () => false;

  it('delta +1: 종료일(월 2/9) 다음 수업일은 수 2/11', () => {
    const r = shiftEndDateBySessions({
      endDate: new Date(2026, 1, 9), deltaSessions: 1,
      classDays, holdingRanges: [], isHoliday: noHoliday,
    });
    expect(toISOForTest(r)).toBe('2026-02-11');
  });

  it('delta +2: 두 수업일 전진 (2/9 → 2/16)', () => {
    const r = shiftEndDateBySessions({
      endDate: new Date(2026, 1, 9), deltaSessions: 2,
      classDays, holdingRanges: [], isHoliday: noHoliday,
    });
    expect(toISOForTest(r)).toBe('2026-02-16');
  });

  it('전진 중 휴일(2/11) 건너뜀 → 2/16', () => {
    const isHol = (d) => toISOForTest(d) === '2026-02-11';
    const r = shiftEndDateBySessions({
      endDate: new Date(2026, 1, 9), deltaSessions: 1,
      classDays, holdingRanges: [], isHoliday: isHol,
    });
    expect(toISOForTest(r)).toBe('2026-02-16');
  });

  it('delta -1: 종료일(수 2/11) 이전 수업일은 월 2/9', () => {
    const r = shiftEndDateBySessions({
      endDate: new Date(2026, 1, 11), deltaSessions: -1,
      classDays, holdingRanges: [], isHoliday: noHoliday,
    });
    expect(toISOForTest(r)).toBe('2026-02-09');
  });

  it('후진 중 홀딩(2/9) 건너뜀 → 2/4', () => {
    const ranges = [{ start: new Date(2026, 1, 9), end: new Date(2026, 1, 9) }];
    const r = shiftEndDateBySessions({
      endDate: new Date(2026, 1, 11), deltaSessions: -1,
      classDays, holdingRanges: ranges, isHoliday: noHoliday,
    });
    expect(toISOForTest(r)).toBe('2026-02-04');
  });

  it('delta 0이면 종료일 그대로', () => {
    const r = shiftEndDateBySessions({
      endDate: new Date(2026, 1, 11), deltaSessions: 0,
      classDays, holdingRanges: [], isHoliday: noHoliday,
    });
    expect(toISOForTest(r)).toBe('2026-02-11');
  });

  it('가드 소진 시 null (모든 수업일이 휴일)', () => {
    const r = shiftEndDateBySessions({
      endDate: new Date(2026, 1, 9), deltaSessions: 1,
      classDays, holdingRanges: [], isHoliday: () => true,
    });
    expect(r).toBe(null);
  });
});

describe('extendEndDateForHeldSessions', () => {
  // 조동환: 화목→월수 전환, 시작 6/16(화). 저장 종료일 7/8(월수 7회분).
  // 홀딩 없으면 종료일을 처음부터 다시 세면 안 됨 — 저장값을 신뢰하고 빠진 수업일만큼만 민다.
  const base = {
    startDate: iso('2026-06-16'),
    endDate: iso('2026-07-08'),
    classDays: [1, 3], // 월수
    isHoliday: () => false,
    priorHoldingRanges: [],
  };

  it('저장된 종료일(7/8)에서 홀딩한 수업일(7/8) 1회만큼만 다음 수업일로 민다 → 7/13(월)', () => {
    const r = extendEndDateForHeldSessions({ ...base, newHeldDates: ['2026-07-08'] });
    expect(toISOd(r)).toBe('2026-07-13');
  });

  it('중간 수업일(7/1)을 홀딩해도 종료일은 1 수업일만 밀린다 → 7/13', () => {
    const r = extendEndDateForHeldSessions({ ...base, newHeldDates: ['2026-07-01'] });
    expect(toISOd(r)).toBe('2026-07-13');
  });

  it('홀딩 2일이면 2 수업일 밀린다 → 7/15(수)', () => {
    const r = extendEndDateForHeldSessions({ ...base, newHeldDates: ['2026-07-06', '2026-07-08'] });
    expect(toISOd(r)).toBe('2026-07-15');
  });

  it('비수업요일(7/7 화)을 빼도 종료일 변화 없음', () => {
    const r = extendEndDateForHeldSessions({ ...base, newHeldDates: ['2026-07-07'] });
    expect(toISOd(r)).toBe('2026-07-08');
  });

  it('수강기간 밖 날짜는 무시', () => {
    const r = extendEndDateForHeldSessions({ ...base, newHeldDates: ['2026-08-05'] });
    expect(toISOd(r)).toBe('2026-07-08');
  });

  it('이미 종료일에 반영된 기존 홀딩 범위와 겹치면 중복 연장 안 함', () => {
    const r = extendEndDateForHeldSessions({
      ...base,
      priorHoldingRanges: [{ start: iso('2026-07-08'), end: iso('2026-07-08') }],
      newHeldDates: ['2026-07-08'],
    });
    expect(toISOd(r)).toBe('2026-07-08');
  });

  it('전진 중 휴일은 건너뛴다 (7/13 월이 휴일이면 7/15 수)', () => {
    const r = extendEndDateForHeldSessions({
      ...base,
      isHoliday: (d) => toISOd(d) === '2026-07-13',
      newHeldDates: ['2026-07-08'],
    });
    expect(toISOd(r)).toBe('2026-07-15');
  });

  it('extraSessions(보강일 홀딩 등 비정규 추가분)만큼 더 민다', () => {
    const r = extendEndDateForHeldSessions({
      ...base, newHeldDates: ['2026-07-08'], extraSessions: 1,
    });
    expect(toISOd(r)).toBe('2026-07-15');
  });

  it('빠진 수업이 없으면 종료일 그대로', () => {
    const r = extendEndDateForHeldSessions({ ...base, newHeldDates: [] });
    expect(toISOd(r)).toBe('2026-07-08');
  });
});
