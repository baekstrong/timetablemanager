import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
const { checkStudentWrite, parseRowRange } = createRequire(import.meta.url)('./_sheetOwnership.js');

const SHEET = '등록생 목록(26년11월)';
// 5행 = 김기안, 6행 = 홍길동, 7행 = 빈 행
const OWNERS = { 5: '김기안', 6: '홍길동', 7: '' };
const readNames = vi.fn(async ranges => ranges.map(r => OWNERS[Number(r.match(/B(\d+)$/)[1])] ?? ''));
const values = items => ({ kind: 'values', items });

describe('수강생 시트 쓰기는 본인 행만', () => {
    it.each([
        ['홀딩: 본인 행 M/N/O/H', [{ range: `${SHEET}!M5`, values: [['O']] }, { range: `${SHEET}!N5:O5`, values: [['261105', '261106']] }, { range: `${SHEET}!H5`, values: [['261210']] }]],
        ['시간표 변경: D/G', [{ range: `${SHEET}!D5`, values: [['화4목4']] }, { range: `${SHEET}!G5`, values: [['261110']] }]],
        ['이름 앞뒤 공백', [{ range: `${SHEET}!H5`, values: [['261210']] }]],
    ])('%s → 허용', async (_label, items) => {
        expect(await checkStudentWrite(values(items), ' 김기안 ', readNames)).toBeNull();
    });

    it('재등록 계약: 빈 행에 본인 이름으로 A:R 한 줄 → 허용', async () => {
        const row = Array(18).fill(''); row[1] = '김기안';
        expect(await checkStudentWrite(values([{ range: `${SHEET}!A7:R7`, values: [row] }]), '김기안', readNames)).toBeNull();
    });

    it.each([
        ['남의 행', [{ range: `${SHEET}!H6`, values: [['261231']] }]],
        ['본인 행 결제유무(K)', [{ range: `${SHEET}!K5`, values: [['O']] }]],
        ['본인 행 이름(B)', [{ range: `${SHEET}!B5`, values: [['홍길동']] }]],
        ['본인 행 연락처까지(A:R)', [{ range: `${SHEET}!A5:R5`, values: [Array(18).fill('')] }]],
        ['빈 행에 남의 이름', [{ range: `${SHEET}!A7:R7`, values: [['', '홍길동']] }]],
        ['빈 행 일부 칸', [{ range: `${SHEET}!H7`, values: [['261231']] }]],
        ['여러 행 범위', [{ range: `${SHEET}!H5:H6`, values: [['1'], ['2']] }]],
        ['열 전체', [{ range: `${SHEET}!A:R`, values: [] }]],
        ['헤더 행', [{ range: `${SHEET}!H2`, values: [['x']] }]],
        ['본인 행과 남의 행 섞임', [{ range: `${SHEET}!H5`, values: [['1']] }, { range: `${SHEET}!H6`, values: [['1']] }]],
    ])('%s → 거부', async (_label, items) => {
        expect(await checkStudentWrite(values(items), '김기안', readNames)).toEqual(expect.any(String));
    });

    it('색칠: 본인 행은 어느 열이든, 남의 행은 거부', async () => {
        expect(await checkStudentWrite({ kind: 'format', sheetName: SHEET, items: [{ range: 'J5' }, { range: 'K5' }] }, '김기안', readNames)).toBeNull();
        expect(await checkStudentWrite({ kind: 'format', sheetName: SHEET, items: [{ range: 'H6' }] }, '김기안', readNames)).toEqual(expect.any(String));
    });

    it('이름 확인은 한 번에 모아 읽는다', async () => {
        readNames.mockClear();
        await checkStudentWrite(values([{ range: `${SHEET}!M5`, values: [['O']] }, { range: `${SHEET}!H5`, values: [['1']] }]), '김기안', readNames);
        expect(readNames).toHaveBeenCalledTimes(1);
        expect(readNames.mock.calls[0][0]).toEqual([`'${SHEET}'!B5`]);
    });

    it('따옴표 시트 이름도 읽는다', () => {
        expect(parseRowRange("'A''s'!H12")).toEqual({ sheet: "A's", row: 12, c1: 7, c2: 7 });
    });
});
