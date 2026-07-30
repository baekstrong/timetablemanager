import { describe, it, expect } from 'vitest';
import { resolveClassSlot, parseSchedule, rosterFor } from './class-period.js';

// 2026-07-30은 목요일, 2026-08-01은 토요일, 2026-08-03은 월요일
const at = (iso) => new Date(iso);

describe('resolveClassSlot', () => {
    it('수업 중이면 그 교시를 now로', () => {
        const s = resolveClassSlot(at('2026-07-30T20:10:00'));
        expect(s.period.id).toBe(5);
        expect(s.status).toBe('now');
        expect(s.dayLabel).toBe('목');
        expect(s.date).toBe('2026-07-30');
    });

    it('시작 15분 전도 now로 잡는다', () => {
        expect(resolveClassSlot(at('2026-07-30T19:36:00')).period.id).toBe(5);
        expect(resolveClassSlot(at('2026-07-30T19:36:00')).status).toBe('now');
    });

    it('교시 사이(쉬는 시간)면 방금 끝난 교시를 past로', () => {
        const s = resolveClassSlot(at('2026-07-30T19:32:00'));
        expect(s.period.id).toBe(4);
        expect(s.status).toBe('past');
        expect(s.date).toBe('2026-07-30');
    });

    it('모든 수업이 끝난 밤이면 마지막 교시를 past로', () => {
        const s = resolveClassSlot(at('2026-07-30T23:50:00'));
        expect(s.period.id).toBe(6);
        expect(s.status).toBe('past');
        expect(s.date).toBe('2026-07-30');
    });

    it('첫 교시 전 이른 아침이면 전날 마지막 교시', () => {
        const s = resolveClassSlot(at('2026-07-30T07:00:00'));
        expect(s.period.id).toBe(6);
        expect(s.status).toBe('past');
        expect(s.date).toBe('2026-07-29');
    });

    it('주말이면 직전 평일(금요일) 마지막 교시', () => {
        const s = resolveClassSlot(at('2026-08-01T14:00:00')); // 토요일
        expect(s.dayLabel).toBe('금');
        expect(s.date).toBe('2026-07-31');
        expect(s.period.id).toBe(6);
    });

    it('월요일 이른 아침이면 금요일로 되감는다', () => {
        const s = resolveClassSlot(at('2026-08-03T08:00:00')); // 월요일 08:00
        expect(s.dayLabel).toBe('금');
        expect(s.date).toBe('2026-07-31');
    });
});

describe('parseSchedule', () => {
    it('요일+교시를 순서대로 읽는다', () => {
        expect(parseSchedule('월1수1')).toEqual([{ day: '월', period: 1 }, { day: '수', period: 1 }]);
        expect(parseSchedule('화5목5금5')).toHaveLength(3);
        expect(parseSchedule('')).toEqual([]);
        expect(parseSchedule(undefined)).toEqual([]);
    });
});

describe('rosterFor', () => {
    const map = { 김수미: '월1수1', 조동환: '화5목5', 윤경원: '목5금5', 도성재: '월4수4금4' };

    it('해당 요일·교시 수강생만 가나다순으로', () => {
        expect(rosterFor(map, '목', 5)).toEqual(['윤경원', '조동환']);
        expect(rosterFor(map, '월', 1)).toEqual(['김수미']);
        expect(rosterFor(map, '월', 4)).toEqual(['도성재']);
    });

    it('아무도 없으면 빈 배열', () => {
        expect(rosterFor(map, '금', 1)).toEqual([]);
        expect(rosterFor(null, '월', 1)).toEqual([]);
    });
});
