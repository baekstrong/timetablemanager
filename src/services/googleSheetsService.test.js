import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isQuotaError, getHolidayName, calculateMembershipStats } from './googleSheetsService';

describe('getHolidayName', () => {
  it('한국 공휴일은 이름 반환', () => {
    expect(getHolidayName(new Date(2026, 4, 5))).toBe('어린이날'); // 5월 5일
  });
  it('직접 지정 휴일은 reason 반환', () => {
    const custom = [{ date: '2026-07-20', reason: '휴관' }];
    expect(getHolidayName(new Date(2026, 6, 20), custom)).toBe('휴관');
  });
  it('휴일 아니면 null', () => {
    expect(getHolidayName(new Date(2026, 6, 21))).toBe(null); // 평일
  });
});

describe('isQuotaError', () => {
  it('HTTP 429는 할당량 에러', () => {
    expect(isQuotaError(429, 'whatever')).toBe(true);
  });
  it('메시지에 quota/rate 포함 시 (상태코드 무관) 할당량 에러', () => {
    expect(isQuotaError(500, "Quota exceeded for quota metric 'Read requests'")).toBe(true);
    expect(isQuotaError(500, 'Rate limit exceeded')).toBe(true);
    expect(isQuotaError(403, 'RESOURCE_EXHAUSTED')).toBe(true);
  });
  it('일반 에러는 할당량 에러 아님', () => {
    expect(isQuotaError(500, 'Sheet not found')).toBe(false);
    expect(isQuotaError(400, 'Range parameter is required')).toBe(false);
    expect(isQuotaError(200, '')).toBe(false);
  });
});

describe('calculateMembershipStats 출석 수', () => {
  const HEADERS = ['번호', '이름', '주횟수', '요일 및 시간', '특이사항', '신규/재등록', '시작날짜', '종료날짜', '결제금액', '결제일', '결제유무', '결제방식', '홀딩 사용여부', '홀딩 시작일', '홀딩 종료일', '핸드폰', '성별', '직업'];
  const makeStudent = (notes) => Object.fromEntries(HEADERS.map((h, i) =>
    [h, ['35', '정순영', '3', '월4수4금4', notes, '재등록', '260803', '260907', '39', '260730', 'O', '계좌', 'X', '', '', '010-0000-0000', '여', '직장인'][i]]
  ));

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 11)); // 2026-08-11
  });
  afterEach(() => vi.useRealTimers());

  // 결석 3일 + 커스텀 공휴일 1일이 종료일을 9/7까지 밀어놓은 상태.
  // 그 4일을 남은회차에서 안 빼면 남은=총=12가 되어 출석이 0으로 바닥친다.
  it('E열 결석일과 커스텀 공휴일은 남은회차에서 제외한다', () => {
    const stats = calculateMembershipStats(
      makeStudent('26.8.14, 26.8.19, 26.8.21 결석'),
      [{ date: '2026-08-17', reason: '광복절 대체 휴일' }]
    );
    expect(stats.totalClasses).toBe(12);
    expect(stats.attendanceCount).toBe(4); // 8/3, 8/5, 8/7, 8/10
  });

  it('결석·휴일 없는 정상 행은 종전대로', () => {
    const student = { ...makeStudent(''), '종료날짜': '260828' }; // 8/3부터 12회차 = 8/28
    expect(calculateMembershipStats(student, []).attendanceCount).toBe(4);
  });
});
