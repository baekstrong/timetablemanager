/**
 * 신규 등록 시간표 그리드의 슬롯별 인원수 계산 (순수 로직).
 *
 * 핵심 규칙: 각 수강생은 현재 활성 시간표(D열 `요일 및 시간`) 기준으로 센다.
 * 미리 등록된 다음 시간표(`_nextSchedule`)는 아직 좌석 점유에 반영하지 않는다.
 * 코치 "신규 전용" 시간표와 같은 기준이며, pending 신규 신청만 추가로 합산한다.
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
        const scheduleStr = student['요일 및 시간'];
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
