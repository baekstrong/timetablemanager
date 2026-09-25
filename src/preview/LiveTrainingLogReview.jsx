import { useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '../config/firebase';
import './live-training-log-review.css';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const pad = value => String(value).padStart(2, '0');
const todayISO = () => { const date = new Date(); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; };
const nextMonth = (month, offset) => { const [year, number] = month.split('-').map(Number); const date = new Date(year, number - 1 + offset, 1); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`; };
const dateLabel = date => { const [year, month, day] = date.split('-').map(Number); return `${month}월 ${day}일 ${WEEKDAYS[new Date(year, month - 1, day).getDay()]}요일`; };
const timestampValue = value => typeof value?.toMillis === 'function' ? value.toMillis() : typeof value?.seconds === 'number' ? value.seconds * 1000 : 0;
function formatSet(set) {
    const intensity = set?.intensity || { value: set?.weight ?? '', unit: 'kg' };
    const reps = typeof set?.reps === 'object' && set.reps ? set.reps : { value: set?.reps ?? '', unit: '회' };
    const intensityText = intensity.unit === '맨몸' ? '맨몸' : intensity.unit === '자율' ? intensity.value || '자율' : `${intensity.value ?? ''}${intensity.unit || 'kg'}`;
    const repsText = reps.unit === '초 x 회' ? `${reps.value ?? ''}초 × ${reps.count || '?'}회` : `${reps.value ?? ''}${reps.unit || '회'}`;
    return `${intensityText} × ${repsText}`;
}

export default function LiveTrainingLogReview({ user }) {
    const today = todayISO();
    const [month, setMonth] = useState(today.slice(0, 7));
    const [selectedDate, setSelectedDate] = useState(today);
    const [result, setResult] = useState(null);
    const [loadingKey, setLoadingKey] = useState('');
    const [error, setError] = useState(null);
    const [attempt, setAttempt] = useState(0);
    const requestId = useRef(0);
    const username = user?.username || '';
    const selectionKey = JSON.stringify([username, month]);
    const current = result?.key === selectionKey ? result : null;
    const currentError = error?.key === selectionKey ? error.message : '';
    const loading = !currentError && (!current || loadingKey === selectionKey);
    const [year, monthNumber] = month.split('-').map(Number);
    const firstWeekday = new Date(year, monthNumber - 1, 1).getDay();
    const monthDays = new Date(year, monthNumber, 0).getDate();

    useEffect(() => {
        if (!username) return;
        const id = ++requestId.current;
        let active = true;
        const load = async () => {
            setLoadingKey(selectionKey);
            setError(null);
            try {
                if (!db) throw new Error('unconfigured');
                const [recordsResult, memosResult] = await Promise.allSettled([
                    getDocs(query(collection(db, 'records'), where('userName', '==', username), where('date', '>=', `${month}-01`), where('date', '<', `${nextMonth(month, 1)}-01`))),
                    getDoc(doc(db, 'pinnedMemos', username)),
                ]);
                if (!active || id !== requestId.current) return;
                if (recordsResult.status === 'rejected') throw recordsResult.reason;
                const records = recordsResult.value.docs.map(record => ({ ...record.data(), id: record.id }));
                const memos = memosResult.status === 'fulfilled' && memosResult.value.exists() ? memosResult.value.data().memos : [];
                setResult({ key: selectionKey, records, memos: Array.isArray(memos) ? memos : [], memoError: memosResult.status === 'rejected' });
            } catch {
                if (!active || id !== requestId.current) return;
                setResult(null);
                setError({ key: selectionKey, message: '실제 훈련 기록을 불러오지 못했어요. 연결 상태를 확인한 뒤 다시 조회해주세요.' });
            } finally {
                if (active && id === requestId.current) setLoadingKey('');
            }
        };
        void load();
        return () => { active = false; };
    }, [username, month, selectionKey, attempt]);

    const recordsByDate = useMemo(() => {
        const grouped = new Map();
        (current?.records || []).forEach(record => {
            if (record.userName !== username || !record.date?.startsWith(`${month}-`) || record.date > today) return;
            const records = grouped.get(record.date) || [];
            records.push(record);
            grouped.set(record.date, records);
        });
        for (const records of grouped.values()) records.sort((a, b) => {
            if (a.order !== undefined && b.order !== undefined) return a.order - b.order;
            if (a.order !== undefined) return -1;
            if (b.order !== undefined) return 1;
            return timestampValue(a.timestamp) - timestampValue(b.timestamp);
        });
        return grouped;
    }, [current, username, month, today]);
    const selectedRecords = recordsByDate.get(selectedDate) || [];
    const goToMonth = target => {
        if (target > today.slice(0, 7)) return;
        setMonth(target);
        setSelectedDate(target === today.slice(0, 7) ? today : `${target}-01`);
    };
    const reload = () => setAttempt(value => value + 1);

    return <section className="live-training-review" aria-label="실제 훈련일지 조회">
        <header className="ltlr-header"><div><p>근력학교</p><h1>훈련일지</h1><span>{username}님의 실제 기록</span></div><button type="button" onClick={reload} disabled={loading}>{loading ? '조회 중…' : '새로고침'}</button></header>
        <button type="button" className="ltlr-start" disabled>오늘 운동 기록하기 ＋</button>
        <p className="ltlr-readonly">조회 전용 화면이에요. 기록 작성·수정·삭제는 실행되지 않아요.</p>
        <section className="ltlr-calendar-card" aria-label="월간 운동 기록">
            <div className="ltlr-month-heading"><h2>{year}년 {monthNumber}월</h2><div><button type="button" aria-label="이전 달" onClick={() => goToMonth(nextMonth(month, -1))}>‹</button><button type="button" aria-label="다음 달" disabled={month >= today.slice(0, 7)} onClick={() => goToMonth(nextMonth(month, 1))}>›</button></div></div>
            <div className="ltlr-summary"><p>운동 기록 <strong>{current && !loading ? recordsByDate.size : '—'}<small>일</small></strong></p>{month !== today.slice(0, 7) ? <button type="button" onClick={() => goToMonth(today.slice(0, 7))}>이번 달로</button> : <span>기록을 남긴 날짜예요</span>}</div>
            <div className="ltlr-calendar" aria-label={`${year}년 ${monthNumber}월 기록 달력`}>
                {WEEKDAYS.map(day => <span key={day} className="ltlr-weekday">{day}</span>)}
                {Array.from({ length: firstWeekday }, (_, index) => <span key={`blank-${index}`} aria-hidden="true" />)}
                {Array.from({ length: monthDays }, (_, index) => {
                    const date = `${month}-${pad(index + 1)}`;
                    const records = recordsByDate.get(date) || [];
                    const hasRecords = records.length > 0;
                    const hasFeedback = records.some(record => String(record.feedback || '').trim());
                    const selected = date === selectedDate;
                    const isToday = date === today;
                    return <button type="button" key={date} className={`ltlr-day${hasRecords ? ' has-record' : ''}${selected ? ' is-selected' : ''}${isToday ? ' is-today' : ''}`} disabled={date > today} aria-pressed={selected} aria-current={isToday ? 'date' : undefined} aria-label={`${dateLabel(date)}, ${date > today ? '미래 날짜' : currentError ? '기록 조회 실패' : loading ? '기록 조회 중' : hasRecords ? '운동 기록 있음' : '기록 없음'}${hasFeedback ? ', 코치 피드백 있음' : ''}`} onClick={() => setSelectedDate(date)}><strong>{index + 1}</strong><small>{hasRecords ? '✓ ' : ''}{isToday ? '오늘' : selected ? '선택' : '\u00a0'}</small>{hasFeedback && <i aria-hidden="true" />}</button>;
                })}
            </div>
            <div className="ltlr-legend"><span><b>✓</b> 운동 기록</span><span><i /> 코치 피드백</span></div>
        </section>
        {loading && <p className="ltlr-status" role="status">실제 훈련 기록을 조회하고 있어요.</p>}
        {currentError && <div className="ltlr-status ltlr-error" role="alert"><p>{currentError}</p><button type="button" onClick={reload}>다시 조회</button></div>}
        {!loading && !currentError && current && <section className="ltlr-records" aria-label="선택한 날짜의 훈련 기록"><div className="ltlr-records-heading"><h2>{dateLabel(selectedDate)} 기록</h2><span>{selectedDate === today ? '오늘' : '선택한 날짜'}</span></div>
            {current.memoError && <div className="ltlr-memo-error"><p>종목 메모를 불러오지 못했어요. 운동 기록과 피드백은 확인할 수 있어요.</p><button type="button" onClick={reload}>메모 다시 조회</button></div>}
            {!selectedRecords.length ? <p className="ltlr-empty">{recordsByDate.size === 0 ? '이번 달에는 저장된 운동 기록이 없어요.' : '선택한 날짜에는 저장된 운동 기록이 없어요.'}</p> : selectedRecords.map(record => {
                const memo = current.memos.find(item => item.exercise === record.exercise)?.memo || record.memo;
                return <article className="ltlr-record" key={record.id}><div className="ltlr-record-title"><h3>{record.exercise || '운동'}</h3>{record.pain && <span className="ltlr-pain">통증</span>}</div><div className="ltlr-sets">{Array.isArray(record.sets) ? record.sets.map((set, index) => <p key={index}><span>{index + 1}세트</span>{formatSet(set)}</p>) : <p>{record.weight ?? ''}kg × {record.reps ?? ''}회 × {record.sets ?? ''}세트</p>}</div>{memo && <div className="ltlr-memo"><span>운동 메모</span><p>{memo}</p></div>}{record.feedback && <div className="ltlr-feedback"><span>코치 피드백</span><p>{record.feedback}</p></div>}</article>;
            })}
        </section>}
    </section>;
}
