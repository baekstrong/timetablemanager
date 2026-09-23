import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { it, expect, vi } from 'vitest';
it('잠금 조회는 만료 항목을 제외하고 읽기만 한다', async () => {
    const source = readFileSync(new URL('./firebaseService.js', import.meta.url), 'utf8');
    const a = source.indexOf('export const getLockedSlots =');
    const b = source.indexOf('\n};', a) + 3;
    const remove = vi.fn(() => { throw Error('학생 삭제는 금지'); });
    const context = vm.createContext({ db: {}, queryDocs: async () => [
        { id: 'old', date: '2000-01-01', key: '월-1' },
        { id: 'new', date: '2999-01-01', key: '화-2' },
        { id: 'always', key: '수-3' },
    ], firestoreDeleteDoc: remove, console: { log() {}, error() {} } });
    vm.runInContext(source.slice(a, b).replace('export ', ''), context);
    expect(Array.from(await vm.runInContext('getLockedSlots()', context))).toEqual(['화-2', '수-3']);
    expect(remove).not.toHaveBeenCalled();
});
