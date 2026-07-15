import { describe, it, expect } from 'vitest';
import { isQuotaError, getHolidayName } from './googleSheetsService';

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
