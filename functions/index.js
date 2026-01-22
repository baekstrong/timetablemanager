const { onRequest } = require('firebase-functions/v2/https');
const { google } = require('googleapis');
const path = require('path');

// 서비스 계정 키 파일 경로
const SERVICE_ACCOUNT_PATH = path.join(__dirname, '..', 'timetable-manager-483823-71c27367cd6a.json');
const SPREADSHEET_ID = process.env.VITE_GOOGLE_SHEETS_ID;

// Google Sheets API 클라이언트 생성
const getGoogleSheetsClient = async () => {
  const auth = new google.auth.GoogleAuth({
    keyFile: SERVICE_ACCOUNT_PATH,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const authClient = await auth.getClient();
  return google.sheets({ version: 'v4', auth: authClient });
};

/**
 * 구글 시트 데이터 읽기
 * GET /api/sheets/read?range=시트이름!A:Z
 */
exports.readSheet = onRequest({ cors: true }, async (req, res) => {
  try {
    const { range } = req.query;

    if (!range) {
      return res.status(400).json({ error: 'Range parameter is required' });
    }

    const sheets = await getGoogleSheetsClient();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: range,
    });

    res.json({
      success: true,
      values: response.data.values || [],
    });
  } catch (error) {
    console.error('Error reading sheet:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * 구글 시트 데이터 쓰기
 * POST /api/sheets/write
 * Body: { range: "시트이름!A1", values: [["data1", "data2"]] }
 */
exports.writeSheet = onRequest({ cors: true }, async (req, res) => {
  try {
    const { range, values } = req.body;

    if (!range || !values) {
      return res.status(400).json({ error: 'Range and values are required' });
    }

    const sheets = await getGoogleSheetsClient();
    const response = await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: range,
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: values,
      },
    });

    res.json({
      success: true,
      updatedCells: response.data.updatedCells,
      updatedRange: response.data.updatedRange,
    });
  } catch (error) {
    console.error('Error writing sheet:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * 구글 시트 데이터 추가
 * POST /api/sheets/append
 * Body: { range: "시트이름!A:Z", values: [["data1", "data2"]] }
 */
exports.appendSheet = onRequest({ cors: true }, async (req, res) => {
  try {
    const { range, values } = req.body;

    if (!range || !values) {
      return res.status(400).json({ error: 'Range and values are required' });
    }

    const sheets = await getGoogleSheetsClient();
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: range,
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: values,
      },
    });

    res.json({
      success: true,
      updates: response.data.updates,
    });
  } catch (error) {
    console.error('Error appending sheet:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * 스프레드시트 정보 가져오기
 * GET /api/sheets/info
 */
exports.getSheetInfo = onRequest({ cors: true }, async (req, res) => {
  try {
    const sheets = await getGoogleSheetsClient();
    const response = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
    });

    res.json({
      success: true,
      sheets: response.data.sheets.map(sheet => sheet.properties.title),
    });
  } catch (error) {
    console.error('Error getting sheet info:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * 일괄 업데이트
 * POST /api/sheets/batchUpdate
 * Body: { data: [{ range: "시트!A1", values: [[...]] }, ...] }
 */
exports.batchUpdateSheet = onRequest({ cors: true }, async (req, res) => {
  try {
    const { data } = req.body;

    if (!data || !Array.isArray(data)) {
      return res.status(400).json({ error: 'Data array is required' });
    }

    const sheets = await getGoogleSheetsClient();
    const response = await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: {
        valueInputOption: 'USER_ENTERED',
        data: data,
      },
    });

    res.json({
      success: true,
      totalUpdatedCells: response.data.totalUpdatedCells,
      responses: response.data.responses,
    });
  } catch (error) {
    console.error('Error batch updating sheet:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});
