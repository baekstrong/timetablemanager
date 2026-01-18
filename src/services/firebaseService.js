import { db } from '../config/firebase';
import {
    collection,
    addDoc,
    query,
    where,
    getDocs,
    updateDoc,
    doc,
    serverTimestamp,
    Timestamp
} from 'firebase/firestore';

// Check if Firebase is available
const isFirebaseAvailable = () => {
    if (!db) {
        console.warn('⚠️ Firebase not initialized - makeup class features unavailable');
        return false;
    }
    return true;
};

/**
 * 보강 신청 생성
 * @param {string} studentName - 학생 이름
 * @param {Object} originalClass - 원본 수업 정보 {date, day, period, periodName}
 * @param {Object} makeupClass - 보강 수업 정보 {date, day, period, periodName}
 * @returns {Promise<Object>} - {success: boolean, id: string}
 */
export const createMakeupRequest = async (studentName, originalClass, makeupClass) => {
    if (!isFirebaseAvailable()) {
        throw new Error('Firebase가 설정되지 않았습니다. 관리자에게 문의하세요.');
    }

    try {
        console.log('🔄 보강 신청 생성:', { studentName, originalClass, makeupClass });

        const docRef = await addDoc(collection(db, 'makeupRequests'), {
            studentName,
            originalClass: {
                date: originalClass.date,
                day: originalClass.day,
                period: originalClass.period,
                periodName: originalClass.periodName
            },
            makeupClass: {
                date: makeupClass.date,
                day: makeupClass.day,
                period: makeupClass.period,
                periodName: makeupClass.periodName
            },
            status: 'active',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });

        console.log('✅ 보강 신청 생성 완료:', docRef.id);
        return { success: true, id: docRef.id };
    } catch (error) {
        console.error('❌ 보강 신청 실패:', error);
        throw error;
    }
};

/**
 * 학생의 활성 보강 신청 조회
 * @param {string} studentName - 학생 이름
 * @returns {Promise<Object|null>} - 보강 신청 정보 또는 null
 */
export const getActiveMakeupRequest = async (studentName) => {
    if (!isFirebaseAvailable()) return null;

    try {
        const q = query(
            collection(db, 'makeupRequests'),
            where('studentName', '==', studentName),
            where('status', '==', 'active')
        );

        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            console.log('📭 활성 보강 신청 없음:', studentName);
            return null;
        }

        const docData = snapshot.docs[0];
        const data = { id: docData.id, ...docData.data() };

        console.log('📬 활성 보강 신청 조회:', data);
        return data;
    } catch (error) {
        console.error('❌ 보강 신청 조회 실패:', error);
        throw error;
    }
};

/**
 * 특정 날짜의 보강 신청 목록 조회 (코치용)
 * @param {string} date - 날짜 (YYYY-MM-DD)
 * @returns {Promise<Array>} - 보강 신청 목록
 */
export const getMakeupRequestsByDate = async (date) => {
    if (!isFirebaseAvailable()) return [];

    try {
        const q = query(
            collection(db, 'makeupRequests'),
            where('makeupClass.date', '==', date),
            where('status', '==', 'active')
        );

        const snapshot = await getDocs(q);
        const requests = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        console.log(`📅 ${date} 보강 신청 목록:`, requests.length);
        return requests;
    } catch (error) {
        console.error('❌ 날짜별 보강 신청 조회 실패:', error);
        throw error;
    }
};

/**
 * 특정 주의 모든 보강 신청 조회 (코치용)
 * @param {string} startDate - 주 시작일 (YYYY-MM-DD)
 * @param {string} endDate - 주 종료일 (YYYY-MM-DD)
 * @returns {Promise<Array>} - 보강 신청 목록
 */
export const getMakeupRequestsByWeek = async (startDate, endDate) => {
    try {
        const q = query(
            collection(db, 'makeupRequests'),
            where('status', '==', 'active')
        );

        const snapshot = await getDocs(q);

        // 클라이언트 측에서 날짜 범위 필터링
        const requests = snapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() }))
            .filter(req => {
                const makeupDate = req.makeupClass.date;
                return makeupDate >= startDate && makeupDate <= endDate;
            });

        console.log(`📅 ${startDate} ~ ${endDate} 보강 신청 목록:`, requests.length);
        return requests;
    } catch (error) {
        console.error('❌ 주간 보강 신청 조회 실패:', error);
        throw error;
    }
};

/**
 * 원본 수업에서 빠진 학생 조회 (코치용)
 * @param {string} date - 날짜 (YYYY-MM-DD)
 * @param {string} day - 요일
 * @param {number} period - 교시
 * @returns {Promise<Array>} - 빠진 학생 목록
 */
export const getAbsentStudentsByClass = async (date, day, period) => {
    try {
        const q = query(
            collection(db, 'makeupRequests'),
            where('originalClass.day', '==', day),
            where('originalClass.period', '==', period),
            where('status', '==', 'active')
        );

        const snapshot = await getDocs(q);
        const students = snapshot.docs.map(doc => ({
            id: doc.id,
            studentName: doc.data().studentName,
            ...doc.data()
        }));

        return students;
    } catch (error) {
        console.error('❌ 결석 학생 조회 실패:', error);
        throw error;
    }
};

/**
 * 보강 신청 취소
 * @param {string} requestId - 보강 신청 ID
 * @returns {Promise<void>}
 */
export const cancelMakeupRequest = async (requestId) => {
    try {
        console.log('🗑️ 보강 신청 취소:', requestId);

        const docRef = doc(db, 'makeupRequests', requestId);
        await updateDoc(docRef, {
            status: 'cancelled',
            updatedAt: serverTimestamp()
        });

        console.log('✅ 보강 신청 취소 완료');
    } catch (error) {
        console.error('❌ 보강 신청 취소 실패:', error);
        throw error;
    }
};

/**
 * 보강 신청 완료 처리 (출석 후)
 * @param {string} requestId - 보강 신청 ID
 * @returns {Promise<void>}
 */
export const completeMakeupRequest = async (requestId) => {
    try {
        console.log('✅ 보강 신청 완료 처리:', requestId);

        const docRef = doc(db, 'makeupRequests', requestId);
        await updateDoc(docRef, {
            status: 'completed',
            updatedAt: serverTimestamp()
        });

        console.log('✅ 보강 신청 완료');
    } catch (error) {
        console.error('❌ 보강 신청 완료 처리 실패:', error);
        throw error;
    }
};
