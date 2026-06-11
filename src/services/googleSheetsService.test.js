import { describe, it, expect } from 'vitest';
import { isQuotaError } from './googleSheetsService';

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
