import { describe, it, expect } from 'vitest';
import { isOwnTimetableSlot } from './ownTimetableSlot';

const row = (start, end, schedule) => ({ 이름: '김수영', '요일 및 시간': schedule, 시작날짜: start, 종료날짜: end });

describe('isOwnTimetableSlot', () => {
    const ended = row('261007', '261102', '월6수6');

    it('종료일 뒤라도 원래 시간표 칸이면 막는다 (김수영 11/2 월6 → 11/4 수6)', () => {
        expect(isOwnTimetableSlot(ended, '2026-11-04', '수', 6)).toBe(true);
    });

    it('원래 시간표가 아닌 칸은 허용', () => {
        expect(isOwnTimetableSlot(ended, '2026-11-04', '수', 5)).toBe(false);
        expect(isOwnTimetableSlot(ended, '2026-11-05', '목', 6)).toBe(false);
    });

    it('등록 기간 안이면 그 등록의 시간표로 판정', () => {
        expect(isOwnTimetableSlot(ended, '2026-10-21', '수', 6)).toBe(true);
        expect(isOwnTimetableSlot(ended, '2026-10-21', '화', 6)).toBe(false);
    });

    it('미리 등록으로 시간표가 바뀌면 각 기간의 시간표를 쓴다', () => {
        const student = { ...row('261007', '261102', '월6수6'), _upcomingRegistrations: [row('261109', '261203', '화5목5')] };
        expect(isOwnTimetableSlot(student, '2026-10-29', '목', 5)).toBe(false); // 현재 등록 기간: 월6수6
        expect(isOwnTimetableSlot(student, '2026-11-12', '수', 6)).toBe(false); // 다음 등록 기간: 화5목5
        expect(isOwnTimetableSlot(student, '2026-11-12', '목', 5)).toBe(true);
        expect(isOwnTimetableSlot(student, '2026-11-04', '수', 6)).toBe(true);  // 사이 공백: 합집합
        expect(isOwnTimetableSlot(student, '2026-11-05', '목', 5)).toBe(true);
    });

    it('등록 정보가 없으면 막지 않는다', () => {
        expect(isOwnTimetableSlot(null, '2026-11-04', '수', 6)).toBe(false);
    });
});
