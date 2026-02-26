import { firebaseConfig } from './config.js';

export const state = {
    currentUser: null,
    userPassword: null,
    isCoach: false,
    unsubscribe: null,
    coachMemosUnsubscribe: null,
    studentPinnedMemosUnsubscribe: null,
    selectedDate: new Date().toISOString().split('T')[0],
    selectedStudents: [],
    allStudents: [],
    calendarYear: new Date().getFullYear(),
    calendarMonth: new Date().getMonth(),
    currentSets: [],
    editingSets: [],
    pinnedExercises: [],
    archivedMemos: [],
    coachPinnedMemos: [],
    painFilter: false,
    memoFilter: false,
    pinnedMemoFilter: false,
    recordsFilter: false,

    // UI state
    addSetCount: 1,
    addEditSetCount: 1,
    deleteMode: false
};

export let db = null;
export let firebaseInitialized = false;

// Firebase Init
try {
    if (firebaseConfig.apiKey === "YOUR_API_KEY") {
        throw new Error('Firebase 설정값이 기본값입니다.');
    }

    // Global firebase object is loaded via CDN in index.html, so we assume 'firebase' exists globally.
    // However, since we are module, we should be careful. 
    // The instructions say "Keep Firebase SDK CDN links (Global scope)".
    // So 'window.firebase' should be available.

    if (window.firebase) {
        window.firebase.initializeApp(firebaseConfig);
        db = window.firebase.firestore();
        firebaseInitialized = true;
        console.log('✅ Firebase 초기화 성공');
    } else {
        console.error('❌ Firebase SDK가 로드되지 않았습니다.');
        firebaseInitialized = false;
    }

} catch (error) {
    console.error('❌ Firebase 초기화 실패:', error);
    firebaseInitialized = false;
}
