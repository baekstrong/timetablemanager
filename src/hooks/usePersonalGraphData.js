import { useEffect, useEffectEvent, useState } from 'react';

const EMPTY_DATA = [];

// Account/period changes hide the previous result immediately. A failed request
// remains an error, and retry starts a fresh request instead of caching emptiness.
export function usePersonalGraphData(key, load, emptyData = EMPTY_DATA) {
    const [attempt, setAttempt] = useState(0);
    const [result, setResult] = useState({ key: null, attempt: -1, data: emptyData, error: '' });
    const read = useEffectEvent(load);
    useEffect(() => {
        if (!key) return;
        let cancelled = false;
        Promise.resolve().then(() => read()).then(data => {
            if (!cancelled) setResult({ key, attempt, data, error: '' });
        }).catch(() => {
            if (!cancelled) setResult({ key, attempt, data: emptyData, error: '훈련 기록을 불러오지 못했어요. 다시 시도해주세요.' });
        });
        return () => { cancelled = true; };
    }, [key, attempt, emptyData]);
    const current = result.key === key && result.attempt === attempt;
    return {
        data: current ? result.data : emptyData,
        error: current ? result.error : '',
        loading: Boolean(key) && !current,
        retry: () => setAttempt(value => value + 1),
    };
}
