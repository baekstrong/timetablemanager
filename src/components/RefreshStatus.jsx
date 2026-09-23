import { useEffect, useState } from 'react';
import { formatRefreshAge } from '../utils/refreshTime';
import './RefreshStatus.css';

export default function RefreshStatus({ refreshedAt, refreshing, message, onRefresh }) {
    const [now, setNow] = useState(Date.now);
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 15_000);
        return () => clearInterval(timer);
    }, []);
    const date = refreshedAt ? new Date(refreshedAt) : null;
    return <div className="refresh-status">
        <button className="refresh-status__button" type="button" onClick={onRefresh} disabled={refreshing} aria-label={refreshing ? '새로고침 중' : '새로고침'} title={refreshing ? '새로고침 중' : '최신 출석 현황 불러오기'} aria-busy={refreshing}>
            <svg className={refreshing ? 'is-refreshing' : undefined} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 3v5h-5" />
                <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
            </svg>
        </button>
        <span className="refresh-status__time">
            {date ? <>마지막 갱신 <time dateTime={date.toISOString()} title={date.toLocaleString('ko-KR')}>{date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })}</time> · {formatRefreshAge(refreshedAt, now)}</> : '최신 정보 확인 중…'}
        </span>
        {message && <span className="refresh-status__message" role="status">{message}</span>}
    </div>;
}
