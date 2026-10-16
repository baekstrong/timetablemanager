import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { getCoachReminderClock } from '../../public/shared/coachRenewalReminder.js';
const require = createRequire(import.meta.url);
const { buildDailySnapshot, registrationRanges, registrationsFromRanges, effectiveEndDate, selectRegistrations } = require('./_coachRenewalLib');
const { createDailySnapshotLoader } = require('./_coachRenewalSource');
const { PERIODS } = require('../../src/data/mockData.js');

const date = '2026-10-16'; // Friday, independent of execution timezone.
const registration = (name, patch = {}) => ({ 이름: name, '요일 및 시간': '수1금1', 시작날짜: '260918', 종료날짜: '261016', '홀딩 사용여부': 'X', _foundSheetName: '등록생 목록(26년10월)', ...patch });
const daily = patch => ({ date, registrations: [registration('마지막'), registration('지연', { 종료날짜: '261014' })], periods: PERIODS, ...patch });
const plan = patch => buildDailySnapshot(daily(patch));
const first = snapshot => snapshot.lessons.find(lesson => lesson.period === 1);
const makeup = (name, original, destination) => ({ studentName: name, status: 'active', originalClass: { date: original[0], period: original[1] }, makeupClass: { date: destination[0], period: destination[1] } });

describe('fresh source daily reminder plan', () => {
  it('includes only current lesson attendees and separates expired from last-day names', () => {
    expect(first(plan())).toEqual({ period: 1, startMinute: 600, lastNames: ['마지막'], delayedNames: ['지연'] });
    expect(plan().lessons.map(lesson => lesson.period)).toEqual([1, 2, 4, 5, 6]);
  });
  it('excludes prepaid next registrations, future starts, stopped and paused memberships', () => {
    const registrations = [registration('미리'), registration('미리', { 시작날짜: '261021', 종료날짜: '261118' }),
      registration('미래', { 시작날짜: '261021', 종료날짜: '261118' }),
      registration('종료', { '요일 및 시간': '' }),
      registration('정지'), registration('정지', { '요일 및 시간': '', 시작날짜: '250101', 종료날짜: '3회' })];
    expect(first(plan({ registrations })).lastNames).toEqual(['정지']); // Active registration has priority over paused history.
    expect(first(plan({ registrations: registrations.map(row => row.이름 === '정지' && row['요일 및 시간'] ? { ...row, 종료날짜: '261014' } : row) })).delayedNames).toEqual([]);
  });
  it('uses latest active sheet, suppresses older duplicate rows and retains next-registration metadata', () => {
    const selected = selectRegistrations([registration('A', { _foundSheetName: '등록생 목록(26년9월)', 종료날짜: '261030' }), registration('A')], date);
    expect(selected[0]['종료날짜']).toBe('261016');
    expect(selected[0]._hasNext).toBe(false);
  });
  it('filters holidays, disabled classes, active absences, agreed absences and specific holding dates', () => {
    expect(plan({ holidays: [{ date }] }).lessons).toEqual([]);
    expect(plan({ koreanHolidays: { [date]: '휴일' } }).lessons).toEqual([]);
    expect(plan({ date: '2026-10-17' }).lessons).toEqual([]);
    expect(plan({ disabledClasses: ['금-1'] }).lessons.some(lesson => lesson.period === 1)).toBe(false);
    expect(first(plan({ absences: [{ studentName: '마지막', date }] })).lastNames).toEqual([]);
    expect(first(plan({ registrations: [registration('A', { 특이사항: '26.10.14, 26.10.16 결석' })] })).lastNames).toEqual([]);
    const held = registration('A', { '홀딩 사용여부': 'O(1/2)', '홀딩 시작일': '261012', '홀딩 종료일': '261016' });
    expect(first(plan({ registrations: [held] })).lastNames).toEqual([]);
    expect(first(plan({ registrations: [held], holdings: [{ studentName: 'A', startDate: '2026-10-12', endDate: date, holdingDates: ['2026-10-14'] }] })).lastNames).toEqual(['A']);
  });
  it('moves the last-class reminder to the actual makeup lesson and excludes the vacated slot', () => {
    const result = plan({ registrations: [registration('A')], makeups: [makeup('A', [date, 1], [date, 4])] });
    expect(first(result).lastNames).toEqual([]);
    expect(result.lessons.find(lesson => lesson.period === 4).lastNames).toEqual(['A']);
  });
  it('chooses the latest actual class on the final day independently of makeup ordering', () => {
    const registrations = [registration('A', { '요일 및 시간': '화5금5' })];
    const makeups = [makeup('A', ['2026-10-13', 5], [date, 1]), makeup('A', ['2026-10-09', 5], [date, 2])];
    const forward = plan({ registrations, makeups });
    const reverse = plan({ registrations, makeups: [...makeups].reverse() });
    expect(forward).toEqual(reverse);
    expect(forward.lessons.filter(lesson => lesson.lastNames.includes('A')).map(lesson => lesson.period)).toEqual([5]);
  });
  it('does not call a membership expired while its valid makeup is still ahead, and ignores canceled makeups', () => {
    const registrations = [registration('A', { 종료날짜: '261014' })];
    expect(first(plan({ registrations, makeups: [makeup('A', ['2026-10-14', 1], ['2026-10-19', 1])] })).delayedNames).toEqual([]);
    expect(first(plan({ registrations, makeups: [{ ...makeup('A', ['2026-10-14', 1], ['2026-10-19', 1]), status: 'cancelled' }] })).delayedNames).toEqual(['A']);
    // A makeup requested from an already expired regular slot cannot extend that membership.
    expect(first(plan({ registrations, makeups: [makeup('A', [date, 1], ['2026-10-19', 1])] })).delayedNames).toEqual([]); // Vacated original slot, so no attendance.
  });
  it('preserves first-class move cap and the latest preceding regular class for early makeups', () => {
    const row = registration('A', { '요일 및 시간': '월1수1', 종료날짜: '261012' });
    expect(effectiveEndDate(row, [makeup('A', ['2026-10-12', 1], ['2026-10-16', 1])])).toBe('2026-10-14');
    expect(effectiveEndDate(registration('A'), [makeup('A', [date, 1], ['2026-10-13', 1])])).toBe('2026-10-14');
  });
  it('bounds full registration fields to recent months, keeps old paused rows and does not include contact columns', () => {
    const ranges = registrationRanges(['등록생 목록(26년3월)', '등록생 목록(26년4월)', '등록생 목록(26년12월)', '다른 시트'], date);
    expect(ranges.map(range => range.range)).toEqual(["'등록생 목록(26년3월)'!B3:H", "'등록생 목록(26년4월)'!B3:O", "'등록생 목록(26년12월)'!B3:O"]);
    const rows = registrationsFromRanges(ranges.slice(0, 1), [{ values: [['과거', '2', '수1금1', '', '', '260301', '260401'], ['정지', '', '', '', '', '', '3회']] }]);
    expect(rows.map(row => row.이름)).toEqual(['정지']);
    expect(rows[0]).not.toHaveProperty('핸드폰');
    expect(() => registrationsFromRanges(ranges, [])).toThrow('Incomplete');
  });
});

describe('daily source cache', () => {
  it('shares concurrent requests, refresh bypasses complete cache, and failures never become an empty successful day', async () => {
    let time = 0;
    const readSource = vi.fn(async () => daily());
    const load = createDailySnapshotLoader({ readSource, now: () => time });
    await Promise.all([load(date), load(date)]);
    expect(readSource).toHaveBeenCalledTimes(1);
    await load(date); expect(readSource).toHaveBeenCalledTimes(1);
    await load(date, { refresh: true }); expect(readSource).toHaveBeenCalledTimes(2);
    time = 60001; readSource.mockRejectedValueOnce(new Error('private payload'));
    await expect(load(date)).rejects.toThrow('private payload');
    await load(date); expect(readSource).toHaveBeenCalledTimes(4);
  });
  it('queues one fresh shared read when a post-write refresh arrives during an older read', async () => {
    let release;
    const readSource = vi.fn().mockImplementationOnce(() => new Promise(resolve => { release = resolve; }))
      .mockResolvedValueOnce(daily({ registrations: [] }));
    const load = createDailySnapshotLoader({ readSource });
    const old = load(date);
    await Promise.resolve();
    const freshA = load(date, { refresh: true });
    const freshB = load(date, { refresh: true });
    release(daily());
    expect(first(await old).lastNames).toEqual(['마지막']);
    expect(first(await freshA).lastNames).toEqual([]);
    expect(await freshB).toEqual(await freshA);
    expect(readSource).toHaveBeenCalledTimes(2);
  });
  it('does not resurrect a pre-renewal cache after a forced refresh fails', async () => {
    const readSource = vi.fn().mockResolvedValueOnce(daily())
      .mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(daily({ registrations: [] }));
    const load = createDailySnapshotLoader({ readSource });
    await load(date);
    await expect(load(date, { refresh: true })).rejects.toThrow('offline');
    expect(first(await load(date)).lastNames).toEqual([]);
    expect(readSource).toHaveBeenCalledTimes(3);
  });
});

it('reads active absenceRequests and date-bounded holdings with field projections and no source writes', async () => {
  const queries = [];
  const db = { collection: collection => {
    const query = { collection, conditions: [], fields: [] };
    queries.push(query);
    const chain = { where: (...condition) => { query.conditions.push(condition); return chain; },
      select: (...fields) => { query.fields = fields; return chain; }, get: async () => ({ docs: [] }) };
    return chain;
  } };
  const batchGet = vi.fn(async () => ({ data: { valueRanges: [{ values: [] }] } }));
  const lib = require('./_coachRenewalLib');
  const context = { module: { exports: {} }, process: { env: { GOOGLE_CLIENT_EMAIL: 'fixture', GOOGLE_PRIVATE_KEY: 'fixture', GOOGLE_SHEETS_ID: 'fixture' } }, require: name => {
    if (name === 'firebase-admin/app') return { getApps: () => [{}] };
    if (name === 'firebase-admin/firestore') return { getFirestore: () => db };
    if (name === '@googleapis/sheets') return { sheets: () => ({ spreadsheets: {
      get: async () => ({ data: { sheets: [{ properties: { title: '등록생 목록(26년10월)' } }] } }), values: { batchGet },
    } }), auth: { GoogleAuth: function () {} } };
    if (name.endsWith('mockData.js')) return { PERIODS, KOREAN_HOLIDAYS: {} };
    if (name === './_coachRenewalLib') return lib;
    throw new Error(name);
  } };
  vm.runInNewContext(readFileSync(new URL('_coachRenewalSource.js', import.meta.url), 'utf8'), context);
  await context.module.exports.readDailySource(date);
  expect(queries.find(query => query.collection === 'absenceRequests')?.conditions).toEqual([['date', '==', date], ['status', '==', 'active']]);
  expect(queries.some(query => query.collection === 'absences')).toBe(false);
  expect(queries.find(query => query.collection === 'holdingRequests')?.conditions).toEqual([['endDate', '>=', date]]);
  expect(queries.every(query => query.fields.length > 0)).toBe(true);
  expect(batchGet.mock.calls[0][0].ranges).toEqual(["'등록생 목록(26년10월)'!B3:O"]);
});

function endpointHarness() {
  const auth = vi.fn(async () => null);
  const load = vi.fn(async () => plan());
  const context = { exports: {}, console: { error: vi.fn() }, Date, require: name => {
    if (name === './_requireCoach') return { requireCoach: auth };
    if (name === './_coachRenewalSource') return { loadDailySnapshot: load };
    if (name.endsWith('coachRenewalReminder.js')) return { getCoachReminderClock };
    throw new Error(name);
  } };
  vm.runInNewContext(readFileSync(new URL('coach-renewal.js', import.meta.url), 'utf8'), context);
  return { run: override => context.exports.handler({ httpMethod: 'GET', headers: {}, ...override }), auth, load };
}

describe('coach-only daily endpoint', () => {
  it('checks coach authorization before every read, including warm calls', async () => {
    const h = endpointHarness();
    h.auth.mockResolvedValueOnce(401).mockResolvedValueOnce(403);
    expect((await h.run()).statusCode).toBe(401);
    expect((await h.run()).statusCode).toBe(403);
    expect(h.load).not.toHaveBeenCalled();
    expect((await h.run({ queryStringParameters: { refresh: '1' } })).statusCode).toBe(200);
    expect(h.load.mock.calls[0][1]).toEqual({ refresh: true });
    expect(h.auth).toHaveBeenCalledTimes(3);
  });
  it('handles preflight/wrong method, returns private no-store and sanitizes failures', async () => {
    const h = endpointHarness();
    expect((await h.run({ httpMethod: 'OPTIONS' })).statusCode).toBe(200);
    expect((await h.run({ httpMethod: 'POST' })).statusCode).toBe(405);
    expect(h.auth).not.toHaveBeenCalled();
    h.load.mockRejectedValueOnce(new Error('private student and token'));
    const failed = await h.run();
    expect(failed.statusCode).toBe(503); expect(failed.body).not.toContain('private student');
    expect(failed.headers['Cache-Control']).toBe('private, no-store');
  });
});
