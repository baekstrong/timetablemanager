// 보강 맞교환 (2026-11-11 사용자 결정, docs/makeup-swap-2026-11-11.md)
// 만석으로 보강 이동이 막힐 때 두 사람이 서로 자리를 바꾼다. 정원은 그대로(한 명 나가고 한 명 들어옴).
// - 보강 대기(makeupWaitlists, waiting)가 곧 '교환 요청'이다: 원래 수업 X → 원하는 칸 Y.
// - 자동 맞교환: 서로 상대 칸을 원하는 대기 두 건이 있으면 바로 확정.
// - 현황판: Y에 정규 수업이 있는 사람이 '바꾸기'를 누르면 즉시 확정(요청자는 대기를 걸며 이미 동의).
// - 두 사람 모두 보강 1회 사용, 신청 마감은 두 수업 모두 시작 2시간 전, 확정 후 취소 불가.
import { getClassDateTime } from './scheduleUtils';
import { isLiveWaitlist } from './makeupWaitlist';

export const SWAP_DEADLINE_MS = 120 * 60 * 1000;

const samePeriod = (a, b) => Number(a) === Number(b);

/** 두 수업 모두 시작 2시간 전보다 이른가 — 맞교환 마감 */
export function isSwapOpen(entry, now = new Date()) {
    const original = entry?.originalClass;
    if (!original?.date || !entry?.date) return false;
    const limit = now.getTime() + SWAP_DEADLINE_MS;
    const originalStart = getClassDateTime(original.date, Number(original.period));
    const targetStart = getClassDateTime(entry.date, Number(entry.period));
    return !!originalStart && !!targetStart && originalStart.getTime() > limit && targetStart.getTime() > limit;
}

/**
 * 맞교환 요청으로 볼 수 있는 대기 — 대기 중(waiting)이고 살아 있고 마감 전인 것.
 * 자리 안내를 받은(notified) 대기는 곧 그 자리를 수락할 수 있으므로 현황판에서 뺀다.
 * '원래 수업 빠지고 대기 유지'를 고른 대기는 원래 수업이 결석 처리돼 바꿀 자리가 없으므로 뺀다.
 */
export function isSwapRequest(entry, now = new Date()) {
    return entry?.status === 'waiting' && !entry.keepAfterOriginal && isLiveWaitlist(entry, now) && isSwapOpen(entry, now);
}

/** 이번 주 현황판 목록 — 주 범위 안의 맞교환 요청, 오래된 순 */
export function swapBoardEntries(entries = [], { weekStart, weekEnd, now = new Date() } = {}) {
    const inWeek = date => !!date && date >= weekStart && date <= weekEnd;
    return entries
        .filter(e => isSwapRequest(e, now) && inWeek(e.date) && inWeek(e.originalClass?.date))
        .sort((a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0));
}

/**
 * 새 대기와 서로 맞는 대기 — 상대의 원래 수업이 내가 원하는 칸이고, 상대가 원하는 칸이 내 원래 수업.
 * 여러 건이면 먼저 건 사람. 같은 사람끼리는 짝짓지 않는다.
 */
export function findMutualSwap(entry, entries = [], now = new Date()) {
    if (!isSwapRequest(entry, now)) return null;
    const mine = entry.originalClass;
    return entries
        .filter(e => e.id !== entry.id && e.studentName !== entry.studentName && isSwapRequest(e, now))
        .filter(e => e.originalClass?.date === entry.date && samePeriod(e.originalClass?.period, entry.period)
            && e.date === mine.date && samePeriod(e.period, mine.period))
        .sort((a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0))[0] || null;
}

/**
 * 현황판에서 내가 이 요청을 받아줄 때 내줄 내 수업 — 요청자가 원하는 칸(Y)에 있는 내 정규 수업.
 * 보강으로 들어간 수업은 내줄 수 없다(보강을 다시 옮기는 것이라 규칙이 꼬인다).
 */
export function mySessionForSwap(entry, sessions = []) {
    return sessions.find(s => s.date === entry.date && samePeriod(s.period, entry.period) && s.type === 'regular') || null;
}

/** 확정 뒤 두 사람의 보강 기록 — A: X→Y, B: Y→X */
export function buildSwapMakeups(entry, partnerName) {
    const x = pickClass(entry.originalClass);
    const y = pickClass(entry);
    return {
        requester: { studentName: entry.studentName, originalClass: x, makeupClass: y, swapWith: partnerName },
        partner: { studentName: partnerName, originalClass: y, makeupClass: x, swapWith: entry.studentName },
    };
}

function pickClass(c) {
    return { date: c.date, day: c.day, period: c.period, periodName: c.periodName };
}
