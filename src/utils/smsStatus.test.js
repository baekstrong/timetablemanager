import { describe, it, expect } from 'vitest';
import { SMS_TYPES, smsChip, isReminderExpected, smsIssueCount, isReminderResendable, formatScheduledAt, formatAt, expectedReminderAt } from './smsStatus';

describe('smsChip', () => {
  it('엔트리 없으면 미발송', () => {
    expect(smsChip(undefined)).toEqual({ kind: 'none', label: '미발송' });
  });
  it('sent → 발송 시각 + 발송완료', () => {
    const at = new Date(2026, 6, 25, 16, 6).getTime();
    expect(smsChip({ status: 'sent', at })).toEqual({ kind: 'sent', label: '7/25 16:06 발송완료' });
  });
  it('sent(시각 미기록) → 발송완료', () => {
    expect(smsChip({ status: 'sent' })).toEqual({ kind: 'sent', label: '발송완료' });
  });
  it('scheduled(시각 미기록) → 예약완료', () => {
    expect(smsChip({ status: 'scheduled', at: 1 })).toEqual({ kind: 'scheduled', label: '예약완료' });
  });
  it('scheduled + scheduledAt → 발송 예정 시각 표시', () => {
    expect(smsChip({ status: 'scheduled', at: 1, scheduledAt: '2026-06-13 09:00:00' }))
      .toEqual({ kind: 'scheduled', label: '6/13 09:00 예약완료' });
  });
  it('failed → 실패 시각 표시', () => {
    const at = new Date(2026, 6, 25, 9, 5).getTime();
    expect(smsChip({ status: 'failed', at })).toEqual({ kind: 'failed', label: '7/25 09:05 실패' });
  });
});

describe('formatAt', () => {
  it('ms → M/D HH:mm', () => {
    expect(formatAt(new Date(2026, 11, 3, 18, 30).getTime())).toBe('12/3 18:30');
  });
  it('없거나 잘못된 값이면 null', () => {
    expect(formatAt(undefined)).toBe(null);
    expect(formatAt(0)).toBe(null);
    expect(formatAt('1785133012506')).toBe(null);
  });
});

describe('formatScheduledAt', () => {
  it('YYYY-MM-DD HH:mm:ss → M/D HH:mm', () => {
    expect(formatScheduledAt('2026-06-13 09:00:00')).toBe('6/13 09:00');
    expect(formatScheduledAt('2026-12-03 18:30:00')).toBe('12/3 18:30');
  });
  it('파싱 실패 시 null', () => {
    expect(formatScheduledAt('')).toBe(null);
    expect(formatScheduledAt('이상한값')).toBe(null);
    expect(formatScheduledAt(null)).toBe(null);
  });
});

describe('expectedReminderAt', () => {
  const now = new Date(2026, 5, 10, 12, 0); // 2026-06-10 12:00
  it('입학반 3일 전 오전 9시가 미래면 추정 시각 반환', () => {
    expect(expectedReminderAt({ entranceDate: '2026-06-20' }, now)).toBe('6/17 09:00');
  });
  it('추정 시각이 이미 지났으면 null (즉시 발송됐을 수 있음)', () => {
    expect(expectedReminderAt({ entranceDate: '2026-06-12' }, now)).toBe(null);
  });
  it('입학반 날짜 없으면 null', () => {
    expect(expectedReminderAt({}, now)).toBe(null);
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
  it('코치 직접 등록: 접수확인만 제외하고 승인문자는 카운트', () => {
    // 접수확인 문자는 안 보내므로 제외, 승인문자는 실제로 발송되므로 누락이면 카운트
    expect(smsIssueCount({ status: 'approved', registeredByCoach: true, smsLog: {} })).toBe(1);
    expect(smsIssueCount({ status: 'approved', registeredByCoach: true, smsLog: { approval: { status: 'sent', at: 1 } } })).toBe(0);
  });
  it('코치 직접 등록 + 입학반: 리마인더 누락도 카운트', () => {
    const reg = { status: 'approved', registeredByCoach: true, entranceClassDate: 'x', entranceDate: '2026-08-01', smsLog: { approval: { status: 'sent', at: 1 } } };
    expect(smsIssueCount(reg)).toBe(1);
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
