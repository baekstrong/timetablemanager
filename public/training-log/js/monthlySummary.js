// Shared by the main app and training log. Never stores tokens or record bodies.
export function createMonthlySummaryClient({ getToken, getSessionKey, endpoint, fetchImpl = (...args) => fetch(...args), timeoutMs = 20_000 }) {
    const inflight = new Map();
    return async (month, { refresh = false } = {}) => {
        if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('월 형식을 확인해주세요.');
        const session = getSessionKey();
        if (!session) throw new Error('로그인이 필요합니다.');
        const key = `${session}|${month}|${refresh}`;
        if (inflight.has(key)) return inflight.get(key);
        const request = (async () => {
            const controller = new AbortController();
            let timer;
            try {
                const timeout = new Promise((_, reject) => {
                    timer = setTimeout(() => { controller.abort(); reject(new Error('월별 기록 응답이 늦어지고 있어요. 다시 시도해주세요.')); }, timeoutMs);
                });
                const load = async () => {
                    const token = await getToken();
                    if (!token || getSessionKey() !== session || controller.signal.aborted) throw new Error('로그인을 다시 확인해주세요.');
                    const response = await fetchImpl(`${endpoint}?month=${encodeURIComponent(month)}${refresh ? '&refresh=1' : ''}`, {
                        headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
                    });
                    const data = await response.json();
                    if (!response.ok) throw new Error(response.status === 401 ? '로그인을 다시 확인해주세요.' : '월별 기록을 불러오지 못했어요. 다시 시도해주세요.');
                    if (getSessionKey() !== session) throw new Error('로그인 계정이 변경되었습니다.');
                    const validRow = row => typeof row?.userName === 'string' && ['trainingDays', 'activeDays', 'totalExercises', 'avgExercises', 'volume'].every(field => Number.isFinite(row[field]));
                    if (data.month !== month || !Array.isArray(data.students) || !data.students.every(validRow) || !data.generatedAt) throw new Error('월별 기록 응답을 확인하지 못했어요.');
                    return data;
                };
                return await Promise.race([load(), timeout]);
            } finally { clearTimeout(timer); }
        })().finally(() => { if (inflight.get(key) === request) inflight.delete(key); });
        inflight.set(key, request);
        return request;
    };
}
