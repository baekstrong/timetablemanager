import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({ states: [], cursor: 0, weekly: {}, sheets: {} }));
vi.mock('react', async original => ({
    ...await original(),
    useState: initial => {
        const index = harness.cursor++;
        const value = index < harness.states.length ? harness.states[index] : typeof initial === 'function' ? initial() : initial;
        return [value, vi.fn(next => { harness.states[index] = typeof next === 'function' ? next(value) : next; })];
    },
    useMemo: compute => compute(), useCallback: callback => callback,
    useEffect: () => {}, useRef: value => ({ current: value }),
}));
vi.mock('react-dom', async original => ({ ...await original(), createPortal: node => node }));
vi.mock('../../hooks/useWeeklyData', () => ({ useWeeklyData: () => harness.weekly }));
vi.mock('../../contexts/GoogleSheetsContext', () => ({ useGoogleSheets: () => harness.sheets }));
vi.mock('../../services/firebaseService', () => ({
    getActiveMakeupRequests: vi.fn(), getWeekMakeupRequests: vi.fn(), createMakeupRequest: vi.fn(),
    cancelMakeupRequest: vi.fn(), completeMakeupRequest: vi.fn(), getHolidays: vi.fn(),
    createMakeupWaitlist: vi.fn(), getActiveMakeupWaitlists: vi.fn(), updateMakeupWaitlistStatus: vi.fn(),
    acceptMakeupWaitlist: vi.fn(), declineMakeupWaitlist: vi.fn(), getDisabledClasses: vi.fn(),
    getLockedSlots: vi.fn(), getNewStudentRegistrations: vi.fn(), createWaitlistRequest: vi.fn(),
    cancelWaitlistRequest: vi.fn(), checkWaitlistAvailability: vi.fn(), updateWaitlistAvailability: vi.fn(),
    removeFreeWorkout: vi.fn(), addFreeWorkoutRosterMember: vi.fn(), removeFreeWorkoutRosterMember: vi.fn(),
}));
vi.mock('../../services/makeupWaitlistService', () => ({
    normalizeWaitlistEntry: entry => entry, onSeatFreed: vi.fn(), syncMakeupWaitlists: vi.fn(),
}));
vi.mock('../../features/today/CoachHome', () => ({ default: () => null }));
vi.mock('./FreeWorkoutModal', () => ({ default: () => null }));

import { MOCK_DATA } from '../../data/mockData';
import { useScheduleCore } from './useScheduleCore';
import StudentSchedule from './StudentSchedule';
import StudentClassView from './StudentClassView';
import ReviewModal from '../../features/today/ReviewModal';
import WeeklySchedule from '../WeeklySchedule';

const student = { 이름: '검토 수강생', 시작날짜: '260901', 종료날짜: '260930', '요일 및 시간': '화5목5', 주횟수: '2', '홀딩 사용여부': 'X' };
const user = { username: student.이름, role: 'student' };
const original = { date: '2026-09-17', day: '목', period: 5, periodName: '5교시' };
const target = { date: '2026-09-18', day: '금', period: 4, periodName: '4교시' };
const weekDates = { 월: '9/14', 화: '9/15', 수: '9/16', 목: '9/17', 금: '9/18' };
const elements = node => Array.isArray(node) ? node.flatMap(elements)
    : React.isValidElement(node) ? [node, ...elements(node.props.children)] : [];
const textOf = node => Array.isArray(node) ? node.map(textOf).join('')
    : React.isValidElement(node) ? textOf(node.props.children) : typeof node === 'string' ? node : '';
const serviceNames = ['getActiveMakeupRequests', 'getWeekMakeupRequests', 'createMakeupRequest', 'cancelMakeupRequest', 'completeMakeupRequest', 'getHolidays', 'createMakeupWaitlist', 'getActiveMakeupWaitlists', 'updateMakeupWaitlistStatus', 'acceptMakeupWaitlist', 'declineMakeupWaitlist', 'onSeatFreed', 'processHolidayMakeupEndDate'];
const renderStudent = ({ waiting = false, respondingWaitlist = null, ...overrides } = {}) => {
    harness.cursor = 0;
    harness.states = [new Date(), 'all', 0, 'loaded', 'confirm', target, waiting, false, target, original, [], false, null, [], false, target, original, respondingWaitlist, false];
    const services = Object.fromEntries(serviceNames.map(name => [name, vi.fn().mockResolvedValue(name === 'processHolidayMakeupEndDate' ? { updated: false } : [])]));
    const props = {
        user, studentData: student, weekDates, weekAbsences: [], weekWaitlist: [],
        studentSchedule: [{ day: '화', period: 5 }, { day: '목', period: 5 }],
        isMyHoldingDate: () => false, isMakeupHeld: () => false,
        isClassDisabled: () => false, isSlotLocked: () => false, getHolidayInfo: () => null,
        getCellData: () => ({ isFull: false, currentCount: 0, availableSeats: 7 }),
        loadWeeklyData: vi.fn().mockResolvedValue(undefined), refreshStudents: vi.fn().mockResolvedValue(undefined),
        weeklyDataLoaded: true, services, ...overrides,
    };
    const wrapper = StudentSchedule(props);
    return { nodes: elements(wrapper.type(wrapper.props)), services, props };
};

const lastDayStudent = { ...student, 종료날짜: '261008' };
const renderCourseNotice = overrides => {
    const { nodes } = renderStudent({ studentData: lastDayStudent, now: new Date('2026-10-08T12:00:00'), ...overrides });
    const view = nodes.find(node => node.type === StudentClassView);
    return renderToStaticMarkup(React.createElement(StudentClassView, view.props));
};

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-16T09:00:00'));
    vi.stubGlobal('React', React);
    vi.stubGlobal('document', { body: {} });
    vi.stubGlobal('alert', vi.fn());
    vi.stubGlobal('confirm', vi.fn(() => true));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    harness.cursor = 0;
    harness.states = [];
    harness.weekly = {
        weekMakeupRequests: [], weekHoldings: [], weekAbsences: [], weekHolidays: [], weekWaitlist: [],
        weekFreeWorkout: [], freeWorkoutRoster: [], currentWeekStart: '2026-09-14',
        weeklyDataLoaded: true, weeklyDataError: '', loadWeeklyData: vi.fn().mockResolvedValue(undefined),
    };
    harness.sheets = { students: [student], isAuthenticated: true, isConnected: true, error: null, loading: false, refresh: vi.fn().mockResolvedValue(undefined) };
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('수강생 첫 화면의 종료 안내', () => {
    it.each(['mine', 'all'])('종료일 당일에는 어느 탭에서도 마지막 수업 팝업을 표시한다 (%s)', tab => {
        const { nodes } = renderStudent({ studentData: lastDayStudent, now: new Date('2026-10-08T23:59:59') });
        const view = nodes.find(node => node.type === StudentClassView);
        const html = renderToStaticMarkup(React.createElement(StudentClassView, { ...view.props, tab }));
        expect(html).toContain('오늘은 마지막 수업일입니다');
        expect(html).not.toContain('수강 기간이 만료되었습니다');
        expect(html).toContain('<dialog');
        expect(html).toContain('>확인</button>');
    });

    it('다음날 0시부터 만료 안내와 코치 문의 문구를 표시한다', () => {
        const html = renderCourseNotice({ now: new Date('2026-10-09T00:00:00') });
        expect(html).toContain('수강 기간이 만료되었습니다');
        expect(html).toContain('재등록을 원하시면 코치에게 문의해주세요.');
        expect(html).toContain('<dialog');
        expect(html).not.toContain('오늘은 마지막 수업일입니다');
    });

    it.each([
        { studentData: { ...student, 종료날짜: '261030' } },
        { studentData: { ...student, 종료날짜: '' } },
        { studentData: null },
        { weeklyDataLoaded: false },
        { weeklyDataError: '명단 조회 실패' },
    ])('기간이 남았거나 확실한 자료가 없으면 종료 안내를 표시하지 않는다: %j', overrides => {
        expect(renderCourseNotice(overrides)).not.toContain('<dialog');
    });

    it('미리 재등록한 기간의 최종 종료일까지 안내를 미룬다', () => {
        const data = { ...lastDayStudent, _nextRegistration: { ...student, 시작날짜: '261013', 종료날짜: '261105' } };
        expect(renderCourseNotice({ studentData: data })).not.toContain('<dialog');
        expect(renderCourseNotice({ studentData: data, now: new Date('2026-11-05T12:00:00') })).toContain('오늘은 마지막 수업일입니다');
    });

    it('확인한 화면에서는 탭/시각 갱신에 다시 뜨지 않고 첫 화면 재진입 시 다시 뜬다', () => {
        const { nodes } = renderStudent({ studentData: lastDayStudent, now: new Date('2026-10-08T12:00:00') });
        const props = nodes.find(node => node.type === StudentClassView).props;
        harness.states = [];
        const render = overrides => {
            harness.cursor = 0;
            return elements(StudentClassView({ ...props, ...overrides }));
        };
        const modal = render().find(node => node.type === ReviewModal);
        const confirm = elements(modal).find(node => node.type === 'button' && textOf(node) === '확인');
        confirm.props.onClick();
        expect(render({ tab: 'mine', now: new Date('2026-10-08T12:01:00') }).some(node => node.type === ReviewModal)).toBe(false);
        harness.states = [];
        expect(render().some(node => node.type === ReviewModal)).toBe(true);
        render().find(node => node.type === ReviewModal).props.onClose();
        expect(render().some(node => node.type === ReviewModal)).toBe(false);
        expect(render({ now: new Date('2026-10-09T00:00:00') }).find(node => node.type === ReviewModal).props.title).toBe('수강 기간이 만료되었습니다');
    });

    it('마지막 수업을 보강으로 옮기면 반영된 종료일에 맞춰 안내한다', () => {
        harness.weekly.weekMakeupRequests = [{ studentName: student.이름, status: 'active', originalClass: { date: '2026-10-08' }, makeupClass: { date: '2026-10-09' } }];
        const { getEffectiveEndDate } = useScheduleCore({ user, students: [lastDayStudent], mode: 'student', studentData: lastDayStudent });
        expect(renderCourseNotice({ getEffectiveEndDate })).not.toContain('<dialog');
        expect(renderCourseNotice({ getEffectiveEndDate, now: new Date('2026-10-09T12:00:00') })).toContain('오늘은 마지막 수업일입니다');
        expect(renderCourseNotice({ getEffectiveEndDate, now: new Date('2026-10-10T00:00:00') })).toContain('수강 기간이 만료되었습니다');
    });
});

describe('학생 명단이 없을 때 예시 시간표를 사용하지 않는다', () => {
    it('학생은 빈 실제 자료를 반환하고 기존 코치·강제 모드만 예시 표시를 유지한다', () => {
        const props = { user, students: [], mode: 'student', studentData: student };
        const studentCore = useScheduleCore(props);
        expect(studentCore.scheduleData.regularEnrollments).toEqual([]);
        expect(studentCore.getCellData('금', { id: 4 }).currentCount).toBe(0);
        expect(useScheduleCore({ ...props, user: { role: 'coach' }, mode: 'coach' }).scheduleData).toBe(MOCK_DATA);
        expect(useScheduleCore({ ...props, mode: 'studentForce' }).scheduleData).toBe(MOCK_DATA);
        expect(useScheduleCore({ ...props, user: { role: 'coach' }, readOnly: true }).scheduleData.regularEnrollments).toEqual([]);
    });

    it.each([
        { students: [], error: null },
        { students: [student], error: '조회 실패' },
    ])('전체 명단 미확보/오류를 실제 WeeklySchedule에서 학생 화면에 전달한다: %j', state => {
        harness.sheets = { ...harness.sheets, ...state };
        const nodes = elements(WeeklySchedule({ user, studentData: student }));
        const schedule = nodes.find(node => node.type === StudentSchedule);
        expect(schedule.props.weeklyDataLoaded).toBe(false);
        expect(schedule.props.weeklyDataError).toContain('명단');
    });

    it('정상 조회된 학생 경로는 실제 여석과 신청을 그대로 허용한다', () => {
        const nodes = elements(WeeklySchedule({ user, studentData: student }));
        const schedule = nodes.find(node => node.type === StudentSchedule);
        expect(schedule.props.weeklyDataLoaded).toBe(true);
        expect(schedule.props.weeklyDataError).toBe('');
    });
});

describe('확인창을 연 뒤 발생한 조회 실패', () => {
    it.each([false, true])('보강/대기 확정 버튼과 핸들러 모두 저장을 막는다 (대기=%s)', async waiting => {
        const { nodes, services } = renderStudent({ waiting, weeklyDataError: '명단 조회 실패', weeklyDataLoaded: false });
        const view = nodes.find(node => node.type === StudentClassView);
        expect(view.props.error).toBe('명단 조회 실패');
        const submit = nodes.find(node => node.type === 'button' && textOf(node) === (waiting ? '대기 신청' : '보강 확정'));
        expect(submit.props.disabled).toBe(true);
        await submit.props.onClick();
        serviceNames.forEach(name => expect(services[name]).not.toHaveBeenCalled());
        expect(alert).toHaveBeenCalledWith('명단 조회 실패');
    });

    it('자료를 다시 읽는 동안에도 이전 확인창을 확정할 수 없다', async () => {
        const { nodes, services } = renderStudent({ weeklyDataLoaded: false });
        const submit = nodes.find(node => node.type === 'button' && textOf(node) === '보강 확정');
        expect(submit.props.disabled).toBe(true);
        await submit.props.onClick();
        expect(services.createMakeupRequest).not.toHaveBeenCalled();
    });

    it('다시 불러오기는 주간 자료와 전체 명단을 함께 갱신한다', async () => {
        const { nodes, props } = renderStudent({ weeklyDataError: '명단 조회 실패' });
        await nodes.find(node => node.type === StudentClassView).props.onRetry();
        expect(props.loadWeeklyData).toHaveBeenCalledOnce();
        expect(props.refreshStudents).toHaveBeenCalledOnce();
    });

    it('명단이 실패하면 기존 보강 취소와 도착한 자리 수락도 잘못된 여석으로 처리하지 않는다', async () => {
        const offer = { ...target, id: 'offer', status: 'notified', originalClass: original, notifiedAtMs: Date.now() };
        const { nodes, services } = renderStudent({ weeklyDataError: '명단 조회 실패', respondingWaitlist: offer });
        const view = nodes.find(node => node.type === StudentClassView);
        await view.props.onCancelMakeup('makeup');
        await view.props.onWaitlist({ id: 'waiting', status: 'waiting' });
        for (const label of ['자리 수락', '이번에는 거절']) {
            const action = nodes.find(node => node.type === 'button' && textOf(node) === label);
            expect(action.props.disabled).toBe(true);
            await action.props.onClick();
        }
        serviceNames.forEach(name => expect(services[name]).not.toHaveBeenCalled());
    });

    it.each([false, true])('정상 자료가 있으면 기존 보강/대기 신청이 실행된다 (대기=%s)', async waiting => {
        const { nodes, services } = renderStudent({ waiting });
        const submit = nodes.find(node => node.type === 'button' && textOf(node) === (waiting ? '대기 신청' : '보강 확정'));
        expect(submit.props.disabled).toBe(false);
        await submit.props.onClick();
        expect(services[waiting ? 'createMakeupWaitlist' : 'createMakeupRequest']).toHaveBeenCalledOnce();
    });
});
