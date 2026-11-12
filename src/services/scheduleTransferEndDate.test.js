import { describe, it, expect } from 'vitest';
import { planInProgressScheduleTransfer, getStudentField } from './googleSheetsService';
import { contractCalculationBase, scheduleOnDate, readContractChange } from '../utils/contractChange';

// 진행 중 등록의 시간표 변경은 지난 수업을 옛 시간표로 보존해야 한다 (2026-11-12 정진주 사례).
// 예전엔 시작일부터 새 시간표로 다시 세서 옛 요일에 들은 수업이 사라지고 종료일이 늘어났다.
const student = (over = {}) => ({
    이름: '정진주', 주횟수: '2', '요일 및 시간': '화4금4', 특이사항: '',
    시작날짜: '261020', 종료날짜: '261113', '홀딩 사용여부': 'X', '홀딩 시작일': '', '홀딩 종료일': '', ...over,
});
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

describe('planInProgressScheduleTransfer', () => {
    it('옛 요일에 들은 수업을 보존한다 — 화4금4 첫 수업 뒤 월5목5로 바꾸면 11/12 종료', () => {
        // 10/20(화) 화4금4 첫 수업 → 10/21(수) 월5목5로 변경. 남은 7회: 10/22 … 11/12
        const plan = planInProgressScheduleTransfer({
            student: student(), newScheduleStr: '월5목5', now: new Date(2026, 9, 21, 12),
        });
        expect(plan.remaining).toBe(7);
        expect(iso(plan.newEnd)).toBe('2026-11-12');
        expect(plan.metadata.consumed).toBe(1);
    });

    it('E열 태그로 이후 재계산 기준과 지난 날짜 시간표를 복원한다', () => {
        const plan = planInProgressScheduleTransfer({
            student: student({ 특이사항: '허리 조심' }), newScheduleStr: '월5목5', now: new Date(2026, 9, 21, 12),
        });
        expect(plan.notes.startsWith('허리 조심 ')).toBe(true);
        expect(plan.notes).not.toContain('\n'); // 수강생 증표 E열 쓰기는 한 줄만 허용
        expect(plan.notes.length).toBeLessThanOrEqual(500);
        const after = student({ '요일 및 시간': '월5목5', 특이사항: plan.notes, 종료날짜: '261112' });
        expect(contractCalculationBase(after, getStudentField)).toEqual({ from: '2026-10-21', consumed: 1, reserved: 0 });
        expect(scheduleOnDate(after, '2026-10-20', getStudentField)).toBe('화4금4');
        expect(scheduleOnDate(after, '2026-10-22', getStudentField)).toBe('월5목5');
    });

    it('오늘 옛 수업이 끝났으면 오늘은 소진으로 보고 내일부터 새 시간표', () => {
        // 10/20(화) 19:40 — 화4(18:00~19:30) 끝남
        const plan = planInProgressScheduleTransfer({
            student: student(), newScheduleStr: '월5목5', now: new Date(2026, 9, 20, 19, 40),
        });
        expect(plan.metadata.from).toBe('2026-10-21');
        expect(iso(plan.newEnd)).toBe('2026-11-12');
    });

    it('저장된 종료일에 반영된 연장(결석·홀딩)을 보존한다', () => {
        // H가 한 회 늘어난 11/17(화)이면 남은 회차도 1회 많다 → 11/16(월)
        const plan = planInProgressScheduleTransfer({
            student: student({ 종료날짜: '261117' }), newScheduleStr: '월5목5', now: new Date(2026, 9, 21, 12),
        });
        expect(plan.remaining).toBe(8);
        expect(iso(plan.newEnd)).toBe('2026-11-16');
    });

    it('두 번째 변경은 이전 구간을 이어 붙인다', () => {
        const first = planInProgressScheduleTransfer({
            student: student(), newScheduleStr: '월5목5', now: new Date(2026, 9, 21, 12),
        });
        const second = planInProgressScheduleTransfer({
            student: student({ '요일 및 시간': '월5목5', 특이사항: first.notes, 종료날짜: '261112' }),
            newScheduleStr: '월5금5', now: new Date(2026, 10, 3, 12),
        });
        const tag = readContractChange(second.notes);
        expect(tag.segments.map(s => s.schedule)).toEqual(['화4금4', '월5목5']);
        expect(tag.segments[1]).toEqual({ from: '2026-10-21', until: '2026-11-03', schedule: '월5목5' });
        // 11/3 이후 월목으로 남은 4회(11/5·9·12 + …)를 월금으로: 11/6, 11/9, 11/13 …
        expect(second.remaining).toBe(3);
        expect(iso(second.newEnd)).toBe('2026-11-13');
    });

    it('다 들은 등록이면 계산하지 않는다', () => {
        expect(planInProgressScheduleTransfer({
            student: student(), newScheduleStr: '월5목5', now: new Date(2026, 10, 20, 12),
        })).toBeNull();
    });
});
