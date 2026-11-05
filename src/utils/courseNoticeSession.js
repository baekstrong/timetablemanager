const STORAGE_KEY = 'course_notice_session';

// 메뉴를 떠나도 유지하고, 별도 문서인 훈련일지에서 복귀할 때만 이어 쓴다.
export function createCourseNoticeSession(getStorage = () => window.sessionStorage, storageKey = STORAGE_KEY) {
    let dismissedStudents = new Set();
    return {
        start({ resume = false } = {}) {
            dismissedStudents = new Set();
            try {
                const storage = getStorage();
                if (!resume) storage.removeItem(storageKey);
                else {
                    const saved = JSON.parse(storage.getItem(storageKey) || '[]');
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
            try { getStorage().setItem(storageKey, JSON.stringify([...dismissedStudents])); }
            catch { /* 앱 실행 중에는 메모리로 중복 안내를 막는다. */ }
        },
    };
}

export const courseNoticeSession = createCourseNoticeSession();
// 재등록 계약서 팝업: 계약서 id별로 '나중에'를 앱 실행 동안만 기억한다(재접속하면 다시 뜬다).
export const contractNoticeSession = createCourseNoticeSession(undefined, 'contract_notice_session');

export function startCourseNoticeSession() {
    let resume = false;
    try { resume = window.sessionStorage.getItem('quickReturn') === 'true'; }
    catch { /* 저장소 미지원은 새 실행으로 취급한다. */ }
    courseNoticeSession.start({ resume });
    contractNoticeSession.start({ resume });
}
