const crypto = require('crypto');

const COOLSMS_API_URL = 'https://api.coolsms.co.kr';

/**
 * CoolSMS HMAC-SHA256 인증 헤더 생성
 */
function generateAuthHeaders() {
  const apiKey = process.env.COOLSMS_API_KEY;
  const apiSecret = process.env.COOLSMS_API_SECRET;

  if (!apiKey || !apiSecret) {
    throw new Error('CoolSMS API 인증 정보가 설정되지 않았습니다.');
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
 * CoolSMS API를 통해 SMS 발송
 * @param {string} to - 수신 번호 (하이픈 포함 가능)
 * @param {string} text - 메시지 내용
 * @param {string|null} scheduledDate - 예약 발송 시간 (YYYY-MM-DD HH:mm:ss, KST)
 */
async function sendSMS(to, text, scheduledDate = null) {
  const from = process.env.COOLSMS_SENDER_PHONE;
  if (!from) {
    throw new Error('COOLSMS_SENDER_PHONE이 설정되지 않았습니다.');
  }

  const toClean = to.replace(/-/g, '');
  const fromClean = from.replace(/-/g, '');

  const body = {
    message: {
      to: toClean,
      from: fromClean,
      text: text
    }
  };

  if (scheduledDate) {
    body.scheduledDate = scheduledDate;
  }

  const headers = generateAuthHeaders();

  console.log(`SMS 발송 요청: to=${toClean}, textLength=${text.length}, scheduled=${scheduledDate || '즉시'}`);

  const response = await fetch(`${COOLSMS_API_URL}/messages/v4/send`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  const result = await response.json();

  if (!response.ok) {
    console.error('CoolSMS 오류:', result);
    throw new Error(result.errorMessage || `SMS 발송 실패 (${response.status})`);
  }

  console.log('SMS 발송 성공:', result);
  return result;
}

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
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
      const { to, text, scheduledDate } = JSON.parse(event.body);

      if (!to || !text) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'to와 text는 필수입니다.' })
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
      const { messages } = JSON.parse(event.body);

      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'messages 배열이 필요합니다.' })
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

    // POST /sms/settings - SMS 설정 정보 조회 (환경 변수 기반)
    if (event.httpMethod === 'POST' && path === 'settings') {
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
            isConfigured: !!(process.env.COOLSMS_API_KEY && process.env.COOLSMS_API_SECRET && process.env.COOLSMS_SENDER_PHONE)
          }
        })
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
