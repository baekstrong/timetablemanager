import { describe, expect, it } from 'vitest';
import { getHoldingClass, getHoldingRegistration, getHoldingRequestDateError, isBeforeHoldingDeadline, parseHoldingDate } from './holdingEligibility';
import { validateHoldingDates } from './holdingDates';

const date = value => new Date(`${value}T00:00:00`);
const student = {
    '시작날짜': '260901', '종료날짜': '260930', '요일 및 시간': '화5목5', '주횟수': '2',
    _prevRegistration: { '시작날짜': '260801', '종료날짜': '260828', '요일 및 시간': '월4금4', '주횟수': '2' },
    _nextRegistration: { '시작날짜': '261005', '종료날짜': '261030', '요일 및 시간': '월1수2금4', '주횟수': '3' },
};
const options = (over = {}) => ({ date: date('2026-09-17'), classInfo: getHoldingClass(date('2026-09-17'), student), requestType: 'holding', now: new Date('2026-09-17T17:49:00'), ...over });

describe('등록별 홀딩·결석 수업 자격', () => {
    it('다음 등록의 요일·교시·주횟수를 사용하며 현재 등록 요일을 만들지 않는다', () => {
        expect(getHoldingClass(date('2026-10-05'), student)).toMatchObject({ key: 'next', period: 1, weeklyFrequency: 3 });
        expect(getHoldingClass(date('2026-10-07'), student)).toMatchObject({ period: 2 });
        expect(getHoldingClass(date('2026-10-06'), student)).toBeNull();
    });
    it('이전 등록은 그 등록 일정으로 판정하고 재등록 사이 공백을 막는다', () => {
        expect(getHoldingClass(date('2026-08-24'), student)).toMatchObject({ key: 'previous', period: 4 });
        expect(getHoldingRegistration(date('2026-10-02'), student)).toBeNull();
        expect(getHoldingClass(date('2026-10-02'), student)).toBeNull();
    });
    it('다음 등록의 연속된 3개 수업은 허용하고 중간 실제 수업을 빼면 막는다', () => {
        const isClass = day => !!getHoldingClass(day, student);
        const frequency = getHoldingClass(date('2026-10-05'), student).weeklyFrequency;
        expect(validateHoldingDates(['2026-10-05', '2026-10-07', '2026-10-09'], frequency, isClass)).toBeNull();
        expect(validateHoldingDates(['2026-10-05', '2026-10-09'], frequency, isClass)).toContain('연속');
    });
    it('등록 밖 확정 보강의 실제 교시를 사용하고 원래 수업을 제외한다', () => {
        const makeups = [{ status: 'active', originalClass: { date: '2026-09-29', period: 5 }, makeupClass: { date: '2026-10-02', period: 1 } }];
        expect(getHoldingClass(date('2026-10-02'), student, makeups)).toMatchObject({ key: 'current', period: 1, weeklyFrequency: 2 });
        expect(getHoldingClass(date('2026-09-29'), student, makeups)).toBeNull();
        expect(getHoldingClass(date('2026-10-02'), student, [{ ...makeups[0], status: 'cancelled' }])).toBeNull();
    });
    it('존재하지 않는 문맥 날짜를 다음 달로 넘겨서 선택하지 않는다', () => {
        expect(parseHoldingDate('2026-02-31')).toBeNull();
        expect(parseHoldingDate('not a date')).toBeNull();
    });
});

describe('날짜 선택과 최종 확정의 공통 검증', () => {
    it.each(['추석', '코치 휴무'])('%s에는 문맥 진입도 막는다', holiday => {
        expect(getHoldingRequestDateError(options({ holiday }))).toContain('휴일');
    });
    it('이미 홀딩 또는 결석한 날짜는 양쪽 유형 모두 막는다', () => {
        for (const requestType of ['holding', 'absence']) {
            expect(getHoldingRequestDateError(options({ requestType, holdings: [{ startDate: '2026-09-15', endDate: '2026-09-17' }] }))).toContain('이미 홀딩');
            expect(getHoldingRequestDateError(options({ requestType, absences: [{ date: '2026-09-17' }] }))).toContain('이미 결석');
        }
        expect(getHoldingRequestDateError(options({ absences: [{ date: '2026-09-17', status: 'cancelled' }] }))).toBeNull();
    });
    it('확인창을 열 때 허용돼도 2시간 마감 정각에 확정하면 막는다', () => {
        expect(getHoldingRequestDateError(options())).toBeNull();
        expect(getHoldingRequestDateError(options({ now: new Date('2026-09-17T17:50:00') }))).toContain('2시간');
    });
    it('결석은 10분 전 정각에 막고 다음 등록의 실제 교시로 마감을 계산한다', () => {
        expect(getHoldingRequestDateError(options({ requestType: 'absence', now: new Date('2026-09-17T19:40:00') }))).toContain('10분');
        const next = { date: date('2026-10-05'), classInfo: getHoldingClass(date('2026-10-05'), student), now: new Date('2026-10-05T08:00:00') };
        expect(getHoldingRequestDateError(options(next))).toContain('2시간');
    });
    it('취소는 홀딩 1시간 전/결석 시작 전, 알 수 없는 교시는 허용하지 않는다', () => {
        expect(isBeforeHoldingDeadline(date('2026-10-05'), 1, 60, new Date('2026-10-05T09:00:00'))).toBe(false);
        expect(isBeforeHoldingDeadline(date('2026-10-05'), 1, 0, new Date('2026-10-05T09:59:00'))).toBe(true);
        expect(isBeforeHoldingDeadline(date('2026-10-05'), null, 0, new Date('2026-10-05T09:59:00'))).toBe(false);
    });
});
