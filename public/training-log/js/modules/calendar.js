import { state, db } from '../state.js';
import { formatDate } from '../utils.js';
import { localDate, calendarSummary, escapeHTML } from './student-workspace-logic.js?v=20260925-student-ux';

const calendarCache = new Map();
const calendarInflight = new Map();
const calendarGenerations = new Map();
const CALENDAR_CACHE_MS = 30_000;
const SAVED_CALENDAR_MS = 7 * 24 * 60 * 60 * 1000;
let calendarRequest = 0;
const monthKey = () => `${state.calendarYear}-${String(state.calendarMonth + 1).padStart(2, '0')}`;
const storageKey = (user, month) => `trainingCalendar_v1_${encodeURIComponent(user)}_${month}`;

// 날짜/피드백 유무만 보관한다. 운동 내용은 저장하지 않고 인증된 동일 계정에서만 읽는다.
function savedCalendar(user, month) {
    try {
        const saved = JSON.parse(localStorage.getItem(storageKey(user, month)) || 'null');
        if (!saved || !Number.isFinite(saved.at) || saved.at > Date.now() || Date.now() - saved.at > SAVED_CALENDAR_MS || !Array.isArray(saved.dates) || !Array.isArray(saved.feedbackDates)) return null;
        const valid = date => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && date.startsWith(`${month}-`);
        return { at: saved.at, dates: saved.dates.filter(valid), feedbackDates: saved.feedbackDates.filter(valid) };
    } catch { return null; }
}
function paintCalendar(summary, { loading = false, failed = false } = {}) {
    const calendarDiv = document.getElementById('calendar');
    if (!calendarDiv) return;
    const month = monthKey();
    const today = localDate();
    const dates = new Set(summary?.dates || []);
    const feedbackDates = new Set(summary?.feedbackDates || []);
    const lastDay = new Date(state.calendarYear, state.calendarMonth + 1, 0).getDate();
    if (summary && month === today.slice(0, 7)) {
        state.studentTodayHasRecords = dates.has(today);
        window.updateStudentStartButton?.();
    }
    let html = `<div class="student-calendar-heading"><h3>${state.calendarYear}년 ${state.calendarMonth + 1}월</h3><div><button type="button" aria-label="이전 달" onclick="changeCalendarMonth(-1)">‹</button><button type="button" aria-label="다음 달" onclick="changeCalendarMonth(1)" ${month >= today.slice(0, 7) ? 'disabled' : ''}>›</button></div></div><div class="student-calendar-summary"><p>운동 기록 <strong>${summary ? dates.size : '—'}<small>일</small></strong></p>${month !== today.slice(0, 7) ? '<button type="button" onclick="returnToCurrentMonth()">이번 달로</button>' : '<span>기록을 남긴 날짜예요</span>'}</div>`;
    if (loading) html += `<p class="student-help" role="status">${summary ? '마지막 확인 기록 · 새 기록 확인 중…' : '운동 기록 확인 중…'}</p>`;
    if (failed) html += `<p class="student-help" role="status">${summary ? '마지막 확인 기록이에요. 새 기록을 확인하지 못했어요.' : '운동 기록을 확인하지 못했어요.'} <button type="button" onclick="renderCalendar()">다시 시도</button></p>`;
    html += `<div class="student-calendar-grid">${['일', '월', '화', '수', '목', '금', '토'].map(day => `<span class="student-calendar-weekday">${day}</span>`).join('')}`;
    const firstDay = new Date(state.calendarYear, state.calendarMonth, 1).getDay();
    for (let index = 0; index < firstDay; index++) html += '<span></span>';
    for (let day = 1; day <= lastDay; day++) {
        const date = `${month}-${String(day).padStart(2, '0')}`;
        const workout = dates.has(date);
        const feedback = feedbackDates.has(date);
        const selected = date === state.selectedDate;
        html += `<button type="button" class="student-calendar-day ${workout ? 'has-record' : ''} ${date === today ? 'is-today' : ''} ${selected ? 'is-selected' : ''}" ${date > today ? 'disabled' : ''} aria-pressed="${selected}" ${date === today ? 'aria-current="date"' : ''} aria-label="${escapeHTML(date)} ${summary ? workout ? '운동 기록 있음' : '기록 없음' : '기록 확인 중'}${feedback ? ', 코치 피드백 있음' : ''}" onclick="selectCalendarDate('${date}')"><strong>${day}</strong><small>${workout ? '✓ ' : ''}${date === today ? '오늘' : selected ? '선택' : '&nbsp;'}</small>${feedback ? '<i aria-hidden="true"></i>' : ''}</button>`;
    }
    html += '</div><div class="student-calendar-legend"><span><b>✓</b> 운동 기록</span><span><i></i> 코치 피드백</span></div>';
    calendarDiv.innerHTML = html;
}
function fetchCalendar(user, month) {
    const key = `${user}__${month}`;
    if (calendarInflight.has(key)) return calendarInflight.get(key);
    const generation = calendarGenerations.get(key) || 0;
    const [year, monthNumber] = month.split('-').map(Number);
    const lastDay = new Date(year, monthNumber, 0).getDate();
    const request = db.collection('records').where('userName', '==', user)
        .where('date', '>=', `${month}-01`).where('date', '<=', `${month}-${lastDay}`).get().then(snapshot => {
            if ((calendarGenerations.get(key) || 0) !== generation) return null;
            const records = []; snapshot.forEach(doc => records.push(doc.data()));
            const { dates, feedbackDates } = calendarSummary(records, month, localDate());
            const summary = { at: Date.now(), dates: [...dates], feedbackDates: [...feedbackDates] };
            calendarCache.set(key, summary);
            try { localStorage.setItem(storageKey(user, month), JSON.stringify(summary)); } catch { /* 캐시 없이도 표시한다. */ }
            return summary;
        }).finally(() => { if (calendarInflight.get(key) === request) calendarInflight.delete(key); });
    calendarInflight.set(key, request);
    return request;
}
export async function renderCalendar(refresh = true) {
    if (!document.getElementById('calendar') || !state.currentUser || state.isCoach || !db) return;
    const request = ++calendarRequest;
    const month = monthKey();
    const user = state.currentUser;
    const key = `${user}__${month}`;
    const cached = calendarCache.get(key);
    const preview = cached || savedCalendar(user, month);
    const fresh = cached && Date.now() - cached.at < CALENDAR_CACHE_MS;
    // 첫 응답 전에도 날짜를 고를 수 있다. 저장된 표시는 갱신 중임을 함께 알린다.
    paintCalendar(preview, { loading: refresh || !fresh });
    if (!refresh && fresh) return;
    try {
        const summary = await fetchCalendar(user, month);
        if (!summary || request !== calendarRequest || user !== state.currentUser || month !== monthKey()) return;
        paintCalendar(summary);
    } catch (error) {
        if (request !== calendarRequest || user !== state.currentUser || month !== monthKey()) return;
        console.error('Error rendering calendar:', error);
        paintCalendar(preview, { failed: true });
    }
}

export function changeCalendarMonth(delta) {
    const target = new Date(state.calendarYear, state.calendarMonth + delta, 1);
    const today = new Date();
    if (target > new Date(today.getFullYear(), today.getMonth(), 1)) return;
    state.calendarYear = target.getFullYear(); state.calendarMonth = target.getMonth();
    const date = monthKey() === localDate().slice(0, 7) ? localDate() : `${monthKey()}-01`;
    selectCalendarDate(date);
}
export function returnToCurrentMonth() {
    const today = new Date(); state.calendarYear = today.getFullYear(); state.calendarMonth = today.getMonth();
    selectCalendarDate(localDate());
}
export function selectCalendarDate(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > localDate()) return;
    state.selectedDate = date; // View date only: never changes studentWriteDate or the draft.
    const [year, month] = date.split('-').map(Number);
    state.calendarYear = year; state.calendarMonth = month - 1;
    const title = document.getElementById('recordsListTitle');
    if (title) title.textContent = `${formatDate(date)} 기록`;
    window.updateStudentStartButton?.();
    renderCalendar(false);
    window.loadMyRecords?.();
}

export function invalidateStudentCalendar(date, user = state.currentUser) {
    if (!user || !date) return;
    const month = date.slice(0, 7);
    const key = `${user}__${month}`;
    calendarGenerations.set(key, (calendarGenerations.get(key) || 0) + 1);
    calendarCache.delete(key);
    calendarInflight.delete(key);
    try { localStorage.removeItem(storageKey(user, month)); } catch { /* 저장소 사용 불가 */ }
}
