const { google } = require('googleapis');

// Service account credentials from environment variables
const getGoogleSheetsClient = async () => {
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

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const authClient = await auth.getClient();
    return google.sheets({ version: 'v4', auth: authClient });
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
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

    const sheets = await getGoogleSheetsClient();

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
        insertDataOption: 'INSERT_ROWS',
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

    // POST /sheets/formatCells - Highlight cells with yellow background
    if (event.httpMethod === 'POST' && path === 'formatCells') {
      const { ranges, sheetName } = JSON.parse(event.body);
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
              userEnteredFormat: {
                backgroundColor: {
                  red: 1.0,
                  green: 1.0,
                  blue: 0.6, // Light yellow
                },
              },
            },
            fields: 'userEnteredFormat.backgroundColor',
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

    return {
      statusCode: 404,
      headers,
      body: JSON.stringify({ error: 'Not found' }),
    };
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: error.message,
      }),
    };
  }
};
