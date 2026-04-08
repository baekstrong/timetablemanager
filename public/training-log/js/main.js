import * as Admin from './modules/admin.js';
import { renderLoginScreen, renderStudentScreen, renderCoachScreen, renderAdminModalHTML } from './ui.js';

import { state, db, firebaseInitialized } from './state.js';
// Import all functions to expose to window
import * as Auth from './modules/auth.js';
import * as Sets from './modules/sets.js';
import * as Records from './modules/records.js';
import * as Calendar from './modules/calendar.js';
import * as Coach from './modules/coach.js';

// ============================================
// Auto Save Logic (DOM Dependent)
// ============================================

window.autoSaveFormData = function () {
    if (!state.currentUser || state.isCoach) return;

    const formData = {
        exercise: document.getElementById('exercise')?.value || '',
        memo: document.getElementById('memo')?.value || '',
        painCheck: document.getElementById('painCheck')?.checked || false,
        sets: state.currentSets,
        timestamp: Date.now()
    };

    localStorage.setItem(`autoSave_${state.currentUser}`, JSON.stringify(formData));

    // 핀 버튼 업데이트
    updatePinButton();
}

function loadAutoSavedData() {
    if (!state.currentUser || state.isCoach) return;

    const saved = localStorage.getItem(`autoSave_${state.currentUser}`);
    if (!saved) return;

    try {
        const formData = JSON.parse(saved);
        if (Date.now() - formData.timestamp > 30 * 60 * 1000) {
            localStorage.removeItem(`autoSave_${state.currentUser}`);
            return;
        }

        if (formData.exercise || formData.memo || formData.sets.length > 0) {
            if (confirm('저장되지 않은 입력 내용이 있습니다. 복구하시겠습니까?')) {
                const exerciseEl = document.getElementById('exercise');
                if (exerciseEl) exerciseEl.value = formData.exercise;

                const memoEl = document.getElementById('memo');
                if (memoEl) memoEl.value = formData.memo;

                const painEl = document.getElementById('painCheck');
                if (painEl) painEl.checked = formData.painCheck;

                state.currentSets = formData.sets || [];
                Sets.renderSets();
            }
            localStorage.removeItem(`autoSave_${state.currentUser}`);
        }
    } catch (e) {
        console.error('Auto-save load error:', e);
    }
}

window.clearAutoSave = function () {
    if (!state.currentUser) return;
    localStorage.removeItem(`autoSave_${state.currentUser}`);
}

// Navigate back to timetable app while preserving login session
window.navigateToTimetable = function () {
    // Set a one-time flag for auto-login (using sessionStorage for single use)
    sessionStorage.setItem('quickReturn', 'true');

    // Also ensure credentials are available for auto-login
    const savedUser = localStorage.getItem('savedUser');
    if (savedUser) {
        try {
            const user = JSON.parse(savedUser);
            const credentials = {
                username: user.name,
                password: user.password,
                autoLogin: true // Enable auto-login temporarily
            };
            localStorage.setItem('login_credentials', JSON.stringify(credentials));
        } catch (err) {
            console.error('Failed to prepare credentials:', err);
        }
    }

    // Navigate back to timetable app
    window.location.href = '/timetablemanager/';
}

// ============================================
// Bottom Navigation
// ============================================

window.bottomNavNavigate = function (page) {
    if (page === 'training-log') return; // Already on this page

    // Prepare credentials for auto-login back in React app
    sessionStorage.setItem('quickReturn', 'true');
    const savedUser = localStorage.getItem('savedUser');
    if (savedUser) {
        try {
            const user = JSON.parse(savedUser);
            const credentials = {
                username: user.name,
                password: user.password,
                autoLogin: true
            };
            localStorage.setItem('login_credentials', JSON.stringify(credentials));
        } catch (err) {
            console.error('Failed to prepare credentials:', err);
        }
    }

    // Store target page so React app navigates there after auto-login
    sessionStorage.setItem('targetPage', page);
    window.location.href = '/timetablemanager/';
}

function updateBottomNav() {
    const nav = document.getElementById('bottomNav');
    if (!nav) return;

    if (!state.currentUser) {
        nav.style.display = 'none';
        return;
    }

    nav.style.display = 'flex';

    // Show/hide role-specific tabs
    const coachTabs = nav.querySelectorAll('.coach-tab');
    const studentTabs = nav.querySelectorAll('.student-tab');

    coachTabs.forEach(tab => {
        tab.style.display = state.isCoach ? 'flex' : 'none';
    });
    studentTabs.forEach(tab => {
        tab.style.display = state.isCoach ? 'none' : 'flex';
    });
}

// ============================================
// Utility / Helper UI Updates
// ============================================

window.updatePinButton = function () {
    // Button removed from UI, so this function does nothing.
    // Kept to prevent errors if called from other modules.
}

function setupCoachMemosListener() {
    if (!state.currentUser || state.isCoach || !firebaseInitialized || !db) return;

    if (state.coachMemosUnsubscribe) state.coachMemosUnsubscribe();

    state.coachMemosUnsubscribe = db.collection('coachPinnedMemos')
        .doc(state.currentUser)
        .onSnapshot((doc) => {
            if (doc.exists) {
                state.coachPinnedMemos = doc.data().memos || [];
            } else {
                state.coachPinnedMemos = [];
            }
            Records.updatePinnedDisplay();
        }, (error) => {
            console.error('❌ 코치 메모 리스너 오류:', error);
        });
}

function setupStudentPinnedMemosListener() {
    console.log('Hooking up listener for:', state.currentUser);

    if (!state.currentUser) { console.error('No currentUser'); return; }
    if (state.isCoach) { console.log('Is coach, skipping'); return; }
    if (!db) { console.error('No DB'); return; }

    console.log('Listener checks passed. Attaching to:', state.currentUser);

    if (state.studentPinnedMemosUnsubscribe) state.studentPinnedMemosUnsubscribe();

    state.studentPinnedMemosUnsubscribe = db.collection('pinnedMemos')
        .doc(state.currentUser)
        .onSnapshot((doc) => {
            if (doc.exists) {
                const data = doc.data();
                console.log('🔥 Realtime Update detected:', data);
                state.pinnedExercises = data.memos || [];

                console.log('✅ Updated state.pinnedExercises:', state.pinnedExercises);

                // 동기화: 최신 데이터를 로컬 스토리지에도 저장 (오프라인/빠른 로드용)
                localStorage.setItem(`pinnedExercises_${state.currentUser}`, JSON.stringify(state.pinnedExercises));
            } else {
                // 문서가 없으면(삭제됨) 빈 배열
                // state.pinnedExercises = []; 
                // 주의: 네트워크 오류로 일시적으로 없을 수도 있으므로 신중해야 하지만,
                // 코치/사용자가 삭제했다면 반영해야 함. 일단 유지.
            }
            Records.updatePinnedDisplay();
        }, (error) => {
            console.error('❌ 수강생 메모 리스너 오류:', error);
        });
}

window.render = async function () {
    const app = document.getElementById('app');
    if (!app) return;

    updateBottomNav();

    if (!state.currentUser) {
        app.innerHTML = renderLoginScreen();
    } else if (state.isCoach) {
        app.innerHTML = renderCoachScreen() + renderAdminModalHTML();

        // * Default Date: Set to Today
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        state.selectedDate = `${yyyy}-${mm}-${dd}`;

        const dateInput = document.getElementById('coachDateFilter');
        if (dateInput) {
            dateInput.value = state.selectedDate;
        }

        Coach.loadStudentList(); // 완료 후 내부에서 필요 시 기록/메모 로드
        Coach.setupRealtimePinnedMemosListener();
        Admin.loadExercisesList();
    } else {
        app.innerHTML = renderStudentScreen(); // Datalist already added in ui.js
        // 리스너는 즉시 설정 (Promise 아님)
        setupCoachMemosListener();
        setupStudentPinnedMemosListener(); // 실시간 내 메모(코멘트 포함) 리스너

        // Firestore 쿼리 병렬 실행
        await Promise.all([
            Records.loadMyRecords(),
            Calendar.renderCalendar(),
            Admin.loadExercisesList(), // Load exercises for Datalist
        ]);

        Records.updatePinnedDisplay();
        setTimeout(loadAutoSavedData, 100);
    }
}

// ============================================
// Window Loading & Initialization
// ============================================

async function initApp() {
    // Expose all imported module functions to window
    Object.assign(window, Auth);
    Object.assign(window, Sets);
    Object.assign(window, Records);
    Object.assign(window, Calendar);
    Object.assign(window, Coach);
    Object.assign(window, Admin);

    window.loadAutoSavedData = loadAutoSavedData; // Explicitly assign local function

    // Init logic
    state.currentSets = [];

    // 코치 모드 필터 상태를 autoLogin/render 전에 미리 복원
    // (autoLogin 내부에서 render()를 호출하므로 그 전에 설정해야 함)
    const savedMemoFilter = localStorage.getItem('coachPinnedMemoFilter');
    if (savedMemoFilter === null || savedMemoFilter === 'true') {
        state.pinnedMemoFilter = true;
    }
    if (localStorage.getItem('coachPainFilter') === 'true') {
        state.painFilter = true;
    }

    // Auto Login 먼저 시도 (render 전에 실행하여 로그인 화면 깜빡임 방지)
    if (!state.currentUser) {
        await Auth.autoLogin();
    }

    // autoLogin이 render()를 호출하지 않은 경우 (비로그인 상태) 렌더링
    if (!state.currentUser) {
        window.render();
    }

    console.log('✅ Web App Initialized (Fast Mode)');
}

// Run initialization as soon as DOM is ready, don't wait for images/stylesheets
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}
