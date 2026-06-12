import { getClassDateTime } from './scheduleUtils';

// 보강 대기 알림 응답 제한 시간 (1시간)
export const NOTIFY_WINDOW_MS = 60 * 60 * 1000;

/** notified 항목의 수락 마감 시각: min(notifiedAt + 1시간, 수업 시작 시각) */
export function getNotificationDeadline(entry) {
    const classStart = getClassDateTime(entry.date, entry.period);
    if (!classStart) return null;
    if (!entry.notifiedAtMs) return classStart;
    return new Date(Math.min(entry.notifiedAtMs + NOTIFY_WINDOW_MS, classStart.getTime()));
}

export function isNotificationExpired(entry, now = new Date()) {
    const deadline = getNotificationDeadline(entry);
    if (!deadline) return true;
    return now >= deadline;
}

/** waiting 항목에 아직 알림을 보낼 수 있는지 (수업 시작 전) */
export function canStillNotify(entry, now = new Date()) {
    const classStart = getClassDateTime(entry.date, entry.period);
    return classStart ? now < classStart : false;
}

function splitQueue(entries, now) {
    const toExpire = entries.filter(e => e.status === 'notified' && isNotificationExpired(e, now));
    const activeNotifiedCount = entries.filter(e => e.status === 'notified' && !isNotificationExpired(e, now)).length;
    const waiting = entries
        .filter(e => e.status === 'waiting' && canStillNotify(e, now))
        .sort((a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0));
    return { toExpire, activeNotifiedCount, waiting };
}

/**
 * 자리가 freedSeats개 새로 빠졌을 때 (홀딩/결석/보강취소/거절 트리거).
 * 만료된 notified가 반납한 자리도 함께 다음 순번에게 배정한다.
 * 반환: { toExpire: entry[], toNotify: entry[] }
 *
 * 호출자 계약: entries는 반드시 같은 슬롯(date+day+period)의 대기열이어야 한다.
 * 반환된 toNotify의 status는 여전히 'waiting' — 호출자가 SMS 발송 후
 * 'notified' 전환 + notifiedAt 기록을 책임진다. toExpire도 마찬가지로 'expired' 전환은 호출자 몫.
 */
export function resolveAfterSeatFreed(entries, now = new Date(), freedSeats = 1) {
    const { toExpire, waiting } = splitQueue(entries, now);
    const claimable = Math.max(0, freedSeats) + toExpire.length;
    return { toExpire, toNotify: waiting.slice(0, claimable) };
}

/**
 * 실제 여석 수(availableSeats)를 알 때 (코치 시간표 로드 백스톱).
 * 유효한 notified는 자리를 선점한 것으로 보고, 남는 자리만큼만 새로 알린다.
 */
export function resolveToTarget(entries, now = new Date(), availableSeats = 0) {
    const { toExpire, activeNotifiedCount, waiting } = splitQueue(entries, now);
    const claimable = Math.max(0, availableSeats - activeNotifiedCount);
    return { toExpire, toNotify: waiting.slice(0, claimable) };
}
