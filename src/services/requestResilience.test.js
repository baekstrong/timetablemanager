import { beforeEach, afterEach, it, expect, vi } from 'vitest';

const sheet = '등록생 목록(26년9월)';
const response = (data, status = 200) => ({ status, json: async () => data });
let service;
beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 7));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    service = await import('./googleSheetsService');
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('응답이 없는 조회는 전체 20초에 종료하고 재시도를 이어가지 않는다', async () => {
    const fetch = vi.fn((_, { signal }) => new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(Object.assign(new Error('abort'), { name: 'AbortError' })));
    }));
    vi.stubGlobal('fetch', fetch);
    const result = service.readSheetData('test!A:R').catch(e => e);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await result).toBeInstanceOf(Error);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
});

it('할당량 오류는 최대 3회이며 짧은 재시도 후 복구할 수 있다', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response({ error: 'quota' }, 429))
        .mockResolvedValue(response({ success: true, values: [['ok']] }));
    vi.stubGlobal('fetch', fetch);
    const result = service.readSheetData('test!A:R');
    await vi.runAllTimersAsync();
    expect(await result).toEqual([['ok']]);
    expect(fetch).toHaveBeenCalledTimes(2);
    fetch.mockReset().mockResolvedValue(response({ error: 'quota' }, 429));
    const failed = service.readSheetData('test!A:R').catch(e => e);
    await vi.runAllTimersAsync();
    expect(await failed).toBeInstanceOf(Error);
    expect(fetch).toHaveBeenCalledTimes(3);
});

it('쓰기 응답 유실은 자동 재전송하지 않는다', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('network'));
    vi.stubGlobal('fetch', fetch);
    await expect(service.writeSheetData('test!A1', [['value']])).rejects.toThrow('network');
    expect(fetch).toHaveBeenCalledTimes(1);
});

it('배치 실패를 월별 read 요청으로 확대하지 않는다', async () => {
    const fetch = vi.fn(async url => String(url).endsWith('/info')
        ? response({ success: true, sheets: [sheet] }) : response({ error: 'unavailable' }, 503));
    vi.stubGlobal('fetch', fetch);
    await expect(service.getAllStudentsFromAllSheets()).rejects.toThrow('unavailable');
    expect(fetch.mock.calls.some(([url]) => String(url).includes('/read?'))).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
});

it('존재하지 않는 미래 월은 제외하고 정상 빈 시트는 재조회하지 않는다', async () => {
    const fetch = vi.fn(async (url, options) => {
        if (String(url).endsWith('/info')) return response({ success: true, sheets: [sheet] });
        expect(JSON.parse(options.body).ranges).toEqual([`${sheet}!A:R`]);
        return response({ success: true, valueRanges: [{ range: `${sheet}!A:R` }] });
    });
    vi.stubGlobal('fetch', fetch);
    expect(await service.findStudentAcrossSheets('synthetic', { requireActive: false })).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
});

it('쓰기 이전에 시작된 응답이 새 시트 캐시를 덮어쓰지 않는다', async () => {
    let finishOld;
    let batchCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async url => {
        if (String(url).endsWith('/info')) return response({ success: true, sheets: [sheet] });
        batchCalls++;
        if (batchCalls === 1) return new Promise(resolve => { finishOld = resolve; });
        return response({ success: true, valueRanges: [{ values: [[], ['이름'], ['new']] }] });
    }));
    const old = service.getAllStudents(2026, 9);
    await vi.advanceTimersByTimeAsync(0);
    service.invalidateStudentSheetCache();
    const latest = await service.getAllStudents(2026, 9);
    finishOld(response({ success: true, valueRanges: [{ values: [[], ['이름'], ['old']] }] }));
    expect((await old)[0]['이름']).toBe('new');
    expect(latest[0]['이름']).toBe('new');
    expect((await service.getAllStudents(2026, 9))[0]['이름']).toBe('new');
    expect(batchCalls).toBe(2);
});
