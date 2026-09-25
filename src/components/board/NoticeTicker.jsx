import { useEffect, useState } from 'react';
import { getNoticeReads, getNoticeSummaries } from '../../services/noticeService';
import { isNoticeUnread } from '../../utils/noticeState';
import './NoticeTicker.css';

const DEFAULT_SERVICES = { getNoticeSummaries, getNoticeReads };

export default function NoticeTicker({ user, onOpen, services = DEFAULT_SERVICES, refreshKey = 0 }) {
    const username = user?.username;
    const [feed, setFeed] = useState({ owner: '', notices: [], reads: {}, error: false });
    const [retry, setRetry] = useState(0);
    const [index, setIndex] = useState(0);
    const [paused, setPaused] = useState(false);
    const [interacting, setInteracting] = useState(false);
    const [hidden, setHidden] = useState(() => document.hidden);
    const notices = feed.owner === username ? feed.notices : [];

    useEffect(() => {
        if (!username) return;
        let cancelled = false;
        Promise.all([services.getNoticeSummaries(), services.getNoticeReads(username)])
            .then(([notices, reads]) => {
                if (!cancelled) { setFeed({ owner: username, notices, reads, error: false }); setIndex(0); }
            })
            .catch(() => {
                if (!cancelled) setFeed({ owner: username, notices: [], reads: {}, error: true });
            });
        return () => { cancelled = true; };
    }, [username, services, retry, refreshKey]);

    useEffect(() => {
        const onVisibility = () => setHidden(document.hidden);
        document.addEventListener('visibilitychange', onVisibility);
        return () => document.removeEventListener('visibilitychange', onVisibility);
    }, []);

    useEffect(() => {
        if (notices.length < 2 || paused || interacting || hidden) return;
        const timer = setInterval(() => setIndex(value => (value + 1) % notices.length), 6000);
        return () => clearInterval(timer);
    }, [notices.length, paused, interacting, hidden]);

    if (!username || feed.owner !== username) return null;
    if (feed.error) return <div className="student-notice-bar student-notice-error" role="status"><span>공지를 불러오지 못했어요.</span><button type="button" onClick={() => setRetry(value => value + 1)}>다시 시도</button></div>;
    const notice = notices[index % notices.length];
    if (!notice) return null;
    const unread = isNoticeUnread(notice, feed.reads);

    return <aside className="student-notice-bar" aria-label="게시판 공지"
        onMouseEnter={() => setInteracting(true)} onMouseLeave={event => setInteracting(event.currentTarget.contains(document.activeElement))}
        onFocus={() => setInteracting(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setInteracting(false); }}>
        <button type="button" className="student-notice-open" onClick={() => onOpen?.(notice.id)} title={notice.title}
            aria-label={`공지: ${notice.title}${unread ? ', 새 공지, 아직 확인하지 않음' : ''}`}>
            <span className="student-notice-label">공지</span>
            <span className="student-notice-title">{notice.title}</span>
            {unread && <span className="student-notice-new" aria-hidden="true">N</span>}
        </button>
        {notices.length > 1 && <>
            <button type="button" className="student-notice-next" aria-label={`다음 공지, 현재 ${index % notices.length + 1}/${notices.length}`} onClick={() => setIndex(value => (value + 1) % notices.length)}><span>{index % notices.length + 1}/{notices.length}</span><span aria-hidden="true">›</span></button>
            <button type="button" className="student-notice-pause" aria-label={paused ? '공지 자동 순환 시작' : '공지 자동 순환 멈추기'} aria-pressed={paused} onClick={() => setPaused(value => !value)}>
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" fill="currentColor">{paused ? <path d="M3 1.5 10 6 3 10.5Z" /> : <><rect x="2" y="2" width="3" height="8" rx=".5" /><rect x="7" y="2" width="3" height="8" rx=".5" /></>}</svg>
            </button>
        </>}
    </aside>;
}
