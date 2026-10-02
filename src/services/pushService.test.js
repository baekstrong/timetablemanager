import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ getToken: vi.fn(), setDoc: vi.fn(), getIdTokenResult: vi.fn() }));
vi.mock('firebase/messaging', () => ({ getMessaging: () => ({}), getToken: mocks.getToken, isSupported: async () => true }));
vi.mock('firebase/firestore', () => ({ doc: (_db, collection, name) => ({ collection, name }), setDoc: mocks.setDoc, serverTimestamp: () => 'now' }));
vi.mock('../config/firebase', () => ({ default: {}, db: {}, auth: { currentUser: { getIdTokenResult: mocks.getIdTokenResult } } }));

let initPush;
beforeEach(async () => {
    vi.stubEnv('VITE_FIREBASE_VAPID_KEY', 'test-key');
    vi.stubGlobal('window', { Notification: {} });
    vi.stubGlobal('Notification', { permission: 'granted' });
    vi.stubGlobal('navigator', { serviceWorker: { ready: Promise.resolve({}) } });
    vi.stubGlobal('localStorage', { getItem: vi.fn(), setItem: vi.fn() });
    mocks.setDoc.mockReset().mockResolvedValue(undefined);
    mocks.getToken.mockReset().mockResolvedValue('device-token');
    mocks.getIdTokenResult.mockReset().mockResolvedValue({ claims: { name: '김수강' } });
    ({ initPush } = await import('./pushService'));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('푸시 기기 토큰 계정 확인', () => {
    it('로그인 본인 이름에만 토큰을 등록한다', async () => {
        expect(await initPush('김수강')).toBe('device-token');
        expect(mocks.setDoc).toHaveBeenCalledWith({ collection: 'users', name: '김수강' }, { fcmToken: 'device-token', fcmUpdatedAt: 'now' }, { merge: true });
    });
    it('빙의·계정 전환 중 다른 이름으로 기기 토큰을 덮어쓰지 않는다', async () => {
        expect(await initPush('다른 학생')).toBeNull();
        expect(mocks.setDoc).not.toHaveBeenCalled();
    });
    it('신원 확인 없이 캐시만 보고 켜졌다고 판단하지 않는다', async () => {
        localStorage.getItem.mockReturnValue('device-token');
        mocks.getIdTokenResult.mockResolvedValue({ claims: { name: '다른 학생' } });
        expect(await initPush('김수강')).toBeNull();
        expect(mocks.setDoc).not.toHaveBeenCalled();
    });
});
