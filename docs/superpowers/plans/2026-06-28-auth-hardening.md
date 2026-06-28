# 인증/보안 강화 (서버 로그인 + Firebase Auth + Firestore 규칙) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 로그인 검증을 서버(Netlify 함수)로 옮기고 Firebase Auth 커스텀 토큰으로 `request.auth`를 채워, Firestore 규칙으로 역할 기반 접근 제어를 적용한다. 비밀번호는 bcrypt 해시로 저장하고 클라이언트에 노출하지 않는다.

**Architecture:** 클라가 이름+비번을 Netlify `auth` 함수에 보내면, 함수가 `userSecrets/{name}`의 bcrypt 해시와 비교(미마이그레이션 사용자는 평문 `users.password` 폴백) → 성공 시 `admin.auth().createCustomToken(uid, {isCoach, name})` 반환 → 클라가 `signInWithCustomToken`으로 로그인 → 이후 모든 Firestore 호출이 인증된 사용자로 수행. **데이터 키는 계속 이름(name)** 을 사용하고, 소유 판정은 커스텀 클레임 `name`으로 한다. 락아웃 0을 위해 **Phase A(폴백 유지·규칙 개방) → Phase B(규칙 잠금) → Phase C(폴백·평문 제거)** 3단계로 전환한다.

**Tech Stack:** React 19 (modular Firebase SDK) / 훈련일지 Vanilla JS (compat SDK 10.7.1, CDN) / Netlify Functions (CommonJS) / `firebase-admin` / `bcryptjs` / Vitest.

## Global Constraints

- **대상 Firebase 프로젝트는 `traininglogforclients`** (메인앱·훈련일지 공용, `.env`/`config.js` 기준). 스펙 원문의 `timetable-manager-483823`는 **오류** — 서비스계정·규칙·Admin 초기화 전부 `traininglogforclients`를 향한다.
- **`.env`는 git에 커밋돼 있다.** Firebase Admin 비공개 키를 `.env`에 절대 넣지 않는다. 로컬 스크립트는 gitignore된 JSON 키 파일을 읽는다.
- **bcrypt는 `bcryptjs`(순수 JS)** 사용. 네이티브 `bcrypt`는 Netlify 번들에서 컴파일 문제 → 금지.
- **데이터 문서 키 = 이름(name).** name→UUID 재키잉은 범위 밖(YAGNI).
- Netlify 함수 의존성은 **루트 `package.json`** 에서 설치된다(`googleapis`가 이미 그렇게 동작). 함수 dep은 루트에 추가한다.
- 커스텀 클레임은 정확히 `{ isCoach: boolean, name: string }`. 규칙은 `request.auth.token.name` / `request.auth.token.isCoach`를 읽는다.
- uid는 이름에서 결정적으로 파생: `deriveUid(name) = 'u_' + sha1(name)` (hex). 별도 저장 없음.

---

## File Structure

**신규**
- `netlify/functions/auth.js` — `/auth/login`, `/auth/set-password` 핸들러 (Admin SDK, bcrypt 비교, 커스텀 토큰 발급)
- `netlify/functions/_authLib.js` — 순수 헬퍼(`deriveUid`/`hashPassword`/`verifyPassword`), 브라우저/Vitest/함수 공용 CommonJS
- `netlify/functions/_authLib.test.js` — `_authLib` 단위 테스트
- `src/services/authService.js` — 프론트 로그인/비번설정 API 래퍼
- `scripts/migrate-passwords.js` — 평문 `users.password` → bcrypt `userSecrets/{name}` 1회 마이그레이션
- `firestore.rules` — Firestore 보안 규칙

**수정**
- `vitest.config.js:6` — include glob에 `netlify/**/*.test.js` 추가
- `package.json` — deps에 `firebase-admin`, `bcryptjs` 추가
- `.gitignore` — Firebase Admin 키 파일명 추가
- `firebase.json` — `firestore` 규칙 등록
- `src/config/firebase.js` — `auth` export 추가
- `src/components/Login.jsx:51-124` — 서버 로그인 + 커스텀토큰, 클라 비교는 폴백으로
- `src/services/firebaseService.js:130-141` — `updateUserPassword`가 `auth-set-password` 경유
- `src/components/CoachNewStudents.jsx:227-231` — 승인 시 해시도 기록 + 이름충돌 에러
- `src/components/StudentRegistrationModal.jsx:394-410, 943-949` — 해시 기록, 이름충돌 명시 에러, 비번 input `autoComplete`
- `public/training-log/index.html:18-19` — `firebase-auth-compat.js` 추가
- `public/training-log/js/config.js` — `FUNCTIONS_BASE` 상수 추가
- `public/training-log/js/modules/auth.js:32-47, 100-135` — 서버 로그인 + 커스텀토큰, 폴백 유지

---

# Phase A — 병행 도입 (폴백 유지, 규칙 개방)

> 끝 검증: Netlify 배포 후 **신규 로그인으로 토큰이 발급되고 `request.auth`가 채워지는지** 확인. 기존 클라 비교 폴백은 그대로 살아 있어 로그인이 절대 막히지 않는다.

## Task A1: 의존성 + 테스트 글롭 + gitignore

**Files:**
- Modify: `package.json` (dependencies)
- Modify: `vitest.config.js:6`
- Modify: `.gitignore`

- [ ] **Step 1: 의존성 추가**

```bash
npm install firebase-admin bcryptjs
```

- [ ] **Step 2: vitest include에 netlify 추가**

`vitest.config.js`의 include 라인을:

```js
    include: ['src/**/*.test.js', 'public/training-log/**/*.test.js', 'netlify/**/*.test.js'],
```

- [ ] **Step 3: gitignore에 Admin 키 추가**

`.gitignore` 끝에 추가:

```
# Firebase Admin 서비스계정 키 (로컬 마이그레이션 전용 — 절대 커밋 금지)
firebase-admin-key.json
```

- [ ] **Step 4: 설치 확인**

Run: `node -e "require('firebase-admin'); require('bcryptjs'); console.log('ok')"`
Expected: `ok`

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.js .gitignore
git commit -m "chore(보안): auth 강화용 firebase-admin·bcryptjs 추가 + 테스트 글롭 확장"
```

## Task A2: 순수 헬퍼 `_authLib.js` (TDD)

**Files:**
- Create: `netlify/functions/_authLib.js`
- Test: `netlify/functions/_authLib.test.js`

**Interfaces:**
- Produces: `deriveUid(name: string) -> string`, `hashPassword(plain: string) -> Promise<string>`, `verifyPassword(plain: string, hash: string) -> Promise<boolean>`

- [ ] **Step 1: 실패하는 테스트 작성**

`netlify/functions/_authLib.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { deriveUid, hashPassword, verifyPassword } from './_authLib.js';

describe('_authLib', () => {
  it('deriveUid은 이름에 대해 결정적이고 u_ 접두사를 가진다', () => {
    expect(deriveUid('홍길동')).toBe(deriveUid('홍길동'));
    expect(deriveUid('홍길동')).toMatch(/^u_[0-9a-f]{40}$/);
    expect(deriveUid('홍길동')).not.toBe(deriveUid('김길동'));
  });

  it('hash/verify 라운드트립: 맞는 비번은 true, 틀린 비번은 false', async () => {
    const hash = await hashPassword('1234');
    expect(await verifyPassword('1234', hash)).toBe(true);
    expect(await verifyPassword('9999', hash)).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test -- _authLib`
Expected: FAIL — `Cannot find module './_authLib.js'`

- [ ] **Step 3: 구현**

`netlify/functions/_authLib.js`:

```js
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const BCRYPT_COST = 10;

function deriveUid(name) {
  return 'u_' + crypto.createHash('sha1').update(name).digest('hex');
}

function hashPassword(plain) {
  return bcrypt.hash(plain, BCRYPT_COST);
}

function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

module.exports = { deriveUid, hashPassword, verifyPassword };
```

> 참고: 테스트는 ESM `import`, 함수 코드는 CommonJS `require`. Vitest는 CJS `module.exports`를 ESM named import로 상호운용한다. 검증은 Step 4에서 한다.

- [ ] **Step 4: 통과 확인**

Run: `npm run test -- _authLib`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/_authLib.js netlify/functions/_authLib.test.js
git commit -m "feat(보안): auth 순수 헬퍼(deriveUid/hash/verify) + 단위 테스트"
```

## Task A3: Netlify `auth` 함수 (login + set-password)

**Files:**
- Create: `netlify/functions/auth.js`

**Interfaces:**
- Consumes: `_authLib.deriveUid/hashPassword/verifyPassword`, env `FIREBASE_ADMIN_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY`
- Produces (HTTP):
  - `POST /auth/login {name, password}` → `200 {success:true, token, isCoach}` | `401 {success:false, error}`
  - `POST /auth/set-password {coachName, coachPassword, targetName, newPassword}` → `200 {success:true}` | `401/403/400`

- [ ] **Step 1: 함수 작성** (`netlify/functions/auth.js`)

```js
const admin = require('firebase-admin');
const { deriveUid, hashPassword, verifyPassword } = require('./_authLib');

// Admin 초기화 (Netlify 환경변수 — traininglogforclients 서비스계정)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      // Netlify는 줄바꿈을 \n 문자열로 저장 → 실제 개행으로 복원
      privateKey: (process.env.FIREBASE_ADMIN_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    }),
  });
}

const db = admin.firestore();

// 비번 검증: userSecrets 해시 우선, 없으면 평문 users.password 폴백(Phase A/B; Phase C에서 폴백 제거)
async function checkPassword(name, password) {
  const secretSnap = await db.collection('userSecrets').doc(name).get();
  if (secretSnap.exists && secretSnap.data().hash) {
    return verifyPassword(password, secretSnap.data().hash);
  }
  // ponytail: 평문 폴백 — 마이그레이션 전/누락 사용자용. Phase C에서 이 블록 삭제.
  const userSnap = await db.collection('users').doc(name).get();
  if (userSnap.exists && userSnap.data().password === password) return true;
  return false;
}

async function getUser(name) {
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

    // POST /auth/login
    if (event.httpMethod === 'POST' && path === 'login') {
      const { name, password } = JSON.parse(event.body || '{}');
      if (!name || !password) return json(400, { success: false, error: '이름과 비밀번호는 필수입니다.' });

      const user = await getUser(name);
      if (!user) return json(401, { success: false, error: '등록되지 않은 계정입니다.' });

      const ok = await checkPassword(name, password);
      if (!ok) return json(401, { success: false, error: '비밀번호가 올바르지 않습니다.' });

      const isCoach = user.isCoach || false;
      const token = await admin.auth().createCustomToken(deriveUid(name), { isCoach, name });
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
      await db.collection('userSecrets').doc(targetName).set(
        { hash, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
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
```

- [ ] **Step 2: 구문/번들 가능성 점검**

Run: `node -e "require('./netlify/functions/auth.js'); console.log('loads ok')"`
Expected: `loads ok` (Admin 초기화는 env 없으면 인증서 빈 값으로 lazy — 모듈 로드 자체는 통과)

- [ ] **Step 3: Commit**

```bash
git add netlify/functions/auth.js
git commit -m "feat(보안): Netlify auth 함수 — 서버 로그인(커스텀토큰) + 코치 비번설정"
```

> **검증 노트:** 이 함수의 실제 I/O 검증은 **Phase A 배포 후** 라이브에서 한다(Task A10). 로컬 단위 테스트는 A2의 순수 헬퍼로 충분하며, 핸들러는 Admin/Firestore I/O라 단위 테스트 대신 배포 검증으로 커버한다.

## Task A4: 비밀번호 마이그레이션 스크립트

**Files:**
- Create: `scripts/migrate-passwords.js`

**Interfaces:**
- Consumes: gitignore된 `firebase-admin-key.json` (루트), `_authLib.hashPassword`
- 효과: 모든 `users/{name}.password`(평문) → `userSecrets/{name}.hash`(bcrypt). 이미 hash 있으면 건너뜀(멱등).

- [ ] **Step 1: 스크립트 작성**

```js
// 1회용: 평문 users.password → bcrypt userSecrets/{name}.hash
// 실행: node scripts/migrate-passwords.js   (루트에 firebase-admin-key.json 필요)
const admin = require('firebase-admin');
const path = require('path');
const { hashPassword } = require('../netlify/functions/_authLib');

const serviceAccount = require(path.join(__dirname, '..', 'firebase-admin-key.json'));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

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
      { hash, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );
    migrated++;
    console.log(`✓ ${name}`);
  }
  console.log(`\n완료 — 신규 해시 ${migrated}, 이미존재 ${skipped}, 비번없음 ${noPw}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: 실행은 배포 검증 단계에서** (백관장이 키 발급·배치 후 Task A10에서 실행). 지금은 작성만.

- [ ] **Step 3: Commit**

```bash
git add scripts/migrate-passwords.js
git commit -m "feat(보안): 평문 비번 → bcrypt userSecrets 마이그레이션 스크립트"
```

## Task A5: 클라 Firebase Auth 준비

**Files:**
- Modify: `src/config/firebase.js`

**Interfaces:**
- Produces: `export { auth }` — `getAuth(app)` 인스턴스 (미설정 시 `null`)

- [ ] **Step 1: auth export 추가**

`src/config/firebase.js` 수정:
- import 라인에 추가: `import { getAuth } from 'firebase/auth';`
- `let db = null;` 아래에 `let auth = null;`
- try 블록 `db = getFirestore(app);` 다음 줄에 `auth = getAuth(app);`
- 마지막 export를 `export { db, auth };` 로 변경

- [ ] **Step 2: 빌드 점검**

Run: `npm run build`
Expected: 빌드 성공 (auth import 해석됨)

- [ ] **Step 3: Commit**

```bash
git add src/config/firebase.js
git commit -m "feat(보안): 클라 Firebase Auth 인스턴스 export"
```

## Task A6: 프론트 `authService.js`

**Files:**
- Create: `src/services/authService.js`

**Interfaces:**
- Consumes: `auth` (firebase.js), `signInWithCustomToken` (firebase/auth), `VITE_FUNCTIONS_URL`
- Produces:
  - `serverLogin(name, password) -> Promise<{ isCoach: boolean }>` (성공 시 `signInWithCustomToken` 완료, 실패 시 throw)
  - `setStudentPassword(coachName, coachPassword, targetName, newPassword) -> Promise<void>`

- [ ] **Step 1: 작성**

```js
import { auth } from '../config/firebase';
import { signInWithCustomToken } from 'firebase/auth';

// smsService.js와 동일한 베이스 URL 해석: VITE_FUNCTIONS_URL의 /sheets를 /auth로 교체
function getAuthBaseUrl() {
  const functionsUrl = import.meta.env.VITE_FUNCTIONS_URL;
  if (functionsUrl) {
    const base = functionsUrl.replace(/\/sheets\/?$/, '');
    return `${base}/auth`;
  }
  if (import.meta.env.PROD) return '/.netlify/functions/auth';
  return 'http://localhost:5001/auth';
}

export async function serverLogin(name, password) {
  const res = await fetch(`${getAuthBaseUrl()}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, password }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || `로그인 실패 (${res.status})`);
  }
  await signInWithCustomToken(auth, data.token);
  return { isCoach: data.isCoach };
}

export async function setStudentPassword(coachName, coachPassword, targetName, newPassword) {
  const res = await fetch(`${getAuthBaseUrl()}/set-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ coachName, coachPassword, targetName, newPassword }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || `비밀번호 설정 실패 (${res.status})`);
  }
}
```

- [ ] **Step 2: 빌드 점검**

Run: `npm run build`
Expected: 성공

- [ ] **Step 3: Commit**

```bash
git add src/services/authService.js
git commit -m "feat(보안): 프론트 authService(서버 로그인/비번설정 래퍼)"
```

## Task A7: `Login.jsx` 서버 로그인 + 폴백

**Files:**
- Modify: `src/components/Login.jsx:51-124` (performLogin)

**Interfaces:**
- Consumes: `serverLogin` (authService)

- [ ] **Step 1: import 추가**

`Login.jsx` 상단 import에 추가:

```js
import { serverLogin } from '../services/authService';
```

- [ ] **Step 2: performLogin의 신원 결정 블록 교체**

현재 `performLogin`의 `try { ... isCoach = ... }` 안에서 **유저 조회+비번 비교 부분(line 61~83)** 을 아래로 교체. 나머지(credentials 저장, onLogin 호출)는 그대로 둔다.

```js
        try {
            let isCoach = false;
            try {
                // 서버 로그인: 커스텀 토큰 발급 + signInWithCustomToken (request.auth 채움)
                const result = await serverLogin(name, pass);
                isCoach = result.isCoach;
            } catch (serverErr) {
                // ponytail: Phase A/B 폴백 — 서버 경로 검증될 때까지 클라 비교 유지, Phase C에서 제거.
                console.warn('서버 로그인 실패, 클라 폴백:', serverErr.message);
                const userRef = doc(db, 'users', name);
                const userDoc = await getDoc(userRef);
                if (!userDoc.exists()) {
                    setError('❌ 등록되지 않은 계정입니다. 코치에게 문의해 주세요.');
                    setLoading(false);
                    return;
                }
                if (userDoc.data().password !== pass) {
                    setError('❌ 비밀번호가 올바르지 않습니다!');
                    setLoading(false);
                    return;
                }
                isCoach = userDoc.data().isCoach || false;
            }
```

> 주의: `let isCoach = false;` 가 try 안으로 들어갔으므로, 기존 line 65의 바깥 `let isCoach = false;` 선언은 제거한다(중복 선언 방지). 이후 `localStorage`·`onLogin` 코드에서 쓰는 `isCoach`는 이 블록의 값을 그대로 사용.

- [ ] **Step 3: 로컬 동작 확인 (폴백 경로)**

Run: `npm run dev` → 브라우저에서 기존 계정으로 로그인.
Expected: 로컬엔 auth 함수가 없어 `serverLogin`이 실패 → 폴백으로 정상 로그인. 콘솔에 "서버 로그인 실패, 클라 폴백" 경고 1줄.
> ponytail: 로컬 dev는 폴백으로 동작. 서버 경로 실검증은 배포 후(Task A10).

- [ ] **Step 4: Commit**

```bash
git add src/components/Login.jsx
git commit -m "feat(보안): 메인앱 로그인 서버 경로 전환 + 클라 비교 폴백"
```

## Task A8: 훈련일지 로그인 서버 경로 + 폴백

**Files:**
- Modify: `public/training-log/index.html:18-19`
- Modify: `public/training-log/js/config.js`
- Modify: `public/training-log/js/modules/auth.js:32-47` (login), `:100-135` (autoLogin)

- [ ] **Step 1: auth compat SDK 로드**

`index.html`의 firestore-compat 스크립트(line 19) 다음 줄에 추가:

```html
    <script src="https://www.gstatic.com/firebasejs/10.7.1/firebase-auth-compat.js"></script>
```

- [ ] **Step 2: config.js에 함수 베이스 URL 상수 추가**

`config.js`의 `firebaseConfig` 객체 아래에 추가 (훈련일지는 Vite env가 없어 프로덕션 URL을 하드코딩):

```js
// Netlify 함수 베이스 URL (백관장 확인 값으로 고정 — 보통 strengthschool.netlify.app)
export const FUNCTIONS_BASE = "https://strengthschool.netlify.app/.netlify/functions";
```

- [ ] **Step 3: `login()` 서버 경로 + 폴백**

`auth.js`의 `login()` 안 `try {` 블록에서 **userDoc 조회+비교(line 33~47)** 를 교체:

```js
    try {
        // 서버 로그인 시도 (커스텀 토큰)
        try {
            const res = await fetch(`${FUNCTIONS_BASE}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, password }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || '로그인 실패');
            await firebase.auth().signInWithCustomToken(data.token);
            state.isCoach = data.isCoach || false;
        } catch (serverErr) {
            // ponytail: Phase A/B 폴백 — Phase C에서 제거.
            console.warn('서버 로그인 실패, 클라 폴백:', serverErr.message);
            const userDoc = await db.collection('users').doc(name).get();
            if (!userDoc.exists) {
                alert('❌ 등록되지 않은 계정입니다. 코치에게 문의해 주세요.');
                return;
            }
            if (userDoc.data().password !== password) {
                alert('❌ 비밀번호가 올바르지 않습니다!');
                return;
            }
            state.isCoach = userDoc.data().isCoach || false;
        }
```

상단 import에 `FUNCTIONS_BASE` 추가:
```js
import { firebaseConfig, FUNCTIONS_BASE } from '../config.js';
```
> `config.js` import 경로/이름은 기존 state.js의 firebaseConfig 사용처를 따른다. auth.js가 직접 config를 import하지 않으면, `window` 전역이나 state 경유 대신 config.js에서 named import를 추가한다.

- [ ] **Step 4: `autoLogin()` 서버 경로 + 폴백**

`autoLogin()`의 userDoc 비교(line 105~135) 동일 패턴으로 교체 — 저장된 `saved.password`로 `fetch /auth/login` 후 `signInWithCustomToken`, 실패 시 기존 평문 비교 폴백:

```js
    try {
        try {
            const res = await fetch(`${FUNCTIONS_BASE}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: saved.name, password: saved.password }),
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || '자동 로그인 실패');
            await firebase.auth().signInWithCustomToken(data.token);
            state.isCoach = data.isCoach || false;
        } catch (serverErr) {
            console.warn('서버 자동로그인 실패, 클라 폴백:', serverErr.message);
            const userDoc = await db.collection('users').doc(saved.name).get();
            if (!userDoc.exists || userDoc.data().password !== saved.password) {
                clearSavedLogin();
                return;
            }
            state.isCoach = userDoc.data().isCoach || false;
        }
        state.currentUser = saved.name;
        state.userPassword = saved.password;
        state.currentSets = [];
        await migrateLocalStorageToFirestore();
        loadPinnedExercisesFromStorage().then(loaded => { state.pinnedExercises = loaded; });
        loadArchivedMemosFromStorage().then(loaded => { state.archivedMemos = loaded; });
        console.log('✅ 자동 로그인 성공!');
        if (window.render) window.render();
    } catch (error) {
        console.error('자동 로그인 실패:', error);
    }
```

- [ ] **Step 5: 로컬 확인**

`public/training-log/index.html`을 메인앱 통해 열어 로그인 → 폴백으로 정상 동작 확인(프로덕션 함수가 살아있으면 서버 경로로 동작).

- [ ] **Step 6: Commit**

```bash
git add public/training-log/index.html public/training-log/js/config.js public/training-log/js/modules/auth.js
git commit -m "feat(보안): 훈련일지 로그인/자동로그인 서버 경로 전환 + 폴백"
```

## Task A9: 계정 생성/비번 변경 경로에 해시 기록 + 보안리뷰 픽스

**Files:**
- Modify: `src/components/StudentRegistrationModal.jsx:394-410, 943-949`
- Modify: `src/components/CoachNewStudents.jsx:227-231`
- Modify: `src/services/firebaseService.js:130-141` (updateUserPassword)
- Modify: `src/components/StudentInfo.jsx` 또는 `PasswordChangeCard.jsx` (updateUserPassword 호출부 — 코치 자격 전달)

**Interfaces:**
- Consumes: `setStudentPassword` (authService)

- [ ] **Step 1: StudentRegistrationModal 이름충돌 명시 에러 + 해시 기록**

`:394-410` 블록을 교체 — 동명 계정이 있으면 **조용히 건너뛰지 말고 중단**, 신규면 평문(폴백용)+해시 동시 기록:

```js
            // 신규 등록: 로그인 계정 생성
            if (registrationType === 'new') {
                const userRef = doc(db, 'users', form.이름.trim());
                const existing = await getDoc(userRef);
                if (existing.exists()) {
                    alert('❌ 이미 동일한 이름의 계정이 존재합니다. 등록을 중단합니다. (동명이인은 이름 뒤 구분자 사용)');
                    setSubmitting(false);
                    return;
                }
                try {
                    await setDoc(userRef, {
                        password: form.비밀번호.trim(),   // ponytail: Phase C에서 제거(해시만 사용)
                        isCoach: false,
                        createdAt: serverTimestamp()
                    });
                    await setStudentPassword(coachName, coachPassword, form.이름.trim(), form.비밀번호.trim());
                } catch (acctErr) {
                    console.warn('로그인 계정 생성 실패 (시트 등록은 완료):', acctErr);
                    alert('⚠️ 시트 등록은 됐지만 로그인 계정 생성에 실패했습니다. 다시 시도하거나 코치에게 문의하세요.');
                }
            }
```

> `coachName`/`coachPassword`/`setSubmitting`는 이 컴포넌트의 기존 로그인 상태에서 가져온다. 코치 자격이 컴포넌트에 없으면 props로 전달받도록 호출부(StudentManager)에서 `currentUser`/저장된 자격을 넘긴다. import에 `import { setStudentPassword } from '../services/authService';` 추가.

- [ ] **Step 2: 비번 input autoComplete**

`:944-949`의 비번 input(`type="text"` 유지 — 코치가 학생에게 불러주는 용도)에 속성 추가:

```jsx
                            <input
                                type="text"
                                autoComplete="new-password"
                                value={form.비밀번호}
                                onChange={(e) => handleChange('비밀번호', e.target.value)}
                                placeholder="수강생이 로그인할 비밀번호"
                            />
```

- [ ] **Step 3: CoachNewStudents 승인 시 해시 기록**

`:229-231`의 `setDoc(userRef, { password: reg.password, isCoach: false, ... })` 직후에 해시 기록 추가:

```js
            await setStudentPassword(coachName, coachPassword, reg.name, reg.password);
```
import에 `import { setStudentPassword } from '../services/authService';` 추가. `coachName`/`coachPassword`는 이 컴포넌트의 코치 세션에서 가져온다.

- [ ] **Step 4: updateUserPassword가 해시도 갱신**

`firebaseService.updateUserPassword`는 평문만 갱신 중. 코치 자격이 없는 학생 본인 변경이라 `auth-set-password`(코치 인증)를 직접 못 쓴다. → **본인 변경 전용**으로, 현재 비번 검증 후 평문 갱신은 유지하되, 해시 갱신은 별도 함수로 분리한다. `authService`에 본인용 엔드포인트가 없으므로 **Phase A에서는 평문 갱신만 유지**(서버 로그인은 평문 폴백으로 계속 동작), Phase C 직전에 본인 비번변경용 `auth-change-password`(본인 현재 비번 재검증) 엔드포인트를 추가한다.

이 Step에서는 **주석만** 남긴다 (`firebaseService.js:138` 위):

```js
        // ponytail: 본인 비번 변경은 Phase A에선 평문만 갱신(서버는 평문 폴백으로 로그인 가능).
        // Phase C 직전 auth-change-password(본인 현재비번 재검증) 추가 후 해시 갱신으로 전환.
```

- [ ] **Step 5: 빌드 + 린트**

Run: `npm run build && npm run lint`
Expected: 성공, 새 경고 없음

- [ ] **Step 6: Commit**

```bash
git add src/components/StudentRegistrationModal.jsx src/components/CoachNewStudents.jsx src/services/firebaseService.js
git commit -m "feat(보안): 계정 생성에 bcrypt 해시 기록 + 이름충돌 명시 에러 + 비번 input autoComplete"
```

## Task A10: Phase A 배포 + 라이브 검증 ⛳ 체크포인트

> **백관장 선행 작업** (이 시점에 필요): A-1 서비스계정 키 발급(`traininglogforclients`), A-2 Netlify 환경변수 3개, A-3 Authentication 활성화, A-4 프로덕션 함수 URL 확인. 루트에 `firebase-admin-key.json` 배치(마이그레이션용).

- [ ] **Step 1: 푸시 → Netlify·GitHub Pages 자동 배포**

```bash
git push
```

- [ ] **Step 2: 비번 마이그레이션 실행** (Admin 키 배치 후)

Run: `node scripts/migrate-passwords.js`
Expected: `완료 — 신규 해시 N, ...` (N = 현재 수강생+코치 수)

- [ ] **Step 3: 서버 로그인 라이브 검증**

배포된 메인앱에서 코치 계정·학생 계정 각각 로그인. 브라우저 콘솔에서:
```js
firebase.auth?.().currentUser   // 또는 modular: getAuth().currentUser
```
Expected: `currentUser`가 존재하고 `uid`가 `u_<sha1>` 형태. "서버 로그인 실패, 클라 폴백" 경고가 **뜨지 않음**(서버 경로 성공).

- [ ] **Step 4: 훈련일지 로그인 검증**

훈련일지 진입 → 로그인 → 콘솔에서 `firebase.auth().currentUser` 존재 확인.

- [ ] **Step 5: 신규 등록 → 로그인 왕복**

코치로 학생 1명 직접 등록(StudentRegistrationModal) → 그 계정으로 로그인 성공. `userSecrets/{그이름}` 문서에 `hash` 생성됐는지 콘솔/Firebase Console에서 확인.

> **게이트:** Step 3·4가 폴백 없이 성공해야 Phase B 진행. 실패 시 환경변수·함수 로그 점검(폴백 덕에 로그인 자체는 안 막힘).

---

# Phase B — 규칙 잠금

> 활성 사용자가 서버 경로로 정상 접속됨을 A10에서 확인한 뒤 규칙을 인증 요구로 조인다.

## Task B1: `firestore.rules` 작성 + 등록

**Files:**
- Create: `firestore.rules`
- Modify: `firebase.json`

- [ ] **Step 1: 규칙 작성** (`firestore.rules`)

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function signedIn() { return request.auth != null; }
    function isCoach() { return signedIn() && request.auth.token.isCoach == true; }
    function isSelf(name) { return signedIn() && request.auth.token.name == name; }

    // 비밀번호 해시 — 클라이언트 전면 차단(서버 Admin만 우회)
    match /userSecrets/{name} {
      allow read, write: if false;
    }

    // 계정: 본인/코치 read, 쓰기는 코치만(서버 경유 생성은 Admin이 우회)
    match /users/{name} {
      allow read: if isSelf(name) || isCoach();
      allow write: if isCoach();
    }

    // 학생 소유 컬렉션(문서ID 또는 userName 필드가 본인): 본인 read/write, 코치 전체
    match /personalBests/{docId} {
      allow read: if signedIn();
      allow write: if isCoach() || (signedIn() && request.resource.data.userName == request.auth.token.name);
    }
    match /monthlyStamps/{docId} {
      allow read: if isSelf(docId.split('__')[0]) || isCoach();
      allow write: if isCoach();
    }

    // 게시판: 인증 사용자 read, 작성자/코치 write
    match /posts/{postId} {
      allow read: if signedIn();
      allow create: if signedIn();
      allow update, delete: if isCoach() || (signedIn() && resource.data.authorName == request.auth.token.name);
      match /comments/{commentId} {
        allow read: if signedIn();
        allow create: if signedIn();
        allow update, delete: if isCoach() || (signedIn() && resource.data.authorName == request.auth.token.name);
      }
    }

    // 운영 컬렉션: 인증 사용자 read/write (역할 세분화는 후순위 — 동작 우선)
    // ponytail: makeup/holding/absence/waitlist 등은 우선 'signedIn'으로 개방. 악용 시 소유자 규칙 추가.
    match /{collection}/{docId} {
      allow read, write: if signedIn() &&
        collection in ['makeupRequests','holdingRequests','absenceRequests','waitlistRequests',
                       'makeupWaitlists','holidays','disabledClasses','newStudentRegistrations',
                       'entranceClasses','registrationFAQ','coachPinnedMemos','pinnedMemos',
                       'renewalContracts','studentTerminations','records','freeWorkoutAttendance',
                       'monthlyStamps','personalBests'];
    }
  }
}
```

> 위 규칙은 **현 컬렉션 동작 보존(락아웃 0)** 을 최우선으로 한 보수적 버전. 모든 인증 사용자에게 운영 컬렉션 read/write를 허용하되 **비인증(=토큰 없는 공격자)은 전면 차단**한다 — 이것만으로 "공개 DB 덤프" 구멍이 닫힌다. 소유자 단위 강화는 Phase C 이후 별도 과제(YAGNI).
> `userName`/`authorName` 필드명은 각 컬렉션 실제 스키마에 맞춰 구현 시 확인·정정한다(CLAUDE.md Firestore 섹션 참조).

- [ ] **Step 2: firebase.json에 규칙 등록**

`firebase.json`에 `firestore` 키 추가:

```json
{
  "firestore": { "rules": "firestore.rules" },
  "functions": [ ... 기존 그대로 ... ]
}
```

- [ ] **Step 3: 규칙 문법 검증** (firebase CLI 있으면)

Run: `npx firebase deploy --only firestore:rules --project traininglogforclients --dry-run` 또는 콘솔 붙여넣기 시 문법 오류 없음 확인.

- [ ] **Step 4: Commit**

```bash
git add firestore.rules firebase.json
git commit -m "feat(보안): Firestore 보안 규칙 — 비인증 전면 차단 + userSecrets 봉인"
```

## Task B2: 규칙 배포 + 핵심 기능 검증 ⛳ 체크포인트

- [ ] **Step 1: 규칙 배포**

`npx firebase deploy --only firestore:rules --project traininglogforclients` (백관장 firebase 로그인) **또는** Firebase Console → Firestore → 규칙 → 붙여넣기 → 게시.

- [ ] **Step 2: 로그인 후 핵심 기능 확인**

배포된 앱에서 코치·학생 각각:
- 로그인 → 시간표 로드(makeup/holding/waitlist 읽기)
- 게시판 글 읽기/작성
- 훈련일지 기록 작성/조회
- 신규 등록 1건

Expected: 전부 정상. 콘솔에 `permission-denied` 없음.

- [ ] **Step 3: 비인증 차단 확인 (구멍 닫힘 증명)**

시크릿 창에서 로그인 없이 콘솔로:
```js
firebase.firestore().collection('users').get().then(s=>console.log(s.size)).catch(e=>console.log('차단:', e.code))
```
Expected: `차단: permission-denied` (이전엔 전체 덤프됐던 것).

> **게이트:** Step 2 전부 통과해야 Phase C 진행. `permission-denied`가 하나라도 나면 해당 컬렉션을 B1 규칙의 운영 목록/소유자 조건에 보정 후 재배포. 최악의 경우 규칙을 직전(개방)으로 롤백.

---

# Phase C — 폴백·평문 제거

> 모두가 서버 경로로 안정 접속됨을 B2에서 확인한 뒤 마무리.

## Task C1: 본인 비번 변경용 서버 엔드포인트

**Files:**
- Modify: `netlify/functions/auth.js` (`/auth/change-password` 추가)
- Modify: `src/services/authService.js` (`changeMyPassword`)
- Modify: `src/services/firebaseService.js:130-141` (updateUserPassword → 서버 경유)

- [ ] **Step 1: 함수에 change-password 추가**

`auth.js` 핸들러에 분기 추가(본인 현재 비번 재검증 후 해시 갱신, 평문 미사용):

```js
    // POST /auth/change-password  (본인 현재 비번 재검증 후 변경)
    if (event.httpMethod === 'POST' && path === 'change-password') {
      const { name, currentPassword, newPassword } = JSON.parse(event.body || '{}');
      if (!name || !currentPassword || !newPassword) {
        return json(400, { success: false, error: '필수 파라미터 누락' });
      }
      const ok = await checkPassword(name, currentPassword);
      if (!ok) return json(401, { success: false, error: '현재 비밀번호가 올바르지 않습니다.' });
      const hash = await hashPassword(newPassword);
      await db.collection('userSecrets').doc(name).set(
        { hash, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
      return json(200, { success: true });
    }
```

- [ ] **Step 2: authService에 래퍼**

```js
export async function changeMyPassword(name, currentPassword, newPassword) {
  const res = await fetch(`${getAuthBaseUrl()}/change-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, currentPassword, newPassword }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || '비밀번호 변경 실패');
}
```

- [ ] **Step 3: updateUserPassword 교체**

`firebaseService.updateUserPassword` 본문을 `changeMyPassword` 호출로 교체(평문 `users.password` 갱신 제거). 호출부(PasswordChangeCard) 시그니처 유지.

- [ ] **Step 4: 배포 + 본인 비번 변경 검증**

학생 계정으로 '내 정보' → 비번 변경 → 로그아웃 → 새 비번 로그인 성공.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/auth.js src/services/authService.js src/services/firebaseService.js
git commit -m "feat(보안): 본인 비번 변경 서버 경로(change-password) + 평문 갱신 제거"
git push
```

## Task C2: 클라 폴백 + 평문 제거

**Files:**
- Modify: `src/components/Login.jsx` (폴백 블록 제거)
- Modify: `public/training-log/js/modules/auth.js` (폴백 제거)
- Modify: `netlify/functions/auth.js` (`checkPassword` 평문 폴백 제거)
- Modify: `src/components/StudentRegistrationModal.jsx`, `CoachNewStudents.jsx` (평문 `password` 쓰기 제거)
- Create: `scripts/drop-plaintext-passwords.js` (users.password 필드 삭제)

- [ ] **Step 1: 서버 평문 폴백 제거**

`auth.js`의 `checkPassword`에서 `// ponytail: 평문 폴백` 블록 삭제 → 해시 없으면 무조건 실패.

- [ ] **Step 2: 클라 폴백 제거**

`Login.jsx`: `try { serverLogin } catch { 클라 비교 }` 의 catch 폴백을 제거하고, 서버 실패 시 에러 표시로 단순화:

```js
            let isCoach = false;
            try {
                const result = await serverLogin(name, pass);
                isCoach = result.isCoach;
            } catch (serverErr) {
                setError('❌ ' + (serverErr.message || '로그인에 실패했습니다.'));
                setLoading(false);
                return;
            }
```
`doc`/`getDoc` import가 더는 안 쓰이면 제거. 훈련일지 `auth.js`도 동일하게 폴백 catch 제거.

- [ ] **Step 3: 평문 쓰기 제거**

신규 계정 생성 시 `users` 문서에서 `password` 필드를 빼고(`isCoach`/`createdAt`만), 비번은 `setStudentPassword`로만 기록.

- [ ] **Step 4: 평문 필드 일괄 삭제 스크립트**

```js
// users.password 평문 필드 제거 (해시는 userSecrets에 있음)
const admin = require('firebase-admin');
const path = require('path');
admin.initializeApp({ credential: admin.credential.cert(require(path.join(__dirname,'..','firebase-admin-key.json'))) });
const db = admin.firestore();
(async () => {
  const snap = await db.collection('users').get();
  let n = 0;
  for (const d of snap.docs) {
    if (d.data().password !== undefined) {
      await d.ref.update({ password: admin.firestore.FieldValue.delete() });
      n++;
    }
  }
  console.log(`평문 비번 제거: ${n}건`); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 5: 배포 후 실행 + 최종 검증**

```bash
git push
node scripts/drop-plaintext-passwords.js
```
검증: 로그인(메인앱·훈련일지)·비번변경·신규등록 전부 정상. 시크릿 창에서 `users` read 차단 확인. `userSecrets` read 차단 확인.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(보안): 클라 비번 비교·평문 password 필드 제거(폴백 종료)"
git push
```

---

## 백관장 작업 요약 (실행 중 호출되는 시점)

| 시점 | 작업 | 소요 |
| --- | --- | --- |
| Task A10 직전 | `traininglogforclients` 서비스계정 키 발급 + 루트에 `firebase-admin-key.json` 배치 | 5분 |
| Task A10 직전 | Netlify 환경변수 `FIREBASE_ADMIN_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY` | 5분 |
| Task A10 직전 | Firebase Console에서 Authentication 활성화 | 2분 |
| Task A10 직전 | 프로덕션 함수 URL 확인(훈련일지 `FUNCTIONS_BASE`에 반영) | 1분 |
| Task A10/B2/C 각 배포 후 | 로그인 1회 확인 | 각 2분 |
| Task B2 | (CLI 미사용 시) `firestore.rules` 콘솔 붙여넣기·게시 | 3분 |

## 범위 밖 (YAGNI)
- 운영 컬렉션 소유자 단위 규칙 세분화(Phase 후 별도)
- name→UUID 재키잉 / rate limiting / 비번 복잡도 정책

---

## Self-Review

**Spec coverage:**
- ① Firestore 공개 → B1/B2 (비인증 전면 차단) ✓
- ② 평문+클라 비교 → A2~A8(서버 로그인·해시) + C1/C2(평문·폴백 제거) ✓
- ③ request.auth 없음 → A3/A5~A8(커스텀 토큰·signInWithCustomToken) ✓
- 컴포넌트 1 함수 / 2 해시저장(userSecrets) / 3 마이그레이션 / 4 클라변경 / 5 규칙 → A3 / A3·B1 / A4 / A5~A9 / B1 ✓
- 단계적 전환 A/B/C → 그대로 ✓
- 보안리뷰 3건(이름충돌·비번 input·평문 미잔존) → A9 + C2 ✓
- 테스트(bcrypt 단위/규칙 수동/수동 시나리오) → A2 단위, B2 수동, A10/C 시나리오 ✓
- 프로젝트 ID 정정 → Global Constraints ✓

**Type consistency:** `serverLogin -> {isCoach}`, `setStudentPassword(coachName,coachPassword,targetName,newPassword)`, `changeMyPassword(name,currentPassword,newPassword)`, `deriveUid -> 'u_'+sha1`, 클레임 `{isCoach,name}`, 규칙 `request.auth.token.name/isCoach` — 전 태스크 일관.

**Placeholder scan:** 코드 블록 전부 실제 내용. `userName`/`authorName` 필드명은 B1에서 "실제 스키마 확인" 명시(미검증 지점 1곳, 의도적 플래그).
