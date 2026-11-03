import { describe, it, expect, vi } from 'vitest';

vi.mock('../config/firebase', () => ({ auth: {} }));

import { buildStudentApprovalText, formatRegistrationDate } from './smsService';

const base = {
  paymentMethod: 'naver',
  weeklyFrequency: 2,
  scheduleString: '화1목1',
  entranceDate: '2026-11-14',
  entranceClassDate: '11월 14일 (토) 10:00 ~ 13:00',
  startDate: '2026-11-17',
  endDate: '2026-12-10',
};
const settings = { naverStoreLinks: { 2: 'https://example.com/2' } };

describe('formatRegistrationDate', () => {
  it('YYYY-MM-DD와 시트 YYMMDD를 요일 붙은 점 표기로 바꾼다', () => {
    expect(formatRegistrationDate('2026-11-17')).toBe('2026.11.17(화)');
    expect(formatRegistrationDate('261210')).toBe('2026.12.10(목)');
  });
  it('비었거나 못 읽으면 빈 문자열', () => {
    expect(formatRegistrationDate('')).toBe('');
    expect(formatRegistrationDate(undefined)).toBe('');
    expect(formatRegistrationDate('2026-13-40')).toBe('');
  });
});

describe('buildStudentApprovalText', () => {
  it('입학반·다음 주 시작 안내·등록 시간·등록 기간을 순서대로 담는다', () => {
    const text = buildStudentApprovalText('홍길동', base, settings);
    expect(text).toContain(
      '[근력학교] 홍길동님, 신규 수강이 승인되었습니다.\n\n' +
      '입학반: 11월 14일(토) 10:00 ~ 13:00\n' +
      '입학반 수강 후 다음 주부터 정규 수업이 시작됩니다.\n\n' +
      '등록 시간: 화1목1 (주2회)\n' +
      '등록 기간: 2026.11.17(화) ~ 2026.12.10(목)\n\n' +
      '아래 네이버 스마트스토어 링크를 통해서 결제해주세요.'
    );
    expect(text).toContain('6교시 21:40 ~ 23:10');
  });

  it('기간이 없으면(입학반 미정) 등록 기간 줄과 다음 주 안내를 뺀다', () => {
    const text = buildStudentApprovalText('홍길동', { ...base, entranceDate: '', startDate: '', endDate: '' }, settings);
    expect(text).not.toContain('등록 기간');
    expect(text).not.toContain('다음 주부터');
    expect(text).toContain('등록 시간: 화1목1 (주2회)');
  });

  it('현장 결제는 결제 링크 대신 방문 결제 안내', () => {
    const text = buildStudentApprovalText('홍길동', { ...base, paymentMethod: 'card' }, settings);
    expect(text).toContain('입학반날 방문하셔서 결제해주세요!');
    expect(text).not.toContain('example.com');
  });
});
