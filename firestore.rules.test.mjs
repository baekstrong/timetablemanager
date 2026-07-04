// Firestore 보안 규칙 테스트 — 본인(학생)/코치/비로그인 3개 시나리오.
//
// ⚠️ 일반 `npm test`(vitest run)에 포함되지 않음. Firestore 에뮬레이터가 필요하다.
// 실행:
//   1) 최초 1회:  npm i -D @firebase/rules-unit-testing firebase-tools
//                 (+ Java 17+ 설치 필요 — 에뮬레이터 런타임)
//   2) 실행:      npx firebase emulators:exec --only firestore --project demo-strength \
//                   "npx vitest run firestore.rules.test.mjs"
//
// 목적: 규칙이 (a) 비인증의 전체 덤프를 차단하고, (b) 앱이 실제 쓰는 모든 접근을
//       인증 사용자에게 허용하며, (c) userSecrets 를 전면 봉인하는지 검증.

import { readFileSync } from 'fs';
import { beforeAll, afterAll, beforeEach, describe, it } from 'vitest';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc,
  collection, getDocs, addDoc,
} from 'firebase/firestore';

let testEnv;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-strength',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterAll(async () => { await testEnv?.cleanup(); });

// 매 테스트 전 규칙 우회로 시드 주입
beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'userSecrets', '홍길동'), { hash: '$2a$10$abc' });
    await setDoc(doc(db, 'users', '홍길동'), { isCoach: false, tier: 'core' });
    await setDoc(doc(db, 'users', '김코치'), { isCoach: true });
    await setDoc(doc(db, 'holidays', 'h1'), { date: '2026-07-04' });
    await setDoc(doc(db, 'disabledClasses', '월-1'), { off: true });
    await setDoc(doc(db, 'entranceClasses', 'e1'), { when: '7월' });
    await setDoc(doc(db, 'registrationFAQ', 'f1'), { q: 'x' });
    await setDoc(doc(db, 'newStudentRegistrations', 'r1'), { name: '신규', status: 'pending' });
    await setDoc(doc(db, 'makeupRequests', 'm1'), { userName: '홍길동', status: 'active' });
    await setDoc(doc(db, 'records', 'rec1'), { userName: '홍길동' });
    await setDoc(doc(db, 'posts', 'p1'), { authorName: '홍길동', title: 't' });
    await setDoc(doc(db, 'posts', 'p1', 'comments', 'c1'), { authorName: '홍길동' });
  });
});

const student = () => testEnv.authenticatedContext('u_hong', { name: '홍길동', isCoach: false }).firestore();
const coach   = () => testEnv.authenticatedContext('u_coach', { name: '김코치', isCoach: true }).firestore();
const anon    = () => testEnv.unauthenticatedContext().firestore();

// ─────────────────────────────────────────────────────────────
describe('비로그인(anon) — 덤프 차단 + 신규등록 funnel만 허용', () => {
  it('신규등록 funnel 공개 read 허용', async () => {
    const db = anon();
    await assertSucceeds(getDoc(doc(db, 'holidays', 'h1')));
    await assertSucceeds(getDoc(doc(db, 'disabledClasses', '월-1')));
    await assertSucceeds(getDoc(doc(db, 'entranceClasses', 'e1')));
    await assertSucceeds(getDoc(doc(db, 'registrationFAQ', 'f1')));
    await assertSucceeds(getDoc(doc(db, 'newStudentRegistrations', 'r1')));
  });

  it('신규 신청 create/update 허용', async () => {
    const db = anon();
    await assertSucceeds(setDoc(doc(db, 'newStudentRegistrations', 'r2'), { name: '새신규', status: 'pending' }));
    await assertSucceeds(updateDoc(doc(db, 'newStudentRegistrations', 'r1'), { memo: 'x' }));
  });

  it('users / userSecrets / 운영 컬렉션 read 전면 차단', async () => {
    const db = anon();
    await assertFails(getDoc(doc(db, 'users', '홍길동')));
    await assertFails(getDocs(collection(db, 'users')));       // 예전엔 전체 덤프됐던 경로
    await assertFails(getDoc(doc(db, 'userSecrets', '홍길동')));
    await assertFails(getDoc(doc(db, 'makeupRequests', 'm1')));
    await assertFails(getDoc(doc(db, 'posts', 'p1')));
    await assertFails(getDoc(doc(db, 'records', 'rec1')));
  });
});

// ─────────────────────────────────────────────────────────────
describe('학생 본인(홍길동) — 앱이 쓰는 접근 허용, 코치권한/서버시크릿 차단', () => {
  it('users broad read(뱃지 getDocs) 허용', async () => {
    const db = student();
    await assertSucceeds(getDoc(doc(db, 'users', '김코치')));
    await assertSucceeds(getDocs(collection(db, 'users')));
  });

  it('운영/훈련일지/게시판 read·write 허용', async () => {
    const db = student();
    await assertSucceeds(getDoc(doc(db, 'makeupRequests', 'm1')));
    await assertSucceeds(setDoc(doc(db, 'makeupRequests', 'm2'), { userName: '홍길동' }));
    await assertSucceeds(setDoc(doc(db, 'records', 'rec2'), { userName: '홍길동' }));
    await assertSucceeds(setDoc(doc(db, 'personalBests', '홍길동__스쿼트'), { userName: '홍길동' }));
    await assertSucceeds(addDoc(collection(db, 'posts'), { authorName: '홍길동' }));
    await assertSucceeds(updateDoc(doc(db, 'posts', 'p1'), { likes: 1 }));   // 좋아요(비작성자 update)
    await assertSucceeds(setDoc(doc(db, 'posts', 'p1', 'comments', 'c2'), { authorName: '홍길동' }));
  });

  it('userSecrets read 차단 / users write(코치 전용) 차단', async () => {
    const db = student();
    await assertFails(getDoc(doc(db, 'userSecrets', '홍길동')));
    await assertFails(setDoc(doc(db, 'users', '김코치'), { hacked: true }));
  });
});

// ─────────────────────────────────────────────────────────────
describe('코치(김코치) — 계정 쓰기 허용, 서버시크릿은 코치도 차단', () => {
  it('users read/write 허용', async () => {
    const db = coach();
    await assertSucceeds(getDocs(collection(db, 'users')));
    await assertSucceeds(updateDoc(doc(db, 'users', '홍길동'), { tier: 'iron' }));
  });

  it('운영 컬렉션 read/write + 신규신청 delete 허용', async () => {
    const db = coach();
    await assertSucceeds(setDoc(doc(db, 'holidays', 'h2'), { date: '2026-07-05' }));
    await assertSucceeds(setDoc(doc(db, 'makeupRequests', 'm3'), { userName: '홍길동' }));
    await assertSucceeds(deleteDoc(doc(db, 'newStudentRegistrations', 'r1')));
  });

  it('userSecrets 는 코치도 read/write 차단(서버 Admin 전용)', async () => {
    const db = coach();
    await assertFails(getDoc(doc(db, 'userSecrets', '홍길동')));
    await assertFails(setDoc(doc(db, 'userSecrets', '홍길동'), { hash: 'x' }));
  });
});
