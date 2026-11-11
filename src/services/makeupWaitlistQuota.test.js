import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('./firebaseService', () => ({
    getActiveMakeupWaitlists: vi.fn(),
    getWeekMakeupRequests: vi.fn(),
    getMakeupWaitlistsByStudent: vi.fn(),
    notifyMakeupWaitlist: vi.fn(),
    updateMakeupWaitlistStatus: vi.fn(),
}));
vi.mock('./smsService', () => ({ requestMakeupSeatSMS: vi.fn() }));
vi.mock('./pushService', () => ({ pushMakeupSeat: vi.fn() }));
import { getWeekMakeupRequests, notifyMakeupWaitlist, updateMakeupWaitlistStatus } from './firebaseService';
import { pushMakeupSeat } from './pushService';
import { onSeatFreed, pickNotifiable } from './makeupWaitlistService';

// 대기는 성공해야 1회 (2026-11-11): 자리 안내 직전에 남은 보강 횟수를 확인한다.
const DATE = '2099-11-18';
const wait = (id, name, createdAtMs, extra = {}) => ({
    id, studentName: name, date: DATE, day: '수', period: 4, periodName: '4교시', status: 'waiting', createdAtMs,
    originalClass: { date: '2099-11-19', day: '목', period: 5, periodName: '5교시' }, weeklyLimit: 2, ...extra,
});

beforeEach(() => {
    vi.resetAllMocks();
    pushMakeupSeat.mockResolvedValue(true);
    notifyMakeupWaitlist.mockResolvedValue();
    updateMakeupWaitlistStatus.mockResolvedValue();
});

describe('자리 안내 직전 남은 횟수 확인', () => {
    it('1순위가 횟수를 다 썼으면 그 대기를 취소하고 2순위에게 안내한다', async () => {
        getWeekMakeupRequests.mockImplementation(async name => (name === '가상A' ? [{ status: 'active' }, { status: 'cancelled' }] : []));
        const entries = [wait('w1', '가상A', 1), wait('w2', '가상B', 2)];
        expect(await onSeatFreed(DATE, '수', 4, null, entries)).toBe(1);
        expect(updateMakeupWaitlistStatus).toHaveBeenCalledWith('w1', 'cancelled');
        expect(notifyMakeupWaitlist).toHaveBeenCalledWith('w2');
        expect(notifyMakeupWaitlist).not.toHaveBeenCalledWith('w1');
    });

    it('남은 횟수가 있으면 1순위에게 그대로 안내한다', async () => {
        getWeekMakeupRequests.mockResolvedValue([{ status: 'active' }]);
        const entries = [wait('w1', '가상A', 1), wait('w2', '가상B', 2)];
        expect(await onSeatFreed(DATE, '수', 4, null, entries)).toBe(1);
        expect(notifyMakeupWaitlist).toHaveBeenCalledWith('w1');
        expect(updateMakeupWaitlistStatus).not.toHaveBeenCalled();
    });

    it('한도가 없는 예전 대기는 조회 없이 안내한다', async () => {
        const entries = [wait('w1', '가상A', 1, { weeklyLimit: undefined })];
        expect(await onSeatFreed(DATE, '수', 4, null, entries)).toBe(1);
        expect(getWeekMakeupRequests).not.toHaveBeenCalled();
        expect(notifyMakeupWaitlist).toHaveBeenCalledWith('w1');
    });

    it('안내할 자리가 없으면 아무도 조회하지 않는다', async () => {
        const check = vi.fn();
        expect(await pickNotifiable([], [wait('w1', '가상A', 1)], check)).toEqual({ chosen: [], exhausted: [] });
        expect(check).not.toHaveBeenCalled();
    });
});
