import { beforeEach, afterEach, vi, it, expect } from 'vitest';
const { auth } = vi.hoisted(() => ({ auth: { currentUser: null } }));
vi.mock('../config/firebase', () => ({ auth }));
import { createCalendarEvent, updateCalendarEvent, deleteCalendarEvent } from './calendarService';
beforeEach(() => {
    auth.currentUser = { getIdToken: vi.fn(async () => 'synthetic-token') };
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ success: true, eventId: 'event' }) })));
});
afterEach(() => vi.unstubAllGlobals());
it.each(['create', 'update', 'delete'])('%s 요청은 토큰을 URL이 아닌 본문으로 전달', async action => {
    if (action === 'create') await createCalendarEvent('2026-09-23', '10:00', '13:00');
    if (action === 'update') await updateCalendarEvent('event', '2026-09-23', '10:00', '13:00');
    if (action === 'delete') await deleteCalendarEvent('event');
    const [url, init] = fetch.mock.calls[0];
    expect(url).not.toContain('synthetic-token');
    expect(JSON.parse(init.body).idToken).toBe('synthetic-token');
});
it('로그인 세션이 없으면 캘린더 요청을 발송하지 않는다', async () => {
    auth.currentUser = null;
    expect(await createCalendarEvent('2026-09-23', '10:00')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
});
