// Isolated, deterministic sample data. No service or persistent storage calls.
export const NOW = new Date('2026-09-24T13:00:00+09:00');
export const TODAY = '2026-09-24';
export const BASE_END = '2026-10-07';
export const TIMES = ['10:00', '12:00', '15:00', '18:00', '19:50', '21:40'];
export const DAYS = ['월', '화', '수', '목', '금'];
export const SEATS = [[3, 2, 0, 2, 3], [2, 0, 3, 1, 2], [null, null, null, null, null], [0, 2, 1, 2, 0], [2, 1, 2, 0, 2], [null, 2, null, 1, null]];
export const dateObject = value => new Date(`${value}T12:00:00+09:00`);
export const dateKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export const addDays = (value, count) => { const date = dateObject(value); date.setDate(date.getDate() + count); return dateKey(date); };
export const weekDates = week => Array.from({ length: 5 }, (_, day) => addDays('2026-09-21', week * 7 + day));
export const weekOf = date => Math.floor((dateObject(date) - dateObject('2026-09-21')) / 604800000);
export const shortDate = date => { const value = dateObject(date); return `${value.getMonth() + 1}.${value.getDate()}`; };
export const dayName = date => ['일', '월', '화', '수', '목', '금', '토'][dateObject(date).getDay()];
export const dateLabel = date => `${shortDate(date)}(${dayName(date)})`;
export const slotLabel = slot => `${dateLabel(slot.date)} ${slot.time}`;
export const slotTime = slot => new Date(`${slot.date}T${slot.time}:00+09:00`);
export const isFuture = slot => slotTime(slot) > NOW;
export const isActiveWait = item => ['waiting', 'offered'].includes(item.status);
export const isSameSlot = (a, b) => a.date === b.date && a.time === b.time;
export const initialState = () => ({ makeups: [], waits: [], breaks: [], trainingDone: false });
export function extendedEnd(holdingCount) {
    let end = BASE_END;
    for (let count = 0; count < holdingCount;) {
        end = addDays(end, 1);
        if ([3, 5].includes(dateObject(end).getDay())) count++;
    }
    return end;
}
export function getSessions(state) {
    const held = state.breaks.filter(item => item.type === 'holding').flatMap(item => item.origins);
    const absent = state.breaks.filter(item => item.type === 'absence').flatMap(item => item.origins);
    const end = extendedEnd(held.length);
    const sessions = [];
    for (let date = '2026-09-23'; date <= end; date = addDays(date, 1)) {
        if (![3, 5].includes(dateObject(date).getDay())) continue;
        const original = { date, time: '19:50' };
        const makeup = state.makeups.find(item => item.origin.date === date && item.status === 'active');
        const type = held.includes(date) ? 'holding' : absent.includes(date) ? 'absence' : makeup ? 'makeup' : 'regular';
        sessions.push({ ...original, ...(makeup ? makeup.target : {}), origin: original, type, makeupId: makeup?.id });
    }
    return sessions.sort((a, b) => slotTime(a) - slotTime(b));
}
export function quotaUsage(state, week) {
    return state.makeups.filter(item => weekOf(item.target.date) === week).length + state.waits.filter(item => isActiveWait(item) && weekOf(item.target.date) === week).length;
}
export function sourceOptions(state, week) {
    if (week !== 0) return [];
    return getSessions(state).filter(item => item.type === 'regular' && weekOf(item.date) === week && slotTime(item) - NOW >= 7200000 && !state.waits.some(wait => isActiveWait(wait) && wait.origin.date === item.date));
}
export function slotStatus(state, slot, origin) {
    const row = TIMES.indexOf(slot.time);
    const col = dateObject(slot.date).getDay() - 1;
    const seats = SEATS[row]?.[col];
    if (seats == null) return { label: '수업 없음', kind: 'off', disabled: true };
    if (slotTime(slot) <= NOW) return { label: '종료', kind: 'past', disabled: true };
    if (slotTime(slot) - NOW < 7200000) return { label: '마감', kind: 'past', disabled: true };
    if (weekOf(slot.date) !== 0) return { label: '조회만', kind: 'past', disabled: true };
    if (origin && isSameSlot(slot, origin)) return { label: '원수업', kind: 'mine', disabled: true };
    if (getSessions(state).some(item => !['holding', 'absence'].includes(item.type) && isSameSlot(slot, item))) return { label: '내 수업', kind: 'mine', disabled: true };
    if (getSessions(state).some(item => !['holding', 'absence'].includes(item.type) && item.date === slot.date && item.origin.date !== origin?.date)) return { label: '수업 있음', kind: 'mine', disabled: true };
    return { label: seats ? `${seats}자리` : '대기', kind: seats ? 'open' : 'wait', disabled: false };
}
export function holdingOptions(state, type = 'holding') {
    const deadline = type === 'absence' ? 600000 : 7200000;
    return getSessions(state).filter(item => !['holding', 'absence'].includes(item.type) && slotTime(item) - NOW >= deadline && !state.waits.some(wait => isActiveWait(wait) && wait.origin.date === item.origin.date));
}
export function consecutiveSelection(options, selected) {
    const indices = options.map((item, index) => selected.includes(item.origin.date) ? index : -1).filter(index => index >= 0);
    return indices.length <= 2 && (indices.length < 2 || indices[1] === indices[0] + 1);
}
