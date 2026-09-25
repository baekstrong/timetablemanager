import { state, db } from '../state.js';
import { formatDate } from '../utils.js';
import { localDate, calendarSummary, escapeHTML } from './student-workspace-logic.js?v=20260925-student-ux';

const calendarCache = new Map();
let calendarRequest = 0;
const monthKey = () => `${state.calendarYear}-${String(state.calendarMonth + 1).padStart(2, '0')}`;
export async function renderCalendar(refresh = true) {
    const calendarDiv = document.getElementById('calendar');
    if (!calendarDiv || !state.currentUser || state.isCoach || !db) return;
    const request = ++calendarRequest;
    const month = monthKey();
    const user = state.currentUser;
    const cacheKey = `${user}__${month}`;
    const lastDay = new Date(state.calendarYear, state.calendarMonth + 1, 0).getDate();
    try {
        let records = calendarCache.get(cacheKey);
        if (refresh || !records) {
            const snapshot = await db.collection('records').where('userName', '==', user).where('date', '>=', `${month}-01`).where('date', '<=', `${month}-${lastDay}`).get();
            records = []; snapshot.forEach(doc => records.push(doc.data()));
            if (request !== calendarRequest || user !== state.currentUser || month !== monthKey()) return;
            calendarCache.set(cacheKey, records);
        }
        if (request !== calendarRequest || user !== state.currentUser || month !== monthKey()) return;
        const today = localDate();
        const { dates, feedbackDates } = calendarSummary(records, month, today);
        if (month === today.slice(0, 7)) {
            state.studentTodayHasRecords = dates.has(today);
            window.updateStudentStartButton?.();
        }
        let html = `<div class="student-calendar-heading"><h3>${state.calendarYear}년 ${state.calendarMonth + 1}월</h3><div><button type="button" aria-label="이전 달" onclick="changeCalendarMonth(-1)">‹</button><button type="button" aria-label="다음 달" onclick="changeCalendarMonth(1)" ${month >= today.slice(0, 7) ? 'disabled' : ''}>›</button></div></div><div class="student-calendar-summary"><p>운동 기록 <strong>${dates.size}<small>일</small></strong></p>${month !== today.slice(0, 7) ? '<button type="button" onclick="returnToCurrentMonth()">이번 달로</button>' : '<span>기록을 남긴 날짜예요</span>'}</div><div class="student-calendar-grid">${['일', '월', '화', '수', '목', '금', '토'].map(day => `<span class="student-calendar-weekday">${day}</span>`).join('')}`;
        const firstDay = new Date(state.calendarYear, state.calendarMonth, 1).getDay();
        for (let index = 0; index < firstDay; index++) html += '<span></span>';
        for (let day = 1; day <= lastDay; day++) {
            const date = `${month}-${String(day).padStart(2, '0')}`;
            const workout = dates.has(date);
            const feedback = feedbackDates.has(date);
            const selected = date === state.selectedDate;
            html += `<button type="button" class="student-calendar-day ${workout ? 'has-record' : ''} ${date === today ? 'is-today' : ''} ${selected ? 'is-selected' : ''}" ${date > today ? 'disabled' : ''} aria-pressed="${selected}" ${date === today ? 'aria-current="date"' : ''} aria-label="${escapeHTML(date)} ${workout ? '운동 기록 있음' : '기록 없음'}${feedback ? ', 코치 피드백 있음' : ''}" onclick="selectCalendarDate('${date}')"><strong>${day}</strong><small>${workout ? '✓ ' : ''}${date === today ? '오늘' : selected ? '선택' : '&nbsp;'}</small>${feedback ? '<i aria-hidden="true"></i>' : ''}</button>`;
        }
        html += '</div><div class="student-calendar-legend"><span><b>✓</b> 운동 기록</span><span><i></i> 코치 피드백</span></div>';
        calendarDiv.innerHTML = html;
    } catch (error) {
        if (request !== calendarRequest) return;
        console.error('Error rendering calendar:', error);
        calendarDiv.innerHTML = '<p class="student-help">달력을 불러오지 못했어요. <button type="button" onclick="renderCalendar()">다시 시도</button></p>';
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
    renderCalendar(false);
    window.loadMyRecords?.();
}

export function invalidateStudentCalendar(date) {
    calendarCache.delete(`${state.currentUser}__${date.slice(0, 7)}`);
}
