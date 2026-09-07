import { describe, it, expect } from 'vitest';
import { computeSlotOccupancy } from './slotOccupancy';

// 테스트용 최소 파서 ("월5화5" → [{day:'월',period:5},...])
const parse = (s) => {
    const out = [];
    const chars = String(s || '').replace(/\s/g, '');
    let i = 0;
    while (i < chars.length) {
        const day = chars[i];
        if ('월화수목금'.includes(day)) {
            i++;
            let n = '';
            while (i < chars.length && /\d/.test(chars[i])) n += chars[i++];
            if (n) out.push({ day, period: parseInt(n) });
        } else i++;
    }
    return out;
};

const s = (name, schedule, extra = {}) => ({ 이름: name, '요일 및 시간': schedule, ...extra });

describe('computeSlotOccupancy', () => {
    it('같은 슬롯 학생 수를 이름 기준으로 센다', () => {
        const occ = computeSlotOccupancy([s('가', '월5'), s('나', '월5'), s('나', '월5')], [], parse);
        expect(occ['월-5']).toBe(2); // '나' 중복 1명 처리
    });

    it('pending 신규 신청도 카운트에 포함한다', () => {
        const occ = computeSlotOccupancy(
            [s('가', '월5')],
            [{ name: '신규', requestedSlots: [{ day: '월', period: 5 }] }],
            parse
        );
        expect(occ['월-5']).toBe(2);
    });

    // 운영 기준: 미리 등록한 다음 시간표가 있어도 신규 여석은 현재 활성 시간표로 센다.
    it('다음 등록 시간표가 있어도 현재 슬롯에서 센다', () => {
        const students = [
            s('가', '월5'), s('나', '월5'), s('다', '월5'),
            s('라', '월5'), s('마', '월5'), s('바', '월5'), // 월5에 이미 6명
            s('X', '화5', { _nextSchedule: '월5' }),        // 화5 활성이지만 다음 달 월5로 이동
        ];
        const occ = computeSlotOccupancy(students, [], parse);
        expect(occ['월-5']).toBe(6); // 다음 시간표는 아직 반영하지 않음
        expect(occ['화-5']).toBe(1); // 현재 활성 슬롯에서 카운트
    });

    it('현재 시간표만 있으면 해당 슬롯에서 센다', () => {
        const occ = computeSlotOccupancy([s('가', '화5')], [], parse);
        expect(occ['화-5']).toBe(1);
    });
});
