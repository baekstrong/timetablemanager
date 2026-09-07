// 외부 신규 신청 페이지와 신규 대기 여석 판정이 코치 "신규 전용" 화면과
// 같은 현재 시간표 점유 계산(computeSlotOccupancy)을 쓰는지 고정하는 회귀 테스트.
// 이 저장소엔 jsdom·testing-library가 없어 소스 배선을 직접 확인한다.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

const read = (file) => readFileSync(new URL(file, import.meta.url), 'utf8');
const core = read('./schedule/useScheduleCore.js');
const weeklySchedule = read('./WeeklySchedule.jsx');
const registration = read('./NewStudentRegistration.jsx');

describe('신규 여석 — 코치 신규 전용의 현재 시간표 기준', () => {
    it('공용 점유 계산에 학생·pending·시간표 파서를 함께 전달한다', () => {
        expect(core).toContain("import { computeSlotOccupancy } from '../../utils/slotOccupancy'");
        expect(core).toMatch(
            /computeSlotOccupancy\(students \|\| \[\], pendingRegistrations, parseScheduleString\)/
        );
    });

    it('외부 신규 신청 페이지도 같은 공용 점유 계산을 사용한다', () => {
        expect(registration).toContain("import { computeSlotOccupancy } from '../utils/slotOccupancy'");
        expect(registration).toMatch(
            /computeSlotOccupancy\(students, pendingRegistrations, parseScheduleString\)/
        );
    });

    it('코치 신규 전용은 공용 현재 점유율로 여석을 계산한다', () => {
        expect(core).toContain('currentCount = newStudentSlotOccupancy[`${day}-${periodObj.id}`] || 0');
        expect(core).not.toContain('currentCount = studentNames.length + pendingForSlot.length');
    });

    it('신규 대기 여석 판정도 동일한 현재 점유율을 사용한다', () => {
        expect(weeklySchedule).toMatch(
            /checkWaitlistAvailability\(\s*newStudentWaitlist, newStudentSlotOccupancy, disabledClasses, MAX_CAPACITY\s*\)/
        );
        expect(weeklySchedule).not.toContain('scheduleData.regularEnrollments에서 슬롯 점유율 계산');
    });
});
