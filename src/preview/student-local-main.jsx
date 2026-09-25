import { createRoot } from 'react-dom/client';
// This entry is deliberately outside the production build inputs.
if (!import.meta.env.DEV || !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
    document.getElementById('root').textContent = '로컬 개발 환경에서만 사용할 수 있습니다.';
} else {
    const NativeDate = window.Date;
    const reviewTime = new NativeDate('2026-09-16T09:00:00+09:00').getTime();
    window.Date = class extends NativeDate {
        constructor(...args) { super(...(args.length ? args : [reviewTime])); }
        static now() { return reviewTime; }
    };
    // Only fixture adapters may make changes. Guard accidental new remote fetches too.
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input.url, location.href);
        if (url.origin !== location.origin) return Promise.reject(new Error('로컬 검토에서는 외부 API를 호출하지 않습니다.'));
        return originalFetch(input, init);
    };
    const { default: StudentLocalReview } = await import('./StudentLocalReview.jsx');
    createRoot(document.getElementById('root')).render(<StudentLocalReview />);
}
