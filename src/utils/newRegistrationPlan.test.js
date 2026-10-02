import { describe, it, expect } from 'vitest';
import { buildNewRegistrationPlan } from './newRegistrationPlan';

const reg = { entranceDate: '2026-10-03' };
const tueThu = [{ day: '화', period: 2 }, { day: '목', period: 2 }];
describe('신규 승인 조건 계산', () => {
    it('시간표 변경에 따라 첫 수업과 8회차 날짜를 변경한다', () => {
        const plan = buildNewRegistrationPlan(reg, tueThu, 2);
        expect(plan).toMatchObject({ startDate: '2026-10-06', endDate: '2026-10-29', scheduleString: '화2목2', totalCost: 390000 });
        const changed = buildNewRegistrationPlan(reg, [{ day: '수', period: 4 }, { day: '금', period: 4 }], 2);
        expect(changed).toMatchObject({ startDate: '2026-10-07', endDate: '2026-11-04', scheduleString: '수4금4' });
    });
    it.each([[2, 310000, 390000], [3, 390000, 470000], [4, 450000, 530000]])('주%d회 수업료와 입학비를 함께 갱신한다', (freq, baseCost, totalCost) => {
        const slots = ['월', '화', '수', '목'].slice(0, freq).map(day => ({ day, period: 1 }));
        expect(buildNewRegistrationPlan(reg, slots, String(freq))).toMatchObject({ weeklyFrequency: freq, baseCost, entranceCost: 80000, totalCost });
    });
    it('첫 수업이 코치 휴무면 시작일도 미루고 총 12회를 보장한다', () => {
        const plan = buildNewRegistrationPlan(reg, ['월', '수', '금'].map(day => ({ day, period: 1 })), 3, [{ date: '2026-10-05' }]);
        expect(plan).toMatchObject({ startDate: '2026-10-07', endDate: '2026-11-04' });
    });
    it('문의한 입학반 날짜를 우선하고 입학반 변경 후 다시 계산한다', () => {
        const plan = buildNewRegistrationPlan({ ...reg, entranceInquiry: '2026-10-10' }, tueThu, 2);
        expect(plan.startDate).toBe('2026-10-13');
        expect(plan.endDate).toBe('2026-11-05');
    });
    it('입학반이 없으면 임의의 날짜를 저장하지 않는다', () => {
        expect(buildNewRegistrationPlan({}, tueThu, 2)).toMatchObject({ startDate: '', endDate: '', totalCost: 390000 });
    });
    it('선택 개수·중복 요일·휴무·자율운동 교시·잘못된 날짜를 거부한다', () => {
        expect(() => buildNewRegistrationPlan(reg, tueThu, 3)).toThrow('정확히 3개');
        expect(() => buildNewRegistrationPlan(reg, [{ day: '화', period: 1 }, { day: '화', period: 2 }], 2)).toThrow('한 교시');
        expect(() => buildNewRegistrationPlan(reg, tueThu, 2, [], ['화-2'])).toThrow('수업이 없는');
        expect(() => buildNewRegistrationPlan(reg, [{ day: '화', period: 3 }, { day: '목', period: 2 }], 2)).toThrow('수업이 없는');
        expect(() => buildNewRegistrationPlan({ entranceDate: '2026-02-30' }, tueThu, 2)).toThrow('입학반 날짜');
    });
    it('입력 슬롯 배열을 정렬하거나 변경하지 않는다', () => {
        const slots = [{ day: '목', period: 2 }, { day: '화', period: 2 }];
        const before = structuredClone(slots);
        expect(buildNewRegistrationPlan(reg, slots, 2).scheduleString).toBe('화2목2');
        expect(slots).toEqual(before);
    });
});
