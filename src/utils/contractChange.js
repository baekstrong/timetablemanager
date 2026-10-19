// Sheets E열의 계약변경 이력. 이전 D열을 비워도 과거 시간표와 소진을 복원한다.
const TAG = /\s*\[계약변경이력:([^\]]+)\]/g;
export const readContractChange = (notes = '') => {
    const matches = [...String(notes).matchAll(TAG)];
    if (!matches.length) return null;
    try {
        const value = JSON.parse(decodeURIComponent(matches.at(-1)[1]));
        return value.v === 1 && Array.isArray(value.segments) ? value : null;
    } catch { return null; }
};
export const contractChangeNotes = (notes, value) => `${String(notes || '').replace(TAG, '').trim()}\n[계약변경이력:${encodeURIComponent(JSON.stringify(value))}]`.trim();
export const scheduleOnDate = (student, isoDate, field) => {
    const change = readContractChange(field(student, '특이사항'));
    return change?.segments.find(s => isoDate >= s.from && isoDate < s.until)?.schedule
        ?? field(student, '요일 및 시간');
};
export const contractCalculationBase = (student, field) => {
    const change = readContractChange(field(student, '특이사항'));
    const digits = String(field(student, '시작날짜') || '').replace(/\D/g, '');
    const start = digits.length === 6 ? `20${digits}` : digits;
    return change && start <= change.from.replaceAll('-', '') ? { from: change.from, consumed: change.consumed, reserved: change.reserved || 0 } : null;
};
// 시간표가 지워진 이전 행은 결제/원본 이력으로 보존하되 현재 수강권 선택에서 제외한다.
export const preferScheduledRegistrations = (rows, field) => {
    const scheduled = rows.filter(r => String(field(r, '요일 및 시간') || '').trim());
    return scheduled.length ? scheduled : rows;
};
