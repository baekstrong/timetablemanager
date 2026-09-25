import './training-log-review.css';
import { createMemoryFirestore } from './trainingLogReviewFirebase.js';
import { createTrainingReviewFixtures, REVIEW_USER } from './trainingLogReviewFixtures.js';

const enabled = import.meta.env.DEV && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const status = message => { const element = document.getElementById('trainingReviewStatus'); if (element) element.textContent = message; };
const STORAGE_PREFIX = 'training-log-review:v1:';
const RESERVED = new Set(['savedUser', 'login_credentials', 'impersonation_origin', 'quickReturn', 'targetPage']);

function isolateStorage(storage, prefix) {
    const keys = () => Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(key => key?.startsWith(prefix));
    return {
        get length() { return keys().length; },
        key: index => keys()[index]?.slice(prefix.length) ?? null,
        getItem: key => RESERVED.has(String(key)) ? null : storage.getItem(`${prefix}${key}`),
        setItem: (key, value) => { if (!RESERVED.has(String(key))) storage.setItem(`${prefix}${key}`, String(value)); },
        removeItem: key => { if (!RESERVED.has(String(key))) storage.removeItem(`${prefix}${key}`); },
        clear: () => keys().forEach(key => storage.removeItem(key)),
    };
}

async function bootReview() {
    const base = import.meta.env.BASE_URL;
    const rootPath = `${base}training-log/`;
    const nativeLocal = window.localStorage;
    const nativeSession = window.sessionStorage;
    const local = isolateStorage(nativeLocal, STORAGE_PREFIX);
    const session = isolateStorage(nativeSession, STORAGE_PREFIX);
    Object.defineProperty(window, 'localStorage', { configurable: true, value: local });
    Object.defineProperty(window, 'sessionStorage', { configurable: true, value: session });

    const blocked = [];
    const nativeFetch = window.fetch.bind(window);
    const rejectNetwork = url => {
        blocked.push(String(url));
        status('검토 범위를 벗어난 연결을 차단했어요. 개발자 콘솔에서 확인할 수 있어요.');
        throw new Error(`로컬 검토에서 차단한 요청: ${url}`);
    };
    // CSP already rejects remote origins. Also reject same-origin API requests;
    // only the source HTML read below is needed by the preview bootstrap.
    window.fetch = (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input.url, location.href);
        const method = init?.method || (typeof input !== 'string' && input.method) || 'GET';
        if (url.origin !== location.origin || url.pathname !== `${rootPath}index.html` || method.toUpperCase() !== 'GET') return Promise.reject(rejectNetwork(url.href));
        return nativeFetch(input, init);
    };
    window.XMLHttpRequest = class { constructor() { rejectNetwork('XMLHttpRequest'); } };
    window.EventSource = class { constructor(url) { rejectNetwork(url); } };
    if (navigator.sendBeacon) Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: url => { rejectNetwork(url); return false; } });

    const fixtures = createTrainingReviewFixtures();
    const adapter = createMemoryFirestore(fixtures.documents);
    Object.defineProperty(window, 'firebase', { configurable: false, writable: false, value: adapter.firebase });
    window.__trainingLogReview = { user: REVIEW_USER, today: fixtures.today, db: adapter.db, operations: adapter.operations, dump: adapter.dump, blocked, storagePrefix: STORAGE_PREFIX };

    // Read only local markup. Never insert CDN scripts, preloads, PWA boot code,
    // impersonation credentials, or the production navigation script.
    const response = await fetch(`${rootPath}index.html`);
    if (!response.ok) throw new Error('실제 훈련일지 HTML을 읽지 못했습니다.');
    const source = new DOMParser().parseFromString(await response.text(), 'text/html');
    const target = document.getElementById('trainingReviewRoot');
    for (const element of source.body.children) {
        if (element.id === 'app' || element.id === 'bottomNav' || element.classList.contains('modal')) target.appendChild(document.importNode(element, true));
    }
    for (const file of ['css/tailwind.css', 'css/style.css']) {
        const link = document.createElement('link');
        link.rel = 'stylesheet'; link.href = `${rootPath}${file}`; document.head.appendChild(link);
    }
    document.body.className = source.body.className;

    if (document.readyState === 'loading') await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
    // The state module sees only our compat adapter. Pre-seeding the fictional
    // identity skips main.js's Auth.autoLogin; no account is saved or restored.
    const { state } = await import(/* @vite-ignore */ `${rootPath}js/state.js`);
    state.currentUser = REVIEW_USER;
    state.userPassword = null;
    state.isCoach = false;
    state.selectedDate = fixtures.today;
    const date = new Date(`${fixtures.today}T12:00:00`);
    state.calendarYear = date.getFullYear(); state.calendarMonth = date.getMonth();
    const mainSource = source.querySelector('script[type="module"][src^="js/main.js"]')?.getAttribute('src');
    if (!mainSource) throw new Error('실제 훈련일지 시작 스크립트를 찾지 못했습니다.');
    const mainUrl = new URL(mainSource, new URL(rootPath, location.origin));
    if (mainUrl.origin !== location.origin || mainUrl.pathname !== `${rootPath}js/main.js`) throw new Error('훈련일지 시작 스크립트 경로가 검토 범위를 벗어났습니다.');
    await import(/* @vite-ignore */ mainUrl.href);
    const reviewNavigate = page => {
        window.autoSaveFormData?.();
        if (page === 'training-log') { window.showStudentCalendar?.(); return; }
        const allowed = new Set(['today', 'schedule', 'dashboard', 'holding', 'myinfo']);
        const targetPage = allowed.has(page) ? page : 'schedule';
        location.assign(`${base}student-local-review.html?page=${encodeURIComponent(targetPage)}`);
    };
    window.bottomNavNavigate = reviewNavigate;
    window.navigateToTimetable = () => reviewNavigate('schedule');
    window.__trainingLogReview.state = state;
    await window.render();
    status('실제 훈련일지 코드 · 가상 기록 조회/저장 · 새로고침 시 리뷰 전용 초안 복구 가능');
    document.getElementById('trainingReviewReset').addEventListener('click', () => {
        local.clear(); session.clear(); location.reload();
    });
    window.__trainingLogReview.ready = true;
}

if (enabled) {
    bootReview().catch(error => { console.error('훈련일지 로컬 검토 부팅 실패:', error); status(`검토 화면을 열지 못했어요: ${error.message}`); });
} else {
    status('이 화면은 localhost의 Vite 개발 서버에서만 열 수 있습니다.');
}
