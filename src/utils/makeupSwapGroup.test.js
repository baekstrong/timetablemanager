import { describe, expect, it } from 'vitest';
import { groupWaits, siblingWaits, swapLockId, swapOffersFor, MAX_WAIT_TARGETS } from './makeupSwap';
import { sourceUnavailableReason } from '../components/schedule/studentClassModel';

const now = new Date('2026-11-16T08:00:00');
const orig = { date: '2026-11-17', day: '화', period: 2, periodName: '2교시' };
const wait = (id, date, period, extra = {}) => ({ id, studentName: '김', status: 'waiting', date, day: '목', period, originalClass: orig, createdAtMs: Number(id.replace(/\D/g, '')) || 0, ...extra });

describe('대기 묶음 (2026-11-12)', () => {
    it('같은 사람·같은 원래 수업 대기를 한 묶음으로, 칸은 시간순', () => {
        const groups = groupWaits([wait('w2', '2026-11-20', 6), wait('w1', '2026-11-19', 5), { ...wait('w3', '2026-11-19', 5), studentName: '이' }]);
        expect(groups).toHaveLength(2);
        expect(groups[0].studentName).toBe('김');
        expect(groups[0].entries.map(e => e.id)).toEqual(['w1', 'w2']);
    });

    it('형제 대기는 살아 있는 같은 묶음만, 자기 자신 제외', () => {
        const list = [wait('w1', '2026-11-19', 5), wait('w2', '2026-11-20', 6), wait('w3', '2026-11-20', 4, { status: 'cancelled' }),
            wait('w4', '2026-11-20', 4, { originalClass: { ...orig, period: 5 } })];
        expect(siblingWaits(list[0], list, now).map(e => e.id)).toEqual(['w2']);
    });

    it('잠금 id는 사람·원래 수업마다 고정', () => {
        expect(swapLockId('김', orig)).toBe('swap__김__2026-11-17__2');
        expect(swapLockId('김', { ...orig, period: '2' })).toBe(swapLockId('김', orig));
    });

    it('대기 거는 경로는 한 수업당 최대 3곳, 그 밖 경로는 대기가 있으면 막음', () => {
        const session = { type: 'regular', date: orig.date, day: '화', period: 2 };
        const waits = [wait('w1', '2026-11-19', 5), wait('w2', '2026-11-20', 6)];
        expect(sourceUnavailableReason(session, { now, waits, forWait: true, adding: 1 })).toBe('');
        expect(sourceUnavailableReason(session, { now, waits, forWait: true, adding: 2 })).toContain(`${MAX_WAIT_TARGETS}곳`);
        expect(sourceUnavailableReason(session, { now, waits })).toContain('보강 대기 중');
        expect(sourceUnavailableReason(session, { now, waits: [] })).toBe('');
    });

    it('받아줄 수 있는 요청만 첫 화면 안내로', () => {
        const entries = [wait('w1', '2026-11-19', 5), wait('w2', '2026-11-20', 6), { ...wait('w3', '2026-11-19', 4), studentName: '이' }];
        const mySession = { date: '2026-11-20', period: 6, type: 'regular' };
        const check = e => (e.date === '2026-11-20' && e.period === 6 ? { session: mySession, reason: '' } : { session: null, reason: '' });
        const offers = swapOffersFor(entries, '박', check);
        expect(offers).toHaveLength(1);
        expect(offers[0]).toMatchObject({ studentName: '김', session: mySession, originalClass: orig });
        expect(swapOffersFor(entries, '김', check)).toHaveLength(0);
    });
});
