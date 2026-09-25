import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStudentGrowthController, growthChanges } from './studentGrowthState';

const profile = (extra = {}) => ({ userName: '예시 학생', xp: 18617, grade: 'e6', gradeSeen: 'e5',
    tier: 'steady', prevTier: 'rookie', tierMonth: '2026-09', tierIntroPending: true, ...extra });
const setup = () => {
    let current = profile();
    const services = {
        refreshStudentTier: vi.fn().mockResolvedValue({}), refreshStudentXP: vi.fn().mockResolvedValue({}),
        getStudentGrowth: vi.fn(async () => current),
        acknowledgeStudentGrowth: vi.fn(async () => (current = { ...current, gradeSeen: 'e6', tierIntroPending: false })),
    };
    return { services, controller: createStudentGrowthController(services), setProfile: value => { current = value; } };
};
const identity = { key: 'student', userName: '예시 학생', gender: '여', month: '2026-09' };
const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; };
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-25T09:00:00')); });
afterEach(() => { vi.useRealTimers(); });

describe('본인 성장 변경 표시', () => {
    it('티어와 학년의 변경을 같은 이벤트로 합치고 최고 확인 학년은 다시 알리지 않는다', () => {
        const changes = growthChanges(profile());
        expect(changes.tierChange).toMatchObject({ tier: 'steady', prevTier: 'rookie', month: '2026-09', direction: 1 });
        expect(changes.gradeChange).toEqual({ from: 'e5', to: 'e6', isNew: false });
        expect(growthChanges(profile({ gradeSeen: 'm1', tierIntroPending: false })).eventKey).toBe('');
    });
    it('최초 안내, 월 티어 하락, 계정별 이벤트를 구분한다', () => {
        expect(growthChanges(profile({ gradeSeen: null })).gradeChange.isNew).toBe(true);
        expect(growthChanges(profile({ tier: 'rookie', prevTier: 'steady' })).tierChange.direction).toBe(-1);
        expect(growthChanges(profile({ userName: '다른 학생' })).eventKey).not.toBe(growthChanges(profile()).eventKey);
        expect(growthChanges(profile({ grade: 'invalid', tier: 'invalid' })).eventKey).toBe('');
    });
});

describe('첫 화면 성장 상태 수명', () => {
    it('중복 시작은 한 번만 계산하고 실제 확인 전까지 두 알림을 보존한다', async () => {
        const { controller, services } = setup();
        await Promise.all([controller.load(identity), controller.load(identity)]);
        expect(services.refreshStudentTier).toHaveBeenCalledOnce();
        expect(services.refreshStudentXP).toHaveBeenCalledWith({ userName: identity.userName, gender: '여', deferSeen: true });
        expect(services.acknowledgeStudentGrowth).not.toHaveBeenCalled();
        expect(growthChanges(controller.getSnapshot().profile).eventKey).not.toBe('');
    });
    it('나중에는 서버에서 소비하지 않고 확인하면 양쪽 알림을 한 번에 처리한다', async () => {
        const { controller, services } = setup();
        await controller.load(identity);
        controller.later();
        expect(controller.getSnapshot().dismissedEvent).toBe(growthChanges(profile()).eventKey);
        expect(services.acknowledgeStudentGrowth).not.toHaveBeenCalled();
        await controller.confirm();
        expect(services.acknowledgeStudentGrowth).toHaveBeenCalledWith({ userName: identity.userName, tier: { month: '2026-09', tier: 'steady' }, grade: 'e6' });
        expect(growthChanges(controller.getSnapshot().profile).eventKey).toBe('');
        await controller.load(identity);
        expect(growthChanges(controller.getSnapshot().profile).eventKey).toBe('');
    });
    it('확인 실패는 이벤트와 재시도를 보존한다', async () => {
        const { controller, services } = setup();
        await controller.load(identity);
        services.acknowledgeStudentGrowth.mockRejectedValueOnce(new Error('offline'));
        await controller.confirm();
        expect(controller.getSnapshot()).toMatchObject({ busy: false, confirmError: '확인을 저장하지 못했어요. 다시 눌러주세요.' });
        expect(growthChanges(controller.getSnapshot().profile).gradeChange).not.toBeNull();
        await controller.confirm();
        expect(growthChanges(controller.getSnapshot().profile).eventKey).toBe('');
    });
    it('늦은 이전 계정의 응답은 새 계정 카드/이벤트를 덮어쓰지 않는다', async () => {
        const { controller, services } = setup();
        const old = deferred();
        services.getStudentGrowth.mockImplementation(name => name === identity.userName ? old.promise : Promise.resolve(profile({ userName: name, xp: 1000 })));
        const first = controller.load({ ...identity, readOnly: true });
        await controller.load({ key: 'other', userName: '다른 학생', readOnly: true });
        old.resolve(profile());
        await first;
        expect(controller.getSnapshot()).toMatchObject({ key: 'other', profile: { userName: '다른 학생', xp: 1000 } });
    });
    it('로그아웃 후 도착한 응답과 확인 결과는 재표시되지 않는다', async () => {
        const { controller, services } = setup();
        await controller.load(identity);
        const ack = deferred();
        services.acknowledgeStudentGrowth.mockReturnValue(ack.promise);
        const confirmation = controller.confirm();
        controller.reset();
        ack.resolve(profile({ gradeSeen: 'e6' }));
        await confirmation;
        expect(controller.getSnapshot()).toMatchObject({ key: '', profile: null, busy: false });
    });
    it('빙의·실데이터 검토는 저장값만 읽고 확인 핸들러도 쓰지 않는다', async () => {
        const { controller, services } = setup();
        await controller.load({ ...identity, readOnly: true });
        await controller.confirm();
        expect(services.getStudentGrowth).toHaveBeenCalledOnce();
        expect(services.refreshStudentTier).not.toHaveBeenCalled();
        expect(services.refreshStudentXP).not.toHaveBeenCalled();
        expect(services.acknowledgeStudentGrowth).not.toHaveBeenCalled();
    });
    it('훈련일지에서 이미 확인한 승급은 화면 복귀 시 사라진다', async () => {
        const { controller, setProfile } = setup();
        await controller.load(identity);
        setProfile(profile({ gradeSeen: 'e6', tierIntroPending: false }));
        vi.advanceTimersByTime(1501);
        await controller.load({ ...identity, calculate: false });
        expect(growthChanges(controller.getSnapshot().profile).eventKey).toBe('');
    });
    it('로딩 중 화면 복귀는 계산 완료를 기다리고 저장 전의 값으로 되돌리지 않는다', async () => {
        const { controller, services } = setup();
        const calculation = deferred();
        services.refreshStudentXP.mockReturnValue(calculation.promise);
        const initial = controller.load(identity);
        const resume = controller.load({ ...identity, calculate: false });
        expect(services.getStudentGrowth).not.toHaveBeenCalled();
        calculation.resolve({});
        await Promise.all([initial, resume]);
        expect(services.getStudentGrowth).toHaveBeenCalledOnce();
        expect(controller.getSnapshot().profile.xp).toBe(18617);
    });
    it.each(['success', 'failure'])('확인 %s 후에는 저장 중 들어온 최신 계산을 한 번 실행한다', async outcome => {
        const { controller, services, setProfile } = setup();
        await controller.load(identity);
        const ack = deferred();
        services.acknowledgeStudentGrowth.mockReturnValue(ack.promise);
        const confirmation = controller.confirm();
        await controller.load({ ...identity, gender: '', month: '2026-10' });
        await controller.load({ ...identity, gender: '여', month: '2026-10' });
        await controller.load({ ...identity, calculate: false });
        expect(services.refreshStudentTier).toHaveBeenCalledOnce();
        const nextMonth = profile({ tierMonth: '2026-10', tier: 'passion', prevTier: 'steady' });
        setProfile(nextMonth);
        if (outcome === 'success') ack.resolve(profile({ gradeSeen: 'e6', tierIntroPending: false }));
        else ack.reject(new Error('offline'));
        await confirmation;
        expect(services.refreshStudentTier).toHaveBeenCalledTimes(2);
        expect(services.refreshStudentXP).toHaveBeenLastCalledWith({ userName: identity.userName, gender: '여', deferSeen: true });
        expect(controller.getSnapshot()).toMatchObject({ busy: false, loading: false, profile: nextMonth });
        expect(growthChanges(controller.getSnapshot().profile).tierChange.month).toBe('2026-10');
    });
    it.each(['logout', 'switch'])('확인 중 대기한 계산은 %s 시 폐기한다', async action => {
        const { controller, services, setProfile } = setup();
        await controller.load(identity);
        const ack = deferred();
        services.acknowledgeStudentGrowth.mockReturnValue(ack.promise);
        const confirmation = controller.confirm();
        await controller.load(identity);
        if (action === 'logout') controller.reset();
        else {
            setProfile(profile({ userName: '다른 학생' }));
            await controller.load({ key: 'other', userName: '다른 학생', readOnly: true });
        }
        ack.resolve(profile({ gradeSeen: 'e6', tierIntroPending: false }));
        await confirmation;
        expect(services.refreshStudentTier).toHaveBeenCalledOnce();
        expect(services.refreshStudentXP).toHaveBeenCalledOnce();
        expect(controller.getSnapshot()).toMatchObject(action === 'logout'
            ? { key: '', profile: null, busy: false }
            : { key: 'other', profile: { userName: '다른 학생' }, busy: false });
    });
    it('조회 실패를 0 XP로 대체하지 않고 재시도할 수 있다', async () => {
        const { controller, services } = setup();
        services.getStudentGrowth.mockRejectedValueOnce(new Error('offline'));
        await controller.load(identity);
        expect(controller.getSnapshot()).toMatchObject({ profile: null, loading: false, error: '성장 정보를 불러오지 못했어요.' });
        await controller.confirm();
        expect(services.acknowledgeStudentGrowth).not.toHaveBeenCalled();
        await controller.load(identity);
        expect(controller.getSnapshot().profile.xp).toBe(18617);
    });

    it('첫 성공과 같은 월·성별은 ready 재전환과 반복 load에서 재계산하지 않는다', async () => {
        const { controller, services } = setup();
        await controller.load(identity);
        for (let i = 0; i < 5; i++) {
            await controller.load({ ...identity, calculate: false });
            await controller.load(identity);
        }
        expect(services.refreshStudentTier).toHaveBeenCalledOnce();
        expect(services.refreshStudentXP).toHaveBeenCalledOnce();
        expect(services.getStudentGrowth).toHaveBeenCalledOnce();
        vi.advanceTimersByTime(2000);
        await controller.load({ ...identity, calculate: false });
        await controller.load(identity);
        expect(services.refreshStudentXP).toHaveBeenCalledOnce();
        expect(services.getStudentGrowth).toHaveBeenCalledTimes(2);
    });

    it.each([false, true])('복귀 3종 이벤트는 1.5초 안에 합치고 이후 복귀는 새로 읽는다 (readOnly=%s)', async readOnly => {
        const { controller, services } = setup();
        await controller.load({ ...identity, readOnly });
        vi.advanceTimersByTime(2000);
        for (let i = 0; i < 3; i++) {
            await controller.load({ ...identity, readOnly, calculate: false });
            vi.advanceTimersByTime(100);
        }
        expect(services.getStudentGrowth).toHaveBeenCalledTimes(2);
        vi.advanceTimersByTime(1500);
        await controller.load({ ...identity, readOnly, calculate: false });
        expect(services.getStudentGrowth).toHaveBeenCalledTimes(3);
        expect(services.refreshStudentXP).toHaveBeenCalledTimes(readOnly ? 0 : 1);
    });

    it('첫 읽기 중 ready가 true로 바뀌면 계산을 놓치지 않는다', async () => {
        const { controller, services } = setup();
        const firstRead = deferred();
        services.getStudentGrowth.mockReturnValueOnce(firstRead.promise);
        const first = controller.load({ ...identity, calculate: false });
        await controller.load(identity);
        firstRead.resolve(profile({ xp: 0 }));
        await first;
        expect(services.refreshStudentTier).toHaveBeenCalledOnce();
        expect(services.refreshStudentXP).toHaveBeenCalledOnce();
        expect(services.getStudentGrowth).toHaveBeenCalledTimes(2);
        expect(controller.getSnapshot().profile.xp).toBe(18617);
    });

    it('진행 중인 이전 달 계산과 새달 계산을 합치지 않는다', async () => {
        const { controller, services, setProfile } = setup();
        const previousMonth = deferred();
        services.refreshStudentTier.mockReturnValueOnce(previousMonth.promise);
        const previous = controller.load(identity);
        setProfile(profile({ tierMonth: '2026-10' }));
        await controller.load({ ...identity, month: '2026-10' });
        previousMonth.resolve({});
        await previous;
        expect(services.refreshStudentTier).toHaveBeenCalledTimes(2);
        expect(services.refreshStudentXP).toHaveBeenCalledTimes(2);
        expect(controller.getSnapshot().profile.tierMonth).toBe('2026-10');
        await controller.load({ ...identity, month: '2026-10' });
        expect(services.refreshStudentTier).toHaveBeenCalledTimes(2);
    });

    it('명시적 재시도는 성공 캐시·짧은 cooldown도 우회하고 실패 뒤 다시 실행할 수 있다', async () => {
        const { controller, services } = setup();
        await controller.load(identity);
        services.refreshStudentXP.mockRejectedValueOnce(new Error('offline'));
        await controller.load({ ...identity, force: true });
        expect(controller.getSnapshot().error).not.toBe('');
        await controller.load({ ...identity, force: true });
        expect(controller.getSnapshot().error).toBe('');
        expect(services.refreshStudentXP).toHaveBeenCalledTimes(3);
        await controller.load({ ...identity, calculate: false, force: true });
        expect(services.getStudentGrowth).toHaveBeenCalledTimes(3);
    });
});
