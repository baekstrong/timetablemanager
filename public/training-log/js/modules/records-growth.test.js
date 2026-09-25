import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { GRADES, gradeRank, xpToGrade } from './grades.js';

// 실제 records 모듈을 실행하고 DOM/Firestore 경계만 모의한다. 운영 쓰기 없음.
function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
function harness() {
    const state = { currentUser: '학생A', isCoach: false, xpVolume: 900, xpCoef: 1, grade: 'e1', gradeSeen: 'e1' };
    const users = new Map([['학생A', { grade: 'e1', gradeSeen: 'e1' }], ['학생B', { grade: 'e1', gradeSeen: 'e1' }]]);
    const nodes = new Map();
    const writes = [];
    const transactionWrites = [];
    const controls = { xpGate: null, ackGate: null, ackError: null, readGate: null, transactionReadGate: null, impersonatedName: null };
    const document = {
        activeElement: null,
        body: { style: { overflow: '' }, appendChild(node) { nodes.set(node.id, node); } },
        getElementById: id => nodes.get(id) || null,
        addEventListener: vi.fn(), removeEventListener: vi.fn(),
        createElement() {
            const children = new Map();
            const node = {
                setAttribute: vi.fn(),
                querySelector(selector) {
                    if (!children.has(selector)) children.set(selector, { disabled: false, textContent: '', focus() { document.activeElement = this; } });
                    return children.get(selector);
                },
                remove() { if (nodes.get(this.id) === this) nodes.delete(this.id); },
            };
            return node;
        },
    };
    const db = {
        collection: () => ({ doc: name => ({ name,
            async get() { if (controls.readGate) await controls.readGate.promise; return { exists: users.has(name), data: () => users.get(name) }; },
            async set(patch) {
                writes.push({ name, patch });
                if (controls.xpGate) await controls.xpGate.promise;
                users.set(name, { ...users.get(name), ...patch });
            },
        }) }),
        runTransaction: vi.fn(async callback => {
            const pending = [];
            const result = await callback({
                get: async ref => {
                    if (controls.transactionReadGate) await controls.transactionReadGate.promise;
                    return { exists: users.has(ref.name), data: () => users.get(ref.name) };
                },
                set: (ref, patch) => pending.push({ name: ref.name, patch }),
            });
            if (controls.ackGate) await controls.ackGate.promise;
            if (controls.ackError) throw controls.ackError;
            for (const write of pending) { transactionWrites.push(write); users.set(write.name, { ...users.get(write.name), ...write.patch }); }
            return result;
        }),
    };
    const context = vm.createContext({ state, db, document, firebaseInitialized: true, GRADES, gradeRank, xpToGrade,
        sessionStorage: { getItem: () => controls.impersonatedName ? JSON.stringify({ impersonatedName: controls.impersonatedName }) : null },
        window: { firebase: { firestore: { FieldValue: { serverTimestamp: () => 'server-time' } } } },
        console: { error: vi.fn() },
    });
    const source = readFileSync(new URL('./records.js', import.meta.url), 'utf8')
        .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
    vm.runInContext(source, context);
    const run = code => vm.runInContext(code, context);
    const overlay = () => nodes.get('levelUpOverlay');
    const confirm = () => overlay().querySelector('.grade-alert-confirm').onclick();
    const prOverlay = () => nodes.get('prCelebrationOverlay');
    return { state, users, writes, transactionWrites, controls, db, run, overlay, prOverlay, confirm };
}

describe('훈련일지 학년 알림 확인', () => {
    it('XP 저장과 미확인 닫기는 gradeSeen을 소비하지 않고 실제 확인만 저장한다', async () => {
        const h = harness();
        await h.run('applyXpDelta(200)');
        expect(h.writes[0].patch).not.toHaveProperty('gradeSeen');
        expect(h.state.gradeSeen).toBe('e1');
        expect(h.overlay()).toBeDefined();
        h.overlay().querySelector('.grade-alert-later').onclick();
        expect(h.db.runTransaction).not.toHaveBeenCalled();
        h.run("showLevelUp('e2', '학생A')");
        await h.confirm();
        expect(h.users.get('학생A').gradeSeen).toBe('e2');
        expect(h.state.gradeSeen).toBe('e2');
        expect(h.overlay()).toBeUndefined();
    });
    it('XP 저장 실패는 gradeSeen을 유지하고 저장되지 않은 승급을 확인시키지 않는다', async () => {
        const h = harness();
        h.controls.xpGate = deferred();
        const result = h.run('applyXpDelta(200)');
        h.controls.xpGate.reject(new Error('permission-denied'));
        expect((await result).saved).toBe(false);
        expect(h.state.gradeSeen).toBe('e1');
        expect(h.users.get('학생A').gradeSeen).toBe('e1');
        expect(h.overlay()).toBeUndefined();
    });
    it('확인 저장 실패는 팝업과 미확인을 유지하며 재시도할 수 있다', async () => {
        const h = harness();
        h.run("showLevelUp('e2', '학생A')");
        h.controls.ackError = new Error('unavailable');
        await h.confirm();
        expect(h.state.gradeSeen).toBe('e1');
        expect(h.overlay().querySelector('.grade-alert-confirm').disabled).toBe(false);
        expect(h.overlay().querySelector('.grade-alert-status').textContent).toContain('다시 시도');
        h.controls.ackError = null;
        await h.confirm();
        expect(h.users.get('학생A').gradeSeen).toBe('e2');
        expect(h.overlay()).toBeUndefined();
    });
    it('다른 탭에서 확인한 더 높은 학년을 낮추지 않는다', async () => {
        const h = harness();
        h.run("showLevelUp('e2', '학생A')");
        h.users.set('학생A', { gradeSeen: 'e4' });
        await h.confirm();
        expect(h.transactionWrites).toHaveLength(0);
        expect(h.state.gradeSeen).toBe('e4');
    });
    it('먼저 열린 팝업의 늦은 확인 완료가 새 승급 팝업을 닫지 않는다', async () => {
        const h = harness();
        h.run("showLevelUp('e2', '학생A')");
        h.controls.ackGate = deferred();
        const first = h.confirm();
        h.run("showLevelUp('e3', '학생A')");
        const newer = h.overlay();
        h.controls.ackGate.resolve();
        await first;
        expect(h.overlay()).toBe(newer);
        expect(h.state.gradeSeen).toBe('e2');
        await h.confirm();
        expect(h.state.gradeSeen).toBe('e3');
    });
    it('늦은 XP 저장 응답은 새 계정에 팝업을 띄우지 않는다', async () => {
        const h = harness();
        h.controls.xpGate = deferred();
        const pending = h.run('applyXpDelta(200)');
        h.state.currentUser = '학생B'; h.state.gradeSeen = 'e3';
        h.controls.xpGate.resolve();
        await pending;
        expect(h.writes[0].name).toBe('학생A');
        expect(h.state.gradeSeen).toBe('e3');
        expect(h.overlay()).toBeUndefined();
    });
    it('확인 중 계정이 바뀌면 원계정만 저장하고 새 계정 상태·팝업을 보존한다', async () => {
        const h = harness();
        h.run("showLevelUp('e2', '학생A')");
        h.controls.ackGate = deferred();
        const pending = h.confirm();
        h.state.currentUser = '학생B'; h.state.gradeSeen = 'e3';
        h.run("showLevelUp('e4', '학생B')");
        const newer = h.overlay();
        h.controls.ackGate.resolve();
        await pending;
        expect(h.users.get('학생A').gradeSeen).toBe('e2');
        expect(h.state.gradeSeen).toBe('e3');
        expect(h.overlay()).toBe(newer);
    });
    it('늦은 XP 초기 조회가 새 계정 상태를 덮어쓰지 않는다', async () => {
        const h = harness();
        h.controls.readGate = deferred();
        const pending = h.run('loadMyXpState()');
        h.state.currentUser = '학생B'; h.state.xpVolume = 555; h.state.gradeSeen = 'e3';
        h.controls.readGate.resolve();
        await pending;
        expect(h.state.xpVolume).toBe(555);
        expect(h.state.gradeSeen).toBe('e3');
    });
    it('빙의 중에도 기존 XP는 적립하지만 학생 학년 알림은 띄우거나 소비하지 않는다', async () => {
        const h = harness();
        h.controls.impersonatedName = '학생A';
        await h.run('applyXpDelta(200)');
        expect(h.users.get('학생A').xp).toBe(1100);
        expect(h.users.get('학생A').gradeSeen).toBe('e1');
        expect(h.overlay()).toBeUndefined();
        expect(h.db.runTransaction).not.toHaveBeenCalled();
    });
    it('팝업을 띄운 뒤 빙의로 바뀌어도 확인 시점에 소비를 차단한다', async () => {
        const h = harness();
        h.run("showLevelUp('e2', '학생A')");
        h.controls.impersonatedName = '학생A';
        await h.confirm();
        expect(h.db.runTransaction).not.toHaveBeenCalled();
        expect(h.users.get('학생A').gradeSeen).toBe('e1');
    });
    it('확인 트랜잭션 조회 중 빙의가 시작되면 gradeSeen 쓰기를 건너뛴다', async () => {
        const h = harness();
        h.run("showLevelUp('e2', '학생A')");
        h.controls.transactionReadGate = deferred();
        const pending = h.confirm();
        h.controls.impersonatedName = '학생A';
        h.controls.transactionReadGate.resolve();
        await pending;
        expect(h.transactionWrites).toHaveLength(0);
        expect(h.state.gradeSeen).toBe('e1');
    });
    it('PR이 먼저 도착하면 PR을 닫은 다음 학년 알림을 보여준다', async () => {
        const h = harness();
        h.run("showPRCelebration({ exercise: '벤치프레스', weightPR: true, weight: 20 }, '학생A')");
        await h.run('applyXpDelta(200)');
        expect(h.prOverlay()).toBeDefined();
        expect(h.overlay()).toBeUndefined();
        expect(h.state.gradeSeen).toBe('e1');
        h.prOverlay().querySelector('button').onclick();
        expect(h.prOverlay()).toBeUndefined();
        expect(h.overlay()).toBeDefined();
        await h.confirm();
        expect(h.state.gradeSeen).toBe('e2');
    });
    it('학년이 먼저 도착하면 확인 실패 중에는 PR을 기다리게 하고 확인 뒤 표시한다', async () => {
        const h = harness();
        await h.run('applyXpDelta(200)');
        h.run("showPRCelebration({ exercise: '벤치프레스', weightPR: true, weight: 20 }, '학생A')");
        expect(h.overlay()).toBeDefined();
        expect(h.prOverlay()).toBeUndefined();
        h.controls.ackError = new Error('unavailable');
        await h.confirm();
        expect(h.prOverlay()).toBeUndefined();
        h.controls.ackError = null;
        await h.confirm();
        expect(h.overlay()).toBeUndefined();
        expect(h.prOverlay()).toBeDefined();
    });
    it('학년 나중에 확인은 미확인을 유지하면서 대기한 PR을 계속 보여준다', async () => {
        const h = harness();
        await h.run('applyXpDelta(200)');
        h.run("showPRCelebration({ exercise: '스쿼트', repsPR: true, reps: 10 }, '학생A')");
        h.overlay().querySelector('.grade-alert-later').onclick();
        expect(h.state.gradeSeen).toBe('e1');
        expect(h.prOverlay()).toBeDefined();
    });
    it('팝업 대기 중 계정이 바뀌면 이전 학생의 알림을 새 계정에 띄우지 않는다', async () => {
        const h = harness();
        h.run("showPRCelebration({ exercise: '벤치프레스', weightPR: true, weight: 20 }, '학생A')");
        await h.run('applyXpDelta(200)');
        h.state.currentUser = '학생B';
        h.prOverlay().querySelector('button').onclick();
        expect(h.overlay()).toBeUndefined();
        expect(h.prOverlay()).toBeUndefined();
        expect(h.db.runTransaction).not.toHaveBeenCalled();
    });
});
