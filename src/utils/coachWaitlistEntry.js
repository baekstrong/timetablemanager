// 코치가 문의(전화·DM 등)를 받고 신규 수강 대기를 직접 넣는 경로 (2026-11-04 사용자 요청).
// 저장 문서는 수강생이 신청 화면에서 만든 대기(status 'waitlist')와 같은 모양이라
// 자리 생김 표시·SMS 안내·대기 시간표 편집·수강 승인이 그대로 동작한다.
import { PRICING, ENTRANCE_FEE, PERIODS, DAYS } from '../data/mockData.js';

const REGULAR_PERIOD_IDS = new Set(PERIODS.filter(p => p.type !== 'free').map(p => p.id));

/** '01012345678' / '010-1234-5678' → '010-1234-5678'. 형식이 아니면 ''. */
export function normalizePhone(value) {
    const digits = String(value || '').replace(/\D/g, '');
    if (!/^01\d{8,9}$/.test(digits)) return '';
    return digits.length === 10
        ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
        : `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

export function sortSlots(slots) {
    return [...slots].sort((a, b) => (DAYS.indexOf(a.day) - DAYS.indexOf(b.day)) || (a.period - b.period));
}

/**
 * 입력 폼 → { data } 또는 { error }.
 * form: { name, phone, gender, weeklyFrequency, slots:[{day,period}], recruitmentMonth, referralSource, coachMemo }
 */
export function buildCoachWaitlistRegistration(form) {
    const name = String(form.name || '').trim();
    if (!name) return { error: '이름을 입력해주세요.' };
    if (name.length > 30 || /[/.#$[\]]/.test(name)) return { error: '이름에 쓸 수 없는 문자가 있습니다.' };

    const phone = normalizePhone(form.phone);
    if (!phone) return { error: '연락처를 010-0000-0000 형식으로 입력해주세요.' };

    const weeklyFrequency = Number(form.weeklyFrequency);
    const pricing = PRICING.find(p => p.frequency === weeklyFrequency);
    if (!pricing) return { error: '주횟수를 선택해주세요.' };

    const seen = new Set();
    const slots = [];
    for (const s of form.slots || []) {
        const key = `${s.day}-${s.period}`;
        if (!DAYS.includes(s.day) || !REGULAR_PERIOD_IDS.has(s.period) || seen.has(key)) continue;
        seen.add(key);
        slots.push({ day: s.day, period: s.period });
    }
    if (slots.length < weeklyFrequency) {
        return { error: `희망 시간을 ${weeklyFrequency}개 이상 선택해주세요. (현재 ${slots.length}개)` };
    }
    const requestedSlots = sortSlots(slots);

    return {
        data: {
            name,
            phone,
            // 승인 시 로그인 비밀번호로 쓰인다 — 공개 신청서와 같은 전화번호 뒤 4자리
            password: phone.slice(-4),
            gender: form.gender === '남' || form.gender === '여' ? form.gender : '',
            occupation: '',
            referralSource: String(form.referralSource || ''),
            exerciseExperience: '',
            healthIssues: '',
            exerciseGoal: '',
            weeklyFrequency,
            baseCost: pricing.baseCost,
            requestedSlots,
            scheduleString: requestedSlots.map(s => `${s.day}${s.period}`).join(''),
            entranceClassId: '',
            entranceDate: '',
            entranceClassDate: '',
            entranceInquiry: '',
            entranceInquiryReason: '',
            entranceCost: ENTRANCE_FEE,
            totalCost: pricing.baseCost + ENTRANCE_FEE,
            paymentMethod: 'transfer',
            wantsConsultation: false,
            question: '',
            recruitmentMonth: /^\d{4}-(0[1-9]|1[0-2])$/.test(form.recruitmentMonth || '') ? form.recruitmentMonth : '',
            coachEntered: true,
            coachMemo: String(form.coachMemo || '').trim().slice(0, 500),
        },
    };
}

const createdMillis = reg => reg.createdAt?.toMillis?.() ?? (reg.createdAt?.seconds != null ? reg.createdAt.seconds * 1000 : 0);

/** 대기 순번 = 앱에 등록된 시각 순서(먼저 들어온 사람이 1번, 2026-11-04 사용자 결정). */
export function orderWaitlist(regs) {
    return [...regs].sort((a, b) => createdMillis(a) - createdMillis(b));
}
