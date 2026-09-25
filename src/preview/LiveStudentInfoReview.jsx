import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../config/firebase';
import StudentInfo from '../components/StudentInfo';
import { GoogleSheetsValueProvider } from '../contexts/GoogleSheetsContext';
import { calculateMembershipStats, generateAttendanceHistory } from '../services/googleSheetsService';
import { getActiveMakeupRequests, getHolidays } from '../services/firebaseService';

const READ_ONLY_SHEETS = { calculateMembershipStats, generateAttendanceHistory };

// The existing history service returns [] on query failure. Keep failures visible
// here so an unavailable history cannot appear as an unused holding allowance.
async function loadLiveHoldingHistory(username) {
    if (!db) throw new Error('Firebase connection unavailable');
    const snapshot = await getDocs(query(collection(db, 'holdingRequests'), where('studentName', '==', username)));
    return snapshot.docs.map(document => ({ id: document.id, ...document.data() }))
        .sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
}

export default function LiveStudentInfoReview({ user, studentData, onNavigate }) {
    const username = user?.username;
    const [result, setResult] = useState(null);
    const [retry, setRetry] = useState(0);
    useEffect(() => {
        if (!username || !studentData) return;
        let cancelled = false;
        Promise.all([getActiveMakeupRequests(username), loadLiveHoldingHistory(username), getHolidays()])
            .then(([makeups, holdings, holidays]) => {
                if (!cancelled) setResult({ username, studentData, retry, makeups, holdings, holidays });
            }).catch(() => {
                if (!cancelled) setResult({ username, studentData, retry, error: true });
            });
        return () => { cancelled = true; };
    }, [username, studentData, retry]);

    const loaded = result?.username === username && result?.studentData === studentData && result?.retry === retry;
    const services = useMemo(() => ({
        getActiveMakeupRequests: async () => result.makeups,
        getHoldingHistory: async () => result.holdings,
        getHolidays: async () => result.holidays,
    }), [result]);

    if (!username || !studentData || !loaded || result.error) return <div className="student-info-container">
        <div className="student-info-header"><h1 className="student-info-title">내 정보</h1></div>
        <div className="student-info-content"><div className="membership-card">
            {!username || !studentData ? <p role="status">수강생을 선택하면 실제 수강 정보를 확인할 수 있습니다.</p>
                : !loaded ? <p role="status">수강 정보를 불러오고 있어요.</p>
                    : <><p role="alert">수강 정보를 불러오지 못했습니다. 다시 조회해주세요.</p><button type="button" className="student-class-button" onClick={() => setRetry(value => value + 1)}>다시 조회</button></>}
        </div></div>
    </div>;

    return <GoogleSheetsValueProvider value={READ_ONLY_SHEETS}>
        <StudentInfo key={`${username}-${retry}`} user={user} studentData={studentData} services={services}
            onNavigate={onNavigate} readOnly />
    </GoogleSheetsValueProvider>;
}
