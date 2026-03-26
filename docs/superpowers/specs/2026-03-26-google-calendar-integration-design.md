# 입학반 일정 Google Calendar 자동 동기화

## 개요

코치가 입학반 일정을 추가/수정/삭제하면 Google Calendar에 자동 반영하는 기능.

## 인증

- 기존 Google Sheets 서비스 계정 재사용
- Google Calendar API 활성화 필요
- 코치 캘린더를 서비스 계정 이메일에 편집 권한으로 공유
- 환경변수: `GOOGLE_CALENDAR_ID`

## 캘린더 이벤트 형식

- **제목**: `[입학반] 3월 28일 (토)` (한국어 날짜 + 요일)
- **시간**: 시작~종료 (예: 10:00~13:00), timezone: Asia/Seoul

## 데이터 흐름

```
코치 → CoachNewStudents.jsx (입학반 CRUD)
  → firebaseService (Firestore 저장)
  → calendarService (백엔드 API 호출)
    → netlify/functions/calendar.js 또는 functions/server.js
      → Google Calendar API v3
  → Firestore에 calendarEventId 저장
```

## 변경 파일

### 신규 파일

| 파일 | 역할 |
|------|------|
| `netlify/functions/calendar.js` | Google Calendar API 서버리스 함수 (create/update/delete) |
| `src/services/calendarService.js` | 프론트 → 백엔드 Calendar API 호출 래퍼 |

### 수정 파일

| 파일 | 변경 |
|------|------|
| `functions/server.js` | 로컬 개발용 Calendar 엔드포인트 3개 추가 |
| `src/components/CoachNewStudents.jsx` | 입학반 추가/수정/삭제 시 calendarService 호출 |
| `src/services/firebaseService.js` | entranceClass 문서에 `calendarEventId` 필드 포함 |

## API 엔드포인트

| 메서드 | 경로 | 기능 | Body |
|--------|------|------|------|
| POST | `/calendar/create` | 이벤트 생성 | `{ title, date, startTime, endTime }` |
| POST | `/calendar/update` | 이벤트 수정 | `{ eventId, title, date, startTime, endTime }` |
| POST | `/calendar/delete` | 이벤트 삭제 | `{ eventId }` |

## Firestore 스키마 변경

`entranceClasses/{docId}`에 필드 추가:

```
calendarEventId: string (Google Calendar event ID)
```

## 에러 처리

- Calendar API 실패 시 Firestore 저장은 유지 (캘린더는 보조 기능)
- 실패 시 console.warn으로 로깅, UI에서 토스트 알림
- calendarEventId가 없는 기존 입학반은 수정/삭제 시 캘린더 연동 스킵

## 환경변수

### 서버 (Netlify Functions + 로컬)

- `GOOGLE_CALENDAR_ID` — 코치 Google Calendar ID (신규)
- `GOOGLE_PROJECT_ID` — 기존
- `GOOGLE_PRIVATE_KEY` — 기존
- `GOOGLE_CLIENT_EMAIL` — 기존
