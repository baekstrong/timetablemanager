// 신규 대기 로컬 목업용 메모리 데이터. 실제 Firestore·문자 발송을 대신한다(가짜 이름·번호).
import { validateWaitlistEntry, assertWaitlistMonthStatus } from '../../utils/newStudentWaitlist';

const at = iso => { const ms = new Date(iso).getTime(); return { toMillis: () => ms, toDate: () => new Date(ms), seconds: ms / 1000 }; };
const slots = text => [...text.matchAll(/([월화수목금])(\d)/g)].map(([, day, period]) => ({ day, period: Number(period) }));
let seq = 1;

export const reviewState = {
    configs: [
        { month: '2026-11', status: 'closed', inquiryPhone: '01000000000', notice: '' },
        { month: '2026-12', status: 'inquiry', inquiryPhone: '01000000000', notice: '' },
    ],
    entrances: [
        { id: 'ec-dec', date: '2026-12-05', time: '19:50', endTime: '21:20', isActive: true, maxCapacity: 8, currentCount: 2, closed: false },
    ],
    registrations: [
        { id: 'w1', name: '김민지', phone: '010-1111-2222', status: 'waitlist', isWaitlist: true, recruitmentMonth: '2026-11', weeklyFrequency: 2,
            requestedSlots: slots('월4수4금4'), scheduleString: '월4수4금4', entranceDate: '2026-11-07', entranceClassDate: '11월 7일 (토) 10:00',
            paymentMethod: 'card', totalCost: 390000, createdAt: at('2026-10-20T10:00:00+09:00'), smsLog: { reception: { status: 'sent', at: Date.parse('2026-10-20T10:00:00+09:00') } } },
        { id: 'w2', name: '이준호', phone: '010-3333-4444', status: 'waitlist', isWaitlist: true, waitType: 'month', source: 'public', recruitmentMonth: '2026-12', weeklyFrequency: 2,
            requestedSlots: slots('화1목1'), scheduleString: '화1목1', entranceClassId: null, entranceDate: '', gender: '남', exerciseExperience: '헬스 6개월',
            createdAt: at('2026-10-25T21:00:00+09:00'), smsLog: { reception: { status: 'sent', at: Date.parse('2026-10-25T21:00:00+09:00') } } },
        { id: 'w3', name: '박서연', phone: '010-5555-6666', status: 'waitlist', isWaitlist: true, waitType: 'month', source: 'coach', recruitmentMonth: '2026-12', weeklyFrequency: 2,
            requestedSlots: slots('월4수4화5'), scheduleString: '월4화5수4', entranceClassId: null, entranceDate: '', memo: '인스타 DM 문의, 저녁만 가능',
            createdAt: at('2026-10-30T13:00:00+09:00') },
        { id: 'p1', name: '최유나', phone: '010-7777-8888', status: 'pending', recruitmentMonth: '2026-11', weeklyFrequency: 2,
            requestedSlots: slots('화5목5'), scheduleString: '화5목5', createdAt: at('2026-11-01T09:00:00+09:00') },
    ],
};

// 월4·수4 만석(7명), 화5 6명(+승인 대기 1명 = 만석)
export const reviewStudents = [
    ...Array.from({ length: 7 }, (_, i) => ({ '이름': `월수수강생${i + 1}`, '요일 및 시간': '월4수4', '신규/재등록': '재등록' })),
    ...Array.from({ length: 6 }, (_, i) => ({ '이름': `화목수강생${i + 1}`, '요일 및 시간': '화5목5', '신규/재등록': '재등록' })),
    ...Array.from({ length: 3 }, (_, i) => ({ '이름': `오전수강생${i + 1}`, '요일 및 시간': '화1목1', '신규/재등록': '재등록' })),
];

const log = (...args) => console.info('[목업]', ...args);
const delay = (value) => new Promise(resolve => setTimeout(() => resolve(value), 150));

export const getRecruitmentOverview = () => delay({ configs: reviewState.configs.map(c => ({ ...c })), entrances: reviewState.entrances });
export const getRecruitmentMonths = () => delay(reviewState.configs.map(c => ({ ...c })));
export const assertRecruitmentOpen = async month => {
    if (reviewState.configs.find(c => c.month === month)?.status !== 'open') throw new Error('선택한 월은 지금 신청할 수 없습니다.');
};
export async function saveRecruitmentMonth(month, data) {
    reviewState.configs = [...reviewState.configs.filter(c => c.month !== month), { month, status: data.status, notice: data.notice || '', inquiryPhone: String(data.inquiryPhone || '').replace(/\D/g, '') }];
    log('모집 상태 저장', month, data.status);
    return delay();
}
export async function submitRecruitmentRegistration() { throw new Error('목업에서는 일반 신청을 저장하지 않습니다.'); }

function addWaitlist(data, extra) {
    const reg = {
        id: `new-${seq++}`, name: data.name.trim(), phone: data.phone, recruitmentMonth: data.recruitmentMonth, weeklyFrequency: data.weeklyFrequency,
        requestedSlots: data.requestedSlots, scheduleString: data.requestedSlots.map(s => `${s.day}${s.period}`).join(''),
        status: 'waitlist', isWaitlist: true, entranceClassId: null, entranceDate: '', createdAt: at(new Date().toISOString()), ...extra,
    };
    reviewState.registrations.push(reg);
    log('대기 저장', reg);
    return delay({ success: true, id: reg.id });
}
export async function submitMonthWaitlist(data) {
    validateWaitlistEntry(data);
    assertWaitlistMonthStatus(reviewState.configs.find(c => c.month === data.recruitmentMonth)?.status || 'inquiry');
    return addWaitlist(data, { waitType: 'month', source: 'public', gender: data.gender, exerciseExperience: data.exerciseExperience, question: data.question || '' });
}
export async function addCoachWaitlist(data) {
    validateWaitlistEntry(data, { coach: true });
    assertWaitlistMonthStatus(reviewState.configs.find(c => c.month === data.recruitmentMonth)?.status || 'inquiry', { coach: true });
    const open = reviewState.configs.find(c => c.month === data.recruitmentMonth)?.status === 'open';
    return addWaitlist(data, { waitType: open ? 'seat' : 'month', source: 'coach', memo: data.memo || '' });
}

export const getSmsSettings = () => delay({ isConfigured: true, coachPhone: '01000000000' });
export async function sendRegistrationNotifications(phone, name, details) { log('접수 문자(발송 안 함)', name, details.waitMonthLabel); return { studentSMS: true, coachSMS: true }; }
export async function sendWaitlistAvailableSMS(phone, name) { log('여석 안내 문자(발송 안 함)', name); return true; }
export async function sendWaitlistCancelledSMS(phone, name) { log('대기 취소 문자(발송 안 함)', name); return true; }
export async function sendStudentRegistrationSMS(phone, name) { log('접수 문자 재발송(발송 안 함)', name); return true; }

export const getDisabledClasses = () => delay([]);
export const getFAQs = () => delay([]);
export const getHolidays = () => delay([]);
export const getEntranceClasses = () => delay(reviewState.entrances);
export const getConsultations = () => delay([]);
export async function getNewStudentRegistrations(status = null) {
    const rows = reviewState.registrations.filter(r => !status || r.status === status);
    return delay(rows.map(r => ({ ...r })).sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis()));
}
export async function updateNewStudentRegistration(id, patch) {
    const reg = reviewState.registrations.find(r => r.id === id);
    if (reg) Object.entries(patch).forEach(([key, value]) => {
        if (key.startsWith('smsLog.')) reg.smsLog = { ...reg.smsLog, [key.slice(7)]: value };
        else reg[key] = value;
    });
    return delay();
}
export async function deleteNewStudentRegistration(id) {
    reviewState.registrations = reviewState.registrations.filter(r => r.id !== id);
    return delay();
}
export async function updateWaitlistRequestedSlots(id, requestedSlots, scheduleString) {
    return updateNewStudentRegistration(id, { requestedSlots, scheduleString });
}
