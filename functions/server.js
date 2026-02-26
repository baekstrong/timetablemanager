/**
 * 로컬 개발용 Express 서버
 * Firebase Emulator 없이도 Functions를 테스트할 수 있습니다.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { google } = require('googleapis');

const app = express();
const PORT = 5001;

// CORS 및 JSON 파싱 미들웨어
app.use(cors());
app.use(express.json());

// 서비스 계정 키 파일 경로
const SERVICE_ACCOUNT_PATH = path.join(__dirname, '..', 'timetable-manager-483823-71c27367cd6a.json');
const SPREADSHEET_ID = process.env.VITE_GOOGLE_SHEETS_ID || '1gZvM6GqiEZRqhpkzTTbX93cl6vaf15pA3yII_t6uIgo';

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
 * GET /readSheet
 * 구글 시트 데이터 읽기
 */
app.get('/readSheet', async (req, res) => {
  try {
    const { range } = req.query;

    if (!range) {
      return res.status(400).json({ error: 'Range parameter is required' });
    }

    console.log(`📖 Reading sheet data from range: ${range}`);

    const sheets = await getGoogleSheetsClient();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: range,
    });

    console.log(`✅ Successfully read ${response.data.values?.length || 0} rows`);

    res.json({
      success: true,
      values: response.data.values || [],
    });
  } catch (error) {
    console.error('❌ Error reading sheet:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /writeSheet
 * 구글 시트 데이터 쓰기
 */
app.post('/writeSheet', async (req, res) => {
  try {
    const { range, values } = req.body;

    if (!range || !values) {
      return res.status(400).json({ error: 'Range and values are required' });
    }

    console.log(`📝 Writing data to range: ${range}`);

    const sheets = await getGoogleSheetsClient();
    const response = await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: range,
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: values,
      },
    });

    console.log(`✅ Successfully updated ${response.data.updatedCells} cells`);

    res.json({
      success: true,
      updatedCells: response.data.updatedCells,
      updatedRange: response.data.updatedRange,
    });
  } catch (error) {
    console.error('❌ Error writing sheet:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /appendSheet
 * 구글 시트에 데이터 추가
 */
app.post('/appendSheet', async (req, res) => {
  try {
    const { range, values } = req.body;

    if (!range || !values) {
      return res.status(400).json({ error: 'Range and values are required' });
    }

    console.log(`➕ Appending data to range: ${range}`);

    const sheets = await getGoogleSheetsClient();
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: range,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      resource: {
        values: values,
      },
    });

    console.log(`✅ Successfully appended data`);

    res.json({
      success: true,
      updates: response.data.updates,
    });
  } catch (error) {
    console.error('❌ Error appending sheet:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /getSheetInfo
 * 스프레드시트 정보 가져오기
 */
app.get('/getSheetInfo', async (req, res) => {
  try {
    console.log(`📊 Getting sheet info`);

    const sheets = await getGoogleSheetsClient();
    const response = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
    });

    const sheetNames = response.data.sheets.map(sheet => sheet.properties.title);
    console.log(`✅ Found ${sheetNames.length} sheets:`, sheetNames);

    res.json({
      success: true,
      sheets: sheetNames,
    });
  } catch (error) {
    console.error('❌ Error getting sheet info:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /batchUpdateSheet
 * 여러 셀 일괄 업데이트
 */
app.post('/batchUpdateSheet', async (req, res) => {
  try {
    const { data } = req.body;

    if (!data || !Array.isArray(data)) {
      return res.status(400).json({ error: 'Data array is required' });
    }

    console.log(`🔄 Batch updating ${data.length} ranges`);

    const sheets = await getGoogleSheetsClient();
    const response = await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: {
        valueInputOption: 'USER_ENTERED',
        data: data,
      },
    });

    console.log(`✅ Successfully updated ${response.data.totalUpdatedCells} cells`);

    res.json({
      success: true,
      totalUpdatedCells: response.data.totalUpdatedCells,
      responses: response.data.responses,
    });
  } catch (error) {
    console.error('❌ Error batch updating sheet:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /formatCells
 * 셀 서식 적용 (배경색, 정렬)
 */
app.post('/formatCells', async (req, res) => {
  try {
    const { ranges, sheetName, color, horizontalAlignment } = req.body;

    if (!ranges || !Array.isArray(ranges) || !sheetName) {
      return res.status(400).json({ error: 'ranges (array) and sheetName are required' });
    }

    const sheets = await getGoogleSheetsClient();
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    const sheet = spreadsheet.data.sheets.find(s => s.properties.title === sheetName);
    if (!sheet) {
      return res.status(404).json({ error: `Sheet not found: ${sheetName}` });
    }

    const sheetId = sheet.properties.sheetId;

    const userEnteredFormat = {};
    const fieldParts = [];

    if (color) {
      userEnteredFormat.backgroundColor = { red: color.red ?? 1.0, green: color.green ?? 1.0, blue: color.blue ?? 1.0 };
      fieldParts.push('userEnteredFormat.backgroundColor');
    }

    if (horizontalAlignment) {
      userEnteredFormat.horizontalAlignment = horizontalAlignment;
      fieldParts.push('userEnteredFormat.horizontalAlignment');
    }

    const requests = ranges.map(range => {
      const match = range.match(/^([A-Z]+)(\d+)$/);
      if (!match) throw new Error(`Invalid range format: ${range}`);

      const columnLetter = match[1];
      const rowNumber = parseInt(match[2]) - 1;

      let columnIndex = 0;
      for (let i = 0; i < columnLetter.length; i++) {
        columnIndex = columnIndex * 26 + (columnLetter.charCodeAt(i) - 64);
      }
      columnIndex -= 1;

      return {
        repeatCell: {
          range: {
            sheetId,
            startRowIndex: rowNumber,
            endRowIndex: rowNumber + 1,
            startColumnIndex: columnIndex,
            endColumnIndex: columnIndex + 1,
          },
          cell: { userEnteredFormat },
          fields: fieldParts.join(','),
        },
      };
    });

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: { requests },
    });

    console.log(`✅ Formatted ${ranges.length} cells`);
    res.json({ success: true, updatedCells: ranges.length });
  } catch (error) {
    console.error('❌ Error formatting cells:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// Solapi 문자 발송 엔드포인트 (로컬 개발용)
// ============================================

const SOLAPI_API_URL = 'https://api.solapi.com';

function generateSolapiAuthHeaders() {
  const apiKey = process.env.SOLAPI_API_KEY;
  const apiSecret = process.env.SOLAPI_API_SECRET;

  if (!apiKey || !apiSecret) {
    throw new Error('Solapi API 인증 정보가 설정되지 않았습니다. (.env에 SOLAPI_API_KEY, SOLAPI_API_SECRET 추가)');
  }

  const date = new Date().toISOString();
  const salt = crypto.randomBytes(32).toString('hex');
  const signature = crypto.createHmac('sha256', apiSecret)
    .update(date + salt)
    .digest('hex');

  return {
    'Authorization': `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`,
    'Content-Type': 'application/json'
  };
}

async function sendSolapiSMS(to, text, scheduledDate = null) {
  const from = process.env.SOLAPI_SENDER_PHONE;
  if (!from) throw new Error('SOLAPI_SENDER_PHONE이 설정되지 않았습니다.');

  const toClean = to.replace(/-/g, '');
  const fromClean = from.replace(/-/g, '');

  const body = {
    message: { to: toClean, from: fromClean, text }
  };
  if (scheduledDate) body.scheduledDate = scheduledDate;

  const headers = generateSolapiAuthHeaders();
  console.log(`SMS 발송: to=${toClean}, length=${text.length}, scheduled=${scheduledDate || '즉시'}`);

  const response = await fetch(`${SOLAPI_API_URL}/messages/v4/send`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.errorMessage || `SMS 발송 실패 (${response.status})`);
  }
  return result;
}

/**
 * POST /sms/send
 * 단일 SMS 발송
 */
app.post('/sms/send', async (req, res) => {
  try {
    const { to, text, scheduledDate } = req.body;
    if (!to || !text) {
      return res.status(400).json({ error: 'to와 text는 필수입니다.' });
    }
    const result = await sendSolapiSMS(to, text, scheduledDate);
    res.json({ success: true, result });
  } catch (error) {
    console.error('SMS 발송 실패:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /sms/send-batch
 * 다중 SMS 발송
 */
app.post('/sms/send-batch', async (req, res) => {
  try {
    const { messages } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages 배열이 필요합니다.' });
    }

    const results = [];
    const errors = [];

    for (const msg of messages) {
      try {
        const result = await sendSolapiSMS(msg.to, msg.text, msg.scheduledDate);
        results.push({ to: msg.to, success: true, result });
      } catch (err) {
        errors.push({ to: msg.to, error: err.message });
      }
    }

    res.json({ success: true, results, errors });
  } catch (error) {
    console.error('SMS 일괄 발송 실패:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /sms/settings
 * SMS 설정 정보 조회
 */
app.post('/sms/settings', (req, res) => {
  res.json({
    success: true,
    settings: {
      coachPhone: process.env.COACH_PHONE || '',
      naverStoreLinks: {
        2: process.env.NAVER_STORE_LINK_2 || '',
        3: process.env.NAVER_STORE_LINK_3 || '',
        4: process.env.NAVER_STORE_LINK_4 || ''
      },
      preparationMessage: process.env.PREPARATION_MESSAGE || '',
      isConfigured: !!(process.env.SOLAPI_API_KEY && process.env.SOLAPI_API_SECRET && process.env.SOLAPI_SENDER_PHONE)
    }
  });
});

// 헬스 체크 엔드포인트
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server is running' });
});

// 서버 시작
app.listen(PORT, () => {
  console.log('');
  console.log('🚀 Firebase Functions 로컬 서버 시작됨');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📍 서버 주소: http://localhost:${PORT}`);
  console.log('');
  console.log('📡 사용 가능한 엔드포인트:');
  console.log(`   GET  http://localhost:${PORT}/readSheet?range=시트이름!A:Z`);
  console.log(`   POST http://localhost:${PORT}/writeSheet`);
  console.log(`   POST http://localhost:${PORT}/appendSheet`);
  console.log(`   POST http://localhost:${PORT}/batchUpdateSheet`);
  console.log(`   GET  http://localhost:${PORT}/getSheetInfo`);
  console.log(`   POST http://localhost:${PORT}/sms/send`);
  console.log(`   POST http://localhost:${PORT}/sms/send-batch`);
  console.log(`   POST http://localhost:${PORT}/sms/settings`);
  console.log(`   GET  http://localhost:${PORT}/health`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log(`📊 Spreadsheet ID: ${SPREADSHEET_ID}`);
  console.log(`🔑 Service Account: ${SERVICE_ACCOUNT_PATH}`);
  console.log(`📱 Solapi: ${process.env.SOLAPI_API_KEY ? '설정됨' : '미설정 (.env에 SOLAPI_* 추가 필요)'}`);
  console.log('');
  console.log('✨ 준비 완료! React 앱을 실행하세요: npm run dev');
  console.log('');
});
