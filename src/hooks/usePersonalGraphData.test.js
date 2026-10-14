import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ slots: [], cursor: 0, effects: [] }));
vi.mock('react', () => ({
    useState(initial) {
        const index = hooks.cursor++;
        if (!(index in hooks.slots)) hooks.slots[index] = initial;
        return [hooks.slots[index], next => { hooks.slots[index] = typeof next === 'function' ? next(hooks.slots[index]) : next; }];
    },
    useEffectEvent: callback => callback,
    useEffect(callback, deps) {
        const index = hooks.cursor++;
        const previous = hooks.slots[index];
        if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
            hooks.effects.push(() => { previous?.cleanup?.(); hooks.slots[index] = { deps, cleanup: callback() }; });
        }
    },
}));
import { usePersonalGraphData } from './usePersonalGraphData';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
function render(key, load) {
    hooks.cursor = 0; hooks.effects = [];
    // This test harness provides the hook state/effect lifecycle without a DOM.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const result = usePersonalGraphData(key, load);
    hooks.effects.forEach(effect => effect());
    return result;
}
beforeEach(() => { hooks.slots = []; });
afterEach(() => { hooks.slots.forEach(slot => slot?.cleanup?.()); });

it('계정 전환 첫 렌더부터 이전 계정 기록을 숨기고 늦은 이전 응답도 무시한다', async () => {
    const first = deferred(), second = deferred();
    const a = vi.fn(() => first.promise), b = vi.fn(() => second.promise);
    expect(render('A', a).loading).toBe(true); await flush();
    expect(render('B', b).data).toEqual([]); await flush();
    second.resolve(['B record']); await flush();
    expect(render('B', b).data).toEqual(['B record']);
    first.resolve(['A record']); await flush();
    expect(render('B', b).data).toEqual(['B record']);
    expect(a).toHaveBeenCalledOnce(); expect(b).toHaveBeenCalledOnce();
});

it('성공한 계정에서 새 계정·기간으로 바꿀 때 기존 자료를 보여주지 않는다', async () => {
    const a = vi.fn(async () => ['old']);
    render('A:3', a); await flush(); expect(render('A:3', a).data).toEqual(['old']);
    const b = vi.fn(() => new Promise(() => {}));
    const next = render('A:12', b);
    expect(next.loading).toBe(true); expect(next.data).toEqual([]);
});

it('실패는 오류로 남고 재시도는 새 요청을 보내며 정상 빈 결과만 기록 없음으로 처리한다', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([]);
    render('A', load); await flush();
    const failed = render('A', load);
    expect(failed.loading).toBe(false); expect(failed.error).not.toBe('');
    failed.retry();
    expect(render('A', load).loading).toBe(true); await flush();
    const recovered = render('A', load);
    expect(recovered).toMatchObject({ data: [], error: '', loading: false });
    expect(load).toHaveBeenCalledTimes(2);
});

it('이름이 없거나 화면을 떠난 경우 조회하거나 늦은 결과를 적용하지 않는다', async () => {
    const load = vi.fn(async () => ['late']);
    expect(render('', load).loading).toBe(false); await flush(); expect(load).not.toHaveBeenCalled();
    const gate = deferred(); load.mockReturnValueOnce(gate.promise);
    render('A', load); await flush();
    expect(render('', load).data).toEqual([]);
    gate.resolve(['late']); await flush();
    expect(render('', load).data).toEqual([]);
});
