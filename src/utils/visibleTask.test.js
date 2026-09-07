import { afterEach, it, expect, vi } from 'vitest';
import { createVisibleTask } from './visibleTask';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('빠른 복귀·진행 중 호출을 합치고 숨겨진 탭은 조회하지 않는다', async () => {
    vi.useFakeTimers();
    const document = { visibilityState: 'visible' };
    vi.stubGlobal('document', document);
    let finish;
    const task = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    const check = createVisibleTask(task);
    const first = check();
    await check();
    await vi.advanceTimersByTimeAsync(61_000);
    await check();
    expect(task).toHaveBeenCalledTimes(1);
    finish(); await first;
    document.visibilityState = 'hidden'; await check();
    expect(task).toHaveBeenCalledTimes(1);
    document.visibilityState = 'visible';
    const second = check();
    finish(); await second;
    await check();
    expect(task).toHaveBeenCalledTimes(2);
});
