/* global module */
// records only: stamp attendance must not include freeWorkoutAttendance or tier scores.
function monthBounds(month) {
  if (typeof month !== 'string' || !/^(20\d{2})-(0[1-9]|1[0-2])$/.test(month)) return null;
  const [year, number] = month.split('-').map(Number);
  return { start: `${month}-01`, end: number === 12 ? `${year + 1}-01-01` : `${year}-${String(number + 1).padStart(2, '0')}-01` };
}

function summarizeMonthlyRecords(records, month) {
  const bounds = monthBounds(month);
  if (!bounds) throw new Error('Invalid month');
  const byUser = new Map();
  const number = value => { const parsed = parseFloat(value); return Number.isNaN(parsed) ? 0 : parsed; };
  for (const record of records) {
    if (!record.userName || !record.date || record.date < bounds.start || record.date >= bounds.end) continue;
    if (!byUser.has(record.userName)) byUser.set(record.userName, { dates: new Set(), totalExercises: 0, volume: 0 });
    const row = byUser.get(record.userName);
    row.dates.add(record.date);
    row.totalExercises++;
    for (const set of Array.isArray(record.sets) ? record.sets : []) {
      if (set?.intensity?.unit === 'kg' && set?.reps?.unit === '회') {
        row.volume += number(set.intensity.value) * number(set.reps.value);
      }
    }
  }
  return [...byUser].map(([userName, row]) => ({
    userName,
    trainingDays: row.dates.size,
    activeDays: row.dates.size,
    totalExercises: row.totalExercises,
    avgExercises: Math.round(row.totalExercises / row.dates.size * 10) / 10,
    volume: Math.round(row.volume),
  }));
}

function createMonthlyLoader({ readRecords, now = Date.now, ttl = 60_000 }) {
  const cache = new Map();
  const inflight = new Map();
  return async (month, { refresh = false } = {}) => {
    const cached = cache.get(month);
    if (!refresh && cached && now() - cached.at < ttl) return cached.value;
    if (inflight.has(month)) return inflight.get(month);
    const request = Promise.resolve().then(() => readRecords(monthBounds(month))).then(records => {
      const at = now();
      const value = { month, generatedAt: new Date(at).toISOString(), students: summarizeMonthlyRecords(records, month) };
      cache.delete(month);
      cache.set(month, { at, value });
      while (cache.size > 24) cache.delete(cache.keys().next().value);
      return value;
    }).finally(() => { if (inflight.get(month) === request) inflight.delete(month); });
    inflight.set(month, request);
    return request;
  };
}

module.exports = { monthBounds, summarizeMonthlyRecords, createMonthlyLoader };
