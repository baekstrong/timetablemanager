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

const fieldOf = v => Array.isArray(v) ? { arrayValue: { values: v.map(fieldOf) } }
    : v !== null && typeof v === 'object' ? { mapValue: { fields: fieldsOf(v) } }
    : typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v })
    : v === null ? { nullValue: null } : { stringValue: v };
const fieldsOf = data => Object.fromEntries(Object.entries(data).map(([key, v]) => [key, fieldOf(v)]));
const consultationSlots = ['월', '화', '수', '목'].map(day => ({ day, period: 1 }));
async function createConsultation(id, changes = {}) {
    const data = { requestedSlots: consultationSlots, recruitmentMonth: '2099-11', name: '로컬검증', phone: '01000000000', message: '', wantsFourTimes: true, status: 'pending', ...changes };
    return fetch(`${root}:commit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ writes: [{ update: { name: `projects/${project}/databases/(default)/documents/recruitmentConsultations/${id}`, fields: fieldsOf(data) },
            updateTransforms: ['createdAt', 'updatedAt'].map(fieldPath => ({ fieldPath, setToServerValue: 'REQUEST_TIME' })) }] }),
        signal: AbortSignal.timeout(10000),
    });
}
const publicSettings = ['holidays', 'disabledClasses', 'entranceClasses', 'registrationFAQ'];
const protectedSettings = ['lockedSlots', 'studentMeta', 'studentCountSnapshots'];
beforeAll(async () => {
    for (const path of ['newStudentRegistrations/weekly-2', 'newStudentRegistrations/weekly-3',
        'newStudentRegistrations/four-pending', 'newStudentRegistrations/four-waitlist',
        'recruitmentConsultations/private-consultation', 'recruitmentConsultations/invalid-consultation']) {
        expect((await request('coach', 'DELETE', path)).status).toBe(200);
    }
    expect((await request('coach', 'PATCH', 'recruitmentMonths/2099-11', fieldsOf({ month: '2099-11', status: 'open', notice: '', inquiryPhone: '' }))).status).toBe(200);
    expect((await request('coach', 'PATCH', 'recruitmentMonths/2099-10', fieldsOf({ month: '2099-10', status: 'closed', notice: '', inquiryPhone: '' }))).status).toBe(200);
    expect((await request('coach', 'PATCH', 'entranceClasses/test-open', fieldsOf({ date: '2099-11-07', isActive: true, closed: false, currentCount: 0, maxCapacity: 6 }))).status).toBe(200);
    for (const name of [...publicSettings, ...protectedSettings, 'coachNotes']) {
        expect((await request('coach', 'PATCH', `${name}/rest-policy`, value)).status).toBe(200);
    }
});

describe('신규 주4회 차단과 비공개 상담 접수', () => {
    it.each([2, 3])('비로그인 주%i회 정상 신청을 유지한다', async weeklyFrequency => {
        expect((await request(null, 'PATCH', `newStudentRegistrations/weekly-${weeklyFrequency}`, fieldsOf({ weeklyFrequency, recruitmentMonth: '2099-11', status: 'pending', entranceInquiry: '', entranceClassId: 'test-open', entranceDate: '2099-11-07' }))).status).toBe(200);
    });
    it.each(['pending', 'waitlist'])('주4회 %s 직접 저장은 거부하고 코치의 주4회 등록은 유지한다', async status => {
        const data = fieldsOf({ weeklyFrequency: 4, recruitmentMonth: '2099-11', status, entranceInquiry: '', entranceClassId: 'test-open', entranceDate: '2099-11-07' });
        expect((await request(null, 'PATCH', `newStudentRegistrations/four-${status}`, data)).status).toBe(403);
        expect((await request('coach', 'PATCH', `newStudentRegistrations/four-${status}`, data)).status).toBe(200);
    });
    it('상담만 접수하고 코치만 조회/완료/삭제할 수 있다', async () => {
        expect((await createConsultation('private-consultation')).status).toBe(200);
        expect((await request(null, 'GET', 'recruitmentConsultations/private-consultation')).status).toBe(403);
        expect((await request('student', 'GET', 'recruitmentConsultations/private-consultation')).status).toBe(403);
        expect((await request('coach', 'GET', 'recruitmentConsultations/private-consultation')).status).toBe(200);
        expect((await request(null, 'PATCH', 'recruitmentConsultations/private-consultation', fieldsOf({ status: 'completed' }))).status).toBe(403);
        expect((await request('student', 'DELETE', 'recruitmentConsultations/private-consultation')).status).toBe(403);
        expect((await request('coach', 'PATCH', 'recruitmentConsultations/private-consultation', fieldsOf({ status: 'completed' }))).status).toBe(200);
        expect((await request('coach', 'DELETE', 'recruitmentConsultations/private-consultation')).status).toBe(200);
    });
    it.each([{ requestedSlots: [] }, { requestedSlots: consultationSlots.slice(0, 3) }, { requestedSlots: [consultationSlots[0], consultationSlots[0], ...consultationSlots.slice(2)] }, { requestedSlots: consultationSlots.map(s => ({ ...s, period: 3 })) }, { requestedSlots: consultationSlots.map(s => ({ ...s, period: 1.5 })) }, { recruitmentMonth: '2099-10' }, { recruitmentMonth: '2099-12' }, { recruitmentMonth: '2000-01' }, { phone: '123' }, { name: '' }, { message: 'x'.repeat(1001) }, { status: 'completed' }, { wantsFourTimes: 'true' }, { weeklyFrequency: 4 }])('잘못된 상담 데이터·마감월을 차단한다: %j', async change => {
        expect((await createConsultation('invalid-consultation', change)).status).toBe(403);
    });
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
