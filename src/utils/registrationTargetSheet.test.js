import { describe, it, expect } from 'vitest';
import { defaultRegistrationSheet } from './registrationTargetSheet';

const sheets = ['등록생 목록(26년11월)', '등록생 목록(26년12월)'];
const today = new Date('2026-11-24T10:00:00');

describe('defaultRegistrationSheet', () => {
    it('신규는 시작날짜의 달 시트', () => {
        expect(defaultRegistrationSheet({ type: 'new', startDate: '2026-12-15', availableSheets: sheets, today })).toBe('등록생 목록(26년12월)');
    });
    it('신규라도 그 달 시트가 없으면 이번 달', () => {
        expect(defaultRegistrationSheet({ type: 'new', startDate: '2027-01-05', availableSheets: sheets, today })).toBe('등록생 목록(26년11월)');
    });
    it('신규 시작날짜가 없으면 이번 달', () => {
        expect(defaultRegistrationSheet({ type: 'new', startDate: '', availableSheets: sheets, today })).toBe('등록생 목록(26년11월)');
    });
    it('재등록은 시작날짜와 무관하게 이번 달', () => {
        expect(defaultRegistrationSheet({ type: 'renew', startDate: '2026-12-15', availableSheets: sheets, today })).toBe('등록생 목록(26년11월)');
    });
});
