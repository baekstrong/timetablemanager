import {
    getActiveMakeupWaitlists,
    notifyMakeupWaitlist,
    updateMakeupWaitlistStatus,
} from './firebaseService';
import { sendMakeupSeatAvailableSMS } from './smsService';
import { resolveAfterSeatFreed, resolveToTarget } from '../utils/makeupWaitlist';
import { parseScheduleString } from '../utils/scheduleUtils';
import { PERIODS } from '../data/mockData';

/** Firestore 문서 → 순수 로직용 정규화 (Timestamp → ms) */
export function normalizeWaitlistEntry(entry) {
    return {
        ...entry,
        createdAtMs: entry.createdAt?.toMillis?.() ?? 0,
        notifiedAtMs: entry.notifiedAt?.toMillis?.() ?? null,
    };
}

function formatDateText(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    return `${d.getMonth() + 1}/${d.getDate()}(${dayNames[d.getDay()]})`;
}

/** expire 처리 + 다음 순번 notified 전환 + SMS 발송. 알린 인원 수 반환. */
async function applyResolution({ toExpire, toNotify }) {
    for (const e of toExpire) {
        await updateMakeupWaitlistStatus(e.id, 'expired')
            .catch(err => console.error('보강 대기 만료 처리 실패:', e.id, err));
    }
    for (const e of toNotify) {
        try {
            await notifyMakeupWaitlist(e.id);
            const periodInfo = PERIODS.find(p => p.id === e.period);
            if (e.phone) {
                await sendMakeupSeatAvailableSMS(
                    e.phone, e.studentName,
                    formatDateText(e.date),
                    periodInfo?.name || `${e.period}교시`
                );
            } else {
                console.warn('보강 대기 전화번호 없음 — SMS 생략:', e.studentName);
            }
        } catch (err) {
            console.error('보강 대기 알림 실패:', e.id, err);
        }
    }
    return toNotify.length;
}

/**
 * 특정 날짜+슬롯에서 자리가 1개 빠졌을 때 호출.
 * 트리거: 홀딩 처리, 결석 처리, 보강 취소, 대기 거절.
 */
export async function onSeatFreed(date, day, period) {
    try {
        const all = (await getActiveMakeupWaitlists()).map(normalizeWaitlistEntry);
        const slotEntries = all.filter(e => e.date === date && e.day === day && e.period === period);
        if (slotEntries.length === 0) return 0;
        return await applyResolution(resolveAfterSeatFreed(slotEntries, new Date(), 1));
    } catch (err) {
        console.error('보강 대기 자리 알림 처리 실패:', err);
        return 0;
    }
}

/**
 * 여러 날짜에 걸친 자리 발생 (홀딩/결석은 날짜 다중 선택 가능).
 * 각 날짜의 요일에 해당하는 정규 수업 슬롯마다 onSeatFreed 호출.
 * @param {string[]} dates - 'YYYY-MM-DD' 배열
 * @param {string} scheduleStr - 해당 수강생의 D열 값 (예: '월1수1')
 */
export async function onSeatsFreedForDates(dates, scheduleStr) {
    const parsed = parseScheduleString(scheduleStr || '');
    if (parsed.length === 0) return;
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    for (const date of dates) {
        const dayName = dayNames[new Date(date + 'T00:00:00').getDay()];
        for (const s of parsed.filter(p => p.day === dayName)) {
            await onSeatFreed(date, dayName, s.period);
        }
    }
}

/**
 * 백스톱 동기화 — 코치 시간표 로드 시 실제 여석 기준으로 대기열 정리.
 * 만료된 notified를 expire하고, 여석이 있으면 다음 순번에게 알린다.
 * @param {(date, day, period) => number|null} getAvailableSeats - 여석 수, 판단 불가 시 null
 */
export async function syncMakeupWaitlists(getAvailableSeats) {
    try {
        const all = (await getActiveMakeupWaitlists()).map(normalizeWaitlistEntry);
        const bySlot = new Map();
        all.forEach(e => {
            const key = `${e.date}|${e.day}|${e.period}`;
            if (!bySlot.has(key)) bySlot.set(key, []);
            bySlot.get(key).push(e);
        });
        let notified = 0;
        for (const [key, entries] of bySlot) {
            const [date, day, periodStr] = key.split('|');
            const seats = getAvailableSeats(date, day, parseInt(periodStr));
            if (seats === null || seats === undefined) continue;
            notified += await applyResolution(resolveToTarget(entries, new Date(), seats));
        }
        return notified;
    } catch (err) {
        console.error('보강 대기 동기화 실패:', err);
        return 0;
    }
}
