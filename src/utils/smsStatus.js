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
  // 코치 직접 등록(재등록 포함)은 자동 문자 발송 흐름을 타지 않으므로 집계 제외
  if (reg && reg.registeredByCoach) return 0;
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
