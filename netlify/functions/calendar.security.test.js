import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { it, expect, vi } from 'vitest';

function load(file, require, env = {}) {
    const context = vm.createContext({ exports: {}, require, process: { env }, console: { log() {}, error() {} } });
    vm.runInContext(readFileSync(new URL(file, import.meta.url), 'utf8'), context);
    return context.exports;
}
function handler(claims, invalid = false) {
    const verify = vi.fn(async () => { if (invalid) throw Error('bad token'); return claims; });
    const guard = load('./_requireCoach.js', id => id.endsWith('/app')
        ? { getApps: () => [{}] } : { getAuth: () => ({ verifyIdToken: verify }) });
    const insert = vi.fn(async () => ({ data: { id: 'synthetic' } }));
    const update = vi.fn(async () => ({}));
    const remove = vi.fn(async () => ({}));
    const api = load('./calendar.js', id => id === './_requireCoach' ? guard : {
        calendar: () => ({ events: { insert, update, delete: remove } }), auth: { GoogleAuth: class {} },
    }, { GOOGLE_CALENDAR_ID: 'synthetic' });
    return { ...api, verify, insert, update, remove };
}
const event = (body, action = 'create') => ({ httpMethod: 'POST', path: `/.netlify/functions/calendar/${action}`, headers: {}, body: JSON.stringify(body) });
const payload = { title: '예시', date: '2026-09-23', startTime: '10:00', endTime: '13:00', eventId: 'synthetic' };
it.each(['create', 'update', 'delete'])('무인증 %s 요청은 Google API를 호출하지 않는다', async action => {
    const api = handler({ isCoach: true });
    expect((await api.handler(event(payload, action))).statusCode).toBe(401);
    expect(api.verify).not.toHaveBeenCalled();
    expect(api.insert).not.toHaveBeenCalled(); expect(api.update).not.toHaveBeenCalled(); expect(api.remove).not.toHaveBeenCalled();
});
it.each([false, 'true', undefined])('수강생·위조 boolean 권한(%s)은 거부', async isCoach => {
    const api = handler({ isCoach });
    expect((await api.handler(event({ ...payload, idToken: 'synthetic' }))).statusCode).toBe(403);
    expect(api.insert).not.toHaveBeenCalled();
});
it('만료/위조 토큰은 인증 실패로 처리', async () => {
    const api = handler({}, true);
    expect((await api.handler(event({ ...payload, idToken: 'invalid' }))).statusCode).toBe(401);
    expect(api.insert).not.toHaveBeenCalled();
});
it('검증된 코치만 생성 가능하며 토큰은 Google 이벤트로 전달하지 않는다', async () => {
    const api = handler({ isCoach: true });
    expect((await api.handler(event({ ...payload, idToken: 'synthetic' }))).statusCode).toBe(200);
    expect(api.verify).toHaveBeenCalledWith('synthetic', true);
    expect(api.insert.mock.calls[0][0].requestBody.idToken).toBeUndefined();
});
it('CORS 사전 요청은 인증 없이 응답한다', async () => {
    const api = handler({});
    expect((await api.handler({ httpMethod: 'OPTIONS' })).statusCode).toBe(200);
    expect(api.verify).not.toHaveBeenCalled();
});
