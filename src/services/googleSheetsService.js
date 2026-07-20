import {
  parseAbsenceDatesFromNotes,
  isHolidayRelevantToStudent,
  shiftEndDateBySessions,
  filterEffectiveHolidayDeltaDates,
  extendEndDateForHeldSessions,
} from './holidayEndDateDelta.js';
import { PERIODS } from '../data/mockData';

// Backend Functions URL
// 로컬 테스트: http://localhost:5001
// Production: VITE_FUNCTIONS_URL 환경 변수 사용 (GitHub Pages + Netlify Functions)
const FUNCTIONS_BASE_URL = import.meta.env.VITE_FUNCTIONS_URL ||
  (import.meta.env.PROD
    ? '/.netlify/functions/sheets'
    : 'http://localhost:5001');
const SPREADSHEET_ID = import.meta.env.VITE_GOOGLE_SHEETS_ID;

// ─── 호환성 함수 (서비스 계정 방식에서는 불필요하나 GoogleSheetsContext에서 import) ───

export const initializeGoogleAPI = async () => {
  console.log('Using Firebase Functions - no client initialization needed');
};

export const initializeGIS = async () => {
  console.log('Using Firebase Functions - no GIS initialization needed');
};

export const signInToGoogle = async () => {
  console.log('Using service account - no sign-in needed');
};

export const signOutFromGoogle = () => {
  console.log('Using service account - no sign-out needed');
};

export const isSignedIn = () => true;

// ─── 내부 유틸리티 ───

/**
 * 공통 API GET 호출
 * @param {string} path - URL 경로 (쿼리 포함, 예: "/read?range=...")
 * @param {string} errorContext - 에러 로그용 문맥 설명
 * @returns {Promise<Object>} - 서버 응답의 data 객체
 */
// 할당량/레이트리밋 에러 판별 (상태코드 또는 메시지)
export function isQuotaError(status, message) {
  if (status === 429) return true;
  const m = String(message || '').toLowerCase();
  return m.includes('quota') || m.includes('rate limit') || m.includes('ratelimit') || m.includes('resource_exhausted');
}

const QUOTA_MAX_RETRIES = 4;
const QUOTA_BASE_DELAY_MS = 600;
// 요청 타임아웃(ms). 함수 콜드스타트 등으로 응답이 없으면 무한 대기(무한 스피너) 대신
// abort → 재시도 → 최종 실패(에러 표시). Netlify 함수 한계(10~26s)보다 넉넉히 잡음.
const REQUEST_TIMEOUT_MS = 20000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const backoffDelay = (attempt) => QUOTA_BASE_DELAY_MS * (2 ** attempt) + Math.floor(Math.random() * 200);

// fetch + JSON + success 검사. 할당량(429/quota) 에러면 지수 백오프로 재시도.
async function requestWithRetry(url, options, errorContext) {
  let lastError;
  for (let attempt = 0; attempt <= QUOTA_MAX_RETRIES; attempt++) {
    let response;
    let data;
    try {
      // 타임아웃: 응답이 없으면 무한 대기하지 않도록 abort
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        response = await fetch(url, { ...(options || {}), signal: controller.signal });
        data = await response.json();
      } finally {
        clearTimeout(timer);
      }
    } catch (netErr) {
      // 네트워크 단절/타임아웃(abort) 등 — 마지막 시도면 throw, 아니면 재시도
      lastError = netErr;
      if (attempt < QUOTA_MAX_RETRIES) { await sleep(backoffDelay(attempt)); continue; }
      throw netErr;
    }
    if (data && data.success) return data;
    const message = (data && data.error) || `Failed to ${errorContext}`;
    if (isQuotaError(response.status, message) && attempt < QUOTA_MAX_RETRIES) {
      console.warn(`⏳ Sheets 할당량 초과 — 재시도 ${attempt + 1}/${QUOTA_MAX_RETRIES} (${errorContext})`);
      await sleep(backoffDelay(attempt));
      continue;
    }
    throw new Error(message);
  }
  throw lastError || new Error(`Failed to ${errorContext}`);
}

async function apiGet(path, errorContext) {
  return requestWithRetry(`${FUNCTIONS_BASE_URL}${path}`, undefined, errorContext);
}

/**
 * 공통 API POST 호출
 * @param {string} path - URL 경로 (예: "/write")
 * @param {Object} body - JSON body
 * @param {string} errorContext - 에러 로그용 문맥 설명
 * @returns {Promise<Object>} - 서버 응답의 data 객체
 */
async function apiPost(path, body, errorContext) {
  return requestWithRetry(`${FUNCTIONS_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, errorContext);
}

/**
 * 날짜를 YYMMDD 형식으로 변환
 * @param {Date} date
 * @returns {string}
 */
function formatDateToYYMMDD(date) {
  const year = String(date.getFullYear()).slice(2);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/**
 * 날짜를 YYYY-MM-DD 형식으로 변환
 * @param {Date} date
 * @returns {string}
 */
function formatDateToISO(date) {
  if (!date) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** start~end(포함) 사이 모든 날짜를 'YYYY-MM-DD' 배열로 열거 */
function enumerateDatesISO(start, end) {
  const out = [];
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  const last = new Date(end);
  last.setHours(0, 0, 0, 0);
  let guard = 400;
  while (cursor <= last && guard-- > 0) {
    out.push(formatDateToISO(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

/**
 * 컬럼 인덱스를 문자로 변환 (0 -> A, 1 -> B, ...)
 * @param {number} index
 * @returns {string}
 */
function getColumnLetter(index) {
  let letter = '';
  while (index >= 0) {
    letter = String.fromCharCode((index % 26) + 65) + letter;
    index = Math.floor(index / 26) - 1;
  }
  return letter;
}

/**
 * 날짜만 비교 (시간 무시)
 */
function isSameOrAfter(date1, date2) {
  const d1 = new Date(date1.getFullYear(), date1.getMonth(), date1.getDate());
  const d2 = new Date(date2.getFullYear(), date2.getMonth(), date2.getDate());
  return d1 >= d2;
}

function isSameOrBefore(date1, date2) {
  const d1 = new Date(date1.getFullYear(), date1.getMonth(), date1.getDate());
  const d2 = new Date(date2.getFullYear(), date2.getMonth(), date2.getDate());
  return d1 <= d2;
}

/**
 * 시트 이름 결정 (year/month 지정 시 해당 시트, 미지정 시 현재 월)
 * @param {number|null} year
 * @param {number|null} month
 * @returns {string}
 */
function resolveSheetName(year, month) {
  if (year && month) {
    return getSheetNameByYearMonth(year, month);
  }
  return getCurrentSheetName();
}

/**
 * 헤더 배열에서 필드명 인덱스 찾기 (공백/개행 변형 모두 검색)
 * @param {Array<string>} headers
 * @param {string} fieldName
 * @returns {number} - 인덱스 또는 -1
 */
function findColumnIndex(headers, fieldName) {
  let index = headers.indexOf(fieldName);
  if (index !== -1) return index;

  index = headers.indexOf(fieldName.replace(/ /g, '\n'));
  if (index !== -1) return index;

  index = headers.indexOf(fieldName.replace(/\n/g, ' '));
  if (index !== -1) return index;

  return -1;
}

/**
 * 시트에서 학생 이름으로 행 찾기 (rows, headers 필요)
 * @param {Array} rows - 시트 전체 행
 * @param {Array} headers - 헤더 행
 * @param {string} studentName
 * @returns {number} - rows 내 행 인덱스 또는 -1
 */
function findStudentRowIndex(rows, headers, studentName) {
  const nameColIndex = headers.indexOf('이름');
  if (nameColIndex === -1) return -1;
  return rows.findIndex((row, idx) => idx >= 2 && row[nameColIndex] === studentName);
}

/**
 * 같은 시트에서 동일 이름의 모든 행 인덱스 찾기
 */
function findAllStudentRowIndices(rows, headers, studentName) {
  const nameColIndex = headers.indexOf('이름');
  if (nameColIndex === -1) return [];
  const indices = [];
  rows.forEach((row, idx) => {
    if (idx >= 2 && row[nameColIndex] === studentName) {
      indices.push(idx);
    }
  });
  return indices;
}

/**
 * 여러 행 중 현재 활성 등록의 행 인덱스 선택 (오늘 기준 수강 기간 내)
 */
function pickActiveRowIndex(rows, headers, indices) {
  if (indices.length === 1) return { activeIndex: indices[0], nextIndex: -1 };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const endDateCol = findColumnIndex(headers, '종료날짜');
  const startDateCol = findColumnIndex(headers, '시작날짜');

  // 시작날짜 기준 정렬
  const sorted = [...indices].sort((a, b) => {
    const startA = startDateCol !== -1 ? parseSheetDate(rows[a][startDateCol]) : null;
    const startB = startDateCol !== -1 ? parseSheetDate(rows[b][startDateCol]) : null;
    if (!startA) return 1;
    if (!startB) return -1;
    return startA - startB;
  });

  // 오늘이 수강 기간 내인 행 찾기
  let activeIdx = -1;
  for (let i = 0; i < sorted.length; i++) {
    const start = startDateCol !== -1 ? parseSheetDate(rows[sorted[i]][startDateCol]) : null;
    const end = endDateCol !== -1 ? parseSheetDate(rows[sorted[i]][endDateCol]) : null;
    if (start && end) {
      start.setHours(0, 0, 0, 0);
      end.setHours(0, 0, 0, 0);
      if (today >= start && today <= end) {
        activeIdx = i;
        break;
      }
    }
  }

  if (activeIdx === -1) activeIdx = 0; // 못 찾으면 첫 번째

  const nextIdx = activeIdx < sorted.length - 1 ? sorted[activeIdx + 1] : -1;
  return { activeIndex: sorted[activeIdx], nextIndex: nextIdx };
}

/**
 * 모든 시트에서 학생을 검색하여 현재 활성 등록 행을 반환
 * 같은 이름이 여러 시트/행에 있을 때 오늘 기준 수강 기간 내 등록을 우선 선택
 * @param {string} studentName
 * @param {string} [primarySheetName] - 우선 검색할 시트명 (기본: 현재 월)
 * @param {Date} [referenceDate] - 이 날짜가 수강 기간에 포함된 등록을 우선 선택
 * @returns {Promise<{foundSheetName, rows, headers, studentIndex, nextRegistrationIndex}>}
 */
async function findStudentInSheets(studentName, primarySheetName = null, referenceDate = new Date(), preferred = null) {
  const primary = primarySheetName || getCurrentSheetName();

  // 모든 시트에서 매치 수집
  const allCandidates = []; // { sheetName, rows, headers, rowIndex, startDate, endDate }

  const collectFromSheet = async (sheetName) => {
    try {
      const rows = await readSheetData(`${sheetName}!A:Z`);
      if (!rows || rows.length < 2) return;
      const headers = rows[1];
      const indices = findAllStudentRowIndices(rows, headers, studentName);
      if (indices.length === 0) return;

      const startDateCol = findColumnIndex(headers, '시작날짜');
      const endDateCol = findColumnIndex(headers, '종료날짜');

      indices.forEach(idx => {
        const startDate = startDateCol !== -1 ? parseSheetDate(rows[idx][startDateCol]) : null;
        const endDate = endDateCol !== -1 ? parseSheetDate(rows[idx][endDateCol]) : null;
        allCandidates.push({ sheetName, rows, headers, rowIndex: idx, startDate, endDate });
      });
    } catch (e) {
      console.warn(`⚠️ ${sheetName} 시트 읽기 실패:`, e.message);
    }
  };

  // 우선 시트 먼저 검색
  await collectFromSheet(primary);

  // 나머지 시트도 검색
  const allSheets = await getAllSheetNames();
  const studentSheets = allSheets.filter(name => name.startsWith('등록생 목록'));

  for (const sheetName of studentSheets) {
    if (sheetName === primary) continue;
    await collectFromSheet(sheetName);
  }

  if (allCandidates.length === 0) {
    throw new Error(`학생 정보를 찾을 수 없습니다: ${studentName}`);
  }

  // 시작날짜 기준 정렬
  allCandidates.sort((a, b) => {
    if (!a.startDate) return 1;
    if (!b.startDate) return -1;
    return a.startDate - b.startDate;
  });

  // 기준 날짜가 수강 기간에 포함된 등록 찾기
  const targetDate = new Date(referenceDate);
  targetDate.setHours(0, 0, 0, 0);

  let activeIdx = -1;

  // 호출 측이 명시한 행이 있으면 최우선 사용 (UI가 이미 active로 보고 있는 행과 정확히 일치 보장)
  // preferred.rowIndex는 parseStudentData의 _rowIndex 포맷 (data-relative, 0 = 첫 데이터 행)
  // → rows 배열 인덱스로 변환하려면 +2 (헤더 2줄)
  if (preferred && preferred.sheetName && preferred.rowIndex !== undefined && preferred.rowIndex !== null) {
    const preferredRowsIdx = preferred.rowIndex + 2;
    activeIdx = allCandidates.findIndex(c =>
      c.sheetName === preferred.sheetName && c.rowIndex === preferredRowsIdx
    );
    if (activeIdx === -1) {
      console.warn(`⚠️ preferred row 매칭 실패 (${preferred.sheetName} row ${preferredRowsIdx}) — 자동 선택으로 fallback`);
    }
  }

  if (activeIdx === -1) {
    for (let i = 0; i < allCandidates.length; i++) {
      const { startDate, endDate } = allCandidates[i];
      if (startDate && endDate) {
        const s = new Date(startDate); s.setHours(0, 0, 0, 0);
        const e = new Date(endDate); e.setHours(0, 0, 0, 0);
        if (targetDate >= s && targetDate <= e) {
          activeIdx = i;
          break;
        }
      }
    }
  }

  // 활성 등록 못 찾으면: 미래 등록 우선(가장 가까운 미래) → 그것도 없으면 가장 최근(latest)
  // (getAllStudentsFromAllSheets의 dedup 로직과 동일하게 맞춰 UI/쓰기 행 불일치 방지)
  if (activeIdx === -1) {
    for (let i = 0; i < allCandidates.length; i++) {
      const s = allCandidates[i].startDate;
      if (s && s > targetDate) { activeIdx = i; break; }
    }
    if (activeIdx === -1) activeIdx = allCandidates.length - 1;
  }

  const active = allCandidates[activeIdx];

  // 다음 등록 찾기 (활성 등록 바로 다음)
  let nextRegistrationIndex = -1;
  let nextSheetName = null;
  let nextRows = null;
  let nextHeaders = null;
  if (activeIdx < allCandidates.length - 1) {
    const next = allCandidates[activeIdx + 1];
    if (next.sheetName === active.sheetName) {
      // 같은 시트 → 기존 방식
      nextRegistrationIndex = next.rowIndex;
    } else {
      // 다른 시트 → 별도 저장
      nextRegistrationIndex = next.rowIndex;
      nextSheetName = next.sheetName;
      nextRows = next.rows;
      nextHeaders = next.headers;
    }
  }

  console.log(`✅ 학생 찾음 (${active.sheetName}): 행 ${active.rowIndex + 1} (전체 ${allCandidates.length}개 등록 중 선택, 기준일: ${formatDateToISO(targetDate)}, 시작: ${active.startDate ? formatDateToISO(active.startDate) : '?'})`);

  return {
    foundSheetName: active.sheetName,
    rows: active.rows,
    headers: active.headers,
    studentIndex: active.rowIndex,
    nextRegistrationIndex,
    nextSheetName,
    nextRows,
    nextHeaders,
  };
}

/**
 * rows + headers에서 학생 데이터를 Object로 변환
 * @param {Array} headers
 * @param {Array} studentRow
 * @returns {Object}
 */
function buildStudentObject(headers, studentRow) {
  const obj = {};
  headers.forEach((header, idx) => {
    obj[header] = studentRow[idx] || '';
  });
  return obj;
}

// 한국 공휴일 데이터 (2026년 기준)
const KOREAN_HOLIDAYS_2026 = {
  '2026-01-01': '신정',
  '2026-02-16': '설날',
  '2026-02-17': '설날',
  '2026-02-18': '설날',
  '2026-03-01': '3·1절',
  '2026-05-01': '노동절',
  '2026-05-05': '어린이날',
  '2026-05-25': '부처님 오신 날',
  '2026-06-06': '현충일',
  '2026-08-15': '광복절',
  '2026-09-24': '추석',
  '2026-09-25': '추석',
  '2026-09-26': '추석',
  '2026-10-03': '개천절',
  '2026-10-09': '한글날',
  '2026-12-25': '크리스마스'
};

// ─── 시트 이름 ───

/**
 * Get current sheet name based on year and month
 * @param {Date} date - Date object (defaults to current date)
 * @returns {string} - Sheet name in format "등록생 목록(26년1월)"
 */
export const getCurrentSheetName = (date = new Date()) => {
  const year = date.getFullYear().toString().slice(-2);
  const month = date.getMonth() + 1;
  return `등록생 목록(${year}년${month}월)`;
};

/**
 * Get sheet name for a specific year and month
 * @param {number} year - Full year (e.g., 2026)
 * @param {number} month - Month (1-12)
 * @returns {string} - Sheet name in format "등록생 목록(26년1월)"
 */
export const getSheetNameByYearMonth = (year, month) => {
  const yearShort = year.toString().slice(-2);
  return `등록생 목록(${yearShort}년${month}월)`;
};

// ─── 기본 Sheets API 래퍼 ───

/**
 * Get all available sheet names from the spreadsheet
 * @returns {Promise<Array<string>>}
 */
let _cachedSheetNames = null;
let _sheetNamesCacheTime = 0;
const SHEET_NAMES_CACHE_TTL = 60 * 1000; // 1분 캐시

export const getAllSheetNames = async () => {
  const now = Date.now();
  if (_cachedSheetNames && (now - _sheetNamesCacheTime) < SHEET_NAMES_CACHE_TTL) {
    return _cachedSheetNames;
  }
  const data = await apiGet('/info', 'get sheet names');
  _cachedSheetNames = data.sheets;
  _sheetNamesCacheTime = now;
  return _cachedSheetNames;
};

/**
 * Read data from Google Sheets
 * @param {string} range - The A1 notation of the range to retrieve values from
 * @returns {Promise<Array>} - Array of rows
 */
export const readSheetData = async (range = null) => {
  if (!range) {
    range = `${getCurrentSheetName()}!A:Z`;
  }
  const data = await apiGet(`/read?range=${encodeURIComponent(range)}`, 'read sheet data');
  return data.values || [];
};

/**
 * 여러 범위를 한 번의 요청으로 읽기 (할당량 절약 — N개 시트를 1개 요청으로)
 * @param {Array<string>} ranges - A1 표기 범위 배열
 * @returns {Promise<Array<{range:string, values:Array}>>} - 입력 순서대로 반환
 */
export const batchReadSheetData = async (ranges) => {
  if (!ranges || ranges.length === 0) return [];
  const data = await apiPost('/batchGet', { ranges }, 'batch read sheet data');
  return data.valueRanges || [];
};

// ─── 학생 시트 읽기 캐시 + 동시요청 합치기 (Sheets 읽기 할당량 절약) ───
// findStudentAcrossSheets / getAllStudentsFromAllSheets / getAllStudents 가 같은 월 시트를
// 짧은 시간에 반복·동시 호출 → 캐시(30초) + in-flight dedup + batchGet 묶음으로 읽기 횟수를 줄인다.
const _studentSheetCache = new Map();    // sheetName -> { time, students }
const _studentSheetInflight = new Map(); // sheetName -> Promise<students>
const STUDENT_SHEET_CACHE_TTL = 30 * 1000;

// 시트에 쓰기가 발생하면 캐시를 비워 read-after-write 정합성을 유지한다.
export const invalidateStudentSheetCache = () => {
  _studentSheetCache.clear();
  _studentSheetInflight.clear();
};

// 미스인 시트들을 1회 batchGet으로 읽고(실패 시 개별 읽기 폴백) 파싱·캐싱한다.
const _fetchStudentSheets = async (names) => {
  let valueRanges = [];
  try {
    valueRanges = await batchReadSheetData(names.map(n => `${n}!A:R`));
  } catch (e) {
    console.warn('⚠️ batchGet 실패 — 개별 읽기로 폴백:', e);
    valueRanges = [];
  }
  const map = new Map();
  await Promise.all(names.map(async (name, i) => {
    let rows = valueRanges[i]?.values;
    if (!rows) {
      try { rows = await readSheetData(`${name}!A:R`); } catch { rows = []; }
    }
    const students = parseStudentData(rows);
    students.forEach(s => { s._foundSheetName = name; });
    _studentSheetCache.set(name, { time: Date.now(), students });
    map.set(name, students);
  }));
  return map;
};

/**
 * 여러 학생 시트(월별)를 캐시·dedup·batchGet으로 읽어 시트별 파싱 학생 배열 맵 반환.
 * 캐시에 있으면 재사용, 진행 중이면 그 요청을 공유, 미스인 시트만 묶어 읽는다.
 * 반환 객체는 호출자별 얕은 복제본이라 자유롭게 변형해도 캐시가 오염되지 않는다.
 * @param {Array<string>} sheetNames
 * @returns {Promise<Map<string, Array>>}
 */
const readStudentSheets = async (sheetNames) => {
  const now = Date.now();
  const promiseByName = new Map();
  const toFetch = [];

  for (const name of sheetNames) {
    if (promiseByName.has(name)) continue; // 중복 입력 무시
    const cached = _studentSheetCache.get(name);
    if (cached && (now - cached.time) < STUDENT_SHEET_CACHE_TTL) {
      promiseByName.set(name, Promise.resolve(cached.students));
    } else if (_studentSheetInflight.has(name)) {
      promiseByName.set(name, _studentSheetInflight.get(name)); // 진행 중 요청 공유
    } else {
      toFetch.push(name);
    }
  }

  if (toFetch.length > 0) {
    const batchPromise = _fetchStudentSheets(toFetch)
      .finally(() => { toFetch.forEach(n => _studentSheetInflight.delete(n)); });
    toFetch.forEach(name => {
      const p = batchPromise.then(map => map.get(name) || []);
      _studentSheetInflight.set(name, p);
      promiseByName.set(name, p);
    });
  }

  const result = new Map();
  await Promise.all([...promiseByName.keys()].map(async name => {
    const students = await promiseByName.get(name);
    result.set(name, (students || []).map(s => ({ ...s }))); // 호출자별 복제본
  }));
  return result;
};

/**
 * Write data to Google Sheets
 * @param {string} range - The A1 notation of the range to update
 * @param {Array} values - 2D array of values to write
 * @returns {Promise}
 */
export const writeSheetData = async (range, values) => {
  const data = await apiPost('/write', { range, values }, 'write sheet data');
  invalidateStudentSheetCache();
  console.log('Sheet updated:', data);
  return data;
};

/**
 * Append data to Google Sheets
 * @param {string} range - The A1 notation of the range to append to
 * @param {Array} values - 2D array of values to append
 * @returns {Promise}
 */
export const appendSheetData = async (range, values) => {
  const data = await apiPost('/append', { range, values }, 'append sheet data');
  invalidateStudentSheetCache();
  console.log('Data appended:', data);
  return data;
};

/**
 * Batch update Google Sheets
 * @param {Array} updates - Array of {range, values} objects
 * @returns {Promise}
 */
export const batchUpdateSheet = async (updates) => {
  const data = await apiPost('/batchUpdate', { data: updates }, 'batch update sheet');
  invalidateStudentSheetCache();
  console.log('Batch update completed:', data);
  return data;
};

/**
 * Highlight cells with background color
 * @param {Array<string>} ranges - Array of cell ranges (e.g., ["A5", "B5", "C5"])
 * @param {string} sheetName - Sheet name
 * @param {Object} [color] - Optional RGB color {red, green, blue} (0.0~1.0). Defaults to yellow.
 * @returns {Promise}
 */
export const highlightCells = async (ranges, sheetName, color = null) => {
  const body = { ranges, sheetName, color: color || { red: 1.0, green: 1.0, blue: 0.6 } };
  const data = await apiPost('/formatCells', body, 'highlight cells');
  console.log(`✅ Highlighted ${ranges.length} cells`);
  return data;
};

/**
 * 배경색 + 정렬을 한 번의 API 호출로 적용
 * @param {Array<string>} ranges
 * @param {string} sheetName
 * @param {object} color - 배경색 { red, green, blue } (0~1)
 * @param {string} horizontalAlignment - 정렬 ('CENTER', 'LEFT', 'RIGHT')
 */
export const formatCellsWithStyle = async (ranges, sheetName, color, horizontalAlignment = 'CENTER') => {
  return await apiPost('/formatCells', { ranges, sheetName, color, horizontalAlignment }, 'format cells');
};

// ─── 데이터 파싱 ───

/**
 * Parse student data from Google Sheets
 * Row 1: merged cells, Row 2: headers, Row 3+: data
 */
export const parseStudentData = (rows) => {
  if (!rows || rows.length < 2) return [];

  const headers = rows[1];
  const data = rows.slice(2);

  console.log('📋 Headers from row 2:', headers);

  return data.map((row, index) => {
    const student = {};
    headers.forEach((header, colIndex) => {
      student[header] = row[colIndex] || '';
    });
    student._rowIndex = index;
    return student;
  }).filter(student => student['이름']);
};

/**
 * Get student field value with flexible field name matching
 * Handles both space-separated and newline-separated field names
 * @param {Object} student
 * @param {string} fieldName
 * @returns {string}
 */
export const getStudentField = (student, fieldName) => {
  if (!student) return '';

  if (student[fieldName] !== undefined) return student[fieldName];

  const withNewline = fieldName.replace(/ /g, '\n');
  if (student[withNewline] !== undefined) return student[withNewline];

  const withSpace = fieldName.replace(/\n/g, ' ');
  if (student[withSpace] !== undefined) return student[withSpace];

  return '';
};

/**
 * Parse date string from Google Sheets (YYMMDD or YYYYMMDD format)
 * Example: "260111" → Date(2026, 0, 11)
 * @param {string} dateStr
 * @returns {Date|null}
 */
export const parseSheetDate = (dateStr) => {
  if (!dateStr) return null;

  const cleaned = String(dateStr).replace(/\D/g, '');

  if (cleaned.length === 6) {
    return new Date(
      parseInt('20' + cleaned.substring(0, 2)),
      parseInt(cleaned.substring(2, 4)) - 1,
      parseInt(cleaned.substring(4, 6))
    );
  }
  if (cleaned.length === 8) {
    return new Date(
      parseInt(cleaned.substring(0, 4)),
      parseInt(cleaned.substring(4, 6)) - 1,
      parseInt(cleaned.substring(6, 8))
    );
  }

  return null;
};

/**
 * 특정 등록(행)의 수강 기간이 주어진 날짜를 포함하는지 검사 (양 끝 포함)
 * 시작/종료날짜를 해석할 수 없으면 false.
 * @param {Object} student - parseStudentData 결과 객체
 * @param {Date} date
 * @returns {boolean}
 */
export const studentRegistrationCoversDate = (student, date) => {
  const start = parseSheetDate(getStudentField(student, '시작날짜'));
  const end = parseSheetDate(getStudentField(student, '종료날짜'));
  if (!start || !end || !date) return false;
  const d = new Date(date); d.setHours(0, 0, 0, 0);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  return d >= start && d <= end;
};

// ─── 홀딩 상태 ───

/**
 * 홀딩 사용여부 필드 파싱 (여러달 수강권 지원)
 * 형식: "X", "O", "X(0/2)", "O(1/3)" 등
 * @param {string} holdingStatusStr
 * @returns {Object} - { months, used, total, isCurrentlyUsed }
 */
export const parseHoldingStatus = (holdingStatusStr) => {
  const DEFAULT = { months: 1, used: 0, total: 1, isCurrentlyUsed: false };

  if (!holdingStatusStr || holdingStatusStr.trim() === '') return DEFAULT;

  const str = holdingStatusStr.trim();

  // X(n/m) 또는 O(n/m) 형식
  const multiMonthMatch = str.match(/^([XOxo])\s*\((\d+)\/(\d+)\)$/);
  if (multiMonthMatch) {
    const status = multiMonthMatch[1].toUpperCase();
    const used = parseInt(multiMonthMatch[2]);
    const total = parseInt(multiMonthMatch[3]);
    return { months: total, used, total, isCurrentlyUsed: status === 'O' };
  }

  // 단순 X 또는 O 형식 (1개월 등록)
  const upperStr = str.toUpperCase();
  if (upperStr === 'X') return DEFAULT;
  if (upperStr === 'O' || upperStr === 'Y' || str === '사용') {
    return { months: 1, used: 1, total: 1, isCurrentlyUsed: true };
  }

  console.warn('알 수 없는 홀딩 상태 형식:', holdingStatusStr);
  return DEFAULT;
};

/**
 * 홀딩 상태 문자열 생성 (여러달 수강권용)
 * @param {boolean} isUsed
 * @param {number} usedCount
 * @param {number} totalCount
 * @returns {string}
 */
export const formatHoldingStatus = (isUsed, usedCount, totalCount) => {
  const status = isUsed ? 'O' : 'X';
  if (totalCount === 1) return status;
  return `${status}(${usedCount}/${totalCount})`;
};

// ─── 공휴일 ───

/**
 * 특정 날짜가 공휴일인지 확인
 */
export const isHolidayDate = (date, firebaseHolidays = []) => {
  const dateStr = formatDateToISO(date);

  if (KOREAN_HOLIDAYS_2026[dateStr]) return true;

  if (firebaseHolidays.length > 0) {
    return firebaseHolidays.some(h => h.date === dateStr);
  }

  return false;
};

/**
 * 공휴일 이름 반환 (공휴일 아니면 null). 공휴일=KOREAN_HOLIDAYS_2026, 커스텀=holidays 컬렉션의 reason
 */
export const getHolidayName = (date, firebaseHolidays = []) => {
  const dateStr = formatDateToISO(date);
  if (KOREAN_HOLIDAYS_2026[dateStr]) return KOREAN_HOLIDAYS_2026[dateStr];
  const custom = firebaseHolidays.find(h => h.date === dateStr);
  return custom ? (custom.reason || '휴일') : null;
};

// ─── 스케줄 파싱 ───

/**
 * 요일 및 시간 문자열 파싱
 * 예: "월5수5" → [{day: '월', period: 5}, {day: '수', period: 5}]
 */
export const parseScheduleString = (scheduleStr) => {
  if (!scheduleStr || typeof scheduleStr !== 'string') return [];

  const result = [];
  const daySet = new Set(['월', '화', '수', '목', '금', '토', '일']);
  const chars = scheduleStr.replace(/\s/g, '');

  let i = 0;
  while (i < chars.length) {
    const char = chars[i];

    if (daySet.has(char)) {
      const day = char;
      i++;

      let periodStr = '';
      while (i < chars.length && /\d/.test(chars[i])) {
        periodStr += chars[i];
        i++;
      }

      if (periodStr) {
        const period = parseInt(periodStr);
        if (period >= 1 && period <= 6) {
          result.push({ day, period });
        }
      }
    } else {
      i++;
    }
  }

  return result;
};

// ─── 종료일 / 세션 계산 ───

const DAY_MAP = { '월': 1, '화': 2, '수': 3, '목': 4, '금': 5, '토': 6, '일': 0 };

/**
 * 스케줄 문자열에서 수업 요일 번호 배열 추출
 * @param {string} scheduleStr
 * @returns {number[]}
 */
function getClassDays(scheduleStr) {
  const schedule = parseScheduleString(scheduleStr);
  return schedule.map(s => DAY_MAP[s.day]).filter(d => d !== undefined);
}

/**
 * Calculate end date based on start date, total sessions, schedule, and optional holding periods
 * @param {Date} startDate
 * @param {number} totalSessions
 * @param {string} scheduleStr
 * @param {Array|Object|null} holdingRanges
 * @param {Array} firebaseHolidays
 * @param {Array<string>} countedHolidayDates - 보강으로 소진한 휴일 원수업일(YYYY-MM-DD)
 * @returns {Date|null}
 */
function calculateEndDate(startDate, totalSessions, scheduleStr, holdingRanges = null, firebaseHolidays = [], countedHolidayDates = []) {
  if (!startDate || !scheduleStr || !totalSessions) return null;

  const classDays = getClassDays(scheduleStr);
  if (classDays.length === 0) return null;
  const countedHolidaySet = new Set(countedHolidayDates || []);

  // 홀딩 기간을 배열로 정규화
  const holdingRangesArray = holdingRanges
    ? (Array.isArray(holdingRanges) ? holdingRanges : [holdingRanges])
    : [];

  let sessionCount = 0;
  const current = new Date(startDate);
  current.setHours(0, 0, 0, 0);
  let maxIterations = 365;

  while (sessionCount < totalSessions && maxIterations > 0) {
    maxIterations--;

    if (classDays.includes(current.getDay())) {
      const isHoliday = isHolidayDate(current, firebaseHolidays);
      const isCountedHoliday = isHoliday && countedHolidaySet.has(formatDateToISO(current));
      const isInHoldingPeriod = holdingRangesArray.some(range =>
        range && isSameOrAfter(current, range.start) && isSameOrBefore(current, range.end)
      );

      if ((!isHoliday || isCountedHoliday) && !isInHoldingPeriod) {
        sessionCount++;
        if (sessionCount === totalSessions) {
          return new Date(current);
        }
      }
    }
    current.setDate(current.getDate() + 1);
  }

  return null;
}

/**
 * Calculate end date with Firebase custom holidays support
 * @param {Date} startDate
 * @param {number} totalSessions
 * @param {string} scheduleStr
 * @param {Array} firebaseHolidays
 * @param {Array<string>} absenceDates - YYYY-MM-DD 형식
 * @returns {Date|null}
 */
export const calculateEndDateWithHolidays = (startDate, totalSessions, scheduleStr, firebaseHolidays = [], absenceDates = []) => {
  let holdingRanges = null;
  if (absenceDates && absenceDates.length > 0) {
    holdingRanges = absenceDates.map(dateStr => {
      const d = new Date(dateStr + 'T00:00:00');
      return { start: d, end: d };
    });
  }
  return calculateEndDate(startDate, totalSessions, scheduleStr, holdingRanges, firebaseHolidays);
};

/**
 * 시작일부터 endDate까지 완료된 수업 횟수 계산 (홀딩 기간 및 공휴일 제외)
 */
function calculateCompletedSessions(startDate, endDate, scheduleStr, holdingRange = null, firebaseHolidays = []) {
  if (!startDate || !scheduleStr || startDate > endDate) return 0;

  const classDays = getClassDays(scheduleStr);
  if (classDays.length === 0) return 0;

  let count = 0;
  const current = new Date(startDate);

  while (current <= endDate) {
    if (classDays.includes(current.getDay())) {
      const isInHoldingPeriod = holdingRange &&
        current >= holdingRange.start &&
        current <= holdingRange.end;
      const holiday = isHolidayDate(current, firebaseHolidays);

      if (!isInHoldingPeriod && !holiday) {
        count++;
      }
    }
    current.setDate(current.getDate() + 1);
  }

  return count;
}

/**
 * 학생 데이터에서 총 세션 수 계산
 * @param {number} weeklyFrequency
 * @param {Object} holdingInfo - parseHoldingStatus 결과
 * @returns {number}
 */
function getTotalSessions(weeklyFrequency, holdingInfo) {
  return weeklyFrequency * 4 * holdingInfo.months;
}

// ─── 학생 조회 ───

/**
 * 구글 시트에서 이름으로 수강생 찾기
 * @param {string} studentName
 * @param {number} year
 * @param {number} month
 * @returns {Promise<Object|null>}
 */
export const getStudentByName = async (studentName, year = null, month = null) => {
  const students = await getAllStudents(year, month);
  const allMatches = students.filter(s => s['이름'] === studentName);

  if (allMatches.length === 0) {
    console.warn(`Student "${studentName}" not found in Google Sheets`);
    return null;
  }

  // 같은 시트에 동일 이름이 여러 행 있으면, 오늘 기준 활성 등록을 우선 반환
  if (allMatches.length > 1) {
    const result = pickActiveRegistration(allMatches);
    console.log(`✅ Found student (multiple registrations): ${studentName}`, result);
    return result;
  }

  console.log(`✅ Found student: ${studentName}`, allMatches[0]);
  return allMatches[0];
};

/**
 * 동일 이름의 여러 등록 중 현재 활성 등록을 선택하고 다음 등록 정보를 _nextRegistration으로 첨부
 * @param {Array} registrations - 같은 이름의 등록 배열
 * @returns {Object} - 현재 활성 등록 (+ _nextRegistration)
 */
function pickActiveRegistration(registrations) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // 시작날짜 기준 정렬
  const sorted = [...registrations].sort((a, b) => {
    const startA = parseSheetDate(getStudentField(a, '시작날짜'));
    const startB = parseSheetDate(getStudentField(b, '시작날짜'));
    if (!startA) return 1;
    if (!startB) return -1;
    return startA - startB;
  });

  // 오늘이 수강 기간 내인 등록 찾기
  let activeIdx = -1;
  for (let i = 0; i < sorted.length; i++) {
    const start = parseSheetDate(getStudentField(sorted[i], '시작날짜'));
    const end = parseSheetDate(getStudentField(sorted[i], '종료날짜'));
    if (start && end) {
      start.setHours(0, 0, 0, 0);
      end.setHours(0, 0, 0, 0);
      if (today >= start && today <= end) {
        activeIdx = i;
        break;
      }
    }
  }

  // 활성 등록이 없으면, 가장 최근 시작하는 등록 (아직 시작 전 포함)
  if (activeIdx === -1) {
    // 아직 시작 전인 등록 중 가장 가까운 것
    for (let i = 0; i < sorted.length; i++) {
      const start = parseSheetDate(getStudentField(sorted[i], '시작날짜'));
      if (start && start > today) {
        activeIdx = i;
        break;
      }
    }
    // 그것도 없으면 마지막(가장 최근) 등록
    if (activeIdx === -1) activeIdx = sorted.length - 1;
  }

  const active = { ...sorted[activeIdx] };

  // 이전 등록이 있으면 첨부 (미리 등록으로 다음 계약이 선택된 경우, 이전 등록의 기간도 필요)
  if (activeIdx > 0) {
    const prev = sorted[activeIdx - 1];
    active._prevRegistration = {
      시작날짜: getStudentField(prev, '시작날짜'),
      종료날짜: getStudentField(prev, '종료날짜'),
      _rowIndex: prev._rowIndex,
      _foundSheetName: prev._foundSheetName,
      '요일 및 시간': getStudentField(prev, '요일 및 시간'),
      주횟수: getStudentField(prev, '주횟수'),
      '홀딩 사용여부': getStudentField(prev, '홀딩 사용여부'),
    };
  }

  // 다음 등록(미리 등록)이 있으면 첨부
  if (activeIdx < sorted.length - 1) {
    const next = sorted[activeIdx + 1];
    active._nextRegistration = {
      시작날짜: getStudentField(next, '시작날짜'),
      종료날짜: getStudentField(next, '종료날짜'),
      _rowIndex: next._rowIndex,
      _foundSheetName: next._foundSheetName,
      '요일 및 시간': getStudentField(next, '요일 및 시간'),
      주횟수: getStudentField(next, '주횟수'),
      '홀딩 사용여부': getStudentField(next, '홀딩 사용여부'),
    };
  }

  console.log(`📅 pickActiveRegistration: ${sorted.length}개 등록 중 #${activeIdx} 선택 (시작: ${getStudentField(active, '시작날짜')})`);
  return active;
}

/**
 * 여러 시트에서 학생 찾기 (모든 시트에서 검색하여 활성 등록 반환)
 * @param {string} studentName
 * @returns {Promise<Object|null>} - { student, year, month, foundSheetName }
 */
export const findStudentAcrossSheets = async (studentName) => {
  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth() + 1;

  const allMatches = [];

  // 현재 월 ±2개월만 병렬 검색 (미리 등록은 인접 월에 있음)
  const searchMonths = [];
  for (let i = -2; i <= 2; i++) {
    const searchDate = new Date(currentYear, currentMonth - 1 + i, 1);
    searchMonths.push({ year: searchDate.getFullYear(), month: searchDate.getMonth() + 1 });
  }

  // 윈도우 5개 시트를 캐시·dedup·batchGet으로 1회에 읽음 (기존: 5회 개별 읽기)
  const windowSheetNames = searchMonths.map(({ year, month }) => getSheetNameByYearMonth(year, month));
  const windowMap = await readStudentSheets(windowSheetNames);
  searchMonths.forEach(({ year, month }) => {
    const foundSheetName = getSheetNameByYearMonth(year, month);
    (windowMap.get(foundSheetName) || [])
      .filter(s => s['이름'] === studentName)
      .forEach(student => {
        student._foundSheetName = foundSheetName;
        allMatches.push({ student, year, month, foundSheetName });
      });
  });

  // 장기(2~3개월) 등록의 행은 "등록(결제)한 달" 시트에 남아 있어, 현재 월에서 2개월 넘게
  // 떨어진 시트에 있을 수 있다. (예: 2월 시트에 3~6월 수강 등록 행)
  // 이 경우 ±2개월 윈도우가 '오늘 활성인 등록'을 놓치고, 인접 달에 있는 '미리 등록(미래 등록)'을
  // 활성으로 오인한다 → ①아예 못 찾았거나 ②윈도우 안에 오늘 활성 등록이 없으면 전체 시트로 폴백.
  const hasActiveMatch = allMatches.some(m => studentRegistrationCoversDate(m.student, today));
  if (allMatches.length === 0 || !hasActiveMatch) {
    console.warn(`⚠️ "${studentName}" ±2개월 윈도우에 오늘 활성 등록 없음 — 전체 시트 스캔으로 보강`);
    try {
      const allSheets = await getAllSheetNames();
      const windowSet = new Set(windowSheetNames); // 윈도우에서 이미 읽은 시트 제외(중복 방지)
      const studentSheets = allSheets
        .filter(name => name.startsWith('등록생 목록('))
        .filter(name => !windowSet.has(name));

      // 남은 시트들도 캐시·dedup·batchGet으로 1회에 읽음 (기존: 시트당 개별 읽기)
      const fallbackMap = await readStudentSheets(studentSheets);
      studentSheets.forEach(foundSheetName => {
        const match = foundSheetName.match(/등록생 목록\((\d+)년(\d+)월\)/);
        if (!match) return;
        const year = parseInt(match[1]) + 2000;
        const month = parseInt(match[2]);
        (fallbackMap.get(foundSheetName) || [])
          .filter(s => s['이름'] === studentName)
          .forEach(student => {
            student._foundSheetName = foundSheetName;
            allMatches.push({ student, year, month, foundSheetName });
          });
      });
    } catch (err) {
      console.warn('전체 시트 폴백 검색 실패:', err);
    }

    if (allMatches.length === 0) {
      console.warn(`❌ Student "${studentName}" not found in any sheet`);
      return null;
    }
    console.log(`✅ 전체 시트 스캔 후 "${studentName}" 등록 ${allMatches.length}건 확보`);
  }

  if (allMatches.length === 1) {
    console.log(`✅ Found student "${studentName}" in ${allMatches[0].foundSheetName}`);
    return allMatches[0];
  }

  // 여러 등록 중 활성 등록 선택
  const allStudents = allMatches.map(m => m.student);
  const activeStudent = pickActiveRegistration(allStudents);

  // 활성 학생의 시트 정보 찾기
  const matchInfo = allMatches.find(m =>
    m.student._rowIndex === activeStudent._rowIndex &&
    m.student._foundSheetName === (activeStudent._foundSheetName || m.foundSheetName)
  ) || allMatches[0];

  console.log(`✅ Found student "${studentName}" (active registration) in ${matchInfo.foundSheetName}`);
  return { student: activeStudent, year: matchInfo.year, month: matchInfo.month, foundSheetName: matchInfo.foundSheetName };
};

/**
 * Get all student data from the sheet
 * @param {number} year
 * @param {number} month
 */
export const getAllStudents = async (year = null, month = null) => {
  const foundSheetName = resolveSheetName(year, month);
  console.log(`📖 Reading data from sheet: "${foundSheetName}"`);
  const map = await readStudentSheets([foundSheetName]);
  const parsedData = map.get(foundSheetName) || [];
  console.log(`✨ Parsed ${parsedData.length} students`);
  return parsedData;
};

/**
 * Get all students from all available sheets
 * @returns {Promise<Array>}
 */
export const getAllStudentsFromAllSheets = async () => {
  console.log('🔍 Fetching students from all available sheets...');

  const sheets = await getAllSheetNames();
  console.log('📊 Available sheets:', sheets);

  const studentSheets = sheets.filter(name => name.startsWith('등록생 목록('));
  console.log('📋 Student sheets found:', studentSheets);

  if (studentSheets.length === 0) {
    console.warn('⚠️ No student sheets found');
    return [];
  }

  // 캐시·dedup·batchGet 묶음 읽기 (할당량 절약)
  const sheetMap = await readStudentSheets(studentSheets);
  const allStudents = studentSheets.flatMap(name => sheetMap.get(name) || []);
  console.log(`✨ Total students loaded from all sheets: ${allStudents.length}`);

  // 같은 이름의 수강생이 여러 시트/행에 있으면 현재 활성 등록을 우선 유지
  // 이전 등록의 종료날짜를 _prevEndDate로 보존 (시작지연 판단용)
  const parseSheetMonth = (sheetName) => {
    const match = sheetName.match(/등록생 목록\((\d+)년(\d+)월\)/);
    if (!match) return 0;
    const year = parseInt(match[1]) + 2000;
    const month = parseInt(match[2]);
    return year * 100 + month; // e.g., 202603
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // 이름별로 모든 등록을 모음
  const byName = {};
  allStudents.forEach(student => {
    const name = student['이름'];
    if (!name) return;
    if (!byName[name]) byName[name] = [];
    byName[name].push({ ...student, _sheetOrder: parseSheetMonth(student._foundSheetName || '') });
  });

  const latestByName = {};
  Object.entries(byName).forEach(([name, registrations]) => {
    if (registrations.length === 1) {
      latestByName[name] = registrations[0];
      return;
    }

    // 날짜를 한 번만 파싱하여 캐싱
    registrations.forEach(r => {
      r._parsedStart = parseSheetDate(getStudentField(r, '시작날짜'));
      r._parsedEnd = parseSheetDate(getStudentField(r, '종료날짜'));
      if (r._parsedStart) r._parsedStart.setHours(0, 0, 0, 0);
      if (r._parsedEnd) r._parsedEnd.setHours(0, 0, 0, 0);
    });

    // 시작날짜 기준 정렬
    registrations.sort((a, b) => {
      if (!a._parsedStart) return 1;
      if (!b._parsedStart) return -1;
      return a._parsedStart - b._parsedStart;
    });

    // 오늘이 수강 기간 내인 등록 찾기.
    // 여러 행이 오늘을 포함하면(옛 시트의 중복/예전 행 vs 현재 시트의 최신 행)
    // "가장 최근 시트(=근본 소스)"의 등록을 우선 — 같은 시트면 더 늦게 시작한 등록.
    // (옛 시트 행이 현재 시트의 최신 등록을 덮어써 날짜가 어긋나던 문제 해결)
    let activeIdx = -1;
    for (let i = 0; i < registrations.length; i++) {
      const { _parsedStart: start, _parsedEnd: end } = registrations[i];
      if (!(start && end && today >= start && today <= end)) continue;
      if (activeIdx === -1) { activeIdx = i; continue; }
      const cur = registrations[activeIdx];
      const curOrder = cur._sheetOrder || 0;
      const iOrder = registrations[i]._sheetOrder || 0;
      if (iOrder > curOrder || (iOrder === curOrder && registrations[i]._parsedStart > cur._parsedStart)) {
        activeIdx = i;
      }
    }

    // 활성 등록이 없으면: 미래 등록 우선, 없으면 가장 최근 등록
    if (activeIdx === -1) {
      const futureIdx = registrations.findIndex(r => r._parsedStart && r._parsedStart > today);

      if (futureIdx !== -1) {
        activeIdx = futureIdx;
      } else {
        activeIdx = registrations.length - 1;
      }
    }

    // 캐싱된 파싱 결과 정리
    registrations.forEach(r => { delete r._parsedStart; delete r._parsedEnd; });

    const active = registrations[activeIdx];

    // 이전 등록(직전)의 종료날짜 보존
    if (activeIdx > 0) {
      const prev = registrations[activeIdx - 1];
      active._prevEndDate = getStudentField(prev, '종료날짜');
      active._prevSchedule = getStudentField(prev, '요일 및 시간');
    }

    // 다음(미리) 등록이 있으면 시작날짜·요일 보존
    //  - _nextStartDate: 이미 재등록한 학생을 '재등록 지연'으로 오탐하지 않기 위함
    //  - _nextSchedule: 다음 달 다른 슬롯으로 옮긴 경우, 신규 등록 시간표 인원 카운트가
    //    '옮겨갈 목적지 슬롯' 기준으로 세도록(정원 초과 배정 방지). computeSlotOccupancy 참고.
    if (activeIdx < registrations.length - 1) {
      active._nextStartDate = getStudentField(registrations[activeIdx + 1], '시작날짜');
      active._nextSchedule = getStudentField(registrations[activeIdx + 1], '요일 및 시간');
    }

    latestByName[name] = active;
  });

  const deduplicatedStudents = Object.values(latestByName).map(({ _sheetOrder, _prevSheetOrder, ...student }) => student);
  console.log(`🧹 Deduplicated: ${allStudents.length} → ${deduplicatedStudents.length} students`);

  return deduplicatedStudents;
};

// ─── 수강권 통계 / 출석 내역 ───

/**
 * 수강생 데이터로부터 수강권 통계 계산
 * @param {Object} student
 * @returns {Object|null}
 */
export const calculateMembershipStats = (student) => {
  if (!student) return null;

  const startDateStr = getStudentField(student, '시작날짜');
  const endDateStr = getStudentField(student, '종료날짜');
  const scheduleStr = getStudentField(student, '요일 및 시간');
  const weeklyFrequencyStr = getStudentField(student, '주횟수');
  const holdingStatusStr = getStudentField(student, '홀딩 사용여부') ||
    getStudentField(student, '홀딩 상태') ||
    getStudentField(student, '홀딩사용여부');

  const holdingInfo = parseHoldingStatus(holdingStatusStr);

  const startDate = parseSheetDate(startDateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const weeklyFrequency = parseInt(weeklyFrequencyStr) || 2;
  const totalSessions = getTotalSessions(weeklyFrequency, holdingInfo);

  const holdingUsed = holdingInfo.isCurrentlyUsed;
  const remainingHolding = holdingInfo.total - holdingInfo.used;

  // 홀딩 기간 정보
  let holdingRange = null;
  const holdingStartDate = parseSheetDate(getStudentField(student, '홀딩 시작일'));
  const holdingEndDate = parseSheetDate(getStudentField(student, '홀딩 종료일'));
  if (holdingUsed && holdingStartDate && holdingEndDate) {
    holdingRange = { start: holdingStartDate, end: holdingEndDate };
  }

  // H열 종료날짜 우선, 없으면 JS 재계산
  let endDate = parseSheetDate(endDateStr);
  if (!endDate && startDate && scheduleStr) {
    endDate = calculateEndDate(startDate, totalSessions, scheduleStr, holdingRange);
  }

  let completedSessions, remainingSessions;

  if (endDate) {
    if (today >= endDate) {
      remainingSessions = 0;
      completedSessions = totalSessions;
    } else if (!startDate || today < startDate) {
      remainingSessions = totalSessions;
      completedSessions = 0;
    } else {
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      remainingSessions = Math.min(
        totalSessions,
        calculateCompletedSessions(tomorrow, endDate, scheduleStr, holdingRange, [])
      );
      completedSessions = Math.max(0, totalSessions - remainingSessions);
    }
  } else {
    completedSessions = Math.min(
      totalSessions,
      calculateCompletedSessions(startDate, today, scheduleStr, holdingRange, [])
    );
    remainingSessions = Math.max(0, totalSessions - completedSessions);
  }

  return {
    studentName: getStudentField(student, '이름'),
    startDate: formatDateToISO(startDate),
    endDate: formatDateToISO(endDate),
    weeklyFrequency,
    totalSessions,
    completedSessions,
    remainingSessions,
    remainingHolding,
    totalHolding: holdingInfo.total,
    usedHolding: holdingInfo.used,
    registrationMonths: holdingInfo.months,
    schedule: scheduleStr,
    attendanceCount: Math.max(0, completedSessions),
    totalClasses: totalSessions,
    holdingStartDate: formatDateToISO(holdingStartDate),
    holdingEndDate: formatDateToISO(holdingEndDate),
    isCurrentlyHolding: holdingUsed,
  };
};

/**
 * 출석 내역 생성
 * @param {Object} student
 * @returns {Array}
 */
export const generateAttendanceHistory = (student, firebaseHolidays = []) => {
  if (!student) return [];

  const startDateStr = getStudentField(student, '시작날짜');
  const scheduleStr = getStudentField(student, '요일 및 시간');
  const holdingStatusStr = getStudentField(student, '홀딩 사용여부');
  const holdingStartStr = getStudentField(student, '홀딩 시작일');
  const holdingEndStr = getStudentField(student, '홀딩 종료일');
  const makeupScheduleStr = getStudentField(student, '보강 요일 및 시간');
  const makeupDateStr = getStudentField(student, '보강 날짜');

  const holdingInfo = parseHoldingStatus(holdingStatusStr);

  const history = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const startDate = parseSheetDate(startDateStr);
  if (startDate && scheduleStr) {
    const schedule = parseScheduleString(scheduleStr);
    const classDays = schedule.map(s => ({
      day: DAY_MAP[s.day],
      dayName: s.day,
      period: s.period
    })).filter(c => c.day !== undefined);

    const holdingStart = holdingInfo.isCurrentlyUsed ? parseSheetDate(holdingStartStr) : null;
    const holdingEnd = holdingInfo.isCurrentlyUsed ? parseSheetDate(holdingEndStr) : null;

    const current = new Date(startDate);
    while (current <= today) {
      const dayOfWeek = current.getDay();
      const classInfo = classDays.find(c => c.day === dayOfWeek);

      if (classInfo) {
        if (isHolidayDate(current, firebaseHolidays)) {
          current.setDate(current.getDate() + 1);
          continue;
        }

        if (holdingStart && holdingEnd &&
          current >= holdingStart && current <= holdingEnd) {
          current.setDate(current.getDate() + 1);
          continue;
        }

        history.push({
          date: formatDateToISO(current),
          period: `${classInfo.period}교시`,
          type: '정규',
          status: '출석'
        });
      }

      current.setDate(current.getDate() + 1);
    }
  }

  if (makeupDateStr && makeupScheduleStr) {
    const makeupDate = parseSheetDate(makeupDateStr);
    if (makeupDate && makeupDate <= today) {
      const makeupSchedule = parseScheduleString(makeupScheduleStr);
      if (makeupSchedule.length > 0) {
        history.push({
          date: formatDateToISO(makeupDate),
          period: `${makeupSchedule[0].period}교시`,
          type: '보강',
          status: '출석'
        });
      }
    }
  }

  history.sort((a, b) => new Date(b.date) - new Date(a.date));

  return history.slice(0, 10);
};

// ─── 학생 데이터 업데이트 ───

/**
 * Update student holding status
 * @param {number} rowIndex - 0-based data row index
 * @param {string} holdingStatus
 * @param {string} holdingStartDate - YYYY-MM-DD
 * @param {string} holdingEndDate - YYYY-MM-DD
 * @param {number} year
 * @param {number} month
 */
export const updateStudentHolding = async (rowIndex, holdingStatus, holdingStartDate, holdingEndDate, year = null, month = null) => {
  const foundSheetName = resolveSheetName(year, month);
  const actualRow = rowIndex + 3;

  await writeSheetData(`${foundSheetName}!M${actualRow}`, [[holdingStatus]]);

  if (holdingStartDate) {
    await writeSheetData(`${foundSheetName}!N${actualRow}`, [[holdingStartDate]]);
  }
  if (holdingEndDate) {
    await writeSheetData(`${foundSheetName}!O${actualRow}`, [[holdingEndDate]]);
  }

  console.log(`Updated holding for row ${actualRow} in sheet ${foundSheetName}`);
};

/**
 * Update student data (주횟수, 요일 및 시간, 홀딩 정보)
 * @param {number} rowIndex - 0-based data row index
 * @param {Object} studentData - fields to update
 * @param {number} year
 * @param {number} month
 */
export const updateStudentData = async (rowIndex, studentData, year = null, month = null) => {
  let foundSheetName;
  if (studentData._foundSheetName) {
    foundSheetName = studentData._foundSheetName;
    console.log(`📍 Using sheet name from student data: ${foundSheetName}`);
  } else {
    foundSheetName = resolveSheetName(year, month);
  }

  const actualRow = rowIndex + 3;
  console.log(`📝 Updating student data for row ${actualRow} in sheet ${foundSheetName}`);

  const columnMap = {
    '주횟수': 'C',
    '요일 및 시간': 'D',
    '시작날짜': 'G',
    '종료날짜': 'H',
    '홀딩 사용여부': 'M',
    '홀딩\n사용여부': 'M',
    '홀딩 시작일': 'N',
    '홀딩\n시작일': 'N',
    '홀딩 종료일': 'O',
    '홀딩\n종료일': 'O'
  };

  for (const [field, value] of Object.entries(studentData)) {
    if (columnMap[field] && value !== undefined) {
      const column = columnMap[field];
      const range = `${foundSheetName}!${column}${actualRow}`;
      await writeSheetData(range, [[value]]);
      console.log(`✅ Updated ${field} to "${value}" at ${range}`);
    }
  }

  console.log(`✨ Successfully updated student data for row ${actualRow}`);
};

// ─── 일시정지 (수강 일시정지) ───

/**
 * from~end(양끝 포함) 사이 수업일 수. 공휴일 제외.
 * ponytail: 미래 홀딩 범위는 미고려 — 드묾, 코치가 숫자 보정. 필요시 holdingRanges 인자 추가.
 */
export const countRemainingSessions = (fromDate, endDate, scheduleStr, firebaseHolidays = []) => {
  const classDays = getClassDays(scheduleStr);
  if (!classDays.length || !fromDate || !endDate) return 0;
  const cur = new Date(fromDate); cur.setHours(0, 0, 0, 0);
  const end = new Date(endDate); end.setHours(0, 0, 0, 0);
  let count = 0, guard = 0;
  while (cur <= end && guard++ < 400) {
    if (classDays.includes(cur.getDay()) && !isHolidayDate(cur, firebaseHolidays)) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
};

/**
 * 오늘 그 수강생 수업이 이미 끝났는지 (오늘 마지막 교시 종료시각 경과 여부).
 * 오늘이 수업일이 아니면 false.
 */
export const todaySessionDone = (scheduleStr, now = new Date()) => {
  const todays = parseScheduleString(scheduleStr).filter(s => DAY_MAP[s.day] === now.getDay());
  if (!todays.length) return false;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const lastEnd = Math.max(...todays.map(s => {
    const p = PERIODS.find(x => x.id === s.period);
    if (!p) return 0;
    const dur = p.type === 'free' ? 120 : 90;  // 3교시(자율)만 2시간, 나머지 90분
    return p.startHour * 60 + p.startMinute + dur;
  }));
  return nowMin >= lastEnd;
};

/** date 이후(포함) scheduleStr의 첫 수업일. (재개 시작일 보정) */
export const firstClassDayOnOrAfter = (date, scheduleStr) => {
  const classDays = getClassDays(scheduleStr);
  const cur = new Date(date); cur.setHours(0, 0, 0, 0);
  for (let i = 0; i < 14 && classDays.length; i++) {
    if (classDays.includes(cur.getDay())) return new Date(cur);
    cur.setDate(cur.getDate() + 1);
  }
  return new Date(date);
};

const fmtYYMMDD = (d) => {
  const yy = String(d.getFullYear()).slice(2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
};

// 정지 시 원래 일정을 특이사항(E)에 보존하는 태그: [정지:주횟수/요일및시간/원래시작YYMMDD]
const PAUSE_TAG_RE = /\s*\[정지:([^/\]]*)\/([^/\]]*)\/([^\]]*)\]/;

/** 이름으로 모든 등록생 시트의 해당 행을 순회 (헤더 인덱스 동봉). */
const eachStudentRowAcrossSheets = async (studentName, cb) => {
  const allSheets = await getAllSheetNames();
  const studentSheets = allSheets.filter(name => name.startsWith('등록생 목록('));
  for (const sheetName of studentSheets) {
    let rows;
    try { rows = await readSheetData(`${sheetName}!A:R`); } catch { continue; }
    if (!rows || rows.length < 2) continue;
    const headers = rows[1];
    const col = (names) => { for (const n of names) { const i = headers.indexOf(n); if (i !== -1) return i; } return -1; };
    const idx = {
      name: col(['이름']),
      weekly: col(['주횟수']),
      schedule: col(['요일 및 시간', '요일 및\n시간', '요일및시간']),
      start: col(['시작날짜']),
      end: col(['종료날짜']),
      notes: col(['특이사항']),
    };
    if (idx.name === -1) continue;
    for (let r = 2; r < rows.length; r++) {
      if ((rows[r][idx.name] || '') !== studentName) continue;
      await cb({ sheetName, rowIdx: r, row: rows[r], idx });
    }
  }
};

/**
 * 수강생 일시정지 — 이름으로 모든 시트를 훑어 스케줄이 있는 등록 행을 전부 정지.
 * (현재 등록 + 다른 월 시트의 미리 등록까지 포함)
 * 각 행: 주횟수(C)·요일및시간(D) 비우고, 종료날짜(H)=남은 "N회", 특이사항(E)에 복원 태그 보존.
 * 미시작(미리등록) 행은 시작날짜(G)도 비움. 이미 시작한 행은 오늘 수업이 끝났으면 오늘 제외.
 * @returns {Promise<Array<{n:number, notStarted:boolean, sheetName:string}>>}
 */
export const pauseStudent = async (studentName, firebaseHolidays = []) => {
  const now = new Date();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const results = [];

  await eachStudentRowAcrossSheets(studentName, async ({ sheetName, rowIdx, row, idx }) => {
    const schedule = idx.schedule !== -1 ? String(row[idx.schedule] || '') : '';
    if (!schedule.trim()) return;  // 스케줄 없는 행(이미 정지/종료)은 대상 아님

    const startStr = idx.start !== -1 ? row[idx.start] : '';
    const weekly = idx.weekly !== -1 ? String(row[idx.weekly] || '') : '';
    const start = parseSheetDate(startStr);
    const end = parseSheetDate(idx.end !== -1 ? row[idx.end] : '');
    const notStarted = !!(start && start > today);
    if (end && end < today && !notStarted) return;  // 이미 종료된 과거 등록은 정지 대상 아님

    let countFrom;
    if (notStarted) {
      countFrom = start;
    } else {
      countFrom = new Date(today);
      if (todaySessionDone(schedule, now)) countFrom.setDate(countFrom.getDate() + 1);
    }
    const n = countRemainingSessions(countFrom, end, schedule, firebaseHolidays);

    const sheetRow = rowIdx + 1;
    const prevNotes = idx.notes !== -1 ? String(row[idx.notes] || '').replace(PAUSE_TAG_RE, '').trim() : '';
    const origStartDigits = startStr ? String(startStr).replace(/\D/g, '') : '';
    const taggedNotes = `${prevNotes}${prevNotes ? ' ' : ''}[정지:${weekly}/${schedule}/${origStartDigits}]`;
    const cell = (i, v) => ({ range: `${sheetName}!${getColumnLetter(i)}${sheetRow}`, values: [[v]] });

    const updates = [cell(idx.schedule, '')];
    if (idx.weekly !== -1) updates.push(cell(idx.weekly, ''));
    if (idx.end !== -1) updates.push(cell(idx.end, `${n}회`));
    if (idx.notes !== -1) updates.push(cell(idx.notes, taggedNotes));
    if (notStarted && idx.start !== -1) updates.push(cell(idx.start, ''));
    await batchUpdateSheet(updates);
    results.push({ n, notStarted, sheetName });
  });

  if (!results.length) throw new Error('정지할 등록을 찾지 못했습니다.');
  return results;
};

/**
 * 수강생 재개 — 정지된(스케줄 비고 종료날짜 "N회") 행을 복원.
 * 특이사항 태그에서 원래 주횟수/요일및시간을 되살리고, restartDate부터 종료날짜 재계산.
 * 여러 등록이면 원래 시작일 순으로 이어붙임(앞 등록 종료 다음날부터 다음 등록 시작).
 * @returns {Promise<Array<{start:string, end:string, n:number, schedule:string}>>}
 */
export const resumeStudent = async (studentName, restartDate, firebaseHolidays = []) => {
  const collected = [];
  await eachStudentRowAcrossSheets(studentName, async ({ sheetName, rowIdx, row, idx }) => {
    const schedule = idx.schedule !== -1 ? String(row[idx.schedule] || '') : '';
    const endStr = idx.end !== -1 ? String(row[idx.end] || '') : '';
    if (schedule.trim()) return;                 // 스케줄 있으면 정지 상태 아님
    if (!/^\s*\d+\s*회\s*$/.test(endStr)) return; // H가 "N회" 아니면 스킵
    const notes = idx.notes !== -1 ? String(row[idx.notes] || '') : '';
    const m = notes.match(PAUSE_TAG_RE);
    if (!m) return;                               // 복원 태그 없으면 원래 일정 모름 → 스킵
    collected.push({
      sheetName, sheetRow: rowIdx + 1, idx,
      origWeekly: m[1], origSchedule: m[2], origStartDigits: m[3] || '99999999',
      n: parseInt(endStr, 10),
      restNotes: notes.replace(PAUSE_TAG_RE, '').trim(),
    });
  });

  if (!collected.length) throw new Error('재개할 정지 등록을 찾지 못했습니다.');
  collected.sort((a, b) => a.origStartDigits.localeCompare(b.origStartDigits));

  let cursor = new Date(restartDate); cursor.setHours(0, 0, 0, 0);
  const results = [];
  for (const c of collected) {
    const start = firstClassDayOnOrAfter(cursor, c.origSchedule);
    const end = calculateEndDate(start, c.n, c.origSchedule, null, firebaseHolidays);
    const startStr = fmtYYMMDD(start);
    const endStr = end ? fmtYYMMDD(end) : '';
    const cell = (i, v) => ({ range: `${c.sheetName}!${getColumnLetter(i)}${c.sheetRow}`, values: [[v]] });

    const updates = [cell(c.idx.schedule, c.origSchedule)];
    if (c.idx.weekly !== -1) updates.push(cell(c.idx.weekly, c.origWeekly));
    if (c.idx.start !== -1) updates.push(cell(c.idx.start, startStr));
    if (c.idx.end !== -1) updates.push(cell(c.idx.end, endStr));
    if (c.idx.notes !== -1) updates.push(cell(c.idx.notes, c.restNotes));
    await batchUpdateSheet(updates);

    results.push({ start: startStr, end: endStr, n: c.n, schedule: c.origSchedule });
    if (end) { cursor = new Date(end); cursor.setDate(cursor.getDate() + 1); }
  }
  return results;
};

// ─── 홀딩 신청/취소 ───

/**
 * 홀딩 신청
 * @param {string} studentName
 * @param {Date} holdingStartDate
 * @param {Date} holdingEndDate
 * @param {number} year
 * @param {number} month
 * @param {Array} existingHoldings - [{startDate, endDate}, ...]
 * @returns {Promise<Object>}
 */
export const requestHolding = async (studentName, holdingStartDate, holdingEndDate = null, year = null, month = null, existingHoldings = [], firebaseHolidays = [], makeupHoldingCount = 0, targetRegistration = 'current', countedHolidayDates = []) => {
  const endDate = holdingEndDate || holdingStartDate;

  console.log(`🔍 홀딩 신청 시작: ${studentName}, ${holdingStartDate.toISOString().split('T')[0]} ~ ${endDate.toISOString().split('T')[0]} (대상: ${targetRegistration})`);

  const primarySheetName = getCurrentSheetName(holdingStartDate);
  const { foundSheetName, rows, headers, studentIndex, nextRegistrationIndex, nextSheetName, nextRows, nextHeaders } =
    await findStudentInSheets(studentName, primarySheetName, holdingStartDate);

  // 홀딩은 신청 날짜가 포함된 등록 행에 반영한다. 시작 전 미리등록도 이 기준으로 정확히 선택된다.
  const targetSheetName = foundSheetName;
  const targetRows = rows;
  const targetHeaders = headers;
  const targetRowIndex = studentIndex;

  console.log(`📄 최종 선택 시트: ${targetSheetName}, 행: ${targetRowIndex + 1}`);

  const holdingUsedCol = findColumnIndex(targetHeaders, '홀딩 사용여부');
  const holdingStartCol = findColumnIndex(targetHeaders, '홀딩 시작일');
  const holdingEndCol = findColumnIndex(targetHeaders, '홀딩 종료일');
  const endDateCol = findColumnIndex(targetHeaders, '종료날짜');

  console.log(`📍 필드 위치: 사용여부=${holdingUsedCol}, 시작일=${holdingStartCol}, 종료일=${holdingEndCol}, 종료날짜=${endDateCol}`);

  if (holdingUsedCol === -1 || holdingStartCol === -1 || holdingEndCol === -1) {
    console.error('헤더:', targetHeaders);
    throw new Error('홀딩 관련 필드를 찾을 수 없습니다. (홀딩 사용여부, 홀딩 시작일, 홀딩 종료일)');
  }

  const studentRow = targetRows[targetRowIndex];
  const studentData = buildStudentObject(targetHeaders, studentRow);

  const startDateField = getStudentField(studentData, '시작날짜');
  const scheduleStr = getStudentField(studentData, '요일 및 시간');
  const weeklyFrequencyStr = getStudentField(studentData, '주횟수');

  const membershipStartDate = parseSheetDate(startDateField);
  const weeklyFrequency = parseInt(weeklyFrequencyStr) || 2;

  const currentHoldingStatusStr = getStudentField(studentData, '홀딩 사용여부');
  const holdingInfo = parseHoldingStatus(currentHoldingStatusStr);
  const totalSessions = getTotalSessions(weeklyFrequency, holdingInfo);

  console.log(`📊 수강생 정보: 시작일=${startDateField}, 주횟수=${weeklyFrequency}, 등록개월=${holdingInfo.months}, 총 횟수=${totalSessions}`);
  console.log(`📊 홀딩 정보: 사용=${holdingInfo.used}/${holdingInfo.total}`);

  if (!membershipStartDate) {
    throw new Error(`시작날짜를 해석할 수 없습니다: ${startDateField || '비어 있음'}`);
  }
  if (!scheduleStr || getClassDays(scheduleStr).length === 0) {
    throw new Error(`수업 요일을 해석할 수 없습니다: ${scheduleStr || '비어 있음'}`);
  }

  // 기존 홀딩(이미 저장된 종료일에 반영됨)
  const priorHoldingRanges = (existingHoldings || []).map(h => ({
    start: new Date(`${h.startDate}T00:00:00`),
    end: new Date(`${h.endDate}T00:00:00`),
  }));

  // 저장된 종료일(H)을 신뢰하고, 이번에 빠지는 수업일 수만큼만 뒤로 민다.
  // 시작일부터 전체 재계산하면 시간표 중간 변경으로 소진한(다른 요일) 수업이
  // 증발해 종료일이 잘못 늘어남 → delta 방식으로 통일.
  const storedEndDate = parseSheetDate(getStudentField(studentData, '종료날짜'));
  let newEndDate;
  if (storedEndDate) {
    newEndDate = extendEndDateForHeldSessions({
      endDate: storedEndDate,
      startDate: membershipStartDate,
      classDays: getClassDays(scheduleStr),
      newHeldDates: enumerateDatesISO(holdingStartDate, endDate),
      isHoliday: (d) => isHolidayDate(d, firebaseHolidays),
      priorHoldingRanges,
      extraSessions: makeupHoldingCount, // 보강일(비정규 요일) 홀딩 추가 연장분
    });
  } else {
    // H 없음(구 데이터) → 기존 전체 재계산으로 폴백
    newEndDate = calculateEndDate(
      membershipStartDate, totalSessions, scheduleStr,
      [...priorHoldingRanges, { start: holdingStartDate, end: endDate }],
      firebaseHolidays, countedHolidayDates,
    );
  }

  if (!newEndDate) {
    throw new Error('종료일 계산에 실패했습니다.');
  }

  const startDateStr = formatDateToYYMMDD(holdingStartDate);
  const endDateStr = formatDateToYYMMDD(endDate);
  const newEndDateStr = formatDateToYYMMDD(newEndDate);

  const newUsedCount = holdingInfo.used + 1;
  const newHoldingStatus = formatHoldingStatus(true, newUsedCount, holdingInfo.total);

  console.log(`📝 업데이트할 데이터: 사용여부=${newHoldingStatus}, 시작일=${startDateStr}, 종료일=${endDateStr}, 새 종료날짜=${newEndDateStr}`);

  const updates = [
    { range: `${targetSheetName}!${getColumnLetter(holdingUsedCol)}${targetRowIndex + 1}`, values: [[newHoldingStatus]] },
    { range: `${targetSheetName}!${getColumnLetter(holdingStartCol)}${targetRowIndex + 1}`, values: [[startDateStr]] },
    { range: `${targetSheetName}!${getColumnLetter(holdingEndCol)}${targetRowIndex + 1}`, values: [[endDateStr]] },
  ];

  if (endDateCol !== -1) {
    updates.push({
      range: `${targetSheetName}!${getColumnLetter(endDateCol)}${targetRowIndex + 1}`,
      values: [[newEndDateStr]]
    });
  }

  await batchUpdateSheet(updates);

  // 하이라이트 적용 (실패해도 홀딩 신청은 성공)
  const cellsToHighlight = updates.map(u => u.range.split('!')[1]);
  try {
    await highlightCells(cellsToHighlight, targetSheetName);
    console.log(`🎨 셀 하이라이트 완료: ${cellsToHighlight.join(', ')}`);
  } catch (highlightError) {
    console.warn('⚠️ 셀 하이라이트 실패 (홀딩 신청은 완료됨):', highlightError);
  }

  console.log(`✅ 홀딩 신청 완료: ${studentName}, ${startDateStr} ~ ${endDateStr}`);
  console.log(`📅 종료일 연장: ${newEndDateStr}`);

  // 선택된 등록 뒤에 미리 등록이 있으면 자동 조정
  if (nextRegistrationIndex !== -1 && nextRegistrationIndex !== undefined) {
    try {
      const nSheet = nextSheetName || foundSheetName;
      const nRows = nextRows || rows;
      const nHeaders = nextHeaders || headers;
      await adjustNextRegistration(nSheet, nRows, nHeaders, nextRegistrationIndex, newEndDate, firebaseHolidays);
    } catch (adjustError) {
      console.warn('⚠️ 다음 등록 자동 조정 실패 (홀딩은 정상 처리됨):', adjustError);
    }
  }

  return { success: true, newEndDate: newEndDateStr };
};

/**
 * 다음 등록(미리 등록)의 시작일/종료일을 현재 등록 종료일 기준으로 자동 조정
 * @param {string} sheetName - 시트 이름
 * @param {Array} rows - 시트 데이터
 * @param {Array} headers - 헤더
 * @param {number} nextRowIndex - 다음 등록의 행 인덱스
 * @param {Date} currentEndDate - 현재 등록의 새 종료일
 * @param {Array} firebaseHolidays - 커스텀 공휴일
 */
async function adjustNextRegistration(sheetName, rows, headers, nextRowIndex, currentEndDate, firebaseHolidays = []) {
  const nextRow = rows[nextRowIndex];
  const nextData = buildStudentObject(headers, nextRow);

  const nextScheduleStr = getStudentField(nextData, '요일 및 시간');
  const nextWeeklyFreq = parseInt(getStudentField(nextData, '주횟수')) || 2;
  const nextHoldingStatus = parseHoldingStatus(getStudentField(nextData, '홀딩 사용여부'));
  const nextTotalSessions = getTotalSessions(nextWeeklyFreq, nextHoldingStatus);

  // 다음 등록의 새 시작일 = 현재 등록 종료일 다음 수업일
  const classDays = getClassDays(nextScheduleStr);
  let newNextStart = new Date(currentEndDate);
  newNextStart.setDate(newNextStart.getDate() + 1);
  let maxIter = 30;
  while (maxIter > 0) {
    if (classDays.includes(newNextStart.getDay()) && !isHolidayDate(newNextStart, firebaseHolidays)) {
      break;
    }
    newNextStart.setDate(newNextStart.getDate() + 1);
    maxIter--;
  }

  // 다음 등록의 새 종료일 계산
  const newNextEnd = calculateEndDate(newNextStart, nextTotalSessions, nextScheduleStr, null, firebaseHolidays);

  if (!newNextEnd) {
    console.warn('⚠️ 다음 등록 종료일 계산 실패');
    return;
  }

  const startDateCol = findColumnIndex(headers, '시작날짜');
  const endDateCol = findColumnIndex(headers, '종료날짜');

  const newNextStartStr = formatDateToYYMMDD(newNextStart);
  const newNextEndStr = formatDateToYYMMDD(newNextEnd);

  const nextUpdates = [];
  if (startDateCol !== -1) {
    nextUpdates.push({
      range: `${sheetName}!${getColumnLetter(startDateCol)}${nextRowIndex + 1}`,
      values: [[newNextStartStr]]
    });
  }
  if (endDateCol !== -1) {
    nextUpdates.push({
      range: `${sheetName}!${getColumnLetter(endDateCol)}${nextRowIndex + 1}`,
      values: [[newNextEndStr]]
    });
  }

  if (nextUpdates.length > 0) {
    await batchUpdateSheet(nextUpdates);
    // 하이라이트
    try {
      const cells = nextUpdates.map(u => u.range.split('!')[1]);
      await highlightCells(cells, sheetName);
    } catch (e) { /* 무시 */ }
    console.log(`📅 다음 등록 자동 조정: 시작일 ${newNextStartStr}, 종료일 ${newNextEndStr}`);
  }
}

/**
 * 휴일 추가/삭제 시 영향받는 수강생의 종료일(H열)을 증분 조정.
 * @param {Object} p
 * @param {string[]} p.changedDates - 방금 추가/삭제된 날짜 'YYYY-MM-DD'
 * @param {'add'|'delete'} p.mode
 * @param {Array<{date:string}>} p.firebaseHolidays - 변경 반영된 전체 커스텀 휴일
 * @returns {Promise<{affectedStudents:number, perSheet:Object, errors:string[]}>}
 */
export const applyHolidayDeltaToEndDates = async ({ changedDates, mode, firebaseHolidays }) => {
  const result = { affectedStudents: 0, perSheet: {}, errors: [] };
  if (!changedDates || changedDates.length === 0) return result;

  const sorted = [...changedDates].sort();
  const earliest = new Date(sorted[0] + 'T00:00:00');
  const latest = new Date(sorted[sorted.length - 1] + 'T00:00:00');

  // 수강 기간이 최대 3개월(+홀딩 연장) 이므로, 가장 이른 휴일 달의 3개월
  // 전부터 가장 늦은 휴일 달까지의 월별 시트를 모두 스캔한다.
  const startCursor = new Date(earliest.getFullYear(), earliest.getMonth() - 3, 1);
  // endCursor: 가장 늦은 휴일이 속한 달까지 스캔 (상한 경계)
  const endCursor = new Date(latest.getFullYear(), latest.getMonth(), 1);
  const wanted = [];
  for (
    let d = new Date(startCursor);
    d <= endCursor;
    d = new Date(d.getFullYear(), d.getMonth() + 1, 1)
  ) {
    wanted.push(getSheetNameByYearMonth(d.getFullYear(), d.getMonth() + 1));
  }
  let existing = [];
  try {
    existing = await getAllSheetNames();
  } catch (e) {
    result.errors.push(`시트 목록 조회 실패: ${e.message}`);
    return result;
  }
  const sheetNames = wanted.filter((n) => existing.includes(n));

  // 추가/삭제 모드 모두: 기본 한국 공휴일은 이미 종료일 계산에서 휴일로 취급되므로
  // 커스텀 휴일 delta 대상에서 제외한다. 중복 연장/중복 단축 방지.
  const effectiveChanged = filterEffectiveHolidayDeltaDates({
    changedDates,
    mode,
    isBuiltInHoliday: (ds) => isHolidayDate(new Date(ds + 'T00:00:00'), []),
  });
  if (effectiveChanged.length === 0) return result;

  const isHoliday = (date) => isHolidayDate(date, firebaseHolidays);

  for (const sheetName of sheetNames) {
    try {
      const rows = await readSheetData(`${sheetName}!A:R`);
      if (!rows || rows.length < 3) {
        result.perSheet[sheetName] = 0;
        continue;
      }
      const headers = rows[1];
      const nameCol = findColumnIndex(headers, '이름');
      const startCol = findColumnIndex(headers, '시작날짜');
      const endCol = findColumnIndex(headers, '종료날짜');
      const schedCol = findColumnIndex(headers, '요일 및 시간');
      const notesCol = findColumnIndex(headers, '특이사항');
      const holdUsedCol = findColumnIndex(headers, '홀딩 사용여부');
      const holdStartCol = findColumnIndex(headers, '홀딩 시작일');
      const holdEndCol = findColumnIndex(headers, '홀딩 종료일');

      if (endCol === -1 || startCol === -1 || schedCol === -1 || nameCol === -1) {
        result.errors.push(`${sheetName}: 필수 컬럼 없음`);
        result.perSheet[sheetName] = 0;
        continue;
      }

      const shifted = []; // { rowIndex, newEndDate(Date), studentName }
      const updates = [];

      for (let i = 2; i < rows.length; i++) {
        const row = rows[i];
        if (!row || !row[nameCol]) continue;
        const startDate = parseSheetDate(row[startCol]);
        const endDate = parseSheetDate(row[endCol]);
        const scheduleStr = row[schedCol] || '';
        if (!startDate || !endDate || !scheduleStr) continue;
        const classDays = getClassDays(scheduleStr);
        if (classDays.length === 0) continue;

        const holdingInfo = parseHoldingStatus(holdUsedCol !== -1 ? row[holdUsedCol] : '');
        const holdingRanges = [];
        if (holdingInfo.isCurrentlyUsed && holdStartCol !== -1 && holdEndCol !== -1) {
          const hs = parseSheetDate(row[holdStartCol]);
          const he = parseSheetDate(row[holdEndCol]);
          if (hs && he) holdingRanges.push({ start: hs, end: he });
        }
        const absenceDateSet = new Set(
          parseAbsenceDatesFromNotes(notesCol !== -1 ? row[notesCol] : ''),
        );

        let n = 0;
        for (const ds of effectiveChanged) {
          const hd = new Date(ds + 'T00:00:00');
          if (
            isHolidayRelevantToStudent({
              holidayDate: hd, classDays, startDate, endDate, holdingRanges, absenceDateSet,
            })
          ) {
            n += 1;
          }
        }
        if (n === 0) continue;

        const delta = mode === 'add' ? n : -n;
        const newEnd = shiftEndDateBySessions({
          endDate, deltaSessions: delta, classDays, holdingRanges, isHoliday,
        });
        if (!newEnd) {
          result.errors.push(`${sheetName} ${row[nameCol]}: 종료일 계산 실패(가드 소진)`);
          continue;
        }
        if (newEnd < startDate) {
          result.errors.push(`${sheetName} ${row[nameCol]}: 종료일이 시작일 이전 — 건너뜀`);
          continue;
        }
        updates.push({
          range: `${sheetName}!${getColumnLetter(endCol)}${i + 1}`,
          values: [[formatDateToYYMMDD(newEnd)]],
        });
        shifted.push({ rowIndex: i, newEndDate: newEnd, studentName: row[nameCol] });
      }

      if (updates.length > 0) {
        await batchUpdateSheet(updates);
        try {
          await highlightCells(updates.map((u) => u.range.split('!')[1]), sheetName);
        } catch (e) {
          console.warn('휴일 종료일 조정 하이라이트 실패:', e);
        }

        // 미리 등록(다음 등록) 자동 조정
        const shiftedRowIndices = new Set(shifted.map((x) => x.rowIndex));
        for (const s of shifted) {
          const sameName = findAllStudentRowIndices(rows, headers, s.studentName);
          if (sameName.length < 2) continue;
          const curStart = parseSheetDate(rows[s.rowIndex][startCol]);
          let nextIdx = -1;
          let nextStart = null;
          for (const idx of sameName) {
            if (idx === s.rowIndex) continue;
            const st = parseSheetDate(rows[idx][startCol]);
            if (st && curStart && st > curStart && (!nextStart || st < nextStart)) {
              nextStart = st;
              nextIdx = idx;
            }
          }
          if (nextIdx !== -1 && !shiftedRowIndices.has(nextIdx)) {
            try {
              await adjustNextRegistration(
                sheetName, rows, headers, nextIdx, s.newEndDate, firebaseHolidays,
              );
            } catch (e) {
              console.warn(`다음 등록 조정 실패 (${s.studentName}):`, e);
            }
          }
        }
        result.affectedStudents += shifted.length;
      }
      result.perSheet[sheetName] = updates.length;
    } catch (e) {
      result.errors.push(`${sheetName}: ${e.message}`);
    }
  }

  return result;
};

/**
 * 홀딩 취소 (Google Sheets에서 홀딩 정보 초기화 + 종료날짜 재계산)
 * @param {string} studentName
 * @param {Array} remainingHoldings - 취소 후 남은 홀딩 목록
 * @returns {Promise<Object>}
 */
export const cancelHoldingInSheets = async (studentName, remainingHoldings = [], firebaseHolidays = [], countedHolidayDates = []) => {
  console.log(`🔄 홀딩 취소 시작 (Google Sheets): ${studentName}`);

  const { foundSheetName, rows, headers, studentIndex: activeIndex, nextRegistrationIndex, nextSheetName, nextRows, nextHeaders } =
    await findStudentInSheets(studentName);

  const student = buildStudentObject(headers, rows[activeIndex]);
  student._rowIndex = activeIndex - 2; // parseStudentData 호환
  const actualRow = activeIndex + 1; // 시트 행번호 (1-based)

  const holdingUsedCol = findColumnIndex(headers, '홀딩 사용여부');
  const holdingStartCol = findColumnIndex(headers, '홀딩 시작일');
  const holdingEndCol = findColumnIndex(headers, '홀딩 종료일');
  const endDateCol = findColumnIndex(headers, '종료날짜');

  if (holdingUsedCol === -1) {
    throw new Error('홀딩 사용여부 필드를 찾을 수 없습니다.');
  }

  const startDateStr = getStudentField(student, '시작날짜');
  const scheduleStr = getStudentField(student, '요일 및 시간');
  const weeklyFrequencyStr = getStudentField(student, '주횟수');

  const currentHoldingStatusStr = getStudentField(student, '홀딩 사용여부');
  const holdingInfo = parseHoldingStatus(currentHoldingStatusStr);

  const membershipStartDate = parseSheetDate(startDateStr);
  const weeklyFrequency = parseInt(weeklyFrequencyStr) || 2;
  const totalSessions = getTotalSessions(weeklyFrequency, holdingInfo);

  console.log(`📊 홀딩 취소 - 수강생 정보: 등록개월=${holdingInfo.months}, 홀딩 사용=${holdingInfo.used}/${holdingInfo.total}`);

  // 남은 홀딩들을 고려하여 종료날짜 재계산
  let newEndDateStr = '';
  if (membershipStartDate && scheduleStr) {
    const holdingRanges = (remainingHoldings || []).map(h => ({
      start: new Date(h.startDate + 'T00:00:00'),
      end: new Date(h.endDate + 'T00:00:00')
    }));

    if (holdingRanges.length > 0) {
      console.log(`📊 남은 홀딩 ${holdingRanges.length}개 포함하여 종료일 계산`);
    } else {
      console.log(`📊 남은 홀딩 없음 - 원래 종료일로 계산`);
    }

    // ponytail: 홀딩 취소는 아직 시작일부터 전체 재계산. 취소된 홀딩 날짜를 넘겨받지 못해
    // delta(-N)로 못 줄임 → 시간표 중간 변경 등록은 취소 시 baseline이 어긋날 수 있음.
    // 취소된 홀딩 dates를 파라미터로 받아 shiftEndDateBySessions(-N)로 바꾸면 통일됨(별도 작업).
    const newEndDate = calculateEndDate(membershipStartDate, totalSessions, scheduleStr, holdingRanges, firebaseHolidays, countedHolidayDates);
    if (newEndDate) {
      newEndDateStr = formatDateToYYMMDD(newEndDate);
    }
  }

  const newUsedCount = Math.max(0, holdingInfo.used - 1);
  const newHoldingStatus = formatHoldingStatus(false, newUsedCount, holdingInfo.total);

  console.log(`📝 홀딩 취소 - 새 상태: ${newHoldingStatus}`);

  const updates = [
    { range: `${foundSheetName}!${getColumnLetter(holdingUsedCol)}${actualRow}`, values: [[newHoldingStatus]] },
  ];

  if (holdingStartCol !== -1) {
    updates.push({ range: `${foundSheetName}!${getColumnLetter(holdingStartCol)}${actualRow}`, values: [['']] });
  }
  if (holdingEndCol !== -1) {
    updates.push({ range: `${foundSheetName}!${getColumnLetter(holdingEndCol)}${actualRow}`, values: [['']] });
  }
  if (endDateCol !== -1 && newEndDateStr) {
    updates.push({ range: `${foundSheetName}!${getColumnLetter(endDateCol)}${actualRow}`, values: [[newEndDateStr]] });
    console.log(`📅 종료날짜 재계산: ${newEndDateStr}`);
  }

  await batchUpdateSheet(updates);

  // 다음 등록(미리 등록)이 있으면 시작일/종료일 자동 조정
  if (nextRegistrationIndex !== -1 && nextRegistrationIndex !== undefined && newEndDateStr) {
    try {
      const newEndDate = parseSheetDate(newEndDateStr);
      if (newEndDate) {
        const nSheet = nextSheetName || foundSheetName;
        const nRows = nextRows || rows;
        const nHeaders = nextHeaders || headers;
        await adjustNextRegistration(nSheet, nRows, nHeaders, nextRegistrationIndex, newEndDate, firebaseHolidays);
      }
    } catch (adjustError) {
      console.warn('⚠️ 다음 등록 자동 조정 실패 (홀딩 취소는 정상 처리됨):', adjustError);
    }
  }

  console.log(`✅ 홀딩 취소 완료 (Google Sheets): ${studentName}`);
  return { success: true, newEndDate: newEndDateStr };
};

// ─── 스케줄 삭제 ───

/**
 * 모든 시트에서 해당 학생의 '요일 및 시간' 컬럼을 비움 (종료 처리)
 * @param {string} studentName
 * @returns {Promise<number>} - 업데이트된 시트 수
 */
export const clearStudentScheduleAllSheets = async (studentName) => {
  console.log(`🔄 모든 시트에서 ${studentName}의 스케줄 삭제 시작...`);

  const allSheets = await getAllSheetNames();
  const studentSheets = allSheets.filter(name => name.startsWith('등록생 목록('));

  let updatedCount = 0;

  for (const sheetName of studentSheets) {
    try {
      const rows = await readSheetData(`${sheetName}!A:Z`);
      if (!rows || rows.length < 2) continue;

      const headers = rows[1];
      const nameColIndex = headers.indexOf('이름');
      if (nameColIndex === -1) continue;

      // '요일 및 시간' 컬럼 찾기 (변형 포함)
      let scheduleColIndex = headers.indexOf('요일 및 시간');
      if (scheduleColIndex === -1) scheduleColIndex = headers.indexOf('요일 및\n시간');
      if (scheduleColIndex === -1) scheduleColIndex = headers.indexOf('요일및시간');
      if (scheduleColIndex === -1) continue;

      for (let rowIdx = 2; rowIdx < rows.length; rowIdx++) {
        const row = rows[rowIdx];
        if (row[nameColIndex] === studentName && row[scheduleColIndex]) {
          const col = getColumnLetter(scheduleColIndex);
          const cellRange = `${sheetName}!${col}${rowIdx + 1}`;
          await writeSheetData(cellRange, [['']]);
          console.log(`✅ ${sheetName}에서 ${studentName}의 스케줄 삭제 완료 (${cellRange})`);
          updatedCount++;
        }
      }
    } catch (sheetError) {
      console.warn(`⚠️ ${sheetName} 처리 중 오류:`, sheetError.message);
    }
  }

  console.log(`✨ 총 ${updatedCount}개 시트에서 스케줄 삭제 완료`);
  return updatedCount;
};

// ─── 결석 처리 ───

/**
 * 수강생 결석 처리
 * - 특이사항에 "26.M.D, 26.M.D 결석" 형식으로 기록
 * - 종료날짜를 결석 횟수만큼 뒤로 연장
 * @param {string} studentName
 * @param {Array<string>} absenceDates - YYYY-MM-DD 형식
 * @param {Array} firebaseHolidays
 * @returns {Promise<Object>} - { success, newEndDate, notesText, validAbsenceCount }
 */
export const processStudentAbsence = async (studentName, absenceDates, firebaseHolidays = [], countedHolidayDates = []) => {
  console.log(`🔄 결석 처리 시작: ${studentName}, 날짜: ${absenceDates.join(', ')}`);

  const { foundSheetName, rows, headers, studentIndex } =
    await findStudentInSheets(studentName);

  const notesCol = findColumnIndex(headers, '특이사항');
  const endDateCol = findColumnIndex(headers, '종료날짜');
  const startDateCol = findColumnIndex(headers, '시작날짜');
  const scheduleCol = findColumnIndex(headers, '요일 및 시간');
  const weeklyFreqCol = findColumnIndex(headers, '주횟수');
  const holdingUsedCol = findColumnIndex(headers, '홀딩 사용여부');

  if (endDateCol === -1 || scheduleCol === -1) {
    throw new Error('필요한 필드를 찾을 수 없습니다.');
  }

  const studentRow = rows[studentIndex];

  // 기존 특이사항
  const currentNotes = (notesCol !== -1 && studentRow[notesCol]) ? studentRow[notesCol] : '';

  // 결석 날짜를 "YY.M.D" 형식으로 변환
  const absenceTexts = absenceDates.map(dateStr => {
    const d = new Date(dateStr + 'T00:00:00');
    const yy = String(d.getFullYear()).slice(2);
    return `${yy}.${d.getMonth() + 1}.${d.getDate()}`;
  });
  const absenceNote = `${absenceTexts.join(', ')} 결석`;
  const newNotes = currentNotes ? `${currentNotes}, ${absenceNote}` : absenceNote;

  // 스케줄 정보
  const scheduleStr = scheduleCol !== -1 ? (studentRow[scheduleCol] || '') : '';
  const startDateStr = startDateCol !== -1 ? (studentRow[startDateCol] || '') : '';
  const weeklyFreqStr = weeklyFreqCol !== -1 ? (studentRow[weeklyFreqCol] || '') : '';
  const holdingStatusStr = holdingUsedCol !== -1 ? (studentRow[holdingUsedCol] || '') : '';

  // 수업 요일 파싱
  const classDays = getClassDays(scheduleStr);

  // 결석 날짜 중 실제 수업일만 필터
  const validAbsenceDates = absenceDates.filter(dateStr => {
    const d = new Date(dateStr + 'T00:00:00');
    return classDays.includes(d.getDay());
  });

  console.log(`📊 결석 날짜 ${absenceDates.length}개 중 수업일: ${validAbsenceDates.length}개`);

  // 종료날짜 재계산
  const membershipStartDate = parseSheetDate(startDateStr);
  const weeklyFrequency = parseInt(weeklyFreqStr) || 2;
  const holdingInfo = parseHoldingStatus(holdingStatusStr);
  const totalSessions = getTotalSessions(weeklyFrequency, holdingInfo);

  // 결석일을 1일짜리 홀딩 범위로 변환
  const absenceRanges = validAbsenceDates.map(dateStr => {
    const d = new Date(dateStr + 'T00:00:00');
    return { start: d, end: d };
  });

  // 기존 홀딩 기간도 포함
  const studentData = buildStudentObject(headers, studentRow);
  const holdingStartStr = getStudentField(studentData, '홀딩 시작일');
  const holdingEndStr = getStudentField(studentData, '홀딩 종료일');

  const priorHoldingRanges = [];
  if (holdingInfo.isCurrentlyUsed && holdingStartStr && holdingEndStr) {
    const hs = parseSheetDate(holdingStartStr);
    const he = parseSheetDate(holdingEndStr);
    if (hs && he) priorHoldingRanges.push({ start: hs, end: he });
  }

  // 저장된 종료일에서 결석한 수업일만큼만 delta로 민다 (홀딩과 동일).
  const storedEndDate = parseSheetDate(endDateCol !== -1 ? studentRow[endDateCol] : '');
  let newEndDate;
  if (storedEndDate) {
    newEndDate = extendEndDateForHeldSessions({
      endDate: storedEndDate,
      startDate: membershipStartDate,
      classDays,
      newHeldDates: absenceDates,
      isHoliday: (d) => isHolidayDate(d, firebaseHolidays),
      priorHoldingRanges,
    });
  } else {
    newEndDate = calculateEndDate(
      membershipStartDate, totalSessions, scheduleStr,
      [...absenceRanges, ...priorHoldingRanges],
      firebaseHolidays, countedHolidayDates,
    );
  }

  if (!newEndDate) {
    throw new Error('종료일 계산에 실패했습니다.');
  }

  const newEndDateStr = formatDateToYYMMDD(newEndDate);

  // 시트 업데이트
  const updates = [];

  if (notesCol !== -1) {
    updates.push({
      range: `${foundSheetName}!${getColumnLetter(notesCol)}${studentIndex + 1}`,
      values: [[newNotes]]
    });
  }

  updates.push({
    range: `${foundSheetName}!${getColumnLetter(endDateCol)}${studentIndex + 1}`,
    values: [[newEndDateStr]]
  });

  await batchUpdateSheet(updates);

  // 하이라이트 적용
  const cellsToHighlight = updates.map(u => u.range.split('!')[1]);
  try {
    await highlightCells(cellsToHighlight, foundSheetName);
  } catch (highlightError) {
    console.warn('⚠️ 셀 하이라이트 실패:', highlightError);
  }

  console.log(`✅ 결석 처리 완료: ${studentName}, 특이사항="${newNotes}", 새 종료일=${newEndDateStr}`);
  return { success: true, newEndDate: newEndDateStr, notesText: newNotes, validAbsenceCount: validAbsenceDates.length };
};

/**
 * 코치모드에서 수강생 홀딩 처리 (Google Sheets + Firebase 동시 기록)
 * @param {string} studentName - 수강생 이름
 * @param {Array<string>} holdingDates - 홀딩 날짜 배열 (YYYY-MM-DD)
 * @param {Array} firebaseHolidays - 커스텀 공휴일
 * @returns {Promise<Object>}
 */
export const processCoachHolding = async (studentName, holdingDates, firebaseHolidays = [], countedHolidayDates = []) => {
  if (!holdingDates || holdingDates.length === 0) {
    throw new Error('홀딩 날짜를 선택해주세요.');
  }

  const sortedDates = [...holdingDates].sort();
  const startDate = sortedDates[0];
  const endDate = sortedDates[sortedDates.length - 1];

  console.log(`🔄 코치 홀딩 처리 시작: ${studentName}, ${startDate} ~ ${endDate}`);

  // 1. 시트에서 학생 찾기
  const { foundSheetName, rows, headers, studentIndex, nextRegistrationIndex, nextSheetName, nextRows, nextHeaders } =
    await findStudentInSheets(studentName);

  const studentRow = rows[studentIndex];
  const studentData = buildStudentObject(headers, studentRow);

  const holdingUsedCol = findColumnIndex(headers, '홀딩 사용여부');
  const holdingStartCol = findColumnIndex(headers, '홀딩 시작일');
  const holdingEndCol = findColumnIndex(headers, '홀딩 종료일');
  const endDateCol = findColumnIndex(headers, '종료날짜');
  const startDateFieldCol = findColumnIndex(headers, '시작날짜');

  if (holdingUsedCol === -1) {
    throw new Error('홀딩 사용여부 필드를 찾을 수 없습니다.');
  }

  const membershipStartDate = parseSheetDate(getStudentField(studentData, '시작날짜'));
  const scheduleStr = getStudentField(studentData, '요일 및 시간');
  const weeklyFrequency = parseInt(getStudentField(studentData, '주횟수')) || 2;
  const currentHoldingStatusStr = getStudentField(studentData, '홀딩 사용여부');
  const holdingInfo = parseHoldingStatus(currentHoldingStatusStr);
  const totalSessions = getTotalSessions(weeklyFrequency, holdingInfo);

  // 2. 기존 Firebase 홀딩 조회 (동적 import 방지를 위해 외부에서 전달받지 않고 직접 계산)
  const holdingStartDate = new Date(startDate + 'T00:00:00');
  const holdingEndDate = new Date(endDate + 'T00:00:00');

  // 3. 종료일 계산 — 저장된 종료일에서 빠진 수업일만큼만 delta로 민다 (requestHolding과 동일)
  const priorHoldingRanges = [];
  const existHoldStart = parseSheetDate(getStudentField(studentData, '홀딩 시작일'));
  const existHoldEnd = parseSheetDate(getStudentField(studentData, '홀딩 종료일'));
  if (holdingInfo.isCurrentlyUsed && existHoldStart && existHoldEnd) {
    priorHoldingRanges.push({ start: existHoldStart, end: existHoldEnd });
  }

  const storedEndDate = parseSheetDate(getStudentField(studentData, '종료날짜'));
  let newEndDate;
  if (storedEndDate) {
    newEndDate = extendEndDateForHeldSessions({
      endDate: storedEndDate,
      startDate: membershipStartDate,
      classDays: getClassDays(scheduleStr),
      newHeldDates: enumerateDatesISO(holdingStartDate, holdingEndDate),
      isHoliday: (d) => isHolidayDate(d, firebaseHolidays),
      priorHoldingRanges,
    });
  } else {
    newEndDate = calculateEndDate(
      membershipStartDate, totalSessions, scheduleStr,
      [{ start: holdingStartDate, end: holdingEndDate }, ...priorHoldingRanges],
      firebaseHolidays, countedHolidayDates,
    );
  }
  if (!newEndDate) {
    throw new Error('종료일 계산에 실패했습니다.');
  }

  // 4. 시트 업데이트
  const newUsedCount = holdingInfo.used + 1;
  const newHoldingStatus = formatHoldingStatus(true, newUsedCount, holdingInfo.total);
  const startDateStr = formatDateToYYMMDD(holdingStartDate);
  const endDateStr = formatDateToYYMMDD(holdingEndDate);
  const newEndDateStr = formatDateToYYMMDD(newEndDate);

  const updates = [
    { range: `${foundSheetName}!${getColumnLetter(holdingUsedCol)}${studentIndex + 1}`, values: [[newHoldingStatus]] },
  ];
  if (holdingStartCol !== -1) {
    updates.push({ range: `${foundSheetName}!${getColumnLetter(holdingStartCol)}${studentIndex + 1}`, values: [[startDateStr]] });
  }
  if (holdingEndCol !== -1) {
    updates.push({ range: `${foundSheetName}!${getColumnLetter(holdingEndCol)}${studentIndex + 1}`, values: [[endDateStr]] });
  }
  if (endDateCol !== -1) {
    updates.push({ range: `${foundSheetName}!${getColumnLetter(endDateCol)}${studentIndex + 1}`, values: [[newEndDateStr]] });
  }

  await batchUpdateSheet(updates);

  // 하이라이트
  try {
    const cells = updates.map(u => u.range.split('!')[1]);
    await highlightCells(cells, foundSheetName);
  } catch (e) { /* 무시 */ }

  // 5. 다음 등록 자동 조정
  if (nextRegistrationIndex !== -1 && nextRegistrationIndex !== undefined) {
    try {
      const nSheet = nextSheetName || foundSheetName;
      const nRows = nextRows || rows;
      const nHeaders = nextHeaders || headers;
      await adjustNextRegistration(nSheet, nRows, nHeaders, nextRegistrationIndex, newEndDate, firebaseHolidays);
    } catch (adjustError) {
      console.warn('⚠️ 다음 등록 자동 조정 실패:', adjustError);
    }
  }

  console.log(`✅ 코치 홀딩 처리 완료: ${studentName}, ${startDate} ~ ${endDate}, 새 종료일=${newEndDateStr}`);
  return {
    success: true,
    startDate,
    endDate,
    newEndDate: newEndDateStr,
    holdingStatus: newHoldingStatus
  };
};

/**
 * 휴일 정규 수업을 보강으로 소진한 경우 H열 종료날짜를 다시 계산한다.
 * 일반 종료일 계산은 휴일을 제외하지만, 보강 신청된 휴일 원수업일은 1회 출석으로 카운트한다.
 * @param {string} studentName
 * @param {Array<string>} countedHolidayDates - YYYY-MM-DD 형식
 * @param {Array} firebaseHolidays - 커스텀 공휴일
 * @param {string|null} referenceDateStr - 원수업 날짜(YYYY-MM-DD). 해당 등록 행 선택 기준.
 * @returns {Promise<Object>}
 */
export const processHolidayMakeupEndDate = async (studentName, countedHolidayDates = [], firebaseHolidays = [], referenceDateStr = null) => {
  const uniqueHolidayDates = [...new Set((countedHolidayDates || []).filter(Boolean))];

  if (uniqueHolidayDates.length === 0) {
    return { success: true, updated: false, reason: 'no-holiday-makeup' };
  }

  const referenceDate = referenceDateStr
    ? new Date(referenceDateStr + 'T00:00:00')
    : new Date(uniqueHolidayDates[0] + 'T00:00:00');
  const primarySheetName = getCurrentSheetName(referenceDate);
  const { foundSheetName, rows, headers, studentIndex, nextRegistrationIndex, nextSheetName, nextRows, nextHeaders } =
    await findStudentInSheets(studentName, primarySheetName, referenceDate);

  const studentRow = rows[studentIndex];
  const studentData = buildStudentObject(headers, studentRow);

  const endDateCol = findColumnIndex(headers, '종료날짜');
  if (endDateCol === -1) {
    throw new Error('종료날짜 필드를 찾을 수 없습니다.');
  }

  const membershipStartDate = parseSheetDate(getStudentField(studentData, '시작날짜'));
  const membershipEndDate = parseSheetDate(getStudentField(studentData, '종료날짜'));
  const scheduleStr = getStudentField(studentData, '요일 및 시간');
  const weeklyFrequency = parseInt(getStudentField(studentData, '주횟수')) || 2;
  const holdingInfo = parseHoldingStatus(getStudentField(studentData, '홀딩 사용여부'));
  const totalSessions = getTotalSessions(weeklyFrequency, holdingInfo);

  if (!membershipStartDate) {
    throw new Error(`휴일 보강 종료일 조정 실패: 시작날짜를 해석할 수 없습니다. (${getStudentField(studentData, '시작날짜') || '비어 있음'})`);
  }
  if (!scheduleStr || getClassDays(scheduleStr).length === 0) {
    throw new Error(`휴일 보강 종료일 조정 실패: 수업 요일을 해석할 수 없습니다. (${scheduleStr || '비어 있음'})`);
  }

  // 방어 필터: (1) 공휴일 (2) 현재 등록 기간 내 (3) 정규 수업 요일 — 다른 등록기/스테일 데이터 차단
  const classDayNumbers = getClassDays(scheduleStr);
  const validHolidayDates = uniqueHolidayDates.filter(dateStr => {
    const d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d.getTime())) return false;
    if (!isHolidayDate(d, firebaseHolidays)) return false;
    if (d < membershipStartDate) return false;
    if (membershipEndDate && d > membershipEndDate) return false;
    if (!classDayNumbers.includes(d.getDay())) return false;
    return true;
  });

  if (validHolidayDates.length === 0) {
    return { success: true, updated: false, reason: 'no-holiday-makeup' };
  }

  console.log(`🔄 휴일 보강 종료일 재계산 시작: ${studentName}, dates=${validHolidayDates.join(',')}`);

  const holdingRanges = [];
  const existHoldStart = parseSheetDate(getStudentField(studentData, '홀딩 시작일'));
  const existHoldEnd = parseSheetDate(getStudentField(studentData, '홀딩 종료일'));
  if (holdingInfo.isCurrentlyUsed && existHoldStart && existHoldEnd) {
    holdingRanges.push({ start: existHoldStart, end: existHoldEnd });
  }

  const newEndDate = calculateEndDate(
    membershipStartDate,
    totalSessions,
    scheduleStr,
    holdingRanges,
    firebaseHolidays,
    validHolidayDates
  );

  if (!newEndDate) {
    throw new Error(`휴일 보강 반영 종료일 계산에 실패했습니다. 시작일=${formatDateToYYMMDD(membershipStartDate)}, 주횟수=${weeklyFrequency}, 일정=${scheduleStr}, 휴일보강=${validHolidayDates.join(',')}`);
  }

  const currentEndDateStr = getStudentField(studentData, '종료날짜');
  const newEndDateStr = formatDateToYYMMDD(newEndDate);

  if (currentEndDateStr === newEndDateStr) {
    return { success: true, updated: false, newEndDate: newEndDateStr };
  }

  const updates = [
    { range: `${foundSheetName}!${getColumnLetter(endDateCol)}${studentIndex + 1}`, values: [[newEndDateStr]] }
  ];
  try {
    await batchUpdateSheet(updates);
  } catch (error) {
    throw new Error(`휴일 보강 종료일 시트 업데이트 실패: ${error.message} (시트=${foundSheetName}, 행=${studentIndex + 1}, 종료일=${newEndDateStr})`);
  }

  try {
    await highlightCells([`${getColumnLetter(endDateCol)}${studentIndex + 1}`], foundSheetName);
  } catch { /* 무시 */ }

  if (nextRegistrationIndex !== -1 && nextRegistrationIndex !== undefined) {
    try {
      const nSheet = nextSheetName || foundSheetName;
      const nRows = nextRows || rows;
      const nHeaders = nextHeaders || headers;
      await adjustNextRegistration(nSheet, nRows, nHeaders, nextRegistrationIndex, newEndDate, firebaseHolidays);
    } catch (adjustError) {
      console.warn('⚠️ 다음 등록 자동 조정 실패:', adjustError);
    }
  }

  console.log(`✅ 휴일 보강 종료일 재계산 완료: ${studentName}, 새 종료일=${newEndDateStr}`);
  return { success: true, updated: true, newEndDate: newEndDateStr };
};

/**
 * 코치가 수강생의 시간표를 다른 슬롯으로 옮길 때 D열(요일 및 시간) + H열(종료날짜) 동시 업데이트.
 * 새 스케줄에 맞춰 수업일이 달라지므로 종료일을 재계산해야 한다.
 * @param {string} studentName
 * @param {string} newScheduleStr - 예: "화2금4"
 * @param {Array} firebaseHolidays - 커스텀 공휴일
 * @returns {Promise<Object>}
 */
/**
 * 주어진 기준일 이후(포함) 첫 수업 가능 일자 (스케줄 요일 매칭 + 공휴일 제외)
 */
function firstClassDayAtOrAfter(refDate, scheduleStr, firebaseHolidays = []) {
  const classDays = getClassDays(scheduleStr);
  if (classDays.length === 0) return null;
  const d = new Date(refDate);
  d.setHours(0, 0, 0, 0);
  let max = 60;
  while (max-- > 0) {
    if (classDays.includes(d.getDay()) && !isHolidayDate(d, firebaseHolidays)) return new Date(d);
    d.setDate(d.getDate() + 1);
  }
  return null;
}

/**
 * 다음 등록(미리 등록)에 새 스케줄을 적용 — D/G/H열 모두 갱신
 */
async function applyNewScheduleToNextRegistration(sheetName, rows, headers, nextRowIndex, newScheduleStr, currentEndDate, firebaseHolidays = []) {
  const nextRow = rows[nextRowIndex];
  const nextData = buildStudentObject(headers, nextRow);

  const nextWeeklyFreq = parseInt(getStudentField(nextData, '주횟수')) || 2;
  const nextHoldingStatus = parseHoldingStatus(getStudentField(nextData, '홀딩 사용여부'));
  const nextTotalSessions = getTotalSessions(nextWeeklyFreq, nextHoldingStatus);

  // 새 시작일 = 현재 등록의 새 종료일 다음 날부터, 새 스케줄의 첫 수업일
  const dayAfterEnd = new Date(currentEndDate);
  dayAfterEnd.setDate(dayAfterEnd.getDate() + 1);
  const newNextStart = firstClassDayAtOrAfter(dayAfterEnd, newScheduleStr, firebaseHolidays);
  if (!newNextStart) {
    console.warn('⚠️ 다음 등록 시작일 계산 실패 (새 스케줄)');
    return;
  }

  const newNextEnd = calculateEndDate(newNextStart, nextTotalSessions, newScheduleStr, null, firebaseHolidays);
  if (!newNextEnd) {
    console.warn('⚠️ 다음 등록 종료일 계산 실패');
    return;
  }

  const scheduleCol = findColumnIndex(headers, '요일 및 시간');
  const startDateCol = findColumnIndex(headers, '시작날짜');
  const endDateCol = findColumnIndex(headers, '종료날짜');

  const updates = [];
  if (scheduleCol !== -1) {
    updates.push({
      range: `${sheetName}!${getColumnLetter(scheduleCol)}${nextRowIndex + 1}`,
      values: [[newScheduleStr]]
    });
  }
  if (startDateCol !== -1) {
    updates.push({
      range: `${sheetName}!${getColumnLetter(startDateCol)}${nextRowIndex + 1}`,
      values: [[formatDateToYYMMDD(newNextStart)]]
    });
  }
  if (endDateCol !== -1) {
    updates.push({
      range: `${sheetName}!${getColumnLetter(endDateCol)}${nextRowIndex + 1}`,
      values: [[formatDateToYYMMDD(newNextEnd)]]
    });
  }

  if (updates.length > 0) {
    await batchUpdateSheet(updates);
    try {
      const cells = updates.map(u => u.range.split('!')[1]);
      await highlightCells(cells, sheetName);
    } catch (e) { /* 무시 */ }
    console.log(`📅 다음 등록 새 스케줄 적용: D=${newScheduleStr}, G=${formatDateToYYMMDD(newNextStart)}, H=${formatDateToYYMMDD(newNextEnd)}`);
  }
}

/**
 * 시간표 영구 변경 처리
 * - 활성 등록 행: D열 + H열 갱신. 시작 전(미래) 등록이면 G열도 새 스케줄의 첫 수업일로 이동.
 * - 다음 등록(미리 등록) 행이 있으면 D/G/H 모두 새 스케줄로 갱신.
 *
 * @param {string} studentName
 * @param {string} newScheduleStr - 예: "화2금4"
 * @param {Array} firebaseHolidays - 커스텀 공휴일
 * @param {Object} [options]
 * @param {string} [options.preferredSheetName] - UI가 active로 보고 있는 행의 시트명 (불일치 방지용)
 * @param {number} [options.preferredRowIndex] - parseStudentData 기준 _rowIndex (data-relative)
 * @returns {Promise<Object>}
 */
export const processScheduleTransfer = async (studentName, newScheduleStr, firebaseHolidays = [], options = {}) => {
  if (!newScheduleStr) {
    throw new Error('새 시간표가 비어있습니다.');
  }

  console.log(`🔄 시간표 이동 처리 시작: ${studentName}, new=${newScheduleStr}`);

  const preferred = (options.preferredSheetName && options.preferredRowIndex !== undefined && options.preferredRowIndex !== null)
    ? { sheetName: options.preferredSheetName, rowIndex: options.preferredRowIndex }
    : null;

  const { foundSheetName, rows, headers, studentIndex, nextRegistrationIndex, nextSheetName, nextRows, nextHeaders } =
    await findStudentInSheets(studentName, null, new Date(), preferred);

  const studentRow = rows[studentIndex];
  const studentData = buildStudentObject(headers, studentRow);

  const scheduleCol = findColumnIndex(headers, '요일 및 시간');
  const startDateCol = findColumnIndex(headers, '시작날짜');
  const endDateCol = findColumnIndex(headers, '종료날짜');

  if (scheduleCol === -1) {
    throw new Error('요일 및 시간 필드를 찾을 수 없습니다.');
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const originalStart = parseSheetDate(getStudentField(studentData, '시작날짜'));
  const weeklyFrequency = parseInt(getStudentField(studentData, '주횟수')) || 2;
  const holdingStatusStr = getStudentField(studentData, '홀딩 사용여부');
  const holdingInfo = parseHoldingStatus(holdingStatusStr);
  const totalSessions = getTotalSessions(weeklyFrequency, holdingInfo);

  // 기존 홀딩 범위 포함해 재계산
  const holdingRanges = [];
  const existHoldStart = parseSheetDate(getStudentField(studentData, '홀딩 시작일'));
  const existHoldEnd = parseSheetDate(getStudentField(studentData, '홀딩 종료일'));
  if (holdingInfo.isCurrentlyUsed && existHoldStart && existHoldEnd) {
    holdingRanges.push({ start: existHoldStart, end: existHoldEnd });
  }

  // 미래 등록(시작 전)이면 시작일을 새 스케줄의 첫 수업일로 이동. 진행 중이면 시작일 유지.
  let activeStart = originalStart;
  if (originalStart && originalStart > today) {
    const shifted = firstClassDayAtOrAfter(originalStart, newScheduleStr, firebaseHolidays);
    if (shifted) activeStart = shifted;
  }

  if (!activeStart) {
    throw new Error('시작날짜를 확인할 수 없습니다.');
  }

  const newEndDate = calculateEndDate(activeStart, totalSessions, newScheduleStr, holdingRanges, firebaseHolidays);
  if (!newEndDate) {
    throw new Error('종료일 계산에 실패했습니다.');
  }

  const newEndDateStr = formatDateToYYMMDD(newEndDate);
  const newStartDateStr = formatDateToYYMMDD(activeStart);
  const startChanged = originalStart && activeStart && originalStart.getTime() !== activeStart.getTime();

  const updates = [
    { range: `${foundSheetName}!${getColumnLetter(scheduleCol)}${studentIndex + 1}`, values: [[newScheduleStr]] },
  ];
  if (startChanged && startDateCol !== -1) {
    updates.push({ range: `${foundSheetName}!${getColumnLetter(startDateCol)}${studentIndex + 1}`, values: [[newStartDateStr]] });
  }
  if (endDateCol !== -1) {
    updates.push({ range: `${foundSheetName}!${getColumnLetter(endDateCol)}${studentIndex + 1}`, values: [[newEndDateStr]] });
  }

  await batchUpdateSheet(updates);

  try {
    const cells = updates.map(u => u.range.split('!')[1]);
    await highlightCells(cells, foundSheetName);
  } catch (e) { /* 무시 */ }

  // 다음 등록(미리 등록)에도 새 스케줄 적용 (D + G + H 모두)
  if (nextRegistrationIndex !== -1 && nextRegistrationIndex !== undefined && nextRegistrationIndex !== null) {
    try {
      const nSheet = nextSheetName || foundSheetName;
      const nRows = nextSheetName ? nextRows : rows;
      const nHeaders = nextSheetName ? nextHeaders : headers;
      await applyNewScheduleToNextRegistration(nSheet, nRows, nHeaders, nextRegistrationIndex, newScheduleStr, newEndDate, firebaseHolidays);
    } catch (adjustError) {
      console.warn('⚠️ 다음 등록 자동 조정 실패:', adjustError);
    }
  }

  console.log(`✅ 시간표 이동 처리 완료: ${studentName}, 시작${startChanged ? '=' + newStartDateStr : ' 유지'}, 종료=${newEndDateStr}`);
  return { success: true, newSchedule: newScheduleStr, newStartDate: newStartDateStr, newEndDate: newEndDateStr, startChanged };
};
