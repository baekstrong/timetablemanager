# Google Calendar 입학반 일정 동기화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 코치가 입학반 일정을 추가/수정/삭제하면 Google Calendar에 자동으로 이벤트가 생성/수정/삭제되도록 한다.

**Architecture:** 기존 서비스 계정(googleapis)을 재사용하여 백엔드(Netlify Functions + 로컬 Express)에 Calendar API 엔드포인트를 추가하고, 프론트엔드에서 calendarService를 통해 호출. Firestore entranceClasses 문서에 calendarEventId를 저장하여 수정/삭제 시 연동.

**Tech Stack:** googleapis (Calendar API v3), Netlify Functions, Express, React, Firebase Firestore

---

## File Structure

| 파일 | 역할 | 생성/수정 |
|------|------|-----------|
| `netlify/functions/calendar.js` | Google Calendar API 서버리스 함수 | 생성 |
| `functions/server.js` | 로컬 Calendar 엔드포인트 추가 (라인 419 앞) | 수정 |
| `src/services/calendarService.js` | 프론트 → 백엔드 Calendar API 호출 래퍼 | 생성 |
| `src/components/CoachNewStudents.jsx` | 입학반 CRUD에 calendarService 호출 추가 | 수정 |
| `netlify.toml` | GOOGLE_CALENDAR_ID 환경변수 주석 추가 | 수정 |

---

### Task 1: Netlify Functions — calendar.js

**Files:**
- Create: `netlify/functions/calendar.js`

- [ ] **Step 1: Create calendar.js with Google Calendar API client**

기존 `netlify/functions/sheets.js`의 인증 패턴을 그대로 따른다. scopes에 `https://www.googleapis.com/auth/calendar` 추가.

```javascript
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
```

- [ ] **Step 2: Add handler with create/update/delete routes**

```javascript
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
      const event = {
        summary: title,
        start: { dateTime: `${date}T${startTime}:00`, timeZone: 'Asia/Seoul' },
        end: { dateTime: `${date}T${endTime || '13:00'}:00`, timeZone: 'Asia/Seoul' },
      };
      const result = await calendar.events.insert({ calendarId: CALENDAR_ID, requestBody: event });
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, eventId: result.data.id }) };
    }

    // POST /calendar/update
    if (path === 'update') {
      const { eventId, title, date, startTime, endTime } = body;
      if (!eventId) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'eventId는 필수입니다.' }) };
      }
      const event = {
        summary: title,
        start: { dateTime: `${date}T${startTime}:00`, timeZone: 'Asia/Seoul' },
        end: { dateTime: `${date}T${endTime || '13:00'}:00`, timeZone: 'Asia/Seoul' },
      };
      await calendar.events.update({ calendarId: CALENDAR_ID, eventId, requestBody: event });
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
```

- [ ] **Step 3: Commit**

```bash
git add netlify/functions/calendar.js
git commit -m "feat: add Google Calendar API Netlify function for entrance class sync"
```

---

### Task 2: 로컬 개발 서버 — Calendar 엔드포인트

**Files:**
- Modify: `functions/server.js` (라인 397~419 사이에 추가)

- [ ] **Step 1: Add Google Calendar client function**

`getGoogleSheetsClient` 아래(라인 34 근처)에 Calendar 클라이언트 함수 추가:

```javascript
// Google Calendar API 클라이언트 생성
const getGoogleCalendarClient = async () => {
  const auth = new google.auth.GoogleAuth({
    keyFile: SERVICE_ACCOUNT_PATH,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });
  const authClient = await auth.getClient();
  return google.calendar({ version: 'v3', auth: authClient });
};
```

- [ ] **Step 2: Add calendar endpoints before health check**

`app.post('/sms/settings', ...)` 뒤, `app.get('/health', ...)` 앞에 추가:

```javascript
// ============================================
// Google Calendar API 엔드포인트
// ============================================

const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID;

/**
 * POST /calendar/create
 * Google Calendar 이벤트 생성
 */
app.post('/calendar/create', async (req, res) => {
  try {
    if (!CALENDAR_ID) {
      return res.status(500).json({ success: false, error: 'GOOGLE_CALENDAR_ID가 설정되지 않았습니다.' });
    }
    const { title, date, startTime, endTime } = req.body;
    if (!title || !date || !startTime) {
      return res.status(400).json({ error: 'title, date, startTime은 필수입니다.' });
    }
    const calendar = await getGoogleCalendarClient();
    const event = {
      summary: title,
      start: { dateTime: `${date}T${startTime}:00`, timeZone: 'Asia/Seoul' },
      end: { dateTime: `${date}T${endTime || '13:00'}:00`, timeZone: 'Asia/Seoul' },
    };
    const result = await calendar.events.insert({ calendarId: CALENDAR_ID, requestBody: event });
    res.json({ success: true, eventId: result.data.id });
  } catch (error) {
    console.error('Calendar 이벤트 생성 실패:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /calendar/update
 * Google Calendar 이벤트 수정
 */
app.post('/calendar/update', async (req, res) => {
  try {
    if (!CALENDAR_ID) {
      return res.status(500).json({ success: false, error: 'GOOGLE_CALENDAR_ID가 설정되지 않았습니다.' });
    }
    const { eventId, title, date, startTime, endTime } = req.body;
    if (!eventId) {
      return res.status(400).json({ error: 'eventId는 필수입니다.' });
    }
    const calendar = await getGoogleCalendarClient();
    const event = {
      summary: title,
      start: { dateTime: `${date}T${startTime}:00`, timeZone: 'Asia/Seoul' },
      end: { dateTime: `${date}T${endTime || '13:00'}:00`, timeZone: 'Asia/Seoul' },
    };
    await calendar.events.update({ calendarId: CALENDAR_ID, eventId, requestBody: event });
    res.json({ success: true });
  } catch (error) {
    console.error('Calendar 이벤트 수정 실패:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /calendar/delete
 * Google Calendar 이벤트 삭제
 */
app.post('/calendar/delete', async (req, res) => {
  try {
    if (!CALENDAR_ID) {
      return res.status(500).json({ success: false, error: 'GOOGLE_CALENDAR_ID가 설정되지 않았습니다.' });
    }
    const { eventId } = req.body;
    if (!eventId) {
      return res.status(400).json({ error: 'eventId는 필수입니다.' });
    }
    const calendar = await getGoogleCalendarClient();
    await calendar.events.delete({ calendarId: CALENDAR_ID, eventId });
    res.json({ success: true });
  } catch (error) {
    console.error('Calendar 이벤트 삭제 실패:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});
```

- [ ] **Step 3: Update server startup log**

기존 console.log 목록에 calendar 엔드포인트 3줄 추가:

```javascript
  console.log(`   POST http://localhost:${PORT}/calendar/create`);
  console.log(`   POST http://localhost:${PORT}/calendar/update`);
  console.log(`   POST http://localhost:${PORT}/calendar/delete`);
```

- [ ] **Step 4: Commit**

```bash
git add functions/server.js
git commit -m "feat: add Google Calendar endpoints to local dev server"
```

---

### Task 3: 프론트엔드 — calendarService.js

**Files:**
- Create: `src/services/calendarService.js`

- [ ] **Step 1: Create calendarService.js**

기존 `smsService.js`의 URL 결정 패턴을 따른다:

```javascript
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
```

- [ ] **Step 2: Commit**

```bash
git add src/services/calendarService.js
git commit -m "feat: add calendarService for frontend Calendar API calls"
```

---

### Task 4: CoachNewStudents.jsx — Calendar 연동 통합

**Files:**
- Modify: `src/components/CoachNewStudents.jsx`

- [ ] **Step 1: Import calendarService**

파일 상단 import 영역에 추가:

```javascript
import { createCalendarEvent, updateCalendarEvent, deleteCalendarEvent } from '../services/calendarService';
```

- [ ] **Step 2: handleEntranceSubmit에 Calendar 연동 추가**

`handleEntranceSubmit()` (라인 686-705)을 수정. 생성 시 calendarEventId를 Firestore에 저장, 수정 시 기존 eventId로 업데이트:

```javascript
const handleEntranceSubmit = async () => {
    if (!entranceForm.date || !entranceForm.time) {
        alert('날짜와 시간을 입력해주세요.');
        return;
    }

    try {
        if (editingEntrance) {
            // Firestore 수정
            await updateEntranceClass(editingEntrance.id, entranceForm);
            // Calendar 수정
            updateCalendarEvent(
                editingEntrance.calendarEventId,
                entranceForm.date,
                entranceForm.time,
                entranceForm.endTime
            );
        } else {
            // Firestore 생성
            const result = await createEntranceClass(entranceForm);
            // Calendar 생성 → eventId를 Firestore에 저장
            const eventId = await createCalendarEvent(
                entranceForm.date,
                entranceForm.time,
                entranceForm.endTime
            );
            if (eventId && result?.id) {
                await updateEntranceClass(result.id, { calendarEventId: eventId });
            }
        }
        setShowEntranceForm(false);
        setEditingEntrance(null);
        setEntranceForm({ date: '', time: '', description: '', maxCapacity: 6 });
        await loadEntranceClasses();
    } catch (err) {
        alert('저장 실패: ' + err.message);
    }
};
```

- [ ] **Step 3: handleEntranceDelete에 Calendar 삭제 추가**

`handleEntranceDelete()` (라인 707-715)을 수정:

```javascript
const handleEntranceDelete = async (ec) => {
    if (!confirm('이 입학반 일정을 삭제하시겠습니까?')) return;
    try {
        await deleteEntranceClass(ec.id);
        // Calendar 이벤트도 삭제
        deleteCalendarEvent(ec.calendarEventId);
        await loadEntranceClasses();
    } catch (err) {
        alert('삭제 실패: ' + err.message);
    }
};
```

- [ ] **Step 4: handleApprove 자동 생성에도 Calendar 연동 추가**

`handleApprove()` 내 입학반 자동 생성 부분(라인 275-281)에 캘린더 이벤트 생성 추가:

```javascript
// 기존 createEntranceClass 호출 후에 추가:
const eventId = await createCalendarEvent(reg.entranceInquiry, '10:00', '13:00');
if (eventId) {
    await updateEntranceClass(newECId, { currentCount: 1, calendarEventId: eventId });
} else {
    await updateEntranceClass(newECId, { currentCount: 1 });
}
```

- [ ] **Step 5: Commit**

```bash
git add src/components/CoachNewStudents.jsx
git commit -m "feat: integrate Google Calendar sync with entrance class CRUD"
```

---

### Task 5: netlify.toml 환경변수 주석 추가

**Files:**
- Modify: `netlify.toml`

- [ ] **Step 1: Add GOOGLE_CALENDAR_ID comment**

기존 환경변수 주석 섹션 마지막에 추가:

```toml
# Google Calendar 연동
# GOOGLE_CALENDAR_ID
```

- [ ] **Step 2: Commit**

```bash
git add netlify.toml
git commit -m "docs: add GOOGLE_CALENDAR_ID env var comment to netlify.toml"
```
