import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('./firebaseService', () => ({ getActiveWaitlistRequests: vi.fn(), getHolidays: vi.fn(), acceptWaitlistRequest: vi.fn() }));
vi.mock('./googleSheetsService', () => ({ processScheduleTransfer: vi.fn() }));
import { getActiveWaitlistRequests, getHolidays, acceptWaitlistRequest } from './firebaseService';
import { processScheduleTransfer } from './googleSheetsService';
import { acceptScheduleTransfer } from './scheduleTransferService';

const student = { 이름: '예시학생', '요일 및 시간': '월1수1', _foundSheetName: '등록생 목록(26년9월)', _rowIndex: 3 };
const request = { id: 'transfer-1', studentName: '예시학생', status: 'notified', currentSlot: { day: '월', period: '1' }, desiredSlot: { day: '화', period: '2' } };
beforeEach(() => {
    vi.resetAllMocks();
    getActiveWaitlistRequests.mockResolvedValue([request]);
    getHolidays.mockResolvedValue([{ date: '2026-10-09' }]);
    processScheduleTransfer.mockResolvedValue({ newEndDate: '261030' });
});
describe('첫 화면 고정 시간표 변경 승인', () => {
    it('최신 코치 승인과 본인 등록을 확인하고 시트 저장 이후 완료 처리한다', async () => {
        expect(await acceptScheduleTransfer('예시학생', request.id, student)).toEqual({ currentSchedule: '월1수1', newSchedule: '화2수1', newEndDate: '261030' });
        expect(getActiveWaitlistRequests).toHaveBeenCalledWith('예시학생');
        expect(processScheduleTransfer).toHaveBeenCalledWith('예시학생', '화2수1', [{ date: '2026-10-09' }], { preferredSheetName: student._foundSheetName, preferredRowIndex: 3 });
        expect(acceptWaitlistRequest).toHaveBeenCalledWith(request.id);
        expect(processScheduleTransfer.mock.invocationCallOrder[0]).toBeLessThan(acceptWaitlistRequest.mock.invocationCallOrder[0]);
    });
    it.each(['waiting', 'cancelled', 'accepted'])('승인이 철회되거나 이미 처리된 %s는 저장하지 않는다', async status => {
        getActiveWaitlistRequests.mockResolvedValue([{ ...request, status }]);
        await expect(acceptScheduleTransfer('예시학생', request.id, student)).rejects.toThrow('승인 상태');
        expect(processScheduleTransfer).not.toHaveBeenCalled();
    });
    it.each([null, { ...student, 이름: '다른학생' }, { ...student, '요일 및 시간': '목1금1' }, { ...student, '요일 및 시간': '월1화1' }])('잘못된 본인 등록이나 원래 수업 불일치는 저장을 막는다', async row => {
        await expect(acceptScheduleTransfer('예시학생', request.id, row)).rejects.toThrow();
        expect(processScheduleTransfer).not.toHaveBeenCalled();
    });
    it('공휴일 조회 실패 때 임의 종료일을 쓰지 않는다', async () => {
        getHolidays.mockRejectedValue(new Error('조회 실패'));
        await expect(acceptScheduleTransfer('예시학생', request.id, student)).rejects.toThrow('조회 실패');
        expect(processScheduleTransfer).not.toHaveBeenCalled();
        expect(acceptWaitlistRequest).not.toHaveBeenCalled();
    });
    it('시트 저장 실패는 승인 완료로 표시하지 않는다', async () => {
        processScheduleTransfer.mockRejectedValue(new Error('저장 실패'));
        await expect(acceptScheduleTransfer('예시학생', request.id, student)).rejects.toThrow('저장 실패');
        expect(acceptWaitlistRequest).not.toHaveBeenCalled();
    });
});
