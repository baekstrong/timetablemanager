// 화면 복귀와 타이머가 겹쳐도 같은 알림을 반복 조회하지 않는다.
export function createVisibleTask(task, minIntervalMs = 60_000) {
    let pending = false;
    let lastStarted = -Infinity;
    return async () => {
        if (document.visibilityState !== 'visible' || pending || Date.now() - lastStarted < minIntervalMs) return;
        pending = true;
        lastStarted = Date.now();
        try { await task(); }
        finally { pending = false; }
    };
}
