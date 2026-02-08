// ============================================
// 수강생 종료일 → Google Calendar 자동 등록
// Google Sheets에 바인딩하여 사용
// ============================================

// 설정
var CALENDAR_NAME = '수강생 종료일 관리';
var SHEET_PREFIX = '등록생 목록';

// ============================================
// 초기 설정 (최초 1회 실행)
// ============================================

/**
 * 최초 설정 - 스크립트 편집기에서 이 함수를 1회 실행
 * 1. 전용 캘린더 생성
 * 2. onEdit 트리거 등록
 * 3. 주기적 동기화 트리거 등록 (매 시간)
 */
function setup() {
  // 기존 트리거 제거
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    ScriptApp.deleteTrigger(triggers[i]);
  }

  // onEdit 트리거 (수동 편집 감지)
  ScriptApp.newTrigger('onSheetEdit')
    .forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet())
    .onEdit()
    .create();

  // 매 시간 동기화 트리거 (API 변경 감지용)
  ScriptApp.newTrigger('syncAllEndDates')
    .timeBased()
    .everyHours(1)
    .create();

  // 전용 캘린더 생성
  var calendar = getOrCreateCalendar();

  Logger.log('설정 완료!');
  Logger.log('캘린더: ' + calendar.getName());
  Logger.log('캘린더 ID: ' + calendar.getId());
  Logger.log('→ TimeTree에서 이 Google Calendar를 외부 캘린더로 연동하세요.');
}

// ============================================
// 핵심 함수
// ============================================

/**
 * 전용 캘린더 가져오기 (없으면 생성)
 */
function getOrCreateCalendar() {
  var calendars = CalendarApp.getCalendarsByName(CALENDAR_NAME);
  if (calendars.length > 0) {
    return calendars[0];
  }
  var calendar = CalendarApp.createCalendar(CALENDAR_NAME, {
    summary: '수강생 종료일 자동 관리',
    color: CalendarApp.Color.RED
  });
  Logger.log('캘린더 생성됨: ' + CALENDAR_NAME);
  return calendar;
}

/**
 * onEdit 트리거 - 종료날짜 컬럼 변경 감지
 */
function onSheetEdit(e) {
  try {
    var sheet = e.source.getActiveSheet();
    var sheetName = sheet.getName();

    // 등록생 목록 시트만 처리
    if (sheetName.indexOf(SHEET_PREFIX) !== 0) return;

    var editedRow = e.range.getRow();
    var editedCol = e.range.getColumn();

    // 헤더 행(1~2행) 무시
    if (editedRow <= 2) return;

    // 종료날짜 컬럼 찾기
    var endDateCol = findColumnByHeader(sheet, '종료날짜');
    if (endDateCol === -1) return;

    // 종료날짜 컬럼이 변경된 경우만 처리
    if (editedCol !== endDateCol) return;

    // 학생 이름 가져오기
    var nameCol = findColumnByHeader(sheet, '이름');
    if (nameCol === -1) return;

    var studentName = String(sheet.getRange(editedRow, nameCol).getValue()).trim();
    var endDateValue = String(sheet.getRange(editedRow, endDateCol).getValue()).trim();

    if (!studentName || !endDateValue) return;

    var endDate = parseDateStr(endDateValue);
    if (!endDate) return;

    // 요일 및 시간 확인 (빈 값이면 종료된 수강생)
    var scheduleCol = findColumnByHeader(sheet, '요일 및 시간');
    if (scheduleCol !== -1) {
      var schedule = String(sheet.getRange(editedRow, scheduleCol).getValue()).trim();
      if (!schedule) return; // 수업 일정 없으면 무시
    }

    updateCalendarEvent(studentName, endDate);
    Logger.log('캘린더 업데이트: ' + studentName + ' → ' + formatDate(endDate));

  } catch (error) {
    Logger.log('onSheetEdit 오류: ' + error.message);
  }
}

/**
 * 캘린더 이벤트 생성/업데이트
 */
function updateCalendarEvent(studentName, endDate) {
  var calendar = getOrCreateCalendar();
  var eventTitle = '[' + studentName + '] 수강 종료';

  // 기존 이벤트 검색 후 삭제 (중복 방지)
  var searchStart = new Date(2024, 0, 1);
  var searchEnd = new Date(2030, 11, 31);
  var events = calendar.getEvents(searchStart, searchEnd, { search: studentName });

  for (var i = 0; i < events.length; i++) {
    if (events[i].getTitle() === eventTitle) {
      events[i].deleteEvent();
    }
  }

  // 새 종일 이벤트 생성
  var event = calendar.createAllDayEvent(eventTitle, endDate, {
    description: studentName + ' 수강생의 수강권 종료일입니다.\n자동 등록됨 (Google Sheets 연동)'
  });

  // 종료일 당일 오전 9시 알림
  event.addPopupReminder(9 * 60); // 9시간 전 = 당일 오전 (종일 이벤트 기준)

  return event;
}

// ============================================
// 전체 동기화 (매 시간 자동 실행 + 수동 가능)
// ============================================

/**
 * 모든 시트의 종료날짜를 스캔하여 캘린더와 동기화
 * - 매 시간 자동 실행 (API 변경 감지)
 * - 수동 실행 가능
 */
function syncAllEndDates() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();
  var syncCount = 0;
  var calendar = getOrCreateCalendar();

  // 현재 캘린더의 모든 이벤트를 가져와서 비교
  var existingEvents = {};
  var allEvents = calendar.getEvents(new Date(2024, 0, 1), new Date(2030, 11, 31));
  for (var i = 0; i < allEvents.length; i++) {
    var title = allEvents[i].getTitle();
    var eventDate = allEvents[i].getAllDayStartDate();
    if (eventDate) {
      existingEvents[title] = formatDate(eventDate);
    }
  }

  for (var s = 0; s < sheets.length; s++) {
    var sheet = sheets[s];
    var sheetName = sheet.getName();

    if (sheetName.indexOf(SHEET_PREFIX) !== 0) continue;

    var nameCol = findColumnByHeader(sheet, '이름');
    var endDateCol = findColumnByHeader(sheet, '종료날짜');
    var scheduleCol = findColumnByHeader(sheet, '요일 및 시간');

    if (nameCol === -1 || endDateCol === -1) continue;

    var lastRow = sheet.getLastRow();
    if (lastRow <= 2) continue;

    for (var row = 3; row <= lastRow; row++) {
      var name = String(sheet.getRange(row, nameCol).getValue()).trim();
      var endDateValue = String(sheet.getRange(row, endDateCol).getValue()).trim();

      if (!name || !endDateValue) continue;

      // 요일 및 시간이 비어있으면 종료된 수강생 → 무시
      if (scheduleCol !== -1) {
        var schedule = String(sheet.getRange(row, scheduleCol).getValue()).trim();
        if (!schedule) continue;
      }

      var endDate = parseDateStr(endDateValue);
      if (!endDate) continue;

      var eventTitle = '[' + name + '] 수강 종료';
      var endDateStr = formatDate(endDate);

      // 이미 동일한 날짜로 등록되어 있으면 스킵
      if (existingEvents[eventTitle] === endDateStr) continue;

      updateCalendarEvent(name, endDate);
      syncCount++;
    }
  }

  if (syncCount > 0) {
    Logger.log('동기화 완료: ' + syncCount + '건 업데이트');
  }
}

// ============================================
// 유틸리티 함수
// ============================================

/**
 * 헤더 이름으로 컬럼 번호 찾기 (1-based)
 * Row 2가 헤더 행
 */
function findColumnByHeader(sheet, headerName) {
  var lastCol = sheet.getLastColumn();
  if (lastCol === 0) return -1;

  var headers = sheet.getRange(2, 1, 1, lastCol).getValues()[0];

  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i]).replace(/\n/g, ' ').trim();
    if (h === headerName) return i + 1;
  }
  return -1;
}

/**
 * 날짜 문자열 파싱 (YYMMDD, YYYYMMDD, YYYY-MM-DD 지원)
 */
function parseDateStr(dateStr) {
  if (!dateStr) return null;
  dateStr = String(dateStr).trim();

  // YYMMDD (예: 260331)
  if (/^\d{6}$/.test(dateStr)) {
    var yy = parseInt(dateStr.substring(0, 2), 10);
    var mm = parseInt(dateStr.substring(2, 4), 10) - 1;
    var dd = parseInt(dateStr.substring(4, 6), 10);
    return new Date(2000 + yy, mm, dd);
  }

  // YYYYMMDD (예: 20260331)
  if (/^\d{8}$/.test(dateStr)) {
    var yyyy = parseInt(dateStr.substring(0, 4), 10);
    var mm2 = parseInt(dateStr.substring(4, 6), 10) - 1;
    var dd2 = parseInt(dateStr.substring(6, 8), 10);
    return new Date(yyyy, mm2, dd2);
  }

  // YYYY-MM-DD (예: 2026-03-31)
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    var parts = dateStr.split('-');
    return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  }

  return null;
}

/**
 * Date → YYYY-MM-DD 문자열
 */
function formatDate(date) {
  if (!date) return '';
  var y = date.getFullYear();
  var m = ('0' + (date.getMonth() + 1)).slice(-2);
  var d = ('0' + date.getDate()).slice(-2);
  return y + '-' + m + '-' + d;
}
