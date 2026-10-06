import { db } from '../config/firebase';
import {
    collection, doc, documentId, getDocsFromServer, getDocFromServer,
    query, where, setDoc, serverTimestamp, runTransaction,
} from 'firebase/firestore';
import {
    koreanDate, isRecruitmentMonth, shiftMonth, monthEntrances, isEntranceAvailable,
    normalizeInquiryPhone, isInquiryPhone, validateRecruitmentSubmission, RECRUITMENT_STATUSES,
} from '../utils/recruitment';

function requireDb() {
    if (!db) throw new Error('모집 정보를 불러올 수 없습니다. 잠시 후 다시 시도해주세요.');
}
const list = snapshot => snapshot.docs.map(d => ({ ...d.data(), id: d.id }));

export async function getRecruitmentMonths() {
    requireDb();
    const current = koreanDate().slice(0, 7);
    return list(await getDocsFromServer(query(collection(db, 'recruitmentMonths'),
        where(documentId(), '>=', current), where(documentId(), '<=', shiftMonth(current, 12)))));
}

export async function getRecruitmentOverview() {
    requireDb();
    const [configs, entrances] = await Promise.all([
        getRecruitmentMonths(),
        getDocsFromServer(query(collection(db, 'entranceClasses'), where('isActive', '==', true))).then(list),
    ]);
    return { configs, entrances };
}

export async function saveRecruitmentMonth(month, data) {
    requireDb();
    if (!isRecruitmentMonth(month) || month < koreanDate().slice(0, 7) || month > shiftMonth(koreanDate().slice(0, 7), 12)) {
        throw new Error('현재 달부터 12개월 뒤까지 모집월을 선택해주세요.');
    }
    if (!RECRUITMENT_STATUSES[data.status]) throw new Error('모집 상태를 선택해주세요.');
    const phone = normalizeInquiryPhone(data.inquiryPhone);
    if (phone && !isInquiryPhone(phone)) throw new Error('문자 문의번호를 확인해주세요.');
    if (String(data.notice || '').length > 300) throw new Error('모집 안내는 300자 이내로 입력해주세요.');
    if (data.status === 'open') {
        const { entrances } = await getRecruitmentOverview();
        if (!monthEntrances(entrances, month).some(isEntranceAvailable)) {
            throw new Error('먼저 해당 월에 신청 가능한 입학반 날짜·시간·정원을 등록해주세요.');
        }
    }
    await setDoc(doc(db, 'recruitmentMonths', month), {
        month, status: data.status, inquiryPhone: phone, notice: String(data.notice || '').trim(),
        updatedAt: serverTimestamp(),
    });
}

export async function assertRecruitmentOpen(month) {
    requireDb();
    if (!isRecruitmentMonth(month)) throw new Error('모집월을 다시 선택해주세요.');
    const snapshot = await getDocFromServer(doc(db, 'recruitmentMonths', month));
    const config = snapshot.exists() ? snapshot.data() : null;
    if (config?.status !== 'open' || config.month !== month || month < koreanDate().slice(0, 7)) {
        throw new Error('선택한 월은 지금 신청할 수 없습니다. 모집 안내를 다시 확인해주세요.');
    }
    return config;
}

// 모집 상태와 입학반을 같은 서버 트랜잭션에서 읽는다. 작성 중 마감/날짜 변경도 생성 전에 거부한다.
export async function submitRecruitmentRegistration(data, status = 'pending') {
    requireDb();
    if (!isRecruitmentMonth(data.recruitmentMonth) || !['pending', 'waitlist'].includes(status)) {
        throw new Error('모집월과 신청 내용을 다시 확인해주세요.');
    }
    const registrationRef = doc(collection(db, 'newStudentRegistrations'));
    await runTransaction(db, async transaction => {
        const config = await transaction.get(doc(db, 'recruitmentMonths', data.recruitmentMonth));
        const entrance = data.entranceClassId
            ? await transaction.get(doc(db, 'entranceClasses', data.entranceClassId)) : null;
        validateRecruitmentSubmission(config.exists() ? config.data() : null, data,
            entrance?.exists() ? entrance.data() : null);
        transaction.set(registrationRef, {
            ...data, status, isWaitlist: status === 'waitlist', coachSeen: false, questionSeen: false,
            createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        });
    });
    return { success: true, id: registrationRef.id };
}
