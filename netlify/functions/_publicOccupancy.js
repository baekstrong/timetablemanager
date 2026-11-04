// 신규 신청 화면(로그인 없음)용 칸별 인원. 이름·연락처는 내보내지 않고 숫자만 돌려준다(2026-11-04).
// 코치 '신규 전용' 시간표와 같은 기준을 지키려고 앱의 시트 읽기·중복 정리 코드를 그대로 쓴다
// (fetch 대신 시트 API를 직접 부르는 통로를 꽂는다). 읽기 전용 — 쓰기 경로는 막는다.
import { setSheetsTransport, getAllStudentsFromAllSheets, parseScheduleString } from '../../src/services/googleSheetsService.js';
import { computeSlotOccupancy } from '../../src/utils/slotOccupancy.js';

export function readOnlySheetsTransport(sheets, spreadsheetId) {
  return {
    async get(path) {
      if (path !== '/info') throw new Error(`occupancy: unsupported read ${path}`);
      const response = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties.title' });
      return { success: true, sheets: (response.data.sheets || []).map(sheet => sheet.properties.title) };
    },
    async post(path, body) {
      if (path !== '/batchGet') throw new Error(`occupancy: unsupported write ${path}`);
      const response = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: body.ranges });
      return { success: true, valueRanges: (response.data.valueRanges || []).map(v => ({ range: v.range, values: v.values || [] })) };
    },
  };
}

/** 승인 대기 신규 신청의 이름·희망 시간만(연락처 등은 읽지 않는다). */
export async function readPendingRegistrations(db) {
  const snapshot = await db.collection('newStudentRegistrations').where('status', '==', 'pending')
    .select('name', 'requestedSlots', 'status').get();
  return snapshot.docs.map(doc => doc.data());
}

/**
 * 60초 동안 결과를 재사용하고 동시 요청은 한 번의 읽기를 공유한다.
 * 신청 화면을 여는 사람마다 시트 전체를 다시 읽지 않게 한다.
 */
export function createOccupancyLoader({ sheets, spreadsheetId, readPending, now = Date.now, ttlMs = 60000 }) {
  let cached = null;
  let inFlight = null;
  return async function load() {
    if (cached && now() - cached.at < ttlMs) return cached.value;
    if (inFlight) return inFlight;
    inFlight = (async () => {
      setSheetsTransport(readOnlySheetsTransport(sheets, spreadsheetId));
      const [students, pending] = await Promise.all([getAllStudentsFromAllSheets(), readPending()]);
      const value = computeSlotOccupancy(students, pending, parseScheduleString);
      cached = { at: now(), value };
      return value;
    })().finally(() => { inFlight = null; });
    return inFlight;
  };
}
