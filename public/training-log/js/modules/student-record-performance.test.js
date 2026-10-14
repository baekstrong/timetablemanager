import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { calendarSummary, recentExerciseDays, escapeHTML } from './student-workspace-logic.js';

const read = name => readFileSync(new URL(`./${name}.js`, import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const snapshot = records => { const docs = records.map((data, index) => ({ id: String(data.id ?? index), data: () => data })); return { docs, size: docs.length, forEach: fn => docs.forEach(fn) }; };
const sets = [{ intensity: { value: 50, unit: 'kg' }, reps: { value: 8, unit: '회' } }];
const record = (date, id, userName = 'A') => ({ id, date, userName, exercise: 'squat', sets });
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-14T12:00:00')); });
afterEach(() => vi.useRealTimers());

function referencesHarness(records = []) {
    const calls = [], gates = [];
    function query(filters = [], cursor = null, count = null) {
        return { where: (...condition) => query([...filters, condition], cursor, count), orderBy: () => query(filters, cursor, count), limit: n => query(filters, cursor, n), startAfter: doc => query(filters, doc.id, count),
            get() {
                calls.push({ filters, cursor, count });
                if (gates.length) return gates.shift().promise;
                const all = records.filter(r => filters.every(([key, op, value]) => op === '==' ? r[key] === value : r[key] < value)).sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
                const offset = cursor === null ? 0 : all.findIndex(r => r.id === cursor) + 1;
                return Promise.resolve(snapshot(all.slice(offset, offset + count)));
            } };
    }
    const state = { currentUser: 'A', studentWriteDate: '2026-10-14', isCoach: false };
    const context = vm.createContext({ state, db: { collection: () => query() }, Date, console, localDate: () => '2026-10-14', recentExerciseDays, window: { addEventListener() {} } });
    vm.runInContext(read('student-workspace'), context);
    return { calls, gates, state, run: code => vm.runInContext(code, context) };
}
it('최근 3일의 모든 세트를 페이지 경계에서도 보존하고 그 이전 기록을 끝까지 읽지 않는다', async () => {
    const records = [ ...Array.from({ length: 30 }, (_, i) => record('2026-10-13', `a${i}`)), ...Array.from({ length: 2 }, (_, i) => record('2026-10-12', `b${i}`)), ...Array.from({ length: 29 }, (_, i) => record('2026-10-11', `c${i}`)), ...Array.from({ length: 100 }, (_, i) => record('2026-10-10', `d${i}`)), record('2026-10-14', 'future') ];
    const h = referencesHarness(records);
    const result = await h.run('fetchStudentReferences("A", "squat", "2026-10-14")');
    expect(result.map(r => r.date)).toEqual(['2026-10-13', '2026-10-12', '2026-10-11']);
    expect(result.map(r => r.sets.length)).toEqual([30, 2, 29]);
    expect(h.calls).toHaveLength(3);
    expect(h.calls.every(call => call.count === 24 && call.filters.some(f => f[0] === 'date' && f[1] === '<'))).toBe(true);
});
it('같은 참고 요청을 합류하고 계정과 작성일이 바뀌면 별도 조회한다', async () => {
    const h = referencesHarness([record('2026-10-13', 'one')]);
    const gate = deferred(); h.gates.push(gate);
    const first = h.run('fetchStudentReferences("A", "squat", "2026-10-14")');
    const second = h.run('fetchStudentReferences("A", "squat", "2026-10-14")');
    expect(h.calls).toHaveLength(1);
    gate.resolve(snapshot([record('2026-10-13', 'one')])); await Promise.all([first, second]);
    await h.run('fetchStudentReferences("A", "squat", "2026-10-14")');
    expect(h.calls).toHaveLength(1);
    await h.run('fetchStudentReferences("A", "squat", "2026-10-12")');
    await h.run('fetchStudentReferences("B", "squat", "2026-10-14")');
    expect(h.calls).toHaveLength(3);
});
it('저장 후 무효화된 늦은 응답은 참고 캐시를 되살리지 않는다', async () => {
    const h = referencesHarness([record('2026-10-13', 'fresh')]);
    const gate = deferred(); h.gates.push(gate);
    const old = h.run('fetchStudentReferences("A", "squat", "2026-10-14")');
    h.run('invalidateStudentReferences("A")');
    gate.resolve(snapshot([record('2026-10-12', 'old')]));
    expect(await old).toBeNull();
    expect((await h.run('fetchStudentReferences("A", "squat", "2026-10-14")'))[0].date).toBe('2026-10-13');
    expect(h.calls).toHaveLength(2);
});
it('참고 조회 실패를 무경계 쿼리로 넓히지 않고 다음 시도는 다시 요청한다', async () => {
    const h = referencesHarness(); const gate = deferred(); h.gates.push(gate);
    const result = h.run('fetchStudentReferences("A", "squat", "2026-10-14")').catch(e => e);
    gate.reject(new Error('index unavailable'));
    expect((await result).message).toBe('index unavailable');
    expect(h.calls).toHaveLength(1);
    expect(await h.run('fetchStudentReferences("A", "squat", "2026-10-14")')).toEqual([]);
    expect(h.calls).toHaveLength(2);
});

function calendarHarness() {
    const state = { currentUser: 'A', isCoach: false, calendarYear: 2026, calendarMonth: 9, selectedDate: '2026-10-14' };
    const calendar = { innerHTML: '' }, storage = new Map(), pending = [];
    const query = { where() { return this; }, get() { const gate = deferred(); pending.push(gate); return gate.promise; } };
    const context = vm.createContext({ state, db: { collection: () => query }, Date, console: { error() {} }, localDate: () => '2026-10-14', calendarSummary, escapeHTML, formatDate: s => s, window: {},
        document: { getElementById: id => id === 'calendar' ? calendar : null }, localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } });
    vm.runInContext(read('calendar'), context);
    return { state, calendar, storage, pending, run: code => vm.runInContext(code, context) };
}
it('달력은 네트워크 응답 전 날짜와 확인 중 상태를 표시하고 동시 조회를 공유한다', async () => {
    const h = calendarHarness(); const a = h.run('renderCalendar()'); const b = h.run('renderCalendar(false)');
    expect(h.calendar.innerHTML).toContain('2026-10-14');
    expect(h.calendar.innerHTML).toContain('운동 기록 확인 중');
    expect(h.calendar.innerHTML).toContain('<strong>—');
    expect(h.pending).toHaveLength(1);
    h.pending[0].resolve(snapshot([record('2026-10-13', 'one')])); await Promise.all([a, b]);
    expect(h.calendar.innerHTML).toContain('has-record');
    expect(h.calendar.innerHTML).not.toContain('기록 확인 중');
});
it('동일 계정의 마지막 날짜 요약만 미리 표시하고 실패 때 오래된 표시임을 알린다', async () => {
    const h = calendarHarness();
    h.storage.set('trainingCalendar_v1_A_2026-10', JSON.stringify({ at: Date.now(), dates: ['2026-10-13'], feedbackDates: [] }));
    const first = h.run('renderCalendar()');
    expect(h.calendar.innerHTML).toContain('마지막 확인 기록');
    h.pending[0].reject(new Error('offline')); await first;
    expect(h.calendar.innerHTML).toContain('새 기록을 확인하지 못했어요');
    h.state.currentUser = 'B'; const second = h.run('renderCalendar()');
    expect(h.calendar.innerHTML).not.toContain('마지막 확인 기록');
    expect(h.calendar.innerHTML).toContain('<strong>—');
    h.pending[1].resolve(snapshot([])); await second;
});
it('월 이동과 쓰기 무효화 뒤 늦은 달력 응답을 표시하거나 저장하지 않는다', async () => {
    const h = calendarHarness(); const old = h.run('renderCalendar()');
    h.run('invalidateStudentCalendar("2026-10-13")');
    h.state.calendarMonth = 8; const current = h.run('renderCalendar()');
    h.pending[1].resolve(snapshot([record('2026-09-12', 'new')])); await current;
    h.pending[0].resolve(snapshot([record('2026-10-12', 'old')])); await old;
    expect(h.calendar.innerHTML).toContain('2026년 9월');
    expect(h.storage.has('trainingCalendar_v1_A_2026-10')).toBe(false);
});

function oneRMHarness() {
    const state = { currentUser: 'A' }, pending = [], chip = { innerHTML: '' };
    const context = vm.createContext({ state, db: { collection: () => ({ doc: user => ({ get() { const gate = deferred(); pending.push({ user, ...gate }); return gate.promise; } }) }) }, console: { error() {} },
        document: { getElementById: id => id === 'exercise' ? { value: 'squat' } : id === 'oneRMQuickCard' ? chip : null } });
    vm.runInContext(read('onerm'), context);
    return { state, chip, pending, run: code => vm.runInContext(code, context) };
}
it('첫 1RM 칩 호출 둘은 문서 요청 한 개를 공유한다', async () => {
    const h = oneRMHarness(); const a = h.run('renderOneRMChip()'); const b = h.run('renderOneRMChip()');
    expect(h.pending).toHaveLength(1);
    h.pending[0].resolve({ exists: true, data: () => ({ map: { squat: { oneRM: 100 } } }) }); await Promise.all([a, b]);
    expect(h.chip.innerHTML).toContain('100kg');
});
it('다른 계정의 늦은 1RM 응답과 저장 전 응답이 최신 칩을 덮지 않는다', async () => {
    const h = oneRMHarness(); const old = h.run('renderOneRMChip()');
    h.state.currentUser = 'B'; const current = h.run('renderOneRMChip()');
    h.pending[1].resolve({ exists: true, data: () => ({ map: { squat: { oneRM: 80 } } }) }); await current;
    h.pending[0].resolve({ exists: true, data: () => ({ map: { squat: { oneRM: 100 } } }) }); await old;
    expect(h.chip.innerHTML).toContain('80kg');
    expect(h.chip.innerHTML).not.toContain('100kg');
    h.run('rememberOneRMMap("B", null)'); const pending = h.run('renderOneRMChip()');
    h.run('rememberOneRMMap("B", {squat: {oneRM: 90}})'); await h.run('renderOneRMChip()');
    h.pending[2].resolve({ exists: false }); await pending;
    expect(h.chip.innerHTML).toContain('90kg');
});
