/**
 * Google Calendar 연동 서비스
 * 입학반 일정 추가/수정/삭제 시 Google Calendar에 자동 반영
 */

const getCalendarBaseUrl = () => {
  const functionsUrl = import.meta.env.VITE_FUNCTIONS_URL;
  if (functionsUrl) {
    const base = functionsUrl.replace(/\/sheets\/?$/, '');
    return `${base}/calendar`;
  }
  if (import.meta.env.PROD) {
    return '/.netlify/functions/calendar';
  }
  return 'http://localhost:5001/calendar';
};

/**
 * 입학반 일정의 캘린더 이벤트 제목 생성
 * @param {string} dateStr - YYYY-MM-DD 형식
 * @returns {string} "[입학반] 3월 28일 (토)"
 */
const formatCalendarTitle = (dateStr) => {
  const date = new Date(dateStr + 'T00:00:00+09:00');
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  const dayName = dayNames[date.getDay()];
  return `[입학반] ${month}월 ${day}일 (${dayName})`;
};

/**
 * Google Calendar 이벤트 생성
 * @returns {Promise<string|null>} eventId 또는 실패 시 null
 */
export const createCalendarEvent = async (date, startTime, endTime) => {
  try {
    const response = await fetch(`${getCalendarBaseUrl()}/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: formatCalendarTitle(date),
        date,
        startTime,
        endTime: endTime || '13:00',
      }),
    });
    const result = await response.json();
    if (result.success) {
      console.log('📅 캘린더 이벤트 생성:', result.eventId);
      return result.eventId;
    }
    console.warn('캘린더 이벤트 생성 실패:', result.error);
    return null;
  } catch (err) {
    console.warn('캘린더 연동 실패 (생성):', err.message);
    return null;
  }
};

/**
 * Google Calendar 이벤트 수정
 */
export const updateCalendarEvent = async (eventId, date, startTime, endTime) => {
  if (!eventId) return;
  try {
    const response = await fetch(`${getCalendarBaseUrl()}/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId,
        title: formatCalendarTitle(date),
        date,
        startTime,
        endTime: endTime || '13:00',
      }),
    });
    const result = await response.json();
    if (!result.success) {
      console.warn('캘린더 이벤트 수정 실패:', result.error);
    }
  } catch (err) {
    console.warn('캘린더 연동 실패 (수정):', err.message);
  }
};

/**
 * Google Calendar 이벤트 삭제
 */
export const deleteCalendarEvent = async (eventId) => {
  if (!eventId) return;
  try {
    const response = await fetch(`${getCalendarBaseUrl()}/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventId }),
    });
    const result = await response.json();
    if (!result.success) {
      console.warn('캘린더 이벤트 삭제 실패:', result.error);
    }
  } catch (err) {
    console.warn('캘린더 연동 실패 (삭제):', err.message);
  }
};
