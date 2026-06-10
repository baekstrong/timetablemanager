# 신규 수강생 자동 문자 발송 상황판

작성일: 2026-06-10

## 목표

신규(`CoachNewStudents`) 페이지에서 각 신규 수강생에게 **어떤 자동 문자가 나갔는지/실패했는지/누락됐는지** 한눈에 보고, 실패·누락 건을 바로 **재발송**할 수 있는 상황판을 만든다.

## 배경 (현황)

- 신규 수강생 대상 자동 문자 3종(추적 대상):
  1. **접수확인** — `sendRegistrationNotifications()` 내부의 학생 문자. 등록 위자드 제출 시 발송 (`NewStudentRegistration.jsx:276`, 문서 생성 `createNewStudentRegistration` 직후)
  2. **승인문자** — `sendApprovalNotifications()`의 `approvalSMS`. 코치 승인 시 발송 (`CoachNewStudents.jsx`)
  3. **입학반 리마인더(예약)** — `sendApprovalNotifications()`의 `reminderSMS`(예약, `groupId` 반환). 승인 시 예약
- (코치 접수알림은 코치 본인 수신이므로 **추적 제외**)
- **현재 발송 결과는 영구 저장되지 않음.** 함수가 `true/false`만 반환. `reminderGroupId`만 등록 문서에 저장 중.
- 등록 데이터: Firestore `newStudentRegistrations` (`createNewStudentRegistration`, `getNewStudentRegistrations`, `updateNewStudentRegistration`).

## 결정 사항

| 항목 | 결정 |
|---|---|
| 기능 범위 | 상태 표시 + 재발송 |
| 추적 문자 | 수강생 대상 3종(접수확인·승인·리마인더) |
| 저장 방식 | **A: 등록 문서에 `smsLog` 필드 임베드** |
| 위치 | `CoachNewStudents` 페이지 내 상황판 패널 |
| 소급 | 과거 발송분은 로그 없음 → "미발송"으로 표시(소급 불가). 앞으로 발송분부터 정확 |

## 데이터 모델

`newStudentRegistrations/{id}` 문서에 `smsLog` 필드 추가:

```js
smsLog: {
  reception: { status: 'sent' | 'failed', at: <ms>, error?: string },
  approval:  { status: 'sent' | 'failed', at: <ms>, error?: string },
  reminder:  { status: 'scheduled' | 'failed', at: <ms>, scheduledFor?: <ms>, groupId?: string, error?: string },
}
```

- 필드가 없으면(키 부재) → UI에서 **"미발송(⚪)"**으로 표시.
- 재발송 시 해당 키를 덮어씀(최신 1건만 보관 — 이력 누적은 범위 외).
- 기존 `reminderGroupId`는 `smsLog.reminder.groupId`로 통합(취소 로직은 둘 다 읽도록 하위호환 유지).

## 동작 흐름

### ① 발송 시점 로그 기록

- **접수확인**: `NewStudentRegistration.jsx`에서 `createNewStudentRegistration`이 반환한 문서 id로, `sendRegistrationNotifications` 결과(`studentSMS` 성공 여부)를 `updateNewStudentRegistration(id, { 'smsLog.reception': {...} })`로 기록.
- **승인문자 / 리마인더**: `CoachNewStudents.jsx` 승인 핸들러에서 `sendApprovalNotifications` 결과로 `smsLog.approval`, `smsLog.reminder` 기록(기존 `reminderGroupId` 저장 코드와 통합).

### ② 상황판 UI (CoachNewStudents 내 패널)

- 신규 수강생 목록 각 항목(또는 전용 표)에서 문자 3종 상태칩 표시:
  - `sent` → ✅ 초록칩 "나감"
  - `scheduled` → ⏳ 코발트칩 "예약됨" (리마인더 전용)
  - `failed` → ❌ 빨강칩 "실패"
  - 키 없음 → ⚪ 회색칩 "미발송"
- 디자인 토큰 준수(플랫, 상태칩 `{색}1A` 배경 + 진한 텍스트, 코발트 액센트).
- **누락 강조**: 패널 상단에 요약 줄("⚠ 누락/실패 N건") 표시 + 해당 수강생 행에 강조 테두리/배지. (정렬 변경 없이 행 강조로 처리 — 목록 순서 유지)

### ③ 재발송

- 각 상태칩 옆(또는 실패/미발송 시) **[재발송]** 버튼:
  - 접수확인 → `sendStudentRegistrationSMS()` 재호출 → `smsLog.reception` 갱신
  - 승인문자 → 승인문자 전용 발송 재호출 → `smsLog.approval` 갱신
  - 리마인더 → 입학반 날짜가 **미래면** 재예약(`sendApprovalNotifications`의 리마인더 부분 또는 전용 함수) 후 `smsLog.reminder` 갱신, **지났으면 버튼 비활성**("기간 지남")
- 재발송 전 확인 다이얼로그, 결과 alert.

## 컴포넌트/파일 영향

- `src/services/firebaseService.js` — `smsLog` 부분 업데이트 헬퍼(또는 기존 `updateNewStudentRegistration` 재사용, dot-path 머지).
- `src/services/smsService.js` — `sendRegistrationNotifications`/`sendApprovalNotifications` 반환값에 종류별 성공 여부가 명확히 담기는지 확인(필요 시 보강). 재발송용 단건 함수 노출(이미 `sendStudentRegistrationSMS` 등 존재).
- `src/components/NewStudentRegistration.jsx` — 제출 후 `smsLog.reception` 기록.
- `src/components/CoachNewStudents.jsx` — 승인 시 `smsLog.approval`/`reminder` 기록 + **상황판 패널** 렌더 + 재발송 핸들러.
- (UI가 커지면) `src/components/SmsStatusBoard.jsx` 분리 고려.

## 엣지 케이스

- 연락처 없음 → 발송 자체 불가, 칩에 "연락처 없음" 표시·재발송 비활성.
- 대기(waitlist) 등록 → 접수확인은 대기용 문구. 승인/리마인더는 대기→승인 전환 후에만. 상황판은 상태에 맞게.
- 리마인더 재예약: 입학반 날짜 지남 → 비활성.
- SMS 설정 미구성(`settings.isConfigured=false`) → 발송 실패로 기록, 패널 상단에 "SMS 미설정" 경고.

## 범위 외 (YAGNI)

- 재시도 이력 누적(최신 1건만 보관).
- 코치 접수알림 추적.
- 일반 수강생(비신규) 문자 추적.
- Solapi 실제 도달(수신확인) 상태 폴링 — 발송 성공/실패까지만.

## 검증

- 단위: `smsLog` 머지 헬퍼, 상태칩 매핑 로직(status→칩) 테스트.
- 수동: 신규 등록→접수확인 로그 확인 / 승인→승인·리마인더 로그 확인 / 실패 모의(설정 미구성)→❌ 표시·재발송 동작.
- `npm run build` / `npm run lint` / `npm run test` 통과.
