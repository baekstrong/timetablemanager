const { requireCoach } = require('./_requireCoach');
const { checkSignedIn, adminFirestore } = require('./_signedIn');
const crypto = require('crypto');

// 임의 수신번호·문구 발송(/send, /send-batch)은 코치만(2026-11-04). 수강생·공개 신청 화면의 자동 안내는
// /registration-received, /makeup-seat 가 문서를 읽어 정해진 문구로 보낸다.
// 전환기: false면 거부하지 않고 기록만 한다(캐시에 남은 옛 앱이 문자를 못 보내는 일 방지). 새 앱 배포 뒤 true.
const REQUIRE_COACH_FOR_FREE_TEXT = false;

async function freeTextDenied(event, body, path) {
  const denied = await requireCoach(event, body);
  if (denied) console.warn(`[sms] 코치 아닌 ${path} 요청 (${denied})${REQUIRE_COACH_FOR_FREE_TEXT ? ' — 거부' : ' — 전환기라 허용'}`);
  return REQUIRE_COACH_FOR_FREE_TEXT ? denied : null;
}

const json = (statusCode, headers, body) => ({ statusCode, headers, body: JSON.stringify(body) });
const REQUEST_ERRORS = { 400: '잘못된 요청입니다.', 404: '대상을 찾을 수 없습니다.', 409: '이미 보낸 안내입니다.', 410: '안내 가능 시간이 지났습니다.' };

const SOLAPI_API_URL = 'https://api.solapi.com';

/**
 * Solapi HMAC-SHA256 인증 헤더 생성
 */
function generateAuthHeaders() {
  const apiKey = process.env.SOLAPI_API_KEY;
  const apiSecret = process.env.SOLAPI_API_SECRET;

  if (!apiKey || !apiSecret) {
    throw new Error('Solapi API 인증 정보가 설정되지 않았습니다.');
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

/**
 * Solapi API를 통해 SMS 발송
 * @param {string} to - 수신 번호 (하이픈 포함 가능)
 * @param {string} text - 메시지 내용
 * @param {string|null} scheduledDate - 예약 발송 시간 (ISO 8601, +09:00 오프셋 필수 — 없으면 Solapi가 UTC로 해석)
 */
async function sendSMS(to, text, scheduledDate = null) {
  const from = process.env.SOLAPI_SENDER_PHONE;
  if (!from) {
    throw new Error('SOLAPI_SENDER_PHONE이 설정되지 않았습니다.');
  }

  const toClean = to.replace(/-/g, '');
  const fromClean = from.replace(/-/g, '');

  const headers = generateAuthHeaders();

  console.log(`SMS 발송 요청: to=${toClean}, textLength=${text.length}, scheduled=${scheduledDate || '즉시'}`);

  let response;

  if (scheduledDate) {
    // 예약 발송: /messages/v4/send-many 사용 (scheduledDate 지원)
    const body = {
      messages: [
        {
          to: toClean,
          from: fromClean,
          text: text
        }
      ],
      scheduledDate: scheduledDate
    };
    console.log('SMS 예약 발송 body:', JSON.stringify(body));
    response = await fetch(`${SOLAPI_API_URL}/messages/v4/send-many/detail`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });
  } else {
    // 즉시 발송: /messages/v4/send 사용
    const body = {
      message: {
        to: toClean,
        from: fromClean,
        text: text
      }
    };
    console.log('SMS 즉시 발송 body:', JSON.stringify(body));
    response = await fetch(`${SOLAPI_API_URL}/messages/v4/send`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });
  }

  const result = await response.json();

  if (!response.ok) {
    console.error('Solapi 오류:', JSON.stringify(result));
    throw new Error(result.errorMessage || `SMS 발송 실패 (${response.status})`);
  }

  console.log('SMS 발송 성공:', JSON.stringify(result));
  return result;
}

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  let path = event.path.replace('/.netlify/functions/sms', '');
  if (path.startsWith('/')) path = path.substring(1);

  console.log('SMS Function - Path:', path, 'Method:', event.httpMethod);

  try {
    // POST /sms/send - 단일 SMS 발송
    if (event.httpMethod === 'POST' && path === 'send') {
      // 환경변수 설정 확인
      if (!process.env.SOLAPI_API_KEY || !process.env.SOLAPI_API_SECRET) {
        console.error('Solapi 환경변수 미설정: SOLAPI_API_KEY, SOLAPI_API_SECRET를 Netlify 대시보드에서 설정해주세요.');
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({
            success: false,
            error: 'SMS 서비스가 설정되지 않았습니다. Netlify 환경변수(SOLAPI_API_KEY, SOLAPI_API_SECRET, SOLAPI_SENDER_PHONE)를 확인해주세요.'
          })
        };
      }

      const sendBody = JSON.parse(event.body || '{}');
      const sendDenied = await freeTextDenied(event, sendBody, 'send');
      if (sendDenied) return json(sendDenied, headers, { success: false, error: sendDenied === 401 ? '로그인이 필요합니다.' : '코치 권한이 필요합니다.' });
      const { to, text, scheduledDate } = sendBody;

      if (!to || !text) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ success: false, error: 'to와 text는 필수입니다.' })
        };
      }

      const result = await sendSMS(to, text, scheduledDate);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, result })
      };
    }

    // POST /sms/send-batch - 다중 SMS 발송
    if (event.httpMethod === 'POST' && path === 'send-batch') {
      if (!process.env.SOLAPI_API_KEY || !process.env.SOLAPI_API_SECRET) {
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({
            success: false,
            error: 'SMS 서비스가 설정되지 않았습니다. Netlify 환경변수를 확인해주세요.'
          })
        };
      }

      const batchBody = JSON.parse(event.body || '{}');
      const batchDenied = await freeTextDenied(event, batchBody, 'send-batch');
      if (batchDenied) return json(batchDenied, headers, { success: false, error: batchDenied === 401 ? '로그인이 필요합니다.' : '코치 권한이 필요합니다.' });
      const { messages } = batchBody;

      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ success: false, error: 'messages 배열이 필요합니다.' })
        };
      }

      const results = [];
      const errors = [];

      for (const msg of messages) {
        try {
          const result = await sendSMS(msg.to, msg.text, msg.scheduledDate || null);
          results.push({ to: msg.to, success: true, result });
        } catch (err) {
          console.error(`SMS 발송 실패 (${msg.to}):`, err.message);
          errors.push({ to: msg.to, error: err.message });
        }
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, results, errors })
      };
    }

    // POST /sms/registration-received {registrationId} — 공개 신규 신청 직후 접수 안내(신청자+코치). 신청서당 1회.
    // POST /sms/makeup-seat {waitlistId} — 보강 대기 자리 안내 폴백. 로그인 필요, 대기 문서당 1회.
    if (event.httpMethod === 'POST' && (path === 'registration-received' || path === 'makeup-seat')) {
      let body;
      try { body = JSON.parse(event.body || '{}'); } catch { return json(400, headers, { success: false, error: REQUEST_ERRORS[400] }); }
      if (path === 'makeup-seat') {
        const signed = await checkSignedIn(event);
        if (signed !== 'ok') return json(401, headers, { success: false, error: '로그인이 필요합니다.' });
      }
      const { FieldValue } = require('firebase-admin/firestore');
      const requests = require('./_smsRequests');
      const common = { db: adminFirestore(), sendSMS: (to, text) => sendSMS(to, text), serverTimestamp: () => FieldValue.serverTimestamp() };
      const outcome = path === 'makeup-seat'
        ? await requests.makeupSeat({ ...common, waitlistId: body?.waitlistId })
        : await requests.registrationReceived({ ...common, coachPhone: process.env.COACH_PHONE, registrationId: body?.registrationId });
      return outcome.status === 200 ? json(200, headers, outcome.body)
        : json(outcome.status, headers, { success: false, error: REQUEST_ERRORS[outcome.status] || '요청을 처리할 수 없습니다.' });
    }

    // POST /sms/settings - SMS 설정 정보 조회 (환경 변수 기반)
    if (event.httpMethod === 'POST' && path === 'settings') {
      const isConfigured = !!(process.env.SOLAPI_API_KEY && process.env.SOLAPI_API_SECRET && process.env.SOLAPI_SENDER_PHONE);
      if (!isConfigured) {
        console.warn('SMS 설정 미완료 - 누락된 환경변수:', {
          SOLAPI_API_KEY: !!process.env.SOLAPI_API_KEY,
          SOLAPI_API_SECRET: !!process.env.SOLAPI_API_SECRET,
          SOLAPI_SENDER_PHONE: !!process.env.SOLAPI_SENDER_PHONE,
          COACH_PHONE: !!process.env.COACH_PHONE
        });
      }
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          settings: {
            coachPhone: process.env.COACH_PHONE || '',
            naverStoreLinks: {
              2: process.env.NAVER_STORE_LINK_2 || '',
              3: process.env.NAVER_STORE_LINK_3 || '',
              4: process.env.NAVER_STORE_LINK_4 || ''
            },
            preparationMessage: process.env.PREPARATION_MESSAGE || '',
            isConfigured
          }
        })
      };
    }

    // POST /sms/cancel-scheduled - 예약 SMS 취소
    if (event.httpMethod === 'POST' && path === 'cancel-scheduled') {
      let body;
      try { body = JSON.parse(event.body || '{}'); }
      catch { return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: '잘못된 요청입니다.' }) }; }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: '잘못된 요청입니다.' }) };
      const denied = await requireCoach(event, body);
      if (denied) return { statusCode: denied, headers, body: JSON.stringify({ success: false, error: denied === 401 ? '로그인이 필요합니다.' : '코치 권한이 필요합니다.' }) };
      const { groupId } = body;
      if (!groupId) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ success: false, error: 'groupId는 필수입니다.' })
        };
      }

      const authHeaders = generateAuthHeaders();
      console.log('예약 SMS 취소 요청:', groupId);

      // Solapi 예약 취소는 /schedule (복수형 /scheduled 는 404 — 취소가 조용히 실패했었음)
      const response = await fetch(`${SOLAPI_API_URL}/messages/v4/groups/${groupId}/schedule`, {
        method: 'DELETE',
        headers: authHeaders
      });

      const result = await response.json();

      if (!response.ok) {
        console.error('예약 SMS 취소 실패:', JSON.stringify(result));
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: false, error: result.errorMessage || `취소 실패 (${response.status})` })
        };
      }

      console.log('예약 SMS 취소 성공:', JSON.stringify(result));
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, result })
      };
    }

    return {
      statusCode: 404,
      headers,
      body: JSON.stringify({ error: 'Not found' })
    };
  } catch (error) {
    console.error('SMS Function Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
};
