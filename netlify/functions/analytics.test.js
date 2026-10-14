import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { computeStampStats } from '../../public/training-log/js/modules/stamp-logic.js';
const require = createRequire(import.meta.url);
const { monthBounds, summarizeMonthlyRecords, createMonthlyLoader } = require('./_monthlySummary.js');
const sets = [{ intensity: { unit: 'kg', value: '12.5' }, reps: { unit: '회', value: '8' } }];

function harness() {
  const get = vi.fn(async () => ({ docs: [{ data: () => ({ userName: 'fixture', date: '2026-09-01', sets, memo: 'never transmitted' }) }] }));
  const query = { where: vi.fn(() => query), select: vi.fn(() => query), get };
  const collection = vi.fn(() => query);
  const verify = vi.fn(async () => ({ uid: 'fixture', name: 'fixture', isCoach: false }));
  const context = { exports: {}, process: { env: {} }, require: name => {
    if (name === 'firebase-admin/app') return { getApps: () => [{}] };
    if (name === 'firebase-admin/auth') return { getAuth: () => ({ verifyIdToken: verify }) };
    if (name === 'firebase-admin/firestore') return { getFirestore: () => ({ collection }) };
    if (name === './_monthlySummary') return { monthBounds, createMonthlyLoader };
    throw new Error(name);
  } };
  vm.runInNewContext(readFileSync(new URL('analytics.js', import.meta.url), 'utf8'), context);
  const run = (overrides = {}) => context.exports.handler({ httpMethod: 'GET', path: '/.netlify/functions/analytics/monthly', headers: { authorization: 'Bearer fixture-token' }, queryStringParameters: { month: '2026-09' }, ...overrides });
  return { run, get, query, collection, verify };
}

describe('monthly record aggregation', () => {
  it('preserves document count, distinct days and kg×reps without counting freeworkout or distinct exercises', () => {
    const records = [
      { userName: 'A', date: '2026-09-01', sets }, { userName: 'A', date: '2026-09-01', sets },
      { userName: 'A', date: '2026-09-02', sets: [{ intensity: { unit: 'kg', value: 'bad' }, reps: { unit: '회', value: '4' } }] },
      { userName: 'B', date: '2026-09-03', sets: [{ intensity: { unit: '맨몸', value: 10 }, reps: { unit: '회', value: 20 } }] },
      { userName: 'B', date: '2026-09-04', sets: null },
      { userName: 'A', date: '2026-10-01', sets }, { date: '2026-09-04', sets },
    ];
    const rows = summarizeMonthlyRecords(records, '2026-09');
    expect(rows).toEqual([
      { userName: 'A', trainingDays: 2, activeDays: 2, volume: 200, totalExercises: 3, avgExercises: 1.5 },
      { userName: 'B', trainingDays: 2, activeDays: 2, volume: 0, totalExercises: 2, avgExercises: 1 },
    ]);
    expect(computeStampStats(records.slice(0, 3))).toEqual({ activeDays: rows[0].activeDays, totalExercises: rows[0].totalExercises, avgExercises: rows[0].avgExercises });
    expect(monthBounds('2026-12')).toEqual({ start: '2026-12-01', end: '2027-01-01' });
    expect(monthBounds('2026-13')).toBeNull();
  });
  it('shares concurrent work and warm results, permits refresh and never caches failed reads', async () => {
    let time = 0; let reject;
    const readRecords = vi.fn().mockImplementationOnce(() => new Promise((_, r) => { reject = r; })).mockResolvedValue([]);
    const load = createMonthlyLoader({ readRecords, now: () => time });
    const a = load('2026-09'); const b = load('2026-09');
    const checks = [expect(a).rejects.toThrow('offline'), expect(b).rejects.toThrow('offline')];
    await Promise.resolve(); reject(new Error('offline')); await Promise.all(checks);
    expect(readRecords).toHaveBeenCalledTimes(1);
    await load('2026-09'); await load('2026-09'); expect(readRecords).toHaveBeenCalledTimes(2);
    time = 60_001; await load('2026-09'); expect(readRecords).toHaveBeenCalledTimes(3);
    await load('2026-09', { refresh: true }); expect(readRecords).toHaveBeenCalledTimes(4);
  });
});

describe('read-only authenticated endpoint', () => {
  it('rejects missing/invalid authorization before database reads and on warm cache hits', async () => {
    const h = harness();
    expect((await h.run({ headers: {} })).statusCode).toBe(401); expect(h.get).not.toHaveBeenCalled();
    expect((await h.run()).statusCode).toBe(200);
    h.verify.mockRejectedValueOnce(new Error('revoked'));
    expect((await h.run()).statusCode).toBe(401); expect(h.get).toHaveBeenCalledTimes(1);
  });
  it('returns only compact aggregates and uses a bounded field projection, shared on warm reads', async () => {
    const h = harness(); const result = await h.run();
    await h.run();
    expect(h.verify).toHaveBeenCalledTimes(2); expect(h.get).toHaveBeenCalledTimes(1);
    expect(h.query.where.mock.calls).toEqual([['date', '>=', '2026-09-01'], ['date', '<', '2026-10-01']]);
    expect(h.query.select).toHaveBeenCalledWith('userName', 'date', 'sets');
    expect(result.headers['Cache-Control']).toBe('private, no-store');
    expect(JSON.parse(result.body).students[0].volume).toBe(100);
    expect(result.body).not.toContain('never transmitted'); expect(result.body).not.toContain('fixture-token'); expect(result.body).not.toContain('sets');
  });
  it('handles preflight, wrong method/path/month without reads', async () => {
    const h = harness();
    expect((await h.run({ httpMethod: 'OPTIONS' })).headers['Access-Control-Max-Age']).toBe('86400');
    expect((await h.run({ httpMethod: 'POST' })).statusCode).toBe(405);
    expect((await h.run({ path: '/.netlify/functions/analytics/anything' })).statusCode).toBe(404);
    expect((await h.run({ queryStringParameters: { month: '2026-13' } })).statusCode).toBe(400);
    expect(h.get).not.toHaveBeenCalled(); expect(h.verify).not.toHaveBeenCalled();
  });
  it('does not publish a successful empty month after database failure', async () => {
    const h = harness(); h.get.mockRejectedValueOnce(new Error('private backend payload'));
    const failed = await h.run(); expect(failed.statusCode).toBe(503); expect(failed.body).not.toContain('private backend payload');
    expect((await h.run()).statusCode).toBe(200); expect(h.get).toHaveBeenCalledTimes(2);
  });
});
