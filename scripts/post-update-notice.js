/**
 * 관리자봇 업데이트 공지 게시 스크립트
 *
 * 사용법: node --env-file=.env scripts/post-update-notice.js "제목" "본문"
 *
 * 동작:
 * 1. posts에서 author='관리자봇' && isUpdateNotice=true인 기존 공지를 소프트 삭제
 * 2. 새 공지를 notice 카테고리로 등록 (앱의 createPost와 동일 스키마)
 *
 * ※ 반드시 백관장 승인 후 실행할 것 (CLAUDE.md '업데이트 공지 규칙' 참고)
 */
import { initializeApp } from 'firebase/app';
import {
    getFirestore, collection, query, where, getDocs,
    updateDoc, addDoc, doc, serverTimestamp,
} from 'firebase/firestore';

const [title, content] = process.argv.slice(2);
if (!title || !content) {
    console.error('사용법: node --env-file=.env scripts/post-update-notice.js "제목" "본문"');
    process.exit(1);
}

const required = ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID'];
const missing = required.filter(k => !process.env[k]);
if (missing.length > 0) {
    console.error(`환경변수 누락: ${missing.join(', ')} — node --env-file=.env 로 실행했는지 확인하세요.`);
    process.exit(1);
}

const app = initializeApp({
    apiKey: process.env.VITE_FIREBASE_API_KEY,
    authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.VITE_FIREBASE_APP_ID,
});
const db = getFirestore(app);

// 1. 기존 관리자봇 업데이트 공지 소프트 삭제
const existing = await getDocs(query(
    collection(db, 'posts'),
    where('author', '==', '관리자봇'),
    where('isUpdateNotice', '==', true),
));
for (const d of existing.docs) {
    if (!d.data().deleted) {
        await updateDoc(doc(db, 'posts', d.id), { deleted: true, updatedAt: serverTimestamp() });
        console.log(`기존 공지 내림: "${d.data().title}" (${d.id})`);
    }
}

// 2. 새 공지 등록 (PostForm 작성 글과 동일 스키마)
// isCoach: 작성자 이름 하늘색 표시, pinned: 공지 노란 배경 + 상단 고정
const ref = await addDoc(collection(db, 'posts'), {
    title,
    content,
    category: 'notice',
    author: '관리자봇',
    isCoach: true,
    pinned: true,
    isUpdateNotice: true,
    images: [],
    likes: [],
    commentCount: 0,
    deleted: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
});
console.log(`✅ 새 업데이트 공지 등록 완료: "${title}" (${ref.id})`);
process.exit(0);
