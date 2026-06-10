# 신규 수강생 자동 문자 발송 상황판 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 신규 페이지에서 수강생별 자동 문자 3종(접수확인·승인·리마인더)의 발송 상태를 보고 실패·누락 건을 재발송할 수 있는 상황판을 만든다.

**Architecture:** 발송 결과를 `newStudentRegistrations/{id}.smsLog`에 기록(발송 시점 + 재발송 시 dot-path 머지 업데이트)하고, 순수 매핑 유틸(`smsStatus.js`)로 상태→칩 변환·누락 집계를 한 뒤, `CoachNewStudents` 내 상황판 패널에서 칩과 재발송 버튼을 렌더한다.

**Tech Stack:** React 19, Firebase Firestore, Vitest, 기존 `smsService.js` 발송 함수 재사용

**참고 스펙:** `docs/superpowers/specs/2026-06-10-new-student-sms-status-board-design.md`

---

## 확인된 기존 코드 사실 (이 시그니처에 의존)

- `createNewStudentRegistration(data, status)` → `{ success, id }` 반환 (firebaseService.js:612)
- `updateNewStudentRegistration(id, fields)` → `updateDoc` 사용 → **dot-path 키(`'smsLog.reception'`) 머지 지원** (firebaseService.js:654, updateDocStatus:75)
- `sendRegistrationNotifications(phone, name, details)` → `{ studentSMS: bool, coachSMS: bool }` (smsService.js:425)
- `sendApprovalNotifications(...)` → `{ approvalSMS: bool, reminderSMS: <{groupId}|false> }` (smsService.js:510)
- 단건 함수(재발송용, 모두 export됨): `sendStudentRegistrationSMS(phone, name, isWaitlist)`:162, `sendStudentApprovalSMS(phone, name, details)`:254, `scheduleEntranceReminderSMS(phone, name, details)`:342
- 승인 핸들러: `CoachNewStudents.jsx:374~408` (현재 `reminderGroupId`만 저장 `:395`)
- 접수 발송: `NewStudentRegistration.jsx:271~294`
- 등록 목록 렌더 시작: `CoachNewStudents.jsx:984`
- 테스트 패턴: 소스 옆 `*.test.js` (vitest), 예 `src/utils/makeupQuota.test.js`

## smsLog 데이터 형태 (이 구조로 통일)

```js
smsLog: {
  reception: { status: 'sent'|'failed', at: <ms> },
  approval:  { status: 'sent'|'failed', at: <ms> },
  reminder:  { status: 'scheduled'|'failed', at: <ms>, groupId?: string },
}
```
키 부재 = 미발송. 재발송 시 해당 키 덮어씀.

---

## Task 1: SMS 상태 매핑 유틸 (순수 로직, TDD)

**Files:**
- Create: `src/utils/smsStatus.js`
- Test: `src/utils/smsStatus.test.js`

- [ ] **Step 1: 실패 테스트 작성**

`src/utils/smsStatus.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { SMS_TYPES, smsChip, isReminderExpected, smsIssueCount, isReminderResendable } from './smsStatus';

describe('smsChip', () => {
  it('엔트리 없으면 미발송', () => {
    expect(smsChip(undefined)).toEqual({ kind: 'none', label: '미발송' });
  });
  it('sent → 나감', () => {
    expect(smsChip({ status: 'sent', at: 1 })).toEqual({ kind: 'sent', label: '나감' });
  });
  it('scheduled → 예약됨', () => {
    expect(smsChip({ status: 'scheduled', at: 1 })).toEqual({ kind: 'scheduled', label: '예약됨' });
  });
  it('failed → 실패', () => {
    expect(smsChip({ status: 'failed', at: 1 })).toEqual({ kind: 'failed', label: '실패' });
  });
});

describe('isReminderExpected', () => {
  it('입학반 정보 있으면 기대됨', () => {
    expect(isReminderExpected({ entranceClassDate: '6월 14일', entranceDate: '2026-06-14' })).toBe(true);
  });
  it('입학반 정보 없으면 기대 안 함', () => {
    expect(isReminderExpected({})).toBe(false);
  });
});

describe('smsIssueCount', () => {
  it('pending: 접수확인 누락만 카운트', () => {
    expect(smsIssueCount({ status: 'pending', smsLog: {} })).toBe(1);
    expect(smsIssueCount({ status: 'pending', smsLog: { reception: { status: 'sent', at: 1 } } })).toBe(0);
  });
  it('approved + 입학반: 접수/승인/리마인더 누락·실패 카운트', () => {
    const reg = { status: 'approved', entranceClassDate: 'x', entranceDate: '2026-06-14', smsLog: { reception: { status: 'sent', at: 1 }, approval: { status: 'failed', at: 1 } } };
    expect(smsIssueCount(reg)).toBe(2); // approval failed + reminder 미발송
  });
  it('approved + 입학반 없음: 리마인더는 카운트 제외', () => {
    const reg = { status: 'approved', smsLog: { reception: { status: 'sent', at: 1 }, approval: { status: 'sent', at: 1 } } };
    expect(smsIssueCount(reg)).toBe(0);
  });
});

describe('isReminderResendable', () => {
  it('미래 입학반 날짜면 재발송 가능', () => {
    expect(isReminderResendable({ entranceDate: '2999-01-01' })).toBe(true);
  });
  it('과거 입학반 날짜면 불가', () => {
    expect(isReminderResendable({ entranceDate: '2000-01-01' })).toBe(false);
  });
  it('날짜 없으면 불가', () => {
    expect(isReminderResendable({})).toBe(false);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/utils/smsStatus.test.js`
Expected: FAIL (`smsStatus` 모듈 없음)

- [ ] **Step 3: 구현 작성**

`src/utils/smsStatus.js`:
```js
// 신규 수강생 자동 문자 상황판: 상태 매핑/집계 순수 로직

export const SMS_TYPES = [
  { key: 'reception', label: '접수확인' },
  { key: 'approval', label: '승인문자' },
  { key: 'reminder', label: '입학반 리마인더' },
];

// 로그 엔트리 → 칩 표시 {kind, label}
export function smsChip(entry) {
  if (entry && entry.status === 'sent') return { kind: 'sent', label: '나감' };
  if (entry && entry.status === 'scheduled') return { kind: 'scheduled', label: '예약됨' };
  if (entry && entry.status === 'failed') return { kind: 'failed', label: '실패' };
  return { kind: 'none', label: '미발송' };
}

// 입학반 리마인더가 기대되는 등록인지 (입학반 정보 있을 때만)
export function isReminderExpected(reg) {
  return Boolean(reg && reg.entranceClassDate && reg.entranceDate);
}

// 입학반 날짜가 미래라 리마인더 재예약이 가능한지
export function isReminderResendable(reg) {
  if (!reg || !reg.entranceDate) return false;
  const t = new Date(reg.entranceDate).getTime();
  if (Number.isNaN(t)) return false;
  return t > Date.now();
}

// 등록 건의 누락/실패 문자 개수 (수강생 3종 기준; 승인/리마인더는 해당될 때만)
export function smsIssueCount(reg) {
  const log = (reg && reg.smsLog) || {};
  let issues = 0;
  const bad = (e) => !e || e.status === 'failed';
  if (bad(log.reception)) issues++;
  if (reg && reg.status === 'approved') {
    if (bad(log.approval)) issues++;
    if (isReminderExpected(reg) && bad(log.reminder)) issues++;
  }
  return issues;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/utils/smsStatus.test.js`
Expected: PASS (전체 통과)

- [ ] **Step 5: 커밋**

```bash
git add src/utils/smsStatus.js src/utils/smsStatus.test.js
git commit -m "feat(sms-board): SMS 상태 매핑/집계 순수 유틸 추가

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: 접수확인 발송 결과 기록 (등록 위자드)

**Files:**
- Modify: `src/components/NewStudentRegistration.jsx:3` (import), `:271~294` (제출 흐름)

- [ ] **Step 1: import에 updateNewStudentRegistration 추가**

`:3`의 import 구문에 `updateNewStudentRegistration` 추가:
```js
import { getDisabledClasses, createNewStudentRegistration, updateNewStudentRegistration, getEntranceClasses, getFAQs, getNewStudentRegistrations } from '../services/firebaseService';
```

- [ ] **Step 2: 생성 결과 id 캡처 + 접수 로그 기록**

`:271` 줄
```js
            await createNewStudentRegistration(data, isWaitlistMode ? 'waitlist' : 'pending');
```
을 아래로 교체:
```js
            const created = await createNewStudentRegistration(data, isWaitlistMode ? 'waitlist' : 'pending');
            const regId = created?.id;
```
그리고 `:288~293`의 `sendRegistrationNotifications` 결과 처리부에서, `if (!smsResults.studentSMS || !smsResults.coachSMS)` 블록 **직전에** 접수 로그 기록 추가:
```js
                if (regId) {
                    await updateNewStudentRegistration(regId, {
                        'smsLog.reception': {
                            status: smsResults.studentSMS ? 'sent' : 'failed',
                            at: Date.now(),
                        },
                    });
                }
```

- [ ] **Step 3: 빌드 확인**

Run: `npm run build`
Expected: `✓ built` 성공

- [ ] **Step 4: 커밋**

```bash
git add src/components/NewStudentRegistration.jsx
git commit -m "feat(sms-board): 신규 등록 시 접수확인 문자 발송 결과를 smsLog.reception에 기록

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: 승인·리마인더 발송 결과 기록 (승인 핸들러)

**Files:**
- Modify: `src/components/CoachNewStudents.jsx:388~397` (승인 SMS 결과 처리)

- [ ] **Step 1: 승인/리마인더 로그 기록으로 교체**

`:388~397` 블록
```js
                    if (smsResults.approvalSMS) sent.push('승인 문자');
                    else failed.push('승인 문자');
                    if (smsResults.reminderSMS) {
                        sent.push('입학반 리마인더');
                        // 예약 SMS groupId 저장 (취소용)
                        const groupId = smsResults.reminderSMS?.groupId;
                        if (groupId) {
                            await updateNewStudentRegistration(reg.id, { reminderGroupId: groupId });
                        }
                    }
```
을 아래로 교체:
```js
                    if (smsResults.approvalSMS) sent.push('승인 문자');
                    else failed.push('승인 문자');

                    const groupId = smsResults.reminderSMS?.groupId;
                    const smsLogUpdate = {
                        'smsLog.approval': {
                            status: smsResults.approvalSMS ? 'sent' : 'failed',
                            at: Date.now(),
                        },
                    };
                    if (smsResults.reminderSMS) {
                        sent.push('입학반 리마인더');
                        smsLogUpdate['smsLog.reminder'] = {
                            status: 'scheduled',
                            at: Date.now(),
                            ...(groupId ? { groupId } : {}),
                        };
                        // 예약 SMS groupId 저장 (취소용, 기존 필드 하위호환 유지)
                        if (groupId) smsLogUpdate.reminderGroupId = groupId;
                    } else if (reg.entranceDate && reg.entranceClassDate) {
                        // 리마인더가 기대됐는데 예약 실패
                        smsLogUpdate['smsLog.reminder'] = { status: 'failed', at: Date.now() };
                    }
                    await updateNewStudentRegistration(reg.id, smsLogUpdate);
```

- [ ] **Step 2: 빌드 확인**

Run: `npm run build`
Expected: `✓ built` 성공

- [ ] **Step 3: 커밋**

```bash
git add src/components/CoachNewStudents.jsx
git commit -m "feat(sms-board): 승인 시 승인문자·리마인더 발송 결과를 smsLog에 기록(reminderGroupId 통합)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: 상태 칩 컴포넌트

**Files:**
- Create: `src/components/SmsStatusChips.jsx`

- [ ] **Step 1: 컴포넌트 작성**

`src/components/SmsStatusChips.jsx`:
```jsx
import { SMS_TYPES, smsChip, isReminderExpected } from '../utils/smsStatus';

// 칩 종류별 색 (플랫 코발트 디자인 — 가독성 강화 톤)
const CHIP_STYLE = {
    sent:      { background: '#C9E8D2', color: '#166534' },
    scheduled: { background: '#C9E3F8', color: '#1f6699' },
    failed:    { background: '#F8D2D5', color: '#991b1b' },
    none:      { background: '#E8E9EC', color: '#6b6e73' },
};

const ICON = { sent: '✅', scheduled: '⏳', failed: '❌', none: '⚪' };

/**
 * 신규 수강생 한 명의 SMS 3종 상태 칩 + (있으면) 재발송 버튼.
 * @param {object} reg - newStudentRegistrations 문서
 * @param {(reg, typeKey) => void} onResend - 재발송 핸들러 (실패/미발송 시 노출). 비활성이면 disabled 사유 문자열 반환 가능
 * @param {(reg, typeKey) => string|null} resendDisabledReason - null이면 활성, 문자열이면 비활성+사유
 */
export default function SmsStatusChips({ reg, onResend, resendDisabledReason }) {
    const log = reg.smsLog || {};
    return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
            {SMS_TYPES.map(({ key, label }) => {
                // 리마인더가 애초에 기대되지 않으면 표시 생략
                if (key === 'reminder' && !isReminderExpected(reg)) return null;
                // 승인/리마인더는 승인 전이면 '대상 아님'으로 흐리게
                const notYet = (key === 'approval' || key === 'reminder') && reg.status !== 'approved';
                const chip = smsChip(log[key]);
                const showResend = !notYet && (chip.kind === 'failed' || chip.kind === 'none');
                const disabledReason = showResend && resendDisabledReason ? resendDisabledReason(reg, key) : null;
                return (
                    <span key={key} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', opacity: notYet ? 0.4 : 1 }}>
                        <span style={{
                            fontSize: '0.72rem', fontWeight: 600, padding: '2px 8px',
                            borderRadius: 'var(--r-chip)',
                            ...CHIP_STYLE[notYet ? 'none' : chip.kind],
                        }}>
                            {ICON[notYet ? 'none' : chip.kind]} {label}: {notYet ? '대기' : chip.label}
                        </span>
                        {showResend && (
                            <button
                                onClick={() => !disabledReason && onResend(reg, key)}
                                disabled={Boolean(disabledReason)}
                                title={disabledReason || '재발송'}
                                style={{
                                    fontSize: '0.7rem', padding: '2px 8px', cursor: disabledReason ? 'not-allowed' : 'pointer',
                                    borderRadius: 'var(--r-chip)', border: '1px solid var(--accent-30)',
                                    background: disabledReason ? 'var(--canvas-tint)' : 'var(--accent-10)',
                                    color: disabledReason ? 'var(--text-muted)' : 'var(--accent-hover)',
                                }}
                            >
                                {disabledReason ? '기간 지남' : '재발송'}
                            </button>
                        )}
                    </span>
                );
            })}
        </div>
    );
}
```

- [ ] **Step 2: 빌드 확인**

Run: `npm run build`
Expected: `✓ built` 성공

- [ ] **Step 3: 커밋**

```bash
git add src/components/SmsStatusChips.jsx
git commit -m "feat(sms-board): SMS 상태 칩 컴포넌트 추가

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: 상황판 패널 + 재발송 (CoachNewStudents)

**Files:**
- Modify: `src/components/CoachNewStudents.jsx` (import 추가, 재발송 핸들러, 패널 렌더)

- [ ] **Step 1: import 추가**

기존 smsService import(`:28`)에 단건 함수 추가, 그리고 새 모듈 import:
```js
import { sendApprovalNotifications, sendWaitlistAvailableSMS, cancelScheduledSMS, sendWaitlistCancelledSMS, sendStudentRegistrationSMS, sendStudentApprovalSMS, scheduleEntranceReminderSMS } from '../services/smsService';
import SmsStatusChips from './SmsStatusChips';
import { smsIssueCount, isReminderResendable } from '../utils/smsStatus';
```

- [ ] **Step 2: 재발송 핸들러 추가**

컴포넌트 함수 본문(다른 핸들러들 근처, 예: `handleSendWaitlistSMS` 정의 부근)에 추가:
```js
    // 상황판: 문자 종류별 재발송
    const handleResendSms = async (reg, typeKey) => {
        if (!reg.phone) { alert('연락처가 없어 문자를 보낼 수 없습니다.'); return; }
        const labelMap = { reception: '접수확인', approval: '승인문자', reminder: '입학반 리마인더' };
        if (!confirm(`"${reg.name}" 수강생에게 [${labelMap[typeKey]}] 문자를 재발송할까요?`)) return;
        try {
            const details = {
                paymentMethod: reg.paymentMethod,
                weeklyFrequency: reg.weeklyFrequency,
                scheduleString: reg.scheduleString || '',
                entranceDate: reg.entranceDate,
                entranceClassDate: reg.entranceClassDate,
            };
            if (typeKey === 'reception') {
                const ok = await sendStudentRegistrationSMS(reg.phone, reg.name, reg.isWaitlist);
                await updateNewStudentRegistration(reg.id, { 'smsLog.reception': { status: ok ? 'sent' : 'failed', at: Date.now() } });
            } else if (typeKey === 'approval') {
                const ok = await sendStudentApprovalSMS(reg.phone, reg.name, details);
                await updateNewStudentRegistration(reg.id, { 'smsLog.approval': { status: ok ? 'sent' : 'failed', at: Date.now() } });
            } else if (typeKey === 'reminder') {
                const res = await scheduleEntranceReminderSMS(reg.phone, reg.name, details);
                const groupId = res?.groupId;
                await updateNewStudentRegistration(reg.id, {
                    'smsLog.reminder': { status: res ? 'scheduled' : 'failed', at: Date.now(), ...(groupId ? { groupId } : {}) },
                    ...(groupId ? { reminderGroupId: groupId } : {}),
                });
            }
            alert('재발송 처리되었습니다.');
            await loadRegistrations(); // 확인됨: 목록 로드 함수 (CoachNewStudents.jsx:130)
        } catch (err) {
            alert('재발송 실패: ' + (err?.message || err));
        }
    };

    // 리마인더 재발송 비활성 사유 (입학반 날짜 지남)
    const resendDisabledReason = (reg, typeKey) => {
        if (typeKey === 'reminder' && !isReminderResendable(reg)) return '입학반 날짜가 지나 재예약할 수 없습니다.';
        return null;
    };
```
확인됨: 목록 state는 `registrations`/`setRegistrations`(:42), 로드 함수는 `loadRegistrations()`(:130)이며 다른 핸들러(:413,426,522…)에서도 동일하게 호출 중. 그대로 사용.

- [ ] **Step 3: 상황판 패널 렌더 추가**

등록 목록 렌더(`return (` 이후 `:984`~) 안에서, 목록 상단에 패널을 추가. 각 등록 카드 안에 `<SmsStatusChips>`를 넣고, 목록 시작 직전에 누락 요약 줄을 추가:
```jsx
{/* SMS 상황판 요약 */}
{(() => {
    const issues = registrations.reduce((sum, r) => sum + smsIssueCount(r), 0);
    return (
        <div style={{
            margin: '0 0 12px', padding: '10px 14px', borderRadius: 'var(--r-md)',
            background: issues > 0 ? '#F8D2D5' : '#C9E8D2',
            color: issues > 0 ? '#991b1b' : '#166534', fontWeight: 600, fontSize: '0.9rem',
        }}>
            {issues > 0 ? `⚠ 자동 문자 누락/실패 ${issues}건 — 아래에서 재발송하세요` : '✅ 자동 문자 누락/실패 없음'}
        </div>
    );
})()}
```
그리고 각 등록 카드 내부(이름/정보 아래)에:
```jsx
<div style={{ marginTop: '8px' }}>
    <SmsStatusChips reg={reg} onResend={handleResendSms} resendDisabledReason={resendDisabledReason} />
</div>
```
확인됨: 목록 state 변수는 `registrations`(:42), 등록 카드는 `registrations.map(...)` 컨텍스트에서 `reg` 변수로 렌더됨(렌더는 `:984` `return (` 이후). 패널 요약은 `activeTab === 'registrations'` 목록 영역 상단에 배치.

- [ ] **Step 4: 빌드·린트 확인**

Run: `npm run build && npm run lint`
Expected: 빌드 성공, 신규 lint 에러 0

- [ ] **Step 5: 커밋**

```bash
git add src/components/CoachNewStudents.jsx
git commit -m "feat(sms-board): 신규 페이지에 SMS 상황판 패널 + 재발송 추가

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: 최종 검증 + 머지

- [ ] **Step 1: 전체 검증**

Run: `npm run build && npm run lint && npm run test`
Expected: 빌드 성공, lint 신규 에러 0, 테스트 전부 통과(신규 smsStatus 테스트 포함)

- [ ] **Step 2: 수동 확인 항목 (로컬 dev)**

`docs/superpowers/specs/...` 검증 절을 따라:
- 신규 등록 제출 → 해당 등록 문서에 `smsLog.reception` 기록되는지 (Firestore 콘솔 또는 패널 칩)
- 승인 → `smsLog.approval` / (입학반 있으면) `smsLog.reminder` 기록·칩 반영
- 패널 상단 누락 요약 + 실패/미발송 칩의 [재발송] 동작
- 리마인더 입학반 날짜 지난 건 → 재발송 버튼 "기간 지남" 비활성

- [ ] **Step 3: main 머지·푸시**

```bash
git checkout main && git pull --ff-only
git merge --no-ff feat/new-student-sms-status-board -m "Merge feat/new-student-sms-status-board: 신규 수강생 자동 문자 상황판"
git push
```

- [ ] **Step 4: CLAUDE.md 갱신**

`CLAUDE.md`의 `newStudentRegistrations` 컬렉션 설명에 `smsLog` 필드(reception/approval/reminder)와 상황판 기능을 한 줄 추가. 별도 커밋·푸시.
