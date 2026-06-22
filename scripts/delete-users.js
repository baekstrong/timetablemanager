/**
 * 계정(및 관련 데이터) 삭제 — 명시한 이름만. 인자로 받은 이름 외에는 절대 건드리지 않는다.
 * 사용법: node --env-file=.env scripts/delete-users.js "이름1" "이름2" ...
 *
 * 각 이름에 대해 삭제: users, coachPinnedMemos, pinnedMemos, archivedMemos 문서 +
 * records / monthlyStamps 중 userName 일치 문서.
 * ※ 파괴적. 반드시 백관장 승인 후 실행.
 */
import { initializeApp } from 'firebase/app';
import {
    getFirestore, collection, query, where, getDocs, doc, deleteDoc, getDoc,
} from 'firebase/firestore';

const names = process.argv.slice(2).filter(a => !a.startsWith('--'));
if (names.length === 0) {
    console.error('사용법: node --env-file=.env scripts/delete-users.js "이름1" "이름2" ...');
    process.exit(1);
}

const app = initializeApp({
    apiKey: process.env.VITE_FIREBASE_API_KEY,
    authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.VITE_FIREBASE_PROJECT_ID,
    appId: process.env.VITE_FIREBASE_APP_ID,
});
const db = getFirestore(app);

for (const name of names) {
    // 존재 확인
    const userSnap = await getDoc(doc(db, 'users', name));
    if (!userSnap.exists()) {
        console.log(`⏭️  "${name}" — users 문서 없음, 건너뜀`);
        continue;
    }
    // 이름 키 기반 문서
    for (const c of ['users', 'coachPinnedMemos', 'pinnedMemos', 'archivedMemos']) {
        await deleteDoc(doc(db, c, name)).catch(() => {});
    }
    // userName 필드 기반 문서
    for (const c of ['records', 'monthlyStamps']) {
        const snap = await getDocs(query(collection(db, c), where('userName', '==', name)));
        for (const d of snap.docs) await deleteDoc(d.ref);
        if (snap.size) console.log(`   ${c}: ${snap.size}건 삭제`);
    }
    console.log(`🗑️  "${name}" 삭제 완료`);
}
console.log(`\n총 ${names.length}개 처리.`);
process.exit(0);
