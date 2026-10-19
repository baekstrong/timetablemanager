import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
const save = createRequire(import.meta.url)('./lib/contractChange.cjs');
const sheetName = '등록생 목록(26년10월)';
const original = ['3', '검토회원', '2', '월4목1', '메모', '신규', '261019', '261112', '39', '261017', 'O', '카드', 'X', '', '', '', '', ''];
const id = 'contract-change-test-123';
const changed = [...original]; changed[2] = '4'; changed[3] = '월4수4목4금4'; changed[4] = `[계약변경이력:${encodeURIComponent(JSON.stringify({ v: 1, id, segments: [] }))}]`; changed[5] = '계약변경'; changed[7] = '261113'; changed[8] = '14';
const input = () => ({ name: '검토회원', targetSheet: sheetName, id, row: [...changed], retired: [{ sheetName, rowIndex: 2, expected: [...original], notes: `메모\n26.10.19에 주2회 → 주4회로 수강 변경 함\n[이전시간표:월4목1] [계약변경연결:${id}]` }] });
const mock = (rows = [original]) => ({ spreadsheets: {
    get: vi.fn(async () => ({ data: { sheets: [{ properties: { title: sheetName, sheetId: 7 } }] } })),
    values: { batchGet: vi.fn(async () => ({ data: { valueRanges: [{ values: [[], [], ...rows] }] } })) },
    batchUpdate: vi.fn(async () => ({ data: {} })),
} });

describe('계약변경 Sheets 원자적 저장', () => {
    it('D/E만 수정하고 appendCells를 같은 요청에 넣어 기존 G/H·결제를 보존한다', async () => {
        const sheets = mock(); await save(sheets, 'test', input());
        const requests = sheets.spreadsheets.batchUpdate.mock.calls[0][0].resource.requests;
        expect(requests).toHaveLength(2);
        expect(requests[0].updateCells.range).toMatchObject({ startColumnIndex: 3, endColumnIndex: 5 });
        expect(requests[0].updateCells.rows[0].values[0].userEnteredValue.stringValue).toBe('');
        expect(requests[1].appendCells.rows[0].values[5].userEnteredValue.stringValue).toBe('계약변경');
        expect(requests[1].appendCells.rows[0].values[8].userEnteredValue.numberValue).toBe(14);
        expect(requests[1].appendCells.rows[0].values[0].userEnteredValue.numberValue).toBe(4);
    });
    it('원본이 달라지면 한 칸도 쓰지 않는다', async () => {
        const modified = [...original]; modified[7] = '261116'; const sheets = mock([modified]);
        await expect(save(sheets, 'test', input())).rejects.toThrow('변경됐습니다');
        expect(sheets.spreadsheets.batchUpdate).not.toHaveBeenCalled();
    });
    it('응답 유실 후 같은 ID 요청에 새 행을 또 만들지 않는다', async () => {
        const retired = [...original]; retired[3] = ''; const sheets = mock([retired, changed]);
        expect(await save(sheets, 'test', input())).toMatchObject({ alreadySaved: true });
        expect(sheets.spreadsheets.batchUpdate).not.toHaveBeenCalled();
    });
    it('같은 ID로 다른 금액을 저장하려 하면 거부한다', async () => {
        const sheets = mock([original, changed]), data = input(); data.row[8] = '19';
        await expect(save(sheets, 'test', data)).rejects.toThrow('저장 내용이 다릅니다');
    });
    it('잘못된 위치·다른 학생·미보존 시간표 요청을 거부한다', async () => {
        for (const change of [data => data.retired[0].rowIndex = -1, data => data.name = '다른회원', data => data.retired[0].notes = '변경']) {
            const sheets = mock(), data = input(); change(data);
            await expect(save(sheets, 'test', data)).rejects.toThrow();
            expect(sheets.spreadsheets.batchUpdate).not.toHaveBeenCalled();
        }
    });
    it('API 실패는 성공으로 반환하지 않는다', async () => {
        const sheets = mock(); sheets.spreadsheets.batchUpdate.mockRejectedValue(new Error('통신 오류'));
        await expect(save(sheets, 'test', input())).rejects.toThrow('통신 오류');
    });
});
