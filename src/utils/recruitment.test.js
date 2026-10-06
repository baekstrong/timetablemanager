import { describe, it, expect } from 'vitest';
import {
    koreanDate, shiftMonth, recruitmentOptions, monthEntrances, validateRecruitmentSubmission,
    inquirySmsLink, inquiryMessage, isInquiryPhone, isAdmissionDate, recruitmentInquiryRoute,
} from './recruitment';

const entrance = { id: 'nov', date: '2026-11-07', time: '10:00', isActive: true, maxCapacity: 6, currentCount: 2 };
const data = { recruitmentMonth: '2026-11', entranceClassId: 'nov', entranceDate: entrance.date, entranceInquiry: '' };
const open = { month: '2026-11', status: 'open' };

describe('월별 신규 모집', () => {
    it('한국 자정과 연도 경계를 기준으로 모집월을 계산한다', () => {
        expect(koreanDate(new Date('2026-10-31T15:00:00Z'))).toBe('2026-11-01');
        expect(shiftMonth('2026-12')).toBe('2027-01');
    });
    it('설정되지 않은 월은 기존 입학반이 있어도 자동으로 접수하지 않는다', () => {
        expect(recruitmentOptions([], [entrance], '2026-10-06').map(o => [o.month, o.canApply]))
            .toEqual([['2026-10', false], ['2026-11', false]]);
    });
    it('현재 마감월을 숨기지 않고 다음 달의 사전 접수를 허용한다', () => {
        const options = recruitmentOptions([{ month: '2026-10', status: 'closed' }, open], [entrance], '2026-10-06');
        expect(options[0]).toMatchObject({ month: '2026-10', status: 'closed', canApply: false });
        expect(options[1]).toMatchObject({ month: '2026-11', canApply: true });
    });
    it('다음 달이 사전 접수중이면 현재 마감월의 상담 대신 모집 이동을 표시한다', () => {
        const current = { month: '2026-10', status: 'closed' };
        expect(recruitmentInquiryRoute(current, [current, open])).toMatchObject({ showInquiry: false, nextOpen: true });
        expect(recruitmentInquiryRoute(open, [current, open])).toMatchObject({ showInquiry: false, nextOpen: false });
        expect(recruitmentInquiryRoute(current, [current, { ...open, status: 'inquiry' }])).toMatchObject({ showInquiry: true, nextOpen: false });
    });
    it('다른 달·지난 날짜·비활성 입학반을 선택지에 섞지 않는다', () => {
        expect(monthEntrances([entrance, { ...entrance, date: '2026-10-10' }, { ...entrance, date: '2026-11-03' }, { ...entrance, isActive: false }], '2026-11', '2026-11-06')).toEqual([entrance]);
    });
    it.each([{ ...entrance, closed: true }, { ...entrance, currentCount: 6 }, { ...entrance, isActive: false }])('입학반이 마감되면 월이 열려 있어도 신청 버튼을 막는다', ec => {
        expect(recruitmentOptions([open], [ec], '2026-10-06').find(o => o.month === '2026-11').canApply).toBe(false);
    });
    it('존재하는 신청 가능한 입학반만 통과한다', () => {
        expect(() => validateRecruitmentSubmission(open, data, entrance, '2026-10-06')).not.toThrow();
    });
    it.each([null, { ...open, status: 'closed' }, { ...open, status: 'inquiry' }, { ...open, month: '2026-10' }])('작성 중 모집 마감·문의 전환·없는 월은 최종 제출에서 거부한다', config => {
        expect(() => validateRecruitmentSubmission(config, data, entrance, '2026-10-06')).toThrow('모집');
    });
    it.each([null, { ...entrance, date: '2026-12-05' }, { ...entrance, date: '2026-11-14' }, { ...entrance, closed: true }, { ...entrance, currentCount: 6 }])('작성 중 입학반 삭제·이동·날짜 변경·마감은 거부한다', ec => {
        expect(() => validateRecruitmentSubmission(open, data, ec, '2026-10-06')).toThrow('입학반');
    });
    it('지난 입학월의 제출을 거부한다', () => {
        expect(() => validateRecruitmentSubmission(open, data, entrance, '2026-12-01')).toThrow('모집');
    });
    it('같은 월의 다른 날 문의는 사유가 있는 경우만 통과한다', () => {
        const inquiry = { ...data, entranceClassId: null, entranceInquiry: '2026-11-14', entranceInquiryReason: '출장' };
        expect(() => validateRecruitmentSubmission(open, inquiry, null, '2026-10-06')).not.toThrow();
        expect(() => validateRecruitmentSubmission(open, { ...inquiry, entranceInquiryReason: '  ' }, null, '2026-10-06')).toThrow();
        expect(() => validateRecruitmentSubmission(open, { ...inquiry, entranceInquiry: '2026-12-05' }, null, '2026-10-06')).toThrow();
        expect(() => validateRecruitmentSubmission(open, { ...inquiry, entranceClassId: 'nov' }, entrance, '2026-10-06')).toThrow();
    });
    it('존재하지 않는 날짜와 잘못된 형식을 거부한다', () => {
        expect(isAdmissionDate('2026-02-31')).toBe(false);
        expect(isAdmissionDate('2026-11-7')).toBe(false);
        expect(isAdmissionDate('2028-02-29')).toBe(true);
    });
    it('문자 내용은 월을 명시하고 기기별 문자 링크에는 번호·문구를 넣는다', () => {
        expect(inquiryMessage('2026-11')).toContain('2026년 11월');
        expect(inquirySmsLink('010-1234-5678', '2026-11', 'iPhone')).toContain('sms:01012345678&body=');
        expect(inquirySmsLink('010-1234-5678', '2026-11', 'Android')).toContain('sms:01012345678?body=');
        expect(inquirySmsLink('', '2026-11')).toBe('');
        expect(isInquiryPhone('010-1234-5678')).toBe(true);
        expect(isInquiryPhone('javascript:alert(1)')).toBe(false);
    });
});
