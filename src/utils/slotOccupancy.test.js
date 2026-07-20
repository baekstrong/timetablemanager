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

    // 회귀: 다음 달 월5로 옮긴 학생(현재 활성 슬롯은 화5)이 목적지 월5에서 세져야
    // '만석인데 자리 있음'으로 표시돼 정원 초과 배정되던 버그를 막는다.
    it('다음 달 다른 슬롯으로 옮긴 학생은 목적지 슬롯에서 센다', () => {
        const students = [
            s('가', '월5'), s('나', '월5'), s('다', '월5'),
            s('라', '월5'), s('마', '월5'), s('바', '월5'), // 월5에 이미 6명
            s('X', '화5', { _nextSchedule: '월5' }),        // 화5 활성이지만 다음 달 월5로 이동
        ];
        const occ = computeSlotOccupancy(students, [], parse);
        expect(occ['월-5']).toBe(7); // X 포함 → 만석
        expect(occ['화-5'] || 0).toBe(0); // 옮겨간 옛 슬롯에서는 빠짐
    });

    it('_nextSchedule 없으면 현재 슬롯으로 센다', () => {
        const occ = computeSlotOccupancy([s('가', '화5')], [], parse);
        expect(occ['화-5']).toBe(1);
    });
});
