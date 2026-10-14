import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const oldSheet = '등록생 목록(26년1월)';
const recentSheet = '등록생 목록(26년10월)';
const headers = ['번호', '이름', '주횟수', '요일 및 시간', '특이사항', '신규/재등록', '시작날짜', '종료날짜', '결제금액'];
const pausedRow = remaining => ['', '정지회원', '2', '', '[정지:2/월1수1/260101]', '신규', '260101', `${remaining}회`, '31'];
const activeRow = ['', '재개회원', '2', '월1수1', '', '신규', '261001', '261031', '31'];
const nextRow = ['', '재개회원', '2', '월1수1', '', '재등록', '261101', '261130', '31'];
const response = (data, status = 200) => ({ status, json: async () => ({ success: status === 200, ...data }) });
let service, reads, oldRemaining, holdOld, failOld, releaseOld;

beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 14, 9));
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    reads = []; oldRemaining = 5; holdOld = false; failOld = false; releaseOld = null;
    vi.stubGlobal('fetch', vi.fn(async (url, options) => {
        if (String(url).endsWith('/info')) return response({ sheets: [oldSheet, recentSheet] });
        if (String(url).endsWith('/batchUpdate')) return response({});
        expect(String(url)).toMatch(/\/batchGet$/);
        const ranges = JSON.parse(options.body).ranges;
        reads.push(ranges);
        const isOldPartial = ranges.includes(`${oldSheet}!B:H`);
        if (isOldPartial && failOld) return response({ error: 'past unavailable' }, 503);
        const result = response({ valueRanges: ranges.map(range => {
            const old = range.startsWith(oldSheet);
            const rows = [[], headers, ...(old ? [pausedRow(oldRemaining), activeRow] : [nextRow])];
            return { range, values: range.endsWith('!B:H') ? rows.map(row => row.slice(1, 8)) : rows };
        }) });
        if (isOldPartial && holdOld) {
            holdOld = false;
            return new Promise(resolve => { releaseOld = () => resolve(result); });
        }
        return result;
    }));
    service = await import('./googleSheetsService');
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const partialReads = () => reads.filter(ranges => ranges.includes(`${oldSheet}!B:H`)).length;

it('동시 명단 조회를 합치고 30초 내 반복 조회는 과거 시트도 캐시한다', async () => {
    holdOld = true;
    const first = service.getAllStudentsFromAllSheets();
    const second = service.getAllStudentsFromAllSheets();
    await vi.waitFor(() => expect(releaseOld).toBeTypeOf('function'));
    expect(partialReads()).toBe(1);
    releaseOld();
    const [one, two] = await Promise.all([first, second]);
    expect(one.find(row => row['이름'] === '정지회원')._pausedTotal).toBe(5);
    expect(two).toEqual(one);
    one.find(row => row['이름'] === '정지회원')['종료날짜'] = '99회';
    const repeated = await service.getAllStudentsFromAllSheets();
    expect(repeated.find(row => row['이름'] === '정지회원')._pausedTotal).toBe(5);
    expect(partialReads()).toBe(1);
    vi.setSystemTime(new Date(2026, 9, 14, 9, 0, 31));
    await service.getAllStudentsFromAllSheets();
    expect(partialReads()).toBe(2);
});

it('쓰기 전의 과거 응답이 늦게 와도 최신 잔여를 반환하고 캐시를 되돌리지 않는다', async () => {
    holdOld = true;
    const oldRequest = service.getAllStudentsFromAllSheets();
    await vi.waitFor(() => expect(releaseOld).toBeTypeOf('function'));
    oldRemaining = 3;
    await service.batchUpdateSheet([{ range: `${oldSheet}!H3`, values: [['3회']] }]);
    const latest = await service.getAllStudentsFromAllSheets();
    releaseOld();
    const beforeWrite = await oldRequest;
    expect(latest.find(row => row['이름'] === '정지회원')._pausedTotal).toBe(3);
    expect(beforeWrite.find(row => row['이름'] === '정지회원')._pausedTotal).toBe(3);
    expect((await service.getAllStudentsFromAllSheets()).find(row => row['이름'] === '정지회원')._pausedTotal).toBe(3);
    expect(partialReads()).toBe(2);
});

it('과거 부분 조회 실패를 빈 정상 캐시로 남기지 않아 다음 조회에서 복구한다', async () => {
    failOld = true;
    await expect(service.getAllStudentsFromAllSheets()).rejects.toThrow('past unavailable');
    failOld = false;
    const result = await service.getAllStudentsFromAllSheets();
    expect(result.find(row => row['이름'] === '정지회원')._pausedTotal).toBe(5);
    expect(partialReads()).toBe(2);
});

it('과거 B:H 캐시가 있어도 본인 현재 등록은 A:R로 확인하여 연락·결제 필드를 보존한다', async () => {
    await service.getAllStudentsFromAllSheets();
    const result = await service.findStudentAcrossSheets('재개회원', { requireActive: true });
    expect(result.foundSheetName).toBe(oldSheet);
    expect(result.student['결제금액']).toBe('31');
    expect(result.student._nextRegistration['시작날짜']).toBe('261101');
    expect(reads.filter(ranges => ranges.includes(`${oldSheet}!A:R`))).toHaveLength(1);
});
