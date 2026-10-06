import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
const { createElement } = React;
import { renderToStaticMarkup } from 'react-dom/server';
import { useScheduleCore } from './useScheduleCore';
import CoachSchedule from './CoachSchedule';
import { PERIODS } from '../../data/mockData';

vi.mock('../../hooks/useWeeklyData', () => ({
    useWeeklyData: () => ({ weekMakeupRequests: [], weekHoldings: [], weekAbsences: [], weekHolidays: [], currentWeekStart: '2026-10-05' }),
}));
vi.mock('../../services/firebaseService', () => ({
    toggleDisabledClass: vi.fn(), toggleLockedSlot: vi.fn(), publishRoster: vi.fn(),
    publishLastClasses: vi.fn(), publishReregX: vi.fn(), cancelWaitlistRequest: vi.fn(),
}));

const students = Array.from({ length: 5 }, (_, i) => ({
    이름: `등록생${i + 1}`, '요일 및 시간': '화2목2', 시작날짜: '260901', 종료날짜: '261031',
}));
const pending = [{ name: '신청자', status: 'pending', requestedSlots: [{ day: '화', period: 2 }, { day: '수', period: 4 }] }];
const period2 = PERIODS.find(p => p.id === 2);
let core;
function Capture({ role = 'coach', mode = 'coach', registrations = pending }) {
    // eslint-disable-next-line react-hooks/globals -- Capture hook output for isolated server-rendered tests.
    core = useScheduleCore({ user: { role }, students, mode, pendingRegistrations: registrations, readOnly: true });
    return null;
}
function renderCoach() {
    return renderToStaticMarkup(createElement(CoachSchedule, {
        ...core, weekWaitlist: [], newStudentWaitlist: [], disabledClasses: [], lockedSlots: [],
    }));
}
beforeEach(() => {
    vi.stubGlobal('React', React);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 6, 9));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('코치 시간표 신규 승인대기 표시', () => {
    it('출석 5명·여석2는 유지하고 승인대기 이름을 별도로 표시한다', () => {
        renderToStaticMarkup(createElement(Capture));
        const cell = core.getCellData('화', period2);
        expect(cell).toMatchObject({ currentCount: 5, availableSeats: 2, pendingNames: ['신청자'] });
        expect(cell.regularStudentsPresent).not.toContain('신청자');
        expect(cell.activeStudents).not.toContain('신청자');
        expect(renderCoach()).toContain('신청자<span class="status-badge"');
        expect(renderCoach().match(/승인대기/g)).toHaveLength(2); // 화2와 수4 모두 표시
    });
    it('승인대기만 있는 칸도 빈 칸으로 숨기지 않는다', () => {
        renderToStaticMarkup(createElement(Capture));
        expect(core.getCellData('수', PERIODS.find(p => p.id === 4))).toMatchObject({ currentCount: 0, pendingNames: ['신청자'] });
        expect(renderCoach().match(/승인대기/g)).toHaveLength(2);
    });
    it('신규 전용 여석에는 계속 승인대기를 포함한다', () => {
        renderToStaticMarkup(createElement(Capture, { mode: 'student' }));
        expect(core.getCellData('화', period2)).toMatchObject({ currentCount: 6, availableSeats: 1, pendingNames: ['신청자'] });
    });
    it('수강생에게는 승인대기 이름을 전달하지 않는다', () => {
        renderToStaticMarkup(createElement(Capture, { role: 'student', mode: 'student' }));
        expect(core.getCellData('화', period2).pendingNames).toEqual([]);
    });
    it('승인되어 pending 목록에서 빠지면 이름표도 사라진다', () => {
        renderToStaticMarkup(createElement(Capture, { registrations: [] }));
        expect(renderCoach()).not.toContain('승인대기');
        expect(core.getCellData('화', period2).pendingNames).toEqual([]);
    });
});
