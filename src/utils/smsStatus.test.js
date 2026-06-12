import { describe, it, expect } from 'vitest';
import { SMS_TYPES, smsChip, isReminderExpected, smsIssueCount, isReminderResendable, formatScheduledAt, expectedReminderAt } from './smsStatus';

describe('smsChip', () => {
  it('엔트리 없으면 미발송', () => {
    expect(smsChip(undefined)).toEqual({ kind: 'none', label: '미발송' });
  });
  it('sent → 나감', () => {
    expect(smsChip({ status: 'sent', at: 1 })).toEqual({ kind: 'sent', label: '나감' });
  });
  it('scheduled(시각 미기록) → 예약됨', () => {
    expect(smsChip({ status: 'scheduled', at: 1 })).toEqual({ kind: 'scheduled', label: '예약됨' });
  });
  it('scheduled + scheduledAt → 예약 시각 표시', () => {
    expect(smsChip({ status: 'scheduled', at: 1, scheduledAt: '2026-06-13 09:00:00' }))
      .toEqual({ kind: 'scheduled', label: '6/13 09:00 문자 예약됨' });
  });
  it('failed → 실패', () => {
    expect(smsChip({ status: 'failed', at: 1 })).toEqual({ kind: 'failed', label: '실패' });
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
  it('코치 직접 등록(registeredByCoach)은 자동문자 대상 아님 → 항상 0', () => {
    expect(smsIssueCount({ status: 'approved', registeredByCoach: true, smsLog: {} })).toBe(0);
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
