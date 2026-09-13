import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateHoldingDates } from './holdingDates';

const tueThu = date => [2, 4].includes(date.getDay());
const monWedFri = date => [1, 3, 5].includes(date.getDay());
const iso = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

describe('홀딩 수업일 연속성', () => {
    it.each([
        ['2026-09-15', '2026-09-17'],
        ['2026-09-17', '2026-09-22'],
        ['2026-12-31', '2027-01-05'],
        ['2026-09-17'],
    ])('연속 화목 수업과 단일 수업을 허용: %s', (...dates) => {
        expect(validateHoldingDates(dates, 2, tueThu)).toBeNull();
    });
    it('목→다음 목 사이 화요일 수업을 건너뛰면 거부한다', () => {
        expect(validateHoldingDates(['2026-09-17', '2026-09-24'], 2, tueThu)).toContain('연속');
    });
    it('주3회는 주 경계를 넘는 연속 3수업을 허용한다', () => {
        expect(validateHoldingDates(['2026-09-18', '2026-09-21', '2026-09-23'], 3, monWedFri)).toBeNull();
    });
    it('주3회에서 중간 수업을 빼면 거부한다', () => {
        expect(validateHoldingDates(['2026-09-14', '2026-09-18', '2026-09-21'], 3, monWedFri)).toContain('연속');
    });
    it('연속이어도 주횟수를 넘으면 거부한다', () => {
        expect(validateHoldingDates(['2026-09-15', '2026-09-17', '2026-09-22'], 2, tueThu)).toContain('최대 2일');
    });
    it('휴일에는 수업이 없으므로 다음 실제 수업으로 이어진다', () => {
        const actual = date => tueThu(date) && iso(date) !== '2026-09-22';
        expect(validateHoldingDates(['2026-09-17', '2026-09-24'], 2, actual)).toBeNull();
        expect(validateHoldingDates(['2026-09-22'], 2, actual)).toContain('실제 수업일');
    });
    it('보강으로 이동한 수업일을 포함하고 원래 날짜를 제외한다', () => {
        const actual = date => iso(date) === '2026-09-16' || (tueThu(date) && iso(date) !== '2026-09-15');
        expect(validateHoldingDates(['2026-09-16', '2026-09-17'], 2, actual)).toBeNull();
        expect(validateHoldingDates(['2026-09-10', '2026-09-17'], 2, actual)).toContain('연속');
    });
    it('중간 선택 해제 후 제출하는 비연속 날짜를 거부한다', () => {
        expect(validateHoldingDates(['2026-09-14', '2026-09-18'], 3, monWedFri)).toContain('연속');
    });
    it('역순 선택도 날짜 순으로 판단한다', () => {
        expect(validateHoldingDates(['2026-09-22', '2026-09-17'], 2, tueThu)).toBeNull();
    });
    it('학생 화면은 날짜 추가 및 Firebase 저장 전 모두 검증한다', () => {
        const source = readFileSync(new URL('../components/HoldingManager.jsx', import.meta.url), 'utf8');
        expect(source).toContain('getHoldingDatesError(newDates)');
        const submit = source.slice(source.indexOf('const handleSubmit = async'));
        expect(submit.indexOf('getHoldingDatesError(selectedDates)')).toBeGreaterThan(-1);
        expect(submit.indexOf('getHoldingDatesError(selectedDates)')).toBeLessThan(submit.indexOf('createHoldingRequest('));
    });
});
