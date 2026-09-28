import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { buildStudentWeek, sourceUnavailableReason, studentWeekDays } from '../components/schedule/studentClassModel';

const oldSheet = '등록생 목록(26년6월)';
const newSheet = '등록생 목록(26년9월)';
const headers = ['번호', '이름', '주횟수', '요일 및 시간', '특이사항', '신규/재등록', '시작날짜', '종료날짜', '결제금액', '결제일', '결제유무', '결제방식', '홀딩 사용여부'];
const rows = {
    [oldSheet]: [[], headers, ['', '재개회원', '2', '월4수5', '', '신규', '260928', '261026', '', '', '', '', 'X']],
    [newSheet]: [[], headers, ['', '재개회원', '2', '월4수5', '', '재등록', '261028', '261123', '', '', '', '', 'X']],
};
let service;
let reads;
let failOld;
const now = new Date(2026, 8, 28, 9);
beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    reads = [];
    failOld = false;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async (url, options) => {
        const response = (data, status = 200) => ({ status, json: async () => data });
        if (String(url).endsWith('/info')) return response({ success: true, sheets: [oldSheet, newSheet] });
        expect(String(url)).toMatch(/\/batchGet$/);
        const ranges = JSON.parse(options.body).ranges;
        reads.push(ranges);
        if (failOld && ranges.some(range => range.startsWith(oldSheet))) return response({ error: 'past sheet unavailable' }, 503);
        return response({ success: true, valueRanges: ranges.map(range => ({ range, values: rows[range.split('!')[0]] })) });
    }));
    service = await import('./googleSheetsService');
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('오래된 재개 등록을 선택하고 추가 등록과 이번 주 보강 원수업을 보존한다', async () => {
    const result = await service.findStudentAcrossSheets('재개회원', { requireActive: true });
    expect(result.foundSheetName).toBe(oldSheet);
    expect(result.student['시작날짜']).toBe('260928');
    expect(result.student['종료날짜']).toBe('261026');
    expect(result.student._nextRegistration).toMatchObject({ 시작날짜: '261028', 종료날짜: '261123', _foundSheetName: newSheet });
    expect(reads).toEqual([[`${newSheet}!A:R`], [`${oldSheet}!A:R`]]);
    const sessions = buildStudentWeek({ days: studentWeekDays({ 월: '9/28' }, 0, now), studentData: result.student, studentName: '재개회원' });
    expect(sessions.map(s => `${s.date}/${s.period}`)).toEqual(['2026-09-28/4', '2026-09-30/5']);
    expect(sessions.every(s => !sourceUnavailableReason(s, { now, quotaLimit: 2 }))).toBe(true);
    await service.findStudentAcrossSheets('재개회원', { requireActive: true });
    expect(reads).toHaveLength(2); // 재조회는 시트 캐시 공유
});

it('과거 등록 조회 실패를 미래 등록만 있는 정상 결과로 숨기지 않는다', async () => {
    failOld = true;
    await expect(service.findStudentAcrossSheets('재개회원', { requireActive: true })).rejects.toThrow('past sheet unavailable');
});

it('오늘 활성 등록이 최근 시트에 있으면 과거 전체 조회를 추가하지 않는다', async () => {
    vi.setSystemTime(new Date(2026, 9, 28, 9));
    const result = await service.findStudentAcrossSheets('재개회원', { requireActive: true });
    expect(result.student['시작날짜']).toBe('261028');
    expect(reads).toEqual([[`${newSheet}!A:R`]]);
});

it('미리 등록이 두 건이면 세 번째 등록과 등록별 계산 필드까지 보존한다', async () => {
    rows[newSheet].push(['', '재개회원', '3', '월1수2금4', '26.12.2 결석', '재등록', '261125', '261223', '', '', '', '', 'O(1/2)']);
    try {
        const result = await service.findStudentAcrossSheets('재개회원', { requireActive: true });
        expect(result.student._upcomingRegistrations).toHaveLength(2);
        expect(result.student._upcomingRegistrations[1]).toMatchObject({ 시작날짜: '261125', 주횟수: '3', 특이사항: '26.12.2 결석', '홀딩 사용여부': 'O(1/2)' });
        expect(service.calculateMembershipStats(result.student)).toMatchObject({ endDate: '2026-12-23', totalClasses: 40, totalHolding: 4 });
    } finally {
        rows[newSheet].pop();
    }
});

it('줄바꿈이 있는 시트 헤더도 다음 등록의 기존 필드 계약으로 전달한다', async () => {
    const oldHeaders = [...headers];
    headers[3] = '요일\n및\n시간';
    headers[12] = '홀딩\n사용여부';
    try {
        const result = await service.findStudentAcrossSheets('재개회원', { requireActive: true });
        expect(result.student._nextRegistration).toMatchObject({ '요일 및 시간': '월4수5', '홀딩 사용여부': 'X' });
        expect(service.calculateMembershipStats(result.student).totalSessions).toBe(16);
    } finally {
        headers.splice(0, headers.length, ...oldHeaders);
    }
});
