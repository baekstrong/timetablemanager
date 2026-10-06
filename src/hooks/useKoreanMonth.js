import { useEffect, useState } from 'react';
import { koreanDate } from '../utils/recruitment';

// 열린 화면도 한국 날짜의 자정/탭 복귀 때 모집월 범위를 갱신한다.
export default function useKoreanMonth() {
    const [month, setMonth] = useState(() => koreanDate().slice(0, 7));
    useEffect(() => {
        let timer;
        const refresh = () => {
            clearTimeout(timer);
            setMonth(koreanDate().slice(0, 7));
            const now = new Date();
            const koreanNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
            const midnight = Date.UTC(koreanNow.getUTCFullYear(), koreanNow.getUTCMonth(), koreanNow.getUTCDate() + 1) - 9 * 60 * 60 * 1000;
            timer = setTimeout(refresh, midnight - now.getTime() + 250);
        };
        const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
        refresh();
        window.addEventListener('focus', refresh);
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            clearTimeout(timer);
            window.removeEventListener('focus', refresh);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, []);
    return month;
}
