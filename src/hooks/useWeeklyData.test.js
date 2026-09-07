import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { getStudentField, parseHoldingStatus } from '../services/googleSheetsService';
import { parseSheetDate, formatDateISO, isClassWithinMinutes } from '../utils/scheduleUtils';

// 훅의 상태/의존성 수명만 제공하고 실제 useWeeklyData 본문을 실행한다.
// 이 저장소는 node 테스트 환경이며 DOM/운영 Firebase를 사용하지 않는다.
function harness() {
    const slots = [];
    let cursor = 0;
    let effects = [];
    const memo = (fn, deps) => {
        const i = cursor++;
        if (!slots[i] || deps.some((d, n) => !Object.is(d, slots[i].deps[n]))) {
            slots[i] = { deps, value: fn() };
        }
        return slots[i].value;
    };
    const calls = {};
    const names = ['getMakeupRequestsByWeek', 'getAbsencesByDate', 'getHolidays', 'getAllActiveWaitlist',
        'getHoldingsByWeek', 'getFreeWorkoutByDateRange', 'getFreeWorkoutRoster', 'completeMakeupRequest'];
    names.forEach(name => { calls[name] = vi.fn(async () => []); });
    const ctx = vm.createContext({ ...calls, Date, getStudentField, parseHoldingStatus, parseSheetDate,
        formatDateISO, isClassWithinMinutes, console: { error() {} }, window: { setTimeout, clearTimeout },
        useState(initial) {
            const i = cursor++;
            if (!(i in slots)) slots[i] = initial;
            return [slots[i], value => { slots[i] = value; }];
        },
        useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
        useMemo: memo,
        useCallback: (fn, deps) => memo(() => fn, deps),
        useEffect(fn, deps) {
            const i = cursor++;
            if (!slots[i] || deps.some((d, n) => !Object.is(d, slots[i].deps[n]))) {
                const old = slots[i];
                effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; });
            }
        },
    });
    const source = readFileSync(new URL('./useWeeklyData.js', import.meta.url), 'utf8');
    vm.runInContext(source.slice(source.indexOf('export function useWeeklyData')).replace('export ', ''), ctx);
    return { calls, render(students = []) {
        cursor = 0; effects = []; ctx.props = { students, mode: 'coach' };
        const result = vm.runInContext('useWeeklyData(props)', ctx);
        effects.forEach(fn => fn());
        return result;
    } };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 8, 7, 9)); });
afterEach(() => vi.useRealTimers());

it('시트 refresh 이후 자동 Firebase 재조회 없이 최신 홀딩을 계산한다', async () => {
    const h = harness();
    h.render();
    await vi.runAllTimersAsync();
    const student = { 이름: 'A', '홀딩 사용여부': 'O', '홀딩 시작일': '260907', '홀딩 종료일': '260909' };
    let view = h.render([student]);
    expect(view.weekHoldings[0].studentName).toBe('A');
    await view.loadWeeklyData(); // 수동 refresh 핸들러의 주간 갱신 1회
    view = h.render([{ ...student }]);
    await vi.runAllTimersAsync();
    expect(h.calls.getMakeupRequestsByWeek).toHaveBeenCalledTimes(2); // 초기 + 수동
    expect(h.calls.getAbsencesByDate).toHaveBeenCalledTimes(10);
    expect(view.weeklyDataLoaded).toBe(true);
});

it('실패한 갱신은 마지막 정상 데이터를 보존하고 백스톱 게이트를 닫는다', async () => {
    const h = harness();
    h.calls.getFreeWorkoutRoster.mockResolvedValue([{ studentName: 'A' }]);
    h.render(); await vi.runAllTimersAsync();
    const view = h.render();
    h.calls.getAbsencesByDate.mockRejectedValue(new Error('unavailable'));
    await expect(view.loadWeeklyData()).rejects.toThrow('unavailable');
    const after = h.render();
    expect(after.freeWorkoutRoster).toEqual([{ studentName: 'A' }]);
    expect(after.weeklyDataLoaded).toBe(false);
});

it('오래된 주간 응답이 최신 결과를 덮어쓰지 않는다', async () => {
    const h = harness();
    h.render(); await vi.runAllTimersAsync();
    const view = h.render();
    let finishOld;
    h.calls.getFreeWorkoutRoster.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }))
        .mockResolvedValue([{ studentName: 'new' }]);
    const first = view.loadWeeklyData();
    await view.loadWeeklyData();
    finishOld([{ studentName: 'old' }]); await first;
    expect(h.render().freeWorkoutRoster).toEqual([{ studentName: 'new' }]);
});
