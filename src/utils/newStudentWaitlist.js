// 신규 수강 대기(newStudentRegistrations status='waitlist') 순수 로직.
// 종류: seat = 접수중인 달에서 원하는 시간이 만석 / month = 문의 및 대기 가능한 달에 미리 대기(마감된 달은 받지 않음).
// waitType 필드가 없는 예전 문서는 만석 대기다. source='coach'는 코치가 직접 넣은 대기.
import { isRecruitmentMonth, koreanDate } from './recruitment';

export const WAIT_TYPES = { seat: '만석 대기', month: '모집 대기' };
export const waitTypeOf = reg => (reg?.waitType === 'month' ? 'month' : 'seat');
export const isCoachWaitlist = reg => reg?.source === 'coach';

const DAYS = ['월', '화', '수', '목', '금'];
const REGULAR_PERIODS = [1, 2, 4, 5, 6];
const createdMillis = reg => reg?.createdAt?.toMillis?.() ?? (typeof reg?.createdAt === 'number' ? reg.createdAt : 0);

/** 먼저 신청한 사람이 앞(순번 1). */
export const sortWaitlist = regs => [...regs].sort((a, b) => createdMillis(a) - createdMillis(b));

/** 희망 시간 중 지금 자리가 있는 시간과, 주횟수만큼 들어갈 수 있는지. */
export function waitlistSeatStatus(reg, occupancy = {}, disabledClasses = [], maxCapacity = 7) {
    const availableSlots = (reg?.requestedSlots || []).filter(({ day, period }) => {
        const key = `${day}-${period}`;
        return !disabledClasses.includes(key) && (occupancy[key] || 0) < maxCapacity;
    });
    // 같은 요일 두 교시는 한 번만 다닐 수 있으므로 요일 수로 판정한다.
    const days = new Set(availableSlots.map(s => s.day)).size;
    return { availableSlots, hasSeat: days >= (reg?.weeklyFrequency || 2) };
}

/** 접수중 전환 안내 창: 그 달 모집 대기자(순번순) + 자리 여부. */
export function monthWaitlistNotice(regs, month, occupancy, disabledClasses, maxCapacity) {
    return sortWaitlist(regs.filter(r => r.status === 'waitlist' && waitTypeOf(r) === 'month' && r.recruitmentMonth === month))
        .map((reg, index) => ({ reg, order: index + 1, ...waitlistSeatStatus(reg, occupancy, disabledClasses, maxCapacity) }));
}

export const sortSlots = slots => [...slots].sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || a.period - b.period);
export const slotsToString = slots => sortSlots(slots).map(s => `${s.day}${s.period}`).join('');

/**
 * 그 달 모집 상태로 대기를 받을 수 있는지. 마감된 달은 다음 달로 받으므로 대기도 받지 않는다(2026-11-03 사용자 결정).
 * 공개 모집 대기는 '문의 및 대기 가능'(설정 없음 포함)인 달만. 접수중인 달은 일반 신청 화면의 만석 대기를 쓴다.
 */
export function assertWaitlistMonthStatus(status, { coach = false } = {}) {
    if (status === 'closed') throw new Error('마감된 달은 대기 신청을 받지 않습니다. 다음 달로 신청해주세요.');
    if (!coach && status === 'open') throw new Error('이 달은 신규 모집이 시작되었습니다. 모집 화면에서 신청해주세요.');
}

/**
 * 대기 신청 입력 검증. 공개 신청은 주2/3회, 코치 직접 추가는 주4회까지.
 * 희망 시간은 서로 다른 요일이 주횟수 이상이어야 한다(같은 요일 여러 교시는 선택 가능).
 */
export function validateWaitlistEntry(data, { coach = false, today = koreanDate() } = {}) {
    const name = String(data?.name || '').trim();
    if (!name || name.length > 50) throw new Error('이름을 확인해주세요.');
    if (!/^010-?\d{4}-?\d{4}$/.test(String(data?.phone || ''))) throw new Error('연락처를 010-0000-0000 형식으로 입력해주세요.');
    if (!isRecruitmentMonth(data?.recruitmentMonth) || data.recruitmentMonth < today.slice(0, 7)) {
        throw new Error('희망 입학 월을 다시 선택해주세요.');
    }
    const allowed = coach ? [2, 3, 4] : [2, 3];
    if (!allowed.includes(data?.weeklyFrequency)) throw new Error(`주 횟수는 ${allowed.map(n => `주${n}회`).join('·')} 중에서 선택해주세요.`);
    const slots = data?.requestedSlots || [];
    const keys = new Set(slots.map(s => `${s.day}-${s.period}`));
    if (keys.size !== slots.length || slots.some(s => !DAYS.includes(s.day) || !REGULAR_PERIODS.includes(Number(s.period)))) {
        throw new Error('희망 시간을 다시 선택해주세요.');
    }
    if (new Set(slots.map(s => s.day)).size < data.weeklyFrequency) {
        throw new Error(`가능한 시간을 서로 다른 요일로 ${data.weeklyFrequency}일 이상 선택해주세요.`);
    }
}
