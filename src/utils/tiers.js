// 티어 = 지난달 "활동일 수"(고유 날짜) 버킷.
// 활동일 = 훈련일지 기록일 ∪ 자율운동일. 실제 운동 기록이 있는 날만 인정한다
// (예정 수업일이라도 그날 기록이 없으면 불인정 — 결석신청 없이 안 나오는 노쇼 제외).
// 경계값(min)은 운영하며 조정하는 손잡이 — 주2회 기록이 '성실'에 안착하도록 잡음.

// 높은 티어가 배열 앞. scoreToTier는 위에서부터 첫 매칭을 고름.
export const TIERS = [
    { key: 'iron', label: '철인', emoji: '🔥', min: 17, color: '#242428' },
    { key: 'core', label: '코어', emoji: '💎', min: 13, color: '#A16207' }, // 진한 골드: 연한 뱃지 배경 위에서도 글자 읽히게(밝은 #EDBC40은 대비 부족)
    { key: 'passion', label: '열정', emoji: '🥇', min: 9, color: '#31A552' },
    { key: 'steady', label: '성실', emoji: '🥈', min: 6, color: '#329BE7' },
    { key: 'rookie', label: '입문', emoji: '🥉', min: 0, color: '#A7A7AA' },
];

const ORDER = ['rookie', 'steady', 'passion', 'core', 'iron']; // 낮은→높은

export function scoreToTier(score) {
    const s = Number(score) || 0;
    return TIERS.find(t => s >= t.min) || TIERS[TIERS.length - 1];
}

export function tierByKey(key) {
    return TIERS.find(t => t.key === key) || null;
}

// 승급(+1) / 강등(-1) / 유지(0). 알 수 없으면 0.
export function compareTiers(prevKey, nextKey) {
    const a = ORDER.indexOf(prevKey);
    const b = ORDER.indexOf(nextKey);
    if (a < 0 || b < 0) return 0;
    return Math.sign(b - a);
}

// 고유 활동일 수 = 실제 운동 증거가 있는 날만(훈련일지 기록 ∪ 자율운동).
// 예정 수업일이라도 그날 기록이 없으면 인정하지 않는다(결석신청 없이 안 나오는 노쇼 제외).
export function computeActiveScore({ recordDates, freeDates } = {}) {
    const days = new Set();
    recordDates?.forEach(d => days.add(d));
    freeDates?.forEach(d => days.add(d));
    return days.size;
}
