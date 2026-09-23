import { beforeAll, describe, it, expect } from 'vitest';

// 에뮬레이터 전용 unsigned JWT. 실제 Firebase에서는 유효하지 않으며 운영 주소를 허용하지 않는다.
const host = process.env.FIRESTORE_EMULATOR_HOST;
if (!/^127\.0\.0\.1:8080$/.test(host || '')) throw Error('로컬 Firestore 에뮬레이터에서만 실행하세요.');
const project = 'demo-strength';
const root = `http://${host}/v1/projects/${project}/databases/(default)/documents`;
function token(role) {
    const now = Math.floor(Date.now() / 1000);
    const claims = { iss: `https://securetoken.google.com/${project}`, aud: project, sub: role,
        user_id: role, iat: now, exp: now + 3600, auth_time: now,
        firebase: { sign_in_provider: 'custom', identities: {} }, name: role, isCoach: role === 'coach' };
    return [ { alg: 'none', typ: 'JWT' }, claims ].map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.';
}
async function request(role, method, path, fields) {
    return fetch(`${root}/${path}`, {
        method, headers: { 'Content-Type': 'application/json', ...(role ? { Authorization: `Bearer ${token(role)}` } : {}) },
        ...(fields ? { body: JSON.stringify({ fields }) } : {}), signal: AbortSignal.timeout(10000),
    });
}
const value = { value: { integerValue: '1' } };
const publicSettings = ['holidays', 'disabledClasses', 'entranceClasses', 'registrationFAQ'];
const protectedSettings = ['lockedSlots', 'studentMeta', 'studentCountSnapshots'];
beforeAll(async () => {
    for (const name of [...publicSettings, ...protectedSettings, 'coachNotes']) {
        expect((await request('coach', 'PATCH', `${name}/rest-policy`, value)).status).toBe(200);
    }
});
describe('운영 설정은 코치만 변경', () => {
    it.each([...publicSettings, ...protectedSettings])('%s: 학생 조회 허용, 생성/수정/삭제 거부', async name => {
        expect((await request('student', 'GET', `${name}/rest-policy`)).status).toBe(200);
        expect((await request('student', 'PATCH', `${name}/new-student`, value)).status).toBe(403);
        expect((await request('student', 'PATCH', `${name}/rest-policy`, value)).status).toBe(403);
        expect((await request('student', 'DELETE', `${name}/rest-policy`)).status).toBe(403);
    });
    it.each(publicSettings)('%s: 비로그인 공개 조회 유지, 쓰기 거부', async name => {
        expect((await request(null, 'GET', `${name}/rest-policy`)).status).toBe(200);
        expect((await request(null, 'PATCH', `${name}/rest-policy`, value)).status).toBe(403);
    });
    it.each([...protectedSettings, 'coachNotes'])('%s: 비로그인 조회 거부', async name => {
        expect((await request(null, 'GET', `${name}/rest-policy`)).status).toBe(403);
    });
    it('코치 메모는 수강생 조회/쓰기도 거부', async () => {
        expect((await request('student', 'GET', 'coachNotes/rest-policy')).status).toBe(403);
        expect((await request('student', 'PATCH', 'coachNotes/rest-policy', value)).status).toBe(403);
    });
    it('본인 역할 자가 승격은 거부', async () => {
        expect((await request('coach', 'PATCH', 'users/student', { isCoach: { booleanValue: false } })).status).toBe(200);
        expect((await request('student', 'PATCH', 'users/student', { isCoach: { booleanValue: true } })).status).toBe(403);
    });
    it('코치도 서버 전용 비밀번호 문서를 읽거나 쓰지 못한다', async () => {
        expect((await request('coach', 'GET', 'userSecrets/student')).status).toBe(403);
        expect((await request('coach', 'PATCH', 'userSecrets/student', value)).status).toBe(403);
    });
    it.each([...publicSettings, ...protectedSettings])('%s: 코치 수정/삭제는 유지', async name => {
        const path = `${name}/coach-edit`;
        expect((await request('coach', 'PATCH', path, value)).status).toBe(200);
        expect((await request('coach', 'PATCH', path, { value: { integerValue: '2' } })).status).toBe(200);
        expect((await request('coach', 'DELETE', path)).status).toBe(200);
    });
});
