import { state, db } from '../state.js';
import { renderSets } from './sets.js?v=20260925-student-ux';
import { localDate, escapeHTML, draftKey, cloneSets, hasSetValues, hasDraftContent, recentExerciseDays, setSummary } from './student-workspace-logic.js?v=20260925-student-ux';

let activeExercise = '';
let referenceRequest = 0;
let references = [];
let selectedReference = 0;
let initializing = false;
const storageKey = (user = state.currentUser) => `trainingDrafts_v1_${user}`;
const emptyStore = () => ({ drafts: {}, lastByDate: {} });
function readStore(user = state.currentUser) {
    try {
        const parsed = JSON.parse(localStorage.getItem(storageKey(user)) || 'null');
        return parsed?.drafts && parsed?.lastByDate ? parsed : emptyStore();
    } catch { return emptyStore(); }
}
function writeStore(store, user = state.currentUser) {
    try { localStorage.setItem(storageKey(user), JSON.stringify(store)); return true; }
    catch { if (user === state.currentUser) setStatus('이 기기에서 초안을 보관하지 못했어요. 기록을 저장한 뒤 이동해주세요.'); return false; }
}
function setStatus(message) {
    const status = document.getElementById('studentDraftStatus');
    if (status) status.textContent = message;
}
function blankForm() {
    state.currentSets = [];
    const memo = document.getElementById('memo');
    const pain = document.getElementById('painCheck');
    if (memo) memo.value = '';
    if (pain) pain.checked = false;
    references = []; selectedReference = 0; referenceRequest++;
}
export function saveStudentDraft() {
    if (!state.currentUser || state.isCoach || state.studentView !== 'write' || initializing || !document.getElementById('exercise')) return;
    const date = state.studentWriteDate || localDate();
    const draft = { date, exercise: activeExercise, query: document.getElementById('exercise').value, memo: document.getElementById('memo')?.value || '', painCheck: document.getElementById('painCheck')?.checked || false, sets: cloneSets(state.currentSets), timestamp: Date.now() };
    const store = readStore();
    if (hasDraftContent(draft) || draft.query) {
        store.drafts[draftKey(date, activeExercise)] = draft;
        store.lastByDate[date] = activeExercise;
    } else delete store.drafts[draftKey(date, activeExercise)];
    const saved = writeStore(store);
    if (saved) setStatus(hasDraftContent(draft) ? '이 기기에 초안 보관 중' : '');
    updateStudentStartButton();
}
function restoreDraft(date, exercise) {
    initializing = true;
    blankForm();
    activeExercise = exercise || '';
    const draft = readStore().drafts[draftKey(date, activeExercise)];
    const input = document.getElementById('exercise');
    if (input) {
        input.value = draft?.query || activeExercise;
        input.readOnly = Boolean(activeExercise);
        input.classList.toggle('bg-gray-100', Boolean(activeExercise));
        input.classList.toggle('cursor-not-allowed', Boolean(activeExercise));
    }
    document.getElementById('exerciseClearBtn')?.classList.toggle('hidden', !activeExercise);
    if (draft) {
        state.currentSets = cloneSets(draft.sets);
        document.getElementById('memo').value = draft.memo || '';
        document.getElementById('painCheck').checked = Boolean(draft.painCheck);
    }
    renderSets();
    initializing = false;
    window.renderExerciseMemo?.();
    loadStudentReferences(activeExercise);
    setStatus(draft ? '보관한 초안을 이어서 작성해요' : '');
}
export function initializeStudentWorkspace() {
    state.studentWriteDate = localDate();
    state.studentView = 'calendar';
    state.studentTodayHasRecords = false;
    blankForm();
    activeExercise = '';
    const dateInput = document.getElementById('studentWriteDate');
    if (dateInput) { dateInput.value = state.studentWriteDate; dateInput.max = localDate(); }
    const store = readStore();
    // Old autosave had no writing date. Preserve it and let the student verify the date.
    try {
        const legacy = JSON.parse(localStorage.getItem(`autoSave_${state.currentUser}`) || 'null');
        if (legacy && hasDraftContent(legacy) && !Object.keys(store.drafts).length) {
            const date = legacy.date || localDate(new Date(legacy.timestamp || Date.now()));
            store.drafts[draftKey(date, legacy.exercise)] = { ...legacy, date, query: legacy.exercise, legacyDate: !legacy.date };
            store.lastByDate[date] = legacy.exercise || '';
            writeStore(store);
        }
    } catch { /* Keep the old stored value if migration is not possible. */ }
    updateStudentStartButton();
    renderStudentDraftList();
}
export function updateStudentStartButton() {
    const button = document.getElementById('studentStartButton');
    if (!button) return;
    const today = localDate();
    const hasDraft = Object.values(readStore().drafts).some(draft => draft.date === today && hasDraftContent(draft));
    button.textContent = hasDraft ? '이어서 기록하기 ＋' : state.studentTodayHasRecords ? '오늘 기록 확인·추가 ＋' : '오늘 운동 기록하기 ＋';
}
function renderStudentDraftList() {
    const container = document.getElementById('studentDraftList');
    if (!container) return;
    const store = readStore();
    const drafts = [...Object.values(store.drafts), ...Object.entries(store.recoveries || {}).map(([recoveryId, draft]) => ({ ...draft, recoveryId }))].filter(draft => hasDraftContent(draft)).sort((a, b) => b.timestamp - a.timestamp);
    container.innerHTML = drafts.length ? `<details><summary>보관한 초안 ${drafts.length}개</summary>${drafts.map(draft => `<button type="button" data-recovery-id="${escapeHTML(draft.recoveryId || '')}" data-draft-date="${escapeHTML(draft.date)}" data-draft-exercise="${escapeHTML(draft.exercise)}"><span>${escapeHTML(draft.date)} · ${escapeHTML(draft.exercise || '종목 선택 전')}</span>${draft.recoveryId ? '<small>저장 실패 · 입력 복구</small>' : draft.legacyDate ? '<small>이전 초안 · 작성일을 확인해주세요</small>' : ''}</button>`).join('')}</details>` : '';
    container.querySelectorAll('[data-draft-date]').forEach(button => button.addEventListener('click', () => button.dataset.recoveryId ? recoverStudentDraft(button.dataset.recoveryId) : startStudentRecord(button.dataset.draftDate, button.dataset.draftExercise)));
}
export function startStudentRecord(date = localDate(), exercise, { skipSave = false } = {}) {
    if (date > localDate()) return;
    if (!skipSave) saveStudentDraft();
    state.studentWriteDate = date;
    const store = readStore();
    restoreDraft(date, exercise === undefined ? store.lastByDate[date] || '' : exercise);
    document.getElementById('studentWriteDate').value = date;
    state.studentView = 'write';
    document.getElementById('studentCalendarView').hidden = true;
    document.getElementById('studentWriteView').hidden = false;
    document.getElementById('studentRecordSaved').hidden = true;
    document.getElementById('studentWriteHeading')?.scrollIntoView({ block: 'start' });
}
export function showStudentCalendar(date) {
    saveStudentDraft();
    state.studentView = 'calendar';
    document.getElementById('studentWriteView').hidden = true;
    document.getElementById('studentCalendarView').hidden = false;
    if (date) window.selectCalendarDate?.(date);
    updateStudentStartButton();
    renderStudentDraftList();
    document.getElementById('studentStartButton')?.focus();
}
export function changeStudentWriteDate(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > localDate()) {
        document.getElementById('studentWriteDate').value = state.studentWriteDate;
        return;
    }
    saveStudentDraft();
    state.studentWriteDate = date;
    restoreDraft(date, readStore().lastByDate[date] || '');
}
export function prepareStudentExercise(name) {
    saveStudentDraft();
    if (!activeExercise) {
        const store = readStore();
        const date = state.studentWriteDate || localDate();
        const unnamedKey = draftKey(date, '');
        const targetKey = draftKey(date, name);
        const unnamed = store.drafts[unnamedKey];
        // A student may enter sets/memo before choosing the exercise. Move that draft,
        // or keep it separately if this exercise already has a different draft.
        if (unnamed && !store.drafts[targetKey]) {
            store.drafts[targetKey] = { ...unnamed, exercise: name, query: name };
            store.lastByDate[date] = name;
            delete store.drafts[unnamedKey];
            writeStore(store);
        }
    }
    restoreDraft(state.studentWriteDate || localDate(), name);
}
export function clearStudentExercise({ saved = false } = {}) {
    if (!saved) saveStudentDraft();
    initializing = true;
    blankForm();
    activeExercise = '';
    renderSets();
    initializing = false;
    renderStudentReference();
}
export function completeStudentRecord(date, exercise) {
    window.invalidateStudentCalendar?.(date);
    const store = readStore();
    delete store.drafts[draftKey(date, exercise)];
    if (store.lastByDate[date] === exercise) delete store.lastByDate[date];
    writeStore(store);
    localStorage.removeItem(`autoSave_${state.currentUser}`);
    clearStudentExercise({ saved: true });
    setStatus('');
    if (date === localDate()) state.studentTodayHasRecords = true;
    updateStudentStartButton();
    const saved = document.getElementById('studentRecordSaved');
    if (saved) { saved.hidden = false; saved.querySelector('p').textContent = `${date} · ${exercise} 기록을 저장했어요.`; }
}
export function restoreFailedStudentRecord(recordId, draft, user = state.currentUser) {
    const store = readStore(user);
    store.recoveries ||= {};
    store.recoveries[recordId] = { ...draft, query: draft.exercise, sets: cloneSets(draft.sets), timestamp: Date.now() };
    const saved = writeStore(store, user);
    if (user !== state.currentUser || state.isCoach) return;
    const notice = document.getElementById('studentRecordSaved');
    if (notice) notice.hidden = true;
    setStatus(saved ? '서버 저장에 실패했어요. 달력의 보관한 초안에서 입력을 복구할 수 있어요.' : '서버 저장과 기기 보관에 실패했어요. 이 화면을 닫기 전에 입력 내용을 확인해주세요.');
    renderStudentDraftList();
}
export function recoverStudentDraft(recordId) {
    saveStudentDraft();
    const store = readStore();
    const draft = store.recoveries?.[recordId];
    if (!draft) return;
    const key = draftKey(draft.date, draft.exercise);
    if (hasDraftContent(store.drafts[key]) && !confirm('이 날짜·종목의 다른 초안이 있어요. 저장에 실패했던 입력으로 바꿀까요?')) return;
    store.drafts[key] = { ...draft, sets: cloneSets(draft.sets) };
    store.lastByDate[draft.date] = draft.exercise;
    delete store.recoveries[recordId];
    if (!writeStore(store)) return;
    startStudentRecord(draft.date, draft.exercise, { skipSave: true });
}

export async function loadStudentReferences(exercise) {
    const request = ++referenceRequest;
    references = []; selectedReference = 0;
    if (!exercise || !state.currentUser || state.isCoach || !db) { renderStudentReference(); return; }
    const user = state.currentUser;
    const writingDate = state.studentWriteDate || localDate();
    renderStudentReference('지난 기록을 불러오는 중…');
    try {
        const snapshot = await db.collection('records').where('userName', '==', user).where('exercise', '==', exercise).get();
        if (request !== referenceRequest || user !== state.currentUser || writingDate !== state.studentWriteDate || exercise !== activeExercise) return;
        const records = []; snapshot.forEach(doc => records.push(doc.data()));
        references = recentExerciseDays(records, exercise, writingDate);
        renderStudentReference();
        refreshStudentPreviousSets();
    } catch (error) {
        if (request !== referenceRequest) return;
        console.error('지난 운동 기록 조회 실패:', error);
        renderStudentReference('지난 기록을 불러오지 못했어요. 입력은 계속할 수 있어요.');
    }
}
export function renderStudentReference(message = '') {
    const container = document.getElementById('studentReference');
    if (!container) return;
    if (!activeExercise) { container.innerHTML = ''; return; }
    const selected = references[selectedReference];
    container.innerHTML = message ? `<p class="student-help" role="status">${escapeHTML(message)}</p>` : !selected ? '<p class="student-help">이 종목의 지난 기록이 없어요. 오늘 값을 직접 입력하세요.</p>' : `<div class="student-reference-heading"><label>지난 같은 운동 <select id="studentReferenceDate" onchange="selectStudentReference(this.value)">${references.map((reference, index) => `<option value="${index}" ${index === selectedReference ? 'selected' : ''}>${escapeHTML(reference.date)} · ${reference.sets.length}세트</option>`).join('')}</select></label><button type="button" onclick="fillStudentPreviousValues()">지난 값 채우기</button></div><p class="student-help">참고용이에요. 지난 값은 버튼을 눌러야 입력돼요.</p>${selected.feedback.length ? `<p class="student-reference-feedback">코치 피드백 · ${selected.feedback.map(escapeHTML).join('<br>')}</p>` : ''}`;
}
export function selectStudentReference(index) {
    selectedReference = Math.min(Math.max(Number(index) || 0, 0), Math.max(0, references.length - 1));
    renderStudentReference(); refreshStudentPreviousSets();
}
function refreshStudentPreviousSets() {
    document.querySelectorAll('#setsContainer .student-previous-set').forEach((element, index) => { element.outerHTML = studentPreviousSetHTML(index); });
}
export function studentPreviousSetHTML(index) {
    const set = references[selectedReference]?.sets[index];
    return `<div class="student-previous-set"><span>지난 ${index + 1}세트</span><strong>${set ? escapeHTML(setSummary(set)) : '기록 없음'}</strong></div>`;
}
export function fillStudentPreviousValues() {
    const reference = references[selectedReference];
    if (!reference) return;
    if (hasSetValues(state.currentSets) && !confirm('입력한 세트 값이 있어요. 선택한 지난 기록의 세트 값으로 바꿀까요?\n메모·통증·작성일은 그대로 유지돼요.')) return;
    state.currentSets = cloneSets(reference.sets);
    renderSets(); saveStudentDraft();
    setStatus(`${reference.date} 세트 값을 채웠어요. 오늘 값에 맞게 수정하세요.`);
}
if (typeof window !== 'undefined') window.addEventListener('pagehide', saveStudentDraft);
