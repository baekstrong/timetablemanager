import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const io = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), getDocs: vi.fn(), update: vi.fn(), remove: vi.fn() }));
vi.mock('../config/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
    collection: (_, path) => ({ path }), doc: (_, path, id) => ({ path: `${path}/${id}` }),
    getDocsFromServer: io.getDocs, updateDoc: io.update, deleteDoc: io.remove,
    serverTimestamp: () => 'server-time', runTransaction: (_, callback) => callback({ get: io.get, set: io.set }),
}));
import { validateConsultation, submitConsultation, getConsultations, completeConsultation } from './consultationService';

const slots = ['월', '화', '수', '목'].map(day => ({ day, period: 1 }));
const data = { requestedSlots: slots, name: ' 예시 ', phone: '010-0000-0000', recruitmentMonth: '2026-11', message: '상담 원합니다', wantsFourTimes: true };
beforeEach(() => {
    vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-20T03:00:00Z'));
    io.get.mockResolvedValue({ exists: () => true, data: () => ({ month: '2026-11', status: 'open' }) });
});
afterEach(() => vi.useRealTimers());
describe('수강 신청과 분리된 상담 접수', () => {
    it('희망 시간은 상담 문서에만 저장하고 주횟수/결제/비밀번호를 제외한다', async () => {
        await submitConsultation({ ...data, weeklyFrequency: 4, password: 'test' }, 'request-1');
        expect(io.get).toHaveBeenCalledTimes(1);
        expect(io.set).toHaveBeenCalledWith({ path: 'recruitmentConsultations/request-1' }, {
            name: '예시', phone: '01000000000', recruitmentMonth: '2026-11', message: '상담 원합니다', wantsFourTimes: true,
            requestedSlots: slots, status: 'pending', createdAt: 'server-time', updatedAt: 'server-time',
        });
    });
    it('상담 글에 주4회가 있어도 체크하지 않았다면 희망 표시를 추측하지 않는다', async () => {
        await submitConsultation({ ...data, message: '주4회가 궁금합니다', wantsFourTimes: false, requestedSlots: [] }, 'request-2');
        expect(io.set.mock.calls[0][1].wantsFourTimes).toBe(false);
    });
    it.each(['closed', 'inquiry'])('작성 중 %s 전환은 저장 전에 차단한다', async status => {
        io.get.mockResolvedValue({ exists: () => true, data: () => ({ month: '2026-11', status }) });
        await expect(submitConsultation(data, 'request-1')).rejects.toThrow('마감');
        expect(io.set).not.toHaveBeenCalled();
    });
    it.each([{ requestedSlots: [] }, { requestedSlots: slots.slice(0, 3) }, { requestedSlots: [slots[0], slots[0], ...slots.slice(2)] }, { requestedSlots: slots.map(s => ({ ...s, period: 3 })) }, { requestedSlots: null }, { name: ' ' }, { phone: '01012' }, { recruitmentMonth: '2026-09' }, { message: 'x'.repeat(1001) }])('잘못된 필수 정보는 조회·쓰기 전에 거부한다: %j', async change => {
        expect(() => validateConsultation({ ...data, ...change })).toThrow();
        await expect(submitConsultation({ ...data, ...change }, 'bad')).rejects.toThrow();
        expect(io.get).not.toHaveBeenCalled(); expect(io.set).not.toHaveBeenCalled();
    });
    it('조회 실패가 접수 성공이 되지 않는다', async () => {
        io.get.mockRejectedValue(new Error('offline'));
        await expect(submitConsultation(data, 'request-1')).rejects.toThrow('offline');
        expect(io.set).not.toHaveBeenCalled();
    });
    it('대기 상담을 완료 상담보다 먼저 표시하고 완료 처리는 상담 문서만 수정한다', async () => {
        io.getDocs.mockResolvedValue({ docs: [{ id: 'done', data: () => ({ status: 'completed' }) }, { id: 'waiting', data: () => ({ status: 'pending' }) }] });
        expect((await getConsultations()).map(r => r.id)).toEqual(['waiting', 'done']);
        await completeConsultation('waiting');
        expect(io.update).toHaveBeenCalledWith({ path: 'recruitmentConsultations/waiting' }, { status: 'completed', updatedAt: 'server-time' });
    });

});
