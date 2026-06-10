# 전체 디자인 리팩토링 (플랫 + 코발트) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 근력학교 앱 전체 비주얼을 보라 그라데이션 테마에서 완전 플랫 + 단일 코발트(#329BE7) 액센트로 전환한다.

**Architecture:** `src/index.css :root`에 디자인 토큰을 먼저 정립한 뒤, 화면 묶음별 9개 phase로 CSS/JSX의 하드코딩 색·그라데이션·그림자를 토큰으로 치환한다. 각 phase는 독립 커밋이며 빌드·린트·grep·스크린샷으로 검증한다.

**Tech Stack:** React 19, Vite 7, 순수 CSS (변수 기반), 일부 JS 스타일 객체(`scheduleStyles.js`)

**참고 스펙:** `docs/superpowers/specs/2026-06-10-design-refactoring-cobalt-flat-design.md`

---

## 공통 치환 매핑 (모든 phase에서 동일 적용 — 이 표가 작업의 기준)

CSS/JSX/JS 스타일에서 아래 값을 찾으면 오른쪽 토큰/값으로 바꾼다.

| 찾을 값 (정규식/문자열) | 바꿀 값 |
|---|---|
| `linear-gradient(135deg, #667eea 0%, #764ba2 100%)` (브랜드 그라데이션, 배경) | `var(--accent)` (액센트 면) 또는 `var(--surface)` (큰 면적) — 맥락 판단 |
| `linear-gradient(... #667eea ... #764ba2 ...)` (텍스트 클립 그라데이션) | 단색 `var(--accent)` + 클립 속성 제거 |
| `linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)` (body/페이지 배경) | `var(--canvas-tint)` |
| `#667eea` / `#764ba2` (단색) | `var(--accent)` |
| `#f093fb` / `#f5576c` / `#4facfe` / `#00f2fe` (보조 그라데이션 색) | `var(--accent)` 또는 상태색 (맥락 판단) |
| 텍스트 `#1f2937` / `#374151` | `var(--text)` |
| 텍스트 `#6b7280` | `var(--text-secondary)` |
| 텍스트 `#9ca3af` | `var(--text-muted)` |
| 보더 `#e5e7eb` | `var(--hairline)` |
| 배경 `#f9fafb` / `#f0f4ff` / `#eef2ff` / `#e0e7ff` | `var(--canvas-tint)` |
| 장식 `box-shadow: ... rgba(102,126,234,..)` / 진한 그림자 | 삭제 후 `border: 1px solid var(--hairline)` (모달/팝오버는 그림자 유지) |
| `border-radius` 임의값 → 가장 가까운 사다리 | `8/12/16/18/20/32px` 중 택1 (`var(--r-*)`) |
| 상태 그라데이션 (성공 `#dcfce7/#bbf7d0`, 경고 `#fef3c7/#fde68a`, 대기 `#fef9c3/#fde047`, 결석 `#fee2e2/#fecaca`) | 해당 상태색 `{색}1A` 배경 + `{색}4D` 보더 (단색) |

**상태색 매핑**: 성공/신규 → `--success #31A552`, 경고/홀딩 → `--caution #EDBC40`, 결석/오류 → `--error #E94E58`, 보강/정보 → `--info #5E56F0`, 정규/액센트 → `--accent`.

**phase 검증 명령** (각 phase 끝에서 실행):
- `npm run build` → 성공
- `npm run lint` → 신규 에러 0
- `git grep -nE "667eea|764ba2|f093fb|f5576c|4facfe" -- <이번 phase 파일들>` → 0건
- 해당 화면 스크린샷 1장으로 시각 확인 (보라/그라데이션 잔존 없음)

---

## Task 0: 디자인 토큰 토대 (Phase 0)

**Files:**
- Modify: `src/index.css` (전체 — 1~126줄)
- Modify: `src/App.css:13`, `:21-25`, `:38`, `:47-50`

- [ ] **Step 1: `src/index.css`의 `:root`를 토큰 세트로 교체**

`@import url('https://fonts.googleapis.com/...Inter...')` 줄 다음에 Noto Sans KR도 포함하도록 import를 교체:
```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Sans+KR:wght@400;500;700&display=swap');
```

`:root { ... }` 블록 전체를 아래로 교체:
```css
:root {
  /* 브랜드 — 단일 코발트 + 알파 사다리 */
  --accent: #329BE7;        --accent-hover: #327AB8;   --accent-light: #47C8FF;
  --accent-30: #329BE74D;   --accent-20: #329BE733;    --accent-10: #329BE71A;

  /* 표면 (플랫) */
  --canvas: #FFFFFF;  --surface: #FCFCFC;  --canvas-tint: #F7F7F8;  --hairline: #EFEFF0;

  /* 텍스트 — 반투명 검정 (#000 금지) */
  --text: rgba(0,0,0,0.85);  --text-secondary: rgba(0,0,0,0.6);  --text-muted: #A7A7AA;
  --cta-dark: #242428;

  /* 상태색 — "상태"에만 */
  --success: #31A552;  --caution: #EDBC40;  --error: #E94E58;  --info: #5E56F0;

  /* 라디우스 사다리 (보간 금지) */
  --r-chip: 8px;  --r-md: 12px;  --r-cta: 18px;  --r-card: 20px;  --r-band: 32px;  --r-full: 9999px;

  /* 간격 */
  --sp-xs: 4px;  --sp-sm: 8px;  --sp-md: 16px;  --sp-lg: 24px;  --sp-xl: 32px;  --sp-xxl: 48px;

  /* 모션 */
  --ease: cubic-bezier(0.3,0,0,1);  --dur-s: 150ms;  --dur-m: 300ms;  --dur-l: 450ms;

  /* 폰트 — Inter + Noto KR */
  --font: 'Inter','Noto Sans KR',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;

  /* 하위호환 (기존 변수 참조 코드가 깨지지 않게 매핑) */
  --bg-primary: var(--canvas);
  --bg-secondary: var(--canvas-tint);
  --bg-glass: var(--canvas);
  --text-primary: var(--text);
  --text-secondary: var(--text-secondary);
  --text-muted: var(--text-muted);
  --border-color: var(--hairline);
  --warning: var(--caution);
  --error: var(--error);
  --info: var(--info);
}
```

- [ ] **Step 2: `body`를 플랫 흰 배경으로, 폰트 변수 사용**

`body { ... }` 블록에서:
```css
body {
  font-family: var(--font);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  background: var(--canvas-tint);
  color: var(--text);
  letter-spacing: -0.1px;
}
```

- [ ] **Step 3: 스크롤바·그라데이션 유틸 제거**

`::-webkit-scrollbar-thumb`의 `background: linear-gradient(...)` → `background: var(--text-muted)`, hover → `var(--text-secondary)`.
`.text-gradient` 유틸 블록(72~77줄) 삭제. `--primary-gradient`/`--secondary-gradient`/`--accent-gradient` 변수 삭제(위 :root 교체로 이미 제거됨).
`@keyframes` (fadeIn/slideUp/slideDown/float)는 유지.

- [ ] **Step 4: `src/App.css` 그라데이션 치환**

`.coming-soon` 배경(13줄) → `background: var(--canvas-tint);`
`.coming-soon h1`(21~24줄) → `color: var(--accent);` 로 바꾸고 `-webkit-background-clip`/`-webkit-text-fill-color`/`background-clip`/`background` 그라데이션 4줄 삭제.
`.coming-soon p` 색 `#6b7280` → `var(--text-secondary)`.
`.back-button` 보더 `#e5e7eb`→`var(--hairline)`, 색 `#374151`→`var(--text)`, radius `12px`→`var(--r-md)`, hover 배경 `#f9fafb`→`var(--canvas-tint)`, hover 보더/색 `#667eea`→`var(--accent)`.

- [ ] **Step 5: 빌드·grep 검증**

Run: `npm run build`
Expected: `✓ built` 성공
Run: `git grep -nE "667eea|764ba2|linear-gradient|text-gradient" -- src/index.css src/App.css`
Expected: 0건

- [ ] **Step 6: 커밋**

```bash
git add src/index.css src/App.css
git commit -m "refactor(design): Phase 0 — 디자인 토큰 정립 + 플랫 흰 배경 전환

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 1: 진입 화면 (Phase 1)

**Files:**
- Modify: `src/components/Login.css`, `src/components/BottomNav.css`, `src/components/Dashboard.css`
- Modify: `src/components/Dashboard.jsx` (인라인 색 5곳: `:374`, `:390`, `:445`, `:500`, `:654`)

- [ ] **Step 1: Login.css / BottomNav.css / Dashboard.css 치환**

공통 치환 매핑표 전부 적용. 특히:
- 모든 `linear-gradient(...#667eea...)` 버튼/헤더 배경 → `var(--accent)` (텍스트 흰색 유지)
- 활성 탭/하이라이트 → `var(--accent)` 또는 `var(--accent-10)` 배경
- 카드 `box-shadow` 진한 보라 그림자 → 삭제 + `border: 1px solid var(--hairline)`
- radius 임의값 → 사다리 스냅

- [ ] **Step 2: Dashboard.jsx 인라인 색 치환**

- `:445` `background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'` → `background: 'var(--accent)'`
- `:374`, `:500` 경고 그라데이션 `#fef3c7,#fde68a` → `background: 'var(--caution-10, #EDBC401A)'`, 보더 `var(--caution)` (인라인이라 hex 직접: `#EDBC401A` / `#EDBC40`)
- `:390` 결석 그라데이션 `#fee2e2,#fecaca` → `#E94E581A` 배경 + `#E94E58` 보더
- `:654` `#eef2ff,#e0e7ff` → `var(--accent-10)` (인라인 hex: `#329BE71A`)

- [ ] **Step 3: 빌드·grep·스크린샷 검증**

Run: `npm run build && npm run lint`
Expected: 빌드 성공, 신규 lint 에러 0
Run: `git grep -nE "667eea|764ba2" -- src/components/Login.css src/components/BottomNav.css src/components/Dashboard.css src/components/Dashboard.jsx`
Expected: 0건
로그인·대시보드 화면 스크린샷 확인.

- [ ] **Step 4: 커밋**

```bash
git add src/components/Login.css src/components/BottomNav.css src/components/Dashboard.css src/components/Dashboard.jsx
git commit -m "refactor(design): Phase 1 — 로그인·하단탭·대시보드 플랫 코발트 전환

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: 시간표 코어 (Phase 2)

**Files:**
- Modify: `src/components/WeeklySchedule.css`, `src/components/TimeTable.css`, `src/components/MonthSelector.css`
- Modify: `src/components/schedule/scheduleStyles.js` (`:17` 성공, `:24` 경고, `:31` 대기 그라데이션)
- Modify: `src/components/schedule/StudentSchedule.jsx` (`:325` 줄무늬, `:494` 홀딩 회색 그라데이션)
- Modify: `src/components/schedule/CoachWaitlistPanel.jsx` (`:10` 노란 그라데이션)

- [ ] **Step 1: CSS 3종 치환**

공통 매핑표 적용. 시간표 슬롯/셀 배경은 `var(--canvas)`, 보더 `var(--hairline)`, 정원/시간 텍스트 `var(--text-muted)`.

- [ ] **Step 2: scheduleStyles.js 상태 스타일을 단색 상태칩으로 교체**

- `:17` 성공 `linear-gradient(135deg, #dcfce7, #bbf7d0)` → `background: '#31A5521A'`, `border: '1px solid #31A5524D'`, `color: '#31A552'`
- `:24` 경고 `#fef3c7,#fde68a` → `background: '#EDBC401A'`, `border: '1px solid #EDBC404D'`, `color: '#9a7a12'`
- `:31` 대기 `#fef9c3,#fde047` → `background: '#EDBC401A'`, `border: '1px solid #EDBC404D'`, `color: '#9a7a12'`

- [ ] **Step 3: StudentSchedule.jsx / CoachWaitlistPanel.jsx 치환**

- StudentSchedule `:325` `repeating-linear-gradient(45deg, #f3f4f6...)` 비활성 줄무늬 → 단색 `background: 'var(--canvas-tint)'` (또는 `#F7F7F8`)
- StudentSchedule `:494` 홀딩 `linear-gradient(135deg, #9ca3af 0%, #6b7280 100%)` → `background: '#A7A7AA'`
- CoachWaitlistPanel `:10` `linear-gradient(135deg, #fef9c3, #fde047)` → `background: '#EDBC401A'`, 보더 `#EDBC404D`

- [ ] **Step 4: 빌드·grep·스크린샷 검증**

Run: `npm run build && npm run lint`
Run: `git grep -nE "667eea|764ba2|linear-gradient" -- src/components/WeeklySchedule.css src/components/TimeTable.css src/components/MonthSelector.css src/components/schedule/`
Expected: 0건
주간 시간표(코치/학생) 스크린샷 확인 — 상태칩(정규/보강/홀딩/결석/신규) 색 구분 유지 확인.

- [ ] **Step 5: 커밋**

```bash
git add src/components/WeeklySchedule.css src/components/TimeTable.css src/components/MonthSelector.css src/components/schedule/
git commit -m "refactor(design): Phase 2 — 시간표 슬롯·상태칩 플랫 전환

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: 게시판 (Phase 3)

**Files:**
- Modify: `src/components/board/Board.css`
- Modify: `src/components/board/PostList.jsx` (`:135` 작성자색), `src/components/board/PostForm.jsx` (`:217` 안내색, `:235` 버튼 그라데이션)

- [ ] **Step 1: Board.css 치환**

공통 매핑표 적용. 카테고리칩 → `var(--accent-10)` 배경 + `var(--accent)` 텍스트. 작성자(코치)색 → `var(--accent)`. 좋아요/댓글 카운트 → `var(--text-secondary)`.

- [ ] **Step 2: PostList.jsx / PostForm.jsx 인라인 치환**

- PostList `:135` `color: '#667eea'` → `color: 'var(--accent)'`
- PostForm `:217` `color: '#667eea'` → `color: 'var(--accent)'`
- PostForm `:235` `'linear-gradient(135deg, #667eea, #764ba2)'` → `'var(--accent)'`

- [ ] **Step 3: 빌드·grep·스크린샷 검증**

Run: `npm run build && npm run lint`
Run: `git grep -nE "667eea|764ba2" -- src/components/board/`
Expected: 0건
게시판 목록·글 상세·작성 모달 스크린샷 확인.

- [ ] **Step 4: 커밋**

```bash
git add src/components/board/
git commit -m "refactor(design): Phase 3 — 게시판 플랫 코발트 전환

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: 코치 관리 (Phase 4)

**Files:**
- Modify: `src/components/StudentManager.css`, `src/components/HoldingManager.css`, `src/components/StudentRegistrationModal.css`, `src/components/CoachNewStudents.css`
- Modify: `src/components/StudentManager.jsx` (`:597` 홀딩 행, `:674` 버튼 배경), `src/components/HoldingManager.jsx` (`:751` 스피너, `:842`, `:849`, `:865`, `:939`, `:964`), `src/components/HolidayManager.jsx` (`:257` info-card)

- [ ] **Step 1: CSS 4종 치환**

공통 매핑표 적용. 모달 오버레이는 `rgba(0,0,0,0.3)` scrim 유지, 모달 본체만 그림자 유지(`box-shadow` OK). 그 외 카드 그림자는 보더로 교체.

- [ ] **Step 2: StudentManager.jsx 인라인 치환**

- `:597` 홀딩 행 `background: '#f0f4ff'`, `border: '1px solid #667eea'` → `background: 'var(--accent-10)'`, `border: '1px solid var(--accent-30)'`, radius `8px`→`var(--r-chip)`
- `:674` `background: '#667eea'` → `background: 'var(--accent)'`

- [ ] **Step 3: HoldingManager.jsx 인라인 치환**

- `:751` 스피너 `borderTop: '4px solid #667eea'` → `borderTop: '4px solid var(--accent)'`
- `:842` info-card `background: '#f0f4ff', borderColor: '#667eea'` → `background: 'var(--accent-10)', borderColor: 'var(--accent-30)'`
- `:849` 홀딩 라벨 `color: '#667eea'` → `color: 'var(--accent)'`
- `:865` 홀딩 박스 `border: '1px solid #667eea'` → `border: '1px solid var(--accent-30)'`
- `:939` 결석 라벨 `color: '#764ba2'` → `color: 'var(--error)'`
- `:964` 결석 박스 `border: '1px solid #764ba2'` → `border: '1px solid #E94E584D'`

- [ ] **Step 4: HolidayManager.jsx 인라인 치환**

- `:257` `background: '#f0f4ff', borderColor: '#667eea'` → `background: 'var(--accent-10)', borderColor: 'var(--accent-30)'`

- [ ] **Step 5: 빌드·grep·스크린샷 검증**

Run: `npm run build && npm run lint`
Run: `git grep -nE "667eea|764ba2" -- src/components/StudentManager.css src/components/HoldingManager.css src/components/StudentRegistrationModal.css src/components/CoachNewStudents.css src/components/StudentManager.jsx src/components/HoldingManager.jsx src/components/HolidayManager.jsx`
Expected: 0건
수강생 관리·홀딩·신규승인·등록모달 스크린샷 확인.

- [ ] **Step 6: 커밋**

```bash
git add src/components/StudentManager.* src/components/HoldingManager.* src/components/StudentRegistrationModal.css src/components/CoachNewStudents.css src/components/HolidayManager.jsx
git commit -m "refactor(design): Phase 4 — 코치 관리 화면 플랫 코발트 전환

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: 학생 상세 (Phase 5)

**Files:**
- Modify: `src/components/StudentInfo.css`, `src/components/Ranking.css`, `src/components/PRSubmitModal.css`, `src/components/ContractView.css`, `src/components/ContractHistory.css`
- Modify: `src/components/StudentInfo.jsx` (`:233` 그라데이션, `:234` 그라데이션)

- [ ] **Step 1: CSS 5종 치환**

공통 매핑표 적용. Ranking 차트색은 코발트 계열 단색(`--accent`, `--accent-light`)으로. PR 그래프 라인 색 → `var(--accent)`.

- [ ] **Step 2: StudentInfo.jsx 진행바 치환**

`:233-234` 진행바 그라데이션 (`#f093fb,#f5576c` / `#667eea,#764ba2`) → 단색: 위험구간은 `'var(--error)'`, 정상은 `'var(--accent)'`로 분기.

- [ ] **Step 3: 빌드·grep·스크린샷 검증**

Run: `npm run build && npm run lint`
Run: `git grep -nE "667eea|764ba2|f093fb|f5576c" -- src/components/StudentInfo.* src/components/Ranking.css src/components/PRSubmitModal.css src/components/ContractView.css src/components/ContractHistory.css`
Expected: 0건
내정보·랭킹(3탭)·PR모달·계약 화면 스크린샷 확인.

- [ ] **Step 4: 커밋**

```bash
git add src/components/StudentInfo.* src/components/Ranking.css src/components/PRSubmitModal.css src/components/ContractView.css src/components/ContractHistory.css
git commit -m "refactor(design): Phase 5 — 학생 상세(내정보·랭킹·PR·계약) 플랫 전환

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: 외부 등록 위자드 (Phase 6)

**Files:**
- Modify: `src/components/NewStudentRegistration.css` (보라/그라데이션 26곳 — 최다)

- [ ] **Step 1: 치환**

공통 매핑표 적용. 단계 진행 인디케이터 활성 → `var(--accent)`, 비활성 → `var(--hairline)`. 제출/다음 버튼 → `var(--accent)` (또는 최종 제출은 `var(--cta-dark)`). 헤더 그라데이션 배너 → 플랫 `var(--canvas)` + 하단 `var(--hairline)` 보더.

- [ ] **Step 2: 빌드·grep·스크린샷 검증**

Run: `npm run build && npm run lint`
Run: `git grep -nE "667eea|764ba2|f093fb|f5576c|4facfe" -- src/components/NewStudentRegistration.css`
Expected: 0건
`?register=true` 위자드 7단계 스크린샷 확인.

- [ ] **Step 3: 커밋**

```bash
git add src/components/NewStudentRegistration.css
git commit -m "refactor(design): Phase 6 — 신규 등록 위자드 플랫 코발트 전환

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: 관리 유틸 (Phase 7)

**Files:**
- Modify: `src/components/GoogleSheetsSync.css`, `src/components/GoogleSheetsEmbed.css`, `src/components/GoogleSheetsTest.css`

- [ ] **Step 1: 치환**

공통 매핑표 적용. 내부 전용 화면이라 동일 규칙으로 기계적 치환.

- [ ] **Step 2: 빌드·grep 검증**

Run: `npm run build && npm run lint`
Run: `git grep -nE "667eea|764ba2|linear-gradient" -- src/components/GoogleSheetsSync.css src/components/GoogleSheetsEmbed.css src/components/GoogleSheetsTest.css`
Expected: 0건

- [ ] **Step 3: 커밋**

```bash
git add src/components/GoogleSheetsSync.css src/components/GoogleSheetsEmbed.css src/components/GoogleSheetsTest.css
git commit -m "refactor(design): Phase 7 — Sheets 관리 유틸 화면 플랫 전환

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: 훈련일지 서브앱 (Phase 8)

**Files:**
- Read 먼저: `public/training-log/index.html` (Tailwind CDN config 위치 확인), `public/training-log/css/style.css`
- Modify: `public/training-log/index.html` (Tailwind config theme.extend.colors), `public/training-log/css/style.css`

- [ ] **Step 1: 현황 확인**

Run: `git grep -nE "667eea|764ba2|linear-gradient|tailwind.config" -- public/training-log/`
Tailwind CDN config(`tailwind.config = {...}`)가 index.html에 있으면 `theme.extend.colors.accent = '#329BE7'` 등 추가, 없으면 style.css에서 직접 색 치환.

- [ ] **Step 2: 치환**

style.css의 보라/그라데이션을 공통 매핑표대로 치환. Tailwind 유틸 클래스(`bg-purple-*`, `from-*/to-*` 그라데이션)는 코발트 계열(`bg-[#329BE7]`)로 교체.

- [ ] **Step 3: grep·스크린샷 검증**

Run: `git grep -nE "667eea|764ba2|gradient-to|from-purple|to-purple" -- public/training-log/`
Expected: 0건
훈련일지 메인 화면 스크린샷 확인.

- [ ] **Step 4: 커밋**

```bash
git add public/training-log/
git commit -m "refactor(design): Phase 8 — 훈련일지 서브앱 플랫 코발트 전환

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: 최종 검증 + 정리

- [ ] **Step 1: 전역 잔존 확인**

Run: `git grep -nE "667eea|764ba2|f093fb|f5576c|4facfe|00f2fe" -- src public/training-log`
Expected: 0건 (있으면 해당 phase로 돌아가 수정)
Run: `git grep -cn "linear-gradient" -- src public/training-log`
Expected: 0건 (남았다면 의도적인 것인지 확인 — 스펙상 0이 목표)

- [ ] **Step 2: 전체 빌드·린트**

Run: `npm run build && npm run lint && npm run test`
Expected: 빌드 성공, lint 신규 에러 0, 테스트 통과

- [ ] **Step 3: main 머지 및 푸시**

```bash
git checkout main && git pull --ff-only
git merge --no-ff refactor/cobalt-flat-design -m "Merge refactor/cobalt-flat-design: 전체 플랫+코발트 디자인 리팩토링"
git push
```

- [ ] **Step 4: CLAUDE.md 디자인 토큰 섹션 추가**

`CLAUDE.md`에 "## 디자인 시스템" 섹션을 추가: 토큰 변수 목록, 플랫 원칙, 라디우스 사다리, 상태색 규칙. 별도 커밋·푸시.
