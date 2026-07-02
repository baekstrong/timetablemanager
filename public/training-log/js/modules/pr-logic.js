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
