import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { getPausedStudentAdjustmentInfo, adjustPausedStudentSessions, getPausedStudentResumeInfo,
  getAllStudentsFromAllSheets, invalidateStudentSheetCache } from './googleSheetsService';
import { isPausedRegistration } from '../utils/studentList';
import { planPausedSessionAdjustment } from '../utils/pausedSessions';

const headers = ['번호', '이름', '주횟수', '요일 및 시간', '특이사항', '신규/재등록', '시작날짜', '종료날짜'];
let sheets, writes;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 8, 9));
  invalidateStudentSheetCache();
  writes = [];
  sheets = {
    '등록생 목록(26년5월)': [[], headers, ['1', '테스트회원', '', '', '기존 메모 [정지:2/화1목1/260528]', '', '260528', '6회']],
    '등록생 목록(26년3월)': [[], headers, ['2', '테스트회원', '', '', '[정지:2/화1목1/260709]', '', '', '16회']],
  };
  vi.stubGlobal('fetch', vi.fn(async (url, options) => {
    const body = options?.body && JSON.parse(options.body);
    let data = {};
    if (url.endsWith('/info')) data = { sheets: Object.keys(sheets) };
    else if (url.endsWith('/batchGet')) data = { valueRanges: body.ranges.map(range => ({ range,
      values: sheets[range.split('!')[0]].map(row => range.endsWith('B:H') ? row.slice(1, 8) : row),
    })) };
    else if (url.endsWith('/batchUpdate')) {
      writes.push(body.data);
      for (const update of body.data) {
        const [name, cell] = update.range.split('!');
        const [, col, row] = cell.match(/([A-Z])(\d+)/);
        sheets[name][Number(row) - 1][col.charCodeAt(0) - 65] = update.values[0][0];
      }
    } else throw new Error(`Unexpected endpoint: ${url}`);
    return { ok: true, status: 200, json: async () => ({ success: true, ...data }) };
  }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); invalidateStudentSheetCache(); });
it('22→11 차감은 6→0, 16→11. 완료 등록을 재개에서 제외하고 사유를 보존한다', async () => {
  const info = await getPausedStudentAdjustmentInfo('테스트회원');
  const result = await adjustPausedStudentSessions('테스트회원', 11, '자율운동 이용을 위한 차감', info.snapshot);
  expect(result.map(row => [row.before, row.after])).toEqual([[6, 0], [16, 11]]);
  expect(writes).toHaveLength(1);
  expect(writes[0].map(row => row.range.split('!')[1])).toEqual(['H3', 'E3', 'H3', 'E3']);
  const first = sheets['등록생 목록(26년5월)'][2];
  expect(first[4]).toContain('기존 메모');
  expect(first[4]).toContain('소진 완료');
  expect(first[4]).not.toContain('[정지:');
  expect(first[7]).toBe('0회');
  expect(sheets['등록생 목록(26년3월)'][2][4]).toContain('[정지:2/화1목1/260709]');
  expect((await getPausedStudentResumeInfo('테스트회원')).map(row => row.n)).toEqual([11]);
  expect(isPausedRegistration({ '요일 및 시간': '', 종료날짜: '0회' })).toBe(false);
  const list = await getAllStudentsFromAllSheets();
  expect(list[0]).toMatchObject({ _pausedTotal: 11, _pausedCount: 1 });
});
it('시트 변경 후 오래된 미리보기로 저장하면 거부하고 쓰지 않는다', async () => {
  const info = await getPausedStudentAdjustmentInfo('테스트회원');
  sheets['등록생 목록(26년3월)'][2][7] = '15회';
  await expect(adjustPausedStudentSessions('테스트회원', 11, '차감', info.snapshot)).rejects.toThrow('변경');
  expect(writes).toHaveLength(0);
});
it('사유가 없거나 잔여를 늘리거나 소수·음수이면 거부한다', async () => {
  const info = await getPausedStudentAdjustmentInfo('테스트회원');
  await expect(adjustPausedStudentSessions('테스트회원', 11, '', info.snapshot)).rejects.toThrow('사유');
  for (const value of ['', 23, 22, -1, 1.5, NaN]) expect(() => planPausedSessionAdjustment(info.registrations, value)).toThrow();
  expect(writes).toHaveLength(0);
});
it('전량 소진 후 재개 대상과 정지 목록에서 모두 제외한다', async () => {
  const info = await getPausedStudentAdjustmentInfo('테스트회원');
  await adjustPausedStudentSessions('테스트회원', 0, '전량 차감', info.snapshot);
  await expect(getPausedStudentResumeInfo('테스트회원')).rejects.toThrow('찾지 못');
  expect(await getAllStudentsFromAllSheets()).toEqual([]);
});
it('최근 창 밖의 정지도 합산하고 원래 대표 행의 H는 유지한다', async () => {
  vi.setSystemTime(new Date(2026, 10, 9));
  const list = await getAllStudentsFromAllSheets();
  expect(list[0]).toMatchObject({ _pausedTotal: 22, _pausedCount: 2, 종료날짜: '6회' });
});

it('활성 등록이 함께 있으면 시간표가 정지 대표 행에 가려지지 않는다', async () => {
  sheets['등록생 목록(26년5월)'].push(['3', '테스트회원', '2', '화1목1', '', '', '260901', '260930']);
  const list = await getAllStudentsFromAllSheets();
  expect(list[0]['요일 및 시간']).toBe('화1목1');
});
