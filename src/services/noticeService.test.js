import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isNoticeUnread } from '../utils/noticeState';

const mocks = vi.hoisted(() => ({ getDoc: vi.fn(), getDocs: vi.fn(), runTransaction: vi.fn(), updates: vi.fn() }));
vi.mock('../config/firebase', () => ({ db: { reviewOnly: true } }));
vi.mock('firebase/firestore', () => ({
    collection: (_db, name) => ({ collection: name }),
    doc: (_db, name, id) => ({ path: `${name}/${id}` }),
    query: (...parts) => parts,
    where: (...parts) => ({ where: parts }),
    FieldPath: class { constructor(...segments) { this.segments = segments; } },
    getDoc: mocks.getDoc,
    getDocs: mocks.getDocs,
    runTransaction: mocks.runTransaction,
}));

let getNoticeSummaries, getNoticeReads, markNoticeRead, NOTICE_SUMMARIES_TTL, NOTICE_READS_TTL;

const snapshot = data => ({ exists: () => data !== undefined, data: () => structuredClone(data) });
const notice = (id, revision) => ({ id, category: 'notice', createdAt: revision });
let users;

beforeEach(async () => {
    vi.resetModules();
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-25T10:00:00+09:00'));
    ({ getNoticeSummaries, getNoticeReads, markNoticeRead, NOTICE_SUMMARIES_TTL, NOTICE_READS_TTL } = await import('./noticeService'));
    users = { 'users/학생': { isCoach: false, xp: 123, noticeReads: { previous: 50 } } };
    mocks.getDocs.mockResolvedValue({ docs: [] });
    mocks.getDoc.mockImplementation(async reference => snapshot(users[reference.path]));
    mocks.runTransaction.mockImplementation(async (_db, callback) => callback({
        get: async reference => snapshot(users[reference.path]),
        update: (reference, field, value) => {
            mocks.updates(reference, field, value);
            const [map, id] = field.segments;
            users[reference.path][map] ||= {};
            users[reference.path][map][id] = value;
        },
    }));
});
afterEach(() => { vi.useRealTimers(); });

describe('공지 서비스 — 모든 Firestore 호출은 mock', () => {
    it('상단 고정 공지만 삭제 제외·작성일 최신순으로 요약한다', async () => {
        const posts = [
            { ...notice('new', 500), title: '최근', content: '본문', images: ['image'] },
            { ...notice('pinned-old', 100), title: '고정', pinned: true },
            { ...notice('pinned-new', 200), title: '최근 고정', pinned: true },
            { ...notice('deleted', 600), pinned: true, deleted: true },
            { ...notice('free', 700), category: 'free', pinned: true },
            { ...notice('unpinned', 800), pinned: false },
        ];
        mocks.getDocs.mockResolvedValue({ docs: posts.map(post => ({ id: post.id, data: () => post })) });
        const summaries = await getNoticeSummaries();
        expect(summaries.map(post => post.id)).toEqual(['pinned-new', 'pinned-old']);
        expect(Object.keys(summaries[0]).sort()).toEqual(['createdAt', 'id', 'pinned', 'title', 'updatedAt']);
        expect(mocks.getDocs).toHaveBeenCalledWith([{ collection: 'posts' }, { where: ['pinned', '==', true] }]);
        expect(mocks.runTransaction).not.toHaveBeenCalled();
    });

    it('사용자별 서버 읽음 상태를 조회하며 계정이 없으면 조회하지 않는다', async () => {
        users['users/다른학생'] = { noticeReads: { other: 80, malformed: '90' } };
        expect(await getNoticeReads('학생')).toEqual({ previous: 50 });
        expect(await getNoticeReads('다른학생')).toEqual({ other: 80 });
        expect(await getNoticeReads('없는학생')).toEqual({});
        mocks.getDoc.mockClear();
        expect(await getNoticeReads('')).toEqual({});
        expect(mocks.getDoc).not.toHaveBeenCalled();
    });

    it('서로 다른 공지의 동시 확인은 다른 필드와 기존 읽음 정보를 보존한다', async () => {
        await Promise.all([markNoticeRead('학생', notice('one', 100)), markNoticeRead('학생', notice('two', 200))]);
        expect(users['users/학생']).toEqual({ isCoach: false, xp: 123, noticeReads: { previous: 50, one: 100, two: 200 } });
        expect(mocks.updates).toHaveBeenCalledTimes(2);
    });

    it('같은 수정본 재확인과 늦은 이전 수정본은 서버 값을 낮추거나 다시 쓰지 않는다', async () => {
        await markNoticeRead('학생', notice('same', 300));
        expect(await markNoticeRead('학생', notice('same', 300))).toBe(false);
        expect(await markNoticeRead('학생', notice('same', 100))).toBe(false);
        expect(users['users/학생'].noticeReads.same).toBe(300);
        expect(mocks.updates).toHaveBeenCalledTimes(1);
    });

    it('트랜잭션 충돌 재시도 때 다른 기기의 최신 확인 revision을 존중한다', async () => {
        mocks.runTransaction.mockImplementation(async (_db, callback) => {
            // The first attempted write loses a concurrent commit and is retried.
            await callback({ get: async () => snapshot({ noticeReads: {} }), update() {} });
            users['users/학생'].noticeReads.same = 500;
            return callback({ get: async () => snapshot(users['users/학생']), update: mocks.updates });
        });
        expect(await markNoticeRead('학생', notice('same', 100))).toBe(false);
        expect(users['users/학생'].noticeReads.same).toBe(500);
        expect(mocks.updates).not.toHaveBeenCalled();
    });

    it('점이 포함된 글 ID도 하나의 map key로 저장한다', async () => {
        await markNoticeRead('학생', notice('a.b', 123));
        expect(mocks.updates.mock.calls[0][1].segments).toEqual(['noticeReads', 'a.b']);
        expect(users['users/학생'].noticeReads['a.b']).toBe(123);
    });

    it('삭제글·비공지·계정 누락은 저장하지 않고 서버 실패는 호출자에게 알린다', async () => {
        await markNoticeRead('학생', { ...notice('deleted', 100), deleted: true });
        await markNoticeRead('학생', { ...notice('free', 100), category: 'free' });
        await markNoticeRead('', notice('one', 100));
        expect(mocks.runTransaction).not.toHaveBeenCalled();
        mocks.runTransaction.mockRejectedValueOnce(new Error('offline'));
        await expect(markNoticeRead('학생', notice('one', 100))).rejects.toThrow('offline');
        expect(users['users/학생'].noticeReads).toEqual({ previous: 50 });
        await expect(markNoticeRead('없는학생', notice('one', 100))).rejects.toThrow('사용자 정보');
    });

    it('고정 공지는 개수로 자르지 않고 60초 안의 동시 요청·100회 왕복을 한 조회로 합친다', async () => {
        const posts = Array.from({ length: 40 }, (_, index) => ({ ...notice(`pinned-${index}`, index), pinned: true }));
        mocks.getDocs.mockResolvedValue({ docs: posts.map(post => ({ id: post.id, data: () => post })) });
        const results = await Promise.all(Array.from({ length: 20 }, () => getNoticeSummaries()));
        expect(results.every(result => result.length === 40)).toBe(true);
        for (let i = 0; i < 100; i++) await getNoticeSummaries();
        expect(mocks.getDocs).toHaveBeenCalledTimes(1);
        await getNoticeSummaries({ force: true });
        expect(mocks.getDocs).toHaveBeenCalledTimes(2);
        vi.advanceTimersByTime(NOTICE_SUMMARIES_TTL);
        await Promise.all([getNoticeSummaries(), getNoticeSummaries()]);
        expect(mocks.getDocs).toHaveBeenCalledTimes(3);
    });

    it('계정별 읽음 조회는 1.5초 안의 동시 요청·100회 왕복을 합치고 강제 조회·만료를 구분한다', async () => {
        users['users/다른학생'] = { noticeReads: { other: 100 } };
        await Promise.all(Array.from({ length: 20 }, () => getNoticeReads('학생')));
        for (let i = 0; i < 100; i++) expect(await getNoticeReads('학생')).toEqual({ previous: 50 });
        expect(mocks.getDoc).toHaveBeenCalledTimes(1);
        expect(await getNoticeReads('다른학생')).toEqual({ other: 100 });
        expect(mocks.getDoc).toHaveBeenCalledTimes(2);
        await getNoticeReads('학생', { force: true });
        expect(mocks.getDoc).toHaveBeenCalledTimes(3);
        vi.advanceTimersByTime(NOTICE_READS_TTL);
        await Promise.all([getNoticeReads('학생'), getNoticeReads('학생')]);
        expect(mocks.getDoc).toHaveBeenCalledTimes(4);
    });

    it('실제 확인 성공은 캐시에도 즉시 반영하고 다른 계정과 새 수정본의 N은 보존한다', async () => {
        const post = notice('one', 100);
        const reads = await getNoticeReads('학생');
        expect(isNoticeUnread(post, reads)).toBe(true);
        await markNoticeRead('학생', post);
        const updated = await getNoticeReads('학생');
        expect(isNoticeUnread(post, updated)).toBe(false);
        expect(isNoticeUnread({ ...post, updatedAt: 200 }, updated)).toBe(true);
        expect(mocks.getDoc).toHaveBeenCalledTimes(1);
        expect(isNoticeUnread(post, await getNoticeReads('다른학생'))).toBe(true);
    });

    it('확인 전에 시작된 늦은 읽음 응답도 확인 revision을 덮어써 N을 되살리지 않는다', async () => {
        const stale = snapshot(structuredClone(users['users/학생']));
        let resolveRead;
        mocks.getDoc.mockReturnValueOnce(new Promise(resolve => { resolveRead = resolve; }));
        const pendingRead = getNoticeReads('학생');
        await markNoticeRead('학생', notice('one', 300));
        resolveRead(stale);
        const reads = await pendingRead;
        expect(reads.one).toBe(300);
        expect(isNoticeUnread(notice('one', 300), await getNoticeReads('학생'))).toBe(false);
        expect(mocks.getDoc).toHaveBeenCalledTimes(1);
    });

    it('동시 확인과 늦은 이전 수정본의 캐시 병합은 모든 공지의 최대 revision을 보존한다', async () => {
        await getNoticeReads('학생');
        await Promise.all([markNoticeRead('학생', notice('one', 300)), markNoticeRead('학생', notice('two', 200))]);
        await markNoticeRead('학생', notice('one', 100));
        expect(await getNoticeReads('학생')).toEqual({ previous: 50, one: 300, two: 200 });
        expect(mocks.getDoc).toHaveBeenCalledTimes(1);
    });

    it('조회 실패는 캐시하지 않고 확인 저장 실패는 캐시의 N을 지우지 않는다', async () => {
        mocks.getDocs.mockRejectedValueOnce(new Error('offline'));
        await expect(getNoticeSummaries()).rejects.toThrow('offline');
        await getNoticeSummaries();
        expect(mocks.getDocs).toHaveBeenCalledTimes(2);
        mocks.getDoc.mockRejectedValueOnce(new Error('offline'));
        await expect(getNoticeReads('학생')).rejects.toThrow('offline');
        await getNoticeReads('학생');
        expect(mocks.getDoc).toHaveBeenCalledTimes(2);
        mocks.runTransaction.mockRejectedValueOnce(new Error('offline'));
        await expect(markNoticeRead('학생', notice('one', 100))).rejects.toThrow('offline');
        expect(isNoticeUnread(notice('one', 100), await getNoticeReads('학생'))).toBe(true);
    });
});
