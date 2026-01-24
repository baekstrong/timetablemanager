import * as Admin from './modules/admin.js';
import { renderLoginScreen, renderStudentScreen, renderCoachScreen, renderAdminModalHTML, renderNoticeModalHTML, renderNoticePopupHTML } from './ui.js';

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
    window.location.href = '/';
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

window.render = function () {
    const app = document.getElementById('app');
    if (!app) return;

    if (!state.currentUser) {
        app.innerHTML = renderLoginScreen();
    } else if (state.isCoach) {
        app.innerHTML = renderCoachScreen() + renderAdminModalHTML() + renderNoticeModalHTML(); // Admin & Notice Modal Added

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

        Coach.loadStudentList();
        Coach.setupRealtimePinnedMemosListener(); // Real-time listener initiation
        Coach.loadAllRecords(); // Will load today's records by default now
        Admin.loadExercisesList(); // Load exercises for Admin UI
    } else {
        app.innerHTML = renderStudentScreen(); // Datalist already added in ui.js
        Records.loadMyRecords();
        Calendar.renderCalendar();
        Calendar.renderCalendar();
        setupCoachMemosListener();
        setupStudentPinnedMemosListener(); // 실시간 내 메모(코멘트 포함) 리스너
        Records.updatePinnedDisplay();
        setTimeout(loadAutoSavedData, 100);
        Admin.loadExercisesList(); // Load exercises for Datalist
        checkAndShowNotice(); // Check for announcements
    }
}

// ============================================
// Notice Logic (Student Side)
// ============================================

async function checkAndShowNotice() {
    if (!state.currentUser || state.isCoach || !db) return;

    try {
        const doc = await db.collection('notices').doc('shared').get();
        if (!doc.exists) return;

        const notice = doc.data();
        if (!notice.isVisible) return;

        const today = new Date().toISOString().split('T')[0];
        if (today < notice.startDate || today > notice.endDate) return;

        // "오늘 하루 보지 않기" 체크 확인
        const lastSeenDate = localStorage.getItem(`notice_hidden_${state.currentUser}`);
        if (lastSeenDate === today) return;

        // 팝업 렌더링
        const popupHTML = renderNoticePopupHTML(notice);
        if (popupHTML) {
            const app = document.getElementById('app');
            // 기존 팝업이 있다면 제거 (중복 방지)
            const existingPopup = document.getElementById('studentNoticePopup');
            if (existingPopup) existingPopup.remove();

            app.insertAdjacentHTML('beforeend', popupHTML);
        }

    } catch (error) {
        console.error('Error checking notice:', error);
    }
}

window.closeNoticePopup = function () {
    const checkbox = document.getElementById('dontShowToday');
    if (checkbox && checkbox.checked) {
        const today = new Date().toISOString().split('T')[0];
        localStorage.setItem(`notice_hidden_${state.currentUser}`, today);
    }

    const popup = document.getElementById('studentNoticePopup');
    if (popup) {
        popup.remove();
    }
}



// ... (existing autoSave and utilities)

// ============================================
// Window Loading & Initialization
// ============================================

// ============================================
// Window Loading & Initialization
// ============================================

function initApp() {
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

    // Render Initial Screen
    window.render();

    // Auto Login (No delay needed if Firebase is initialized)
    if (!state.currentUser) {
        Auth.autoLogin();
    }

    console.log('✅ Web App Initialized (Fast Mode)');
}

// Run initialization as soon as DOM is ready, don't wait for images/stylesheets
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}
