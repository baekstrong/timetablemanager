import { describe, expect, it } from 'vitest';
import { getNoticeRevision, isNoticeUnread } from './noticeState';

describe('공지 수정본과 읽음 상태', () => {
    it('작성·수정 시각 중 최신 값을 서로 다른 timestamp 표현에서도 사용한다', () => {
        expect(getNoticeRevision({ createdAt: { toMillis: () => 100 }, updatedAt: 200 })).toBe(200);
        expect(getNoticeRevision({ createdAt: new Date(300), updatedAt: { seconds: 0, nanoseconds: 200000000 } })).toBe(300);
        expect(getNoticeRevision({ createdAt: '2026-09-25T00:00:00Z', updatedAt: 'invalid' })).toBe(Date.parse('2026-09-25T00:00:00Z'));
        expect(getNoticeRevision(null)).toBe(0);
    });

    it('오늘 여부와 무관하게 미확인 공지를 표시하고 수정되면 다시 표시한다', () => {
        const post = { id: 'notice', createdAt: 100, updatedAt: 200 };
        expect(isNoticeUnread(post, {})).toBe(true);
        expect(isNoticeUnread(post, { notice: 100 })).toBe(true);
        expect(isNoticeUnread(post, { notice: 200 })).toBe(false);
        expect(isNoticeUnread(post, { notice: 300 })).toBe(false);
        expect(isNoticeUnread({ ...post, updatedAt: 400 }, { notice: 300 })).toBe(true);
    });

    it('누락·잘못된 읽음 값은 미확인으로 두고 삭제글·다른 카테고리는 제외한다', () => {
        expect(isNoticeUnread({ id: 'old' }, null)).toBe(true);
        expect(isNoticeUnread({ id: 'old' }, { old: '0' })).toBe(true);
        expect(isNoticeUnread({ id: 'old' }, { old: 0 })).toBe(false);
        expect(isNoticeUnread({ id: 'old', deleted: true })).toBe(false);
        expect(isNoticeUnread({ id: 'old', category: 'free' })).toBe(false);
        expect(isNoticeUnread(null)).toBe(false);
    });
});
