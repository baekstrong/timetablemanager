# 인증/보안 강화 (Option 1: 서버 로그인 + Firebase Auth + Firestore 규칙)

작성일: 2026-06-22 · 실행 예정: 주말 (락아웃 위험 때문에 평일 회피)

## ⚠️ 주말에 이 작업을 시작하는 법 (다른 컴퓨터에서)

1. 해당 컴퓨터에서 저장소 클론/오픈 후 **`git pull`** (이 스펙은 `main`에 푸시돼 있음).
2. Claude Code에게 이렇게 말한다:
   > "`docs/superpowers/specs/2026-06-22-auth-hardening-design.md` 스펙대로 보안 강화 작업 진행해줘. writing-plans로 구현 계획부터 만들고, 서브에이전트 방식으로 실행."
3. Claude가 중간에 **백관장 콘솔 작업(아래 '백관장이 직접 할 일')** 을 요청하면 그때 해주면 된다(~30분).
4. **프로덕션 Netlify 함수 URL**을 물어보면 알려준다 (Netlify 대시보드 사이트 주소 + `/.netlify/functions/...`, 또는 배포된 앱 DevTools Network 탭의 함수 요청 URL).

> 단계적 전환(폴백 유지)으로 설계되어 있어, 절차를 순서대로 따르면 로그인 락아웃 없이 전환된다.

## 목적 / 위협 모델

현재 구멍(이번에 해결 대상):
1. **Firestore 전체 공개 가능성** — `firestore.rules` 파일 없음 → 테스트 모드(전체 허용)로 추정. 빌드 JS에 박힌 공개 API 키만으로 누구나 DB 전체 read/write 가능.
2. **평문 비밀번호 + 클라이언트 직접 비교** — `users/{name}.password`를 클라이언트가 읽어 비교(`Login.jsx`, `auth.js`). 1번과 합쳐지면 **전 수강생 비밀번호를 통째로 덤프 가능**.
3. **사용자를 구별할 `request.auth`가 없음** — Firebase Auth 미사용이라 규칙으로 사람을 구별 못 함(공격자=앱).

목표: 로그인 검증을 서버로 옮기고, Firebase Auth(커스텀 토큰)로 `request.auth`를 채워, Firestore 규칙으로 역할 기반 접근 제어. 비밀번호는 해시 저장 + 클라이언트에 절대 노출 안 함.

## 아키텍처

```
[클라이언트 로그인]
  이름+비번 → Netlify 함수 auth-login
                ├ users 측 해시와 bcrypt 비교
                ├ Firebase Admin: 커스텀 클레임 {isCoach, name} 세팅
                └ 커스텀 토큰 반환
  → 클라 signInWithCustomToken(token) → request.auth.uid + token.claims 채워짐
  → 이후 모든 Firestore 호출이 '인증된 사용자'로 수행
[Firestore 규칙] request.auth + 클레임(isCoach, name)으로 read/write 인가
```

핵심 결정: **데이터는 계속 이름(name)을 키로 사용**(전 컬렉션이 `userName`/문서ID=name에 의존 — 재키잉은 범위 밖). Firebase Auth uid는 인증용으로만 두고, **커스텀 클레임 `name`** 을 자기 데이터 소유 판정에 사용. uid↔name 매핑은 `userAuthMap/{uid} = {name}` 또는 클레임으로 관리.

## 컴포넌트

### 1. Netlify 함수 (Firebase Admin SDK)
- **`auth-login`** (POST `{name, password}`): `users/{name}`(또는 비밀 컬렉션)의 bcrypt 해시와 비교 → 성공 시 `admin.auth().createCustomToken(uid, {isCoach, name})` 반환. 실패 시 401. uid는 name 기반 결정적 값(예: `sha1(name)` 또는 `users` 문서의 고정 uid 필드).
- **`auth-set-password`** (POST, 코치 인증 필요): 코치가 학생 비밀번호 설정/초기화 → bcrypt 해시 저장. 신규 등록·비번 변경이 이 경로로.
- Firebase Admin 초기화는 Netlify 환경변수의 서비스계정 사용(`FIREBASE_ADMIN_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY`). 기존 Google Sheets 서비스계정과 별개(Firebase Admin 권한 필요) — 백관장이 발급.

### 2. 비밀번호 해시 저장 위치
- 해시는 **클라이언트가 못 읽는 곳**에 둔다. 두 안 중 택1(구현 시 결정):
  - (a) `users/{name}.passwordHash` 저장 + Firestore 규칙으로 `password*` 필드 클라이언트 read 차단(필드 단위 차단이 어려우면 b).
  - (b) **`userSecrets/{name}` 별도 컬렉션**에 해시 저장, 규칙에서 클라이언트 read/write 전면 차단(서버 Admin만 접근). ← 권장(필드 차단보다 단순·확실).

### 3. 비밀번호 마이그레이션 (1회)
- 스크립트: 기존 `users/{name}.password`(평문) → bcrypt 해시 → `userSecrets/{name}`에 저장.
- 전환 기간 동안 평문 `password`는 **즉시 삭제하지 않고 폴백 유지**, 3단계에서 제거.
- `scripts/` 에 작성, `node --env-file=.env` 실행(Admin 자격 필요).

### 4. 클라이언트 변경
- `src/config/firebase.js`: `getAuth` 추가, 앱 시작 시 Auth 준비.
- `Login.jsx` / 훈련일지 `auth.js`: 비밀번호 클라이언트 비교 제거 → `auth-login` 호출 → `signInWithCustomToken`. 자동로그인도 토큰 재발급 경로로.
- `users.password` 읽기 코드 제거. 코치 신규 등록(`StudentRegistrationModal`)·비번 변경(`updateUserPassword`)은 `auth-set-password` 호출로 교체.

### 5. Firestore 규칙 (`firestore.rules` 신규 + `firebase.json`에 등록)
- 기본 `allow read, write: if false`.
- `users/{name}`: read — 본인(`request.auth.token.name == name`) 또는 코치(`token.isCoach`); write — 코치/서버만. **`userSecrets/**`: 클라이언트 read/write 전면 차단.**
- 학생 소유 데이터(`records`, `pinnedMemos`, `monthlyStamps` 등): 본인 것 read/write, 코치는 전체. `posts`/댓글: 인증 사용자 read, 작성자/코치 write. 컬렉션별 규칙은 구현 시 표로 확정.
- 배포: `firebase deploy --only firestore:rules` (백관장 firebase CLI 로그인 필요) 또는 콘솔 붙여넣기.

## 단계적 전환 (락아웃 0 목표)

- **Phase A — 병행 도입(규칙은 아직 개방):** Admin 함수(`auth-login`/`auth-set-password`) + 해시 마이그레이션 + 클라 Auth/커스텀토큰 로그인 추가. 단, **기존 클라이언트 비교를 폴백으로 남김**, `firestore.rules`는 아직 개방. 배포 후 신규 로그인으로 토큰이 정상 발급되고 `request.auth`가 채워지는지 확인.
- **Phase B — 규칙 잠금:** 활성 사용자가 새 로그인으로 정상 접속됨을 확인한 뒤 `firestore.rules`를 인증 요구로 조이고 배포. 핵심 기능(시간표/게시판/훈련일지) 동작 확인.
- **Phase C — 폴백 제거:** 클라이언트 비밀번호 비교 코드·평문 `password` 필드 삭제. 마무리.

각 Phase 끝에 검증 통과해야 다음 Phase 진행. 문제 시 직전 Phase로 롤백(규칙 재개방/폴백 사용).

## 함께 처리할 보안 리뷰 지적 (이미 머지된 코드)
- **이름 충돌 무음 처리**(`StudentRegistrationModal`): 동명 계정 존재 시 조용히 건너뛰던 것 → **명시적 에러("이미 동일 이름 계정이 존재합니다")로 변경 + 등록 중단**. (작은 픽스지만 이 작업에 포함)
- **비번 입력 `type="text"`**: 코치가 학생에게 전달하려 보이게 둔 의도. 유지하되 `autoComplete="new-password"` 추가. (또는 reveal 토글 — 구현 시 택1)
- 비번 설정은 위 `auth-set-password` 경로로 통합되며 평문이 Firestore에 안 남게 됨.

## 백관장이 직접 할 일 (~20–30분, 주말 1회)
1. **Firebase Admin 서비스계정 키 발급**: Firebase 콘솔 → 프로젝트(`timetable-manager-483823`) 설정 → 서비스 계정 → 새 비공개 키 생성(JSON).
2. **Netlify 환경변수 등록**: `FIREBASE_ADMIN_PROJECT_ID`, `FIREBASE_ADMIN_CLIENT_EMAIL`, `FIREBASE_ADMIN_PRIVATE_KEY`(JSON에서 추출).
3. **(필요 시) Firebase 콘솔에서 Authentication 사용 설정** (커스텀 토큰용; 별도 공급자 불필요).
4. **프로덕션 Netlify 함수 URL** 알려주기.
5. **firestore.rules 배포 권한**: `firebase login` 가능하면 Claude가 배포 / 아니면 콘솔에 규칙 붙여넣기.
6. 각 Phase 배포 후 **로그인 1회 확인**.

## 범위 밖 (YAGNI / 추후)
- 전 컬렉션 문서키를 name→UUID로 재키잉(대규모, 별도 과제).
- 로그인 시도 rate limiting / lockout(소규모 사용자라 후순위 — 필요 시 함수에 간단 카운터).
- 비밀번호 정책(길이/복잡도) 강제.

## 테스트
- 함수: bcrypt 검증 로직 단위 테스트(해시 일치/불일치, 클레임 세팅).
- 규칙: 가능하면 Firebase 에뮬레이터 규칙 테스트(본인/코치/타인 접근). 최소 수동 시나리오.
- 수동: 메인앱·훈련일지 양쪽 로그인, 코치/학생 권한, 신규 등록→로그인, 게시판/시간표/훈련일지 read·write 정상.

## 참고 파일
- 로그인: `src/components/Login.jsx`, `public/training-log/js/modules/auth.js`
- 계정 생성: `src/components/CoachNewStudents.jsx`(승인), `src/components/StudentRegistrationModal.jsx`(코치 직접 등록)
- 비번 변경: `firebaseService.updateUserPassword`
- Firebase init: `src/config/firebase.js`
- 함수: `netlify/functions/`(프로덕션), `functions/server.js`(로컬)
- 설정: `firebase.json`, `.firebaserc`(프로젝트 `timetable-manager-483823`)
