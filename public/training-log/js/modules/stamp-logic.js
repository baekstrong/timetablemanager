// 월간 도장 순수 로직 — Firebase/DOM 의존 없음 (브라우저 + vitest 양쪽에서 import 가능)

// headline = 지난달 상태(맥락), label = 격려(도장 안 짧은 문구)
export const STAMP_GRADES = {
    great:     { label: '참 잘했어요',   headline: '지난달 정말 꾸준히 나오셨어요', color: '#E94E58' },
    good:      { label: '잘하고 있어요', headline: '지난달 잘 나오고 있어요',       color: '#329BE7' },
    tryharder: { label: '더 힘내세요!',  headline: '지난달에 부족했어요',           color: '#EDBC40' },
};

export const STAMP_ORDER = ['great', 'good', 'tryharder'];

// 자동추천 등급 — 주횟수 기반. great=주횟수×3+1, good=주횟수×2.
// 예) 주2: great≥7 good≥4 / 주3: great≥10 good≥6 / 주4: great≥13 good≥8
// ponytail: 주횟수 모르면 주3 기본. 경계 바뀌면 여기 숫자만 수정.
export function suggestGrade(activeDays, weeklyFrequency = 3) {
    const f = weeklyFrequency || 3;
    if (activeDays >= f * 3 + 1) return 'great';
    if (activeDays >= f * 2) return 'good';
    return 'tryharder';
}

// 'YYYY-MM' → 지난달 범위. 1월이면 전년 12월로 롤오버.
export function prevMonthRange(monthStr) {
    const [y, m] = monthStr.split('-').map(Number);
    const py = m === 1 ? y - 1 : y;
    const pm = m === 1 ? 12 : m - 1;
    const pmStr = String(pm).padStart(2, '0');
    const lastDay = new Date(py, pm, 0).getDate(); // pm은 1-based, day 0 = 그 달 말일
    return {
        prevMonth: `${py}-${pmStr}`,
        start: `${py}-${pmStr}-01`,
        end: `${py}-${pmStr}-${String(lastDay).padStart(2, '0')}`,
    };
}

// 한 학생의 기간 내 records → 활동일/총종목/일평균
export function computeStampStats(records) {
    const days = new Set();
    for (const r of records) {
        if (r && r.date) days.add(r.date);
    }
    const activeDays = days.size;
    const totalExercises = records.length;
    const avgExercises = activeDays === 0 ? 0
        : Math.round((totalExercises / activeDays) * 10) / 10;
    return { activeDays, totalExercises, avgExercises };
}
