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

    syncStudentEvents(studentName);
    Logger.log('캘린더 업데이트: ' + studentName);

  } catch (error) {
    Logger.log('onSheetEdit 오류: ' + error.message);
  }
}

// ============================================
// 시트 읽기 (일괄)
// ============================================

/**
 * 모든 등록생 시트에서 (이름, 종료일) 쌍을 수집한다.
 *
 * ⚠️ 셀을 하나씩 getRange().getValue()로 읽지 말 것.
 * 예전엔 시트 15개 × 행 706개 × 칸 3개 = 개별 읽기 2,118회였고, 1회 실행이
 * 176~360초까지 늘어 결국 Apps Script 6분 제한(360초)에 걸려 매시간 죽었다.
 * 2026-09-01에 5회 연속 시간 초과로 시트 변경이 캘린더에 반영되지 않았다.
 * 시트당 getDataRange().getValues() 1회면 읽기 15회로 끝난다.
 *
 * @param {Function} onRow  (이름, 종료일Date) 콜백
 */
function forEachEndDate(onRow) {
  var sheets = SpreadsheetApp.getActiveSpreadsheet().getSheets();

  for (var s = 0; s < sheets.length; s++) {
    var sheet = sheets[s];
    if (sheet.getName().indexOf(SHEET_PREFIX) !== 0) continue;

    var values = sheet.getDataRange().getValues(); // ← 시트 전체를 1회에
    if (values.length <= 2) continue;

    // Row 2(인덱스 1)가 헤더
    var headers = values[1];
    var nameCol = -1, endDateCol = -1, scheduleCol = -1;
    for (var c = 0; c < headers.length; c++) {
      var h = String(headers[c]).replace(/\n/g, ' ').trim();
      if (h === '이름') nameCol = c;
      else if (h === '종료날짜') endDateCol = c;
      else if (h === '요일 및 시간') scheduleCol = c;
    }
    if (nameCol === -1 || endDateCol === -1) continue;

    for (var r = 2; r < values.length; r++) { // Row 3(인덱스 2)부터 데이터
      var name = String(values[r][nameCol]).trim();
      var endRaw = String(values[r][endDateCol]).trim();
      if (!name || !endRaw) continue;

      // 요일 및 시간이 비어있으면 종료된 수강생 → 무시
      if (scheduleCol !== -1 && !String(values[r][scheduleCol]).trim()) continue;

      var endDate = parseDateStr(endRaw);
      if (!endDate) continue;

      onRow(name, endDate);
    }
  }
}

/**
 * 특정 수강생의 캘린더 이벤트를 전부 삭제 후, 모든 시트의 현재 종료일로 다시 생성
 */
function syncStudentEvents(studentName) {
  var calendar = getOrCreateCalendar();
  var eventTitle = '[' + studentName + '] 수강 종료';

  // 1. 이 수강생의 기존 이벤트 모두 삭제
  var events = calendar.getEvents(new Date(2024, 0, 1), new Date(2030, 11, 31), { search: studentName });
  for (var i = 0; i < events.length; i++) {
    if (events[i].getTitle() === eventTitle) {
      events[i].deleteEvent();
    }
  }

  // 2. 모든 시트에서 이 수강생의 현재 종료일을 찾아 이벤트 재생성
  forEachEndDate(function (name, endDate) {
    if (name !== studentName) return;
    ensureCalendarEvent(studentName, endDate);
  });
}

/**
 * 해당 이름+날짜 조합의 이벤트가 없으면 생성
 * (같은 날짜에 이미 있으면 중복 생성하지 않음)
 */
function ensureCalendarEvent(studentName, endDate) {
  var calendar = getOrCreateCalendar();
  var eventTitle = '[' + studentName + '] 수강 종료';

  // 해당 날짜에 같은 제목의 이벤트가 이미 있는지 확인
  var dayStart = new Date(endDate);
  dayStart.setHours(0, 0, 0, 0);
  var dayEnd = new Date(endDate);
  dayEnd.setDate(dayEnd.getDate() + 1);

  var events = calendar.getEvents(dayStart, dayEnd, { search: studentName });
  for (var i = 0; i < events.length; i++) {
    if (events[i].getTitle() === eventTitle) {
      return events[i]; // 이미 존재하므로 스킵
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
 * - 이름+날짜 조합 기준으로 이벤트 관리
 * - 같은 사람이 여러 시트에 있으면 종료일별로 각각 이벤트 생성
 * - 시트에서 삭제된 이벤트는 자동 정리
 */
function syncAllEndDates() {
  var startedAt = new Date().getTime();
  var syncCount = 0;
  var calendar = getOrCreateCalendar();

  // 1. 모든 시트에서 필요한 (이름, 종료날짜) 쌍 수집 (시트당 1회 읽기)
  var desiredEvents = {}; // 키: "이름|YYYY-MM-DD"

  forEachEndDate(function (name, endDate) {
    desiredEvents[name + '|' + formatDate(endDate)] = { name: name, endDate: endDate };
  });

  // 2. 현재 캘린더 이벤트를 (이름, 날짜) 기준으로 맵핑
  var allEvents = calendar.getEvents(new Date(2024, 0, 1), new Date(2030, 11, 31));
  var existingKeys = {}; // 키: "이름|YYYY-MM-DD" → [이벤트 객체들]

  for (var i = 0; i < allEvents.length; i++) {
    var title = allEvents[i].getTitle();
    // "[이름] 수강 종료" 패턴만 처리
    var match = title.match(/^\[(.+)\] 수강 종료$/);
    if (!match) continue;

    var eventName = match[1];
    var eventDate = allEvents[i].getAllDayStartDate();
    if (!eventDate) continue;

    var eventKey = eventName + '|' + formatDate(eventDate);
    if (!existingKeys[eventKey]) {
      existingKeys[eventKey] = [];
    }
    existingKeys[eventKey].push(allEvents[i]);
  }

  // 3. 필요한데 없는 이벤트 생성
  for (var key in desiredEvents) {
    if (!existingKeys[key]) {
      var d = desiredEvents[key];
      ensureCalendarEvent(d.name, d.endDate);
      syncCount++;
    }
  }

  // 4. 시트에 없는 고아 이벤트 삭제
  var deleteCount = 0;
  for (var key in existingKeys) {
    if (!desiredEvents[key]) {
      var orphans = existingKeys[key];
      for (var j = 0; j < orphans.length; j++) {
        orphans[j].deleteEvent();
        deleteCount++;
      }
    }
  }

  // 실행시간을 항상 남긴다 — 6분(360초) 제한에 다시 다가가는지 이 줄로 판단한다.
  var elapsed = ((new Date().getTime() - startedAt) / 1000).toFixed(1);
  Logger.log('동기화 완료: ' + syncCount + '건 생성, ' + deleteCount + '건 삭제, ' +
             Object.keys(desiredEvents).length + '건 대조, ' + elapsed + '초');
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
 * 기존 캘린더 이벤트 전체 삭제 후 재동기화
 * 최초 1회 수동 실행 권장
 */
function resetAndSync() {
  var calendar = getOrCreateCalendar();
  var allEvents = calendar.getEvents(new Date(2024, 0, 1), new Date(2030, 11, 31));
  var deleteCount = 0;

  for (var i = 0; i < allEvents.length; i++) {
    var title = allEvents[i].getTitle();
    if (title.indexOf('] 수강 종료') !== -1) {
      allEvents[i].deleteEvent();
      deleteCount++;
    }
  }

  Logger.log('기존 이벤트 ' + deleteCount + '건 삭제 완료');
  Logger.log('재동기화 시작...');
  syncAllEndDates();
  Logger.log('완료!');
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
