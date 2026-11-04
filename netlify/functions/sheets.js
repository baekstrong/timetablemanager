// 공개 빈자리 계산이 앱 코드의 '오늘'(로컬 날짜)을 쓰므로 한국 시간으로 맞춘다(Lambda 기본은 UTC).
process.env.TZ = 'Asia/Seoul';
// googleapis 전체(319개 API eager 로드)는 콜드스타트를 지배하므로 sheets 단독 패키지만 사용
const { sheets: sheetsApi, auth: googleAuth } = require('@googleapis/sheets');
const { readCaller, adminFirestore } = require('./_signedIn');
const { checkStudentWrite } = require('./_sheetOwnership');

// 시트는 수강생 명단·연락처·결제 정보다. 로그인한 사람(코치·수강생)만 쓴다(2026-11-04).
// 2026-11-04 앱이 증표를 보내도록 배포한 뒤 true로 전환. false로 되돌리면 다시 누구나 명단을 읽는다.
const REQUIRE_SIGN_IN = true;
let occupancyLoader = null;

// 모듈 스코프 캐시 — 웜 컨테이너에서 인증 클라이언트(액세스 토큰 포함)를 재사용해
// 요청마다 발생하던 OAuth 토큰 교환 왕복(+150~400ms)을 없앤다
let cachedSheetsClient = null;

// Service account credentials from environment variables
const getGoogleSheetsClient = () => {
  if (cachedSheetsClient) return cachedSheetsClient;

  console.log('Credentials check:', {
    hasProjectId: !!process.env.GOOGLE_PROJECT_ID,
    hasPrivateKey: !!process.env.GOOGLE_PRIVATE_KEY,
    hasClientEmail: !!process.env.GOOGLE_CLIENT_EMAIL,
  });

  try {
    // Private key handling (support various formats)
    let privateKey = process.env.GOOGLE_PRIVATE_KEY;
    if (privateKey) {
      // 1. Remove all whitespace and headers/footers to get raw base64
      let rawKey = privateKey
        .replace(/\\n/g, '')
        .replace(/\s/g, '')
        .replace(/-----BEGINPRIVATEKEY-----/g, '')
        .replace(/-----ENDPRIVATEKEY-----/g, '')
        .replace(/"/g, '');

      // 2. Chunk into 64 characters (Standard PEM format requirement)
      const chunked = rawKey.match(/.{1,64}/g)?.join('\n');

      // 3. Reassemble with correct headers
      if (chunked) {
        privateKey = `-----BEGIN PRIVATE KEY-----\n${chunked}\n-----END PRIVATE KEY-----\n`;
        console.log('Reformatted Private Key Length:', privateKey.length);
      }
    }

    const credentials = {
      type: 'service_account',
      project_id: process.env.GOOGLE_PROJECT_ID,
      private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
      private_key: privateKey,
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      client_id: process.env.GOOGLE_CLIENT_ID,
      auth_uri: 'https://accounts.google.com/o/oauth2/auth',
      token_uri: 'https://oauth2.googleapis.com/token',
      auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
      client_x509_cert_url: process.env.GOOGLE_CERT_URL,
    };

    const auth = new googleAuth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    // GoogleAuth 인스턴스를 그대로 넘기면 내부에서 토큰을 발급·캐시·자동갱신한다
    cachedSheetsClient = sheetsApi({ version: 'v4', auth });
    return cachedSheetsClient;
  } catch (error) {
    console.error('Auth Error Details:', error);
    throw error;
  }
};

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID || process.env.VITE_GOOGLE_SHEETS_ID;

exports.handler = async (event, context) => {
  // Enable CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    // preflight(OPTIONS) 결과를 브라우저가 캐시하게 해 POST마다 왕복 2회가 되는 것을 방지
    'Access-Control-Max-Age': '86400',
  };

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // Debug logging
  console.log('Request Debug:', {
    path: event.path,
    method: event.httpMethod,
    spreadsheetId: SPREADSHEET_ID ? `${SPREADSHEET_ID.substring(0, 5)}...` : 'MISSING'
  });

  try {
    // Robust path parsing
    let path = event.path.replace('/.netlify/functions/sheets', '');
    if (path.startsWith('/')) path = path.substring(1); // Remove leading slash

    console.log('Parsed Path:', path);

    const sheets = getGoogleSheetsClient();

    // GET /sheets/occupancy — 로그인 없는 신규 신청 화면용 칸별 인원(숫자만).
    if (event.httpMethod === 'GET' && path === 'occupancy') {
      if (!occupancyLoader) {
        const { createOccupancyLoader, readPendingRegistrations } = require('./_publicOccupancy');
        occupancyLoader = createOccupancyLoader({ sheets, spreadsheetId: SPREADSHEET_ID,
          readPending: () => readPendingRegistrations(adminFirestore()) });
      }
      const occupancy = await occupancyLoader();
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, occupancy }) };
    }

    const { status: caller, claims } = await readCaller(event);
    if (caller !== 'ok') {
      console.warn('sheets: 로그인 증표 없음/무효', caller, event.httpMethod, path);
      if (REQUIRE_SIGN_IN) {
        return { statusCode: 401, headers, body: JSON.stringify({ success: false, error: '로그인이 필요합니다. 다시 로그인해주세요.' }) };
      }
    }

    // 수강생 증표의 쓰기는 본인 행만(2026-11-04). 행 추가·계약변경은 코치만. 읽기는 그대로(시간표 여석 계산에 전체 명단이 필요).
    if (caller === 'ok' && claims.isCoach !== true && event.httpMethod === 'POST'
      && ['write', 'batchUpdate', 'formatCells', 'append', 'contractChange'].includes(path)) {
      let denied = null;
      if (path === 'append' || path === 'contractChange') denied = '코치만 할 수 있습니다';
      else {
        let body;
        try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }
        const req = path === 'write' ? { kind: 'values', items: [{ range: body.range, values: body.values }] }
          : path === 'batchUpdate' ? { kind: 'values', items: Array.isArray(body.data) ? body.data : [] }
          : { kind: 'format', items: Array.isArray(body.ranges) ? body.ranges.map(range => ({ range })) : [], sheetName: body.sheetName };
        denied = await checkStudentWrite(req, claims.name, async ranges => {
          const res = await sheets.spreadsheets.values.batchGet({ spreadsheetId: SPREADSHEET_ID, ranges });
          return ranges.map((_, i) => res.data.valueRanges?.[i]?.values?.[0]?.[0] ?? '');
        });
      }
      if (denied) {
        console.warn('sheets: 수강생 쓰기 거부', path, denied);
        return { statusCode: 403, headers, body: JSON.stringify({ success: false, error: `권한이 없습니다: ${denied}` }) };
      }
    }

    // GET /sheets/read?range=...
    if (event.httpMethod === 'GET' && path === 'read') {
      const { range } = event.queryStringParameters || {};
      if (!range) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Range parameter is required' }),
        };
      }

      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: range,
      });

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          values: response.data.values || [],
        }),
      };
    }

    // POST /sheets/write
    if (event.httpMethod === 'POST' && path === 'write') {
      const { range, values } = JSON.parse(event.body);
      if (!range || !values) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Range and values are required' }),
        };
      }

      const response = await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: range,
        valueInputOption: 'USER_ENTERED',
        resource: { values: values },
      });

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          updatedCells: response.data.updatedCells,
          updatedRange: response.data.updatedRange,
        }),
      };
    }

    // POST /sheets/append
    if (event.httpMethod === 'POST' && path === 'append') {
      const { range, values } = JSON.parse(event.body);
      if (!range || !values) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Range and values are required' }),
        };
      }

      const response = await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: range,
        valueInputOption: 'USER_ENTERED',
        // INSERT_ROWS는 그리드에 새 행을 삽입해 우측 집계 블록(T~AH)을 밀어버리므로
        // OVERWRITE로 표 바로 아래 빈 행에 값만 기록한다 (행 삽입 없음)
        insertDataOption: 'OVERWRITE',
        resource: { values: values },
      });

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          updates: response.data.updates,
        }),
      };
    }

    // GET /sheets/info
    if (event.httpMethod === 'GET' && path === 'info') {
      const response = await sheets.spreadsheets.get({
        spreadsheetId: SPREADSHEET_ID,
      });

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          sheets: response.data.sheets.map(sheet => sheet.properties.title),
        }),
      };
    }

    // 이전 시간표 제거와 계약변경 행 추가를 단일 원자적 쓰기로 처리한다.
    if (event.httpMethod === 'POST' && path === 'contractChange') {
      const saveContractChange = require('./lib/contractChange.cjs');
      try {
        const result = await saveContractChange(sheets, SPREADSHEET_ID, JSON.parse(event.body));
        return { statusCode: 200, headers, body: JSON.stringify(result) };
      } catch (error) {
        return { statusCode: error.status || 500, headers, body: JSON.stringify({ success: false, error: error.message }) };
      }
    }

    // POST /sheets/batchUpdate
    if (event.httpMethod === 'POST' && path === 'batchUpdate') {
      const { data } = JSON.parse(event.body);
      if (!data || !Array.isArray(data)) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Data array is required' }),
        };
      }

      const response = await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        resource: {
          valueInputOption: 'USER_ENTERED',
          data: data,
        },
      });

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          totalUpdatedCells: response.data.totalUpdatedCells,
          responses: response.data.responses,
        }),
      };
    }

    // POST /sheets/formatCells - Format cells (background color and/or alignment)
    if (event.httpMethod === 'POST' && path === 'formatCells') {
      const { ranges, sheetName, color, horizontalAlignment } = JSON.parse(event.body);
      if (!ranges || !Array.isArray(ranges) || !sheetName) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'ranges (array) and sheetName are required' }),
        };
      }

      // Get sheet ID from sheet name
      const spreadsheet = await sheets.spreadsheets.get({
        spreadsheetId: SPREADSHEET_ID,
      });

      const sheet = spreadsheet.data.sheets.find(s => s.properties.title === sheetName);
      if (!sheet) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: `Sheet not found: ${sheetName}` }),
        };
      }

      const sheetId = sheet.properties.sheetId;

      // Build format object and fields mask
      const userEnteredFormat = {};
      const fieldParts = [];

      if (color) {
        const colorObj = { red: color.red ?? 1.0, green: color.green ?? 1.0, blue: color.blue ?? 1.0 };
        userEnteredFormat.backgroundColor = colorObj;
        userEnteredFormat.backgroundColorStyle = { rgbColor: colorObj };
        fieldParts.push('userEnteredFormat.backgroundColor');
        fieldParts.push('userEnteredFormat.backgroundColorStyle');
      }

      if (horizontalAlignment) {
        userEnteredFormat.horizontalAlignment = horizontalAlignment;
        fieldParts.push('userEnteredFormat.horizontalAlignment');
      }

      // Build batch update requests for formatting
      const requests = ranges.map(range => {
        // Parse range like "A5" or "B10"
        const match = range.match(/^([A-Z]+)(\d+)$/);
        if (!match) {
          throw new Error(`Invalid range format: ${range}`);
        }

        const columnLetter = match[1];
        const rowNumber = parseInt(match[2]) - 1; // 0-indexed

        // Convert column letter to index (A=0, B=1, ...)
        let columnIndex = 0;
        for (let i = 0; i < columnLetter.length; i++) {
          columnIndex = columnIndex * 26 + (columnLetter.charCodeAt(i) - 64);
        }
        columnIndex -= 1; // 0-indexed

        return {
          repeatCell: {
            range: {
              sheetId: sheetId,
              startRowIndex: rowNumber,
              endRowIndex: rowNumber + 1,
              startColumnIndex: columnIndex,
              endColumnIndex: columnIndex + 1,
            },
            cell: {
              userEnteredFormat,
            },
            fields: fieldParts.join(','),
          },
        };
      });

      const response = await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        resource: { requests },
      });

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          updatedCells: ranges.length,
        }),
      };
    }

    // POST /sheets/batchGet - 여러 범위를 한 번에 읽기 (할당량 절약)
    if (event.httpMethod === 'POST' && path === 'batchGet') {
      const { ranges } = JSON.parse(event.body || '{}');
      if (!Array.isArray(ranges) || ranges.length === 0) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'ranges (array) is required' }),
        };
      }

      const response = await sheets.spreadsheets.values.batchGet({
        spreadsheetId: SPREADSHEET_ID,
        ranges,
      });

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          valueRanges: (response.data.valueRanges || []).map(v => ({
            range: v.range,
            values: v.values || [],
          })),
        }),
      };
    }

    return {
      statusCode: 404,
      headers,
      body: JSON.stringify({ error: 'Not found' }),
    };
  } catch (error) {
    console.error('Error:', error);
    // 할당량 초과(429)는 상태코드를 보존해 클라이언트가 재시도할 수 있게 한다
    // (googleapis는 상태를 error.status / error.response.status / error.code 중 하나에 둠)
    const upstreamStatus = error.status || error.response?.status || error.code;
    const statusCode = upstreamStatus === 429 ? 429 : 500;
    return {
      statusCode,
      headers,
      body: JSON.stringify({
        success: false,
        error: error.message,
      }),
    };
  }
};
