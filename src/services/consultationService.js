import { collection, doc, getDocsFromServer, runTransaction, serverTimestamp, updateDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { isRecruitmentMonth, koreanDate, normalizeInquiryPhone } from '../utils/recruitment';
import { DAYS, PERIODS } from '../data/mockData';

const regularPeriods = PERIODS.filter(p => p.type !== 'free').map(p => p.id);

export function validateConsultationSlots(data) {
    const slots = data.requestedSlots || [];
    if (!Array.isArray(slots) || (data.wantsFourTimes === true
        ? slots.length !== 4 || new Set(slots.map(s => s?.day)).size !== 4 ||
            slots.some(s => !s || !DAYS.includes(s.day) || !regularPeriods.includes(s.period))
        : slots.length !== 0)) {
        throw new Error('주4회 희망 시간을 서로 다른 요일로 4개 선택해주세요.');
    }
}

export function validateConsultation(data) {
    validateConsultationSlots(data);
    if (!isRecruitmentMonth(data.recruitmentMonth) || data.recruitmentMonth < koreanDate().slice(0, 7)) {
        throw new Error('모집월을 다시 확인해주세요.');
    }
    if (!data.name?.trim() || data.name.trim().length > 50) throw new Error('이름을 50자 이내로 입력해주세요.');
    if (!/^010\d{8}$/.test(normalizeInquiryPhone(data.phone))) throw new Error('연락처를 010으로 시작하는 11자리로 입력해주세요.');
    if (String(data.message || '').length > 1000) throw new Error('상담 내용은 1,000자 이내로 입력해주세요.');
}

export async function submitConsultation(data, requestId) {
    validateConsultation(data);
    if (!db) throw new Error('상담 신청에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.');
    const ref = doc(db, 'recruitmentConsultations', requestId);
    await runTransaction(db, async transaction => {
        const snapshot = await transaction.get(doc(db, 'recruitmentMonths', data.recruitmentMonth));
        const config = snapshot.exists() ? snapshot.data() : null;
        if (config?.month !== data.recruitmentMonth || config.status !== 'open') {
            throw new Error('선택한 월의 모집이 마감되었습니다. 모집 안내를 다시 확인해주세요.');
        }
        transaction.set(ref, {
            recruitmentMonth: data.recruitmentMonth, name: data.name.trim(), phone: normalizeInquiryPhone(data.phone),
            message: String(data.message || '').trim(), wantsFourTimes: data.wantsFourTimes === true,
            requestedSlots: (data.requestedSlots || []).map(({ day, period }) => ({ day, period }))
                .sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day)),
            status: 'pending', createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        });
    });
}

export async function getConsultations() {
    if (!db) throw new Error('상담 요청을 불러올 수 없습니다.');
    const snapshot = await getDocsFromServer(collection(db, 'recruitmentConsultations'));
    return snapshot.docs.map(d => ({ ...d.data(), id: d.id }))
        .sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending') || (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
}

export const completeConsultation = id => updateDoc(doc(db, 'recruitmentConsultations', id), {
    status: 'completed', updatedAt: serverTimestamp(),
});
export const deleteConsultation = id => deleteDoc(doc(db, 'recruitmentConsultations', id));
