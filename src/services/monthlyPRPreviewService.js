import { collection, doc, getDoc, getDocs, limit, orderBy, query, Timestamp, where } from 'firebase/firestore';
import { db } from '../config/firebase';

export const MONTHLY_PR_PREVIEW_LIMIT = 12;
export const MONTHLY_PR_PREVIEW_TTL = 5 * 60 * 1000;
const STORAGE_KEY = 'monthly-pr-preview-v1';
let cached = null;
let pending = null;

function readCache() {
    if (cached?.expiresAt > Date.now()) return cached.value;
    try {
        const stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null');
        if (stored?.expiresAt > Date.now() && stored.expiresAt <= Date.now() + MONTHLY_PR_PREVIEW_TTL
            && Array.isArray(stored.value?.records) && stored.value.records.length <= MONTHLY_PR_PREVIEW_LIMIT
            && stored.value.tierMap && typeof stored.value.tierMap === 'object') {
            cached = stored;
            return stored.value;
        }
    } catch { /* 저장소가 없어도 메모리 캐시와 조회를 사용할 수 있다. */ }
    return null;
}

// 첫 화면은 최근 12건만 읽는다. 전체 PR은 랭킹에서 확인한다.
// users 전체 컬렉션 대신 표시되는 작성자만 읽으며 회전·탭 왕복은 재조회하지 않는다.
export async function getMonthlyPRPreview({ force = false } = {}) {
    if (pending) return pending;
    const previous = !force && readCache();
    if (previous) return previous;
    pending = (async () => {
        if (!db) throw new Error('PR 기록을 불러올 수 없습니다.');
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 30);
        const snapshot = await getDocs(query(collection(db, 'personalBests'),
            where('updatedAt', '>=', Timestamp.fromDate(cutoff)), orderBy('updatedAt', 'desc'), limit(MONTHLY_PR_PREVIEW_LIMIT)));
        const records = snapshot.docs.map(item => {
            const row = item.data();
            return { id: item.id, userName: row.userName, exercise: row.exercise,
                prType: row.prType, intensity: row.intensity, reps: row.reps, date: row.date };
        });
        const names = [...new Set(records.map(row => row.userName).filter(name => typeof name === 'string' && name && !name.includes('/')))];
        const tiers = await Promise.all(names.map(async name => {
            try {
                const user = await getDoc(doc(db, 'users', name));
                return [name, user.exists() ? user.data()?.tier || null : null];
            } catch { return [name, null]; } // 보조 배지를 못 읽어도 PR 본문은 표시한다.
        }));
        const value = { records, tierMap: Object.fromEntries(tiers) };
        cached = { expiresAt: Date.now() + MONTHLY_PR_PREVIEW_TTL, value };
        try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(cached)); } catch { /* 메모리 캐시 유지 */ }
        return value;
    })().finally(() => { pending = null; });
    return pending;
}
