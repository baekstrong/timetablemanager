const { google } = require('googleapis');

const getCalendarClient = async () => {
  let privateKey = process.env.GOOGLE_PRIVATE_KEY;
  if (privateKey) {
    let rawKey = privateKey
      .replace(/\\n/g, '')
      .replace(/\s/g, '')
      .replace(/-----BEGINPRIVATEKEY-----/g, '')
      .replace(/-----ENDPRIVATEKEY-----/g, '')
      .replace(/"/g, '');
    const chunked = rawKey.match(/.{1,64}/g)?.join('\n');
    if (chunked) {
      privateKey = `-----BEGIN PRIVATE KEY-----\n${chunked}\n-----END PRIVATE KEY-----\n`;
    }
  }

  const auth = new google.auth.GoogleAuth({
    credentials: {
      type: 'service_account',
      project_id: process.env.GOOGLE_PROJECT_ID,
      private_key: privateKey,
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
    },
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });

  const authClient = await auth.getClient();
  return google.calendar({ version: 'v3', auth: authClient });
};

const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID;

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  let path = event.path.replace('/.netlify/functions/calendar', '');
  if (path.startsWith('/')) path = path.substring(1);

  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    if (!CALENDAR_ID) {
      return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: 'GOOGLE_CALENDAR_ID가 설정되지 않았습니다.' }) };
    }

    const body = JSON.parse(event.body);
    const calendar = await getCalendarClient();

    // POST /calendar/create
    if (path === 'create') {
      const { title, date, startTime, endTime } = body;
      if (!title || !date || !startTime) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'title, date, startTime은 필수입니다.' }) };
      }
      const calendarEvent = {
        summary: title,
        start: { dateTime: `${date}T${startTime}:00`, timeZone: 'Asia/Seoul' },
        end: { dateTime: `${date}T${endTime || '13:00'}:00`, timeZone: 'Asia/Seoul' },
      };
      const result = await calendar.events.insert({ calendarId: CALENDAR_ID, requestBody: calendarEvent });
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, eventId: result.data.id }) };
    }

    // POST /calendar/update
    if (path === 'update') {
      const { eventId, title, date, startTime, endTime } = body;
      if (!eventId) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'eventId는 필수입니다.' }) };
      }
      const calendarEvent = {
        summary: title,
        start: { dateTime: `${date}T${startTime}:00`, timeZone: 'Asia/Seoul' },
        end: { dateTime: `${date}T${endTime || '13:00'}:00`, timeZone: 'Asia/Seoul' },
      };
      await calendar.events.update({ calendarId: CALENDAR_ID, eventId, requestBody: calendarEvent });
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    // POST /calendar/delete
    if (path === 'delete') {
      const { eventId } = body;
      if (!eventId) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'eventId는 필수입니다.' }) };
      }
      await calendar.events.delete({ calendarId: CALENDAR_ID, eventId });
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    return { statusCode: 404, headers, body: JSON.stringify({ error: `Unknown path: ${path}` }) };
  } catch (error) {
    console.error('Calendar API 오류:', error.message);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: error.message }) };
  }
};
