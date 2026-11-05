import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../../config/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({ doc: vi.fn((...parts) => parts.slice(1).join('/')), getDoc: vi.fn(), setDoc: vi.fn(), deleteField: () => 'DELETE', serverTimestamp: () => 'timestamp' }));
vi.mock('../../services/googleSheetsService', () => ({ readSheetData: vi.fn(), writeSheetData: vi.fn() }));
import { readSheetData, writeSheetData } from '../../services/googleSheetsService';
import { setDoc } from 'firebase/firestore';
import { saveCoachNote, confirmStudentPayment } from './todayService';

beforeEach(() => vi.clearAllMocks());
describe('오늘 업무 저장 대상 보호', () => {
    it('다른 수강생 메모를 덮지 않고 훈련일지와 같은 보호 문서에 병합', async () => {
        await saveCoachNote('가상학생', ' 메모 ');
        expect(setDoc).toHaveBeenCalledWith('coachNotes/notes', { map: { 가상학생: '메모' }, updatedAt: 'timestamp' }, { merge: true });
    });
    it('다른 결제월의 선택된 등록 J:L만 저장', async () => {
        readSheetData.mockResolvedValue([['가상학생', '', '', '', '', '', '', '', '', 'X']]);
        await confirmStudentPayment({ 이름: '가상학생', _foundSheetName: '등록생 목록(26년5월)', _rowIndex: 8 }, '2026-09-23', '카드');
        expect(writeSheetData).toHaveBeenCalledWith('등록생 목록(26년5월)!J11:L11', [['260923', 'O', '카드']]);
    });
    it('행이 바뀌었거나 이미 결제된 경우 저장 차단', async () => {
        readSheetData.mockResolvedValue([['다른사람', '', '', '', '', '', '', '', '', 'X']]);
        await expect(confirmStudentPayment({ 이름: '가상학생', _foundSheetName: '시트', _rowIndex: 0 }, '2026-09-23', '카드')).rejects.toThrow('변경');
        expect(writeSheetData).not.toHaveBeenCalled();
    });
});

it.each([
    [-1, '2026-09-23', '카드'],
    [0, '2026-02-30', '카드'],
    [0, '2026-09-23', '알수없음'],
])('잘못된 행/날짜/결제방식이면 원격 조회나 저장을 하지 않는다', async (row, date, method) => {
    await expect(confirmStudentPayment({ 이름: '가상학생', _foundSheetName: '등록생 목록(26년9월)', _rowIndex: row }, date, method)).rejects.toThrow('확인');
    expect(readSheetData).not.toHaveBeenCalled();
    expect(writeSheetData).not.toHaveBeenCalled();
});
it('선택 후 이미 결제된 등록은 다시 덮어쓰지 않는다', async () => {
    readSheetData.mockResolvedValue([['가상학생', '', '', '', '', '', '', '', '', 'O']]);
    await expect(confirmStudentPayment({ 이름: '가상학생', _foundSheetName: '시트', _rowIndex: 0 }, '2026-09-23', '카드')).rejects.toThrow('변경');
    expect(writeSheetData).not.toHaveBeenCalled();
});

describe('코치 첫 화면 체크리스트 체크', () => {
    it('수강생 목록(coachPinnedMemos)은 건드리지 않고 코치 전용 문서에만 쓴다', async () => {
        const { setDoc } = await import('firebase/firestore');
        const { setCoachChecklistCheck, checklistKey } = await import('./todayService');
        const at = await setCoachChecklistCheck('가상학생', { id: 'b', text: '둘' }, true);
        expect(at).toBeTruthy();
        expect(setDoc).toHaveBeenCalledWith('coachNotes/checklistChecks', { map: { 가상학생: { 'id:b': at } }, updatedAt: 'timestamp' }, { merge: true });
        await setCoachChecklistCheck('가상학생', { id: 'b', text: '둘' }, false);
        expect(setDoc).toHaveBeenLastCalledWith('coachNotes/checklistChecks', { map: { 가상학생: { 'id:b': 'DELETE' } }, updatedAt: 'timestamp' }, { merge: true });
        expect(setDoc.mock.calls.every(call => !String(call[0]).startsWith('coachPinnedMemos'))).toBe(true);
        expect(checklistKey({ exercise: '스쿼트', text: '아래로' })).toBe('t:스쿼트::아래로');
    });
});
