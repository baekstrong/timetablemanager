import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import { getNoticeSummaries, getNoticeReads, markNoticeRead } from './noticeService';

const snapshot = data => ({ exists: () => data !== undefined, data: () => structuredClone(data) });
const notice = (id, revision) => ({ id, category: 'notice', createdAt: revision });
let users;

beforeEach(() => {
    vi.clearAllMocks();
    users = { 'users/학생': { isCoach: false, xp: 123, noticeReads: { previous: 50 } } };
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
        expect(mocks.getDocs).toHaveBeenCalledWith([{ collection: 'posts' }, { where: ['category', '==', 'notice'] }]);
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
});
