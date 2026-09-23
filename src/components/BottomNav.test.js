import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React, { createElement } from 'react';
import BottomNav from './BottomNav';

const render = (role, currentPage = 'dashboard') => renderToStaticMarkup(createElement(BottomNav, {
    user: { role }, currentPage, onNavigate() {}, hasContractNotification: true,
}));

describe('역할별 하단 메뉴', () => {
    beforeEach(() => vi.stubGlobal('React', React));
    afterEach(() => vi.unstubAllGlobals());
    it('수강생은 기존 메뉴와 게시판 알림을 유지', () => {
        const html = render('student', 'holding');
        expect([...html.matchAll(/class="tab-label">([^<]+)/g)].map(match => match[1]))
            .toEqual(['게시판', '시간표', '훈련일지', '홀딩/결석', '내 정보']);
        expect(html.match(/aria-current="page"/g)).toHaveLength(1);
        expect(html).toContain('notification-dot');
    });
    it('코치에만 오늘 메뉴 적용하고 신규 메뉴 유지', () => {
        const html = render('coach', 'today');
        expect([...html.matchAll(/class="tab-label">([^<]+)/g)].map(match => match[1]))
            .toEqual(['오늘', '시간표', '훈련일지', '수강생', '신규']);
    });
});
