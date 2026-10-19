import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildContractChangePlan, loadContractRegistrations, saveContractChange, contractSnapshot } from './contractChangeService';
import { calculateMembershipStats, findStudentAcrossSheets, generateAttendanceHistory, getAllStudentsFromAllSheets, invalidateStudentSheetCache, parseStudentData } from './googleSheetsService';
import { readContractChange } from '../utils/contractChange';

const headers = ['번호', '이름', '주횟수', '요일 및 시간', '특이사항', '신규/재등록', '시작날짜', '종료날짜', '결제금액', '결제일', '결제유무', '결제방식', '홀딩 사용여부', '홀딩 시작일', '홀딩 종료일', '핸드폰', '성별', '직업'];
const row = ['3', '검토회원', '2', '월4목1', '기존 메모', '신규', '261019', '261112', '39', '261017', 'O', '카드', 'X', '', '', '', '', ''];
const sheetName = '등록생 목록(26년10월)';
const entryOf = (values = row, index = 2) => ({ sheetName, rowIndex: index, row: values, student: Object.fromEntries(headers.map((h, i) => [h, values[i] || ''])) });
const entry = entryOf();
const now = new Date(2026, 9, 19, 19, 38);
const options = { entry, entries: [entry], frequency: 4, schedule: '월4수4목4금4', now, id: 'contract-change-test-123', paymentDate: '2026-10-19', paymentMethod: '카드' };
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); invalidateStudentSheetCache(); });

describe('계약변경 소진·남은 횟수 자동 계산', () => {
    it('월4 종료 후 1회 소진, 총16회·잔여15회·차액14만원이며 원래 시작일을 유지한다', () => {
        const plan = buildContractChangePlan(options);
        expect(plan).toMatchObject({ consumed: 1, total: 16, remaining: 15, amount: 14, endDate: '2026-11-13', from: '2026-10-20' });
        expect(plan.row.slice(5, 13)).toEqual(['계약변경', '261019', '261113', '14', '261019', 'O', '카드', 'X']);
        expect(plan.row[4]).toContain('기존 메모');
        expect(entry.row).toEqual(row);
    });
    it('수업 종료 전은 아직0회 소진으로 계산한다', () => {
        const plan = buildContractChangePlan({ ...options, now: new Date(2026, 9, 19, 19, 29) });
        expect(plan).toMatchObject({ consumed: 0, remaining: 16, from: '2026-10-19' });
        vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 9, 19, 19, 29));
        expect(calculateMembershipStats(entryOf(plan.row).student)).toMatchObject({ completedSessions: 0, remainingSessions: 16 });
    });
    it('지난 수업이 늘면 자동 소진하며 새 요일을 과거 소진으로 만들지 않는다', () => {
        const plan = buildContractChangePlan({ ...options, now: new Date(2026, 9, 23, 20) });
        expect(plan.consumed).toBe(2);
        vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 24));
        const changed = entryOf(plan.row).student;
        const dates = generateAttendanceHistory(changed).map(h => h.date);
        expect(dates).toEqual(['2026-10-22', '2026-10-19']);
        expect(calculateMembershipStats(changed)).toMatchObject({ totalSessions: 16, completedSessions: 2, remainingSessions: 14 });
    });
    it('공휴일·시트 합의결석·홀딩을 제외하고 사용한 홀딩을 이어받는다', () => {
        const held = entryOf([...row.slice(0, 12), 'X(1/2)', '', '', '', '', '']);
        // 2개월의 원래 정상 종료일을 그대로 구성한다.
        held.row[7] = '261217'; held.student['종료날짜'] = '261217';
        const plan = buildContractChangePlan({ ...options, entry: held, entries: [held], now: new Date(2026, 9, 23, 20), holidays: [{ date: '2026-10-22' }] });
        expect(plan.total).toBe(32);
        expect(plan.row[12]).toBe('X(1/2)');
        expect(plan.amount).toBe(28);
    });
    it('기예약 보강은 잔여에 포함하고 새 정규 수업으로 중복 지급하지 않는다', () => {
        const plan = buildContractChangePlan({ ...options, makeups: [{ status: 'active', originalClass: { date: '2026-10-19' }, makeupClass: { date: '2026-10-21' } }] });
        expect(plan).toMatchObject({ consumed: 0, remaining: 16, reserved: 1, endDate: '2026-11-13' });
    });
    it('새 시간표에 같은 원수업이 남는 보강은 종료일을 이중 차감하지 않는다', () => {
        const makeup = { status: 'active', originalClass: { date: '2026-10-26', period: 4 }, makeupClass: { date: '2026-10-27', period: 4 } };
        const plan = buildContractChangePlan({ ...options, makeups: [makeup] });
        expect(plan).toMatchObject({ consumed: 1, remaining: 15, reserved: 0, endDate: '2026-11-13' });
    });
    it('기예약 보강이 정규 종료일 밖이어도 내정보 잔여에 포함한다', () => {
        const makeup = { status: 'active', originalClass: { date: '2026-10-19', period: 4 }, makeupClass: { date: '2026-11-17', period: 4 } };
        const plan = buildContractChangePlan({ ...options, makeups: [makeup] });
        vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now);
        const changed = entryOf(plan.row).student;
        expect(calculateMembershipStats(changed)).toMatchObject({ totalSessions: 16, completedSessions: 0, remainingSessions: 16 });
        vi.setSystemTime(new Date(2026, 10, 14));
        expect(calculateMembershipStats(changed)).toMatchObject({ remainingSessions: 1, completedSessions: 15 });
    });
    it('미래 홀딩을 종료일과 내정보 잔여에 같은 기준으로 반영한다', () => {
        const held = entryOf([...row]); held.row[7] = '261116'; held.student['종료날짜'] = '261116';
        const holding = { status: 'active', startDate: '2026-10-22', endDate: '2026-10-22', holdingDates: ['2026-10-22'] };
        const plan = buildContractChangePlan({ ...options, entry: held, entries: [held], holdings: [holding] });
        expect(plan).toMatchObject({ consumed: 1, remaining: 15, endDate: '2026-11-16' });
        vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now);
        expect(calculateMembershipStats(entryOf(plan.row).student, [], { holdings: [holding] })).toMatchObject({ completedSessions: 1, remainingSessions: 15 });
    });
    it('후속 등록은 지우지 않고 변경 종료일과 겹치면 저장을 막는다', () => {
        const next = entryOf([...row], 3); next.row[6] = '261113'; next.student['시작날짜'] = '261113';
        expect(() => buildContractChangePlan({ ...options, entries: [entry, next] })).toThrow('겹칩니다');
        next.row[6] = '261116'; next.student['시작날짜'] = '261116';
        expect(buildContractChangePlan({ ...options, entries: [entry, next] }).retired).toEqual([entry]);
    });
    it('반복 계약변경에서도 과거 시간표 이력을 보존한다', () => {
        const first = buildContractChangePlan(options);
        const changed = entryOf(first.row, 4);
        const second = buildContractChangePlan({ ...options, entry: changed, entries: [changed], frequency: 3, schedule: '월4수4금4', amount: 0, now: new Date(2026, 9, 23, 20) });
        expect(second.consumed).toBe(4);
        expect(readContractChange(second.row[4]).segments).toHaveLength(2);
    });
    it('만료·시간표 불일치·음수 결제는 쓰기 전에 막는다', () => {
        expect(() => buildContractChangePlan({ ...options, now: new Date(2026, 11, 1) })).toThrow('현재 수강');
        expect(() => buildContractChangePlan({ ...options, schedule: '월4수4' })).toThrow('시간표');
        expect(() => buildContractChangePlan({ ...options, amount: -1 })).toThrow('추가 결제액');
    });
});

describe('계약변경 후 현재 수강권·내정보·시트 쓰기 선택', () => {
    const original = [...row]; original[3] = '';
    const changed = buildContractChangePlan(options).row;
    const response = data => ({ ok: true, json: async () => ({ success: true, ...data }) });
    const mockSheets = values => vi.stubGlobal('fetch', vi.fn(async (url, request) => {
        if (String(url).endsWith('/info')) return response({ sheets: [sheetName] });
        if (String(url).endsWith('/batchGet')) return response({ valueRanges: [{ values: [['등록생'], headers, ...values] }] });
        if (String(url).includes('/read?')) return response({ values: [['등록생'], headers, ...values] });
        if (String(url).endsWith('/contractChange')) return response({});
        throw new Error('unexpected ' + url + request);
    }));
    it('같은 시작일의 이전 D열이 비어도 현재 계약변경행을 선택하고16회만 표시한다', async () => {
        vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now); mockSheets([original, changed]);
        const found = await findStudentAcrossSheets('검토회원');
        expect(found.student['신규/재등록']).toBe('계약변경');
        expect(calculateMembershipStats(found.student)).toMatchObject({ totalClasses: 16, attendanceCount: 1, remainingSessions: 15, registrationMonths: 1, totalHolding: 1 });
        const all = await getAllStudentsFromAllSheets();
        expect(all[0]['신규/재등록']).toBe('계약변경');
        expect(all[0]._nextStartDate).toBeUndefined();
    });
    it('저장 직전 등록이 바뀌면 API 쓰기를 실행하지 않는다', async () => {
        mockSheets([changed]);
        const context = { name: '검토회원', entry, snapshot: contractSnapshot([entry]) };
        await expect(saveContractChange(context, options, buildContractChangePlan(options))).rejects.toThrow('등록 정보가 변경');
        expect(fetch.mock.calls.some(([url]) => String(url).endsWith('/contractChange'))).toBe(false);
    });
    it('이전 메모·변경 날짜·주횟수 전후를 원자적 쓰기 요청에 남긴다', async () => {
        mockSheets([row]);
        const entries = await loadContractRegistrations('검토회원');
        const context = { name: '검토회원', entry: entries[0], snapshot: contractSnapshot(entries) };
        const plan = buildContractChangePlan({ ...options, entry: entries[0], entries });
        await saveContractChange(context, options, plan);
        const body = JSON.parse(fetch.mock.calls.find(([url]) => String(url).endsWith('/contractChange'))[1].body);
        expect(body.retired[0].notes).toContain('26.10.19에 주2회 → 주4회로 수강 변경 함');
        expect(body.retired[0].expected[6]).toBe('261019');
        expect(body.retired[0].expected[7]).toBe('261112');
        expect(body.row[5]).toBe('계약변경');
    });
    it('빈 이전 행이 수강권 합산에 다시 들어가지 않는다', () => {
        const student = parseStudentData([[], headers, changed])[0];
        student._upcomingRegistrations = [entryOf(original).student];
        vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now);
        expect(calculateMembershipStats(student).totalSessions).toBe(16);
    });
});
