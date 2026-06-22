/**
 * 종료자 후보 조회 — 읽기 전용. 삭제하지 않는다.
 * 최근 6개 월별 시트(등록생 목록)의 이름(B열) 합집합에 없는 비코치 users를 후보로 출력.
 * 사용법: node --env-file=.env scripts/termination-candidates.js
 */
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';

const BASE = process.env.VITE_FUNCTIONS_URL;
if (!BASE) { console.error('VITE_FUNCTIONS_URL 누락'); process.exit(1); }

// 최근 6개 월별 시트명 (오늘 기준, 당월 포함)
const now = new Date();
const sheetNames = [];
for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const yy = String(d.getFullYear()).slice(-2);
    sheetNames.push(`등록생 목록(${yy}년${d.getMonth() + 1}월)`);
}

// 각 시트 B열(이름) 읽어 합집합
const active = new Set();
for (const name of sheetNames) {
    const range = `${name}!B3:B`;
    const res = await fetch(`${BASE}/read?range=${encodeURIComponent(range)}`);
    if (!res.ok) { console.log(`⚠️  ${name}: 읽기 실패(${res.status}) — 건너뜀`); continue; }
    const { values = [] } = await res.json();
    let n = 0;
    for (const row of values) {
        const v = (row?.[0] || '').trim();
        if (v && v !== '이름') { active.add(v); n++; }
    }
    console.log(`  ${name}: 이름 ${n}개`);
}
console.log(`\n활성 명단(합집합): ${active.size}명\n`);

// users (비코치, 관리자봇 제외)
const app = initializeApp({
    apiKey: process.env.VITE_FIREBASE_API_KEY,
    authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.VITE_FIREBASE_PROJECT_ID,
    appId: process.env.VITE_FIREBASE_APP_ID,
});
const db = getFirestore(app);
const snap = await getDocs(collection(db, 'users'));

const candidates = [];
for (const d of snap.docs) {
    const u = d.data();
    if (u.isCoach || d.id === '관리자봇') continue;
    if (!active.has(d.id)) {
        const ts = u.createdAt?.toDate?.();
        candidates.push({ name: d.id, created: ts ? ts.toISOString().slice(0, 10) : '?' });
    }
}
candidates.sort((a, b) => a.created.localeCompare(b.created));

console.log(`=== 종료자 후보 (최근 6개월 시트에 없음): ${candidates.length}명 ===`);
for (const c of candidates) console.log(`  ${c.created}  ${c.name}`);
console.log(`\n※ 이름 정확일치 비교. 오타/동명이인 가능 → 검토 후 삭제할 이름만 delete-users.js로.`);
process.exit(0);
