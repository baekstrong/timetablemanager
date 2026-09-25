import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 화면에 자료가 도착한 상태를 주입하고 실제 이벤트 핸들러를 호출한다.
// Firebase/Sheets/알림 모듈은 전부 모의하므로 운영 요청은 발생하지 않는다.
const harness = vi.hoisted(() => ({ states: [], setters: [], requestHolding: vi.fn(), refresh: vi.fn() }));
vi.mock('react', async importOriginal => ({
    ...await importOriginal(),
    useState: initial => {
        const index = harness.setters.length;
        const setter = vi.fn();
        harness.setters.push(setter);
        return [index < harness.states.length ? harness.states[index] : typeof initial === 'function' ? initial() : initial, setter];
    },
    useMemo: compute => compute(),
    useEffect: () => {},
}));
vi.mock('../contexts/GoogleSheetsContext', () => ({
    useGoogleSheets: () => ({ requestHolding: harness.requestHolding, refresh: harness.refresh }),
}));
vi.mock('../services/googleSheetsService', () => ({
    getStudentField: (student, field) => student?.[field],
    parseHoldingStatus: () => ({ months: 1, used: 0, total: 1, isCurrentlyUsed: false }),
    cancelHoldingInSheets: vi.fn(),
}));
vi.mock('../services/firebaseService', () => ({
    createHoldingRequest: vi.fn(), markHoldingSheetsApplied: vi.fn(), createAbsenceRequest: vi.fn(),
    getHoldingsByStudent: vi.fn(), getAbsencesByStudent: vi.fn(), cancelHolding: vi.fn(),
    cancelAbsence: vi.fn(), getHolidays: vi.fn(), getActiveMakeupRequests: vi.fn(),
}));
vi.mock('../services/makeupWaitlistService', () => ({ onSeatsFreedForDates: vi.fn() }));

import HoldingManager from './HoldingManager';

const studentData = { '시작날짜': '260901', '종료날짜': '260930', '요일 및 시간': '화5목5', '주횟수': '2', '홀딩 사용여부': 'X' };
const mutationNames = ['createHoldingRequest', 'markHoldingSheetsApplied', 'createAbsenceRequest', 'cancelHolding', 'cancelAbsence', 'cancelHoldingInSheets', 'onSeatsFreedForDates'];
const servicesForTest = () => Object.fromEntries([
    ...mutationNames.map(name => [name, vi.fn().mockResolvedValue(name === 'createHoldingRequest' ? { id: 'new-holding' } : undefined)]),
    ...['getHoldingsByStudent', 'getAbsencesByStudent', 'getActiveMakeupRequests', 'getHolidays'].map(name => [name, vi.fn().mockResolvedValue([])]),
]);
const elements = node => {
    if (Array.isArray(node)) return node.flatMap(elements);
    if (!React.isValidElement(node)) return [];
    return [node, ...elements(node.props.children)];
};
const textOf = node => {
    if (Array.isArray(node)) return node.map(textOf).join('');
    if (React.isValidElement(node)) return textOf(node.props.children);
    return typeof node === 'string' || typeof node === 'number' ? String(node) : '';
};
const render = ({ readOnly, requestType = 'holding', selectedDates = ['2026-09-17'], holdings = [], absences = [] } = {}) => {
    harness.setters = [];
    // requestType, dates, submitting, confirmation, holdings, absences, holidays,
    // makeups, loading state, calendar year/month의 로딩 완료 상태.
    harness.states = [requestType, selectedDates, false, true, holdings, absences, {}, [], 'ready', 2026, 8];
    const services = servicesForTest();
    const tree = HoldingManager({ user: { username: '검토 수강생' }, studentData, initialDate: '2026-09-17', services, readOnly });
    return { services, nodes: elements(tree) };
};
const button = (nodes, label) => nodes.find(node => node.type === 'button' && textOf(node) === label);
const expectNoWrites = services => {
    mutationNames.forEach(name => expect(services[name]).not.toHaveBeenCalled());
    expect(harness.requestHolding).not.toHaveBeenCalled();
    expect(harness.refresh).not.toHaveBeenCalled();
};

describe('홀딩·결석 조회 전용 화면', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-16T09:00:00'));
        vi.stubGlobal('React', React);
        vi.stubGlobal('alert', vi.fn());
        vi.stubGlobal('confirm', vi.fn(() => true));
        vi.spyOn(console, 'log').mockImplementation(() => {});
        harness.requestHolding.mockReset().mockResolvedValue(undefined);
        harness.refresh.mockReset().mockResolvedValue(undefined);
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it.each(['holding', 'absence'])('%s 확인 화면까지 열되 확정 핸들러를 직접 호출해도 저장·알림을 실행하지 않는다', async requestType => {
        const { services, nodes } = render({ readOnly: true, requestType });
        const reviewButton = button(nodes, requestType === 'holding' ? '홀딩 신청하기' : '결석 신청하기');
        expect(reviewButton.props.disabled).toBe(false);
        reviewButton.props.onClick();
        expect(harness.setters[3]).toHaveBeenCalledWith(true);
        const finalButton = button(nodes, '조회 전용 · 신청 불가');
        expect(finalButton.props.disabled).toBe(true);
        finalButton.props.onClick();
        await Promise.resolve();
        expectNoWrites(services);
    });

    it('날짜 선택과 홀딩·결석 유형 전환은 계속 사용할 수 있다', () => {
        const { services, nodes } = render({ readOnly: true, selectedDates: [] });
        const selectDate = button(nodes, '9월 17일 수업 선택하기');
        expect(selectDate.props.disabled).toBe(false);
        selectDate.props.onClick();
        expect(harness.setters[1]).toHaveBeenCalledWith(['2026-09-17']);
        for (const type of ['holding', 'absence']) {
            const radio = nodes.find(node => node.type === 'input' && node.props.value === type);
            expect(radio.props.disabled).not.toBe(true);
            radio.props.onChange();
            expect(harness.setters[0]).toHaveBeenCalledWith(type);
        }
        expectNoWrites(services);
    });

    it('아직 취소 가능한 홀딩·결석도 취소 버튼과 핸들러 양쪽에서 차단한다', async () => {
        const { services, nodes } = render({
            readOnly: true,
            holdings: [{ id: 'holding', startDate: '2026-09-17', endDate: '2026-09-17', holdingDates: ['2026-09-17'] }],
            absences: [{ id: 'absence', date: '2026-09-22' }],
        });
        const cancelButtons = nodes.filter(node => node.type === 'button' && textOf(node) === '취소');
        expect(cancelButtons).toHaveLength(2);
        for (const cancelButton of cancelButtons) {
            expect(cancelButton.props.disabled).toBe(true);
            await cancelButton.props.onClick();
        }
        expect(confirm).not.toHaveBeenCalled();
        expectNoWrites(services);
    });

    it.each(['holding', 'absence'])('readOnly를 생략한 기존 %s 신청은 기존 서비스와 알림을 실행한다', async requestType => {
        const { services, nodes } = render({ requestType });
        const finalButton = button(nodes, '신청 확정');
        expect(finalButton.props.disabled).toBe(false);
        finalButton.props.onClick();
        await vi.runAllTimersAsync();
        if (requestType === 'holding') {
            expect(services.createHoldingRequest).toHaveBeenCalledWith('검토 수강생', '2026-09-17', '2026-09-17', ['2026-09-17']);
            expect(harness.requestHolding).toHaveBeenCalledOnce();
            expect(services.markHoldingSheetsApplied).toHaveBeenCalledWith('new-holding');
        } else {
            expect(services.createAbsenceRequest).toHaveBeenCalledWith('검토 수강생', '2026-09-17');
            expect(harness.requestHolding).not.toHaveBeenCalled();
        }
        expect(services.onSeatsFreedForDates).toHaveBeenCalledWith(['2026-09-17'], '목5');
    });
});
