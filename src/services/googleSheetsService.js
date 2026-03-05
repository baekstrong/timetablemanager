// Backend Functions URL
// 로컬 테스트: http://localhost:5001
// Production: VITE_FUNCTIONS_URL 환경 변수 사용 (GitHub Pages + Netlify Functions)
const FUNCTIONS_BASE_URL = import.meta.env.VITE_FUNCTIONS_URL ||
  (import.meta.env.PROD
    ? '/.netlify/functions/sheets'
    : 'http://localhost:5001');
const SPREADSHEET_ID = import.meta.env.VITE_GOOGLE_SHEETS_ID;

/**
 * 초기화 함수들 (더 이상 필요 없지만 호환성을 위해 유지)
 */
export const initializeGoogleAPI = async () => {
  console.log('Using Firebase Functions - no client initialization needed');
  return Promise.resolve();
};

export const initializeGIS = async () => {
  console.log('Using Firebase Functions - no GIS initialization needed');
  return Promise.resolve();
};

export const signInToGoogle = async () => {
  console.log('Using service account - no sign-in needed');
  return Promise.resolve();
};

export const signOutFromGoogle = () => {
  console.log('Using service account - no sign-out needed');
};

export const isSignedIn = () => {
  // 서비스 계정을 사용하므로 항상 인증된 것으로 간주
  return true;
};

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

/**
 * Get all available sheet names from the spreadsheet
 * @returns {Promise<Array<string>>} - Array of sheet names
 */
export const getAllSheetNames = async () => {
  try {
    const response = await fetch(`${FUNCTIONS_BASE_URL}/info`);
    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || 'Failed to get sheet names');
    }

    return data.sheets;
  } catch (error) {
    console.error('Error getting sheet names:', error);
    throw error;
  }
};

/**
 * Read data from Google Sheets
 * @param {string} range - The A1 notation of the range to retrieve values from
 * @returns {Promise<Array>} - Array of rows
 */
export const readSheetData = async (range = null) => {
  try {
    if (!range) {
      const foundSheetName = getCurrentSheetName();
      range = `${foundSheetName}!A:Z`;
    }

    const response = await fetch(`${FUNCTIONS_BASE_URL}/read?range=${encodeURIComponent(range)}`);
    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || 'Failed to read sheet data');
    }

    return data.values || [];
  } catch (error) {
    console.error('Error reading sheet data:', error);
    throw error;
  }
};

/**
 * Write data to Google Sheets
 * @param {string} range - The A1 notation of the range to update
 * @param {Array} values - 2D array of values to write
 * @returns {Promise}
 */
export const writeSheetData = async (range, values) => {
  try {
    const response = await fetch(`${FUNCTIONS_BASE_URL}/write`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ range, values }),
    });

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || 'Failed to write sheet data');
    }

    console.log('Sheet updated:', data);
    return data;
  } catch (error) {
    console.error('Error writing sheet data:', error);
    throw error;
  }
};

/**
 * Append data to Google Sheets
 * @param {string} range - The A1 notation of the range to append to
 * @param {Array} values - 2D array of values to append
 * @returns {Promise}
 */
export const appendSheetData = async (range, values) => {
  try {
    const response = await fetch(`${FUNCTIONS_BASE_URL}/append`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ range, values }),
    });

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || 'Failed to append sheet data');
    }

    console.log('Data appended:', data);
    return data;
  } catch (error) {
    console.error('Error appending sheet data:', error);
    throw error;
  }
};

/**
 * Batch update Google Sheets
 * @param {Array} updates - Array of {range, values} objects
 * @returns {Promise}
 */
export const batchUpdateSheet = async (updates) => {
  try {
    const response = await fetch(`${FUNCTIONS_BASE_URL}/batchUpdate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ data: updates }),
    });

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || 'Failed to batch update sheet');
    }

    console.log('Batch update completed:', data);
    return data;
  } catch (error) {
    console.error('Error batch updating sheet:', error);
    throw error;
  }
};

/**
 * Highlight cells with background color
 * @param {Array<string>} ranges - Array of cell ranges (e.g., ["A5", "B5", "C5"])
 * @param {string} sheetName - Sheet name (백엔드 파라미터명과 일치)
 * @param {Object} [color] - Optional RGB color {red, green, blue} (0.0~1.0). Defaults to yellow.
 * @returns {Promise}
 */
export const highlightCells = async (ranges, sheetName, color = null) => {
  try {
    // color 미지정 시 노란색 명시 적용
    const body = { ranges, sheetName, color: color || { red: 1.0, green: 1.0, blue: 0.6 } };

    const response = await fetch(`${FUNCTIONS_BASE_URL}/formatCells`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || 'Failed to highlight cells');
    }

    console.log(`✅ Highlighted ${ranges.length} cells`);
    return data;
  } catch (error) {
    console.error('Error highlighting cells:', error);
    throw error;
  }
};

/**
 * 배경색 + 정렬을 한 번의 API 호출로 적용
 * @param {Array<string>} ranges - 셀 범위 (e.g., ["A5", "B5"])
 * @param {string} sheetName - 시트 이름
 * @param {object} color - 배경색 { red, green, blue } (0~1)
 * @param {string} horizontalAlignment - 정렬 ('CENTER', 'LEFT', 'RIGHT')
 */
export const formatCellsWithStyle = async (ranges, sheetName, color, horizontalAlignment = 'CENTER') => {
  try {
    const response = await fetch(`${FUNCTIONS_BASE_URL}/formatCells`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ranges, sheetName, color, horizontalAlignment }),
    });

    const data = await response.json();
    if (!data.success) {
      throw new Error(data.error || 'Failed to format cells');
    }
    return data;
  } catch (error) {
    console.error('Error formatting cells:', error);
    throw error;
  }
};

/**
 * Parse student data from Google Sheets
 * Expected columns: 이름, 주횟수, 요일 및 시간, 특이사항, 학기/개월수, 시작날짜, 종료날짜, 홀딩 사용여부, 홀딩 시작일, 홀딩 종료일, etc.
 * Note: Row 1 contains merged cells, Row 2 contains actual headers
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
    // Store original row index (0-based relative to data start) for updates
    student._rowIndex = index;
    return student;
  }).filter(student => student['이름']);
};

/**
 * Get student field value with flexible field name matching
 * Handles both space-separated and newline-separated field names
 * @param {Object} student - Student object
 * @param {string} fieldName - Field name (e.g., "홀딩 사용여부")
 * @returns {string} - Field value or empty string
 */
export const getStudentField = (student, fieldName) => {
  if (!student) return '';

  if (student[fieldName] !== undefined) {
    return student[fieldName];
  }

  const fieldNameWithNewline = fieldName.replace(/ /g, '\n');
  if (student[fieldNameWithNewline] !== undefined) {
    return student[fieldNameWithNewline];
  }

  const fieldNameWithSpace = fieldName.replace(/\n/g, ' ');
  if (student[fieldNameWithSpace] !== undefined) {
    return student[fieldNameWithSpace];
  }

  return '';
};

/**
 * 홀딩 사용여부 필드 파싱 (여러달 수강권 지원)
 * 형식:
 *   - "X" → 1개월 등록, 홀딩 0회 사용, 총 1회
 *   - "O" → 1개월 등록, 홀딩 1회 사용 (모두 소진)
 *   - "X(0/2)" → 2개월 등록, 홀딩 0회 사용, 총 2회
 *   - "X(1/3)" → 3개월 등록, 홀딩 1회 사용, 총 3회
 *   - "O(2/3)" → 3개월 등록, 홀딩 2회 사용, 총 3회 (이번달은 이미 사용)
 * @param {string} holdingStatusStr - 홀딩 사용여부 필드 값
 * @returns {Object} - { months: 등록개월, used: 사용횟수, total: 총횟수, isCurrentlyUsed: 현재 홀딩중 여부 }
 */
export const parseHoldingStatus = (holdingStatusStr) => {
  if (!holdingStatusStr || holdingStatusStr.trim() === '') {
    return { months: 1, used: 0, total: 1, isCurrentlyUsed: false };
  }

  const str = holdingStatusStr.trim();

  // X(n/m) 또는 O(n/m) 형식 파싱
  const multiMonthMatch = str.match(/^([XOxo])\s*\((\d+)\/(\d+)\)$/);
  if (multiMonthMatch) {
    const status = multiMonthMatch[1].toUpperCase();
    const used = parseInt(multiMonthMatch[2]);
    const total = parseInt(multiMonthMatch[3]);
    const months = total; // 총 홀딩 횟수 = 등록 개월수

    return {
      months,
      used,
      total,
      isCurrentlyUsed: status === 'O'
    };
  }

  // 단순 X 또는 O 형식 (1개월 등록)
  const upperStr = str.toUpperCase();
  if (upperStr === 'X') {
    return { months: 1, used: 0, total: 1, isCurrentlyUsed: false };
  }
  if (upperStr === 'O' || upperStr === 'Y' || str === '사용') {
    return { months: 1, used: 1, total: 1, isCurrentlyUsed: true };
  }

  // 알 수 없는 형식은 기본값 반환
  console.warn('알 수 없는 홀딩 상태 형식:', holdingStatusStr);
  return { months: 1, used: 0, total: 1, isCurrentlyUsed: false };
};

/**
 * 홀딩 상태 문자열 생성 (여러달 수강권용)
 * @param {boolean} isUsed - 현재 홀딩 사용 여부 (O/X)
 * @param {number} usedCount - 사용한 홀딩 횟수
 * @param {number} totalCount - 총 홀딩 횟수
 * @returns {string} - 홀딩 상태 문자열
 */
export const formatHoldingStatus = (isUsed, usedCount, totalCount) => {
  const status = isUsed ? 'O' : 'X';

  // 1개월 등록 (총 1회)인 경우 간단히 표시
  if (totalCount === 1) {
    return status;
  }

  // 여러달 등록인 경우 (n/m) 형식으로 표시
  return `${status}(${usedCount}/${totalCount})`;
};

/**
 * 구글 시트에서 이름으로 수강생 찾기
 * @param {string} studentName - 검색할 수강생 이름
 * @param {number} year - 연도 (기본값: 현재 연도)
 * @param {number} month - 월 (1-12) (기본값: 현재 월)
 * @returns {Promise<Object|null>} - 수강생 객체 또는 찾지 못한 경우 null
 */
export const getStudentByName = async (studentName, year = null, month = null) => {
  try {
    const students = await getAllStudents(year, month);
    const student = students.find(s => s['이름'] === studentName);

    if (!student) {
      console.warn(`Student "${studentName}" not found in Google Sheets`);
      return null;
    }

    console.log(`✅ Found student: ${studentName}`, student);
    return student;
  } catch (error) {
    console.error('Error finding student:', error);
    throw error;
  }
};

/**
 * 여러 시트에서 학생 찾기 (자동으로 현재 월부터 과거 6개월까지 검색)
 * @param {string} studentName - 검색할 수강생 이름
 * @returns {Promise<Object|null>} - { student: 학생데이터, year: 연도, month: 월, foundSheetName: 시트명 }
 */
export const findStudentAcrossSheets = async (studentName) => {
  try {
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1;

    // 현재 월부터 6개월 전까지 검색
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
          return {
            student,
            year,
            month,
            foundSheetName
          };
        }
      } catch (err) {
        // 해당 월의 시트가 없으면 다음 월로 계속
        console.log(`⏭️  Sheet for ${year}년 ${month}월 not found, continuing...`);
        continue;
      }
    }

    console.warn(`❌ Student "${studentName}" not found in any sheet (searched 6 months)`);
    return null;
  } catch (error) {
    console.error('Error searching student across sheets:', error);
    throw error;
  }
};

/**
 * 요일 및 시간 문자열 파싱
 * 예: "월5수5" → [{day: '월', period: 5}, {day: '수', period: 5}]
 */
const parseScheduleString = (scheduleStr) => {
  if (!scheduleStr || typeof scheduleStr !== 'string') return [];

  const result = [];
  const dayMap = { '월': '월', '화': '화', '수': '수', '목': '목', '금': '금', '토': '토', '일': '일' };

  const chars = scheduleStr.replace(/\s/g, '');

  let i = 0;
  while (i < chars.length) {
    const char = chars[i];

    if (dayMap[char]) {
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

// 특정 날짜가 공휴일인지 확인
const isHolidayDate = (date, firebaseHolidays = []) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const dateStr = `${year}-${month}-${day}`;

  // 하드코딩 공휴일 체크
  if (KOREAN_HOLIDAYS_2026[dateStr]) return true;

  // Firebase 커스텀 공휴일 체크
  if (firebaseHolidays.length > 0) {
    return firebaseHolidays.some(h => h.date === dateStr);
  }

  return false;
};

// 날짜만 비교 (시간 무시)
const isSameOrAfter = (date1, date2) => {
  const d1 = new Date(date1.getFullYear(), date1.getMonth(), date1.getDate());
  const d2 = new Date(date2.getFullYear(), date2.getMonth(), date2.getDate());
  return d1 >= d2;
};

const isSameOrBefore = (date1, date2) => {
  const d1 = new Date(date1.getFullYear(), date1.getMonth(), date1.getDate());
  const d2 = new Date(date2.getFullYear(), date2.getMonth(), date2.getDate());
  return d1 <= d2;
};

/**
 * Calculate end date based on start date, total sessions, schedule, and optional holding periods
 * @param {Date} startDate - Start date of membership
 * @param {number} totalSessions - Total number of sessions (e.g., weeklyFrequency * 4)
 * @param {string} scheduleStr - Schedule string (e.g., "화1목1")
 * @param {Array|Object} holdingRanges - Optional holding period(s). Can be single {start, end} or array of them
 * @returns {Date|null} - Calculated end date
 */
const calculateEndDate = (startDate, totalSessions, scheduleStr, holdingRanges = null, firebaseHolidays = []) => {
  if (!startDate || !scheduleStr || !totalSessions) return null;

  const schedule = parseScheduleString(scheduleStr);
  const dayMap = { '월': 1, '화': 2, '수': 3, '목': 4, '금': 5, '토': 6, '일': 0 };
  const classDays = schedule.map(s => dayMap[s.day]).filter(d => d !== undefined);

  if (classDays.length === 0) return null;

  // 홀딩 기간을 배열로 정규화
  let holdingRangesArray = [];
  if (holdingRanges) {
    if (Array.isArray(holdingRanges)) {
      holdingRangesArray = holdingRanges;
    } else {
      holdingRangesArray = [holdingRanges];
    }
  }

  let sessionCount = 0;
  const current = new Date(startDate);
  current.setHours(0, 0, 0, 0);

  // 최대 365일까지만 검색 (무한 루프 방지)
  let maxIterations = 365;

  while (sessionCount < totalSessions && maxIterations > 0) {
    maxIterations--;
    const dayOfWeek = current.getDay();

    // 해당 요일이 수업일인지 확인
    if (classDays.includes(dayOfWeek)) {
      // 공휴일인지 확인
      const isHoliday = isHolidayDate(current, firebaseHolidays);

      // 여러 홀딩 기간 중 하나라도 해당하는지 확인
      const isInHoldingPeriod = holdingRangesArray.some(range =>
        range && isSameOrAfter(current, range.start) && isSameOrBefore(current, range.end)
      );

      // 공휴일이 아니고 홀딩 기간이 아닌 경우에만 세션 카운트
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
};

/**
 * Calculate end date with Firebase custom holidays support
 * @param {Date} startDate - Start date
 * @param {number} totalSessions - Total number of sessions
 * @param {string} scheduleStr - Schedule string (e.g., "화1목1")
 * @param {Array} firebaseHolidays - Firebase custom holidays [{date: "2026-02-14", reason: "휴무"}, ...]
 * @returns {Date|null} - Calculated end date
 */
export const calculateEndDateWithHolidays = (startDate, totalSessions, scheduleStr, firebaseHolidays = [], absenceDates = []) => {
  // 결석일을 각각 1일짜리 홀딩 범위로 변환
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
 * 시작일부터 오늘까지 완료된 수업 횟수 계산 (홀딩 기간 및 공휴일 제외)
 * @param {Date} startDate - 시작일
 * @param {Date} today - 오늘 날짜
 * @param {string} scheduleStr - 요일 및 시간 (예: "화1목1")
 * @param {Object} holdingRange - 홀딩 기간 { start: Date, end: Date } (optional)
 * @param {Array} firebaseHolidays - Firebase 커스텀 공휴일 배열 (optional)
 * @returns {number} - 완료된 수업 횟수
 */
const calculateCompletedSessions = (startDate, today, scheduleStr, holdingRange = null, firebaseHolidays = []) => {
  if (!startDate || !scheduleStr) return 0;

  if (startDate > today) return 0;

  const schedule = parseScheduleString(scheduleStr);
  const dayMap = { '월': 1, '화': 2, '수': 3, '목': 4, '금': 5, '토': 6, '일': 0 };
  const classDays = schedule.map(s => dayMap[s.day]).filter(d => d !== undefined);

  if (classDays.length === 0) return 0;

  let count = 0;
  const current = new Date(startDate);

  while (current <= today) {
    const dayOfWeek = current.getDay();
    if (classDays.includes(dayOfWeek)) {
      // 홀딩 기간 중에는 수업 완료로 카운트하지 않음
      const isInHoldingPeriod = holdingRange &&
        current >= holdingRange.start &&
        current <= holdingRange.end;

      // 공휴일인 경우 수업 완료로 카운트하지 않음
      const holiday = isHolidayDate(current, firebaseHolidays);

      if (!isInHoldingPeriod && !holiday) {
        count++;
      }
    }
    current.setDate(current.getDate() + 1);
  }

  return count;
};

/**
 * 수강생 데이터로부터 수강권 통계 계산
 * @param {Object} student - 구글 시트의 수강생 객체
 * @returns {Object} - 수강권 통계
 */
export const calculateMembershipStats = (student) => {
  if (!student) return null;

  const startDateStr = getStudentField(student, '시작날짜');
  const endDateStr = getStudentField(student, '종료날짜'); // H열: Google Sheets에 저장된 종료일
  const scheduleStr = getStudentField(student, '요일 및 시간');
  const weeklyFrequencyStr = getStudentField(student, '주횟수');

  const holdingStatusStr = getStudentField(student, '홀딩 사용여부') ||
    getStudentField(student, '홀딩 상태') ||
    getStudentField(student, '홀딩사용여부');

  // 여러달 수강권 지원: 홀딩 상태 파싱
  const holdingInfo = parseHoldingStatus(holdingStatusStr);

  const parseDate = (dateStr) => {
    if (!dateStr) return null;
    const cleaned = dateStr.replace(/\D/g, '');

    if (cleaned.length === 6) {
      const year = parseInt('20' + cleaned.substring(0, 2));
      const month = parseInt(cleaned.substring(2, 4)) - 1;
      const day = parseInt(cleaned.substring(4, 6));
      return new Date(year, month, day);
    } else if (cleaned.length === 8) {
      const year = parseInt(cleaned.substring(0, 4));
      const month = parseInt(cleaned.substring(4, 6)) - 1;
      const day = parseInt(cleaned.substring(6, 8));
      return new Date(year, month, day);
    }
    return null;
  };

  const startDate = parseDate(startDateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const weeklyFrequency = parseInt(weeklyFrequencyStr) || 2;
  // 여러달 등록: 총 세션 = 주횟수 × 4주 × 등록개월
  const totalSessions = weeklyFrequency * 4 * holdingInfo.months;

  // 여러달 등록: 남은 홀딩 횟수 = 총 홀딩 횟수 - 사용한 횟수
  const holdingUsed = holdingInfo.isCurrentlyUsed;
  const remainingHolding = holdingInfo.total - holdingInfo.used;
  const totalHolding = holdingInfo.total;
  const usedHolding = holdingInfo.used;

  // 홀딩 기간 정보 가져오기 (completedSessions 계산에 사용)
  let holdingRange = null;
  const holdingStartDate = parseDate(getStudentField(student, '홀딩 시작일'));
  const holdingEndDate = parseDate(getStudentField(student, '홀딩 종료일'));
  if (holdingUsed && holdingStartDate && holdingEndDate) {
    holdingRange = { start: holdingStartDate, end: holdingEndDate };
  }

  // Google Sheets H열 종료날짜를 우선 사용 (홀딩/결석 처리 시 정확하게 갱신됨)
  // H열이 없으면 JS로 재계산 (폴백)
  let endDate = parseDate(endDateStr);
  if (!endDate && startDate && scheduleStr) {
    endDate = calculateEndDate(startDate, totalSessions, scheduleStr, holdingRange);
  }

  // 남은 횟수 계산: 종료일(H열)이 있으면 오늘~종료일 사이의 수업일을 카운트
  // (기존 방식: 시작일~오늘 카운트 → 공휴일/홀딩으로 종료일이 연장된 경우 completedSessions > totalSessions 발생)
  let completedSessions, remainingSessions;

  if (endDate) {
    if (today >= endDate) {
      // 종료일이 지났거나 오늘이 종료일 → 남은 횟수 0
      remainingSessions = 0;
      completedSessions = totalSessions;
    } else if (!startDate || today < startDate) {
      // 시작 전 → 남은 횟수 = 총 횟수
      remainingSessions = totalSessions;
      completedSessions = 0;
    } else {
      // 진행 중: 내일부터 종료일까지의 수업일 수 = 남은 횟수
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      remainingSessions = Math.min(
        totalSessions,
        calculateCompletedSessions(tomorrow, endDate, scheduleStr, holdingRange, [])
      );
      completedSessions = Math.max(0, totalSessions - remainingSessions);
    }
  } else {
    // endDate가 없는 경우 기존 방식 (폴백)
    const countUntil = today;
    completedSessions = Math.min(
      totalSessions,
      calculateCompletedSessions(startDate, countUntil, scheduleStr, holdingRange, [])
    );
    remainingSessions = Math.max(0, totalSessions - completedSessions);
  }

  const formatDate = (date) => {
    if (!date) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // completedSessions는 이미 홀딩 기간을 제외하고 계산됨
  const attendanceCount = completedSessions;

  return {
    studentName: getStudentField(student, '이름'),
    startDate: formatDate(startDate),
    endDate: formatDate(endDate),
    weeklyFrequency,
    totalSessions,
    completedSessions,
    remainingSessions,
    remainingHolding,
    totalHolding,
    usedHolding,
    registrationMonths: holdingInfo.months, // 등록 개월 수
    schedule: scheduleStr,
    attendanceCount: Math.max(0, attendanceCount),
    totalClasses: totalSessions,
    // 홀딩 기간 정보 (N/O열, M열)
    holdingStartDate: formatDate(holdingStartDate),
    holdingEndDate: formatDate(holdingEndDate),
    isCurrentlyHolding: holdingUsed, // M열이 O로 시작하면 true
  };
};

/**
 * 출석 내역 생성
 * @param {Object} student - 수강생 데이터
 * @returns {Array} - 출석 내역 배열
 */
export const generateAttendanceHistory = (student) => {
  if (!student) return [];

  const startDateStr = getStudentField(student, '시작날짜');
  const scheduleStr = getStudentField(student, '요일 및 시간');
  const holdingStatusStr = getStudentField(student, '홀딩 사용여부');
  const holdingStartStr = getStudentField(student, '홀딩 시작일');
  const holdingEndStr = getStudentField(student, '홀딩 종료일');
  const makeupScheduleStr = getStudentField(student, '보강 요일 및 시간');
  const makeupDateStr = getStudentField(student, '보강 날짜');

  // 여러달 수강권 지원: 홀딩 상태 파싱
  const holdingInfo = parseHoldingStatus(holdingStatusStr);

  const history = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const parseDate = (dateStr) => {
    if (!dateStr) return null;
    const cleaned = dateStr.replace(/\D/g, '');

    if (cleaned.length === 6) {
      const year = parseInt('20' + cleaned.substring(0, 2));
      const month = parseInt(cleaned.substring(2, 4)) - 1;
      const day = parseInt(cleaned.substring(4, 6));
      return new Date(year, month, day);
    } else if (cleaned.length === 8) {
      const year = parseInt(cleaned.substring(0, 4));
      const month = parseInt(cleaned.substring(4, 6)) - 1;
      const day = parseInt(cleaned.substring(6, 8));
      return new Date(year, month, day);
    }
    return null;
  };

  const formatDateKorean = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const startDate = parseDate(startDateStr);
  if (startDate && scheduleStr) {
    const schedule = parseScheduleString(scheduleStr);
    const dayMap = { '월': 1, '화': 2, '수': 3, '목': 4, '금': 5 };
    const classDays = schedule.map(s => ({
      day: dayMap[s.day],
      dayName: s.day,
      period: s.period
    })).filter(c => c.day !== undefined);

    const holdingStart = holdingInfo.isCurrentlyUsed ? parseDate(holdingStartStr) : null;
    const holdingEnd = holdingInfo.isCurrentlyUsed ? parseDate(holdingEndStr) : null;

    const current = new Date(startDate);
    while (current <= today) {
      const dayOfWeek = current.getDay();
      const classInfo = classDays.find(c => c.day === dayOfWeek);

      if (classInfo) {
        // 공휴일인 경우 출석 내역에서 제외
        if (isHolidayDate(current, [])) {
          current.setDate(current.getDate() + 1);
          continue;
        }

        const dateStr = formatDateKorean(current);
        const periodName = `${classInfo.period}교시`;

        // 홀딩 기간은 출석 내역에서 제외
        if (holdingStart && holdingEnd &&
          current >= holdingStart && current <= holdingEnd) {
          current.setDate(current.getDate() + 1);
          continue;
        }

        history.push({
          date: dateStr,
          period: periodName,
          type: '정규',
          status: '출석'
        });
      }

      current.setDate(current.getDate() + 1);
    }
  }

  if (makeupDateStr && makeupScheduleStr) {
    const makeupDate = parseDate(makeupDateStr);
    if (makeupDate && makeupDate <= today) {
      const makeupSchedule = parseScheduleString(makeupScheduleStr);
      if (makeupSchedule.length > 0) {
        const dateStr = formatDateKorean(makeupDate);
        const periodName = `${makeupSchedule[0].period}교시`;

        history.push({
          date: dateStr,
          period: periodName,
          type: '보강',
          status: '출석'
        });
      }
    }
  }

  history.sort((a, b) => {
    const dateA = new Date(a.date);
    const dateB = new Date(b.date);
    return dateB - dateA;
  });

  return history.slice(0, 10);
};

/**
 * Get all student data from the sheet
 * @param {number} year - Year (defaults to current year)
 * @param {number} month - Month 1-12 (defaults to current month)
 */
export const getAllStudents = async (year = null, month = null) => {
  try {
    let foundSheetName;
    if (year && month) {
      foundSheetName = getSheetNameByYearMonth(year, month);
    } else {
      foundSheetName = getCurrentSheetName();
    }

    console.log(`📖 Reading data from sheet: "${foundSheetName}"`);
    const range = `${foundSheetName}!A:Z`;
    console.log(`📍 Full range: ${range}`);

    const rows = await readSheetData(range);
    console.log(`📦 Raw data received (${rows.length} rows):`, rows.slice(0, 3));

    const parsedData = parseStudentData(rows);
    console.log(`✨ Parsed ${parsedData.length} students`);

    return parsedData;
  } catch (error) {
    console.error('❌ Error getting students:', error);
    console.error('Error stack:', error.stack);
    throw error;
  }
};

/**
 * Get all students from all available sheets
 * @returns {Promise<Array>} - Array of all students from all sheets
 */
export const getAllStudentsFromAllSheets = async () => {
  try {
    console.log('🔍 Fetching students from all available sheets...');

    // Get all sheet names
    const sheets = await getAllSheetNames();
    console.log('📊 Available sheets:', sheets);

    // Filter sheets matching the pattern "등록생 목록(YY년M월)"
    const studentSheets = sheets.filter(name => name.startsWith('등록생 목록('));
    console.log('📋 Student sheets found:', studentSheets);

    if (studentSheets.length === 0) {
      console.warn('⚠️ No student sheets found');
      return [];
    }

    // Fetch students from all sheets
    const allStudentsPromises = studentSheets.map(async (foundSheetName) => {
      try {
        const range = `${foundSheetName}!A:Z`;
        const rows = await readSheetData(range);
        const parsedData = parseStudentData(rows);
        // Attach sheet name to each student for update tracking
        parsedData.forEach(student => {
          student._foundSheetName = foundSheetName;
        });
        console.log(`✅ Loaded ${parsedData.length} students from ${foundSheetName}`);
        return parsedData;
      } catch (error) {
        console.warn(`⚠️ Failed to load sheet ${foundSheetName}:`, error);
        return [];
      }
    });

    const studentsArrays = await Promise.all(allStudentsPromises);
    const allStudents = studentsArrays.flat();

    console.log(`✨ Total students loaded from all sheets: ${allStudents.length}`);

    return allStudents;
  } catch (error) {
    console.error('❌ Error getting students from all sheets:', error);
    throw error;
  }
};

/**
 * Update student holding status
 * @param {number} rowIndex - Row index in the sheet (0-based, excluding header)
 * @param {string} holdingStatus - 'O' or 'X'
 * @param {string} holdingStartDate - Start date in YYYY-MM-DD format
 * @param {string} holdingEndDate - End date in YYYY-MM-DD format
 * @param {number} year - Year (defaults to current year)
 * @param {number} month - Month 1-12 (defaults to current month)
 */
export const updateStudentHolding = async (rowIndex, holdingStatus, holdingStartDate, holdingEndDate, year = null, month = null) => {
  try {
    let foundSheetName;
    if (year && month) {
      foundSheetName = getSheetNameByYearMonth(year, month);
    } else {
      foundSheetName = getCurrentSheetName();
    }

    // Row 1: Merged header cells
    // Row 2: Column names (headers)
    // Row 3+: Data starts here
    const actualRow = rowIndex + 3;

    await writeSheetData(`${foundSheetName}!M${actualRow}`, [[holdingStatus]]);

    if (holdingStartDate) {
      await writeSheetData(`${foundSheetName}!N${actualRow}`, [[holdingStartDate]]);
    }

    if (holdingEndDate) {
      await writeSheetData(`${foundSheetName}!O${actualRow}`, [[holdingEndDate]]);
    }

    console.log(`Updated holding for row ${actualRow} in sheet ${foundSheetName}`);
  } catch (error) {
    console.error('Error updating holding:', error);
    throw error;
  }
};

/**
 * Update student data (주차수, 요일 및 시간, 홀딩 정보)
 * @param {number} rowIndex - Row index in the sheet (0-based, excluding header)
 * @param {Object} studentData - Student data object with fields to update
 * @param {number} year - Year (defaults to current year)
 * @param {number} month - Month 1-12 (defaults to current month)
 */
export const updateStudentData = async (rowIndex, studentData, year = null, month = null) => {
  try {
    let foundSheetName;

    // Prefer _foundSheetName from studentData if available (for multi-sheet scenarios)
    if (studentData._foundSheetName) {
      foundSheetName = studentData._foundSheetName;
      console.log(`📍 Using sheet name from student data: ${foundSheetName}`);
    } else if (year && month) {
      foundSheetName = getSheetNameByYearMonth(year, month);
    } else {
      foundSheetName = getCurrentSheetName();
    }

    // Row 1: Merged header cells
    // Row 2: Column names (headers)
    // Row 3+: Data starts here
    // So: actualRow = rowIndex + 3
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
  } catch (error) {
    console.error('❌ Error updating student data:', error);
    throw error;
  }
};

/**
 * 홀딩 신청
 * @param {string} studentName - 학생 이름
 * @param {Date} holdingStartDate - 홀딩 시작 날짜
 * @param {Date} holdingEndDate - 홀딩 종료 날짜 (선택사항, 없으면 시작일과 동일)
 * @param {number} year - 년도
 * @param {number} month - 월 (1-12)
 * @param {Array} existingHoldings - 기존 홀딩 목록 (Firebase에서 가져온 것, [{startDate, endDate}, ...])
 * @returns {Promise<Object>} - 성공 여부
 */
export const requestHolding = async (studentName, holdingStartDate, holdingEndDate = null, year = null, month = null, existingHoldings = []) => {
  try {
    const endDate = holdingEndDate || holdingStartDate;

    console.log(`🔍 홀딩 신청 시작: ${studentName}, ${holdingStartDate.toISOString().split('T')[0]} ~ ${endDate.toISOString().split('T')[0]}`);

    // 여러 시트에서 학생 찾기
    let foundSheetName = null;
    let rows = null;
    let headers = null;
    let nameColIndex = -1;
    let studentIndex = -1;

    // 1. 먼저 홀딩 시작일 기준 시트에서 찾기
    const primarySheetName = getCurrentSheetName(holdingStartDate);
    console.log(`📋 우선 검색 시트: ${primarySheetName}`);

    try {
      const primaryRange = `${primarySheetName}!A:Z`;
      rows = await readSheetData(primaryRange);

      if (rows && rows.length >= 2) {
        headers = rows[1];
        nameColIndex = headers.indexOf('이름');

        if (nameColIndex !== -1) {
          studentIndex = rows.findIndex((row, idx) =>
            idx >= 2 && row[nameColIndex] === studentName
          );

          if (studentIndex !== -1) {
            foundSheetName = primarySheetName;
            console.log(`✅ 학생 찾음 (${primarySheetName}): 행 ${studentIndex + 1}`);
          }
        }
      }
    } catch (primaryError) {
      console.warn(`⚠️ ${primarySheetName} 시트 읽기 실패:`, primaryError.message);
    }

    // 2. 못 찾았으면 모든 시트에서 검색
    if (!foundSheetName) {
      console.log(`🔄 ${primarySheetName}에서 못 찾음. 다른 시트 검색 시작...`);

      const allSheets = await getAllSheetNames();
      console.log(`📋 전체 시트 목록:`, allSheets);

      // 등록생 목록 시트만 필터링 (YY년M월 형식)
      const studentSheets = allSheets.filter(name => name.startsWith('등록생 목록'));

      for (const sheetToCheck of studentSheets) {
        if (sheetToCheck === primarySheetName) continue; // 이미 확인한 시트 건너뛰기

        try {
          const range = `${sheetToCheck}!A:Z`;
          rows = await readSheetData(range);

          if (rows && rows.length >= 2) {
            headers = rows[1];
            nameColIndex = headers.indexOf('이름');

            if (nameColIndex !== -1) {
              studentIndex = rows.findIndex((row, idx) =>
                idx >= 2 && row[nameColIndex] === studentName
              );

              if (studentIndex !== -1) {
                foundSheetName = sheetToCheck;
                console.log(`✅ 학생을 다음 시트에서 찾음: ${sheetToCheck}, 행 ${studentIndex + 1}`);
                break;
              }
            }
          }
        } catch (sheetError) {
          console.warn(`⚠️ ${sheetToCheck} 시트 읽기 실패:`, sheetError.message);
        }
      }
    }

    // 3. 모든 시트에서 못 찾았으면 에러
    if (!foundSheetName || studentIndex === -1) {
      throw new Error(`학생 정보를 찾을 수 없습니다: ${studentName}`);
    }

    console.log(`📄 최종 선택 시트: ${foundSheetName}`);

    const findColumnIndex = (fieldName) => {
      let index = headers.indexOf(fieldName);
      if (index !== -1) return index;

      const fieldNameWithNewline = fieldName.replace(/ /g, '\n');
      index = headers.indexOf(fieldNameWithNewline);
      if (index !== -1) return index;

      const fieldNameWithSpace = fieldName.replace(/\n/g, ' ');
      index = headers.indexOf(fieldNameWithSpace);
      if (index !== -1) return index;

      return -1;
    };

    const holdingUsedCol = findColumnIndex('홀딩 사용여부');
    const holdingStartCol = findColumnIndex('홀딩 시작일');
    const holdingEndCol = findColumnIndex('홀딩 종료일');
    const endDateCol = findColumnIndex('종료날짜');

    console.log(`📍 필드 위치: 사용여부=${holdingUsedCol}, 시작일=${holdingStartCol}, 종료일=${holdingEndCol}, 종료날짜=${endDateCol}`);

    if (holdingUsedCol === -1 || holdingStartCol === -1 || holdingEndCol === -1) {
      console.error('헤더:', headers);
      console.error('찾은 인덱스:', { holdingUsedCol, holdingStartCol, holdingEndCol });
      throw new Error('홀딩 관련 필드를 찾을 수 없습니다. (홀딩 사용여부, 홀딩 시작일, 홀딩 종료일)');
    }

    const studentRow = rows[studentIndex];
    const studentData = {};
    headers.forEach((header, idx) => {
      studentData[header] = studentRow[idx] || '';
    });

    const parseDate = (dateStr) => {
      if (!dateStr) return null;
      const cleaned = dateStr.replace(/\D/g, '');
      if (cleaned.length === 6) {
        const year = parseInt('20' + cleaned.substring(0, 2));
        const month = parseInt(cleaned.substring(2, 4)) - 1;
        const day = parseInt(cleaned.substring(4, 6));
        return new Date(year, month, day);
      } else if (cleaned.length === 8) {
        const year = parseInt(cleaned.substring(0, 4));
        const month = parseInt(cleaned.substring(4, 6)) - 1;
        const day = parseInt(cleaned.substring(6, 8));
        return new Date(year, month, day);
      }
      return null;
    };

    const startDateField = getStudentField(studentData, '시작날짜');
    const scheduleStr = getStudentField(studentData, '요일 및 시간');
    const weeklyFrequencyStr = getStudentField(studentData, '주횟수');

    const membershipStartDate = parseDate(startDateField);
    const weeklyFrequency = parseInt(weeklyFrequencyStr) || 2;

    // 여러달 수강권 지원: 홀딩 상태 파싱
    const currentHoldingStatusStr = getStudentField(studentData, '홀딩 사용여부');
    const holdingInfo = parseHoldingStatus(currentHoldingStatusStr);

    // 총 세션 = 주횟수 × 4주 × 등록개월
    const totalSessions = weeklyFrequency * 4 * holdingInfo.months;

    console.log(`📊 수강생 정보: 시작일=${startDateField}, 주횟수=${weeklyFrequency}, 등록개월=${holdingInfo.months}, 총 횟수=${totalSessions}`);
    console.log(`📊 홀딩 정보: 사용=${holdingInfo.used}/${holdingInfo.total}`);

    // 모든 홀딩 기간 수집 (기존 홀딩 + 새 홀딩)
    const allHoldingRanges = [];

    // 기존 홀딩들 추가 (Firebase에서 가져온 것)
    if (existingHoldings && existingHoldings.length > 0) {
      existingHoldings.forEach(h => {
        const start = new Date(h.startDate + 'T00:00:00');
        const end = new Date(h.endDate + 'T00:00:00');
        allHoldingRanges.push({ start, end });
      });
      console.log(`📊 기존 홀딩 ${existingHoldings.length}개 포함`);
    }

    // 새 홀딩 추가
    allHoldingRanges.push({
      start: holdingStartDate,
      end: endDate
    });

    console.log(`📊 총 ${allHoldingRanges.length}개 홀딩 기간으로 종료일 계산`);

    const newEndDate = calculateEndDate(membershipStartDate, totalSessions, scheduleStr, allHoldingRanges);

    if (!newEndDate) {
      throw new Error('종료일 계산에 실패했습니다.');
    }

    const startDateStr = formatDateToYYMMDD(holdingStartDate);
    const endDateStr = formatDateToYYMMDD(endDate);
    const newEndDateStr = formatDateToYYMMDD(newEndDate);

    // 여러달 수강권: 홀딩 상태 문자열 생성
    const newUsedCount = holdingInfo.used + 1;
    const newHoldingStatus = formatHoldingStatus(true, newUsedCount, holdingInfo.total);

    console.log(`📝 업데이트할 데이터: 사용여부=${newHoldingStatus}, 시작일=${startDateStr}, 종료일=${endDateStr}, 새 종료날짜=${newEndDateStr}`);

    const updates = [
      {
        range: `${foundSheetName}!${getColumnLetter(holdingUsedCol)}${studentIndex + 1}`,
        values: [[newHoldingStatus]]
      },
      {
        range: `${foundSheetName}!${getColumnLetter(holdingStartCol)}${studentIndex + 1}`,
        values: [[startDateStr]]
      },
      {
        range: `${foundSheetName}!${getColumnLetter(holdingEndCol)}${studentIndex + 1}`,
        values: [[endDateStr]]
      }
    ];

    if (endDateCol !== -1) {
      updates.push({
        range: `${foundSheetName}!${getColumnLetter(endDateCol)}${studentIndex + 1}`,
        values: [[newEndDateStr]]
      });
    }

    await batchUpdateSheet(updates);

    // 변경된 셀들을 노란색으로 하이라이트
    const cellsToHighlight = [
      `${getColumnLetter(holdingUsedCol)}${studentIndex + 1}`,
      `${getColumnLetter(holdingStartCol)}${studentIndex + 1}`,
      `${getColumnLetter(holdingEndCol)}${studentIndex + 1}`
    ];

    if (endDateCol !== -1) {
      cellsToHighlight.push(`${getColumnLetter(endDateCol)}${studentIndex + 1}`);
    }

    // 하이라이트 적용 (실패해도 홀딩 신청은 성공으로 처리)
    try {
      await highlightCells(cellsToHighlight, foundSheetName);
      console.log(`🎨 셀 하이라이트 완료: ${cellsToHighlight.join(', ')}`);
    } catch (highlightError) {
      console.warn('⚠️ 셀 하이라이트 실패 (홀딩 신청은 완료됨):', highlightError);
    }

    console.log(`✅ 홀딩 신청 완료: ${studentName}, ${startDateStr} ~ ${endDateStr}`);
    console.log(`📅 종료일 연장: ${newEndDateStr}`);
    return { success: true, newEndDate: newEndDateStr };
  } catch (error) {
    console.error('❌ 홀딩 신청 실패:', error);
    throw error;
  }
};

/**
 * 홀딩 취소 (Google Sheets에서 홀딩 정보 초기화 + 종료날짜 재계산)
 * @param {string} studentName - 학생 이름
 * @param {Array} remainingHoldings - 취소 후 남은 홀딩 목록 (Firebase에서 가져온 것)
 * @returns {Promise<Object>} - 성공 여부
 */
export const cancelHoldingInSheets = async (studentName, remainingHoldings = []) => {
  try {
    console.log(`🔄 홀딩 취소 시작 (Google Sheets): ${studentName}`);

    // 여러 시트에서 학생 찾기
    const result = await findStudentAcrossSheets(studentName);

    if (!result) {
      throw new Error(`학생 정보를 찾을 수 없습니다: ${studentName}`);
    }

    const { student, foundSheetName } = result;
    const rowIndex = student._rowIndex;
    const actualRow = rowIndex + 3; // Row 1: 병합 헤더, Row 2: 컬럼명, Row 3부터 데이터

    // 시트의 헤더를 다시 읽어서 컬럼 위치 파악
    const range = `${foundSheetName}!A:Z`;
    const rows = await readSheetData(range);
    const headers = rows[1];

    const findColumnIndex = (fieldName) => {
      let index = headers.indexOf(fieldName);
      if (index !== -1) return index;

      const fieldNameWithNewline = fieldName.replace(/ /g, '\n');
      index = headers.indexOf(fieldNameWithNewline);
      if (index !== -1) return index;

      const fieldNameWithSpace = fieldName.replace(/\n/g, ' ');
      index = headers.indexOf(fieldNameWithSpace);
      if (index !== -1) return index;

      return -1;
    };

    const holdingUsedCol = findColumnIndex('홀딩 사용여부');
    const holdingStartCol = findColumnIndex('홀딩 시작일');
    const holdingEndCol = findColumnIndex('홀딩 종료일');
    const endDateCol = findColumnIndex('종료날짜');

    if (holdingUsedCol === -1) {
      throw new Error('홀딩 사용여부 필드를 찾을 수 없습니다.');
    }

    // 종료날짜 재계산을 위한 데이터 가져오기
    const startDateStr = getStudentField(student, '시작날짜');
    const scheduleStr = getStudentField(student, '요일 및 시간');
    const weeklyFrequencyStr = getStudentField(student, '주횟수');

    // 여러달 수강권 지원: 현재 홀딩 상태 파싱
    const currentHoldingStatusStr = getStudentField(student, '홀딩 사용여부');
    const holdingInfo = parseHoldingStatus(currentHoldingStatusStr);

    const parseDate = (dateStr) => {
      if (!dateStr) return null;
      const cleaned = dateStr.replace(/\D/g, '');
      if (cleaned.length === 6) {
        const year = parseInt('20' + cleaned.substring(0, 2));
        const month = parseInt(cleaned.substring(2, 4)) - 1;
        const day = parseInt(cleaned.substring(4, 6));
        return new Date(year, month, day);
      } else if (cleaned.length === 8) {
        const year = parseInt(cleaned.substring(0, 4));
        const month = parseInt(cleaned.substring(4, 6)) - 1;
        const day = parseInt(cleaned.substring(6, 8));
        return new Date(year, month, day);
      }
      return null;
    };

    const membershipStartDate = parseDate(startDateStr);
    const weeklyFrequency = parseInt(weeklyFrequencyStr) || 2;
    // 여러달 수강권: 총 세션 = 주횟수 × 4주 × 등록개월
    const totalSessions = weeklyFrequency * 4 * holdingInfo.months;

    console.log(`📊 홀딩 취소 - 수강생 정보: 등록개월=${holdingInfo.months}, 홀딩 사용=${holdingInfo.used}/${holdingInfo.total}`);

    // 남은 홀딩들을 고려하여 종료날짜 재계산
    let newEndDateStr = '';
    if (membershipStartDate && scheduleStr) {
      // 남은 홀딩 기간들을 Date 객체로 변환
      const holdingRanges = [];
      if (remainingHoldings && remainingHoldings.length > 0) {
        remainingHoldings.forEach(h => {
          const start = new Date(h.startDate + 'T00:00:00');
          const end = new Date(h.endDate + 'T00:00:00');
          holdingRanges.push({ start, end });
        });
        console.log(`📊 남은 홀딩 ${remainingHoldings.length}개 포함하여 종료일 계산`);
      } else {
        console.log(`📊 남은 홀딩 없음 - 원래 종료일로 계산`);
      }

      const newEndDate = calculateEndDate(membershipStartDate, totalSessions, scheduleStr, holdingRanges);
      if (newEndDate) {
        newEndDateStr = formatDateToYYMMDD(newEndDate);
      }
    }

    // 여러달 수강권: 홀딩 상태 업데이트 (사용 횟수 감소)
    const newUsedCount = Math.max(0, holdingInfo.used - 1);
    const newHoldingStatus = formatHoldingStatus(false, newUsedCount, holdingInfo.total);

    console.log(`📝 홀딩 취소 - 새 상태: ${newHoldingStatus}`);

    // 홀딩 정보 초기화 + 종료날짜 업데이트
    const updates = [
      {
        range: `${foundSheetName}!${getColumnLetter(holdingUsedCol)}${actualRow}`,
        values: [[newHoldingStatus]]
      }
    ];

    if (holdingStartCol !== -1) {
      updates.push({
        range: `${foundSheetName}!${getColumnLetter(holdingStartCol)}${actualRow}`,
        values: [['']]
      });
    }

    if (holdingEndCol !== -1) {
      updates.push({
        range: `${foundSheetName}!${getColumnLetter(holdingEndCol)}${actualRow}`,
        values: [['']]
      });
    }

    // 종료날짜 업데이트 (재계산된 값으로)
    if (endDateCol !== -1 && newEndDateStr) {
      updates.push({
        range: `${foundSheetName}!${getColumnLetter(endDateCol)}${actualRow}`,
        values: [[newEndDateStr]]
      });
      console.log(`📅 종료날짜 재계산: ${newEndDateStr}`);
    }

    await batchUpdateSheet(updates);

    console.log(`✅ 홀딩 취소 완료 (Google Sheets): ${studentName}`);
    return { success: true, newEndDate: newEndDateStr };
  } catch (error) {
    console.error('❌ 홀딩 취소 실패 (Google Sheets):', error);
    throw error;
  }
};

/**
 * 날짜를 YYMMDD 형식으로 변환
 * @param {Date} date - 날짜 객체
 * @returns {string} - YYMMDD 형식 문자열
 */
const formatDateToYYMMDD = (date) => {
  const year = String(date.getFullYear()).slice(2);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
};

/**
 * 컬럼 인덱스를 문자로 변환 (0 -> A, 1 -> B, ...)
 * @param {number} index - 컬럼 인덱스
 * @returns {string} - 컬럼 문자
 */
const getColumnLetter = (index) => {
  let letter = '';
  while (index >= 0) {
    letter = String.fromCharCode((index % 26) + 65) + letter;
    index = Math.floor(index / 26) - 1;
  }
  return letter;
};

/**
 * Parse date string from Google Sheets (YYMMDD format)
 * Example: "260111" → Date(2026, 0, 11)
 * @param {string} dateStr - YYMMDD format date string
 * @returns {Date|null}
 */
export const parseSheetDate = (dateStr) => {
  if (!dateStr || typeof dateStr !== 'string') return null;

  const cleaned = dateStr.replace(/\D/g, '');

  if (cleaned.length === 6) {
    const year = parseInt('20' + cleaned.substring(0, 2));
    const month = parseInt(cleaned.substring(2, 4)) - 1;
    const day = parseInt(cleaned.substring(4, 6));
    return new Date(year, month, day);
  } else if (cleaned.length === 8) {
    const year = parseInt(cleaned.substring(0, 4));
    const month = parseInt(cleaned.substring(4, 6)) - 1;
    const day = parseInt(cleaned.substring(6, 8));
    return new Date(year, month, day);
  }

  return null;
};

/**
 * 모든 시트에서 해당 학생의 '요일 및 시간' 컬럼을 비움 (종료 처리)
 * @param {string} studentName - 학생 이름
 * @returns {Promise<number>} - 업데이트된 시트 수
 */
export const clearStudentScheduleAllSheets = async (studentName) => {
  try {
    console.log(`🔄 모든 시트에서 ${studentName}의 스케줄 삭제 시작...`);

    const allSheets = await getAllSheetNames();
    const studentSheets = allSheets.filter(name => name.startsWith('등록생 목록('));

    let updatedCount = 0;

    for (const sheetName of studentSheets) {
      try {
        const range = `${sheetName}!A:Z`;
        const rows = await readSheetData(range);

        if (!rows || rows.length < 2) continue;

        const headers = rows[1];
        const nameColIndex = headers.indexOf('이름');

        if (nameColIndex === -1) continue;

        // '요일 및 시간' 컬럼 찾기
        let scheduleColIndex = headers.indexOf('요일 및 시간');
        if (scheduleColIndex === -1) {
          scheduleColIndex = headers.indexOf('요일 및\n시간');
        }
        if (scheduleColIndex === -1) {
          scheduleColIndex = headers.indexOf('요일및시간');
        }
        if (scheduleColIndex === -1) continue;

        // 데이터 행(인덱스 2부터) 순회
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
  } catch (error) {
    console.error('❌ 모든 시트 스케줄 삭제 실패:', error);
    throw error;
  }
};

/**
 * 수강생 결석 처리
 * - 구글 시트의 특이사항에 "26.M.D, 26.M.D 결석" 형식으로 기록
 * - 종료날짜를 결석 횟수만큼 뒤로 연장
 * @param {string} studentName - 학생 이름
 * @param {Array<string>} absenceDates - 결석 날짜 배열 (YYYY-MM-DD 형식)
 * @param {Array} firebaseHolidays - Firebase 커스텀 공휴일 배열
 * @returns {Promise<Object>} - { success, newEndDate, notesText }
 */
export const processStudentAbsence = async (studentName, absenceDates, firebaseHolidays = []) => {
  try {
    console.log(`🔄 결석 처리 시작: ${studentName}, 날짜: ${absenceDates.join(', ')}`);

    // 여러 시트에서 학생 찾기
    let foundSheetName = null;
    let rows = null;
    let headers = null;
    let nameColIndex = -1;
    let studentIndex = -1;

    // 현재 월 시트에서 먼저 찾기
    const primarySheetName = getCurrentSheetName();
    try {
      rows = await readSheetData(`${primarySheetName}!A:Z`);
      if (rows && rows.length >= 2) {
        headers = rows[1];
        nameColIndex = headers.indexOf('이름');
        if (nameColIndex !== -1) {
          studentIndex = rows.findIndex((row, idx) =>
            idx >= 2 && row[nameColIndex] === studentName
          );
          if (studentIndex !== -1) {
            foundSheetName = primarySheetName;
          }
        }
      }
    } catch (e) {
      console.warn(`⚠️ ${primarySheetName} 시트 읽기 실패:`, e.message);
    }

    // 못 찾았으면 모든 시트에서 검색
    if (!foundSheetName) {
      const allSheets = await getAllSheetNames();
      const studentSheets = allSheets.filter(name => name.startsWith('등록생 목록'));

      for (const sheetToCheck of studentSheets) {
        if (sheetToCheck === primarySheetName) continue;
        try {
          rows = await readSheetData(`${sheetToCheck}!A:Z`);
          if (rows && rows.length >= 2) {
            headers = rows[1];
            nameColIndex = headers.indexOf('이름');
            if (nameColIndex !== -1) {
              studentIndex = rows.findIndex((row, idx) =>
                idx >= 2 && row[nameColIndex] === studentName
              );
              if (studentIndex !== -1) {
                foundSheetName = sheetToCheck;
                break;
              }
            }
          }
        } catch (sheetError) {
          continue;
        }
      }
    }

    if (!foundSheetName || studentIndex === -1) {
      throw new Error(`학생 정보를 찾을 수 없습니다: ${studentName}`);
    }

    const findColumnIndex = (fieldName) => {
      let index = headers.indexOf(fieldName);
      if (index !== -1) return index;
      index = headers.indexOf(fieldName.replace(/ /g, '\n'));
      if (index !== -1) return index;
      index = headers.indexOf(fieldName.replace(/\n/g, ' '));
      if (index !== -1) return index;
      return -1;
    };

    const notesCol = findColumnIndex('특이사항');
    const endDateCol = findColumnIndex('종료날짜');
    const startDateCol = findColumnIndex('시작날짜');
    const scheduleCol = findColumnIndex('요일 및 시간');
    const weeklyFreqCol = findColumnIndex('주횟수');
    const holdingUsedCol = findColumnIndex('홀딩 사용여부');

    if (endDateCol === -1 || scheduleCol === -1) {
      throw new Error('필요한 필드를 찾을 수 없습니다.');
    }

    const studentRow = rows[studentIndex];

    // 기존 특이사항 가져오기
    const currentNotes = (notesCol !== -1 && studentRow[notesCol]) ? studentRow[notesCol] : '';

    // 결석 날짜를 "26.M.D" 형식으로 변환
    const absenceTexts = absenceDates.map(dateStr => {
      const d = new Date(dateStr + 'T00:00:00');
      const yy = String(d.getFullYear()).slice(2);
      const m = d.getMonth() + 1;
      const day = d.getDate();
      return `${yy}.${m}.${day}`;
    });
    const absenceNote = `${absenceTexts.join(', ')} 결석`;

    // 기존 특이사항에 결석 내용 추가
    const newNotes = currentNotes
      ? `${currentNotes}, ${absenceNote}`
      : absenceNote;

    // 스케줄 정보 가져오기
    const scheduleStr = scheduleCol !== -1 ? (studentRow[scheduleCol] || '') : '';
    const startDateStr = startDateCol !== -1 ? (studentRow[startDateCol] || '') : '';
    const weeklyFreqStr = weeklyFreqCol !== -1 ? (studentRow[weeklyFreqCol] || '') : '';
    const holdingStatusStr = holdingUsedCol !== -1 ? (studentRow[holdingUsedCol] || '') : '';

    // 스케줄에서 수업 요일 파싱
    const schedule = parseScheduleString(scheduleStr);
    const dayMap = { '월': 1, '화': 2, '수': 3, '목': 4, '금': 5, '토': 6, '일': 0 };
    const classDays = schedule.map(s => dayMap[s.day]).filter(d => d !== undefined);

    // 결석 날짜 중 실제 수업일에 해당하는 것만 카운트
    const validAbsenceDates = absenceDates.filter(dateStr => {
      const d = new Date(dateStr + 'T00:00:00');
      return classDays.includes(d.getDay());
    });

    console.log(`📊 결석 날짜 ${absenceDates.length}개 중 수업일: ${validAbsenceDates.length}개`);

    // 종료날짜 재계산: 결석일을 홀딩 범위처럼 처리
    const parseDate = (dateStr) => {
      if (!dateStr) return null;
      const cleaned = dateStr.replace(/\D/g, '');
      if (cleaned.length === 6) {
        return new Date(parseInt('20' + cleaned.substring(0, 2)), parseInt(cleaned.substring(2, 4)) - 1, parseInt(cleaned.substring(4, 6)));
      } else if (cleaned.length === 8) {
        return new Date(parseInt(cleaned.substring(0, 4)), parseInt(cleaned.substring(4, 6)) - 1, parseInt(cleaned.substring(6, 8)));
      }
      return null;
    };

    const membershipStartDate = parseDate(startDateStr);
    const weeklyFrequency = parseInt(weeklyFreqStr) || 2;
    const holdingInfo = parseHoldingStatus(holdingStatusStr);
    const totalSessions = weeklyFrequency * 4 * holdingInfo.months;

    // 결석일을 각각 1일짜리 홀딩 범위로 변환
    const absenceRanges = validAbsenceDates.map(dateStr => {
      const d = new Date(dateStr + 'T00:00:00');
      return { start: d, end: d };
    });

    // 기존 홀딩 기간도 포함 (있을 경우)
    const holdingStartStr = holdingUsedCol !== -1 ? getStudentField(
      Object.fromEntries(headers.map((h, i) => [h, studentRow[i] || ''])),
      '홀딩 시작일'
    ) : '';
    const holdingEndStr = holdingUsedCol !== -1 ? getStudentField(
      Object.fromEntries(headers.map((h, i) => [h, studentRow[i] || ''])),
      '홀딩 종료일'
    ) : '';

    const allRanges = [...absenceRanges];
    if (holdingInfo.isCurrentlyUsed && holdingStartStr && holdingEndStr) {
      const hs = parseDate(holdingStartStr);
      const he = parseDate(holdingEndStr);
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
  } catch (error) {
    console.error('❌ 결석 처리 실패:', error);
    throw error;
  }
};
