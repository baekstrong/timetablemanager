import { describe, it, expect } from 'vitest';
import {
    getNotificationDeadline,
    isNotificationExpired,
    canStillNotify,
    findWaitlistsReleasedByHolding,
    isOriginalClassStarted,
    isLiveWaitlist,
    isReleasedByOriginalStart,
    canKeepAfterOriginal,
    canConvertWaitToMakeup,
    resolveAfterSeatFreed,
    resolveToTarget,
} from './makeupWaitlist';

// 5교시 = 19:50 시작 (mockData PERIODS 기준)
const SLOT = { date: '2026-06-19', day: '금', period: 5 };
const classStart = new Date('2026-06-19T19:50:00');

function entry(over = {}) {
    return {
        id: 'w1', studentName: '김대기', phone: '01000000000',
        ...SLOT, periodName: '5교시',
        originalClass: { date: '2026-06-22', day: '월', period: 5, periodName: '5교시' },
        status: 'waiting', createdAtMs: 1000, notifiedAtMs: null,
        ...over,
    };
}

describe('getNotificationDeadline / isNotificationExpired', () => {
    it('마감 = notifiedAt + 1시간 (수업 시작이 더 늦을 때)', () => {
        const notifiedAt = new Date('2026-06-19T10:00:00').getTime();
        const e = entry({ status: 'notified', notifiedAtMs: notifiedAt });
        expect(getNotificationDeadline(e).getTime()).toBe(notifiedAt + 60 * 60 * 1000);
        expect(isNotificationExpired(e, new Date('2026-06-19T10:59:00'))).toBe(false);
        expect(isNotificationExpired(e, new Date('2026-06-19T11:00:00'))).toBe(true);
    });
    it('수업 시작까지 1시간 미만이면 마감 = 수업 시작', () => {
        const notifiedAt = new Date('2026-06-19T19:20:00').getTime();
        const e = entry({ status: 'notified', notifiedAtMs: notifiedAt });
        expect(getNotificationDeadline(e).getTime()).toBe(classStart.getTime());
    });
});

describe('canStillNotify', () => {
    it('수업 시작 전이면 true, 이후 false', () => {
        expect(canStillNotify(entry(), new Date('2026-06-19T19:49:00'))).toBe(true);
        expect(canStillNotify(entry(), new Date('2026-06-19T19:50:00'))).toBe(false);
    });
});

describe('resolveAfterSeatFreed', () => {
    const now = new Date('2026-06-19T10:00:00');
    it('자리 1개 → 선착순(createdAt) waiting 1명만 알림', () => {
        const entries = [
            entry({ id: 'b', createdAtMs: 2000 }),
            entry({ id: 'a', createdAtMs: 1000 }),
        ];
        const { toExpire, toNotify } = resolveAfterSeatFreed(entries, now, 1);
        expect(toExpire).toHaveLength(0);
        expect(toNotify.map(e => e.id)).toEqual(['a']);
    });
    it('만료된 notified는 expire하고 그 자리만큼 추가 알림', () => {
        const entries = [
            entry({ id: 'stale', status: 'notified', notifiedAtMs: new Date('2026-06-19T08:00:00').getTime() }),
            entry({ id: 'next1', createdAtMs: 1000 }),
            entry({ id: 'next2', createdAtMs: 2000 }),
        ];
        const { toExpire, toNotify } = resolveAfterSeatFreed(entries, now, 1);
        expect(toExpire.map(e => e.id)).toEqual(['stale']);
        // 새 자리 1 + 만료 반환 자리 1 = 2명 알림
        expect(toNotify.map(e => e.id)).toEqual(['next1', 'next2']);
    });
    it('수업 시작이 지난 waiting은 알림 대상에서 제외', () => {
        const after = new Date('2026-06-19T20:00:00');
        const { toNotify } = resolveAfterSeatFreed([entry()], after, 1);
        expect(toNotify).toHaveLength(0);
    });
});

describe('resolveToTarget', () => {
    const now = new Date('2026-06-19T10:00:00');
    it('여석 수에 맞춰 부족한 만큼만 알림 (유효한 notified는 자리 보유로 계산)', () => {
        const entries = [
            entry({ id: 'held', status: 'notified', notifiedAtMs: now.getTime() - 10 * 60 * 1000 }),
            entry({ id: 'w1', createdAtMs: 1000 }),
            entry({ id: 'w2', createdAtMs: 2000 }),
        ];
        const { toNotify } = resolveToTarget(entries, now, 2);
        expect(toNotify.map(e => e.id)).toEqual(['w1']); // 2자리 - 유효 notified 1 = 1명
    });
    it('여석 0이면 아무도 알리지 않는다', () => {
        const { toNotify } = resolveToTarget([entry()], now, 0);
        expect(toNotify).toHaveLength(0);
    });
});

describe('findWaitlistsReleasedByHolding — 홀딩한 수업의 보강 대기', () => {
    const wait = (over) => ({ id: 'w', studentName: '이정은', status: 'waiting', date: '2026-10-30', day: '금', period: 5,
        originalClass: { date: '2026-10-29', day: '목', period: 1 }, ...over });
    it('원래 수업 날짜를 홀딩하면 그 대기(waiting/notified)를 취소 대상으로', () => {
        const entries = [wait({ id: 'a' }), wait({ id: 'b', status: 'notified' })];
        expect(findWaitlistsReleasedByHolding(entries, '이정은', ['2026-10-29']).map(e => e.id)).toEqual(['a', 'b']);
    });
    it('다른 날짜 홀딩·다른 수강생·이미 끝난 대기는 건드리지 않음', () => {
        const entries = [
            wait({ id: 'other-date', originalClass: { date: '2026-10-27', day: '화', period: 1 } }),
            wait({ id: 'other-name', studentName: '송영훈' }),
            wait({ id: 'accepted', status: 'accepted' }),
        ];
        expect(findWaitlistsReleasedByHolding(entries, '이정은', ['2026-10-29'])).toEqual([]);
    });
    it('보강 목적지 날짜만 홀딩한 경우는 취소하지 않음', () => {
        expect(findWaitlistsReleasedByHolding([wait()], '이정은', ['2026-10-30'])).toEqual([]);
    });
});

describe('원래 수업이 시작된 보강 대기 자동 취소', () => {
    // 목5(10/29 19:50) → 금5(10/30) 대기. 확인 시각 10/30 10:00 = 원래 수업 지남, 보강 수업 전.
    const now = new Date('2026-10-30T10:00:00+09:00');
    const entry = (over) => ({ id: 'x', studentName: '이슬아', status: 'waiting', date: '2026-10-30', day: '금', period: 5, createdAtMs: 1,
        originalClass: { date: '2026-10-29', day: '목', period: 5 }, ...over });
    it('원래 수업이 시작됐으면 살아 있는 대기가 아니다', () => {
        expect(isOriginalClassStarted(entry(), now)).toBe(true);
        expect(isLiveWaitlist(entry(), now)).toBe(false);
        expect(isLiveWaitlist(entry({ originalClass: { date: '2026-10-31', day: '금', period: 1 } }), now)).toBe(true);
    });
    it('자리가 나면 지난 대기는 취소하고 다음 순번에게 알린다', () => {
        const stale = entry({ id: 'stale', createdAtMs: 1 });
        const ok = entry({ id: 'ok', createdAtMs: 2, originalClass: { date: '2026-11-02', day: '월', period: 1 } });
        const r = resolveAfterSeatFreed([stale, ok], now, 1);
        expect(r.toCancel.map(e => e.id)).toEqual(['stale']);
        expect(r.toNotify.map(e => e.id)).toEqual(['ok']);
    });
    it('자리 안내를 받았던 지난 대기를 취소하면 그 자리도 다음 순번에게', () => {
        const notified = entry({ id: 'n', status: 'notified', notifiedAtMs: now.getTime() - 60000 });
        const a = entry({ id: 'a', createdAtMs: 2, originalClass: { date: '2026-11-02', day: '월', period: 1 } });
        const b = entry({ id: 'b', createdAtMs: 3, originalClass: { date: '2026-11-02', day: '월', period: 1 } });
        expect(resolveAfterSeatFreed([notified, a, b], now, 1).toNotify.map(e => e.id)).toEqual(['a', 'b']);
        expect(resolveToTarget([notified, a, b], now, 1).toNotify.map(e => e.id)).toEqual(['a']);
    });
});

describe("'원래 수업 빠지고 대기 유지'", () => {
    const now = new Date('2026-10-30T10:00:00+09:00');
    const base = { id: 'k', studentName: '이정은', status: 'waiting', date: '2026-10-31', day: '금', period: 5, createdAtMs: 1 };
    it('유지를 고른 대기는 원래 수업이 지나도 살아 있다', () => {
        const kept = { ...base, keepAfterOriginal: true, originalClass: { date: '2026-10-29', day: '목', period: 1 } };
        expect(isReleasedByOriginalStart(kept, now)).toBe(false);
        expect(isLiveWaitlist(kept, now)).toBe(true);
        expect(resolveAfterSeatFreed([kept], now, 1).toNotify.map(e => e.id)).toEqual(['k']);
    });
    it('원래 수업 시작 전 + 원래 수업이 보강보다 먼저일 때만 고를 수 있다', () => {
        expect(canKeepAfterOriginal({ ...base, originalClass: { date: '2026-10-30', day: '금', period: 4 } }, now)).toBe(true);
        expect(canKeepAfterOriginal({ ...base, originalClass: { date: '2026-10-29', day: '목', period: 1 } }, now)).toBe(false);
        expect(canKeepAfterOriginal({ ...base, date: '2026-10-30', period: 2, originalClass: { date: '2026-10-30', day: '금', period: 4 } }, now)).toBe(false);
        expect(canKeepAfterOriginal({ ...base, keepAfterOriginal: true, originalClass: { date: '2026-10-30', day: '금', period: 4 } }, now)).toBe(false);
    });
});

describe("'다른 시간으로 보강 변경'", () => {
    const now = new Date('2026-10-30T17:10:00+09:00'); // 금 4교시(18:00) 50분 전 — 일반 보강 마감(2시간 전)은 지남
    const base = { id: 'c', studentName: '이정은', status: 'waiting', date: '2026-11-02', day: '월', period: 5, createdAtMs: 1 };
    it('원래 수업 시작 전이면 2시간 마감이 지나도 고를 수 있다', () => {
        expect(canConvertWaitToMakeup({ ...base, originalClass: { date: '2026-10-30', day: '금', period: 4 } }, now)).toBe(true);
    });
    it("'대기 유지'를 고른 대기도 원래 수업 전이면 바꿀 수 있다", () => {
        expect(canConvertWaitToMakeup({ ...base, keepAfterOriginal: true, originalClass: { date: '2026-10-30', day: '금', period: 4 } }, now)).toBe(true);
    });
    it('원래 수업이 시작됐거나, 자리 안내(notified)를 받은 대기는 안 된다', () => {
        expect(canConvertWaitToMakeup({ ...base, originalClass: { date: '2026-10-30', day: '금', period: 2 } }, now)).toBe(false);
        expect(canConvertWaitToMakeup({ ...base, keepAfterOriginal: true, originalClass: { date: '2026-10-29', day: '목', period: 1 } }, now)).toBe(false);
        expect(canConvertWaitToMakeup({ ...base, status: 'notified', originalClass: { date: '2026-10-30', day: '금', period: 4 } }, now)).toBe(false);
    });
});
