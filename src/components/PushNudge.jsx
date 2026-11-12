import { useEffect, useRef, useState } from 'react';
import { getPushPermission, initPush, isPushAvailable } from '../services/pushService';
import { pushBlockedGuide, resolvePushState } from '../utils/pushStatus';
import { resolveInstallState } from '../utils/installState';
import { getDeferredInstallPrompt, takeDeferredInstallPrompt } from '../utils/installPrompt';
import './PushNudge.css';

const DISMISS_KEY = 'pushNudgeDismissed';

function isStandalone() {
    try {
        return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    } catch {
        return false;
    }
}

function readDismissed(name) {
    try { return sessionStorage.getItem(DISMISS_KEY) === name; } catch { return false; }
}

/**
 * 수강생 첫 화면 '알림 켜기' 강조 카드 (2026-11-12 사용자 요청).
 * 보강 자리 안내(1시간 안에 수락)·맞교환 확정은 알림을 못 받으면 놓친다.
 * 알림이 켜질 때까지 매번 앱을 열 때 보인다 — '나중에'는 이번 실행에만 숨긴다.
 * 아이폰은 홈 화면에 추가해야 알림을 받을 수 있어 그 순서를 단계로 보여준다.
 * @param {string} [previewState] - 로컬 검토용: 'off'|'denied'|'ios-safari'|'ios-other'|'android'
 */
export default function PushNudge({ user, readOnly = false, previewState = null }) {
    const name = user?.username;
    const [state, setState] = useState(null); // resolvePushState 결과
    const [install, setInstall] = useState(null);
    const [busy, setBusy] = useState(false);
    const [dismissed, setDismissed] = useState(() => readDismissed(name));
    const working = useRef(false);
    const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(ua);

    useEffect(() => {
        if (!name || readOnly || previewState) return;
        let cancelled = false;
        const decideInstall = () => setInstall(resolveInstallState({ standalone: isStandalone(), ua: navigator.userAgent, canPrompt: Boolean(getDeferredInstallPrompt()) }));
        decideInstall();
        window.addEventListener('install-prompt-ready', decideInstall);
        (async () => {
            const available = await isPushAvailable();
            const permission = getPushPermission();
            const token = available && permission === 'granted' ? await initPush(name) : null;
            if (!cancelled) setState(resolvePushState({ available, permission, token }));
        })();
        return () => { cancelled = true; window.removeEventListener('install-prompt-ready', decideInstall); };
    }, [name, readOnly, previewState]);

    async function enable() {
        if (working.current || previewState) return;
        working.current = true;
        setBusy(true);
        try {
            const token = await initPush(name, true);
            const available = await isPushAvailable();
            const next = resolvePushState({ available, permission: getPushPermission(), token });
            setState(next);
            window.dispatchEvent(new Event('push-state-changed'));
            if (next === 'on') alert('알림이 켜졌어요. 보강 자리·맞교환 소식을 바로 알려드릴게요.');
        } finally {
            working.current = false;
            setBusy(false);
        }
    }

    async function installApp() {
        const prompt = takeDeferredInstallPrompt();
        if (!prompt) return;
        prompt.prompt();
        try { await prompt.userChoice; } catch { /* 무시 */ }
        setInstall(resolveInstallState({ standalone: isStandalone(), ua: navigator.userAgent, canPrompt: false }));
    }

    function later() {
        try { sessionStorage.setItem(DISMISS_KEY, name); } catch { /* 저장 못 해도 이번 화면에선 숨김 */ }
        setDismissed(true);
    }

    if (!name || readOnly || dismissed) return null;
    const view = previewState || (state === 'unsupported' && isIOS && install !== 'installed' ? install : state);
    if (!view || view === 'on') return null;
    const showAndroidInstall = !previewState ? install === 'android' : view === 'android';

    let body;
    if (view === 'ios-safari' || view === 'ios-other') {
        body = <ol className="push-nudge-steps">
            {view === 'ios-other' && <li><strong>사파리로 열기</strong> — 지금은 카톡·인스타 등 다른 앱 안에서 열려 있어요. 오른쪽 아래 ⋯ 또는 공유 버튼에서 ‘사파리로 열기’를 눌러주세요.</li>}
            <li>사파리 화면 아래 <strong>공유 버튼</strong>(네모에 위쪽 화살표)을 눌러요.</li>
            <li>목록을 내려 <strong>‘홈 화면에 추가’</strong>를 누르고 ‘추가’를 눌러요.</li>
            <li>홈 화면에 생긴 <strong>근력학교 아이콘</strong>으로 앱을 열고, 여기 뜨는 <strong>‘알림 켜기’</strong>를 눌러요.</li>
        </ol>;
    } else if (view === 'off' || view === 'android') {
        body = <>
            <p>버튼을 누르고 ‘허용’을 눌러주세요.</p>
            <div className="push-nudge-actions">
                {showAndroidInstall && <button type="button" className="push-nudge-button" onClick={installApp}>홈 화면에 추가</button>}
                <button type="button" className="push-nudge-button primary" disabled={busy} onClick={enable}>{busy ? '설정 중…' : '알림 켜기'}</button>
            </div>
        </>;
    } else if (view === 'unsupported' && isIOS) {
        body = <p>아이폰 iOS 16.4 이상에서 알림을 받을 수 있어요. 설정 → 일반 → 소프트웨어 업데이트 후 다시 열어주세요.</p>;
    } else {
        body = <p>{pushBlockedGuide(view === 'denied' ? 'denied' : 'unsupported', isIOS)}</p>;
    }

    return <section className="push-nudge" aria-labelledby="push-nudge-title">
        <div className="push-nudge-head">
            <h2 id="push-nudge-title"><span aria-hidden="true">🔔</span> 알림을 꼭 켜주세요</h2>
            <button type="button" className="push-nudge-later" onClick={later}>나중에</button>
        </div>
        <p className="push-nudge-why">보강 자리가 나면 <strong>1시간 안에 수락</strong>해야 하고, 맞교환이 확정되면 바로 알려드려요. 알림이 꺼져 있으면 자리가 다음 사람에게 넘어가요.</p>
        {body}
    </section>;
}
