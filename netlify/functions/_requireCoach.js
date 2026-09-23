const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

exports.requireCoach = async (event, body = {}) => {
  const header = event.headers?.authorization || event.headers?.Authorization || '';
  // JSON 토큰은 이전 Content-Type 전용 CORS 배포와 호환하기 위한 경로다. 로그에 남기지 않는다.
  const token = header.match(/^Bearer\s+(.+)$/i)?.[1] || body.idToken;
  if (typeof token !== 'string' || !token) return 401;
  if (!getApps().length) {
    initializeApp({ credential: cert({
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey: (process.env.FIREBASE_ADMIN_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    }) });
  }
  let claims;
  try { claims = await getAuth().verifyIdToken(token, true); }
  catch { return 401; }
  return claims.isCoach === true ? null : 403;
};
