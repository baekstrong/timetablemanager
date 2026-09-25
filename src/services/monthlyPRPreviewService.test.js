import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getDoc: vi.fn(), getDocs: vi.fn() }));
vi.mock('../config/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
    collection: (_db, name) => ({ name }), doc: (_db, name, id) => ({ name, id }),
    query: (collection, ...constraints) => ({ ...collection, constraints }),
    where: (field, op, value) => ({ field, op, value }), orderBy: (field, direction) => ({ order: field, direction }),
    limit: count => ({ limit: count }), Timestamp: { fromDate: date => date },
    getDoc: mocks.getDoc, getDocs: mocks.getDocs,
}));

let storage;
beforeEach(() => {
    vi.resetModules(); vi.clearAllMocks(); vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-25T10:00:00+09:00'));
    storage = new Map();
    vi.stubGlobal('sessionStorage', { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) });
    mocks.getDocs.mockResolvedValue({ docs: Array.from({ length: 12 }, (_, i) => ({ id: `pr-${i}`, data: () => ({ userName: `학생${i}`, exercise: '스쿼트', prType: 'oneRM', intensity: { value: 80, unit: 'kg' }, date: '2026-09-25' }) })) });
    mocks.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ tier: 'rookie' }) });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('첫 화면 PR 문서 읽기 상한', () => {
    it('최근30일·최신순·12건 제한, 작성자12명만 읽고 users 전체 조회는 없다', async () => {
        const { getMonthlyPRPreview } = await import('./monthlyPRPreviewService');
        const result = await getMonthlyPRPreview();
        expect(mocks.getDocs).toHaveBeenCalledTimes(1);
        expect(mocks.getDocs.mock.calls[0][0]).toMatchObject({ name: 'personalBests', constraints: [
            { field: 'updatedAt', op: '>=' }, { order: 'updatedAt', direction: 'desc' }, { limit: 12 },
        ] });
        expect(mocks.getDoc).toHaveBeenCalledTimes(12);
        expect(mocks.getDoc.mock.calls.every(([ref]) => ref.name === 'users')).toBe(true);
        expect(result.records).toHaveLength(12);
    });
    it('동시 마운트·회전/화면 왕복 100회는 한 묶음만 조회하고 훈련일지 왕복 후에도 캐시를 재사용한다', async () => {
        const { getMonthlyPRPreview } = await import('./monthlyPRPreviewService');
        await Promise.all(Array.from({ length: 20 }, () => getMonthlyPRPreview()));
        for (let i = 0; i < 100; i++) await getMonthlyPRPreview();
        expect(mocks.getDocs).toHaveBeenCalledTimes(1);
        expect(mocks.getDoc).toHaveBeenCalledTimes(12);
        vi.resetModules();
        await (await import('./monthlyPRPreviewService')).getMonthlyPRPreview();
        expect(mocks.getDocs).toHaveBeenCalledTimes(1);
    });
    it('5분 만료 후 또는 명시적 새로고침 때만 다시 조회한다', async () => {
        const { getMonthlyPRPreview, MONTHLY_PR_PREVIEW_TTL } = await import('./monthlyPRPreviewService');
        await getMonthlyPRPreview();
        await getMonthlyPRPreview({ force: true });
        expect(mocks.getDocs).toHaveBeenCalledTimes(2);
        vi.advanceTimersByTime(MONTHLY_PR_PREVIEW_TTL);
        await Promise.all([getMonthlyPRPreview(), getMonthlyPRPreview()]);
        expect(mocks.getDocs).toHaveBeenCalledTimes(3);
    });
    it('동일 작성자는 한 번만, 빈 PR은 작성자 조회 없이 처리한다', async () => {
        const { getMonthlyPRPreview } = await import('./monthlyPRPreviewService');
        mocks.getDocs.mockResolvedValueOnce({ docs: [1, 2, 3].map(id => ({ id: String(id), data: () => ({ userName: '학생A' }) })) });
        await getMonthlyPRPreview();
        expect(mocks.getDoc).toHaveBeenCalledTimes(1);
        mocks.getDocs.mockResolvedValueOnce({ docs: [] });
        expect(await getMonthlyPRPreview({ force: true })).toEqual({ records: [], tierMap: {} });
        expect(mocks.getDoc).toHaveBeenCalledTimes(1);
    });
    it('실패를 빈 성공으로 캐시하지 않아 재시도가 가능하다', async () => {
        const { getMonthlyPRPreview } = await import('./monthlyPRPreviewService');
        mocks.getDocs.mockRejectedValueOnce(new Error('offline'));
        await expect(getMonthlyPRPreview()).rejects.toThrow('offline');
        await getMonthlyPRPreview();
        expect(mocks.getDocs).toHaveBeenCalledTimes(2);
    });
});
