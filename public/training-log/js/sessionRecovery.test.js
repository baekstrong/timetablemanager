import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { restoreSessionIdentity } from './sessionRecovery.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function adapter() {
    let emit;
    const unsubscribe = vi.fn();
    const subscribe = vi.fn(callback => { emit = callback; return unsubscribe; });
    return { subscribe, unsubscribe, emit: user => emit(user) };
}
const user = (name = '테스트', isCoach = false) => ({
    getIdTokenResult: vi.fn(async () => ({ claims: { name, isCoach } })),
});

it('2.5초가 지나도 복원 중인 세션을 없는 세션으로 취급하지 않는다', async () => {
    const source = adapter();
    let settled = false;
    const result = restoreSessionIdentity({ subscribe: source.subscribe, expectedName: '테스트' });
    result.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(3000);
    expect(settled).toBe(false);
    source.emit(user());
    await expect(result).resolves.toEqual({ name: '테스트', isCoach: false });
    expect(source.unsubscribe).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
});

it.each([null, user('다른 계정')])('실제 빈 세션이나 계정 불일치일 때만 null을 반환한다', async restored => {
    const source = adapter();
    const result = restoreSessionIdentity({ subscribe: source.subscribe, expectedName: '테스트' });
    source.emit(restored);
    await expect(result).resolves.toBeNull();
});

it('클레임 조회가 지연되어도 전체 복원 예산을 넘으면 오류로 끝낸다', async () => {
    const source = adapter();
    const result = restoreSessionIdentity({ subscribe: source.subscribe, expectedName: '테스트' }).catch(error => error);
    source.emit({ getIdTokenResult: () => new Promise(() => {}) });
    await vi.advanceTimersByTimeAsync(12_000);
    expect((await result).code).toBe('auth/session-restore-timeout');
    expect(source.unsubscribe).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
});

it('토큰 네트워크 오류는 세션 없음과 구분한다', async () => {
    const source = adapter();
    const error = Object.assign(new Error('offline'), { code: 'auth/network-request-failed' });
    const result = restoreSessionIdentity({ subscribe: source.subscribe, expectedName: '테스트' });
    source.emit({ getIdTokenResult: async () => { throw error; } });
    await expect(result).rejects.toBe(error);
});

it('이전 토큰 응답이 늦게 와도 새 로그아웃 상태를 덮어쓰지 않는다', async () => {
    const source = adapter();
    let resolveToken;
    const result = restoreSessionIdentity({ subscribe: source.subscribe, expectedName: '테스트' });
    source.emit({ getIdTokenResult: () => new Promise(resolve => { resolveToken = resolve; }) });
    source.emit(null);
    await expect(result).resolves.toBeNull();
    resolveToken({ claims: { name: '테스트', isCoach: true } });
    await Promise.resolve();
    expect(source.unsubscribe).toHaveBeenCalledTimes(1);
});

it('화면 이탈 시 구독과 타이머를 해제한다', async () => {
    const source = adapter();
    const controller = new AbortController();
    const result = restoreSessionIdentity({ subscribe: source.subscribe, expectedName: '테스트', signal: controller.signal });
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(source.unsubscribe).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
});

it('동기 콜백 어댑터에서도 정상 세션을 복원한다', async () => {
    const unsubscribe = vi.fn();
    const result = restoreSessionIdentity({ subscribe: callback => { callback(user('테스트', true)); return unsubscribe; }, expectedName: '테스트' });
    await expect(result).resolves.toEqual({ name: '테스트', isCoach: true });
    expect(unsubscribe).toHaveBeenCalledTimes(1);
});
