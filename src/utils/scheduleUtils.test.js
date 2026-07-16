import { describe, it, expect } from 'vitest';
import { getPeriodEndMinutes, isPeriodImminentOrOngoing, wouldDoubleBookDay, isDelayedReregistration } from './scheduleUtils';

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

describe('wouldDoubleBookDay (보강 이중 수강 차단)', () => {
    // 송태규: 월4목4
    const schedule = [{ day: '월', period: 4 }, { day: '목', period: 4 }];

    it('다른 날 수업을 이미 수업 있는 요일로 옮기면 차단 (버그 케이스: 월4→목1)', () => {
        const orig = { day: '월', period: 4 };
        expect(wouldDoubleBookDay(schedule, [], orig, '목', '2026-07-16')).toBe(true);
    });
    it('같은 날 안에서 시간만 옮기면 허용 (목4→목1)', () => {
        const orig = { day: '목', period: 4 };
        expect(wouldDoubleBookDay(schedule, [], orig, '목', '2026-07-16')).toBe(false);
    });
    it('정규 수업이 없는 요일로 옮기면 허용 (월4→화1)', () => {
        const orig = { day: '월', period: 4 };
        expect(wouldDoubleBookDay(schedule, [], orig, '화', '2026-07-14')).toBe(false);
    });
    it('대상 요일 정규 수업을 이미 보강으로 비운 날짜면 옮겨와도 허용 (월4→목4 재사용)', () => {
        const orig = { day: '월', period: 4 };
        const moved = [{ originalClass: { day: '목', period: 4, date: '2026-07-16' } }];
        expect(wouldDoubleBookDay(schedule, moved, orig, '목', '2026-07-16')).toBe(false);
    });
    it('한 요일에 정규가 둘일 때 같은 날 이동은 허용 (목1↔목4 사이 이동)', () => {
        const twice = [{ day: '목', period: 1 }, { day: '목', period: 4 }];
        const orig = { day: '목', period: 1 };
        expect(wouldDoubleBookDay(twice, [], orig, '목', '2026-07-16')).toBe(false);
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

describe('isDelayedReregistration (재등록X 배지)', () => {
    const today = new Date('2026-07-16T00:00:00');
    const d = (iso) => new Date(iso + 'T00:00:00');

    it('주상조 케이스: 종료일(7/16)보다 앞선 날(7/15)로 보강해 마지막 수업이 앞당겨졌어도, 이미 재등록했으면 지연 아님', () => {
        expect(isDelayedReregistration({
            effectiveEnd: d('2026-07-15'), // 보강으로 앞당겨진 마지막 실제 수업일
            today,
            schedule: '목1',
            hasNextRegistration: true,     // 어제 재등록함
        })).toBe(false);
    });

    it('재등록 안 했고 마지막 수업이 지났으면 지연으로 표시', () => {
        expect(isDelayedReregistration({
            effectiveEnd: d('2026-07-15'),
            today,
            schedule: '목1',
            hasNextRegistration: false,
        })).toBe(true);
    });

    it('마지막 수업일이 아직 오늘 이후면 지연 아님', () => {
        expect(isDelayedReregistration({
            effectiveEnd: d('2026-07-20'),
            today,
            schedule: '목1',
            hasNextRegistration: false,
        })).toBe(false);
    });

    it('시간표가 없으면(빈 문자열) 지연 아님', () => {
        expect(isDelayedReregistration({
            effectiveEnd: d('2026-07-15'),
            today,
            schedule: '',
            hasNextRegistration: false,
        })).toBe(false);
    });
});
