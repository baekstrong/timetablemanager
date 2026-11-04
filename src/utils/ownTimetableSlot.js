import { getMembershipRegistrations, registrationContainsDate } from './membershipRegistrations';
import { parseScheduleString } from './scheduleUtils';

const scheduleOf = (row) => parseScheduleString(String(
    Object.entries(row || {}).find(([key]) => key.replace(/\s/g, '') === '요일및시간')?.[1] || ''
));

/**
 * 보강 대상 칸이 수강생 '원래 시간표'(시트 D열 요일·교시)인지.
 * 원래 시간표 칸으로는 보강·대기를 받지 않는다(2026-11-04 사용자 결정).
 * - 그 날짜를 포함하는 등록이 있으면 그 등록의 시간표로 판정.
 * - 등록 기간 밖(종료 뒤·등록 사이 공백)이면 모든 등록 시간표의 합집합으로 판정 —
 *   마지막 수업(월6)을 종료일 뒤 자기 정규 칸(수6)으로 옮기면, 재등록하는 순간
 *   같은 칸이 보강이자 새 등록 첫 수업이 되어 1회가 사라진다(김수영 11/2→11/4 사례).
 */
export function isOwnTimetableSlot(student, date, day, period) {
    const registrations = getMembershipRegistrations(student);
    if (!registrations.length) return false;
    const covering = registrations.find(reg => registrationContainsDate(reg, date));
    const slots = covering ? scheduleOf(covering) : registrations.flatMap(scheduleOf);
    return slots.some(slot => slot.day === day && Number(slot.period) === Number(period));
}

export const OWN_TIMETABLE_SLOT_MESSAGE = '원래 수업 시간표(요일·교시)에는 보강을 신청할 수 없어요.\n다른 시간을 선택해주세요.';
