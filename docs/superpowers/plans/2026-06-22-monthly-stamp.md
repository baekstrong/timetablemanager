# 월간 도장 시스템 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 코치가 한 달에 한 번 수강생 훈련일지에 3등급 도장을 찍고, 학생은 도장 배지·팝업으로, 코치는 네비 빨간점으로 이를 인지하게 한다.

**Architecture:** 훈련일지 서브앱(Vanilla JS)에 도장 순수 로직(`stamp-logic.js`) + Firebase/DOM 모듈(`stamp.js`)을 추가한다. 코치는 "운동 종목 관리" 옆 버튼으로 전원 리스트 모달을 열어 자동추천 등급을 확정(batch write to `monthlyStamps`)한다. 학생 화면은 도장 배지 + 첫 접속 팝업을 띄운다. 메인 React 앱은 `BottomNav` 훈련일지 탭에 빨간점(이번 달 도장 미완료 시)을 표시한다.

**Tech Stack:** Vanilla JS (Firebase compat SDK, `db.collection().get()`/`db.batch()`), React 19, Firestore 모듈 SDK, Vitest.

## Global Constraints

- 훈련일지 서브앱은 `:root` CSS 변수를 못 쓴다 → 색은 hex 직접 사용 (`#E94E58` 빨강 / `#329BE7` 코발트 / `#EDBC40` 앰버). **보라/인디고 금지.**
- 도장 3등급 키·문구·색 (verbatim):
  - `great` = "참 잘했어요" = `#E94E58`
  - `good` = "잘하고 있어요" = `#329BE7`
  - `tryharder` = "더 힘내요!" = `#EDBC40`
- 자동추천 경계 = 티어 경계 재사용: 활동일 ≥ 13 → `great`, ≥ 6 → `good`, 그 미만 → `tryharder`.
- `monthlyStamps` 문서 ID = `{userName}__{YYYY-MM}`, `month`은 도장을 부여한 달. 활동 통계는 **지난달** 기록 기준.
- 훈련일지 함수는 `window`에 노출(main.js `Object.assign(window, Stamp)` 패턴), 모달은 `.modal`+`.active` 패턴 재사용. 새 모달 프레임워크 금지.
- 한국 시간 가정(앱 전체 동일). `new Date()`는 훈련일지/React 앱 모두 사용 가능.

---

### Task 1: 도장 순수 로직 + 테스트

날짜 집합/평균/등급추천/지난달 범위 계산. 유일하게 자동 테스트가 가능한 비즈니스 로직.

**Files:**
- Create: `public/training-log/js/modules/stamp-logic.js`
- Create: `public/training-log/js/modules/stamp-logic.test.js`
- Modify: `vitest.config.js` (include glob 확장)

**Interfaces:**
- Produces:
  - `STAMP_GRADES` — `{ great:{label,color}, good:{...}, tryharder:{...} }`
  - `STAMP_ORDER` — `['great','good','tryharder']`
  - `prevMonthRange(monthStr)` → `{ prevMonth:'YYYY-MM', start:'YYYY-MM-DD', end:'YYYY-MM-DD' }`
  - `computeStampStats(records)` → `{ activeDays:number, totalExercises:number, avgExercises:number }` (records = `[{date, exercise}]` for one student in the period)
  - `suggestGrade(activeDays)` → `'great'|'good'|'tryharder'`

- [ ] **Step 1: 순수 로직 작성**

Create `public/training-log/js/modules/stamp-logic.js`:

```js
// 월간 도장 순수 로직 — Firebase/DOM 의존 없음 (브라우저 + vitest 양쪽에서 import 가능)

export const STAMP_GRADES = {
    great:     { label: '참 잘했어요',   color: '#E94E58' },
    good:      { label: '잘하고 있어요', color: '#329BE7' },
    tryharder: { label: '더 힘내요!',    color: '#EDBC40' },
};

export const STAMP_ORDER = ['great', 'good', 'tryharder'];

// 자동추천 등급 — 티어 경계(13/6) 재사용
// ponytail: 경계 바뀌면 여기 숫자만 수정
export function suggestGrade(activeDays) {
    if (activeDays >= 13) return 'great';
    if (activeDays >= 6) return 'good';
    return 'tryharder';
}

// 'YYYY-MM' → 지난달 범위. 1월이면 전년 12월로 롤오버.
export function prevMonthRange(monthStr) {
    const [y, m] = monthStr.split('-').map(Number);
    const py = m === 1 ? y - 1 : y;
    const pm = m === 1 ? 12 : m - 1;
    const pmStr = String(pm).padStart(2, '0');
    const lastDay = new Date(py, pm, 0).getDate(); // pm은 1-based, day 0 = 그 달 말일
    return {
        prevMonth: `${py}-${pmStr}`,
        start: `${py}-${pmStr}-01`,
        end: `${py}-${pmStr}-${String(lastDay).padStart(2, '0')}`,
    };
}

// 한 학생의 기간 내 records → 활동일/총종목/일평균
export function computeStampStats(records) {
    const days = new Set();
    for (const r of records) {
        if (r && r.date) days.add(r.date);
    }
    const activeDays = days.size;
    const totalExercises = records.length;
    const avgExercises = activeDays === 0 ? 0
        : Math.round((totalExercises / activeDays) * 10) / 10;
    return { activeDays, totalExercises, avgExercises };
}
```

- [ ] **Step 2: 테스트 작성**

Create `public/training-log/js/modules/stamp-logic.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { suggestGrade, prevMonthRange, computeStampStats } from './stamp-logic.js';

describe('suggestGrade', () => {
    it('활동일 13 이상이면 great', () => {
        expect(suggestGrade(18)).toBe('great');
        expect(suggestGrade(13)).toBe('great');
    });
    it('활동일 6~12면 good', () => {
        expect(suggestGrade(12)).toBe('good');
        expect(suggestGrade(6)).toBe('good');
    });
    it('활동일 6 미만이면 tryharder', () => {
        expect(suggestGrade(5)).toBe('tryharder');
        expect(suggestGrade(0)).toBe('tryharder');
    });
});

describe('prevMonthRange', () => {
    it('일반 달은 직전 달 범위', () => {
        expect(prevMonthRange('2026-06')).toEqual({
            prevMonth: '2026-05', start: '2026-05-01', end: '2026-05-31',
        });
    });
    it('1월은 전년 12월로 롤오버', () => {
        expect(prevMonthRange('2026-01')).toEqual({
            prevMonth: '2025-12', start: '2025-12-01', end: '2025-12-31',
        });
    });
    it('2월 말일(평년 28일) 계산', () => {
        expect(prevMonthRange('2026-03').end).toBe('2026-02-28');
    });
});

describe('computeStampStats', () => {
    it('같은 날 여러 종목이면 활동일 1, 일평균은 종목수', () => {
        const recs = [
            { date: '2026-05-01', exercise: '벤치' },
            { date: '2026-05-01', exercise: '스쿼트' },
            { date: '2026-05-01', exercise: '데드' },
        ];
        expect(computeStampStats(recs)).toEqual({
            activeDays: 1, totalExercises: 3, avgExercises: 3,
        });
    });
    it('건성 케이스: 활동일 높고 일평균 1점대', () => {
        const recs = [
            { date: '2026-05-01', exercise: 'a' },
            { date: '2026-05-02', exercise: 'b' },
            { date: '2026-05-03', exercise: 'c' },
            { date: '2026-05-03', exercise: 'd' },
        ];
        const s = computeStampStats(recs);
        expect(s.activeDays).toBe(3);
        expect(s.avgExercises).toBe(1.3);
    });
    it('빈 배열은 0', () => {
        expect(computeStampStats([])).toEqual({
            activeDays: 0, totalExercises: 0, avgExercises: 0,
        });
    });
});
```

- [ ] **Step 3: vitest include 확장**

Modify `vitest.config.js` — `include` 배열에 훈련일지 경로 추가:

```js
    include: ['src/**/*.test.js', 'public/training-log/**/*.test.js'],
```

- [ ] **Step 4: 테스트 실행해 통과 확인**

Run: `npm test -- stamp-logic`
Expected: PASS (3 describe 블록 모두 통과)

- [ ] **Step 5: 커밋**

```bash
git add public/training-log/js/modules/stamp-logic.js public/training-log/js/modules/stamp-logic.test.js vitest.config.js
git commit -m "feat(도장): 월간 도장 순수 로직(등급추천/지난달범위/통계) + 테스트"
```

---

### Task 2: 도장 Firebase/DOM 모듈 (stamp.js)

코치 모달 로직 + 학생 배지/팝업 로직. DOM·Firebase를 다루므로 자동 테스트 대신 브라우저 수동 검증.

**Files:**
- Create: `public/training-log/js/modules/stamp.js`

**Interfaces:**
- Consumes: `state`, `db` (from `../state.js`); `getKoreanInitial` (from `../utils.js`); Task 1의 `stamp-logic.js` 전체.
- Produces (모두 `window`에 노출 예정):
  - `currentMonthStr()` → `'YYYY-MM'`
  - `openStampModal()` / `closeStampModal()`
  - `confirmAllStamps()`
  - `loadMyStamp()` (학생 화면 진입 시 호출)
  - `closeStampPopup()`
  - `renderStampBadge(stamp)` → HTML string (배지)

- [ ] **Step 1: 모듈 작성**

Create `public/training-log/js/modules/stamp.js`:

```js
import { state, db } from '../state.js';
import { getKoreanInitial } from '../utils.js';
import { STAMP_GRADES, STAMP_ORDER, prevMonthRange, computeStampStats, suggestGrade } from './stamp-logic.js';

export function currentMonthStr() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"]/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
    ));
}

// ===== 코치: 도장 모달 =====

export async function openStampModal() {
    const modal = document.getElementById('stampModal');
    if (!modal) return;
    modal.classList.add('active');
    const body = document.getElementById('stampModalBody');
    body.innerHTML = '<div class="text-center text-gray-500 py-8">불러오는 중...</div>';

    const month = currentMonthStr();
    const { prevMonth, start, end } = prevMonthRange(month);
    document.getElementById('stampModalSubtitle').textContent = `지난달(${prevMonth}) 기준`;

    // 1) 학생 목록
    const usersSnap = await db.collection('users').get();
    const students = [];
    usersSnap.forEach(d => {
        const u = d.data();
        if (!u.isCoach) students.push(d.id);
    });
    students.sort((a, b) => a.localeCompare(b, 'ko'));

    // 2) 지난달 기록 1회 범위 조회 후 학생별 그룹핑
    const recSnap = await db.collection('records')
        .where('date', '>=', start).where('date', '<=', end).get();
    const byStudent = {};
    recSnap.forEach(d => {
        const r = d.data();
        (byStudent[r.userName] = byStudent[r.userName] || []).push({ date: r.date, exercise: r.exercise });
    });

    // 3) 이미 이번 달 찍은 도장 프리필
    const stampSnap = await db.collection('monthlyStamps').where('month', '==', month).get();
    const existing = {};
    stampSnap.forEach(d => { existing[d.data().userName] = d.data(); });

    // 3.5) 학생별 고정 메모 (전체 1회 조회)
    const pmSnap = await db.collection('pinnedMemos').get();
    const memosByStudent = {};
    pmSnap.forEach(d => { memosByStudent[d.id] = (d.data().memos || []); });

    // 4) 행 렌더
    const rows = students.map((name, idx) => {
        const stats = computeStampStats(byStudent[name] || []);
        const prefGrade = existing[name]?.grade || suggestGrade(stats.activeDays);
        const comment = existing[name]?.comment || '';
        const warn = stats.activeDays >= 6 && stats.avgExercises > 0 && stats.avgExercises < 1.5;
        const options = STAMP_ORDER.map(g =>
            `<option value="${g}" ${g === prefGrade ? 'selected' : ''}>${STAMP_GRADES[g].label}</option>`
        ).join('');
        const memos = memosByStudent[name] || [];
        const memoBtn = `<button type="button" onclick="document.getElementById('stamp-memos-${idx}').classList.toggle('hidden')" class="text-xs text-[#329BE7] underline ${memos.length ? '' : 'opacity-40 pointer-events-none'}">📝 메모 ${memos.length}개</button>`;
        const memoList = memos.length === 0 ? '' : `
                <div id="stamp-memos-${idx}" class="hidden mt-1 pl-2 border-l-2 border-gray-200 space-y-1">
                    ${memos.map(m => `<div class="text-xs text-gray-600">${m.pain ? '⚠️ ' : ''}<b>${escapeHtml(m.exercise)}</b> ${escapeHtml(m.memo)}</div>`).join('')}
                </div>`;
        return `
            <div class="border-b border-gray-200 py-2" data-student="${escapeHtml(name)}">
                <div class="flex items-center gap-2 flex-wrap">
                    <span class="font-bold text-gray-800 w-20">${escapeHtml(name)}</span>
                    <span class="text-xs text-gray-500">활동 ${stats.activeDays}일 · 일평균 ${stats.avgExercises}종목 ${warn ? '⚠️' : ''}</span>
                    ${memoBtn}
                    <select class="stamp-grade-select ml-auto px-2 py-1 border rounded-lg text-sm">${options}</select>
                </div>
                ${memoList}
                <input type="text" class="stamp-comment-input w-full mt-1 px-2 py-1 border rounded-lg text-sm"
                       placeholder="💬 한 줄 코멘트 (선택)" value="${escapeHtml(comment)}">
            </div>`;
    }).join('');

    body.innerHTML = rows || '<div class="text-center text-gray-500 py-8">수강생이 없습니다.</div>';
    document.getElementById('stampConfirmBtn').textContent = `전체 확정 (${students.length}명)`;
}

export function closeStampModal() {
    const modal = document.getElementById('stampModal');
    if (modal) modal.classList.remove('active');
}

export async function confirmAllStamps() {
    const month = currentMonthStr();
    const rows = document.querySelectorAll('#stampModalBody [data-student]');
    if (rows.length === 0) { closeStampModal(); return; }

    const batch = db.batch();
    rows.forEach(row => {
        const name = row.getAttribute('data-student');
        const grade = row.querySelector('.stamp-grade-select').value;
        const comment = row.querySelector('.stamp-comment-input').value.trim();
        const ref = db.collection('monthlyStamps').doc(`${name}__${month}`);
        batch.set(ref, {
            userName: name,
            month,
            grade,
            comment,
            stampedBy: state.currentUser,
            stampedAt: new Date().toISOString(),
            seenByStudent: false, // ponytail: 재확정 시 학생 팝업 다시 뜸 — 월 1회라 허용
        });
    });
    await batch.commit();
    closeStampModal();
    alert(`${rows.length}명에게 도장을 찍었습니다.`);
}

// ===== 학생: 배지 + 팝업 =====

export function renderStampBadge(stamp) {
    if (!stamp || !STAMP_GRADES[stamp.grade]) return '';
    const g = STAMP_GRADES[stamp.grade];
    const comment = stamp.comment
        ? `<p class="text-sm text-gray-600 mt-1">${escapeHtml(stamp.comment)}</p>` : '';
    return `
        <div class="rounded-lg p-4 mb-4 text-center" style="border:2px solid ${g.color};background:${g.color}1A">
            <div class="inline-block px-4 py-1 rounded-full font-bold text-white" style="background:${g.color}">
                ${g.label}
            </div>
            ${comment}
        </div>`;
}

export async function loadMyStamp() {
    const container = document.getElementById('myStampContainer');
    if (!container) return;
    const month = currentMonthStr();
    const ref = db.collection('monthlyStamps').doc(`${state.currentUser}__${month}`);
    const doc = await ref.get();
    if (!doc.exists) { container.innerHTML = ''; return; }
    const stamp = doc.data();
    container.innerHTML = renderStampBadge(stamp);

    if (!stamp.seenByStudent) {
        showStampPopup(stamp);
        await ref.update({ seenByStudent: true });
    }
}

function showStampPopup(stamp) {
    const g = STAMP_GRADES[stamp.grade];
    if (!g) return;
    const comment = stamp.comment
        ? `<p class="text-gray-600 mt-2">${escapeHtml(stamp.comment)}</p>` : '';
    const overlay = document.createElement('div');
    overlay.id = 'stampPopupOverlay';
    overlay.className = 'modal active';
    overlay.innerHTML = `
        <div class="modal-content max-w-sm w-full text-center">
            <p class="text-sm text-gray-500 mb-3">이번 달 코치님의 도장이 도착했어요</p>
            <div class="inline-block px-6 py-2 rounded-full text-xl font-bold text-white mb-2" style="background:${g.color}">
                ${g.label}
            </div>
            ${comment}
            <button onclick="closeStampPopup()" class="mt-4 w-full bg-[#329BE7] hover:bg-[#327AB8] text-white py-2 rounded-lg font-bold">확인</button>
        </div>`;
    document.body.appendChild(overlay);
}

export function closeStampPopup() {
    document.getElementById('stampPopupOverlay')?.remove();
}
```

- [ ] **Step 2: 구문 확인**

Run: `node --check public/training-log/js/modules/stamp.js`
Expected: 에러 없이 종료 (import 경고는 무시 — `--check`는 구문만 검사)

> 참고: `node --check`는 ESM import를 구문으로만 본다. 통과하면 OK.

- [ ] **Step 3: 커밋**

```bash
git add public/training-log/js/modules/stamp.js
git commit -m "feat(도장): 코치 도장 모달 + 학생 배지/팝업 모듈(stamp.js)"
```

---

### Task 3: 훈련일지 UI 배선 (버튼·모달·배지·window 노출)

stamp.js를 실제 화면에 연결한다.

**Files:**
- Modify: `public/training-log/js/ui.js` (코치 버튼, 모달 HTML, 학생 배지 컨테이너)
- Modify: `public/training-log/js/main.js` (import, window 노출, 모달 append, 학생 로드 호출)

**Interfaces:**
- Consumes: Task 2의 `Stamp.openStampModal/closeStampModal/confirmAllStamps/loadMyStamp` (window 경유 `onclick`).
- Produces: `renderStampModalHTML()` (ui.js) — 모달 HTML string.

- [ ] **Step 1: 코치 화면에 "이달의 도장" 버튼 추가**

Modify `public/training-log/js/ui.js` — line 154~158 어드민 메뉴 div. "운동 종목 관리" 버튼 **앞에** 도장 버튼 추가:

```html
            <!-- 어드민 메뉴 (운동 관리) -->
            <div class="mb-4 text-right flex justify-end gap-2">
                <button onclick="openStampModal()" class="bg-[#E94E58] text-white px-4 py-2 rounded-lg text-sm font-semibold hover:opacity-90 transition flex items-center inline-flex gap-2">
                    📋 이달의 도장
                </button>
                <button onclick="openAdminModal()" class="bg-gray-800 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-gray-900 transition flex items-center inline-flex gap-2">
                    ⚙️ 운동 종목 관리
                </button>
            </div>
```

- [ ] **Step 2: 도장 모달 HTML 렌더 함수 추가**

Modify `public/training-log/js/ui.js` — `renderAdminModalHTML()` 함수(257~282행) **바로 뒤에** 추가:

```js
export function renderStampModalHTML() {
    return `
        <div id="stampModal" class="modal">
            <div class="modal-content max-w-2xl w-full">
                <div class="flex justify-between items-center mb-1">
                    <h2 class="text-xl font-bold text-gray-800">📋 ${(() => { const n = new Date(); return `${n.getMonth() + 1}월의 도장`; })()}</h2>
                    <button onclick="closeStampModal()" class="text-gray-500 hover:text-gray-700 text-2xl">×</button>
                </div>
                <p id="stampModalSubtitle" class="text-xs text-gray-500 mb-3"></p>
                <div id="stampModalBody" class="max-h-[60vh] overflow-y-auto"></div>
                <button id="stampConfirmBtn" onclick="confirmAllStamps()"
                        class="mt-4 w-full bg-[#E94E58] hover:opacity-90 text-white py-3 rounded-lg font-bold">
                    전체 확정
                </button>
            </div>
        </div>`;
}
```

- [ ] **Step 3: 학생 화면에 도장 배지 컨테이너 추가**

Modify `public/training-log/js/ui.js` — `renderStudentScreen()` 헤더 div(65~74행) **바로 뒤**, `pinnedMemosContainer`(76~77행) **앞에** 추가:

```html
            <!-- 이번 달 도장 -->
            <div id="myStampContainer"></div>

```

- [ ] **Step 4: main.js — import & window 노출 & 모달 append & 학생 로드**

Modify `public/training-log/js/main.js`:

(a) line 2 import에 `renderStampModalHTML` 추가:

```js
import { renderLoginScreen, renderStudentScreen, renderCoachScreen, renderAdminModalHTML, renderStampModalHTML } from './ui.js';
```

(b) 파일 상단 다른 모듈 import 옆에 Stamp import 추가 (예: `import * as Admin from './modules/admin.js';` 줄 근처):

```js
import * as Stamp from './modules/stamp.js';
```

(c) `initApp()` 의 `Object.assign(window, Admin);`(268행) 바로 뒤에 추가:

```js
    Object.assign(window, Stamp);
```

(d) 코치 렌더 분기(221행) — 모달 HTML을 함께 append:

```js
        app.innerHTML = renderCoachScreen() + renderAdminModalHTML() + renderStampModalHTML();
```

(e) 학생 렌더 분기 — `Records.updatePinnedDisplay();`(252행) 바로 뒤에 도장 로드 추가:

```js
        Stamp.loadMyStamp();
```

- [ ] **Step 5: 수동 검증 (코치)**

```bash
npm run dev
```
1. 코치로 훈련일지 진입 → "📋 이달의 도장" 버튼이 "운동 종목 관리" 왼쪽에 보임.
2. 클릭 → 모달에 수강생 전원 + 활동일/일평균/`📝 메모 N개`/등급 드롭다운(자동추천 채워짐) 표시.
2-1. `📝 메모 N개` 클릭 → 그 학생의 고정 메모 목록(운동명+내용, 통증 ⚠️)이 펼쳐지고, 다시 클릭하면 접힘. 메모 0개면 비활성(흐릿).
3. 등급 변경/코멘트 입력 후 [전체 확정] → "N명에게 도장을 찍었습니다" alert, 모달 닫힘.
4. Firestore `monthlyStamps`에 `{이름}__{YYYY-MM}` 문서 생성 확인.

Expected: 위 4단계 모두 정상.

- [ ] **Step 6: 수동 검증 (학생)**

학생 계정으로 훈련일지 진입 →
1. 헤더 아래 도장 배지(문구+색) 표시.
2. 첫 진입 시 도장 팝업 1회 → 확인 닫음 → 새로고침해도 팝업 안 뜸(배지는 유지).
3. Firestore에서 해당 학생 문서 `seenByStudent: true` 확인.

Expected: 위 3단계 정상.

- [ ] **Step 7: 커밋**

```bash
git add public/training-log/js/ui.js public/training-log/js/main.js
git commit -m "feat(도장): 훈련일지에 도장 버튼·모달·학생 배지/팝업 배선"
```

---

### Task 4: 메인 앱 네비 빨간점

코치가 이번 달 도장을 안 찍었으면 메인 React 앱 하단 "훈련일지" 탭에 빨간점.

**Files:**
- Modify: `src/services/firebaseService.js` (쿼리 함수 추가)
- Modify: `src/App.jsx` (state + 폴링 effect + prop 전달)
- Modify: `src/components/BottomNav.jsx` (prop 수신 + dot 렌더)

**Interfaces:**
- Produces: `isMonthlyStampDone(monthStr)` → `Promise<boolean>` (firebaseService.js)
- Consumes: BottomNav `hasStampPendingNotification` prop.

- [ ] **Step 1: firebaseService에 쿼리 함수 추가**

Modify `src/services/firebaseService.js` — 파일 끝부분(다른 export 함수 옆)에 추가. (`collection`, `query`, `where`, `getDocs`, `limit as queryLimit`는 이미 import됨 — 1~15행 확인)

```js
// 이번 달 월간 도장 작업을 했는지 (문서 1개라도 있으면 완료로 간주)
export async function isMonthlyStampDone(monthStr) {
    const q = query(
        collection(db, 'monthlyStamps'),
        where('month', '==', monthStr),
        queryLimit(1)
    );
    const snap = await getDocs(q);
    return !snap.empty;
}
```

- [ ] **Step 2: App.jsx — state + 폴링 effect**

Modify `src/App.jsx`:

(a) import에 `isMonthlyStampDone` 추가 (firebaseService import 줄에 합류).

(b) 다른 notification state 옆(47행 `hasNewPostNotification` 근처)에 추가:

```jsx
  const [hasStampPendingNotification, setHasStampPendingNotification] = useState(false);
```

(c) 코치 신규신청 폴링 effect(58~85행) **바로 뒤에** 새 effect 추가:

```jsx
  // 코치: 이번 달 도장 미완료면 훈련일지 탭에 빨간점
  useEffect(() => {
    if (!user || user.role !== 'coach') return;

    const checkStamp = async () => {
      try {
        const now = new Date();
        const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const done = await isMonthlyStampDone(monthStr);
        setHasStampPendingNotification(!done);
      } catch {
        // ignore polling errors
      }
    };

    const checkIfVisible = () => { if (isPageVisible()) checkStamp(); };
    checkIfVisible();
    const interval = setInterval(checkIfVisible, NOTIFICATION_POLL_INTERVAL);
    const onVisible = () => checkIfVisible();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [user]);
```

(d) `<BottomNav>`(418~426행)에 prop 추가:

```jsx
          hasStampPendingNotification={hasStampPendingNotification}
```

- [ ] **Step 3: BottomNav에 prop 수신 + dot 렌더**

Modify `src/components/BottomNav.jsx`:

(a) 컴포넌트 시그니처(3행)에 prop 추가:

```jsx
const BottomNav = ({ currentPage, user, onNavigate, hasNewStudentNotification, hasWaitlistNotification, hasContractNotification, hasNewPostNotification, hasStampPendingNotification }) => {
```

(b) tab-icon 내부 dot 렌더 블록(123~128행) 뒤에 추가:

```jsx
                            {tab.id === 'training-log' && hasStampPendingNotification && (
                                <span className="notification-dot" />
                            )}
```

- [ ] **Step 4: lint + 수동 검증**

Run: `npm run lint`
Expected: 신규 코드 관련 에러 없음.

수동:
```bash
npm run dev
```
1. (Firestore에서 이번 달 `monthlyStamps` 문서 전부 삭제한 상태로) 코치 로그인 → 하단 "훈련일지" 탭에 빨간점 표시.
2. Task 3대로 도장 [전체 확정] 후, 탭 화면 복귀 → (폴링 주기 또는 탭 visibility 변경 시) 빨간점 사라짐.
3. 학생 로그인 → 빨간점 없음.

Expected: 위 3단계 정상.

- [ ] **Step 5: 커밋**

```bash
git add src/services/firebaseService.js src/App.jsx src/components/BottomNav.jsx
git commit -m "feat(도장): 코치 훈련일지 탭에 이번 달 도장 미완료 빨간점"
```

---

## 배포 후

- CLAUDE.md 업데이트: `monthlyStamps` 컬렉션을 Firestore 컬렉션 표에 추가, 훈련일지 서브앱 섹션에 도장 기능 한 줄.
- 수강생 체감 변경(도장 배지/팝업)이므로 `/deploy-notice`로 공지 초안 제안 → 백관장 승인.

## Self-Review 결과

- **Spec 커버리지**: 3등급(Task1/2) · 데이터모델 monthlyStamps(Task2) · 코치 모달+자동추천+일평균신호+전체확정(Task1/2/3) · 빨간점(Task4) · 학생 배지+첫접속 팝업(Task2/3) 모두 태스크 존재. ✓
- **Placeholder 스캔**: 모든 코드 step에 실제 코드 포함, TBD 없음. ✓
- **타입 일관성**: `suggestGrade`/`computeStampStats`/`prevMonthRange` 시그니처가 Task1 정의와 Task2 사용처 일치, 등급 키(great/good/tryharder) 전 구간 동일, 문서 ID 규칙 `{name}__{month}` Task2/4 동일. ✓
