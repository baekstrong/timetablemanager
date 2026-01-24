const { google } = require('googleapis');

// Service account credentials from environment variables
const getGoogleSheetsClient = async () => {
  console.log('Credentials check:', {
    hasProjectId: !!process.env.GOOGLE_PROJECT_ID,
    hasPrivateKey: !!process.env.GOOGLE_PRIVATE_KEY,
    hasClientEmail: !!process.env.GOOGLE_CLIENT_EMAIL,
  });

  try {
    const credentials = {
      type: 'service_account',
      project_id: process.env.GOOGLE_PROJECT_ID,
      private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
      private_key: process.env.GOOGLE_PRIVATE_KEY ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined,
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

  try {
    const path = event.path.replace('/.netlify/functions/sheets/', '');
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
