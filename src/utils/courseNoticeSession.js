const STORAGE_KEY = 'course_notice_session';

// 메뉴를 떠나도 유지하고, 별도 문서인 훈련일지에서 복귀할 때만 이어 쓴다.
export function createCourseNoticeSession(getStorage = () => window.sessionStorage) {
    let dismissedStudents = new Set();
    return {
        start({ resume = false } = {}) {
            dismissedStudents = new Set();
            try {
                const storage = getStorage();
                if (!resume) storage.removeItem(STORAGE_KEY);
                else {
                    const saved = JSON.parse(storage.getItem(STORAGE_KEY) || '[]');
                    if (Array.isArray(saved)) dismissedStudents = new Set(saved.filter(name => typeof name === 'string'));
                }
            } catch { /* 저장소를 못 쓰더라도 현재 앱의 메모리 상태는 유지한다. */ }
        },
        isDismissed(studentName) {
            return dismissedStudents.has(studentName);
        },
        dismiss(studentName) {
            if (!studentName) return;
            dismissedStudents.add(studentName);
            try { getStorage().setItem(STORAGE_KEY, JSON.stringify([...dismissedStudents])); }
            catch { /* 앱 실행 중에는 메모리로 중복 안내를 막는다. */ }
        },
    };
}

export const courseNoticeSession = createCourseNoticeSession();

export function startCourseNoticeSession() {
    let resume = false;
    try { resume = window.sessionStorage.getItem('quickReturn') === 'true'; }
    catch { /* 저장소 미지원은 새 실행으로 취급한다. */ }
    courseNoticeSession.start({ resume });
}
