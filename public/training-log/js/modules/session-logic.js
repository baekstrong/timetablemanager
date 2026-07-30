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

// 코치가 수강생을 선택했을 때 기본으로 열 세션 날짜.
// 목적이 '바로 전 수업 확인'이므로 오늘 기록은 건너뛴다 — 수업 중에 입력되고 있을 수 있어
// 오늘 것이 뜨면 지난 수업을 볼 수 없다. 오늘 기록밖에 없으면 그거라도 보여준다.
// dates는 groupSessionsByDate가 내려준 최신순 배열, today는 'YYYY-MM-DD'.
export function defaultSessionDate(dates, today) {
    if (!dates || dates.length === 0) return null;
    return dates.find(d => d < today) || dates[0];
}
