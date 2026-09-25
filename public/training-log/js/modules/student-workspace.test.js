import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { draftKey } from './student-workspace-logic.js';

const fixture = vi.hoisted(() => ({ state: {} }));
vi.mock('../state.js', () => ({ state: fixture.state, db: null }));
vi.mock('./sets.js?v=20260925-student-ux', () => ({ renderSets: () => {} }));
import { initializeStudentWorkspace, startStudentRecord, saveStudentDraft, prepareStudentExercise, changeStudentWriteDate, showStudentCalendar, restoreFailedStudentRecord, recoverStudentDraft } from './student-workspace.js';

const today = '2026-09-25';
const storageKey = user => `trainingDrafts_v1_${user}`;
const oneSet = value => [{ intensity: { value, unit: 'kg' }, reps: { value: '8', unit: '회' } }];
let nodes;
let storage;
function node() {
    return { value: '', checked: false, hidden: false, innerHTML: '', textContent: '', classList: { toggle: vi.fn() }, querySelectorAll: () => [], querySelector: () => ({ textContent: '' }), focus: vi.fn(), scrollIntoView: vi.fn() };
}
const store = (user = '학생A') => JSON.parse(storage.get(storageKey(user)) || '{"drafts":{},"lastByDate":{}}');
beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-25T12:00:00'));
    storage = new Map(); nodes = new Map();
    Object.assign(fixture.state, { currentUser: '학생A', isCoach: false, currentSets: [], studentWriteDate: today, studentView: 'calendar' });
    vi.stubGlobal('localStorage', { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) });
    vi.stubGlobal('document', { getElementById: id => { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); }, querySelectorAll: () => [] });
    vi.stubGlobal('window', { renderExerciseMemo: vi.fn(), invalidateStudentCalendar: vi.fn() });
    vi.stubGlobal('confirm', vi.fn(() => true));
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('student persistent draft transitions', () => {
    it('does not erase an unnamed search draft while the initial calendar is showing', () => {
        storage.set(storageKey('학생A'), JSON.stringify({ drafts: { [draftKey(today, '')]: { date: today, exercise: '', query: '스쿼', sets: [], memo: '', timestamp: Date.now() } }, lastByDate: { [today]: '' } }));
        initializeStudentWorkspace();
        saveStudentDraft(); // also the pagehide path
        expect(store().drafts[draftKey(today, '')].query).toBe('스쿼');
        startStudentRecord();
        expect(nodes.get('exercise').value).toBe('스쿼');
    });
    it('moves unnamed sets/memo/pain into the first chosen exercise', () => {
        initializeStudentWorkspace(); startStudentRecord();
        fixture.state.currentSets = oneSet('31');
        nodes.get('memo').value = '첫 입력'; nodes.get('painCheck').checked = true;
        nodes.get('exercise').value = '스쿼';
        saveStudentDraft(); prepareStudentExercise('스쿼트');
        expect(fixture.state.currentSets[0].intensity.value).toBe('31');
        expect(nodes.get('memo').value).toBe('첫 입력');
        expect(nodes.get('painCheck').checked).toBe(true);
        expect(store().drafts[draftKey(today, '스쿼트')].memo).toBe('첫 입력');
    });
    it('restores separate exercise/date drafts including notes and pain', () => {
        initializeStudentWorkspace(); startStudentRecord(); prepareStudentExercise('스쿼트');
        fixture.state.currentSets = oneSet('40'); nodes.get('memo').value = '오늘 메모'; nodes.get('painCheck').checked = true;
        saveStudentDraft(); prepareStudentExercise('데드리프트');
        fixture.state.currentSets = oneSet('60'); saveStudentDraft(); prepareStudentExercise('스쿼트');
        expect(fixture.state.currentSets[0].intensity.value).toBe('40');
        expect(nodes.get('memo').value).toBe('오늘 메모');
        expect(nodes.get('painCheck').checked).toBe(true);
        changeStudentWriteDate('2026-09-23'); prepareStudentExercise('스쿼트');
        fixture.state.currentSets = oneSet('30'); saveStudentDraft(); changeStudentWriteDate(today);
        expect(fixture.state.currentSets[0].intensity.value).toBe('40');
        showStudentCalendar();
        expect(fixture.state.studentWriteDate).toBe(today);
        expect(store().drafts[draftKey('2026-09-23', '스쿼트')].sets[0].intensity.value).toBe('30');
    });
    it('keeps failed saves separate from a newer draft and confirms recovery replacement', () => {
        initializeStudentWorkspace(); startStudentRecord(); prepareStudentExercise('스쿼트');
        fixture.state.currentSets = oneSet('55'); saveStudentDraft();
        restoreFailedStudentRecord('failed-1', { date: today, exercise: '스쿼트', sets: oneSet('31'), memo: '복구', painCheck: true }, '학생A');
        expect(store().drafts[draftKey(today, '스쿼트')].sets[0].intensity.value).toBe('55');
        confirm.mockReturnValueOnce(false); recoverStudentDraft('failed-1');
        expect(store().recoveries['failed-1']).toBeDefined();
        recoverStudentDraft('failed-1');
        expect(fixture.state.currentSets[0].intensity.value).toBe('31');
        expect(nodes.get('memo').value).toBe('복구');
        expect(nodes.get('painCheck').checked).toBe(true);
    });
    it('routes a late failed write to its original account without touching the new account UI', () => {
        initializeStudentWorkspace();
        fixture.state.currentUser = '학생B';
        document.getElementById('studentDraftStatus').textContent = '새 계정 상태';
        restoreFailedStudentRecord('old-write', { date: today, exercise: '스쿼트', sets: oneSet('31') }, '학생A');
        expect(store('학생A').recoveries['old-write'].exercise).toBe('스쿼트');
        expect(store('학생B').drafts).toEqual({});
        expect(nodes.get('studentDraftStatus').textContent).toBe('새 계정 상태');
    });
});
