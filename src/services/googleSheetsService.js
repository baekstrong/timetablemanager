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
async function apiGet(path, errorContext) {
  const response = await fetch(`${FUNCTIONS_BASE_URL}${path}`);
  const data = await response.json();
  if (!data.success) {
    throw new Error(data.error || `Failed to ${errorContext}`);
  }
  return data;
}

/**
 * 공통 API POST 호출
 * @param {string} path - URL 경로 (예: "/write")
 * @param {Object} body - JSON body
 * @param {string} errorContext - 에러 로그용 문맥 설명
 * @returns {Promise<Object>} - 서버 응답의 data 객체
 */
async function apiPost(path, body, errorContext) {
  const response = await fetch(`${FUNCTIONS_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!data.success) {
    throw new Error(data.error || `Failed to ${errorContext}`);
  }
  return data;
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
 * 현재 월 시트 우선, 못 찾으면 모든 시트에서 학생 검색
 * @param {string} studentName
 * @param {string} [primarySheetName] - 우선 검색할 시트명 (기본: 현재 월)
 * @returns {Promise<{foundSheetName, rows, headers, studentIndex}>}
 */
async function findStudentInSheets(studentName, primarySheetName = null) {
  const primary = primarySheetName || getCurrentSheetName();

  // 1차: 우선 시트에서 검색
  try {
    const rows = await readSheetData(`${primary}!A:Z`);
    if (rows && rows.length >= 2) {
      const headers = rows[1];
      const studentIndex = findStudentRowIndex(rows, headers, studentName);
      if (studentIndex !== -1) {
        console.log(`✅ 학생 찾음 (${primary}): 행 ${studentIndex + 1}`);
        return { foundSheetName: primary, rows, headers, studentIndex };
      }
    }
  } catch (e) {
    console.warn(`⚠️ ${primary} 시트 읽기 실패:`, e.message);
  }

  // 2차: 모든 시트에서 검색
  console.log(`🔄 ${primary}에서 못 찾음. 다른 시트 검색 시작...`);
  const allSheets = await getAllSheetNames();
  const studentSheets = allSheets.filter(name => name.startsWith('등록생 목록'));

  for (const sheetName of studentSheets) {
    if (sheetName === primary) continue;
    try {
      const rows = await readSheetData(`${sheetName}!A:Z`);
      if (rows && rows.length >= 2) {
        const headers = rows[1];
        const studentIndex = findStudentRowIndex(rows, headers, studentName);
        if (studentIndex !== -1) {
          console.log(`✅ 학생을 다음 시트에서 찾음: ${sheetName}, 행 ${studentIndex + 1}`);
          return { foundSheetName: sheetName, rows, headers, studentIndex };
        }
      }
    } catch (sheetError) {
      console.warn(`⚠️ ${sheetName} 시트 읽기 실패:`, sheetError.message);
    }
  }

  throw new Error(`학생 정보를 찾을 수 없습니다: ${studentName}`);
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
export const getAllSheetNames = async () => {
  const data = await apiGet('/info', 'get sheet names');
  return data.sheets;
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
 * Write data to Google Sheets
 * @param {string} range - The A1 notation of the range to update
 * @param {Array} values - 2D array of values to write
 * @returns {Promise}
 */
export const writeSheetData = async (range, values) => {
  const data = await apiPost('/write', { range, values }, 'write sheet data');
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
  if (!dateStr || typeof dateStr !== 'string') return null;

  const cleaned = dateStr.replace(/\D/g, '');

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
 * @returns {Date|null}
 */
function calculateEndDate(startDate, totalSessions, scheduleStr, holdingRanges = null, firebaseHolidays = []) {
  if (!startDate || !scheduleStr || !totalSessions) return null;

  const classDays = getClassDays(scheduleStr);
  if (classDays.length === 0) return null;

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
      const isInHoldingPeriod = holdingRangesArray.some(range =>
        range && isSameOrAfter(current, range.start) && isSameOrBefore(current, range.end)
      );

      if (!isHoliday && !isInHoldingPeriod) {
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
  const student = students.find(s => s['이름'] === studentName);

  if (!student) {
    console.warn(`Student "${studentName}" not found in Google Sheets`);
    return null;
  }

  console.log(`✅ Found student: ${studentName}`, student);
  return student;
};

/**
 * 여러 시트에서 학생 찾기 (현재 월부터 과거 6개월까지 검색)
 * @param {string} studentName
 * @returns {Promise<Object|null>} - { student, year, month, foundSheetName }
 */
export const findStudentAcrossSheets = async (studentName) => {
  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth() + 1;

  for (let i = 0; i <= 6; i++) {
    const searchDate = new Date(currentYear, currentMonth - 1 - i, 1);
    const year = searchDate.getFullYear();
    const month = searchDate.getMonth() + 1;

    try {
      console.log(`🔍 Searching in ${year}년 ${month}월...`);
      const students = await getAllStudents(year, month);
      const student = students.find(s => s['이름'] === studentName);

      if (student) {
        const foundSheetName = getSheetNameByYearMonth(year, month);
        console.log(`✅ Found student "${studentName}" in ${foundSheetName}`);
        return { student, year, month, foundSheetName };
      }
    } catch (err) {
      console.log(`⏭️  Sheet for ${year}년 ${month}월 not found, continuing...`);
    }
  }

  console.warn(`❌ Student "${studentName}" not found in any sheet (searched 6 months)`);
  return null;
};

/**
 * Get all student data from the sheet
 * @param {number} year
 * @param {number} month
 */
export const getAllStudents = async (year = null, month = null) => {
  const foundSheetName = resolveSheetName(year, month);

  console.log(`📖 Reading data from sheet: "${foundSheetName}"`);
  const range = `${foundSheetName}!A:Z`;
  console.log(`📍 Full range: ${range}`);

  const rows = await readSheetData(range);
  console.log(`📦 Raw data received (${rows.length} rows):`, rows.slice(0, 3));

  const parsedData = parseStudentData(rows);
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

  const studentsArrays = await Promise.all(
    studentSheets.map(async (foundSheetName) => {
      try {
        const rows = await readSheetData(`${foundSheetName}!A:Z`);
        const parsedData = parseStudentData(rows);
        parsedData.forEach(student => {
          student._foundSheetName = foundSheetName;
        });
        console.log(`✅ Loaded ${parsedData.length} students from ${foundSheetName}`);
        return parsedData;
      } catch (error) {
        console.warn(`⚠️ Failed to load sheet ${foundSheetName}:`, error);
        return [];
      }
    })
  );

  const allStudents = studentsArrays.flat();
  console.log(`✨ Total students loaded from all sheets: ${allStudents.length}`);

  // 같은 이름의 수강생이 여러 시트에 있으면 최신 시트의 데이터만 유지
  // 단, 이전 등록의 종료날짜를 _prevEndDate로 보존 (시작지연 판단용)
  const parseSheetMonth = (sheetName) => {
    const match = sheetName.match(/등록생 목록\((\d+)년(\d+)월\)/);
    if (!match) return 0;
    const year = parseInt(match[1]) + 2000;
    const month = parseInt(match[2]);
    return year * 100 + month; // e.g., 202603
  };

  const latestByName = {};
  allStudents.forEach(student => {
    const name = student['이름'];
    if (!name) return;
    const sheetOrder = parseSheetMonth(student._foundSheetName || '');
    const existing = latestByName[name];
    if (!existing) {
      latestByName[name] = { ...student, _sheetOrder: sheetOrder, _prevSheetOrder: 0 };
    } else if (sheetOrder > existing._sheetOrder) {
      // 최신 레코드로 교체하되, 직전 등록의 종료날짜와 시간표 보존
      latestByName[name] = {
        ...student,
        _sheetOrder: sheetOrder,
        _prevEndDate: getStudentField(existing, '종료날짜'),
        _prevSchedule: getStudentField(existing, '요일 및 시간'),
        _prevSheetOrder: existing._sheetOrder,
      };
    } else if (sheetOrder < existing._sheetOrder) {
      // 현재가 더 오래된 레코드 → 직전(가장 최근 이전) 등록만 보존
      if (sheetOrder > (existing._prevSheetOrder || 0)) {
        existing._prevEndDate = getStudentField(student, '종료날짜');
        existing._prevSchedule = getStudentField(student, '요일 및 시간');
        existing._prevSheetOrder = sheetOrder;
      }
    }
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
export const requestHolding = async (studentName, holdingStartDate, holdingEndDate = null, year = null, month = null, existingHoldings = [], firebaseHolidays = [], makeupHoldingCount = 0) => {
  const endDate = holdingEndDate || holdingStartDate;

  console.log(`🔍 홀딩 신청 시작: ${studentName}, ${holdingStartDate.toISOString().split('T')[0]} ~ ${endDate.toISOString().split('T')[0]}`);

  const primarySheetName = getCurrentSheetName(holdingStartDate);
  const { foundSheetName, rows, headers, studentIndex } =
    await findStudentInSheets(studentName, primarySheetName);

  console.log(`📄 최종 선택 시트: ${foundSheetName}`);

  const holdingUsedCol = findColumnIndex(headers, '홀딩 사용여부');
  const holdingStartCol = findColumnIndex(headers, '홀딩 시작일');
  const holdingEndCol = findColumnIndex(headers, '홀딩 종료일');
  const endDateCol = findColumnIndex(headers, '종료날짜');

  console.log(`📍 필드 위치: 사용여부=${holdingUsedCol}, 시작일=${holdingStartCol}, 종료일=${holdingEndCol}, 종료날짜=${endDateCol}`);

  if (holdingUsedCol === -1 || holdingStartCol === -1 || holdingEndCol === -1) {
    console.error('헤더:', headers);
    throw new Error('홀딩 관련 필드를 찾을 수 없습니다. (홀딩 사용여부, 홀딩 시작일, 홀딩 종료일)');
  }

  const studentRow = rows[studentIndex];
  const studentData = buildStudentObject(headers, studentRow);

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

  // 모든 홀딩 기간 수집 (기존 + 새 홀딩)
  const allHoldingRanges = [];

  if (existingHoldings && existingHoldings.length > 0) {
    existingHoldings.forEach(h => {
      allHoldingRanges.push({
        start: new Date(h.startDate + 'T00:00:00'),
        end: new Date(h.endDate + 'T00:00:00')
      });
    });
    console.log(`📊 기존 홀딩 ${existingHoldings.length}개 포함`);
  }

  allHoldingRanges.push({ start: holdingStartDate, end: endDate });
  console.log(`📊 총 ${allHoldingRanges.length}개 홀딩 기간으로 종료일 계산`);

  let newEndDate = calculateEndDate(membershipStartDate, totalSessions, scheduleStr, allHoldingRanges, firebaseHolidays);

  if (!newEndDate) {
    throw new Error('종료일 계산에 실패했습니다.');
  }

  // 보강 날짜(비정규 요일)를 홀딩한 경우 추가 연장
  if (makeupHoldingCount > 0) {
    const classDays = getClassDays(scheduleStr);
    let extraDays = 0;
    const cursor = new Date(newEndDate);
    cursor.setDate(cursor.getDate() + 1);
    while (extraDays < makeupHoldingCount) {
      if (classDays.includes(cursor.getDay()) && !isHolidayDate(cursor, firebaseHolidays)) {
        extraDays++;
        if (extraDays === makeupHoldingCount) {
          newEndDate = new Date(cursor);
          break;
        }
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    console.log(`📅 보강 홀딩 ${makeupHoldingCount}건 → 종료일 추가 연장`);
  }

  const startDateStr = formatDateToYYMMDD(holdingStartDate);
  const endDateStr = formatDateToYYMMDD(endDate);
  const newEndDateStr = formatDateToYYMMDD(newEndDate);

  const newUsedCount = holdingInfo.used + 1;
  const newHoldingStatus = formatHoldingStatus(true, newUsedCount, holdingInfo.total);

  console.log(`📝 업데이트할 데이터: 사용여부=${newHoldingStatus}, 시작일=${startDateStr}, 종료일=${endDateStr}, 새 종료날짜=${newEndDateStr}`);

  const updates = [
    { range: `${foundSheetName}!${getColumnLetter(holdingUsedCol)}${studentIndex + 1}`, values: [[newHoldingStatus]] },
    { range: `${foundSheetName}!${getColumnLetter(holdingStartCol)}${studentIndex + 1}`, values: [[startDateStr]] },
    { range: `${foundSheetName}!${getColumnLetter(holdingEndCol)}${studentIndex + 1}`, values: [[endDateStr]] },
  ];

  if (endDateCol !== -1) {
    updates.push({
      range: `${foundSheetName}!${getColumnLetter(endDateCol)}${studentIndex + 1}`,
      values: [[newEndDateStr]]
    });
  }

  await batchUpdateSheet(updates);

  // 하이라이트 적용 (실패해도 홀딩 신청은 성공)
  const cellsToHighlight = updates.map(u => u.range.split('!')[1]);
  try {
    await highlightCells(cellsToHighlight, foundSheetName);
    console.log(`🎨 셀 하이라이트 완료: ${cellsToHighlight.join(', ')}`);
  } catch (highlightError) {
    console.warn('⚠️ 셀 하이라이트 실패 (홀딩 신청은 완료됨):', highlightError);
  }

  console.log(`✅ 홀딩 신청 완료: ${studentName}, ${startDateStr} ~ ${endDateStr}`);
  console.log(`📅 종료일 연장: ${newEndDateStr}`);
  return { success: true, newEndDate: newEndDateStr };
};

/**
 * 홀딩 취소 (Google Sheets에서 홀딩 정보 초기화 + 종료날짜 재계산)
 * @param {string} studentName
 * @param {Array} remainingHoldings - 취소 후 남은 홀딩 목록
 * @returns {Promise<Object>}
 */
export const cancelHoldingInSheets = async (studentName, remainingHoldings = [], firebaseHolidays = []) => {
  console.log(`🔄 홀딩 취소 시작 (Google Sheets): ${studentName}`);

  const result = await findStudentAcrossSheets(studentName);
  if (!result) {
    throw new Error(`학생 정보를 찾을 수 없습니다: ${studentName}`);
  }

  const { student, foundSheetName } = result;
  const actualRow = student._rowIndex + 3;

  // 시트 헤더 읽기
  const rows = await readSheetData(`${foundSheetName}!A:Z`);
  const headers = rows[1];

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

    const newEndDate = calculateEndDate(membershipStartDate, totalSessions, scheduleStr, holdingRanges, firebaseHolidays);
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
export const processStudentAbsence = async (studentName, absenceDates, firebaseHolidays = []) => {
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

  const allRanges = [...absenceRanges];
  if (holdingInfo.isCurrentlyUsed && holdingStartStr && holdingEndStr) {
    const hs = parseSheetDate(holdingStartStr);
    const he = parseSheetDate(holdingEndStr);
    if (hs && he) {
      allRanges.push({ start: hs, end: he });
    }
  }

  const newEndDate = calculateEndDate(membershipStartDate, totalSessions, scheduleStr, allRanges, firebaseHolidays);

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
