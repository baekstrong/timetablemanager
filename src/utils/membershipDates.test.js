import { describe, expect, it } from 'vitest';
import { isWithinRegisteredPeriod } from './membershipDates';
import { validateHoldingDates } from './holdingDates';

const old = { 시작날짜: '260825', 종료날짜: '260917' };
const next = { 시작날짜: '260929', 종료날짜: '261027' };
const date = value => new Date(`${value}T12:00:00`);

describe('재등록 사이 수강 공백', () => {
    it.each([
        { ...old, _nextRegistration: next },
        { ...next, _prevRegistration: old },
    ])('대표 등록 선택과 무관하게 실제 등록 기간만 허용한다', student => {
        for (const value of ['2026-09-18', '2026-09-22', '2026-09-24', '2026-09-28']) {
            expect(isWithinRegisteredPeriod(date(value), student)).toBe(false);
        }
        for (const value of ['2026-08-25', '2026-09-15', '2026-09-17', '2026-09-29', '2026-10-27']) {
            expect(isWithinRegisteredPeriod(date(value), student)).toBe(true);
        }
        expect(isWithinRegisteredPeriod(date('2026-10-28'), student)).toBe(false);
    });
    it('보강은 공백과 종료 후에도 해당 날짜만 허용한다', () => {
        const makeups = ['2026-09-23', '2026-10-01'].map(value => ({ makeupClass: { date: value } }));
        for (const value of ['2026-09-23', '2026-10-01']) {
            expect(isWithinRegisteredPeriod(date(value), old, makeups)).toBe(true);
        }
        for (const value of ['2026-09-22', '2026-09-24', '2026-09-29']) {
            expect(isWithinRegisteredPeriod(date(value), old, makeups)).toBe(false);
        }
    });
    it('공백 날짜를 홀딩 검증에서도 거부한다', () => {
        const actual = day => [2, 4].includes(day.getDay()) &&
            isWithinRegisteredPeriod(day, { ...old, _nextRegistration: next });
        expect(validateHoldingDates(['2026-09-22'], 2, actual)).toContain('실제 수업일');
        expect(validateHoldingDates(['2026-09-29'], 2, actual)).toBeNull();
    });
    it('날짜 형식과 종료일 별칭을 지원한다', () => {
        expect(isWithinRegisteredPeriod(date('2026-09-22'), {
            시작날짜: 260922, 종료일: '2026-09-24',
        })).toBe(true);
    });
    it('누락·잘못된 날짜를 수강 기간으로 간주하지 않는다', () => {
        for (const student of [null, {}, { 시작날짜: '260901', 종료날짜: '8회' },
            { 시작날짜: '260901', 종료날짜: '260932' }]) {
            expect(isWithinRegisteredPeriod(date('2026-09-22'), student)).toBe(false);
        }
        expect(isWithinRegisteredPeriod(null, old)).toBe(false);
    });
});
