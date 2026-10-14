/* global require, exports, process */
const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { monthBounds, createMonthlyLoader } = require('./_monthlySummary');

function ensureAdmin() {
  if (!getApps().length) initializeApp({ credential: cert({
    projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
    clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
    privateKey: (process.env.FIREBASE_ADMIN_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  }) });
}

const loadMonthly = createMonthlyLoader({ readRecords: async ({ start, end }) => {
  const snapshot = await getFirestore().collection('records')
    .where('date', '>=', start).where('date', '<', end)
    .select('userName', 'date', 'sets').get();
  return snapshot.docs.map(doc => doc.data());
} });

exports.handler = async event => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Cache-Control': 'private, no-store',
    'Content-Type': 'application/json',
  };
  const json = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });
  if (event.httpMethod === 'OPTIONS') return json(200, {});
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });
  if (event.path?.replace('/.netlify/functions/analytics', '').replace(/\/$/, '') !== '/monthly') return json(404, { error: 'Not found' });
  const month = event.queryStringParameters?.month;
  if (!monthBounds(month)) return json(400, { error: '월 형식을 확인해주세요.' });
  const token = (event.headers?.authorization || event.headers?.Authorization || '').match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return json(401, { error: '로그인이 필요합니다.' });
  try {
    ensureAdmin();
    // Existing records/ranking reads are available to signed-in students and coaches.
    // Verify each caller even on a cache hit; no public CDN/user-token cache is used.
    try { await getAuth().verifyIdToken(token, true); }
    catch { return json(401, { error: '로그인을 다시 확인해주세요.' }); }
    const result = await loadMonthly(month, { refresh: event.queryStringParameters?.refresh === '1' });
    return json(200, result);
  } catch {
    // No token, names, record bodies, or Admin exception payloads in logs/responses.
    return json(503, { error: '월별 기록을 불러오지 못했어요. 다시 시도해주세요.' });
  }
};
