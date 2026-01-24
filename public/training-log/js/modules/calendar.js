import { state, db } from '../state.js';
import { formatDate } from '../utils.js';

// ============================================
// 캘린더 렌더링 (수강생)
// ============================================

export async function renderCalendar() {
    const calendarDiv = document.getElementById('calendar');
    if (!calendarDiv) return;

    const today = new Date();

    // state.calendarYear, state.calendarMonth 사용
    const firstDay = new Date(state.calendarYear, state.calendarMonth, 1);
    const lastDay = new Date(state.calendarYear, state.calendarMonth + 1, 0);

    const startDate = firstDay.toISOString().split('T')[0];
    const endDate = lastDay.toISOString().split('T')[0];

    try {
        const snapshot = await db.collection('records')
            .where('userName', '==', state.currentUser)
            .where('date', '>=', startDate)
            .where('date', '<=', endDate)
            .get();

        const workoutDates = new Set();
        const feedbackDates = new Set();
        snapshot.forEach(doc => {
            const data = doc.data();
            workoutDates.add(data.date);
            if (data.feedback && data.feedback.trim() !== '') {
                feedbackDates.add(data.date);
            }
        });

        const monthNames = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];

        let html = `
            <div class="flex justify-between items-center mb-3">
                <button onclick="changeCalendarMonth(-1)" class="px-3 py-1 bg-gray-200 hover:bg-gray-300 rounded">◀</button>
                <div class="text-center font-bold text-lg">${state.calendarYear}년 ${monthNames[state.calendarMonth]}</div>
                <button onclick="changeCalendarMonth(1)" class="px-3 py-1 bg-gray-200 hover:bg-gray-300 rounded">▶</button>
            </div>
            <div class="grid grid-cols-7 gap-1 text-center text-sm">
                <div class="text-red-600 font-semibold py-2">일</div>
                <div class="font-semibold py-2">월</div>
                <div class="font-semibold py-2">화</div>
                <div class="font-semibold py-2">수</div>
                <div class="font-semibold py-2">목</div>
                <div class="font-semibold py-2">금</div>
                <div class="text-blue-600 font-semibold py-2">토</div>
        `;

        const firstDayOfWeek = firstDay.getDay();
        for (let i = 0; i < firstDayOfWeek; i++) {
            html += '<div></div>';
        }

        const daysInMonth = lastDay.getDate();
        for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = `${state.calendarYear}-${String(state.calendarMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const isToday = dateStr === today.toISOString().split('T')[0];
            const isSelected = dateStr === state.selectedDate;
            const hasWorkout = workoutDates.has(dateStr);
            const hasFeedback = feedbackDates.has(dateStr);

            let classes = 'calendar-day flex items-center justify-center rounded-lg cursor-pointer transition';
            if (isToday) classes += ' today';
            if (isSelected) classes += ' selected-date';
            if (hasFeedback) classes += ' has-feedback';
            else if (hasWorkout) classes += ' has-workout';
            else classes += ' hover:bg-gray-200';

            html += `<div class="${classes}" onclick="selectCalendarDate('${dateStr}')">${day}</div>`;
        }

        html += '</div>';
        calendarDiv.innerHTML = html;
    } catch (error) {
        console.error('Error rendering calendar:', error);
        calendarDiv.innerHTML = '<p class="text-red-500 text-sm">달력 로딩 실패</p>';
    }
}

export function changeCalendarMonth(delta) {
    state.calendarMonth += delta;

    if (state.calendarMonth < 0) {
        state.calendarMonth = 11;
        state.calendarYear--;
    } else if (state.calendarMonth > 11) {
        state.calendarMonth = 0;
        state.calendarYear++;
    }

    renderCalendar();
}

export function selectCalendarDate(dateStr) {
    state.selectedDate = dateStr;

    // 화면 제목 업데이트 (DOM 직접 조작)
    const titleElement = document.querySelector('.max-w-2xl .bg-white.rounded-lg.shadow-md.p-6.mb-4 h3');
    if (titleElement) {
        titleElement.textContent = `🏋️ ${formatDate(state.selectedDate)} 운동 기록`;
    }

    const recordsTitleElement = document.querySelector('.max-w-2xl .bg-white.rounded-lg.shadow-md.p-6:last-child h3');
    if (recordsTitleElement) {
        recordsTitleElement.textContent = `📝 ${formatDate(state.selectedDate)} 기록`;
    }

    renderCalendar();

    if (window.loadMyRecords) {
        window.loadMyRecords();
    }
}
