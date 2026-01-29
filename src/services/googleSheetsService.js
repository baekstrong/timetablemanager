// Backend Functions URL
// 로컬 테스트: http://localhost:5001
// Netlify Functions: /.netlify/functions/sheets (자동으로 현재 도메인 사용)
const FUNCTIONS_BASE_URL = import.meta.env.PROD
  ? '/.netlify/functions/sheets'
  : (import.meta.env.VITE_FUNCTIONS_URL || 'http://localhost:5001');
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
 * Highlight cells with yellow background (노란색 하이라이트)
 * @param {Array<string>} ranges - Array of cell ranges (e.g., ["A5", "B5", "C5"])
 * @param {string} foundSheetName - Sheet name
 * @returns {Promise}
 */
export const highlightCells = async (ranges, foundSheetName) => {
  try {
    const response = await fetch(`${FUNCTIONS_BASE_URL}/formatCells`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ranges, foundSheetName }),
    });

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || 'Failed to highlight cells');
    }

    console.log(`✅ Highlighted ${ranges.length} cells with yellow background`);
    return data;
  } catch (error) {
    console.error('Error highlighting cells:', error);
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

/**
 * Calculate end date based on start date, total sessions, schedule, and optional holding period
 * @param {Date} startDate - Start date of membership
 * @param {number} totalSessions - Total number of sessions (e.g., weeklyFrequency * 4)
 * @param {string} scheduleStr - Schedule string (e.g., "화1목1")
 * @param {Object} holdingRange - Optional holding period {start: Date, end: Date}
 * @returns {Date|null} - Calculated end date
 */
const calculateEndDate = (startDate, totalSessions, scheduleStr, holdingRange = null) => {
  if (!startDate || !scheduleStr || !totalSessions) return null;

  const schedule = parseScheduleString(scheduleStr);
  const dayMap = { '월': 1, '화': 2, '수': 3, '목': 4, '금': 5, '토': 6, '일': 0 };
  const classDays = schedule.map(s => dayMap[s.day]).filter(d => d !== undefined);

  if (classDays.length === 0) return null;

  let sessionCount = 0;
  const current = new Date(startDate);

  while (sessionCount < totalSessions) {
    const dayOfWeek = current.getDay();

    if (classDays.includes(dayOfWeek)) {
      const isInHoldingPeriod = holdingRange &&
        current >= holdingRange.start &&
        current <= holdingRange.end;

      if (!isInHoldingPeriod) {
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
 * 시작일부터 오늘까지 완료된 수업 횟수 계산
 * @param {Date} startDate - 시작일
 * @param {Date} today - 오늘 날짜
 * @param {string} scheduleStr - 요일 및 시간 (예: "화1목1")
 * @returns {number} - 완료된 수업 횟수
 */
const calculateCompletedSessions = (startDate, today, scheduleStr) => {
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
      count++;
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
  const scheduleStr = getStudentField(student, '요일 및 시간');
  const weeklyFrequencyStr = getStudentField(student, '주횟수');

  const holdingStatusStr = getStudentField(student, '홀딩 사용여부') ||
    getStudentField(student, '홀딩 상태') ||
    getStudentField(student, '홀딩사용여부');

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
  const totalSessions = weeklyFrequency * 4;
  const completedSessions = calculateCompletedSessions(startDate, today, scheduleStr);
  const remainingSessions = Math.max(0, totalSessions - completedSessions);

  const holdingUsed = holdingStatusStr && (
    holdingStatusStr.toUpperCase().trim() === 'O' ||
    holdingStatusStr.trim() === 'o' ||
    holdingStatusStr === '사용' ||
    holdingStatusStr.toUpperCase().trim() === 'Y'
  );
  const remainingHolding = holdingUsed ? 0 : 1;

  const formatDate = (date) => {
    if (!date) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  let endDate = null;
  if (startDate && scheduleStr) {
    let holdingRange = null;
    if (holdingUsed) {
      const holdingStartDate = parseDate(getStudentField(student, '홀딩 시작일'));
      const holdingEndDate = parseDate(getStudentField(student, '홀딩 종료일'));
      if (holdingStartDate && holdingEndDate) {
        holdingRange = { start: holdingStartDate, end: holdingEndDate };
      }
    }

    endDate = calculateEndDate(startDate, totalSessions, scheduleStr, holdingRange);
  }

  let attendanceCount = completedSessions;

  if (holdingUsed && startDate && scheduleStr) {
    const holdingStartDate = parseDate(getStudentField(student, '홀딩 시작일'));
    const holdingEndDate = parseDate(getStudentField(student, '홀딩 종료일'));

    if (holdingStartDate && holdingEndDate) {
      const schedule = parseScheduleString(scheduleStr);
      const dayMap = { '월': 1, '화': 2, '수': 3, '목': 4, '금': 5 };
      const classDays = schedule.map(s => dayMap[s.day]).filter(d => d !== undefined);

      let holdingSessionCount = 0;
      const current = new Date(holdingStartDate);
      while (current <= holdingEndDate) {
        const dayOfWeek = current.getDay();
        if (classDays.includes(dayOfWeek)) {
          holdingSessionCount++;
        }
        current.setDate(current.getDate() + 1);
      }

      attendanceCount -= holdingSessionCount;
    }
  }

  return {
    studentName: getStudentField(student, '이름'),
    startDate: formatDate(startDate),
    endDate: formatDate(endDate),
    weeklyFrequency,
    totalSessions,
    completedSessions,
    remainingSessions,
    remainingHolding,
    schedule: scheduleStr,
    attendanceCount: Math.max(0, attendanceCount),
    totalClasses: totalSessions
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
  const holdingUsed = getStudentField(student, '홀딩 사용여부');
  const holdingStartStr = getStudentField(student, '홀딩 시작일');
  const holdingEndStr = getStudentField(student, '홀딩 종료일');
  const makeupScheduleStr = getStudentField(student, '보강 요일 및 시간');
  const makeupDateStr = getStudentField(student, '보강 날짜');

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

    const holdingStart = (holdingUsed === 'O' || holdingUsed === 'o') ? parseDate(holdingStartStr) : null;
    const holdingEnd = (holdingUsed === 'O' || holdingUsed === 'o') ? parseDate(holdingEndStr) : null;

    const current = new Date(startDate);
    while (current <= today) {
      const dayOfWeek = current.getDay();
      const classInfo = classDays.find(c => c.day === dayOfWeek);

      if (classInfo) {
        const dateStr = formatDateKorean(current);
        const periodName = `${classInfo.period}교시`;

        if (holdingStart && holdingEnd &&
          current >= holdingStart && current <= holdingEnd) {
          history.push({
            date: dateStr,
            period: periodName,
            type: '정규',
            status: '홀딩'
          });
        } else {
          history.push({
            date: dateStr,
            period: periodName,
            type: '정규',
            status: '출석'
          });
        }
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
 * @returns {Promise<Object>} - 성공 여부
 */
export const requestHolding = async (studentName, holdingStartDate, holdingEndDate = null, year = null, month = null) => {
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

      for (const foundSheetName of studentSheets) {
        if (foundSheetName === primarySheetName) continue; // 이미 확인한 시트 건너뛰기

        try {
          const range = `${foundSheetName}!A:Z`;
          rows = await readSheetData(range);

          if (rows && rows.length >= 2) {
            headers = rows[1];
            nameColIndex = headers.indexOf('이름');

            if (nameColIndex !== -1) {
              studentIndex = rows.findIndex((row, idx) =>
                idx >= 2 && row[nameColIndex] === studentName
              );

              if (studentIndex !== -1) {
                foundSheetName = foundSheetName;
                console.log(`✅ 학생 찾음 (${foundSheetName}): 행 ${studentIndex + 1}`);
                break;
              }
            }
          }
        } catch (sheetError) {
          console.warn(`⚠️ ${foundSheetName} 시트 읽기 실패:`, sheetError.message);
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
    const totalSessions = weeklyFrequency * 4;

    console.log(`📊 수강생 정보: 시작일=${startDateField}, 주횟수=${weeklyFrequency}, 총 횟수=${totalSessions}`);

    const holdingRange = {
      start: holdingStartDate,
      end: endDate
    };

    const newEndDate = calculateEndDate(membershipStartDate, totalSessions, scheduleStr, holdingRange);

    if (!newEndDate) {
      throw new Error('종료일 계산에 실패했습니다.');
    }

    const startDateStr = formatDateToYYMMDD(holdingStartDate);
    const endDateStr = formatDateToYYMMDD(endDate);
    const newEndDateStr = formatDateToYYMMDD(newEndDate);

    console.log(`📝 업데이트할 데이터: 사용여부=O, 시작일=${startDateStr}, 종료일=${endDateStr}, 새 종료날짜=${newEndDateStr}`);

    const updates = [
      {
        range: `${foundSheetName}!${getColumnLetter(holdingUsedCol)}${studentIndex + 1}`,
        values: [['O']]
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
