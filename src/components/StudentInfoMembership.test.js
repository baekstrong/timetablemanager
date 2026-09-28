import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('../services/firebaseService', () => ({ getActiveMakeupRequests: vi.fn(), getHoldingHistory: vi.fn(), getHolidays: vi.fn() }));
vi.mock('../contexts/GoogleSheetsContext', async () => {
    const { calculateMembershipStats, generateAttendanceHistory } = await import('../services/googleSheetsService');
    return { useGoogleSheets: () => ({ calculateMembershipStats, generateAttendanceHistory }) };
});
vi.mock('./PasswordChangeCard', () => ({ default: () => null }));
vi.mock('./ContractHistory', () => ({ default: () => null }));
import StudentInfo from './StudentInfo';

beforeEach(() => { vi.stubGlobal('React', React); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 8, 27)); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('내 정보의 기간·남은회차·홀딩·통계가 모두 동일한 두 달 합계를 표시한다', () => {
    const first = { 이름: '통합표시회원', 시작날짜: '260928', 종료날짜: '261026', 주횟수: '2', '요일 및 시간': '월4수5', '홀딩 사용여부': 'X' };
    const html = renderToStaticMarkup(React.createElement(StudentInfo, { user: { username: first.이름 }, studentData: { ...first, _nextRegistration: { ...first, 시작날짜: '261028', 종료날짜: '261123' } }, readOnly: true }));
    expect(html).toContain('2026-09-28');
    expect(html).toContain('2026-11-23');
    expect(html).not.toContain('2026-10-26');
    expect(html).toContain('16회 남음');
    expect(html).toContain('2회 남음');
    expect(html).toContain('(2개월 등록)');
    expect(html).toMatch(/stat-value">16<\/div><div class="stat-label">총 수업/);
    expect(html).toMatch(/stat-value">0<\/div><div class="stat-label">출석/);
});
