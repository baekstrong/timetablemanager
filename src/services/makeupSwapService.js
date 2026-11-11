import { confirmMakeupSwap, getActiveMakeupWaitlists, getWeekMakeupRequests } from './firebaseService';
import { pushMakeupSwap } from './pushService';
import { normalizeWaitlistEntry } from './makeupWaitlistService';
import { buildSwapMakeups, findMutualSwap, isSwapRequest } from '../utils/makeupSwap';
import { hasMakeupQuotaLeft } from '../utils/makeupQuota';
import { getThisWeekRange } from '../utils/scheduleUtils';

/** 대기 주인이 이번 주 보강 횟수를 아직 갖고 있는가 (대기는 성공해야 1회, 2026-11-11) */
async function ownerHasQuota(entry) {
    if (!entry.weeklyLimit) return true;
    const { start, end } = getThisWeekRange(new Date(`${entry.date}T00:00:00`));
    return hasMakeupQuotaLeft(entry, await getWeekMakeupRequests(entry.studentName, start, end));
}

/**
 * 현황판에서 내가 상대의 교환 요청을 받아준다. 내 쪽 규칙(내 수업·횟수·요일)은 화면이 먼저 확인한다.
 * 확정되면 요청자에게 푸시(실패해도 교환은 유지 — 앱을 열면 시간표에 보인다).
 */
export async function acceptSwapRequest(entry, myName, now = new Date()) {
    if (!isSwapRequest(entry, now)) throw new Error('이 교환 요청은 마감되었어요.');
    if (!(await ownerHasQuota(entry))) throw new Error(`${entry.studentName}님이 이번 주 보강 횟수를 모두 써서 교환할 수 없어요.`);
    const makeups = buildSwapMakeups(entry, myName);
    const result = await confirmMakeupSwap({ waitId: entry.id, makeups });
    pushMakeupSwap(entry.id).catch(() => {});
    return { ...result, makeups };
}

/**
 * 방금 건 대기와 서로 맞는 대기가 있으면 바로 맞교환한다(자동 맞교환). 없으면 null.
 * 먼저 건 상대의 대기를 기준(요청자)으로 확정하고, 상대에게 푸시를 보낸다.
 */
export async function tryAutoSwap(newEntryId, myName, now = new Date()) {
    const all = (await getActiveMakeupWaitlists()).map(normalizeWaitlistEntry);
    const mine = all.find(e => e.id === newEntryId);
    if (!mine) return null;
    const partner = findMutualSwap(mine, all, now);
    if (!partner || !(await ownerHasQuota(partner))) return null;
    const makeups = buildSwapMakeups(partner, myName);
    const result = await confirmMakeupSwap({ waitId: partner.id, partnerWaitId: mine.id, makeups });
    pushMakeupSwap(partner.id).catch(() => {});
    return { ...result, makeups, partner };
}
