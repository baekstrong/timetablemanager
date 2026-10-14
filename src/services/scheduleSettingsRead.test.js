import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { afterEach, expect, it, vi } from 'vitest';

// 실제 조회 함수를 실행하되 Firestore 전송만 대체한다. 운영 연결/쓰기는 없다.
function settingsService({ connected = true, docs = [], error } = {}) {
    const queryDocs = vi.fn(async () => { if (error) throw error; return docs; });
    const context = vm.createContext({ db: connected ? {} : null, queryDocs, Date, console: { log() {}, error() {} } });
    const source = readFileSync(new URL('./firebaseService.js', import.meta.url), 'utf8');
    for (const [name, next] of [['getDisabledClasses', 'toggleDisabledClass'], ['getLockedSlots', 'toggleLockedSlot']]) {
        const body = source.slice(source.indexOf(`export const ${name} =`), source.indexOf(`export const ${next} =`)).replace('export ', '');
        vm.runInContext(body, context);
    }
    return { queryDocs, read: (name, options) => { context.options = options; return vm.runInContext(`${name}(options)`, context); } };
}

afterEach(() => vi.useRealTimers());

it.each(['getDisabledClasses', 'getLockedSlots'])('%s는 strict 조회 실패를 빈 설정으로 바꾸지 않고 기존 호출은 유지한다', async name => {
    const service = settingsService({ error: new Error('offline') });
    await expect(service.read(name, { strict: true })).rejects.toThrow('offline');
    await expect(service.read(name)).resolves.toEqual([]);
});

it.each(['getDisabledClasses', 'getLockedSlots'])('%s는 연결 없음과 정상 빈 설정을 구별한다', async name => {
    const offline = settingsService({ connected: false });
    await expect(offline.read(name, { strict: true })).rejects.toThrow('연결');
    await expect(offline.read(name)).resolves.toEqual([]);
    expect(offline.queryDocs).not.toHaveBeenCalled();
    await expect(settingsService().read(name, { strict: true })).resolves.toEqual([]);
});

it('strict 잠금 조회도 만료 항목만 제외하며 날짜 없는 기존 잠금을 보존한다', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-14T09:00:00'));
    const service = settingsService({ docs: [{ key: '월-1', date: '2026-10-13' }, { key: '수-2', date: '2026-10-14' }, { key: '금-3' }] });
    await expect(service.read('getLockedSlots', { strict: true })).resolves.toEqual(['수-2', '금-3']);
});
