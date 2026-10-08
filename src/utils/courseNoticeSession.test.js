import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCourseNoticeSession, courseNoticeSession, startCourseNoticeSession } from './courseNoticeSession';

const createStorage = () => {
    const values = new Map();
    return {
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: key => values.delete(key),
    };
};
afterEach(() => vi.unstubAllGlobals());

describe('종료 팝업의 앱 실행 범위', () => {
    it('훈련일지 문서 왕복은 확인을 이어 쓰고 일반 재실행은 복원된 저장소까지 초기화한다', () => {
        const storage = createStorage();
        const first = createCourseNoticeSession(() => storage);
        first.start();
        first.dismiss('수강생 A');
        const returning = createCourseNoticeSession(() => storage);
        returning.start({ resume: true });
        expect(returning.isDismissed('수강생 A')).toBe(true);
        expect(returning.isDismissed('수강생 B')).toBe(false);
        const reopened = createCourseNoticeSession(() => storage);
        reopened.start();
        expect(reopened.isDismissed('수강생 A')).toBe(false);
        returning.start({ resume: true });
        expect(returning.isDismissed('수강생 A')).toBe(false);
    });

    it('실제 시작 함수는 기존 quickReturn을 훈련일지 복귀로 처리한다', () => {
        const storage = createStorage();
        vi.stubGlobal('window', { sessionStorage: storage });
        startCourseNoticeSession();
        courseNoticeSession.dismiss('수강생 A');
        storage.setItem('quickReturn', 'true');
        startCourseNoticeSession();
        expect(courseNoticeSession.isDismissed('수강생 A')).toBe(true);
        storage.removeItem('quickReturn');
        startCourseNoticeSession();
        expect(courseNoticeSession.isDismissed('수강생 A')).toBe(false);
    });

    it('저장소가 막혀도 메뉴 이동 중에는 다시 뜨지 않고 새 실행에서 초기화한다', () => {
        const session = createCourseNoticeSession(() => { throw new Error('Storage blocked'); });
        session.start();
        session.dismiss('수강생 A');
        expect(session.isDismissed('수강생 A')).toBe(true);
        session.start();
        expect(session.isDismissed('수강생 A')).toBe(false);
    });
});
