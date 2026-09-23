import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { TaskSection } from './TodayViews';
import { attendingNames, automaticLessonId, currentLessonId, coachTaskCategory } from './todayModel';

describe('오늘 화면 표시 규칙', () => {
    it.each([true, false])('코치 여부 %s: 모든 할 일 완료 시 제목과 여백까지 제거', coach => {
        const html = renderToStaticMarkup(createElement(TaskSection, { coach, groups: [{ id: 'a', items: [{ id: 'done', completed: true }] }] }));
        expect(html).toBe('');
    });
    it('보강 참석자는 포함하고 홀딩·결석·이동한 사람은 메모 대상에서 제외', () => {
        expect(attendingNames({ regularStudentsPresent: ['정규', '이동', '결석', '합의', '홀딩'], makeupMovedStudents: ['이동'], absenceStudents: ['결석'], agreedAbsenceStudents: ['합의'], holdingStudents: ['홀딩'], makeupStudents: ['보강', '정규'], subs: [{ name: '대타' }] })).toEqual(['정규', '보강', '대타']);
    });
    const lessons = [{ id: 1, startMinute: 600, endMinute: 690 }, { id: 4, startMinute: 1080, endMinute: 1170 }];
    it('실제 교시와 다음 수업을 분리하고 종료 경계에서 현재 강조를 해제', () => {
        expect(currentLessonId(lessons, 600)).toBe(1);
        expect(currentLessonId(lessons, 690)).toBeNull();
        expect(automaticLessonId(lessons, 690)).toBe(4);
        expect(automaticLessonId(lessons, 1170)).toBeNull();
    });
});

describe('코치 안내 우선순위', () => {
    it('신규이면서 미결제면 신규로만 분류', () => {
        expect(coachTaskCategory({ isNew: true, unpaid: true })).toBe('new');
    });
    it('재등록 대상이면서 미결제면 미결제로 분류', () => {
        expect(coachTaskCategory({ isNew: false, unpaid: true })).toBe('unpaid');
    });
    it('결제된 기존 수강생의 재등록 안내는 유지', () => {
        expect(coachTaskCategory({ isNew: false, unpaid: false })).toBe('renewal');
    });
});
