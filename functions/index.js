const functions = require('firebase-functions');
const { onRequest } = require('firebase-functions/v2/https');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { google } = require('googleapis');
const admin = require('firebase-admin');

// Initialize Firebase Admin (automatically uses default service account in Cloud Functions)
if (!admin.apps.length) {
  admin.initializeApp();
}

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID || process.env.VITE_GOOGLE_SHEETS_ID;
const getHoldingDiscordWebhookUrl = () => (
  process.env.DISCORD_HOLDING_WEBHOOK_URL
  || functions.config().discord?.holding_webhook_url
);

const formatHoldingSlot = (data) => {
  const startDate = data.startDate || '시작일 미상';
  const endDate = data.endDate || '종료일 미상';
  const holdingDates = Array.isArray(data.holdingDates) && data.holdingDates.length > 0
    ? data.holdingDates.join(', ')
    : '';
  return holdingDates ? `${startDate}~${endDate} / ${holdingDates}` : `${startDate}~${endDate}`;
};

const postDiscordWebhook = async (webhookUrl, content) => {
  if (!webhookUrl) {
    console.warn('DISCORD_HOLDING_WEBHOOK_URL is not configured; skipping holding notification.');
    return { skipped: true };
  }
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Hermes-Ops/1.0',
    },
    body: JSON.stringify({ content }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Discord webhook failed: ${response.status} ${body.slice(0, 300)}`);
  }
  return { success: true };
};

exports.notifyHoldingRequest = onDocumentCreated('holdingRequests/{requestId}', async (event) => {
  const data = event.data?.data() || {};
  const requestId = event.params.requestId;
  const status = data.status || 'active';
  if (status === 'cancelled' || data.deleted) return;

  const lines = [
    '[근학 앱] 홀딩 신청',
    '',
    `학생: ${data.studentName || '이름 미상'}`,
    `기간: ${formatHoldingSlot(data)}`,
    `상태: ${status}`,
    `신청 ID: ${requestId}`,
  ];
  await postDiscordWebhook(getHoldingDiscordWebhookUrl(), lines.join('\n'));
});

// Google Sheets API 클라이언트 생성
const getGoogleSheetsClient = async () => {
  // In Cloud Functions, use Application Default Credentials
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const authClient = await auth.getClient();
  return google.sheets({ version: 'v4', auth: authClient });
};

/**
 * 구글 시트 데이터 읽기
 * GET /readSheet?range=시트이름!A:Z
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
 * POST /writeSheet
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
 * POST /appendSheet
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
      // INSERT_ROWS는 그리드에 새 행을 삽입해 우측 집계 블록(T~AH)을 밀어버리므로
      // OVERWRITE로 표 바로 아래 빈 행에 값만 기록한다 (행 삽입 없음)
      insertDataOption: 'OVERWRITE',
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
 * GET /getSheetInfo
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
 * POST /batchUpdateSheet
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
