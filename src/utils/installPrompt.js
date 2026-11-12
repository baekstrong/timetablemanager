/**
 * 안드로이드 크롬의 '홈 화면에 추가' 이벤트(beforeinstallprompt)는 페이지 로드 직후 한 번만 온다.
 * 그 화면이 마운트되기 전에 지나가면 버튼을 띄울 수 없으므로 앱 시작 때 붙잡아 둔다(main.jsx).
 */
let deferred = null;

export function captureInstallPrompt() {
    if (typeof window === 'undefined') return;
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault(); // 크롬 기본 배너 대신 우리 버튼에서 띄운다
        deferred = e;
        window.dispatchEvent(new Event('install-prompt-ready'));
    });
    window.addEventListener('appinstalled', () => { deferred = null; });
}

export const getDeferredInstallPrompt = () => deferred;

/** 이벤트는 한 번만 쓸 수 있다 */
export function takeDeferredInstallPrompt() {
    const e = deferred;
    deferred = null;
    return e;
}
