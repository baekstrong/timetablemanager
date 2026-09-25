import { afterEach, describe, expect, it, vi } from 'vitest';
import { isStudentLiveReadRequest, installStudentLiveGuards, studentLiveInitialSelection } from './student-live-guards';

const config = { origin: 'http://localhost:5173', sheetsBase: 'https://backend.example/.netlify/functions/sheets' };
const allowed = (url, method = 'GET') => isStudentLiveReadRequest(url, method, config);

describe('실데이터 조회 전용 요청 경계', () => {
    it('Sheets 조회와 batchGet만 허용하고 쓰기·알림 서버 요청은 막는다', () => {
        expect(allowed(`${config.sheetsBase}/info`)).toBe(true);
        expect(allowed(`${config.sheetsBase}/read?range=example`)).toBe(true);
        expect(allowed(`${config.sheetsBase}/batchGet`, 'POST')).toBe(true);
        for (const path of ['write', 'batchUpdate', 'append', 'highlight', 'delete']) {
            expect(allowed(`${config.sheetsBase}/${path}`, 'POST')).toBe(false);
        }
        expect(allowed('https://backend.example/.netlify/functions/push', 'POST')).toBe(false);
        expect(allowed('https://backend.example/.netlify/functions/sms', 'POST')).toBe(false);
    });
    it('Firestore 조회 채널과 쿼리를 허용하지만 쓰기 채널·commit은 차단한다', () => {
        const base = 'https://firestore.googleapis.com';
        expect(allowed(`${base}/google.firestore.v1.Firestore/Listen/channel?RID=1`, 'POST')).toBe(true);
        expect(allowed(`${base}/v1/projects/example/databases/(default)/documents:runQuery`, 'POST')).toBe(true);
        expect(allowed(`${base}/v1/projects/example/databases/(default)/documents:batchGet`, 'POST')).toBe(true);
        expect(allowed(`${base}/google.firestore.v1.Firestore/Write/channel`, 'POST')).toBe(false);
        expect(allowed(`${base}/v1/projects/example/databases/(default)/documents:commit`, 'POST')).toBe(false);
        expect(allowed(`${base}/v1/projects/example/databases/(default)/documents:batchWrite`, 'POST')).toBe(false);
        expect(allowed(`${base}/v1/projects/example/databases/(default)/documents/posts/id`, 'PATCH')).toBe(false);
    });
    it('기존 정상 로그인·토큰 갱신은 허용하지만 계정 변경은 허용하지 않는다', () => {
        expect(allowed('https://backend.example/.netlify/functions/auth/login', 'POST')).toBe(true);
        expect(allowed('https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=example', 'POST')).toBe(true);
        expect(allowed('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=example', 'POST')).toBe(true);
        expect(allowed('https://securetoken.googleapis.com/v1/token?key=example', 'POST')).toBe(true);
        expect(allowed('https://backend.example/.netlify/functions/auth/set-password', 'POST')).toBe(false);
        expect(allowed('https://identitytoolkit.googleapis.com/v1/accounts:update', 'POST')).toBe(false);
    });
    it('로컬 API 기본 경로에서도 조회·로그인을 허용한다', () => {
        const local = { ...config, sheetsBase: 'http://localhost:5001' };
        expect(isStudentLiveReadRequest('http://localhost:5001/info', 'GET', local)).toBe(true);
        expect(isStudentLiveReadRequest('http://localhost:5001/auth/login', 'POST', local)).toBe(true);
        expect(isStudentLiveReadRequest('http://localhost:5001/batchUpdate', 'POST', local)).toBe(false);
    });
    it('명시한 API와 로컬 정적 리소스 이외의 요청은 차단한다', () => {
        expect(allowed('/src/preview/student-live-main.jsx')).toBe(true);
        expect(allowed('https://unrelated.example/read', 'GET')).toBe(false);
        expect(allowed('/.netlify/functions/sheets/write', 'POST')).toBe(false);
    });
});

describe('전송 전에 쓰기 차단', () => {
    afterEach(() => vi.unstubAllGlobals());
    it('fetch와 XHR 모두 운영 쓰기 전달을 거부한다', async () => {
        const fetch = vi.fn(async () => ({ ok: true }));
        const open = vi.fn();
        class FakeXHR { open(...args) { return open(...args); } }
        const fakeWindow = { fetch, console: { log() {}, info() {}, debug() {}, warn() {}, error() {} } };
        vi.stubGlobal('window', fakeWindow);
        vi.stubGlobal('XMLHttpRequest', FakeXHR);
        installStudentLiveGuards(config);
        await expect(fakeWindow.fetch(`${config.sheetsBase}/batchUpdate`, { method: 'POST' })).rejects.toThrow('조회 전용');
        expect(() => new FakeXHR().open('POST', 'https://firestore.googleapis.com/google.firestore.v1.Firestore/Write/channel')).toThrow('조회 전용');
        expect(fetch).not.toHaveBeenCalled();
        expect(open).not.toHaveBeenCalled();
        await fakeWindow.fetch(`${config.sheetsBase}/info`);
        new FakeXHR().open('POST', 'https://firestore.googleapis.com/google.firestore.v1.Firestore/Listen/channel');
        expect(fetch).toHaveBeenCalledOnce();
        expect(open).toHaveBeenCalledOnce();
    });
});

describe('조회할 수강생 선택', () => {
    it('학생 세션은 URL의 다른 이름을 무시하고 본인만 선택한다', () => {
        expect(studentLiveInitialSelection({ username: '본인', role: 'student' }, '다른 학생')).toBe('본인');
        expect(studentLiveInitialSelection(null, '다른 학생')).toBe('');
    });
    it('코치 세션은 URL 선택값을 사용하며 등록 명단 대조는 화면에서 수행한다', () => {
        expect(studentLiveInitialSelection({ username: '코치', role: 'coach' }, ' 선택 학생 ')).toBe('선택 학생');
    });
});
