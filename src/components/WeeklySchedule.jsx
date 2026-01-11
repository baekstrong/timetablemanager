import { useState, useMemo } from 'react';
import { PERIODS, DAYS, MOCK_DATA, MAX_CAPACITY } from '../data/mockData';
import './WeeklySchedule.css';

const WeeklySchedule = ({ user, onBack }) => {
    const [mode, setMode] = useState(user?.role || 'student'); // 'student' | 'coach'
    const [scheduleData, setScheduleData] = useState(MOCK_DATA);

    // --- Logic to process raw data into cell data ---
    const getCellData = (day, periodObj) => {
        // 1. Find Regular Enrollments for this slot
        const regularClass = scheduleData.regularEnrollments.find(
            e => e.day === day && e.period === periodObj.id
        );
        let studentNames = regularClass ? [...regularClass.names] : [];

        // 2. Identify Holds (People who are absent)
        const holds = scheduleData.holds.filter(
            h => h.day === day && h.period === periodObj.id
        );
        const holdNames = holds.map(h => h.name);

        // 3. Identify Substitutes (People filling in)
        const subs = scheduleData.substitutes.filter(
            s => s.day === day && s.period === periodObj.id
        );

        // 4. Calculate counts
        // Active Students = (Regular - Holds) + Substitutes
        const activeStudents = studentNames.filter(name => !holdNames.includes(name));
        const currentCount = activeStudents.length + subs.length;
        const availableSeats = Math.max(0, MAX_CAPACITY - currentCount);
        const isFull = availableSeats === 0;

        return {
            studentNames,
            holdNames,
            subs,
            currentCount,
            availableSeats,
            isFull,
            activeStudents
        };
    };

    const handleCellClick = (day, periodObj, cellData) => {
        if (periodObj.type === 'free') return;

        if (mode === 'student') {
            if (cellData.isFull) {
                alert('만석입니다. 대기 신청을 하시겠습니까?');
            } else {
                if (confirm(`${day}요일 ${periodObj.name}에 수강 신청(보강) 하시겠습니까?`)) {
                    // Logic to add current user as substitute would go here
                    alert('신청되었습니다!');
                }
            }
        } else {
            // Coach Mode
            const attendingList = [
                ...cellData.activeStudents,
                ...cellData.subs.map(s => s.name)
            ].join(', ');
            alert(`[${day}요일 ${periodObj.name} 출석 명단]\n${attendingList}`);
            // Navigate to training log logic would go here
        }
    };

    // Render logic for a single cell
    const renderCell = (day, periodObj) => {
        // Special Case: Free Training (Autonomous)
        if (periodObj.type === 'free') {
            return <div className="schedule-cell cell-free">자율 운동</div>;
        }

        const data = getCellData(day, periodObj);

        // --- STUDENT MODE RENDER ---
        if (mode === 'student') {
            if (data.currentCount === 0) {
                return <div className="schedule-cell cell-empty"><span style={{ color: '#999' }}>수업 없음</span></div>;
            }
            if (data.isFull) {
                return (
                    <div
                        className="schedule-cell cell-full"
                        onClick={() => handleCellClick(day, periodObj, data)}
                    >
                        <span className="cell-full-text">0</span>
                        <span style={{ fontSize: '0.8em' }}>(만석)</span>
                    </div>
                );
            }
            return (
                <div
                    className="schedule-cell cell-available"
                    onClick={() => handleCellClick(day, periodObj, data)}
                >
                    <span className="seat-count">{data.availableSeats}</span>
                    <span style={{ fontSize: '0.8em', color: '#666' }}>자리</span>
                </div>
            );
        }

        // --- COACH MODE RENDER ---
        else {
            if (data.currentCount === 0 && data.holdNames.length === 0) {
                return <div className="schedule-cell"><span style={{ color: '#ccc' }}>-</span></div>;
            }

            return (
                <div
                    className="schedule-cell"
                    onClick={() => handleCellClick(day, periodObj, data)}
                    style={{ alignItems: 'flex-start', justifyContent: 'flex-start', padding: '8px' }}
                >
                    {/* Header with count for Coach */}
                    <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', marginBottom: '4px', fontSize: '0.8rem', fontWeight: 'bold', borderBottom: '1px solid #eee' }}>
                        <span>{data.isFull ? <span style={{ color: 'red' }}>Full</span> : `${data.currentCount}명`}</span>
                    </div>

                    <div className="student-list">
                        {/* 1. Regular Students not on hold */}
                        {data.studentNames.map(name => {
                            const isHold = data.holdNames.includes(name);
                            if (isHold) return null; // Don't show holds in the main list, or show differently? 
                            // Request said: "who is attending"
                            return <span key={name} className="student-tag">{name}</span>;
                        })}

                        {/* 2. Substitutes */}
                        {data.subs.map(sub => (
                            <span key={sub.name} className="student-tag substitute">{sub.name}</span>
                        ))}

                        {/* 3. Holds (Optional: Show struck through or red?) */}
                        {data.holdNames.map(name => (
                            <span key={name} className="student-tag" style={{ backgroundColor: '#fee2e2', color: '#991b1b', textDecoration: 'line-through' }}>{name}</span>
                        ))}
                    </div>
                </div>
            );
        }
    };

    return (
        <div className="schedule-container">
            <div className="schedule-page-header">
                {onBack && (
                    <button onClick={onBack} className="back-button">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                        뒤로가기
                    </button>
                )}
                <h1 className="schedule-page-title">
                    {mode === 'coach' ? '코치 시간표' : '수강생 시간표'}
                </h1>
            </div>

            <div className="controls">
                <button
                    className={`mode-toggle ${mode === 'student' ? 'active' : ''}`}
                    onClick={() => setMode('student')}
                >
                    수강생 모드
                </button>
                <button
                    className={`mode-toggle ${mode === 'coach' ? 'active' : ''}`}
                    onClick={() => setMode('coach')}
                >
                    코치 모드
                </button>
            </div>

            <div className="schedule-grid">
                {/* Top Header: Time Label + Days */}
                <div className="grid-header"></div> {/* Empty corner slot */}
                {DAYS.map(day => (
                    <div key={day} className="grid-header">{day}</div>
                ))}

                {/* Rows: Each Period */}
                {PERIODS.map(period => (
                    <>
                        {/* Time Column */}
                        <div className="time-header">
                            <div className="period-name">{period.name}</div>
                            <div className="period-time">{period.time}</div>
                        </div>

                        {/* Day Columns for this Period */}
                        {DAYS.map(day => (
                            <div key={`${day}-${period.id}`} style={{ display: 'contents' }}>
                                {renderCell(day, period)}
                            </div>
                        ))}
                    </>
                ))}
            </div>

            <div className="legend">
                {mode === 'student' ? (
                    <>
                        <div className="legend-item"><span className="legend-color" style={{ background: '#ef4444' }}></span> 만석 (대기 가능)</div>
                        <div className="legend-item"><span className="legend-color" style={{ background: 'white', border: '1px solid #ccc' }}></span> 신청 가능 (숫자: 여석)</div>
                        <div className="legend-item"><span className="legend-color" style={{ background: '#f59e0b' }}></span> 자율 운동</div>
                    </>
                ) : (
                    <>
                        <div className="legend-item"><span className="student-tag" style={{ fontSize: '0.8rem' }}>김철수</span> 출석 예정</div>
                        <div className="legend-item"><span className="student-tag substitute" style={{ fontSize: '0.8rem' }}>이영희(보강)</span> 보강/대타</div>
                        <div className="legend-item"><span className="student-tag" style={{ fontSize: '0.8rem', backgroundColor: '#fee2e2', textDecoration: 'line-through' }}>박민수</span> 결석/홀딩</div>
                    </>
                )}
            </div>
        </div>
    );
};

export default WeeklySchedule;
