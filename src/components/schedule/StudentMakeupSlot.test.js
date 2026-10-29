import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React, { createElement } from 'react';
import StudentMakeupSlot from './StudentMakeupSlot';

const render = props => renderToStaticMarkup(createElement(StudentMakeupSlot, { label: '대기 가능', isFull: true, ...props }));

describe('보강 시간표 만석 칸의 대기 인원', () => {
    beforeEach(() => vi.stubGlobal('React', React));
    afterEach(() => vi.unstubAllGlobals());
    it('대기자가 있으면 대기 가능 아래에 인원을 작게 표시', () => {
        const html = render({ waitCount: 3 });
        expect(html).toContain('대기 가능');
        expect(html).toContain('<span class="student-makeup-slot-wait-count">대기 3명</span>');
        expect(html).toContain('aria-label="대기 가능 · 대기 3명"');
    });
    it('대기자가 없거나 내 수업 칸이면 표시하지 않음', () => {
        expect(render({ waitCount: 0 })).not.toContain('wait-count');
        const regular = { type: 'regular', date: '2026-11-02', period: 6, day: '월' };
        expect(render({ waitCount: 2, session: regular })).not.toContain('대기 2명');
    });
});
