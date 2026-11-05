import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React, { createElement } from 'react';
import { TaskSection } from './TodayViews';
import { attendingNames, automaticLessonId, currentLessonId, lessonRefreshId, buildCoachTaskGroups } from './todayModel';

beforeEach(() => vi.stubGlobal('React', React));
afterEach(() => vi.unstubAllGlobals());

describe('오늘 화면 표시 규칙', () => {
    it.each([true, false])('코치 여부 %s: 모든 할 일 완료 시 제목과 여백까지 제거', coach => {
        const html = renderToStaticMarkup(createElement(TaskSection, { coach, groups: [{ id: 'a', items: [{ id: 'done', completed: true }] }] }));
        expect(html).toBe('');
    });
    it('보강 참석자는 포함하고 홀딩·결석·이동한 사람은 메모 대상에서 제외', () => {
        expect(attendingNames({ regularStudentsPresent: ['정규', '이동', '결석', '합의', '홀딩'], makeupMovedStudents: ['이동'], absenceStudents: ['결석'], agreedAbsenceStudents: ['합의'], holdingStudents: ['홀딩'], makeupStudents: ['보강', '정규'], subs: [{ name: '대타' }] })).toEqual(['정규', '보강', '대타']);
    });
    const lessons = [{ id: 1, startMinute: 600, endMinute: 690 }, { id: 4, startMinute: 1080, endMinute: 1170 }];
    it('각 수업 30분 전 경계에서만 자동 갱신 대상을 바꾼다', () => {
        expect(lessonRefreshId(lessons, 569)).toBeNull();
        expect(lessonRefreshId(lessons, 570)).toBe(1);
        expect(lessonRefreshId(lessons, 600)).toBe(1);
        expect(lessonRefreshId(lessons, 690)).toBe(1);
        expect(lessonRefreshId(lessons, 1049)).toBe(1);
        expect(lessonRefreshId(lessons, 1050)).toBe(4);
        expect(lessonRefreshId(lessons, 1170)).toBe(4);
        expect(lessonRefreshId([], 1050)).toBeNull();
        expect(currentLessonId(lessons, 570)).toBeNull();
    });
    it('실제 교시와 다음 수업을 분리하고 종료 경계에서 현재 강조를 해제', () => {
        expect(currentLessonId(lessons, 600)).toBe(1);
        expect(currentLessonId(lessons, 690)).toBeNull();
        expect(automaticLessonId(lessons, 690)).toBe(4);
        expect(automaticLessonId(lessons, 1170)).toBeNull();
    });
});

describe('코치 첫 화면 종료 안내', () => {
    const last = { name: '마지막 신규', schedule: '월1금1', payment: '39', todayPeriod: 1 };
    const expired = { name: '종료 미결제', schedule: '화2목2', payment: '31', endDate: '9/30' };
    const unpaid = name => ({ 이름: name, 결제유무: 'X', _foundSheetName: '시트', _rowIndex: 2 });
    it('마지막 수업·미재등록 두 목록만 만들고 진행 중 미결제는 목록에서 제외한다', () => {
        const groups = buildCoachTaskGroups({ lastDayStudents: [last], delayedStudents: [expired], unpaidRows: [unpaid('진행 중 미결제')] });
        expect(groups.map(group => group.title)).toEqual(['오늘 마지막 수업', '수강 종료·미재등록']);
        expect(groups.flatMap(group => group.items).map(item => item.name)).toEqual([last.name, expired.name]);
    });
    it('신규/미결제 마지막 수업도 안내를 유지하고 결제 확인을 함께 제공한다', () => {
        const row = unpaid(last.name);
        const item = buildCoachTaskGroups({ lastDayStudents: [last], unpaidRows: [row] })[0].items[0];
        expect(item).toMatchObject({ type: 'renewal', actionLabel: '재등록', unpaid: true, paymentAction: { type: 'payment', student: row } });
    });
    it('종료 미결제는 재등록과 선택 등록의 결제 확인을 모두 제공한다', () => {
        const row = unpaid(expired.name);
        const item = buildCoachTaskGroups({ delayedStudents: [expired], unpaidRows: [row], periodFor: () => 2 })[1].items[0];
        expect(item).toMatchObject({ type: 'renewal', period: 2, description: '종료: 9/30', unpaid: true, paymentAction: { student: row } });
        const html = renderToStaticMarkup(createElement(TaskSection, { coach: true, groups: [{ id: 'delayed', title: '수강 종료·미재등록', items: [item] }] }));
        expect(html).toContain('미결제');
        expect(html).toContain('종료 미결제 결제 확인');
        expect(html).toContain('재등록</button>');
    });
    it('과거 결제된 종료 등록에 미결제 표시를 붙이지 않고 중복 이름을 합친다', () => {
        const groups = buildCoachTaskGroups({ delayedStudents: [expired, expired] });
        expect(groups[1].items).toHaveLength(1);
        expect(groups[1].items[0].unpaid).toBeUndefined();
        expect(groups[1].items[0].paymentAction).toBeUndefined();
    });
    it('대상이 없으면 첫 화면 업무 영역을 숨긴다', () => {
        const groups = buildCoachTaskGroups({ unpaidRows: [unpaid('진행 중')] });
        expect(renderToStaticMarkup(createElement(TaskSection, { coach: true, groups }))).toBe('');
    });
});
