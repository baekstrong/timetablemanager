// 1회용: users.password 평문 필드 제거 (해시는 userSecrets 에 있음).
// 실행: node scripts/drop-plaintext-passwords.cjs   (루트에 firebase-admin-key.json 필요)
//
// 가드: 해당 유저가 userSecrets 해시를 가진 경우에만 삭제한다.
//       (해시 없는 유저의 평문을 지우면 로그인 폴백까지 죽어 락아웃되므로 건너뛰고 경고)
const path = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

initializeApp({ credential: cert(require(path.join(__dirname, '..', 'firebase-admin-key.json'))) });
const db = getFirestore();

(async () => {
  const snap = await db.collection('users').get();
  let dropped = 0, alreadyClean = 0, skipped = 0;
  for (const d of snap.docs) {
    if (d.data().password === undefined) { alreadyClean++; continue; }
    const secret = await db.collection('userSecrets').doc(d.id).get();
    if (!secret.exists || !secret.data().hash) {
      console.warn(`⚠️  건너뜀(해시 없음 — 지우면 락아웃): ${d.id}`);
      skipped++;
      continue;
    }
    await d.ref.update({ password: FieldValue.delete() });
    dropped++;
  }
  console.log(`\n평문 제거 ${dropped}건 / 이미없음 ${alreadyClean} / 건너뜀(해시없음) ${skipped}`);
  process.exit(skipped > 0 ? 2 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
