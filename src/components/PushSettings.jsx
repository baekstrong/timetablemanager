import { useEffect, useId, useRef, useState } from 'react';
import { getPushPermission, initPush, isPushAvailable } from '../services/pushService';
import { resolvePushState } from '../utils/pushStatus';
import './PushSettings.css';

export default function PushSettings({ user, readOnly = false }) {
    const [result, setResult] = useState(null);
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const working = useRef(false);
    const detailsId = useId();
    const name = user?.username;
    const state = result?.name === name ? result.state : null;
    useEffect(() => {
        if (!name || readOnly) return;
        let cancelled = false;
        (async () => {
            const available = await isPushAvailable();
            const permission = getPushPermission();
            const token = available && permission === 'granted' ? await initPush(name) : null;
            if (!cancelled) setResult({ name, state: resolvePushState({ available, permission, token }) });
        })();
        return () => { cancelled = true; };
    }, [name, readOnly]);

    async function enable() {
        if (working.current || readOnly) return;
        working.current = true;
        setBusy(true);
        try {
            const token = await initPush(name, true);
            const available = await isPushAvailable();
            setResult({ name, state: resolvePushState({ available, permission: getPushPermission(), token }) });
            setOpen(!token);
        } finally {
            working.current = false;
            setBusy(false);
        }
    }

    if (!name || readOnly) return null;
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const label = busy ? '설정 중…' : state === 'on' ? '알림 켜짐' : state === 'off' ? '알림 켜기' : state ? '알림 설정' : '알림 확인 중';
    const message = state === 'on' ? '공지·댓글·답글·보강 자리 알림을 받을 수 있어요.'
        : state === 'denied' ? (isIOS ? '아이폰 설정 → 알림 → 근력학교에서 알림을 허용해주세요.' : '주소창 왼쪽 사이트 설정 → 알림 → 허용으로 바꿔주세요.')
        : state === 'unsupported' ? (isIOS ? '사파리에서 공유 → 홈 화면에 추가한 뒤 앱을 열어 알림을 켜주세요.' : '이 브라우저에서는 알림을 켤 수 없어요. 카톡·인스타 안에서 열었다면 크롬으로 다시 열어주세요.')
        : '공지·댓글·답글·보강 자리 알림을 받아보세요. 허용했는데 켜지지 않으면 다시 시도해주세요.';
    return <span className="push-settings">
        <button type="button" className={`push-settings-button${state === 'on' ? ' is-on' : ''}`} disabled={!state || busy}
            aria-label={label} aria-expanded={open} aria-controls={detailsId}
            onClick={() => state === 'off' ? enable() : setOpen(value => !value)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>
            <span>{label}</span>
        </button>
        {open && <span className="push-settings-details" id={detailsId} role="status"><span>{message}</span><button type="button" onClick={() => setOpen(false)} aria-label="알림 안내 닫기">×</button></span>}
    </span>;
}
