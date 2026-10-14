import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { STAMP_GRADES, STAMP_ORDER, prevMonthRange, suggestGrade, computeStampStats } from './stamp-logic.js';

const source = readFileSync(new URL('./stamp.js', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const snapshot = rows => ({ forEach: fn => rows.forEach(([id, value]) => fn({ id, data: () => value })) });
const summary = (name = '학생', extra = {}) => ({ month: '2026-09', students: [{ userName: name, trainingDays: 7, totalExercises: 9, ...extra }] });

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-14T12:00:00')); });
afterEach(() => vi.useRealTimers());

function harness() {
    const state = { currentUser: '코치A', isCoach: true };
    const auth = { currentUser: { uid: 'uid-A', getIdToken: async () => 'fixture-token' } };
    const calls = [], summaryCalls = [], summaryGates = [], memoGates = [], writes = [], stamps = [];
    let elements = new Map();
    function element(id, hidden = false) {
        const classes = new Set(hidden ? ['hidden'] : []);
        let html = '';
        const item = { id, disabled: false, textContent: '', attributes: {},
            classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c), toggle(c) { if (classes.has(c)) { classes.delete(c); return false; } classes.add(c); return true; } },
            setAttribute: (key, value) => { item.attributes[key] = value; },
            get innerHTML() { return html; }, set innerHTML(value) { html = value; if (id === 'stampModalBody') {
                elements = new Map([...elements].filter(([key]) => !key.startsWith('stamp-memo')));
                for (const [, key] of value.matchAll(/id="(stamp-memo[^"]+)"/g)) elements.set(key, element(key, key.startsWith('stamp-memos-')));
            } },
        };
        return item;
    }
    for (const id of ['stampModal', 'stampModalBody', 'stampModalSubtitle', 'stampConfirmBtn']) elements.set(id, element(id));
    const row = { getAttribute: () => '학생', querySelector: selector => ({ value: selector === '.stamp-grade-select' ? 'good' : '  계속 힘내요  ' }) };
    const db = { collection: collection => ({
        where(...filters) { return { get: async () => { calls.push({ collection, filters }); return snapshot(stamps); } }; },
        get: async () => { calls.push({ collection }); if (collection !== 'users') throw new Error('Unexpected full collection read'); return snapshot([['학생', { isCoach: false }], ['코치A', { isCoach: true }]]); },
        doc: id => ({ collection, id, get: async () => {
            calls.push({ collection, id });
            if (collection === 'studentMeta') return { exists: true, data: () => ({ map: { 학생: 2 } }) };
            if (collection === 'pinnedMemos') return memoGates.length ? memoGates.shift().promise : { exists: true, data: () => ({ memos: [{ exercise: '스쿼트', memo: '호흡 확인' }] }) };
            throw new Error('Unexpected document read');
        } }),
    }), batch: () => ({ set: (ref, data) => writes.push({ ref, data }), commit: async () => {} }) };
    const client = async (month, options) => { summaryCalls.push({ month, options }); return summaryGates.length ? summaryGates.shift().promise : summary(); };
    const context = vm.createContext({ state, db, Date, console: { error() {} }, window: { firebase: { auth: () => auth } }, FUNCTIONS_BASE: 'https://fixture.invalid', createMonthlySummaryClient: () => client,
        STAMP_GRADES, STAMP_ORDER, prevMonthRange, suggestGrade, alert() {},
        document: { getElementById: id => elements.get(id), querySelectorAll: () => [row] },
    });
    vm.runInContext(source, context);
    return { state, auth, calls, summaryCalls, summaryGates, memoGates, writes, stamps, el: id => elements.get(id), run: code => vm.runInContext(code, context) };
}

it('지난달 요약으로 기존 활동일·평균·주횟수 추천을 표시하고 records와 메모 전체 조회를 하지 않는다', async () => {
    const h = harness(); await h.run('openStampModal()');
    expect(h.summaryCalls).toEqual([{ month: '2026-09', options: { refresh: false } }]);
    const legacy = computeStampStats(Array.from({ length: 9 }, (_, index) => ({ date: `2026-09-${String(index % 7 + 1).padStart(2, '0')}` })));
    expect(h.el('stampModalBody').innerHTML).toContain(`활동 ${legacy.activeDays}일 · 일평균 ${legacy.avgExercises}종목 ⚠️`);
    expect(h.el('stampModalBody').innerHTML).toContain('value="great" selected');
    expect(h.el('stampModalBody').innerHTML).toContain('📝 메모 보기');
    expect(h.calls.map(c => c.collection).sort()).toEqual(['monthlyStamps', 'studentMeta', 'users']);
    expect(h.el('stampConfirmBtn').disabled).toBe(false);
    expect(h.writes).toEqual([]);
});

it('집계 실패나 잘못된 집계로 빈 도장을 확정하지 않고 명시적 재시도를 허용한다', async () => {
    const h = harness(); const fail = deferred(); h.summaryGates.push(fail);
    const open = h.run('openStampModal()'); fail.reject(new Error('offline')); await open;
    expect(h.el('stampConfirmBtn').disabled).toBe(true);
    expect(h.el('stampModalBody').innerHTML).toContain('openStampModal(true)');
    await h.run('confirmAllStamps()'); expect(h.writes).toEqual([]);
    const invalid = deferred(); h.summaryGates.push(invalid); const retry = h.run('openStampModal(true)'); invalid.resolve(summary('학생', { trainingDays: -1 })); await retry;
    expect(h.el('stampConfirmBtn').disabled).toBe(true);
    await h.run('openStampModal(true)');
    expect(h.summaryCalls.at(-1).options.refresh).toBe(true);
    expect(h.el('stampConfirmBtn').disabled).toBe(false);
    expect(h.calls.some(c => c.collection === 'records')).toBe(false);
});

it('이미 확정한 등급과 코멘트는 새 추천보다 우선하여 그대로 프리필한다', async () => {
    const h = harness(); h.stamps.push(['학생__2026-10', { userName: '학생', grade: 'good', comment: '강도 "천천히" & 꾸준히' }]);
    await h.run('openStampModal()');
    expect(h.el('stampModalBody').innerHTML).toContain('value="good" selected');
    expect(h.el('stampModalBody').innerHTML).not.toContain('value="great" selected');
    expect(h.el('stampModalBody').innerHTML).toContain('강도 &quot;천천히&quot; &amp; 꾸준히');
});

it('닫힌 모달이나 계정 전환 뒤 늦은 집계는 표시·확정할 수 없다', async () => {
    const h = harness(); const old = deferred(); h.summaryGates.push(old);
    const request = h.run('openStampModal()'); h.run('closeStampModal()');
    old.resolve(summary()); await request;
    expect(h.el('stampModalBody').innerHTML).not.toContain('data-student');
    await h.run('openStampModal()');
    h.state.currentUser = '코치B'; h.auth.currentUser.uid = 'uid-B';
    await h.run('confirmAllStamps()');
    expect(h.writes).toEqual([]);
});

it('비코치와 미인증 계정은 도장 데이터를 조회하지 않는다', async () => {
    const h = harness(); h.state.isCoach = false; await h.run('openStampModal()');
    h.state.isCoach = true; h.auth.currentUser = null; await h.run('openStampModal()');
    expect(h.calls).toEqual([]); expect(h.summaryCalls).toEqual([]);
});

it('메모는 펼친 학생 문서 한 개만 읽고 중복 펼침과 짧은 재방문은 요청을 합류한다', async () => {
    const h = harness(); await h.run('openStampModal()');
    const pending = deferred(); h.memoGates.push(pending);
    const first = h.run('toggleStampMemos(0)'); await h.run('toggleStampMemos(0)');
    const joined = h.run('toggleStampMemos(0)');
    expect(h.calls.filter(c => c.collection === 'pinnedMemos')).toHaveLength(1);
    pending.resolve({ exists: true, data: () => ({ memos: [{ exercise: '<스쿼트>', memo: '호흡 & 확인', pain: true }] }) });
    await Promise.all([first, joined]);
    expect(h.el('stamp-memos-0').innerHTML).toContain('&lt;스쿼트&gt;');
    expect(h.el('stamp-memos-0').innerHTML).toContain('호흡 &amp; 확인');
    expect(h.el('stamp-memo-btn-0').textContent).toContain('1개');
    await h.run('toggleStampMemos(0)'); await h.run('toggleStampMemos(0)');
    expect(h.calls.filter(c => c.collection === 'pinnedMemos')).toHaveLength(1);
    vi.advanceTimersByTime(30_001);
    await h.run('toggleStampMemos(0)'); await h.run('toggleStampMemos(0)');
    expect(h.calls.filter(c => c.collection === 'pinnedMemos')).toHaveLength(2);
});

it('다른 계정의 진행 중 메모와 캐시를 재사용하거나 늦은 내용을 새 모달에 쓰지 않는다', async () => {
    const h = harness(); await h.run('openStampModal()');
    const pending = deferred(); h.memoGates.push(pending); const old = h.run('toggleStampMemos(0)');
    h.state.currentUser = '코치B'; h.auth.currentUser.uid = 'uid-B'; await h.run('openStampModal()'); await h.run('toggleStampMemos(0)');
    pending.resolve({ exists: true, data: () => ({ memos: [{ memo: '이전 계정 내용' }] }) }); await old;
    expect(h.calls.filter(c => c.collection === 'pinnedMemos')).toHaveLength(2);
    expect(h.el('stamp-memos-0').innerHTML).toContain('호흡 확인');
    expect(h.el('stamp-memos-0').innerHTML).not.toContain('이전 계정 내용');
    h.state.currentUser = '코치A'; h.auth.currentUser.uid = 'uid-A'; await h.run('openStampModal()'); await h.run('toggleStampMemos(0)');
    expect(h.calls.filter(c => c.collection === 'pinnedMemos')).toHaveLength(3);
});

it('메모 실패는 빈 성공으로 캐시하지 않고 다시 시도하며 없는 메모는 정확히 표시한다', async () => {
    const h = harness(); await h.run('openStampModal()');
    const fail = deferred(); h.memoGates.push(fail); const request = h.run('toggleStampMemos(0)'); fail.reject(new Error('offline')); await request;
    expect(h.el('stamp-memos-0').innerHTML).toContain('retryStampMemos(0)');
    const missing = deferred(); h.memoGates.push(missing); const retry = h.run('retryStampMemos(0)'); missing.resolve({ exists: false }); await retry;
    expect(h.el('stamp-memos-0').innerHTML).toContain('등록된 메모가 없어요');
    expect(h.el('stamp-memo-btn-0').textContent).toContain('0개');
    expect(h.calls.filter(c => c.collection === 'pinnedMemos')).toHaveLength(2);
});

it('정상 확정은 이번 달·추천과 수동 코멘트·확인 플래그의 기존 쓰기 형식을 유지한다', async () => {
    const h = harness(); await h.run('openStampModal()'); await h.run('confirmAllStamps()');
    expect(h.writes).toEqual([{ ref: expect.objectContaining({ collection: 'monthlyStamps', id: '학생__2026-10' }), data: {
        userName: '학생', month: '2026-10', grade: 'good', comment: '계속 힘내요', stampedBy: '코치A', stampedAt: new Date().toISOString(), seenByStudent: false,
    } }]);
    expect(h.el('stampModal').classList.contains('active')).toBe(false);
});
