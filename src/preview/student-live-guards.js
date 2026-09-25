// The live review permits data reads and normal sign-in only. Firestore writes also
// use POST, so distinguish the read transport from mutation endpoints explicitly.
export function isStudentLiveReadRequest(input, method, { origin, sheetsBase }) {
    const url = new URL(input, origin);
    const verb = String(method || 'GET').toUpperCase();
    const sheets = new URL(sheetsBase, origin);
    const basePath = sheets.pathname.replace(/\/$/, '');
    const authPath = `${basePath.replace(/\/sheets$/, '')}/auth/login`;
    if (url.origin === sheets.origin && url.pathname === authPath) return verb === 'POST';
    if (url.origin === sheets.origin && url.pathname.startsWith(`${basePath}/`)) {
        const path = url.pathname.slice(basePath.length);
        if (['/info', '/read'].includes(path)) return verb === 'GET';
        if (path === '/batchGet') return verb === 'POST';
        return false;
    }
    if (url.hostname === 'firestore.googleapis.com') {
        if (/\/(?:Write|Commit|BatchWrite)(?:\/|$)|:(?:commit|batchWrite)$/.test(url.pathname)) return false;
        return /\/Listen\/channel$|\/documents:(?:batchGet|runQuery)$/.test(url.pathname)
            || (verb === 'GET' && /\/documents(?:\/|$)/.test(url.pathname));
    }
    if (url.hostname === 'identitytoolkit.googleapis.com') {
        return verb === 'POST' && /^\/v1\/accounts:(?:signInWithCustomToken|lookup)$/.test(url.pathname);
    }
    if (url.hostname === 'securetoken.googleapis.com') return verb === 'POST' && url.pathname === '/v1/token';
    // Local static assets/HMR are read-only; deny all other same-origin endpoints.
    return url.origin === origin && verb === 'GET' && !url.pathname.includes('/.netlify/functions/')
        && /\.(?:js|jsx|css|json|svg|png|woff2?)(?:$)|^\/(?:@vite|@id|@fs|src|node_modules)\//.test(url.pathname);
}

export function studentLiveInitialSelection(identity, requestedName = '') {
    if (identity?.role === 'student') return identity.username;
    return identity?.role === 'coach' ? requestedName.trim() : '';
}

export function installStudentLiveGuards({ origin, sheetsBase }) {
    const permits = (url, method) => isStudentLiveReadRequest(url, method, { origin, sheetsBase });
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
        const requestUrl = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
        if (!permits(requestUrl, init?.method || input.method)) return Promise.reject(new Error('실데이터 조회 전용: 허용되지 않은 요청입니다.'));
        return nativeFetch(input, init);
    };
    const nativeOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        if (!permits(String(url), method)) throw new Error('실데이터 조회 전용: 허용되지 않은 요청입니다.');
        return nativeOpen.call(this, method, url, ...rest);
    };
    // Existing services log registration rows and names. This page displays them
    // only in the authenticated UI and never writes those details to the console.
    for (const method of ['log', 'info', 'debug', 'warn', 'error']) window.console[method] = () => {};
}
