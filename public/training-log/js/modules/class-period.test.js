import { describe, it, expect } from 'vitest';
import { resolveClassSlot, previousSlot, slotHasEnded, parseSchedule, rosterFor, weekdayDates, PERIODS } from './class-period.js';

describe('previousSlot', () => {
    const slotAt = (id, date, dayLabel) => ({ period: PERIODS.find(p => p.id === id), date, dayLabel, status: 'past' });

    it('같은 날 앞 교시로 되감는다', () => {
        const p = previousSlot(slotAt(5, '2026-07-31', '금'));
        expect(p.period.id).toBe(4);
        expect(p.date).toBe('2026-07-31');
    });

    it('1교시에서는 직전 평일 마지막 교시로', () => {
        const p = previousSlot(slotAt(1, '2026-07-31', '금'));
        expect(p.period.id).toBe(6);
        expect(p.date).toBe('2026-07-30');
        expect(p.dayLabel).toBe('목');
    });

    it('월요일 1교시에서는 금요일로 건너뛴다', () => {
        const p = previousSlot(slotAt(1, '2026-08-03', '월'));
        expect(p.dayLabel).toBe('금');
        expect(p.date).toBe('2026-07-31');
    });
});

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

describe('slotHasEnded', () => {
    const slot = (id, date) => ({ period: PERIODS.find(p => p.id === id), date, dayLabel: '금' });

    it('지난 날짜면 끝난 것', () => {
        expect(slotHasEnded(slot(5, '2026-07-30'), at('2026-07-31T10:00:00'))).toBe(true);
    });

    it('오늘이면 종료 시각 기준', () => {
        expect(slotHasEnded(slot(4, '2026-07-31'), at('2026-07-31T19:31:00'))).toBe(true);  // 4교시 19:30 종료
        expect(slotHasEnded(slot(4, '2026-07-31'), at('2026-07-31T19:00:00'))).toBe(false); // 진행 중
        expect(slotHasEnded(slot(5, '2026-07-31'), at('2026-07-31T13:00:00'))).toBe(false); // 아직 시작 전
    });

    it('미래 날짜면 안 끝난 것', () => {
        expect(slotHasEnded(slot(1, '2026-08-03'), at('2026-07-31T23:00:00'))).toBe(false);
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

describe('weekdayDates', () => {
    it('주중 아무 날이나 그 주 월~금을 돌려준다', () => {
        // 2026-08-05는 수요일
        expect(weekdayDates(new Date('2026-08-05T13:00:00'))).toEqual({
            월: '2026-08-03', 화: '2026-08-04', 수: '2026-08-05', 목: '2026-08-06', 금: '2026-08-07',
        });
    });

    it('월요일·금요일도 같은 주를 가리킨다', () => {
        const mon = weekdayDates(new Date('2026-08-03T09:00:00'));
        const fri = weekdayDates(new Date('2026-08-07T22:00:00'));
        expect(mon).toEqual(fri);
        expect(mon.월).toBe('2026-08-03');
    });

    it('일요일은 다음 주 월요일 기준 (메인 앱 시간표와 동일)', () => {
        expect(weekdayDates(new Date('2026-08-09T10:00:00')).월).toBe('2026-08-10');
    });

    it('토요일은 그 주 월요일 기준', () => {
        expect(weekdayDates(new Date('2026-08-08T10:00:00')).월).toBe('2026-08-03');
    });

    it('월 경계를 넘어가도 맞다', () => {
        // 2026-09-02(수) → 그 주 월요일은 8/31
        expect(weekdayDates(new Date('2026-09-02T10:00:00'))).toEqual({
            월: '2026-08-31', 화: '2026-09-01', 수: '2026-09-02', 목: '2026-09-03', 금: '2026-09-04',
        });
    });
});
