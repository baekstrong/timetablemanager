// 학년(레벨) 순수 로직 — 메인앱 src/utils/grades.js의 미러(훈련일지는 그 파일을 import 못 해 복제).
// ⚠️ 둘을 항상 같이 수정할 것. 값이 어긋나면 앱마다 레벨이 달라진다.

export const GRADES = [
    { key: 'e1', short: '초1', label: '초등 1학년', min: 0 },
    { key: 'e2', short: '초2', label: '초등 2학년', min: 1000 },
    { key: 'e3', short: '초3', label: '초등 3학년', min: 2500 },
    { key: 'e4', short: '초4', label: '초등 4학년', min: 5000 },
    { key: 'e5', short: '초5', label: '초등 5학년', min: 8000 },
    { key: 'e6', short: '초6', label: '초등 6학년', min: 13000 },
    { key: 'm1', short: '중1', label: '중등 1학년', min: 20000 },
    { key: 'm2', short: '중2', label: '중등 2학년', min: 30000 },
    { key: 'm3', short: '중3', label: '중등 3학년', min: 45000 },
    { key: 'h1', short: '고1', label: '고등 1학년', min: 65000 },
    { key: 'h2', short: '고2', label: '고등 2학년', min: 95000 },
    { key: 'h3', short: '고3', label: '고등 3학년', min: 135000 },
    { key: 'u1', short: '대1', label: '대학 1학년', min: 200000 },
    { key: 'u2', short: '대2', label: '대학 2학년', min: 280000 },
    { key: 'u3', short: '대3', label: '대학 3학년', min: 380000 },
    { key: 'u4', short: '대4', label: '대학 4학년(졸업)', min: 500000 },
];

const numVal = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };

export function gradeRank(key) {
    return GRADES.findIndex(g => g.key === key);
}

// 누적 XP → 학년(min을 넘는 가장 높은 학년).
export function xpToGrade(xp) {
    const x = Number(xp) || 0;
    let g = GRADES[0];
    for (const cand of GRADES) if (x >= cand.min) g = cand;
    return g;
}

// record(또는 {sets}) 1건의 kg×회 훈련량(성별 보정 전). src/utils/grades.js와 동일 규칙.
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
