import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { expect, it, vi } from 'vitest';

function harness(readPage) {
    const slots = [];
    let cursor = 0, effects = [];
    const context = vm.createContext({
        getPostsPage: readPage, POST_LIMITS: { PAGE_SIZE: 10 }, console: { error() {} },
        useState(initial) {
            const i = cursor++;
            if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
            return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }];
        },
        useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
        useEffect(work, deps) {
            const i = cursor++, previous = slots[i];
            if (!previous || deps.some((value, index) => !Object.is(value, previous.deps[index]))) {
                effects.push(() => { previous?.cleanup?.(); slots[i] = { deps, cleanup: work() }; });
            }
        },
    });
    const source = readFileSync(new URL('./useBoardPosts.js', import.meta.url), 'utf8');
    vm.runInContext(source.slice(source.indexOf('export function')).replace('export ', ''), context);
    const render = () => { cursor = 0; effects = []; const view = vm.runInContext('useBoardPosts()', context); effects.forEach(work => work()); return view; };
    return { render, settle: async () => { await nextTurn(); return render(); }, unmount: () => slots.forEach(slot => slot?.cleanup?.()) };
}
const data = (id, nextCursor = null) => ({ posts: [{ id }], nextCursor, hasNextPage: Boolean(nextCursor) });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

it('페이지 이동에는 저장한 문서 커서를 사용하고 분류 변경 즉시 이전 목록을 감춘다', async () => {
    const reader = vi.fn().mockResolvedValueOnce(data('all-first', 'all-cursor')).mockResolvedValueOnce(data('all-second')).mockResolvedValueOnce(data('free-first', 'free-cursor'));
    const h = harness(reader);
    expect(h.render().loading).toBe(true);
    let view = await h.settle(); expect(view.posts[0].id).toBe('all-first');
    view.setPage(2); view = h.render(); expect(view.posts).toEqual([]);
    view = await h.settle(); expect(view.posts[0].id).toBe('all-second');
    expect(reader).toHaveBeenNthCalledWith(2, 'all', 10, 'all-cursor');
    view.setCategory('free'); view = h.render();
    expect(view.page).toBe(1); expect(view.posts).toEqual([]); expect(view.loading).toBe(true);
    view = await h.settle(); expect(view.posts[0].id).toBe('free-first');
    expect(reader).toHaveBeenNthCalledWith(3, 'free', 10, null);
});

it('늦게 끝난 이전 분류 요청이 새 목록이나 다음 페이지 커서를 덮어쓰지 않는다', async () => {
    const old = deferred();
    const reader = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce(data('free-first', 'free-cursor')).mockResolvedValueOnce(data('free-second'));
    const h = harness(reader);
    h.render().setCategory('free'); h.render();
    let view = await h.settle();
    old.resolve(data('old', 'wrong-cursor')); view = await h.settle();
    expect(view.posts[0].id).toBe('free-first');
    view.setPage(2); h.render(); view = await h.settle();
    expect(reader).toHaveBeenLastCalledWith('free', 10, 'free-cursor');
    expect(view.posts[0].id).toBe('free-second');
});

it('작성·수정 후 첫 페이지 갱신은 한 번만 읽고 이전 분류 커서를 재사용하지 않는다', async () => {
    const reader = vi.fn().mockResolvedValueOnce(data('one', 'cursor')).mockResolvedValueOnce(data('two')).mockResolvedValueOnce(data('new', 'new-cursor'));
    const h = harness(reader);
    h.render(); let view = await h.settle();
    view.setPage(2); h.render(); view = await h.settle();
    view.refresh({ firstPage: true }); view = h.render();
    expect(view.page).toBe(1); expect(view.loading).toBe(true);
    view = await h.settle(); await h.settle();
    expect(view.posts[0].id).toBe('new');
    expect(reader).toHaveBeenCalledTimes(3);
    expect(reader).toHaveBeenLastCalledWith('all', 10, null);
});

it('마지막 페이지 삭제 후에는 커서를 다시 만들고 마지막 유효 페이지를 추가 중복조회 없이 표시한다', async () => {
    const reader = vi.fn().mockResolvedValueOnce(data('one', 'cursor')).mockResolvedValueOnce(data('last')).mockResolvedValueOnce(data('one-updated'));
    const h = harness(reader);
    h.render(); let view = await h.settle();
    view.setPage(2); h.render(); view = await h.settle();
    view.refresh(); h.render(); view = await h.settle();
    expect(view.page).toBe(1); expect(view.posts[0].id).toBe('one-updated');
    expect(view.hasNextPage).toBe(false);
    await h.settle(); expect(reader).toHaveBeenCalledTimes(3);
});

it('상세 복귀 갱신은 현재 페이지의 좋아요·댓글 최신 자료를 읽는다', async () => {
    const reader = vi.fn().mockResolvedValueOnce(data('one', 'cursor')).mockResolvedValueOnce(data('two'))
        .mockResolvedValueOnce(data('one', 'fresh-cursor')).mockResolvedValueOnce({ ...data('two'), posts: [{ id: 'two', likeCount: 2, commentCount: 3 }] });
    const h = harness(reader);
    h.render(); let view = await h.settle();
    view.setPage(2); h.render(); view = await h.settle();
    view.refresh(); h.render(); view = await h.settle();
    expect(view.page).toBe(2); expect(view.posts[0]).toMatchObject({ likeCount: 2, commentCount: 3 });
    expect(reader).toHaveBeenLastCalledWith('all', 10, 'fresh-cursor');
});

it('실패는 빈 게시판으로 보이지 않으며 재시도는 새 커서로 복구한다', async () => {
    const reader = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(data('recovered'));
    const h = harness(reader);
    h.render(); let view = await h.settle();
    expect(view.loading).toBe(false); expect(view.error).toContain('불러오지 못했습니다');
    view.refresh(); h.render(); view = await h.settle();
    expect(view.error).toBe(null); expect(view.posts[0].id).toBe('recovered');
});

it('삭제 후 마지막 페이지 보정이 분류 전환 이벤트와 겹쳐도 새 분류의 1페이지를 유지한다', async () => {
    const last = deferred();
    const reader = vi.fn().mockResolvedValueOnce(data('one', 'a')).mockResolvedValueOnce(data('two', 'b')).mockResolvedValueOnce(data('three'))
        .mockResolvedValueOnce(data('one', 'fresh-a')).mockReturnValueOnce(last.promise).mockResolvedValueOnce(data('free-first'));
    const h = harness(reader);
    h.render(); let view = await h.settle();
    view.setPage(3); h.render(); view = await h.settle();
    view.refresh(); h.render(); view = await h.settle();
    view.setCategory('free'); // React가 새 effect를 정리하기 직전 이전 응답이 끝나는 상황.
    last.resolve(data('last-valid-two')); view = await h.settle();
    expect(view.category).toBe('free'); expect(view.page).toBe(1);
    view = await h.settle();
    expect(view.posts[0].id).toBe('free-first');
    expect(reader).toHaveBeenLastCalledWith('free', 10, null);
});
