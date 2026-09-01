// 시트 쓰기 경로의 "왕복 횟수" 회귀 테스트.
//
// 이 경로들은 예전에 등록생 시트를 하나씩 읽고(탭 수만큼 왕복) 행마다 따로 썼다.
// 프로덕션 왕복 1회가 ≈0.73초라 버튼 한 번이 12초를 넘었다. 고친 뒤에도 누가
// 반복문 안에 readSheetData/writeSheetData를 다시 넣으면 조용히 되돌아가므로,
// 동작이 아니라 **호출 횟수**를 못 박아 둔다.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { clearStudentScheduleAllSheets, pauseStudent } from './googleSheetsService';

const SHEETS = ['등록생 목록(26년8월)', '등록생 목록(26년7월)', '등록생 목록(26년6월)'];

// A~R 헤더 (2행). 인덱스: 1=이름, 2=주횟수, 3=요일및시간, 4=특이사항, 6=시작날짜, 7=종료날짜
const HEADERS = ['번호', '이름', '주횟수', '요일 및 시간', '특이사항', '신규/재등록',
    '시작날짜', '종료날짜', '결제금액', '결제일', '결제유무', '결제방식',
    '홀딩 사용여부', '홀딩 시작일', '홀딩 종료일', '핸드폰', '성별', '직업'];

const row = ({ name, schedule = '월1수1', start = '', end = '' }) => {
    const r = Array(18).fill('');
    r[1] = name; r[2] = '2'; r[3] = schedule; r[6] = start; r[7] = end;
    return r;
};

// 시트별 데이터: 홍길동은 8월·6월 두 시트에 등록이 있다
const SHEET_ROWS = {
    '등록생 목록(26년8월)': [Array(18).fill(''), HEADERS,
        row({ name: '아무개' }),
        row({ name: '홍길동', start: '260801', end: '260901' })],
    '등록생 목록(26년7월)': [Array(18).fill(''), HEADERS,
        row({ name: '아무개' })],
    '등록생 목록(26년6월)': [Array(18).fill(''), HEADERS,
        row({ name: '홍길동', start: '260601', end: '260701' })],
};

let calls;

/** 호출된 엔드포인트만 뽑아 센다. */
const countOf = (path) => calls.filter(c => c.path === path).length;

beforeEach(() => {
    calls = [];
    global.fetch = vi.fn(async (url, options) => {
        const u = String(url);
        const path = u.includes('/batchGet') ? 'batchGet'
            : u.includes('/batchUpdate') ? 'batchUpdate'
                : u.includes('/read') ? 'read'
                    : u.includes('/write') ? 'write'
                        : u.includes('/info') ? 'info'
                            : u.includes('/formatCells') ? 'formatCells'
                                : 'other';
        const body = options?.body ? JSON.parse(options.body) : null;
        calls.push({ path, body });

        const json = (o) => ({ ok: true, status: 200, json: async () => ({ success: true, ...o }) });

        if (path === 'info') return json({ sheets: SHEETS });
        if (path === 'batchGet') {
            return json({
                valueRanges: body.ranges.map(r => {
                    const name = r.split('!')[0];
                    return { range: r, values: SHEET_ROWS[name] || [] };
                }),
            });
        }
        if (path === 'read') {
            const name = decodeURIComponent(u.split('range=')[1] || '').split('!')[0];
            return json({ values: SHEET_ROWS[name] || [] });
        }
        return json({});
    });
});

describe('clearStudentScheduleAllSheets (수강 종료) — 왕복 횟수', () => {
    it('시트가 몇 개든 batchGet 1회 + batchUpdate 1회로 끝난다', async () => {
        await clearStudentScheduleAllSheets('홍길동');

        expect(countOf('batchGet')).toBe(1);
        expect(countOf('batchUpdate')).toBe(1);
        // 개별 읽기·쓰기로 되돌아가면 실패한다
        expect(countOf('read')).toBe(0);
        expect(countOf('write')).toBe(0);
    });

    it('여러 시트에 걸친 행을 한 요청에 모아 지운다', async () => {
        await clearStudentScheduleAllSheets('홍길동');

        const upd = calls.find(c => c.path === 'batchUpdate').body.data;
        expect(upd).toHaveLength(2); // 8월 4행 + 6월 3행
        expect(upd.map(u => u.range).sort()).toEqual([
            '등록생 목록(26년6월)!D3',
            '등록생 목록(26년8월)!D4',
        ]);
        upd.forEach(u => expect(u.values).toEqual([['']]));
    });

    it('해당 학생이 없으면 아무것도 쓰지 않는다', async () => {
        await clearStudentScheduleAllSheets('없는사람');
        expect(countOf('batchUpdate')).toBe(0);
    });
});

describe('pauseStudent (일시정지) — 왕복 횟수', () => {
    it('등록이 여러 시트에 있어도 batchGet 1회 + batchUpdate 1회', async () => {
        await pauseStudent('홍길동', []);

        expect(countOf('batchGet')).toBe(1);
        expect(countOf('batchUpdate')).toBe(1);
        expect(countOf('read')).toBe(0);
        expect(countOf('write')).toBe(0);
    });

    it('정지할 등록이 없으면 던지고, 시트에 쓰지 않는다', async () => {
        await expect(pauseStudent('없는사람', [])).rejects.toThrow('정지할 등록을 찾지 못했습니다.');
        expect(countOf('batchUpdate')).toBe(0);
    });
});
