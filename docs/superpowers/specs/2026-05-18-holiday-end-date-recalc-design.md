# 휴일 변경 시 수강생 종료일 자동 증분 조정

작성일: 2026-05-18

## 1. 배경 / 문제

코치가 "휴일 설정" 기능(`HolidayManager`)으로 휴일을 추가/삭제해도, 현재는
Firebase `holidays` 컬렉션에만 저장될 뿐 **기존 수강생들의 종료일(Google
Sheets H열)이 자동으로 조정되지 않는다**. 종료일에 휴일이 반영되는 시점은
이후 해당 수강생에게 홀딩/결석/보강/시간표변경/신규등록 같은 별도 이벤트가
발생할 때뿐이다.

`HolidayManager.jsx:192`의 안내문("설정된 휴일은 수강생의 종료일 계산에 자동
반영됩니다")과 실제 동작이 불일치한다.

목표: 휴일을 추가하면 영향받는 수강생의 종료일이 즉시 뒤로 밀리고, 휴일을
삭제하면 다시 앞으로 당겨지도록 한다.

## 2. 핵심 결정 사항 (사용자 확정)

| 항목 | 결정 |
|---|---|
| 실행 시점 | 휴일 **추가·삭제 모두 자동** |
| 대상 범위 | **휴일이 속한 달 − 3개월 ~ 휴일이 속한 달** 시트 탭 |
| 계산 방식 | **증분(delta)** — 기존 H열을 그대로 두고 변경된 휴일만큼만 이동 |

증분 방식 선택 이유: 전체 재계산은 과거 결석(E열 텍스트)·보강 소진 휴일·홀딩
이력을 모두 정확히 재구성해야 하며, 재구성이 틀리면 **전체 수강생**의 종료일을
잘못 덮어쓴다. 증분 방식은 변경된 휴일만 보고 종료일을 ±이동하므로 기존
데이터 손상 위험이 없다.

## 3. 알고리즘

### 3.1 휴일 추가

방금 추가된 날짜 목록 `changedDates`만 처리한다. 각 수강생 행에 대해, 추가된
휴일 날짜 `d`가 다음을 **모두** 만족하면 "영향 1건"으로 카운트한다:

1. `d`의 요일이 수강생 수업 요일(D열 파싱 결과)에 포함
2. `시작일(G) ≤ d ≤ 현재 종료일(H)`
3. `d`가 홀딩 기간(M열 사용중 + N/O열) 안에 있지 않음
4. `d`가 E열 결석 기록(`YY.M.D 결석`)과 겹치지 않음
   - 재구성이 아니라 **확장에서 제외(보수적 스킵)** 용도로만 가볍게 파싱

한 수강생에 대해 `changedDates`의 여러 날짜가 동시에 조건을 만족하면 그
건수를 **합산하여 `N`**으로 보고 종료일을 **1회만** 이동한다(날짜별로 여러 번
이동하지 않음).

영향 건수 `N`만큼 **현재 종료일에서 앞으로** 유효 수업일 `N`일을 추가한 날짜가
새 종료일이다. 확장 스캔 시 비수업요일·전체 휴일(한국 공휴일 +
변경 반영된 전체 커스텀 휴일)·홀딩 기간은 건너뛴다.

### 3.2 휴일 삭제

3.1과 동일 조건이되 추가 조건: 삭제된 날짜가 **여전히 한국 공휴일이면
제외**한다(`isHolidayDate(d, []) === true`이면 휴일 상태 유지 → 변화 없음).

영향 건수 `N`만큼 **현재 종료일에서 뒤로(과거 방향)** 유효 수업일 `N`일만큼
당긴 날짜가 새 종료일이다.

### 3.3 미리 등록(다음 등록) 조정

종료일 변경 후, 같은 이름의 미리 등록 행이 같은 시트에 있으면 기존
`adjustNextRegistration(sheetName, rows, headers, nextRowIndex, currentEndDate, firebaseHolidays)`
를 재사용해 다음 등록의 시작일/종료일을 자동 조정한다.

## 4. 코드 구조

### 4.1 `src/services/googleSheetsService.js` — 신규 export 함수

```js
export const applyHolidayDeltaToEndDates = async ({
  changedDates,        // ['2026-06-15', ...] 방금 추가/삭제된 날짜 (YYYY-MM-DD)
  mode,                // 'add' | 'delete'
  firebaseHolidays     // 변경이 반영된 전체 커스텀 휴일 목록 (확장/축소 스캔용)
}) => {
  // 반환: { affectedStudents: number, perSheet: {…}, errors: [...] }
}
```

동작:

- `changedDates` 중 가장 이른 날짜의 (연,월) 기준으로 `월 − 3개월 ~ 그 달`
  범위의 시트 이름 목록 생성. `getAllSheetNames()`로 실제 존재하는 탭만 필터.
- 시트별로 1회 `readSheetData` → 모든 행에 대해 §3 알고리즘으로 새 H열 값
  (및 미리등록 시작/종료) 계산.
- 시트별 변경분을 **한 번의 `batchUpdateSheet`** + **한 번의
  `highlightCells`** 로 묶어 호출 (API 호출/쿼터 최소화).

### 4.2 내부 헬퍼

```js
function shiftEndDateBySessions(endDate, deltaSessions, classDays,
                                holdingRanges, firebaseHolidays) {
  // deltaSessions > 0 → 앞(미래)으로, < 0 → 뒤(과거)로 유효 수업일 이동
  // 비수업요일 / isHolidayDate / 홀딩기간 건너뜀, 최대 365회 가드
}
```

기존 모듈 헬퍼 재사용: `getClassDays`, `parseSheetDate`, `isHolidayDate`,
`formatDateToYYMMDD`, `findColumnIndex`, `buildStudentObject`,
`getStudentField`, `parseHoldingStatus`, `adjustNextRegistration`,
`findAllStudentRowIndices`.

### 4.3 `src/components/HolidayManager.jsx` — 연결

- import에 `applyHolidayDeltaToEndDates` 추가.
- `handleSubmit`: `createHoliday` 루프 종료 후 → `getHolidays()`로 갱신
  목록 확보 → `applyHolidayDeltaToEndDates({ changedDates: selectedDates,
  mode: 'add', firebaseHolidays })` 호출 → 결과를 alert 메시지에 포함
  (예: `"3일 휴일 설정 완료. 수강생 12명 종료일이 연장되었습니다."`).
- `handleDeleteHoliday`: `deleteHoliday` 후 → 삭제 반영된 `getHolidays()` →
  `applyHolidayDeltaToEndDates({ changedDates: [삭제된 날짜], mode: 'delete',
  firebaseHolidays })`.
- 재계산 진행 중 `isSubmitting` 버튼 문구를 "종료일 반영 중..."으로 표시.
- 종료일 조정이 실패해도 휴일 추가/삭제 데이터 자체는 롤백하지 않고, 에러는
  alert로 경고만 한다(`errors` 요약 포함).

## 5. 엣지케이스

| 상황 | 처리 |
|---|---|
| 휴일이 수강생 종료일 이후 | 영향 없음 (이미 종료) |
| 휴일이 시작일 이전 | 영향 없음 |
| 휴일이 비수업 요일 | 영향 없음 |
| 휴일이 홀딩 기간 내 | 영향 없음 (이미 미출석) |
| 휴일 = 결석일(E열) | 확장에서 제외 (중복 연장 방지) |
| 삭제 날짜가 한국 공휴일이기도 함 | 변화 없음 (여전히 휴일) |
| 같은 이름 미리등록 존재 | `adjustNextRegistration`으로 다음 등록 자동 조정 |
| 여러 날짜 동시 추가 | 그 날짜들만 처리(기존 휴일 재처리 안 함 → 중복 카운트 방지) |
| 행 데이터 불완전(시작일/스케줄/종료일 없음) | 해당 행 건너뜀, `errors`에 기록 |
| 휴일 추가 후 다른 이벤트로 전체 재계산 발생 | 안전 — `calculateEndDate`는 처음부터 재계산하므로 delta가 이중 반영되지 않음 |

## 6. 데이터 무결성 / 안전장치

- delta는 변경된 휴일만 카운트하므로 기존 결석/보강/홀딩 이력을 재파싱하지
  않음 → 기존 H열 손상 위험 없음.
- `시작일 ≤ d ≤ 현재 종료일` 필터로 영향 없는 수강생은 H열 미변경.
- 시트별 batch write 1회 + highlight 1회로 부분 실패 표면 축소.
- `shiftEndDateBySessions` 365회 반복 가드(무한 루프 방지).

## 7. 작업 브랜치

메모리의 git 워크플로(`feedback_git_workflow`)에 따라 `main` 최신화 후 새
브랜치 `feat/holiday-end-date-recalc`에서 작업한다. 현재 워킹트리의 무관한
로컬 변경(.env, package-lock.json, .netlify/ 등)은 건드리지 않는다.

## 8. 범위 밖 (YAGNI)

- 전체 idempotent 재계산 모드 (의도적으로 제외 — 위험/복잡)
- 휴일 변경 이력/감사 로그
- 영향받은 수강생에게 SMS 통지
- 코치가 재계산 미리보기로 확인 후 적용하는 UI (자동 적용으로 결정됨)
