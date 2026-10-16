/* global require, exports */
const { requireCoach } = require('./_requireCoach');
const { loadDailySnapshot } = require('./_coachRenewalSource');
const { getCoachReminderClock } = require('../../public/shared/coachRenewalReminder.js');

exports.handler = async event => {
  const headers = {
    'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Max-Age': '86400',
    'Cache-Control': 'private, no-store', 'Content-Type': 'application/json; charset=utf-8',
  };
  const json = (statusCode, value) => ({ statusCode, headers, body: JSON.stringify(value) });
  if (event.httpMethod === 'OPTIONS') return json(200, {});
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });
  try {
    const denied = await requireCoach(event);
    if (denied) return json(denied, { error: '코치 로그인이 필요합니다.' });
    const { date } = getCoachReminderClock(new Date());
    const snapshot = await loadDailySnapshot(date, { refresh: event.queryStringParameters?.refresh === '1' });
    return json(200, snapshot);
  } catch {
    // Never expose source rows, names, tokens, credentials or provider errors.
    console.error('coach-renewal daily source unavailable');
    return json(503, { error: '재등록 안내 대상을 불러오지 못했습니다. 다시 시도해주세요.' });
  }
};
