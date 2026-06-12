import { describe, it, expect } from 'vitest';
import {
    getNotificationDeadline,
    isNotificationExpired,
    canStillNotify,
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
        originalClass: { date: '2026-06-17', day: '수', period: 5, periodName: '5교시' },
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
