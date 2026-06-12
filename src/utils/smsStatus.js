// 신규 수강생 자동 문자 상황판: 상태 매핑/집계 순수 로직

export const SMS_TYPES = [
  { key: 'reception', label: '접수확인' },
  { key: 'approval', label: '승인문자' },
  { key: 'reminder', label: '입학반 리마인더' },
];

// 'YYYY-MM-DD HH:mm:ss' 예약 시각 → 'M/D HH:mm' (파싱 실패 시 null)
export function formatScheduledAt(scheduledAt) {
  if (!scheduledAt || typeof scheduledAt !== 'string') return null;
  const m = scheduledAt.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return null;
  return `${parseInt(m[2], 10)}/${parseInt(m[3], 10)} ${m[4]}:${m[5]}`;
}

// 로그 엔트리 → 칩 표시 {kind, label}
export function smsChip(entry) {
  if (entry && entry.status === 'sent') return { kind: 'sent', label: '나감' };
  if (entry && entry.status === 'scheduled') {
    const at = formatScheduledAt(entry.scheduledAt);
    return { kind: 'scheduled', label: at ? `${at} 문자 예약됨` : '예약됨' };
  }
  if (entry && entry.status === 'failed') return { kind: 'failed', label: '실패' };
  return { kind: 'none', label: '미발송' };
}

// scheduledAt 미기록(과거 데이터) 시 "입학반 3일 전 오전 9시" 규칙으로 예약 시각 추정.
// 추정 시각이 이미 지났으면 즉시 발송됐을 수도 있어 단정하지 않는다(null).
export function expectedReminderAt(reg, now = new Date()) {
  if (!reg || !reg.entranceDate) return null;
  const d = new Date(reg.entranceDate + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() - 3);
  d.setHours(9, 0, 0, 0);
  if (d.getTime() <= now.getTime()) return null;
  return `${d.getMonth() + 1}/${d.getDate()} 09:00`;
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
