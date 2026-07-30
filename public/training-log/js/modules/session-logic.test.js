import { describe, it, expect } from 'vitest';
import { groupSessionsByDate, defaultSessionDate } from './session-logic.js';

describe('defaultSessionDate', () => {
    const TODAY = '2026-07-30';

    it('오늘 기록이 있어도 그 이전 수업을 기본으로 고른다', () => {
        expect(defaultSessionDate(['2026-07-30', '2026-07-28', '2026-07-25'], TODAY)).toBe('2026-07-28');
    });

    it('오늘 기록이 없으면 가장 최근 수업', () => {
        expect(defaultSessionDate(['2026-07-28', '2026-07-25'], TODAY)).toBe('2026-07-28');
    });

    it('오늘 기록밖에 없으면 오늘이라도 보여준다', () => {
        expect(defaultSessionDate(['2026-07-30'], TODAY)).toBe('2026-07-30');
    });

    it('미래 날짜 기록은 건너뛴다', () => {
        expect(defaultSessionDate(['2026-08-02', '2026-07-30', '2026-07-28'], TODAY)).toBe('2026-07-28');
    });

    it('기록이 없으면 null', () => {
        expect(defaultSessionDate([], TODAY)).toBe(null);
        expect(defaultSessionDate(undefined, TODAY)).toBe(null);
    });
});

describe('groupSessionsByDate', () => {
    it('날짜별로 묶고 최근 날짜를 먼저, 같은 날은 시간 오름차순으로 정렬', () => {
        const recs = [
            { date: '2026-07-01', ts: 300, ex: 'C' },
            { date: '2026-07-06', ts: 200, ex: 'B' },
            { date: '2026-07-06', ts: 100, ex: 'A' },
        ];
        const { dates, byDate } = groupSessionsByDate(recs);
        expect(dates).toEqual(['2026-07-06', '2026-07-01']);
        expect(byDate['2026-07-06'].map(r => r.ex)).toEqual(['A', 'B']);
        expect(byDate['2026-07-01'].map(r => r.ex)).toEqual(['C']);
    });

    it('빈 배열은 빈 결과', () => {
        expect(groupSessionsByDate([])).toEqual({ dates: [], byDate: {} });
    });

    it('날짜 없는 기록은 (날짜 없음) 버킷으로', () => {
        const { dates, byDate } = groupSessionsByDate([{ ts: 1, ex: 'X' }]);
        expect(dates).toEqual(['(날짜 없음)']);
        expect(byDate['(날짜 없음)'].map(r => r.ex)).toEqual(['X']);
    });
});
