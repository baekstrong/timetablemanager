/**
 * Solapi 문자 발송 서비스
 * 신규 수강 접수/승인/입학반 알림 문자 발송
 */

// SMS Netlify Function URL
const getSmsBaseUrl = () => {
  const functionsUrl = import.meta.env.VITE_FUNCTIONS_URL;
  if (functionsUrl) {
    // VITE_FUNCTIONS_URL이 sheets 함수 경로를 포함하면 sms로 교체
    // 예: https://xxx.netlify.app/.netlify/functions/sheets → .../functions/sms
    // 예: http://localhost:5001 → http://localhost:5001/sms
    const base = functionsUrl.replace(/\/sheets\/?$/, '');
    return `${base}/sms`;
  }
  if (import.meta.env.PROD) {
    return '/.netlify/functions/sms';
  }
  return 'http://localhost:5001/sms';
};

// SMS 설정 캐시
let smsSettingsCache = null;
let smsSettingsCacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5분

/**
 * SMS 설정 정보 조회 (코치 전화번호, 스마트스토어 링크, 준비물 안내 등)
 */
export const getSmsSettings = async () => {
  const now = Date.now();
  if (smsSettingsCache && (now - smsSettingsCacheTime) < CACHE_TTL) {
    return smsSettingsCache;
  }

  try {
    const baseUrl = getSmsBaseUrl();
    const response = await fetch(`${baseUrl}/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    const data = await response.json();
    if (data.success && data.settings) {
      smsSettingsCache = data.settings;
      smsSettingsCacheTime = now;
      return data.settings;
    }
    return null;
  } catch (error) {
    console.error('SMS 설정 조회 실패:', error.message);
    return null;
  }
};

/**
 * SMS 단일 발송 (내부 API 호출)
 */
const sendSMS = async (to, text, scheduledDate = null) => {
  const baseUrl = getSmsBaseUrl();
  const url = `${baseUrl}/send`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, text, scheduledDate })
    });

    if (!response.ok) {
      let errorMsg = `SMS API 응답 오류 (HTTP ${response.status})`;
      try {
        const errorData = await response.json();
        errorMsg = errorData.error || errorMsg;
      } catch {}
      throw new Error(errorMsg);
    }

    const data = await response.json();
    if (!data.success) {
      throw new Error(data.error || 'SMS 발송 실패');
    }
    return data;
  } catch (error) {
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      console.error(`SMS 서버 연결 실패 (${url}):`, error.message);
      throw new Error(`SMS 서버에 연결할 수 없습니다. Functions URL을 확인해주세요: ${url}`);
    }
    console.error('SMS 발송 실패:', error.message);
    throw error;
  }
};

/**
 * SMS 일괄 발송 (내부 API 호출)
 */
const sendBatchSMS = async (messages) => {
  try {
    const baseUrl = getSmsBaseUrl();
    const response = await fetch(`${baseUrl}/send-batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages })
    });

    const data = await response.json();
    return data;
  } catch (error) {
    console.warn('SMS 일괄 발송 실패:', error.message);
    throw error;
  }
};

/**
 * KST 날짜 포맷 (Solapi 예약 발송용)
 * @param {Date} date
 * @returns {string} "YYYY-MM-DD HH:mm:ss"
 */
const formatScheduleDate = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
};

// ============================================
// 수강생 안내문자 1: 신규 수강 접수 직후
// ============================================
/**
 * 수강생에게 접수 확인 문자 발송
 * "신규 수강 신청 내역이 코치에게 전달되었습니다. 수강이 승인되면 연락 드리겠습니다"
 */
export const sendStudentRegistrationSMS = async (studentPhone, studentName) => {
  const text = `[근력학교] ${studentName}님, 신규 수강 신청 내역이 코치에게 전달되었습니다. 수강이 승인되면 연락 드리겠습니다.`;

  try {
    await sendSMS(studentPhone, text);
    console.log('수강생 안내문자 1 발송 완료:', studentName);
    return true;
  } catch (error) {
    console.error('수강생 안내문자 1 발송 실패:', studentName, '-', error.message);
    return false;
  }
};

// ============================================
// 코치 안내문자 1: 신규 수강 접수 알림
// ============================================
/**
 * 코치에게 신규 접수 알림 문자 발송
 * "신규 수강 신청이 접수되었습니다"
 */
export const sendCoachNewRegistrationSMS = async (studentName, details, studentPhone) => {
  const settings = await getSmsSettings();
  if (!settings) {
    console.error('SMS 설정을 가져올 수 없습니다. 서버 연결 상태를 확인해주세요.');
    return false;
  }
  if (!settings.isConfigured) {
    console.error('SMS 서비스가 설정되지 않았습니다. Netlify 환경변수(SOLAPI_API_KEY, SOLAPI_API_SECRET, SOLAPI_SENDER_PHONE)를 확인해주세요.');
    return false;
  }
  if (!settings.coachPhone) {
    console.error('코치 전화번호(COACH_PHONE)가 설정되지 않아 문자를 발송할 수 없습니다.');
    return false;
  }

  const paymentLabel = details.paymentMethod === 'naver'
    ? '네이버'
    : details.paymentMethod === 'card'
      ? '현장 카드 결제'
      : '현장 계좌 이체';

  let text = `[근력학교] 신규 수강 신청이 접수되었습니다.`;
  text += `\n이름: ${studentName}`;
  if (studentPhone) {
    text += `\n연락처: ${studentPhone}`;
  }
  text += `\n주횟수: 주${details.weeklyFrequency}회`;
  text += `\n시간표: ${details.scheduleString}`;
  text += `\n결제방식: ${paymentLabel}`;
  if (details.entranceClassDate) {
    text += `\n입학반: ${details.entranceClassDate}`;
  }
  if (details.wantsConsultation) {
    text += `\n* 상담 요청`;
  }
  if (details.question) {
    text += `\n질문: ${details.question}`;
  }

  try {
    await sendSMS(settings.coachPhone, text);
    console.log('코치 안내문자 1 발송 완료');
    return true;
  } catch (error) {
    console.error('코치 안내문자 1 발송 실패:', error.message);
    return false;
  }
};

// ============================================
// 수강생 안내문자 2: 신규 수강 승인 직후
// ============================================
/**
 * 수강생에게 승인 확인 문자 발송
 * "신규 수강이 승인되었습니다." + 준비물 안내 + 네이버 결제 링크
 */
export const sendStudentApprovalSMS = async (studentPhone, studentName, details) => {
  const settings = await getSmsSettings();

  let text = `[근력학교] ${studentName}님, 신규 수강이 승인되었습니다.`;

  // 네이버 결제인 경우 결제 안내 + 스마트스토어 링크 추가
  if (details.paymentMethod === 'naver' && settings?.naverStoreLinks) {
    const link = settings.naverStoreLinks[details.weeklyFrequency];
    if (link) {
      text += `\n\n아래 네이버 스마트스토어 링크를 통해서 결제해주세요.`;
      text += `\n\n네이버 결제 링크(주${details.weeklyFrequency}회):\n${link}`;
    }
  } else {
    // 현장 결제인 경우 방문 안내
    text += `\n\n입학반 날 방문하셔서 결제해주세요!`;
  }

  try {
    await sendSMS(studentPhone, text);
    console.log('수강생 안내문자 2 발송 완료:', studentName);
    return true;
  } catch (error) {
    console.error('수강생 안내문자 2 발송 실패:', error.message);
    return false;
  }
};

// ============================================
// 수강생 안내문자 3: 입학반 일정 3일 전
// ============================================
/**
 * 수강생에게 입학반 3일 전 리마인더 발송
 * "입학반 수강 3일 전입니다." + 준비물 안내
 *
 * 승인 시점에 Solapi 예약 발송 기능으로 스케줄링합니다.
 * - 입학반이 3일 이상 남은 경우: 3일 전 오전 9시에 예약 발송
 * - 입학반이 1~3일 남은 경우: 즉시 발송
 * - 입학반이 이미 지난 경우: 발송하지 않음
 */
export const scheduleEntranceReminderSMS = async (studentPhone, studentName, details) => {
  // 날짜/시간 포맷: "2026-02-28" → "2월 28일(토)", 시간은 entranceClassDate에서 추출
  let dateTimeStr = details.entranceClassDate || '';
  try {
    const d = new Date(details.entranceDate + 'T00:00:00');
    if (!isNaN(d.getTime())) {
      const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
      const month = d.getMonth() + 1;
      const day = d.getDate();
      const dayOfWeek = dayNames[d.getDay()];
      // entranceClassDate에서 시간 부분 추출 (예: "10:00 ~ 13:00" → "10-1시")
      const timeMatch = dateTimeStr.match(/(\d{1,2}):?\d{0,2}\s*~\s*(\d{1,2}):?\d{0,2}/);
      let timeStr = '';
      if (timeMatch) {
        let startH = parseInt(timeMatch[1]);
        let endH = parseInt(timeMatch[2]);
        if (endH > 12) endH -= 12;
        timeStr = ` ${startH}-${endH}시`;
      }
      dateTimeStr = `${month}월 ${day}일(${dayOfWeek})${timeStr}`;
    }
  } catch (e) { /* 파싱 실패 시 원본 사용 */ }

  let text = `⭐️근력학교 입학반 안내⭐️\n\n안녕하세요 근력학교입니다!\n\n<${dateTimeStr}> 입학반 예정입니다.\n\n준비물은 물 드실 텀블러만 챙겨오시면 되구요.\n옷, 수건 제공해드리니 가져오시지 않아도 됩니다.\n참고로, 수업은 맨발로 진행되니, 신발도 필요없습니다!\n\n이날 늦지 않게 와주시면 감사하겠습니다!`;

  const now = new Date();
  const entranceDate = new Date(details.entranceDate + 'T00:00:00');

  if (isNaN(entranceDate.getTime())) {
    console.error('입학반 날짜 파싱 실패:', details.entranceDate);
    return false;
  }

  // 3일 전 오전 9시
  const reminderDate = new Date(entranceDate);
  reminderDate.setDate(reminderDate.getDate() - 3);
  reminderDate.setHours(9, 0, 0, 0);

  if (reminderDate > now) {
    // 3일 이상 남음 → 예약 발송
    const scheduledDate = formatScheduleDate(reminderDate);
    try {
      await sendSMS(studentPhone, text, scheduledDate);
      console.log('수강생 안내문자 3 예약 완료:', studentName, scheduledDate);
      return true;
    } catch (error) {
      console.error('수강생 안내문자 3 예약 실패:', error.message);
      return false;
    }
  } else if (entranceDate > now) {
    // 입학반이 아직 안 지났지만 3일 이내 → 즉시 발송
    try {
      await sendSMS(studentPhone, text);
      console.log('수강생 안내문자 3 즉시 발송:', studentName);
      return true;
    } catch (error) {
      console.error('수강생 안내문자 3 발송 실패:', error.message);
      return false;
    }
  } else {
    // 입학반이 이미 지남 → 발송하지 않음
    console.log('입학반이 이미 지나 문자를 발송하지 않습니다:', studentName);
    return false;
  }
};

// ============================================
// 신규 접수 시 일괄 발송 (수강생 SMS 1 + 코치 SMS 1)
// ============================================
/**
 * 신규 수강 접수 시 수강생/코치에게 동시 발송
 * 실패해도 등록 자체에 영향을 주지 않음
 */
export const sendRegistrationNotifications = async (studentPhone, studentName, details) => {
  const results = {
    studentSMS: false,
    coachSMS: false
  };

  // 병렬로 수강생/코치 문자 발송
  const [studentResult, coachResult] = await Promise.allSettled([
    sendStudentRegistrationSMS(studentPhone, studentName),
    sendCoachNewRegistrationSMS(studentName, details, studentPhone)
  ]);

  results.studentSMS = studentResult.status === 'fulfilled' && studentResult.value;
  results.coachSMS = coachResult.status === 'fulfilled' && coachResult.value;

  if (studentResult.status === 'rejected') {
    console.error('수강생 문자 발송 실패:', studentResult.reason?.message || studentResult.reason);
  }
  if (coachResult.status === 'rejected') {
    console.error('코치 문자 발송 실패:', coachResult.reason?.message || coachResult.reason);
  }

  return results;
};

// ============================================
// 승인 시 일괄 발송 (수강생 SMS 2 + 수강생 SMS 3 예약)
// ============================================
/**
 * 수강 승인 시 수강생에게 승인 문자 + 입학반 리마인더 예약
 * 실패해도 승인 자체에 영향을 주지 않음
 */
export const sendApprovalNotifications = async (studentPhone, studentName, details) => {
  const results = {
    approvalSMS: false,
    reminderSMS: false
  };

  // 승인 문자 즉시 발송
  try {
    results.approvalSMS = await sendStudentApprovalSMS(studentPhone, studentName, details);
  } catch (error) {
    console.error('승인 문자 발송 실패:', error.message);
  }

  // 입학반 리마인더 예약 (입학반 날짜가 있는 경우)
  if (details.entranceDate && details.entranceClassDate) {
    try {
      results.reminderSMS = await scheduleEntranceReminderSMS(studentPhone, studentName, details);
    } catch (error) {
      console.error('입학반 리마인더 예약 실패:', error.message);
    }
  }

  return results;
};
