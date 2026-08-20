// 개인 기록(PR) 판정 순수 로직 — Firebase/DOM 의존 없음 (브라우저·Vitest 양쪽 import 가능)
// sets 형태: [{ intensity: { value, unit }, reps: { value, unit } }, ...]

function maxWeightKg(sets) {
    let m = -Infinity;
    for (const s of sets || []) {
        if (s?.intensity?.unit === 'kg') {
            const w = parseFloat(s.intensity.value);
            if (!isNaN(w)) m = Math.max(m, w);
        }
    }
    return m;
}

function maxReps(sets) {
    let m = -Infinity;
    for (const s of sets || []) {
        const r = parseFloat(s?.reps?.value);
        if (!isNaN(r)) m = Math.max(m, r);
    }
    return m;
}

// 스냅샷 문서들([{id, sets}])에서 비교용 과거 세트를 모은다.
// excludeId = 방금 저장한 문서. PR 판정 읽기는 저장 쓰기와 동시에 출발하므로 서버에 늦게 닿으면
// 새 기록이 결과에 섞인다 → 자기 자신과 비교해 신기록이 영원히 안 잡힌다. id로 빼서 그 레이스를 없앤다.
export function pastSetsFrom(docs, excludeId = null) {
    const out = [];
    for (const d of docs || []) {
        if (!d || (excludeId && d.id === excludeId)) continue;
        for (const s of d.sets || []) out.push(s);
    }
    return out;
}

// 과거 기록이 하나도 없으면(비교 대상 없음) null → 그 종목 첫 기록은 축하하지 않음.
// 새 최고 무게(kg) 또는 새 최다 반복(회/초)이면 PR 반환.
export function evaluatePR(pastSets, newSets) {
    if (!(pastSets && pastSets.length)) return null;

    const pastW = maxWeightKg(pastSets), pastR = maxReps(pastSets);
    const newW = maxWeightKg(newSets), newR = maxReps(newSets);

    const weightPR = newW > -Infinity && pastW > -Infinity && newW > pastW;
    const repsPR = newR > -Infinity && pastR > -Infinity && newR > pastR;
    if (!weightPR && !repsPR) return null;

    return { weightPR, repsPR, weight: newW, reps: newR };
}
