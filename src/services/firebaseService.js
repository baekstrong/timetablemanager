import { db } from '../config/firebase';
import {
    collection,
    addDoc,
    query,
    where,
    getDocs,
    updateDoc,
    deleteDoc as firestoreDeleteDoc,
    doc,
    serverTimestamp,
    Timestamp,
    orderBy,
    getCountFromServer
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
 * 학생의 활성 보강 신청 조회 (단일 - 하위 호환성 유지)
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
 * 학생의 모든 활성 보강 신청 조회 (복수)
 * @param {string} studentName - 학생 이름
 * @returns {Promise<Array>} - 보강 신청 목록
 */
export const getActiveMakeupRequests = async (studentName) => {
    if (!isFirebaseAvailable()) return [];

    try {
        const q = query(
            collection(db, 'makeupRequests'),
            where('studentName', '==', studentName),
            where('status', 'in', ['active', 'completed'])
        );

        const snapshot = await getDocs(q);
        const requests = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        console.log(`📬 보강 신청 ${requests.length}개 조회 (active+completed):`, studentName);
        return requests;
    } catch (error) {
        console.error('❌ 보강 신청 목록 조회 실패:', error);
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
            where('status', 'in', ['active', 'completed'])
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
 * 학생의 활성 홀딩 조회 (단일)
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
 * 학생의 모든 활성 홀딩 조회 (여러 개)
 * @param {string} studentName - 학생 이름
 * @returns {Promise<Array>} - 홀딩 목록
 */
export const getHoldingsByStudent = async (studentName) => {
    if (!isFirebaseAvailable()) return [];

    try {
        const q = query(
            collection(db, 'holdingRequests'),
            where('studentName', '==', studentName),
            where('status', '==', 'active')
        );

        const snapshot = await getDocs(q);
        const holdings = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        console.log(`📋 ${studentName} 홀딩 목록 조회:`, holdings.length);
        return holdings;
    } catch (error) {
        console.error('❌ 홀딩 목록 조회 실패:', error);
        throw error;
    }
};

/**
 * 학생의 전체 홀딩 이력 조회 (active + completed + cancelled)
 * @param {string} studentName - 학생 이름
 * @returns {Promise<Array>} - 홀딩 이력 (최신순)
 */
export const getHoldingHistory = async (studentName) => {
    if (!isFirebaseAvailable()) return [];

    try {
        const q = query(
            collection(db, 'holdingRequests'),
            where('studentName', '==', studentName)
        );

        const snapshot = await getDocs(q);
        const holdings = snapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() }))
            .sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));

        return holdings;
    } catch (error) {
        console.error('❌ 홀딩 이력 조회 실패:', error);
        return [];
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

// ============================================
// HOLIDAY FUNCTIONS (코치용 휴일 설정)
// ============================================

/**
 * 휴일 추가
 * @param {string} date - 휴일 날짜 (YYYY-MM-DD)
 * @param {string} reason - 휴일 사유 (휴가, 개인 사정 등)
 * @returns {Promise<Object>} - {success: boolean, id: string}
 */
export const createHoliday = async (date, reason = '') => {
    if (!isFirebaseAvailable()) {
        throw new Error('Firebase가 설정되지 않았습니다.');
    }

    try {
        console.log('🗓️ 휴일 추가:', { date, reason });

        const docRef = await addDoc(collection(db, 'holidays'), {
            date,
            reason,
            createdAt: serverTimestamp()
        });

        console.log('✅ 휴일 추가 완료:', docRef.id);
        return { success: true, id: docRef.id };
    } catch (error) {
        console.error('❌ 휴일 추가 실패:', error);
        throw error;
    }
};

/**
 * 모든 휴일 조회
 * @returns {Promise<Array>} - 휴일 목록
 */
export const getHolidays = async () => {
    if (!isFirebaseAvailable()) return [];

    try {
        const q = query(collection(db, 'holidays'));
        const snapshot = await getDocs(q);
        const holidays = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        console.log('📋 휴일 목록 조회:', holidays.length);
        return holidays;
    } catch (error) {
        console.error('❌ 휴일 목록 조회 실패:', error);
        throw error;
    }
};

/**
 * 휴일 삭제
 * @param {string} holidayId - 휴일 ID
 * @returns {Promise<void>}
 */
export const deleteHoliday = async (holidayId) => {
    if (!isFirebaseAvailable()) {
        throw new Error('Firebase가 설정되지 않았습니다.');
    }

    try {
        console.log('🗑️ 휴일 삭제:', holidayId);

        const { deleteDoc } = await import('firebase/firestore');
        await deleteDoc(doc(db, 'holidays', holidayId));

        console.log('✅ 휴일 삭제 완료');
    } catch (error) {
        console.error('❌ 휴일 삭제 실패:', error);
        throw error;
    }
};

/**
 * 홀딩 취소 (Google Sheets도 함께 초기화)
 * @param {string} holdingId - Firebase 홀딩 ID
 * @param {string} studentName - 학생 이름 (Google Sheets 업데이트용)
 * @returns {Promise<void>}
 */
export const cancelHoldingWithSheets = async (holdingId, studentName) => {
    if (!isFirebaseAvailable()) {
        throw new Error('Firebase가 설정되지 않았습니다.');
    }

    try {
        console.log('🗑️ 홀딩 취소 (Firebase + Sheets):', holdingId, studentName);

        // Firebase 홀딩 취소
        if (holdingId) {
            await updateDoc(doc(db, 'holdingRequests', holdingId), {
                status: 'cancelled',
                updatedAt: serverTimestamp()
            });
        }

        console.log('✅ 홀딩 취소 완료');
    } catch (error) {
        console.error('❌ 홀딩 취소 실패:', error);
        throw error;
    }
};

// ============================================
// DISABLED CLASSES FUNCTIONS
// ============================================

/**
 * 비활성화된 수업 목록 조회
 * @returns {Promise<Array>} - 비활성화된 수업 키 목록 ["월-1", "수-3", ...]
 */
export const getDisabledClasses = async () => {
    if (!isFirebaseAvailable()) return [];

    try {
        const q = query(collection(db, 'disabledClasses'));
        const snapshot = await getDocs(q);

        const disabledKeys = snapshot.docs.map(doc => doc.data().key);
        console.log('📋 비활성화된 수업 조회:', disabledKeys);
        return disabledKeys;
    } catch (error) {
        console.error('❌ 비활성화된 수업 조회 실패:', error);
        return [];
    }
};

/**
 * 수업 비활성화 상태 토글
 * @param {string} key - 수업 키 (예: "월-1")
 * @returns {Promise<boolean>} - 토글 후 비활성화 상태 (true=비활성화됨)
 */
export const toggleDisabledClass = async (key) => {
    if (!isFirebaseAvailable()) {
        throw new Error('Firebase가 설정되지 않았습니다.');
    }

    try {
        // 해당 키가 이미 존재하는지 확인
        const q = query(
            collection(db, 'disabledClasses'),
            where('key', '==', key)
        );
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            // 존재하지 않으면 추가 (비활성화)
            await addDoc(collection(db, 'disabledClasses'), {
                key,
                createdAt: serverTimestamp()
            });
            console.log('🚫 수업 비활성화:', key);
            return true;
        } else {
            // 존재하면 삭제 (활성화)
            const docId = snapshot.docs[0].id;
            const { deleteDoc } = await import('firebase/firestore');
            await deleteDoc(doc(db, 'disabledClasses', docId));
            console.log('✅ 수업 활성화:', key);
            return false;
        }
    } catch (error) {
        console.error('❌ 수업 비활성화 토글 실패:', error);
        throw error;
    }
};

// ============================================
// LOCKED SLOTS FUNCTIONS (보강 차단)
// ============================================

/**
 * 잠긴 슬롯 목록 조회 (날짜 지난 것은 자동 삭제)
 * @returns {Promise<Array>} - 잠긴 슬롯 키 목록 ["월-1", "금-4", ...]
 */
export const getLockedSlots = async () => {
    if (!isFirebaseAvailable()) return [];

    try {
        const q = query(collection(db, 'lockedSlots'));
        const snapshot = await getDocs(q);

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

        const activeKeys = [];
        const expiredDocs = [];

        snapshot.docs.forEach(docSnap => {
            const data = docSnap.data();
            if (data.date && data.date < todayStr) {
                expiredDocs.push(docSnap.id);
            } else {
                activeKeys.push(data.key);
            }
        });

        // 지난 날짜 잠금 자동 삭제
        if (expiredDocs.length > 0) {
            const { deleteDoc } = await import('firebase/firestore');
            await Promise.all(expiredDocs.map(id => deleteDoc(doc(db, 'lockedSlots', id))));
            console.log('🗑️ 만료된 슬롯 잠금 삭제:', expiredDocs.length, '건');
        }

        console.log('🔒 잠긴 슬롯 조회:', activeKeys);
        return activeKeys;
    } catch (error) {
        console.error('❌ 잠긴 슬롯 조회 실패:', error);
        return [];
    }
};

/**
 * 슬롯 잠금 상태 토글
 * @param {string} key - 슬롯 키 (예: "월-1")
 * @param {string} date - 해당 슬롯의 날짜 (YYYY-MM-DD)
 * @returns {Promise<boolean>} - 토글 후 잠금 상태 (true=잠김)
 */
export const toggleLockedSlot = async (key, date) => {
    if (!isFirebaseAvailable()) {
        throw new Error('Firebase가 설정되지 않았습니다.');
    }

    try {
        const q = query(
            collection(db, 'lockedSlots'),
            where('key', '==', key),
            where('date', '==', date)
        );
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            await addDoc(collection(db, 'lockedSlots'), {
                key,
                date,
                createdAt: serverTimestamp()
            });
            console.log('🔒 슬롯 잠금:', key, date);
            return true;
        } else {
            const docId = snapshot.docs[0].id;
            const { deleteDoc } = await import('firebase/firestore');
            await deleteDoc(doc(db, 'lockedSlots', docId));
            console.log('🔓 슬롯 잠금 해제:', key, date);
            return false;
        }
    } catch (error) {
        console.error('❌ 슬롯 잠금 토글 실패:', error);
        throw error;
    }
};

// ============================================
// NEW STUDENT REGISTRATION FUNCTIONS
// ============================================

/**
 * 신규 수강생 등록 생성
 * @param {Object} data - 등록 데이터
 * @param {string} status - 등록 상태 ('pending' | 'waitlist', 기본값 'pending')
 * @returns {Promise<Object>} - {success: boolean, id: string}
 */
export const createNewStudentRegistration = async (data, status = 'pending') => {
    if (!isFirebaseAvailable()) {
        throw new Error('Firebase가 설정되지 않았습니다.');
    }

    try {
        const docRef = await addDoc(collection(db, 'newStudentRegistrations'), {
            ...data,
            status,
            isWaitlist: status === 'waitlist',
            coachSeen: false,
            questionSeen: false,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });

        return { success: true, id: docRef.id };
    } catch (error) {
        console.error('❌ 신규 수강생 등록 실패:', error);
        throw error;
    }
};

/**
 * 신규 수강생 등록 목록 조회
 * @param {string} status - 상태 필터 ('pending'|'approved'|'rejected', null=전체)
 * @returns {Promise<Array>}
 */
export const getNewStudentRegistrations = async (status = null) => {
    if (!isFirebaseAvailable()) return [];

    try {
        let q;
        if (status) {
            q = query(
                collection(db, 'newStudentRegistrations'),
                where('status', '==', status)
            );
        } else {
            q = query(collection(db, 'newStudentRegistrations'));
        }

        const snapshot = await getDocs(q);
        const registrations = snapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() }))
            .sort((a, b) => {
                const aTime = a.createdAt?.toMillis?.() || 0;
                const bTime = b.createdAt?.toMillis?.() || 0;
                return bTime - aTime;
            });

        return registrations;
    } catch (error) {
        console.error('❌ 등록 목록 조회 실패:', error);
        throw error;
    }
};

/**
 * 대기 중인 등록 수 조회 (알림용, pending + waitlist 모두 포함)
 * @returns {Promise<number>}
 */
export const getPendingRegistrationCount = async () => {
    if (!isFirebaseAvailable()) return 0;

    try {
        const q = query(
            collection(db, 'newStudentRegistrations'),
            where('status', 'in', ['pending', 'waitlist'])
        );
        const snapshot = await getDocs(q);
        return snapshot.size;
    } catch (error) {
        console.error('❌ 대기 등록 수 조회 실패:', error);
        return 0;
    }
};

/**
 * 신규 수강생 등록 업데이트
 * @param {string} id - 등록 ID
 * @param {Object} data - 업데이트할 데이터
 * @returns {Promise<void>}
 */
export const updateNewStudentRegistration = async (id, data) => {
    if (!isFirebaseAvailable()) {
        throw new Error('Firebase가 설정되지 않았습니다.');
    }

    try {
        await updateDoc(doc(db, 'newStudentRegistrations', id), {
            ...data,
            updatedAt: serverTimestamp()
        });
    } catch (error) {
        console.error('❌ 등록 업데이트 실패:', error);
        throw error;
    }
};

/**
 * 신규 수강생 등록 삭제
 * @param {string} id - 등록 ID
 * @returns {Promise<void>}
 */
export const deleteNewStudentRegistration = async (id) => {
    if (!isFirebaseAvailable()) {
        throw new Error('Firebase가 설정되지 않았습니다.');
    }

    try {
        await firestoreDeleteDoc(doc(db, 'newStudentRegistrations', id));
    } catch (error) {
        console.error('❌ 등록 삭제 실패:', error);
        throw error;
    }
};

// ============================================
// ENTRANCE CLASS FUNCTIONS
// ============================================

/**
 * 입학반 생성
 * @param {Object} data - {date, time, description, maxCapacity}
 * @returns {Promise<Object>}
 */
export const createEntranceClass = async (data) => {
    if (!isFirebaseAvailable()) {
        throw new Error('Firebase가 설정되지 않았습니다.');
    }

    try {
        const docRef = await addDoc(collection(db, 'entranceClasses'), {
            ...data,
            currentCount: 0,
            isActive: true,
            createdAt: serverTimestamp()
        });

        return { success: true, id: docRef.id };
    } catch (error) {
        console.error('❌ 입학반 생성 실패:', error);
        throw error;
    }
};

/**
 * 입학반 목록 조회
 * @param {boolean} activeOnly - true면 활성만
 * @returns {Promise<Array>}
 */
export const getEntranceClasses = async (activeOnly = true) => {
    if (!isFirebaseAvailable()) return [];

    try {
        let q;
        if (activeOnly) {
            q = query(
                collection(db, 'entranceClasses'),
                where('isActive', '==', true)
            );
        } else {
            q = query(collection(db, 'entranceClasses'));
        }

        const snapshot = await getDocs(q);
        const classes = snapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() }))
            .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

        return classes;
    } catch (error) {
        console.error('❌ 입학반 조회 실패:', error);
        throw error;
    }
};

/**
 * 입학반 업데이트
 * @param {string} id - 입학반 ID
 * @param {Object} data - 업데이트 데이터
 * @returns {Promise<void>}
 */
export const updateEntranceClass = async (id, data) => {
    if (!isFirebaseAvailable()) {
        throw new Error('Firebase가 설정되지 않았습니다.');
    }

    try {
        await updateDoc(doc(db, 'entranceClasses', id), {
            ...data
        });
    } catch (error) {
        console.error('❌ 입학반 업데이트 실패:', error);
        throw error;
    }
};

/**
 * 입학반 삭제
 * @param {string} id - 입학반 ID
 * @returns {Promise<void>}
 */
export const deleteEntranceClass = async (id) => {
    if (!isFirebaseAvailable()) {
        throw new Error('Firebase가 설정되지 않았습니다.');
    }

    try {
        await firestoreDeleteDoc(doc(db, 'entranceClasses', id));
    } catch (error) {
        console.error('❌ 입학반 삭제 실패:', error);
        throw error;
    }
};

// ============================================
// REGISTRATION FAQ FUNCTIONS
// ============================================

/**
 * FAQ 생성
 * @param {Object} data - {question, answer, order}
 * @returns {Promise<Object>}
 */
export const createFAQ = async (data) => {
    if (!isFirebaseAvailable()) {
        throw new Error('Firebase가 설정되지 않았습니다.');
    }

    try {
        const docRef = await addDoc(collection(db, 'registrationFAQ'), {
            ...data,
            isActive: true,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });

        return { success: true, id: docRef.id };
    } catch (error) {
        console.error('❌ FAQ 생성 실패:', error);
        throw error;
    }
};

/**
 * FAQ 목록 조회
 * @param {boolean} activeOnly - true면 활성만
 * @returns {Promise<Array>}
 */
export const getFAQs = async (activeOnly = true) => {
    if (!isFirebaseAvailable()) return [];

    try {
        let q;
        if (activeOnly) {
            q = query(
                collection(db, 'registrationFAQ'),
                where('isActive', '==', true)
            );
        } else {
            q = query(collection(db, 'registrationFAQ'));
        }

        const snapshot = await getDocs(q);
        const faqs = snapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() }))
            .sort((a, b) => (a.order || 0) - (b.order || 0));

        return faqs;
    } catch (error) {
        console.error('❌ FAQ 조회 실패:', error);
        throw error;
    }
};

/**
 * FAQ 업데이트
 * @param {string} id - FAQ ID
 * @param {Object} data - 업데이트 데이터
 * @returns {Promise<void>}
 */
export const updateFAQ = async (id, data) => {
    if (!isFirebaseAvailable()) {
        throw new Error('Firebase가 설정되지 않았습니다.');
    }

    try {
        await updateDoc(doc(db, 'registrationFAQ', id), {
            ...data,
            updatedAt: serverTimestamp()
        });
    } catch (error) {
        console.error('❌ FAQ 업데이트 실패:', error);
        throw error;
    }
};

/**
 * FAQ 삭제
 * @param {string} id - FAQ ID
 * @returns {Promise<void>}
 */
export const deleteFAQ = async (id) => {
    if (!isFirebaseAvailable()) {
        throw new Error('Firebase가 설정되지 않았습니다.');
    }

    try {
        await firestoreDeleteDoc(doc(db, 'registrationFAQ', id));
    } catch (error) {
        console.error('❌ FAQ 삭제 실패:', error);
        throw error;
    }
};

// ============================================
// WAITLIST FUNCTIONS (대기 신청)
// ============================================

/**
 * 대기 신청 생성 (영구적 시간표 변경 요청)
 * @param {string} studentName - 학생 이름
 * @param {Object} currentSlot - 현재 수업 {day, period, periodName}
 * @param {Object} desiredSlot - 옮기고 싶은 슬롯 {day, period, periodName}
 * @returns {Promise<Object>} - {success: boolean, id: string}
 */
export const createWaitlistRequest = async (studentName, currentSlot, desiredSlot) => {
    if (!isFirebaseAvailable()) {
        throw new Error('Firebase가 설정되지 않았습니다.');
    }

    try {
        // 중복 대기 신청 방지 (같은 목표 슬롯)
        const existing = await getActiveWaitlistByDesiredSlot(studentName, desiredSlot.day, desiredSlot.period);
        if (existing) {
            throw new Error('이미 해당 시간에 대기 신청이 되어 있습니다.');
        }

        const docRef = await addDoc(collection(db, 'waitlistRequests'), {
            studentName,
            currentSlot: {
                day: currentSlot.day,
                period: currentSlot.period,
                periodName: currentSlot.periodName
            },
            desiredSlot: {
                day: desiredSlot.day,
                period: desiredSlot.period,
                periodName: desiredSlot.periodName
            },
            status: 'waiting', // waiting → notified → accepted → cancelled
            notifiedAt: null,
            respondedAt: null,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });

        console.log('✅ 대기 신청 생성 완료:', docRef.id);
        return { success: true, id: docRef.id };
    } catch (error) {
        console.error('❌ 대기 신청 실패:', error);
        throw error;
    }
};

/**
 * 특정 학생+목표 슬롯의 활성 대기 신청 조회
 */
const getActiveWaitlistByDesiredSlot = async (studentName, day, period) => {
    if (!isFirebaseAvailable()) return null;

    try {
        const q = query(
            collection(db, 'waitlistRequests'),
            where('studentName', '==', studentName),
            where('desiredSlot.day', '==', day),
            where('desiredSlot.period', '==', period),
            where('status', 'in', ['waiting', 'notified'])
        );

        const snapshot = await getDocs(q);
        if (snapshot.empty) return null;
        return { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
    } catch (error) {
        console.error('❌ 대기 신청 조회 실패:', error);
        return null;
    }
};

/**
 * 학생의 활성 대기 신청 목록 조회
 * @param {string} studentName - 학생 이름
 * @returns {Promise<Array>}
 */
export const getActiveWaitlistRequests = async (studentName) => {
    if (!isFirebaseAvailable()) return [];

    try {
        const q = query(
            collection(db, 'waitlistRequests'),
            where('studentName', '==', studentName),
            where('status', 'in', ['waiting', 'notified'])
        );

        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
        console.error('❌ 대기 신청 목록 조회 실패:', error);
        return [];
    }
};

/**
 * 모든 활성 대기 신청 조회 (코치/자동 알림용)
 * @returns {Promise<Array>}
 */
export const getAllActiveWaitlist = async () => {
    if (!isFirebaseAvailable()) return [];

    try {
        const q = query(
            collection(db, 'waitlistRequests'),
            where('status', 'in', ['waiting', 'notified'])
        );

        const snapshot = await getDocs(q);
        return snapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() }))
            .sort((a, b) => {
                const aTime = a.createdAt?.toMillis?.() || 0;
                const bTime = b.createdAt?.toMillis?.() || 0;
                return aTime - bTime;
            });
    } catch (error) {
        console.error('❌ 대기 목록 조회 실패:', error);
        return [];
    }
};

/**
 * 대기 신청 취소
 * @param {string} waitlistId - 대기 신청 ID
 * @returns {Promise<void>}
 */
export const cancelWaitlistRequest = async (waitlistId) => {
    if (!isFirebaseAvailable()) {
        throw new Error('Firebase가 설정되지 않았습니다.');
    }

    try {
        await updateDoc(doc(db, 'waitlistRequests', waitlistId), {
            status: 'cancelled',
            updatedAt: serverTimestamp()
        });
        console.log('✅ 대기 신청 취소 완료');
    } catch (error) {
        console.error('❌ 대기 신청 취소 실패:', error);
        throw error;
    }
};

/**
 * 대기 신청에 알림 발송 (자리가 남)
 * @param {string} waitlistId - 대기 신청 ID
 * @returns {Promise<void>}
 */
export const notifyWaitlistRequest = async (waitlistId) => {
    if (!isFirebaseAvailable()) {
        throw new Error('Firebase가 설정되지 않았습니다.');
    }

    try {
        await updateDoc(doc(db, 'waitlistRequests', waitlistId), {
            status: 'notified',
            notifiedAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });
        console.log('✅ 대기 알림 발송 완료:', waitlistId);
    } catch (error) {
        console.error('❌ 대기 알림 발송 실패:', error);
        throw error;
    }
};

/**
 * 대기 승인 취소 (notified → waiting 되돌리기)
 * @param {string} waitlistId - 대기 신청 ID
 * @returns {Promise<void>}
 */
export const revertWaitlistNotification = async (waitlistId) => {
    if (!isFirebaseAvailable()) {
        throw new Error('Firebase가 설정되지 않았습니다.');
    }

    try {
        await updateDoc(doc(db, 'waitlistRequests', waitlistId), {
            status: 'waiting',
            notifiedAt: null,
            updatedAt: serverTimestamp()
        });
        console.log('✅ 대기 승인 취소 완료:', waitlistId);
    } catch (error) {
        console.error('❌ 대기 승인 취소 실패:', error);
        throw error;
    }
};

/**
 * 대기 신청 수락 (수강생이 자리를 확정)
 * @param {string} waitlistId - 대기 신청 ID
 * @returns {Promise<void>}
 */
export const acceptWaitlistRequest = async (waitlistId) => {
    if (!isFirebaseAvailable()) {
        throw new Error('Firebase가 설정되지 않았습니다.');
    }

    try {
        await updateDoc(doc(db, 'waitlistRequests', waitlistId), {
            status: 'accepted',
            respondedAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });
        console.log('✅ 대기 수락 완료:', waitlistId);
    } catch (error) {
        console.error('❌ 대기 수락 실패:', error);
        throw error;
    }
};

