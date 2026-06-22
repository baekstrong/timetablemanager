// 월간 도장 순수 로직 — Firebase/DOM 의존 없음 (브라우저 + vitest 양쪽에서 import 가능)

export const STAMP_GRADES = {
    great:     { label: '참 잘했어요',   color: '#E94E58' },
    good:      { label: '잘하고 있어요', color: '#329BE7' },
    tryharder: { label: '더 힘내요!',    color: '#EDBC40' },
};

export const STAMP_ORDER = ['great', 'good', 'tryharder'];

// 자동추천 등급 — 티어 경계(13/6) 재사용
// ponytail: 경계 바뀌면 여기 숫자만 수정
export function suggestGrade(activeDays) {
    if (activeDays >= 13) return 'great';
    if (activeDays >= 6) return 'good';
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
