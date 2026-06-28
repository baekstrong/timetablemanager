import { state, db, firebaseInitialized } from '../state.js';
import { saveLogin, loadSavedLogin, clearSavedLogin } from '../utils.js';
import { loadPinnedExercisesFromStorage, loadArchivedMemosFromStorage, migrateLocalStorageToFirestore } from './records.js';
import { FUNCTIONS_BASE } from '../config.js';

// ============================================
// 로그인 및 인증 관련
// ============================================

export async function login() {
    const nameInput = document.getElementById('nameInput');
    const passwordInput = document.getElementById('passwordInput');
    const rememberMe = document.getElementById('rememberMe');

    if (!nameInput || !passwordInput) {
        alert('입력 필드를 찾을 수 없습니다.');
        return;
    }

    const name = nameInput.value.trim();
    const password = passwordInput.value.trim();

    if (!name || !password) {
        alert('이름과 비밀번호를 모두 입력해주세요!');
        return;
    }

    if (!firebaseInitialized || !db) {
        alert('❌ Firebase 연결 실패!\n\nconfig.js 파일의 firebaseConfig 설정을 확인해주세요.');
        return;
    }

    try {
        // 서버 로그인 시도 (커스텀 토큰)
        try {
            const res = await fetch(`${FUNCTIONS_BASE}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, password }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || '로그인 실패');
            await firebase.auth().signInWithCustomToken(data.token);
            state.isCoach = data.isCoach || false;
        } catch (serverErr) {
            // ponytail: Phase A/B 폴백 — Phase C에서 제거.
            console.warn('서버 로그인 실패, 클라 폴백:', serverErr.message);
            const userDoc = await db.collection('users').doc(name).get();
            if (!userDoc.exists) {
                alert('❌ 등록되지 않은 계정입니다. 코치에게 문의해 주세요.');
                return;
            }
            if (userDoc.data().password !== password) {
                alert('❌ 비밀번호가 올바르지 않습니다!');
                return;
            }
            state.isCoach = userDoc.data().isCoach || false;
        }

        state.currentUser = name;
        state.userPassword = password;

        // 사용자별 고정 메모 불러오기 (async)
        loadPinnedExercisesFromStorage().then(loaded => {
            state.pinnedExercises = loaded;
            if (!state.isCoach && window.updatePinnedDisplay) {
                window.updatePinnedDisplay();
            }
        });

        // 보관 메모 불러오기 (async)
        loadArchivedMemosFromStorage().then(loaded => {
            state.archivedMemos = loaded;
        });

        // 코치 로그인 시 날짜 필터 초기화
        if (state.isCoach) {
            state.selectedDate = null;
        } else {
            state.selectedDate = new Date().toISOString().split('T')[0];
        }

        // 기존 localStorage 고정 메모를 Firestore로 마이그레이션
        await migrateLocalStorageToFirestore();

        // 로그인 저장
        if (rememberMe && rememberMe.checked) {
            saveLogin(name, password, state.isCoach);
        } else {
            clearSavedLogin();
        }

        console.log('✅ 로그인 성공!');
        state.currentSets = [];
        if (window.render) window.render();
    } catch (error) {
        console.error('❌ 로그인 오류:', error);

        let errorMessage = '';

        if (error.code === 'permission-denied') {
            errorMessage = '❌ Firestore 권한 오류!\n\n해결 방법:\n1. Firebase Console 접속\n2. Firestore Database > 규칙 탭\n3. allow read, write: if true; 로 변경\n4. [게시] 버튼 클릭';
        } else {
            errorMessage = '❌ 로그인 실패\n\n' + error.message;
        }

        alert(errorMessage);
    }
}

export async function autoLogin() {
    const saved = loadSavedLogin();
    if (!saved || !firebaseInitialized || !db) return;

    try {
        try {
            const res = await fetch(`${FUNCTIONS_BASE}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: saved.name, password: saved.password }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || '자동 로그인 실패');
            await firebase.auth().signInWithCustomToken(data.token);
            state.isCoach = data.isCoach || false;
        } catch (serverErr) {
            console.warn('서버 자동로그인 실패, 클라 폴백:', serverErr.message);
            const userDoc = await db.collection('users').doc(saved.name).get();
            if (!userDoc.exists || userDoc.data().password !== saved.password) {
                clearSavedLogin();
                return;
            }
            state.isCoach = userDoc.data().isCoach || false;
        }
        state.currentUser = saved.name;
        state.userPassword = saved.password;
        state.currentSets = [];
        await migrateLocalStorageToFirestore();
        loadPinnedExercisesFromStorage().then(loaded => { state.pinnedExercises = loaded; });
        loadArchivedMemosFromStorage().then(loaded => { state.archivedMemos = loaded; });
        console.log('✅ 자동 로그인 성공!');
        if (window.render) window.render();
    } catch (error) {
        console.error('자동 로그인 실패:', error);
    }
}

export function logout() {
    if (state.unsubscribe) state.unsubscribe();
    if (state.coachMemosUnsubscribe) state.coachMemosUnsubscribe(); // 코치 메모 리스너 해제
    if (state.studentPinnedMemosUnsubscribe) state.studentPinnedMemosUnsubscribe(); // 수강생 메모 리스너 해제

    // Clear all localStorage keys used by both apps
    localStorage.removeItem('savedUser');
    localStorage.removeItem('login_credentials');

    state.currentUser = null;
    state.userPassword = null;
    state.isCoach = false;
    state.selectedStudents = [];
    state.allStudents = [];
    state.currentSets = [];
    state.pinnedExercises = []; // 고정 메모 초기화
    state.archivedMemos = []; // 보관 메모 초기화
    state.coachPinnedMemos = []; // 코치 고정 메모 초기화
    state.calendarYear = new Date().getFullYear();
    state.calendarMonth = new Date().getMonth();
    state.selectedDate = new Date().toISOString().split('T')[0];

    // Redirect to timetable app login
    window.location.href = '/timetablemanager/';
}
