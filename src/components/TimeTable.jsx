import { useState, useEffect } from 'react';
import { useGoogleSheets } from '../contexts/GoogleSheetsContext';
import { getStudentField } from '../services/googleSheetsService';
import './TimeTable.css';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_MAP = {
    '월': 'Mon',
    '화': 'Tue',
    '수': 'Wed',
    '목': 'Thu',
    '금': 'Fri',
    '토': 'Sat',
    '일': 'Sun'
};
const START_HOUR = 6;
const END_HOUR = 23;
const HOURS = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => i + START_HOUR);

// Generate random color for each student
const generateColor = (index) => {
    const colors = [
        '#38bdf8', '#818cf8', '#34d399', '#f472b6', '#fb923c',
        '#a78bfa', '#4ade80', '#60a5fa', '#f87171', '#fbbf24'
    ];
    return colors[index % colors.length];
};

// Parse time string like "10:00" to hour number
const parseTime = (timeStr) => {
    if (!timeStr) return null;
    const match = timeStr.match(/(\d+):(\d+)/);
    if (match) {
        return parseInt(match[1]);
    }
    return null;
};

// Parse schedule string like "월수금 10:00" or "화목 14:00"
const parseSchedule = (scheduleStr) => {
    if (!scheduleStr) return [];

    const events = [];
    const parts = scheduleStr.split(' ');

    // Extract days and time
    let daysStr = '';
    let timeStr = '';

    for (const part of parts) {
        if (part.match(/\d+:\d+/)) {
            timeStr = part;
        } else {
            daysStr += part;
        }
    }

    if (!timeStr) return [];

    const hour = parseTime(timeStr);
    if (hour === null) return [];

    // Parse Korean days
    for (let i = 0; i < daysStr.length; i++) {
        const koreanDay = daysStr[i];
        const englishDay = DAY_MAP[koreanDay];
        if (englishDay) {
            events.push({
                day: englishDay,
                start: hour,
                duration: 1.5 // Default 1.5 hours
            });
        }
    }

    return events;
};

const TimeTable = () => {
    const { students, isConnected, loading } = useGoogleSheets();
    const [events, setEvents] = useState([]);

    // Convert student data to timetable events
    useEffect(() => {
        if (!students || students.length === 0) {
            setEvents([]);
            return;
        }

        const newEvents = [];
        students.forEach((student, index) => {
            const schedule = student['요일 및 시간'];
            const name = student['이름'];
            const isHolding = getStudentField(student, '홀딩 사용여부') === 'O';

            // Skip students on holding
            if (isHolding) return;

            const scheduleEvents = parseSchedule(schedule);
            scheduleEvents.forEach(event => {
                newEvents.push({
                    id: `${index}-${event.day}-${event.start}`,
                    day: event.day,
                    start: event.start,
                    duration: event.duration,
                    title: name,
                    color: generateColor(index)
                });
            });
        });

        setEvents(newEvents);
        console.log('📅 Generated timetable events:', newEvents);
    }, [students]);

    if (!isConnected) {
        return (
            <div className="timetable-container">
                <div className="not-connected-message">
                    <h3>Google Sheets에 연결되지 않았습니다</h3>
                    <p>대시보드에서 Google 계정을 연결해주세요.</p>
                </div>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="timetable-container">
                <div className="loading-message">
                    <div className="loading-spinner"></div>
                    <p>시간표를 불러오는 중...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="timetable-container">
            <div className="glass-panel timetable-grid">
                {/* Header Row */}
                <div className="header-cell">Time</div>
                {DAYS.map(day => (
                    <div key={day} className="header-cell">{day}</div>
                ))}

                {/* Time Labels Column */}
                <div className="time-col">
                    {HOURS.map(hour => (
                        <div key={hour} className="time-slot-label">
                            {hour}:00
                        </div>
                    ))}
                </div>

                {/* Days Columns */}
                {DAYS.map(day => (
                    <div key={day} className="day-col">
                        {/* Render Background Slots */}
                        {HOURS.map(hour => (
                            <div
                                key={`${day}-${hour}`}
                                className="time-slot"
                            />
                        ))}

                        {/* Render Events for this Day */}
                        {events
                            .filter(ev => ev.day === day)
                            .map(ev => (
                                <div
                                    key={ev.id}
                                    className="event-card"
                                    style={{
                                        top: `${(ev.start - START_HOUR) * 60}px`,
                                        height: `${ev.duration * 60}px`,
                                        backgroundColor: ev.color
                                    }}
                                    title={`${ev.title} - ${ev.start}:00`}
                                >
                                    <div className="event-time">
                                        {ev.start}:00 - {Math.floor(ev.start + ev.duration)}:{(ev.duration % 1) * 60 || '00'}
                                    </div>
                                    <div>{ev.title}</div>
                                </div>
                            ))
                        }
                    </div>
                ))}
            </div>
        </div>
    );
};

export default TimeTable;
