// 순수 로직: 훈련일지 기록을 '수업(날짜)'별로 묶는다. Firebase/DOM 무관 — 브라우저·vitest 양쪽 import 가능.
// records: [{ date:'YYYY-MM-DD', ts:number(ms), ...payload }]
// 반환: { dates:[최근 날짜 먼저], byDate:{ 날짜:[기록...] (같은 날은 ts 오름차순) } }
export function groupSessionsByDate(records) {
    const byDate = {};
    for (const r of records) {
        const date = r.date || '(날짜 없음)';
        (byDate[date] = byDate[date] || []).push(r);
    }
    for (const arr of Object.values(byDate)) {
        arr.sort((a, b) => (a.ts || 0) - (b.ts || 0));
    }
    const dates = Object.keys(byDate).sort().reverse();
    return { dates, byDate };
}
