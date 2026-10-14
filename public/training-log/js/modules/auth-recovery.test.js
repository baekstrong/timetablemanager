import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { restoreSessionIdentity } from '../sessionRecovery.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
function harness() {
    const state = { currentUser: null };
    const controls = {};
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ success: true, token: 'synthetic', isCoach: false }) }));
    const signIn = vi.fn(async () => {}), render = vi.fn(), unsubscribe = vi.fn();
    const context = vm.createContext({ state, db: {}, firebaseInitialized: true, restoreSessionIdentity,
        loadSavedLogin: () => ({ name: 'A', password: 'synthetic', isCoach: false }),
        document: { getElementById: () => null }, window: { render },
        firebase: { auth: () => ({ onAuthStateChanged(callback, onError) { controls.callback = callback; controls.onError = onError; return unsubscribe; }, signInWithCustomToken: signIn }) },
        migrateLocalStorageToFirestore: vi.fn(async () => {}), loadPinnedExercisesFromStorage: vi.fn(async () => []), loadArchivedMemosFromStorage: vi.fn(async () => []),
        fetch, AbortController, setTimeout, clearTimeout, FUNCTIONS_BASE: 'https://example.invalid', console: { log() {}, warn() {}, error() {} } });
    const source = readFileSync(new URL('./auth.js', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
    vm.runInContext(source, context);
    return { state, controls, fetch, signIn, render, unsubscribe, run: () => vm.runInContext('autoLogin()', context) };
}
it('2.5초 뒤에 복원되는 세션도 비밀번호 재로그인 없이 계정과 역할을 검증한다', async () => {
    const h = harness(); const result = h.run();
    await vi.advanceTimersByTimeAsync(3000);
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.unsubscribe).not.toHaveBeenCalled();
    await h.controls.callback({ getIdTokenResult: async () => ({ claims: { name: 'A', isCoach: false } }) });
    await result;
    expect(h.state.currentUser).toBe('A');
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.render).toHaveBeenCalledTimes(1);
});
it('복원 시한 초과와 네트워크 오류는 비밀번호 재인증으로 확대하지 않고 재시도 안내를 남긴다', async () => {
    const h = harness(); const first = h.run();
    await vi.advanceTimersByTimeAsync(12_000); await first;
    expect(h.state.currentUser).toBeNull();
    expect(h.state.authRestoreError).toContain('다시 확인');
    expect(h.fetch).not.toHaveBeenCalled();
    const second = h.run(); h.controls.onError(new Error('network')); await second;
    expect(h.fetch).not.toHaveBeenCalled();
});
it.each([null, { getIdTokenResult: async () => ({ claims: { name: 'B', isCoach: true } }) }])('실제 세션 없음 또는 다른 계정이면 저장된 계정으로만 재인증한다', async user => {
    const h = harness(); const result = h.run(); await h.controls.callback(user); await result;
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(h.signIn).toHaveBeenCalledWith('synthetic');
    expect(h.state.currentUser).toBe('A');
    expect(h.state.isCoach).toBe(false);
});
