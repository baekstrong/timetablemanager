import { useEffect, useRef, useState } from 'react';
import { getMonthlyPRPreview } from '../services/monthlyPRPreviewService';
import TierBadge from './TierBadge';
import './MonthlyPRBanner.css';

const DEFAULT_SERVICES = { getMonthlyPRPreview };
const VISIBLE_ROWS = 1;

function formatPRSummary(pr) {
    const intensity = pr.intensity || {};
    const reps = pr.reps || {};
    switch (pr.prType) {
        case 'oneRM': return `${intensity.value ?? '—'}${intensity.unit || 'kg'}`;
        case 'weightThenReps': return `${intensity.value ?? '—'}${intensity.unit || 'kg'} × ${reps.value ?? '—'}회`;
        case 'timeHold': return `${reps.value ?? '—'}초`;
        case 'bodyweightReps': return `${reps.value ?? '—'}회`;
        default: return '';
    }
}

export default function MonthlyPRBanner({ onOpen, services = DEFAULT_SERVICES, refreshKey = 0 }) {
    const [feed, setFeed] = useState(null);
    const [retry, setRetry] = useState(0);
    const [index, setIndex] = useState(0);
    const [paused, setPaused] = useState(() => typeof window !== 'undefined'
        && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches));
    const [hovering, setHovering] = useState(false);
    const [focused, setFocused] = useState(false);
    const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden);
    const previousRequest = useRef(null);
    const current = feed?.services === services && feed?.refreshKey === refreshKey && feed?.retry === retry ? feed : null;
    const records = current?.records || [];

    useEffect(() => {
        let cancelled = false;
        const previous = previousRequest.current;
        const force = Boolean(previous && previous.services === services && (previous.retry !== retry
            || (previous.refreshKey != null && previous.refreshKey !== refreshKey)));
        previousRequest.current = { services, refreshKey, retry };
        Promise.resolve().then(() => services.getMonthlyPRPreview({ force }))
            .then(({ records, tierMap }) => {
                if (cancelled) return;
                setFeed({ services, refreshKey, retry, records: Array.isArray(records) ? records : [], tiers: tierMap || {}, error: false });
                setIndex(0);
            })
            .catch(() => {
                if (!cancelled) setFeed({ services, refreshKey, retry, records: [], tiers: {}, error: true });
            });
        return () => { cancelled = true; };
    }, [services, refreshKey, retry]);

    useEffect(() => {
        const onVisibility = () => setHidden(document.hidden);
        const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
        const onMotionChange = event => { if (event.matches) setPaused(true); };
        document.addEventListener('visibilitychange', onVisibility);
        motion?.addEventListener('change', onMotionChange);
        return () => {
            document.removeEventListener('visibilitychange', onVisibility);
            motion?.removeEventListener('change', onMotionChange);
        };
    }, []);

    useEffect(() => {
        if (records.length <= VISIBLE_ROWS || paused || hovering || focused || hidden) return;
        const timer = setInterval(() => setIndex(value => (value + 1) % records.length), 6000);
        return () => clearInterval(timer);
    }, [records.length, paused, hovering, focused, hidden]);

    const visibleRecords = records.length ? Array.from({ length: Math.min(VISIBLE_ROWS, records.length) },
        (_, offset) => records[(index + offset) % records.length]) : [];

    return <aside className="monthly-pr-banner" aria-label="이달의 PR"
        onMouseEnter={() => setHovering(true)} onMouseLeave={() => setHovering(false)}
        onFocus={() => setFocused(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
        <div className="monthly-pr-heading">
            <h2><span aria-hidden="true">🏆</span> 이달의 PR</h2>
            <button type="button" className="monthly-pr-link" onClick={onOpen}>랭킹 보기 <span aria-hidden="true">›</span></button>
            {records.length > VISIBLE_ROWS && <div className="monthly-pr-controls">
                <button type="button" aria-label="다음 PR 보기" title="다음 PR 보기"
                    onClick={() => setIndex(value => (value + 1) % records.length)}><span aria-hidden="true">›</span></button>
                <button type="button" aria-label={paused ? 'PR 자동 순환 시작' : 'PR 자동 순환 멈추기'}
                    title={paused ? '자동 순환 시작' : '자동 순환 멈추기'} aria-pressed={paused} onClick={() => setPaused(value => !value)}>
                    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" fill="currentColor">
                        {paused ? <path d="M3 1.5 10 6 3 10.5Z" /> : <><rect x="2" y="2" width="3" height="8" rx=".5" /><rect x="7" y="2" width="3" height="8" rx=".5" /></>}
                    </svg>
                </button>
            </div>}
        </div>
        {!current ? <p className="monthly-pr-message" role="status">최근 PR을 불러오는 중…</p>
            : current.error ? <div className="monthly-pr-message monthly-pr-error" role="status">
                <span>PR을 불러오지 못했어요.</span><button type="button" onClick={() => setRetry(value => value + 1)}>다시 시도</button>
            </div> : visibleRecords.length ? <button type="button" className="monthly-pr-records" onClick={onOpen} aria-live="off">
                {visibleRecords.map((record, offset) => <span className="monthly-pr-row" key={`${record.id || record.userName}-${offset}`}
                    title={`${record.userName} · ${record.exercise} ${formatPRSummary(record)} · ${record.date || ''}`}>
                    <TierBadge tier={current.tiers[record.userName]} /><strong>{record.userName}</strong>
                    {' — '}{record.exercise} {formatPRSummary(record)} <span className="monthly-pr-date">{record.date}</span>
                </span>)}
            </button> : <p className="monthly-pr-message">최근 30일 갱신된 PR이 없습니다.</p>}
    </aside>;
}
