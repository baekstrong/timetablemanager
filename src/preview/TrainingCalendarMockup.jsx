import { useId, useState } from 'react';
import './training-calendar-mockup.css';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const pad = value => String(value).padStart(2, '0');
const dateParts = date => date.split('-').map(Number);
const monthLabel = month => { const [year, number] = month.split('-').map(Number); return `${year}년 ${number}월`; };
const fullDateLabel = date => {
    const [year, month, day] = dateParts(date);
    return `${month}월 ${day}일 ${WEEKDAYS[new Date(year, month - 1, day).getDay()]}요일`;
};
const offsetMonth = (month, offset) => {
    const [year, number] = month.split('-').map(Number);
    const date = new Date(year, number - 1 + offset, 1);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
};

function CheckMark() {
    return <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3 8 3 3 7-7" /></svg>;
}
function FeedbackMark({ size = 15 }) {
    return <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M16 3H4a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2v3l4-3h6a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Z" /><path d="M6 7h8M6 11h5" /></svg>;
}

export default function TrainingCalendarMockup({ today, days = [], onStart, hasDraft = false, hasTodayRecords = false }) {
    const todayMonth = today.slice(0, 7);
    const [month, setMonth] = useState(todayMonth);
    const [selectedDate, setSelectedDate] = useState(today);
    const calendarTitleId = useId();
    const detailTitleId = useId();
    const recordsByDate = new Map();
    days.forEach(day => {
        if (!day.date || day.date > today || !Array.isArray(day.records) || !day.records.length) return;
        recordsByDate.set(day.date, [...(recordsByDate.get(day.date) || []), ...day.records]);
    });
    const recordedDates = [...recordsByDate.keys()].filter(date => date.startsWith(`${month}-`));
    const [year, monthNumber] = month.split('-').map(Number);
    const firstWeekday = new Date(year, monthNumber - 1, 1).getDay();
    const daysInMonth = new Date(year, monthNumber, 0).getDate();
    const cellCount = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
    const selectedRecords = recordsByDate.get(selectedDate) || [];
    const selectedIsToday = selectedDate === today;
    const startLabel = hasDraft ? '이어서 기록하기' : hasTodayRecords ? '오늘 기록 확인·추가' : '오늘 운동 기록하기';
    const goToMonth = nextMonth => {
        if (nextMonth > todayMonth) return;
        setMonth(nextMonth);
        const dates = [...recordsByDate.keys()].filter(date => date.startsWith(`${nextMonth}-`)).sort();
        setSelectedDate(nextMonth === todayMonth ? today : dates.at(-1) || `${nextMonth}-01`);
    };

    return <section className="tlc" aria-label="월간 훈련일지">
        <div className="tlc-today-line"><span>{fullDateLabel(today)}</span>{hasDraft && <span className="tlc-draft-state">작성 중인 기록</span>}</div>
        <button type="button" className="tlc-start" onClick={onStart}><span>{startLabel}</span><span aria-hidden="true">＋</span></button>
        <section className="tlc-calendar-card" aria-labelledby={calendarTitleId}>
            <div className="tlc-month-heading"><h2 id={calendarTitleId}>{monthLabel(month)}</h2><div className="tlc-month-arrows"><button type="button" aria-label="이전 달" onClick={() => goToMonth(offsetMonth(month, -1))}>‹</button><button type="button" aria-label="다음 달" disabled={month >= todayMonth} onClick={() => goToMonth(offsetMonth(month, 1))}>›</button></div></div>
            <div className="tlc-month-summary"><p>{month === todayMonth ? '이번 달' : `${monthNumber}월`} 운동 기록 <strong>{recordedDates.length}<span>일</span></strong></p>{month !== todayMonth ? <button type="button" onClick={() => goToMonth(todayMonth)}>이번 달로</button> : <span>차곡차곡 쌓이는 내 기록</span>}</div>
            <div className="tlc-calendar" aria-label={`${monthLabel(month)} 운동 날짜`}>
                {WEEKDAYS.map(day => <span key={day} className="tlc-weekday" aria-hidden="true">{day}</span>)}
                {Array.from({ length: cellCount }, (_, index) => {
                    const dayNumber = index - firstWeekday + 1;
                    if (dayNumber < 1 || dayNumber > daysInMonth) return <span className="tlc-blank-day" key={`blank-${index}`} aria-hidden="true" />;
                    const date = `${month}-${pad(dayNumber)}`;
                    const records = recordsByDate.get(date) || [];
                    const hasRecords = records.length > 0;
                    const hasFeedback = records.some(record => Boolean(record.feedback));
                    const isToday = date === today;
                    const selected = date === selectedDate;
                    const future = date > today;
                    const label = `${fullDateLabel(date)}${isToday ? ', 오늘' : ''}, ${future ? '미래 날짜' : hasRecords ? `운동 기록 ${records.length}종목` : '운동 기록 없음'}${hasFeedback ? ', 코치 피드백 있음' : ''}`;
                    return <button type="button" key={date} className={`tlc-day${hasRecords ? ' has-record' : ''}${hasFeedback ? ' has-feedback' : ''}${isToday ? ' is-today' : ''}${selected ? ' is-selected' : ''}`} aria-label={label} aria-pressed={selected} aria-current={isToday ? 'date' : undefined} disabled={future} onClick={() => setSelectedDate(date)}>
                        <strong>{dayNumber}</strong><span className="tlc-day-marks" aria-hidden="true">{hasRecords && <CheckMark />}{isToday ? <small>오늘</small> : selected ? <small>선택</small> : !hasRecords ? <small>&nbsp;</small> : null}</span>{hasFeedback && <span className="tlc-feedback-dot" aria-hidden="true" />}
                    </button>;
                })}
            </div>
            <div className="tlc-calendar-legend"><span><i className="tlc-record-key"><CheckMark /></i>운동 기록</span><span><i className="tlc-feedback-key" />코치 피드백</span></div>
        </section>
        <section className="tlc-day-detail" aria-labelledby={detailTitleId}>
            <div className="tlc-detail-heading"><h2 id={detailTitleId}>{fullDateLabel(selectedDate)}</h2><span>{selectedIsToday ? '오늘' : '선택한 날짜'}</span></div>
            {selectedRecords.length > 0 ? <div className="tlc-record-list">{selectedRecords.map((record, index) => <article className="tlc-record" key={`${record.exercise}-${index}`}><div className="tlc-record-title"><span className="tlc-record-number">{pad(index + 1)}</span><h3>{record.exercise}</h3></div><p className="tlc-record-summary">{record.summary}</p>{record.memo && <p className="tlc-record-memo">{record.memo}</p>}{record.feedback && <div className="tlc-coach-feedback"><span><FeedbackMark />코치 피드백</span><p>{record.feedback}</p></div>}</article>)}</div> : <div className="tlc-empty"><span className="tlc-empty-icon" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h4" /></svg></span><strong>{selectedIsToday ? '오늘의 첫 기록을 남겨볼까요?' : '이날은 남긴 기록이 없어요'}</strong><p>{selectedIsToday ? hasDraft ? '작성하던 운동 기록을 이어서 남겨보세요.' : '운동한 내용을 기록하면 달력에 쌓여요.' : '표시된 날짜를 누르면 운동과 피드백을 볼 수 있어요.'}</p></div>}
        </section>
    </section>;
}
