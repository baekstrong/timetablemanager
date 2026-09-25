import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sheet = '등록생 목록(26년 9월)';
const headers = ['번호', '이름', '주횟수', '요일 및 시간', '특이사항', '신규/재등록', '시작날짜', '종료날짜', '결제금액', '결제일', '결제유무', '결제방식', '홀딩 사용여부', '홀딩 시작일', '홀딩 종료일'];
const rows = [[], headers,
    ['1', '예시 수강생', '2', '화5목5', '', '재등록', '260901', '260930', '', '', '', '', 'O(1/2)', '260917', '260917'],
    ['2', '예시 수강생', '3', '월1수2금4', '', '재등록', '261005', '261102', '', '', '', '', 'O', '261005', '261005'],
];

describe('홀딩 취소의 대상 등록', () => {
    let updates;
    beforeEach(() => {
        vi.resetModules();
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-16T09:00:00'));
        updates = [];
        // 실제 네트워크로 나갈 수 없도록 모든 fetch를 모의 처리한다.
        vi.stubGlobal('fetch', vi.fn(async (url, options) => {
            const body = options?.body ? JSON.parse(options.body) : {};
            let payload;
            if (url.endsWith('/info')) payload = { sheets: [sheet] };
            else if (url.endsWith('/batchGet')) payload = { valueRanges: body.ranges.map(range => ({ range, values: rows })) };
            else if (url.endsWith('/batchUpdate')) { updates.push(...body.data); payload = {}; }
            else if (url.endsWith('/highlight')) payload = {};
            else throw new Error(`Unexpected mock request: ${url}`);
            return { status: 200, json: async () => ({ success: true, ...payload }) };
        }));
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });
    afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

    it('다음 등록 날짜의 홀딩 취소는 현재 등록의 횟수·종료일을 건드리지 않는다', async () => {
        const { cancelHoldingInSheets } = await import('./googleSheetsService');
        await cancelHoldingInSheets('예시 수강생', [], [], [], new Date('2026-10-05T00:00:00'));
        expect(updates).toHaveLength(4);
        expect(updates.every(item => item.range.endsWith('4'))).toBe(true);
        expect(updates.find(item => item.range.endsWith('M4')).values).toEqual([['X']]);
        expect(updates.some(item => item.range.endsWith('M3') || item.range.endsWith('H3'))).toBe(false);
    });
    it('날짜 인자가 없는 기존 호출은 오늘 등록의 사용 횟수를 돌려준다', async () => {
        const { cancelHoldingInSheets } = await import('./googleSheetsService');
        await cancelHoldingInSheets('예시 수강생');
        expect(updates.find(item => item.range.endsWith('M3')).values).toEqual([['X(0/2)']]);
        expect(updates.some(item => item.range.endsWith('M4'))).toBe(false);
    });
});
