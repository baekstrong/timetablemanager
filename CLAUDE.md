# 근력학교 수강 관리 시스템 (timetable-manager)

<!-- GIT-WORKFLOW-RULE:START -->
## ⚠️ Git 작업 규칙 (필수)

이 저장소에서 작업할 때는 아래 순서를 **반드시** 지킨다.

### 1. 작업 시작 시 — 가장 먼저 `git pull`
원격의 최신 변경사항을 받아온 뒤에 작업을 시작한다.
```bash
git pull
```
- 충돌(conflict)이 나면 작업 전에 먼저 해결한다.
- pull 없이 곧바로 코드를 수정하지 않는다.

### 2. 작업 종료 시 — `add` → `commit` → `push`
변경사항을 반드시 커밋하고 원격에 푸시한 뒤 작업을 마친다.
```bash
git add -A
git commit -m "<한글 커밋 메시지>"
git push
```
- 커밋 메시지는 **한글**로, 무엇을·왜 바꿨는지 알 수 있게 작성한다.
- 변경사항이 있는데 커밋/푸시하지 않고 작업을 끝내지 않는다.
<!-- GIT-WORKFLOW-RULE:END -->


> **이 파일은 프로젝트 변경 시 반드시 함께 업데이트해야 합니다**.코드 수정, 파일 추가/삭제, 구조 변경, 비즈니스 로직 변경이 있으면 해당 섹션을 갱신하세요.

## 프로젝트 개요

개인 트레이닝 스튜디오 "근력학교"를 위한 React PWA. 수강생 등록/관리, 주간 시간표, 홀딩/결석, 보강, 공휴일, 신규 수강 신청, SMS 알림을 통합 관리합니다.

## 기술 스택

- **프론트엔드**: React 19, Vite 7 (ES modules)
- **데이터 저장 (주)**: Google Sheets API v4 (서비스 계정 인증)
- **데이터 저장 (보조)**: Firebase Firestore (실시간 운영 데이터)
- **백엔드 (프로덕션)**: Netlify Functions (서버리스)
- **백엔드 (로컬)**: Express 서버 (`functions/server.js`, 포트 5001)
- **SMS**: Solapi API (HMAC-SHA256 인증)
- **웹 푸시**: FCM(Firebase Cloud Messaging) + `public/sw.js`의 `push` 핸들러 — 아이폰은 홈 화면에 추가한 경우에만 수신
- **캘린더**: Google Calendar API v3 (입학반 일정 — `calendarService.js` + Netlify `calendar.js`, 종료일 동기화 — `google-apps-script/CalendarSync.gs`)
- **차트**: Recharts
- **이미지 업로드**: Cloudinary(unsigned upload preset) + `browser-image-compression`(`cloudinaryService.js`, 게시판 첨부)
- **에러 모니터링**: Sentry(`@sentry/react`, `src/main.jsx`에서 프로덕션만 init)
- **훈련일지 서브앱**: Vanilla JS SPA (`public/training-log/`, Tailwind **정적 빌드 CSS**, Firebase compat). Tailwind는 CDN 런타임 JIT가 아니라 `npm run build:tl-css`로 빌드한 `css/tailwind.css`를 로드 — **훈련일지 HTML/JS에 새 Tailwind 클래스를 추가하면 반드시 `npm run build:tl-css`를 재실행해 커밋**할 것 (안 하면 스타일이 안 먹음)

## 디자인 시스템 (플랫 + 단일 코발트)

Channel Talk/Bezier 기반. **완전 플랫**(그라데이션·장식 그림자 없음) + **단일 코발트 액센트**. 토큰은 `src/index.css`의 `:root`에 정의되며 모든 컴포넌트는 하드코딩 색 대신 이 변수를 참조한다.

### 핵심 원칙 (반드시 지킬 것)
1. **그라데이션 0개** — `linear-gradient` 신규 사용 금지. 단색 토큰만.
2. **단일 브랜드 액센트는 코발트 `--accent #329BE7`** — 큰 면적 배경엔 쓰지 말고 액센트로만. 보라/인디고/바이올렛(`#667eea`·`#6366f1`·`#8b5cf6` 등) 도입 금지.
3. **본문 텍스트는 `--text` (rgba(0,0,0,.85))** — 순수 `#000` 금지.
4. **그림자는 모달/팝오버 본체에만** — 카드 깊이는 `1px solid var(--hairline)` 보더 + 표면 틴트로.
5. **라디우스는 사다리값에서만** — `--r-chip 8` / `--r-md 12` / `--r-cta 18` / `--r-card 20` / `--r-band 32`. 보간(24 등) 금지.
6. **상태색은 상태표시에만** — `--success`/`--caution`/`--error`/`--info`. 장식에 쓰지 말 것. 상태칩 패턴: 배경 `{색}1A` + 보더 `1px solid {색}4D` + 텍스트 해당 색.

### 주요 토큰
- 액센트: `--accent #329BE7`, `--accent-hover #327AB8`, `--accent-light #47C8FF`, `--accent-10/20/30`(알파)
- 표면: `--canvas #fff`, `--surface #FCFCFC`, `--canvas-tint #F7F7F8`, `--hairline #EFEFF0`
- 텍스트: `--text`, `--text-secondary`, `--text-muted #A7A7AA`, `--cta-dark #242428`
- 상태: `--success #31A552`, `--caution #EDBC40`, `--error #E94E58`, `--info #5E56F0`
- 모션: `--ease cubic-bezier(0.3,0,0,1)`, `--dur-s/m/l` 150/300/450ms
- 폰트: `--font` = Inter + Noto Sans KR (weight 400/700)

### 훈련일지 서브앱
`public/training-log/`는 별도 HTML이라 `:root` 변수를 못 쓴다. 코발트 hex(`#329BE7`) 또는 Tailwind arbitrary value(`bg-[#329BE7]`)를 직접 사용한다.

## 배포

- **프론트엔드**: GitHub Pages (`.github/workflows/deploy.yml`로 자동 배포, `main` 브랜치 push 시 트리거)
- **주간 칼럼 발행**: `.github/workflows/newsletter.yml` (매주 월요일 09:00 KST, `scripts/newsletters/` 큐에서 1건)
- **백엔드 (Netlify Functions)**: ⚠️ **자동 배포가 아니다. main에 푸시해도 Netlify는 아무것도 하지 않는다.**
  - Netlify 사이트(`strengthschool`)에 **GitHub 저장소가 연결돼 있지 않다**(빌드 크레딧 절약). `build_settings.repo_url`이 비어 있고 배포 이력이 전부 `Build from drop deployment`다.
  - 배포는 백관장이 `~/Desktop/앱 제작/netlify-deploy` 폴더를 Netlify 대시보드에 **드래그&드롭**해서 한다. 함수를 고쳤으면 그 폴더의 `netlify/functions/`를 먼저 갱신해야 반영된다.
  - **`firebase-admin`을 쓰는 함수는 의존성을 인라인한 단일 파일 `*.cjs`로 미리 번들해서 넣는다** — 드롭 배포는 그 폴더의 `package.json`으로 install하는데 거기엔 `firebase-admin`이 없다. 현재 `auth.cjs`, `push.cjs`가 이 방식(각 5.6MB).
    ```bash
    npx esbuild netlify/functions/push.js --bundle --platform=node --target=node20 \
      --format=cjs --outfile="$HOME/Desktop/앱 제작/netlify-deploy/netlify/functions/push.cjs"
    ```
  - `sms.js`/`sheets.js`/`calendar.js`는 소스 그대로 복사한다. 단 **스테이징 `package.json`이 리포와 따로 논다** — 2026-08-27 기준 거기엔 `googleapis`만 있어서, `@googleapis/sheets`를 쓰는 리포 최신 `sheets.js`를 그대로 드롭하면 시트 연동이 죽는다. 함수를 옮길 땐 `package.json` 의존성부터 맞출 것.
  - ⚠️ **함수 파일 확장자는 반드시 `.cjs`** — 스테이징 `package.json`이 `"type": "module"`이라 `.js`는 ESM으로 해석돼 `module is not defined in ES module scope`로 502가 난다. 2026-08-27에 이걸로 `sheets`가 죽어 앱 전체가 멈췄다(7월엔 넷리파이 번들러가 봐줬으나 지금 빌드 이미지는 안 봐준다).
  - ⚠️ **AWS Lambda 환경변수 4KB 한도** — `GOOGLE_PRIVATE_KEY`(1.7KB)와 `FIREBASE_ADMIN_PRIVATE_KEY`(1.7KB)를 **둘 다 환경변수에 넣으면 배포가 실패한다**(`Your environment variables exceed the 4KB limit`). 안 쓰는 `VITE_*` 12개(698B)를 다 지워도 초과다. 그래서 **firebase-admin 자격증명은 esbuild `--define`으로 번들에 인라인**한다. 2026-08-27 기준 여유 870B.
  - 번들은 `node scripts/bundle-netlify-fn.mjs <함수이름>` — 위 세 제약(의존성 인라인 / `.cjs` / 4KB)을 한 번에 처리한다.
  - ⚠️ **`auth.cjs`·`push.cjs`에는 서비스 계정 키가 구워져 있다.** 스테이징 폴더는 git 저장소가 아니어야 하고(2026-08-27 확인) 그 파일을 공유·커밋하면 안 된다. **Lambda 호환 모드를 벗어나면 4KB 제한이 없어지므로**(넷리파이 대시보드 > 함수 설정) 그때 `--define`을 빼고 환경변수로 되돌릴 것.
  - `netlify.toml`의 `functions = "netlify/functions"` 경로에서 서버리스 함수 배포
  - 프론트엔드 빌드는 Netlify에서 하지 않음 (`command = ""`)
- **API 연결**: 프론트엔드에서 `VITE_FUNCTIONS_URL` 환경변수로 Netlify Functions URL 지정
- **Firebase**: 별도 배포 없음 (Firestore는 클라이언트 SDK로 직접 접근, `src/config/firebase.js`에서 초기화)

## 개발 명령어

```bash
npm run dev        # Vite 개발 서버 (React 앱)
npm run backend    # 로컬 백엔드 (functions/server.js, 포트 5001)
npm run build      # 프로덕션 빌드
npm run preview    # 빌드 결과 미리보기
npm run lint       # ESLint (eslint .)
npm run test       # Vitest 단위 테스트 (vitest run)
```

## 운영/버그 픽스 규칙

- ops cron `ops 근력학교 repo weekly pull 매주 월 03:20`가 매주 월요일 03:20 KST에 로컬 repo를 최신화한다.
- 자동 최신화는 `git pull --ff-only`만 허용한다. 충돌/실패 시 임의 merge하지 말고 보고한다.
- 근학 앱 버그 픽스 작업을 시작하기 전에는 항상 먼저 최신 main을 pull 한다.

```bash
git -C /Users/baeggwanjangjadonghwa/workspace/repos/timetablemanager pull --ff-only
```

- pull 실패, 로컬 변경 충돌, fast-forward 불가 상태면 수정하지 말고 원인과 필요한 선택지를 보고한다.
- 버그 원인 분석/수정안 제안은 가능하지만 실제 수정·push·배포는 백관장 승인 후 진행한다.

## 업데이트 공지 규칙 (관리자봇)

main에 푸시(배포)하는 변경이 **수강생이 체감하는 변경**(새 기능, 화면/동작 변화)이면:

1. Claude가 공지 초안(제목+본문)을 터미널에 제시하고 **백관장 승인을 받는다**. 승인 전에는 절대 게시하지 않는다.
2. 승인 시 아래 스크립트를 실행한다. `--unpin-old`(기본으로 사용)면 **기존 관리자봇 공지는 삭제하지 않고 상단 고정만 해제**되어 게시판에 기록으로 남고, 상단 고정 공지는 새 공지 1건만 남는다. (플래그 없이 실행하면 기존 공지를 소프트 삭제 — 특별히 지우려는 경우만.)

```bash
node scripts/post-update-notice.js "제목" "본문" --unpin-old
```

3. 거절 시 공지 없이 배포만 진행한다.
4. 내부 리팩토링·마이너 버그 픽스는 공지 제안 자체를 하지 않는다.
5. 스크립트는 루트 `firebase-admin-key.json`(서비스 계정)으로 **Firestore REST**를 직접 호출한다. `.env` 불필요. 게시 전 확인은 `--dry-run`.
   - 클라이언트 SDK는 규칙 잠금(`signedIn()` 필수) 이후 permission-denied, Admin SDK는 스트리밍 RPC(runQuery)가 gRPC라 일부 네트워크에서 무한 대기 → 둘 다 쓰지 않는다.
6. 이 절차 전체는 `/deploy-notice` 슬래시 커맨드(`.claude/commands/deploy-notice.md`)로 실행할 수 있다.

## 뉴스레터(칼럼) 게시 규칙

노션 `✉️ 뉴스레터 출력` 페이지(하위 페이지 = 회차별 원고)의 뉴스레터를 **주 1회** 게시판 `칼럼` 카테고리에 올린다.
발행은 **GitHub Actions 예약 실행**(`.github/workflows/newsletter.yml`, 매주 월요일 09:00 KST)이 맡으므로 **맥을 켜둘 필요가 없다.**

### 원고 큐 (`scripts/newsletters/`)

`NN-슬러그.md` 형식으로 미리 커밋해두면 Actions가 매주 **파일명 순으로 아직 안 올린 것 1건**을 게시한다. 원고가 떨어지면 아무것도 안 하고 정상 종료한다.

- 파일 형식: **1행 = 게시할 제목 / 2행부터 = 노션 원문 마크다운**.
- 노션 원고엔 회차마다 `## 제목 후보`·`## CTA 후보`·`## 자체 검수` 같은 **작업용 섹션이 섞여 있다.** 이건 판단이 필요하니 Claude가 원고를 만들 때 손으로 걷어낸다. 기계적인 정제(마크다운 기호, 사진 프롬프트 줄)만 스크립트가 한다.
- 회차마다 노션 형식이 제각각이다 — 작업용 섹션(`제목 후보`·`CTA 후보`·`자체 검수`)이 있는 회차, 하위 페이지에 `수정본`이 따로 있는 회차(05), 같은 주제의 `분량 확대본`이 별도 페이지인 회차(08), `<br>`·`<table>`로 내보내지는 회차가 섞여 있다. **원고를 만들기 전에 페이지 전체를 훑어볼 것.**
- 본문에 남은 `[구매 링크]` 같은 **빈 플레이스홀더는 지운다** — 게시판에선 링크가 아니라 그냥 글자로 보인다.
- 노션 원문은 **한 문장 한 줄에 빈 줄이 없어** 그대로 올리면 게시판에서 글자 벽처럼 보인다. 원고를 만들 때 **문단 사이에 빈 줄을 넣을 것**(소제목 앞뒤 빈 줄은 스크립트가 자동으로 넣는다).
- 이미지가 있는 회차는 **커밋 시점에 Cloudinary로 미리 올려 영구 URL을 `![](…)` 로 박아둔다.** 스크립트는 `res.cloudinary.com` URL이면 재업로드하지 않으므로 Actions에 Cloudinary 키가 필요 없다.

### 절차

1. Claude가 노션 MCP로 다음 회차를 읽어 `scripts/newsletters/NN-….md` 를 만든다.
2. `--dry-run`으로 실제 게시될 본문을 보여주고 **백관장 승인을 받는다**. 승인 전에는 게시하지 않는다.
3. 커밋·푸시하면 그 다음 월요일에 자동 발행된다. 당장 올리려면 dry-run 없이 실행하거나 Actions 탭에서 `Run workflow`.

```bash
node --env-file=.env scripts/post-newsletter.js --list                      # 이미 올린 칼럼 확인
node --env-file=.env scripts/post-newsletter.js scripts/newsletters --dry-run  # 다음 회차 미리보기
node --env-file=.env scripts/post-newsletter.js scripts/newsletters            # 다음 회차 즉시 게시
node --env-file=.env scripts/post-newsletter.js <원고.md>                   # 특정 원고 지정
```

- 인자가 **디렉토리면 큐 모드**(다음 회차 1건), **파일이면 그 원고**를 올린다.
- 워크플로에 필요한 시크릿은 `FIREBASE_ADMIN_KEY`(= `firebase-admin-key.json` 전체) 하나뿐이다.
- ⚠️ 스크립트의 `isMain` 판정을 `import.meta.main`으로 되돌리지 말 것 — 그건 Node 24+ 전용이라 Actions의 Node 20에서는 **조용히 아무것도 안 하고 성공으로 끝난다**(발행 실패를 눈치채지 못한다).

- Firestore 접근은 `post-update-notice.js`와 같은 이유로 **REST + 서비스 계정**(루트 `firebase-admin-key.json`). Cloudinary 키는 `.env`에 있으므로 **`--env-file=.env` 없이 실행하면 이미지 업로드가 실패**한다.
- `author='백관장'`(실제 코치 계정이라 앱에서 수정·삭제 가능), `pinned:false` — **상단 고정은 업데이트 공지 몫이니 뉴스레터를 `notice`로 올리지 말 것.**

### 게시판 본문의 제약 (뉴스레터를 그대로 붙이면 안 되는 이유)

| 항목 | 현실 |
| --- | --- |
| 본문 | **순수 텍스트** (`white-space: pre-wrap` + `linkifyText`로 URL만 링크화). 마크다운 미렌더 → `## 제목`이 글자 그대로 노출 |
| 이미지 | `images:[{url,publicId,width,height}]`로 **본문 맨 아래에만** 표시. 문단 사이 삽입 불가 → **대표 1장만** 올린다 |
| 노션 이미지 URL | AWS S3 **서명 URL, 5분 만료** → 반드시 Cloudinary로 재업로드(스크립트가 처리) |
| 길이 | 제목 100자 / 본문 5000자 (`POST_LIMITS`) |

`cleanNewsletter`가 `## →` `■`, `- →` `·`, `**굵게**` 마커 제거, 마크다운 이스케이프 해제, 소제목 앞 빈 줄 삽입을 하고 **`> 📷 사진 생성 프롬프트:` 같은 내부용 줄을 지운다**. `assertPostable`은 그 내부용 문구나 마크다운 이미지가 본문에 남으면 게시를 막는다 — 수강생에게 새어나가면 안 되므로 이 가드를 없애지 말 것.

## 디렉토리 구조

```
src/
├── App.jsx                          # 루트 컴포넌트, 수동 라우팅 (currentPage state + switch/case)
├── main.jsx                         # React 진입점
├── config/firebase.js               # Firebase 초기화
├── contexts/GoogleSheetsContext.jsx  # 전역 상태 (students, selectedMonth, 각종 유틸)
├── services/
│   ├── googleSheetsService.js       # Google Sheets API 호출 (~1768줄)
│   ├── firebaseService.js           # Firestore CRUD (~1123줄)
│   ├── smsService.js                # Solapi SMS 발송 (sendManualSMS 포함)
│   ├── pushService.js               # 웹 푸시 — 토큰 등록(initPush) + 발송 호출(pushNotice/pushComment/pushMakeupSeat)
│   ├── analyticsService.js          # 매출·통계 집계 로직
│   └── makeupWaitlistService.js     # 보강 대기 자리 발생 감지·순차 SMS 알림 오케스트레이션 (CRUD는 firebaseService)
├── utils/
│   └── makeupWaitlist.js            # 보강 대기 순번/만료 판정 순수 로직 (1시간·수업시작 마감)
├── components/
│   ├── Login.jsx                    # 로그인 (Firestore 평문 비밀번호 비교)
│   ├── Dashboard.jsx                # 대시보드 (커뮤니티 게시판)
│   ├── WeeklySchedule.jsx           # 주간 시간표 (핵심 컴포넌트; 진행중/임박 셀 강조, 미결제 배지)
│   ├── StudentManager.jsx           # 코치용 수강생 목록/관리 (이름·전화번호 검색 포함)
│   ├── StudentRegistrationModal.jsx # 코치용 직접 등록 모달 (신규/재등록)
│   ├── StudentInfo.jsx              # 학생용 내 정보 조회
│   ├── HoldingManager.jsx           # 홀딩/결석 신청
│   ├── HolidayManager.jsx           # 코치용 공휴일 관리
│   ├── MakeupRequestManager.jsx     # 보강 관리
│   ├── CoachNewStudents.jsx         # 신규 신청 승인/거절
│   ├── ContractView.jsx            # 재등록 계약 동의 페이지 (학생용)
│   ├── ContractHistory.jsx         # 계약 이력 모달 (코치/학생 공용)
│   ├── NewStudentRegistration.jsx   # 신규 수강생 7단계 위자드 (외부 접근: ?register=true)
│   ├── schedule/                    # 시간표 분리 컴포넌트 (CoachSchedule, StudentSchedule, MakeupModal, MakeupWaitlistModal=대기 수락/거절 모달, ScheduleCell 등)
│   ├── MonthSelector.jsx            # 월 선택 드롭다운 (6개월전~3개월후)
│   ├── BottomNav.jsx                # 하단 네비게이션 (코치/학생 탭 다름)
│   ├── Ranking.jsx                  # 랭킹·내 PR·성장 그래프 페이지 (3 탭)
│   ├── PRSubmitModal.jsx            # 공식 PR 측정 등록 모달 (prType별 동적 폼)
│   ├── AnalyticsDashboard.jsx       # 매출·통계 대시보드 (코치용)
│   ├── SmsSendModal.jsx             # 코치 수동 문자 발송 모달 (수신자 선택 + 발송 결과 상태창)
│   ├── PasswordChangeCard.jsx       # 수강생 비밀번호 변경 카드 (내 정보 하단)
│   ├── GoogleSheetsSync.jsx         # Sheets 동기화 UI
│   ├── GoogleSheetsEmbed.jsx        # Sheets 임베드
│   └── GoogleSheetsTest.jsx         # Sheets 연결 테스트
├── board/
│   ├── PostList.jsx               # 게시판 글 목록 + 카테고리 탭
│   ├── PostDetail.jsx             # 글 상세 + 댓글 + 좋아요
│   ├── PostForm.jsx               # 글 작성/수정 모달
│   ├── CommentItem.jsx            # 댓글 컴포넌트
│   └── Board.css                  # 게시판 스타일
└── data/
    ├── mockData.js                  # 교시 정의, 요금제, 상수
    ├── contractTerms.js             # 재등록 계약 조건 상수
    └── boardConstants.js            # 게시판 카테고리, 입력 제한 상수

netlify/functions/
├── sheets.js    # Google Sheets 서버리스 함수
├── sms.js       # Solapi SMS 서버리스 함수
├── push.js      # 웹 푸시 발송 (ID 토큰 검증 → users 토큰 조회 → FCM)
└── _pushLib.js  # 푸시 본문 생성 (순수, firebase-admin 미의존 — 테스트용 분리)

functions/
├── server.js    # 로컬 개발용 Express (Sheets + SMS API)
└── package.json

scripts/
├── post-update-notice.js  # 관리자봇 업데이트 공지 게시 스크립트
├── post-newsletter.js     # 뉴스레터(칼럼) 게시 스크립트 + 노션 마크다운 정제 순수 함수
├── post-newsletter.test.js
└── newsletters/           # 발행 대기 원고 큐 (NN-슬러그.md, 파일명 순으로 주 1회 발행)

public/training-log/   # 훈련일지 서브앱 (별도 Vanilla JS SPA)
├── index.html
└── js/ (main.js, state.js, config.js, ui.js, utils.js, modules/*)
```

## 라우팅

React Router 미사용. `App.jsx`의 `currentPage` state로 수동 관리:

| currentPage | 컴포넌트 | 설명 |
| --- | --- | --- |
| `dashboard` | Dashboard | 커뮤니티 게시판 |
| `schedule` | WeeklySchedule | 주간 시간표 |
| `holding` | HoldingManager | 홀딩/결석 (학생용) |
| `myinfo` | StudentInfo | 내 정보 (학생용) |
| `students` | StudentManager | 수강생 관리 (코치용) |
| `holidays` | HolidayManager | 공휴일 (코치용) |
| `newstudents` | CoachNewStudents | 신규 승인 (코치용) |
| `contractView` | ContractView | 재등록 계약 동의 (학생용) |
| `ranking` | Ranking | 랭킹·내 PR·성장 그래프 (코치/학생 공용, Dashboard 카드로 진입) |
| `analytics` | AnalyticsDashboard | 매출·통계 대시보드 (코치용, 수강생 관리에서 진입) |

- URL `?register=true` → 로그인 없이 `NewStudentRegistration` 직접 렌더링
- 훈련일지 탭 → `window.location.href = './training-log/index.html'` (React 외부)

## 인증

- Firebase Auth 미사용
- Firestore `users/{이름}` 문서에서 평문 비밀번호 직접 비교
- `isCoach` 필드로 코치/학생 역할 구분
- 자동 로그인: `localStorage.login_credentials`, `localStorage.savedUser`
- 수강생은 내 정보에서 비밀번호 변경 가능 (`firebaseService.updateUserPassword`, localStorage 자격증명 동기화)
- **`users/{이름}` 문서가 없으면 로그인 불가**(auth `/login`이 `등록되지 않은 계정`으로 401). 앱 이전부터 다니던 수강생을 코치가 '재등록'으로 넣으면 시트 행만 생기고 계정이 없다 → `firebaseService.ensureUserAccount(이름)`이 없을 때만 만든다. 재등록 모달(비번=전화번호 뒤 4자리 자동)과 수강생 관리 '비번초기화' 버튼 양쪽에서 호출

## Google Sheets 구조

### 시트 탭 명명

```
등록생 목록(26년1월)  → 2026년 1월 데이터
등록생 목록(26년2월)  → 2026년 2월 데이터
```

### 행 구조

- Row 1 (인덱스 0): 병합된 헤더 (무시)
- Row 2 (인덱스 1): 컬럼 헤더
- Row 3+ (인덱스 2+): 데이터
- `actualRow = _rowIndex + 3` (배열 인덱스 → 시트 행번호)

### 컬럼 매핑 (A\~R)

| 열 | 필드 | 설명 | 형식 |
| --- | --- | --- | --- |
| A | 번호 | 자동 순번 (A열 최대값+1) | 숫자 |
| B | 이름 | 수강생 이름 | 텍스트 |
| C | 주횟수 | 주 몇 회 | 2, 3, 4 |
| D | 요일 및 시간 | 수업 일정 인코딩 | `월1수1`, `화5목5금5` |
| E | 특이사항 | 메모, 결석 기록 | `26.2.10 결석` |
| F | 신규/재등록 | 등록 유형 | `신규` / `재등록` |
| G | 시작날짜 |  | `YYMMDD` (예: `260111`) |
| H | 종료날짜 |  | `YYMMDD` |
| I | 결제금액 |  | 숫자 |
| J | 결제일 |  | `YYMMDD` |
| K | 결제유무 |  | `O` / `X` |
| L | 결제방식 |  | `카드`/`계좌`/`네이버`/`제로페이` |
| M | 홀딩 사용여부 |  | `X`, `O`, `X(0/2)`, `O(1/3)` |
| N | 홀딩 시작일 |  | `YYMMDD` |
| O | 홀딩 종료일 |  | `YYMMDD` |
| P | 핸드폰 |  | 전화번호 |
| Q | 성별 |  | `남` / `여` |
| R | 직업 |  | 텍스트 |

### 수업 일정 인코딩 (D열)

```
"월1수1"   → 월요일 1교시, 수요일 1교시
"화5목5"   → 화요일 5교시, 목요일 5교시
"월1수1금1" → 주3회 (월수금 1교시)
```

파싱: 한국어 요일(월화수목금) + 숫자(교시)를 순서대로 읽음.

### 홀딩 상태 인코딩 (M열)

| 값 | 의미 |
| --- | --- |
| `X` | 1개월 등록, 홀딩 미사용 |
| `O` | 1개월 등록, 홀딩 사용 중 |
| `X(0/2)` | 2개월 등록, 0회 사용 |
| `O(1/3)` | 3개월 등록, 1회 사용 중 |

## 교시 정의 (mockData.js)

| ID | 이름 | 시간 | 비고 |
| --- | --- | --- | --- |
| 1 | 1교시 | 10:00\~11:30 |  |
| 2 | 2교시 | 12:00\~13:30 |  |
| 3 | 3교시(자율) | 15:00\~17:00 | type: 'free' |
| 4 | 4교시 | 18:00\~19:30 |  |
| 5 | 5교시 | 19:50\~21:20 |  |
| 6 | 6교시 | 21:40\~23:10 |  |

- `MAX_CAPACITY = 7` (슬롯당 최대 수강생)
- 요일: `['월', '화', '수', '목', '금']`

## Firebase Firestore 컬렉션

| 컬렉션 | 용도 |
| --- | --- |
| `users` | 로그인 계정 `{password, isCoach, createdAt}`. 웹 푸시 토큰 `{fcmToken, fcmUpdatedAt}` — 본인 기기가 저장하고(직전 토큰과 같으면 write 생략), FCM이 `registration-token-not-registered`를 뱉으면 `push.js`가 지운다. 티어(출석 등급) 필드 `{tier, tierMonth('YYYY-MM'), prevTier, tierScore, tierIntroPending, tierUpdatedAt}` — 본인 접속 시 `refreshStudentTier`, 코치 접속 시 `backfillTiersForMonth`가 갱신 (아래 '티어 시스템' 참고) |
| `makeupRequests` | 보강 신청 (status: active/completed/cancelled) |
| `holdingRequests` | 홀딩 신청 |
| `absenceRequests` | 결석 신청 |
| `posts` | 커뮤니티 게시판 (category: notice/free/exercise/question, soft delete) |
| `posts/{postId}/comments` | 게시글 댓글 (서브컬렉션, soft delete) |
| `holidays` | 코치 커스텀 공휴일 |
| `disabledClasses` | 비활성화된 수업 슬롯 (키: `"월-1"`) |
| `waitlistRequests` | 시간표 대기 신청 — 영구 시간표 변경 (status: waiting/notified/accepted/cancelled) |
| `newStudentRegistrations` | 신규 수강 신청 (pending/approved/rejected). `smsLog{reception,approval,reminder}` 필드에 자동 문자 발송 결과 기록 → 신규 페이지 SMS 상황판(상태칩+재발송)이 이를 읽음. `registeredByCoach=true`(코치 직접 등록)는 자동문자 대상 아님. `referralSource`(유입경로: 인스타그램/네이버/지인추천/직접방문/기타) 필드를 포함하며 매출·통계 대시보드 유입경로 집계에 사용 |
| `entranceClasses` | 입학반 정보 |
| `registrationFAQ` | 신규 등록 FAQ |
| `coachPinnedMemos` | 코치가 수강생별 고정한 메모 (훈련일지) — **수강생에게 보임** |
| `coachNotes` | 코치 전용 비공개 메모. 단일 문서 `coachNotes/notes` = `{map:{수강생명:'메모'}, updatedAt}` (몇 명을 선택해도 읽기 1회). 훈련일지 코치 화면에서 수강생 선택 시 상단 `#coachPrivateNotesSection`에 카드로 항상 노출(메모 없는 수강생은 한 줄로 접힘, `✏️ 메모 쓰기`로 펼침). 상단 퀵내비 이름 클릭은 **첫 클릭 = 코치 전용 메모 / 같은 이름 재클릭 = 훈련일지 기록**으로 왕복. 저장은 `저장` 버튼 **+ textarea `onchange`(포커스 이탈)** 양쪽 — 데스크톱에서 mousedown 시 blur로 버튼이 밀려 click이 삼켜지면 한 번 눌러선 저장이 안 되던 문제 대응(모바일은 정상이었음). 값이 캐시와 같으면 write 생략. **수강생 코드에서 절대 읽지 않으며 규칙도 `isCoach()`만 허용** — generic signedIn 목록에 넣으면 학생 read가 뚫리므로 넣지 말 것. 같은 컬렉션의 별도 문서 `coachNotes/unpaid` = `{names:[미결제 이름...], updatedAt}` — 메인 앱이 코치 진입 시 `syncUnpaidStudents`로 발행(시트 K열=X, 내용 같으면 write 생략), 훈련일지 이름칩 `미결제` 표기용. 같은 이유로 `coachNotes/reregX` = `{names:[재등록 지연 이름...], updatedAt}` — 코치 시간표(`CoachSchedule`)가 `publishReregX`로 발행(종료일 지났고 다음 등록 없음 = 시간표의 `재등록X` 배지와 같은 명단, 명단이 통째로 비면 시트 미로드로 보고 발행 생략), 훈련일지 이름칩 `재등록X` 표기용. **`studentMeta`가 아니라 여기 두는 이유는 결제·재등록 상태가 수강생끼리 보이면 안 되기 때문** |
| `pinnedMemos` | 수강생 자신의 고정 메모 (훈련일지) |
| `renewalContracts` | 재등록 계약 (status: pending/agreed/cancelled) |
| `personalBests` | 공식 PR 측정 결과 (`prType`별 비교 룰; doc id: `{userName}__{exercise}` 또는 `{userName}__{exercise}__{intensity}{unit}` for `weightThenReps`) |
| `studentTerminations` | 코치가 '종료' 버튼으로 수강 종료한 기록 (이탈 통계용). `{studentName, terminatedBy:'coach', reason, terminatedAt}` |
| `makeupWaitlists` | 만석 슬롯 보강 대기 (status: waiting/notified/accepted/declined/expired/cancelled). 자리 발생 시 선착순 1명에게 SMS → 1시간(수업 시작이 더 가까우면 그때까지) 내 앱 시간표 '보강승인중' 칩에서 수락, 무응답/거절 시 다음 순번. 트리거: 홀딩/결석/보강취소/거절 + 코치 시간표 로드 백스톱 |
| `monthlyStamps` | 월간 도장(훈련일지). 문서 ID `{userName}__{YYYY-MM}`, `{userName, month('YYYY-MM'), grade('great'/'good'/'tryharder'), comment, stampedBy, stampedAt, seenByStudent}`. 코치가 훈련일지에서 월 1회 일괄 도장 → 학생은 일지 상단 배지+첫 접속 팝업. 메인앱은 이번 달 미작성 시 코치 훈련일지 탭 빨간점 (아래 '월간 도장 시스템' 참고) |
| `oneRMRecords` | 훈련일지 1RM 계산기의 '내 1RM 저장' — 문서 ID `{userName}`, `{map:{종목:{oneRM,weight,reps,date}}, updatedAt}`. 계산기 모달에서 종목별 최신 1개 덮어쓰기 저장/삭제 (`public/training-log/js/modules/onerm.js`) |
| `studentMeta/frequencies` | 이름→주횟수 맵 단일 문서 `{map:{이름:2/3/4}, updatedAt}`. 메인 앱이 코치 진입 시 `syncStudentFrequencies`로 통째 덮어씀. 훈련일지 도장 모달이 읽어 `suggestGrade` 자동추천 기준(주횟수)으로 사용 (시트 C열 주횟수를 훈련일지에 전달하는 유일 경로) |
| `studentMeta/schedules` | 이름→시트 D열 수업일정 맵 단일 문서 `{map:{이름:'월1수1'}, updatedAt}`. 메인 앱이 코치 진입 시 `syncStudentSchedules`로 덮어씀(같은 이름 여러 행이면 오늘이 수강 기간인 행 우선). 코치 시간표 명단이 아직 없는 과거 날짜의 폴백용 |
| `studentMeta/tierBackfill` | 티어 월간 백필 잠금 단일 문서 `{month:'YYYY-MM', updatedAt}`. `backfillTiersForMonth`가 스캔 전에 먼저 써서 그 달 1회만 돌게 한다 (아래 '티어 시스템' 참고) |
| `studentMeta/roster-YYYY-MM-DD` | 그 날 교시별 **실제 출석 명단** `{date, map:{'1':[이름...]}, updatedAt}`. 코치 시간표(`CoachSchedule`)가 **표시 중인 주 전체**를 날짜별로 `publishRoster`로 발행 — 화면 셀 렌더와 같은 기준(정규 출석 + 보강 오는 사람, 보강이동·결석·합의결석·홀딩·신규·시작전 제외). 내용이 같으면 write 생략. 훈련일지 '지금 수업' 명단의 1순위 출처 |
| `studentMeta/lastClasses` | 이름→마지막 수업 맵 단일 문서 `{map:{이름:{date:'YYYY-MM-DD', period}}, updatedAt}`. 코치 시간표가 `publishLastClasses`로 발행(내용 같으면 write 생략). 종료날짜는 시트 H열에만 있어 훈련일지가 모르므로, 선택 버튼 `마지막` 칩의 **유일한 경로** |

### `personalBests` 상세

**저장 시점**: `Ranking` 페이지 → `PRSubmitModal` → `submitPersonalBest()` (firebaseService.js)

**문서 ID 규칙**:
- `oneRM`/`timeHold`/`bodyweightReps`: `{userName}__{exercise}` (운동당 1개)
- `weightThenReps`: `{userName}__{exercise}__{intensity.value}{intensity.unit}` (중량별 분리)

**필드**: `{userName, exercise, prType, intensity:{value,unit}, reps:{value,unit}, date, note, history:[…], createdAt, updatedAt}`

**갱신 룰 (`isNewPRBetter`)**:
- `oneRM`: `intensity.value` 큰 쪽
- `weightThenReps`: 같은 도큐먼트(=같은 중량) 내 `reps.value` 큰 쪽
- `timeHold` / `bodyweightReps`: `reps.value` 큰 쪽

갱신 안 되어도 `history` 배열에는 측정 시도 기록 추가됨.

## 데이터 흐름

### Google Sheets API 경로

```
React → googleSheetsService.js → [프로덕션] netlify/functions/sheets.js
                                → [로컬]     functions/server.js (포트 5001)
                                → Google Sheets API v4
```

- `VITE_FUNCTIONS_URL` 설정 시 해당 URL 사용, 미설정 시 `/.netlify/functions/sheets`

### API 엔드포인트

| 메서드 | 경로 | 기능 |
| --- | --- | --- |
| GET | `/read?range=` | 시트 데이터 읽기 |
| POST | `/write` | 셀 값 업데이트 |
| POST | `/append` | 행 추가 |
| GET | `/info` | 시트 목록 조회 |
| POST | `/batchUpdate` | 여러 범위 일괄 업데이트 |
| POST | `/formatCells` | 셀 색상 하이라이트 |

### 이중 쓰기 패턴

홀딩/결석 데이터는 **Firebase + Google Sheets** 두 곳에 동시 저장:

- Firebase: 실시간 조회, 상태 관리 (취소/완료)
- Google Sheets: 영구 기록, 종료일 재계산 기준

## 핵심 비즈니스 로직

### 종료일 계산

`calculateEndDate(startDate, totalSessions, scheduleStr, holdingRanges, firebaseHolidays)`

- 시작일부터 하루씩 전진, 유효한 수업일만 카운트
- 제외 조건: 수업 요일 아님, 홀딩 기간, 한국 공휴일, Firebase 커스텀 공휴일
- 총 수업 횟수 = `주횟수 × 4 × 등록개월수`
- 최대 365번 반복 (무한 루프 방지)

### 홀딩 신청 흐름

1. 학생이 날짜 선택 후 신청 → Firebase `holdingRequests` 생성
2. Google Sheets M/N/O열 업데이트
3. 홀딩 기간 포함하여 종료일(H열) 재계산
4. **미리 등록(다음 등록)이 있으면 시작일/종료일 자동 조정**
5. 변경 셀 노란색 하이라이트

- 신청 데드라인: 홀딩 시작일 수업 시작 **1시간** 전
- 취소 데드라인: 홀딩 시작일 수업 시작 **30분** 전 (보강일 포함, `getClassPeriod` 사용)
- 코치모드에서는 데드라인 제약 없이 취소 가능 (StudentManager)
- 코치모드에서도 수강생 관리 페이지의 '홀딩' 버튼으로 직접 처리 가능 (Firebase + Sheets 동시 기록)

### 중복 등록 처리 (미리 등록)

- 같은 이름의 수강생이 같은 시트에 여러 행(현재 등록 + 미리 등록)으로 존재 가능
- `pickActiveRegistration()`, `pickActiveRowIndex()`: 오늘 기준 수강 기간 내인 등록을 우선 선택
- `_nextRegistration` 필드: 미리 등록된 다음 수강 정보를 보존
- `adjustNextRegistration()`: 홀딩/취소로 현재 종료일이 변경되면 다음 등록의 시작일/종료일도 자동 조정

### 결석 처리

- E열(특이사항)에 `"26.2.10 결석"` 형식으로 추가
- 결석일을 홀딩 범위에 포함 → 종료일 연장
- 데드라인: 수업 시작 **10분** 전

### 보강 시스템

- 학생이 WeeklySchedule에서 원래 수업 → 보강 날짜/교시 선택
- Firebase `makeupRequests` 생성 (status: active)
- 당주 최대 보강 횟수 = `weeklyFrequency`
- 향후 14일 이내 선택 가능
- 지난 날짜의 활성 보강 → 자동 `completed` 처리
- 신청 데드라인: 원본 수업과 보강 대상 수업 모두 시작 **1시간** 전까지
- 취소 데드라인: 보강 수업 시작 **30분** 전까지
- 쿼터는 **취소분도 1회로 계산**(`getWeekMakeupRequests`가 cancelled까지 조회) — 취소해도 그 주 횟수는 복구되지 않지만, 남은 횟수가 있으면 다른 시간으로 재신청 가능. 한도가 주1회에서 주 수강 횟수로 바뀐 뒤에도 "취소=재신청 불가"라는 옛 안내가 남아 혼선이 있었으므로 문구를 고칠 땐 이 규칙과 맞출 것
- **원래 수업이 만석이면 그냥 취소 불가** — 보강으로 비운 자리를 다른 수강생·대기자가 채웠는데 취소하면 정원(7명)을 넘긴다(`availableSeats`가 0으로 잘려 화면엔 초과가 안 보인다). 이 경우 취소 버튼은 '시간 변경 모드'(`changingMakeup`)로 전환되어, 여석 칸을 누르면 새 보강 생성 + 기존 보강 취소로 옮겨간다. 취소가 유일한 이동 경로였기 때문에 단순 차단만 하면 수강생이 갇힌다. 변경도 쿼터 1회를 소모하며, 남은 횟수 0이면 코치 문의 안내

### 만석 슬롯 보강 대기 흐름 (makeupWaitlists)

만석 슬롯 클릭 시 대기 신청 모달(`MakeupModal` 재사용)에서 원래 수업을 선택해 `makeupWaitlists` 컬렉션에 등록한다. 자리 발생 트리거(홀딩 신청/결석 신청/보강 취소·거절 + 코치 시간표 로드 백스톱)가 실행되면 대기 1순위에게 자리 안내 SMS를 발송하고 status를 `notified`로 변경한다. 수강생은 시간표의 '보강승인중' 칩을 클릭해 1시간(수업 시작이 더 가까우면 그때까지) 내에 수락 또는 거절할 수 있다. 수락 시 정식 보강(`makeupRequests`)으로 확정되고 종료일이 재계산된다. 거절하거나 시간 초과로 만료되면 다음 순번에게 동일하게 안내한다. 대기 신청은 주간 보강 쿼터를 미리 소진하지 않으며, 수락 시점에 쿼터를 검증한다.

### 월간 도장 시스템 (훈련일지 — 코치가 학생을 보고 있다는 신호)

훈련일지를 안 쓰거나 건성으로 쓰는 수강생을 줄이기 위해, 코치가 **월 1회** 일지에 3등급 도장을 찍는다.

- **순수 로직**: `public/training-log/js/modules/stamp-logic.js` (Firebase/DOM 의존 없음 — 브라우저·Vitest 양쪽 import 가능). `STAMP_GRADES`(각 등급 `{label 격려문구, headline 지난달상태, color}` — great '참 잘했어요'/'지난달 정말 꾸준히 나오셨어요' #E94E58 / good '잘하고 있어요'/'지난달 잘 나오고 있어요' #329BE7 / tryharder '더 힘내세요!'/'지난달에 부족했어요' #EDBC40. 배지·팝업은 headline 위, label 강조 2단 구성), `suggestGrade(활동일, 주횟수)`(주횟수 기반: great=주횟수×3+1, good=주횟수×2, 그 외 tryharder — 주2:7/4·주3:10/6·주4:13/8; 주횟수 없으면 주3 기본), `prevMonthRange`, `computeStampStats`. 테스트: `stamp-logic.test.js` (vitest include glob에 `public/training-log/**/*.test.js` 추가됨). 주횟수는 시트 C열에만 있어 훈련일지가 모름 → 메인 앱이 코치 진입 시 `firebaseService.syncStudentFrequencies(students)`로 `studentMeta/frequencies` 문서(이름→주횟수)를 발행하고 도장 모달이 이를 읽어 전달.
- **Firebase/DOM**: `public/training-log/js/modules/stamp.js`. 코치 도장 모달(전원 리스트 + 지난달 활동일·일평균 종목·등급 자동추천 프리필 + 고정 메모 개수·펼쳐보기 + [전체 확정] batch write)과 학생 배지·첫 접속 팝업. `window`에 노출(main.js `Object.assign(window, Stamp)`).
- **코치 부담 최소화**: 활동일로 등급 자동추천, 일평균 종목 수로 '건성' 케이스(활동일 높은데 일평균 1점대) 가시화 — 코치는 이상한 것만 손보고 한 번에 확정. 일지 일일이 안 읽어도 됨.
- **진입**: 훈련일지 코치 화면 '운동 종목 관리' 버튼 옆 `📋 이달의 도장`.
- **빨간점**: 메인 React 앱 `BottomNav` 훈련일지 탭 — 코치 모드 + 이번 달 `monthlyStamps` 미작성 시. `firebaseService.isMonthlyStampDone(month)` 폴링, 확정하면 사라짐.

### 티어 시스템 (출석 등급 — 수강생 독려용)

지난달 **활동일 수**로 5단계 티어를 매겨 게시판 이름 앞에 뱃지로 표시. 더 많은 운동·기록을 유도하는 게 목적.

- **순수 로직**: `src/utils/tiers.js` — `TIERS`(철인/코어/열정/성실/입문, 경계 17/13/9/6/0일), `scoreToTier`, `computeActiveScore`, `compareTiers`.
- **활동일** = 지난달 고유 날짜의 합집합: 훈련일지 기록일(`records`) ∪ 자율운동일(`freeWorkoutAttendance`). **실제 운동 기록이 있는 날만 인정** — 예정 수업일이라도 그날 기록이 없으면 불인정(결석신청 없이 안 나오는 노쇼 제외). 따라서 홀딩/결석/공휴일/시간표는 점수에 영향 없음. 주2회 기록 ≈ 8일(성실), 추가 운동·기록이 상위 티어로 올림.
- **저장/갱신(본인)**: `refreshStudentTier({userName})` — 학생 접속 시 지난달 기준 재계산해 `users/{이름}`에 기록. 같은 달 재실행은 no-op. 첫 계산(이전 티어 없음)은 인트로 팝업.
- **일괄 백필(코치)**: `backfillTiersForMonth()` — 코치 진입 시 호출되지만 `studentMeta/tierBackfill` 문서(`{month}`)로 **그 달 첫 1회만** 실제 실행(그 외엔 문서 1회 읽고 종료). 지난달 `records`를 날짜 범위로, `freeWorkoutAttendance`를 통째로 **컬렉션당 1회** 읽어 이름별 날짜 집합으로 그룹핑 → 이번 달 미계산 학생만 batch write. 스캔 **전에** 잠금을 먼저 써서 코치 2명·탭 2개 동시 진입 시 중복 스캔을 막는다. ⚠️ 이게 없으면 메인 앱을 안 여는 학생(훈련일지만 쓰는 학생)의 뱃지가 지난달 값에 영구히 멈춘다 — 2026-08에 실제로 62명 중 32명이 6월 기준 메달을 달고 있었다. 백필 대상은 `tierIntroPending=true`로 표시 → 그 학생이 다음 접속할 때 `refreshStudentTier`가 저장된 `prevTier`로 승급/강등(또는 첫 계산이면 인트로) 팝업을 띄우고 플래그 해제.
- **뱃지**: `TierBadge.jsx`. 게시판은 `getTierMap()`(이름→티어, 5분 캐시)을 Dashboard에서 읽어 PostList/PostDetail/CommentItem에 prop으로 전달. 코치는 뱃지 없음.
- **팝업**: `TierChangeModal.jsx` — 첫 진입 시 등급 안내, 이후 새 달 첫 접속 시 승급(축하)/강등(분발) 안내. Dashboard 마운트 effect에서 트리거. ponytail: '첫 출석'이 아니라 '새 달 첫 앱 접속' 기준.

### WeeklySchedule 수강생 상태

| 상태 | 설명 |
| --- | --- |
| `regular` | 정규 등록 |
| `makeup` | 보강 온 수강생 |
| `makeup-absent` | 보강으로 자리 비움 |
| `holding` | 홀딩 중 |
| `delayed` | 시작일 전 |
| `new` | 신규 수강생 |
| `agreed-absent` | 합의 결석 |
| `absent` | 결석 신청 처리됨 |
| `makeup-pending`(보강승인중) | 만석 대기 중 자리 안내 문자를 받고 수락 대기 중 |
| 보강대기 | 만석 슬롯 대기열 등록 상태 (코치 시간표 칩) |

### 신규 수강생 등록 → 승인

**등록** (NewStudentRegistration, 7단계): 개인정보 → 주횟수 → 시간표 → 입학반 → 결제방식 → 상담여부 → 요약+제출

**승인** (CoachNewStudents):

1. Firestore `users/{name}` 계정 생성
2. 시트 빈 행 탐색 → A열 번호 자동 부여 (A열 최대값+1)
3. A\~R열 전체 작성 (시작/종료일 자동 계산)
4. 행 주황색 하이라이트
5. 승인 SMS + 입학반 3일 전 예약 SMS 발송

### 요금제

| 주횟수 | 수강료 | 입학비 포함 |
| --- | --- | --- |
| 주4회 | 450,000원 | 530,000원 |
| 주3회 | 390,000원 | 470,000원 |
| 주2회 | 310,000원 | 390,000원 |

입학비: 80,000원

## 날짜 형식 규칙

| 용도 | 형식 | 예시 |
| --- | --- | --- |
| Google Sheets 저장 | `YYMMDD` | `260111` |
| JavaScript 내부 | `YYYY-MM-DD` | `2026-01-11` |
| 특이사항 결석 기록 | `YY.M.D` | `26.2.10` |
| Solapi 예약 발송 | `YYYY-MM-DDTHH:mm:ss+09:00` (ISO 8601, 오프셋 필수) | `2026-02-13T09:00:00+09:00` |

## SMS 시스템 (Solapi)

| 발송 시점 | 수신자 | 내용 |
| --- | --- | --- |
| 신규 신청 | 학생 | 접수 확인 |
| 신규 신청 | 코치 | 신청 알림 + 정보 |
| 승인 | 학생 | 승인 확인 + 준비 메시지 + 결제 링크 |
| 승인 (예약) | 학생 | 입학반 3일 전 오전 9시 리마인더 |
| 수동 발송 | 코치가 선택한 수강생 | 수강생 관리 → 문자 보내기 (수신자별 성공/실패 상태창) |
| 보강 대기 자리 발생 | 대기 1순위 수강생 | **푸시 우선, 실패 시 SMS 폴백** (1시간 데드라인이라 못 받으면 안 됨) |

## 웹 푸시 알림 (FCM)

문자비 없이 보내는 알림. **아이폰은 홈 화면에 추가한(설치된) 경우에만 수신**되며, 안드로이드/크롬은 그냥 된다.

- **토큰**: `pushService.initPush(이름, ask)` → `users/{이름}.fcmToken`. `ask=true`는 권한 팝업을 띄우는데 **아이폰은 사용자 제스처 안에서만 통하므로 버튼 클릭 핸들러에서만 true로 부를 것.** 이미 허용한 사람은 마운트 시 조용히 갱신하고, 직전 토큰과 같으면 write를 생략한다(접속마다 write 방지). `navigator.serviceWorker.ready`는 SW 등록 실패 시 reject가 아니라 **영원히 대기**하므로 5초 타임아웃을 걸어 실패로 떨어뜨린다(안 그러면 '알림 켜기'가 먹통).
- **Dashboard 상단 알림 상태 줄**(`PUSH_ROW` + `src/utils/pushStatus.js`의 `resolvePushState`): 4상태를 **항상** 보여준다 — `on`(작은 회색 '🔔 알림 켜짐') / `off`(켜기 버튼) / `denied`(브라우저 설정에서 푸는 법) / `unsupported`(아이폰=홈 화면 추가 안내, 그 외=인앱 브라우저 대신 크롬으로 열라는 안내). ⚠️ **'켜짐' 판정은 권한이 아니라 `initPush`가 돌려준 토큰으로 한다** — 권한만 보면 허용해놓고 getToken이 조용히 실패한 사람이 영영 못 고친다. 2026-08-27 배포 직후 69명 중 6명만 토큰이 등록됐고 "알림 켜기 버튼이 안 보인다"(특히 갤럭시)는 문의가 나온 원인이 **권한 `default`일 때만 뜨던 옛 배너**였다. 조건을 다시 좁히지 말 것.
- **발송**: 클라이언트 → `netlify/functions/push.js`. Firebase **ID 토큰을 `Authorization: Bearer`로 검증**하고 클레임의 `name`/`isCoach`를 쓴다.
- ⚠️ **클라이언트가 준 텍스트·수신자를 그대로 쓰지 말 것.** 로그인한 수강생 아무나 `/push`를 부를 수 있으므로, 자유 텍스트를 받으면 남의 잠금화면에 임의 문구를 띄우는 통로가 된다(게시판과 달리 코치 눈에 안 보인다). 그래서 `_pushLib`는 두 단계로 나뉜다:
  1. `verifyPathFor(req)` — 이 요청을 검증하려면 어떤 문서를 읽어야 하는지 반환 (댓글=`posts/{postId}`, 답글=그 댓글 문서, 보강자리=`makeupWaitlists/{id}`). 식별자가 없으면 `undefined` → 400.
  2. `buildMessage(req, caller, record)` — **수신자와 문구를 그 문서에서 뽑는다.** 댓글/답글은 조회한 글·댓글의 `author`가 대상이고 본문은 고정 문구, 보강 자리는 `status === 'notified'`인 항목만 통과하며 날짜·교시도 그 문서에서 읽는다(가짜 자리 알림 차단).
  - 자유 텍스트는 **코치 공지 하나뿐**이고 `isCoach`로 막는다. 검증 비용은 알림 1건당 read 1회.
- **수강중 필터는 서버에 두지 않는다.** 대상 이름은 이미 시트를 들고 있는 코치 클라이언트가 `shouldShowInCoachStudentList`로 뽑아 넘긴다(= 문자 수신자 목록과 같은 기준). 서버에 같은 판정 로직이 두 벌 생기는 걸 피하려는 것.
- **읽기 비용**: 알림 1건당 대상 인원수만큼 `users` read. 공지(≈62)는 드물고 댓글·보강대기는 1명이라 무시 가능. 집계 문서(`studentMeta/pushTokens`)는 **일부러 안 만들었다** — 동기화 타이밍 문제만 늘고 절감이 없다.
- **표시**: data-only 메시지로 보내고 `public/sw.js`의 `push` 핸들러가 직접 `showNotification`. SW에 firebase SDK를 `importScripts` 하지 않는다.
- **알림 종류**: 공지(`PostForm`의 '수강생에게 푸시 알림 보내기' 체크 — 새 공지 작성 시에만, 수정 땐 다시 안 감) / 내 글에 댓글 / 내 댓글에 답글 / 보강 대기 자리 발생.
- **게시판 새 글 전체 알림은 없다** — 자유게시판 글마다 전원 폰이 울리면 스팸이라 댓글·답글만 보낸다.
- ⚠️ **보강 대기 알림은 SMS 폴백을 지우지 말 것** — 1시간 데드라인이 걸려 있어서 토큰이 없거나(알림 미허용·기기 변경) 발송 실패면 반드시 문자로 가야 한다.
- 로컬 Express(`functions/server.js`)엔 `/push`가 없다. 로컬 개발 중 푸시 호출은 404로 조용히 실패한다(콘솔 경고만).

## Google Calendar 연동 (입학반 일정)

- `calendarService.js` → Netlify `calendar.js`(로컬은 `server.js`) → Google Calendar API v3
- 입학반 일정 추가/수정/삭제 시 `[입학반] M월 D일 (요일)` 형식 이벤트를 `GOOGLE_CALENDAR_ID` 캘린더에 자동 반영
- `calendarService.getCalendarBaseUrl()`은 `VITE_FUNCTIONS_URL`의 `/sheets`를 떼고 `/calendar`를 붙여 엔드포인트를 결정(없으면 `/.netlify/functions/calendar`, 로컬 `http://localhost:5001/calendar`)
- 별개로 `google-apps-script/CalendarSync.gs`는 시트에 바인딩되어 수강생 **종료일**을 전용 캘린더로 동기화 (앱과 독립적으로 시트에서 직접 실행)

## 훈련일지 서브앱 (training-log)

`public/training-log/`에 위치한 별도 Vanilla JS SPA.

- Firebase 프로젝트: `traininglogforclients` (주 앱과 동일 프로젝트 사용 가능)
- 주 앱과 `localStorage.savedUser`로 세션 공유
- 코치 → 훈련일지: `localStorage.coachSelectedStudents`로 수강생 목록 전달
- 훈련일지 → 시간표 복귀: `sessionStorage.quickReturn` + `login_credentials.autoLogin`
- **운동 종목**: 코치가 관리하는 전역 공용 `exercises` 컬렉션(`{name}`) + **학생 개인 전용 종목**. 기록 입력 자동완성(`admin.js`)에서 목록에 없는 이름을 치면 `+ '○○' 직접 추가` 옵션 → `selectCustomExercise`가 기기별 `localStorage['myCustomExercises_<이름>']`에 기억하고 그 학생 자동완성에만 병합(공용 목록·코치 화면 불변). 개인 종목으로 저장된 기록은 `records` 문서에 `custom:true` 플래그(`isCustomExercise`). 커스텀 이름은 `'"\<>` 정제 후 저장.
- **PR 축하 팝업**: 기록 저장 시 같은 종목 과거 기록 대비 새 최고 무게(kg) 또는 새 최다 반복이면 🎉 축하 팝업(`records.js` `showPRCelebration`). 판정 순수 로직은 `public/training-log/js/modules/pr-logic.js`의 `evaluatePR(pastSets, newSets)`(Firebase/DOM 무관, `records.js` `computePR`이 Firestore 조회분을 넘김). 그 종목 첫 기록은 비교 대상이 없어 축하 안 함. 테스트: `pr-logic.test.js`.
- **기록 저장은 로컬 우선(local-first)** — `state.js`에서 `enablePersistence({synchronizeTabs:true})`로 오프라인 캐시(IndexedDB)를 켠다. `addRecord`는 문서 id를 로컬에서 먼저 뽑아(`.doc()`) `set()`하고 **서버 ACK를 기다리지 않는다** — 쓰기가 IndexedDB에 durable하게 남아 탭을 닫아도 재전송되기 때문. 캐시가 실패한 환경(사파리 시크릿 등)에서는 `persistenceEnabled=false`라 예전처럼 `await`한다(유실 방지). ⚠️ **이 await를 무조건 되살리지 말 것** — Firestore SDK는 유휴 60초면 스트림을 닫으므로(`PersistentStream` idle timer), 세트 사이 쉬는 시간이 긴 훈련 특성상 저장마다 재연결 핸드셰이크를 타 "가끔 몇 초 멈춤"의 원인이었다.
- **저장 경로의 서버 왕복은 0회가 기본** — `order`는 `currentDayRecordCount()`가 `loadMyRecords` onSnapshot 캐시(`lastRecordDocs`)에서 읽어 쿼리를 안 한다(구독 키가 다르거나 첫 스냅샷 전이면 그때만 조회). 재구독 시 `lastRecordDocs=null`로 비우는 줄을 지우지 말 것 — 안 비우면 날짜 전환 직후 남의 날짜 개수가 `order`로 박힌다. PR 판정은 쓰기와 동시에 출발시켜 화면을 푼 뒤 결과만 받고(축하 팝업이 저장 확인 뒤에 따라붙음), 방금 쓴 문서를 `pastSetsFrom(docs, excludeId)`로 빼서 자기 자신과 비교되는 레이스를 막는다.
- **1RM 계산기**: 학생 화면 헤더 '🧮 1RM 계산기' 버튼 → 모달에서 무게·횟수 입력 시 Epley 예상 1RM + %별(50~95%) 중량표. 종목 입력 후 '저장'하면 종목별 최신 1RM을 `oneRMRecords/{userName}` 문서에 저장하고 모달 하단 '📌 내 1RM' 목록에 표시(개별 삭제 가능). 순수 로직 `estimate1RM/trainingTable/sortMyOneRMs/percentSets`는 `public/training-log/js/modules/onerm.js`, 테스트 `onerm.test.js`.
- **'지금 수업' 자동 명단 (코치)**: 훈련일지 코치 화면 진입 시 현재 교시에 수업 있는 수강생을 자동 선택하고, 상단 배너(`#classSlotBanner`)에 `지금 수업 목 5교시 19:50~21:20 · 7명` + `🔄 새로고침`(`applyCurrentClassRoster`)을 띄운다. 순수 로직은 `public/training-log/js/modules/class-period.js`(`PERIODS`는 `src/data/mockData.js`와 동일하게 유지할 복제본, `resolveClassSlot`·`parseSchedule`·`rosterFor`, 테스트 `class-period.test.js`). 규칙: 시작 15분 전~종료는 `now`, 교시 사이·수업 종료 후는 그날 마지막 끝난 교시가 `past`, 첫 교시 전·주말은 직전 평일 마지막 교시. **`past`면 그 수업 날짜 기록을 펼치고, `now`면 `defaultSessionDate`(오늘 이전 마지막 수업)를 따른다.** 명단 출처는 `studentMeta/roster-{날짜}`(1순위, 배너에 `보강 포함`) → 없으면 `studentMeta/schedules` 정규 시간표(배너에 `정규 시간표 기준`). 명단이 빈 교시는 `previousSlot`으로 최대 12칸 되감아 실제로 사람이 있던 수업을 찾는다. 상단 퀵내비 바(`.student-quick-nav-btn`)와 하단 수강생 선택 뱃지 **양쪽에 시간표와 같은 `미결제`·`재등록X`·`보강`·`마지막` 칩**이 붙는다 — `tagsForSlot(명단, slot)`이 훈련일지에서 직접 계산한다(보강 = `makeupRequests` where `makeupClass.date`==그 날, status active/completed·날짜당 1쿼리 캐시 / 마지막 = `studentMeta/lastClasses` / 미결제 = `coachNotes/unpaid` / 재등록X = `coachNotes/reregX`, 세션당 1회). 상태색 우선순위는 미결제(주황) > 재등록X(노랑) > 마지막(빨강) > 보강(파랑)이고, 텍스트에는 해당하는 칩이 모두 나온다. **명단 출처와 무관하게 계산**하므로 정규 시간표 폴백에서도 칩이 나오고, 폴백 명단엔 그 날 보강자를 합쳐 넣는다(정규 시간표엔 보강 온 사람이 없으므로). 태그는 **명단에 있는 사람에게만** 붙어서, roster 경로의 시간표 판정(보강홀딩·보강결석 제외)을 훼손하지 않는다. 버튼의 이름은 `data-name`에서 읽는다 — `textContent`엔 칩 글자가 섞여 있으므로 이름 파싱에 쓰지 말 것.
- **시간표에서 수업 고르기 (코치)**: 배너의 `📅 시간표` 버튼(`openSlotPicker`) → 이번 주 요일 선택 + 교시별 인원수 목록 → 누르면 그 시간 명단이 그대로 선택되고 배너가 `선택한 수업`이 된다. 명단은 '지금 수업'과 같은 `rosterForSlot` 경로. 주 월~금 날짜는 순수 함수 `weekdayDates`(class-period.js, 일요일은 다음 주 월요일 기준).
- **훈련일지 진입 경로 2가지**:
  1. **직접 진입**(하단 탭) — 지금 수업 명단 자동. 수업 시간이 아니면 마지막으로 사람이 있던 수업으로 되감음. 배너 `지금 수업`(초록) / `마지막 수업`(회색).
  2. **시간표에서 수업 칸 클릭** — `CoachSchedule.handleCellClickToTrainingLog`가 `localStorage.trainingLogSlot`(명단·날짜·교시)을 넘기고, 훈련일지가 이를 **한 번 소비**해 그대로 표시(배너 `선택한 수업`, 파랑). 자동 계산이 덮어쓰지 않는다. 이후 🔄를 누르면 다시 '지금 수업' 기준.
  - 기록 기본 날짜: 그 수업이 **이미 끝났으면**(`slotHasEnded`) 그 날짜, 아직 진행 중/시작 전이면 `defaultSessionDate`(오늘 이전 마지막 수업).
- ⚠️ **구버전 사파리(15.6) 퀵내비 깨짐**: 페이지 로드 직후엔 항목이 겹쳐 잘리는데 앱 안 🔄를 누르면 멀쩡해졌다 = DOM이 아니라 **레이아웃을 잰 시점**이 문제. 로딩 중 스크롤바가 생기며 폭이 바뀌어도 sticky flex 줄을 다시 계산하지 않는다. 대응 2종: `.student-quick-nav`를 가로 스크롤 대신 `flex-wrap: wrap`, + `updateStudentQuickNav` 끝에서 `forceRelayout()`(rAF에서 display 토글). 칸 *내부*를 고치는 시도(칩 CSS화·button→span·min-width)는 전부 헛수고였다 — 원인은 줄 전체의 가로 압박이었다.
- ⚠️ **훈련일지 JS는 해시 없는 ES 모듈**(`js/modules/*.js`)이라 구버전 사파리(15.x)는 **강제 새로고침으로도 하위 import를 캐시에서 꺼내온다**. CSS(`style.css`)만 새 버전이 되는 상태가 실제로 발생하므로, 구형 브라우저 버그를 고칠 땐 **CSS만으로도 듣는 형태**로 넣을 것. 사파리 캐시를 비우려면 Safari > 설정 > 고급 > 개발자용 메뉴 > 개발자용 > 캐시 비우기. 실제 사례: 퀵내비 칩이 붙은 항목의 이름이 0폭으로 눌려 사라진 버그 — `.student-quick-nav-btn`/`.student-badge`의 `min-width: max-content`가 최종 해법이었다(JS 수정 2회는 캐시 때문에 도달하지 못했다).
- **세트 순서 이동**: 기록 입력 폼·수정 모달의 각 세트 헤더 오른쪽 `↑`/`↓` 버튼으로 이웃 세트와 자리를 바꾼다. 마크업은 `sets.js`의 `moveButtons(핸들러명, index, total)` 하나를 양쪽이 공유하고(입력폼 `moveSet` / 수정모달 `moveEditSet`), 실제 교환은 순수 함수 `swapSets(배열, index, delta)`(범위 밖이면 false). 갈 수 없는 방향은 버튼을 아예 안 그린다(disabled 스타일 불필요). 테스트 `sets.test.js`.
- **1RM으로 세트 채우기**: 기록 입력 폼에서 1RM이 저장된 종목을 고르면 종목칸 아래 `⚡ 내 1RM ○○kg — %로 세트 채우기` 칩(`#oneRMQuickCard`, `renderOneRMChip` — `renderExerciseMemo`에서 함께 호출) → 모달(`#percentModal`)에서 %를 **누른 순서대로** 1세트부터 강도(kg)에 입력. 높은 %를 먼저 누르면 무거운 것부터가 되어 별도 정렬 옵션이 필요 없다. 반복 수·선택 개수 초과 세트는 유지, 세트가 모자라면 마지막 세트를 복제해 확장. `oneRMRecords` 맵은 세션 캐시(Firestore 읽기 1회, 저장/삭제 시 갱신).

## 환경변수

### 프론트엔드 (VITE\_ 접두사)

- `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`
- `VITE_GOOGLE_SHEETS_ID`
- `VITE_FUNCTIONS_URL` (로컬 개발: `http://localhost:5001`)
- `VITE_CLOUDINARY_CLOUD_NAME`, `VITE_CLOUDINARY_UPLOAD_PRESET` (게시판 이미지 업로드)
- `VITE_SENTRY_DSN` (선택, 미설정 시 코드 내 기본 DSN 사용; 프로덕션에서만 init)
- `VITE_FIREBASE_VAPID_KEY` (웹 푸시. Firebase 콘솔 > 프로젝트 설정 > 클라우드 메시징 > 웹 푸시 인증서에서 발급. **없으면 푸시 기능 전체가 조용히 no-op**)

### 서버 (Netlify Functions)

- `GOOGLE_PROJECT_ID`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_CLIENT_EMAIL`, `GOOGLE_SHEETS_ID`
- `SOLAPI_API_KEY`, `SOLAPI_API_SECRET`, `SOLAPI_SENDER_PHONE`
- `COACH_PHONE`
- `NAVER_STORE_LINK_2`, `NAVER_STORE_LINK_3`, `NAVER_STORE_LINK_4`
- `PREPARATION_MESSAGE`
- `GOOGLE_CALENDAR_ID` (입학반 일정 동기화 대상 캘린더)

> ⚠️ 루트의 `*-<해시>.json`(Google 서비스 계정 키)은 시크릿이다. `.gitignore`에 있어야 하며 커밋·노출 금지.

## 작업 시 주의사항

1. **Google Sheets 컬럼 순서(A\~R)를 절대 변경하지 말 것** — 전체 서비스 로직이 컬럼 인덱스에 의존
2. **시트 탭 명명 규칙** `등록생 목록(YY년M월)` **유지** — `getCurrentSheetName()` 함수가 이 패턴에 의존
3. **이중 쓰기 패턴 유지** — 홀딩/결석은 Firebase + Sheets 양쪽 모두 업데이트
4. **종료일 재계산 누락 주의** — 홀딩/결석/보강 변경 시 반드시 `calculateEndDate` 호출하여 H열 업데이트
5. **actualRow = \_rowIndex + 3** — 시트 행 번호 변환 시 이 공식 준수
6. **날짜 형식 혼용 주의** — Sheets는 YYMMDD, JS 내부는 YYYY-MM-DD, 특이사항은 YY.M.D
7. **코치/학생 역할에 따라 UI가 다름** — BottomNav 탭, 기능 접근 권한 확인
8. **A열 번호 자동 부여** — 신규 등록 시 A열 최대값+1로 부여 (중복 방지)
9. **초기 로드는 최근 창(-3~+2개월) 시트만 읽는다** — `getAllStudentsFromAllSheets`가 `src/utils/recentSheets.js`의 `filterRecentStudentSheets`로 시트를 제한하므로, 컨텍스트 `students`에는 그 창 밖(4개월+ 과거)의 등록이 없다. 과거 월 상세는 `changeMonth`(단일 시트), 매출 통계는 `getAllRawRows`(전체 시트) 별도 경로 사용
10. **recharts 화면은 lazy 청크** — `Ranking`·`AnalyticsDashboard`는 `App.jsx`에서 `React.lazy`로 분리 로드. 이 컴포넌트를 다른 곳에서 정적 import하면 분리가 깨진다
11. **Netlify sheets/calendar 함수는 `@googleapis/sheets`·`@googleapis/calendar` 단독 패키지 사용** — `googleapis` 전체 패키지로 되돌리면 콜드스타트가 크게 나빠진다. 인증 클라이언트는 모듈 스코프 캐시(요청마다 재생성 금지)
12. **users 뱃지 맵은 `getUsersMaps` 1회 스캔 공유** — `getTierMap`/`getGradeMap`에 개별 스캔·개별 캐시를 다시 넣지 말 것. 티어/학년 쓰기 후에는 캐시 전체 무효화 대신 해당 항목만 제자리 갱신
13. **훈련일지 `loadPinnedMemosForSelectedStudents`의 캐시 가드를 없애지 말 것** — `renderPinnedMemosForCoach`가 `loadAllRecords`의 `onSnapshot` 콜백 안에서도 불리므로, 캐시가 없으면 학생이 기록을 저장할 때마다 선택 인원×2 문서를 다시 읽는다(7명이면 스냅샷 1회당 14 read). 문서를 직접 고친 쓰기 경로는 캐시를 같이 갱신하거나 `renderPinnedMemosForCoach(이름)`으로 그 학생만 재조회시킨다