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
        // 원본 수업 날짜 OR 보강 수업 날짜가 이번 주에 포함되면 조회
        const requests = snapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() }))
            .filter(req => {
                const makeupDate = req.makeupClass.date;
                const originalDate = req.originalClass.date;
                const isMakeupInRange = makeupDate >= startDate && makeupDate <= endDate;
                const isOriginalInRange = originalDate >= startDate && originalDate <= endDate;
                return isMakeupInRange || isOriginalInRange;
            });

        console.log(`📅 ${startDate} ~ ${endDate} 보강 신청 목록:`, requests.length);
        if (requests.length > 0) {
            console.log('   보강 신청 상세:', requests.map(r => ({
                student: r.studentName,
                original: `${r.originalClass.day} ${r.originalClass.periodName} (${r.originalClass.date})`,
                makeup: `${r.makeupClass.day} ${r.makeupClass.periodName} (${r.makeupClass.date})`
            })));
        }
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
// ============================================
// HOLDING REQUEST FUNCTIONS
// ============================================

/**
 * 홀딩 신청 생성
 * @param {string} studentName - 학생 이름
 * @param {string} startDate - 시작일 (YYYY-MM-DD)
 * @param {string} endDate - 종료일 (YYYY-MM-DD)
 * @returns {Promise<Object>} - {success: boolean, id: string}
 */
export const createHoldingRequest = async (studentName, startDate, endDate) => {
    if (!isFirebaseAvailable()) {
        throw new Error('Firebase가 설정되지 않았습니다.');
    }

    try {
        console.log('🔄 홀딩 신청 생성:', { studentName, startDate, endDate });

        const docRef = await addDoc(collection(db, 'holdingRequests'), {
            studentName,
            startDate,
            endDate,
            status: 'active',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });

        console.log('✅ 홀딩 신청 생성 완료:', docRef.id);
        return { success: true, id: docRef.id };
    } catch (error) {
        console.error('❌ 홀딩 신청 실패:', error);
        throw error;
    }
};

/**
 * 학생의 활성 홀딩 조회
 * @param {string} studentName - 학생 이름
 * @returns {Promise<Object|null>} - 홀딩 정보 또는 null
 */
export const getActiveHolding = async (studentName) => {
    if (!isFirebaseAvailable()) return null;

    try {
        const q = query(
            collection(db, 'holdingRequests'),
            where('studentName', '==', studentName),
            where('status', '==', 'active')
        );

        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            return null;
        }

        const docData = snapshot.docs[0];
        return { id: docData.id, ...docData.data() };
    } catch (error) {
        console.error('❌ 홀딩 조회 실패:', error);
        throw error;
    }
};

/**
 * 특정 주의 홀딩 목록 조회
 * @param {string} startDate - 주 시작일 (YYYY-MM-DD)
 * @param {string} endDate - 주 종료일 (YYYY-MM-DD)
 * @returns {Promise<Array>} - 홀딩 목록
 */
export const getHoldingsByWeek = async (startDate, endDate) => {
    if (!isFirebaseAvailable()) return [];

    try {
        const q = query(
            collection(db, 'holdingRequests'),
            where('status', '==', 'active')
        );

        const snapshot = await getDocs(q);
        const holdings = snapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() }))
            .filter(h => h.endDate >= startDate && h.startDate <= endDate);

        console.log(`📅 ${startDate} ~ ${endDate} 홀딩 목록:`, holdings.length);
        return holdings;
    } catch (error) {
        console.error('❌ 주간 홀딩 조회 실패:', error);
        throw error;
    }
};

/**
 * 홀딩 취소
 * @param {string} holdingId - 홀딩 ID
 * @returns {Promise<void>}
 */
export const cancelHolding = async (holdingId) => {
    if (!isFirebaseAvailable()) {
        throw new Error('Firebase가 설정되지 않았습니다.');
    }

    try {
        console.log('🗑️ 홀딩 취소:', holdingId);

        await updateDoc(doc(db, 'holdingRequests', holdingId), {
            status: 'cancelled',
            updatedAt: serverTimestamp()
        });

        console.log('✅ 홀딩 취소 완료');
    } catch (error) {
        console.error('❌ 홀딩 취소 실패:', error);
        throw error;
    }
};

// ============================================
// ABSENCE REQUEST FUNCTIONS
// ============================================

/**
 * 결석 신청 생성
 * @param {string} studentName - 학생 이름
 * @param {string} date - 결석 날짜 (YYYY-MM-DD)
 * @returns {Promise<Object>} - {success: boolean, id: string}
 */
export const createAbsenceRequest = async (studentName, date) => {
    if (!isFirebaseAvailable()) {
        throw new Error('Firebase가 설정되지 않았습니다.');
    }

    try {
        console.log('🔄 결석 신청 생성:', { studentName, date });

        const docRef = await addDoc(collection(db, 'absenceRequests'), {
            studentName,
            date,
            status: 'active',
            createdAt: serverTimestamp()
        });

        console.log('✅ 결석 신청 생성 완료:', docRef.id);
        return { success: true, id: docRef.id };
    } catch (error) {
        console.error('❌ 결석 신청 실패:', error);
        throw error;
    }
};

/**
 * 학생의 결석 목록 조회
 * @param {string} studentName - 학생 이름
 * @returns {Promise<Array>} - 결석 목록
 */
export const getAbsencesByStudent = async (studentName) => {
    if (!isFirebaseAvailable()) return [];

    try {
        const q = query(
            collection(db, 'absenceRequests'),
            where('studentName', '==', studentName),
            where('status', '==', 'active')
        );

        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
        console.error('❌ 결석 목록 조회 실패:', error);
        throw error;
    }
};

/**
 * 특정 날짜의 결석 목록 조회
 * @param {string} date - 날짜 (YYYY-MM-DD)
 * @returns {Promise<Array>} - 결석 목록
 */
export const getAbsencesByDate = async (date) => {
    if (!isFirebaseAvailable()) return [];

    try {
        const q = query(
            collection(db, 'absenceRequests'),
            where('date', '==', date),
            where('status', '==', 'active')
        );

        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
        console.error('❌ 날짜별 결석 조회 실패:', error);
        throw error;
    }
};

/**
 * 결석 취소
 * @param {string} absenceId - 결석 ID
 * @returns {Promise<void>}
 */
export const cancelAbsence = async (absenceId) => {
    if (!isFirebaseAvailable()) {
        throw new Error('Firebase가 설정되지 않았습니다.');
    }

    try {
        console.log('🗑️ 결석 취소:', absenceId);

        await updateDoc(doc(db, 'absenceRequests', absenceId), {
            status: 'cancelled'
        });

        console.log('✅ 결석 취소 완료');
    } catch (error) {
        console.error('❌ 결석 취소 실패:', error);
        throw error;
    }
};

// ============================================
// ANNOUNCEMENT FUNCTIONS
// ============================================

/**
 * 공지사항 생성
 * @param {string} title - 제목
 * @param {string} content - 내용
 * @param {boolean} important - 중요 공지 여부
 * @returns {Promise<Object>} - {success: boolean, id: string}
 */
export const createAnnouncement = async (title, content, important = false) => {
    if (!isFirebaseAvailable()) {
        throw new Error('Firebase가 설정되지 않았습니다.');
    }

    try {
        console.log('📢 공지사항 생성:', { title, important });

        const docRef = await addDoc(collection(db, 'announcements'), {
            title,
            content,
            important,
            date: new Date().toISOString().split('T')[0], // YYYY-MM-DD
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });

        console.log('✅ 공지사항 생성 완료:', docRef.id);
        return { success: true, id: docRef.id };
    } catch (error) {
        console.error('❌ 공지사항 생성 실패:', error);
        throw error;
    }
};

/**
 * 모든 공지사항 조회 (최신순)
 * @returns {Promise<Array>} - 공지사항 목록
 */
export const getAnnouncements = async () => {
    if (!isFirebaseAvailable()) return [];

    try {
        const q = query(collection(db, 'announcements'));
        const snapshot = await getDocs(q);

        const announcements = snapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() }))
            .filter(a => !a.deleted) // 삭제된 공지 제외
            .sort((a, b) => {
                // 중요 공지사항을 먼저, 그 다음 최신순
                if (a.important && !b.important) return -1;
                if (!a.important && b.important) return 1;
                return (b.date || '').localeCompare(a.date || '');
            });

        console.log('📋 공지사항 조회:', announcements.length);
        return announcements;
    } catch (error) {
        console.error('❌ 공지사항 조회 실패:', error);
        throw error;
    }
};

/**
 * 공지사항 수정
 * @param {string} announcementId - 공지사항 ID
 * @param {Object} data - 수정할 데이터 {title?, content?, important?}
 * @returns {Promise<void>}
 */
export const updateAnnouncement = async (announcementId, data) => {
    if (!isFirebaseAvailable()) {
        throw new Error('Firebase가 설정되지 않았습니다.');
    }

    try {
        console.log('✏️ 공지사항 수정:', announcementId, data);

        await updateDoc(doc(db, 'announcements', announcementId), {
            ...data,
            updatedAt: serverTimestamp()
        });

        console.log('✅ 공지사항 수정 완료');
    } catch (error) {
        console.error('❌ 공지사항 수정 실패:', error);
        throw error;
    }
};

/**
 * 공지사항 삭제
 * @param {string} announcementId - 공지사항 ID
 * @returns {Promise<void>}
 */
export const deleteAnnouncement = async (announcementId) => {
    if (!isFirebaseAvailable()) {
        throw new Error('Firebase가 설정되지 않았습니다.');
    }

    try {
        console.log('🗑️ 공지사항 삭제:', announcementId);

        // Firestore에서 완전 삭제 대신 soft delete (상태 변경)
        await updateDoc(doc(db, 'announcements', announcementId), {
            deleted: true,
            updatedAt: serverTimestamp()
        });

        console.log('✅ 공지사항 삭제 완료');
    } catch (error) {
        console.error('❌ 공지사항 삭제 실패:', error);
        throw error;
    }
};
