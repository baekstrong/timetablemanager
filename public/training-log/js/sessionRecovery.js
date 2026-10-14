import { readSessionIdentity } from './sessionIdentity.js';

export const SESSION_RESTORE_TIMEOUT_MS = 12_000;

// A slow Firebase restoration is not evidence that the stored session is absent.
// Only an observed missing/mismatched identity returns null and permits a login
// fallback. A timeout or network error leaves the saved credentials untouched.
export function restoreSessionIdentity({ subscribe, expectedName, timeoutMs = SESSION_RESTORE_TIMEOUT_MS, signal }) {
    return new Promise((resolve, reject) => {
        let finished = false;
        let revision = 0;
        let unsubscribe = () => {};
        let timer;
        const abortError = () => Object.assign(new Error('Session restoration cancelled'), { name: 'AbortError' });
        const cleanup = () => {
            clearTimeout(timer);
            unsubscribe();
            signal?.removeEventListener('abort', onAbort);
        };
        const finish = (error, identity) => {
            if (finished) return;
            finished = true;
            cleanup();
            if (error) reject(error);
            else resolve(identity);
        };
        const onAbort = () => finish(abortError());
        if (signal?.aborted) { finish(abortError()); return; }
        signal?.addEventListener('abort', onAbort, { once: true });
        timer = setTimeout(() => finish(Object.assign(
            new Error('로그인 정보를 확인하는 데 시간이 걸리고 있어요. 잠시 후 다시 시도해주세요.'),
            { code: 'auth/session-restore-timeout' },
        )), timeoutMs);
        try {
            unsubscribe = subscribe(async user => {
                if (finished) return;
                const current = ++revision;
                try {
                    const identity = await readSessionIdentity(user, expectedName);
                    if (current === revision) finish(null, identity);
                } catch (error) {
                    if (current === revision) finish(error);
                }
            }, error => finish(error)) || (() => {});
            // Also support adapters which synchronously invoke their callback.
            if (finished) unsubscribe();
        } catch (error) { finish(error); }
    });
}
