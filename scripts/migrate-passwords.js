// 1회용: 평문 users.password → bcrypt userSecrets/{name}.hash
// 실행: node scripts/migrate-passwords.js   (루트에 firebase-admin-key.json 필요)
const path = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { hashPassword } = require('../netlify/functions/_authLib');

const serviceAccount = require(path.join(__dirname, '..', 'firebase-admin-key.json'));
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

async function main() {
  const usersSnap = await db.collection('users').get();
  let migrated = 0, skipped = 0, noPw = 0;
  for (const userDoc of usersSnap.docs) {
    const name = userDoc.id;
    const password = userDoc.data().password;
    if (!password) { noPw++; continue; }
    const secretSnap = await db.collection('userSecrets').doc(name).get();
    if (secretSnap.exists && secretSnap.data().hash) { skipped++; continue; }
    const hash = await hashPassword(String(password));
    await db.collection('userSecrets').doc(name).set(
      { hash, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    migrated++;
    console.log(`✓ ${name}`);
  }
  console.log(`\n완료 — 신규 해시 ${migrated}, 이미존재 ${skipped}, 비번없음 ${noPw}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
