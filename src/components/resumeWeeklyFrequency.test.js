// 재개 모달의 주횟수 선택이 화면과 실제 저장까지 연결되는지 고정한다.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ResumeStudentModal from './ResumeStudentModal';

// Vitest의 JSX 변환은 이 저장소에서 classic runtime을 사용한다.
globalThis.React = React;

const read = (file) => readFileSync(new URL(file, import.meta.url), 'utf8');
const modal = read('./ResumeStudentModal.jsx');
const manager = read('./StudentManager.jsx');

const renderModal = () => renderToStaticMarkup(createElement(ResumeStudentModal, {
    studentName: '테스트 수강생',
    registrations: [{ n: 8, origWeekly: '2', origSchedule: '월1수1', origStartDigits: '260101' }],
    loading: false,
    loadError: '',
    holidays: [],
    processing: false,
    onRetry: () => {},
    onClose: () => {},
    onSubmit: () => {},
}));

describe('수강 재개 모달 — 주횟수 선택', () => {
    it('주 1~5회 선택지를 제공하고 기존 주횟수를 기본값으로 사용한다', () => {
        const html = renderModal();
        ['주1회', '주2회', '주3회', '주4회', '주5회'].forEach(label => expect(html).toContain(label));
        expect(html).toContain('class="selected" aria-pressed="true">주2회</button>');
        expect(html).toContain('서로 다른 요일을 2개 선택해주세요. (2/2)');
        expect(html).toMatch(/id="resume-end-date"[^>]+value="\d{4}-\d{2}-\d{2}"/);
    });

    it('선택한 시간표 개수가 주횟수와 같아야 계산·제출한다', () => {
        expect(modal).toContain('const isScheduleComplete = selectedSlots.length === weeklyFrequency');
        expect(modal).toContain('!isScheduleComplete || !endDate || processing');
        expect(modal).toContain('weeklyFrequency,');
    });

    it('선택한 주횟수를 실제 재개 저장 함수까지 전달한다', () => {
        expect(manager).toContain('handleResumeSubmit = async ({ restartDate, schedule, weeklyFrequency })');
        expect(manager).toMatch(
            /resumeStudent\(\s*resumeTarget\['이름'\], restartDate, schedule, normalizedHolidays, weeklyFrequency\s*\)/
        );
    });
});
