import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../../config/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({ doc: vi.fn((...parts) => parts.slice(1).join('/')), getDoc: vi.fn(), setDoc: vi.fn(), runTransaction: vi.fn((_db, fn) => globalThis.__tx(fn)), serverTimestamp: () => 'timestamp' }));
vi.mock('../../services/googleSheetsService', () => ({ readSheetData: vi.fn(), writeSheetData: vi.fn() }));
import { readSheetData, writeSheetData } from '../../services/googleSheetsService';
import { confirmStudentPayment } from './todayService';

beforeEach(() => vi.clearAllMocks());
describe('오늘 업무 저장 대상 보호', () => {
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
    it('최신 문서에서 id로 찾아 done만 바꾸고 다른 항목은 그대로 둔다', async () => {
        const memos = [{ id: 'a', exercise: '스쿼트', memo: '하나' }, { id: 'b', exercise: '벤치', memo: '둘' }];
        const set = vi.fn();
        globalThis.__tx = fn => fn({ get: async () => ({ exists: () => true, data: () => ({ memos }) }), set });
        const { setChecklistDone } = await import('./todayService');
        const next = await setChecklistDone('가상학생', { id: 'b', index: 1, text: '둘' }, true);
        expect(next[0]).toEqual(memos[0]);
        expect(next[1]).toMatchObject({ id: 'b', done: true });
        expect(next[1].doneAt).toBeTruthy();
        expect(set.mock.calls[0][0]).toBe('coachPinnedMemos/가상학생');
        await expect(setChecklistDone('가상학생', { index: 5, text: '없음' }, true)).rejects.toThrow('바뀌었');
    });
});
