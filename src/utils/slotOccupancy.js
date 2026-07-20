/**
 * 신규 등록 시간표 그리드의 슬롯별 인원수 계산 (순수 로직).
 *
 * 핵심 규칙: 각 수강생은 '앞으로 가 있을' 슬롯 기준으로 센다.
 * 미리(다음) 등록이 있으면 그 슬롯(`_nextSchedule`)을, 없으면 현재 D열(`요일 및 시간`)을 사용.
 * 신규 등록은 본질적으로 '미래 시작'이므로, 다음 달 다른 슬롯으로 옮긴 학생을
 * 오늘 활성 슬롯이 아니라 목적지 슬롯에서 세야 정원 초과 배정(만석인데 자리 있음 표시)을 막는다.
 *
 * @param {Array} students - 이름당 활성 등록 1행으로 dedup된 목록 (getAllStudentsFromAllSheets)
 * @param {Array} pendingRegistrations - Firebase 신규 신청 pending (requestedSlots 포함)
 * @param {(scheduleStr: string) => Array<{day, period}>} parse - 요일·교시 파서
 * @returns {Object} key `"요일-교시"` → 인원수
 */
export function computeSlotOccupancy(students = [], pendingRegistrations = [], parse) {
    const namesPerSlot = {}; // 슬롯별 이름 Set (중복 방지)

    const addName = (day, period, name) => {
        const key = `${day}-${period}`;
        if (!namesPerSlot[key]) namesPerSlot[key] = new Set();
        namesPerSlot[key].add(name);
    };

    students.forEach((student) => {
        const name = student['이름'];
        if (!name) return;
        // 옮겨갈 다음 슬롯이 있으면 그쪽에서 카운트, 없으면 현재 슬롯
        const scheduleStr = student._nextSchedule || student['요일 및 시간'];
        if (!scheduleStr) return;
        parse(scheduleStr).forEach(({ day, period }) => addName(day, period, name));
    });

    pendingRegistrations.forEach((reg) => {
        if (!reg.requestedSlots || !reg.name) return;
        reg.requestedSlots.forEach(({ day, period }) => addName(day, period, `__pending__${reg.name}`));
    });

    const occupancy = {};
    Object.keys(namesPerSlot).forEach((key) => {
        occupancy[key] = namesPerSlot[key].size;
    });
    return occupancy;
}
