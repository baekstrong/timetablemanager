import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/firebaseService', () => ({
    getActiveMakeupRequests: vi.fn(), getHoldingHistory: vi.fn(), getHolidays: vi.fn(),
}));
vi.mock('../contexts/GoogleSheetsContext', () => ({
    useGoogleSheets: () => ({
        calculateMembershipStats: () => ({ studentName: '검토 수강생', weeklyFrequency: 2, startDate: '2026-09-01', endDate: '2026-09-30', totalSessions: 8, remainingSessions: 7, totalHolding: 1, registrationMonths: 1, attendanceCount: 1, totalClasses: 8 }),
        generateAttendanceHistory: () => [],
    }),
}));
vi.mock('../components/PasswordChangeCard', () => ({ default: () => 'PASSWORD_CHANGE_CONTROL' }));
vi.mock('../components/ContractHistory', () => ({ default: () => 'CONTRACT_HISTORY_CONTROL' }));

import StudentInfo from '../components/StudentInfo';

describe('실데이터 내 정보의 조회 전용 제어', () => {
    afterEach(() => vi.unstubAllGlobals());
    const render = readOnly => {
        vi.stubGlobal('React', React);
        return renderToStaticMarkup(React.createElement(StudentInfo, {
            user: { username: '검토 수강생', role: 'student' }, studentData: {}, readOnly,
            onLogout: () => {}, onNavigate: () => {}, hasPendingContract: true,
        }));
    };

    it('수강 정보는 유지하고 로그아웃·비밀번호·계약 이동을 노출하지 않는다', () => {
        const html = render(true);
        expect(html).toContain('검토 수강생');
        expect(html).toContain('2026-09-30');
        expect(html).toContain('7회');
        expect(html).not.toContain('로그아웃');
        expect(html).not.toContain('PASSWORD_CHANGE_CONTROL');
        expect(html).not.toContain('재등록 계약서 확인');
        expect(html).not.toContain('CONTRACT_HISTORY_CONTROL');
        expect(html).toMatch(/<button[^>]*disabled=""[^>]*>계약 이력 · 조회 전용 화면에서 제외<\/button>/);
    });

    it('일반 앱에서는 기존 계정 관리·계약 버튼을 유지한다', () => {
        const html = render(false);
        expect(html).toContain('로그아웃');
        expect(html).toContain('PASSWORD_CHANGE_CONTROL');
        expect(html).toContain('재등록 계약서 확인');
        expect(html).toContain('계약 이력 보기');
        expect(html).not.toContain('조회 전용 화면에서 제외');
    });
});
