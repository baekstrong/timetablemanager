import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { serverLogin, logoutSession } from './authService';

vi.mock('../config/firebase', () => ({ auth: {} }));
vi.mock('firebase/auth', () => ({ signInWithCustomToken: vi.fn(async () => {}), signOut: vi.fn(async () => {}) }));
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function loginFor(app) {
    if (app === 'main') return () => serverLogin('synthetic', 'test');
    const source = readFileSync(new URL('../../public/training-log/js/modules/auth.js', import.meta.url), 'utf8')
        .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
    const context = vm.createContext({ AbortController, setTimeout, clearTimeout,
        fetch: (...args) => globalThis.fetch(...args), FUNCTIONS_BASE: 'https://example.invalid' });
    vm.runInContext(source, context);
    return () => vm.runInContext('requestLogin("synthetic", "test")', context);
}

it.each(['main', 'training'])('%s 인증 응답 지연은 20초에 끝나며 자동 재전송하지 않는다', async app => {
    const fetch = vi.fn((_, { signal }) => new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(Object.assign(new Error('abort'), { name: 'AbortError' })));
    }));
    vi.stubGlobal('fetch', fetch);
    const result = loginFor(app)().catch(e => e);
    await vi.advanceTimersByTimeAsync(20_000);
    expect((await result).message).toContain('응답이 늦어지고');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
});

it.each(['main', 'training'])('%s 인증 성공 시 대기 타이머를 해제한다', async app => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ success: true, token: 'synthetic', isCoach: false }) })));
    await loginFor(app)();
    expect(vi.getTimerCount()).toBe(0);
});

it('메인 로그아웃은 Firebase 인증 세션을 실제로 종료한다', async () => {
    const { signOut } = await import('firebase/auth');
    await logoutSession();
    expect(signOut).toHaveBeenCalledTimes(1);
});

function trainingAuthContext(signOut) {
    const source = readFileSync(new URL('../../public/training-log/js/modules/auth.js', import.meta.url), 'utf8')
        .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
    const context = vm.createContext({
        state: { currentUser: '가상코치', isCoach: true },
        firebase: { auth: () => ({ signOut }) },
        localStorage: { removeItem: vi.fn() }, sessionStorage: { removeItem: vi.fn() },
        window: { location: { href: 'training-log' } }, alert: vi.fn(), Date,
    });
    vm.runInContext(source, context);
    return context;
}

it('훈련일지는 인증 종료 완료 후에만 저장 세션을 지우고 이동', async () => {
    let resolve;
    const signOut = vi.fn(() => new Promise(done => { resolve = done; }));
    const context = trainingAuthContext(signOut);
    const result = vm.runInContext('logout()', context);
    expect(context.localStorage.removeItem).not.toHaveBeenCalled();
    expect(context.window.location.href).toBe('training-log');
    resolve(); await result;
    expect(context.state.currentUser).toBeNull();
    expect(context.window.location.href).toBe('/timetablemanager/');
});

it('인증 종료 실패를 로그아웃 성공으로 표시하지 않는다', async () => {
    const context = trainingAuthContext(vi.fn(async () => { throw new Error('failed'); }));
    await vm.runInContext('logout()', context);
    expect(context.alert).toHaveBeenCalled();
    expect(context.localStorage.removeItem).not.toHaveBeenCalled();
    expect(context.window.location.href).toBe('training-log');
});
