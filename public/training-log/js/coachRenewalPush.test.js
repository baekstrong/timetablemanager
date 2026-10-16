import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { expect, it, vi } from 'vitest';

// Run the real login/message wiring with in-memory Firebase and service worker
// events. No reminder endpoint, storage ledger, timer, or operational data.
function harness() {
    const state = { currentUser: null, isCoach: false };
    const token = vi.fn(async () => ({ claims: { name: state.currentUser, isCoach: true } }));
    let authChanged;
    const unsubscribeAuth = vi.fn();
    const auth = { currentUser: { getIdTokenResult: token }, onIdTokenChanged(callback) { authChanged = callback; return unsubscribeAuth; } };
    const addPushMessage = vi.fn();
    const removePushMessage = vi.fn();
    const window = { firebase: { auth: () => auth }, bottomNavNavigate: vi.fn(), navigator: { serviceWorker: {
        addEventListener: addPushMessage,
        removeEventListener: removePushMessage,
    } } };
    const context = vm.createContext({ state, window });
    const source = readFileSync(new URL('./coachRenewalPush.js', import.meta.url), 'utf8')
        .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
    vm.runInContext(source, context);
    const run = code => vm.runInContext(code, context);
    return { state, window, auth, token, run, unsubscribeAuth, addPushMessage, removePushMessage,
        authChanged: user => authChanged(user),
        pushMessage: data => addPushMessage.mock.calls.at(-1)?.[1]({ data }) };
}

it('수강생에는 연결하지 않고 코치 재렌더에도 리스너를 한 번만 연결한다', () => {
    const h = harness();
    h.run('syncCoachRenewalPush()');
    h.state.currentUser = '가상수강생';
    h.run('syncCoachRenewalPush()');
    expect(h.addPushMessage).not.toHaveBeenCalled();
    h.state.currentUser = '가상코치';
    h.state.isCoach = true;
    h.run('syncCoachRenewalPush(); syncCoachRenewalPush()');
    expect(h.addPushMessage).toHaveBeenCalledOnce();
    expect(h.token).not.toHaveBeenCalled();
});

it('코치 계정 전환과 로그아웃 때 이전 인증·메시지 리스너를 정리한다', () => {
    const h = harness();
    h.state.currentUser = '가상코치A';
    h.state.isCoach = true;
    h.run('syncCoachRenewalPush()');
    h.state.currentUser = '가상코치B';
    h.run('syncCoachRenewalPush()');
    expect(h.addPushMessage).toHaveBeenCalledTimes(2);
    expect(h.removePushMessage).toHaveBeenCalledOnce();
    expect(h.unsubscribeAuth).toHaveBeenCalledOnce();
    h.state.isCoach = false;
    h.run('syncCoachRenewalPush()');
    expect(h.removePushMessage).toHaveBeenCalledTimes(2);
    expect(h.unsubscribeAuth).toHaveBeenCalledTimes(2);
});

it('재등록 푸시의 today 링크만 이동하며 게시판·다른 페이지 알림은 무시한다', async () => {
    const h = harness();
    h.state.currentUser = '가상코치';
    h.state.isCoach = true;
    h.run('syncCoachRenewalPush()');
    await h.pushMessage({ type: 'notificationClick', postId: 'sample-post' });
    await h.pushMessage({ type: 'notificationClick', page: 'schedule' });
    expect(h.token).not.toHaveBeenCalled();
    expect(h.window.bottomNavNavigate).not.toHaveBeenCalled();
    await h.pushMessage({ type: 'notificationClick', page: 'today' });
    expect(h.window.bottomNavNavigate).toHaveBeenCalledOnce();
    expect(h.window.bottomNavNavigate).toHaveBeenCalledWith('today');
    h.run('stopCoachRenewalPush()');
    expect(h.removePushMessage).toHaveBeenCalledWith('message', expect.any(Function));
    await h.pushMessage({ type: 'notificationClick', page: 'today' });
    expect(h.window.bottomNavNavigate).toHaveBeenCalledOnce();
});

it('다른 탭에서 학생으로 로그인하면 메시지 리스너를 해제한다', async () => {
    const h = harness();
    h.state.currentUser = '가상코치';
    h.state.isCoach = true;
    h.run('syncCoachRenewalPush()');
    h.auth.currentUser = { getIdTokenResult: vi.fn() };
    h.authChanged(h.auth.currentUser);
    expect(h.removePushMessage).toHaveBeenCalledOnce();
    expect(h.unsubscribeAuth).toHaveBeenCalledOnce();
    await h.pushMessage({ type: 'notificationClick', page: 'today' });
    expect(h.window.bottomNavNavigate).not.toHaveBeenCalled();
});

it('Firebase 클레임의 코치 권한이나 이름이 다르면 이동하지 않는다', async () => {
    for (const claims of [{ name: '가상코치', isCoach: false }, { name: '다른코치', isCoach: true }]) {
        const h = harness();
        h.state.currentUser = '가상코치';
        h.state.isCoach = true;
        h.run('syncCoachRenewalPush()');
        h.token.mockResolvedValue({ claims });
        await h.pushMessage({ type: 'notificationClick', page: 'today' });
        expect(h.window.bottomNavNavigate).not.toHaveBeenCalled();
    }
});

it('푸시 클릭의 인증 확인 중 계정이 바뀌면 오늘 페이지로 이동하지 않는다', async () => {
    const h = harness();
    h.state.currentUser = '가상코치';
    h.state.isCoach = true;
    h.run('syncCoachRenewalPush()');
    let resolveToken;
    h.token.mockImplementation(() => new Promise(resolve => { resolveToken = resolve; }));
    const pending = h.pushMessage({ type: 'notificationClick', page: 'today' });
    h.auth.currentUser = null;
    resolveToken({ claims: { name: '가상코치', isCoach: true } });
    await pending;
    expect(h.window.bottomNavNavigate).not.toHaveBeenCalled();
});

it('인증 조회가 실패하면 조용히 현재 훈련일지 화면을 유지한다', async () => {
    const h = harness();
    h.state.currentUser = '가상코치';
    h.state.isCoach = true;
    h.run('syncCoachRenewalPush()');
    h.token.mockRejectedValue(new Error('offline'));
    await h.pushMessage({ type: 'notificationClick', page: 'today' });
    expect(h.window.bottomNavNavigate).not.toHaveBeenCalled();
});
