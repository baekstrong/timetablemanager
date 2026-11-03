import { describe, expect, it } from 'vitest';
import { assertWaitlistMonthStatus, monthWaitlistNotice, sortWaitlist, validateWaitlistEntry, waitTypeOf, waitlistSeatStatus, slotsToString } from './newStudentWaitlist';

const at = ms => ({ toMillis: () => ms });
const base = { name: '홍길동', phone: '010-1234-5678', recruitmentMonth: '2026-12', weeklyFrequency: 2,
    requestedSlots: [{ day: '월', period: 4 }, { day: '수', period: 4 }] };

describe('신규 대기', () => {
    it('waitType이 없는 예전 문서는 만석 대기', () => {
        expect(waitTypeOf({})).toBe('seat');
        expect(waitTypeOf({ waitType: 'month' })).toBe('month');
    });

    it('먼저 신청한 사람이 순번 1', () => {
        expect(sortWaitlist([{ id: 'b', createdAt: at(2) }, { id: 'a', createdAt: at(1) }]).map(r => r.id)).toEqual(['a', 'b']);
    });

    it('자리 여부는 서로 다른 요일 수로 판정하고 휴강 칸은 제외', () => {
        const reg = { weeklyFrequency: 2, requestedSlots: [{ day: '월', period: 4 }, { day: '월', period: 5 }, { day: '수', period: 4 }] };
        expect(waitlistSeatStatus(reg, { '수-4': 7 }, [], 7).hasSeat).toBe(false);
        expect(waitlistSeatStatus(reg, {}, ['수-4'], 7).hasSeat).toBe(false);
        const open = waitlistSeatStatus(reg, { '월-4': 7 }, [], 7);
        expect(open.hasSeat).toBe(true);
        expect(open.availableSlots).toEqual([{ day: '월', period: 5 }, { day: '수', period: 4 }]);
    });

    it('접수중 안내 창은 그 달 모집 대기만 순번대로', () => {
        const regs = [
            { id: 'late', status: 'waitlist', waitType: 'month', recruitmentMonth: '2026-12', createdAt: at(5), ...base },
            { id: 'early', status: 'waitlist', waitType: 'month', recruitmentMonth: '2026-12', createdAt: at(1), ...base, requestedSlots: [{ day: '화', period: 1 }, { day: '목', period: 1 }] },
            { id: 'seat', status: 'waitlist', recruitmentMonth: '2026-12', createdAt: at(0), ...base },
            { id: 'other', status: 'waitlist', waitType: 'month', ...base, recruitmentMonth: '2027-01', createdAt: at(0) },
        ];
        const rows = monthWaitlistNotice(regs, '2026-12', { '월-4': 7 }, [], 7);
        expect(rows.map(r => [r.reg.id, r.order, r.hasSeat])).toEqual([['early', 1, true], ['late', 2, false]]);
    });

    it('입력 검증: 공개 신청은 주2/3회, 코치는 주4회까지', () => {
        const today = '2026-11-03';
        expect(() => validateWaitlistEntry(base, { today })).not.toThrow();
        expect(() => validateWaitlistEntry({ ...base, weeklyFrequency: 4 }, { today })).toThrow();
        const four = { ...base, weeklyFrequency: 4, requestedSlots: ['월', '화', '수', '목'].map(day => ({ day, period: 1 })) };
        expect(() => validateWaitlistEntry(four, { coach: true, today })).not.toThrow();
        expect(() => validateWaitlistEntry({ ...base, recruitmentMonth: '2026-10' }, { today })).toThrow();
        expect(() => validateWaitlistEntry({ ...base, requestedSlots: [{ day: '월', period: 4 }, { day: '월', period: 5 }] }, { today })).toThrow();
        expect(() => validateWaitlistEntry({ ...base, requestedSlots: [{ day: '월', period: 3 }, { day: '수', period: 4 }] }, { today })).toThrow();
        expect(() => validateWaitlistEntry({ ...base, phone: '1234' }, { today })).toThrow();
    });

    it('마감된 달은 대기를 받지 않고, 접수중인 달은 코치만 추가', () => {
        expect(() => assertWaitlistMonthStatus('closed')).toThrow();
        expect(() => assertWaitlistMonthStatus('closed', { coach: true })).toThrow();
        expect(() => assertWaitlistMonthStatus('open')).toThrow();
        expect(() => assertWaitlistMonthStatus('open', { coach: true })).not.toThrow();
        expect(() => assertWaitlistMonthStatus('inquiry')).not.toThrow();
    });

    it('시간표 문자열은 요일·교시 순', () => {
        expect(slotsToString([{ day: '수', period: 4 }, { day: '월', period: 5 }, { day: '월', period: 1 }])).toBe('월1월5수4');
    });
});
