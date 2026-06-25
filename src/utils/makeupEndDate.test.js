import { describe, it, expect } from 'vitest';
import { classDayNums, secondClassDayISO, cappedEndForFirstClassMove } from './makeupEndDate';

// 기준 주: 2026-06-22(월) 수업, 같은 주 수요일 = 2026-06-24
const MON = '2026-06-22';
const TUE = '2026-06-23';
const WED = '2026-06-24';
const THU = '2026-06-25';
const FRI = '2026-06-26';

describe('classDayNums', () => {
    it('월수 → [1,3]', () => expect(classDayNums('월1수1')).toEqual([1, 3]));
    it('화목금 → [2,4,5]', () => expect(classDayNums('화5목5금5')).toEqual([2, 4, 5]));
    it('중복 제거', () => expect(classDayNums('월1월2수1')).toEqual([1, 3]));
    it('빈 입력', () => expect(classDayNums('')).toEqual([]));
});

describe('secondClassDayISO', () => {
    it('월수, 종료=월 → 같은 주 수', () => expect(secondClassDayISO('월1수1', MON)).toBe(WED));
    it('종료가 두번째 수업일(수)이면 미적용', () => expect(secondClassDayISO('월1수1', WED)).toBe(null));
    it('주1회면 미적용', () => expect(secondClassDayISO('월1', MON)).toBe(null));
});

describe('cappedEndForFirstClassMove (월수, 종료=월)', () => {
    const base = { scheduleStr: '월1수1', endDateISO: MON };

    it('안 옮기면 종료=월 그대로', () => {
        expect(cappedEndForFirstClassMove({ ...base }).capISO).toBe(MON);
    });
    it('월→금 → 수로 캡', () => {
        expect(cappedEndForFirstClassMove({ ...base, firstMakeupISO: FRI }).capISO).toBe(WED);
    });
    it('월→화 → 화 유지(두번째 수업일 전)', () => {
        expect(cappedEndForFirstClassMove({ ...base, firstMakeupISO: TUE }).capISO).toBe(TUE);
    });
    it('월→금 & 수→화 → 화 (두번째 수업이 화로 이동)', () => {
        expect(cappedEndForFirstClassMove({ ...base, firstMakeupISO: FRI, secondMakeupISO: TUE }).capISO).toBe(TUE);
    });
    it('월→금 & 수→목 → 목', () => {
        expect(cappedEndForFirstClassMove({ ...base, firstMakeupISO: FRI, secondMakeupISO: THU }).capISO).toBe(THU);
    });
    it('종료가 두번째 수업일이면 null(규칙 미적용)', () => {
        expect(cappedEndForFirstClassMove({ scheduleStr: '월1수1', endDateISO: WED, firstMakeupISO: FRI })).toBe(null);
    });
});
