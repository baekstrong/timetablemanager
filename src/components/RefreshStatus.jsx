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
        <button type="button" onClick={onRefresh} disabled={refreshing}>
            {refreshing ? '새로고침 중…' : '새로고침'}
        </button>
        <span className="refresh-status__time">
            {date ? <>마지막 갱신 <time dateTime={date.toISOString()} title={date.toLocaleString('ko-KR')}>{date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })}</time> · {formatRefreshAge(refreshedAt, now)}</> : '최신 정보 확인 중…'}
        </span>
        {message && <span className="refresh-status__message" role="status">{message}</span>}
    </div>;
}
