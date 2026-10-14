import { afterEach, it, expect, vi } from 'vitest';
import { createMonthlySummaryClient } from './monthlySummary.js';
const data = { month: '2026-09', generatedAt: '2026-10-14T00:00:00Z', students: [] };
const response = (body = data, status = 200) => ({ ok: status === 200, status, json: async () => body });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
afterEach(() => vi.useRealTimers());

it('shares only concurrent requests for the same authenticated session and month', async () => {
    const pending = deferred(); let session = 'A';
    const fetchImpl = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(response());
    const getToken = vi.fn(async () => 'fixture-token');
    const load = createMonthlySummaryClient({ getToken, getSessionKey: () => session, endpoint: '/analytics/monthly', fetchImpl });
    const a = load('2026-09'); const b = load('2026-09'); await Promise.resolve();
    expect(fetchImpl).toHaveBeenCalledTimes(1); pending.resolve(response()); await Promise.all([a, b]);
    session = 'B'; await load('2026-09', { refresh: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2); expect(fetchImpl.mock.calls[1][0]).toContain('refresh=1');
    session = ''; await expect(load('2026-09')).rejects.toThrow('로그인');
});

it('rejects old-session results and clears failed inflight requests for retry', async () => {
    let session = 'A'; const pending = deferred();
    const fetchImpl = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(response());
    const load = createMonthlySummaryClient({ getToken: async () => 'token', getSessionKey: () => session, endpoint: '/summary', fetchImpl });
    const old = load('2026-09'); await Promise.resolve(); session = 'B';
    pending.resolve(response()); await expect(old).rejects.toThrow('계정');
    await expect(load('2026-09')).resolves.toEqual(data);
});

it('does not issue a late fetch after token restoration times out', async () => {
    vi.useFakeTimers(); const token = deferred(); const fetchImpl = vi.fn();
    const load = createMonthlySummaryClient({ getToken: () => token.promise, getSessionKey: () => 'A', endpoint: '/summary', fetchImpl, timeoutMs: 100 });
    const result = expect(load('2026-09')).rejects.toThrow('늦어지고');
    await vi.advanceTimersByTimeAsync(101); await result; token.resolve('token'); await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).not.toHaveBeenCalled();
});

it('rejects bad month, server errors and incomplete aggregate rows instead of treating them as no activity', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(response({ error: 'backend detail' }, 503))
        .mockResolvedValueOnce(response({ ...data, students: [{ userName: 'A' }] })).mockResolvedValue(response());
    const load = createMonthlySummaryClient({ getToken: async () => 'token', getSessionKey: () => 'A', endpoint: '/summary', fetchImpl });
    await expect(load('2026-13')).rejects.toThrow('월 형식'); expect(fetchImpl).not.toHaveBeenCalled();
    await expect(load('2026-09')).rejects.toThrow('불러오지'); await expect(load('2026-09')).rejects.toThrow('응답');
    await expect(load('2026-09')).resolves.toEqual(data);
});
