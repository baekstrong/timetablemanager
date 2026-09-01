import {
    getActiveMakeupWaitlists,
    notifyMakeupWaitlist,
    updateMakeupWaitlistStatus,
} from './firebaseService';
import { sendMakeupSeatAvailableSMS } from './smsService';
import { pushMakeupSeat } from './pushService';
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
            const dateText = formatDateText(e.date);
            const periodLabel = periodInfo?.name || `${e.period}교시`;
            // 푸시 우선. 1시간 데드라인이 걸린 알림이라 토큰이 없거나(알림 미허용·기기 변경)
            // 발송 실패면 반드시 SMS로 폴백해야 한다.
            const pushed = await pushMakeupSeat(e.id);
            if (!pushed) {
                if (e.phone) {
                    await sendMakeupSeatAvailableSMS(e.phone, e.studentName, dateText, periodLabel);
                } else {
                    console.warn('보강 대기 알림 실패 — 푸시 없음, 전화번호도 없음:', e.studentName);
                }
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
export async function onSeatFreed(date, day, period, availableSeats = null, preloaded = null) {
    try {
        // preloaded: 여러 슬롯을 한 번에 처리할 때 호출자가 목록을 1회만 조회해 넘긴다.
        // 안 넘기면 종전대로 직접 조회.
        const all = preloaded || (await getActiveMakeupWaitlists()).map(normalizeWaitlistEntry);
        const slotEntries = all.filter(e => e.date === date && e.day === day && e.period === period);
        if (slotEntries.length === 0) return 0;
        // 실제 여석 수를 알면 그 기준으로(만석이면 0명 알림), 모르면 종전대로 1자리 가정.
        const resolution = typeof availableSeats === 'number'
            ? resolveToTarget(slotEntries, new Date(), availableSeats)
            : resolveAfterSeatFreed(slotEntries, new Date(), 1);
        return await applyResolution(resolution);
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

    const slots = [];
    for (const date of dates) {
        const dayName = dayNames[new Date(date + 'T00:00:00').getDay()];
        for (const s of parsed.filter(p => p.day === dayName)) {
            slots.push({ date, dayName, period: s.period });
        }
    }
    if (slots.length === 0) return;

    // 예전엔 슬롯마다 onSeatFreed를 직렬로 불렀고, 그 안에서 대기열 전체를 매번 다시 조회했다.
    // 홀딩 5일이면 같은 쿼리가 5번 줄줄이 났고 이 호출은 신청 완료 알림 앞에서 await 된다.
    // → 목록은 1회만 읽고, 슬롯 처리는 병렬로.
    // 슬롯끼리는 date|day|period로 갈라져 대상 대기자가 겹치지 않으므로 같은 스냅샷을 써도 안전하다.
    const all = (await getActiveMakeupWaitlists()).map(normalizeWaitlistEntry);
    await Promise.all(slots.map(s => onSeatFreed(s.date, s.dayName, s.period, null, all)));
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
