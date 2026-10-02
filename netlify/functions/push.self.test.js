import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { buildMessage, verifyPathFor, filterTargets } from './_pushLib';

function harness({ author = '다른 학생', isCoach = false, callerCoach = false, sameDevice = false } = {}) {
    const send = vi.fn(async () => ({ responses: [], successCount: 1, failureCount: 0 }));
    const getAll = vi.fn(async (...refs) => refs.map(ref => ({ id: ref.name, exists: true, data: () => ({ fcmToken: ref.name === '김수강' || sameDevice ? 'my-device' : 'other-device' }) })));
    const db = { doc: () => ({ get: async () => ({ data: () => ({ author, isCoach }) }) }),
        collection: () => ({ doc: name => ({ name }) }), getAll };
    const context = vm.createContext({ exports: {}, process: { env: { FIREBASE_ADMIN_PRIVATE_KEY: 'fixture' } }, console: { error() {} }, require: id => {
        if (id === './_pushLib') return { buildMessage, verifyPathFor, filterTargets };
        if (id === 'firebase-admin/app') return { getApps: () => [{}] };
        if (id === 'firebase-admin/auth') return { getAuth: () => ({ verifyIdToken: async () => ({ name: '김수강', isCoach: callerCoach }) }) };
        if (id === 'firebase-admin/firestore') return { getFirestore: () => db };
        if (id === 'firebase-admin/messaging') return { getMessaging: () => ({ sendEachForMulticast: send }) };
        throw Error(id);
    } });
    vm.runInContext(readFileSync(new URL('./push.js', import.meta.url), 'utf8'), context);
    return { send, getAll, handler: context.exports.handler };
}
const event = type => ({ httpMethod: 'POST', headers: { authorization: 'Bearer fixture' }, body: JSON.stringify({ type, postId: 'p1', parentId: 'c1' }) });

describe('댓글/답글 서버의 실제 발송 경로', () => {
    it.each(['comment', 'reply'])('%s: 본인 작성자면 FCM·수신자 토큰 조회 없음', async type => {
        const api = harness({ author: '김수강' });
        await api.handler(event(type));
        expect(api.send).not.toHaveBeenCalled();
        expect(api.getAll).not.toHaveBeenCalled();
    });
    it.each(['comment', 'reply'])('%s: 다른 계정에 발신자 기기 토큰이 남아도 발송 없음', async type => {
        const api = harness({ sameDevice: true });
        const res = await api.handler(event(type));
        expect(res.statusCode).toBe(200);
        expect(JSON.parse(res.body).sent).toBe(0);
        expect(api.send).not.toHaveBeenCalled();
    });
    it.each(['comment', 'reply'])('%s: 다른 사람의 기기에는 한 번 발송', async type => {
        const api = harness();
        const res = await api.handler(event(type));
        expect(res.statusCode).toBe(200);
        expect(api.send).toHaveBeenCalledTimes(1);
        expect(api.send.mock.calls[0][0].tokens).toEqual(['other-device']);
    });
    it('코치의 예전 표시 이름 댓글도 본인 답글로 제외', async () => {
        const api = harness({ author: '예전 코치 이름', isCoach: true, callerCoach: true });
        await api.handler(event('reply'));
        expect(api.send).not.toHaveBeenCalled();
    });
});
