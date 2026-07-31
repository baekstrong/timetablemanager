// googleapis 전체(319개 API eager 로드)는 콜드스타트를 지배하므로 calendar 단독 패키지만 사용
const { calendar: calendarApi, auth: googleAuth } = require('@googleapis/calendar');

// 모듈 스코프 캐시 — 웜 컨테이너에서 인증 클라이언트(액세스 토큰 포함)를 재사용
let cachedCalendarClient = null;

const getCalendarClient = () => {
  if (cachedCalendarClient) return cachedCalendarClient;

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

  const auth = new googleAuth.GoogleAuth({
    credentials: {
      type: 'service_account',
      project_id: process.env.GOOGLE_PROJECT_ID,
      private_key: privateKey,
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
    },
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });

  cachedCalendarClient = calendarApi({ version: 'v3', auth });
  return cachedCalendarClient;
};

const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID;

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
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
    const calendar = getCalendarClient();

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
