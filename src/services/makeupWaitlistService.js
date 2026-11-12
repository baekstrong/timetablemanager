import {
    getActiveMakeupWaitlists,
    getWeekMakeupRequests,
    getMakeupWaitlistsByStudent,
    notifyMakeupWaitlist,
    updateMakeupWaitlistStatus,
} from './firebaseService';
import { requestMakeupSeatSMS } from './smsService';
import { pushMakeupSeat } from './pushService';
import { findWaitlistsReleasedByHolding, isReleasedByOriginalStart, resolveAfterSeatFreed, resolveToTarget } from '../utils/makeupWaitlist';
import { getThisWeekRange, parseScheduleString } from '../utils/scheduleUtils';
import { PERIODS } from '../data/mockData';
import { hasMakeupQuotaLeft } from '../utils/makeupQuota';
import { siblingWaits } from '../utils/makeupSwap';

/** Firestore 문서 → 순수 로직용 정규화 (Timestamp → ms) */
export function normalizeWaitlistEntry(entry) {
    return {
        ...entry,
        createdAtMs: entry.createdAt?.toMillis?.() ?? 0,
        notifiedAtMs: entry.notifiedAt?.toMillis?.() ?? null,
    };
}

/**
 * 자리 안내 직전 남은 보강 횟수 확인 (2026-11-11 사용자 결정: 대기는 성공해야 1회).
 * 대기를 건 뒤 다른 보강으로 횟수를 다 썼으면 수락할 수 없으므로, 안내하지 않고 대기를 취소한다 —
 * 안내가 간 자리는 수락 시간 동안 찬 자리로 묶이기 때문이다.
 * 조회 실패(safeRead가 [] 반환)나 한도 없는 예전 대기는 막지 않는다(종전 동작).
 */
async function canReceiveSeat(entry) {
    if (!entry.weeklyLimit) return true;
    const { start, end } = getThisWeekRange(new Date(`${entry.date}T00:00:00`));
    const weekMakeups = await getWeekMakeupRequests(entry.studentName, start, end);
    return hasMakeupQuotaLeft(entry, weekMakeups);
}

/** 앞 순번부터 안내 가능한 사람을 slots명 고른다. 횟수를 다 쓴 사람은 취소 목록으로. */
export async function pickNotifiable(toNotify = [], backup = [], check = canReceiveSeat) {
    const slots = toNotify.length;
    const chosen = [];
    const exhausted = [];
    for (const entry of [...toNotify, ...backup]) {
        if (chosen.length >= slots) break;
        if (await check(entry)) chosen.push(entry);
        else exhausted.push(entry);
    }
    return { chosen, exhausted };
}

/** cancel·expire 처리 + 다음 순번 notified 전환 + 푸시/SMS 발송. 알린 인원 수 반환. */
async function applyResolution({ toCancel = [], toExpire, toNotify: candidates, backup = [] }) {
    const { chosen: toNotify, exhausted } = await pickNotifiable(candidates, backup);
    toCancel = [...toCancel, ...exhausted];
    for (const e of toCancel) {
        await updateMakeupWaitlistStatus(e.id, 'cancelled')
            .catch(err => console.error('보강 대기 자동 취소 실패:', e.id, err));
    }
    for (const e of toExpire) {
        await updateMakeupWaitlistStatus(e.id, 'expired')
            .catch(err => console.error('보강 대기 만료 처리 실패:', e.id, err));
    }
    for (const e of toNotify) {
        try {
            await notifyMakeupWaitlist(e.id);
            // 푸시 우선. 1시간 데드라인이 걸린 알림이라 토큰이 없거나(알림 미허용·기기 변경)
            // 발송 실패면 반드시 SMS로 폴백해야 한다.
            const pushed = await pushMakeupSeat(e.id);
            if (!pushed) {
                if (e.phone) {
                    // 문구·수신번호는 서버가 대기 문서에서 만든다(2026-11-04)
                    await requestMakeupSeatSMS(e.id);
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
 * 홀딩한 날짜를 원래 수업으로 건 본인의 보강 대기를 취소한다. 취소한 건수 반환.
 * 자리 안내(notified)를 받은 대기를 취소하면 그 자리를 다음 순번에게 넘긴다.
 * 홀딩 저장(학생·코치 경로) 뒤에 부른다 — 실패해도 홀딩 자체에는 영향이 없다.
 */
export async function cancelWaitlistsForHeldDates(studentName, heldDates) {
    const mine = (await getMakeupWaitlistsByStudent(studentName)).map(normalizeWaitlistEntry);
    const targets = findWaitlistsReleasedByHolding(mine, studentName, heldDates);
    await Promise.all(targets.map(e => updateMakeupWaitlistStatus(e.id, 'cancelled')));
    targets.filter(e => e.status === 'notified')
        .forEach(e => onSeatFreed(e.date, e.day, e.period).catch(() => {}));
    return targets.length;
}

/**
 * 대기 묶음 정리 (2026-11-12) — 같은 원래 수업으로 건 다른 칸 대기를 취소한다. 취소한 대기 목록 반환.
 * 묶음 중 하나가 보강으로 확정됐을 때(자리 수락·다른 시간 보강 변경) 부른다. 맞교환은 확정 트랜잭션이 직접 정리한다.
 * 자리 안내(notified)를 받고 있던 칸은 다음 순번에게 넘긴다. 실패해도 확정된 보강에는 영향이 없다.
 */
export async function releaseSiblingWaits(entry) {
    const mine = (await getMakeupWaitlistsByStudent(entry.studentName)).map(normalizeWaitlistEntry);
    const targets = siblingWaits(entry, mine);
    await Promise.all(targets.map(e => updateMakeupWaitlistStatus(e.id, 'cancelled')));
    targets.filter(e => e.status === 'notified')
        .forEach(e => onSeatFreed(e.date, e.day, e.period).catch(() => {}));
    return targets;
}

/**
 * 백스톱 동기화 — 코치 시간표 로드 시 실제 여석 기준으로 대기열 정리.
 * 만료된 notified를 expire하고, 여석이 있으면 다음 순번에게 알린다.
 * @param {(date, day, period) => number|null} getAvailableSeats - 여석 수, 판단 불가 시 null
 */
export async function syncMakeupWaitlists(getAvailableSeats) {
    try {
        let all = (await getActiveMakeupWaitlists()).map(normalizeWaitlistEntry);
        // 원래 수업이 시작된 대기는 슬롯 여석을 모르는 주(다음 주 등)에도 취소한다.
        const now = new Date();
        const stale = all.filter(e => isReleasedByOriginalStart(e, now));
        if (stale.length) {
            await applyResolution({ toCancel: stale, toExpire: [], toNotify: [] });
            all = all.filter(e => !stale.includes(e));
        }
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
