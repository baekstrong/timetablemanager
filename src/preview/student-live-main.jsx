import { createRoot } from 'react-dom/client';
import { installStudentLiveGuards } from './student-live-guards';

if (!import.meta.env.DEV || !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
    document.getElementById('root').textContent = '로컬 개발 환경에서만 사용할 수 있습니다.';
} else {
    installStudentLiveGuards({ origin: location.origin, sheetsBase: import.meta.env.VITE_FUNCTIONS_URL || 'http://localhost:5001' });
    const { default: StudentLiveReview } = await import('./StudentLiveReview.jsx');
    createRoot(document.getElementById('root')).render(<StudentLiveReview />);
}
