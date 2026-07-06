import { describe, it, expect } from 'vitest';
import { groupSessionsByDate } from './session-logic.js';

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
