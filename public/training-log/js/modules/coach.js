import { state, db, firebaseInitialized } from '../state.js';
import { getKoreanInitial, getStudentColor, getStudentBadgeColor, getStudentTextColor, formatDate, debounce } from '../utils.js';

const debouncedLoadAllRecords = debounce(loadAllRecords, 300);
import { normalizeSet } from './sets.js';
import { groupSessionsByDate, defaultSessionDate } from './session-logic.js';
import { resolveClassSlot, previousSlot, rosterFor, slotHasEnded, PERIODS } from './class-period.js';

// 기록의 date는 로컬 기준 YYYY-MM-DD → 오늘도 로컬로 계산(toISOString은 UTC라 KST 새벽에 하루 밀림)
function localToday() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ============================================
// 코치 기능
// ============================================

export async function loadStudentList() {
    const studentListDiv = document.getElementById('studentList');
    if (!studentListDiv) return;

    try {
        resetCoachSessionCache(); // 페이지 재진입 시 세션 캐시 비워 최신 기록 재조회
        // users 컬렉션에서 수강생 목록 조회 (records 전체 조회 대비 훨씬 빠름)
        const usersSnapshot = await db.collection('users').get();

        const studentSet = new Set();
        usersSnapshot.forEach(doc => {
            const userData = doc.data();
            const userName = doc.id;
            // 코치가 아닌 사용자만 수강생으로 표시
            if (userName && userName !== state.currentUser && !userData.isCoach) {
                studentSet.add(userName);
            }
        });

        state.allStudents = Array.from(studentSet).sort();

        if (state.allStudents.length === 0) {
            studentListDiv.innerHTML = '<div class="text-gray-500 text-sm">아직 등록된 수강생이 없습니다.</div>';
            return;
        }

        // Restore selection from localStorage if state is empty (first load)
        if (state.selectedStudents.length === 0) {
            const saved = localStorage.getItem('coachSelectedStudents');
            if (saved) {
                try {
                    const parsed = JSON.parse(saved);
                    if (Array.isArray(parsed)) {
                        state.selectedStudents = parsed.filter(s => state.allStudents.includes(s));
                    }
                } catch (e) {
                    console.error('Failed to load saved selection:', e);
                }
            }
        }

        // Feature 4: Restore Filters
        if (localStorage.getItem('coachPainFilter') === 'true') {
            state.painFilter = true;
            const chk = document.getElementById('painFilterCheck');
            if (chk) chk.checked = true;
        }
        // 운동 메모만 보기: 저장된 값이 없으면 기본 true (체크)
        const savedMemoFilter = localStorage.getItem('coachPinnedMemoFilter');
        if (savedMemoFilter === null || savedMemoFilter === 'true') {
            state.pinnedMemoFilter = true;
            const chk = document.getElementById('pinnedMemoFilterCheck');
            if (chk) chk.checked = true;
        }

        // 초성별로 그룹화
        const groupedByInitial = {};
        state.allStudents.forEach(student => {
            const initial = getKoreanInitial(student);
            if (!groupedByInitial[initial]) {
                groupedByInitial[initial] = [];
            }
            groupedByInitial[initial].push(student);
        });

        const sortedInitials = Object.keys(groupedByInitial).sort();

        let html = '';

        // 전체 선택 버튼
        const allSelected = state.selectedStudents.length === state.allStudents.length && state.allStudents.length > 0;
        html += `
            <div class="w-full mb-3 pb-3 border-b border-gray-300">
                <button 
                    onclick="toggleSelectAll()"
                    class="px-4 py-2 rounded-lg text-sm font-semibold ${allSelected ? 'bg-green-500 text-white' : 'bg-[#329BE7] text-white'} hover:opacity-90 transition"
                >
                    ${allSelected ? '✓ 전체 선택됨 (' + state.allStudents.length + '명)' : '👥 전체 선택 (' + state.allStudents.length + '명)'}
                </button>
                <button
                    onclick="clearStudentSelection()"
                    class="ml-2 px-4 py-2 rounded-lg text-sm font-semibold bg-red-100 text-red-700 hover:bg-red-200"
                    style="display: ${state.selectedStudents.length > 0 ? '' : 'none'}"
                >
                    ✕ 선택 해제 (${state.selectedStudents.length})
                </button>
                <button
                    onclick="toggleDeleteMode()"
                    class="ml-2 px-4 py-2 rounded-lg text-sm font-semibold ${state.deleteMode ? 'bg-red-500 text-white' : 'bg-gray-200 text-gray-600'} hover:opacity-90 transition"
                >
                    ${state.deleteMode ? '삭제 모드 ON' : '수강생 삭제'}
                </button>
            </div>
        `;

        sortedInitials.forEach(initial => {
            const students = groupedByInitial[initial];

            html += `
                <div class="w-full mb-4">
                    <div class="flex items-center mb-2">
                        <span class="text-lg font-bold text-gray-800 bg-gray-100 px-3 py-1 rounded">${initial}</span>
                        <span class="text-xs text-gray-500 ml-2">(${students.length}명)</span>
                    </div>
                    <div class="flex flex-wrap gap-2 ml-2">
            `;

            students.forEach(student => {
                const isSelected = state.selectedStudents.includes(student);
                if (state.deleteMode) {
                    html += `
                        <span class="student-badge px-3 py-2 rounded-full text-sm font-semibold bg-red-100 text-red-700 border-2 border-red-300 flex items-center gap-1">
                            ${student}
                            <button onclick="deleteStudentAccount('${student}')" class="ml-1 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold leading-none hover:bg-red-700">✕</button>
                        </span>
                    `;
                } else {
                    html += `
                        <span
                            data-name="${escHtml(student)}"
                            class="student-badge px-3 py-2 rounded-full text-sm font-semibold ${isSelected ? 'active' : 'bg-gray-200 text-gray-700'}"
                            onclick="toggleStudent('${student}')"
                        >${escHtml(labelFor(student, isSelected ? '✓ ' : ''))}</span>
                    `;
                }
            });

            html += `
                    </div>
                </div>
            `;
        });

        studentListDiv.innerHTML = html;
        updateStudentSelectionSummary();

        // Quick nav bar 업데이트
        updateStudentQuickNav();

        // 진입 시 '지금(또는 방금 끝난) 수업' 명단을 자동 선택 → 코치가 이름을 고르지 않아도 된다.
        // 안쪽에서 renderCoachSessionView까지 호출한다.
        await applyCurrentClassRoster({ silent: true });

    } catch (error) {
        console.error('Error loading student list:', error);
        studentListDiv.innerHTML = '<div class="text-red-500 text-sm">수강생 목록 로딩 실패</div>';
        updateStudentSelectionSummary();
    }
}

// ============================================
// '지금 수업' 자동 명단
// ============================================

// 명단 출처 두 가지 (둘 다 메인 앱이 발행한 단일 문서 = 읽기 1회):
//  1) studentMeta/roster-YYYY-MM-DD — 코치 시간표가 계산한 그 날 교시별 실제 출석 명단.
//     보강으로 오는 사람 포함, 홀딩·결석·보강이동은 빠져 있다.
//  2) studentMeta/schedules — 시트 D열 정규 시간표. 아직 발행되지 않은 과거 날짜의 폴백.
let schedulesMap = null;
const rosterByDate = {}; // 'YYYY-MM-DD' → {'1': [이름...]} | null(없음)
// 지금 표시 중인 수업의 이름→태그. 수강생 선택 버튼에 시간표와 같은 칩(보강/마지막)을 띄우는 데만 쓴다.
// 명단 출처(roster/정규 시간표)와 무관하게 여기서 직접 계산한다 — 폴백에서도 칩이 나오도록.
let currentRosterTags = {};
const makeupsByDate = {}; // 'YYYY-MM-DD' → {'4': [이름...]} 그 날 보강으로 오는 사람
let lastClassesMap = null; // 이름 → {date, period} (메인 앱이 발행)
// past 슬롯이면 그 수업 날짜의 기록을 열어야 한다 → 세션 뷰 기본 날짜로 쓰이는 힌트.
export let coachPreferredDate = null;

async function loadSchedules(force = false) {
    if (!firebaseInitialized || !db) return;
    if (schedulesMap && !force) return;
    try {
        const schedDoc = await db.collection('studentMeta').doc('schedules').get();
        schedulesMap = (schedDoc.exists && schedDoc.data().map) ? schedDoc.data().map : {};
    } catch (error) {
        console.error('시간표 조회 실패:', error);
        schedulesMap = schedulesMap || {};
    }
}

// 그 날짜의 코치 시간표 명단(studentMeta/roster-YYYY-MM-DD). 날짜당 1회만 읽는다.
async function loadRosterForDate(date) {
    if (date in rosterByDate) return rosterByDate[date];
    if (!firebaseInitialized || !db) return null;
    try {
        const doc = await db.collection('studentMeta').doc(`roster-${date}`).get();
        rosterByDate[date] = doc.exists ? (doc.data().map || null) : null;
    } catch (error) {
        console.error('출석 명단 조회 실패:', date, error);
        rosterByDate[date] = null;
    }
    return rosterByDate[date];
}

// 그 날 보강으로 오는 사람(교시별). 날짜당 1쿼리, 되감기 루프가 같은 날짜를 다시 봐도 재조회 없음.
async function loadMakeupsForDate(date) {
    if (date in makeupsByDate) return makeupsByDate[date];
    if (!firebaseInitialized || !db) return {};
    try {
        const snap = await db.collection('makeupRequests').where('makeupClass.date', '==', date).get();
        const byPeriod = {};
        snap.forEach(doc => {
            const d = doc.data();
            if (d.status !== 'active' && d.status !== 'completed') return; // 취소·거절 제외
            const p = String(d.makeupClass?.period ?? '');
            if (!p || !d.studentName) return;
            (byPeriod[p] = byPeriod[p] || []).push(d.studentName);
        });
        makeupsByDate[date] = byPeriod;
    } catch (error) {
        console.error('보강 조회 실패:', date, error);
        makeupsByDate[date] = {};
    }
    return makeupsByDate[date];
}

// 이름 → 마지막 수업. 시트 종료날짜는 훈련일지가 모르므로 메인 앱이 발행한 문서를 읽는다.
async function loadLastClasses() {
    if (lastClassesMap) return lastClassesMap;
    if (!firebaseInitialized || !db) return {};
    try {
        const doc = await db.collection('studentMeta').doc('lastClasses').get();
        lastClassesMap = (doc.exists && doc.data().map) ? doc.data().map : {};
    } catch (error) {
        console.error('마지막 수업 조회 실패:', error);
        lastClassesMap = {};
    }
    return lastClassesMap;
}

// 명단에 있는 사람만 태그한다 — roster 경로에선 시간표 판정(보강홀딩·보강결석 제외)이 이미 걸러준 뒤라
// 여기서 보강 판정을 다시 해도 없는 사람이 새로 붙지 않는다.
export async function tagsForSlot(names, slot) {
    const [makeups, last] = await Promise.all([loadMakeupsForDate(slot.date), loadLastClasses()]);
    const makeupSet = new Set(makeups[String(slot.period.id)] || []);
    const tags = {};
    names.forEach(n => {
        const t = [];
        if (makeupSet.has(n)) t.push('보강');
        const lc = last[n];
        if (lc && lc.date === slot.date && String(lc.period) === String(slot.period.id)) t.push('마지막');
        if (t.length) tags[n] = t;
    });
    return tags;
}

// 코치 시간표가 발행한 그 날 명단이 있으면 사용(보강 포함·안 오는 사람 제외).
// 없으면(발행 전 날짜) 정규 시간표 + 그 날 보강자로 폴백 — 정규 시간표엔 보강 온 사람이 없다.
// 반환: { names, source }
async function rosterForSlot(slot) {
    const map = await loadRosterForDate(slot.date);
    const names = map?.[String(slot.period.id)];
    if (Array.isArray(names)) return { names, source: 'roster' };
    const makeups = (await loadMakeupsForDate(slot.date))[String(slot.period.id)] || [];
    const regular = rosterFor(schedulesMap, slot.dayLabel, slot.period.id);
    return { names: [...new Set([...regular, ...makeups])], source: 'schedule' };
}

// 지금/방금 끝난 교시의 수강생을 선택 상태로 만든다. 새로고침 버튼도 이걸 호출한다.
// 시간표에서 수업 칸을 눌러 들어온 경우: 그 수업 명단을 그대로 쓴다(자동 계산으로 덮어쓰지 않음).
// 한 번 쓰고 지운다 → 이후 🔄 새로고침은 다시 '지금 수업' 기준.
function consumeClickedSlot() {
    let raw = null;
    try { raw = localStorage.getItem('trainingLogSlot'); } catch { return null; }
    if (!raw) return null;
    localStorage.removeItem('trainingLogSlot');
    try {
        const s = JSON.parse(raw);
        const period = PERIODS.find(p => p.id === s.periodId);
        if (!period || !s.date) return null;
        return { slot: { period, dayLabel: s.dayLabel, date: s.date, status: 'picked' }, names: s.names || [] };
    } catch {
        return null;
    }
}

export async function applyCurrentClassRoster({ silent = false } = {}) {
    const clicked = consumeClickedSlot();
    if (clicked) return applyPickedSlot(clicked);

    let slot = resolveClassSlot();
    if (!slot) return;

    // 새로고침 때마다 다시 읽는다(보강 신청·홀딩 변경 반영)
    Object.keys(rosterByDate).forEach(k => delete rosterByDate[k]);
    Object.keys(makeupsByDate).forEach(k => delete makeupsByDate[k]);
    lastClassesMap = null;
    await loadSchedules(true);

    // 수업이 없는 빈 교시는 건너뛰고 실제로 사람이 있던 수업까지 되감는다.
    // (예: 금 13:44 → '마지막 수업'이 2교시인데 그 교시는 수업이 없음)
    let roster = [];
    let source = 'roster';
    currentRosterTags = {};
    for (let i = 0; i < 12; i++) {
        const r = await rosterForSlot(slot);
        roster = r.names.filter(n => state.allStudents.includes(n)); // 훈련일지 계정이 있는 사람만
        if (roster.length > 0) { source = r.source; currentRosterTags = await tagsForSlot(roster, slot); break; }
        const prev = previousSlot(slot);
        if (!prev) break;
        slot = prev;
    }

    // 수업이 끝난 교시면 그 날짜 기록을 펼친다. 수업 중이면 기존 규칙(오늘 이전 마지막 수업)을 따른다.
    coachPreferredDate = slot.status === 'past' ? slot.date : null;

    state.selectedStudents = roster;
    localStorage.setItem('coachSelectedStudents', JSON.stringify(roster));
    // 새로 고를 때마다 캐시된 선택 날짜를 버려야 preferredDate가 반영된다
    Object.keys(coachSessionSelectedDate).forEach(k => delete coachSessionSelectedDate[k]);

    renderClassSlotBanner(slot, roster.length, source);
    updateStudentBadges();
    updateStudentSelectionSummary();
    updateStudentQuickNav();
    await renderCoachSessionView();

    if (!silent && roster.length === 0) {
        alert(`${slot.dayLabel}요일 ${slot.period.label}에 등록된 수강생이 없습니다.`);
    }
}
window.applyCurrentClassRoster = applyCurrentClassRoster;

// 시간표에서 고른 수업을 그대로 표시. 이미 끝난 수업이면 그 날짜 기록을 편다.
async function applyPickedSlot({ slot, names }) {
    const roster = names.filter(n => state.allStudents.includes(n));
    currentRosterTags = await tagsForSlot(roster, slot);
    coachPreferredDate = slotHasEnded(slot) ? slot.date : null;

    state.selectedStudents = roster;
    localStorage.setItem('coachSelectedStudents', JSON.stringify(roster));
    Object.keys(coachSessionSelectedDate).forEach(k => delete coachSessionSelectedDate[k]);

    renderClassSlotBanner(slot, roster.length, 'roster');
    updateStudentBadges();
    updateStudentSelectionSummary();
    updateStudentQuickNav();
    await renderCoachSessionView();
}

function renderClassSlotBanner(slot, count, source) {
    const el = document.getElementById('classSlotBanner');
    if (!el) return;
    const isNow = slot.status === 'now';
    const isPicked = slot.status === 'picked';
    const title = isPicked ? '선택한 수업' : (isNow ? '지금 수업' : '마지막 수업');
    const color = isPicked ? '#329BE7' : (isNow ? '#31A552' : '#A7A7AA');
    // 코치 시간표 명단이면 보강·홀딩까지 반영된 정확한 명단, 폴백이면 정규 시간표 기준임을 밝힌다.
    const note = source === 'roster'
        ? '<span class="text-xs text-gray-400 ml-2">보강 포함</span>'
        : '<span class="text-xs text-[#EDBC40] ml-2">정규 시간표 기준</span>';
    el.innerHTML = `
        <div class="flex items-center justify-between gap-2 bg-white rounded-lg px-4 py-3 border border-[#EFEFF0]">
            <div class="text-sm">
                <span class="font-bold" style="color:${color}">${title}</span>
                <span class="text-gray-800 font-semibold ml-1">${slot.dayLabel} ${slot.period.label}</span>
                <span class="text-gray-400 ml-1">${slot.period.start}~${slot.period.end}</span>
                <span class="text-gray-500 ml-2">· ${count}명</span>${note}
            </div>
            <button type="button" onclick="applyCurrentClassRoster()"
                    class="shrink-0 bg-[#329BE7] hover:bg-[#327AB8] text-white text-xs font-bold px-3 py-2 rounded-lg transition">
                🔄 새로고침
            </button>
        </div>`;
}

export function updateStudentSelectionSummary() {
    const summary = document.getElementById('studentSelectionSummary');
    if (!summary) return;

    if (state.allStudents.length === 0) {
        summary.textContent = '등록된 수강생이 없습니다.';
        return;
    }

    if (state.selectedStudents.length === 0) {
        summary.textContent = `전체 ${state.allStudents.length}명 | 선택: 없음`;
    } else if (state.selectedStudents.length === state.allStudents.length) {
        summary.textContent = `전체 ${state.allStudents.length}명 모두 선택됨`;
    } else {
        summary.textContent = `전체 ${state.allStudents.length}명 | 선택: ${state.selectedStudents.length}명 (${state.selectedStudents.join(', ')})`;
    }
}

export function toggleStudent(studentName) {
    const index = state.selectedStudents.indexOf(studentName);

    if (index === -1) {
        state.selectedStudents.push(studentName);
    } else {
        state.selectedStudents.splice(index, 1);
    }

    // Save selection to localStorage
    localStorage.setItem('coachSelectedStudents', JSON.stringify(state.selectedStudents));

    // Update UI without reloading entire list (which would restore from localStorage)
    updateStudentBadges();
    updateStudentSelectionSummary();
    updateStudentQuickNav();

    // 메모/기록 업데이트
    renderCoachSessionView();
}

// Helper function to update student badges without full reload
// 보강/마지막 표시. 상단 퀵내비 바와 하단 선택 목록 양쪽이 쓴다.
//
// ⚠️ 작은 칩(span 박스)을 쓰지 않는다. 구버전 사파리(15.6)에서 10px 칩이 계속 눌려
//    껍데기만 남고 글자가 잘렸고, 옆에 붙은 이름까지 0폭으로 사라졌다.
//    CSS(flex 고정·min-width·요소 교체)로 세 번 시도했지만 전부 실패.
//    → 자식 요소를 아예 만들지 않는다. 이름과 같은 텍스트 노드에 ' · 보강'을 붙이고
//      색은 칸 자체에 준다. 자식이 0개면 눌릴 것도 잘릴 것도 없다.
function labelFor(name, prefix = '') {
    const tags = currentRosterTags[name] || [];
    return `${prefix}${name}${tags.length ? ' · ' + tags.join(' · ') : ''}`;
}

// 칸 자체에 상태색을 입힌다(마지막이 더 급한 정보라 우선).
function applyTagClass(el, name) {
    const tags = currentRosterTags[name] || [];
    el.classList.remove('tag-makeup', 'tag-last');
    if (tags.includes('마지막')) el.classList.add('tag-last');
    else if (tags.includes('보강')) el.classList.add('tag-makeup');
}

function updateStudentBadges() {
    // 이름은 data-name에서 읽는다 — textContent엔 칩 글자가 섞여 있다.
    const badges = document.querySelectorAll('.student-badge[data-name]');
    badges.forEach(badge => {
        const studentName = badge.dataset.name;
        const isSelected = state.selectedStudents.includes(studentName);

        badge.classList.toggle('active', isSelected);
        badge.classList.toggle('bg-gray-200', !isSelected);
        badge.classList.toggle('text-gray-700', !isSelected);
        badge.textContent = labelFor(studentName, isSelected ? '✓ ' : '');
    });

    // Update select all button
    const allSelected = state.selectedStudents.length === state.allStudents.length && state.allStudents.length > 0;
    const selectAllBtn = document.querySelector('button[onclick="toggleSelectAll()"]');
    if (selectAllBtn) {
        if (allSelected) {
            selectAllBtn.className = 'px-4 py-2 rounded-lg text-sm font-semibold bg-green-500 text-white hover:opacity-90 transition';
            selectAllBtn.innerHTML = `✓ 전체 선택됨 (${state.allStudents.length}명)`;
        } else {
            selectAllBtn.className = 'px-4 py-2 rounded-lg text-sm font-semibold bg-[#329BE7] text-white hover:opacity-90 transition';
            selectAllBtn.innerHTML = `👥 전체 선택 (${state.allStudents.length}명)`;
        }
    }

    // Update clear selection button
    const clearBtn = document.querySelector('button[onclick="clearStudentSelection()"]');
    if (clearBtn) {
        if (state.selectedStudents.length > 0) {
            clearBtn.style.display = '';
            clearBtn.innerHTML = `✕ 선택 해제 (${state.selectedStudents.length})`;
        } else {
            clearBtn.style.display = 'none';
        }
    }
}

// ============================================
// Student Quick Navigation Bar
// ============================================

let activeQuickNavStudent = null;
let quickNavStage = null; // 'memo'(첫 클릭) → 'records'(같은 이름 재클릭)

export function updateStudentQuickNav() {
    const nav = document.getElementById('studentQuickNav');
    if (!nav) return;

    if (state.selectedStudents.length === 0) {
        nav.style.display = 'none';
        while (nav.firstChild) nav.removeChild(nav.firstChild);
        activeQuickNavStudent = null;
        return;
    }

    nav.style.display = 'flex';
    while (nav.firstChild) nav.removeChild(nav.firstChild);

    state.selectedStudents.forEach(name => {
        // <button>이 아니라 span인 이유: 구버전 WebKit(사파리 15.x)은 버튼 내부를 익명 flex로
        // 렌더링해 이름+칩이 서로 찌그러진다(이름이 0폭으로 눌려 사라졌다). span엔 그 동작이 없다.
        const btn = document.createElement('span');
        btn.className = 'student-quick-nav-btn' + (activeQuickNavStudent === name ? ' active' : '');
        btn.setAttribute('role', 'button');
        btn.tabIndex = 0;
        btn.dataset.name = name;
        // 이름 + ' · 보강'. 이름은 textContent가 아니라 dataset에서 읽어야 한다(태그가 섞인다).
        btn.textContent = labelFor(name);
        applyTagClass(btn, name);
        // 첫 클릭은 상단 코치 전용 메모, 같은 이름 두 번째 클릭은 훈련일지 기록으로.
        const go = () => {
            const goToRecords = activeQuickNavStudent === name && quickNavStage === 'memo';
            activeQuickNavStudent = name;
            quickNavStage = goToRecords ? 'records' : 'memo';
            highlightQuickNavBtn(nav, name);
            if (goToRecords) scrollToStudent(name);
            else scrollToCoachNote(name);
        };
        btn.addEventListener('click', go);
        btn.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return; // span은 기본 키보드 동작이 없다
            e.preventDefault();
            go();
        });
        nav.appendChild(btn);
    });
}

function highlightQuickNavBtn(nav, activeName) {
    nav.querySelectorAll('.student-quick-nav-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.name === activeName);
    });
}

function scrollIntoViewBelowNav(el) {
    if (!el) return;
    const navBar = document.getElementById('studentQuickNav');
    const navHeight = navBar ? navBar.offsetHeight + 8 : 0;
    const y = el.getBoundingClientRect().top + window.pageYOffset - navHeight;
    // ponytail: behavior:'smooth'는 이 페이지에서 위 방향 스크롤이 시작되지 않는 경우가 있어 즉시 이동으로 고정.
    window.scrollTo(0, y);
}

function scrollToStudent(name) {
    // student-section-{이름}은 메모 블록과 기록 블록 양쪽에 있다 → 기록 컨테이너 안쪽을 우선.
    const sel = `[id="student-section-${String(name).replace(/["\\]/g, '\\$&')}"]`;
    const section = document.querySelector(`#allRecordsList ${sel}`) || document.getElementById(`student-section-${name}`);
    scrollIntoViewBelowNav(section);
}
window.scrollToStudent = scrollToStudent;

// 첫 클릭 대상: 상단 코치 전용 메모. 접혀 있으면 펼쳐서 바로 쓸 수 있게 한다.
async function scrollToCoachNote(name) {
    const idx = state.selectedStudents.indexOf(name);
    if (idx !== -1 && !(coachNotesMap[name] || '') && !expandedNotes.has(name)) {
        await expandCoachNote(idx);
    }
    scrollIntoViewBelowNav(document.getElementById(`coach-note-${name}`));
}

// ============================================
// Data Caching & Real-time Listeners
// ============================================
let studentPinnedMemosCache = {};
let coachPinnedMemosCache = {};

// 코치 전용 비공개 메모 — 수강생 화면 어디에서도 읽지 않는다(규칙에서도 isCoach만 허용).
// 학생별 문서 대신 단일 문서의 map: 몇 명을 선택해도 읽기 1회. (studentMeta/frequencies와 같은 패턴)
let coachNotesMap = {};
let coachNotesLoaded = false;
const expandedNotes = new Set(); // 비어 있는 메모를 코치가 직접 펼친 수강생

// ponytail: 문서 1개를 세션당 1회만 읽는다. 저장은 캐시도 갱신하므로 재조회 불필요
// (코치가 두 기기에서 동시에 쓰는 경우는 고려 안 함 — 새로고침하면 최신).
async function loadCoachNotes() {
    if (coachNotesLoaded || !firebaseInitialized || !db) return;
    try {
        const doc = await db.collection('coachNotes').doc('notes').get();
        coachNotesMap = (doc.exists && doc.data().map) ? doc.data().map : {};
        coachNotesLoaded = true;
    } catch (error) {
        console.error('코치 전용 메모 조회 실패:', error);
    }
}

// 비어 있어 접혀 있던 메모를 펼친다 (퀵내비 첫 클릭·연필 버튼)
export async function expandCoachNote(idx) {
    const name = state.selectedStudents[idx];
    if (!name) return;
    expandedNotes.add(name);
    await renderCoachNotes(); // 렌더 후에 focus — 접힌 버튼은 이미 교체된 상태
    document.getElementById(`coachNote-${idx}`)?.focus();
}
window.expandCoachNote = expandCoachNote;

const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function showNoteSaved(status) {
    if (!status) return;
    status.textContent = '저장됐어요';
    clearTimeout(status._hideTimer);
    status._hideTimer = setTimeout(() => { status.textContent = ''; }, 2000);
}

// 선택한 수강생마다 코치 전용 메모 카드를 상단에 렌더.
// '운동 메모만 보기' 필터로 숨겨지는 coachPinnedMemosSection과 별도 섹션이라 항상 보인다.
export async function renderCoachNotes() {
    const section = document.getElementById('coachPrivateNotesSection');
    if (!section) return;

    if (state.selectedStudents.length === 0) {
        section.innerHTML = '';
        return;
    }

    await loadCoachNotes(); // 몇 명을 선택해도 문서 1개 = 읽기 1회

    // 메모가 있는 수강생만 펼쳐서 보여준다 — 여러 명 선택 시 상단이 textarea로 도배되지 않게.
    section.innerHTML = state.selectedStudents.map((studentName, idx) => {
        const note = coachNotesMap[studentName] || '';
        const anchor = `id="coach-note-${escHtml(studentName)}"`;

        if (!note && !expandedNotes.has(studentName)) {
            return `
                <button ${anchor} type="button" onclick="expandCoachNote(${idx})"
                        class="w-full flex items-center justify-between bg-white rounded-lg px-3 py-2 mb-2 border border-[#EFEFF0] text-left">
                    <span class="text-xs font-bold text-gray-700">🔒 ${escHtml(studentName)}
                        <span class="font-normal text-gray-400">· 코치 전용 메모 없음</span></span>
                    <span class="text-xs font-semibold text-[#327AB8]">✏️ 메모 쓰기</span>
                </button>`;
        }

        return `
            <div ${anchor} class="bg-white rounded-lg p-3 mb-2 border border-[#EFEFF0]">
                <div class="flex items-center justify-between mb-2">
                    <h4 class="text-xs font-bold text-gray-700">
                        🔒 ${escHtml(studentName)} — 코치 전용 메모
                        <span class="font-normal text-gray-400">· 수강생에게 보이지 않음</span>
                    </h4>
                    <span id="coachNoteStatus-${idx}" class="text-xs text-[#31A552]"></span>
                </div>
                <textarea id="coachNote-${idx}" rows="3" placeholder="나만 볼 메모 (부상, 성향, 상담 내용 등)"
                          onchange="saveCoachNote(${idx})"
                          class="w-full px-3 py-2 border border-[#EFEFF0] rounded-lg text-sm focus:outline-none focus:border-[#329BE7]">${escHtml(note)}</textarea>
                <button onclick="saveCoachNote(${idx})" type="button"
                        class="mt-2 w-full bg-gray-800 hover:bg-gray-900 text-white text-sm font-semibold py-2 rounded-lg transition">
                    저장
                </button>
            </div>`;
    }).join('');
}
window.renderCoachNotes = renderCoachNotes;

// 이름을 onclick/id로 넘기지 않는다(따옴표·특수문자 escape 불필요) — 선택 목록 인덱스로만 참조.
// textarea의 onchange(포커스 이탈 시)와 저장 버튼 양쪽에서 호출된다.
// 데스크톱에서 "저장을 한 번 눌러선 안 되고 두 번 눌러야 저장된다"는 제보의 대응:
// 마우스는 버튼을 누르는 순간(mousedown) textarea가 blur되는데, 그 사이 버튼이 밀리면
// mouseup이 다른 요소에 떨어져 click 자체가 안 난다(터치는 이 현상이 없어 모바일은 정상이었다).
// onchange가 먼저 저장하므로 click이 삼켜져도 메모는 이미 저장돼 있다.
export async function saveCoachNote(idx) {
    const studentName = state.selectedStudents[idx];
    const el = document.getElementById(`coachNote-${idx}`);
    const status = document.getElementById(`coachNoteStatus-${idx}`);
    if (!studentName || !el || !db) return;

    const note = el.value.trim();
    // onchange로 이미 저장된 뒤 버튼까지 눌린 경우 — 같은 값이면 write 없이 안내만.
    if (note === (coachNotesMap[studentName] || '')) {
        showNoteSaved(status);
        return;
    }
    try {
        // merge:true는 map 필드를 딥 병합 → 다른 수강생 메모는 그대로 유지된다.
        await db.collection('coachNotes').doc('notes').set({
            map: { [studentName]: note },
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        coachNotesMap[studentName] = note;
        showNoteSaved(status);
    } catch (error) {
        console.error('코치 전용 메모 저장 실패:', error);
        if (status) status.textContent = '저장 실패';
    }
}
window.saveCoachNote = saveCoachNote;

export function setupRealtimePinnedMemosListener() {
    // 2단계 읽기 절감: 코치 진입 시 pinnedMemos 전체 컬렉션 실시간 구독 금지.
    // 선택된 학생의 문서만 render 시점에 직접 조회한다.
}

async function loadPinnedMemosForSelectedStudents() {
    if (!firebaseInitialized || !db || state.selectedStudents.length === 0) return;

    const selected = [...new Set(state.selectedStudents)];
    await Promise.all(selected.map(async (studentName) => {
        try {
            const [studentDoc, coachDoc] = await Promise.all([
                db.collection('pinnedMemos').doc(studentName).get(),
                db.collection('coachPinnedMemos').doc(studentName).get()
            ]);
            studentPinnedMemosCache[studentName] = studentDoc.exists ? (studentDoc.data().memos || []) : [];
            coachPinnedMemosCache[studentName] = coachDoc.exists ? (coachDoc.data().memos || []) : [];
        } catch (error) {
            console.error('선택 학생 메모 조회 실패:', studentName, error);
            studentPinnedMemosCache[studentName] = studentPinnedMemosCache[studentName] || [];
            coachPinnedMemosCache[studentName] = coachPinnedMemosCache[studentName] || [];
        }
    }));
}

// Feature 3, 4, 5: Render Pinned Memos for Coach View (Independent of Date Filter)
// Displays both Coach's Pinned Memos AND Student's Self-Pinned Memos
// Feature 3, 4, 5, 1, 6, 8: Unified Memo & Message Renderer
export async function renderPinnedMemosForCoach() {
    const section = document.getElementById('coachPinnedMemosSection');
    if (!section) return;

    if (state.selectedStudents.length === 0) {
        section.innerHTML = '';
        return;
    }

    await loadPinnedMemosForSelectedStudents();

    let html = '';

    state.selectedStudents.forEach(studentName => {
        const studentColor = getStudentColor(studentName, state.allStudents) || '#ffffff';
        const studentMemos = studentPinnedMemosCache[studentName] || [];
        const coachMemos = coachPinnedMemosCache[studentName] || [];

        // Filter by Exercise
        let filteredStudentMemos = studentMemos;
        let filteredCoachMemos = coachMemos;

        if (state.exerciseFilter) {
            filteredStudentMemos = studentMemos.filter(m => m.exercise === state.exerciseFilter);
            filteredCoachMemos = coachMemos.filter(m => m.exercise === state.exerciseFilter);
        }

        if (state.painFilter) {
            filteredStudentMemos = filteredStudentMemos.filter(m => m.pain === true);
            // Coach messages generally don't have pain? But if they do...
            // Or maybe Coach messages should hide if pain filter used?
            // "Show only records with pain". Assuming Coach Memos are not "pain" records unless specified.
            // But user says "Coach view... pain display necessary on student exercise memo" which I did.
            // "Coach mode... if checked pain view, show relevant memos".
            // For now, I won't filter Coach Memos by pain unless we add pain prop to Coach Memos (unlikely).
            // But if ONLY pain is wanted, showing non-pain coach messages might be clutter.
            // I'll keep default generic messages, but maybe hide exercise-specific coach memos that aren't about pain?
            // Safer to just filter Student Memos (where pain originates).
        }

        // Show section if there is content OR if we are in "Memo View" (to allow adding messages)
        // But if filtering by exercise and no matches, maybe show nothing?
        // User wants "Send Personal Message" capability.

        html += `<div id="student-section-${studentName}" class="rounded-xl p-4 mb-4 border border-[#EFEFF0]" style="background-color: ${studentColor}20;">
            <div class="flex items-center justify-between border-b border-gray-200 pb-2 mb-3">
                <h3 class="font-bold text-gray-800 text-lg flex items-center gap-2">
                    <span class="px-2 py-1 rounded bg-white border border-[#EFEFF0] text-sm">${studentName}</span>
                    <span class="text-sm font-normal text-gray-500">님의 메모 & 메시지</span>
                </h3>
                <button onclick="promptPersonalMessage('${studentName}')" class="bg-[#329BE7] text-white text-xs px-3 py-1.5 rounded hover:bg-[#327AB8] font-semibold flex items-center gap-1">
                    📩 메시지 보내기
                </button>
            </div>`;


        // 1. Coach Messages (Personal Messages / Coach Memos)
        if (filteredCoachMemos.length > 0) {
            html += `<div class="mb-4">
                <h4 class="text-xs font-bold text-[#327AB8] mb-2 uppercase tracking-wider opacity-70">Coach Messages</h4>
                <div class="space-y-2">`;

            filteredCoachMemos.forEach((memo, idx) => {
                html += `
                    <div class="bg-[#329BE71A] rounded-lg p-3 border border-[#329BE7]/20 relative">
                        <div class="flex justify-between items-start mb-1">
                            <span class="font-bold text-[#327AB8] text-sm">${memo.exercise}</span>
                            <div class="flex gap-2">
                                <button onclick="editCoachMemo('${studentName}', '${memo.id || ''}', \`${(memo.memo || '').replace(/`/g, '\\`')}\`)" class="px-2 py-1 text-xs bg-[#329BE71A] text-[#327AB8] rounded border border-[#329BE7]/30 font-semibold">수정</button>
                                <button onclick="deleteCoachMemo('${studentName}', '${memo.id || ''}')" class="px-2 py-1 text-xs bg-red-100 text-red-700 rounded border border-red-300 font-semibold">삭제</button>
                            </div>
                        </div>
                        <div class="text-gray-800 text-sm whitespace-pre-wrap">${memo.memo}</div>
                        <div class="text-xs text-[#329BE7]/60 mt-1 text-right">${formatDate(memo.updatedAt || memo.createdAt)}</div>
                    </div>`;
            });
            html += `</div></div>`;
        }

        // 2. Student Memos (하이라이트 메모 상단 정렬)
        if (filteredStudentMemos.length > 0) {
            // 원본 인덱스를 보존하면서 하이라이트 메모를 상단으로 정렬
            const indexedMemos = filteredStudentMemos.map((memo, i) => ({ memo, originalIdx: studentMemos.indexOf(memo) }));
            indexedMemos.sort((a, b) => {
                const aH = a.memo.highlighted ? 1 : 0;
                const bH = b.memo.highlighted ? 1 : 0;
                return bH - aH; // highlighted가 true인 것이 위로
            });

            html += `<div>
                <h4 class="text-xs font-bold text-gray-600 mb-2 uppercase tracking-wider opacity-70">Student Memos</h4>
                <div class="space-y-3">`;

            indexedMemos.forEach(({ memo, originalIdx }) => {
                const comment = memo.coachComment || '';
                const isHighlighted = memo.highlighted === true;
                const borderColor = isHighlighted ? 'border-yellow-400' : 'border-gray-400';
                const bgColor = isHighlighted ? 'bg-yellow-50' : 'bg-white';
                const starBtn = isHighlighted
                    ? `<button onclick="toggleMemoHighlight('${studentName}', ${originalIdx})" class="text-yellow-400 hover:text-yellow-500 text-lg leading-none" title="중요 해제">★</button>`
                    : `<button onclick="toggleMemoHighlight('${studentName}', ${originalIdx})" class="text-gray-300 hover:text-yellow-400 text-lg leading-none" title="중요 표시">☆</button>`;
                html += `
                    <div class="${bgColor} rounded-lg p-3 border-l-4 ${borderColor} ${isHighlighted ? 'ring-1 ring-yellow-200' : ''}">
                        <div class="flex justify-between items-start">
                            <div class="flex items-center gap-2 mb-1">
                                ${starBtn}
                                <div class="font-bold text-gray-800 text-base">${memo.exercise}</div>
                                ${memo.pain ? '<span class="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded font-semibold">⚠️ 통증</span>' : ''}
                                ${isHighlighted ? '<span class="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded font-semibold">중요</span>' : ''}
                            </div>
                        </div>
                        ${memo.memo ? `<div class="text-gray-700 whitespace-pre-wrap mb-3 text-sm">${memo.memo}</div>` : '<div class="text-gray-400 italic mb-3 text-xs">메모 없음</div>'}

                        <!-- Coach Comment (Legacy / Reply) -->
                        <div class="pt-2 border-t border-gray-100 bg-gray-50 -mx-3 -mb-3 px-3 py-2 rounded-b">
                            <label class="text-xs font-bold text-gray-500 block mb-1">💬 코멘트</label>
                            <div class="flex gap-2">
                                <textarea id="coach-comment-${studentName}-${originalIdx}"
                                    class="flex-1 px-2 py-1 text-sm border border-[#EFEFF0] rounded focus:outline-none focus:border-[#329BE7]"
                                    rows="1"
                                    placeholder="코멘트...">${comment}</textarea>
                                <button onclick="saveCoachCommentToStudentMemo('${studentName}', ${originalIdx})"
                                    class="bg-gray-600 text-white text-xs px-3 py-1 rounded hover:bg-gray-700 font-semibold h-fit self-end pb-1.5 pt-1.5">
                                    저장
                                </button>
                            </div>
                        </div>
                    </div>`;
            });
            html += `</div></div>`;
        }

        if (filteredCoachMemos.length === 0 && filteredStudentMemos.length === 0) {
            html += `<div class="text-center py-4 text-gray-400 text-sm">표시할 메모가 없습니다.</div>`;
        }

        html += `</div>`;
    });

    section.innerHTML = html;
    updateStudentQuickNav();
}

// Helper: Prompt for Personal Message



export async function saveCoachMessage(studentName, title, content) {
    if (!firebaseInitialized || !db) return;
    try {
        const docRef = db.collection('coachPinnedMemos').doc(studentName);
        const doc = await docRef.get();
        let memos = doc.exists ? (doc.data().memos || []) : [];

        // Check for existing "Personal Message" to append or separate?
        // Let's treat it as a new distinct entry if we want multiple messages?
        // Current structure is array of {exercise, memo}.
        // If we want multiple messages, we might need unique IDs or just use "Personal Message 1", "2"?
        // Or simply Append to one big "Personal Message"?
        // User wants "Student can delete message". 
        // Array of objects is fine. Exercise name can be the "Title".

        // Let's just add it as a new entry with Date.
        const newMsg = {
            exercise: title || '알림',
            memo: content,
            pinnedBy: state.currentUser,
            createdAt: new Date().toISOString(),
            id: Date.now().toString(),
            type: 'message' // Marker
        };

        memos.unshift(newMsg); // Add to top

        await docRef.set({
            userName: studentName,
            memos: memos,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        coachPinnedMemosCache[studentName] = memos;
        alert('✅ 메시지가 전송되었습니다.');
        renderPinnedMemosForCoach();
    } catch (e) {
        console.error(e);
        alert('전송 실패');
    }
}

export async function editCoachMemo(studentName, memoId, currentMemo) {
    const newMemo = prompt('메모 수정:', currentMemo);
    if (newMemo === null) return;
    updateCoachMemo(studentName, memoId, newMemo);
}
window.editCoachMemo = editCoachMemo;

export async function deleteCoachMemo(studentName, memoId) {
    if (!confirm('정말 삭제하시겠습니까?')) return;
    updateCoachMemo(studentName, memoId, null, true);
}
window.deleteCoachMemo = deleteCoachMemo;

async function updateCoachMemo(studentName, memoId, newContent, isDelete = false) {
    const docRef = db.collection('coachPinnedMemos').doc(studentName);
    const doc = await docRef.get();
    if (!doc.exists) return;

    let memos = doc.data().memos || [];
    // id 기반 매칭, 레거시 데이터는 exercise 폴백
    let idx = memoId ? memos.findIndex(m => m.id === memoId) : -1;
    if (idx === -1) {
        idx = memos.findIndex(m => m.exercise === memoId);
    }

    if (idx > -1) {
        if (isDelete) {
            memos.splice(idx, 1);
        } else {
            memos[idx].memo = newContent;
            memos[idx].updatedAt = new Date().toISOString();
        }
        await docRef.update({ memos });
        coachPinnedMemosCache[studentName] = memos;
        renderPinnedMemosForCoach();
    }
}

export async function saveCoachCommentToStudentMemo(studentName, memoIndex) {
    const textarea = document.getElementById(`coach-comment-${studentName}-${memoIndex}`);
    const comment = textarea.value.trim();

    if (!firebaseInitialized || !db) return;

    try {
        const docRef = db.collection('pinnedMemos').doc(studentName);
        const doc = await docRef.get();

        if (doc.exists) {
            const data = doc.data();
            const memos = data.memos || [];

            if (memos[memoIndex]) {
                memos[memoIndex].coachComment = comment;

                await docRef.update({
                    memos: memos,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });

                studentPinnedMemosCache[studentName] = memos;
                alert('✅ 코멘트가 저장되었습니다!');
                if (state.recordsFilter) debouncedLoadAllRecords();
            } else {
                alert('메모를 찾을 수 없습니다.');
            }
        } else {
            alert('수강생의 메모 데이터를 찾을 수 없습니다.');
        }
    } catch (error) {
        console.error('Error saving comment:', error);
        alert('저장 실패: ' + error.message);
    }
}
window.saveCoachCommentToStudentMemo = saveCoachCommentToStudentMemo;

export async function toggleMemoHighlight(studentName, memoIndex) {
    if (!firebaseInitialized || !db) return;

    try {
        const docRef = db.collection('pinnedMemos').doc(studentName);
        const doc = await docRef.get();

        if (doc.exists) {
            const memos = doc.data().memos || [];
            if (memos[memoIndex]) {
                memos[memoIndex].highlighted = !memos[memoIndex].highlighted;

                await docRef.update({
                    memos: memos,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });

                // 캐시도 업데이트
                studentPinnedMemosCache[studentName] = memos;
                renderPinnedMemosForCoach();
            }
        }
    } catch (error) {
        console.error('Error toggling highlight:', error);
        alert('하이라이트 변경 실패: ' + error.message);
    }
}
window.toggleMemoHighlight = toggleMemoHighlight;

export function toggleSelectAll() {
    if (state.selectedStudents.length === state.allStudents.length) {
        state.selectedStudents = [];
    } else {
        state.selectedStudents = [...state.allStudents];
    }

    // Save to localStorage
    localStorage.setItem('coachSelectedStudents', JSON.stringify(state.selectedStudents));

    updateStudentBadges();
    updateStudentSelectionSummary();
    updateStudentQuickNav();
    renderCoachSessionView();
}

export function clearStudentSelection() {
    state.selectedStudents = [];

    // Save to localStorage
    localStorage.setItem('coachSelectedStudents', JSON.stringify(state.selectedStudents));

    updateStudentBadges();
    updateStudentSelectionSummary();
    updateStudentQuickNav();
    renderCoachSessionView();
}

export function toggleDeleteMode() {
    state.deleteMode = !state.deleteMode;
    loadStudentList();
}
window.toggleDeleteMode = toggleDeleteMode;

export async function deleteStudentAccount(name) {
    if (!confirm(`"${name}" 수강생 계정을 삭제하시겠습니까?`)) return;
    if (!confirm(`정말로 "${name}"의 계정과 모든 관련 데이터를 삭제합니다. 이 작업은 되돌릴 수 없습니다.`)) return;

    try {
        const batch = db.batch();

        // users 컬렉션 삭제
        batch.delete(db.collection('users').doc(name));
        // coachPinnedMemos 삭제
        batch.delete(db.collection('coachPinnedMemos').doc(name));
        // pinnedMemos 삭제
        batch.delete(db.collection('pinnedMemos').doc(name));
        // 코치 전용 메모(단일 문서 map)에서 해당 키만 제거
        batch.set(db.collection('coachNotes').doc('notes'),
            { map: { [name]: firebase.firestore.FieldValue.delete() } }, { merge: true });

        await batch.commit();

        // records 컬렉션 삭제 (서브컬렉션은 batch로 안되므로 개별 삭제)
        const recordsSnap = await db.collection('records').where('userName', '==', name).get();
        const deletePromises = recordsSnap.docs.map(doc => doc.ref.delete());
        await Promise.all(deletePromises);

        // 선택 목록에서 제거
        state.selectedStudents = state.selectedStudents.filter(s => s !== name);
        state.allStudents = state.allStudents.filter(s => s !== name);
        localStorage.setItem('coachSelectedStudents', JSON.stringify(state.selectedStudents));

        alert(`"${name}" 계정이 삭제되었습니다.`);
        await loadStudentList();
    } catch (e) {
        console.error('수강생 삭제 실패:', e);
        alert('삭제 실패: ' + e.message);
    }
}
window.deleteStudentAccount = deleteStudentAccount;

export function toggleStudentList() {
    const container = document.getElementById('studentListContainer');
    const icon = document.getElementById('studentListIcon');

    if (container.classList.contains('hidden')) {
        container.classList.remove('hidden');
        icon.textContent = '▲';
    } else {
        container.classList.add('hidden');
        icon.textContent = '▼';
    }
}

// 필터 패널 아코디언
export function toggleFilterPanel() {
    const container = document.getElementById('filterPanelContainer');
    const icon = document.getElementById('filterPanelIcon');

    if (container.classList.contains('hidden')) {
        container.classList.remove('hidden');
        icon.textContent = '▲';
    } else {
        container.classList.add('hidden');
        icon.textContent = '▼';
    }
}
window.toggleFilterPanel = toggleFilterPanel;

export function updateFilterSummary() {
    const summary = document.getElementById('filterSummary');
    if (!summary) return;

    const parts = [];
    if (state.selectedDate) parts.push(state.selectedDate);
    if (state.exerciseFilter) parts.push(state.exerciseFilter);
    if (state.painFilter) parts.push('통증');
    if (state.pinnedMemoFilter) parts.push('메모');
    if (state.recordsFilter) parts.push('기록');

    summary.textContent = parts.length > 0 ? parts.join(' · ') : '기본 설정';
}

// 필터 관련
export function changeCoachDate(newDate) {
    state.selectedDate = newDate;
    updateFilterSummary();
    if (state.recordsFilter) debouncedLoadAllRecords();
}

export function showAllDates() {
    state.selectedDate = null;
    document.getElementById('coachDateFilter').value = '';
    updateFilterSummary();
    if (state.recordsFilter) debouncedLoadAllRecords();
}

export function togglePainFilter() {
    const checkbox = document.getElementById('painFilterCheck');
    state.painFilter = checkbox ? checkbox.checked : false;
    localStorage.setItem('coachPainFilter', state.painFilter);
    updateFilterSummary();
    renderCoachSessionView();
}

export function toggleMemoFilter() {
    // Deprecated: Merged into Workout Memo Filter
    // console.log('Memo filter deprecated');
}

export function togglePinnedMemoFilter() {
    const checkbox = document.getElementById('pinnedMemoFilterCheck');
    state.pinnedMemoFilter = checkbox ? checkbox.checked : false;
    localStorage.setItem('coachPinnedMemoFilter', state.pinnedMemoFilter);
    updateFilterSummary();

    const pinnedSection = document.getElementById('coachPinnedMemosSection');
    if (state.pinnedMemoFilter) {
        if (pinnedSection) pinnedSection.style.display = 'block';
        renderPinnedMemosForCoach();
    } else {
        if (pinnedSection) pinnedSection.style.display = 'none';
    }
}

export function toggleRecordsFilter() {
    const checkbox = document.getElementById('recordsFilterCheck');
    state.recordsFilter = checkbox ? checkbox.checked : false;
    updateFilterSummary();

    const allRecordsList = document.getElementById('allRecordsList');
    if (state.recordsFilter) {
        // 운동 기록 보기 체크 → 기록 로드 및 표시
        if (allRecordsList) allRecordsList.style.display = 'grid';
        loadAllRecords();
    } else {
        // 체크 해제 → 기록 숨기기, 리스너 해제
        if (allRecordsList) {
            allRecordsList.style.display = 'none';
            allRecordsList.innerHTML = '';
        }
        if (state.unsubscribe) {
            state.unsubscribe();
            state.unsubscribe = null;
        }
    }
}

export function promptPersonalMessage(studentName) {
    // Use the new Modal
    if (typeof openPersonalMessageModal === 'function') {
        openPersonalMessageModal(studentName);
    } else {
        // Fallback or Error
        alert("메시지 모달을 열 수 없습니다.");
    }
}

// function already added in previous step's replacement
// I will verify the previous step execution first.
// The previous step modifies coach.js.
// I will just add the visual cue to clear date picker in coach.js
export function changeCoachExerciseFilter(exerciseName) {
    state.exerciseFilter = exerciseName;
    updateFilterSummary();

    // 운동 필터가 켜져도 날짜 필터를 유지하도록 수정 (state.selectedDate = null 제거)
    renderCoachSessionView();
}

// 전체 기록 불러오기 (운동 기록 보기 체크 시에만 호출됨)
export async function loadAllRecords() {
    const allRecordsList = document.getElementById('allRecordsList');

    if (!allRecordsList) return;

    if (state.unsubscribe) state.unsubscribe();

    if (state.selectedStudents.length === 0) {
        allRecordsList.innerHTML = '<p class="text-gray-500 text-center py-8 col-span-full">기록을 보려면 수강생을 먼저 선택하세요.</p>';
        return;
    }

    const selectedStudentsForQuery = [...new Set(state.selectedStudents)];
    if (selectedStudentsForQuery.length > 10 && !state.selectedDate && !state.exerciseFilter && !state.painFilter) {
        allRecordsList.innerHTML = '<p class="text-gray-500 text-center py-8 col-span-full">읽기 절감을 위해 10명 이하로 선택하거나 날짜/운동/통증 필터를 먼저 적용하세요.</p>';
        return;
    }

    let query = db.collection('records');

    if (selectedStudentsForQuery.length <= 10) {
        query = query.where('userName', 'in', selectedStudentsForQuery);
    }

    // Feature 2: 운동별 보기 필터 (날짜 필터와 함께 동작하도록 수정)
    if (state.exerciseFilter) {
        query = query.where('exercise', '==', state.exerciseFilter);
    }

    // 날짜 필터 적용 (운동 필터가 있어도 날짜 필터가 있으면 적용)
    if (state.selectedDate) {
        query = query.where('date', '==', state.selectedDate);
    }
    // 날짜 필터가 없고 운동 필터도 없으면 전체 보기 (서버 정렬)
    else if (!state.exerciseFilter) {
        query = query.orderBy('timestamp', 'asc');
    }

    if (state.painFilter) {
        query = query.where('pain', '==', true);
    }

    // 고정 메모 필터 사용 시 선택된 수강생 문서만 조회
    let allPinnedMemos = {};
    if (state.pinnedMemoFilter && firebaseInitialized && db) {
        await loadPinnedMemosForSelectedStudents();
        state.selectedStudents.forEach(studentName => {
            allPinnedMemos[studentName] = studentPinnedMemosCache[studentName] || [];
        });
    }

    state.unsubscribe = query.limit(100).onSnapshot((snapshot) => {
        if (snapshot.empty) {
            allRecordsList.innerHTML = '<p class="text-gray-500 text-center py-8 col-span-full">기록이 없습니다.</p>';
            // Feature 3 Fix: 기록이 없어도 고정 메모는 보여야 함
            if (state.isCoach) {
                renderPinnedMemosForCoach();
            }
            return;
        }

        let filteredDocs = [];
        snapshot.forEach((doc) => {
            const data = doc.data();

            // Memo Filter Logic Removed (Merged into Pinned)
            // if (state.memoFilter && (!data.memo || data.memo.trim() === '')) {
            //     return;
            // }

            if (state.selectedStudents.length > 0 && !state.selectedStudents.includes(data.userName)) {
                return;
            }

            if (state.pinnedMemoFilter) {
                const studentPinnedMemos = allPinnedMemos[data.userName];
                if (!studentPinnedMemos || studentPinnedMemos.length === 0) {
                    return;
                }

                const exerciseName = data.exercise.trim().toLowerCase();
                const isPinned = studentPinnedMemos.some(p => p.exercise.trim().toLowerCase() === exerciseName);

                if (!isPinned) {
                    return;
                }
            }

            filteredDocs.push({ id: doc.id, data: data });
        });

        if (filteredDocs.length === 0) {
            allRecordsList.innerHTML = `
                <div class="col-span-full text-center py-8">
                    <p class="text-gray-500 mb-2">필터 조건에 맞는 기록이 없습니다.</p>
                </div>
            `;
            // Feature 3 Fix: 필터 결과가 없어도 고정 메모는 보여야 함
            if (state.isCoach) {
                renderPinnedMemosForCoach();
            }
            return;
        }

        const groupedByStudent = {};
        filteredDocs.forEach((doc) => {
            const userName = doc.data.userName;
            if (!groupedByStudent[userName]) {
                groupedByStudent[userName] = [];
            }
            groupedByStudent[userName].push(doc);
        });

        Object.keys(groupedByStudent).forEach(userName => {
            groupedByStudent[userName].sort((a, b) => {
                const timeA = a.data.timestamp ? a.data.timestamp.toDate().getTime() : 0;
                const timeB = b.data.timestamp ? b.data.timestamp.toDate().getTime() : 0;
                return timeA - timeB;
            });
        });

        const sortedStudents = Object.keys(groupedByStudent).sort();

        let html = '';
        sortedStudents.forEach(userName => {
            groupedByStudent[userName].forEach((doc) => {
                const data = doc.data;
                const dateTime = data.timestamp ? data.timestamp.toDate().toLocaleString('ko-KR') : '방금 전';

                let setsDisplay = '';
                if (data.sets && Array.isArray(data.sets)) {
                    setsDisplay = data.sets.map((set, idx) => {
                        const normalized = normalizeSet(set);
                        const intensityStr = normalized.intensity.unit === '맨몸'
                            ? '맨몸'
                            : `${normalized.intensity.value}${normalized.intensity.unit}`;
                        let repsStr = '';

                        if (normalized.reps.unit === '초 x 회') {
                            repsStr = `${normalized.reps.value}초 × ${normalized.reps.count || '?'}회`;
                        } else {
                            repsStr = `${normalized.reps.value}${normalized.reps.unit}`;
                        }

                        return `<div class="text-sm text-gray-600">${idx + 1}세트: ${intensityStr} × ${repsStr}</div>`;
                    }).join('');
                } else {
                    setsDisplay = `<p class="text-gray-600">${data.weight}kg × ${data.reps}회 × ${data.sets}세트</p>`;
                }

                const bgColor = getStudentColor(data.userName, state.allStudents);

                html += `
                <div class="bg-white rounded-lg border border-[#EFEFF0] p-5 card-enter" style="background-color: ${bgColor};">
                    <div class="flex items-center justify-between mb-3">
                        <span class="px-3 py-1 rounded-full text-sm font-semibold" style="background-color: ${getStudentBadgeColor(data.userName, state.allStudents)}; color: ${getStudentTextColor(data.userName, state.allStudents)};">
                            ${data.userName}
                        </span>
                        <div class="flex items-center gap-2">
                            ${data.pain ? '<span class="text-xs bg-red-100 text-red-700 px-2 py-1 rounded">⚠️ 통증</span>' : ''}
                            <span class="text-xs text-gray-500">${formatDate(data.date)}</span>
                        </div>
                    </div>
                    
                    <div class="mb-3">
                        <h4 class="font-bold text-lg text-gray-800 mb-1">${data.exercise}</h4>
                        ${setsDisplay}
                        ${data.memo ? `<p class="text-sm text-gray-600 mt-2" style="white-space: pre-wrap;">📝 ${data.memo}</p>` : ''}
                        <p class="text-xs text-gray-400 mt-1">${dateTime}</p>
                    </div>
                </div>
            `;
            });
        });

        allRecordsList.innerHTML = html;

        if (state.isCoach) {
            renderPinnedMemosForCoach();
        }
    }, (error) => {
        console.error('Error loading records:', error);
        allRecordsList.innerHTML = '<p class="text-red-500 text-center py-8 col-span-full">기록 불러오기 실패.</p>';
    });
}



// ============================================
// 코치: '바로 전 수업' 세션 뷰 (수강생 선택 시 기본 화면)
// 선택한 각 수강생을 [이름 + 날짜 드롭다운 + 그 날 카드]로 표시. 드롭다운으로 이전 수업 조회.
// ============================================
let coachSessionCache = {};        // 이름 -> { dates:[최근순], byDate:{날짜:[item]} }
let coachSessionSelectedDate = {}; // 이름 -> 현재 선택 날짜

function resetCoachSessionCache() {
    coachSessionCache = {};
    coachSessionSelectedDate = {};
}

const escCoach = (s) => String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const tsMs = (ts) => (ts && ts.toDate) ? ts.toDate().getTime() : 0;

export async function renderCoachSessionView() {
    renderCoachNotes(); // 선택 변경의 단일 관문 — 코치 전용 메모도 여기서 같이 갱신

    const container = document.getElementById('allRecordsList');
    if (!container) return;
    container.style.display = 'block';

    // 레거시 실시간 기록 리스너가 남아있으면 해제 (컨테이너 덮어쓰기 방지)
    if (state.unsubscribe) { state.unsubscribe(); state.unsubscribe = null; }

    const selected = [...new Set(state.selectedStudents)];
    if (selected.length === 0) {
        container.innerHTML = '<p class="text-gray-500 text-center py-8">수강생을 선택하면 바로 전 수업 기록이 표시됩니다.</p>';
        return;
    }
    // ponytail: 학생당 최근 100건 조회 → 10명 초과면 읽기 폭주. 좁히도록 안내(상한 올리려면 숫자만 조정).
    if (selected.length > 10) {
        container.innerHTML = '<p class="text-gray-500 text-center py-8">읽기 절감을 위해 10명 이하로 선택하세요.</p>';
        return;
    }

    const needFetch = selected.filter(name => !coachSessionCache[name]);
    if (needFetch.length > 0) {
        container.innerHTML = '<p class="text-gray-400 text-center py-8">불러오는 중…</p>';
        try {
            // 세션 뷰 조회 범위: 최근 90일. 무경계(userName만)로 읽으면 학생당 전체 이력이
            // 통째로 내려와(장기 수강생 수백 read×선택 인원) 코치 진입이 느려지고 비싸진다.
            // (userName,date) 복합 인덱스는 학생 달력이 상시 쓰는 조합이라 존재. 실패 시 무경계 폴백.
            // 90일 이전 기록은 학생 개별 화면(달력)에서 조회.
            const cutoffD = new Date(); cutoffD.setDate(cutoffD.getDate() - 90);
            const cutoff = `${cutoffD.getFullYear()}-${String(cutoffD.getMonth() + 1).padStart(2, '0')}-${String(cutoffD.getDate()).padStart(2, '0')}`;
            await Promise.all(needFetch.map(async (name) => {
                const snap = await db.collection('records')
                    .where('userName', '==', name)
                    .where('date', '>=', cutoff)
                    .get()
                    .catch(() => db.collection('records').where('userName', '==', name).get());
                const items = [];
                snap.forEach(doc => {
                    const d = doc.data();
                    items.push({ id: doc.id, data: d, date: d.date, ts: tsMs(d.timestamp) });
                });
                const { dates, byDate } = groupSessionsByDate(items);
                coachSessionCache[name] = { dates, byDate };
                // 끝난 수업을 보고 있으면 그 날짜를, 아니면 오늘 이전 마지막 수업을 기본으로.
                coachSessionSelectedDate[name] = (coachPreferredDate && byDate[coachPreferredDate])
                    ? coachPreferredDate
                    : defaultSessionDate(dates, localToday());
            }));
            // 학생 화면과 동일하게 종목별 고정 메모를 표시하려면 pinnedMemos도 필요.
            await loadPinnedMemosForSelectedStudents();
        } catch (e) {
            console.error('코치 세션 조회 실패:', e);
            container.innerHTML = '<p class="text-red-500 text-center py-8">기록 불러오기 실패.</p>';
            return;
        }
    }

    // 캐시에 이미 있던 수강생도 기본 날짜를 다시 정한다 — '지금 수업' 새로고침이 반영되도록.
    selected.forEach(name => {
        const c = coachSessionCache[name];
        if (!c || coachSessionSelectedDate[name]) return;
        coachSessionSelectedDate[name] = (coachPreferredDate && c.byDate[coachPreferredDate])
            ? coachPreferredDate
            : defaultSessionDate(c.dates, localToday());
    });

    container.innerHTML = selected.map(renderCoachSessionBlock).join('');
}

function renderCoachSessionBlock(name) {
    // 색칩 제거 — 이름만 크고 진하게(코치 요청).
    const nameChip = `<span class="text-xl font-bold text-gray-900">${escCoach(name)}</span>`;

    const cache = coachSessionCache[name];
    if (!cache || cache.dates.length === 0) {
        return `<div id="student-section-${escCoach(name)}" class="bg-white rounded-lg border border-[#EFEFF0] p-5 mb-4">
            ${nameChip}
            <p class="text-gray-400 text-sm mt-3">아직 훈련일지 기록이 없습니다.</p>
        </div>`;
    }

    const selDate = coachSessionSelectedDate[name] || cache.dates[0];
    const records = cache.byDate[selDate] || [];
    const pinnedList = studentPinnedMemosCache[name] || [];
    const options = cache.dates.map(d =>
        `<option value="${escCoach(d)}"${d === selDate ? ' selected' : ''}>${escCoach(formatDate(d))}</option>`
    ).join('');
    const cards = records.map(item => renderCoachRecordCard(item, pinnedList)).join('');

    return `<div id="student-section-${escCoach(name)}" class="bg-white rounded-lg border border-[#EFEFF0] p-5 mb-4">
        <div class="flex items-center justify-between gap-2 flex-wrap mb-2">
            ${nameChip}
            <select data-student="${escCoach(name)}" onchange="changeCoachSessionDate(this.dataset.student, this.value)"
                class="px-3 py-2 border border-gray-300 rounded-lg text-sm font-semibold text-gray-700 bg-white">
                ${options}
            </select>
        </div>
        ${cards || '<p class="text-gray-400 text-sm py-2">이 날짜에는 기록이 없습니다.</p>'}
    </div>`;
}

function renderCoachRecordCard(item, pinnedList = []) {
    const data = item.data;
    // 학생 화면과 동일: 해당 종목 고정 메모 우선, 없으면 기록 자체 메모
    const pinned = pinnedList.find(p => p.exercise === data.exercise);
    const memoText = (pinned && pinned.memo) || data.memo;
    let setsDisplay = '';
    if (Array.isArray(data.sets)) {
        setsDisplay = data.sets.map((set, idx) => {
            const n = normalizeSet(set);
            const intensityStr = n.intensity.unit === '맨몸' ? '맨몸' : `${n.intensity.value}${n.intensity.unit}`;
            const repsStr = n.reps.unit === '초 x 회'
                ? `${n.reps.value}초 × ${n.reps.count || '?'}회`
                : `${n.reps.value}${n.reps.unit}`;
            return `<div class="text-sm text-gray-600">${idx + 1}세트: ${escCoach(intensityStr)} × ${escCoach(repsStr)}</div>`;
        }).join('');
    } else if (data.weight != null) {
        setsDisplay = `<div class="text-sm text-gray-600">${escCoach(data.weight)}kg × ${escCoach(data.reps)}회 × ${escCoach(data.sets)}세트</div>`;
    }
    const time = (data.timestamp && data.timestamp.toDate)
        ? data.timestamp.toDate().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
        : '';
    return `<div class="py-3 border-t border-gray-100 first:border-t-0">
        <div class="flex items-start justify-between gap-2">
            <h4 class="font-bold text-base text-gray-800">${escCoach(data.exercise)}</h4>
            <div class="flex items-center gap-2 shrink-0">
                ${data.pain ? '<span class="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded font-semibold">⚠️ 통증</span>' : ''}
                <span class="text-xs text-gray-400">${escCoach(time)}</span>
            </div>
        </div>
        ${setsDisplay}
        ${memoText ? `<div class="mt-2 flex items-start gap-2 bg-[#F7F7F8] border-l-4 border-[#329BE7] rounded px-3 py-2"><span class="shrink-0">📝</span><span class="text-sm text-gray-800 leading-relaxed" style="white-space:pre-wrap;">${escCoach(memoText)}</span></div>` : ''}
    </div>`;
}

export function changeCoachSessionDate(name, date) {
    coachSessionSelectedDate[name] = date;
    renderCoachSessionView(); // 캐시가 있어 재조회 없이 다시 그림
}

// Personal Message Modal Logic
export function openPersonalMessageModal(studentName) {
    state.currentMessageTarget = studentName;

    // Create modal if not exists
    let modal = document.getElementById('personalMessageModal');
    if (!modal) {
        const modalHTML = `
            <div id="personalMessageModal" class="modal" style="display: none; position: fixed; z-index: 5000; left: 0; top: 0; width: 100%; height: 100%; overflow: auto; background-color: rgba(0,0,0,0.5);">
                <div class="modal-content bg-white m-auto p-6 border rounded-lg shadow-lg w-full max-w-md relative top-20">
                    <div class="flex justify-between items-center mb-4">
                        <h2 class="text-xl font-bold" id="msgModalTitle">메시지 보내기</h2>
                        <button onclick="closePersonalMessageModal()" class="text-gray-500 hover:text-gray-700 text-2xl">&times;</button>
                    </div>
                    <div class="mb-4">
                        <label class="block text-sm font-semibold mb-1">받는 사람</label>
                        <input type="text" id="msgStudentName" class="w-full px-3 py-2 border rounded-lg bg-gray-100" readonly>
                    </div>
                    <div class="mb-4">
                        <label class="block text-sm font-semibold mb-1">제목 (선택)</label>
                        <input type="text" id="msgTitle" class="w-full px-3 py-2 border rounded-lg" placeholder="예: 📢 공지사항">
                    </div>
                     <div class="mb-4">
                        <label class="block text-sm font-semibold mb-1">내용</label>
                        <textarea id="msgContent" class="w-full px-3 py-2 border rounded-lg h-32" placeholder="메세지 내용을 입력하세요..."></textarea>
                    </div>
                    <div class="flex justify-end gap-2">
                        <button onclick="closePersonalMessageModal()" class="px-4 py-2 bg-gray-300 rounded hover:bg-gray-400 font-semibold">취소</button>
                        <button onclick="confirmSendMessage()" class="px-4 py-2 bg-[#329BE7] text-white rounded hover:bg-[#327AB8] font-semibold">전송</button>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        modal = document.getElementById('personalMessageModal');
    }

    document.getElementById('msgStudentName').value = studentName;
    document.getElementById('msgTitle').value = '';
    document.getElementById('msgContent').value = '';
    document.getElementById('msgModalTitle').textContent = `${studentName}님에게 메시지 보내기`;

    modal.style.display = 'block';
    document.getElementById('msgContent').focus();
}

export function closePersonalMessageModal() {
    const modal = document.getElementById('personalMessageModal');
    if (modal) modal.style.display = 'none';
}

export function confirmSendMessage() {
    const studentName = state.currentMessageTarget;
    const title = document.getElementById('msgTitle').value.trim() || '📢 개인 메시지';
    const content = document.getElementById('msgContent').value.trim();

    if (!content) {
        alert('내용을 입력해주세요.');
        return;
    }

    saveCoachMessage(studentName, title, content);
    closePersonalMessageModal();
}

window.openPersonalMessageModal = openPersonalMessageModal;
window.closePersonalMessageModal = closePersonalMessageModal;
window.confirmSendMessage = confirmSendMessage;

