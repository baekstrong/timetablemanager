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
    limit as queryLimit,
    getDoc,
    setDoc,
    arrayUnion,
    arrayRemove,
    increment,
    writeBatch,
    onSnapshot,
    startAfter
} from 'firebase/firestore';

// ============================================
// INTERNAL HELPERS
// ============================================

/**
 * Firebase 사용 가능 여부 확인. 불가 시 fallback 반환 또는 에러 throw.
 * @param {*} fallback - null이 아니면 해당 값을 반환, null이면 에러를 throw
 */
function assertFirebase(fallback = undefined) {
    if (!db) {
        if (fallback !== undefined) {
            console.warn('Firebase not initialized');
            return fallback;
        }
        throw new Error('Firebase가 설정되지 않았습니다. 관리자에게 문의하세요.');
    }
    return null;
}

const HOLIDAY_CACHE_TTL_MS = 5 * 60 * 1000;
let holidaysCache = null;
let holidaysCacheFetchedAt = 0;

function clearHolidaysCache() {
    holidaysCache = null;
    holidaysCacheFetchedAt = 0;
}

function dedupeDocsById(docs) {
    const map = new Map();
    docs.forEach(item => {
        if (item?.id) map.set(item.id, item);
    });
    return Array.from(map.values());
}

/**
 * Firestore 쿼리 실행 후 docs를 { id, ...data() } 형태로 매핑
 */
async function queryDocs(collectionName, ...constraints) {
    const q = constraints.length > 0
        ? query(collection(db, collectionName), ...constraints)
        : query(collection(db, collectionName));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * 문서의 status 및 추가 필드를 업데이트하는 공통 함수
 */
async function updateDocStatus(collectionName, docId, fields) {
    await updateDoc(doc(db, collectionName, docId), {
        ...fields,
        updatedAt: serverTimestamp()
    });
}

/**
 * 컬렉션에 문서 추가 후 { success: true, id } 반환
 */
async function createDoc(collectionName, data) {
    const docRef = await addDoc(collection(db, collectionName), {
        ...data,
        createdAt: serverTimestamp()
    });
    return { success: true, id: docRef.id };
}

/**
 * 읽기 작업 래퍼: firebase 체크 + 에러 시 fallback 반환
 */
async function safeRead(fallback, fn) {
    const bail = assertFirebase(fallback);
    if (bail !== null) return bail;
    try {
        return await fn();
    } catch (error) {
        console.error(error);
        throw error;
    }
}

/**
 * 쓰기 작업 래퍼: firebase 체크 + 에러 시 throw
 */
async function safeWrite(fn) {
    assertFirebase();
    try {
        return await fn();
    } catch (error) {
        console.error(error);
        throw error;
    }
}

// ============================================
// USERS (계정)
// ============================================

/**
 * users/{userName} 비밀번호 변경 — 현재 비밀번호 일치 검증 후 갱신.
 */
export const updateUserPassword = async (userName, currentPassword, newPassword) => {
    return safeWrite(async () => {
        const userRef = doc(db, 'users', userName);
        const userDoc = await getDoc(userRef);
        if (!userDoc.exists()) throw new Error('계정을 찾을 수 없습니다.');
        if (userDoc.data().password !== currentPassword) {
            throw new Error('현재 비밀번호가 올바르지 않습니다.');
        }
        await updateDoc(userRef, { password: newPassword, updatedAt: serverTimestamp() });
        return { success: true };
    });
};

// ============================================
// MAKEUP REQUEST FUNCTIONS (보강)
// ============================================

export const createMakeupRequest = async (studentName, originalClass, makeupClass) => {
    return safeWrite(async () => {
        console.log('보강 신청 생성:', { studentName, originalClass, makeupClass });

        const result = await createDoc('makeupRequests', {
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
            updatedAt: serverTimestamp()
        });

        console.log('보강 신청 생성 완료:', result.id);
        return result;
    });
};

export const getActiveMakeupRequest = async (studentName) => {
    return safeRead(null, async () => {
        const results = await queryDocs('makeupRequests',
            where('studentName', '==', studentName),
            where('status', '==', 'active')
        );

        if (results.length === 0) {
            console.log('활성 보강 신청 없음:', studentName);
            return null;
        }

        console.log('활성 보강 신청 조회:', results[0]);
        return results[0];
    });
};

export const getActiveMakeupRequests = async (studentName) => {
    return safeRead([], async () => {
        const requests = await queryDocs('makeupRequests',
            where('studentName', '==', studentName),
            where('status', 'in', ['active', 'completed'])
        );

        console.log(`보강 신청 ${requests.length}개 조회 (active+completed):`, studentName);
        return requests;
    });
};

// 주간 보강 쿼터 계산용 — 상태 무관 전체 조회 (cancelled 포함)
// 취소된 보강도 "주 1회" 쿼터를 소진한 것으로 간주하기 위함
export const getWeekMakeupRequests = async (studentName, startDate, endDate) => {
    return safeRead([], async () => {
        const allRequests = await queryDocs('makeupRequests',
            where('studentName', '==', studentName)
        );
        const requests = allRequests.filter(req => {
            const makeupDate = req.makeupClass?.date;
            const originalDate = req.originalClass?.date;
            return (makeupDate >= startDate && makeupDate <= endDate) ||
                   (originalDate >= startDate && originalDate <= endDate);
        });
        console.log(`${studentName} 주간 보강 이력(${startDate}~${endDate}) ${requests.length}개 (전체 상태)`);
        return requests;
    });
};

export const getMakeupRequestsByDate = async (date) => {
    return safeRead([], async () => {
        const requests = await queryDocs('makeupRequests',
            where('makeupClass.date', '==', date),
            where('status', '==', 'active')
        );

        console.log(`${date} 보강 신청 목록:`, requests.length);
        return requests;
    });
};

export const getMakeupRequestsByWeek = async (startDate, endDate) => {
    return safeRead([], async () => {
        const [makeupDateRequests, originalDateRequests] = await Promise.all([
            queryDocs('makeupRequests',
                where('makeupClass.date', '>=', startDate),
                where('makeupClass.date', '<=', endDate)
            ),
            queryDocs('makeupRequests',
                where('originalClass.date', '>=', startDate),
                where('originalClass.date', '<=', endDate)
            )
        ]);

        const requests = dedupeDocsById([...makeupDateRequests, ...originalDateRequests]).filter(req => {
            if (!['active', 'completed'].includes(req.status)) return false;
            const makeupDate = req.makeupClass?.date;
            const originalDate = req.originalClass?.date;
            return (makeupDate >= startDate && makeupDate <= endDate) ||
                   (originalDate >= startDate && originalDate <= endDate);
        });

        console.log(`${startDate} ~ ${endDate} 보강 신청 목록:`, requests.length);
        if (requests.length > 0) {
            console.log('   보강 신청 상세:', requests.map(r => ({
                student: r.studentName,
                original: `${r.originalClass.day} ${r.originalClass.periodName} (${r.originalClass.date})`,
                makeup: `${r.makeupClass.day} ${r.makeupClass.periodName} (${r.makeupClass.date})`
            })));
        }
        return requests;
    });
};

export const getAbsentStudentsByClass = async (date, day, period) => {
    return safeRead([], async () => {
        const results = await queryDocs('makeupRequests',
            where('originalClass.day', '==', day),
            where('originalClass.period', '==', period),
            where('status', '==', 'active')
        );
        return results;
    });
};

export const cancelMakeupRequest = async (requestId) => {
    return safeWrite(async () => {
        console.log('보강 신청 취소:', requestId);
        await updateDocStatus('makeupRequests', requestId, { status: 'cancelled' });
        console.log('보강 신청 취소 완료');
    });
};

export const completeMakeupRequest = async (requestId) => {
    return safeWrite(async () => {
        console.log('보강 신청 완료 처리:', requestId);
        await updateDocStatus('makeupRequests', requestId, { status: 'completed' });
        console.log('보강 신청 완료');
    });
};

// ============================================
// HOLDING REQUEST FUNCTIONS (홀딩)
// ============================================

export const createHoldingRequest = async (studentName, startDate, endDate, holdingDates) => {
    return safeWrite(async () => {
        console.log('홀딩 신청 생성:', { studentName, startDate, endDate, holdingDates });

        const result = await createDoc('holdingRequests', {
            studentName,
            startDate,
            endDate,
            holdingDates: holdingDates || [],
            status: 'active',
            updatedAt: serverTimestamp()
        });

        console.log('홀딩 신청 생성 완료:', result.id);
        return result;
    });
};

export const getAllActiveHoldings = async () => {
    return safeRead([], async () => {
        return await queryDocs('holdingRequests',
            where('status', '==', 'active')
        );
    });
};

export const getActiveHolding = async (studentName) => {
    return safeRead(null, async () => {
        const results = await queryDocs('holdingRequests',
            where('studentName', '==', studentName),
            where('status', '==', 'active')
        );
        return results.length > 0 ? results[0] : null;
    });
};

export const getHoldingsByStudent = async (studentName) => {
    return safeRead([], async () => {
        const holdings = await queryDocs('holdingRequests',
            where('studentName', '==', studentName),
            where('status', '==', 'active')
        );
        console.log(`${studentName} 홀딩 목록 조회:`, holdings.length);
        return holdings;
    });
};

export const getHoldingHistory = async (studentName) => {
    if (!db) return [];

    try {
        const holdings = await queryDocs('holdingRequests',
            where('studentName', '==', studentName)
        );
        return holdings.sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
    } catch (error) {
        console.error('홀딩 이력 조회 실패:', error);
        return [];
    }
};

export const getHoldingsByWeek = async (startDate, endDate) => {
    return safeRead([], async () => {
        const possibleHoldings = await queryDocs('holdingRequests',
            where('endDate', '>=', startDate)
        );
        const holdings = possibleHoldings.filter(h =>
            h.status === 'active' &&
            h.endDate >= startDate &&
            h.startDate <= endDate
        );
        console.log(`${startDate} ~ ${endDate} 홀딩 목록:`, holdings.length);
        return holdings;
    });
};

export const cancelHolding = async (holdingId) => {
    return safeWrite(async () => {
        console.log('홀딩 취소:', holdingId);
        await updateDocStatus('holdingRequests', holdingId, { status: 'cancelled' });
        console.log('홀딩 취소 완료');
    });
};

// ============================================
// ABSENCE REQUEST FUNCTIONS (결석)
// ============================================

export const createAbsenceRequest = async (studentName, date) => {
    return safeWrite(async () => {
        console.log('결석 신청 생성:', { studentName, date });

        const result = await createDoc('absenceRequests', {
            studentName,
            date,
            status: 'active'
        });

        console.log('결석 신청 생성 완료:', result.id);
        return result;
    });
};

export const getAbsencesByStudent = async (studentName) => {
    return safeRead([], async () => {
        return queryDocs('absenceRequests',
            where('studentName', '==', studentName),
            where('status', '==', 'active')
        );
    });
};

export const getAbsencesByDate = async (date) => {
    return safeRead([], async () => {
        return queryDocs('absenceRequests',
            where('date', '==', date),
            where('status', '==', 'active')
        );
    });
};

export const cancelAbsence = async (absenceId) => {
    return safeWrite(async () => {
        console.log('결석 취소:', absenceId);
        await updateDoc(doc(db, 'absenceRequests', absenceId), {
            status: 'cancelled'
        });
        console.log('결석 취소 완료');
    });
};

// ============================================
// ANNOUNCEMENT FUNCTIONS (공지사항)
// ============================================

export const createAnnouncement = async (title, content, important = false) => {
    return safeWrite(async () => {
        console.log('공지사항 생성:', { title, important });

        const result = await createDoc('announcements', {
            title,
            content,
            important,
            date: new Date().toISOString().split('T')[0],
            updatedAt: serverTimestamp()
        });

        console.log('공지사항 생성 완료:', result.id);
        return result;
    });
};

export const getAnnouncements = async () => {
    return safeRead([], async () => {
        const announcements = await queryDocs('announcements');

        const filtered = announcements
            .filter(a => !a.deleted)
            .sort((a, b) => {
                if (a.important && !b.important) return -1;
                if (!a.important && b.important) return 1;
                return (b.date || '').localeCompare(a.date || '');
            });

        console.log('공지사항 조회:', filtered.length);
        return filtered;
    });
};

export const updateAnnouncement = async (announcementId, data) => {
    return safeWrite(async () => {
        console.log('공지사항 수정:', announcementId, data);
        await updateDocStatus('announcements', announcementId, data);
        console.log('공지사항 수정 완료');
    });
};

export const deleteAnnouncement = async (announcementId) => {
    return safeWrite(async () => {
        console.log('공지사항 삭제:', announcementId);
        await updateDocStatus('announcements', announcementId, { deleted: true });
        console.log('공지사항 삭제 완료');
    });
};

// ============================================
// HOLIDAY FUNCTIONS (코치용 휴일 설정)
// ============================================

export const createHoliday = async (date, reason = '') => {
    return safeWrite(async () => {
        console.log('휴일 추가:', { date, reason });
        const result = await createDoc('holidays', { date, reason });
        clearHolidaysCache();
        console.log('휴일 추가 완료:', result.id);
        return result;
    });
};

export const getHolidays = async () => {
    return safeRead([], async () => {
        const now = Date.now();
        if (holidaysCache && now - holidaysCacheFetchedAt < HOLIDAY_CACHE_TTL_MS) {
            return holidaysCache;
        }
        const holidays = await queryDocs('holidays');
        holidaysCache = holidays;
        holidaysCacheFetchedAt = now;
        console.log('휴일 목록 조회:', holidays.length);
        return holidays;
    });
};

export const deleteHoliday = async (holidayId) => {
    return safeWrite(async () => {
        console.log('휴일 삭제:', holidayId);
        await firestoreDeleteDoc(doc(db, 'holidays', holidayId));
        clearHolidaysCache();
        console.log('휴일 삭제 완료');
    });
};

/**
 * 홀딩 취소 (Google Sheets도 함께 초기화)
 * Firebase 홀딩 상태만 cancelled로 변경 (Sheets 업데이트는 호출측에서 처리)
 */
export const cancelHoldingWithSheets = async (holdingId, studentName) => {
    return safeWrite(async () => {
        console.log('홀딩 취소 (Firebase + Sheets):', holdingId, studentName);
        if (holdingId) {
            await updateDocStatus('holdingRequests', holdingId, { status: 'cancelled' });
        }
        console.log('홀딩 취소 완료');
    });
};

// ============================================
// DISABLED CLASSES FUNCTIONS
// ============================================

export const getDisabledClasses = async () => {
    if (!db) return [];

    try {
        const docs = await queryDocs('disabledClasses');
        const disabledKeys = docs.map(d => d.key);
        console.log('비활성화된 수업 조회:', disabledKeys);
        return disabledKeys;
    } catch (error) {
        console.error('비활성화된 수업 조회 실패:', error);
        return [];
    }
};

export const toggleDisabledClass = async (key) => {
    return safeWrite(async () => {
        const existing = await queryDocs('disabledClasses', where('key', '==', key));

        if (existing.length === 0) {
            await addDoc(collection(db, 'disabledClasses'), {
                key,
                createdAt: serverTimestamp()
            });
            console.log('수업 비활성화:', key);
            return true;
        } else {
            await firestoreDeleteDoc(doc(db, 'disabledClasses', existing[0].id));
            console.log('수업 활성화:', key);
            return false;
        }
    });
};

// ============================================
// LOCKED SLOTS FUNCTIONS (보강 차단)
// ============================================

export const getLockedSlots = async () => {
    if (!db) return [];

    try {
        const docs = await queryDocs('lockedSlots');

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

        const activeKeys = [];
        const expiredIds = [];

        for (const d of docs) {
            if (d.date && d.date < todayStr) {
                expiredIds.push(d.id);
            } else {
                activeKeys.push(d.key);
            }
        }

        if (expiredIds.length > 0) {
            await Promise.all(expiredIds.map(id => firestoreDeleteDoc(doc(db, 'lockedSlots', id))));
            console.log('만료된 슬롯 잠금 삭제:', expiredIds.length, '건');
        }

        console.log('잠긴 슬롯 조회:', activeKeys);
        return activeKeys;
    } catch (error) {
        console.error('잠긴 슬롯 조회 실패:', error);
        return [];
    }
};

export const toggleLockedSlot = async (key, date) => {
    return safeWrite(async () => {
        const existing = await queryDocs('lockedSlots',
            where('key', '==', key),
            where('date', '==', date)
        );

        if (existing.length === 0) {
            await addDoc(collection(db, 'lockedSlots'), {
                key,
                date,
                createdAt: serverTimestamp()
            });
            console.log('슬롯 잠금:', key, date);
            return true;
        } else {
            await firestoreDeleteDoc(doc(db, 'lockedSlots', existing[0].id));
            console.log('슬롯 잠금 해제:', key, date);
            return false;
        }
    });
};

// ============================================
// NEW STUDENT REGISTRATION FUNCTIONS
// ============================================

export const createNewStudentRegistration = async (data, status = 'pending') => {
    return safeWrite(async () => {
        return createDoc('newStudentRegistrations', {
            ...data,
            status,
            isWaitlist: status === 'waitlist',
            coachSeen: false,
            questionSeen: false,
            updatedAt: serverTimestamp()
        });
    });
};

export const getNewStudentRegistrations = async (status = null) => {
    return safeRead([], async () => {
        const constraints = status ? [where('status', '==', status)] : [];
        const registrations = await queryDocs('newStudentRegistrations', ...constraints);

        return registrations.sort((a, b) => {
            const aTime = a.createdAt?.toMillis?.() || 0;
            const bTime = b.createdAt?.toMillis?.() || 0;
            return bTime - aTime;
        });
    });
};

export const getPendingRegistrationCount = async () => {
    if (!db) return 0;

    try {
        const q = query(
            collection(db, 'newStudentRegistrations'),
            where('status', 'in', ['pending', 'waitlist'])
        );
        const snapshot = await getDocs(q);
        return snapshot.size;
    } catch (error) {
        console.error('대기 등록 수 조회 실패:', error);
        return 0;
    }
};

export const updateNewStudentRegistration = async (id, data) => {
    return safeWrite(async () => {
        await updateDocStatus('newStudentRegistrations', id, data);
    });
};

export const deleteNewStudentRegistration = async (id) => {
    return safeWrite(async () => {
        await firestoreDeleteDoc(doc(db, 'newStudentRegistrations', id));
    });
};

// ============================================
// STUDENT TERMINATION FUNCTIONS (수강 종료 기록)
// ============================================

export const createStudentTermination = async (studentName, reason = '') => {
    return safeWrite(async () => {
        return createDoc('studentTerminations', {
            studentName,
            terminatedBy: 'coach',
            reason,
            terminatedAt: serverTimestamp(),
        });
    });
};

export const getTerminations = async () => {
    return safeRead([], async () => {
        return queryDocs('studentTerminations');
    });
};

// ============================================
// ENTRANCE CLASS FUNCTIONS
// ============================================

export const createEntranceClass = async (data) => {
    return safeWrite(async () => {
        return createDoc('entranceClasses', {
            ...data,
            currentCount: 0,
            isActive: true
        });
    });
};

export const getEntranceClasses = async (activeOnly = true) => {
    return safeRead([], async () => {
        const constraints = activeOnly ? [where('isActive', '==', true)] : [];
        const classes = await queryDocs('entranceClasses', ...constraints);
        return classes.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    });
};

export const updateEntranceClass = async (id, data) => {
    return safeWrite(async () => {
        await updateDoc(doc(db, 'entranceClasses', id), data);
    });
};

export const deleteEntranceClass = async (id) => {
    return safeWrite(async () => {
        await firestoreDeleteDoc(doc(db, 'entranceClasses', id));
    });
};

// ============================================
// REGISTRATION FAQ FUNCTIONS
// ============================================

export const createFAQ = async (data) => {
    return safeWrite(async () => {
        return createDoc('registrationFAQ', {
            ...data,
            isActive: true,
            updatedAt: serverTimestamp()
        });
    });
};

export const getFAQs = async (activeOnly = true) => {
    return safeRead([], async () => {
        const constraints = activeOnly ? [where('isActive', '==', true)] : [];
        const faqs = await queryDocs('registrationFAQ', ...constraints);
        return faqs.sort((a, b) => (a.order || 0) - (b.order || 0));
    });
};

export const updateFAQ = async (id, data) => {
    return safeWrite(async () => {
        await updateDocStatus('registrationFAQ', id, data);
    });
};

export const deleteFAQ = async (id) => {
    return safeWrite(async () => {
        await firestoreDeleteDoc(doc(db, 'registrationFAQ', id));
    });
};

// ============================================
// WAITLIST FUNCTIONS (대기 신청)
// ============================================

/**
 * 특정 학생+목표 슬롯의 활성 대기 신청 조회 (내부 전용)
 */
async function getActiveWaitlistByDesiredSlot(studentName, day, period) {
    if (!db) return null;

    try {
        const results = await queryDocs('waitlistRequests',
            where('studentName', '==', studentName),
            where('desiredSlot.day', '==', day),
            where('desiredSlot.period', '==', period),
            where('status', 'in', ['waiting', 'notified'])
        );
        return results.length > 0 ? results[0] : null;
    } catch (error) {
        console.error('대기 신청 조회 실패:', error);
        return null;
    }
}

export const createWaitlistRequest = async (studentName, currentSlot, desiredSlot) => {
    return safeWrite(async () => {
        const existing = await getActiveWaitlistByDesiredSlot(studentName, desiredSlot.day, desiredSlot.period);
        if (existing) {
            throw new Error('이미 해당 시간에 대기 신청이 되어 있습니다.');
        }

        const result = await createDoc('waitlistRequests', {
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
            status: 'waiting',
            notifiedAt: null,
            respondedAt: null,
            updatedAt: serverTimestamp()
        });

        console.log('대기 신청 생성 완료:', result.id);
        return result;
    });
};

export const getActiveWaitlistRequests = async (studentName) => {
    if (!db) return [];

    try {
        return queryDocs('waitlistRequests',
            where('studentName', '==', studentName),
            where('status', 'in', ['waiting', 'notified'])
        );
    } catch (error) {
        console.error('대기 신청 목록 조회 실패:', error);
        return [];
    }
};

export const getAllActiveWaitlist = async () => {
    if (!db) return [];

    try {
        const results = await queryDocs('waitlistRequests',
            where('status', 'in', ['waiting', 'notified'])
        );
        return results.sort((a, b) => {
            const aTime = a.createdAt?.toMillis?.() || 0;
            const bTime = b.createdAt?.toMillis?.() || 0;
            return aTime - bTime;
        });
    } catch (error) {
        console.error('대기 목록 조회 실패:', error);
        return [];
    }
};

export const cancelWaitlistRequest = async (waitlistId) => {
    return safeWrite(async () => {
        await updateDocStatus('waitlistRequests', waitlistId, { status: 'cancelled' });
        console.log('대기 신청 취소 완료');
    });
};

export const notifyWaitlistRequest = async (waitlistId) => {
    return safeWrite(async () => {
        await updateDocStatus('waitlistRequests', waitlistId, {
            status: 'notified',
            notifiedAt: serverTimestamp()
        });
        console.log('대기 알림 발송 완료:', waitlistId);
    });
};

export const revertWaitlistNotification = async (waitlistId) => {
    return safeWrite(async () => {
        await updateDocStatus('waitlistRequests', waitlistId, {
            status: 'waiting',
            notifiedAt: null
        });
        console.log('대기 승인 취소 완료:', waitlistId);
    });
};

export const acceptWaitlistRequest = async (waitlistId) => {
    return safeWrite(async () => {
        await updateDocStatus('waitlistRequests', waitlistId, {
            status: 'accepted',
            respondedAt: serverTimestamp()
        });
        console.log('대기 수락 완료:', waitlistId);
    });
};

// ============================================
// WAITLIST AVAILABILITY FUNCTIONS (대기 여석 감지)
// ============================================

/**
 * 대기 건의 여석 정보 업데이트
 */
export const updateWaitlistAvailability = async (regId, availabilityData) => {
    return safeWrite(async () => {
        await updateDocStatus('newStudentRegistrations', regId, availabilityData);
        console.log('대기 여석 정보 업데이트:', regId, availabilityData.hasAvailableSlots);
    });
};

/**
 * 코치가 대기 건의 시간표(requestedSlots) 수동 수정
 */
export const updateWaitlistRequestedSlots = async (regId, newSlots, newScheduleString) => {
    return safeWrite(async () => {
        await updateDocStatus('newStudentRegistrations', regId, {
            requestedSlots: newSlots,
            scheduleString: newScheduleString
        });
        console.log('대기 시간표 수정 완료:', regId, newScheduleString);
    });
};

/**
 * 대기 건들의 여석 체크 (슬롯 점유율 기반)
 * @param {Array} waitlistRegs - status === 'waitlist'인 등록 목록
 * @param {Object} slotOccupancy - { "월-1": 5, "화-2": 7, ... }
 * @param {Array} disabledClasses - ["월-3", ...] 비활성 슬롯
 * @param {number} maxCapacity - 슬롯당 최대 인원
 * @returns {Array} 업데이트가 필요한 건 목록 [{ regId, hasAvailableSlots, availableSlots }]
 */
export const checkWaitlistAvailability = (waitlistRegs, slotOccupancy, disabledClasses, maxCapacity) => {
    const updates = [];

    for (const reg of waitlistRegs) {
        const requestedSlots = reg.requestedSlots || [];
        const weeklyFrequency = reg.weeklyFrequency || 2;

        // requestedSlots 중 현재 여석이 있는 슬롯
        const availableSlots = requestedSlots.filter(slot => {
            const key = `${slot.day}-${slot.period}`;
            if (disabledClasses.includes(key)) return false;
            const occ = slotOccupancy[key] || 0;
            return occ < maxCapacity;
        });

        const hasAvailableSlots = availableSlots.length >= weeklyFrequency;
        const prevHas = reg.hasAvailableSlots || false;

        // 상태가 변경된 경우만 업데이트
        if (hasAvailableSlots !== prevHas) {
            updates.push({
                regId: reg.id,
                hasAvailableSlots,
                availableSlots
            });
        }
    }

    return updates;
};

// ============================================
// RENEWAL CONTRACT FUNCTIONS (재등록 계약)
// ============================================

export const createRenewalContract = async (data) => {
    return safeWrite(async () => {
        const result = await createDoc('renewalContracts', {
            ...data,
            status: 'pending',
            agreedAt: null,
            updatedAt: serverTimestamp()
        });
        console.log('재등록 계약 생성 완료:', result.id);
        return result;
    });
};

export const getPendingContractForStudent = async (studentName) => {
    return safeRead(null, async () => {
        const results = await queryDocs('renewalContracts',
            where('studentName', '==', studentName),
            where('status', '==', 'pending')
        );
        return results.length > 0 ? results[0] : null;
    });
};

export const getContractHistory = async (studentName) => {
    return safeRead([], async () => {
        const contracts = await queryDocs('renewalContracts',
            where('studentName', '==', studentName)
        );
        return contracts.sort((a, b) => {
            const aTime = a.createdAt?.toMillis?.() || 0;
            const bTime = b.createdAt?.toMillis?.() || 0;
            return bTime - aTime;
        });
    });
};

export const agreeToContract = async (contractId) => {
    return safeWrite(async () => {
        await updateDocStatus('renewalContracts', contractId, {
            status: 'agreed',
            agreedAt: serverTimestamp()
        });
        console.log('계약 동의 완료:', contractId);
    });
};

export const cancelContract = async (contractId) => {
    return safeWrite(async () => {
        await updateDocStatus('renewalContracts', contractId, {
            status: 'cancelled'
        });
        console.log('계약 취소 완료:', contractId);
    });
};

// ============================================
// MAKEUP WAITLIST (만석 슬롯 보강 대기)
// ============================================
// status: waiting → notified → accepted | declined | expired | cancelled

export const createMakeupWaitlist = async (studentName, phone, slot, originalClass) => {
    return safeWrite(async () => {
        const existing = await queryDocs('makeupWaitlists',
            where('studentName', '==', studentName),
            where('date', '==', slot.date),
            where('period', '==', slot.period),
            where('status', 'in', ['waiting', 'notified'])
        );
        if (existing.length > 0) throw new Error('이미 이 시간에 보강 대기를 신청했습니다.');
        return createDoc('makeupWaitlists', {
            studentName,
            phone: phone || '',
            date: slot.date,
            day: slot.day,
            period: slot.period,
            periodName: slot.periodName,
            originalClass: {
                date: originalClass.date,
                day: originalClass.day,
                period: originalClass.period,
                periodName: originalClass.periodName,
            },
            status: 'waiting',
            notifiedAt: null,
            respondedAt: null,
            updatedAt: serverTimestamp(),
        });
    });
};

export const getMakeupWaitlistsByStudent = async (studentName) => {
    return safeRead([], () => queryDocs('makeupWaitlists',
        where('studentName', '==', studentName),
        where('status', 'in', ['waiting', 'notified'])
    ));
};

export const getActiveMakeupWaitlists = async () => {
    return safeRead([], () => queryDocs('makeupWaitlists',
        where('status', 'in', ['waiting', 'notified'])
    ));
};

export const updateMakeupWaitlistStatus = async (id, status) => {
    return safeWrite(() => updateDocStatus('makeupWaitlists', id, { status }));
};

export const notifyMakeupWaitlist = async (id) => {
    return safeWrite(() => updateDocStatus('makeupWaitlists', id, {
        status: 'notified', notifiedAt: serverTimestamp(),
    }));
};

export const acceptMakeupWaitlist = async (id) => {
    return safeWrite(() => updateDocStatus('makeupWaitlists', id, {
        status: 'accepted', respondedAt: serverTimestamp(),
    }));
};

export const declineMakeupWaitlist = async (id) => {
    return safeWrite(() => updateDocStatus('makeupWaitlists', id, {
        status: 'declined', respondedAt: serverTimestamp(),
    }));
};

// ============================================
// BOARD - POSTS
// ============================================

export const createPost = async (data) => {
    return safeWrite(async () => {
        const result = await createDoc('posts', {
            ...data,
            likes: [],
            commentCount: 0,
            deleted: false,
            updatedAt: serverTimestamp(),
        });
        return result;
    });
};

export const getPosts = async (category = null, limitCount = 20) => {
    return safeRead([], async () => {
        const constraints = category && category !== 'all'
            ? [where('category', '==', category)]
            : [];
        const posts = await queryDocs('posts', ...constraints);
        const filtered = posts.filter(p => !p.deleted);
        return filtered.sort((a, b) => {
            const aPinned = a.pinned && a.category === 'notice';
            const bPinned = b.pinned && b.category === 'notice';
            if (aPinned && !bPinned) return -1;
            if (!aPinned && bPinned) return 1;
            const aTime = a.createdAt?.toMillis?.() || 0;
            const bTime = b.createdAt?.toMillis?.() || 0;
            return bTime - aTime;
        }).slice(0, limitCount);
    });
};

export const getPostsPage = async (category = 'all', pageSize = 10, cursor = null) => {
    const toSummary = (post) => {
        const images = post.images;
        const likes = post.likes;
        const summary = { ...post };
        delete summary.content;
        delete summary.images;
        delete summary.likes;
        return {
            ...summary,
            imageCount: Array.isArray(images) ? images.length : 0,
            likeCount: Array.isArray(likes) ? likes.length : 0,
        };
    };

    return safeRead({ posts: [], nextCursor: null, hasNextPage: false }, async () => {
        // 특정 카테고리: where(category)+orderBy(createdAt) 복합 인덱스가 필요해 에러가 났었음.
        // 동등 필터로만 읽고 정렬·페이지네이션을 클라이언트에서 처리해 인덱스 의존성을 제거한다.
        // (단일 스튜디오 게시판 규모에선 카테고리 전체를 읽어도 비용이 작다)
        if (category && category !== 'all') {
            const snapshot = await getDocs(query(
                collection(db, 'posts'),
                where('category', '==', category)
            ));
            const all = snapshot.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => !p.deleted);
            const byNewest = (a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0);

            // 공지 카테고리: 고정 공지는 상단(첫 페이지)에서만, 날짜순 목록에서는 제외
            const pinned = category === 'notice' ? all.filter(p => p.pinned).sort(byNewest) : [];
            const pinnedIds = new Set(pinned.map(p => p.id));
            const rest = all.filter(p => !pinnedIds.has(p.id)).sort(byNewest);

            const start = typeof cursor === 'number' ? cursor : 0;
            const pageSlice = rest.slice(start, start + pageSize);
            const hasNextPage = rest.length > start + pageSize;
            const combined = [...(start === 0 ? pinned : []), ...pageSlice];
            return {
                posts: combined.map(toSummary),
                nextCursor: hasNextPage ? start + pageSize : null,
                hasNextPage,
            };
        }

        const baseConstraints = [];

        const includePinnedNotices = !cursor && (category === 'all' || category === 'notice');
        const pinnedSnapshotPromise = includePinnedNotices
            ? getDocs(query(
                collection(db, 'posts'),
                where('category', '==', 'notice'),
                where('pinned', '==', true),
                queryLimit(20)
            ))
            : Promise.resolve({ docs: [] });

        // 삭제 글/고정 공지를 건너뛰면서 표시 가능한 글을 정확히 pageSize개 채운다.
        // - 삭제 글: 쿼리 결과에서 슬롯만 차지하고 화면에서 빠지면 페이지당 글 수가 줄어드는 문제 방지
        // - 고정 공지: 첫 페이지 상단에서만 노출하고 날짜순 목록에서는 제외 (페이지 중간 중복 노출 방지)
        const isDisplayable = (data) => !data.deleted && !(data.pinned && data.category === 'notice');

        const displayDocs = [];      // 화면에 표시할 문서 (pageSize + 1개까지 — 마지막 1개는 다음 페이지 존재 판정용)
        let probeDoc = cursor;       // 다음 배치 조회 시작점
        let exhausted = false;
        while (displayDocs.length < pageSize + 1 && !exhausted) {
            const batchQuery = query(
                collection(db, 'posts'),
                ...baseConstraints,
                orderBy('createdAt', 'desc'),
                ...(probeDoc ? [startAfter(probeDoc)] : []),
                queryLimit(pageSize + 1)
            );
            const snapshot = await getDocs(batchQuery);
            for (const d of snapshot.docs) {
                if (isDisplayable(d.data())) {
                    displayDocs.push(d);
                    if (displayDocs.length >= pageSize + 1) break;
                }
            }
            probeDoc = snapshot.docs[snapshot.docs.length - 1] || probeDoc;
            exhausted = snapshot.docs.length < pageSize + 1;
        }

        const hasNextPage = displayDocs.length > pageSize;
        const pageDocs = displayDocs.slice(0, pageSize);
        const pagePosts = pageDocs.map(d => ({ id: d.id, ...d.data() }));

        const pinnedSnapshot = await pinnedSnapshotPromise;
        const pinnedPosts = pinnedSnapshot.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter(p => !p.deleted)
            .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
        const posts = [...pinnedPosts, ...pagePosts].map(toSummary);

        return {
            posts,
            // 다음 페이지는 "이번 페이지 마지막 표시 글" 이후부터 — 사이에 끼인 삭제/고정 글은 다음 호출에서 다시 건너뜀
            nextCursor: pageDocs[pageDocs.length - 1] || null,
            hasNextPage,
        };
    });
};

export const getLatestPostCreatedAt = async () => {
    return safeRead(0, async () => {
        const q = query(collection(db, 'posts'), orderBy('createdAt', 'desc'), queryLimit(1));
        const snapshot = await getDocs(q);
        if (snapshot.empty) return 0;
        const data = snapshot.docs[0].data();
        if (data.deleted) return 0;
        return data.createdAt?.toMillis?.() || 0;
    });
};

export const subscribePosts = (category, limitCount, callback) => {
    if (!db) {
        callback([]);
        return () => {};
    }
    const constraints = category && category !== 'all'
        ? [where('category', '==', category)]
        : [];
    const q = query(collection(db, 'posts'), ...constraints);
    return onSnapshot(q, (snapshot) => {
        const posts = snapshot.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter(p => !p.deleted);
        const sorted = posts.sort((a, b) => {
            const aPinned = a.pinned && a.category === 'notice';
            const bPinned = b.pinned && b.category === 'notice';
            if (aPinned && !bPinned) return -1;
            if (!aPinned && bPinned) return 1;
            const aTime = a.createdAt?.toMillis?.() || 0;
            const bTime = b.createdAt?.toMillis?.() || 0;
            return bTime - aTime;
        }).slice(0, limitCount);
        callback(sorted);
    }, (error) => {
        console.error('게시글 실시간 구독 실패:', error);
        callback([]);
    });
};

export const getPost = async (postId) => {
    return safeRead(null, async () => {
        const docRef = doc(db, 'posts', postId);
        const docSnap = await getDoc(docRef);
        if (!docSnap.exists()) return null;
        return { id: docSnap.id, ...docSnap.data() };
    });
};

export const updatePost = async (postId, data) => {
    return safeWrite(async () => {
        await updateDocStatus('posts', postId, data);
    });
};

export const deletePost = async (postId) => {
    return safeWrite(async () => {
        await updateDocStatus('posts', postId, { deleted: true });
    });
};

export const toggleLike = async (postId, username) => {
    return safeWrite(async () => {
        const postRef = doc(db, 'posts', postId);
        const docSnap = await getDoc(postRef);
        if (!docSnap.exists()) throw new Error('게시글을 찾을 수 없습니다.');
        const likes = docSnap.data().likes || [];
        const isLiked = likes.includes(username);
        await updateDoc(postRef, {
            likes: isLiked ? arrayRemove(username) : arrayUnion(username),
        });
        return !isLiked;
    });
};

// ============================================
// BOARD - COMMENTS
// ============================================

export const getComments = async (postId) => {
    return safeRead([], async () => {
        const commentsRef = collection(db, 'posts', postId, 'comments');
        const q = query(commentsRef, orderBy('createdAt', 'asc'));
        const snapshot = await getDocs(q);
        return snapshot.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter(c => !c.deleted);
    });
};

export const createComment = async (postId, data) => {
    return safeWrite(async () => {
        const batch = writeBatch(db);
        const commentRef = doc(collection(db, 'posts', postId, 'comments'));
        batch.set(commentRef, {
            ...data,
            deleted: false,
            createdAt: serverTimestamp(),
        });
        const postRef = doc(db, 'posts', postId);
        batch.update(postRef, { commentCount: increment(1) });
        await batch.commit();
        return { success: true, id: commentRef.id };
    });
};

export const deleteComment = async (postId, commentId) => {
    return safeWrite(async () => {
        const batch = writeBatch(db);
        const commentRef = doc(db, 'posts', postId, 'comments', commentId);
        batch.update(commentRef, { deleted: true });
        const postRef = doc(db, 'posts', postId);
        batch.update(postRef, { commentCount: increment(-1) });
        await batch.commit();
    });
};

export const updateComment = async (postId, commentId, content, image) => {
    return safeWrite(async () => {
        const commentRef = doc(db, 'posts', postId, 'comments', commentId);
        const updateData = { content, updatedAt: serverTimestamp() };
        if (image !== undefined) {
            updateData.image = image;
        }
        await updateDoc(commentRef, updateData);
    });
};

export const toggleCommentLike = async (postId, commentId, username) => {
    return safeWrite(async () => {
        const commentRef = doc(db, 'posts', postId, 'comments', commentId);
        const docSnap = await getDoc(commentRef);
        if (!docSnap.exists()) throw new Error('댓글을 찾을 수 없습니다.');
        const likes = docSnap.data().likes || [];
        const isLiked = likes.includes(username);
        await updateDoc(commentRef, {
            likes: isLiked ? arrayRemove(username) : arrayUnion(username),
        });
        return !isLiked;
    });
};

// ============================================
// PERSONAL BEST (PR) FUNCTIONS — 공식 측정 기록
// ============================================

const PR_TYPES = ['oneRM', 'weightThenReps', 'timeHold', 'bodyweightReps'];

const sanitizeIdSegment = (s) => String(s || '').replace(/[/\\.#$[\]]/g, '_').trim();

const buildPRDocId = ({ userName, exercise, prType, intensity }) => {
    const base = `${sanitizeIdSegment(userName)}__${sanitizeIdSegment(exercise)}`;
    if (prType === 'weightThenReps') {
        const intVal = sanitizeIdSegment(intensity?.value);
        const intUnit = sanitizeIdSegment(intensity?.unit || 'kg');
        return `${base}__${intVal}${intUnit}`;
    }
    return base;
};

const numVal = (v) => {
    const n = parseFloat(v);
    return isNaN(n) ? 0 : n;
};

/**
 * 새 측정 결과가 기존 best보다 더 좋은지 판단
 */
const isNewPRBetter = (prType, oldData, newEntry) => {
    if (!oldData) return true;
    switch (prType) {
        case 'oneRM':
            return numVal(newEntry.intensity?.value) > numVal(oldData.intensity?.value);
        case 'weightThenReps':
            // 같은 중량 도큐먼트 내에서 reps 비교 (도큐먼트 분리로 중량은 이미 같음)
            return numVal(newEntry.reps?.value) > numVal(oldData.reps?.value);
        case 'timeHold':
        case 'bodyweightReps':
            return numVal(newEntry.reps?.value) > numVal(oldData.reps?.value);
        default:
            return false;
    }
};

/**
 * PR 측정 결과 등록. 갱신 룰에 따라 best를 갱신하고 history에 추가.
 * @returns { docId, updated: boolean } — updated=true면 신기록
 */
export const submitPersonalBest = async ({ userName, exercise, prType, intensity, reps, date, note }) => {
    return safeWrite(async () => {
        if (!userName || !exercise) throw new Error('이름·운동명은 필수입니다.');
        if (!PR_TYPES.includes(prType)) throw new Error(`잘못된 prType: ${prType}`);

        const newEntry = {
            intensity: intensity || { value: '', unit: '' },
            reps: reps || { value: '', unit: '' },
            date: date || new Date().toISOString().slice(0, 10),
            note: note || '',
            recordedAt: new Date().toISOString()
        };

        const docId = buildPRDocId({ userName, exercise, prType, intensity });
        const docRef = doc(db, 'personalBests', docId);
        const snap = await getDoc(docRef);
        const existing = snap.exists() ? snap.data() : null;
        const updated = isNewPRBetter(prType, existing, newEntry);

        if (existing) {
            // 갱신: best 덮어쓰기 + history 추가 / 갱신 안되면 history만 추가
            const updates = {
                history: arrayUnion(newEntry),
                updatedAt: serverTimestamp()
            };
            if (updated) {
                updates.intensity = newEntry.intensity;
                updates.reps = newEntry.reps;
                updates.date = newEntry.date;
                updates.note = newEntry.note;
            }
            await updateDoc(docRef, updates);
        } else {
            await setDoc(docRef, {
                userName,
                exercise,
                prType,
                intensity: newEntry.intensity,
                reps: newEntry.reps,
                date: newEntry.date,
                note: newEntry.note,
                history: [newEntry],
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            });
        }
        return { docId, updated };
    });
};

/**
 * PR 도큐먼트 삭제 (이력 포함 전체 제거)
 */
export const deletePersonalBest = async (docId) => {
    return safeWrite(async () => {
        if (!docId) throw new Error('docId가 필요합니다.');
        await firestoreDeleteDoc(doc(db, 'personalBests', docId));
        return { success: true };
    });
};

/**
 * PR best(최고기록) 직접 수정. history 배열은 그대로 두고 표시값과 메타만 갱신.
 * @param fields { intensity?, reps?, date?, note? }
 */
export const updatePersonalBest = async (docId, fields) => {
    return safeWrite(async () => {
        if (!docId) throw new Error('docId가 필요합니다.');
        const allowed = {};
        if (fields.intensity !== undefined) allowed.intensity = fields.intensity;
        if (fields.reps !== undefined) allowed.reps = fields.reps;
        if (fields.date !== undefined) allowed.date = fields.date;
        if (fields.note !== undefined) allowed.note = fields.note;
        if (Object.keys(allowed).length === 0) return { success: true };
        allowed.updatedAt = serverTimestamp();
        await updateDoc(doc(db, 'personalBests', docId), allowed);
        return { success: true };
    });
};

/**
 * 특정 학생의 PR 전체 (내 PR 탭, 그래프 PR 마커용)
 */
export const getPersonalBests = async (userName) => {
    return safeRead([], async () => {
        return queryDocs('personalBests', where('userName', '==', userName));
    });
};

/**
 * 전체 PR 컬렉션 (legacy/admin fallback only).
 * 일반 랭킹 화면에서는 운동별/학생별 범위 쿼리를 우선 사용해 Firestore reads를 줄인다.
 */
export const getAllPersonalBests = async () => {
    return safeRead([], async () => {
        return queryDocs('personalBests');
    });
};

/**
 * 특정 운동의 PR 목록 (종목별 랭킹 탭).
 */
export const getPersonalBestsByExercise = async (exercise) => {
    if (!exercise) return [];
    return safeRead([], async () => {
        return queryDocs('personalBests', where('exercise', '==', exercise));
    });
};

/**
 * 최근 N일 내 PR 갱신/추가된 학생 목록 (이달의 PR 갱신자)
 */
export const getMonthlyPRUpdaters = async (daysAgo = 30) => {
    return safeRead([], async () => {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - daysAgo);
        const cutoffTs = Timestamp.fromDate(cutoff);
        return queryDocs(
            'personalBests',
            where('updatedAt', '>=', cutoffTs),
            orderBy('updatedAt', 'desc')
        );
    });
};

/**
 * 코치가 훈련일지에서 관리하는 공식 운동 종목 목록 (`exercises` 컬렉션, name 가나다 정렬)
 * PR 등록 폼의 운동명 드롭다운에 사용 — 일관된 종목명 강제용.
 */
export const getAllExerciseNames = async () => {
    return safeRead([], async () => {
        const docs = await queryDocs('exercises');
        const set = new Set();
        for (const d of docs) {
            const name = (d.name || '').trim();
            if (name) set.add(name);
        }
        return Array.from(set).sort((a, b) => a.localeCompare(b, 'ko'));
    });
};

/**
 * 그래프용: 특정 학생의 일상 훈련 기록 (시계열)
 * 복합 인덱스 회피를 위해 userName으로만 쿼리하고 date는 클라이언트에서 필터.
 * 정확 일치 0건이면 sinceDate 이후 records를 fetch해서 trim/대소문자 무시 매칭으로 폴백.
 * @param sinceDate 'YYYY-MM-DD'
 */
export const getRecordsByUserSince = async (userName, sinceDate) => {
    return safeRead([], async () => {
        const trimmed = (userName || '').trim();
        let all = await queryDocs('records', where('userName', '==', trimmed));
        if (all.length === 0 && trimmed) {
            const recent = await queryDocs('records', where('date', '>=', sinceDate));
            const lower = trimmed.toLowerCase();
            all = recent.filter(r => (r.userName || '').trim().toLowerCase() === lower);
        }
        return all
            .filter(r => r.date && r.date >= sinceDate)
            .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    });
};

/**
 * 출석/운동량 랭킹: 지정한 달(기본 = 이번 달, 1일~말일) records에서 학생별 출석일·총 운동량 집계
 * @param yearMonth 'YYYY-MM' (생략 시 이번 달)
 */
export const getAttendanceRanking = async (yearMonth) => {
    return safeRead([], async () => {
        const ym = yearMonth || (() => {
            const d = new Date();
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        })();
        const [y, m] = ym.split('-').map(Number);
        const monthStart = `${ym}-01`;
        const next = new Date(y, m, 1); // m은 1-indexed; new Date의 month는 0-indexed → 다음 달 1일
        const nextStart = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-01`;
        const records = await queryDocs(
            'records',
            where('date', '>=', monthStart),
            where('date', '<', nextStart)
        );
        const byUser = new Map();
        for (const r of records) {
            const u = r.userName;
            if (!u) continue;
            if (!byUser.has(u)) byUser.set(u, { userName: u, dates: new Set(), volume: 0 });
            const entry = byUser.get(u);
            entry.dates.add(r.date);
            // 운동량: kg×reps 합 (단위가 kg & 회인 세트만). sets가 배열이 아닌 손상된 record는 무시
            const sets = Array.isArray(r.sets) ? r.sets : [];
            for (const set of sets) {
                const intUnit = set?.intensity?.unit;
                const repUnit = set?.reps?.unit;
                if (intUnit === 'kg' && repUnit === '회') {
                    entry.volume += numVal(set.intensity?.value) * numVal(set.reps?.value);
                }
            }
        }
        return Array.from(byUser.values()).map(e => ({
            userName: e.userName,
            trainingDays: e.dates.size,
            volume: Math.round(e.volume)
        }));
    });
};

/**
 * 학생 개인의 월별 출석일·총 운동량 추이 (최근 N개월, 기본 12개월)
 * 비어있는 달도 0으로 채워서 반환 → 그래프에서 끊김 없이 표시
 */
export const getMonthlyAttendanceHistory = async (userName, monthsBack = 12) => {
    return safeRead([], async () => {
        const today = new Date();
        const startMonth = new Date(today.getFullYear(), today.getMonth() - (monthsBack - 1), 1);
        const startStr = `${startMonth.getFullYear()}-${String(startMonth.getMonth() + 1).padStart(2, '0')}-01`;
        const trimmed = (userName || '').trim();
        let all = await queryDocs('records', where('userName', '==', trimmed));
        if (all.length === 0 && trimmed) {
            const recent = await queryDocs('records', where('date', '>=', startStr));
            const lower = trimmed.toLowerCase();
            all = recent.filter(r => (r.userName || '').trim().toLowerCase() === lower);
        }
        const records = all.filter(r => r.date && r.date >= startStr);
        const byMonth = new Map();
        // 빈 달도 미리 채워둠
        for (let i = 0; i < monthsBack; i++) {
            const d = new Date(today.getFullYear(), today.getMonth() - (monthsBack - 1) + i, 1);
            const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            byMonth.set(ym, { month: ym, dates: new Set(), volume: 0 });
        }
        for (const r of records) {
            if (!r.date) continue;
            const ym = r.date.slice(0, 7);
            if (!byMonth.has(ym)) continue; // 범위 밖 무시
            const entry = byMonth.get(ym);
            entry.dates.add(r.date);
            // sets가 배열이 아닌 손상된 record는 무시
            const sets = Array.isArray(r.sets) ? r.sets : [];
            for (const set of sets) {
                const intUnit = set?.intensity?.unit;
                const repUnit = set?.reps?.unit;
                if (intUnit === 'kg' && repUnit === '회') {
                    entry.volume += numVal(set.intensity?.value) * numVal(set.reps?.value);
                }
            }
        }
        return Array.from(byMonth.values())
            .map(e => ({ month: e.month, trainingDays: e.dates.size, volume: Math.round(e.volume) }))
            .sort((a, b) => a.month.localeCompare(b.month));
    });
};
