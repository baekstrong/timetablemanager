import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ getToken: vi.fn(), setDoc: vi.fn(), getIdTokenResult: vi.fn(), getIdToken: vi.fn() }));
vi.mock('firebase/messaging', () => ({ getMessaging: () => ({}), getToken: mocks.getToken, isSupported: async () => true }));
vi.mock('firebase/firestore', () => ({ doc: (_db, collection, name) => ({ collection, name }), setDoc: mocks.setDoc, serverTimestamp: () => 'now' }));
vi.mock('../config/firebase', () => ({ default: {}, db: {}, auth: { currentUser: { getIdTokenResult: mocks.getIdTokenResult, getIdToken: mocks.getIdToken } } }));

let initPush, pushComment, pushReply, pushNotice, pushMakeupSeat;
beforeEach(async () => {
    vi.stubEnv('VITE_FIREBASE_VAPID_KEY', 'test-key');
    vi.stubGlobal('window', { Notification: {} });
    vi.stubGlobal('Notification', { permission: 'granted' });
    vi.stubGlobal('navigator', { serviceWorker: { ready: Promise.resolve({}) } });
    vi.stubGlobal('localStorage', { getItem: vi.fn(), setItem: vi.fn() });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, sent: 1 }) }));
    mocks.setDoc.mockReset().mockResolvedValue(undefined);
    mocks.getToken.mockReset().mockResolvedValue('device-token');
    mocks.getIdTokenResult.mockReset().mockResolvedValue({ claims: { name: '김수강' }, token: 'verified-token' });
    mocks.getIdToken.mockReset().mockResolvedValue('verified-token');
    ({ initPush, pushComment, pushReply, pushNotice, pushMakeupSeat } = await import('./pushService'));
});

describe('게시판 발송 직전 인증 계정의 본인 알림 제외', () => {
    const notify = (type, record) => type === 'reply' ? pushReply('p1', 'c1', record) : pushComment('p1', record);

    it.each(['comment', 'reply'])('%s: 인증 계정 본인에게는 서버 요청도 보내지 않는다', async type => {
        expect(await notify(type, { author: ' 김수강 '.normalize('NFD') })).toBe(false);
        expect(fetch).not.toHaveBeenCalled();
    });

    it.each(['comment', 'reply'])('%s: 표시 계정이 달라도 코치의 예전 댓글에는 보내지 않는다', async type => {
        mocks.getIdTokenResult.mockResolvedValue({ claims: { name: '백관장', isCoach: true }, token: 'coach-token' });
        expect(await notify(type, { author: '예전 코치 이름', isCoach: true })).toBe(false);
        expect(fetch).not.toHaveBeenCalled();
    });

    it.each(['comment', 'reply'])('%s: 다른 사람에게는 인증에 사용한 토큰으로 한 번 요청한다', async type => {
        expect(await notify(type, { author: '박수강' })).toBe(true);
        expect(fetch).toHaveBeenCalledTimes(1);
        const [, request] = fetch.mock.calls[0];
        expect(request.headers.Authorization).toBe('Bearer verified-token');
        expect(JSON.parse(request.body)).toEqual({ type, postId: 'p1', ...(type === 'reply' && { parentId: 'c1' }) });
        expect(mocks.getIdToken).not.toHaveBeenCalled();
    });

    it('없는 대상·삭제된 댓글·알 수 없는 인증 이름은 보내지 않는다', async () => {
        for (const record of [undefined, { author: '박수강', deleted: true }]) {
            expect(await pushReply('p1', 'c1', record)).toBe(false);
        }
        mocks.getIdTokenResult.mockResolvedValue({ claims: {}, token: 'no-name-token' });
        expect(await pushReply('p1', 'c1', { author: '박수강' })).toBe(false);
        expect(fetch).not.toHaveBeenCalled();
    });

    it('공지·보강 알림은 기존 발송 경로를 유지한다', async () => {
        expect(await pushNotice(['김수강'], '공지', '내용', 'p1')).toBe(true);
        expect(await pushMakeupSeat('w1')).toBe(true);
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(mocks.getIdTokenResult).not.toHaveBeenCalled();
    });
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
