import { firebaseConfig } from './config.js';

export const state = {
    currentUser: null,
    userPassword: null,
    isCoach: false,
    unsubscribe: null,
    recordsSubKey: null, // 기록 리스너 구독 키(사용자__날짜). 같은 키면 재구독 대신 재렌더만.
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

    // 레벨(XP) — users/{이름}에서 로그인 시 로드. 기록 저장/수정/삭제 때 증분(카운터 방식).
    xpVolume: null,   // 원시 누적 훈련량(성별 보정 전). null = 아직 미로드
    xpCoef: 1,        // 성별 계수(메인앱이 기록). 여=1.5
    grade: null,      // 현재 학년 키
    gradeSeen: null,  // 팝업으로 안내된 최고 학년(승급 판정 기준)
    editingOldVolume: 0, // 수정 모달 열 때 옛 기록 volume 보관(수정 delta 계산용)

    // UI state
    deleteMode: false
};

export let db = null;
export let firebaseInitialized = false;
// 오프라인 캐시(IndexedDB)가 실제로 켜졌는지. 켜져야 쓰기가 로컬에 durable하게 남아
// 서버 ACK를 안 기다려도 안전하다 (records.js addRecord가 이 값을 본다).
export let persistenceEnabled = false;

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
        // 오프라인 캐시. 다른 Firestore 호출보다 먼저 켜야 한다.
        // 켜지면 (1) 읽기가 로컬에서 처리되고 (2) 쓰기가 IndexedDB에 남아 탭을 닫아도 유실되지 않는다.
        // 사파리 시크릿모드 등 IndexedDB가 없으면 실패 — 그땐 캐시 없이 예전처럼 돌아간다.
        db.enablePersistence({ synchronizeTabs: true })
            .then(() => { persistenceEnabled = true; })
            .catch((e) => console.warn('⚠️ 오프라인 캐시 비활성:', e.code || e.message));
        console.log('✅ Firebase 초기화 성공');
    } else {
        console.error('❌ Firebase SDK가 로드되지 않았습니다.');
        firebaseInitialized = false;
    }

} catch (error) {
    console.error('❌ Firebase 초기화 실패:', error);
    firebaseInitialized = false;
}
