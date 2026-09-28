import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { calculateMembershipStats, generateAttendanceHistory } from './googleSheetsService';
import { getMembershipHoldings, getMembershipRegistrations } from '../utils/membershipRegistrations';

const first = { 이름: '합산회원', 시작날짜: '260928', 종료날짜: '261026', 주횟수: '2', '요일 및 시간': '월4수5', '홀딩 사용여부': 'X' };
const next = { ...first, 시작날짜: '261028', 종료날짜: '261123' };
const third = { ...first, 시작날짜: '261125', 종료날짜: '261221' };
const previous = { ...first, 시작날짜: '260803', 종료날짜: '260826', '홀딩 사용여부': 'O' };
const twoMonths = { ...first, _prevRegistration: previous, _nextRegistration: next };
const threeMonths = { ...twoMonths, _upcomingRegistrations: [next, third] };

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 27, 12));
});
afterEach(() => vi.useRealTimers());

describe('현재 등록 + 미리 등록 수강 정보', () => {
    it('별도 결제한 두 달의 최종 종료일·16회·홀딩2회를 합산하고 과거 등록은 제외한다', () => {
        expect(calculateMembershipStats(twoMonths)).toMatchObject({
            startDate: '2026-09-28', endDate: '2026-11-23', registrationMonths: 2,
            totalSessions: 16, remainingSessions: 16, completedSessions: 0,
            totalHolding: 2, remainingHolding: 2, usedHolding: 0, attendanceCount: 0, totalClasses: 16,
        });
        expect(generateAttendanceHistory(twoMonths)).toEqual([]);
    });
    it('한 행의 3개월 등록도 기존대로 24회·홀딩3회다', () => {
        expect(calculateMembershipStats({ ...first, 종료날짜: '261221', '홀딩 사용여부': 'X(0/3)' }))
            .toMatchObject({ registrationMonths: 3, totalSessions: 24, remainingSessions: 24, totalHolding: 3, remainingHolding: 3 });
    });
    it('3개 행도 전부 합산하되 next 별칭을 중복 합산하지 않는다', () => {
        expect(calculateMembershipStats(threeMonths)).toMatchObject({ endDate: '2026-12-21', totalSessions: 24, totalClasses: 24, registrationMonths: 3, totalHolding: 3 });
        expect(getMembershipRegistrations(threeMonths)).toHaveLength(3);
    });
    it('다음 등록의 주횟수·홀딩 사용량·결석 메모를 각 등록 기준으로 계산한다', () => {
        vi.setSystemTime(new Date(2026, 9, 30, 12));
        const changed = { ...next, 주횟수: '3', '요일 및 시간': '월1수2금4', '홀딩 사용여부': 'X(1/2)', 특이사항: '26.11.4 결석' };
        const data = { ...first, _nextRegistration: changed };
        const sum = calculateMembershipStats(data);
        const a = calculateMembershipStats(first);
        const b = calculateMembershipStats(changed);
        expect(sum).toMatchObject({ totalSessions: 32, totalHolding: 3, remainingHolding: 2, usedHolding: 1, registrationMonths: 3 });
        expect(sum.remainingSessions).toBe(a.remainingSessions + b.remainingSessions);
        expect(sum.attendanceCount).toBe(a.attendanceCount + b.attendanceCount);
        expect(sum.attendanceCount + sum.remainingSessions).toBe(sum.totalClasses);
    });
    it('다음 등록으로 넘어가면 끝난 이전 등록을 합산하지 않는다', () => {
        vi.setSystemTime(new Date(2026, 9, 29));
        expect(calculateMembershipStats({ ...next, _prevRegistration: first, _nextRegistration: third }))
            .toMatchObject({ startDate: '2026-10-28', endDate: '2026-12-21', totalClasses: 16, totalHolding: 2 });
    });
    it('합산해도 각 등록의 종료 경계·등록 공백·결석을 출석으로 만들지 않는다', () => {
        vi.setSystemTime(new Date(2026, 10, 30));
        const delayed = { ...next, 시작날짜: '261104', 특이사항: '26.11.11 결석' };
        const history = generateAttendanceHistory({ ...first, _nextRegistration: delayed });
        const dates = history.map(record => record.date);
        expect(dates).toContain('2026-09-28');
        expect(dates).toContain('2026-11-23');
        for (const day of ['2026-10-28', '2026-11-02', '2026-11-11', '2026-11-25', '2026-11-30']) expect(dates).not.toContain(day);
        expect(new Set(history.map(r => `${r.date}/${r.period}`)).size).toBe(history.length);
    });
    it('단일 등록 종료 이후에도 출석 내역이 끝없이 늘어나지 않는다', () => {
        vi.setSystemTime(new Date(2026, 11, 31));
        expect(generateAttendanceHistory(first).every(r => r.date <= '2026-10-26')).toBe(true);
    });
    it('시트/Firebase의 같은 홀딩은 한 번만 차감하고 과거·취소·범위 밖은 제외한다', () => {
        const data = { ...twoMonths, '홀딩 사용여부': 'O', '홀딩 시작일': '261005', '홀딩 종료일': '261007' };
        const holdings = [
            { id: 'old', startDate: '2026-08-10', endDate: '2026-08-12', status: 'completed' },
            { id: 'current', startDate: '2026-10-05', endDate: '2026-10-07', status: 'completed' },
            { id: 'future', startDate: '2026-11-02', endDate: '2026-11-04', status: 'active' },
            { id: 'cancelled', startDate: '2026-11-09', endDate: '2026-11-11', status: 'cancelled' },
            { id: 'outside', startDate: '2026-12-02', endDate: '2026-12-04', status: 'active' },
        ];
        expect(getMembershipHoldings(data, holdings).map(h => h.id)).toEqual(['current', 'future']);
        expect(calculateMembershipStats(data, [], { holdings })).toMatchObject({ totalHolding: 2, usedHolding: 2, remainingHolding: 0 });
        expect(calculateMembershipStats(data)).toMatchObject({ usedHolding: 1, remainingHolding: 1 });
    });
    it('시작 전 보강일 홀딩은 원수업이 현재 등록에 속할 때만 포함한다', () => {
        const holdings = [{ startDate: '2026-09-25', endDate: '2026-09-25', status: 'active' }];
        const makeup = { originalClass: { date: '2026-09-28' }, makeupClass: { date: '2026-09-25' }, status: 'active' };
        expect(getMembershipHoldings(twoMonths, holdings)).toEqual([]);
        expect(getMembershipHoldings(twoMonths, holdings, [makeup])).toEqual(holdings);
    });
});
