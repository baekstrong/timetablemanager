import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { expect, it, vi } from 'vitest';

// Exercise the real login wiring with a controller/DOM adapter instead of
// contacting Firebase or the production reminder endpoint.
function harness({ storageUnavailable = false } = {}) {
    const state = { currentUser: null, isCoach: false };
    const controllers = [];
    const loaders = [];
    const dialogs = [];
    const token = vi.fn(async () => ({ token: 'test-token', claims: { name: state.currentUser, isCoach: true } }));
    let authChanged;
    const unsubscribeAuth = vi.fn();
    const auth = { currentUser: { getIdTokenResult: token }, onIdTokenChanged(callback) { authChanged = callback; return unsubscribeAuth; } };
    let pushMessage;
    const removePushMessage = vi.fn();
    const window = { firebase: { auth: () => auth }, bottomNavNavigate: vi.fn(), navigator: { serviceWorker: {
        addEventListener(type, callback) { if (type === 'message') pushMessage = callback; },
        removeEventListener: removePushMessage,
    } } };
    Object.defineProperty(window, 'localStorage', { get() {
        if (storageUnavailable) throw new Error('storage unavailable');
        return {};
    } });
    const context = vm.createContext({ state, window, document: {}, FUNCTIONS_BASE: 'https://example.test/.netlify/functions',
        createCoachReminderLoader(options) {
            loaders.push(options);
            return async () => ({ date: '2026-10-16', lessons: [] });
        },
        createCoachReminderController(options) {
            const cleanup = vi.fn();
            const controller = { options, start: vi.fn(() => cleanup), dismiss: vi.fn(), refresh: vi.fn(), cleanup };
            controllers.push(controller);
            return controller;
        },
        makeDialog(options) {
            const dialog = { options, show: vi.fn(), hide: vi.fn() };
            dialogs.push(dialog);
            return dialog;
        },
    });
    const source = readFileSync(new URL('./coachRenewalReminder.js', import.meta.url), 'utf8')
        .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
    vm.runInContext(source, context);
    vm.runInContext('createCoachReminderDialog = makeDialog', context);
    const run = code => vm.runInContext(code, context);
    return { state, controllers, loaders, dialogs, window, auth, token, run, unsubscribeAuth, authChanged: user => authChanged(user),
        pushMessage: data => pushMessage?.({ data }), removePushMessage };
}

it('비로그인·수강생 화면에는 시작하지 않고, 코치 재렌더에는 같은 controller를 유지한다', () => {
    const h = harness();
    h.run('syncCoachRenewalReminder()');
    h.state.currentUser = '가상수강생';
    h.run('syncCoachRenewalReminder()');
    expect(h.controllers).toHaveLength(0);
    h.state.currentUser = '가상코치';
    h.state.isCoach = true;
    h.run('syncCoachRenewalReminder(); syncCoachRenewalReminder()');
    expect(h.controllers).toHaveLength(1);
    expect(h.controllers[0].start).toHaveBeenCalledTimes(1);
    expect(h.controllers[0].options.coachName).toBe('가상코치');
});

it('코치 계정 전환·로그아웃은 이전 구독과 팝업을 모두 정리한다', () => {
    const h = harness();
    h.state.currentUser = '가상코치A';
    h.state.isCoach = true;
    h.run('syncCoachRenewalReminder()');
    h.state.currentUser = '가상코치B';
    h.run('syncCoachRenewalReminder()');
    expect(h.controllers).toHaveLength(2);
    expect(h.controllers[0].cleanup).toHaveBeenCalledOnce();
    expect(h.dialogs[0].hide).toHaveBeenCalledOnce();
    h.state.isCoach = false;
    h.run('syncCoachRenewalReminder()');
    expect(h.controllers[1].cleanup).toHaveBeenCalledOnce();
    expect(h.dialogs[1].hide).toHaveBeenCalledOnce();
});

it('인증된 Firebase 토큰만 조회하며 저장소가 차단돼도 알림을 시작한다', async () => {
    const h = harness({ storageUnavailable: true });
    h.state.currentUser = '가상코치';
    h.state.isCoach = true;
    h.run('syncCoachRenewalReminder()');
    expect(h.controllers[0].options.storage).toBeNull();
    expect(await h.loaders[0].getToken()).toBe('test-token');
    expect(h.token).toHaveBeenCalledOnce();
    h.auth.currentUser = null;
    expect(await h.loaders[0].getToken()).toBeNull();
});

it('할 일 보기는 기존 오늘 페이지 이동을 사용하고 문서 수정은 하지 않는다', () => {
    const h = harness();
    h.state.currentUser = '가상코치';
    h.state.isCoach = true;
    h.run('syncCoachRenewalReminder()');
    h.dialogs[0].options.onDismiss('2026-10-16:1');
    h.dialogs[0].options.onOpenTasks();
    expect(h.controllers[0].dismiss).toHaveBeenCalledWith('2026-10-16:1');
    expect(h.window.bottomNavNavigate).toHaveBeenCalledWith('today');
});

it('다른 탭에서 학생으로 로그인하면 열린 팝업과 코치 controller를 정리한다', async () => {
    const h = harness();
    h.state.currentUser = '가상코치';
    h.state.isCoach = true;
    h.run('syncCoachRenewalReminder()');
    h.auth.currentUser = { getIdTokenResult: async () => ({ claims: { name: '가상학생', isCoach: false } }) };
    await h.authChanged(h.auth.currentUser);
    expect(h.controllers[0].cleanup).toHaveBeenCalledOnce();
    expect(h.dialogs[0].hide).toHaveBeenCalledOnce();
    expect(h.unsubscribeAuth).toHaveBeenCalledOnce();
    expect(await h.loaders[0].getToken()).toBeNull();
});

it('같은 Firebase user라도 코치 권한·이름이 달라지면 표시를 중단한다', async () => {
    for (const claims of [{ name: '가상코치', isCoach: false }, { name: '다른코치', isCoach: true }]) {
        const h = harness();
        h.state.currentUser = '가상코치';
        h.state.isCoach = true;
        h.run('syncCoachRenewalReminder()');
        h.token.mockResolvedValue({ token: 'changed-token', claims });
        expect(await h.loaders[0].getToken()).toBeNull();
        await h.authChanged(h.auth.currentUser);
        expect(h.controllers[0].cleanup).toHaveBeenCalledOnce();
    }
});

it('토큰 조회 도중 계정이 바뀌면 이전 토큰을 endpoint에 전달하지 않는다', async () => {
    const h = harness();
    h.state.currentUser = '가상코치';
    h.state.isCoach = true;
    h.run('syncCoachRenewalReminder()');
    let resolveToken;
    h.token.mockImplementation(() => new Promise(resolve => { resolveToken = resolve; }));
    const pending = h.loaders[0].getToken();
    h.auth.currentUser = { getIdTokenResult: vi.fn() };
    resolveToken({ token: 'old-token', claims: { name: '가상코치', isCoach: true } });
    expect(await pending).toBeNull();
});

it('코치 재등록 푸시의 today 링크만 오늘 페이지로 이동하고 게시판 알림은 그대로 둔다', async () => {
    const h = harness();
    h.state.currentUser = '가상코치';
    h.state.isCoach = true;
    h.run('syncCoachRenewalReminder()');
    await h.pushMessage({ type: 'notificationClick', postId: 'sample-post' });
    await h.pushMessage({ type: 'notificationClick', page: 'schedule' });
    expect(h.token).not.toHaveBeenCalled();
    expect(h.window.bottomNavNavigate).not.toHaveBeenCalled();
    await h.pushMessage({ type: 'notificationClick', page: 'today' });
    expect(h.window.bottomNavNavigate).toHaveBeenCalledOnce();
    expect(h.window.bottomNavNavigate).toHaveBeenCalledWith('today');
    h.run('stopCoachRenewalReminder()');
    expect(h.removePushMessage).toHaveBeenCalledWith('message', expect.any(Function));
    await h.pushMessage({ type: 'notificationClick', page: 'today' });
    expect(h.window.bottomNavNavigate).toHaveBeenCalledOnce();
});

it('푸시 클릭의 인증 확인 중 다른 계정으로 바뀌면 코치 페이지로 이동하지 않는다', async () => {
    const h = harness();
    h.state.currentUser = '가상코치';
    h.state.isCoach = true;
    h.run('syncCoachRenewalReminder()');
    let resolveToken;
    h.token.mockImplementation(() => new Promise(resolve => { resolveToken = resolve; }));
    const pending = h.pushMessage({ type: 'notificationClick', page: 'today' });
    h.auth.currentUser = null;
    resolveToken({ token: 'old-token', claims: { name: '가상코치', isCoach: true } });
    await pending;
    expect(h.window.bottomNavNavigate).not.toHaveBeenCalled();
});
