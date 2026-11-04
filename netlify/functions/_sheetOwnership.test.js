import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
const { checkStudentWrite, parseRowRange, contractRow } = createRequire(import.meta.url)('./_sheetOwnership.js');

const SHEET = '등록생 목록(26년11월)';
// 5행 = 김기안, 6행 = 홍길동, 7행 = 빈 행, 8행 = 이름만 빈 행(다른 칸에 값)
const ROWS = { 5: ['1', '김기안'], 6: ['2', '홍길동'], 7: [], 8: ['3', '', '2'] };
const readNames = vi.fn(async ranges => ranges.map(r => ROWS[Number(r.match(/R(\d+)$/)[1])] ?? []));
const CONTRACT = { 이름: '김기안', 주횟수: '2', '요일 및 시간': '월1수1', 특이사항: '', 시작날짜: '261201', 종료날짜: '261224',
    결제금액: '31', 결제일: '', 결제유무: 'X', 결제방식: '', '홀딩 사용여부': 'X', 핸드폰: '010-0000-0000', 성별: '남', 직업: '' };
const expected = async sheet => (sheet === SHEET ? contractRow(CONTRACT) : null);
const notYet = async () => false;
const agreedRow = (patch = {}) => { const row = contractRow({ ...CONTRACT, ...patch }); row[0] = '42'; return row; };
const values = items => ({ kind: 'values', items });

describe('수강생 시트 쓰기는 본인 행만', () => {
    it.each([
        ['홀딩: 본인 행 M/N/O/H', [{ range: `${SHEET}!M5`, values: [['O(1/3)']] }, { range: `${SHEET}!N5:O5`, values: [['261105', '261106']] }, { range: `${SHEET}!H5`, values: [[261210]] }]],
        ['홀딩 취소: 빈칸으로', [{ range: `${SHEET}!N5`, values: [['']] }, { range: `${SHEET}!M5`, values: [['X']] }]],
        ['메모', [{ range: `${SHEET}!E5`, values: [['26.2.10 결석']] }]],
        ['시간표 변경: D/G', [{ range: `${SHEET}!D5`, values: [['화4목4']] }, { range: `${SHEET}!G5`, values: [['261110']] }]],
        ['이름 앞뒤 공백', [{ range: `${SHEET}!H5`, values: [['261210']] }]],
    ])('%s → 허용', async (_label, items) => {
        expect(await checkStudentWrite(values(items), ' 김기안 ', readNames)).toBeNull();
    });

    it('재등록 계약: 빈 행에 계약서와 같은 A:R 한 줄 → 허용', async () => {
        expect(await checkStudentWrite(values([{ range: `${SHEET}!A7:R7`, values: [agreedRow()] }]), '김기안', readNames, expected, notYet)).toBeNull();
    });

    it('재등록 계약: 이미 같은 재등록 행이 있으면(재전송) 거부', async () => {
        expect(await checkStudentWrite(values([{ range: `${SHEET}!A7:R7`, values: [agreedRow()] }]), '김기안', readNames, expected, async () => true)).toMatch('이미');
    });

    it.each([
        ['H에 수식 아닌 이상한 값', 'H5', '1+1'],
        ['M에 임의 문자', 'M5', 'IMPORTXML'],
        ['D에 수식', 'D5', '=A1'],
        ['E에 + 시작', 'E5', '+SUM(1)'],
        ['E에 공백 뒤 =', 'E5', '  =1'],
    ])('열 형식 위반: %s → 거부', async (_label, cell, v) => {
        expect(await checkStudentWrite(values([{ range: `${SHEET}!${cell}`, values: [[v]] }]), '김기안', readNames)).toEqual(expect.any(String));
    });

    it.each([
        ['결제유무를 O로 바꿈', agreedRow({ 결제유무: 'O' }), 7, SHEET],
        ['계약서 없는 탭', agreedRow(), 7, '등록생 목록(26년10월)'],
        ['이름만 빈 행(다른 칸 값 있음)', agreedRow(), 8, SHEET],
    ])('재등록 계약 위조: %s → 거부', async (_label, row, r, sheet) => {
        expect(await checkStudentWrite(values([{ range: `${sheet}!A${r}:R${r}`, values: [row] }]), '김기안', readNames, expected, notYet)).toEqual(expect.any(String));
    });

    it('수식·등록생 목록 밖 탭 → 거부', async () => {
        expect(await checkStudentWrite(values([{ range: `${SHEET}!E5`, values: [['=IMPORTRANGE("x","A1")']] }]), '김기안', readNames)).toMatch('수식');
        expect(await checkStudentWrite(values([{ range: `${SHEET}!E5`, values: [['-A1']] }]), '김기안', readNames)).toMatch('수식');
        expect(await checkStudentWrite(values([{ range: '집계!H5', values: [['1']] }]), '김기안', readNames)).toMatch('탭');
    });

    it.each([
        ['남의 행', [{ range: `${SHEET}!H6`, values: [['261231']] }]],
        ['본인 행 결제유무(K)', [{ range: `${SHEET}!K5`, values: [['O']] }]],
        ['본인 행 이름(B)', [{ range: `${SHEET}!B5`, values: [['홍길동']] }]],
        ['본인 행 연락처까지(A:R)', [{ range: `${SHEET}!A5:R5`, values: [Array(18).fill('')] }]],
        ['빈 행에 남의 이름', [{ range: `${SHEET}!A7:R7`, values: [['1', '홍길동']] }]],
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
        expect(readNames.mock.calls[0][0]).toEqual([`'${SHEET}'!A5:R5`]);
    });

    it('따옴표 시트 이름도 읽는다', () => {
        expect(parseRowRange("'A''s'!H12")).toEqual({ sheet: "A's", row: 12, c1: 7, c2: 7 });
    });
});
