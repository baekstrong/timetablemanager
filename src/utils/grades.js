// 학년 = 누적 보정 훈련량(XP, kg) 버킷. 티어(tiers.js)와 동일한 형태의 순수 로직.
// min = 해당 학년 "진입" 누적 XP. 곡선은 6.5개월 실데이터로 보정한 누진 곡선(운영 손잡이).
export const GRADES = [
    { key: 'e1', short: '초1', label: '초등 1학년', group: '초등', min: 0 },
    { key: 'e2', short: '초2', label: '초등 2학년', group: '초등', min: 1000 },
    { key: 'e3', short: '초3', label: '초등 3학년', group: '초등', min: 2500 },
    { key: 'e4', short: '초4', label: '초등 4학년', group: '초등', min: 5000 },
    { key: 'e5', short: '초5', label: '초등 5학년', group: '초등', min: 8000 },
    { key: 'e6', short: '초6', label: '초등 6학년', group: '초등', min: 13000 },
    { key: 'm1', short: '중1', label: '중등 1학년', group: '중등', min: 20000 },
    { key: 'm2', short: '중2', label: '중등 2학년', group: '중등', min: 30000 },
    { key: 'm3', short: '중3', label: '중등 3학년', group: '중등', min: 45000 },
    { key: 'h1', short: '고1', label: '고등 1학년', group: '고등', min: 65000 },
    { key: 'h2', short: '고2', label: '고등 2학년', group: '고등', min: 95000 },
    { key: 'h3', short: '고3', label: '고등 3학년', group: '고등', min: 135000 },
    { key: 'u1', short: '대1', label: '대학 1학년', group: '대학', min: 200000 },
    { key: 'u2', short: '대2', label: '대학 2학년', group: '대학', min: 280000 },
    { key: 'u3', short: '대3', label: '대학 3학년', group: '대학', min: 380000 },
    { key: 'u4', short: '대4', label: '대학 4학년(졸업)', group: '대학', min: 500000 },
];

export const FEMALE_COEF = 1.5;

const numVal = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };

export function gradeByKey(key) {
    return GRADES.find(g => g.key === key) || null;
}

// 누적 XP → 학년(min을 넘는 마지막 매칭 = 가장 높은 학년). tiers.scoreToTier와 동일 패턴.
export function xpToGrade(xp) {
    const x = Number(xp) || 0;
    let g = GRADES[0];
    for (const cand of GRADES) if (x >= cand.min) g = cand;
    return g;
}

// 다음 학년까지 진척. 최상단은 next=null, pct=100.
export function gradeProgress(xp) {
    const x = Number(xp) || 0;
    const grade = xpToGrade(x);
    const idx = GRADES.indexOf(grade);
    const next = idx < GRADES.length - 1 ? GRADES[idx + 1] : null;
    if (!next) return { grade, next: null, pct: 100, remaining: 0 };
    const span = next.min - grade.min;
    const into = x - grade.min;
    return { grade, next, pct: (into / span) * 100, remaining: Math.max(0, next.min - x) };
}

// record 1건의 kg×회 훈련량(성별 보정 전). getAttendanceRanking과 동일 규칙.
export function recordVolume(record) {
    const sets = Array.isArray(record?.sets) ? record.sets : [];
    let v = 0;
    for (const s of sets) {
        if (s?.intensity?.unit === 'kg' && s?.reps?.unit === '회') {
            v += numVal(s.intensity?.value) * numVal(s.reps?.value);
        }
    }
    return v;
}

// 본인 records 전량 → 보정 누적 XP.
export function computeUserXp(records, gender) {
    const coef = (gender || '').trim().startsWith('여') ? FEMALE_COEF : 1;
    let total = 0;
    for (const r of (records || [])) total += recordVolume(r);
    return Math.round(total * coef);
}
