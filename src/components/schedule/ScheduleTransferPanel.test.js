import React from 'react';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
vi.mock('../../services/firebaseService', () => ({ cancelWaitlistRequest: vi.fn(), notifyWaitlistRequest: vi.fn(), revertWaitlistNotification: vi.fn() }));
vi.mock('../../services/scheduleTransferService', () => ({ acceptScheduleTransfer: vi.fn() }));
vi.mock('../PushSettings', () => ({ default: () => null }));
import ScheduleTransferPanel from './ScheduleTransferPanel';
const entry = { id: '1', studentName: '예시학생', status: 'waiting', currentSlot: { day: '월', period: 1 }, desiredSlot: { day: '화', period: '2' } };
vi.stubGlobal('React', React);
afterAll(() => vi.unstubAllGlobals());
const html = props => renderToStaticMarkup(React.createElement(ScheduleTransferPanel, { entries: [entry], ready: true, ...props }));
describe('첫 화면 시간표 변경 대기', () => {
    it('학생에게 본인 대기 상태와 취소만 보이고 다른 학생은 노출하지 않는다', () => {
        const output = html({ studentName: '예시학생', entries: [entry, { ...entry, id: '2', studentName: '다른학생' }] });
        expect(output).toContain('대기 중');
        expect(output).toContain('대기 취소');
        expect(output).not.toContain('다른학생');
        expect(output).not.toContain('>승인</button>');
    });
    it('코치 승인 후 학생 거절이 왼쪽, 최종 승인이 오른쪽에 나온다', () => {
        const output = html({ studentName: '예시학생', entries: [{ ...entry, status: 'notified' }] });
        expect(output).toContain('코치 승인 완료');
        expect(output.indexOf('>거절</button>')).toBeLessThan(output.indexOf('>승인</button>'));
    });
    it('코치 만석/미조회일 때 승인을 막고 여석이 확인되면 허용한다', () => {
        const scheduleData = { regularEnrollments: [{ day: '화', period: 2, names: ['1', '2', '3', '4', '5', '6', '7'] }] };
        expect(html({ coach: true, scheduleData })).toContain('disabled="">만석');
        expect(html({ coach: true, ready: false, scheduleData })).toContain('disabled="">확인 중');
        expect(html({ coach: true, scheduleData: { regularEnrollments: [] } })).toContain('>승인</button>');
    });
    it('완료/취소된 항목과 대상이 없는 카드는 숨긴다', () => {
        expect(html({ studentName: '예시학생', entries: [{ ...entry, status: 'accepted' }] })).toBe('');
        expect(html({ coach: true, entries: [] })).toBe('');
    });
});
