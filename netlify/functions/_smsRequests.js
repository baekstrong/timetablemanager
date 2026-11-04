// 코치가 아닌 쪽에서 오는 자동 안내 문자(2026-11-04). 수신번호·문구를 클라이언트에서 받지 않고
// 해당 문서를 서버가 읽어 정해진 문구로 만든다. 문서마다 한 번만 보낸다(smsServer.* 표시를 트랜잭션으로 선점).
import { registrationReceivedText, coachNewRegistrationText, makeupDateText, makeupSeatText } from '../../src/utils/smsTexts.js';
import { PERIODS } from '../../src/data/mockData.js';

const REGISTRATION_WINDOW_MS = 15 * 60 * 1000; // 신청 직후에만
const MAKEUP_WINDOW_MS = 70 * 60 * 1000;       // 자리 안내(1시간 수락) 동안에만
const PHONE = /^01[0-9]-?\d{3,4}-?\d{4}$/;
const shortName = name => typeof name === 'string' && name.trim().length > 0 && name.length <= 20;
const millis = value => value?.toMillis?.() ?? (typeof value === 'number' ? value : 0);

/** 문서를 읽어 조건을 확인하고, 아직 안 보냈으면 표시를 남긴 뒤 문서를 돌려준다. */
async function claimOnce(db, path, field, check, serverTimestamp) {
    const ref = db.doc(path);
    return db.runTransaction(async tx => {
        const snap = await tx.get(ref);
        if (!snap.exists) return { status: 404 };
        const data = snap.data();
        const problem = check(data);
        if (problem) return { status: problem };
        if (data.smsServer?.[field]) return { status: 409 };
        tx.update(ref, { [`smsServer.${field}`]: serverTimestamp() });
        return { data };
    });
}

/** 공개 신규 신청 접수 문자: 신청자 확인 + 코치 알림. 로그인 불필요. */
export async function registrationReceived({ db, sendSMS, coachPhone, registrationId, now = Date.now(), serverTimestamp }) {
    if (typeof registrationId !== 'string' || !/^[A-Za-z0-9]{10,40}$/.test(registrationId)) return { status: 400 };
    const claim = await claimOnce(db, `newStudentRegistrations/${registrationId}`, 'reception', reg => {
        if (!['pending', 'waitlist'].includes(reg.status) || !PHONE.test(String(reg.phone)) || !shortName(reg.name)) return 400;
        const age = now - millis(reg.createdAt);
        return age >= 0 && age <= REGISTRATION_WINDOW_MS ? null : 410;
    }, serverTimestamp);
    if (!claim.data) return claim;
    const reg = { ...claim.data, isWaitlist: claim.data.status === 'waitlist' };
    const [student, coach] = await Promise.allSettled([
        sendSMS(reg.phone, registrationReceivedText(reg.name, reg.isWaitlist)),
        coachPhone ? sendSMS(coachPhone, coachNewRegistrationText(reg)) : Promise.reject(new Error('COACH_PHONE 없음')),
    ]);
    return { status: 200, body: { success: true, studentSMS: student.status === 'fulfilled', coachSMS: coach.status === 'fulfilled' } };
}

/** 보강 대기 자리 안내 문자(푸시 실패 시 폴백). 로그인한 사람만. */
export async function makeupSeat({ db, sendSMS, waitlistId, now = Date.now(), serverTimestamp }) {
    if (typeof waitlistId !== 'string' || !/^[A-Za-z0-9]{10,40}$/.test(waitlistId)) return { status: 400 };
    const claim = await claimOnce(db, `makeupWaitlists/${waitlistId}`, 'seat', entry => {
        if (entry.status !== 'notified' || !PHONE.test(String(entry.phone)) || !shortName(entry.studentName)
            || !/^\d{4}-\d{2}-\d{2}$/.test(String(entry.date))) return 400;
        const age = now - millis(entry.notifiedAt);
        return age >= 0 && age <= MAKEUP_WINDOW_MS ? null : 410;
    }, serverTimestamp);
    if (!claim.data) return claim;
    const entry = claim.data;
    const periodLabel = PERIODS.find(p => p.id === Number(entry.period))?.name || `${entry.period}교시`;
    await sendSMS(entry.phone, makeupSeatText(entry.studentName, makeupDateText(entry.date), periodLabel));
    return { status: 200, body: { success: true } };
}
