import { gapi } from 'gapi-script';

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const API_KEY = import.meta.env.VITE_GOOGLE_API_KEY;
const SPREADSHEET_ID = import.meta.env.VITE_GOOGLE_SHEETS_ID;

// Discovery doc URL for APIs used by the quickstart
const DISCOVERY_DOC = 'https://sheets.googleapis.com/$discovery/rest?version=v4';

// Authorization scopes required by the API
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets';

let tokenClient;
let gapiInited = false;
let gisInited = false;

/**
 * Initialize Google API client
 */
export const initializeGoogleAPI = () => {
    return new Promise((resolve, reject) => {
        gapi.load('client', async () => {
            try {
                await gapi.client.init({
                    apiKey: API_KEY,
                    discoveryDocs: [DISCOVERY_DOC],
                });
                gapiInited = true;
                console.log('Google API initialized');
                resolve();
            } catch (error) {
                console.error('Error initializing Google API:', error);
                reject(error);
            }
        });
    });
};

/**
 * Initialize Google Identity Services
 */
export const initializeGIS = () => {
    return new Promise((resolve) => {
        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID,
            scope: SCOPES,
            callback: '', // defined later
        });
        gisInited = true;
        console.log('Google Identity Services initialized');
        resolve();
    });
};

/**
 * Sign in to Google
 */
export const signInToGoogle = () => {
    return new Promise((resolve, reject) => {
        tokenClient.callback = async (resp) => {
            if (resp.error !== undefined) {
                reject(resp);
            }
            console.log('Signed in to Google');
            resolve(resp);
        };

        if (gapi.client.getToken() === null) {
            // Prompt the user to select a Google Account and ask for consent
            tokenClient.requestAccessToken({ prompt: 'consent' });
        } else {
            // Skip display of account chooser and consent dialog
            tokenClient.requestAccessToken({ prompt: '' });
        }
    });
};

/**
 * Sign out from Google
 */
export const signOutFromGoogle = () => {
    const token = gapi.client.getToken();
    if (token !== null) {
        google.accounts.oauth2.revoke(token.access_token);
        gapi.client.setToken('');
        console.log('Signed out from Google');
    }
};

/**
 * Check if user is signed in
 */
export const isSignedIn = () => {
    return gapi.client.getToken() !== null;
};

/**
 * Get current sheet name based on year and month
 * @param {Date} date - Date object (defaults to current date)
 * @returns {string} - Sheet name in format "등록생 목록(26년1월)"
 */
export const getCurrentSheetName = (date = new Date()) => {
    const year = date.getFullYear().toString().slice(-2); // Get last 2 digits of year
    const month = date.getMonth() + 1; // getMonth() returns 0-11
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
        const response = await gapi.client.sheets.spreadsheets.get({
            spreadsheetId: SPREADSHEET_ID,
        });
        return response.result.sheets.map(sheet => sheet.properties.title);
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
        // If no range specified, use current month's sheet
        if (!range) {
            const sheetName = getCurrentSheetName();
            range = `${sheetName}!A:Z`;
        }

        const response = await gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: range,
        });
        return response.result.values || [];
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
        const response = await gapi.client.sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: range,
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: values,
            },
        });
        console.log('Sheet updated:', response);
        return response;
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
        const response = await gapi.client.sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: range,
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: values,
            },
        });
        console.log('Data appended:', response);
        return response;
    } catch (error) {
        console.error('Error appending sheet data:', error);
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

    // Row 2 (index 1) is the actual header row
    const headers = rows[1];
    const data = rows.slice(2); // Data starts from row 3

    console.log('📋 Headers from row 2:', headers);

    return data.map((row, index) => {
        const student = {};
        headers.forEach((header, colIndex) => {
            student[header] = row[colIndex] || '';
        });
        return student;
    }).filter(student => student['이름']); // Filter out rows without a name
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

    // Try exact match first
    if (student[fieldName] !== undefined) {
        return student[fieldName];
    }

    // Try with newline instead of space
    const fieldNameWithNewline = fieldName.replace(/ /g, '\n');
    if (student[fieldNameWithNewline] !== undefined) {
        return student[fieldNameWithNewline];
    }

    // Try with space instead of newline
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
        
        // Check if this is a class day
        if (classDays.includes(dayOfWeek)) {
            // Check if this date falls within holding period
            const isInHoldingPeriod = holdingRange && 
                current >= holdingRange.start && 
                current <= holdingRange.end;

            // Only count this session if it's NOT in holding period
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

    // 시작일이 미래인 경우 0 반환
    if (startDate > today) return 0;

    // 요일 파싱
    const schedule = parseScheduleString(scheduleStr);
    const dayMap = { '월': 1, '화': 2, '수': 3, '목': 4, '금': 5, '토': 6, '일': 0 };
    const classDays = schedule.map(s => dayMap[s.day]).filter(d => d !== undefined);

    if (classDays.length === 0) return 0;

    // 시작일부터 오늘까지 각 요일이 몇 번 나왔는지 계산
    let count = 0;
    const current = new Date(startDate);

    while (current <= today) {
        const dayOfWeek = current.getDay(); // 0(일) ~ 6(토)
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

    // 홀딩 사용여부 필드 확인 (여러 가능한 필드명 체크)
    const holdingStatusStr = getStudentField(student, '홀딩 사용여부') ||
        getStudentField(student, '홀딩 상태') ||
        getStudentField(student, '홀딩사용여부');

    // 날짜 파싱 (형식: YYMMDD 또는 YYYYMMDD)
    const parseDate = (dateStr) => {
        if (!dateStr) return null;
        const cleaned = dateStr.replace(/\D/g, '');

        if (cleaned.length === 6) {
            // YYMMDD 형식
            const year = parseInt('20' + cleaned.substring(0, 2));
            const month = parseInt(cleaned.substring(2, 4)) - 1;
            const day = parseInt(cleaned.substring(4, 6));
            return new Date(year, month, day);
        } else if (cleaned.length === 8) {
            // YYYYMMDD 형식
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

    // 주횟수 (기본값: 2)
    const weeklyFrequency = parseInt(weeklyFrequencyStr) || 2;

    // 총 횟수 = 주횟수 × 4주
    const totalSessions = weeklyFrequency * 4;

    // 완료된 수업 횟수 계산
    const completedSessions = calculateCompletedSessions(startDate, today, scheduleStr);

    // 남은 횟수
    const remainingSessions = Math.max(0, totalSessions - completedSessions);

    // 남은 홀딩 횟수 (기본 1회, 사용 시 0회)
    // 홀딩 사용여부가 "O", "사용", "Y", "o" 등이면 0, 아니면 1
    const holdingUsed = holdingStatusStr && (
        holdingStatusStr.toUpperCase().trim() === 'O' ||
        holdingStatusStr.trim() === 'o' ||
        holdingStatusStr === '사용' ||
        holdingStatusStr.toUpperCase().trim() === 'Y'
    );
    const remainingHolding = holdingUsed ? 0 : 1;

    // 표시용 날짜 포맷팅
    const formatDate = (date) => {
        if (!date) return '';
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    // 종료일 계산 (홀딩 기간 고려)
    let endDate = null;
    if (startDate && scheduleStr) {
        // 홀딩 기간 파싱
        let holdingRange = null;
        if (holdingUsed) {
            const holdingStartDate = parseDate(getStudentField(student, '홀딩 시작일'));
            const holdingEndDate = parseDate(getStudentField(student, '홀딩 종료일'));
            if (holdingStartDate && holdingEndDate) {
                holdingRange = { start: holdingStartDate, end: holdingEndDate };
            }
        }

        // calculateEndDate 헬퍼 함수 사용
        endDate = calculateEndDate(startDate, totalSessions, scheduleStr, holdingRange);
    }

    // 출석 횟수 계산 (완료된 수업 중 홀딩 제외)
    let attendanceCount = completedSessions;

    // 홀딩 기간 내 수업 횟수 계산
    if (holdingUsed && startDate && scheduleStr) {
        const holdingStartDate = parseDate(getStudentField(student, '홀딩 시작일'));
        const holdingEndDate = parseDate(getStudentField(student, '홀딩 종료일'));

        if (holdingStartDate && holdingEndDate) {
            const schedule = parseScheduleString(scheduleStr);
            const dayMap = { '월': 1, '화': 2, '수': 3, '목': 4, '금': 5 };
            const classDays = schedule.map(s => dayMap[s.day]).filter(d => d !== undefined);

            // 홀딩 기간 내 수업 횟수 계산
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

    // 날짜 파싱 함수 (재사용)
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

    // 날짜를 한국 형식으로 포맷팅
    const formatDateKorean = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    // 1. 정규 수업 출석 내역 생성
    const startDate = parseDate(startDateStr);
    if (startDate && scheduleStr) {
        const schedule = parseScheduleString(scheduleStr);
        const dayMap = { '월': 1, '화': 2, '수': 3, '목': 4, '금': 5 };
        const classDays = schedule.map(s => ({
            day: dayMap[s.day],
            dayName: s.day,
            period: s.period
        })).filter(c => c.day !== undefined);

        // 홀딩 기간 파싱
        const holdingStart = (holdingUsed === 'O' || holdingUsed === 'o') ? parseDate(holdingStartStr) : null;
        const holdingEnd = (holdingUsed === 'O' || holdingUsed === 'o') ? parseDate(holdingEndStr) : null;

        // 시작일부터 오늘까지 순회
        const current = new Date(startDate);
        while (current <= today) {
            const dayOfWeek = current.getDay();
            const classInfo = classDays.find(c => c.day === dayOfWeek);

            if (classInfo) {
                const dateStr = formatDateKorean(current);
                const periodName = `${classInfo.period}교시`;

                // 홀딩 기간 체크
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

    // 2. 보강 수업 출석 내역 추가
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

    // 3. 날짜 역순 정렬 (최신순)
    history.sort((a, b) => {
        const dateA = new Date(a.date);
        const dateB = new Date(b.date);
        return dateB - dateA;
    });

    // 4. 최근 10개만 반환
    return history.slice(0, 10);
};

/**
 * Get all student data from the sheet
 * @param {number} year - Year (defaults to current year)
 * @param {number} month - Month 1-12 (defaults to current month)
 */
export const getAllStudents = async (year = null, month = null) => {
    try {
        let sheetName;
        if (year && month) {
            sheetName = getSheetNameByYearMonth(year, month);
        } else {
            sheetName = getCurrentSheetName();
        }

        console.log(`📖 Reading data from sheet: "${sheetName}"`);
        const range = `${sheetName}!A:Z`;
        console.log(`📍 Full range: ${range}`);

        const rows = await readSheetData(range);
        console.log(`📦 Raw data received (${rows.length} rows):`, rows.slice(0, 3)); // Show first 3 rows

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
        let sheetName;
        if (year && month) {
            sheetName = getSheetNameByYearMonth(year, month);
        } else {
            sheetName = getCurrentSheetName();
        }

        // Assuming holding columns are at specific positions
        // Adjust column letters based on your actual sheet structure
        const actualRow = rowIndex + 2; // +1 for header, +1 for 1-based indexing

        // Update holding status (column M in the image)
        await writeSheetData(`${sheetName}!M${actualRow}`, [[holdingStatus]]);

        // Update holding start date (column N)
        if (holdingStartDate) {
            await writeSheetData(`${sheetName}!N${actualRow}`, [[holdingStartDate]]);
        }

        // Update holding end date (column O)
        if (holdingEndDate) {
            await writeSheetData(`${sheetName}!O${actualRow}`, [[holdingEndDate]]);
        }

        console.log(`Updated holding for row ${actualRow} in sheet ${sheetName}`);
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
        let sheetName;
        if (year && month) {
            sheetName = getSheetNameByYearMonth(year, month);
        } else {
            sheetName = getCurrentSheetName();
        }

        const actualRow = rowIndex + 2; // +1 for header, +1 for 1-based indexing

        console.log(`📝 Updating student data for row ${actualRow} in sheet ${sheetName}`);

        // Column mapping based on typical structure
        // Adjust these column letters based on your actual Google Sheet structure
        // Row 1: Merged cells, Row 2: Headers, Data starts from Row 3
        // Note: Google Sheets headers may contain newlines (\n) instead of spaces
        const columnMap = {
            '주횟수': 'C',           // Column C
            '요일 및 시간': 'D',      // Column D
            '홀딩 사용여부': 'M',     // Column M
            '홀딩\n사용여부': 'M',    // Column M (with newline)
            '홀딩 시작일': 'N',       // Column N
            '홀딩\n시작일': 'N',      // Column N (with newline)
            '홀딩 종료일': 'O',       // Column O
            '홀딩\n종료일': 'O'       // Column O (with newline)
        };

        // Update each field that exists in studentData
        for (const [field, value] of Object.entries(studentData)) {
            if (columnMap[field] && value !== undefined) {
                const column = columnMap[field];
                const range = `${sheetName}!${column}${actualRow}`;
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
        // 종료일이 없으면 시작일과 동일하게 설정
        const endDate = holdingEndDate || holdingStartDate;

        // 선택한 날짜를 기준으로 시트 이름 결정
        const sheetName = getCurrentSheetName(holdingStartDate);
        const range = `${sheetName}!A:Z`;

        console.log(`🔍 홀딩 신청 시작: ${studentName}, ${holdingStartDate.toISOString().split('T')[0]} ~ ${endDate.toISOString().split('T')[0]}`);
        console.log(`📋 시트 이름: ${sheetName}`);

        const response = await gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: range,
        });

        const rows = response.result.values;
        if (!rows || rows.length < 2) {
            throw new Error('시트 데이터를 찾을 수 없습니다.');
        }

        // 학생 찾기
        const headers = rows[1];
        const nameColIndex = headers.indexOf('이름');

        if (nameColIndex === -1) {
            throw new Error('이름 필드를 찾을 수 없습니다.');
        }

        const studentIndex = rows.findIndex((row, idx) =>
            idx >= 2 && row[nameColIndex] === studentName
        );

        if (studentIndex === -1) {
            throw new Error(`학생 정보를 찾을 수 없습니다: ${studentName}`);
        }

        console.log(`✅ 학생 찾음: 행 ${studentIndex + 1}`);

        // 홀딩 정보 업데이트 - 필드명에 줄바꿈이 있을 수 있으므로 유연하게 찾기
        const findColumnIndex = (fieldName) => {
            // 정확한 일치
            let index = headers.indexOf(fieldName);
            if (index !== -1) return index;

            // 띄어쓰기를 줄바꿈으로 변환하여 찾기
            const fieldNameWithNewline = fieldName.replace(/ /g, '\n');
            index = headers.indexOf(fieldNameWithNewline);
            if (index !== -1) return index;

            // 줄바꿈을 띄어쓰기로 변환하여 찾기
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

        // 학생 데이터 가져오기
        const studentRow = rows[studentIndex];
        const studentData = {};
        headers.forEach((header, idx) => {
            studentData[header] = studentRow[idx] || '';
        });

        // 새 종료일 계산
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

        // 홀딩 기간 설정
        const holdingRange = {
            start: holdingStartDate,
            end: endDate
        };

        // 새 종료일 계산
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
                range: `${sheetName}!${getColumnLetter(holdingUsedCol)}${studentIndex + 1}`,
                values: [['O']]
            },
            {
                range: `${sheetName}!${getColumnLetter(holdingStartCol)}${studentIndex + 1}`,
                values: [[startDateStr]]
            },
            {
                range: `${sheetName}!${getColumnLetter(holdingEndCol)}${studentIndex + 1}`,
                values: [[endDateStr]]
            }
        ];

        // 종료날짜 컬럼이 존재하면 업데이트에 추가
        if (endDateCol !== -1) {
            updates.push({
                range: `${sheetName}!${getColumnLetter(endDateCol)}${studentIndex + 1}`,
                values: [[newEndDateStr]]
            });
        }

        await gapi.client.sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            resource: {
                valueInputOption: 'RAW',
                data: updates
            }
        });

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
