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
    await setDoc(doc(db, 'recruitmentMonths', '2099-11'), { month: '2099-11', status: 'open', notice: '', inquiryPhone: '' });
    await setDoc(doc(db, 'recruitmentMonths', '2099-10'), { month: '2099-10', status: 'closed', notice: '', inquiryPhone: '' });
    await setDoc(doc(db, 'entranceClasses', 'nov-open'), { date: '2099-11-07', isActive: true, closed: false, maxCapacity: 6, currentCount: 1 });
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

  it('모집월 없는 구버전 신청은 거부하고 접수 문자 결과 갱신은 허용', async () => {
    const db = anon();
    await assertFails(setDoc(doc(db, 'newStudentRegistrations', 'r2'), { name: '새신규', status: 'pending' }));
    await assertSucceeds(updateDoc(doc(db, 'newStudentRegistrations', 'r1'), { 'smsLog.reception': { status: 'sent' } }));
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

describe('월별 모집의 서버 접수 차단', () => {
  const registration = { name: '예시', recruitmentMonth: '2099-11', status: 'pending', entranceClassId: 'nov-open', entranceDate: '2099-11-07', entranceInquiry: '', entranceInquiryReason: '' };
  it('비로그인도 열린 월의 입학반으로만 신청할 수 있다', async () => {
    await assertSucceeds(setDoc(doc(anon(), 'newStudentRegistrations', 'open-month'), registration));
  });
  it('설정은 비로그인·학생도 조회 가능하지만 코치만 수정 가능', async () => {
    await assertSucceeds(getDoc(doc(anon(), 'recruitmentMonths', '2099-11')));
    await assertFails(updateDoc(doc(anon(), 'recruitmentMonths', '2099-11'), { status: 'closed' }));
    await assertFails(updateDoc(doc(student(), 'recruitmentMonths', '2099-11'), { status: 'closed' }));
    await assertSucceeds(updateDoc(doc(coach(), 'recruitmentMonths', '2099-11'), { status: 'closed' }));
  });
  it('입력 중 코치가 마감하면 최종 서버 쓰기를 거부한다', async () => {
    await updateDoc(doc(coach(), 'recruitmentMonths', '2099-11'), { status: 'closed' });
    await assertFails(setDoc(doc(anon(), 'newStudentRegistrations', 'late-month'), registration));
  });
  it.each(['inquiry', 'closed'])('%s 상태에서는 접수를 거부한다', async status => {
    await updateDoc(doc(coach(), 'recruitmentMonths', '2099-11'), { status });
    await assertFails(setDoc(doc(anon(), 'newStudentRegistrations', 'no-apply'), registration));
  });
  it('미설정 월과 다른 달의 입학반 선택을 거부한다', async () => {
    await assertFails(setDoc(doc(anon(), 'newStudentRegistrations', 'unknown-month'), { ...registration, recruitmentMonth: '2099-12' }));
    await assertFails(setDoc(doc(anon(), 'newStudentRegistrations', 'wrong-month'), { ...registration, entranceDate: '2099-10-07' }));
  });
  it.each([{ closed: true }, { currentCount: 6 }, { isActive: false }, { date: '2099-11-14' }])('입학반 마감·만석·비활성·날짜 변경을 거부한다', async change => {
    await updateDoc(doc(coach(), 'entranceClasses', 'nov-open'), change);
    await assertFails(setDoc(doc(anon(), 'newStudentRegistrations', 'invalid-entrance'), registration));
  });
  it('다른 날 문의도 열린 월 안의 날짜와 사유가 필요하다', async () => {
    const inquiry = { ...registration, entranceClassId: null, entranceDate: '', entranceInquiry: '2099-11-14', entranceInquiryReason: '출장' };
    await assertSucceeds(setDoc(doc(anon(), 'newStudentRegistrations', 'inquiry'), inquiry));
    await assertFails(setDoc(doc(anon(), 'newStudentRegistrations', 'wrong-inquiry'), { ...inquiry, entranceInquiry: '2099-12-05' }));
    await assertFails(setDoc(doc(anon(), 'newStudentRegistrations', 'empty-reason'), { ...inquiry, entranceInquiryReason: '' }));
  });
  it('신청 생성 이후 모집월·신청 상태를 공개 수정으로 우회할 수 없다', async () => {
    const ref = doc(anon(), 'newStudentRegistrations', 'immutable-month');
    await setDoc(ref, registration);
    await assertFails(updateDoc(ref, { recruitmentMonth: '2099-10' }));
    await assertFails(updateDoc(ref, { status: 'approved' }));
    await assertSucceeds(updateDoc(ref, { 'smsLog.reception': { status: 'sent' } }));
  });
  it('코치 직접 등록과 기존 신청의 후속 처리는 유지한다', async () => {
    await assertSucceeds(setDoc(doc(coach(), 'newStudentRegistrations', 'direct-coach'), { name: '직접', status: 'approved', registeredByCoach: true }));
    await assertSucceeds(updateDoc(doc(coach(), 'newStudentRegistrations', 'r1'), { status: 'completed' }));
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

  it('본인 users 문서에 티어/학년 필드 갱신 허용(merge)', async () => {
    const db = student();
    await assertSucceeds(setDoc(doc(db, 'users', '홍길동'), { tier: 'iron', tierMonth: '2026-07', xp: 100 }, { merge: true }));
  });

  it('userSecrets 차단 / isCoach 자가승격 차단 / 타인 users 쓰기 차단', async () => {
    const db = student();
    await assertFails(getDoc(doc(db, 'userSecrets', '홍길동')));
    await assertFails(setDoc(doc(db, 'users', '홍길동'), { isCoach: true }, { merge: true }));   // 권한상승 차단
    await assertFails(setDoc(doc(db, 'users', '김코치'), { tier: 'iron' }, { merge: true }));      // 타인 문서 차단
  });
});

// ─────────────────────────────────────────────────────────────
describe('코치(김코치) — 계정 쓰기 허용, 서버시크릿은 코치도 차단', () => {
  it('users read/write/create 허용', async () => {
    const db = coach();
    await assertSucceeds(getDocs(collection(db, 'users')));
    await assertSucceeds(updateDoc(doc(db, 'users', '홍길동'), { tier: 'iron' }));
    await assertSucceeds(updateDoc(doc(db, 'users', '홍길동'), { isCoach: true }));   // 코치는 isCoach도 가능
    await assertSucceeds(setDoc(doc(db, 'users', '새학생'), { isCoach: false, createdAt: 1 })); // 계정 생성
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
