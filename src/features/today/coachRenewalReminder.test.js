import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCoachReminderController, createCoachReminderLoader, createReminderLedger, getDueCoachReminders } from '../../../public/shared/coachRenewalReminder.js';

const at = time => new Date(`2026-10-16T${time}+09:00`);
const snapshot = (lastNames = ['마지막 회원'], delayedNames = ['미등록 회원']) => ({
    date: '2026-10-16', lessons: [{ period: 1, startMinute: 600, lastNames, delayedNames }],
});
const memoryStorage = () => {
    const values = new Map();
    return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};
const settle = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };
const controllers = [];
function setup({ time = '09:30:00', loadSnapshot = vi.fn(async () => snapshot()), storage = memoryStorage(), blocked = false, hidden = false, includeEnding } = {}) {
    vi.useFakeTimers();
    vi.setSystemTime(at(time));
    const document = new EventTarget();
    document.hidden = hidden;
    document.querySelector = vi.fn(() => blocked ? {} : null);
    const window = new EventTarget();
    window.setInterval = setInterval;
    window.clearInterval = clearInterval;
    const onReminder = vi.fn();
    const onError = vi.fn();
    const controller = createCoachReminderController({ coachName: '검증 코치', loadSnapshot, onReminder, onError, storage, document, window, includeEnding });
    controllers.push(controller);
    controller.start();
    return { controller, loadSnapshot, onReminder, onError, storage, document, window };
}
afterEach(() => { controllers.splice(0).forEach(controller => controller.stop()); vi.useRealTimers(); });

describe('KST 수업 전 안내 경계', () => {
    it('30분 전부터 시작 직전까지만, 시간대와 무관하게 판정한다', () => {
        expect(getDueCoachReminders(snapshot(), at('09:29:59'))).toEqual([]);
        expect(getDueCoachReminders(snapshot(), new Date('2026-10-16T00:30:00Z'))[0].key).toBe('2026-10-16:1');
        expect(getDueCoachReminders(snapshot(), at('09:59:59'))).toHaveLength(1);
        expect(getDueCoachReminders(snapshot(), at('10:00:00'))).toEqual([]);
    });
    it('다른 날짜·주말·잘못된 교시 시각·빈 명단은 표시하지 않는다', () => {
        expect(getDueCoachReminders({ ...snapshot(), date: '2026-10-15' }, at('09:30:00'))).toEqual([]);
        expect(getDueCoachReminders({ ...snapshot(), date: '2026-10-17' }, new Date('2026-10-17T09:30:00+09:00'))).toEqual([]);
        expect(getDueCoachReminders({ date: '2026-10-16', lessons: [{ period: 1, startMinute: 590, lastNames: ['회원'] }] }, at('09:30:00'))).toEqual([]);
        expect(getDueCoachReminders(snapshot([], []), at('09:30:00'))).toEqual([]);
    });
    it('중복 이름을 합치고 같은 사람을 두 목록에 넣지 않는다', () => {
        expect(getDueCoachReminders(snapshot([' A ', 'A'], ['A', 'B', 'B']), at('09:30:00'))[0]).toMatchObject({ lastNames: ['A'], delayedNames: ['B'] });
    });
});

describe('KST 수업 종료 전 안내 경계', () => {
    it('종료 10분 전부터 종료 직전까지만 별도 단계로 판정한다', () => {
        const ending = { includeEnding: true };
        expect(getDueCoachReminders(snapshot(), at('11:19:59'), ending)).toEqual([]);
        expect(getDueCoachReminders(snapshot(), at('11:20:00'), ending)).toEqual([
            expect.objectContaining({ key: '2026-10-16:1:ending', phase: 'ending', period: 1, startMinute: 600, endMinute: 690 }),
        ]);
        expect(getDueCoachReminders(snapshot(), at('11:29:59'), ending)).toHaveLength(1);
        expect(getDueCoachReminders(snapshot(), at('11:30:00'), ending)).toEqual([]);
    });
    it('기본 판정은 기존 수업 전 단계만 반환해 서버 푸시 범위를 유지한다', () => {
        expect(getDueCoachReminders(snapshot(), at('09:30:00'))[0]).toMatchObject({ key: '2026-10-16:1', phase: 'before', endMinute: 690 });
        expect(getDueCoachReminders(snapshot(), at('11:20:00'))).toEqual([]);
        expect(getDueCoachReminders(snapshot(), at('11:20:00'), { includeEnding: false })).toEqual([]);
    });
    it('19:20의 4교시 종료 전과 5교시 시작 전은 서로 다른 키로 반환한다', () => {
        const overlapping = { date: '2026-10-16', lessons: [
            { period: 4, startMinute: 1080, lastNames: ['4교시 회원'], delayedNames: [] },
            { period: 5, startMinute: 1190, lastNames: [], delayedNames: ['5교시 회원'] },
        ] };
        const due = getDueCoachReminders(overlapping, at('19:20:00'), { includeEnding: true });
        expect(due).toEqual(expect.arrayContaining([
            expect.objectContaining({ key: '2026-10-16:4:ending', phase: 'ending', endMinute: 1170, lastNames: ['4교시 회원'] }),
            expect.objectContaining({ key: '2026-10-16:5', phase: 'before', endMinute: 1280, delayedNames: ['5교시 회원'] }),
        ]));
        expect(due).toHaveLength(2);
        expect(getDueCoachReminders(overlapping, at('19:20:00')).map(item => item.key)).toEqual(['2026-10-16:5']);
    });
});

describe('팝업 수명·중복·최신 자료', () => {
    it('경계에 최신 명단을 다시 읽고 교시당 한 번만 표시한다', async () => {
        const fixture = setup({ time: '09:29:45' });
        await settle();
        expect(fixture.onReminder).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(15_000);
        expect(fixture.loadSnapshot).toHaveBeenCalledTimes(2);
        expect(fixture.onReminder.mock.calls.filter(([item]) => item)).toHaveLength(1);
        fixture.controller.dismiss('2026-10-16:1');
        await vi.advanceTimersByTimeAsync(45_000);
        expect(fixture.onReminder.mock.calls.filter(([item]) => item)).toHaveLength(1);
    });
    it('늦게 연 앱도 표시하고, 같은 코치의 새 문서·다른 앱은 반복하지 않는다', async () => {
        const first = setup({ time: '09:58:00' });
        await settle();
        expect(first.onReminder).toHaveBeenCalledWith(expect.objectContaining({ key: '2026-10-16:1' }));
        first.controller.stop();
        const second = setup({ time: '09:59:00', storage: first.storage });
        await settle();
        expect(second.onReminder).not.toHaveBeenCalled();
        expect(createReminderLedger(first.storage, '다른 코치').has('2026-10-16:1')).toBe(false);
    });
    it('다른 모달이 닫힐 때까지 기다리며 대기 중에는 표시 이력을 남기지 않는다', async () => {
        const fixture = setup({ blocked: true });
        await settle();
        expect(fixture.onReminder).not.toHaveBeenCalled();
        expect(createReminderLedger(fixture.storage, '검증 코치').has('2026-10-16:1')).toBe(false);
        fixture.document.querySelector.mockReturnValue(null);
        fixture.document.querySelectorAll = vi.fn(() => [{ getClientRects: () => [{}] }]);
        await vi.advanceTimersByTimeAsync(15_000);
        expect(fixture.onReminder).not.toHaveBeenCalled();
        fixture.document.querySelectorAll.mockReturnValue([]);
        await vi.advanceTimersByTimeAsync(15_000);
        expect(fixture.onReminder).toHaveBeenCalledWith(expect.objectContaining({ period: 1 }));
    });
    it('숨긴 화면에서는 읽거나 표시하지 않고 복귀 시 최신 명단을 확인한다', async () => {
        const fixture = setup({ hidden: true });
        await settle();
        expect(fixture.loadSnapshot).not.toHaveBeenCalled();
        fixture.document.hidden = false;
        fixture.document.dispatchEvent(new Event('visibilitychange'));
        await settle();
        expect(fixture.onReminder).toHaveBeenCalledWith(expect.objectContaining({ period: 1 }));
    });
    it('재등록 완료로 명단이 비면 열린 팝업도 닫는다', async () => {
        const fixture = setup();
        await settle();
        fixture.loadSnapshot.mockResolvedValue(snapshot([], []));
        await fixture.controller.refresh({ force: true });
        expect(fixture.onReminder).toHaveBeenLastCalledWith(null);
    });
    it('기존 요청 중 등록 변경은 후속 강제 조회 후에만 표시한다', async () => {
        let resolve;
        const loadSnapshot = vi.fn().mockImplementationOnce(() => new Promise(done => { resolve = done; })).mockResolvedValue(snapshot([], []));
        const fixture = setup({ loadSnapshot });
        await settle();
        void fixture.controller.refresh({ force: true });
        resolve(snapshot());
        await settle();
        expect(loadSnapshot).toHaveBeenCalledTimes(2);
        expect(fixture.onReminder).not.toHaveBeenCalled();
    });
    it('갱신 실패는 낡은 명단을 표시하지 않고 다시 시도한다', async () => {
        const loadSnapshot = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(snapshot());
        const fixture = setup({ loadSnapshot });
        await settle();
        expect(fixture.onReminder).not.toHaveBeenCalled();
        expect(fixture.onError).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(fixture.onReminder).toHaveBeenCalledWith(expect.objectContaining({ period: 1 }));
    });
    it('계정 전환·로그아웃 후 도착한 응답은 무시한다', async () => {
        let resolve;
        const fixture = setup({ loadSnapshot: () => new Promise(done => { resolve = done; }) });
        await settle();
        fixture.controller.stop();
        resolve(snapshot());
        await settle();
        expect(fixture.onReminder).not.toHaveBeenCalled();
    });
    it('조회가 느려도 수업 시작 때 열린 팝업을 닫는다', async () => {
        const fixture = setup({ time: '09:59:45' });
        await settle();
        fixture.loadSnapshot.mockImplementation(() => new Promise(() => {}));
        void fixture.controller.refresh({ force: true });
        await vi.advanceTimersByTimeAsync(15_000);
        expect(fixture.onReminder).toHaveBeenLastCalledWith(null);
    });
    it('브라우저 저장소가 막혀도 현재 문서에서는 반복하지 않는다', () => {
        const ledger = createReminderLedger({ getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } }, '코치');
        ledger.mark('2026-10-16:1');
        expect(ledger.has('2026-10-16:1')).toBe(true);
    });
});

describe('종료 전 팝업 수명·독립 확인 이력', () => {
    it('시작 전 안내를 닫아도 종료 전 경계에서 최신 명단으로 한 번 더 표시한다', async () => {
        const fixture = setup({ includeEnding: true });
        await settle();
        expect(fixture.onReminder).toHaveBeenCalledWith(expect.objectContaining({ key: '2026-10-16:1', phase: 'before' }));
        fixture.controller.dismiss('2026-10-16:1');
        await vi.advanceTimersByTimeAsync(109 * 60_000 + 45_000);
        expect(fixture.onReminder.mock.calls.filter(([item]) => item?.phase === 'ending')).toHaveLength(0);
        await vi.advanceTimersByTimeAsync(15_000);
        expect(fixture.loadSnapshot).toHaveBeenCalledTimes(2);
        expect(fixture.loadSnapshot).toHaveBeenLastCalledWith({ force: true });
        expect(fixture.onReminder).toHaveBeenLastCalledWith(expect.objectContaining({ key: '2026-10-16:1:ending', phase: 'ending' }));
        fixture.controller.dismiss('2026-10-16:1:ending');
        await vi.advanceTimersByTimeAsync(45_000);
        expect(fixture.onReminder.mock.calls.filter(([item]) => item)).toHaveLength(2);
    });
    it('종료 전 확인 이력은 새로고침에도 유지하고 시작 전 이력과 구분한다', async () => {
        const first = setup({ time: '11:22:00', includeEnding: true });
        await settle();
        const ledger = createReminderLedger(first.storage, '검증 코치');
        expect(ledger.has('2026-10-16:1:ending')).toBe(true);
        expect(ledger.has('2026-10-16:1')).toBe(false);
        first.controller.dismiss('2026-10-16:1:ending');
        first.controller.stop();
        const second = setup({ time: '11:23:00', storage: first.storage, includeEnding: true });
        await settle();
        expect(second.onReminder).not.toHaveBeenCalled();
    });
    it('중간에 재등록한 사람은 종료 전 강제 조회의 빈 대상에 따라 다시 표시하지 않는다', async () => {
        const fixture = setup({ includeEnding: true });
        await settle();
        fixture.controller.dismiss('2026-10-16:1');
        fixture.loadSnapshot.mockResolvedValue(snapshot([], []));
        await vi.advanceTimersByTimeAsync(110 * 60_000);
        expect(fixture.loadSnapshot).toHaveBeenCalledTimes(2);
        expect(fixture.loadSnapshot).toHaveBeenLastCalledWith({ force: true });
        expect(fixture.onReminder.mock.calls.filter(([item]) => item?.phase === 'ending')).toHaveLength(0);
        expect(createReminderLedger(fixture.storage, '검증 코치').has('2026-10-16:1:ending')).toBe(false);
    });
    it('이전 명단이 비어 있어도 종료 전 시간 경계에서 새 대상을 조회한다', async () => {
        const loadSnapshot = vi.fn().mockResolvedValueOnce(snapshot([], [])).mockResolvedValue(snapshot());
        const fixture = setup({ time: '11:19:45', loadSnapshot, includeEnding: true });
        await settle();
        expect(fixture.onReminder).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(15_000);
        expect(loadSnapshot).toHaveBeenCalledTimes(2);
        expect(loadSnapshot).toHaveBeenLastCalledWith({ force: true });
        expect(fixture.onReminder).toHaveBeenLastCalledWith(expect.objectContaining({ key: '2026-10-16:1:ending', phase: 'ending' }));
    });
    it('오늘 페이지에 종료 직전 늦게 들어와도 기본 controller가 종료 전 단계를 표시한다', async () => {
        const fixture = setup({ time: '11:27:00' });
        await settle();
        expect(fixture.onReminder).toHaveBeenCalledWith(expect.objectContaining({ key: '2026-10-16:1:ending', phase: 'ending' }));
    });
    it('종료 전 단계 비활성화 시 기존 시작 전 안내만 사용한다', async () => {
        const fixture = setup({ time: '11:27:00', includeEnding: false });
        await settle();
        expect(fixture.onReminder).not.toHaveBeenCalled();
    });
    it('진행 중인 조회가 느려도 수업 종료 때 열린 팝업을 닫는다', async () => {
        const fixture = setup({ time: '11:29:45', includeEnding: true });
        await settle();
        expect(fixture.onReminder).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'ending' }));
        fixture.loadSnapshot.mockImplementation(() => new Promise(() => {}));
        void fixture.controller.refresh({ force: true });
        await vi.advanceTimersByTimeAsync(15_000);
        expect(fixture.onReminder).toHaveBeenLastCalledWith(null);
    });
    it('동시간의 종료 전·다음 수업 전 안내는 하나씩 각각 한 번 표시한다', async () => {
        const overlapping = { date: '2026-10-16', lessons: [
            { period: 4, startMinute: 1080, lastNames: ['4교시 회원'], delayedNames: [] },
            { period: 5, startMinute: 1190, lastNames: [], delayedNames: ['5교시 회원'] },
        ] };
        const fixture = setup({ time: '19:20:00', loadSnapshot: vi.fn(async () => overlapping), includeEnding: true });
        await settle();
        const first = fixture.onReminder.mock.calls.find(([item]) => item)[0];
        fixture.controller.dismiss(first.key);
        await vi.advanceTimersByTimeAsync(15_000);
        const displayed = fixture.onReminder.mock.calls.filter(([item]) => item).map(([item]) => item.key);
        expect(displayed.sort()).toEqual(['2026-10-16:4:ending', '2026-10-16:5']);
        const second = fixture.onReminder.mock.calls.filter(([item]) => item).at(-1)[0];
        fixture.controller.dismiss(second.key);
        await vi.advanceTimersByTimeAsync(30_000);
        expect(fixture.onReminder.mock.calls.filter(([item]) => item)).toHaveLength(2);
    });
});

describe('안내 API', () => {
    it('코치 토큰과 강제 갱신을 전달하고 실패 응답은 빈 명단으로 바꾸지 않는다', async () => {
        const fetchImpl = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => snapshot() }).mockResolvedValueOnce({ ok: false });
        const load = createCoachReminderLoader({ getToken: async () => 'fake-coach-token', functionsUrl: 'https://example.test/.netlify/functions/sheets', fetchImpl });
        expect(await load({ force: true })).toEqual(snapshot());
        expect(fetchImpl).toHaveBeenCalledWith('https://example.test/.netlify/functions/coach-renewal?refresh=1', expect.objectContaining({ headers: { Authorization: 'Bearer fake-coach-token' }, cache: 'no-store' }));
        await expect(load()).rejects.toThrow('불러오지 못했습니다');
    });
    it('코치 신원이 없으면 요청을 보내지 않는다', async () => {
        const fetchImpl = vi.fn();
        const load = createCoachReminderLoader({ getToken: async () => null, fetchImpl });
        await expect(load()).rejects.toThrow('코치 로그인');
        expect(fetchImpl).not.toHaveBeenCalled();
    });
});
