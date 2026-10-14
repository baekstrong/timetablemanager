import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { expect, it, vi } from 'vitest';

const stamp = value => ({ toMillis: () => value });
const post = (id, createdAt, fields = {}) => ({ id, category: 'free', createdAt: stamp(createdAt), title: id, author: '검증 작성자', deleted: false, content: '본문', images: ['one', 'two'], likes: ['one'], commentCount: 3, ...fields });
const byNewest = (a, b) => b.createdAt.toMillis() - a.createdAt.toMillis() || b.id.localeCompare(a.id);

// 실제 getPostsPage 본문을 실행한다. Firestore 전송만 데이터셋으로 대체하며
// DocumentSnapshot 커서는 정렬 값+문서 ID 기준(같은 작성시각 포함)으로 모의한다.
function service(initial) {
    let rows = initial;
    const calls = [];
    const snapshot = row => ({ id: row.id, data: () => row });
    const getDocs = vi.fn(async request => {
        let result = [...rows];
        for (const condition of request.constraints.filter(item => item.type === 'where')) result = result.filter(row => row[condition.field] === condition.value);
        if (request.constraints.some(item => item.type === 'order')) result = result.filter(row => row.createdAt !== undefined).sort(byNewest);
        const after = request.constraints.find(item => item.type === 'after');
        if (after) result = result.filter(row => byNewest(row, after.cursor.data()) > 0);
        const limit = request.constraints.find(item => item.type === 'limit');
        if (limit) result = result.slice(0, limit.count);
        calls.push({ request, returned: result.length });
        return { docs: result.map(snapshot) };
    });
    const context = vm.createContext({
        db: {}, assertFirebase: () => {}, safeRead: (_, work) => work(), getDocs,
        collection: (_, name) => name, query: (name, ...constraints) => ({ name, constraints }),
        where: (field, op, value) => ({ type: 'where', field, op, value }),
        orderBy: (field, direction) => ({ type: 'order', field, direction }),
        queryLimit: count => ({ type: 'limit', count }), startAfter: cursor => ({ type: 'after', cursor }),
    });
    const source = readFileSync(new URL('./firebaseService.js', import.meta.url), 'utf8');
    const body = source.slice(source.indexOf('export const getPostsPage ='), source.indexOf('export const getLatestPostCreatedAt =')).replace('export ', '');
    vm.runInContext(body, context);
    return {
        calls, getDocs, setRows: next => { rows = next; },
        read(category = 'all', size = 10, cursor = null) { context.args = [category, size, cursor]; return vm.runInContext('getPostsPage(...args)', context); },
    };
}

it('1000개 분류의 첫 페이지는 최대 11개만 읽고 다음 페이지는 문서 커서 뒤에서 읽는다', async () => {
    const s = service(Array.from({ length: 1000 }, (_, i) => post(`free-${i}`, 1000 - i)).concat(post('other', 2000, { category: 'column' })));
    const first = await s.read('free');
    expect(first.posts.map(item => item.id)).toEqual(Array.from({ length: 10 }, (_, i) => `free-${i}`));
    expect(first.hasNextPage).toBe(true);
    expect(first.nextCursor.id).toBe('free-9');
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0].returned).toBe(11);
    expect(s.calls[0].request.constraints).toEqual([
        { type: 'where', field: 'category', op: '==', value: 'free' },
        { type: 'order', field: 'createdAt', direction: 'desc' }, { type: 'limit', count: 11 },
    ]);
    const second = await s.read('free', 10, first.nextCursor);
    expect(second.posts.map(item => item.id)).toEqual(Array.from({ length: 10 }, (_, i) => `free-${i + 10}`));
    expect(s.calls[1].request.constraints.find(item => item.type === 'after').cursor).toBe(first.nextCursor);
    expect(s.calls.reduce((sum, call) => sum + call.returned, 0)).toBe(22);
    expect(first.posts[0]).toMatchObject({ imageCount: 2, likeCount: 1, commentCount: 3 });
    for (const field of ['images', 'likes', 'content']) expect(first.posts[0]).not.toHaveProperty(field);
});

it.each(['all', 'notice'])('%s는 20개가 넘는 고정공지와 삭제글 사이에서도 일반글 페이지를 채우고 고정을 중복 표시하지 않는다', async category => {
    const pins = Array.from({ length: 25 }, (_, i) => post(`pin-${i}`, 500 - i, { category: 'notice', pinned: true }));
    const live = Array.from({ length: 23 }, (_, i) => post(`live-${i}`, 100 - i, { category: 'notice', deleted: i === 2 ? undefined : false }));
    const deleted = Array.from({ length: 16 }, (_, i) => post(`deleted-${i}`, 150 - i, { category: 'notice', deleted: true }));
    const s = service([...pins, ...live, ...deleted]);
    const first = await s.read(category);
    expect(first.posts.map(item => item.id)).toEqual([...pins.map(item => item.id), ...live.slice(0, 10).map(item => item.id)]);
    const second = await s.read(category, 10, first.nextCursor);
    const third = await s.read(category, 10, second.nextCursor);
    expect(second.posts.map(item => item.id)).toEqual(live.slice(10, 20).map(item => item.id));
    expect(third.posts.map(item => item.id)).toEqual(live.slice(20).map(item => item.id));
    expect(third.hasNextPage).toBe(false);
    expect(third.nextCursor).toBe(null);
    expect(s.calls.filter(call => !call.request.constraints.some(item => item.type === 'limit'))).toHaveLength(1);
});

it('같은 작성시각의 글과 중간에 삭제된 커서 문서도 중복·누락 없이 이어 읽는다', async () => {
    const rows = Array.from({ length: 25 }, (_, i) => post(`id-${String(i).padStart(2, '0')}`, 100));
    const expected = [...rows].sort(byNewest).map(item => item.id);
    const s = service(rows);
    const first = await s.read('free');
    s.setRows(rows.filter(row => row.id !== first.nextCursor.id));
    const second = await s.read('free', 10, first.nextCursor);
    const third = await s.read('free', 10, second.nextCursor);
    expect([...first.posts, ...second.posts, ...third.posts].map(item => item.id)).toEqual(expected);
});

it.each([0, 10, 11])('분류 글 %i개일 때 마지막 페이지를 정확히 판정한다', async count => {
    const s = service(Array.from({ length: count }, (_, i) => post(`id-${i}`, 100 - i)));
    const first = await s.read('free');
    expect(first.posts).toHaveLength(Math.min(10, count));
    expect(first.hasNextPage).toBe(count > 10);
    if (count <= 10) expect(first.nextCursor).toBe(null);
});

it('공지 이외의 pinned 글은 일반글로 남기고 삭제된 고정 공지는 숨긴다', async () => {
    const s = service([post('free-pin', 3, { pinned: true }), post('deleted-pin', 2, { category: 'notice', pinned: true, deleted: true }), post('notice', 1, { category: 'notice', pinned: true })]);
    expect((await s.read()).posts.map(item => item.id)).toEqual(['notice', 'free-pin']);
    expect((await s.read('free')).posts.map(item => item.id)).toEqual(['free-pin']);
});

it('분류 인덱스 오류는 전체조회로 숨기지 않고 재시도 가능한 오류로 전달한다', async () => {
    const s = service([]);
    s.getDocs.mockRejectedValueOnce(new Error('failed-precondition: index required'));
    await expect(s.read('column')).rejects.toThrow('index required');
    expect(s.getDocs).toHaveBeenCalledOnce();
});
