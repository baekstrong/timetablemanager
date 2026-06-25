// 종료일(그 주 첫 수업일) 수업을 보강으로 옮길 때의 "표시상 실질 종료일" 계산.
//
// 규칙: 종료일이 그 주 '첫 수업일'(월수면 월)인 사람이 그 종료일 수업을 보강으로 옮기면,
//       표시상 마지막 수업 = min(첫 수업 실제날짜, 두번째 수업 실제날짜).
//       - 첫 수업 실제날짜  = 종료일(또는 종료일 수업의 보강일)
//       - 두번째 수업 실제날짜 = 그 주 두번째 수업일(또는 그 수업의 보강일)
//   즉 첫 수업을 뒤로 밀어도 두번째 수업이 실제로 있는 자리까지만 인정한다.
//   (실제 종료날짜 H열은 바꾸지 않음 — 코치 시간표의 '마지막/오늘 마지막 수업' 표시 + 안내 전용)
//
// 표시 로직(useScheduleCore.getEffectiveEndDate)과 안내 메시지(StudentSchedule)가
// 이 모듈을 공유한다 — 진실원천 1개.

const DAY_NUM = { 일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6 };

// D열("월수", "화5목5금5" 등) → 정렬된 고유 요일번호 배열. 교시 숫자는 무시.
export function classDayNums(scheduleStr) {
    if (!scheduleStr || typeof scheduleStr !== 'string') return [];
    const nums = [];
    for (const ch of scheduleStr) {
        const n = DAY_NUM[ch];
        if (n != null && !nums.includes(n)) nums.push(n);
    }
    return nums.sort((a, b) => a - b);
}

// 종료일이 그 주 '첫 수업일'이면, 같은 주 '두번째 수업일'의 ISO 날짜. 아니면 null.
// (주1회 등 수업일이 1개거나, 종료일이 첫 수업일이 아니면 규칙 미적용 → null)
export function secondClassDayISO(scheduleStr, endDateISO) {
    if (!endDateISO) return null;
    const days = classDayNums(scheduleStr);
    if (days.length < 2) return null;
    const end = new Date(endDateISO + 'T00:00:00');
    if (Number.isNaN(end.getTime())) return null;
    if (end.getDay() !== days[0]) return null; // 종료일이 첫 수업일이 아니면 미적용
    const second = new Date(end);
    second.setDate(second.getDate() + (days[1] - days[0]));
    return formatISO(second);
}

// 종료일(첫 수업일) 수업을 보강으로 옮길 때의 실질 종료일 계산.
// 규칙 미적용 시 null 반환 → 호출측은 기존 로직 사용.
//
// @returns { capISO, secondActualISO, secondScheduledISO } | null
export function cappedEndForFirstClassMove({ scheduleStr, endDateISO, firstMakeupISO, secondMakeupISO }) {
    const secondScheduledISO = secondClassDayISO(scheduleStr, endDateISO);
    if (!secondScheduledISO) return null;
    const secondActualISO = secondMakeupISO || secondScheduledISO;
    const firstActualISO = firstMakeupISO || endDateISO;
    // ISO(YYYY-MM-DD) 문자열은 사전식 비교 = 날짜 비교
    const capISO = firstActualISO < secondActualISO ? firstActualISO : secondActualISO;
    return { capISO, secondActualISO, secondScheduledISO };
}

function formatISO(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}
