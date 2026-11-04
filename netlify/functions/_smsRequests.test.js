import { describe, it, expect, vi } from 'vitest';
import { registrationReceived, makeupSeat } from './_smsRequests.js';

const NOW = Date.parse('2026-11-04T10:00:00+09:00');
const ts = ms => ({ toMillis: () => ms });
// docs: { 경로: { ...필드, _createTime } }
function fakeDb(docs) {
    const writes = [];
    return {
        writes,
        doc: path => ({ path }),
        runTransaction: async fn => fn({
            get: async ref => {
                const { _createTime, ...data } = docs[ref.path] || {};
                return { exists: ref.path in docs, data: () => data, createTime: _createTime };
            },
            set: (ref, data) => { writes.push(ref.path); docs[ref.path] = data; },
        }),
    };
}
const base = (db, sendSMS) => ({ db, sendSMS, now: NOW, serverTimestamp: () => 'TS' });
const REG_ID = 'abcdefghij1234567890';

describe('공개 신규 신청 접수 문자', () => {
    const reg = { status: 'pending', name: '홍길동', phone: '010-1234-5678', weeklyFrequency: 2, scheduleString: '월1수1', createdAt: ts(NOW), _createTime: ts(NOW - 60_000) };

    it('신청서 문서의 번호·이름으로만 보내고 한 번 표시한다', async () => {
        const db = fakeDb({ [`newStudentRegistrations/${REG_ID}`]: reg });
        const sendSMS = vi.fn(async () => ({}));
        const out = await registrationReceived({ ...base(db, sendSMS), coachPhone: '010-0000-0000', registrationId: REG_ID });
        expect(out).toEqual({ status: 200, body: { success: true, studentSMS: true, coachSMS: true } });
        expect(sendSMS).toHaveBeenCalledWith('010-1234-5678', expect.stringContaining('홍길동님, 신규 수강 신청 내역이'));
        expect(sendSMS).toHaveBeenCalledWith('010-0000-0000', expect.stringContaining('시간표: 월1수1'));
        expect(db.writes).toEqual([`smsServerClaims/reception_${REG_ID}`, 'smsServerClaims/reception_phone_01012345678_2026-11-04']);
        // 같은 신청서로 다시 요청하면 보내지 않는다
        expect((await registrationReceived({ ...base(db, sendSMS), coachPhone: '010-0000-0000', registrationId: REG_ID })).status).toBe(409);
        expect(sendSMS).toHaveBeenCalledTimes(2);
    });

    it('같은 번호는 하루 3번까지만', async () => {
        const db = fakeDb({ [`newStudentRegistrations/${REG_ID}`]: reg, 'smsServerClaims/reception_phone_01012345678_2026-11-04': { count: 3 } });
        const sendSMS = vi.fn();
        expect((await registrationReceived({ ...base(db, sendSMS), registrationId: REG_ID })).status).toBe(429);
        expect(sendSMS).not.toHaveBeenCalled();
    });

    it.each([
        ['오래된 신청(createdAt을 지금으로 속여도)', { ...reg, createdAt: ts(NOW), _createTime: ts(NOW - 16 * 60_000) }, 410],
        ['승인 끝난 신청', { ...reg, status: 'approved' }, 400],
        ['긴 이름(광고 문구)', { ...reg, name: '가'.repeat(21) }, 400],
        ['전화번호 아님', { ...reg, phone: '1588-0000' }, 400],
    ])('%s → 발송 없음', async (_label, doc, status) => {
        const sendSMS = vi.fn();
        const out = await registrationReceived({ ...base(fakeDb({ [`newStudentRegistrations/${REG_ID}`]: doc }), sendSMS), coachPhone: '010-0000-0000', registrationId: REG_ID });
        expect(out.status).toBe(status);
        expect(sendSMS).not.toHaveBeenCalled();
    });

    it('없는 신청서·이상한 id → 발송 없음', async () => {
        const sendSMS = vi.fn();
        expect((await registrationReceived({ ...base(fakeDb({}), sendSMS), registrationId: REG_ID })).status).toBe(404);
        expect((await registrationReceived({ ...base(fakeDb({}), sendSMS), registrationId: '../users/x' })).status).toBe(400);
        expect(sendSMS).not.toHaveBeenCalled();
    });
});

describe('보강 대기 자리 안내 문자', () => {
    const entry = { status: 'notified', studentName: '김기안', phone: '01012345678', date: '2026-11-05', period: 5, notifiedAt: ts(NOW - 60_000) };

    it('대기 문서에서 문구를 만든다', async () => {
        const db = fakeDb({ [`makeupWaitlists/${REG_ID}`]: entry });
        const sendSMS = vi.fn(async () => ({}));
        expect((await makeupSeat({ ...base(db, sendSMS), waitlistId: REG_ID })).status).toBe(200);
        expect(sendSMS).toHaveBeenCalledWith('01012345678', expect.stringContaining('김기안님, 대기 신청하신 11/5(목) 5교시 수업에 자리가 났습니다.'));
        // 대기 문서를 고쳐도 보낸 기록은 별도 컬렉션이라 다시 보내지 않는다
        expect((await makeupSeat({ ...base(db, sendSMS), waitlistId: REG_ID })).status).toBe(409);
        expect(sendSMS).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['안내 상태 아님', { ...entry, status: 'waiting' }, 400],
        ['안내 후 70분 넘음', { ...entry, notifiedAt: ts(NOW - 71 * 60_000) }, 410],
    ])('%s → 발송 없음', async (_label, doc, status) => {
        const sendSMS = vi.fn();
        expect((await makeupSeat({ ...base(fakeDb({ [`makeupWaitlists/${REG_ID}`]: doc }), sendSMS), waitlistId: REG_ID })).status).toBe(status);
        expect(sendSMS).not.toHaveBeenCalled();
    });
});
