// Deterministic fictional workout data for the isolated student UX mockup.
export const exercises = {
    ...Object.fromEntries(['프론트 스쿼트', '고블릿 스쿼트', '스플릿 스쿼트', '불가리안 스플릿 스쿼트', '루마니안 데드리프트', '스모 데드리프트', '싱글 레그 데드리프트', '벤치프레스', '덤벨 벤치프레스', '인클라인 벤치프레스', '오버헤드 프레스', '덤벨 숄더 프레스', '바벨 로우', '원암 덤벨 로우', '케이블 로우', '랫 풀다운', '레그 프레스', '레그 컬', '힙 쓰러스트', '케틀벨 스윙'].map(name => [name, { unit: 'kg', repeat: '회', history: [] }])),
    스쿼트: { unit: 'kg', repeat: '회', history: [
        { date: '2026-09-23', sets: [[40, 8], [40, 8], [40, 7]] },
        { date: '2026-09-18', sets: [[40, 8], [40, 7], [40, 6]] },
        { date: '2026-09-16', sets: [[37.5, 8], [37.5, 8], [37.5, 8]] },
    ] },
    데드리프트: { unit: 'kg', repeat: '회', history: [
        { date: '2026-09-23', sets: [[50, 6], [50, 6], [50, 5]] },
        { date: '2026-09-16', sets: [[45, 8], [45, 8], [45, 8]] },
        { date: '2026-09-11', sets: [[45, 6], [45, 6], [45, 6]] },
    ] },
    푸시업: { unit: '맨몸', repeat: '회', history: [
        { date: '2026-09-23', sets: [['', 12], ['', 10], ['', 8]] },
        { date: '2026-09-18', sets: [['', 10], ['', 8], ['', 8]] },
        { date: '2026-09-16', sets: [['', 8], ['', 8], ['', 6]] },
    ] },
    플랭크: { unit: '맨몸', repeat: '초', history: [] },
};
const setText = (set, config) => `${config.unit === '맨몸' ? '맨몸' : `${set[0]}${config.unit}`} × ${set[1]}${config.repeat}`;
export const historyText = (record, config) => {
    const sameWeight = record.sets.every(set => set[0] === record.sets[0][0]);
    return sameWeight
        ? `${config.unit === '맨몸' ? '맨몸' : `${record.sets[0][0]}${config.unit}`} · ${record.sets.map(set => set[1]).join(' / ')}${config.repeat}`
        : record.sets.map(set => setText(set, config)).join(' · ');
};

const earlierDays = ['2026-08-12', '2026-08-19', '2026-08-26', '2026-09-02', '2026-09-04', '2026-09-07', '2026-09-09'].map(date => ({
    date, records: [{ exercise: '스쿼트', summary: '35kg · 8 / 8 / 8회' }, { exercise: '푸시업', summary: '맨몸 · 8 / 8 / 6회' }],
}));
const byDate = new Map(earlierDays.map(day => [day.date, day]));
for (const [exercise, config] of Object.entries(exercises)) {
    for (const record of config.history) {
        if (!byDate.has(record.date)) byDate.set(record.date, { date: record.date, records: [] });
        byDate.get(record.date).records.push({
            exercise,
            summary: historyText(record, config),
            ...(exercise === '스쿼트' && record.date === '2026-09-23' ? { feedback: '마지막 세트까지 동작이 안정적이었어요. 오늘도 같은 자세를 기억해보세요.' } : {}),
        });
    }
}
export const historicalDays = [...byDate.values()].toSorted((a, b) => a.date.localeCompare(b.date));
