import { createRoot } from 'react-dom/client';
// 로컬 목업 전용 진입점 — 배포 빌드 입력이 아니다. 실행: npx vite --config vite.waitlist-review.config.js
if (!import.meta.env.DEV || !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
    document.getElementById('root').textContent = '로컬 개발 환경에서만 사용할 수 있습니다.';
} else {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input.url, location.href);
        if (url.origin !== location.origin) return Promise.reject(new Error('목업에서는 외부 API를 호출하지 않습니다.'));
        return originalFetch(input, init);
    };
    const { default: WaitlistReview } = await import('./WaitlistReview.jsx');
    createRoot(document.getElementById('root')).render(<WaitlistReview />);
}
