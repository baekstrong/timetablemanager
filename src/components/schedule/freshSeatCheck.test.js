import { beforeEach, expect, it, vi } from 'vitest';

// 2026-11-03 화5 8명 사례: 화면을 오래 열어 둔 사이 자리가 차도 저장 직전 최신 기록으로 만석을 잡아야 한다.
vi.mock('react', async original => ({
    ...await original(),
    useMemo: compute => compute(),
    useCallback: callback => callback,
}));
const weekly = vi.hoisted(() => ({ value: null }));
vi.mock('../../hooks/useWeeklyData', () => ({ useWeeklyData: () => weekly.value }));
const fb = vi.hoisted(() => ({ getMakeupRequestsByWeek: vi.fn(), getAbsencesByDate: vi.fn() }));
vi.mock('../../services/firebaseService', () => fb);
import { useScheduleCore } from './useScheduleCore';

const TUE = '2026-11-03';
const slot = { date: TUE, day: '화', period: 5, periodName: '5교시' };
const makeup = (studentName, status = 'active') => ({
    studentName, status,
    originalClass: { date: '2026-11-02', day: '월', period: 4, periodName: '4교시' },
    makeupClass: { ...slot },
});
const student = name => ({ 이름: name, 주횟수: '2', '요일 및 시간': '화5목5', 시작날짜: '261020', 종료날짜: '261130', '홀딩 사용여부': 'X', '신규/재등록': '재등록' });

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-02T15:00:00'));
    // 화면을 연 시점: 정규 5명 + 보강 1명 = 6명 (1자리)
    weekly.value = {
        weekMakeupRequests: [makeup('송제엽')], weekHoldings: [], weekAbsences: [], weekHolidays: [],
        currentWeekStart: '2026-11-02', weeklyDataLoaded: true,
    };
    fb.getMakeupRequestsByWeek.mockReset();
    fb.getAbsencesByDate.mockReset().mockResolvedValue([]);
});

function core() {
    return useScheduleCore({
        user: { username: '정순영', role: 'student' }, mode: 'student',
        students: ['주영은', '이영미', '이정은', '이슬아', '정성훈'].map(student),
        studentData: null, refresh: vi.fn(),
    });
}

it('화면은 1자리로 보여도 서버에서 그 사이 찬 자리를 만석으로 판정한다', async () => {
    const c = core();
    const periodObj = { id: 5 };
    expect(c.getCellData('화', periodObj).currentCount).toBe(6);
    fb.getMakeupRequestsByWeek.mockResolvedValue([makeup('송제엽'), makeup('한익수')]);
    const fresh = await c.getFreshCellData(slot);
    expect(fb.getMakeupRequestsByWeek).toHaveBeenCalledWith(TUE, TUE);
    expect(fresh.currentCount).toBe(7);
    expect(fresh.isFull).toBe(true);
});

it('최신 기록에 자리가 남아 있으면 통과한다 (결석으로 빈 자리도 반영)', async () => {
    fb.getMakeupRequestsByWeek.mockResolvedValue([makeup('송제엽'), makeup('한익수')]);
    fb.getAbsencesByDate.mockResolvedValue([{ studentName: '이영미', date: TUE, status: 'active' }]);
    const fresh = await core().getFreshCellData(slot);
    expect(fresh.currentCount).toBe(6);
    expect(fresh.isFull).toBe(false);
});

it('조회 실패는 빈자리로 보지 않고 호출자에게 던진다', async () => {
    fb.getMakeupRequestsByWeek.mockRejectedValue(new Error('unavailable'));
    await expect(core().getFreshCellData(slot)).rejects.toThrow('unavailable');
});

it('이번 주 화면 밖 날짜는 판단하지 않는다', async () => {
    expect(await core().getFreshCellData({ ...slot, date: '2026-11-10' })).toBeNull();
    expect(fb.getMakeupRequestsByWeek).not.toHaveBeenCalled();
});
