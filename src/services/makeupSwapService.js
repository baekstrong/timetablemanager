import { confirmMakeupSwap, getActiveMakeupWaitlists, getWeekMakeupRequests } from './firebaseService';
import { pushMakeupSwap } from './pushService';
import { normalizeWaitlistEntry, onSeatFreed } from './makeupWaitlistService';
import { buildSwapMakeups, findMutualSwap, isSwapRequest, siblingWaits } from '../utils/makeupSwap';
import { hasMakeupQuotaLeft } from '../utils/makeupQuota';
import { getThisWeekRange } from '../utils/scheduleUtils';

/** 이 사람이 그 주 보강 횟수를 아직 갖고 있는가 (대기는 성공해야 1회, 2026-11-11). 한도를 모르면 막지 않는다. */
async function hasQuota(studentName, weeklyLimit, date) {
    if (!weeklyLimit) return true;
    const { start, end } = getThisWeekRange(new Date(`${date}T00:00:00`));
    return hasMakeupQuotaLeft({ weeklyLimit }, await getWeekMakeupRequests(studentName, start, end));
}

const loadActive = async () => (await getActiveMakeupWaitlists()).map(normalizeWaitlistEntry);

/** 확정 트랜잭션이 취소한 묶음 대기 중 자리 안내 중이던 칸은 다음 순번에게 넘긴다(실패해도 교환은 유지). */
function passFreedSeats(result) {
    for (const slot of result?.freedSlots || []) {
        onSeatFreed(slot.date, slot.day, Number(slot.period)).catch(() => {});
    }
}

/**
 * 현황판에서 내가 상대의 교환 요청을 받아준다. 내 쪽 규칙(내 수업·요일·홀딩)은 화면이 먼저 확인한다.
 * 확정 직전에 두 사람의 남은 보강 횟수를 최신 이력으로 다시 확인한다(2026-11-12).
 * 같은 원래 수업의 다른 대기(묶음)는 확정 트랜잭션에서 함께 취소된다.
 * 확정되면 요청자에게 푸시(실패해도 교환은 유지 — 앱을 열면 시간표에 보인다).
 * @param {{ myLimit?: number }} opts - 내 주간 보강 한도
 */
export async function acceptSwapRequest(entry, myName, now = new Date(), { myLimit = 0 } = {}) {
    if (!isSwapRequest(entry, now)) throw new Error('이 교환 요청은 마감되었어요.');
    const [ownerOk, mineOk, all] = await Promise.all([
        hasQuota(entry.studentName, entry.weeklyLimit, entry.date),
        hasQuota(myName, myLimit, entry.date),
        loadActive(),
    ]);
    if (!ownerOk) throw new Error(`${entry.studentName}님이 이번 주 보강 횟수를 모두 써서 교환할 수 없어요.`);
    if (!mineOk) throw new Error('이번 주 보강 횟수를 모두 사용해서 교환할 수 없어요.');
    const makeups = buildSwapMakeups(entry, myName);
    const cancelIds = siblingWaits(entry, all, now).map(e => e.id);
    const result = await confirmMakeupSwap({ waitId: entry.id, makeups, cancelIds });
    passFreedSeats(result);
    pushMakeupSwap(entry.id).catch(() => {});
    return { ...result, makeups };
}

/**
 * 방금 건 대기와 서로 맞는 대기가 있으면 바로 맞교환한다(자동 맞교환). 없으면 null.
 * 먼저 건 상대의 대기를 기준(요청자)으로 확정하고, 상대에게 푸시를 보낸다.
 * 두 사람 각자의 대기 묶음(같은 원래 수업의 다른 칸)은 함께 취소된다.
 */
export async function tryAutoSwap(newEntryId, myName, now = new Date()) {
    const all = await loadActive();
    const mine = all.find(e => e.id === newEntryId);
    if (!mine) return null;
    const partner = findMutualSwap(mine, all, now);
    if (!partner) return null;
    const [partnerOk, mineOk] = await Promise.all([
        hasQuota(partner.studentName, partner.weeklyLimit, partner.date),
        hasQuota(myName, mine.weeklyLimit, mine.date),
    ]);
    if (!partnerOk || !mineOk) return null;
    const makeups = buildSwapMakeups(partner, myName);
    const cancelIds = [...siblingWaits(partner, all, now), ...siblingWaits(mine, all, now)].map(e => e.id);
    const result = await confirmMakeupSwap({ waitId: partner.id, partnerWaitId: mine.id, makeups, cancelIds });
    passFreedSeats(result);
    pushMakeupSwap(partner.id).catch(() => {});
    return { ...result, makeups, partner };
}
