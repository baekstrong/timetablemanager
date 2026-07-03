/**
 * 관리자봇 업데이트 공지 게시 스크립트
 *
 * 사용법: node --env-file=.env scripts/post-update-notice.js "제목" "본문" [--unpin-old | --add]
 *
 * 동작:
 * 1. 기존 author='관리자봇' 공지 처리 (택1)
 *    - (기본)        소프트 삭제 → 게시판에서 사라짐, 최신 1건만 유지
 *    - --unpin-old   고정만 해제(pinned:false) → 글·notice 카테고리 유지, 상단 고정에서만 내림 (권장·백관장 선호)
 *    - --add         아무것도 안 함, 1건 추가만
 * 2. 새 공지를 notice 카테고리로 등록 (앱의 createPost와 동일 스키마)
 *
 * ※ 반드시 백관장 승인 후 실행할 것 (CLAUDE.md '업데이트 공지 규칙' 참고)
 */
import { initializeApp } from 'firebase/app';
import {
    getFirestore, collection, query, where, getDocs,
    updateDoc, addDoc, doc, serverTimestamp,
} from 'firebase/firestore';

const args = process.argv.slice(2);
const addOnly = args.includes('--add');       // 기존 공지 그대로, 1건만 추가
const unpinOld = args.includes('--unpin-old'); // 기존 공지 고정만 해제(삭제 X), 그 후 1건 추가
const [title, content] = args.filter(a => !a.startsWith('--'));
if (!title || !content) {
    console.error('사용법: node --env-file=.env scripts/post-update-notice.js "제목" "본문" [--add]');
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

// 1. 기존 관리자봇 공지 전체 소프트 삭제 (--add 면 건너뜀)
// (isUpdateNotice 필드로 거르지 않음 — 앱에서 직접 작성한 예전 관리자봇 공지에는
//  이 필드가 없어 안 내려가는 문제가 있었음. 관리자봇 글은 항상 최신 1건만 유지한다.)
if (addOnly) {
    console.log('--add: 기존 공지를 그대로 두고 1건만 추가합니다.');
} else {
    const existing = await getDocs(query(
        collection(db, 'posts'),
        where('author', '==', '관리자봇'),
    ));
    for (const d of existing.docs) {
        const data = d.data();
        if (data.deleted) continue;
        if (unpinOld) {
            // 삭제하지 않고 상단 고정만 해제 → 글·notice 카테고리는 유지되어 게시판에 계속 보임
            if (data.category === 'notice' && data.pinned === true) {
                await updateDoc(doc(db, 'posts', d.id), { pinned: false, updatedAt: serverTimestamp() });
                console.log(`기존 공지 고정 해제(글 유지): "${data.title}" (${d.id})`);
            }
        } else {
            await updateDoc(doc(db, 'posts', d.id), { deleted: true, updatedAt: serverTimestamp() });
            console.log(`기존 공지 내림(삭제): "${data.title}" (${d.id})`);
        }
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
