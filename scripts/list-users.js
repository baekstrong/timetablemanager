/**
 * users 컬렉션 감사용 — 읽기 전용. 전체 계정을 createdAt 순으로 출력.
 * 사용법: node --env-file=.env scripts/list-users.js
 */
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';

const app = initializeApp({
    apiKey: process.env.VITE_FIREBASE_API_KEY,
    authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.VITE_FIREBASE_PROJECT_ID,
    appId: process.env.VITE_FIREBASE_APP_ID,
});
const db = getFirestore(app);

const snap = await getDocs(collection(db, 'users'));
const rows = snap.docs.map(d => {
    const u = d.data();
    const ts = u.createdAt?.toDate?.();
    return { name: d.id, isCoach: !!u.isCoach, created: ts ? ts.toISOString().slice(0, 10) : '?' };
});
rows.sort((a, b) => a.created.localeCompare(b.created));
console.log(`총 ${rows.length}명\n`);
for (const r of rows) {
    console.log(`${r.isCoach ? '👨‍🏫' : '  '} ${r.created}  ${r.name}`);
}
process.exit(0);
