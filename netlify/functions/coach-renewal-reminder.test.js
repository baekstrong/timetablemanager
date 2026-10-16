import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { hasReminderWindow, reminderMessage, deliveryId, listCoachDevices, claimDelivery, runScheduledReminder } = require('./coach-renewal-reminder');
const snapshot = { date: '2026-10-16', lessons: [{ period: 1, startMinute: 600, lastNames: ['마지막'], delayedNames: ['지연'] }] };
const now = new Date('2026-10-16T00:30:00Z');
const reminder = { ...snapshot.lessons[0], date: snapshot.date };

function offline() {
  return { now, loadSnapshot: vi.fn(async () => snapshot), devices: vi.fn(async () => [{ name: '코치', token: 'private-token' }]),
    claim: vi.fn(async () => ({ id: 'receipt' })), send: vi.fn(async () => 'mock-message-id'), finish: vi.fn(async () => {}) };
}

describe('scheduled coach reminder without real delivery', () => {
  it('performs no source, device, ledger reads or sends outside the KST pre-class window', async () => {
    for (const time of ['2026-10-16T00:29:00Z', '2026-10-16T01:00:00Z', '2026-10-17T00:30:00Z', '2026-10-16T05:30:00Z']) {
      const h = offline(); h.now = new Date(time);
      expect(hasReminderWindow(h.now)).toBe(false);
      expect(await runScheduledReminder(h)).toEqual({ due: 0, sent: 0, failed: 0 });
      expect(h.loadSnapshot).not.toHaveBeenCalled(); expect(h.devices).not.toHaveBeenCalled(); expect(h.send).not.toHaveBeenCalled();
    }
  });
  it('sends one combined coach-only message per slot and keeps source refresh uncached', async () => {
    const h = offline();
    expect(await runScheduledReminder(h)).toEqual({ due: 1, sent: 1, failed: 0 });
    expect(h.loadSnapshot).toHaveBeenCalledWith('2026-10-16', { refresh: true });
    expect(h.send.mock.calls[0][1]).toEqual(reminderMessage(reminder));
    expect(h.send.mock.calls[0][1].body).toContain('오늘 마지막 수업: 마지막');
    expect(h.send.mock.calls[0][1].body).toContain('미재등록: 지연');
    expect(h.send.mock.calls[0][2]).toBe(1800);
    expect(h.finish.mock.calls[0][1]).toBe('sent');
  });
  it('does not send duplicates, stale plans, empty plans or after a source failure', async () => {
    const h = offline(); h.claim.mockResolvedValue(null);
    await runScheduledReminder(h); expect(h.send).not.toHaveBeenCalled();
    h.loadSnapshot.mockResolvedValueOnce({ ...snapshot, date: '2026-10-15' });
    await runScheduledReminder(h); expect(h.devices).toHaveBeenCalledTimes(1);
    h.loadSnapshot.mockRejectedValueOnce(new Error('offline'));
    await expect(runScheduledReminder(h)).rejects.toThrow('offline'); expect(h.send).not.toHaveBeenCalled();
  });
  it('keeps a durable ambiguous delivery receipt and does not expose transport error text', async () => {
    const h = offline(); h.send.mockRejectedValueOnce(new Error('unknown delivery state with private token'));
    expect(await runScheduledReminder(h)).toEqual({ due: 1, sent: 0, failed: 1 });
    expect(h.finish.mock.calls[0][1]).toBe('unknown');
    expect(JSON.stringify(h.finish.mock.calls[0][1])).not.toContain('private token');
  });
  it('claims a hashed slot/device receipt once and records no student or coach names', async () => {
    let stored;
    const ref = { id: deliveryId(reminder, 'private-token') };
    const transaction = { get: vi.fn(async () => ({ exists: !!stored })), create: vi.fn((_, value) => { stored = value; }) };
    const db = { collection: () => ({ doc: () => ref }), runTransaction: async task => task(transaction) };
    expect(await claimDelivery(db, reminder, { name: '코치', token: 'private-token' })).toBe(ref);
    expect(await claimDelivery(db, reminder, { name: '코치', token: 'private-token' })).toBeNull();
    expect(JSON.stringify(stored)).not.toContain('코치'); expect(JSON.stringify(stored)).not.toContain('마지막');
    expect(ref.id).not.toContain('private-token');
    expect(transaction.create).toHaveBeenCalledTimes(1);
  });
  it('selects only existing enabled coaches and de-duplicates tokens without trusting customClaims', async () => {
    const documents = [
      { id: 'A', data: () => ({ isCoach: true, fcmToken: 'same' }) },
      { id: 'B', data: () => ({ isCoach: true, fcmToken: 'same' }) },
      { id: '학생', data: () => ({ isCoach: false, fcmToken: 'student' }) },
      { id: '차단', data: () => ({ isCoach: true, fcmToken: 'disabled' }) },
      { id: '없음', data: () => ({ isCoach: true, fcmToken: 'missing' }) },
    ];
    const query = { where: vi.fn(() => query), select: vi.fn(() => query), get: async () => ({ docs: documents }) };
    const auth = { getUser: vi.fn().mockResolvedValueOnce({ disabled: false }).mockResolvedValueOnce({ disabled: false })
      .mockResolvedValueOnce({ disabled: true }).mockRejectedValueOnce({ code: 'auth/user-not-found' }) };
    expect(await listCoachDevices({ collection: () => query }, auth)).toEqual([{ name: 'B', token: 'same' }]);
    expect(query.where).toHaveBeenCalledWith('isCoach', '==', true);
    expect(auth.getUser).toHaveBeenCalledTimes(4);
  });
});
