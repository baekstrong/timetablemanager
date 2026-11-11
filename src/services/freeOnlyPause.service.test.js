import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { setFreeOnlyPause, getPausedStudentAdjustmentInfo, adjustPausedStudentSessions,
  getAllStudentsFromAllSheets, findStudentAcrossSheets, invalidateStudentSheetCache } from './googleSheetsService';

// 자율 전용 정지: 시트는 기준일 시점 값만 두고 화면이 주간 차감을 계산, 쓰기 때만 정산한다.
const headers = ['번호', '이름', '주횟수', '요일 및 시간', '특이사항', '신규/재등록', '시작날짜', '종료날짜'];
let sheets, writes;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 11));
  invalidateStudentSheetCache();
  writes = [];
  sheets = {
    '등록생 목록(26년11월)': [[], headers, ['18', '자율회원', '', '', '[정지:2/화1목1/261116]', '재등록', '', '8회']],
    '등록생 목록(26년3월)': [[], headers, ['2', '자율회원', '', '', '메모 [정지:2/화1목1/260709]', '재등록', '', '11회']],
  };
  vi.stubGlobal('fetch', vi.fn(async (url, options) => {
    const body = options?.body && JSON.parse(options.body);
    let data = {};
    if (url.endsWith('/info')) data = { sheets: Object.keys(sheets) };
    else if (url.endsWith('/batchGet')) data = { valueRanges: body.ranges.map(range => ({ range,
      values: (sheets[range.split('!')[0]] || []).map(row => range.endsWith('B:H') ? row.slice(1, 8) : row),
    })) };
    else if (url.endsWith('/batchUpdate')) {
      writes.push(body.data);
      for (const update of body.data) {
        const [name, cell] = update.range.split('!');
        const [, col, row] = cell.match(/([A-Z])(\d+)/);
        sheets[name][Number(row) - 1][col.charCodeAt(0) - 65] = update.values[0][0];
      }
    } else if (url.includes('/read')) data = { values: [] };
    else throw new Error(`Unexpected endpoint: ${url}`);
    return { ok: true, status: 200, json: async () => ({ success: true, ...data }) };
  }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); invalidateStudentSheetCache(); });

it('켜면 두 정지 행에 다가오는 월요일 태그, 합계 19회 그대로', async () => {
  const result = await setFreeOnlyPause('자율회원', true);
  expect(result.total).toBe(19);
  expect(writes).toHaveLength(1);
  expect(sheets['등록생 목록(26년3월)'][2][4]).toBe('메모 [정지:2/화1목1/260709] [자율전용:261116]');
  expect(sheets['등록생 목록(26년11월)'][2][4]).toBe('[정지:2/화1목1/261116] [자율전용:261116]');
  const list = await getAllStudentsFromAllSheets();
  expect(list[0]).toMatchObject({ _pausedTotal: 19, _pausedCount: 2 });
});

it('주가 지나면 시트를 안 고쳐도 남은 횟수가 줄고, 수강생 조회도 같은 값', async () => {
  await setFreeOnlyPause('자율회원', true);
  vi.setSystemTime(new Date(2027, 1, 8)); // 12주 뒤
  invalidateStudentSheetCache();
  const list = await getAllStudentsFromAllSheets();
  expect(list[0]._pausedTotal).toBe(7);
  const mine = await findStudentAcrossSheets('자율회원');
  expect(mine.student).toMatchObject({ _pausedTotal: 7 });
  expect(mine.student._freeOnly.nextDeduction).toEqual(new Date(2027, 1, 15));
  expect(writes).toHaveLength(1);
});

it('잔여 조정은 차감분을 먼저 정산한 값 기준이고 기준일을 당긴다', async () => {
  await setFreeOnlyPause('자율회원', true);
  vi.setSystemTime(new Date(2026, 11, 7)); // 3주 뒤 → 16회
  invalidateStudentSheetCache();
  const info = await getPausedStudentAdjustmentInfo('자율회원');
  expect(info.registrations.map(r => r.n)).toEqual([8, 8]);
  await adjustPausedStudentSessions('자율회원', 15, '테스트', info.snapshot);
  const old = sheets['등록생 목록(26년3월)'][2];
  expect(old[7]).toBe('7회');
  expect(old[4]).toContain('[자율전용:261207]');
  expect(old[4]).toContain('자율전용 3주 차감 11→8회');
  invalidateStudentSheetCache();
  expect((await getAllStudentsFromAllSheets())[0]._pausedTotal).toBe(15);
});

it('해제하면 차감을 기록하고 태그를 지운다, 다 쓴 행은 0회', async () => {
  await setFreeOnlyPause('자율회원', true);
  vi.setSystemTime(new Date(2027, 1, 8)); // 12주 → [0, 7]
  invalidateStudentSheetCache();
  const result = await setFreeOnlyPause('자율회원', false);
  expect(result.total).toBe(7);
  const [old, fresh] = [sheets['등록생 목록(26년3월)'][2], sheets['등록생 목록(26년11월)'][2]];
  expect(old[7]).toBe('0회');
  expect(old[4]).not.toContain('[정지:');
  expect(old[4]).toContain('소진 완료');
  expect(fresh[7]).toBe('7회');
  expect(fresh[4]).not.toContain('[자율전용');
});
