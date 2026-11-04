// 코치가 아닌 쪽에서 오는 자동 안내 문자(2026-11-04). 수신번호·문구를 클라이언트에서 받지 않고
// 해당 문서를 서버가 읽어 정해진 문구로 만든다. 문서마다 한 번, 번호마다 하루 3번까지만 보낸다.
import { registrationReceivedText, coachNewRegistrationText, makeupDateText, makeupSeatText } from '../../src/utils/smsTexts.js';
import { PERIODS } from '../../src/data/mockData.js';

const REGISTRATION_WINDOW_MS = 15 * 60 * 1000; // 신청 직후에만
const MAKEUP_WINDOW_MS = 70 * 60 * 1000;       // 자리 안내(1시간 수락) 동안에만
const PHONE = /^01[0-9]-?\d{3,4}-?\d{4}$/;
const shortName = name => typeof name === 'string' && name.trim().length > 0 && name.length <= 20;
const millis = value => value?.toMillis?.() ?? (typeof value === 'number' ? value : 0);

// 보낸 기록은 클라이언트가 못 쓰는 smsServerClaims 컬렉션에 둔다(규칙의 어떤 match에도 없어 기본 거부).
// 대상 문서에 표시하면 로그인한 수강생이 지우고 다시 보내게 할 수 있다.
const CLAIMS = 'smsServerClaims';
const PER_PHONE_PER_DAY = 3; // 같은 번호로 하루에 보내는 이 종류 문자 상한(남의 번호로 문서를 여러 개 만들어 보내는 악용 제한)
// 종류별 하루 전체 상한. 번호를 바꿔 가며 신청서를 만들면 번호당 상한은 피하므로 코치 휴대폰이 폭주하지 않게 막는다.
// 실제 신규 신청·보강 자리 안내는 하루 몇 건이다.
const DAILY_TOTAL = { reception: 30, seat: 60 };
const kstDay = ms => new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);

/** 문서를 읽어 조건을 확인하고, 아직 안 보냈고 번호별 하루 상한 안이면 기록을 남긴 뒤 문서를 돌려준다. */
async function claimOnce(db, path, kind, check, { now, serverTimestamp, phoneOf }) {
    const ref = db.doc(path);
    const claimRef = db.doc(`${CLAIMS}/${kind}_${path.split('/').pop()}`);
    return db.runTransaction(async tx => {
        const snap = await tx.get(ref);
        if (!snap.exists) return { status: 404 };
        const data = snap.data();
        const problem = check(data, snap);
        if (problem) return { status: problem };
        const counterRef = db.doc(`${CLAIMS}/${kind}_phone_${String(phoneOf(data)).replace(/\D/g, '')}_${kstDay(now)}`);
        const totalRef = db.doc(`${CLAIMS}/${kind}_total_${kstDay(now)}`);
        const [claim, counter, total] = [await tx.get(claimRef), await tx.get(counterRef), await tx.get(totalRef)];
        if (claim.exists) return { status: 409 };
        const countOf = doc => (doc.exists ? Number(doc.data().count) || 0 : 0);
        if (countOf(counter) >= PER_PHONE_PER_DAY) return { status: 429 };
        if (countOf(total) >= DAILY_TOTAL[kind]) {
            console.warn(`[sms] ${kind} 하루 전체 상한(${DAILY_TOTAL[kind]}) 도달 — 발송 중단`);
            return { status: 429 };
        }
        tx.set(claimRef, { kind, path, at: serverTimestamp() });
        tx.set(counterRef, { count: countOf(counter) + 1, at: serverTimestamp() });
        tx.set(totalRef, { count: countOf(total) + 1, at: serverTimestamp() });
        return { data };
    });
}

/** 공개 신규 신청 접수 문자: 신청자 확인 + 코치 알림. 로그인 불필요. */
export async function registrationReceived({ db, sendSMS, coachPhone, registrationId, now = Date.now(), serverTimestamp }) {
    if (typeof registrationId !== 'string' || !/^[A-Za-z0-9]{10,40}$/.test(registrationId)) return { status: 400 };
    const claim = await claimOnce(db, `newStudentRegistrations/${registrationId}`, 'reception', (reg, snap) => {
        if (!['pending', 'waitlist'].includes(reg.status) || !PHONE.test(String(reg.phone)) || !shortName(reg.name)) return 400;
        // createdAt 필드는 클라이언트가 정할 수 있어 Firestore가 매긴 문서 생성 시각을 쓴다
        const age = now - millis(snap.createTime);
        return age >= 0 && age <= REGISTRATION_WINDOW_MS ? null : 410;
    }, { now, serverTimestamp, phoneOf: reg => reg.phone });
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
    }, { now, serverTimestamp, phoneOf: entry => entry.phone });
    if (!claim.data) return claim;
    const entry = claim.data;
    const periodLabel = PERIODS.find(p => p.id === Number(entry.period))?.name || `${entry.period}교시`;
    await sendSMS(entry.phone, makeupSeatText(entry.studentName, makeupDateText(entry.date), periodLabel));
    return { status: 200, body: { success: true } };
}
