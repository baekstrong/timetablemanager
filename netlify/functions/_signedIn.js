/* global require, exports, process */
const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

function ensureAdmin() {
  if (!getApps().length) {
    initializeApp({ credential: cert({
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey: (process.env.FIREBASE_ADMIN_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    }) });
  }
}

exports.adminFirestore = () => { ensureAdmin(); return getFirestore(); };

/**
 * 앱에 로그인한 사람(코치·수강생)인지 확인한다. readCaller → { status: 'ok'|'missing'|'invalid', claims },
 * checkSignedIn → status만.
 * 폐기 여부 확인(checkRevoked)은 요청마다 왕복이 늘어서 하지 않는다 — 서명·만료만 본다.
 */
exports.readCaller = async (event, verify) => {
  const header = event.headers?.authorization || event.headers?.Authorization || '';
  const token = header.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return { status: 'missing' };
  try {
    let claims;
    if (verify) claims = await verify(token);
    else { ensureAdmin(); claims = await getAuth().verifyIdToken(token); }
    return typeof claims.name === 'string' && claims.name ? { status: 'ok', claims } : { status: 'invalid' };
  } catch {
    return { status: 'invalid' };
  }
};

exports.checkSignedIn = async (event, verify) => (await exports.readCaller(event, verify)).status;
