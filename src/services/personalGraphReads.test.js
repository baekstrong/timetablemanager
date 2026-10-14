import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const record = (id, userName, date, sets = []) => ({ id, userName, date, sets });
function service(records = [], connected = true) {
    const read = vi.fn(async (collection, ...filters) => records.filter(row => filters.every(([key, op, value]) => op === '==' ? row[key] === value : row[key] >= value)));
    const context = vm.createContext({ Date, queryDocs: read, where: (...filter) => filter,
        assertFirebase: () => { if (!connected) throw new Error('Firebase 연결 실패'); },
        dedupeDocsById: rows => [...new Map(rows.map(row => [row.id, row])).values()],
        numVal: value => parseFloat(value) || 0,
    });
    const source = readFileSync(new URL('./firebaseService.js', import.meta.url), 'utf8');
    const start = source.indexOf('const personalGraphInflight =');
    const end = source.indexOf('\n};', source.indexOf('export const getRecordsByUserSince =', start)) + 3;
    const monthly = source.indexOf('export const getMonthlyAttendanceHistory =');
    vm.runInContext(source.slice(start, end).replaceAll('export ', '') + source.slice(monthly, source.indexOf('\n};', monthly) + 3).replace('export ', ''), context);
    return { read, run(name, ...args) { context.args = args; return vm.runInContext(`${name}(...args)`, context); } };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-14T12:00:00')); });
afterEach(() => vi.useRealTimers());

it('기록이 없는 학생도 본인 이름과 시작일 조건 한 번만 읽으며 다른 학생 기록을 읽지 않는다', async () => {
    const h = service([record('other', '다른 학생', '2026-10-13')]);
    expect(await h.run('getRecordsByUserSince', '신규 학생', '2026-07-01')).toEqual([]);
    expect(h.read).toHaveBeenCalledExactlyOnceWith('records', ['userName', '==', '신규 학생'], ['date', '>=', '2026-07-01']);
});

it('입력 trim과 대소문자/입력 원문 호환 후보도 본인 이름+기간으로만 조회한다', async () => {
    const h = service([record('lower', 'sample', '2026-10-12'), record('raw', ' SAMPLE ', '2026-10-11'), record('old', 'sample', '2025-01-01')]);
    const result = await h.run('getRecordsByUserSince', ' SAMPLE ', '2026-07-01');
    expect(result.map(row => row.id)).toEqual(['raw', 'lower']);
    expect(h.read.mock.calls.every(([, ...filters]) => filters.length === 2 && filters[0][0] === 'userName' && filters[1][0] === 'date')).toBe(true);
    expect(h.read.mock.calls.length).toBeLessThanOrEqual(6);
});

it('정확 일치 기록이 있으면 호환 후보 조회를 생략한다', async () => {
    const h = service([record('exact', 'Sample', '2026-10-12'), record('alias', 'sample', '2026-10-11')]);
    expect((await h.run('getRecordsByUserSince', 'Sample', '2026-07-01')).map(row => row.id)).toEqual(['exact']);
    expect(h.read).toHaveBeenCalledOnce();
});

it.each(['failed-precondition', 'unavailable', 'permission-denied'])('%s 오류는 전 기간 조회나 정상 빈 결과로 바꾸지 않고 재시도한다', async code => {
    const h = service([record('new', '시험 학생', '2026-10-12')]);
    const error = Object.assign(new Error(code), { code });
    h.read.mockRejectedValueOnce(error);
    await expect(h.run('getRecordsByUserSince', '시험 학생', '2026-07-01')).rejects.toBe(error);
    expect(h.read).toHaveBeenCalledOnce();
    expect((await h.run('getRecordsByUserSince', '시험 학생', '2026-07-01')).map(row => row.id)).toEqual(['new']);
    expect(h.read).toHaveBeenCalledTimes(2);
});

it('같은 계정·기간의 진행 중 조회만 공유하고 다음 조회와 다른 계정은 독립적이다', async () => {
    const h = service(); const gate = deferred();
    h.read.mockReturnValueOnce(gate.promise);
    const first = h.run('getRecordsByUserSince', 'A', '2026-07-01');
    const second = h.run('getRecordsByUserSince', 'A', '2026-07-01');
    expect(h.read).toHaveBeenCalledOnce();
    gate.resolve([record('one', 'A', '2026-10-12')]); await Promise.all([first, second]);
    await h.run('getRecordsByUserSince', 'A', '2026-07-01');
    await h.run('getRecordsByUserSince', 'B', '2026-07-01');
    expect(h.read.mock.calls.filter(([, filter]) => filter[2] === 'A')).toHaveLength(2);
    expect(h.read.mock.calls.some(([, filter]) => filter[2] === 'B')).toBe(true);
});

it('월별 그래프는 범위 쿼리 결과로 출석일을 중복 제거하고 kg×회 운동량과 빈 달을 보존한다', async () => {
    const sets = [{ intensity: { value: '20', unit: 'kg' }, reps: { value: '5', unit: '회' } }, { intensity: { value: 30, unit: '초' }, reps: { value: 2, unit: '회' } }];
    const h = service([record('one', '시험 학생', '2026-10-12', sets), record('two', '시험 학생', '2026-10-12', sets), record('bad', '시험 학생', '2026-09-01', null), record('old', '시험 학생', '2026-07-31', sets)]);
    expect(await h.run('getMonthlyAttendanceHistory', '시험 학생', 3)).toEqual([
        { month: '2026-08', trainingDays: 0, volume: 0 },
        { month: '2026-09', trainingDays: 1, volume: 0 },
        { month: '2026-10', trainingDays: 1, volume: 200 },
    ]);
    expect(h.read).toHaveBeenCalledExactlyOnceWith('records', ['userName', '==', '시험 학생'], ['date', '>=', '2026-08-01']);
});

it('월별 조회 실패와 Firebase 미연결은 기록 없음으로 반환하지 않는다', async () => {
    const h = service(); h.read.mockRejectedValueOnce(new Error('offline'));
    await expect(h.run('getMonthlyAttendanceHistory', '시험 학생')).rejects.toThrow('offline');
    expect(h.read).toHaveBeenCalledOnce();
    await expect(service([], false).run('getMonthlyAttendanceHistory', '시험 학생')).rejects.toThrow('연결');
});
