import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const io = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), getDocs: vi.fn(), getDoc: vi.fn(), setDoc: vi.fn() }));
vi.mock('../config/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
    collection: (db, path) => ({ path }),
    doc: (db, path, id) => ({ path: path ? `${path}/${id}` : `${db.path}/new-id` }),
    documentId: () => '__name__', query: (ref, ...constraints) => ({ ref, constraints }), where: (...args) => args,
    getDocsFromServer: io.getDocs, getDocFromServer: io.getDoc, setDoc: io.setDoc, serverTimestamp: () => 'server-time',
    runTransaction: (db, callback) => callback({ get: io.get, set: io.set }),
}));
import { assertRecruitmentOpen, getRecruitmentOverview, saveRecruitmentMonth, submitRecruitmentRegistration } from './recruitmentService';

const ec = { date: '2026-11-07', time: '10:00', isActive: true, maxCapacity: 6, currentCount: 1 };
const data = { name: '예시', recruitmentMonth: '2026-11', entranceClassId: 'ec1', entranceDate: ec.date, entranceInquiry: '' };
const snapshot = value => ({ exists: () => Boolean(value), data: () => value });
beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-06T03:00:00Z'));
    io.get.mockImplementation(async ref => snapshot(ref.path.startsWith('recruitmentMonths') ? { month: '2026-11', status: 'open' } : ec));
    io.getDocs.mockResolvedValue({ docs: [] });
});
afterEach(() => vi.useRealTimers());

describe('월별 모집 서비스의 실제 저장 경로', () => {
    it('모집월·입학반 확인이 끝나야 신청 문서가 저장된다', async () => {
        await submitRecruitmentRegistration(data);
        expect(io.get.mock.calls.map(([ref]) => ref.path)).toEqual(['recruitmentMonths/2026-11', 'entranceClasses/ec1']);
        expect(io.set).toHaveBeenCalledWith({ path: 'newStudentRegistrations/new-id' }, expect.objectContaining({ recruitmentMonth: '2026-11', status: 'pending', isWaitlist: false }));
    });
    it.each(['closed', 'inquiry'])('입력 중 %s 전환은 실제 쓰기 전에 거부한다', async status => {
        io.get.mockImplementation(async ref => snapshot(ref.path.startsWith('recruitmentMonths') ? { month: '2026-11', status } : ec));
        await expect(submitRecruitmentRegistration(data)).rejects.toThrow('모집');
        expect(io.set).not.toHaveBeenCalled();
    });
    it('입학반 날짜가 바뀐 경우도 실제 쓰기 전에 거부한다', async () => {
        io.get.mockImplementation(async ref => snapshot(ref.path.startsWith('recruitmentMonths') ? { month: '2026-11', status: 'open' } : { ...ec, date: '2026-11-14' }));
        await expect(submitRecruitmentRegistration(data)).rejects.toThrow('입학반');
        expect(io.set).not.toHaveBeenCalled();
    });
    it('조회 실패를 빈 모집 정보로 위장하거나 신청으로 처리하지 않는다', async () => {
        io.getDocs.mockRejectedValue(new Error('offline'));
        await expect(getRecruitmentOverview()).rejects.toThrow('offline');
        io.get.mockRejectedValue(new Error('offline'));
        await expect(submitRecruitmentRegistration(data)).rejects.toThrow('offline');
        expect(io.set).not.toHaveBeenCalled();
    });
    it('시작 버튼도 최신 서버의 마감을 확인한다', async () => {
        io.getDoc.mockResolvedValue(snapshot({ month: '2026-11', status: 'closed' }));
        await expect(assertRecruitmentOpen('2026-11')).rejects.toThrow('지금 신청');
    });
    it('입학반이 없는 월은 접수중으로 저장하지 않는다', async () => {
        await expect(saveRecruitmentMonth('2026-11', { status: 'open' })).rejects.toThrow('입학반');
        expect(io.setDoc).not.toHaveBeenCalled();
    });
    it('마감 저장은 기존 신청·입학반·운영 시트를 수정하지 않는다', async () => {
        await saveRecruitmentMonth('2026-11', { status: 'closed', notice: '이번 달 마감', inquiryPhone: '010-1234-5678' });
        expect(io.setDoc).toHaveBeenCalledExactlyOnceWith({ path: 'recruitmentMonths/2026-11' }, expect.objectContaining({ status: 'closed', inquiryPhone: '01012345678' }));
        expect(io.set).not.toHaveBeenCalled();
    });
});
