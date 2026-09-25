import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStudentGrowthController } from '../utils/studentGrowthState';

const mocks = vi.hoisted(() => ({ getDoc: vi.fn(), getDocs: vi.fn(), updateDoc: vi.fn(), setDoc: vi.fn(), runTransaction: vi.fn(), transactionUpdates: vi.fn(), transactionGets: vi.fn() }));
vi.mock('../config/firebase', () => ({ db: { mockOnly: true }, auth: null }));
vi.mock('./authService', () => ({ changeMyPassword: vi.fn() }));
vi.mock('firebase/firestore', async original => ({
    ...await original(),
    doc: (_db, collection, name) => ({ path: `${collection}/${name}` }),
    collection: (_db, name) => ({ collection: name }),
    query: (collection, ...constraints) => ({ ...collection, constraints }),
    where: (field, operator, value) => ({ field, operator, value }),
    serverTimestamp: () => 'mock-timestamp',
    getDoc: mocks.getDoc, getDocs: mocks.getDocs, updateDoc: mocks.updateDoc,
    setDoc: mocks.setDoc, runTransaction: mocks.runTransaction,
}));

let users, records, firebase, growth;
const snapshot = data => ({ exists: () => data !== undefined, data: () => structuredClone(data) });
const defaultUser = () => ({ xpVolume: 1500, xpCoef: 1, xp: 1500, grade: 'e2', gradeSeen: 'e1', tier: 'steady', tierMonth: '2026-08', unrelated: 'preserve' });
const readTransaction = () => ({
    get: async reference => { mocks.transactionGets(reference); return snapshot(users[reference.path]); },
    update: (reference, patch) => {
        mocks.transactionUpdates(reference, patch);
        Object.assign(users[reference.path], patch);
    },
});

beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-25T09:00:00'));
    users = { 'users/학생': defaultUser(), 'users/다른학생': { ...defaultUser(), gradeSeen: 'e2', tierMonth: '2026-09' } };
    records = Array.from({ length: 9 }, (_, i) => ({ userName: '학생', date: `2026-08-${String(i + 1).padStart(2, '0')}`, sets: [] }));
    mocks.getDoc.mockImplementation(async reference => snapshot(users[reference.path]));
    mocks.getDocs.mockImplementation(async request => {
        const items = request.collection === 'records' ? records : [];
        const filtered = items.filter(item => (request.constraints || []).every(({ field, operator, value }) =>
            operator === '==' ? item[field] === value : operator === '>=' ? item[field] >= value : item[field] < value));
        return { docs: filtered.map((data, i) => ({ id: String(i), data: () => structuredClone(data) })) };
    });
    mocks.updateDoc.mockImplementation(async (reference, patch) => Object.assign(users[reference.path], patch));
    mocks.setDoc.mockImplementation(async (reference, patch) => { users[reference.path] = { ...users[reference.path], ...patch }; });
    mocks.runTransaction.mockImplementation(async (_db, callback) => callback(readTransaction()));
    [firebase, growth] = await Promise.all([import('./firebaseService'), import('./studentGrowthService')]);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('본인 성장 정보 조회·확인 — Firestore 전부 mock', () => {
    it('조회만 하며 소유자와 미확인 상태를 반환하고 미계산 XP를 0으로 만들지 않는다', async () => {
        expect(await growth.getStudentGrowth(' 학생 ')).toMatchObject({ userName: '학생', xp: 1500, gradeSeen: 'e1', tier: 'steady' });
        users['users/미계산'] = {};
        expect(await growth.getStudentGrowth('미계산')).toEqual({ userName: '미계산', xp: null, grade: null, gradeSeen: null, tier: null, tierMonth: null, prevTier: null, tierIntroPending: false });
        expect(mocks.runTransaction).not.toHaveBeenCalled();
        expect(mocks.setDoc).not.toHaveBeenCalled();
        expect(mocks.updateDoc).not.toHaveBeenCalled();
        await expect(growth.getStudentGrowth('없는학생')).rejects.toThrow('사용자');
        mocks.getDoc.mockRejectedValueOnce(new Error('offline'));
        await expect(growth.getStudentGrowth('학생')).rejects.toThrow('offline');
    });

    it('본인 문서의 표시한 월·티어만 확인하며 늦은 이전 월/등급 확인은 무시한다', async () => {
        Object.assign(users['users/학생'], { tierMonth: '2026-09', tier: 'passion', tierIntroPending: true });
        for (const tier of [{ month: '2026-08', tier: 'passion' }, { month: '2026-09', tier: 'steady' }]) {
            expect(await growth.acknowledgeStudentGrowth({ userName: '학생', tier })).toMatchObject({ userName: '학생', tierAcknowledged: false, updated: false, tierIntroPending: true });
        }
        expect(await growth.acknowledgeStudentGrowth({ userName: '학생', tier: { month: '2026-09', tier: 'passion' }, grade: 'e2' }))
            .toMatchObject({ tierAcknowledged: true, gradeAcknowledged: true, updated: true, tierIntroPending: false, gradeSeen: 'e2' });
        expect(users['users/학생'].unrelated).toBe('preserve');
        expect(users['users/다른학생']).toEqual({ ...defaultUser(), gradeSeen: 'e2', tierMonth: '2026-09' });
    });

    it('낮은 학년의 늦은 확인은 다른 화면에서 확인한 최고 학년을 낮추지 않는다', async () => {
        users['users/학생'].gradeSeen = 'm1';
        const result = await growth.acknowledgeStudentGrowth({ userName: '학생', grade: 'e2' });
        expect(result).toMatchObject({ gradeSeen: 'm1', gradeAcknowledged: true, updated: false });
        expect(mocks.transactionUpdates).not.toHaveBeenCalled();
        await expect(growth.acknowledgeStudentGrowth({ userName: '학생', grade: 'invalid' })).rejects.toThrow('학년');
    });

    it('transaction 재시도 시 새 월 pending과 더 높은 gradeSeen을 보존한다', async () => {
        const previous = { ...defaultUser(), tierMonth: '2026-09', tierIntroPending: true };
        users['users/학생'] = previous;
        mocks.runTransaction.mockImplementation(async (_db, callback) => {
            await callback({ get: async () => snapshot(previous), update() {} });
            users['users/학생'] = { ...previous, tierMonth: '2026-10', tierIntroPending: true, gradeSeen: 'm1' };
            return callback(readTransaction());
        });
        expect(await growth.acknowledgeStudentGrowth({ userName: '학생', tier: { month: '2026-09', tier: 'steady' }, grade: 'e2' }))
            .toMatchObject({ tierMonth: '2026-10', tierIntroPending: true, tierAcknowledged: false, gradeSeen: 'm1', updated: false });
        expect(mocks.transactionUpdates).not.toHaveBeenCalled();
    });

    it('확인 저장 실패를 호출자에게 전달하고 미확인 상태를 유지한다', async () => {
        mocks.runTransaction.mockRejectedValueOnce(new Error('offline'));
        await expect(growth.acknowledgeStudentGrowth({ userName: '학생', grade: 'e2' })).rejects.toThrow('offline');
        expect(users['users/학생'].gradeSeen).toBe('e1');
    });
});

describe('deferSeen 성장 갱신', () => {
    it('XP는 확인 전 이벤트를 반복 반환하고 확인 후 동일 세션에서도 재표시하지 않는다', async () => {
        const args = { userName: '학생', deferSeen: true };
        expect(await firebase.refreshStudentXP(args)).toMatchObject({ xp: 1500, grade: 'e2', promoted: true, fromGrade: 'e1' });
        expect(users['users/학생'].gradeSeen).toBe('e1');
        expect(await firebase.refreshStudentXP(args)).toMatchObject({ promoted: true });
        await growth.acknowledgeStudentGrowth({ userName: '학생', grade: 'e2' });
        expect(await firebase.refreshStudentXP(args)).toMatchObject({ grade: 'e2', promoted: false, isNew: false });
    });

    it('미설정 gradeSeen은 첫 안내 확인 때만 생성된다', async () => {
        delete users['users/학생'].gradeSeen;
        expect(await firebase.refreshStudentXP({ userName: '학생', deferSeen: true })).toMatchObject({ isNew: true, promoted: false });
        expect(users['users/학생']).not.toHaveProperty('gradeSeen');
        await growth.acknowledgeStudentGrowth({ userName: '학생', grade: 'e2' });
        expect(users['users/학생'].gradeSeen).toBe('e2');
    });

    it('같은 본인/성별의 동시 갱신을 합치고 다른 본인의 결과와 섞지 않는다', async () => {
        const args = { userName: '학생', gender: '남', deferSeen: true };
        const [a, b, other] = await Promise.all([firebase.refreshStudentXP(args), firebase.refreshStudentXP(args), firebase.refreshStudentXP({ ...args, userName: '다른학생' })]);
        expect(a).toEqual(b);
        expect(a.promoted).toBe(true);
        expect(other.promoted).toBe(false);
        expect(mocks.runTransaction).toHaveBeenCalledTimes(2);
        expect(mocks.getDoc).toHaveBeenCalledTimes(2);
    });

    it('훈련일지에서 먼저 반영한 XP와 확인값을 늦은 refresh가 덮어쓰지 않는다', async () => {
        mocks.runTransaction.mockImplementation(async (_db, callback) => {
            Object.assign(users['users/학생'], { xpVolume: 20000, xp: 20000, grade: 'm1', gradeSeen: 'm1' });
            return callback(readTransaction());
        });
        expect(await firebase.refreshStudentXP({ userName: '학생', deferSeen: true })).toMatchObject({ xp: 20000, grade: 'm1', promoted: false });
        expect(users['users/학생'].xpVolume).toBe(20000);
        expect(users['users/학생'].gradeSeen).toBe('m1');
    });

    it('월 티어를 계산해 pending으로 보존하며 확인 후에는 다시 소비할 이벤트가 없다', async () => {
        const args = { userName: '학생', deferSeen: true };
        expect(await firebase.refreshStudentTier(args)).toMatchObject({ month: '2026-09', tier: 'passion', prevTier: 'steady', changed: true, direction: 1 });
        expect(users['users/학생'].tierIntroPending).toBe(true);
        expect(await firebase.refreshStudentTier(args)).toMatchObject({ changed: true });
        await growth.acknowledgeStudentGrowth({ userName: '학생', tier: { month: '2026-09', tier: 'passion' } });
        expect(await firebase.refreshStudentTier(args)).toMatchObject({ changed: false });
    });

    it('백필로 생긴 이번 달 pending은 읽는 것으로 사라지지 않는다', async () => {
        Object.assign(users['users/학생'], { tierMonth: '2026-09', tier: 'passion', prevTier: 'steady', tierIntroPending: true });
        expect(await firebase.refreshStudentTier({ userName: '학생', deferSeen: true })).toMatchObject({ changed: true, direction: 1 });
        expect(users['users/학생'].tierIntroPending).toBe(true);
        expect(mocks.updateDoc).not.toHaveBeenCalled();
    });

    it('동시 갱신/확인이 먼저 끝난 월 티어를 늦은 계산이 pending으로 되돌리지 않는다', async () => {
        mocks.runTransaction.mockImplementation(async (_db, callback) => {
            Object.assign(users['users/학생'], { tierMonth: '2026-09', tier: 'passion', prevTier: 'steady', tierIntroPending: false });
            return callback(readTransaction());
        });
        expect(await firebase.refreshStudentTier({ userName: '학생', deferSeen: true })).toMatchObject({ changed: false, tier: 'passion' });
        expect(mocks.transactionUpdates).not.toHaveBeenCalled();
    });

    it('월 경계를 넘겨 늦게 도착한 계산은 다음 달 티어 이벤트를 덮어쓰지 않는다', async () => {
        mocks.runTransaction.mockImplementation(async (_db, callback) => {
            Object.assign(users['users/학생'], { tierMonth: '2026-10', tier: 'core', prevTier: 'passion', tierIntroPending: true });
            return callback(readTransaction());
        });
        expect(await firebase.refreshStudentTier({ userName: '학생', deferSeen: true })).toMatchObject({ month: '2026-10', tier: 'core', changed: true });
        expect(users['users/학생'].tierMonth).toBe('2026-10');
        expect(mocks.transactionUpdates).not.toHaveBeenCalled();
    });

    it('늦게 확정된 성별 계수는 반영하되 이전 최고 확인 학년은 그대로 둔다', async () => {
        users['users/학생'].xpVolume = 900;
        users['users/학생'].gradeSeen = 'e1';
        expect(await firebase.refreshStudentXP({ userName: '학생', gender: '남', deferSeen: true })).toMatchObject({ xp: 900, grade: 'e1', promoted: false });
        expect(await firebase.refreshStudentXP({ userName: '학생', gender: '여', deferSeen: true })).toMatchObject({ xp: 1350, grade: 'e2', promoted: true });
        expect(users['users/학생'].gradeSeen).toBe('e1');
    });

    it('deferSeen을 생략한 기존 XP·티어 호출은 기존의 즉시 확인과 세션 캐시를 유지한다', async () => {
        expect(await firebase.refreshStudentXP({ userName: '학생' })).toMatchObject({ promoted: true });
        expect(users['users/학생'].gradeSeen).toBe('e2');
        mocks.getDoc.mockClear();
        expect(await firebase.refreshStudentXP({ userName: '학생' })).toMatchObject({ promoted: false });
        expect(mocks.getDoc).not.toHaveBeenCalled();
        Object.assign(users['users/학생'], { tierMonth: '2026-09', tierIntroPending: true, prevTier: 'rookie' });
        expect(await firebase.refreshStudentTier({ userName: '학생' })).toMatchObject({ changed: true });
        expect(users['users/학생'].tierIntroPending).toBe(false);
    });

    it('미확인 deferred XP는 예전 캐시를 무시하고 실패는 0 XP나 성공으로 바꾸지 않는다', async () => {
        await firebase.refreshStudentXP({ userName: '학생' });
        Object.assign(users['users/학생'], { xpVolume: 5000, xp: 5000, grade: 'e4' });
        expect(await firebase.refreshStudentXP({ userName: '학생', deferSeen: true })).toMatchObject({ grade: 'e4', promoted: true });
        mocks.getDoc.mockRejectedValueOnce(new Error('offline'));
        await expect(firebase.refreshStudentXP({ userName: '학생', deferSeen: true })).rejects.toThrow('offline');
        await expect(firebase.refreshStudentTier({ userName: '없는학생', deferSeen: true })).rejects.toThrow('사용자');
        mocks.getDocs.mockRejectedValue(new Error('source unavailable'));
        await expect(firebase.refreshStudentTier({ userName: '학생', deferSeen: true })).rejects.toThrow('source unavailable');
        expect(users['users/학생'].tierMonth).toBe('2026-08');
    });

    it('strict 월별 조회 실패는 기간 없는 전체 기록으로 확대하지 않으며 기존 호출만 폴백한다', async () => {
        const normalQuery = mocks.getDocs.getMockImplementation();
        mocks.getDocs.mockImplementation(async request => {
            if (request.collection === 'records' && request.constraints.length > 1) throw new Error('monthly unavailable');
            return normalQuery(request);
        });
        await expect(firebase.refreshStudentTier({ userName: '학생', deferSeen: true })).rejects.toThrow('monthly unavailable');
        let recordQueries = mocks.getDocs.mock.calls.map(([request]) => request).filter(request => request.collection === 'records');
        expect(recordQueries).toHaveLength(1);
        expect(recordQueries[0].constraints).toHaveLength(3);
        mocks.getDocs.mockClear();
        await firebase.refreshStudentTier({ userName: '학생' });
        recordQueries = mocks.getDocs.mock.calls.map(([request]) => request).filter(request => request.collection === 'records');
        expect(recordQueries.map(request => request.constraints.length)).toEqual([3, 1]);
    });

    it('서비스 병합 키도 월을 구분해 새달 요청이 이전 달의 진행 중 요청에 합류하지 않는다', async () => {
        let finishPrevious;
        const previousQuery = new Promise(resolve => { finishPrevious = resolve; });
        const normalQuery = mocks.getDocs.getMockImplementation();
        mocks.getDocs.mockImplementation(request => request.collection === 'records' && request.constraints.some(part => part.value === '2026-08-01')
            ? previousQuery : normalQuery(request));
        const previous = firebase.refreshStudentTier({ userName: '학생', deferSeen: true });
        // 이전 달은 본인 문서를 읽은 뒤 활동 조회에서 대기한다.
        await Promise.resolve(); await Promise.resolve();
        vi.setSystemTime(new Date('2026-10-01T00:00:01'));
        const current = await firebase.refreshStudentTier({ userName: '학생', deferSeen: true });
        expect(current.month).toBe('2026-10');
        finishPrevious({ docs: [] });
        await previous;
        const recordQueries = mocks.getDocs.mock.calls.map(([request]) => request).filter(request => request.collection === 'records');
        expect(recordQueries).toHaveLength(2);
        expect(users['users/학생'].tierMonth).toBe('2026-10');
    });
});

describe('성장 컨트롤러와 실제 서비스의 문서 조회 예산', () => {
    const identity = { key: 'student', userName: '학생', gender: '남', month: '2026-09' };
    const userDocumentReads = () => mocks.getDoc.mock.calls.length + mocks.transactionGets.mock.calls.length;
    const controller = () => createStudentGrowthController({
        refreshStudentTier: firebase.refreshStudentTier, refreshStudentXP: firebase.refreshStudentXP,
        getStudentGrowth: growth.getStudentGrowth, acknowledgeStudentGrowth: growth.acknowledgeStudentGrowth,
    });

    it.each([false, true])('같은 달 첫 조회는 ready 선조회 유무에 따라 4/5문서이며 반복 계산하지 않는다 (선조회=%s)', async preliminaryRead => {
        users['users/학생'].tierMonth = '2026-09';
        const owner = controller();
        if (preliminaryRead) await owner.load({ ...identity, calculate: false });
        await owner.load(identity);
        expect(userDocumentReads()).toBe(preliminaryRead ? 5 : 4);
        expect(mocks.getDocs).not.toHaveBeenCalled();
        for (let i = 0; i < 5; i++) {
            await owner.load({ ...identity, calculate: false });
            await owner.load(identity);
        }
        expect(userDocumentReads()).toBe(preliminaryRead ? 5 : 4);
    });

    it('복귀 이벤트 묶음은 1문서, 통합 확인은 1문서이며 이후 실제 복귀는 다시 1문서만 읽는다', async () => {
        users['users/학생'].tierMonth = '2026-09';
        const owner = controller();
        await owner.load(identity);
        vi.advanceTimersByTime(2000);
        for (let i = 0; i < 3; i++) {
            await owner.load({ ...identity, calculate: false });
            vi.advanceTimersByTime(100);
        }
        expect(userDocumentReads()).toBe(5);
        await Promise.all([owner.confirm(), owner.confirm()]);
        expect(userDocumentReads()).toBe(6);
        vi.advanceTimersByTime(2000);
        await owner.load({ ...identity, calculate: false });
        expect(userDocumentReads()).toBe(7);
    });

    it('readOnly는 최초 1문서·복귀당 1문서이며 계산·확인을 쓰지 않는다', async () => {
        const owner = controller();
        await owner.load({ ...identity, readOnly: true, calculate: false });
        await owner.load({ ...identity, readOnly: true, calculate: true });
        expect(userDocumentReads()).toBe(1);
        vi.advanceTimersByTime(2000);
        for (let i = 0; i < 3; i++) await owner.load({ ...identity, readOnly: true, calculate: false });
        expect(userDocumentReads()).toBe(2);
        await owner.confirm();
        expect(mocks.runTransaction).not.toHaveBeenCalled();
        expect(mocks.getDocs).not.toHaveBeenCalled();
    });

    it('새달 첫 계산은 본인 5문서와 두 활동 쿼리만 실행하고 같은 달에는 다시 조회하지 않는다', async () => {
        const owner = controller();
        await owner.load(identity);
        expect(userDocumentReads()).toBe(5);
        expect(mocks.getDocs).toHaveBeenCalledTimes(2);
        const requests = mocks.getDocs.mock.calls.map(([request]) => request);
        expect(requests.find(request => request.collection === 'records').constraints).toEqual([
            { field: 'userName', operator: '==', value: '학생' },
            { field: 'date', operator: '>=', value: '2026-08-01' },
            { field: 'date', operator: '<', value: '2026-09-01' },
        ]);
        await owner.load(identity);
        expect(userDocumentReads()).toBe(5);
        expect(mocks.getDocs).toHaveBeenCalledTimes(2);
    });
});
