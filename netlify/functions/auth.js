const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { deriveUid, hashPassword, verifyPassword } = require('./_authLib');

// 지연 초기화 — 모듈 로드 시 환경변수 없어도 require 통과, handler 진입 후 초기화
// firebase-admin v14 modular API: getApps() / cert() / initializeApp()
function ensureAdmin() {
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        // Netlify는 줄바꿈을 \n 문자열로 저장 → 실제 개행으로 복원
        privateKey: (process.env.FIREBASE_ADMIN_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      }),
    });
  }
}

// 비번 검증: userSecrets bcrypt 해시만. (평문 폴백은 Phase C에서 제거 — 전원 마이그레이션 완료)
async function checkPassword(name, password) {
  const db = getFirestore();
  const secretSnap = await db.collection('userSecrets').doc(name).get();
  if (secretSnap.exists && secretSnap.data().hash) {
    return verifyPassword(password, secretSnap.data().hash);
  }
  return false;
}

async function getUser(name) {
  const db = getFirestore();
  const snap = await db.collection('users').doc(name).get();
  return snap.exists ? snap.data() : null;
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  let path = event.path.replace('/.netlify/functions/auth', '');
  if (path.startsWith('/')) path = path.substring(1);

  const json = (statusCode, obj) => ({ statusCode, headers, body: JSON.stringify(obj) });

  try {
    if (!process.env.FIREBASE_ADMIN_PRIVATE_KEY) {
      return json(500, { success: false, error: 'Firebase Admin 환경변수가 설정되지 않았습니다.' });
    }

    ensureAdmin();

    // POST /auth/login
    if (event.httpMethod === 'POST' && path === 'login') {
      const { name, password } = JSON.parse(event.body || '{}');
      if (!name || !password) return json(400, { success: false, error: '이름과 비밀번호는 필수입니다.' });

      const user = await getUser(name);
      if (!user) return json(401, { success: false, error: '등록되지 않은 계정입니다.' });

      const ok = await checkPassword(name, password);
      if (!ok) return json(401, { success: false, error: '비밀번호가 올바르지 않습니다.' });

      const isCoach = user.isCoach || false;
      const token = await getAuth().createCustomToken(deriveUid(name), { isCoach, name });
      return json(200, { success: true, token, isCoach });
    }

    // POST /auth/set-password  (코치 인증 후 학생 비번 설정/초기화)
    if (event.httpMethod === 'POST' && path === 'set-password') {
      const { coachName, coachPassword, targetName, newPassword } =
        JSON.parse(event.body || '{}');
      if (!coachName || !coachPassword || !targetName || !newPassword) {
        return json(400, { success: false, error: '필수 파라미터 누락' });
      }
      // ponytail: 코치를 매 호출 비번으로 재인증. 잦아지면 Firebase ID 토큰(verifyIdToken+isCoach 클레임)으로 교체.
      const coach = await getUser(coachName);
      if (!coach || !coach.isCoach) return json(403, { success: false, error: '코치 권한이 없습니다.' });
      const coachOk = await checkPassword(coachName, coachPassword);
      if (!coachOk) return json(401, { success: false, error: '코치 비밀번호가 올바르지 않습니다.' });

      const hash = await hashPassword(newPassword);
      const db = getFirestore();
      await db.collection('userSecrets').doc(targetName).set(
        { hash, updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      );
      return json(200, { success: true });
    }

    // POST /auth/change-password  (본인 현재 비번 재검증 후 변경 — 평문 미사용)
    if (event.httpMethod === 'POST' && path === 'change-password') {
      const { name, currentPassword, newPassword } = JSON.parse(event.body || '{}');
      if (!name || !currentPassword || !newPassword) {
        return json(400, { success: false, error: '필수 파라미터 누락' });
      }
      const ok = await checkPassword(name, currentPassword);
      if (!ok) return json(401, { success: false, error: '현재 비밀번호가 올바르지 않습니다.' });
      const hash = await hashPassword(newPassword);
      const db = getFirestore();
      await db.collection('userSecrets').doc(name).set(
        { hash, updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      );
      return json(200, { success: true });
    }

    return json(404, { error: 'Not found' });
  } catch (error) {
    console.error('auth function error:', error);
    return json(500, { success: false, error: error.message });
  }
};
