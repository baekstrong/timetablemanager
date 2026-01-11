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
