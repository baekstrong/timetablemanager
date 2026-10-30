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

/**
 * 옮기려던 원래 수업이 이미 시작됐는가 (2026-10-30 사용자 요청).
 * 시작된 수업은 보강으로 옮길 수 없어(수락 단계도 차단) 대기는 자동 취소 대상이다.
 * 이걸 안 거르면 수락할 수 없는 사람에게 알림이 가고 그 자리가 최대 1시간 묶인다.
 */
export function isOriginalClassStarted(entry, now = new Date()) {
    const original = entry?.originalClass;
    if (!original?.date) return false;
    const start = getClassDateTime(original.date, Number(original.period));
    return start ? now >= start : false;
}

/**
 * 원래 수업 시작으로 취소해야 하는 대기인가.
 * 수강생이 '원래 수업 빠지고 대기 유지'(keepAfterOriginal)를 골랐으면 원래 수업은 결석 처리됐고
 * 대기는 보강 수업 시작 전까지 살아 있다(2026-10-30 사용자 결정, 자리가 안 나면 그 수업은 소진).
 */
export function isReleasedByOriginalStart(entry, now = new Date()) {
    return !entry?.keepAfterOriginal && isOriginalClassStarted(entry, now);
}

/**
 * '원래 수업 빠지고 대기 유지'를 고를 수 있는가 — 원래 수업 시작 전이고,
 * 원래 수업이 보강 수업보다 먼저인 대기만(반대면 보강 수업이 먼저 끝나 고를 필요가 없다).
 */
export function canKeepAfterOriginal(entry, now = new Date()) {
    if (!entry || entry.keepAfterOriginal) return false;
    if (entry.status !== 'waiting' && entry.status !== 'notified') return false;
    const original = entry.originalClass;
    const originalStart = original?.date ? getClassDateTime(original.date, Number(original.period)) : null;
    const targetStart = getClassDateTime(entry.date, Number(entry.period));
    return !!originalStart && !!targetStart && now < originalStart && originalStart < targetStart;
}

/** 아직 살아 있는 대기인가 — 화면 표시·주간 약속 수·대기 인원 계산 공용 */
export function isLiveWaitlist(entry, now = new Date()) {
    if (isReleasedByOriginalStart(entry, now)) return false;
    if (entry.status === 'waiting') return canStillNotify(entry, now);
    return entry.status === 'notified' && !isNotificationExpired(entry, now);
}

function splitQueue(entries, now) {
    const toCancel = entries.filter(e => (e.status === 'waiting' || e.status === 'notified') && isReleasedByOriginalStart(e, now));
    const live = entries.filter(e => !toCancel.includes(e));
    const toExpire = live.filter(e => e.status === 'notified' && isNotificationExpired(e, now));
    const activeNotifiedCount = live.filter(e => e.status === 'notified' && !isNotificationExpired(e, now)).length;
    const waiting = live
        .filter(e => e.status === 'waiting' && canStillNotify(e, now))
        .sort((a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0));
    return { toCancel, toExpire, activeNotifiedCount, waiting };
}

/**
 * 자리가 freedSeats개 새로 빠졌을 때 (홀딩/결석/보강취소/거절 트리거).
 * 만료된 notified가 반납한 자리도 함께 다음 순번에게 배정한다.
 * 반환: { toCancel: entry[], toExpire: entry[], toNotify: entry[] } — toCancel은 원래 수업이 시작된 대기
 *
 * 호출자 계약: entries는 반드시 같은 슬롯(date+day+period)의 대기열이어야 한다.
 * 반환된 toNotify의 status는 여전히 'waiting' — 호출자가 SMS 발송 후
 * 'notified' 전환 + notifiedAt 기록을 책임진다. toExpire도 마찬가지로 'expired' 전환은 호출자 몫.
 */
export function resolveAfterSeatFreed(entries, now = new Date(), freedSeats = 1) {
    const { toCancel, toExpire, waiting } = splitQueue(entries, now);
    // 자리 안내를 받았다가 취소되는 대기도 쥐고 있던 자리를 반납한다.
    const released = toExpire.length + toCancel.filter(e => e.status === 'notified').length;
    const claimable = Math.max(0, freedSeats) + released;
    return { toCancel, toExpire, toNotify: waiting.slice(0, claimable) };
}

/**
 * 실제 여석 수(availableSeats)를 알 때 (코치 시간표 로드 백스톱).
 * 유효한 notified는 자리를 선점한 것으로 보고, 남는 자리만큼만 새로 알린다.
 */
export function resolveToTarget(entries, now = new Date(), availableSeats = 0) {
    const { toCancel, toExpire, activeNotifiedCount, waiting } = splitQueue(entries, now);
    const claimable = Math.max(0, availableSeats - activeNotifiedCount);
    return { toCancel, toExpire, toNotify: waiting.slice(0, claimable) };
}

/**
 * 홀딩한 날짜의 수업을 원래 수업으로 걸어둔 보강 대기 (2026-10-30 사용자 요청).
 * 그 수업을 홀딩했으면 옮길 수업 자체가 없으므로 대기는 의미가 없다 → 취소 대상.
 * 예: 목1(10/29)을 금5로 보강 대기 → 목1(10/29) 홀딩 시 금5 대기 취소.
 */
export function findWaitlistsReleasedByHolding(entries = [], studentName, heldDates = []) {
    const held = new Set(heldDates);
    return entries.filter(e =>
        e.studentName === studentName &&
        (e.status === 'waiting' || e.status === 'notified') &&
        held.has(e.originalClass?.date)
    );
}
