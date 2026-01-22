/**
 * 로컬 개발용 Express 서버
 * Firebase Emulator 없이도 Functions를 테스트할 수 있습니다.
 */

const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const path = require('path');

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
  console.log(`   GET  http://localhost:${PORT}/health`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log(`📊 Spreadsheet ID: ${SPREADSHEET_ID}`);
  console.log(`🔑 Service Account: ${SERVICE_ACCOUNT_PATH}`);
  console.log('');
  console.log('✨ 준비 완료! React 앱을 실행하세요: npm run dev');
  console.log('');
});
