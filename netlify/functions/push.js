const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');
const { buildMessage, verifyPathFor } = require('./_pushLib');

// auth.js와 같은 지연 초기화 (환경변수도 그대로 재사용 — 새로 설정할 것 없음)
function ensureAdmin() {
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey: (process.env.FIREBASE_ADMIN_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      }),
    });
  }
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const json = (statusCode, obj) => ({ statusCode, headers, body: JSON.stringify(obj) });
  if (event.httpMethod !== 'POST') return json(405, { success: false, error: 'Method not allowed' });

  try {
    if (!process.env.FIREBASE_ADMIN_PRIVATE_KEY) {
      return json(500, { success: false, error: 'Firebase Admin 환경변수가 설정되지 않았습니다.' });
    }
    ensureAdmin();

    const bearer = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer\s+/i, '');
    if (!bearer) return json(401, { success: false, error: '로그인이 필요합니다.' });
    const decoded = await getAuth().verifyIdToken(bearer);
    const caller = { name: decoded.name || '', isCoach: decoded.isCoach === true };

    const req = JSON.parse(event.body || '{}');
    const db = getFirestore();

    // 공지 외에는 실제 문서를 읽어 대상·문구를 서버가 정한다 (클라이언트가 준 텍스트·수신자를 믿지 않음)
    const path = verifyPathFor(req);
    if (path === undefined) return json(400, { success: false, error: '필수 파라미터 누락' });
    const record = path ? (await db.doc(path.join('/')).get()).data() || null : null;

    const msg = buildMessage(req, caller, record);
    if (!msg) return json(400, { success: false, error: '잘못된 요청이거나 권한이 없습니다.' });

    // 공지 대상은 호출자가 넘긴 이름들 — 수강중 판정은 이미 시트를 들고 있는 클라이언트가 한다.
    // ponytail: 서버에 같은 판정 로직을 두 벌 만들지 않으려는 것. 공지는 드물어 이름 수만큼(≈62) read여도 무해.
    const names = [...new Set(msg.names.filter(Boolean))].slice(0, 500);
    const snaps = await db.getAll(...names.map((n) => db.collection('users').doc(n)));
    const targets = snaps
      .map((s) => ({ name: s.id, token: s.exists ? s.data().fcmToken : null }))
      .filter((t) => t.token);

    if (targets.length === 0) return json(200, { success: true, sent: 0, failed: 0, noTokens: true });

    const res = await getMessaging().sendEachForMulticast({
      tokens: targets.map((t) => t.token),
      data: { title: msg.title, body: msg.body, tag: msg.tag, url: msg.url },
      webpush: { headers: { Urgency: 'high', TTL: String(msg.ttl) } },
    });

    // 해지된 토큰은 지운다 (앱 삭제·알림 차단한 사람에게 매번 재시도하지 않게)
    const stale = res.responses
      .map((r, i) => (r.error?.code === 'messaging/registration-token-not-registered' ? targets[i].name : null))
      .filter(Boolean);
    await Promise.all(
      stale.map((n) => db.collection('users').doc(n).update({ fcmToken: FieldValue.delete() }).catch(() => {}))
    );

    return json(200, { success: true, sent: res.successCount, failed: res.failureCount });
  } catch (error) {
    console.error('push function error:', error);
    return json(500, { success: false, error: error.message });
  }
};
