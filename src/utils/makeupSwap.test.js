import { describe, it, expect } from 'vitest';
import { isSwapOpen, isSwapRequest, swapBoardEntries, findMutualSwap, mySessionForSwap, buildSwapMakeups } from './makeupSwap';

// 이번 주 11/16(월)~11/20(금), 지금은 월요일 08:00 (가상 인물)
const NOW = new Date('2099-11-16T08:00:00');
const WEEK = { weekStart: '2099-11-16', weekEnd: '2099-11-20', now: NOW };
const cls = (date, day, period) => ({ date, day, period, periodName: `${period}교시` });
const wait = (id, name, original, target, extra = {}) => ({
    id, studentName: name, status: 'waiting', createdAtMs: Number(id.replace(/\D/g, '')) || 0,
    ...target, originalClass: original, ...extra,
});
const 화5 = cls('2099-11-17', '화', 5);
const 목4 = cls('2099-11-19', '목', 4);
const 수4 = cls('2099-11-18', '수', 4);

describe('isSwapOpen (두 수업 모두 2시간 전 마감)', () => {
    it('두 수업 모두 2시간 넘게 남았으면 열려 있다', () => {
        expect(isSwapOpen(wait('w1', '가상A', 화5, 목4), NOW)).toBe(true);
    });
    it('원래 수업이 2시간 안이면 닫힌다', () => {
        const soon = cls('2099-11-16', '월', 1); // 10:00 시작, 지금 08:00 → 정확히 2시간
        expect(isSwapOpen(wait('w1', '가상A', soon, 목4), NOW)).toBe(false);
    });
    it('원하는 칸이 2시간 안이면 닫힌다', () => {
        expect(isSwapOpen(wait('w1', '가상A', 화5, cls('2099-11-16', '월', 1)), NOW)).toBe(false);
    });
});

describe('isSwapRequest / swapBoardEntries', () => {
    it('자리 안내를 받은 대기·대기 유지 대기는 현황판에서 뺀다', () => {
        expect(isSwapRequest(wait('w1', '가상A', 화5, 목4, { status: 'notified', notifiedAtMs: NOW.getTime() }), NOW)).toBe(false);
        expect(isSwapRequest(wait('w1', '가상A', 화5, 목4, { keepAfterOriginal: true }), NOW)).toBe(false);
    });
    it('이번 주 요청만 오래된 순으로 보여준다', () => {
        const list = swapBoardEntries([
            wait('w3', '가상C', 수4, 목4),
            wait('w1', '가상A', 화5, 목4),
            wait('w2', '가상B', 화5, cls('2099-11-24', '화', 5)),
            wait('w4', '가상D', 화5, 목4, { status: 'cancelled' }),
        ], WEEK);
        expect(list.map(e => e.id)).toEqual(['w1', 'w3']);
    });
});

describe('findMutualSwap (자동 맞교환)', () => {
    it('서로 상대 칸을 원하면 짝을 찾는다', () => {
        const a = wait('w2', '가상A', 화5, 목4);
        const b = wait('w1', '가상B', 목4, 화5);
        expect(findMutualSwap(a, [a, b], NOW)?.id).toBe('w1');
    });
    it('한쪽만 원하면 짝이 아니다', () => {
        const a = wait('w2', '가상A', 화5, 목4);
        const b = wait('w1', '가상B', 목4, 수4);
        expect(findMutualSwap(a, [a, b], NOW)).toBeNull();
    });
    it('같은 사람끼리는 짝짓지 않고, 교시는 숫자·문자 차이를 무시한다', () => {
        const a = wait('w2', '가상A', 화5, 목4);
        expect(findMutualSwap(a, [a, wait('w1', '가상A', 목4, 화5)], NOW)).toBeNull();
        const b = wait('w1', '가상B', { ...목4, period: '4' }, 화5);
        expect(findMutualSwap(a, [a, b], NOW)?.id).toBe('w1');
    });
    it('여러 짝이 있으면 먼저 건 사람', () => {
        const a = wait('w9', '가상A', 화5, 목4);
        const late = wait('w5', '가상C', 목4, 화5);
        const early = wait('w3', '가상B', 목4, 화5);
        expect(findMutualSwap(a, [a, late, early], NOW)?.id).toBe('w3');
    });
});

describe('mySessionForSwap / buildSwapMakeups', () => {
    it('요청자가 원하는 칸에 있는 내 정규 수업만 내줄 수 있다', () => {
        const entry = wait('w1', '가상A', 화5, 목4);
        expect(mySessionForSwap(entry, [{ ...목4, type: 'regular' }])).toBeTruthy();
        expect(mySessionForSwap(entry, [{ ...목4, type: 'makeup' }])).toBeNull();
        expect(mySessionForSwap(entry, [{ ...수4, type: 'regular' }])).toBeNull();
    });
    it('요청자는 X→Y, 받아준 사람은 Y→X 보강이 된다', () => {
        const { requester, partner } = buildSwapMakeups(wait('w1', '가상A', 화5, 목4), '가상B');
        expect(requester).toMatchObject({ studentName: '가상A', originalClass: 화5, makeupClass: 목4, swapWith: '가상B' });
        expect(partner).toMatchObject({ studentName: '가상B', originalClass: 목4, makeupClass: 화5, swapWith: '가상A' });
    });
});
