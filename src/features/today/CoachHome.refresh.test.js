import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { afterEach, expect, it, vi } from 'vitest';
import { createVisibleTask } from '../../utils/visibleTask';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('코치홈 실제 복귀 이벤트는 60초·진행 중 중복을 막고 최신 refresh 함수를 사용한다', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-14T09:00:00'));
    const listeners = new Map();
    const document = {
        visibilityState: 'visible', hidden: false,
        addEventListener: (name, handler) => listeners.set(name, handler),
        removeEventListener: (name, handler) => { if (listeners.get(name) === handler) listeners.delete(name); },
    };
    vi.stubGlobal('document', document);
    let finish;
    const refresh = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    const refreshRef = { current: refresh };
    let cleanup;
    const context = vm.createContext({
        useEffect: effect => { cleanup = effect(); }, document, Date, setInterval, clearInterval,
        createVisibleTask, refreshRef, readCoachNotes: vi.fn().mockResolvedValue({}),
        setNotes: vi.fn(), setNotesReady: vi.fn(), setError: vi.fn(), setNow: vi.fn(),
    });
    // 실제 컴포넌트의 mount effect를 실행한다. 읽기/쓰기 서비스 및 DOM은 대체한다.
    const source = readFileSync(new URL('./CoachHome.jsx', import.meta.url), 'utf8');
    const start = source.indexOf('useEffect(() => {\n        let alive');
    const end = source.indexOf('}, []);', start) + '}, []);'.length;
    vm.runInContext(source.slice(start, end), context);
    const visible = () => listeners.get('visibilitychange')?.();

    visible(); visible();
    expect(refresh).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(61_000);
    visible();
    expect(refresh).toHaveBeenCalledOnce(); // 60초가 지나도 이전 요청이 진행 중이면 합친다.
    finish(); await vi.advanceTimersByTimeAsync(0);
    const latestRefresh = vi.fn().mockResolvedValue(undefined);
    refreshRef.current = latestRefresh;
    visible(); await vi.advanceTimersByTimeAsync(0);
    visible();
    expect(latestRefresh).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(59_999); visible();
    expect(latestRefresh).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    document.hidden = true; document.visibilityState = 'hidden'; visible();
    expect(latestRefresh).toHaveBeenCalledOnce();
    document.hidden = false; document.visibilityState = 'visible'; visible();
    expect(latestRefresh).toHaveBeenCalledTimes(2);
    cleanup();
    expect(listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
});
