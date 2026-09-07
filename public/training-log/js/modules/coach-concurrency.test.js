import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { it, expect } from 'vitest';

// DOM과 DB만 모의 처리하고 실제 coach.js 전체를 실행한다. 운영 Firebase 접근 없음.
function harness() {
    const pending = [];
    const container = { style: {}, innerHTML: '' };
    const state = { selectedStudents: ['A'], unsubscribe: null, selectedDate: '2026-09-07', pinnedMemoFilter: false };
    const active = new Set();
    const db = { collection(collection) {
        const filters = [];
        return {
            where(...args) { filters.push(args); return this; },
            doc(name) { filters.push(['doc', name]); return this; },
            orderBy() { return this; }, limit() { return this; },
            get() { return new Promise((resolve, reject) => pending.push({ collection, filters, resolve, reject })); },
            onSnapshot() { const token = {}; active.add(token); return () => active.delete(token); },
        };
    } };
    const context = vm.createContext({ state, db, firebaseInitialized: true, window: {}, console,
        document: { getElementById: id => id === 'allRecordsList' ? container : null },
        debounce: fn => fn, groupSessionsByDate: () => ({ dates: [], byDate: {} }), defaultSessionDate: () => '',
    });
    const source = readFileSync(new URL('./coach.js', import.meta.url), 'utf8')
        .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
    vm.runInContext(source, context);
    vm.runInContext('renderCoachSessionBlock = name => name', context);
    const run = code => vm.runInContext(code, context);
    return { run, pending, state, container, active };
}
const empty = { forEach() {} };

it('수정 모듈의 import와 preload가 같은 버전 URL을 사용한다', () => {
    const main = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
    for (const module of ['coach', 'auth']) {
        const path = main.match(new RegExp(`from '\\./(modules/${module}\\.js\\?[^']+)'`))[1];
        expect(html).toContain(`href="js/${path}"`);
    }
    expect(html).toMatch(/src="js\/main\.js\?v=/);
});

it('A→A+B 선택에서 A의 진행 중 조회를 공유한다', async () => {
    const h = harness();
    h.run('loadPinnedMemosForSelectedStudents = async () => {}');
    const first = h.run('renderCoachSessionView()');
    h.state.selectedStudents = ['A', 'B'];
    const second = h.run('renderCoachSessionView()');
    expect(h.pending.map(p => p.filters[0][2])).toEqual(['A', 'B']);
    h.pending.forEach(p => p.resolve(empty));
    await Promise.all([first, second]);
    expect(h.container.innerHTML).toBe('AB');
});

it('늦게 도착한 A 응답은 현재 B 화면을 덮어쓰지 않는다', async () => {
    const h = harness();
    h.run('loadPinnedMemosForSelectedStudents = async () => {}');
    const first = h.run('renderCoachSessionView()');
    h.state.selectedStudents = ['B'];
    const second = h.run('renderCoachSessionView()');
    h.pending[1].resolve(empty); await second;
    expect(h.container.innerHTML).toBe('B');
    h.pending[0].resolve(empty); await first;
    expect(h.container.innerHTML).toBe('B');
});

it('기록 쿼리 실패를 개인 전 기간 조회로 확대하지 않는다', async () => {
    const h = harness();
    const result = h.run('fetchSessions("A", 14)').catch(e => e);
    h.pending[0].reject(new Error('unavailable'));
    expect(await result).toBeInstanceOf(Error);
    expect(h.pending).toHaveLength(1);
});

it('선택 학생 메모의 진행 중 조회도 공유한다', async () => {
    const h = harness();
    const a = h.run('loadPinnedMemosForSelectedStudents()');
    const b = h.run('loadPinnedMemosForSelectedStudents()');
    expect(h.pending).toHaveLength(2); // 학생 문서 + 코치 문서
    h.pending.forEach(p => p.resolve({ exists: false }));
    await Promise.all([a, b]);
    await h.run('loadPinnedMemosForSelectedStudents()');
    expect(h.pending).toHaveLength(2);
});

it('구형 기록 보기 요청이 겹쳐도 마지막 구독만 설치한다', async () => {
    const h = harness();
    h.state.pinnedMemoFilter = true;
    const a = h.run('loadAllRecords()');
    const b = h.run('loadAllRecords()');
    h.pending.forEach(p => p.resolve({ exists: false }));
    await Promise.all([a, b]);
    expect(h.active.size).toBe(1);
    h.state.unsubscribe();
    expect(h.active.size).toBe(0);
});
