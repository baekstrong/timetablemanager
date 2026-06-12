import { describe, it, expect } from 'vitest';
import { getPeriodEndMinutes, isPeriodImminentOrOngoing } from './scheduleUtils';

const P5 = { id: 5, name: '5교시', time: '19:50 ~ 21:20', startHour: 19, startMinute: 50 };
const P3 = { id: 3, name: '3교시(자율)', time: '15:00 ~ 17:00', type: 'free', startHour: 15, startMinute: 0 };

const at = (h, m) => new Date(2026, 5, 12, h, m); // 임의의 날짜, 시각만 의미 있음

describe('getPeriodEndMinutes', () => {
    it('time 문자열의 끝 시간을 분으로 반환한다', () => {
        expect(getPeriodEndMinutes(P5)).toBe(21 * 60 + 20);
        expect(getPeriodEndMinutes(P3)).toBe(17 * 60); // 자율은 120분
    });
    it('time 파싱 실패 시 시작+90분으로 폴백한다', () => {
        expect(getPeriodEndMinutes({ startHour: 10, startMinute: 0, time: '이상한값' })).toBe(10 * 60 + 90);
    });
});

describe('isPeriodImminentOrOngoing', () => {
    it('수업 시작 30분 전부터 true', () => {
        expect(isPeriodImminentOrOngoing(P5, at(19, 20))).toBe(true);
        expect(isPeriodImminentOrOngoing(P5, at(19, 19))).toBe(false);
    });
    it('수업 중에는 true, 종료 후 false', () => {
        expect(isPeriodImminentOrOngoing(P5, at(20, 30))).toBe(true);
        expect(isPeriodImminentOrOngoing(P5, at(21, 20))).toBe(true);
        expect(isPeriodImminentOrOngoing(P5, at(21, 21))).toBe(false);
    });
});
