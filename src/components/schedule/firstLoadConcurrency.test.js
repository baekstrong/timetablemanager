import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ slots: [], cursor: 0, effects: [] }));
vi.mock('react', async original => ({
    ...await original(),
    useState(initial) {
        const index = hooks.cursor++;
        if (!(index in hooks.slots)) hooks.slots[index] = typeof initial === 'function' ? initial() : initial;
        return [hooks.slots[index], next => { hooks.slots[index] = typeof next === 'function' ? next(hooks.slots[index]) : next; }];
    },
    useRef(initial) { const index = hooks.cursor++; return hooks.slots[index] ||= { current: initial }; },
    useMemo: compute => compute(), useCallback: callback => callback,
    useEffect(effect, deps) {
        const index = hooks.cursor++;
        const previous = hooks.slots[index];
        if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
            hooks.effects.push(() => { previous?.cleanup?.(); hooks.slots[index] = { deps, cleanup: effect() }; });
        }
    },
}));
vi.mock('../../services/firebaseService', () => ({
    getActiveMakeupRequests: vi.fn(), getWeekMakeupRequests: vi.fn(), createMakeupRequest: vi.fn(),
    cancelMakeupRequest: vi.fn(), completeMakeupRequest: vi.fn(), getHolidays: vi.fn(),
    createMakeupWaitlist: vi.fn(), getActiveMakeupWaitlists: vi.fn(), updateMakeupWaitlistStatus: vi.fn(),
    acceptMakeupWaitlist: vi.fn(), declineMakeupWaitlist: vi.fn(), keepMakeupWaitlistAfterOriginal: vi.fn(), cancelAbsence: vi.fn(),
}));
vi.mock('../../services/makeupWaitlistService', () => ({ normalizeWaitlistEntry: entry => entry, onSeatFreed: vi.fn(), onSeatsFreedForDates: vi.fn() }));
import StudentSchedule from './StudentSchedule';
import StudentClassView from './StudentClassView';

const nodes = node => Array.isArray(node) ? node.flatMap(nodes) : React.isValidElement(node) ? [node, ...nodes(node.props.children)] : [];
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const serviceNames = ['getActiveMakeupRequests', 'getWeekMakeupRequests', 'createMakeupRequest', 'cancelMakeupRequest', 'completeMakeupRequest', 'getHolidays', 'createMakeupWaitlist', 'getActiveMakeupWaitlists', 'updateMakeupWaitlistStatus', 'acceptMakeupWaitlist', 'declineMakeupWaitlist', 'onSeatFreed', 'processHolidayMakeupEndDate'];
const reads = ['getActiveMakeupRequests', 'getWeekMakeupRequests', 'getActiveMakeupWaitlists'];
function harness() {
    const services = Object.fromEntries(serviceNames.map(name => [name, vi.fn().mockResolvedValue([])]));
    const base = {
        user: { username: '시험 학생', role: 'student' },
        studentData: { 이름: '시험 학생', 시작날짜: '261001', 종료날짜: '261030', '요일 및 시간': '화5목5', 주횟수: '2', '홀딩 사용여부': 'X' },
        weekDates: { 월: '10/12', 화: '10/13', 수: '10/14', 목: '10/15', 금: '10/16' },
        weekAbsences: [], weekWaitlist: [], studentSchedule: [], weeklyDataLoaded: false,
        isMyHoldingDate: () => false, isMakeupHeld: () => false, isClassDisabled: () => false,
        isSlotLocked: () => false, getHolidayInfo: () => null,
        getCellData: () => ({ isFull: false, currentCount: 0, availableSeats: 7 }),
        loadWeeklyData: vi.fn().mockResolvedValue(undefined), refreshStudents: vi.fn().mockResolvedValue(undefined),
        services,
    };
    return { services, render(overrides = {}) {
        hooks.cursor = 0; hooks.effects = [];
        const wrapper = StudentSchedule({ ...base, ...overrides });
        const view = nodes(wrapper.type(wrapper.props)).find(node => node.type === StudentClassView);
        hooks.effects.forEach(effect => effect());
        return view.props;
    } };
}
beforeEach(() => {
    hooks.slots = []; hooks.cursor = 0; hooks.effects = [];
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-14T09:00:00'));
    vi.stubGlobal('React', React); vi.stubGlobal('alert', vi.fn());
    vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
    hooks.slots.forEach(slot => slot?.cleanup?.());
    vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

it('공통 주간 자료가 대기 중일 때 개인 3개 조회를 모두 시작하고 공통 완료 때 중복 조회하지 않는다', async () => {
    const h = harness(); const pending = reads.map(() => deferred());
    reads.forEach((name, index) => h.services[name].mockReturnValueOnce(pending[index].promise));
    expect(h.render().loading).toBe(true);
    reads.forEach(name => expect(h.services[name]).toHaveBeenCalledOnce());
    h.render({ weeklyDataLoaded: true });
    reads.forEach(name => expect(h.services[name]).toHaveBeenCalledOnce());
    pending.forEach(item => item.resolve([])); await vi.advanceTimersByTimeAsync(0);
    expect(h.render({ weeklyDataLoaded: true }).loading).toBe(false);
    h.render({ weeklyDataLoaded: false }); h.render({ weeklyDataLoaded: true });
    reads.forEach(name => expect(h.services[name]).toHaveBeenCalledOnce());
});

it('새로고침은 개인 조회를 다시 시작하고 이전 요청의 늦은 완료로 신청 gate를 열지 않는다', async () => {
    const h = harness(); const first = deferred(); const latest = deferred();
    h.services.getWeekMakeupRequests.mockReturnValueOnce(first.promise).mockReturnValueOnce(latest.promise);
    h.render({ weeklyDataLoaded: true });
    const refreshing = h.render({ weeklyDataLoaded: true, personalRefreshKey: 1 });
    expect(refreshing.requestUnavailableReason).not.toBe('');
    first.resolve([]); await vi.advanceTimersByTimeAsync(0);
    expect(h.render({ weeklyDataLoaded: true, personalRefreshKey: 1 }).loading).toBe(true);
    latest.resolve([]); await vi.advanceTimersByTimeAsync(0);
    expect(h.render({ weeklyDataLoaded: true, personalRefreshKey: 1 }).requestUnavailableReason).toBe('');
    reads.forEach(name => expect(h.services[name]).toHaveBeenCalledTimes(2));
});

it('정상 표시 후 새로고침을 누른 첫 렌더부터 신청이 잠기며 개인 실패는 재시도로 복구한다', async () => {
    const h = harness();
    h.render({ weeklyDataLoaded: true }); await vi.advanceTimersByTimeAsync(0);
    expect(h.render({ weeklyDataLoaded: true }).requestUnavailableReason).toBe('');
    h.services.getWeekMakeupRequests.mockRejectedValueOnce(new Error('offline'));
    const refresh = h.render({ weeklyDataLoaded: true, personalRefreshKey: 1 });
    expect(refresh.requestUnavailableReason).not.toBe('');
    refresh.onMakeup({ date: '2026-10-15', day: '목', period: 5 });
    expect(alert).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    const failed = h.render({ weeklyDataLoaded: true, personalRefreshKey: 1 });
    expect(failed.error).toContain('보강 정보를 불러오지 못했어요');
    await failed.onRetry();
    expect(h.render({ weeklyDataLoaded: true, personalRefreshKey: 1 }).requestUnavailableReason).not.toBe('');
    await vi.advanceTimersByTimeAsync(0);
    expect(h.render({ weeklyDataLoaded: true, personalRefreshKey: 1 }).requestUnavailableReason).toBe('');
    expect(h.services.createMakeupRequest).not.toHaveBeenCalled();
});
