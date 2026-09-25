import { describe, expect, it } from 'vitest';
import { buildStudentWeek, classStatusLabel, nextStudentClass, sourceUnavailableReason, studentWeekDays } from './studentClassModel';

const days = studentWeekDays({ 월: '9/21' }, 0, new Date('2026-09-24T13:00:00'));
const studentData = { 시작날짜: '260901', 종료날짜: '260930', '요일 및 시간': '수5금5' };
const origin = { date: '2026-09-25', day: '금', period: 5 };
const target = { date: '2026-09-24', day: '목', period: 4 };
const makeup = { id: 'm', status: 'active', originalClass: origin, makeupClass: target };
const build = overrides => buildStudentWeek({ days, studentData, studentName: '학생', ...overrides });

describe('실제 수강생 주간 일정', () => {
    it('등록 공백을 수업으로 만들지 않고 다음 등록의 다른 요일을 사용한다', () => {
        const data = { ...studentData, 종료날짜: '260917', _nextRegistration: { 시작날짜: '260924', 종료날짜: '261024', '요일 및 시간': '화4목4' } };
        expect(build({ studentData: data }).map(s => `${s.date}/${s.period}`)).toEqual(['2026-09-24/4']);
    });
    it('대기는 수업을 이동시키지 않고 확정 보강만 원래 수업을 이동 처리한다', () => {
        expect(build({ makeups: [{ ...makeup, status: 'waiting' }] }).map(s => s.type)).toEqual(['regular', 'regular']);
        expect(build({ makeups: [makeup] }).map(s => s.type)).toEqual(['regular', 'makeup', 'moved']);
    });
    it('취소한 보강은 제외하고 홀딩된 보강의 원래 수업은 복귀한다', () => {
        expect(build({ makeups: [{ ...makeup, status: 'cancelled' }] })).toHaveLength(2);
        const sessions = build({ makeups: [makeup], holdings: [{ startDate: target.date, endDate: target.date, status: 'active' }] });
        expect(sessions.find(s => s.date === origin.date).type).toBe('regular');
        expect(sessions.find(s => s.date === target.date).type).toBe('holding');
    });
    it('등록 밖 보강 날짜만 추가하고 사이의 정규 수업은 늘리지 않는다', () => {
        const sessions = build({ studentData: { ...studentData, 종료날짜: '260922' }, makeups: [makeup] });
        expect(sessions.map(s => s.date)).toEqual([target.date]);
    });
    it('휴일 수업도 이미 보강했다면 원수업을 다시 신청하지 못한다', () => {
        const sessions = build({ makeups: [makeup], holidays: [{ date: origin.date, reason: '휴일' }] });
        const source = sessions.find(s => s.date === origin.date);
        expect(source.type).toBe('moved');
        expect(sourceUnavailableReason(source, { now: new Date('2026-09-21T00:00:00') })).not.toBe('');
    });
    it('휴일·결석·홀딩·이동한 수업을 다음 출석 수업으로 제시하지 않는다', () => {
        const sessions = build({ holidays: [{ date: '2026-09-23', reason: '휴무' }], absences: [{ date: origin.date, studentName: '학생' }] });
        expect(sessions.map(s => s.type)).toEqual(['holiday', 'absence']);
        expect(nextStudentClass(sessions, new Date('2026-09-21T00:00:00'))).toBeNull();
    });
    it('다른 수강생의 결석과 홀딩을 본인에게 적용하지 않는다', () => {
        expect(build({ absences: [{ date: origin.date, studentName: '다른 학생' }], holdings: [{ startDate: origin.date, endDate: origin.date, studentName: '다른 학생' }] }).every(s => s.type === 'regular')).toBe(true);
    });
    it('시트의 합의 결석도 실제 다음 수업에서 제외한다', () => {
        const sessions = build({ studentData: { ...studentData, 특이사항: '26.9.23, 26.9.25 결석' } });
        expect(sessions.map(s => s.type)).toEqual(['absence', 'absence']);
        expect(nextStudentClass(sessions, new Date('2026-09-21T00:00:00'))).toBeNull();
    });
    it('시트 필드명의 공백 차이를 허용한다', () => {
        expect(build({ studentData: { 시작날짜: '260901', 종료날짜: '260930', 요일및시간: '수5금5' } })).toHaveLength(2);
    });
    it('연말 주 이동의 연도를 보존한다', () => {
        const dates = studentWeekDays({ 월: '12/28' }, 0, new Date('2027-01-01T12:00:00'));
        expect(dates[0].date).toBe('2026-12-28');
        expect(dates[4].date).toBe('2027-01-01');
        expect(studentWeekDays({ 월: '12/28' }, 1, new Date('2027-01-01T12:00:00'))[0].date).toBe('2027-01-04');
    });
    it('신청 마감과 원수업 대기를 선택 전에 설명한다', () => {
        const session = { ...origin, type: 'regular' };
        expect(sourceUnavailableReason(session, { now: new Date('2026-09-25T17:50:00') })).toContain('2시간');
        expect(sourceUnavailableReason(session, { now: new Date('2026-09-24T13:00:00'), waits: [{ status: 'waiting', originalClass: origin }] })).toContain('대기');
    });
    it('출석 대상·보강·이동·결석·홀딩을 각각 구분한다', () => {
        const now = new Date('2026-09-24T09:00:00');
        expect(['regular', 'makeup', 'moved', 'absence', 'holding', 'holiday', 'disabled', 'freeWorkoutAttendance'].map(type => classStatusLabel({ ...origin, type }, now)))
            .toEqual(['출석 예정', '보강', '보강이동', '결석', '홀딩', '휴일', '수업 없음', '출석']);
        expect(classStatusLabel({ ...origin, type: 'regular' }, new Date('2026-09-26T09:00:00'))).toBe('지난 수업');
        expect(classStatusLabel({ ...origin, type: 'makeup' }, new Date('2026-09-26T09:00:00'))).toBe('보강');
    });
    it('보강 목적지의 결석·홀딩은 원수업 상태와 구분한다', () => {
        const held = build({ makeups: [makeup], holdings: [{ startDate: target.date, endDate: target.date, status: 'active' }] });
        expect(classStatusLabel(held.find(s => s.date === target.date))).toBe('보강홀딩');
        expect(classStatusLabel(held.find(s => s.date === origin.date), new Date('2026-09-24T09:00:00'))).toBe('출석 예정');
        const absent = build({ makeups: [makeup], absences: [{ date: target.date, studentName: '학생' }] });
        expect(classStatusLabel(absent.find(s => s.date === target.date))).toBe('보강결석');
        expect(classStatusLabel(absent.find(s => s.date === origin.date))).toBe('보강이동');
        const originalHeld = build({ makeups: [makeup], holdings: [{ startDate: origin.date, endDate: origin.date, status: 'active' }] });
        expect(classStatusLabel(originalHeld.find(s => s.date === origin.date))).toBe('홀딩');
    });
    it('본인의 실제 자율운동 출석만 추가하고 고정 명단·타인 기록·다른 주는 제외한다', () => {
        const sessions = build({ freeWorkoutByDate: {
            '2026-09-21': [{ studentName: '학생', roster: true }],
            '2026-09-22': [{ studentName: '다른 학생' }],
            '2026-09-23': [{ studentName: '학생', roster: true }, { studentName: '학생' }, { studentName: '학생' }],
            '2026-09-28': [{ studentName: '학생' }],
        } });
        expect(sessions.filter(s => s.type === 'freeWorkoutAttendance').map(s => `${s.date}/${s.period}`)).toEqual(['2026-09-23/3']);
        expect(sessions.filter(s => s.date === '2026-09-23')).toHaveLength(2);
        expect(nextStudentClass(sessions, new Date('2026-09-23T09:00:00')).type).toBe('regular');
    });
});
