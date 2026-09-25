import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../config/firebase';
import HoldingManager from '../components/HoldingManager';
import { GoogleSheetsValueProvider } from '../contexts/GoogleSheetsContext';

const rejectWrite = async () => { throw new Error('로컬 검토에서는 실제 신청·취소를 실행하지 않습니다.'); };
const READ_ONLY_SHEETS = Object.freeze({ requestHolding: rejectWrite, refresh: async () => {} });
const WRITE_GUARDS = Object.freeze({
    createHoldingRequest: rejectWrite, markHoldingSheetsApplied: rejectWrite,
    createAbsenceRequest: rejectWrite, cancelHolding: rejectWrite, cancelAbsence: rejectWrite,
    cancelHoldingInSheets: rejectWrite, onSeatsFreedForDates: rejectWrite,
});

// Query failures must remain errors; an unavailable history is not an empty one.
async function readRows(name, ...filters) {
    if (!db) throw new Error('Firebase connection unavailable');
    const snapshot = await getDocs(query(collection(db, name), ...filters));
    return snapshot.docs.map(document => ({ ...document.data(), id: document.id }));
}

export default function LiveHoldingReview({ user, studentData, initialDate = '', onBack }) {
    const username = user.username;
    const [result, setResult] = useState(null);
    const [retry, setRetry] = useState(0);
    useEffect(() => {
        let cancelled = false;
        Promise.all([
            readRows('holdingRequests', where('studentName', '==', username), where('status', '==', 'active')),
            readRows('absenceRequests', where('studentName', '==', username), where('status', '==', 'active')),
            readRows('makeupRequests', where('studentName', '==', username), where('status', 'in', ['active', 'completed'])),
            readRows('holidays'),
        ]).then(([holdings, absences, makeups, holidays]) => {
            if (!cancelled) setResult({ username, studentData, retry, holdings, absences, makeups, holidays });
        }).catch(() => {
            if (!cancelled) setResult({ username, studentData, retry, error: true });
        });
        return () => { cancelled = true; };
    }, [username, studentData, retry]);

    const loaded = result?.username === username && result?.studentData === studentData && result?.retry === retry;
    const services = useMemo(() => Object.freeze({
        ...WRITE_GUARDS,
        getHoldingsByStudent: async () => result.holdings,
        getAbsencesByStudent: async () => result.absences,
        getActiveMakeupRequests: async () => result.makeups,
        getHolidays: async () => result.holidays,
    }), [result]);

    if (!loaded || result.error) return <section className="holding-container">
        <button type="button" className="student-class-link" onClick={onBack}>← 내 수업</button>
        <h1 className="holding-title">홀딩·결석 신청 및 내역</h1>
        {!loaded ? <p className="student-class-help" role="status">실제 신청 내역과 수업일을 불러오고 있어요.</p>
            : <div className="student-class-empty" role="alert"><p>홀딩·결석 정보를 불러오지 못했어요.</p><button type="button" className="student-class-button" onClick={() => setRetry(value => value + 1)}>다시 조회</button></div>}
    </section>;

    return <GoogleSheetsValueProvider value={READ_ONLY_SHEETS}>
        <HoldingManager key={`${username}-${initialDate}-${retry}`} user={user} studentData={studentData}
            initialDate={initialDate} onBack={onBack} services={services} readOnly />
    </GoogleSheetsValueProvider>;
}
