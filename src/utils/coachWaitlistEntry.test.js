import { describe, it, expect } from 'vitest';
import { buildCoachWaitlistRegistration, normalizePhone, orderWaitlist } from './coachWaitlistEntry.js';

const base = { name: ' 홍길동 ', phone: '01012345678', weeklyFrequency: 2, slots: [{ day: '수', period: 5 }, { day: '월', period: 4 }, { day: '월', period: 4 }] };

describe('buildCoachWaitlistRegistration', () => {
    it('공개 대기 신청서와 같은 모양으로 만든다', () => {
        const { data, error } = buildCoachWaitlistRegistration({ ...base, coachMemo: ' 인스타 DM ', recruitmentMonth: '2026-12' });
        expect(error).toBeUndefined();
        expect(data.name).toBe('홍길동');
        expect(data.phone).toBe('010-1234-5678');
        expect(data.password).toBe('5678');
        expect(data.requestedSlots).toEqual([{ day: '월', period: 4 }, { day: '수', period: 5 }]);
        expect(data.scheduleString).toBe('월4수5');
        expect(data.totalCost).toBe(390000);
        expect(data.coachEntered).toBe(true);
        expect(data.coachMemo).toBe('인스타 DM');
        expect(data.recruitmentMonth).toBe('2026-12');
    });

    it('희망 시간이 주횟수보다 적으면 거부 (중복·자율 교시는 세지 않음)', () => {
        expect(buildCoachWaitlistRegistration({ ...base, weeklyFrequency: 3, slots: [...base.slots, { day: '화', period: 3 }] }).error).toMatch(/3개 이상/);
    });

    it('이름·연락처·주횟수 검증', () => {
        expect(buildCoachWaitlistRegistration({ ...base, name: '  ' }).error).toMatch(/이름/);
        expect(buildCoachWaitlistRegistration({ ...base, name: 'a/b' }).error).toMatch(/이름/);
        expect(buildCoachWaitlistRegistration({ ...base, phone: '1234' }).error).toMatch(/연락처/);
        expect(buildCoachWaitlistRegistration({ ...base, weeklyFrequency: 5 }).error).toMatch(/주횟수/);
    });

    it('주4회도 코치는 등록 가능', () => {
        const slots = [{ day: '월', period: 1 }, { day: '화', period: 1 }, { day: '수', period: 1 }, { day: '목', period: 1 }];
        expect(buildCoachWaitlistRegistration({ ...base, weeklyFrequency: 4, slots }).data.totalCost).toBe(530000);
    });
});

describe('normalizePhone', () => {
    it('하이픈 유무 상관없이 정규화', () => {
        expect(normalizePhone('010-1234-5678')).toBe('010-1234-5678');
        expect(normalizePhone('0111234567')).toBe('011-123-4567');
        expect(normalizePhone('02-123-4567')).toBe('');
    });
});

describe('orderWaitlist', () => {
    it('먼저 등록한 사람이 앞 순번', () => {
        const t = s => ({ toMillis: () => s });
        const ordered = orderWaitlist([{ id: 'b', createdAt: t(20) }, { id: 'a', createdAt: t(10) }, { id: 'c', createdAt: t(30) }]);
        expect(ordered.map(r => r.id)).toEqual(['a', 'b', 'c']);
    });
});
